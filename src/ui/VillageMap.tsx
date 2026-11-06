// Carte du village : parchemin vectoriel, lieux cliquables, habitants présents.
import { useState } from 'react';
import { aliveCharacters, formatDuration, fullName, toDate, travelMinutes, type ActivityKind, type GameState } from '../engine';
import { LocationGlyph } from './icons';

const ROADS: [string, string][] = [
  ['square', 'market'], ['square', 'tavern'], ['square', 'bakery'], ['square', 'forge'], ['square', 'houses_a'],
  ['square', 'houses_b'], ['market', 'manor'], ['houses_a', 'farm'], ['forge', 'farm'], ['tavern', 'woodlot'],
  ['houses_a', 'woodlot'], ['manor', 'mine'], ['market', 'houses_b'], ['bakery', 'houses_b'],
];

export const ACTIVITY_COLOR: Record<ActivityKind, string> = {
  work: '#e3a83b', sleep: '#5b7bb3', socialize: '#b57ad1', shop: '#6fbf73', idle: '#a59b86', seekJob: '#e07a5f',
  patrol: '#e3a83b', travel: '#d9d2b8', talk: '#b57ad1', train: '#e07a5f', forage: '#8fae5d', manage: '#e3a83b', dead: '#444', eat: '#6fbf73',
};

function nightOpacity(hour: number, minute: number): number {
  const t = hour + minute / 60;
  if (t >= 22 || t < 5) return 0.55;
  if (t >= 5 && t < 7) return 0.55 * (1 - (t - 5) / 2);
  if (t >= 19 && t < 22) return 0.55 * ((t - 19) / 3);
  return 0;
}

