// PRNG déterministe (mulberry32). L'état vit dans GameState.rng pour être sauvegardé.
import type { GameState } from './types';

export function nextRandom(state: GameState): number {
  let t = (state.rng = (state.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export const rand = nextRandom;

export function randInt(state: GameState, min: number, max: number): number {
  return min + Math.floor(nextRandom(state) * (max - min + 1));
}

export function chance(state: GameState, p: number): boolean {
  return nextRandom(state) < p;
}

export function pick<T>(state: GameState, arr: readonly T[]): T {
  return arr[Math.floor(nextRandom(state) * arr.length)];
}

export function shuffled<T>(state: GameState, arr: readonly T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(nextRandom(state) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
