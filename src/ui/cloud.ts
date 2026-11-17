// ─────────────────────────────────────────────────────────────
// Sauvegarde en ligne : chaque emplacement est recopié dans l'espace privé du joueur
// (capacité `db` de la page publiée, sous data/users/<id>/), compressé et découpé si besoin.
// Le navigateur reste la source immédiate ; le serveur sert de copie de sécurité et de
// pont entre appareils. Sans espace en ligne (page ouverte hors de claude.ai, non connecté),
// tout fonctionne comme avant.
// ─────────────────────────────────────────────────────────────
import type { KVStore } from '../engine';

const PREFIX = 'kingdom-zero:save:';
const CHUNK = 200_000;           // caractères par document (limite du service : 256 Kio)
const AUTO_EVERY_MS = 45_000;    // la sauvegarde automatique n'est envoyée qu'une fois par 45 s au plus

type Doc = { exists: boolean; id: string; data(): Record<string, unknown> | undefined };
type DocRef = { get(): Promise<Doc>; set(d: Record<string, unknown>): Promise<void>; delete(): Promise<void>; collection(p: string): ColRef };
type ColRef = { doc(id: string): DocRef; get(): Promise<{ docs: Doc[] }> };
type Db = { collection(p: string): ColRef };

export type CloudState = 'connecting' | 'on' | 'off' | 'error';
export interface CloudStatus { state: CloudState; lastPush?: number; message?: string; pulled?: string[] }

let status: CloudStatus = { state: 'connecting' };
const listeners = new Set<(s: CloudStatus) => void>();
function setStatus(patch: Partial<CloudStatus>) { status = { ...status, ...patch }; for (const l of listeners) l(status); }
export function cloudStatus(): CloudStatus { return status; }
export function onCloudStatus(fn: (s: CloudStatus) => void): () => void { listeners.add(fn); return () => listeners.delete(fn); }

let col: ColRef | null = null;
let ready: Promise<boolean> | null = null;

/** Se connecte à l'espace privé du joueur. Résout faux si la page n'en dispose pas. */
function connect(): Promise<boolean> {
  ready ??= (async () => {
    try {
      const claude = (globalThis as unknown as { claude?: { use(n: string): Promise<unknown> } }).claude;
      if (!claude?.use) { setStatus({ state: 'off', message: 'Page ouverte hors de claude.ai : sauvegarde en ligne indisponible.' }); return false; }
      const [db, user] = await Promise.all([claude.use('db') as Promise<Db | null>, claude.use('user') as Promise<{ id(): Promise<string | null> } | null>]);
      const uid = user ? await user.id() : null;
      if (!db || !uid) { setStatus({ state: 'off', message: 'Connecte-toi à claude.ai pour sauvegarder en ligne.' }); return false; }
      col = db.collection(`data/users/${uid}`);
      setStatus({ state: 'on', message: undefined });
      return true;
    } catch (e) {
      setStatus({ state: 'error', message: `Sauvegarde en ligne indisponible (${(e as Error).message ?? e}).` });
      return false;
    }
  })();
  return ready;
}

// ── Encodage : gzip puis base64 quand le navigateur sait compresser ──

async function encode(text: string): Promise<{ enc: string; data: string }> {
  if (typeof CompressionStream === 'undefined') return { enc: 'raw', data: text };
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { enc: 'gzip-b64', data: btoa(bin) };
}
async function decode(data: string, enc: string): Promise<string> {
  if (enc === 'raw') return data;
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).text();
}

function metaOf(text: string): Record<string, unknown> {
  try {
    const f = JSON.parse(text) as { savedAt?: string; state?: { time?: number; playerId?: string; characters?: Record<string, { firstName?: string; lastName?: string; money?: number }>; dynasty?: { generation?: number } } };
    const p = f.state?.playerId ? f.state.characters?.[f.state.playerId] : undefined;
    return { savedAt: f.savedAt ?? '', time: f.state?.time ?? 0, who: p ? `${p.firstName} ${p.lastName}` : '?', money: p?.money ?? 0, generation: f.state?.dynasty?.generation ?? 1 };
  } catch { return { savedAt: '' }; }
}

// ── Envoi et récupération d'un emplacement ──

async function push(slot: string, text: string | null): Promise<void> {
  if (!col) return;
  const main = col.doc(`save-${slot}`);
  const prev = await main.get();
  const prevParts = prev.exists ? Number(prev.data()?.parts ?? 1) : 0;
  if (text === null) {
    await main.delete();
    for (let i = 1; i < prevParts; i++) await main.collection('parts').doc(String(i)).delete();
    return;
  }
  const { enc, data } = await encode(text);
  const chunks: string[] = [];
  for (let i = 0; i < data.length; i += CHUNK) chunks.push(data.slice(i, i + CHUNK));
  if (!chunks.length) chunks.push('');
  const rev = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
  // les morceaux d'abord, l'en-tête ensuite : un en-tête ne désigne jamais des morceaux absents
  for (let i = 1; i < chunks.length; i++) await main.collection('parts').doc(String(i)).set({ rev, data: chunks[i] });
  await main.set({ rev, parts: chunks.length, enc, data: chunks[0], meta: metaOf(text) });
  for (let i = chunks.length; i < prevParts; i++) await main.collection('parts').doc(String(i)).delete();
}

async function pull(doc: Doc): Promise<string> {
  const d = doc.data()!;
  const parts = Number(d.parts ?? 1);
  const chunks = [String(d.data ?? '')];
  for (let i = 1; i < parts; i++) {
    const p = await col!.doc(doc.id).collection('parts').doc(String(i)).get();
    if (!p.exists || p.data()?.rev !== d.rev) throw new Error('sauvegarde en ligne incomplète (envoi interrompu)');
    chunks.push(String(p.data()?.data ?? ''));
  }
  return decode(chunks.join(''), String(d.enc ?? 'raw'));
}

