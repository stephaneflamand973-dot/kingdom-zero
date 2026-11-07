import { continueAs, fullName, PROFESSION_NAMES } from '../engine';
import { Crest } from './icons';
import type { Game } from './useGame';
import { useModal } from './a11y';

export function SuccessionModal({ game, onMenu }: { game: Game; onMenu: () => void }) {
  const { state, act } = game;
  const ps = state.pendingSuccession;
  const ref = useModal<HTMLDivElement>();
  if (!ps) return null;
  const dead = state.characters[ps.deceasedId];
  const label = (id: string) => {
    const c = state.characters[id];
    if (dead.childIds.includes(id)) return c.sex === 'F' ? 'Ta fille' : 'Ton fils';
    if (dead.spouseId === id || c.spouseId === dead.id) return c.sex === 'F' ? 'Ton épouse' : 'Ton époux';
    if (dead.parentIds.includes(id)) return c.sex === 'F' ? 'Ta mère' : 'Ton père';
    if (c.parentIds.some(p => dead.parentIds.includes(p))) return c.sex === 'F' ? 'Ta sœur' : 'Ton frère';
    return 'Un ami fidèle';
  };
  return (
    <div className="modal-back">
      <div ref={ref} className="modal succession" role="dialog" aria-modal="true" aria-label="Succession">
        <h2>Fin d'une vie</h2>
        <p>{ps.cause}</p>
        <p className="muted">Le royaume ne s'arrête pas. Qui reprend le flambeau de la lignée {state.dynasty.name} (génération {state.dynasty.generation}) ? Le monde attend ton choix.</p>
        <ul className="heirs">
          {ps.candidates.map(id => {
            const c = state.characters[id];
            return (
              <li key={id}>
                <Crest id={id} initials={c.firstName[0] + c.lastName[0]} size={40} />
                <div><b>{fullName(c)}</b><div className="muted small">{label(id)} · {c.age} ans · {PROFESSION_NAMES[c.profession]} · {c.money} d</div></div>
                <button className="btn" onClick={() => act(s => continueAs(s, id))}>Incarner</button>
              </li>
            );
          })}
        </ul>
        <button className="btn ghost" onClick={onMenu}>Charger une sauvegarde / nouvelle partie</button>
      </div>
    </div>
  );
}
