import { useState } from 'react';
import { activeIncidents, getRelation, hasAccess, INCIDENT_EFFECTS, INCIDENT_NAMES, qty, toDate, type GameState } from '../engine';
import { useModal } from './a11y';
import type { PrefsApi } from './prefs';

export const SHORTCUTS: [string, string][] = [
  ['M', 'Manger'], ['B', 'Boire une bière'], ['A', 'Attendre 1 h'], ['J', 'Attendre jusqu’à la prochaine étape (midi, 18h, matin)'],
  ['D', 'Dormir (meilleure option disponible)'], ['V', 'Vivre une semaine (pilote automatique)'],
  ['1 – 8', 'Onglets : Personnage, Famille, Besace, Affaires, Relations, Journal, Monde, Pouvoir'],
  ['S', 'Couper / rétablir le son'], ['P', 'Menu de la partie (sauvegardes)'], ['? ou H', 'Cette aide'], ['Échap', 'Fermer la fenêtre ouverte'],
  ['Tab / Entrée', 'Parcourir la carte et les boutons au clavier'],
];

interface Goal { label: string; done: boolean; hint: string }

export function goals(state: GameState): Goal[] {
  const p = state.characters[state.playerId];
  const food = qty(p.inventory, 'bread') + qty(p.inventory, 'grain');
  const friend = state.characterOrder.some(id => id !== p.id && state.characters[id].alive && getRelation(state, id, p.id).affinity >= 40);
  const roof = state.properties.some(pr => hasAccess(pr, p));
  return [
    { label: 'Gagner ses premiers deniers', done: p.money >= 20 || !!p.employerId, hint: 'Va à la ferme ou au bois : un patron qui manque de bras paie à l’heure (onglet du lieu, « Travailler »).' },
    { label: 'Avoir deux repas d’avance', done: food >= 2, hint: 'Achète du pain à la boulangerie ou du grain à la ferme, et garde-en dans ta besace.' },
    { label: 'Trouver un emploi stable', done: !!p.employerId, hint: 'Demande un contrat à un patron qui embauche : salaire chaque semaine et meilleure réputation.' },
    { label: 'Se faire un ami', done: friend, hint: 'Bavarde, complimente, offre du pain. Les amis te prêtent, te nourrissent et colportent du bien de toi.' },
    { label: 'Dormir sous son propre toit', done: roof, hint: 'Loue une chambre (Maisons du village) : on y dort mieux et le coffre protège tes biens.' },
    { label: 'Visiter une autre localité', done: Object.keys(state.priceBook).length > 1, hint: 'Les prix diffèrent d’un village à l’autre : c’est là que naît le commerce.' },
    { label: 'Mettre 100 deniers de côté', done: p.money >= 100, hint: 'Épargne : de quoi racheter un commerce, prêter, ou survivre à un hiver.' },
    { label: 'Fonder un foyer', done: !!p.spouseId, hint: 'Fais la cour (fenêtre de dialogue, section Cœur), puis demande en mariage.' },
  ];
}

type Tab = 'guide' | 'keys' | 'options' | 'world';

export function HelpModal({ state, prefsApi, onClose }: { state: GameState; prefsApi: PrefsApi; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('guide');
  const ref = useModal<HTMLDivElement>(onClose);
  const { prefs, update } = prefsApi;
  const g = goals(state);
  const incidents = activeIncidents(state);
  const today = toDate(state.time).day;
  return (
    <div className="modal-back" onClick={onClose}>
      <div ref={ref} className="modal help" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="help-title">
        <button className="close" onClick={onClose} aria-label="Fermer">×</button>
        <h2 id="help-title">Aide &amp; options</h2>
        <nav className="subtabs" role="tablist">
          {([['guide', 'Premiers pas'], ['keys', 'Raccourcis'], ['world', 'Aléas en cours'], ['options', 'Options']] as [Tab, string][]).map(([id, l]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{l}</button>
          ))}
        </nav>
        {tab === 'guide' && (
          <>
            <p className="muted small">Des repères pour démarrer : rien n’est obligatoire, le monde vit sans toi. {g.filter(x => x.done).length}/{g.length} accomplis.</p>
            <ul className="goals">
              {g.map(x => (
                <li key={x.label} className={x.done ? 'done' : ''}>
                  <span className="check" aria-hidden="true">{x.done ? '✔' : '○'}</span>
                  <div><b>{x.label}</b>{x.done && <span className="sr-only"> (accompli)</span>}<div className="muted small">{x.hint}</div></div>
                </li>
              ))}
            </ul>
            <label className="opt"><input type="checkbox" checked={prefs.guide} onChange={e => update({ guide: e.target.checked })} /> Afficher l’objectif suivant sous les actions</label>
          </>
        )}
        {tab === 'keys' && (
          <table className="keys">
            <tbody>{SHORTCUTS.map(([k, l]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{l}</td></tr>)}</tbody>
          </table>
        )}
        {tab === 'world' && (
          incidents.length === 0 ? <p className="muted">Aucun aléa en cours : le temps est clément, la région en paix avec les éléments.</p> : (
            <ul className="incident-list">
              {incidents.map(i => (
                <li key={i.id} className={`incident ${i.kind}`}><b>{INCIDENT_NAMES[i.kind]}</b> à {state.settlements[i.settlementId].name} <span className="muted small">— {INCIDENT_EFFECTS[i.kind]}{i.toDay > today ? `, encore ${i.toDay - today} jour${i.toDay - today > 1 ? 's' : ''}` : ', dernier jour'}</span></li>
              ))}
            </ul>
          )
        )}
        {tab === 'options' && (
          <div className="options">
            <label className="opt"><input type="checkbox" checked={prefs.sound} onChange={e => update({ sound: e.target.checked })} /> Ambiance sonore et bruitages</label>
            <label className="opt">Volume <input type="range" min={0} max={1} step={0.05} value={prefs.volume} onChange={e => update({ volume: Number(e.target.value) })} aria-valuetext={`${Math.round(prefs.volume * 100)} %`} /> {Math.round(prefs.volume * 100)} %</label>
            <fieldset className="opt-group">
              <legend>Taille du texte</legend>
              {[1, 1.15, 1.3].map(v => <label key={v}><input type="radio" name="ts" checked={prefs.textScale === v} onChange={() => update({ textScale: v })} /> {Math.round(v * 100)} %</label>)}
            </fieldset>
            <fieldset className="opt-group">
              <legend>Animations</legend>
              {([['auto', 'Selon le système'], ['reduce', 'Réduites'], ['full', 'Complètes']] as const).map(([v, l]) => <label key={v}><input type="radio" name="mo" checked={prefs.motion === v} onChange={() => update({ motion: v })} /> {l}</label>)}
            </fieldset>
            <label className="opt"><input type="checkbox" checked={prefs.contrast} onChange={e => update({ contrast: e.target.checked })} /> Contraste renforcé</label>
            <p className="muted small">Ces réglages sont propres à ce navigateur et ne modifient pas la sauvegarde.</p>
          </div>
        )}
      </div>
    </div>
  );
}
