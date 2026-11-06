import { useState } from 'react';
import {
  aliveCharacters, allBusinesses, ATTR_NAMES, formatClock, formatDate, fullName, getEvent, getRelation, ITEMS, ITEM_ICON, ITEM_IDS,
  moodOf, PROFESSION_NAMES, qty, referencePrice, relationLabel, reputation, reputationLabel, SKILL_NAMES, xpForNextLevel,
  type AttrId, type GameState, type ItemId, type SkillId, type WorldEvent,
} from '../engine';
import { ACTIVITY_COLOR } from './VillageMap';

type Tab = 'perso' | 'inv' | 'rel' | 'journal' | 'monde';
const TABS: { id: Tab; label: string }[] = [
  { id: 'perso', label: 'Personnage' }, { id: 'inv', label: 'Inventaire' }, { id: 'rel', label: 'Relations' },
  { id: 'journal', label: 'Journal' }, { id: 'monde', label: 'Monde' },
];

export function SidePanels({ state, onTalk }: { state: GameState; onTalk: (id: string) => void }) {
  const [tab, setTab] = useState<Tab>('perso');
  return (
    <section className="panel side">
      <nav className="tabs" role="tablist">
        {TABS.map(t => <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>{t.label}</button>)}
      </nav>
      <div className="tab-body">
        {tab === 'perso' && <Perso state={state} />}
        {tab === 'inv' && <Inv state={state} />}
        {tab === 'rel' && <Rel state={state} onTalk={onTalk} />}
        {tab === 'journal' && <Journal state={state} />}
        {tab === 'monde' && <Monde state={state} />}
      </div>
    </section>
  );
}

const GOALS: Record<string, string> = {
  survivre: 'Survivre : trouver de quoi manger et un toit', trouver_emploi: 'Trouver un emploi', epargner: 'Mettre de l’argent de côté',
  prosperer: 'Faire prospérer son affaire', servir: 'Servir l’intendance',
};

function Perso({ state }: { state: GameState }) {
  const p = state.characters[state.playerId];
  const rep = reputation(state, p.id);
  return (
    <div className="perso">
      <div className="perso-head">
        <div><h3>{fullName(p)}</h3><div className="muted">{p.age} ans · {PROFESSION_NAMES[p.profession]} · {moodOf(p)}</div></div>
        <div className="rep"><div className="tb-sub">Réputation</div><strong>{reputationLabel(rep.score, rep.known)}</strong><div className="muted small">{rep.known} personne{rep.known > 1 ? 's' : ''} te connaissent</div></div>
      </div>
      <p className="goal">🎯 {GOALS[p.goal.kind]}</p>
      <h4>Attributs</h4>
      <div className="attrs">
        {(Object.keys(ATTR_NAMES) as AttrId[]).map(a => <div key={a} className="attr"><span>{ATTR_NAMES[a]}</span><b>{p.attributes[a]}</b></div>)}
      </div>
      <h4>Compétences</h4>
      <div className="skills">
        {(Object.keys(SKILL_NAMES) as SkillId[]).map(k => {
          const xp = p.skillXp[k] ?? 0, need = xpForNextLevel(p.skills[k]);
          return (
            <div key={k} className="skill">
              <span>{SKILL_NAMES[k]}</span>
              <div className="skill-track"><div className="skill-fill" style={{ width: `${p.skills[k]}%` }} /><div className="skill-xp" style={{ width: `${Math.min(100, (xp / need) * 100)}%` }} /></div>
              <b>{p.skills[k]}</b>
            </div>
          );
        })}
      </div>
      <p className="muted small">Les compétences progressent par la pratique : travail, commerce, conversation, entraînement. Plus le niveau est élevé, plus l’apprentissage est lent.</p>
      <div className="facts">
        <span>Travail aujourd'hui : <b>{p.hoursWorkedToday} h</b></span>
        {p.unpaidWages > 0 && <span className="ko">Salaires impayés : {p.unpaidWages} d</span>}
        {p.sick > 0 && <span className="ko">Malade ({p.sick} h)</span>}
      </div>
    </div>
  );
}

