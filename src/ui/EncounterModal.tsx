import { encounterAction, fullName, type EncounterChoice } from '../engine';
import { Crest } from './icons';
import type { Game } from './useGame';

const CHOICES: Record<'bandits' | 'arrest', { c: EncounterChoice; label: string; hint: string; danger?: boolean }[]> = {
  bandits: [
    { c: 'fight', label: 'Se battre', hint: 'un échange de coups', danger: true },
    { c: 'flee', label: 'Fuir', hint: 'Agilité' },
    { c: 'parley', label: 'Parlementer', hint: 'Diplomatie, Charisme' },
    { c: 'pay', label: 'Payer', hint: 'la somme réclamée' },
    { c: 'surrender', label: 'Se rendre', hint: 'ils prennent tout' },
  ],
  arrest: [
    { c: 'surrender', label: 'Se rendre', hint: 'prison et amende' },
    { c: 'pay', label: 'Graisser la patte', hint: 'la moitié de la prime' },
    { c: 'flee', label: 'Fuir', hint: 'Agilité' },
    { c: 'fight', label: 'Résister', hint: 'violences contre la garde', danger: true },
  ],
};

export function EncounterModal({ game }: { game: Game }) {
  const { state, act } = game;
  const e = state.encounter;
  if (!e) return null;
  const p = state.characters[state.playerId];
  return (
    <div className="modal-back">
      <div className="modal encounter" role="dialog" aria-label={e.kind === 'bandits' ? 'Embuscade' : 'Arrestation'}>
        <h2>{e.kind === 'bandits' ? 'Embuscade !' : 'Au nom de la loi'}</h2>
        <p className="muted small">{e.kind === 'bandits' ? `Sur ${state.locations[e.roadId ?? p.locationId].name} · ils réclament ${e.demand} d · tu as ${p.money} d` : `Prime sur ta tête : ${state.wanted.find(w => w.characterId === p.id)?.bounty ?? 0} d`}</p>
        <div className="fighters">
          <div className="fighter you">
            <Crest id="player" initials="Toi" size={40} />
            <div><b>{fullName(p)}</b><div className="hpbar"><div style={{ width: `${p.health}%` }} /></div><span className="small">{Math.round(p.health)} PV · combat {p.skills.combat}</span></div>
          </div>
          {e.enemies.map(id => {
            const c = state.characters[id];
            const hp = e.hp[id] ?? 0;
            return (
              <div key={id} className={`fighter ${hp <= 0 ? 'down' : ''}`}>
                <Crest id={id} initials={e.kind === 'bandits' ? '?' : c.firstName[0] + c.lastName[0]} size={40} />
                <div><b>{e.kind === 'bandits' ? 'Brigand masqué' : fullName(c)}</b><div className="hpbar foe"><div style={{ width: `${Math.max(0, hp)}%` }} /></div><span className="small">{hp} PV</span></div>
              </div>
            );
          })}
        </div>
        {game.feed[0] && <p className="dialog-result">{game.feed[0].text}</p>}
        <ol className="combat-log">
          {e.log.slice(-6).map((l, i) => <li key={i}>{l}</li>)}
        </ol>
        <div className="talk-grid">
          {CHOICES[e.kind].map(o => (
            <button key={o.c} className={`btn ${o.danger ? 'danger' : ''}`} disabled={!!state.gameOver || (o.c === 'pay' && e.kind === 'bandits' && p.money <= 0 && Object.keys(p.inventory).length === 0)}
              onClick={() => act(s => encounterAction(s, o.c))}>{o.label}<small>{o.hint}</small></button>
          ))}
        </div>
      </div>
    </div>
  );
}
