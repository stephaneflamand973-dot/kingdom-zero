# KINGDOM ZERO — Phase 1 (v0.1.0)

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
| `npm test` | 20 tests automatisés (scénarios A–G + invariants) |
| `npm run build` | vérification TypeScript stricte + build de production dans `dist/` |
| `npm run demo` | partie scriptée de bout en bout, affichée dans le terminal |
| `npm run sim -- 224 42` | simulation headless : 224 jours, graine 42, bilan économique |

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
- Personnalité : 10 traits influencent les décisions, mais pas encore d’objectifs de vie à long terme.
- Combat : uniquement une riposte physique à l’insulte ; pas de combat au tour par tour.
- Création de personnage : profil adulte équilibré fixe (choix prévu par la consigne pour la v1).
- Niveaux de détail : tous les PNJ sont simulés en détail à l’heure (suffisant à 20 PNJ : environ 3,5 ms par
  jour simulé mesurés) ; la simulation simplifiée des PNJ secondaires viendra avec plusieurs villages.

### Prévu (phases suivantes)
Contrats, prêts et endettement entre personnes ; objectifs personnels ; plusieurs villages et
caravanes ; propriété ; organisations, criminalité structurée, noblesse ; familles, naissances,
héritage du joueur ; combat au tour par tour ; intégration optionnelle d’un modèle de langage pour
les dialogues (le moteur restera l’autorité sur les faits).

### Limites connues
- L’argent tend à se concentrer chez les épargnants (pas encore d’investissement ni de prêt) et
  les salaires glissent vers le plancher sur le long terme.
- Les routes s’usent plus vite que les travaux publics ne les réparent sur 2 ans.
- Le chômage est structurel (environ 30 %) : l’économie fermée ne crée pas assez de demande pour tous.
- Pas de son ni d’animations au-delà des transitions CSS.
