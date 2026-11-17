// Sauvegarde en ligne : recopie des emplacements dans l'espace privé du joueur (faux service en mémoire).
import { describe, expect, it } from 'vitest';
import { createWorld, liveDays, loadFromStore, saveToStore, serialize, slotInfo, type KVStore } from '../src/engine';

// ── un faux service `db` fidèle à l'essentiel : documents, sous-collections, get/set/delete ──
const docs = new Map<string, Record<string, unknown>>();
let writes = 0;
const MAX = 256 * 1024;
function docRef(path: string) {
  return {
    id: path.split('/').pop()!,
    async get() { const d = docs.get(path); return { id: path.split('/').pop()!, exists: !!d, data: () => d }; },
    async set(d: Record<string, unknown>) { if (JSON.stringify(d).length > MAX) throw Object.assign(new Error('trop gros'), { code: 'invalid_argument' }); writes++; docs.set(path, JSON.parse(JSON.stringify(d))); },
    async delete() { docs.delete(path); },
    collection: (p: string) => colRef(`${path}/${p}`),
  };
}
function colRef(path: string) {
  return {
    doc: (id: string) => docRef(`${path}/${id}`),
    async get() {
      const depth = path.split('/').length + 1;
      return { docs: [...docs.keys()].filter(k => k.startsWith(path + '/') && k.split('/').length === depth).map(k => ({ id: k.split('/').pop()!, exists: true, data: () => docs.get(k) })) };
    },
  };
}
(globalThis as unknown as { claude: unknown }).claude = {
  use: async (n: string) => n === 'db' ? { collection: (p: string) => colRef(p) } : n === 'user' ? { id: async () => 'u42' } : null,
};

const { cloudStore, cloudSync, memoryStore, flushCloud } = await import('../src/ui/cloud');
const settle = async () => { for (let i = 0; i < 50; i++) await new Promise(r => setTimeout(r, 5)); };

describe('Sauvegarde en ligne', () => {
  it('chaque sauvegarde du navigateur part en ligne, compressée, dans l’espace privé du joueur', async () => {
    const base = memoryStore();
    const store = cloudStore(base);
    const s = createWorld(77);
    liveDays(s, 20);
    saveToStore(store, 'slot1', s);
    await settle();
    const head = docs.get('data/users/u42/save-slot1')!;
    expect(head).toBeTruthy();
    expect(head.enc).toBe('gzip-b64');
    expect((head.meta as { who: string }).who).toContain(s.characters[s.playerId].firstName);
    expect(String(head.data).length).toBeLessThan(serialize(s).length / 3); // compressée
  });

  it('un autre appareil (navigateur vide) récupère la partie, à l’identique', async () => {
    const fresh = memoryStore();
    const pulled = await cloudSync(fresh, () => false);
    expect(pulled).toContain('slot1');
    const r = loadFromStore(fresh, 'slot1');
    expect(r.error).toBeUndefined();
    expect(r.state!.characters[r.state!.playerId].firstName).toBeTruthy();
  });

  it('une très grosse partie est découpée en morceaux et se recompose', async () => {
    const base = memoryStore();
    const store = cloudStore(base);
    // un texte peu compressible de plus de 600 Ko
    let junk = ''; let x = 1;
    for (let i = 0; i < 700_000; i++) { x = (Math.imul(x, 1103515245) + 12345) & 0x7fffffff; junk += String.fromCharCode(33 + (x % 90)); }
    const text = JSON.stringify({ savedAt: new Date(Date.now() + 1000).toISOString(), state: { time: 0, playerId: 'p', characters: { p: { firstName: 'Gros', lastName: 'Fichier', money: 1 } } }, junk });
    store.setItem('kingdom-zero:save:slot2', text);
    await settle();
    const head = docs.get('data/users/u42/save-slot2')!;
    expect(Number(head.parts)).toBeGreaterThan(1);
    const fresh = memoryStore();
    await cloudSync(fresh, () => false);
    expect(fresh.getItem('kingdom-zero:save:slot2')).toBe(text);
  });

  it('la version la plus récente l’emporte ; ce que le serveur n’a pas y part au démarrage', async () => {
    const base = memoryStore();
    const s = createWorld(78);
    // ce navigateur a une sauvegarde « rapide » que le serveur ignore
    base.setItem('kingdom-zero:save:rapide', serialize(s, new Date(Date.now() + 5000).toISOString()));
    await cloudSync(base, () => false);
    await settle();
    expect(docs.has('data/users/u42/save-rapide')).toBe(true);
    expect(slotInfo(base, 'slot1')).toBeTruthy(); // et il a récupéré l'emplacement I
  });

  it('si l’on a déjà joué, la partie en ligne plus récente est rangée à part au lieu d’écraser', async () => {
    const other = memoryStore();
    const s = createWorld(79);
    cloudStore(other).setItem('kingdom-zero:save:auto', serialize(s, new Date(Date.now() + 60_000).toISOString()));
    flushCloud(other);
    await settle();
    const mine = memoryStore();
    mine.setItem('kingdom-zero:save:auto', serialize(createWorld(80), new Date().toISOString()));
    const pulled = await cloudSync(mine, () => true);
    expect(pulled).toContain('enligne');
    expect(loadFromStore(mine, 'auto').state!.seed).toBe(80);   // la partie en cours n'est pas touchée
    expect(loadFromStore(mine, 'enligne').state!.seed).toBe(79);
  });

  it('effacer un emplacement l’efface aussi en ligne', async () => {
    const store: KVStore = cloudStore(memoryStore());
    store.setItem('kingdom-zero:save:slot5', serialize(createWorld(81)));
    await settle();
    expect(docs.has('data/users/u42/save-slot5')).toBe(true);
    store.removeItem('kingdom-zero:save:slot5');
    await settle();
    expect(docs.has('data/users/u42/save-slot5')).toBe(false);
    expect(writes).toBeGreaterThan(0);
  });
});
