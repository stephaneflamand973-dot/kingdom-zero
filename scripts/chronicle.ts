// Chronique complète d'une simulation : `npx vite-node scripts/chronicle.ts [jours] [graine] [types...]`
import { createWorld, advanceTime, formatDate, MIN_PER_DAY } from '../src/engine';
const days = Number(process.argv[2] ?? 224), seed = Number(process.argv[3] ?? 42);
const types = process.argv.slice(4);
const s = createWorld(seed); s.observer = true;
const counts: Record<string, number> = {};
let last = 0;
for (let d = 0; d < days; d++) {
  advanceTime(s, MIN_PER_DAY);
  for (const e of s.events) {
    const n = Number(e.id.slice(1));
    if (n <= last) continue;
    if (e.importance >= 2) counts[e.type] = (counts[e.type] ?? 0) + 1;
    if (types.includes(e.type)) console.log(formatDate(e.time), '·', e.text);
  }
  last = s.eventSeq;
}
console.log(counts);
