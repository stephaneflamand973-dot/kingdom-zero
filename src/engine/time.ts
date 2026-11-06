// Calendrier interne : 1 jour = 24 h, semaine = 7 jours, saison = 28 jours, année = 4 saisons.
export const MIN_PER_HOUR = 60;
export const HOURS_PER_DAY = 24;
export const MIN_PER_DAY = MIN_PER_HOUR * HOURS_PER_DAY;
export const DAYS_PER_WEEK = 7;
export const DAYS_PER_SEASON = 28;
export const SEASONS = ['Printemps', 'Été', 'Automne', 'Hiver'] as const;
export const DAYS_PER_YEAR = DAYS_PER_SEASON * SEASONS.length;
export const WEEKDAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'] as const;
export const START_YEAR = 1247;
/** La partie commence le 1er jour du printemps à 6h00. */
export const START_OFFSET_MIN = 6 * MIN_PER_HOUR;

export interface CalendarDate {
  totalMinutes: number;
  minute: number;
  hour: number;
  day: number;        // jour absolu (0..)
  dayOfSeason: number; // 1..28
  weekday: number;    // 0..6
  season: number;     // 0..3
  year: number;
}

export function toDate(time: number): CalendarDate {
  const abs = time + START_OFFSET_MIN;
  const day = Math.floor(abs / MIN_PER_DAY);
  const inDay = abs - day * MIN_PER_DAY;
  const yearIdx = Math.floor(day / DAYS_PER_YEAR);
  const dayOfYear = day - yearIdx * DAYS_PER_YEAR;
  return {
    totalMinutes: time,
    minute: inDay % 60,
    hour: Math.floor(inDay / 60),
    day,
    dayOfSeason: (dayOfYear % DAYS_PER_SEASON) + 1,
    weekday: day % DAYS_PER_WEEK,
    season: Math.floor(dayOfYear / DAYS_PER_SEASON),
    year: START_YEAR + yearIdx,
  };
}

export function hourOf(time: number): number { return toDate(time).hour; }

export function isNight(hour: number): boolean { return hour >= 21 || hour < 6; }

export function formatDate(time: number): string {
  const d = toDate(time);
  return `${WEEKDAYS[d.weekday]} ${d.dayOfSeason} ${SEASONS[d.season]} ${d.year}`;
}

export function formatClock(time: number): string {
  const d = toDate(time);
  return `${String(d.hour).padStart(2, '0')}h${String(d.minute).padStart(2, '0')}`;
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return m ? `${h} h ${m}` : `${h} h`;
}

/** Minutes à attendre pour atteindre la prochaine occurrence de l'heure h. */
export function minutesUntilHour(time: number, h: number): number {
  const d = toDate(time);
  const now = d.hour * 60 + d.minute;
  let target = h * 60;
  if (target <= now) target += MIN_PER_DAY;
  return target - now;
}

/** Multiplicateur de rendement agricole selon la saison. */
export const SEASON_YIELD = [0.9, 1.1, 1.4, 0.5];
