# KINGDOM ZERO — Phase 6 (v0.6.0)

Simulation de vie médiévale / RPG sandbox systémique. Le **pays de Valcendre** vit sans le joueur :
trois localités reliées par des routes, environ 48 habitants qui travaillent, achètent, mangent, se lient
d’amitié, se disputent, s’endettent, déménagent, montent des caravanes, perdent leur emploi, volent,
tombent malades, meurent et sont remplacés par des migrants. Le joueur arrive **sans un denier**.

## Lancer le jeu

```bash
npm install
```
```bash
npm run dev
```
Puis ouvrir http://localhost:5173 (navigateur de bureau ou mobile).

Autres commandes :

| Commande | Rôle |
|---|---|
| `npm test` | 95 tests automatisés (scénarios A–G, phases 2 à 6, invariants, fuzz) |
| `npx vite-node scripts/generations.ts 1792 42` | 16 ans simulés : population, couples, naissances, majorités |
| `npm run build` | vérification TypeScript stricte + build de production dans `dist/` |
| `npm run demo` | partie scriptée de bout en bout, affichée dans le terminal |
| `npm run sim -- 224 42` | simulation headless : 224 jours, graine 42, bilan économique |
| `npx vite-node scripts/chronicle.ts 224 42 loan default seizure sale` | chronique complète des événements choisis |

Aucune clé API, aucun service externe : tout tourne localement (polices embarquées via `@fontsource`).

## Architecture

```
src/engine/        moteur pur TypeScript — aucune dépendance à React, testable seul
  types.ts         modèles de données (état 100 % JSON sérialisable)
  rng.ts           PRNG déterministe (mulberry32), état sauvegardé dans GameState
  time.ts          calendrier : heures, jours, semaines, saisons (28 j), années
  data.ts          tables de règles : biens, recettes, compétences, traits
  world.ts         génération du village (lieux, établissements, habitants, liens)
  sim.ts           boucle temporelle : tick horaire, tick quotidien, mort, migration
  npc.ts           IA des PNJ : besoins → scores d’utilité → action réelle
  economy.ts       prix offre/demande, transactions atomiques, production, salaires, embauche
  social.ts        relations asymétriques, interactions, rumeurs, réputation
  crime.ts         vol, détection par témoins, amendes
  skills.ts        apprentissage par la pratique (rendements décroissants)
  player.ts        actions du joueur, toutes validées par les règles
  narrative.ts     textes générés uniquement à partir de l’état
  events.ts        journal des faits (témoins, causes, connaissance)
  save.ts          sauvegarde versionnée + somme de contrôle + migrations
  invariants.ts    contrôles d’intégrité, bilans monétaire et matière
  finance.ts       prêts, échéances hebdomadaires, défaut, saisie de biens et d’entreprise (phase 2)
  contracts.ts     place salariée du joueur, tableau des commandes (phase 2)
  society.ts       ambitions des PNJ, rachat d’entreprise, mobilité, vengeance, fêtes, réputation (phase 2)
  trade.ts         caravanes marchandes, charge portée, mémoire des prix des marchands (phase 3)
  property.ts      logements : location, achat, coffre, loyers, expulsion (phase 3)
  enterprise.ts    rachat et gestion d’entreprise par le joueur, fondations (phase 3)
  territory.ts     prospérité des localités, relevés hebdomadaires, déménagements (phase 3)
  orgs.ts          organisations : maisons, guilde, bande ; rôles, succession, dissolution (phase 4)
  combat.ts        combat au tour par tour, blessures, issue mortelle ou non (phase 4)
  gangs.ts         brigandage : recrutement secret, embuscades, racket, saccage, recel (phase 4)
  justice.ts       avis de recherche, primes, arrestations, prison (phase 4)
  nobility.ts      tribut, garnison, impôts, grogne, révoltes, diplomatie, guerre, complots (phase 4)
  playerPower.ts   embuscades et arrestations du joueur, requêtes au seigneur, patrouilles ; cour, mariage,
                   vie au jour le jour (phases 4 et 5)
  family.ts        anniversaires, cour, mariage, naissances, enfance, succession, tutelle, domesticité,
                   lignée du joueur (phase 5) ; dons aux hospices (phase 6)
  incidents.ts     aléas : sécheresse, belle récolte, grand froid, épidémie, incendie, foire ;
                   convoi de grain d'urgence (phase 6)
  approaches.ts    initiatives des PNJ envers le joueur (phase 6)
src/ui/            interface React (carte SVG, panneaux, dialogues, sauvegarde)
  audio.ts         ambiance sonore procédurale (Web Audio, aucun fichier)
  a11y.ts, prefs.ts  fenêtres accessibles (focus, Échap), préférences (son, texte, mouvement, contraste)
  Toasts.tsx, HelpModal.tsx, ErrorBoundary.tsx  notifications, aide et options, filet anti-plantage
tests/             Vitest
scripts/           demo et simulation headless
```

