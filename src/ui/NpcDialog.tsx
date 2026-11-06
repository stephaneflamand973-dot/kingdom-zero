import { useState } from 'react';
import {
  canTalk, employerOf, fullName, getRelation, greeting, moodOf, ownedBusiness, PROFESSION_NAMES, qty, relationLabel,
  talk, TRAIT_NAMES, type TalkKind,
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
  const owned = ownedBusiness(state, n);
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal dialog" onClick={e => e.stopPropagation()} role="dialog" aria-label={`Parler avec ${fullName(n)}`}>
        <button className="close" onClick={onClose} aria-label="Fermer">×</button>
        <div className="dialog-head">
          <Crest id={n.id} initials={n.firstName[0] + n.lastName[0]} size={58} />
          <div>
            <h2>{fullName(n)}</h2>
            <div className="muted">{PROFESSION_NAMES[n.profession]}{owned ? ` · propriétaire de ${owned.name}` : job ? ` · ${job.name}` : ''} · {n.age} ans</div>
            <div className="traits">{n.traits.map(t => <span key={t} className="trait">{TRAIT_NAMES[t]}</span>)}<span className="trait mood">{moodOf(n)}</span></div>
          </div>
        </div>
        <p className="greeting">« {greeting(state, n)} »</p>
        <div className="rel-box">
          <div className="rel-title">Ce que {n.firstName} pense de toi : <strong>{relationLabel(r)}</strong></div>
          <Bar v={r.affinity} label="Affinité" />
          <Bar v={r.trust} label="Confiance" />
        </div>
        <p className="muted small">Activité : {n.activity.note}</p>
        {last && <p className="dialog-result">{last}</p>}
        {err ? <p className="warn">{err}</p> : (
          <div className="talk-grid">
            {TALKS.map(t => {
              const disabled = !!state.gameOver || (t.kind === 'gift_bread' && qty(p.inventory, 'bread') < 1) || (t.kind === 'gift_coins' && p.money < 10);
              return (
                <button key={t.kind} className={`btn ${t.kind === 'insult' ? 'danger' : ''}`} disabled={disabled}
                  onClick={() => { const res = act(s => talk(s, npcId, t.kind)); setLast(res.message); }}>
                  {t.label}<small>{t.hint}</small>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
