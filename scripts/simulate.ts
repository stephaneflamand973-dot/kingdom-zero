// Simulation headless : `npm run sim -- [jours] [graine]`
import { createWorld, advanceTime, totalMoney, totalItems, checkIntegrity, itemBalance, moneyBalance, MIN_PER_DAY, formatDate, fullName, ITEM_IDS, referencePrice, aliveCharacters } from '../src/engine';

const days = Number(process.argv[2] ?? 60);
const seed = Number(process.argv[3] ?? 42);
const s = createWorld(seed);
s.observer = true;
const m0 = totalMoney(s), i0 = totalItems(s);
for (let d = 0; d < days; d++) {
  advanceTime(s, MIN_PER_DAY);
  if (d % 7 === 6 || d === days - 1) {
    const pr = ITEM_IDS.map(it => `${it}:${referencePrice(s, it) ?? '-'}`).join(' ');
    const pop = aliveCharacters(s).filter(c => !c.isPlayer);
    const emp = pop.filter(c => c.employerId).length;
    const hunger = Math.round(pop.reduce((a, c) => a + c.needs.hunger, 0) / pop.length);
    const biz = s.businessOrder.map(id => s.businesses[id]).map(b => `${b.id.slice(2)}:${b.treasury}/${b.employees.length}w/w${b.wage}`).join(' ');
    console.log(`J${d + 1} ${formatDate(s.time)} pop ${pop.length} emp ${emp} faim ${hunger} infra ${s.village.infrastructure.toFixed(0)} | ${pr}\n   ${biz}`);
    console.log('   stocks', s.businessOrder.map(id => `${id.slice(2)}:${JSON.stringify(s.businesses[id].stock)}`).join(' '));
  }
}
const notable = s.events.filter(e => e.importance >= 2);
const counts: Record<string, number> = {};
for (const e of notable) counts[e.type] = (counts[e.type] ?? 0) + 1;
console.log('Événements notables :', counts);
console.log(notable.slice(-25).map(e => '  · ' + e.text).join('\n'));
console.log('Riches :', aliveCharacters(s).sort((a, b) => b.money - a.money).slice(0, 6).map(c => `${fullName(c)} ${c.money}`).join(', '));
console.log('Pauvres :', aliveCharacters(s).sort((a, b) => a.money - b.money).slice(0, 6).map(c => `${fullName(c)} ${c.money}`).join(', '));
console.log('Intégrité :', checkIntegrity(s), 'bilan argent', moneyBalance(m0, s), 'bilan objets', itemBalance(i0, s, totalItems(s)));
console.log('stats', s.stats);
