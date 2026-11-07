import { useState } from 'react';
import {
  court, kin, proposeMarriage, houseLedBy, petition, orgsOf, wantedFor, type PetitionKind,
  activeLoans, ambitionLabel, askLoan, businessInTrouble, canTalk, employerOf, fullName, getRelation, greeting, lendMoney, loanTerms,
  moodOf, ownedBusinesses, PROFESSION_NAMES, qty, relationLabel, talk, TRAIT_NAMES, type TalkKind,
} from '../engine';
import { Crest } from './icons';
import type { Game } from './useGame';

const TALKS: { kind: TalkKind; label: string; hint: string }[] = [
  { kind: 'chat', label: 'Bavarder', hint: '20 min · Charisme, Diplomatie' },
  { kind: 'news', label: 'Demander les nouvelles', hint: '15 min · rumeurs connues' },
  { kind: 'compliment', label: 'Complimenter', hint: '5 min' },
  { kind: 'gift_bread', label: 'Offrir du pain', hint: '1 miche' },
  { kind: 'gift_coins', label: 'Donner 10 d', hint: '10 deniers' },
  { kind: 'ask_help', label: 'Demander de l’aide', hint: 'mendier un repas' },
  { kind: 'insult', label: 'Insulter', hint: 'conséquences durables' },
];

function Bar({ v, label }: { v: number; label: string }) {
  const pct = (v + 100) / 2;
  return (
    <div className="relbar" title={`${label} ${v}`}>
      <span>{label}</span>
      <div className="relbar-track"><div className="relbar-mid" /><div className={`relbar-fill ${v >= 0 ? 'pos' : 'neg'}`} style={v >= 0 ? { left: '50%', width: `${pct - 50}%` } : { left: `${pct}%`, width: `${50 - pct}%` }} /></div>
      <b>{v > 0 ? `+${v}` : v}</b>
    </div>
  );
}

