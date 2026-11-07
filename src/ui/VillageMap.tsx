// Cartes : la localité courante (parchemin, lieux cliquables) et la région (routes, caravanes).
import { useState } from 'react';
import {
  aliveCharacters, formatDuration, fullName, prosperityLabel, roadPath, settlementIdOf, toDate, travelMinutes,
  type ActivityKind, type GameState, type Location,
} from '../engine';
import { LocationGlyph } from './icons';

export const ACTIVITY_COLOR: Record<ActivityKind, string> = {
  work: '#e3a83b', sleep: '#5b7bb3', socialize: '#b57ad1', shop: '#6fbf73', idle: '#a59b86', seekJob: '#e07a5f',
  patrol: '#e3a83b', travel: '#d9d2b8', talk: '#b57ad1', train: '#e07a5f', forage: '#8fae5d', manage: '#e3a83b', dead: '#444', eat: '#6fbf73', jailed: '#555', ambush: '#a8322d',
};

function nightOpacity(hour: number, minute: number): number {
  const t = hour + minute / 60;
  if (t >= 22 || t < 5) return 0.55;
  if (t >= 5 && t < 7) return 0.55 * (1 - (t - 5) / 2);
  if (t >= 19 && t < 22) return 0.55 * ((t - 19) / 3);
  return 0;
}

/** Chemins : chaque lieu rejoint la place, plus son voisin le plus proche. */
function localRoads(locs: Location[], squareId: string): [Location, Location][] {
  const sq = locs.find(l => l.id === squareId)!;
  const out: [Location, Location][] = [];
  const seen = new Set<string>();
  for (const l of locs) {
    if (l.id === squareId) continue;
    out.push([sq, l]);
    const near = locs.filter(o => o.id !== l.id && o.id !== squareId)
      .sort((a, b) => Math.hypot(a.x - l.x, a.y - l.y) - Math.hypot(b.x - l.x, b.y - l.y))[0];
    if (near) {
      const key = [l.id, near.id].sort().join('|');
      if (!seen.has(key) && Math.hypot(near.x - l.x, near.y - l.y) < 300) { seen.add(key); out.push([l, near]); }
    }
  }
  return out;
}

const TREES: Record<string, [number, number][]> = {
  valcendre: [[60, 90], [100, 60], [150, 95], [200, 70], [85, 200], [210, 130], [40, 150], [250, 100], [180, 210], [125, 240]],
  staubin: [[60, 260], [90, 340], [140, 380], [70, 420], [160, 300], [40, 330]],
  hautepierre: [[60, 80], [110, 60], [170, 90], [220, 70], [90, 200], [200, 210], [40, 140], [250, 150], [140, 240], [300, 90], [330, 140]],
};

