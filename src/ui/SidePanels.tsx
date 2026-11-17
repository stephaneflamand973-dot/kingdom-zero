import { useState } from 'react';
import {
  WORKS, WORK_IDS, TAX_MIN, TAX_MAX, setFiefTax, buildWork, holdAudience, computeUnrest, upcomingTourney, tourneyOpen, enterTourney, tourneyName, TOURNEY_FEE,
  garrison, garrisonCap, soldierRecruits, raiseSoldier, dismissSoldier, SOLDIER_PAY,
  houseOfPlayer, HOUSE_FOUNDING, foundHouse, houseTreasury, warTargets, declareWar, challengeGangLeader, activeWar,
  gangOf, retinue, retinueCap, recruitsHere, hireManAtArms, dismissManAtArms, gangRaid, leaveGang, RETINUE_BOUNTY, RETINUE_PAY,
  designateHeir, heirOptions, tryForChild, PERKS, fighterOf, GEAR, LIFESTYLES, lifestyleOf, setLifestyle, type Lifestyle,
  acceptedQuests, openOffers, quests, QUEST_NAMES, socialRank, askRaise, careerStatus, GRADES, GRADE_NAMES, raiseChance,
  activeIncidents, INCIDENT_EFFECTS, INCIDENT_NAMES, toDate, residents, businessesIn, settlementIdOf, aliveCharacters, ATTR_NAMES, formatClock, formatDate, fullName, getEvent, getRelation, ITEMS, ITEM_ICON, ITEM_IDS,
  activeContract, activeLoans, ambitionLabel, quitJob, repayLoan, reputationTags, orgList, landsOf, soldiersOf,
  moodOf, PROFESSION_NAMES, qty, referencePrice, relationLabel, reputation, reputationLabel, SKILL_NAMES, xpForNextLevel,
  type AttrId, type GameState, type ItemId, type SkillId, type WorldEvent,
} from '../engine';
import { ACTIVITY_COLOR } from './VillageMap';
import { OwnerPanel } from './LocationPanel';
import type { Game } from './useGame';

type Tab = 'perso' | 'famille' | 'inv' | 'affaires' | 'rel' | 'journal' | 'monde' | 'pouvoir' | 'requetes';
const TABS: { id: Tab; label: string }[] = [
  { id: 'perso', label: 'Personnage' }, { id: 'famille', label: 'Famille' }, { id: 'inv', label: 'Besace' }, { id: 'affaires', label: 'Affaires' }, { id: 'rel', label: 'Relations' },
  { id: 'journal', label: 'Journal' }, { id: 'monde', label: 'Monde' }, { id: 'pouvoir', label: 'Pouvoir' }, { id: 'requetes', label: 'Requêtes' },
];

export type { Tab as SideTab };
export const SIDE_TABS = TABS.map(t => t.id);

export function SidePanels({ game, onTalk, tab, onTab }: { game: Game; onTalk: (id: string) => void; tab: Tab; onTab: (t: Tab) => void }) {
  const { state } = game;
  const setTab = onTab;
  return (
    <section className="panel side">
      <nav className="tabs" role="tablist">
        {TABS.map(t => <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>{t.label}</button>)}
      </nav>
      <div className="tab-body">
        {tab === 'perso' && <Perso state={state} game={game} />}
        {tab === 'famille' && <Famille game={game} onTalk={onTalk} />}
        {tab === 'inv' && <Inv state={state} />}
        {tab === 'affaires' && <Affaires game={game} />}
        {tab === 'rel' && <Rel state={state} onTalk={onTalk} />}
        {tab === 'journal' && <Journal state={state} />}
        {tab === 'monde' && <Monde state={state} />}
        {tab === 'pouvoir' && <Pouvoir state={state} game={game} />}
        {tab === 'requetes' && <Requetes state={state} onTalk={onTalk} />}
      </div>
    </section>
  );
}

const GOALS: Record<string, string> = {
  survivre: 'Survivre : trouver de quoi manger et un toit', trouver_emploi: 'Trouver un emploi', epargner: 'Mettre de l’argent de côté',
  prosperer: 'Faire prospérer son affaire', servir: 'Servir l’intendance',
};

