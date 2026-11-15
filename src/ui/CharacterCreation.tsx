import { useState } from 'react';
import { PERKS, type PerkId } from '../engine';
import { useModal } from './a11y';
import type { Game } from './useGame';

const FIRST = { M: ['Aymeric', 'Bertrand', 'Galeran', 'Renaud', 'Thibaut', 'Enguerrand'], F: ['Aélis', 'Héloïse', 'Ysabeau', 'Mahaut', 'Bérengère', 'Clémence'] };
const LAST = ['de Nulle-Part', 'Lefèvre', 'Duchemin', 'de la Haie', 'Courtepaille', 'Boisvert'];

/** Création du personnage (phase 9) : nom, sexe, âge et deux atouts de départ. */
export function CharacterCreation({ game, canCancel }: { game: Game; canCancel: boolean }) {
  const [sex, setSex] = useState<'M' | 'F'>('M');
  const [firstName, setFirst] = useState('Aymeric');
  const [lastName, setLast] = useState('de Nulle-Part');
  const [age, setAge] = useState(24);
  const [perks, setPerks] = useState<PerkId[]>([]);
  const [seed, setSeed] = useState('');
  const ref = useModal<HTMLDivElement>(canCancel ? () => game.setCreating(false) : undefined);
  const toggle = (id: PerkId) => setPerks(ps => ps.includes(id) ? ps.filter(x => x !== id) : [...ps, id]);
  const random = () => {
    const s = Math.random() < 0.5 ? 'M' : 'F';
    setSex(s);
    setFirst(FIRST[s][Math.floor(Math.random() * FIRST[s].length)]);
    setLast(LAST[Math.floor(Math.random() * LAST.length)]);
    setAge(18 + Math.floor(Math.random() * 15));
  };
  const start = () => game.newGame({ firstName, lastName, sex, age, perks }, seed.trim() ? Math.abs(Math.floor(Number(seed))) || undefined : undefined);
  return (
    <div className="modal-back">
      <div ref={ref} className="modal creation" role="dialog" aria-modal="true" aria-labelledby="cc-title">
        {canCancel && <button className="close" onClick={() => game.setCreating(false)} aria-label="Fermer">×</button>}
        <h2 id="cc-title">Une nouvelle vie</h2>
        <p className="muted small">Tu arrives au pays de Valcendre sans attaches. Qui es-tu ?</p>
        <div className="cc-grid">
          <label>Prénom<input value={firstName} maxLength={24} onChange={e => setFirst(e.target.value)} data-autofocus /></label>
          <label>Nom<input value={lastName} maxLength={24} onChange={e => setLast(e.target.value)} /></label>
          <fieldset className="opt-group"><legend>Sexe</legend>
            <label><input type="radio" name="sex" checked={sex === 'M'} onChange={() => setSex('M')} /> Homme</label>
            <label><input type="radio" name="sex" checked={sex === 'F'} onChange={() => setSex('F')} /> Femme</label>
          </fieldset>
          <label>Âge : {age} ans<input type="range" min={16} max={40} value={age} onChange={e => setAge(Number(e.target.value))} /></label>
        </div>
        <h3 className="dialog-sub">Atouts de départ ({perks.length} choisi{perks.length > 1 ? 's' : ''}, sans limite)</h3>
        <div className="save-row"><button className="btn sm ghost" onClick={() => setPerks(PERKS.map(p => p.id))}>Tout prendre</button><button className="btn sm ghost" onClick={() => setPerks([])}>Aucun</button></div>
        <ul className="perk-list">
          {PERKS.map(pk => {
            const on = perks.includes(pk.id);
            return (
              <li key={pk.id}>
                <button className={`perk ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => toggle(pk.id)}>
                  <b>{pk.name}</b><span>{pk.description}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <details className="small"><summary>Options avancées</summary>
          <label>Graine du monde (facultatif, pour rejouer le même monde)<input value={seed} inputMode="numeric" onChange={e => setSeed(e.target.value.replace(/[^0-9]/g, ''))} placeholder="au hasard" /></label>
        </details>
        <div className="save-row">
          <button className="btn ghost" onClick={random}>Au hasard</button>
          <button className="btn" disabled={!firstName.trim() || !lastName.trim()} onClick={start}>Commencer</button>
        </div>
      </div>
    </div>
  );
}
