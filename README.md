# KINGDOM ZERO — Phase 2 (v0.2.0)

Simulation de vie médiévale / RPG sandbox systémique. Le village de **Valcendre** vit sans le joueur :
19 habitants travaillent, achètent, mangent, se lient d’amitié, se disputent, perdent leur emploi,
volent, tombent malades, meurent et sont remplacés par des migrants. Le joueur arrive **sans un denier**.

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
| `npm test` | 33 tests automatisés (scénarios A–G, phase 2, invariants) |
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
src/ui/            interface React (carte SVG, panneaux, dialogues, sauvegarde)
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
- Les ambitions se limitent à cinq types ; pas encore de mariage ni de projets familiaux.
- Le joueur ne peut pas encore acheter une entreprise ni diriger lui-même une affaire saisie (une
  affaire saisie par le joueur est gérée automatiquement, les dividendes lui reviennent).
- Combat : uniquement une riposte physique à l’insulte ; pas de combat au tour par tour.
- Création de personnage : profil adulte équilibré fixe (choix prévu par la consigne pour la v1).
- Niveaux de détail : tous les PNJ sont simulés en détail à l’heure (suffisant à 20 PNJ : environ 3,5 ms par
  jour simulé mesurés) ; la simulation simplifiée des PNJ secondaires viendra avec plusieurs villages.

### Prévu (phases suivantes)
Plusieurs villages et caravanes ; achat et gestion d'entreprises par le joueur ; propriété ; organisations, criminalité structurée, noblesse ; familles, naissances,
héritage du joueur ; combat au tour par tour ; intégration optionnelle d’un modèle de langage pour
les dialogues (le moteur restera l’autorité sur les faits).

### Limites connues
- L’argent tend à se concentrer chez les épargnants (pas encore d’investissement ni de prêt) et
  les salaires glissent vers le plancher sur le long terme.
- Les routes s’usent plus vite que les travaux publics ne les réparent sur 2 ans.
- Le chômage est structurel (environ 30 à 45 %) : l’économie fermée ne crée pas assez de demande pour tous.
- Beaucoup de démissions viennent de salaires impayés : les petites entreprises vivent au jour le jour.
- Le trésor du village est souvent trop maigre pour offrir la bière des fêtes.
- Pas de son ni d’animations au-delà des transitions CSS.