function Decor({ sid, season }: { sid: string; season: number }) {
  const winter = season === 3, autumn = season === 2;
  const treeColor = sid === 'hautepierre' ? (winter ? '#5d6b62' : '#33503d') : winter ? '#6f7d6a' : autumn ? '#9a6a2f' : '#4f6b3a';
  return (
    <g>
      {sid === 'valcendre' && <>
        <path d="M-10 380 C 120 350, 200 420, 300 370 S 470 300, 520 210 S 600 60, 640 -10" fill="none" stroke="#7d9fb0" strokeWidth="18" opacity="0.65" strokeLinecap="round" />
        <path d="M-10 380 C 120 350, 200 420, 300 370 S 470 300, 520 210 S 600 60, 640 -10" fill="none" stroke="#a9c3cf" strokeWidth="6" opacity="0.7" strokeLinecap="round" />
        <path d="M40 540 L250 520 L300 610 L60 630 Z" fill="url(#field)" stroke="#8b7a4e" strokeWidth="1.5" opacity="0.85" />
        <path d="M60 440 L170 430 L200 470 L70 490 Z" fill="url(#field)" stroke="#8b7a4e" strokeWidth="1.5" opacity="0.85" />
        <path d="M770 260 Q 840 120 920 230 Q 960 140 1010 210 L1010 300 L760 300 Z" fill="#c4ad7f" opacity="0.6" />
      </>}
      {sid === 'staubin' && <>
        <path d="M-10 560 C 200 520, 380 600, 560 560 S 860 520, 1010 580" fill="none" stroke="#7d9fb0" strokeWidth="46" opacity="0.6" strokeLinecap="round" />
        <path d="M-10 560 C 200 520, 380 600, 560 560 S 860 520, 1010 580" fill="none" stroke="#b3cbd6" strokeWidth="14" opacity="0.7" strokeLinecap="round" />
        <path d="M120 420 L330 400 L380 500 L140 520 Z" fill="url(#field)" stroke="#8b7a4e" strokeWidth="1.5" opacity="0.85" />
        <path d="M160 110 L360 100 L380 220 L170 240 Z" fill="url(#field)" stroke="#8b7a4e" strokeWidth="1.5" opacity="0.85" />
        <path d="M400 80 L560 70 L580 160 L410 170 Z" fill="url(#field)" stroke="#8b7a4e" strokeWidth="1.5" opacity="0.7" />
        <g transform="translate(470 540)" opacity="0.8"><path d="M-30 0 Q0 18 30 0 L22 -6 L-22 -6 Z" fill="#6b4a2a" /><line x1="0" y1="-6" x2="0" y2="-40" stroke="#5a4026" strokeWidth="2" /><path d="M0 -40 L18 -12 L0 -12 Z" fill="#e9dcc0" /></g>
      </>}
      {sid === 'hautepierre' && <>
        <path d="M-10 260 L120 120 L200 200 L320 40 L430 170 L520 60 L640 190 L760 30 L880 160 L1010 70 L1010 -10 L-10 -10 Z" fill="#b3a07a" opacity="0.55" />
        <path d="M320 40 L350 75 L300 70 Z M760 30 L790 70 L735 65 Z" fill="#f2efe6" opacity="0.8" />
        {[0, 1, 2].map(i => <path key={i} d={`M100 ${520 + i * 28} L320 ${510 + i * 28}`} stroke="#8b7a4e" strokeWidth="3" opacity="0.6" />)}
        <path d="M820 230 L860 230" stroke="#3b2a18" strokeWidth="5" />
      </>}
      {(TREES[sid] ?? []).map(([x, y], i) => (
        <g key={i} transform={`translate(${x} ${y})`} opacity="0.75">
          <path d={sid === 'hautepierre' ? 'M0 -26 L10 -6 L5 -6 L13 8 L-13 8 L-5 -6 L-10 -6 Z' : 'M0 -22 L14 8 L-14 8 Z'} fill={treeColor} />
          <rect x="-2" y="8" width="4" height="8" fill="#5a4026" />
        </g>
      ))}
    </g>
  );
}

export function VillageMap({ state, onTravel, onSelect }: { state: GameState; onTravel: (id: string) => void; onSelect: (id: string) => void }) {
  const [view, setView] = useState<'local' | 'region'>('local');
  return (
    <div className="map-wrap">
      <div className="map-switch" role="tablist">
        <button role="tab" aria-selected={view === 'local'} className={view === 'local' ? 'on' : ''} onClick={() => setView('local')}>Localité</button>
        <button role="tab" aria-selected={view === 'region'} className={view === 'region' ? 'on' : ''} onClick={() => setView('region')}>Région</button>
      </div>
      {view === 'local'
        ? <LocalMap state={state} onTravel={onTravel} onSelect={onSelect} />
        : <RegionMap state={state} onTravel={id => { onTravel(id); setView('local'); }} />}
    </div>
  );
}

