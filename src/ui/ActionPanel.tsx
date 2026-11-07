import { liveDays, orgsOf, patrol, festivalAt, festivalTonight, feastDrink, drinkAle, eat, forage, formatClock, minutesUntilHour, qty, sleep, sleepOptions, toDate, train, wait } from '../engine';
import { goals } from './HelpModal';
import type { Game } from './useGame';

export function nextStop(hour: number): { hour: number; label: string } {
  return hour >= 6 && hour < 12 ? { hour: 12, label: 'à midi' } : hour >= 12 && hour < 18 ? { hour: 18, label: 'à 18h' } : { hour: 6, label: 'au matin' };
}

const Kbd = ({ k }: { k: string }) => <kbd className="kbd" aria-hidden="true">{k}</kbd>;

export function ActionPanel({ game, showGuide = true, onHelp }: { game: Game; showGuide?: boolean; onHelp?: () => void }) {
  const { state, act, feed } = game;
  const p = state.characters[state.playerId];
  const loc = state.locations[p.locationId];
  const d = toDate(state.time);
  const over = !!state.gameOver;
  const food = qty(p.inventory, 'bread') + qty(p.inventory, 'grain');
  const stop = nextStop(d.hour);
  const firstSleep = sleepOptions(state).find(o => o.ok)?.mode;
  const goal = showGuide ? goals(state).find(g => !g.done) : undefined;
  return (
    <section className="panel action-panel" id="actions" aria-label="Récit et actions">
      <div className="recit">
        <h3 className="sub">Récit</h3>
        <ol className="feed" aria-live="polite" aria-relevant="additions">
          {feed.length === 0 && <li className="muted">Tu arrives à Valcendre au petit matin, sans un denier en poche. Une miche de pain, des bras, et tout à construire.</li>}
          {feed.slice(0, 6).map((f, i) => (
            <li key={f.id} className={`${f.ok ? '' : 'refused'} ${i === 0 ? 'latest' : ''}`}><span className="feed-time">{formatClock(f.time)}</span>{f.text}</li>
          ))}
        </ol>
      </div>
      <div className="actions">
        <h3 className="sub">Actions</h3>
        <div className="action-grid">
          <button className="btn" disabled={over || food < 1} onClick={() => act(eat)} title="15 min · touche M" aria-keyshortcuts="M">🍞 Manger <small>{food}</small><Kbd k="M" /></button>
          <button className="btn" disabled={over || qty(p.inventory, 'ale') < 1} onClick={() => act(drinkAle)} title="20 min · touche B" aria-keyshortcuts="B">🍺 Boire<Kbd k="B" /></button>
          {loc.kind === 'tavern' && festivalTonight(state, loc.id) && <button className="btn feast" disabled={over} onClick={() => act(feastDrink)} title="30 min · chope offerte">🎉 Trinquer à la fête</button>}
          {orgsOf(state, p.id, 'house').some(h => h.roles[p.id] === 'soldat') && (loc.kind === 'square' || loc.kind === 'road') && <button className="btn" disabled={over} onClick={() => act(s => patrol(s, 4))} title="4 h · service de la garnison">🛡 Patrouiller (4 h)</button>}
          {loc.kind === 'woodlot' && <button className="btn" disabled={over} onClick={() => act(s => forage(s, 3))} title="3 h · Agriculture">🪵 Ramasser du bois (3 h)</button>}
          {loc.kind === 'woodlot' && <button className="btn" disabled={over} onClick={() => act(s => forage(s, 3, 'grain'))} title="3 h · racines, baies et glands : maigre pitance, surtout l’hiver">🌰 Cueillir (3 h)</button>}
          {loc.kind === 'square' && <button className="btn" disabled={over} onClick={() => act(train)} title="1 h · Combat">⚔ S'entraîner</button>}
          <button className="btn ghost" disabled={over} onClick={() => act(s => wait(s, 60))} title="touche A" aria-keyshortcuts="A">⌛ Attendre 1 h<Kbd k="A" /></button>
          <button className="btn ghost" disabled={over} onClick={() => act(s => wait(s, minutesUntilHour(s.time, stop.hour)))} title="touche J" aria-keyshortcuts="J">⌛ Jusqu'{stop.label}<Kbd k="J" /></button>
          <button className="btn ghost" disabled={over} onClick={() => act(s => liveDays(s, 7))} title="L’IA conduit ton personnage : il travaille, mange, dort. S’arrête en cas d’imprévu. Touche V" aria-keyshortcuts="V">📅 Vivre une semaine<Kbd k="V" /></button>
          <button className="btn ghost" disabled={over} onClick={() => act(s => liveDays(s, 28))} title="Une saison entière au fil des jours">🍂 Vivre une saison</button>
        </div>
        <h3 className="sub">Repos</h3>
        <div className="action-grid">
          {sleepOptions(state).map(o => (
            <button key={o.mode} className="btn" disabled={over || !o.ok || p.needs.energy >= 95} title={o.reason ?? (d.hour >= 18 || d.hour < 5 ? 'Jusqu’à 6h' : 'Sieste de 4 h')}
              onClick={() => act(s => sleep(s, o.mode))}>🌙 {o.label}{o.mode === firstSleep && <Kbd k="D" />}</button>
          ))}
        </div>
        {festivalTonight(state, loc.id) && loc.kind !== 'tavern' && <p className="notice">{festivalAt(state, loc.id)!.name} ce soir à l’auberge : la bière est offerte par l’intendance.</p>}
        {p.needs.hunger >= 75 && <p className="warn" role="alert">Tu es affamé : ta santé va décliner si tu ne manges pas.</p>}
        {p.needs.energy <= 15 && <p className="warn" role="alert">Tu tiens à peine debout : repose-toi.</p>}
        {goal && <p className="guide"><b>Objectif :</b> {goal.label}. <span className="muted">{goal.hint}</span> <button className="link" onClick={onHelp}>Tous les repères</button></p>}
      </div>
    </section>
  );
}
