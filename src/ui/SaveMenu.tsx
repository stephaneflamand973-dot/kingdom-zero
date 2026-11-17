import { useEffect, useRef, useState } from 'react';
import { cloudStatus, onCloudStatus, type CloudStatus } from './cloud';
import { localAvailable } from './useGame';
import { deleteSlot, deserialize, formatClock, formatDate, saveFileName, serialize, slotInfo } from '../engine';
import type { Game } from './useGame';
import { useModal } from './a11y';

const MANUAL = ['slot1', 'slot2', 'slot3', 'slot4', 'slot5', 'slot6'];
const SLOT_NAME: Record<string, string> = {
  auto: 'Sauvegarde automatique', enligne: 'Sauvegarde en ligne (autre appareil)', rapide: 'Sauvegarde rapide (K / L)', precedente: 'Partie précédente (copie de sécurité)', illisible: 'Sauvegarde mise de côté (illisible auparavant)',
  slot1: 'Emplacement I', slot2: 'Emplacement II', slot3: 'Emplacement III', slot4: 'Emplacement IV', slot5: 'Emplacement V', slot6: 'Emplacement VI',
};

function ago(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'à l’instant';
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
  return `le ${new Date(iso).toLocaleDateString('fr-FR')}`;
}

export function SaveMenu({ game, onClose }: { game: Game; onClose: () => void }) {
  const { state, store, replace, setCreating, saveTo, loadFrom } = game;
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmNew, setConfirmNew] = useState(false);
  const [confirm, setConfirm] = useState<{ slot: string; what: 'save' | 'delete' } | null>(null);
  const [exported, setExported] = useState<string | null>(null);
  const [, force] = useState(0);
  const file = useRef<HTMLInputElement>(null);
  const ref = useModal<HTMLDivElement>(onClose);
  const [cloud, setCloud] = useState<CloudStatus>(cloudStatus());
  useEffect(() => onCloudStatus(setCloud), []);

  const doSave = (slot: string) => {
    if (saveTo(slot, true)) { setMsg(`Partie sauvegardée dans « ${SLOT_NAME[slot]} ».`); force(x => x + 1); }
    else setMsg('Échec de la sauvegarde (stockage du navigateur indisponible ou plein) : télécharge plutôt le fichier.');
    setConfirm(null);
  };
  const doLoad = (slot: string) => {
    const err = loadFrom(slot);
    if (err) return setMsg(err);
    onClose();
  };
  const doDelete = (slot: string) => { if (store) deleteSlot(store, slot); setConfirm(null); setMsg(`« ${SLOT_NAME[slot]} » effacé.`); force(x => x + 1); };
  const doDownload = () => {
    try {
      const blob = new Blob([serialize(state)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = saveFileName(state);
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      setMsg(`Fichier « ${saveFileName(state)} » téléchargé. Garde-le précieusement : « Importer » le recharge, même sur un autre appareil.`);
    } catch { doCopy(); }
  };
  const doCopy = () => {
    const text = serialize(state);
    if (!navigator.clipboard) { setExported(text); setMsg('Sélectionne le texte ci-dessous et copie-le.'); return; }
    navigator.clipboard.writeText(text)
      .then(() => { setExported(null); setMsg('Sauvegarde copiée dans le presse-papiers. Colle-la dans un fichier .json pour la conserver.'); })
      .catch(() => { setExported(text); setMsg('Copie automatique impossible : sélectionne le texte ci-dessous et copie-le.'); });
  };
  const doImport = async (f: File) => {
    const r = deserialize(await f.text());
    if (r.error || !r.state) return setMsg(r.error ?? 'Erreur');
    replace(r.state, 'Partie importée depuis un fichier.');
    onClose();
  };

  const row = (slot: string, manual: boolean) => {
    const info = store ? slotInfo(store, slot) : null;
    const asking = confirm?.slot === slot;
    return (
      <li key={slot}>
        <div>
          <b>{SLOT_NAME[slot]}</b>
          <div className="muted small">{info
            ? <>{info.who}{info.generation > 1 ? ` (génération ${info.generation})` : ''} · {formatDate(info.time)}, {formatClock(info.time)} · {info.money} d — enregistrée {ago(info.savedAt)}</>
            : 'Vide'}</div>
        </div>
        <div className="slot-btns">
          {asking && confirm!.what === 'save' && <><span className="small">Écraser ?</span><button className="btn sm danger" onClick={() => doSave(slot)}>Oui</button><button className="btn sm ghost" onClick={() => setConfirm(null)}>Non</button></>}
          {asking && confirm!.what === 'delete' && <><span className="small">Effacer ?</span><button className="btn sm danger" onClick={() => doDelete(slot)}>Oui</button><button className="btn sm ghost" onClick={() => setConfirm(null)}>Non</button></>}
          {!asking && <>
            {(manual || slot === 'rapide') && <button className="btn sm" disabled={!store} onClick={() => (info ? setConfirm({ slot, what: 'save' }) : doSave(slot))}>Sauvegarder</button>}
            <button className="btn sm ghost" disabled={!info} onClick={() => doLoad(slot)}>Charger</button>
            {manual && info && <button className="btn sm ghost" aria-label={`Effacer ${SLOT_NAME[slot]}`} title="Effacer" onClick={() => setConfirm({ slot, what: 'delete' })}>✕</button>}
          </>}
        </div>
      </li>
    );
  };

  return (
    <div className="modal-back" onClick={onClose}>
      <div ref={ref} className="modal save" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Menu de la partie">
        <button className="close" onClick={onClose} aria-label="Fermer">×</button>
        <h2>Registre de la partie</h2>
        <p className="muted small">
          La partie se sauvegarde seule chaque matin et quand tu quittes la page, dans ce navigateur et en ligne.
          Le fichier téléchargé reste une copie de plus, que tu gardes toi-même. Graine du monde : {state.seed} · format v{state.version}.
        </p>
        <p className={cloud.state === 'on' ? 'notice small' : cloud.state === 'connecting' ? 'muted small' : 'warn small'} role="status">
          {cloud.state === 'on' ? <>☁ Sauvegarde en ligne active : chaque emplacement est aussi gardé dans ton espace privé, lié à ton compte, et te suit d’un appareil à l’autre{cloud.lastPush ? ` (dernier envoi ${ago(new Date(cloud.lastPush).toISOString())})` : ''}.</>
            : cloud.state === 'connecting' ? '☁ Connexion à la sauvegarde en ligne…'
            : `☁ ${cloud.message ?? 'Sauvegarde en ligne indisponible.'}`}
        </p>
        {!localAvailable && <p className="warn">Le stockage du navigateur est indisponible ici : {cloud.state === 'on' ? 'ta partie n’est gardée qu’en ligne.' : 'seul le fichier téléchargé conserve ta partie.'}</p>}
        <ul className="slots">
          {row('auto', false)}
          {row('rapide', false)}
          {store && slotInfo(store, 'precedente') && row('precedente', false)}
          {store && slotInfo(store, 'illisible') && row('illisible', false)}
          {store && slotInfo(store, 'enligne') && row('enligne', false)}
          {MANUAL.map(s => row(s, true))}
        </ul>
        <div className="save-row">
          <button className="btn" onClick={doDownload}>Télécharger le fichier</button>
          <button className="btn ghost" onClick={() => file.current?.click()}>Importer un fichier…</button>
          <button className="btn ghost" onClick={doCopy}>Copier le texte</button>
          <input ref={file} type="file" accept="application/json,.json" hidden onChange={e => e.target.files?.[0] && doImport(e.target.files[0])} />
          {!confirmNew
            ? <button className="btn danger" onClick={() => setConfirmNew(true)}>Nouvelle partie</button>
            : <button className="btn danger" onClick={() => { setCreating(true); onClose(); }}>Confirmer : créer un nouveau personnage</button>}
        </div>
        {confirmNew && <p className="muted small">La partie en cours non sauvegardée sera perdue. <button className="link" onClick={() => setConfirmNew(false)}>Annuler</button></p>}
        {exported && <textarea id="export-save" className="export-box" readOnly value={exported} onFocus={e => e.currentTarget.select()} />}
        {msg && <p className="dialog-result" role="status">{msg}</p>}
      </div>
    </div>
  );
}
