// Démonstration de bout en bout (Phase 1) : `npm run demo`
// Le joueur commence sans argent, travaille, est payé, achète à manger, rencontre le marchand,
// modifie une relation et observe le village pendant plusieurs jours. Aucune donnée n'est modifiée à la main.
import {
  buy, createWorld, eat, formatClock, formatDate, fullName, getRelation, minutesUntilHour, moveTo, relationLabel,
  sleep, talk, totalMoney, wait, work, checkIntegrity, type ActionResult, type GameState,
} from '../src/engine';

const s: GameState = createWorld(2026);
const p = s.characters.player;
const log = (r: ActionResult) => console.log(`  [${formatDate(s.time)} ${formatClock(s.time)}] ${r.ok ? '✔' : '✘'} ${r.message}  (bourse ${p.money} d, faim ${Math.round(p.needs.hunger)}, énergie ${Math.round(p.needs.energy)})`);
const m0 = totalMoney(s);

console.log(`== ${fullName(p)} arrive à Valcendre avec ${p.money} d.`);
log(moveTo(s, 'farm'));
log(work(s, 'b_farm', 8));
log(eat(s));
log(moveTo(s, 'bakery'));
log(buy(s, 'b_bakery', 'bread', 2));
log(moveTo(s, 'market'));
const before = getRelation(s, 'bertrand', 'player');
log(talk(s, 'bertrand', 'chat'));
log(talk(s, 'bertrand', 'compliment'));
log(talk(s, 'bertrand', 'news'));
const after = getRelation(s, 'bertrand', 'player');
console.log(`  → Bertrand : affinité ${before.affinity} → ${after.affinity}, confiance ${before.trust} → ${after.trust} (${relationLabel(after)})`);
log(moveTo(s, 'farm'));
log(wait(s, minutesUntilHour(s.time, 21)));
log(sleep(s, 'barn'));

const watch = ['perrine', 'colin', 'isabeau', 'bertrand', 'raoul'];
const snap = () => watch.map(id => { const c = s.characters[id]; return `${c.firstName}: ${c.money} d, ${c.alive ? c.activity.note : '†'}`; }).join(' | ');
console.log('\n== Le joueur observe le village pendant 4 jours (en mangeant et dormant)');
console.log('  Avant :', snap());
for (let d = 0; d < 4; d++) {
  log(moveTo(s, 'farm'));
  log(work(s, 'b_farm', 6));
  if (p.needs.hunger > 40) log(eat(s));
  log(moveTo(s, 'bakery'));
  log(buy(s, 'b_bakery', 'bread', 2));
  log(eat(s));
  log(moveTo(s, 'farm'));
  log(wait(s, minutesUntilHour(s.time, 21)));
  log(sleep(s, 'barn'));
}
console.log('  Après :', snap());
console.log('\n== Événements notables du village pendant ces jours :');
for (const e of s.events.filter(e => e.importance >= 2).slice(-15)) console.log(`  · ${formatDate(e.time)} ${formatClock(e.time)} — ${e.text}`);
console.log(`\nMasse monétaire : ${m0} → ${totalMoney(s)} (doit être identique, aucun migrant arrivé : ${s.ledger.externalMoneyIn} d externes)`);
console.log('Intégrité :', checkIntegrity(s).length ? checkIntegrity(s) : 'OK');
