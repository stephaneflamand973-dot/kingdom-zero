// Journal d'événements : faits réels survenus dans le monde, avec témoins et causes.
import type { GameState, WorldEvent } from './types';

const MAX_ROUTINE = 250;
const MAX_NOTABLE = 1200;

export function logEvent(state: GameState, e: Omit<WorldEvent, 'id' | 'time' | 'witnesses'> & { witnesses?: string[] }): WorldEvent {
  state.eventSeq += 1;
  const ev: WorldEvent = { ...e, id: `e${state.eventSeq}`, time: state.time, witnesses: e.witnesses ?? [] };
  state.events.push(ev);
  // Seuls les témoins (et les acteurs directs) connaissent l'événement : connaissance imparfaite.
  if (ev.importance >= 2) {
    const knowers = new Set([...ev.witnesses]);
    if (ev.actorId) knowers.add(ev.actorId);
    if (ev.targetId && state.characters[ev.targetId]) knowers.add(ev.targetId);
    for (const id of knowers) learnEvent(state, id, ev.id);
  }
  return ev;
}

export function learnEvent(state: GameState, charId: string, eventId: string): boolean {
  const c = state.characters[charId];
  if (!c || !c.alive || c.knownEvents.includes(eventId)) return false;
  c.knownEvents.push(eventId);
  if (c.knownEvents.length > 60) c.knownEvents.shift(); // mémoire limitée
  return true;
}

export function getEvent(state: GameState, id: string): WorldEvent | undefined {
  // les événements sont ordonnés par id croissant : recherche dichotomique
  const n = Number(id.slice(1));
  let lo = 0, hi = state.events.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const m = Number(state.events[mid].id.slice(1));
    if (m === n) return state.events[mid];
    if (m < n) lo = mid + 1; else hi = mid - 1;
  }
  return undefined;
}

/** Élague le journal (appelé chaque jour) en conservant la cohérence des connaissances. */
export function pruneEvents(state: GameState): void {
  const routine = state.events.filter(e => e.importance === 1);
  const notable = state.events.filter(e => e.importance > 1);
  if (routine.length <= MAX_ROUTINE && notable.length <= MAX_NOTABLE) return;
  const keepR = new Set(routine.slice(-MAX_ROUTINE).map(e => e.id));
  const keepN = new Set(notable.slice(-MAX_NOTABLE).map(e => e.id));
  state.events = state.events.filter(e => keepR.has(e.id) || keepN.has(e.id));
  for (const id of state.characterOrder) {
    const c = state.characters[id];
    c.knownEvents = c.knownEvents.filter(eid => keepN.has(eid));
  }
}
