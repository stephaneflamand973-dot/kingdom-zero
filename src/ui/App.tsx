import { useCallback, useEffect, useState } from 'react';
import { activeIncidents, drinkAle, eat, liveDays, minutesUntilHour, moveTo, settlementIdOf, sleep, sleepOptions, toDate, wait } from '../engine';
import { ActionPanel, nextStop } from './ActionPanel';
import { sound } from './audio';
import { ErrorBoundary } from './ErrorBoundary';
import { HelpModal } from './HelpModal';
import { LocationPanel } from './LocationPanel';
import { NpcDialog } from './NpcDialog';
import { EncounterModal } from './EncounterModal';
import { SuccessionModal } from './SuccessionModal';
import { SaveMenu } from './SaveMenu';
import { SIDE_TABS, SidePanels, type SideTab } from './SidePanels';
import { Toasts } from './Toasts';
import { TopBar } from './TopBar';
import { useGame } from './useGame';
import { usePrefs } from './prefs';
import { VillageMap } from './VillageMap';
import { useModal } from './a11y';

const INDOOR = new Set(['tavern', 'bakery', 'forge', 'manor', 'houses', 'market']);

export function App() {
  return <ErrorBoundary><Game /></ErrorBoundary>;
}

function Game() {
  const game = useGame();
  const prefsApi = usePrefs();
  const { prefs, update } = prefsApi;
  const { state, act } = game;
  const [talkTo, setTalkTo] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [help, setHelp] = useState(false);
  const [tab, setTab] = useState<SideTab>('perso');
  const p = state.characters[state.playerId];
  const d = toDate(state.time);
  const blocked = !!state.encounter || !!state.pendingSuccession || !!state.gameOver;
  const modalOpen = menu || help || !!talkTo || blocked;

  // Ambiance sonore : suit l'heure, la saison, le lieu et la météo
  const locKind = state.locations[p.locationId]?.kind ?? 'square';
  const storm = activeIncidents(state, settlementIdOf(state, p.locationId)).some(i => i.kind === 'grand_froid');
  useEffect(() => {
    sound.setScene({ hour: d.hour, season: d.season, locKind, indoor: INDOOR.has(locKind) && !(locKind === 'market' && d.hour < 20), storm, muted: !prefs.sound, volume: prefs.volume });
  }, [d.hour, d.season, locKind, storm, prefs.sound, prefs.volume]);
  // Le son ne peut démarrer qu'après un geste de l'utilisateur
  useEffect(() => {
    const unlock = () => sound.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => { window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
  }, []);

  const shortcut = useCallback((e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    const k = e.key.toLowerCase();
    if (k === '?' || k === 'h') { setHelp(h => !h); e.preventDefault(); return; }
    if (k === 's') { update({ sound: !prefs.sound }); return; }
    if (modalOpen) return; // les fenêtres gèrent leurs propres touches (Échap)
    const n = Number(e.key);
    if (n >= 1 && n <= SIDE_TABS.length) { setTab(SIDE_TABS[n - 1]); sound.play('page'); return; }
    switch (k) {
      case 'm': act(eat); break;
      case 'b': act(drinkAle); break;
      case 'a': act(s => wait(s, 60)); break;
      case 'j': act(s => wait(s, minutesUntilHour(s.time, nextStop(toDate(s.time).hour).hour))); break;
      case 'v': act(s => liveDays(s, 7)); break;
      case 'p': setMenu(true); break;
      case 'd': {
        const o = sleepOptions(state).find(x => x.ok);
        if (o) act(s => sleep(s, o.mode));
        break;
      }
      default: return;
    }
    e.preventDefault();
  }, [act, modalOpen, prefs.sound, state, update]);
  useEffect(() => {
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, [shortcut]);

  return (
    <div className="app">
      <a className="skip" href="#actions">Aller aux actions</a>
      <TopBar state={state} onMenu={() => setMenu(true)} onHelp={() => setHelp(true)} soundOn={prefs.sound} onSound={() => update({ sound: !prefs.sound })} />
      <main className="layout">
        <div className="col-main">
          <VillageMap state={state} onTravel={id => act(s => moveTo(s, id))} onSelect={() => { /* déjà sur place */ }} />
          <LocationPanel game={game} onTalk={setTalkTo} />
        </div>
        <div className="col-side">
          <ActionPanel game={game} showGuide={prefs.guide} onHelp={() => setHelp(true)} />
          <SidePanels game={game} onTalk={setTalkTo} tab={tab} onTab={setTab} />
        </div>
      </main>
      <Toasts toasts={game.toasts} onDismiss={game.dismiss} />
      {state.encounter && !state.gameOver && !state.pendingSuccession && <EncounterModal game={game} />}
      {state.pendingSuccession && !menu && <SuccessionModal game={game} onMenu={() => setMenu(true)} />}
      {talkTo && !state.encounter && <NpcDialog game={game} npcId={talkTo} onClose={() => setTalkTo(null)} />}
      {help && <HelpModal state={state} prefsApi={prefsApi} onClose={() => setHelp(false)} />}
      {menu && <SaveMenu game={game} onClose={() => setMenu(false)} />}
      {state.gameOver && !menu && <GameOver text={state.gameOver} onMenu={() => setMenu(true)} />}
    </div>
  );
}

function GameOver({ text, onMenu }: { text: string; onMenu: () => void }) {
  const ref = useModal<HTMLDivElement>();
  return (
    <div className="modal-back">
      <div ref={ref} className="modal gameover" role="alertdialog" aria-modal="true" aria-labelledby="go-title">
        <h2 id="go-title">Fin de vie</h2>
        <p>{text}</p>
        <p className="muted">Personne de ta famille ni de tes proches ne peut reprendre le flambeau. Le royaume continue sans toi.</p>
        <button className="btn" onClick={onMenu}>Charger une sauvegarde / nouvelle partie</button>
      </div>
    </div>
  );
}