function Perso({ state, game }: { state: GameState; game: Game }) {
  const p = state.characters[state.playerId];
  const fighter = fighterOf(p);
  const life = lifestyleOf(p);
  const rep = reputation(state, p.id);
  const tags = reputationTags(state, p.id);
  return (
    <div className="perso">
      <div className="perso-head">
        <div><h3>{fullName(p)}</h3><div className="muted">{p.age} ans · {PROFESSION_NAMES[p.profession]} · {moodOf(p)}</div>
          {(p.perks ?? []).length > 0 && <div className="traits">{p.perks!.map(id => { const d = PERKS.find(x => x.id === id); return <span key={id} className="trait" title={d?.description}>{d?.name}</span>; })}</div>}</div>
        <div className="rep"><div className="tb-sub">Réputation</div><strong>{reputationLabel(rep.score, rep.known)}</strong><div className="muted small">{rep.known} personne{rep.known > 1 ? 's' : ''} te connaissent</div></div>
      </div>
      <p className="goal">🎯 {GOALS[p.goal.kind]}{p.title ? ` · ${p.title === 'ecuyer' ? 'Écuyer' : 'Conseiller'}` : ''}</p>
      <div className="equip">
        <div className="equip-line"><span>⚔ {p.gear?.weapon ? `${GEAR[p.gear.weapon.id].name} (usure ${p.gear.weapon.wear}/${GEAR[p.gear.weapon.id].durability})` : 'Mains nues'}</span><span>🛡 {p.gear?.armor ? `${GEAR[p.gear.armor.id].name} (usure ${p.gear.armor.wear}/${GEAR[p.gear.armor.id].durability})` : 'Sans armure'}</span></div>
        <div className="muted small">En combat : attaque {fighter.attack.toFixed(1)} · défense {fighter.defense.toFixed(1)}. Armes et armures se font forger dans une forge.</div>
      </div>
      <div className="lifestyle">
        <label htmlFor="lifestyle"><b>Train de vie</b></label>
        <select id="lifestyle" value={life} onChange={e => game.act(s => setLifestyle(s, e.target.value as Lifestyle))} disabled={!!state.gameOver}>
          {(Object.keys(LIFESTYLES) as Lifestyle[]).map(k => <option key={k} value={k}>{LIFESTYLES[k].name} — {LIFESTYLES[k].cost} d par jour</option>)}
        </select>
        <div className="muted small">{LIFESTYLES[life].note}{life !== 'frugal' ? ` Chaque jour : vie sociale +${LIFESTYLES[life].social}, santé +${LIFESTYLES[life].health}${life === 'aise' || life === 'fastueux' ? ' ; chaque lundi, des habitants t’estiment davantage' : ''}. L’argent va aux commerçants du lieu.` : ''}</div>
      </div>
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
      <p className="muted small">Les compétences progressent par la pratique : travail, commerce, conversation, entraînement. Aucun plafond : chaque compétence peut atteindre 100 pour qui s’exerce assez (chaque lieu permet de s’exercer à son métier). Le pas grandit un peu avec le niveau.</p>
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
      {k ? (<>
        <div className="card-line">
          <div><b>{state.businesses[k.businessId].name}</b> · {k.wage} d/h<div className="muted small">{k.hoursThisWeek} h sur {k.hoursPerWeek} h exigées cette semaine · {k.goodWeeks} semaine{k.goodWeeks > 1 ? 's' : ''} satisfaisante{k.goodWeeks > 1 ? 's' : ''}{k.strikes ? ` · ${k.strikes} avertissement` : ''}</div></div>
          <button className="btn sm ghost" disabled={over} onClick={() => act(quitJob)}>Démissionner</button>
        </div>
        <Carriere game={game} />
      </>) : <p className="muted small">Aucune place. Entre en apprentissage dans un atelier (aucune expérience exigée), ou travaille à la journée puis demande une place à un patron qui te connaît.</p>}
      <h4>Logement</h4>
      {homes.length === 0 && <p className="muted small">Aucun. Une chambre se loue à l’auberge, une maison s’achète auprès de l’intendance.</p>}
      {homes.map(pr => (
        <div key={pr.id} className="card-line"><div><b>{pr.name}</b> · {state.settlements[pr.settlementId].name}<div className="muted small">{pr.ownerId === p.id ? 'Propriété' : `Loyer ${pr.weeklyRent} d, prochain dans ${Math.max(0, (pr.rentDueDay ?? day) - day)} j`} · coffre {Object.values(pr.storage).reduce((a, b) => a + (b ?? 0), 0)} objets</div></div></div>
      ))}
      <h4>Tes entreprises</h4>
      {owned.length === 0 && <p className="muted small">Aucune. Rachète une affaire en difficulté ou fonde un établissement depuis une place.</p>}
      {owned.map(b => (
        <div key={b.id} className="owned-biz">
          <div className="card-line"><div><b>{b.name}</b> · {state.settlements[settlementIdOf(state, b.locationId)].name}<div className="muted small">Caisse {b.treasury} d · {b.employees.length} ouvrier{b.employees.length > 1 ? 's' : ''} à {b.wage} d/h · stock {(Object.keys(b.stock) as ItemId[]).map(i => `${ITEM_ICON[i]} ${b.stock[i]}`).join(' ') || 'vide'}</div></div></div>
          <OwnerPanel game={game} b={b} />
        </div>
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
      {activeIncidents(state, sid).map(i => (
        <p key={i.id} className={`incident-chip ${i.kind}`}><b>{INCIDENT_NAMES[i.kind]}</b> — {INCIDENT_EFFECTS[i.kind]}{i.toDay > day ? ` · encore ${i.toDay - day} j` : ''}</p>
      ))}
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

/** Garnison de la maison du joueur : lever et renvoyer des soldats. */
function Garrison({ state, game }: { state: GameState; game: Game }) {
  const { act } = game;
  const house = houseOfPlayer(state)!;
  const p = state.characters[state.playerId];
  const over = !!state.gameOver;
  const soldiers = garrison(state, house);
  const guards = soldiersOf(state, house).filter(c => !c.isPlayer && c.profession !== 'soldat');
  const cap = garrisonCap(state, house);
  const cands = soldierRecruits(state).sort((a, b) => b.skills.combat - a.skills.combat);
  const here = state.settlements[settlementIdOf(state, p.locationId)];
  const affordable = house.treasury >= RETINUE_BOUNTY + SOLDIER_PAY;
  return (
    <div className="house">
      <div className="rel-row-head"><b>Garnison ({soldiers.length}/{cap})</b><span className="muted small">solde : {soldiers.length * SOLDIER_PAY} d chaque lundi, sur le trésor</span></div>
      <p className="muted small">Lève tes soldats parmi les adultes valides de la localité où tu te trouves (sans emploi, ou prêts à quitter leur place) : {RETINUE_BOUNTY} d de prime, puis {SOLDIER_PAY} d par semaine, payés par le trésor de la maison. Ils gardent tes terres, patrouillent contre les brigands et combattent dans tes guerres. Chaque terre tenue permet deux soldats de plus (12 au plus). Sans solde, ils désertent. Un travailleur qui ne t’est pas hostile peut quitter sa place pour te servir.</p>
      {guards.length > 0 && <p className="muted small">Gardes de l’intendance à ton service (payés par l’intendance) : {guards.map(c => fullName(c)).join(', ')}.</p>}
      <ul className="rel-list">
        {soldiers.map(c => (
          <li key={c.id}><div className="rel-row-head"><b>{fullName(c)}</b><span className="muted small">santé {Math.round(c.health)} · combat {c.skills.combat}{c.gear?.weapon ? ` · ${GEAR[c.gear.weapon.id].name}` : ''}{c.gear?.armor ? ` · ${GEAR[c.gear.armor.id].name}` : ''}</span>
            <button className="btn sm ghost" disabled={over} onClick={() => act(s => dismissSoldier(s, c.id))}>Renvoyer</button></div></li>
        ))}
      </ul>
      {soldiers.length < cap && (cands.length === 0
        ? <p className="small">Personne n’est disponible à {here.name} : les adultes valides y servent déjà, sont trop jeunes, malades, ou te sont hostiles. Essaie une autre localité, gagne l’estime des gens (audience, conversations, cadeaux), ou reviens après un lundi.</p>
        : <>
          <p className="small">Disponibles à {here.name}{affordable ? '' : ` — le trésor (${house.treasury} d) ne suffit pas : verse-lui de l’argent`} :</p>
          <ul className="rel-list">
            {cands.slice(0, 6).map(c => (
              <li key={c.id}><div className="rel-row-head"><b>{fullName(c)}</b><span className="muted small">{c.age} ans · combat {c.skills.combat} · force {c.attributes.force}{c.employerId ? ` · quittera ${state.businesses[c.employerId]?.name}` : ''}</span>
                <button className="btn sm" disabled={over || !affordable} onClick={() => act(s => raiseSoldier(s, c.id))}>Lever ({RETINUE_BOUNTY} d)</button></div></li>
            ))}
          </ul>
        </>)}
    </div>
  );
}

/** Gouverner une terre de sa maison (phase 12). */
function Fief({ state, game, sid }: { state: GameState; game: Game; sid: string }) {
  const { act } = game;
  const st = state.settlements[sid];
  const p = state.characters[state.playerId];
  const here = settlementIdOf(state, p.locationId) === sid;
  const atManor = state.businesses[st.manorId]?.locationId === p.locationId;
  const house = houseOfPlayer(state)!;
  const day = toDate(state.time).day;
  const over = !!state.gameOver;
  const pct = Math.round(st.taxRate * 100);
  const audienceIn = st.audienceDay !== undefined ? 7 - (day - st.audienceDay) : 0;
  return (
    <div className="house">
      <div className="rel-row-head"><b>Fief : {st.name}</b><span className="muted small">grogne {st.unrest} (estimée {computeUnrest(state, st)}) · prospérité {st.prosperity}</span></div>
      <div className="save-row">
        <span className="small">Impôt {pct} %</span>
        <button className="btn sm ghost" disabled={over || st.taxRate <= TAX_MIN} onClick={() => act(s => setFiefTax(s, sid, st.taxRate - 0.01))} aria-label={`Baisser l'impôt de ${st.name}`}>−1 %</button>
        <button className="btn sm ghost" disabled={over || st.taxRate >= TAX_MAX} onClick={() => act(s => setFiefTax(s, sid, st.taxRate + 0.01))} aria-label={`Relever l'impôt de ${st.name}`}>+1 %</button>
        <button className="btn sm" disabled={over || !atManor || audienceIn > 0} title={atManor ? 'Arbitrer la pire querelle, faire l’aumône aux plus pauvres (sur le trésor) ; la grogne s’apaise deux semaines' : `Rends-toi à l’intendance de ${st.name}`} onClick={() => act(holdAudience)}>
          Tenir audience (2 h){audienceIn > 0 ? ` · dans ${audienceIn} j` : ''}</button>
      </div>
      <p className="muted small">L’impôt prélève chaque lundi une part de la caisse des ateliers ; l’intendance reverse 40 % à ta maison, et un tribut sur ses réserves. Chaque point d’impôt ajoute environ 2,5 points de grogne.</p>
      <ul className="rel-list">
        {WORK_IDS.map(id => {
          const w = WORKS[id];
          const built = st.works?.find(x => x.id === id);
          return (
            <li key={id}><div className="rel-row-head"><b>{w.name}</b>
              {built ? <span className="small">{built.ready <= day ? 'achevé' : `chantier : prêt dans ${built.ready - day} j`}</span>
                : <button className="btn sm" disabled={over || !here || house.treasury < w.cost} title={here ? w.effect : `Rends-toi à ${st.name} pour lancer le chantier`} onClick={() => act(s => buildWork(s, id))}>Bâtir ({w.cost} d)</button>}
            </div><div className="muted small">{w.effect} · {w.days} jours de chantier</div></li>
          );
        })}
      </ul>
    </div>
  );
}

/** Tournois de saison annoncés (phase 12). */
function Tourneys({ state, game }: { state: GameState; game: Game }) {
  const p = state.characters[state.playerId];
  const day = toDate(state.time).day;
  const list = (state.tourneys ?? []).filter(t => t.status !== 'done').sort((a, b) => a.day - b.day);
  const last = (state.tourneys ?? []).filter(t => t.status === 'done' && t.championId).sort((a, b) => b.day - a.day)[0];
  if (!list.length && !last) return null;
  const here = upcomingTourney(state, settlementIdOf(state, p.locationId));
  return (<>
    <h4>Tournois</h4>
    <ul className="rel-list">
      {list.map(t => (
        <li key={t.id}><div className="rel-row-head"><b>{tourneyName(state, t)}</b><span className="small">{t.day === day ? 'aujourd’hui, 8 h – 13 h' : `dans ${t.day - day} j`}</span></div>
          <div className="muted small">Prix : {t.purse} d plus les droits ({t.fee} d par concurrent) · duels courtois : le premier qui encaisse 25 points perd l’assaut. Un champion sans titre est armé écuyer.</div></li>
      ))}
    </ul>
    {here && tourneyOpen(state, here) && <button className="btn" disabled={!!state.gameOver || p.money < TOURNEY_FEE} onClick={() => game.act(enterTourney)}>Entrer en lice ({TOURNEY_FEE} d)</button>}
    {last && <p className="muted small">Dernier champion : {last.championId === p.id ? 'toi' : fullName(state.characters[last.championId!])} ({tourneyName(state, last)}).</p>}
  </>);
}

function Pouvoir({ state, game }: { state: GameState; game: Game }) {
  const p = state.characters[state.playerId];
  const { act } = game;
  const myGang = gangOf(state);
  const men = retinue(state);
  const recruits = recruitsHere(state);
  const over = !!state.gameOver;
  const houses = orgList(state, 'house');
  const known = p.knownEvents.map(id => getEvent(state, id)).filter((e): e is WorldEvent => !!e);
  const gangIds = new Set(known.filter(e => (e.type === 'ambush' || e.type === 'racket' || e.type === 'vandalism' || e.type === 'recruit') && e.data?.gang).map(e => String(e.data!.gang)));
  // un brigand rencontré sur la route révèle aussi l'existence de sa bande
  for (const o of orgList(state, 'gang')) if (known.some(e => e.type === 'ambush' && e.targetId === p.id)) gangIds.add(o.id);
  const myOrgs = orgList(state).filter(o => o.members.includes(p.id));
  return (
    <div className="pouvoir">
      {myOrgs.length > 0 && <p className="goal">Ton rang : {myOrgs.map(o => `${({ seigneur: 'seigneur', heritier: 'héritier', soldat: 'soldat', vassal: 'vassal', conseiller: 'conseiller', chef: 'chef', membre: 'membre' } as Record<string, string>)[o.roles[p.id]]} de ${o.name}`).join(', ')}</p>}
      <h4>Tes hommes d’armes ({men.length}/{retinueCap(p, state)})</h4>
      {men.length === 0 && <p className="muted small">{houseOfPlayer(state) ? 'Ton escorte personnelle, payée de ta bourse (les soldats de ta maison se lèvent plus bas, dans « Garnison »). ' : ''}Aucun. Engage un adulte sans emploi présent au même endroit que toi : {RETINUE_BOUNTY} d de prime, puis {RETINUE_PAY} d par jour. Tes hommes te suivent, se battent à tes côtés et dissuadent les brigands. Un écuyer en mène quatre, un conseiller six.</p>}
      {men.length > 0 && <p className="muted small">Solde : {men.length * RETINUE_PAY} d par jour. Sans solde, ils s’en vont. En embuscade, ceux qui sont près de toi combattent avec toi.</p>}
      <ul className="rel-list">
        {men.map(c => (
          <li key={c.id}><div className="rel-row-head"><b>{fullName(c)}</b><span className="muted small">santé {Math.round(c.health)} · combat {c.skills.combat} · {state.locations[c.locationId]?.name}</span>
            <button className="btn sm ghost" disabled={over} onClick={() => act(s => dismissManAtArms(s, c.id))}>Congédier</button></div></li>
        ))}
      </ul>
      {recruits.length > 0 && men.length < retinueCap(p, state) && (<>
        <p className="small">Prêts à s’engager, ici :</p>
        <ul className="rel-list">
          {recruits.slice(0, 5).map(c => (
            <li key={c.id}><div className="rel-row-head"><b>{fullName(c)}</b><span className="muted small">{c.age} ans · combat {c.skills.combat}</span>
              <button className="btn sm" disabled={over || p.money < RETINUE_BOUNTY + RETINUE_PAY} onClick={() => act(s => hireManAtArms(s, c.id))}>Engager ({RETINUE_BOUNTY} d)</button></div></li>
          ))}
        </ul>
      </>)}
      {(() => {
        const mine = houseOfPlayer(state);
        if (!mine) return p.title ? (<>
          <h4>Ta maison</h4>
          <p className="muted small">Ton titre te permet de lever bannière : {HOUSE_FOUNDING} d pour doter son trésor. Tes hommes d’armes en deviennent les soldats (soldés chaque semaine par la maison), ton conjoint et ton héritier en sont membres. Sans terre, il faudra conquérir un fief.</p>
          <button className="btn sm" disabled={over || p.money < HOUSE_FOUNDING} onClick={() => act(foundHouse)}>Fonder ta maison ({HOUSE_FOUNDING} d)</button>
        </>) : null;
        const lands = landsOf(state, mine);
        const targets = warTargets(state);
        const war = activeWar(state, mine.id);
        return (<>
          <h4>{mine.name}</h4>
          <p className="muted small">Trésor {mine.treasury} d · {soldiersOf(state, mine).length} soldat{soldiersOf(state, mine).length > 1 ? 's' : ''} · terres : {lands.length ? lands.map(l => l.name).join(', ') : 'aucune (pas de tribut)'}{war ? ` · en guerre pour ${state.settlements[war.targetSettlementId].name} (${war.victories.attacker}–${war.victories.defender})` : ''}</p>
          <div className="save-row">
            <button className="btn sm ghost" disabled={over || p.money < 1} onClick={() => act(s => houseTreasury(s, 50))}>Verser 50 d</button>
            <button className="btn sm ghost" disabled={over || mine.treasury < 1} onClick={() => act(s => houseTreasury(s, -50))}>Prendre 50 d</button>
          </div>
          <Garrison state={state} game={game} />
          {lands.map(st => <Fief key={st.id} state={state} game={game} sid={st.id} />)}
          {!war && targets.length > 0 && <div className="save-row">{targets.map(id => (
            <button key={id} className="btn sm danger" disabled={over || !!activeWar(state)} title={`Contre ${state.orgs[state.settlements[id].lordHouseId]?.name}`} onClick={() => act(s => declareWar(s, id))}>Revendiquer {state.settlements[id].name}</button>
          ))}</div>}
          <p className="muted small">Une bataille chaque lundi ; deux victoires prennent la place. Toi, tes soldats et tes hommes d’armes y combattez. Conquise, une terre paie tribut à ta maison — et son ancienne maison voudra la reprendre.</p>
        </>);
      })()}
      <Tourneys state={state} game={game} />
      {myGang && (<>
        <h4>Ta bande : {myGang.name}{myGang.leaderId === p.id ? ' — tu la mènes' : ''}</h4>
        <p className="muted small">{myGang.members.length} membres · trésor {myGang.treasury} d · recherchée {myGang.heat >= 70 ? 'activement' : myGang.heat >= 30 ? 'un peu' : 'à peine'}. Ta part du butin tombe chaque lundi. Repaire : {state.settlements[myGang.seatId]?.name}.</p>
        <div className="save-row">
          <button className="btn sm danger" disabled={over} onClick={() => act(gangRaid)} title="6 h · si une caravane passe sur une route voisine du repaire, la bande l’attaque">Guetter la route (6 h)</button>
          {myGang.leaderId !== p.id && <button className="btn sm" disabled={over} onClick={() => act(challengeGangLeader)} title="Duel contre le chef, là où il se trouve : vainqueur, tu prends la tête (double part, racket sur ton ordre)">Défier le chef{myGang.leaderId ? ` (${state.characters[myGang.leaderId]?.firstName})` : ''}</button>}
          <button className="btn sm ghost" disabled={over} onClick={() => act(leaveGang)}>Quitter la bande</button>
        </div>
      </>)}
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

function Famille({ game, onTalk }: { game: Game; onTalk: (id: string) => void }) {
  const { state, act } = game;
  const p = state.characters[state.playerId];
  const spouseC = p.spouseId ? state.characters[p.spouseId] : undefined;
  const expecting = p.pregnantUntil !== undefined ? p : spouseC?.pregnantUntil !== undefined ? spouseC : undefined;
  const today = toDate(state.time).day;
  const options = heirOptions(state);
  const willed = state.dynasty.designatedHeir ? state.characters[state.dynasty.designatedHeir] : undefined;
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
      <p className="goal">Lignée {state.dynasty.name} · génération {state.dynasty.generation}{expecting ? ` · un enfant est attendu dans ${Math.max(0, expecting.pregnantUntil! - today)} jours` : ''}</p>
      {spouseC?.alive && spouseC.sex !== p.sex && (
        <div className="card-line">
          <div><b>Agrandir la famille</b><div className="muted small">{expecting ? `${expecting.isPlayer ? 'Tu attends' : `${expecting.firstName} attend`} un enfant.` : 'Le soir, au foyer, avec ton conjoint présent, le ventre plein. Une chance sur trois chaque soir.'}</div></div>
          <button className="btn sm" disabled={!!state.gameOver || !!expecting} onClick={() => act(tryForChild)}>Avoir un enfant</button>
        </div>
      )}
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
      <h4>Testament</h4>
      <p className="muted small">{willed?.alive ? <>Ton héritier désigné : <b>{fullName(willed)}</b>. Il reçoit tes biens et tes affaires, et sera le premier à pouvoir reprendre ta lignée{willed.age < 14 ? ' une fois majeur' : ''}.</> : 'Aucun testament : la coutume désigne l’héritier (enfants adultes, conjoint, enfants mineurs, puis parents).'}</p>
      {options.length > 0 && (
        <div className="testament">
          <select aria-label="Héritier désigné" value={willed?.alive ? willed.id : ''} onChange={e => act(s => designateHeir(s, e.target.value || undefined))} disabled={!!state.gameOver}>
            <option value="">— selon la coutume —</option>
            {options.map(c => <option key={c.id} value={c.id}>{fullName(c)} ({c.age} ans{c.id === p.spouseId ? ', conjoint' : p.childIds.includes(c.id) ? ', enfant' : ''})</option>)}
          </select>
        </div>
      )}
      <h4>Chronique de la lignée</h4>
      {(state.chronicle ?? []).length === 0
        ? <p className="muted small">Rien encore n’est digne d’être consigné. Les grands moments de ta vie (rangs, promesses tenues ou trahies, noces, naissances, titres) s’inscriront ici.</p>
        : <ol className="journal chronicle">
          {(state.chronicle ?? []).slice().reverse().slice(0, 40).map((e, i) => (
            <li key={i}><span className="j-time">{formatDate(e.time).split(' ').slice(1).join(' ')} · gén. {e.generation}</span><span>{e.text}</span></li>
          ))}
        </ol>}
    </div>
  );
}

function Requetes({ state, onTalk }: { state: GameState; onTalk: (id: string) => void }) {
  const p = state.characters[state.playerId];
  const rank = socialRank(state);
  const day = toDate(state.time).day;
  const where = (id: string) => { const c = state.characters[id]; return c ? state.locations[c.locationId]?.name ?? '?' : '?'; };
  const who = (id: string) => {
    const c = state.characters[id];
    const here = c?.alive && c.locationId === p.locationId;
    return <button className="link" disabled={!here} onClick={() => here && onTalk(id)} title={here ? 'Lui parler' : `Se trouve à ${where(id)}`}>{c ? fullName(c) : '?'}</button>;
  };
  const left = (d: number) => d - day <= 0 ? 'dernier jour' : `${d - day} j restants`;
  const accepted = acceptedQuests(state);
  const offers = openOffers(state);
  const done = quests(state).filter(q => q.status === 'reussie' || q.status === 'echouee').slice(-6).reverse();
  return (
    <div className="requetes">
      <div className="rank-box">
        <div className="rank-name">{rank.name}</div>
        <div className="rank-steps" aria-label={`Rang ${rank.level + 1} sur 7`}>{Array.from({ length: 7 }, (_, i) => <i key={i} className={i <= rank.level ? 'on' : ''} />)}</div>
        {rank.next && <p className="small">Pour devenir <b>{rank.next.name.toLowerCase()}</b> : {rank.next.needs.join(' ; ')}.</p>}
        <p className="muted small">Promesses tenues : {state.questsKept ?? 0} · non tenues : {(state.chronicle ?? []).filter(c => c.text.includes('manque à sa parole')).length}</p>
      </div>
      <h4>Engagements ({accepted.length}/3)</h4>
      {accepted.length === 0 ? <p className="muted small">Aucune promesse en cours. Les habitants qui ont besoin de toi sont listés ci-dessous : va leur parler.</p> : (
        <ul className="quest-list">
          {accepted.map(q => (
            <li key={q.id} className="quest accepted">
              <div className="quest-head"><span className={`quest-kind ${q.kind}`}>{QUEST_NAMES[q.kind]}</span><span className="muted small">{left(q.deadlineDay)}</span></div>
              <div className="small">{q.text}</div>
              <div className="muted small">Pour {who(q.giverId)} ({where(q.giverId)}){q.targetId && <> · auprès de {who(q.targetId)} ({where(q.targetId)})</>}</div>
            </li>
          ))}
        </ul>
      )}
      <h4>Ils ont besoin de toi</h4>
      {offers.length === 0 ? <p className="muted small">Personne ne t’a rien demandé pour l’instant. Les requêtes naissent des besoins réels des habitants : pénuries, brouilles, rancunes, enfants affamés.</p> : (
        <ul className="quest-list">
          {offers.map(q => (
            <li key={q.id} className="quest">
              <div className="quest-head"><span className={`quest-kind ${q.kind}`}>{QUEST_NAMES[q.kind]}</span><span className="muted small">offre valable {left(q.deadlineDay)}</span></div>
              <div className="small">{q.text}</div>
              <div className="muted small">Parler à {who(q.giverId)} — {where(q.giverId)}</div>
            </li>
          ))}
        </ul>
      )}
      {done.length > 0 && <><h4>Récemment</h4><ul className="quest-list">{done.map(q => <li key={q.id} className={`quest ${q.status}`}><span className={`quest-kind ${q.kind}`}>{QUEST_NAMES[q.kind]}</span> <span className="small">{q.status === 'reussie' ? 'Parole tenue' : 'Parole non tenue'} — {state.characters[q.giverId] ? fullName(state.characters[q.giverId]) : ''}</span></li>)}</ul></>}
    </div>
  );
}

function Carriere({ game }: { game: Game }) {
  const { state, act } = game;
  const c = careerStatus(state);
  if (!c) return null;
  const idx = GRADES.indexOf(c.grade);
  const pct = Math.min(100, Math.round(c.xp / c.xpNeeded * 100));
  const chance = Math.round(raiseChance(state, c.contract) * 100);
  return (
    <div className="career">
      <ol className="grades" aria-label={`Grade : ${GRADE_NAMES[c.grade]}`}>
        {GRADES.map((g, i) => <li key={g} className={i < idx ? 'past' : i === idx ? 'now' : ''}>{GRADE_NAMES[g]}</li>)}
      </ol>
      <div className="skill" title={`${Math.round(c.xp)} / ${Math.round(c.xpNeeded)} avant le prochain point`}>
        <span>{SKILL_NAMES[c.skill]}</span>
        <div className="gauge-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><div className="gauge-fill" style={{ width: `${pct}%`, background: 'linear-gradient(90deg,#b8862f,#e3a83b)' }} /></div>
        <b>{c.level}</b>
      </div>
      <p className="muted small">{c.rate > 1 ? `Tu apprends ${c.rate.toLocaleString('fr-FR')} fois plus vite ici${c.grade === 'apprenti' ? ' (apprentissage)' : ' (ton patron en sait plus que toi)'}.` : 'Tu n’apprends plus rien de ton patron : seule la pratique te fait progresser.'}</p>
      {c.next ? (
        <div className="next-grade">
          <b>Pour passer {GRADE_NAMES[c.next.grade].toLowerCase()}</b> <span className="muted small">({c.next.wage} d/h)</span>
          <ul>{c.next.needs.map(n => <li key={n.label} className={n.ok ? 'ok' : ''}>{n.ok ? '✔' : '○'} {n.label}</li>)}</ul>
          <p className="muted small">La promotion est décidée à la revue du lundi, après une semaine où tu as fait tes heures.</p>
        </div>
      ) : <p className="small">Tu es au sommet de l’atelier : prime sur les bénéfices chaque lundi, et l’affaire te revient si le patron meurt sans héritier.</p>}
      {c.grade !== 'apprenti' && (
        <button className="btn sm" disabled={!!state.gameOver || c.raiseInDays > 0} onClick={() => act(askRaise)}
          title="Dépend de la confiance du patron, de ton ancienneté, de ta diplomatie et de la santé de la caisse">
          Demander une augmentation <small>{c.raiseInDays > 0 ? `dans ${c.raiseInDays} j` : `≈ ${chance} % · en personne`}</small>
        </button>
      )}
    </div>
  );
}