**Temps.** Chaque action consomme des minutes ; le monde est résolu à chaque frontière d’heure
franchie (`processedHours` empêche tout double calcul). Une action de 10 minutes qui ne franchit
pas d’heure ne déclenche aucune simulation ; 24 × 1 h, 1 × 24 h et 144 × 10 min donnent un état
identique (testé). La simulation est suspendue quand le jeu est fermé.

**Économie fermée.** L’argent n’est jamais créé par un échange : il circule entre bourses et caisses.
Les biens ne naissent que par les recettes (ferme → grain, bois → fagots, mine → fer, fournil :
2 grain + 1 bois → 10 pains, auberge : grain → bière, forge : fer + bois → outil) et disparaissent par
la consommation, l’usure des outils et le pourrissement. Seuls les migrants apportent de l’argent
de l’extérieur, et c’est comptabilisé dans le grand livre. Le bilan est vérifié à 0 près.

**IA des PNJ.** Chaque heure, un PNJ évalue faim, énergie, vie sociale, emploi, argent, saison ;
note les actions faisables (dormir, travailler, acheter du pain ou du grain, du bois de chauffe,
vendre son surplus, chercher un emploi, ramasser du bois mort, aller à la taverne, mendier, voler…)
et exécute la meilleure. L’activité affichée (« Achète 3 pains au Fournil (4 d) ») est la trace de
cette décision, jamais un texte décoratif. Les propriétaires gèrent chaque matin : remboursement des
salaires dus, approvisionnement auprès des autres entreprises, rémunération, embauche/licenciement.

**Connaissance imparfaite.** Un événement n’est connu que de ses témoins ; il circule ensuite par
les conversations de taverne (rumeurs) et modifie l’opinion de ceux qui l’apprennent. Un vol non
repéré est connu du propriétaire comme « marchandise disparue » sans coupable ; le fait réel n’est
visible que dans la Chronique omnisciente (vue de débogage).

## Phase 2 — profondeur sociale

**Endettement.** Les PNJ empruntent à ceux qui ont de l'argent : un patron dont la caisse ne paie plus
ses ouvriers, un affamé sans le sou auprès d'un ami. Le taux dépend du prêteur (avare, généreux,
ambitieux) et de la relation (un ami prête presque sans intérêt). Les échéances sont prélevées chaque
semaine sur la bourse, puis sur la caisse de l'entreprise du débiteur. Deux échéances manquées valent
défaut : le créancier saisit l'argent, les biens, puis l'entreprise si la dette reste lourde. Le débiteur
ruiné peut garder rancune. Le joueur peut emprunter, prêter (et saisir à son tour) et rembourser.

**Contrats.** Après quelques journées de travail, un patron qui te connaît peut t'offrir une place :
salaire garanti, revu à la hausse avec ta compétence, 24 h par semaine au minimum. Chaque lundi, le
patron fait le bilan : éloge (qui se répand), avertissement, puis renvoi. Les entreprises en pénurie
affichent des **commandes** au tableau de la Place du Puits ; livrer à temps rapporte un bon prix, un
impayé devient une reconnaissance de dette, une commande non livrée coûte la confiance du client.
Le marchand honore lui-même les commandes qu'il peut servir.