function LocalMap({ state, onTravel, onSelect }: { state: GameState; onTravel: (id: string) => void; onSelect: (id: string) => void }) {
  const [hover, setHover] = useState<string | null>(null);
  const p = state.characters[state.playerId];
  const d = toDate(state.time);
  // sur une route (embuscade), on montre la localité de destination ou d'attache
  const onRoad = state.locations[p.locationId]?.kind === 'road';
  const sid = onRoad ? settlementIdOf(state, state.encounter?.destination ?? p.homeId) : settlementIdOf(state, p.locationId);
  const st = state.settlements[sid] ?? state.settlements[state.settlementOrder[0]];
  const locs = state.locationOrder.map(id => state.locations[id]).filter(l => l.settlementId === sid);
  const people = aliveCharacters(state).filter(c => !c.isPlayer);
  const byLoc: Record<string, typeof people> = {};
  for (const c of people) (byLoc[c.locationId] ??= []).push(c);
  const winter = d.season === 3, autumn = d.season === 2;
  // sorties vers les autres localités, placées au bord de la carte dans leur direction
  const neighbours = state.roads.filter(r => r.a === sid || r.b === sid).map(r => (r.a === sid ? r.b : r.a));
  const exits = neighbours.map(o => {
    const other = state.settlements[o];
    const ang = Math.atan2(other.y - st.y, other.x - st.x);
    const x = 500 + Math.cos(ang) * 440, y = 320 + Math.sin(ang) * 270;
    let ex = Math.max(70, Math.min(930, x)), ey = Math.max(40, Math.min(600, y));
    // écarte le panneau d'un lieu trop proche (étiquettes superposées)
    const hits = (yy: number) => locs.some(l => Math.abs(l.x - ex) < 110 && Math.abs(l.y - yy) < 75);
    if (hits(ey)) ey = [ey + 80, ey - 80, ey + 140, ey - 140].find(yy => yy >= 90 && yy <= 600 && !hits(yy)) ?? ey;
    return { id: o, name: other.name, x: ex, y: ey, minutes: travelMinutes(state, p.locationId, other.squareId), squareId: other.squareId };
  });
  const good = st.infrastructure > 40;
  return (
    <>
      <svg className="village-map" viewBox="0 0 1000 640" role="img" aria-label={`Carte de ${st.name}`}>
        <defs>
          <filter id="paper" x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" seed="4" result="n" />
            <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.35  0 0 0 0 0.25  0 0 0 0 0.12  0 0 0 0.22 0" />
            <feComposite in2="SourceGraphic" operator="in" />
            <feBlend in="SourceGraphic" mode="multiply" />
          </filter>
          <radialGradient id="vign" cx="50%" cy="50%" r="70%"><stop offset="60%" stopColor="#000" stopOpacity="0" /><stop offset="100%" stopColor="#2a1a0c" stopOpacity="0.55" /></radialGradient>
          <pattern id="field" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(20)">
            <rect width="14" height="14" fill={winter ? '#d8d3c4' : autumn ? '#d9b866' : '#b9c47a'} />
            <line x1="0" y1="7" x2="14" y2="7" stroke={winter ? '#bdb6a3' : autumn ? '#b8913d' : '#93a356'} strokeWidth="3" />
          </pattern>
        </defs>
        <rect width="1000" height="640" fill={winter ? '#e6e1d3' : sid === 'hautepierre' ? '#e2d6b8' : '#e8d9b5'} filter="url(#paper)" />
        <Decor sid={sid} season={d.season} />
        {localRoads(locs, st.squareId).map(([a, b]) => (
          <line key={a.id + b.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#8a6d45" strokeWidth={good ? 5 : 3} strokeDasharray={good ? undefined : '10 7'} opacity="0.55" strokeLinecap="round" />
        ))}
        {exits.map(e => (
          <g key={e.id}>
            <line x1={state.locations[st.squareId].x} y1={state.locations[st.squareId].y} x2={e.x} y2={e.y} stroke="#8a6d45" strokeWidth="4" strokeDasharray="2 9" opacity="0.6" strokeLinecap="round" />
            <g className="loc exit" transform={`translate(${e.x} ${e.y})`} role="button" tabIndex={0} onClick={() => onTravel(e.squareId)}
              onKeyDown={ev => { if (ev.key === 'Enter') onTravel(e.squareId); }} aria-label={`Partir pour ${e.name} (${formatDuration(e.minutes)})`}>
              <rect x="-74" y="-20" width="148" height="40" rx="6" className="exit-sign" />
              <text y="-3" textAnchor="middle" className="exit-label">Vers {e.name.split('-sur-')[0]}</text>
              <text y="13" textAnchor="middle" className="exit-time">{formatDuration(e.minutes)} de route</text>
            </g>
          </g>
        ))}
        {locs.map(loc => {
          const here = p.locationId === loc.id;
          const occupants = byLoc[loc.id] ?? [];
          const mins = travelMinutes(state, p.locationId, loc.id);
          return (
            <g key={loc.id} className={`loc ${here ? 'here' : ''}`} transform={`translate(${loc.x} ${loc.y})`}
              onMouseEnter={() => setHover(loc.id)} onMouseLeave={() => setHover(h => (h === loc.id ? null : h))}
              onClick={() => (here ? onSelect(loc.id) : onTravel(loc.id))} role="button" tabIndex={0}
              onKeyDown={e => { if (e.key === 'Enter') (here ? onSelect(loc.id) : onTravel(loc.id)); }}
              aria-label={here ? `${loc.name} (vous êtes ici)` : `Aller à ${loc.name} (${formatDuration(mins)})`}>
              <circle r="30" className="loc-disc" />
              <circle r="30" className="loc-ring" />
              <g transform="translate(-17 -17)" className="loc-glyph"><LocationGlyph kind={loc.kind} size={34} /></g>
              <text y="48" textAnchor="middle" className="loc-label">{loc.name}</text>
              {occupants.slice(0, 12).map((c, i) => {
                const ang = -Math.PI / 2 + (i - (Math.min(occupants.length, 12) - 1) / 2) * 0.34;
                return <circle key={c.id} cx={Math.cos(ang) * 39} cy={Math.sin(ang) * 39} r="5" fill={ACTIVITY_COLOR[c.activity.kind]} stroke="#2a1c10" strokeWidth="1.2"><title>{`${fullName(c)} — ${c.activity.note ?? c.activity.kind}`}</title></circle>;
              })}
            </g>
          );
        })}
        {locs.some(l => l.id === p.locationId) && (() => {
          const l = state.locations[p.locationId];
          // le pion se déplace en glissant d'un lieu à l'autre (désactivé si mouvement réduit)
          return <g className="player-token" style={{ transform: `translate(${l.x}px, ${l.y - 30}px)` }} pointerEvents="none" aria-hidden="true">
            <g className="player-pin"><path d="M0 0 L-9 -16 A10 10 0 1 1 9 -16 Z" fill="#a8322d" stroke="#f3e6c4" strokeWidth="2" /><circle cy="-19" r="4" fill="#f3e6c4" /></g>
          </g>;
        })()}
        <g transform="translate(940 580)" opacity="0.7">
          <circle r="26" fill="none" stroke="#6b5434" strokeWidth="1.5" />
          <path d="M0 -24 L5 0 L0 24 L-5 0 Z" fill="#6b5434" /><path d="M-24 0 L0 -5 L24 0 L0 5 Z" fill="#8a6d45" />
          <text y="-30" textAnchor="middle" fontSize="12" fill="#5a4026" fontFamily="Cinzel, serif">N</text>
        </g>
        <text x="30" y="40" className="map-title" style={st.name.length > 14 ? { fontSize: 26 } : undefined}>{st.name}</text>
        <rect width="1000" height="640" fill="url(#vign)" pointerEvents="none" />
        <rect width="1000" height="640" fill="#0b1430" opacity={nightOpacity(d.hour, d.minute)} pointerEvents="none" style={{ transition: 'opacity 0.8s' }} />
      </svg>
      {hover && (
        <div className="map-tip">
          <strong>{state.locations[hover].name}</strong>
          <span>{hover === p.locationId ? 'Tu es ici' : `Trajet : ${formatDuration(travelMinutes(state, p.locationId, hover))}`}</span>
          <span className="muted">{(byLoc[hover] ?? []).length} personne{(byLoc[hover] ?? []).length > 1 ? 's' : ''} présente{(byLoc[hover] ?? []).length > 1 ? 's' : ''}</span>
        </div>
      )}
      <div className="map-legend">
        {(['work', 'shop', 'socialize', 'forage', 'sleep', 'idle'] as ActivityKind[]).map(k => (
          <span key={k}><i style={{ background: ACTIVITY_COLOR[k] }} />{({ work: 'Travail', shop: 'Commerce', socialize: 'Taverne', forage: 'Cueillette', sleep: 'Sommeil', idle: 'Repos' } as Record<string, string>)[k]}</span>
        ))}
      </div>
    </>
  );
}

function RegionMap({ state, onTravel }: { state: GameState; onTravel: (squareId: string) => void }) {
  const p = state.characters[state.playerId];
  const here = settlementIdOf(state, p.locationId);
  const S = state.settlements;
  const moving = state.caravans.filter(c => c.status === 'en_route');
  const posOf = (from: string, to: string, t: number) => {
    const path = roadPath(state, from, to);
    if (!path) return { x: S[from].x, y: S[from].y };
    // position le long de l'itinéraire, au prorata des heures
    let remaining = t * path.hours, cur = from;
    for (const r of path.roads) {
      const next = r.a === cur ? r.b : r.a;
      if (remaining <= r.hours) {
        const f = remaining / r.hours;
        return { x: S[cur].x + (S[next].x - S[cur].x) * f, y: S[cur].y + (S[next].y - S[cur].y) * f };
      }
      remaining -= r.hours;
      cur = next;
    }
    return { x: S[to].x, y: S[to].y };
  };
  return (
    <svg className="village-map region" viewBox="0 0 1000 640" role="img" aria-label="Carte de la région">
      <defs>
        <filter id="paper-r" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" seed="7" result="n" />
          <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.35  0 0 0 0 0.25  0 0 0 0 0.12  0 0 0 0.22 0" />
          <feComposite in2="SourceGraphic" operator="in" />
          <feBlend in="SourceGraphic" mode="multiply" />
        </filter>
      </defs>
      <rect width="1000" height="640" fill="#e4d4ae" filter="url(#paper-r)" />
      <path d="M-10 600 C 150 540, 220 470, 330 470 S 560 420, 700 330 S 900 260, 1010 300" fill="none" stroke="#7d9fb0" strokeWidth="14" opacity="0.55" strokeLinecap="round" />
      <path d="M560 40 L640 160 L700 90 L780 210 L860 70 L960 190 L1010 120 L1010 -10 L520 -10 Z" fill="#b3a07a" opacity="0.55" />
      {[[120, 300], [160, 260], [90, 360], [420, 220], [460, 260], [380, 250]].map(([x, y], i) => <path key={i} d={`M${x} ${y - 16} L${x + 10} ${y + 6} L${x - 10} ${y + 6} Z`} fill="#4f6b3a" opacity="0.6" />)}
      {state.roads.map(r => {
        const a = S[r.a], b = S[r.b];
        return (
          <g key={r.locationId}>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#7a5a34" strokeWidth="6" strokeDasharray="14 8" opacity="0.7" strokeLinecap="round" />
            <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 12} textAnchor="middle" className="road-label">{state.locations[r.locationId].name} · {r.hours} h</text>
          </g>
        );
      })}
      {moving.map(c => {
        const t = Math.min(1, Math.max(0, (state.time - c.departTime) / Math.max(1, c.arriveTime - c.departTime)));
        const pos = posOf(c.from, c.to, t);
        return (
          <g key={c.id} transform={`translate(${pos.x} ${pos.y})`}>
            <circle r="9" fill="#c9a24a" stroke="#3b2a18" strokeWidth="2" />
            <path d="M-5 -2 h10 v5 h-10 z" fill="#3b2a18" />
            <title>{`Caravane de ${fullName(state.characters[c.merchantId])} vers ${S[c.to].name}`}</title>
          </g>
        );
      })}
      {(state.convoys ?? []).map(c => {
        const t = Math.min(1, Math.max(0, (state.time - c.departTime) / Math.max(1, c.arriveTime - c.departTime)));
        const pos = posOf(c.from, c.to, t);
        return (
          <g key={c.id} transform={`translate(${pos.x} ${pos.y})`}>
            <rect x="-9" y="-7" width="18" height="14" rx="3" fill={c.urgent ? '#a8322d' : '#7a8f4a'} stroke="#3b2a18" strokeWidth="2" />
            <circle cx="-5" cy="8" r="3" fill="#3b2a18" /><circle cx="5" cy="8" r="3" fill="#3b2a18" />
            <title>{`Convoi de ${(c.cargo.grain ?? 0) ? `${c.cargo.grain} boisseaux de grain` : `${c.cargo.bread ?? 0} miches de pain`}, de ${S[c.from].name} vers ${S[c.to].name}${c.urgent ? ' (urgence)' : ''}`}</title>
          </g>
        );
      })}
      {state.settlementOrder.map(id => {
        const st = S[id];
        const mins = travelMinutes(state, p.locationId, st.squareId);
        return (
          <g key={id} className={`loc settle ${id === here ? 'here' : ''}`} transform={`translate(${st.x} ${st.y})`} role="button" tabIndex={0}
            onClick={() => id !== here && onTravel(st.squareId)} onKeyDown={e => { if (e.key === 'Enter' && id !== here) onTravel(st.squareId); }}
            aria-label={id === here ? `${st.name} (tu es ici)` : `Partir pour ${st.name} (${formatDuration(mins)})`}>
            <circle r={st.kind === 'bourg' ? 40 : 34} className="loc-disc" />
            <circle r={st.kind === 'bourg' ? 40 : 34} className="loc-ring" />
            <g transform="translate(-17 -17)" className="loc-glyph"><LocationGlyph kind={id === 'hautepierre' ? 'mine' : id === 'staubin' ? 'farm' : 'square'} size={34} /></g>
            <text y="62" textAnchor="middle" className="loc-label">{st.name}</text>
            <text y="80" textAnchor="middle" className="settle-sub">{prosperityLabel(st.prosperity)} · {id === here ? 'tu es ici' : formatDuration(mins)}</text>
            <text y="97" textAnchor="middle" className="settle-sub house-sub">{state.orgs[st.lordHouseId]?.name ?? ''}{(st.revoltUntilDay ?? -1) >= toDate(state.time).day ? ' · révolte' : ''}</text>
            {state.wars.some(w => w.status === 'active' && w.targetSettlementId === id) && <text x="44" y="-30" fontSize="30" aria-label="guerre">⚔</text>}
            {id === here && <g className="player-pin" transform="translate(0 -40)"><path d="M0 0 L-9 -16 A10 10 0 1 1 9 -16 Z" fill="#a8322d" stroke="#f3e6c4" strokeWidth="2" /><circle cy="-19" r="4" fill="#f3e6c4" /></g>}
          </g>
        );
      })}
      <text x="30" y="40" className="map-title">La région</text>
    </svg>
  );
}
