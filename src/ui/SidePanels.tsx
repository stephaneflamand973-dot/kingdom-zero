import { useState } from 'react';
import {
  toDate, residents, businessesIn, settlementIdOf, aliveCharacters, ATTR_NAMES, formatClock, formatDate, fullName, getEvent, getRelation, ITEMS, ITEM_ICON, ITEM_IDS,
  activeContract, activeLoans, ambitionLabel, quitJob, repayLoan, reputationTags, orgList, landsOf, soldiersOf,
  moodOf, PROFESSION_NAMES, qty, referencePrice, relationLabel, reputation, reputationLabel, SKILL_NAMES, xpForNextLevel,
  type AttrId, type GameState, type ItemId, type SkillId, type WorldEvent,
} from '../engine';
import { ACTIVITY_COLOR } from './VillageMap';
import type { Game } from './useGame';

type Tab = 'perso' | 'famille' | 'inv' | 'affaires' | 'rel' | 'journal' | 'monde' | 'pouvoir';
const TABS: { id: Tab; label: string }[] = [
  { id: 'perso', label: 'Personnage' }, { id: 'famille', label: 'Famille' }, { id: 'inv', label: 'Besace' }, { id: 'affaires', label: 'Affaires' }, { id: 'rel', label: 'Relations' },
  { id: 'journal', label: 'Journal' }, { id: 'monde', label: 'Monde' }, { id: 'pouvoir', label: 'Pouvoir' },
];