// ── File d'envoi : un envoi à la fois, la dernière version de chaque emplacement l'emporte ──

const pending = new Map<string, string | null>();
const lastAuto = { at: 0, timer: 0 as unknown as ReturnType<typeof setTimeout> | 0 };
let running = false;

async function drain(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (pending.size) {
      if (!(await connect())) { pending.clear(); return; }
      const [slot, text] = pending.entries().next().value as [string, string | null];
      pending.delete(slot);
      try {
        await push(slot, text);
        setStatus({ state: 'on', lastPush: Date.now(), message: undefined });
      } catch (e) {
        const code = (e as { code?: string }).code;
        setStatus({ state: 'error', message: code === 'quota_exceeded' ? 'Espace en ligne plein : efface des emplacements inutiles.' : `Échec de l’envoi en ligne (${code ?? (e as Error).message}). Nouvel essai à la prochaine sauvegarde.` });
        if (code === 'unavailable' && !pending.has(slot)) { pending.set(slot, text); await new Promise(r => setTimeout(r, 1500 + Math.random() * 1500)); }
      }
    }
  } finally { running = false; }
}

function schedule(slot: string, text: string | null, urgent = false): void {
  if (slot === 'auto' && !urgent) {
    pending.delete('auto');
    const wait = lastAuto.at + AUTO_EVERY_MS - Date.now();
    if (lastAuto.timer) return; // déjà programmée : elle enverra la version la plus récente
    if (wait > 0) {
      lastAuto.timer = setTimeout(() => { lastAuto.timer = 0; lastAuto.at = Date.now(); pending.set('auto', latestAuto); void drain(); }, wait);
      latestAuto = text;
      return;
    }
    lastAuto.at = Date.now();
  }
  if (slot === 'auto') latestAuto = text;
  pending.set(slot, text);
  void drain();
}
let latestAuto: string | null = null;

/** Envoie tout de suite la sauvegarde automatique (quand on quitte ou masque la page). */
export function flushCloud(base: KVStore): void {
  const t = base.getItem(PREFIX + 'auto');
  if (lastAuto.timer) { clearTimeout(lastAuto.timer); lastAuto.timer = 0; }
  if (t) { lastAuto.at = Date.now(); latestAuto = t; pending.set('auto', t); void drain(); }
}

/** Enveloppe le stockage du navigateur : chaque écriture d'une sauvegarde part aussi en ligne. */
export function cloudStore(base: KVStore): KVStore {
  return {
    getItem: k => base.getItem(k),
    setItem(k, v) {
      base.setItem(k, v);
      if (k.startsWith(PREFIX)) { if (k === PREFIX + 'auto') latestAuto = v; schedule(k.slice(PREFIX.length), v); }
    },
    removeItem(k) { base.removeItem(k); if (k.startsWith(PREFIX)) schedule(k.slice(PREFIX.length), null); },
  };
}

/**
 * Au démarrage : récupère les emplacements plus récents en ligne (ou absents de ce navigateur)
 * et envoie ceux qui n'y sont pas encore. `keepAuto` : si le joueur a déjà joué entre-temps,
 * la sauvegarde automatique en ligne est rangée à part plutôt que d'écraser la sienne.
 * Renvoie les emplacements récupérés.
 */
export async function cloudSync(base: KVStore, keepAuto: () => boolean): Promise<string[]> {
  if (!(await connect()) || !col) return [];
  const pulled: string[] = [];
  try {
    const snap = await col.get();
    const online = new Map<string, Doc>();
    for (const d of snap.docs) if (d.exists && d.id.startsWith('save-')) online.set(d.id.slice(5), d);
    for (const [slot, d] of online) {
      const cloudAt = String((d.data()?.meta as { savedAt?: string } | undefined)?.savedAt ?? '');
      const localText = base.getItem(PREFIX + slot);
      const localAt = localText ? String(metaOf(localText).savedAt ?? '') : '';
      if (localText && localAt >= cloudAt) continue;
      try {
        const text = await pull(d);
        const target = slot === 'auto' && keepAuto() ? 'enligne' : slot;
        base.setItem(PREFIX + target, text); // écrit directement : inutile de le renvoyer
        pulled.push(target);
      } catch (e) { setStatus({ state: 'error', message: `Un emplacement en ligne n’a pas pu être lu (${(e as Error).message}).` }); }
    }
    // ce que ce navigateur a et que le serveur n'a pas (ou en plus ancien) part en ligne
    for (const slot of ['auto', 'rapide', 'precedente', 'illisible', 'slot1', 'slot2', 'slot3', 'slot4', 'slot5', 'slot6']) {
      const t = base.getItem(PREFIX + slot);
      if (!t) continue;
      const cloudAt = String((online.get(slot)?.data()?.meta as { savedAt?: string } | undefined)?.savedAt ?? '');
      if (String(metaOf(t).savedAt ?? '') > cloudAt) { pending.set(slot, t); }
    }
    void drain();
    setStatus({ pulled });
  } catch (e) {
    setStatus({ state: 'error', message: `Sauvegarde en ligne injoignable pour l’instant (${(e as { code?: string }).code ?? (e as Error).message}).` });
  }
  return pulled;
}

/** Stockage de secours en mémoire, quand le navigateur refuse le sien (la copie en ligne prend alors le relais). */
export function memoryStore(): KVStore {
  const m = new Map<string, string>();
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: k => { m.delete(k); } };
}