function Inv({ state }: { state: GameState }) {
  const p = state.characters[state.playerId];
  const items = ITEM_IDS.filter(i => qty(p.inventory, i) > 0);
  const value = items.reduce((s, i) => s + qty(p.inventory, i) * (referencePrice(state, i) ?? ITEMS[i].base), 0);
  return (
    <div>
      <div className="inv-money">Bourse : <b>{p.money} d</b> · Valeur estimée des biens : <b>{value} d</b></div>
      {items.length === 0 && <p className="muted">Ta besace est vide.</p>}
      <ul className="inv">
        {items.map(i => <li key={i}><span className="ico big">{ITEM_ICON[i]}</span><div><b>{qty(p.inventory, i)} × {qty(p.inventory, i) > 1 ? ITEMS[i].plural : ITEMS[i].name}</b><div className="muted small">{ITEMS[i].food ? `Nourriture (−${ITEMS[i].food} faim)` : 'Marchandise'} · ~{referencePrice(state, i) ?? ITEMS[i].base} d pièce</div></div></li>)}
      </ul>
    </div>
  );
}

function Rel({ state, onTalk }: { state: GameState; onTalk: (id: string) => void }) {
  const p = state.characters[state.playerId];
  const known = aliveCharacters(state).filter(c => !c.isPlayer && c.relations[p.id])
    .map(c => ({ c, r: getRelation(state, c.id, p.id) })).sort((a, b) => b.r.affinity - a.r.affinity);
  return (
    <div>
      {known.length === 0 && <p className="muted">Personne ne te connaît encore. Parle aux habitants, travaille pour eux, rends-leur service.</p>}
      <ul className="rel-list">
        {known.map(({ c, r }) => (
          <li key={c.id}>
            <div className="rel-row-head">
              <button className="link" onClick={() => c.locationId === p.locationId && onTalk(c.id)} disabled={c.locationId !== p.locationId} title={c.locationId === p.locationId ? 'Parler' : `Se trouve à ${state.locations[c.locationId].name}`}>{fullName(c)}</button>
              <span className={`rel-chip ${r.affinity >= 10 ? 'good' : r.affinity <= -10 ? 'bad' : ''}`}>{relationLabel(r)}</span>
            </div>
            <div className="mini-bars"><span>Aff. <b className={r.affinity < 0 ? 'ko' : 'ok'}>{r.affinity}</b></span><span>Conf. <b className={r.trust < 0 ? 'ko' : 'ok'}>{r.trust}</b></span><span className="muted">{PROFESSION_NAMES[c.profession]}</span></div>
          </li>
        ))}
      </ul>
    </div>
  );
}

type JMode = 'vie' | 'nouvelles' | 'chronique';
function Journal({ state }: { state: GameState }) {
  const [mode, setMode] = useState<JMode>('vie');
  const [selected, setSelected] = useState<string | null>(null);
  const p = state.characters[state.playerId];
  let list: WorldEvent[];
  if (mode === 'vie') list = state.events.filter(e => e.actorId === p.id || e.targetId === p.id);
  else if (mode === 'nouvelles') list = p.knownEvents.map(id => getEvent(state, id)).filter((e): e is WorldEvent => !!e && e.actorId !== p.id && e.targetId !== p.id);
  else list = state.events.filter(e => e.importance >= 2);
  list = list.slice().sort((a, b) => b.time - a.time).slice(0, 80);
  const sel = selected ? getEvent(state, selected) : undefined;
  return (
    <div>
      <div className="seg">
        {([['vie', 'Ma vie'], ['nouvelles', 'Nouvelles apprises'], ['chronique', 'Chronique (omnisciente)']] as [JMode, string][]).map(([m, l]) =>
          <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>{l}</button>)}
      </div>
      {mode === 'chronique' && <p className="muted small">Vue du chroniqueur : tous les faits réels, y compris ceux que ton personnage ignore. Utile pour comprendre et déboguer la simulation.</p>}
      {list.length === 0 && <p className="muted">Rien à consigner pour l’instant.</p>}
      <ol className="journal">
        {list.map(e => (
          <li key={e.id} className={`imp${e.importance}`} onClick={() => setSelected(selected === e.id ? null : e.id)}>
            <span className="j-time">{formatDate(e.time).split(' ').slice(1, 3).join(' ')} · {formatClock(e.time)}</span>
            <span>{e.text}</span>
            {selected === e.id && sel && <EventDetail state={state} e={sel} omniscient={mode === 'chronique'} />}
          </li>
        ))}
      </ol>
    </div>
  );
}