export function SidePanels({ game, onTalk }: { game: Game; onTalk: (id: string) => void }) {
  const { state } = game;
  const [tab, setTab] = useState<Tab>('perso');
  return (
    <section className="panel side">
      <nav className="tabs" role="tablist">
        {TABS.map(t => <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>{t.label}</button>)}
      </nav>
      <div className="tab-body">
        {tab === 'perso' && <Perso state={state} />}
        {tab === 'famille' && <Famille state={state} onTalk={onTalk} />}
        {tab === 'inv' && <Inv state={state} />}
        {tab === 'affaires' && <Affaires game={game} />}
        {tab === 'rel' && <Rel state={state} onTalk={onTalk} />}
        {tab === 'journal' && <Journal state={state} />}
        {tab === 'monde' && <Monde state={state} />}
        {tab === 'pouvoir' && <Pouvoir state={state} />}
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
  const tags = reputationTags(state, p.id);
  return (
    <div className="perso">
      <div className="perso-head">
        <div><h3>{fullName(p)}</h3><div className="muted">{p.age} ans · {PROFESSION_NAMES[p.profession]} · {moodOf(p)}</div></div>
        <div className="rep"><div className="tb-sub">Réputation</div><strong>{reputationLabel(rep.score, rep.known)}</strong><div className="muted small">{rep.known} personne{rep.known > 1 ? 's' : ''} te connaissent</div></div>
      </div>
      <p className="goal">🎯 {GOALS[p.goal.kind]}{p.title ? ` · ${p.title === 'ecuyer' ? 'Écuyer' : 'Conseiller'}` : ''}</p>
      {tags.length > 0 && (
        <div className="tags" title="Ce que les habitants savent de toi, et combien le savent">
          {tags.map(t => <span key={t.tag} className={`tag ${t.good ? 'good' : 'bad'}`}>{t.tag} · {t.known}</span>)}
        </div>
      )}
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

function Affaires({ game }: { game: Game }) {
  const { state, act } = game;
  const p = state.characters[state.playerId];
  const over = !!state.gameOver;
  const k = activeContract(state, p.id);
  const owes = activeLoans(state, { borrowerId: p.id });
  const owed = activeLoans(state, { lenderId: p.id });
  const orders = state.orders.filter(o => o.takerId === p.id && o.status === 'taken');
  const day = toDate(state.time).day;
  const homes = state.properties.filter(pr => pr.tenantId === p.id || pr.ownerId === p.id);
  const owned = Object.values(state.businesses).filter(b => b.ownerId === p.id);
  const past = [...state.loans.filter(l => (l.borrowerId === p.id || l.lenderId === p.id) && l.status !== 'active')].slice(-4);
  return (
    <div className="affaires">
      <h4>Emploi</h4>
      {k ? (
        <div className="card-line">
          <div><b>{state.businesses[k.businessId].name}</b> · {k.wage} d/h<div className="muted small">{k.hoursThisWeek} h sur {k.hoursPerWeek} h exigées cette semaine · {k.goodWeeks} semaine{k.goodWeeks > 1 ? 's' : ''} satisfaisante{k.goodWeeks > 1 ? 's' : ''}{k.strikes ? ` · ${k.strikes} avertissement` : ''}</div></div>
          <button className="btn sm ghost" disabled={over} onClick={() => act(quitJob)}>Démissionner</button>
        </div>
      ) : <p className="muted small">Aucune place. Travaille à la journée, puis demande une place à un patron qui te connaît.</p>}
      <h4>Logement</h4>
      {homes.length === 0 && <p className="muted small">Aucun. Une chambre se loue à l’auberge, une maison s’achète auprès de l’intendance.</p>}
      {homes.map(pr => (
        <div key={pr.id} className="card-line"><div><b>{pr.name}</b> · {state.settlements[pr.settlementId].name}<div className="muted small">{pr.ownerId === p.id ? 'Propriété' : `Loyer ${pr.weeklyRent} d, prochain dans ${Math.max(0, (pr.rentDueDay ?? day) - day)} j`} · coffre {Object.values(pr.storage).reduce((a, b) => a + (b ?? 0), 0)} objets</div></div></div>
      ))}
      <h4>Tes entreprises</h4>
      {owned.length === 0 && <p className="muted small">Aucune. Rachète une affaire en difficulté ou fonde un établissement depuis une place.</p>}
      {owned.map(b => (
        <div key={b.id} className="card-line"><div><b>{b.name}</b> · {state.settlements[settlementIdOf(state, b.locationId)].name}<div className="muted small">Caisse {b.treasury} d · {b.employees.length} ouvrier{b.employees.length > 1 ? 's' : ''} à {b.wage} d/h · stock {(Object.keys(b.stock) as ItemId[]).map(i => `${ITEM_ICON[i]} ${b.stock[i]}`).join(' ') || 'vide'}</div></div></div>
      ))}
      <h4>Tes dettes</h4>
      {owes.length === 0 && <p className="muted small">Tu ne dois rien à personne.</p>}
      {owes.map(l => (
        <div key={l.id} className="card-line">
          <div><b>{l.remaining} d</b> à {fullName(state.characters[l.lenderId])}<div className="muted small">Échéance de {l.installment} d dans {Math.max(0, l.nextDueDay - day)} j · {l.missed ? `${l.missed} échéance manquée · ` : ''}{l.purpose}</div></div>
          <div className="slot-btns">
            <button className="btn sm" disabled={over || p.money < 1} onClick={() => act(s => repayLoan(s, l.id, l.installment))}>Verser {Math.min(l.installment, l.remaining)} d</button>
            <button className="btn sm ghost" disabled={over || p.money < l.remaining} onClick={() => act(s => repayLoan(s, l.id))}>Solder</button>
          </div>
        </div>
      ))}
      {owes.length > 0 && <p className="muted small">Les échéances sont prélevées d’office chaque semaine. Deux échéances manquées valent défaut : saisie de ta bourse et de tes biens, et la nouvelle se répand.</p>}
      <h4>On te doit</h4>
      {owed.length === 0 && <p className="muted small">Personne ne te doit d’argent.</p>}
      {owed.map(l => (
        <div key={l.id} className="card-line"><div><b>{l.remaining} d</b> par {fullName(state.characters[l.borrowerId])}<div className="muted small">{l.installment} d par semaine · prochaine échéance dans {Math.max(0, l.nextDueDay - day)} j{l.missed ? ` · ${l.missed} manquée` : ''}</div></div></div>
      ))}
      <h4>Commandes en cours</h4>
      {orders.length === 0 && <p className="muted small">Aucune. Le tableau des commandes est sur la Place du Puits.</p>}
      {orders.map(o => (
        <div key={o.id} className="card-line"><div><b>{o.qty - o.delivered} {ITEMS[o.item].plural}</b> pour {state.businesses[o.businessId].name}<div className="muted small">{o.unitPrice} d pièce · à livrer sur place d’ici {Math.max(0, o.deadlineDay - day)} j · tu en as {qty(p.inventory, o.item)}</div></div></div>
      ))}
      {past.length > 0 && <><h4>Historique</h4>{past.map(l => <p key={l.id} className="muted small">{l.borrowerId === p.id ? `Emprunt de ${l.principal} d à ${state.characters[l.lenderId].firstName}` : `Prêt de ${l.principal} d à ${state.characters[l.borrowerId].firstName}`} — {l.status === 'repaid' ? 'remboursé' : 'défaut'}</p>)}</>}
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
  const p = state.characters[state.playerId];
  const [view, setView] = useState<'habitants' | 'economie' | 'prix'>('habitants');
  const [sid, setSid] = useState<string>(state.settlements[settlementIdOf(state, p.locationId)] ? settlementIdOf(state, p.locationId) : state.settlementOrder[0]);
  const st = state.settlements[sid];
  const pop = residents(state, sid);
  const manor = state.businesses[st.manorId];
  const hist = st.history.slice(-12);
  const day = toDate(state.time).day;
  return (
    <div>
      <div className="seg">
        {state.settlementOrder.map(id => <button key={id} className={sid === id ? 'on' : ''} onClick={() => setSid(id)}>{state.settlements[id].name.split('-sur-')[0]}</button>)}
      </div>
      <p className="muted small">{st.specialty}</p>
      <div className="village-stats">
        <div><span>Prospérité</span><b>{st.prosperity}</b><Spark values={hist.map(h => h.prosperity)} /></div>
        <div><span>Habitants</span><b>{pop.length}</b></div>
        <div><span>Employés</span><b>{pop.filter(c => c.employerId).length}</b></div>
        <div><span>Chemins</span><b>{Math.round(st.infrastructure)}/100</b></div>
        <div><span>Trésor</span><b>{manor.treasury} d</b></div>
      </div>
      <div className="seg">
        <button className={view === 'habitants' ? 'on' : ''} onClick={() => setView('habitants')}>Habitants</button>
        <button className={view === 'economie' ? 'on' : ''} onClick={() => setView('economie')}>Établissements</button>
        <button className={view === 'prix' ? 'on' : ''} onClick={() => setView('prix')}>Prix de la région</button>
      </div>
      {view === 'habitants' && (
        <ul className="census">
          {pop.map(c => (
            <li key={c.id}>
              <i style={{ background: ACTIVITY_COLOR[c.activity.kind] }} />
              <div><b>{fullName(c)}</b>{c.spouseId ? ' ⚭' : ''} <span className="muted small">{c.age < 14 ? 'Enfant' : PROFESSION_NAMES[c.profession]}, {c.age} ans · {moodOf(c)}</span>
                <div className="small">{c.activity.kind === 'ambush' ? 'Absent' : c.activity.note} — <span className="muted">{c.activity.kind === 'ambush' ? '?' : state.locations[c.locationId].name}</span></div>
                <div className="small muted">Ambition : {ambitionLabel(state, c)}</div></div>
            </li>
          ))}
          {state.characterOrder.filter(id => !state.characters[id].alive && settlementIdOf(state, state.characters[id].homeId) === sid).map(id => (
            <li key={id} className="dead"><i /><div><b>{fullName(state.characters[id])}</b> <span className="muted small">† {state.characters[id].activity.note}</span></div></li>
          ))}
        </ul>
      )}
      {view === 'economie' && (
        <ul className="biz-list">
          {businessesIn(state, sid).map(b => (
            <li key={b.id}>
              <div className="rel-row-head"><b>{b.name}</b><span>{b.treasury} d</span></div>
              <div className="muted small">{b.ownerId ? (b.ownerId === p.id ? 'À toi' : fullName(state.characters[b.ownerId])) : 'Intendance'} · {b.employees.length}/{b.maxWorkers} employés · {b.wage} d/h{b.founded !== undefined ? ` · fondé le jour ${b.founded + 1}` : ''}</div>
              <div className="small">{(Object.keys(b.stock) as ItemId[]).map(i => `${ITEM_ICON[i]} ${b.stock[i]}`).join('  ') || 'Aucun stock'}</div>
            </li>
          ))}
        </ul>
      )}
      {view === 'prix' && (
        <div>
          <p className="muted small">Ce que tu sais des prix : relevés lors de ton dernier passage dans chaque localité. Les prix changent pendant ton absence.</p>
          <div className="table-scroll">
            <table className="prices">
              <thead><tr><th>Bien</th>{state.settlementOrder.map(id => <th key={id}>{state.settlements[id].name.split('-sur-')[0]}<div className="muted small">{state.priceBook[id] ? (state.priceBook[id].day === day ? "aujourd'hui" : `il y a ${day - state.priceBook[id].day} j`) : 'jamais visité'}</div></th>)}</tr></thead>
              <tbody>
                {ITEM_IDS.map((i: ItemId) => {
                  const vals = state.settlementOrder.map(id => state.priceBook[id]?.prices[i]);
                  const known = vals.filter((v): v is number => v !== undefined);
                  const lo = Math.min(...known), hi = Math.max(...known);
                  return <tr key={i}><td>{ITEM_ICON[i]} {ITEMS[i].name}</td>{vals.map((v, k) => <td key={k} className={known.length > 1 && v === lo ? 'ok' : known.length > 1 && v === hi ? 'ko' : ''}>{v ?? '—'}{v !== undefined ? ' d' : ''}</td>)}</tr>;
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Pouvoir({ state }: { state: GameState }) {
  const p = state.characters[state.playerId];
  const houses = orgList(state, 'house');
  const known = p.knownEvents.map(id => getEvent(state, id)).filter((e): e is WorldEvent => !!e);
  const gangIds = new Set(known.filter(e => (e.type === 'ambush' || e.type === 'racket' || e.type === 'vandalism' || e.type === 'recruit') && e.data?.gang).map(e => String(e.data!.gang)));
  // un brigand rencontré sur la route révèle aussi l'existence de sa bande
  for (const o of orgList(state, 'gang')) if (known.some(e => e.type === 'ambush' && e.targetId === p.id)) gangIds.add(o.id);
  const myOrgs = orgList(state).filter(o => o.members.includes(p.id));
  return (
    <div className="pouvoir">
      {myOrgs.length > 0 && <p className="goal">Ton rang : {myOrgs.map(o => `${({ seigneur: 'seigneur', heritier: 'héritier', soldat: 'soldat', vassal: 'vassal', conseiller: 'conseiller', chef: 'chef', membre: 'membre' } as Record<string, string>)[o.roles[p.id]]} de ${o.name}`).join(', ')}</p>}
      <h4>Avis de recherche</h4>
      {state.wanted.length === 0 && <p className="muted small">Personne n’est recherché.</p>}
      <ul className="rel-list">
        {state.wanted.map(w => (
          <li key={w.characterId}><div className="rel-row-head"><b className={w.characterId === p.id ? 'ko' : ''}>{w.characterId === p.id ? 'Toi' : fullName(state.characters[w.characterId])}</b><span>{w.bounty} d</span></div>
            <div className="muted small">{w.reason} · {state.orgs[w.houseId].name}</div></li>
        ))}
      </ul>
      <h4>Maisons nobles</h4>
      {houses.map(h => {
        const lord = h.leaderId ? state.characters[h.leaderId] : undefined;
        const heir = h.members.map(id => state.characters[id]).find(c => c?.alive && h.roles[c.id] === 'heritier');
        const lands = landsOf(state, h);
        return (
          <div key={h.id} className="house">
            <div className="rel-row-head"><b>{h.name}</b><span>{h.treasury} d</span></div>
            <div className="small">{lord ? `${lord.sex === 'F' ? 'Dame' : 'Sire'} ${fullName(lord)}` : 'Sans seigneur'}{heir ? ` · héritier : ${fullName(heir)}` : ''} · {soldiersOf(state, h).length} hommes d'armes</div>
            <ul className="lands">
              {lands.map(st => (
                <li key={st.id}>{st.name} — impôt {Math.round(st.taxRate * 100)} % · grogne <b className={st.unrest >= 60 ? 'ko' : ''}>{st.unrest}</b>{(st.revoltUntilDay ?? -1) >= toDate(state.time).day ? ' · en révolte' : ''}</li>
              ))}
            </ul>
            <div className="muted small">{Object.entries(h.relations).map(([id, v]) => `${state.orgs[id]?.name} : ${v > 20 ? 'amitié' : v > -20 ? 'neutralité' : v > -60 ? 'hostilité' : 'haine'} (${v})`).join(' · ')}</div>
          </div>
        );
      })}
      <h4>Guerres</h4>
      {state.wars.length === 0 && <p className="muted small">La région est en paix.</p>}
      {state.wars.map(w => (
        <p key={w.id} className="small">{w.status === 'active' ? '⚔' : '🕊'} {state.orgs[w.attackerId].name} contre {state.orgs[w.defenderId].name} pour {state.settlements[w.targetSettlementId].name} — {w.status === 'active' ? `${w.victories.attacker}–${w.victories.defender} après ${w.battles} bataille${w.battles > 1 ? 's' : ''}` : w.outcome}</p>
      ))}
      <h4>Guildes</h4>
      {orgList(state, 'guild').map(g => (
        <p key={g.id} className="small"><b>{g.name}</b> · {g.members.map(id => state.characters[id]?.firstName).filter(Boolean).join(', ')} · caisse {g.treasury} d · cotisation {g.dues} d/sem.</p>
      ))}
      <h4>Bandes</h4>
      {gangIds.size === 0 && <p className="muted small">Tu n’as entendu parler d’aucune bande organisée.</p>}
      {[...gangIds].map(id => state.orgs[id]).filter(Boolean).map(g => {
        const suspects = [...new Set(known.filter(e => e.data?.gang === g.id || e.type === 'recruit').map(e => e.actorId).filter((x): x is string => !!x && g.members.includes(x)))];
        return <p key={g.id} className="small"><b>{g.dissolved ? `${g.name} (dispersée)` : 'Une bande sévit sur les routes'}</b>{suspects.length ? ` · membres connus : ${suspects.map(x => fullName(state.characters[x])).join(', ')}` : ' · membres inconnus'}</p>;
      })}
    </div>
  );
}

function Famille({ state, onTalk }: { state: GameState; onTalk: (id: string) => void }) {
  const p = state.characters[state.playerId];
  const person = (id: string, role: string) => {
    const c = state.characters[id];
    if (!c) return null;
    const here = c.alive && c.locationId === p.locationId;
    return (
      <li key={id + role} className={c.alive ? '' : 'dead'}>
        <div className="rel-row-head">
          <button className="link" disabled={!here} onClick={() => here && onTalk(id)}>{fullName(c)}</button>
          <span className="muted small">{role}</span>
        </div>
        <div className="mini-bars">
          {c.alive ? <>
            <span>{c.age} ans</span>
            <span>{c.age < 14 ? 'Enfant' : PROFESSION_NAMES[c.profession]}</span>
            <span className={c.needs.hunger > 60 ? 'ko' : ''}>faim {Math.round(c.needs.hunger)}</span>
            <span className="muted">{state.locations[c.locationId].name}</span>
          </> : <span>† {c.activity.note}</span>}
        </div>
      </li>
    );
  };
  const suitors = Object.entries(state.characters)
    .filter(([id, c]) => id !== p.id && c.alive && (c.relations[p.id]?.romance ?? 0) > 0)
    .sort((a, b) => (b[1].relations[p.id]!.romance ?? 0) - (a[1].relations[p.id]!.romance ?? 0)).slice(0, 5);
  const siblingIds = [...new Set(p.parentIds.flatMap(pid => state.characters[pid]?.childIds ?? []))].filter(id => id !== p.id);
  return (
    <div className="famille">
      <p className="goal">Lignée {state.dynasty.name} · génération {state.dynasty.generation}{p.pregnantUntil ? ' · un enfant est attendu' : ''}</p>
      <h4>Foyer</h4>
      <ul className="rel-list">
        {p.spouseId ? person(p.spouseId, p.sex === 'F' || state.characters[p.spouseId].sex === 'M' ? 'Conjoint' : 'Conjointe') : <li className="muted small">Tu n’es pas marié. Fais ta cour à quelqu’un qui t’apprécie (onglet de dialogue).</li>}
        {p.childIds.map(id => person(id, state.characters[id]?.sex === 'F' ? 'Fille' : 'Fils'))}
      </ul>
      {p.childIds.some(id => state.characters[id]?.alive && state.characters[id].age < 14) && <p className="muted small">Tes enfants mangent ce que ton foyer leur donne : garde du pain, ou de quoi en acheter.</p>}
      {(p.parentIds.length > 0 || siblingIds.length > 0) && <h4>Parents</h4>}
      <ul className="rel-list">
        {p.parentIds.map(id => person(id, state.characters[id]?.sex === 'F' ? 'Mère' : 'Père'))}
        {siblingIds.map(id => person(id, state.characters[id]?.sex === 'F' ? 'Sœur' : 'Frère'))}
      </ul>
      {!p.spouseId && suitors.length > 0 && (<>
        <h4>Attirances</h4>
        <ul className="rel-list">
          {suitors.map(([id, c]) => <li key={id}><div className="rel-row-head"><b>{fullName(c)}</b><span>{c.relations[p.id]!.romance}/100</span></div></li>)}
        </ul>
      </>)}
      <h4>Lignée</h4>
      <ol className="journal">
        {state.dynasty.heads.map(h => {
          const c = state.characters[h.id];
          return <li key={h.id}><span className="j-time">{formatDate(h.from).split(' ').slice(1).join(' ')}{h.to !== undefined ? ` → ${formatDate(h.to).split(' ').slice(1).join(' ')}` : ' → aujourd’hui'}</span><span>{fullName(c)}{c.alive ? '' : ` († ${c.age} ans)`}</span></li>;
        })}
      </ol>
    </div>
  );
}