export function VillageMap({ state, onTravel, onSelect }: { state: GameState; onTravel: (id: string) => void; onSelect: (id: string) => void }) {
  const [hover, setHover] = useState<string | null>(null);
  const p = state.characters[state.playerId];
  const d = toDate(state.time);
  const people = aliveCharacters(state).filter(c => !c.isPlayer);
  const byLoc: Record<string, typeof people> = {};
  for (const c of people) (byLoc[c.locationId] ??= []).push(c);
  const L = state.locations;
  const winter = d.season === 3, autumn = d.season === 2;

  return (
    <div className="map-wrap">
      <svg className="village-map" viewBox="0 0 1000 640" role="img" aria-label="Carte de Valcendre">
        <defs>
          <filter id="paper" x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" seed="4" result="n" />
            <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.35  0 0 0 0 0.25  0 0 0 0 0.12  0 0 0 0.22 0" />
            <feComposite in2="SourceGraphic" operator="in" />
            <feBlend in="SourceGraphic" mode="multiply" />
          </filter>
          <radialGradient id="vign" cx="50%" cy="50%" r="70%">
            <stop offset="60%" stopColor="#000" stopOpacity="0" />
            <stop offset="100%" stopColor="#2a1a0c" stopOpacity="0.55" />
          </radialGradient>
          <pattern id="field" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(20)">
            <rect width="14" height="14" fill={winter ? '#d8d3c4' : autumn ? '#d9b866' : '#b9c47a'} />
            <line x1="0" y1="7" x2="14" y2="7" stroke={winter ? '#bdb6a3' : autumn ? '#b8913d' : '#93a356'} strokeWidth="3" />
          </pattern>
        </defs>
        <rect width="1000" height="640" fill={winter ? '#e6e1d3' : '#e8d9b5'} filter="url(#paper)" />
        {/* Rivière */}
        <path d="M-10 380 C 120 350, 200 420, 300 370 S 470 300, 520 210 S 600 60, 640 -10" fill="none" stroke="#7d9fb0" strokeWidth="18" opacity="0.65" strokeLinecap="round" />
        <path d="M-10 380 C 120 350, 200 420, 300 370 S 470 300, 520 210 S 600 60, 640 -10" fill="none" stroke="#a9c3cf" strokeWidth="6" opacity="0.7" strokeLinecap="round" />
        {/* Champs */}
        <path d="M40 540 L250 520 L300 610 L60 630 Z" fill="url(#field)" stroke="#8b7a4e" strokeWidth="1.5" opacity="0.85" />
        <path d="M60 440 L170 430 L200 470 L70 490 Z" fill="url(#field)" stroke="#8b7a4e" strokeWidth="1.5" opacity="0.85" />
        {/* Forêt */}
        {[[60, 90], [100, 60], [150, 95], [200, 70], [85, 200], [210, 130], [40, 150], [250, 100], [180, 210], [125, 240]].map(([x, y], i) => (
          <g key={i} transform={`translate(${x} ${y})`} opacity="0.75">
            <path d="M0 -22 L14 8 L-14 8 Z" fill={winter ? '#6f7d6a' : autumn ? '#9a6a2f' : '#4f6b3a'} />
            <rect x="-2" y="8" width="4" height="8" fill="#5a4026" />
          </g>
        ))}
        {/* Collines */}
        <path d="M770 260 Q 840 120 920 230 Q 960 140 1010 210 L1010 300 L760 300 Z" fill="#c4ad7f" opacity="0.6" />
        <path d="M800 230 Q 850 150 900 220" fill="none" stroke="#8b7550" strokeWidth="2" opacity="0.7" />
        {/* Routes */}
        {ROADS.map(([a, b]) => (
          <line key={a + b} x1={L[a].x} y1={L[a].y} x2={L[b].x} y2={L[b].y} stroke="#8a6d45" strokeWidth={state.village.infrastructure > 40 ? 5 : 3}
            strokeDasharray={state.village.infrastructure > 40 ? undefined : '10 7'} opacity="0.55" strokeLinecap="round" />
        ))}
        {/* Lieux */}
        {state.locationOrder.map(id => {
          const loc = L[id];
          const here = p.locationId === id;
          const occupants = byLoc[id] ?? [];
          const mins = travelMinutes(state, p.locationId, id);
          return (
            <g key={id} className={`loc ${here ? 'here' : ''}`} transform={`translate(${loc.x} ${loc.y})`}
              onMouseEnter={() => setHover(id)} onMouseLeave={() => setHover(h => (h === id ? null : h))}
              onClick={() => (here ? onSelect(id) : onTravel(id))} role="button" tabIndex={0}
              onKeyDown={e => { if (e.key === 'Enter') (here ? onSelect(id) : onTravel(id)); }}
              aria-label={here ? `${loc.name} (vous êtes ici)` : `Aller à ${loc.name} (${formatDuration(mins)})`}>
              <circle r="30" className="loc-disc" />
              <circle r="30" className="loc-ring" />
              <g transform="translate(-17 -17)" className="loc-glyph"><LocationGlyph kind={loc.kind} size={34} /></g>
              <text y="48" textAnchor="middle" className="loc-label">{loc.name}</text>
              {occupants.slice(0, 12).map((c, i) => {
                const ang = -Math.PI / 2 + (i - (Math.min(occupants.length, 12) - 1) / 2) * 0.34;
                return <circle key={c.id} cx={Math.cos(ang) * 39} cy={Math.sin(ang) * 39} r="5" fill={ACTIVITY_COLOR[c.activity.kind]} stroke="#2a1c10" strokeWidth="1.2"><title>{`${fullName(c)} — ${c.activity.note ?? c.activity.kind}`}</title></circle>;
              })}
              {here && <g className="player-pin" transform="translate(0 -30)"><path d="M0 0 L-9 -16 A10 10 0 1 1 9 -16 Z" fill="#a8322d" stroke="#f3e6c4" strokeWidth="2" /><circle cy="-19" r="4" fill="#f3e6c4" /></g>}
            </g>
          );
        })}
        {/* Rose des vents */}
        <g transform="translate(940 580)" opacity="0.7">
          <circle r="26" fill="none" stroke="#6b5434" strokeWidth="1.5" />
          <path d="M0 -24 L5 0 L0 24 L-5 0 Z" fill="#6b5434" /><path d="M-24 0 L0 -5 L24 0 L0 5 Z" fill="#8a6d45" />
          <text y="-30" textAnchor="middle" fontSize="12" fill="#5a4026" fontFamily="Cinzel, serif">N</text>
        </g>
        <text x="30" y="40" className="map-title">Valcendre</text>
        <rect width="1000" height="640" fill="url(#vign)" pointerEvents="none" />
        <rect width="1000" height="640" fill="#0b1430" opacity={nightOpacity(d.hour, d.minute)} pointerEvents="none" style={{ transition: 'opacity 0.8s' }} />
      </svg>
      {hover && (
        <div className="map-tip">
          <strong>{L[hover].name}</strong>
          <span>{hover === p.locationId ? 'Tu es ici' : `Trajet : ${formatDuration(travelMinutes(state, p.locationId, hover))}`}</span>
          <span className="muted">{(byLoc[hover] ?? []).length} personne{(byLoc[hover] ?? []).length > 1 ? 's' : ''} présente{(byLoc[hover] ?? []).length > 1 ? 's' : ''}</span>
        </div>
      )}
      <div className="map-legend">
        {(['work', 'shop', 'socialize', 'forage', 'sleep', 'idle'] as ActivityKind[]).map(k => (
          <span key={k}><i style={{ background: ACTIVITY_COLOR[k] }} />{({ work: 'Travail', shop: 'Commerce', socialize: 'Taverne', forage: 'Cueillette', sleep: 'Sommeil', idle: 'Repos' } as Record<string, string>)[k]}</span>
        ))}
      </div>
    </div>
  );
}
