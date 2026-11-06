import { useRef, useState } from 'react';
import { deserialize, formatClock, formatDate, loadFromStore, saveToStore, serialize, slotInfo } from '../engine';
import type { Game } from './useGame';

const SLOTS = ['auto', 'slot1', 'slot2', 'slot3'];
const SLOT_NAME: Record<string, string> = { auto: 'Sauvegarde automatique', slot1: 'Emplacement I', slot2: 'Emplacement II', slot3: 'Emplacement III' };

export function SaveMenu({ game, onClose }: { game: Game; onClose: () => void }) {
  const { state, store, replace, newGame } = game;
  const [msg, setMsg] = useState<string | null>(null);
  const [, force] = useState(0);
  const file = useRef<HTMLInputElement>(null);

  const doSave = (slot: string) => {
    if (!store) return setMsg('Le stockage local du navigateur est indisponible : utilise l’export de fichier.');
    try { saveToStore(store, slot, state); setMsg(`Partie sauvegardée (${SLOT_NAME[slot]}).`); force(x => x + 1); }
    catch { setMsg('Échec de la sauvegarde (stockage plein ?).'); }
  };
  const doLoad = (slot: string) => {
    if (!store) return;
    const r = loadFromStore(store, slot);
    if (r.error || !r.state) return setMsg(r.error ?? 'Erreur');
    replace(r.state, `Partie chargée : ${formatDate(r.state.time)}, ${formatClock(r.state.time)}.`);
    onClose();
  };
  const doExport = () => {
    const blob = new Blob([serialize(state)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `kingdom-zero-${formatDate(state.time).replace(/\s+/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const doImport = async (f: File) => {
    const r = deserialize(await f.text());
    if (r.error || !r.state) return setMsg(r.error ?? 'Erreur');
    replace(r.state, 'Partie importée depuis un fichier.');
    onClose();
  };

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal save" onClick={e => e.stopPropagation()} role="dialog" aria-label="Menu de la partie">
        <button className="close" onClick={onClose} aria-label="Fermer">×</button>
        <h2>Registre de la partie</h2>
        <p className="muted small">Graine du monde : {state.seed} · Format de sauvegarde v{state.version} · contrôle d’intégrité à chaque chargement.</p>
        <ul className="slots">
          {SLOTS.map(s => {
            const info = store ? slotInfo(store, s) : null;
            return (
              <li key={s}>
                <div><b>{SLOT_NAME[s]}</b><div className="muted small">{info ? `${formatDate(info.time)} · ${formatClock(info.time)} — enregistré le ${new Date(info.savedAt).toLocaleString('fr-FR')}` : 'Vide'}</div></div>
                <div className="slot-btns">
                  {s !== 'auto' && <button className="btn sm" onClick={() => doSave(s)}>Sauvegarder</button>}
                  <button className="btn sm ghost" disabled={!info} onClick={() => doLoad(s)}>Charger</button>
                </div>
              </li>
            );
          })}
        </ul>
        <div className="save-row">
          <button className="btn ghost" onClick={doExport}>Exporter (.json)</button>
          <button className="btn ghost" onClick={() => file.current?.click()}>Importer…</button>
          <input ref={file} type="file" accept="application/json,.json" hidden onChange={e => e.target.files?.[0] && doImport(e.target.files[0])} />
          <button className="btn danger" onClick={() => { if (confirm('Commencer une nouvelle vie ? La partie en cours non sauvegardée sera perdue.')) { newGame(); onClose(); } }}>Nouvelle partie</button>
        </div>
        {msg && <p className="dialog-result">{msg}</p>}
      </div>
    </div>
  );
}