function EventDetail({ state, e, omniscient }: { state: GameState; e: WorldEvent; omniscient: boolean }) {
  const knowers = state.characterOrder.filter(id => state.characters[id].knownEvents.includes(e.id)).map(id => state.characters[id]);
  const culprit = omniscient && typeof e.data?.culprit === 'string' ? state.characters[e.data.culprit] : undefined;
  return (
    <div className="ev-detail" onClick={ev => ev.stopPropagation()}>
      <div>Type : <b>{e.type}</b> · id {e.id}{e.businessId ? ` · ${state.businesses[e.businessId]?.name}` : ''}</div>
      {e.causeIds?.length ? <div>Causé par : {e.causeIds.map(id => getEvent(state, id)?.text ?? id).join(' ; ')}</div> : null}
      <div>Témoins : {e.witnesses.length ? e.witnesses.map(id => state.characters[id]?.firstName ?? id).join(', ') : 'aucun'}</div>
      {e.importance >= 2 && <div>Connu de : {knowers.length ? knowers.map(c => c.isPlayer ? 'toi' : c.firstName).join(', ') : 'personne'}</div>}
      {culprit && <div className="ko">Coupable réel (fait caché) : {fullName(culprit)}</div>}
    </div>
  );
}

function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return <span className="muted small">—</span>;
  const max = Math.max(...values), min = Math.min(...values);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 80},${18 - ((v - min) / Math.max(1, max - min)) * 16}`).join(' ');
  return <svg width="80" height="20" className="spark"><polyline points={pts} fill="none" stroke="#c9a24a" strokeWidth="1.5" /></svg>;
}

function Monde({ state }: { state: GameState }) {
  const [view, setView] = useState<'habitants' | 'economie'>('habitants');
  const pop = aliveCharacters(state).filter(c => !c.isPlayer);
  const manor = state.businesses[state.village.manorId];
  const hist = state.history.slice(-28);
  return (
    <div>
      <div className="village-stats">
        <div><span>Habitants</span><b>{pop.length}</b></div>
        <div><span>Employés</span><b>{pop.filter(c => c.employerId).length}</b></div>
        <div><span>Routes</span><b>{Math.round(state.village.infrastructure)}/100</b></div>
        <div><span>Trésor public</span><b>{manor.treasury} d</b></div>
      </div>
      <div className="seg">
        <button className={view === 'habitants' ? 'on' : ''} onClick={() => setView('habitants')}>Habitants</button>
        <button className={view === 'economie' ? 'on' : ''} onClick={() => setView('economie')}>Économie</button>
      </div>
      {view === 'habitants' && (
        <ul className="census">
          {pop.map(c => (
            <li key={c.id}>
              <i style={{ background: ACTIVITY_COLOR[c.activity.kind] }} />
              <div><b>{fullName(c)}</b> <span className="muted small">{PROFESSION_NAMES[c.profession]}, {c.age} ans · {moodOf(c)}</span>
                <div className="small">{c.activity.note} — <span className="muted">{state.locations[c.locationId].name}</span></div></div>
            </li>
          ))}
          {state.characterOrder.filter(id => !state.characters[id].alive).map(id => (
            <li key={id} className="dead"><i /><div><b>{fullName(state.characters[id])}</b> <span className="muted small">† {state.characters[id].activity.note}</span></div></li>
          ))}
        </ul>
      )}
      {view === 'economie' && (
        <div>
          <table className="prices">
            <thead><tr><th>Bien</th><th>Prix</th><th>Tendance (28 j)</th><th>Stock total</th></tr></thead>
            <tbody>
              {ITEM_IDS.map((i: ItemId) => {
                const stock = allBusinesses(state).reduce((s, b) => s + qty(b.stock, i), 0);
                return <tr key={i}><td>{ITEM_ICON[i]} {ITEMS[i].name}</td><td>{referencePrice(state, i) ?? '—'} d</td><td><Spark values={hist.map(h => h.prices[i] ?? 0)} /></td><td>{stock}</td></tr>;
              })}
            </tbody>
          </table>
          <h4>Établissements</h4>
          <ul className="biz-list">
            {allBusinesses(state).map(b => (
              <li key={b.id}>
                <div className="rel-row-head"><b>{b.name}</b><span>{b.treasury} d</span></div>
                <div className="muted small">{b.ownerId ? fullName(state.characters[b.ownerId]) : 'Intendance'} · {b.employees.length}/{b.maxWorkers} employés · {b.wage} d/h</div>
                <div className="small">{(Object.keys(b.stock) as ItemId[]).map(i => `${ITEM_ICON[i]} ${b.stock[i]}`).join('  ') || 'Aucun stock'}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
