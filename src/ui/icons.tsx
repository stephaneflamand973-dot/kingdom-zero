// Glyphes vectoriels dessinés à la main (aucune dépendance graphique externe).
import type { LocationKind } from '../engine';

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

export function LocationGlyph({ kind, size = 28 }: { kind: LocationKind; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      {GLYPHS[kind]}
    </svg>
  );
}

const GLYPHS: Record<LocationKind, JSX.Element> = {
  square: (<g {...S}><path d="M8 16 L20 8 L32 16" /><path d="M11 16 V22 M29 16 V22" /><ellipse cx="20" cy="27" rx="10" ry="4" /><path d="M10 27 V32 Q20 37 30 32 V27" /><path d="M20 14 V24" /></g>),
  market: (<g {...S}><path d="M5 17 L20 7 L35 17 Z" /><path d="M9 17 V33 M20 17 V33 M31 17 V33" /><path d="M5 33 H35" /><path d="M12 24 h5 M23 24 h5" /></g>),
  tavern: (<g {...S}><rect x="9" y="12" width="17" height="21" rx="3" /><path d="M26 16 h4 a3 3 0 0 1 3 3 v6 a3 3 0 0 1 -3 3 h-4" /><path d="M9 12 Q11 7 15 9 Q18 5 22 8 Q26 7 26 12" /><path d="M14 18 V28 M20 18 V28" /></g>),
  bakery: (<g {...S}><path d="M6 25 Q6 13 20 13 Q34 13 34 25 Q34 30 20 30 Q6 30 6 25 Z" /><path d="M13 17 L16 24 M19 15 L22 24 M25 17 L28 23" /></g>),
  forge: (<g {...S}><path d="M7 15 H31 Q31 21 25 21 H22 V27 H28 V32 H12 V27 H18 V21 H15 Q7 21 7 15 Z" /><path d="M31 9 l-6 6 M28 6 l6 6" /></g>),
  manor: (<g {...S}><path d="M10 34 V14 H14 V10 H18 V14 H22 V10 H26 V14 H30 V34 Z" /><path d="M17 34 V27 Q20 23 23 27 V34" /><path d="M20 10 V4 L26 6 L20 8" /></g>),
  houses: (<g {...S}><path d="M4 33 V21 L12 14 L20 21 V33 Z" /><path d="M18 33 V18 L27 10 L36 18 V33 Z" /><path d="M10 33 V27 H14 V33 M25 24 h4 v4 h-4 z" /></g>),
  farm: (<g {...S}><path d="M5 33 V18 L15 10 L25 18 V33 Z" /><path d="M10 33 V25 H20 V33 M10 25 L20 33 M20 25 L10 33" /><path d="M30 33 V16 M30 16 l-3 -4 M30 16 l3 -4 M30 21 l-3 -4 M30 21 l3 -4 M30 26 l-3 -4 M30 26 l3 -4" /></g>),
  woodlot: (<g {...S}><path d="M13 34 V26 M13 26 L5 26 L13 8 L21 26 Z" /><path d="M28 34 V27 M28 27 L21 27 L28 12 L35 27 Z" /></g>),
  mine: (<g {...S}><path d="M3 34 L15 12 L22 22 L27 16 L37 34 Z" /><path d="M14 34 V28 Q18 23 22 28 V34" /><path d="M27 6 Q33 7 36 12 M31 8 L25 18" /></g>),
};

export function Coin({ size = 16 }: { size?: number }) {
  return (<svg width={size} height={size} viewBox="0 0 20 20" aria-hidden><circle cx="10" cy="10" r="8" fill="#c9a24a" stroke="#7a5c1c" strokeWidth="1.5" /><circle cx="10" cy="10" r="4.5" fill="none" stroke="#7a5c1c" strokeWidth="1" /></svg>);
}

export function SunMoon({ hour, size = 22 }: { hour: number; size?: number }) {
  const night = hour >= 21 || hour < 6;
  const dusk = hour >= 18 && hour < 21;
  return night ? (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden><path d="M16 3 A9 9 0 1 0 21 15 A7 7 0 1 1 16 3 Z" fill="#d9d2b8" /></svg>
  ) : (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden><circle cx="12" cy="12" r="5" fill={dusk ? '#e08a3c' : '#f2c14e'} />
      {[0, 45, 90, 135, 180, 225, 270, 315].map(a => <line key={a} x1="12" y1="2.5" x2="12" y2="5" stroke={dusk ? '#e08a3c' : '#f2c14e'} strokeWidth="2" strokeLinecap="round" transform={`rotate(${a} 12 12)`} />)}
    </svg>
  );
}

/** Blason généré à partir de l'identifiant (couleurs et partition stables). */
export function Crest({ id, initials, size = 44 }: { id: string; initials: string; size?: number }) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const tinctures = ['#7d2a2a', '#2a4b7d', '#2f5d3a', '#6a3d7a', '#8a6a1f', '#3c3c3c', '#7a4a2a'];
  const a = tinctures[h % tinctures.length], b = tinctures[(h >> 3) % tinctures.length] === a ? '#b8a27a' : tinctures[(h >> 3) % tinctures.length];
  const part = h % 4;
  return (
    <svg width={size} height={size * 1.15} viewBox="0 0 40 46" aria-hidden>
      <defs><clipPath id={`cl-${id}`}><path d="M3 3 H37 V20 Q37 36 20 43 Q3 36 3 20 Z" /></clipPath></defs>
      <g clipPath={`url(#cl-${id})`}>
        <rect width="40" height="46" fill={a} />
        {part === 0 && <rect x="20" width="20" height="46" fill={b} />}
        {part === 1 && <rect y="18" width="40" height="28" fill={b} />}
        {part === 2 && <path d="M0 0 L40 46 H0 Z" fill={b} />}
        {part === 3 && <path d="M14 0 H26 V46 H14 Z" fill={b} />}
      </g>
      <path d="M3 3 H37 V20 Q37 36 20 43 Q3 36 3 20 Z" fill="none" stroke="#c9a24a" strokeWidth="2" />
      <text x="20" y="26" textAnchor="middle" fontSize="13" fontFamily="Cinzel, serif" fill="#f3e6c4" fontWeight="700">{initials}</text>
    </svg>
  );
}
