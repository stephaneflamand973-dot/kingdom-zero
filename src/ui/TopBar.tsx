import { carryCapacity, formatClock, formatDate, moodOf, reputation, reputationLabel, SEASONS, settlementOf, toDate, weightOf, type GameState } from '../engine';
import { Coin, SunMoon } from './icons';

function Gauge({ label, value, color, invert = false }: { label: string; value: number; color: string; invert?: boolean }) {
  const v = Math.round(value);
  const danger = invert ? v >= 75 : v <= 25;
  return (
    <div className={`gauge ${danger ? 'danger' : ''}`} title={`${label} : ${v}/100`}>
      <span className="gauge-label">{label}</span>
      <div className="gauge-track"><div className="gauge-fill" style={{ width: `${v}%`, background: color }} /></div>
      <span className="gauge-val">{v}</span>
    </div>
  );
}

export function TopBar({ state, onMenu }: { state: GameState; onMenu: () => void }) {
  const p = state.characters[state.playerId];
  const d = toDate(state.time);
  const rep = reputation(state, p.id);
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">♜</span>
        <div><div className="brand-name">Kingdom Zero</div><div className="brand-sub">Pays de Valcendre · an {d.year}</div></div>
      </div>
      <div className="tb-block time">
        <SunMoon hour={d.hour} />
        <div><div className="tb-strong">{formatClock(state.time)}</div><div className="tb-sub">{formatDate(state.time)}</div></div>
        <span className={`season s${d.season}`}>{SEASONS[d.season]}</span>
      </div>
      <div className="tb-block"><div><div className="tb-sub">{settlementOf(state, p.locationId).name}</div><div className="tb-strong">{state.locations[p.locationId].name}</div></div></div>
      <div className="tb-block money"><Coin size={20} /><div><div className="tb-strong">{p.money} d</div><div className="tb-sub">deniers</div></div></div>
      <div className="tb-gauges">
        <Gauge label="Santé" value={p.health} color="linear-gradient(90deg,#8e2b2b,#c94a3f)" />
        <Gauge label="Énergie" value={p.needs.energy} color="linear-gradient(90deg,#3d6d8e,#5fa3c9)" />
        <Gauge label="Faim" value={p.needs.hunger} color="linear-gradient(90deg,#b8862f,#e3a83b)" invert />
      </div>
      <div className="tb-block" title="Charge portée / capacité (poids)"><div><div className="tb-sub">Charge</div><div className="tb-strong">{weightOf(p.inventory)}/{carryCapacity(p)}</div></div></div>
      <div className="tb-block status">
        <div className="tb-sub">État · Réputation</div>
        <div className="tb-strong">{moodOf(p)} · {reputationLabel(rep.score, rep.known)}</div>
      </div>
      <button className="btn ghost menu-btn" onClick={onMenu}>☰ Partie</button>
    </header>
  );
}
