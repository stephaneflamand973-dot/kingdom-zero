// Évolution longue : `npx vite-node scripts/generations.ts [jours] [graine]`
import { createWorld, advanceTime, MIN_PER_DAY, npcs, checkIntegrity, totalMoney, moneyBalance, formatDate } from '../src/engine';
const days = Number(process.argv[2] ?? 448), seed = Number(process.argv[3] ?? 42);
const s = createWorld(seed); s.observer = true;
const m0 = totalMoney(s);
const counts: Record<string, number> = {};
let last = 0;
const t0 = performance.now();
for (let d = 0; d < days; d++) {
  advanceTime(s, MIN_PER_DAY);
  for (const e of s.events) { const n = Number(e.id.slice(1)); if (n <= last) continue; counts[e.type] = (counts[e.type] ?? 0) + 1; }
  last = s.eventSeq;
  if ((d + 1) % 112 === 0) {
    const pop = npcs(s);
    console.log(`${formatDate(s.time)} · ${pop.length} habitants dont ${pop.filter(c => c.age < 14).length} enfants · ${pop.filter(c => c.spouseId).length / 2} couples · âge moyen ${Math.round(pop.reduce((a, c) => a + c.age, 0) / pop.length)}`);
  }
}
const pick = (k: string) => `${k} ${counts[k] ?? 0}`;
console.log(['wedding', 'birth', 'pregnancy', 'coming_of_age', 'death', 'estate', 'adoption', 'widowhood', 'courtship', 'arrival'].map(pick).join(' · '));
console.log('Intégrité', checkIntegrity(s), 'argent', moneyBalance(m0, s), `${((performance.now() - t0) / days).toFixed(1)} ms/jour`);