**Ambitions des PNJ.** Chaque habitant poursuit un but : posséder un commerce (il épargne, se prive de
bière, rachète une affaire à vendre, emprunte le complément), faire fortune, trouver une place mieux
payée (il démissionne quand un établissement qui embauche paie mieux), ou se venger. Un rancunier,
un colérique ou un malhonnête humilié se venge en calomniant sa cible à la taverne ; la calomnie
circule comme une rumeur, mais ceux qui apprécient la cible n'y croient pas et se méfient du calomniateur.

**Personnalités.** Quatre nouveaux traits : rancunier (les rancunes s'apaisent à peine), loyal (ne change
pas de place, tolère plus d'impayés), bavard (colporte deux fois plus), prudent (prête peu, n'emprunte
qu'en dernier recours).

**Vie sociale.** Le premier jour de chaque saison, la fête au Sanglier Gris : l'intendance paie la
bière si le trésor le permet, tout le village s'y rend, les liens se resserrent. Les amitiés et les
rivalités naissent des soirées et sont consignées au journal.

**Réputation par catégories.** Voleur, mauvais payeur, querelleur, calomnié, parole non tenue, généreux,
bon payeur, travailleur : chaque étiquette indique combien d'habitants le savent réellement.

Exemples tirés de la simulation sans le joueur : avec la graine 42, Bertrand emprunte 104 d à Perrine
pour renflouer sa halle, ne rembourse pas, et Perrine saisit la Halle du Marché à l'automne. Avec la
graine 3, Isabeau, ambitieuse, rachète le Bois de la Combe à Renaud, en difficulté, pour 318 d.
Ces trajectoires dépendent de la graine : la plupart des parties n'en voient qu'une ou deux par an.

Format de sauvegarde v2 ; les sauvegardes v1 sont migrées automatiquement (testé).

## Phase 3 — économie et territoires

**Trois localités.** Valcendre (carrefour), Saint-Aubin-sur-Loue (bourg agricole : blé abondant, ni fer
ni forge) et Hautepierre (bourg minier : fer riche, grande forge, terrasses pauvres). Chacune a son
intendance, son impôt, ses chemins, sa garde, sa fête. Routes : Valcendre ↔ Saint-Aubin 5 h,
Valcendre ↔ Hautepierre 7 h ; Saint-Aubin ↔ Hautepierre passe par Valcendre (12 h). Le monde continue
de tourner heure par heure pendant le voyage.

**Commerce local, prix locaux.** Habitants et entreprises n'achètent que dans la localité où ils se
trouvent ; la spécialisation (rendements ×1,5 pour le blé de Saint-Aubin, ×1,8 pour le fer de
Hautepierre) crée de vrais écarts de prix. Le joueur ne connaît les prix d'une localité que par son
dernier passage (onglet Monde → Prix de la région).

**Caravanes.** Les marchands comparent les prix connus de chaque destination (relevés hebdomadaires :
l'information a du retard), achètent une cargaison, partent sur la route (on les voit avancer sur la
carte régionale), vendent à destination, puis rentrent chargés. La cargaison existe physiquement pendant
le trajet. Ils retiennent le prix réellement obtenu et évitent de répéter un voyage perdant. Deux
marchands qui inondent la même localité se font concurrence.

**Charge portée.** 40 + 4 × force unités de poids (le grain pèse 2, le fer 3…). Pour commercer en grand,
il faut un logement avec coffre.

**Logements.** Une chambre se loue à l'auberge, une maison se loue ou s'achète auprès de l'intendance.
On y dort gratuitement et on y entrepose. Le loyer se paie chaque lundi ; impayé, c'est l'expulsion et
la saisie du coffre.

**Entreprises.** Le joueur peut racheter une affaire à vendre (ou faire une offre à un propriétaire qui
le connaît et l'estime), puis la diriger : caisse, salaire, effectif, stocks visés ; un contremaître
achète, vend et embauche selon ces consignes. Il peut aussi fonder un comptoir, une boulangerie, un
cabaret ou une forge depuis une place (travaux payés à l'intendance, fonds de roulement dans la caisse).
Les PNJ ambitieux sans affaire à racheter peuvent fonder là où l'offre manque.

**Territoires vivants.** Chaque lundi, la prospérité de chaque localité est recalculée (emploi, faim,
richesse, chemins, santé des entreprises). Les chômeurs sans perspective déménagent vers une localité
qui embauche ; les migrants extérieurs ne viennent que s'il n'y a pas déjà de chômeurs sur place.
Une soupe populaire nourrit les affamés sans le sou quand le trésor local le permet.

Sur 224 jours simulés sans le joueur (4 graines) : 6 à 11 décès pour environ 48 habitants, 2 à 5
déménagements, 1 à 3 saisies d'entreprise, 0 ou 1 rachat, 7 à 10 expéditions de caravane ; masse
monétaire et bilan matière exacts.

Format de sauvegarde v3 ; les sauvegardes v1 et v2 sont migrées automatiquement (testé) — une partie
v2 voit s'ouvrir les routes vers les deux bourgs.

## Phase 4 — pouvoir et conflits

**Organisations.** Deux maisons nobles (Delaval tient Valcendre et Saint-Aubin, la Maison de Roche tient
Hautepierre), la Guilde des marchands de la Loue et une bande, les Loups de la Combe. Chacune a un chef,
des membres avec un rôle, un trésor, une réserve de biens et des relations. À la mort du chef, l'héritier
ou le membre le plus apte lui succède ; sans successeur, l'organisation disparaît.

**Combat au tour par tour.** Compétence, force, agilité, santé et nombre comptent. Les coups retirent de
vrais points de vie ; un combattant à terre peut mourir. Le même moteur résout les embuscades, les
arrestations, les batailles et les attentats.

**Brigands.** La bande recrute en secret des désespérés malhonnêtes (seuls ses membres le savent), tend des
embuscades aux caravanes et aux voyageurs sur les routes qui partent de son repaire, rançonne les commerces
et saccage ceux qui refusent, puis écoule son butin chez un receleur et partage le trésor. Si le danger
devient trop grand (avis de recherche, patrouilles), elle se terre. Le joueur pris en embuscade choisit
à chaque tour : se battre, fuir, parlementer, payer ou se rendre. Un bandit reconnu est recherché.

**Justice.** Les autorités n'agissent que sur ce qu'elles savent : un vol sans témoin reste impuni, un
voleur surpris qui s'enfuit devient recherché, une victime qui a reconnu son agresseur porte plainte.
Gardes et soldats en service arrêtent les recherchés qu'ils croisent (combat non mortel), la prison dure
des jours, le geôlier achète le pain des prisonniers. Le joueur recherché est interpellé : se rendre,
corrompre (si aucun garde n'est honnête), fuir ou résister.

**Gouvernement.** Chaque semaine, 40 % des impôts remontent à la maison seigneuriale, qui paie ses soldats
(ils désertent sans solde), recrute selon la menace (brigands connus, guerre), envoie des patrouilles sur
les routes infestées, secourt ses localités affamées (sauf un seigneur avare), et ajuste l'impôt selon son
trésor et la grogne. La grogne se calcule sur des faits : faim, impôt, crimes du mois, pauvreté, guerre.
Deux semaines de forte grogne déclenchent une révolte : l'impôt n'est plus perçu pendant deux semaines.

**Diplomatie et guerre.** Les relations entre maisons évoluent selon le caractère des seigneurs. Une maison
rancunière, menée par un chef ambitieux ou colérique et nettement plus forte, déclare la guerre pour une
localité voisine. Une bataille par semaine, avec de vrais morts ; deux victoires de l'assaillant valent
conquête (le tribut change de maître), sinon la paix est signée avec une indemnité.

**Complots.** Un héritier ambitieux et sans scrupule peut payer la bande pour faire assassiner son seigneur.
Si un assassin est capturé, il avoue : le complot devient public et l'héritier est recherché.

**Pour le joueur.** Parler à un seigneur permet de demander le titre d'écuyer (avoir fait ses preuves, ou
payer des droits), puis une charge de conseiller (influence réelle sur l'impôt et la paix), de s'engager
dans la garnison (solde si 12 heures de patrouille par semaine ; en patrouille, on arrête les recherchés et
on touche la prime) et de dénoncer les crimes dont on a connaissance. L'onglet Pouvoir montre les avis de
recherche, les maisons, la grogne, les guerres, la guilde, et des bandes seulement ce que ton personnage en sait.

Sur 224 jours simulés sans le joueur (6 graines) : 9 à 11 décès pour environ 52 habitants, 2 à 7
embuscades, une trentaine de rackets, 1 à 6 emprisonnements, 0 à 5 successions ; un complot contre
Guérin Delaval (graine 7). Aucune guerre ni révolte n'éclate spontanément sur ces graines : la Maison de
Roche, la plus belliqueuse, est aussi la plus pauvre. Les tests les déclenchent en forçant les conditions.

Format de sauvegarde v4 ; les sauvegardes v1 à v3 sont migrées automatiquement (testé).

## Phase 5 — familles et générations

**Âge.** Chacun a une date de naissance et vieillit à son anniversaire. Le grand âge tue.

**Cour et mariage.** Entre adultes libres qui s'apprécient et se font confiance, l'attirance grandit chaque
semaine selon leur entente ; à son comble, c'est le mariage : noce payée par le plus aisé à l'auberge,
foyer commun, ressources en partie mises en commun. Les unions sont libres ; un mariage entre deux maisons
nobles scelle une alliance (relations +35). Le joueur fait sa cour (charme, conversation, entente) puis
demande en mariage ; un refus trop tôt indique ce qui manque.

**Naissances et enfance.** Un couple femme-homme en âge d'avoir des enfants, qui mange à sa faim, peut
concevoir ; grossesse de 70 jours, accouchement risqué. L'enfant hérite du nom, de traits et d'aptitudes
de ses parents. Il dort, joue, aide ses parents au travail dès dix ans ; ce sont ses parents (ou son
tuteur) qui le nourrissent, avec le pain du foyer ou acheté pour lui. À 14 ans, il doit gagner son pain.
Un enfant de maison noble en fait partie ; l'aîné devient héritier si la maison n'en a pas.

**Succession.** À la mort, les créanciers sont payés d'abord sur la succession ; l'argent est partagé
entre les héritiers (enfants adultes, conjoint, enfants mineurs, puis parents, frères et sœurs), et
l'héritier principal reçoit les biens, les maisons, les créances et les entreprises. Le conjoint devient
veuf. Un orphelin mineur est confié à un frère ou une sœur adulte, à un ménage aisé, à un ami de ses
parents, ou devient pupille de l'intendance. Sans famille, l'intendance hérite comme avant.

**La lignée du joueur.** À ta mort, le monde se fige et tu choisis qui reprend le flambeau : un enfant
adulte, ton conjoint, un frère, une sœur, ou un ami fidèle. Tu incarnes ce personnage avec ce qu'il a
hérité ; le royaume n'est pas réinitialisé, et un descendant ouvre une nouvelle génération (onglet
Famille). Sans aucun proche, la partie se termine. Pour voir passer les années, « Vivre une semaine » ou
« Vivre une saison » laissent l'IA conduire ton personnage (travail, repas, sommeil, foyer) ; elle s'arrête
net en cas d'embuscade, d'arrestation ou de décès, et ne commet jamais de crime à ta place.

**Équilibre sur la durée.** Faire vivre le monde des années a révélé de vrais défauts, corrigés :
- une spirale déflationniste (stocks pleins, plus d'embauche, plus de salaires) : une entreprise dont
  la caisse déborde garde désormais du personnel ;
- la richesse figée chez quelques-uns : un habitant aisé prend un chômeur à son service comme domestique ;
- des migrants qui venaient mourir dans une localité en famine : la nouvelle d'une famine les détourne ;
  une localité qui se vide attire plutôt un jeune ménage.

Sur 8 ans simulés (3 graines) : 16 à 26 décès, 8 à 9 naissances, une dizaine de couples, population stable
autour de 50 habitants. Sur 16 ans (graine 42) : 16 naissances, 3 enfants nés pendant la partie devenus
adultes, population entre 51 et 56 habitants dont une douzaine d'enfants ; masse monétaire exacte.

Format de sauvegarde v5 ; les sauvegardes v1 à v4 sont migrées automatiquement (testé).

## Phase 6 — polissage

**Aléas du monde** (`incidents.ts`). Chaque jour, chaque localité peut subir un aléa aux effets mécaniques
réels et d'une durée limitée : *sécheresse* l'été (rendement des fermes −45 %), *belle récolte* l'automne
(+40 %), *grand froid* l'hiver (un fagot par jour et par foyer ; sans feu, la santé baisse), *épidémie*
(risque de maladie ×5, favorisée par les chemins en mauvais état et l'hiver), *incendie* (30 à 60 % des stocks
d'un atelier détruits, enregistrés comme consommés), *foire annuelle* (trois jours, prix de vente −10 %,
affluence à la taverne). Les aléas sont annoncés aux habitants, visibles dans la barre du haut, l'onglet Monde
et l'aide. Sur 8 ans et 3 graines : une foire par localité et par an, 15 à 21 grands froids, 6 à 9 épidémies,
5 à 8 incendies.

**PNJ qui prennent l'initiative** (`approaches.ts`). Un PNJ présent au même endroit que toi peut t'aborder
de lui-même, selon son état et votre relation réelle : un ami te glisse une miche quand tu as faim et rien à
manger (l'objet change vraiment de mains), un créancier te relance après une échéance manquée, un rival
colérique ou rancunier te bouscule devant témoins, un admirateur se déclare, un patron qui embauche te fait
signe, un ami t'invite à t'asseoir le soir. Au plus une initiative toutes les quatre heures.

**Équilibrage.** Faire vivre le monde 16 ans sur six graines a révélé des effondrements (jusqu'à
l'extinction complète) qui existaient déjà avant les aléas. Causes trouvées et corrigées :
- **une fuite d'argent** : une créance héritée par le débiteur lui-même créait un prêt à soi-même, et un
  transfert d'une caisse vers elle-même dupliquait la somme ; la dette s'éteint désormais, et le transfert
  vers soi-même est neutre ;
- **une boucle embauche-démission** : un ouvrier embauché démissionnait dans l'heure à cause d'arriérés dus
  par son *ancien* patron, si bien que l'intendance ne gardait jamais de journalier et que les chemins
  tombaient à 0 ;
- **une incohérence de registre** : un propriétaire saisi qui travaillait ailleurs perdait son emploi sur sa
  fiche sans quitter le registre de son patron ;
- **des puits à argent** : les bénéfices d'une affaire sous tutelle remontent désormais au trésor public ;
  les plus riches entretiennent jusqu'à trois domestiques et font chaque semaine un don aux hospices de la
  localité la plus démunie ;
- **des famines totales** : quand plus rien ne se vend, les affamés cueillent racines, baies et glands en
  forêt (faible rendement, très faible l'hiver ; c'est une production naturelle comme le bois mort) ; une
  localité à court de vivres affrète un convoi de grain d'urgence, payé à une localité voisine qui a un vrai
  surplus (jamais sur ses réserves d'hiver) ;
- **les chemins** : quand ils se dégradent, les adultes sans emploi doivent la corvée (sans salaire, au prix
  de leur fatigue), et l'intendance embauche des journaliers plus tôt.

Résultat mesuré sur 16 ans (graines 42, 7, 1234, 99, 5, 2024) : 40 à 59 habitants à la fin, dont 7 à 13
enfants ; intégrité et bilan monétaire exacts. Les chemins se maintiennent entre 47 et 60. Un débutant laissé
au pilote automatique survit une année entière dans 12 mondes sur 12.

**Stabilité.** Un test « au hasard » joue des actions valides ou absurdes (déplacements, travail, achats,
conversations, insultes, sommeil, rencontres, successions) : 4 graines × 300 actions dans la suite de tests, et
un essai ponctuel de 20 graines × 600 actions (environ 2 500 jours simulés, 21 successions) sans aucune erreur,
fuite d'argent ou d'objet ; la sauvegarde reste fidèle après ce chaos. Côté interface, une erreur du moteur
pendant une action est rattrapée et racontée dans le récit, et une erreur d'affichage montre un écran de
secours au lieu d'une page blanche.

**Ambiance sonore** (`audio.ts`). Tout est synthétisé dans le navigateur, sans aucun fichier : vent filtré
(plus fort l'hiver), oiseaux le jour au printemps et en été, grillons les nuits d'été, rumeur et chopes à la
taverne, enclume à la forge ; petits bruitages pour une action réussie, refusée, une pièce qui change de
main, une cloche pour un fait grave. Le son démarre au premier clic ou à la première touche (règle des
navigateurs) et se coupe d'un clic ou avec la touche S.

**Animations et notifications.** Le pion du joueur glisse d'un lieu à l'autre sur la carte ; les faits qui te
concernent (dont tu es acteur, cible ou témoin) apparaissent en notifications colorées (bonne nouvelle,
mauvaise, fait majeur) qui s'effacent seules. Tout respecte la préférence système « réduire les animations »,
ou le réglage du joueur.

**Ergonomie.** Raccourcis clavier (M manger, B boire, A attendre, J jusqu'à la prochaine étape, D dormir,
V vivre une semaine, 1–8 onglets, S son, P partie, ? aide, Échap fermer), indiqués sur les boutons. Une aide
« Premiers pas » propose huit repères calculés sur l'état réel (premiers deniers, réserves, emploi stable,
un ami, un toit, une autre localité, 100 d d'épargne, un foyer) et l'objectif suivant s'affiche sous les
actions. Nouvelle action : cueillir racines et baies au bois.

**Accessibilité.** Fenêtres modales avec focus initial, piège de tabulation, Échap et retour du focus ;
lien d'évitement vers les actions ; récit et notifications annoncés aux lecteurs d'écran (`aria-live`) ;
jauges exposées comme compteurs ; focus visible au clavier sur la carte et les boutons ; taille du texte
100/115/130 %, contraste renforcé, animations réduites ; plus de défilement horizontal sur téléphone.

**Performances.** Environ 11 à 14 ms par jour simulé (≈ 50 habitants, mesuré sur une machine seule) ; une
saison entière au pilote automatique se calcule en moins d'une demi-seconde.

Format de sauvegarde v6 ; les sauvegardes v1 à v5 sont migrées automatiquement (testé).

## État réel du développement

### Implémenté et testé
- Village de 11 lieux, 8 établissements (ferme, bois, mine, fournil, auberge, forge, halle, intendance), 19 PNJ.
- Calendrier complet, cycle jour/nuit affiché sur la carte, saisons influant sur les récoltes et le froid.
- Besoins (faim, énergie, vie sociale), santé, maladie, mort de faim/froid/vieillesse.
- Économie : production, intrants, pénuries tracées, prix dynamiques, salaires, dette salariale,
  démissions, licenciements, ajustement hebdomadaire des salaires, impôts, aumônes de l’intendance.
- Joueur : déplacement, travail journalier (salaire selon compétence et relation, seuils de
  compétence), achat/vente, manger, boire, dormir (auberge payante / grange / dehors), attendre,
  s’entraîner, ramasser du bois, dialogues (bavarder, nouvelles, compliment, cadeau, aide, insulte), vol.
- Relations affinité/confiance asymétriques, influence sur les prix, refus de commercer motivés
  par des faits connus (« Aldric Ferrand refuse… Depuis que tu l’as insulté… »), apaisement avec le temps.
- Succession économique : à la mort d’un propriétaire, l’employé le plus compétent reprend l’affaire.
- Sauvegarde : 3 emplacements + automatique quotidienne, export/import JSON, versionnement, somme de
  contrôle, contrôle d’intégrité au chargement.
- Déterminisme complet (même graine + mêmes actions = même monde, testé).

### Partiel
- Les ambitions se limitent à cinq types ; les PNJ ne cherchent pas activement à se marier ou à avoir
  des enfants (cela découle de leurs relations), ni à transmettre un métier à leurs enfants.
- Le monde de départ compte plus d'hommes que de femmes jeunes : peu de foyers peuvent avoir des enfants
  au début ; les jeunes ménages qui s'installent rééquilibrent peu à peu.
- Le joueur ne choisit pas encore son héritier à l'avance ni ne rédige de testament.
- Le joueur ne peut pas encore affréter sa propre caravane ni embaucher un charretier : il transporte
  lui-même, dans la limite de sa charge.
- Les PNJ peuvent fonder une affaire, mais les conditions (épargne, pénurie locale) sont rarement réunies :
  aucune fondation spontanée sur les simulations de référence.
- Niveaux de détail : les ~48 PNJ sont tous simulés finement à l’heure (environ 13 ms par jour simulé avec ~52 habitants, mesuré) ;
  une simulation allégée des localités lointaines viendra avec une carte plus vaste.
- Combat : uniquement une riposte physique à l’insulte ; pas de combat au tour par tour.
- Création de personnage : profil adulte équilibré fixe (choix prévu par la consigne pour la v1).
- Niveaux de détail : tous les PNJ sont simulés en détail à l’heure (suffisant à 20 PNJ : environ 3,5 ms par
  jour simulé mesurés) ; la simulation simplifiée des PNJ secondaires viendra avec plusieurs villages.

### Prévu (phases suivantes)
Caravanes et escortes du joueur ; adhésion du joueur à une bande ; armes et armures ; organisations, criminalité structurée, noblesse ; familles, naissances,
héritage du joueur ; combat au tour par tour ; intégration optionnelle d’un modèle de langage pour
les dialogues (le moteur restera l’autorité sur les faits).

### Limites connues
- L’argent tend encore à se concentrer chez les épargnants ; domesticité et dons aux hospices le font
  recirculer, sans investissement à proprement parler. Les salaires glissent vers le plancher.
- Le convoi de grain d'urgence arrive le jour même (il ne voyage pas physiquement sur la route) et les vivres
  de disette sont comptés comme du grain.
- Le son est volontairement simple (synthèse) et n'est vérifié automatiquement que par l'absence d'erreur ;
  son rendu dépend du navigateur.
- Un débutant au pilote automatique survit, mais reste pauvre et souvent sans emploi stable : progresser
  demande de jouer.
- Le chômage est structurel (environ 30 à 45 %) : l’économie fermée ne crée pas assez de demande pour tous.
- Beaucoup de démissions viennent de salaires impayés : les petites entreprises vivent au jour le jour.
- Le trésor du village est souvent trop maigre pour offrir la bière des fêtes.
- Le commerce régional reste modeste : l'écart entre prix d'achat et prix de vente des établissements
  est large, les caravanes ne partent que lorsqu'une pénurie creuse les prix.
- Les marchands s'endettent souvent et finissent saisis par leurs créanciers : leurs expéditions sont
  risquées, et la même histoire se répète d'une partie à l'autre.
- Guerres et révoltes sont possibles mais rares : les conditions (rancune, supériorité, grogne durable) se
  réunissent peu souvent en deux ans simulés.
- Le joueur ne peut pas encore lever ses propres troupes, rejoindre la bande ni prendre part à une bataille.
- Pas d'armes ni d'armures : la force d'un combattant ne dépend que de lui.
- Des disettes locales restent possibles (morts de faim isolées, surtout l'hiver) ; la cueillette, la soupe
  populaire, les convois et l'aide seigneuriale empêchent désormais l'effondrement sur les 16 ans mesurés.