export function NpcDialog({ game, npcId, onClose }: { game: Game; npcId: string; onClose: () => void }) {
  const { state, act } = game;
  const [last, setLast] = useState<string | null>(null);
  const n = state.characters[npcId];
  const p = state.characters[state.playerId];
  const r = getRelation(state, npcId, p.id);
  const err = canTalk(state, npcId);
  const job = employerOf(state, n);
  const owned = ownedBusinesses(state, n);
  const iOwe = activeLoans(state, { borrowerId: p.id, lenderId: n.id }).reduce((s, l) => s + l.remaining, 0);
  const theyOwe = activeLoans(state, { borrowerId: n.id, lenderId: p.id }).reduce((s, l) => s + l.remaining, 0);
  const needsMoney = n.money < 30 || owned.some(b => businessInTrouble(b));
  const run = (fn: Parameters<typeof act>[0]) => { const res = act(fn); setLast(res.message); };
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal dialog" onClick={e => e.stopPropagation()} role="dialog" aria-label={`Parler avec ${fullName(n)}`}>
        <button className="close" onClick={onClose} aria-label="Fermer">×</button>
        <div className="dialog-head">
          <Crest id={n.id} initials={n.firstName[0] + n.lastName[0]} size={58} />
          <div>
            <h2>{fullName(n)}</h2>
            <div className="muted">{PROFESSION_NAMES[n.profession]}{owned.length ? ` · propriétaire de ${owned.map(b => b.name).join(', ')}` : job ? ` · ${job.name}` : ''} · {n.age} ans</div>
            <div className="traits">{n.traits.map(t => <span key={t} className="trait">{TRAIT_NAMES[t]}</span>)}<span className="trait mood">{moodOf(n)}</span></div>
          </div>
        </div>
        <p className="greeting">« {greeting(state, n)} »</p>
        <div className="rel-box">
          <div className="rel-title">Ce que {n.firstName} pense de toi : <strong>{relationLabel(r)}</strong></div>
          <Bar v={r.affinity} label="Affinité" />
          <Bar v={r.trust} label="Confiance" />
          {(iOwe > 0 || theyOwe > 0) && <div className="debt-line">{iOwe > 0 && <span>Tu lui dois <b>{iOwe} d</b></span>}{theyOwe > 0 && <span>{n.firstName} te doit <b>{theyOwe} d</b></span>}</div>}
        </div>
        <p className="muted small">Activité : {n.activity.note} · Ambition : {ambitionLabel(state, n)}</p>
        {last && <p className="dialog-result">{last}</p>}
        {err ? <p className="warn">{err}</p> : (
          <>
            <div className="talk-grid">
              {TALKS.map(t => {
                const disabled = !!state.gameOver || (t.kind === 'gift_bread' && qty(p.inventory, 'bread') < 1) || (t.kind === 'gift_coins' && p.money < 10);
                return (
                  <button key={t.kind} className={`btn ${t.kind === 'insult' ? 'danger' : ''}`} disabled={disabled}
                    onClick={() => run(s => talk(s, npcId, t.kind))}>
                    {t.label}<small>{t.hint}</small>
                  </button>
                );
              })}
            </div>
            {houseLedBy(state, n.id) && <LordRequests game={game} lordId={n.id} run={run} />}
            {n.age >= 16 && p.age >= 16 && !kin(state, p, n) && (
              <>
                <h3 className="dialog-sub">Cœur {n.spouseId ? `— ${n.spouseId === p.id ? 'ton conjoint' : `marié${n.sex === 'F' ? 'e' : ''} à ${state.characters[n.spouseId].firstName}`}` : ''}</h3>
                {n.spouseId !== p.id && <Bar v={Math.round((r.romance ?? 0) * 2 - 100)} label="Attirance" />}
                <div className="talk-grid">
                  <button className="btn ghost" disabled={!!state.gameOver || !!p.spouseId || !!n.spouseId} onClick={() => run(s => court(s, npcId))}>Faire la cour<small>30 min · Charisme</small></button>
                  <button className="btn ghost" disabled={!!state.gameOver || !!p.spouseId || !!n.spouseId} onClick={() => run(s => proposeMarriage(s, npcId))}>Demander en mariage<small>attirance 70, affinité 50</small></button>
                </div>
              </>
            )}
            <h3 className="dialog-sub">Argent</h3>
            <div className="talk-grid">
              {[20, 50, 100].map(amount => {
                const t = loanTerms(state, n, p, amount);
                return (
                  <button key={amount} className="btn ghost" disabled={!!state.gameOver} onClick={() => run(s => askLoan(s, npcId, amount))}
                    title={t.ok ? '' : t.reason}>
                    Emprunter {amount} d
                    <small>{t.ok ? `${t.totalDue} d en ${t.weeks} sem. (${Math.round(t.weeklyRate * 100)} %)` : 'refus probable'}</small>
                  </button>
                );
              })}
              <button className="btn ghost" disabled={!!state.gameOver || p.money < 20 || !needsMoney} onClick={() => run(s => lendMoney(s, npcId, 20))}
                title={needsMoney ? '' : `${n.firstName} n'a pas besoin d'argent`}>
                Prêter 20 d<small>{needsMoney ? '24 d rendus en 4 sem.' : 'pas dans le besoin'}</small>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function LordRequests({ game, lordId, run }: { game: Game; lordId: string; run: (fn: Parameters<Game['act']>[0]) => void }) {
  const { state } = game;
  const p = state.characters[state.playerId];
  const house = houseLedBy(state, lordId)!;
  const soldier = orgsOf(state, p.id, 'house').some(h => h.roles[p.id] === 'soldat');
  const reqs: { k: PetitionKind; label: string; hint: string; show: boolean }[] = [
    { k: 'ecuyer', label: 'Demander à être fait écuyer', hint: 'combat 25 et son estime, ou 200 d', show: !p.title },
    { k: 'conseiller', label: 'Demander une charge de conseiller', hint: 'écuyer, affinité 35, confiance 30', show: p.title === 'ecuyer' },
    { k: 'enlist', label: 'S’engager dans la garnison', hint: '40 d/sem. pour 12 h de patrouille', show: !soldier },
    { k: 'denounce', label: 'Dénoncer les crimes connus', hint: 'avis de recherche', show: true },
    { k: 'lower_tax', label: 'Conseiller de baisser l’impôt', hint: 'ici', show: p.title === 'conseiller' },
    { k: 'raise_tax', label: 'Conseiller de relever l’impôt', hint: 'ici', show: p.title === 'conseiller' },
    { k: 'peace', label: 'Conseiller la paix', hint: 'en temps de guerre', show: p.title === 'conseiller' },
  ];
  return (
    <>
      <h3 className="dialog-sub">Requêtes à {house.name}{wantedFor(state, p.id) ? ' — tu es recherché' : ''}</h3>
      <div className="talk-grid">
        {reqs.filter(r => r.show).map(r => (
          <button key={r.k} className="btn ghost" disabled={!!state.gameOver} onClick={() => run(s => petition(s, lordId, r.k))}>{r.label}<small>{r.hint}</small></button>
        ))}
      </div>
    </>
  );
}
