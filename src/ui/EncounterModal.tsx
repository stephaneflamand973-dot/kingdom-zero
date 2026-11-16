import { BOUT_LOSS, encounterAction, fighterOf, fullName, GEAR, type EncounterChoice } from '../engine';
import { Crest } from './icons';
import type { Game } from './useGame';
import { useModal } from './a11y';

type Choice = { c: EncounterChoice; label: string; hint: string; danger?: boolean };
// postures d'escrime (phase 12)
const STANCE_CHOICES: Choice[] = [
  { c: 'fight', label: 'Frapper', hint: 'un échange de coups', danger: true },
  { c: 'strike', label: 'Coup puissant', hint: 'dégâts ×1,6, garde ouverte', danger: true },
  { c: 'guard', label: 'Parer', hint: 'encaisse moins, frappe à moitié' },
  { c: 'feint', label: 'Feinter', hint: 'Agilité, Intelligence' },
];
const CHOICES: Record<'bandits' | 'arrest' | 'duel', Choice[]> = {
  bandits: [
    ...STANCE_CHOICES,
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
    { c: 'guard', label: 'Résister en parant', hint: 'encaisse moins', danger: true },
    { c: 'feint', label: 'Résister par la ruse', hint: 'feinte', danger: true },
  ],
  duel: [
    ...STANCE_CHOICES.map(x => ({ ...x, danger: false })),
    { c: 'surrender', label: 'Céder l’assaut', hint: 'tu es éliminé', danger: true },
  ],
};

const TITLE = { bandits: 'Embuscade !', arrest: 'Au nom de la loi', duel: 'En lice !' };

export function EncounterModal({ game }: { game: Game }) {
  const { state, act } = game;
  const e = state.encounter;
  const ref = useModal<HTMLDivElement>();
  if (!e) return null;
  const p = state.characters[state.playerId];
  return (
    <div className="modal-back">
      <div ref={ref} className="modal encounter" role="alertdialog" aria-modal="true" aria-label={e.kind === 'bandits' ? 'Embuscade' : e.kind === 'duel' ? 'Assaut de tournoi' : 'Arrestation'}>
        <h2>{TITLE[e.kind]}</h2>
        <p className="muted small">{e.kind === 'bandits' ? `Sur ${state.locations[e.roadId ?? p.locationId].name} · ils réclament ${e.demand} d · tu as ${p.money} d`
          : e.kind === 'duel' ? duelLine(e, p.id, Math.round(p.health))
          : `Prime sur ta tête : ${state.wanted.find(w => w.characterId === p.id)?.bounty ?? 0} d`}</p>
        <div className="fighters">
          <div className="fighter you">
            <Crest id="player" initials="Toi" size={40} />
            <div><b>{fullName(p)}</b><div className="hpbar"><div style={{ width: `${p.health}%` }} /></div><span className="small">{Math.round(p.health)} PV · attaque {fighterOf(p).attack.toFixed(1)} · défense {fighterOf(p).defense.toFixed(1)}{p.gear?.weapon ? ` · ${GEAR[p.gear.weapon.id].name}` : ''}{p.gear?.armor ? ` · ${GEAR[p.gear.armor.id].name}` : ''}</span></div>
          </div>
          {e.enemies.map(id => {
            const c = state.characters[id];
            const hp = e.hp[id] ?? 0;
            return (
              <div key={id} className={`fighter ${hp <= 0 ? 'down' : ''}`}>
                <Crest id={id} initials={e.kind === 'bandits' ? '?' : c.firstName[0] + c.lastName[0]} size={40} />
                <div><b>{e.kind === 'bandits' ? 'Brigand masqué' : fullName(c)}</b>{e.kind === 'duel' && <span className="small muted"> · combat {c.skills.combat}</span>}<div className="hpbar foe"><div style={{ width: `${Math.max(0, hp)}%` }} /></div><span className="small">{hp} PV</span></div>
              </div>
            );
          })}
        </div>
        {game.feed[0] && <p className="dialog-result">{game.feed[0].text}</p>}
        <ol className="combat-log" aria-live="polite">
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

function duelLine(e: NonNullable<Game['state']['encounter']>, pid: string, hp: number): string {
  const opp = e.enemies[0];
  const lostP = (e.duelStart?.[pid] ?? hp) - hp, lostO = (e.duelStart?.[opp] ?? 0) - (e.hp[opp] ?? 0);
  return `Duel courtois : le premier qui encaisse ${BOUT_LOSS} points perd l'assaut · touches reçues : toi ${Math.max(0, lostP)}, adversaire ${Math.max(0, lostO)} · tour ${e.round}/8`;
}
