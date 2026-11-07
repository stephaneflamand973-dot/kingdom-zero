import { useState } from 'react';
import { moveTo } from '../engine';
import { ActionPanel } from './ActionPanel';
import { LocationPanel } from './LocationPanel';
import { NpcDialog } from './NpcDialog';
import { EncounterModal } from './EncounterModal';
import { SaveMenu } from './SaveMenu';
import { SidePanels } from './SidePanels';
import { TopBar } from './TopBar';
import { useGame } from './useGame';
import { VillageMap } from './VillageMap';

export function App() {
  const game = useGame();
  const { state, act } = game;
  const [talkTo, setTalkTo] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  return (
    <div className="app">
      <TopBar state={state} onMenu={() => setMenu(true)} />
      <main className="layout">
        <div className="col-main">
          <VillageMap state={state} onTravel={id => act(s => moveTo(s, id))} onSelect={() => { /* déjà sur place */ }} />
          <LocationPanel game={game} onTalk={setTalkTo} />
        </div>
        <div className="col-side">
          <ActionPanel game={game} />
          <SidePanels game={game} onTalk={setTalkTo} />
        </div>
      </main>
      {state.encounter && !state.gameOver && <EncounterModal game={game} />}
      {talkTo && !state.encounter && <NpcDialog game={game} npcId={talkTo} onClose={() => setTalkTo(null)} />}
      {menu && <SaveMenu game={game} onClose={() => setMenu(false)} />}
      {state.gameOver && (
        <div className="modal-back">
          <div className="modal gameover">
            <h2>Fin de vie</h2>
            <p>{state.gameOver}</p>
            <p className="muted">Le royaume continue sans toi. La succession par un descendant sera possible dans une version future.</p>
            <button className="btn" onClick={() => setMenu(true)}>Charger une sauvegarde / nouvelle partie</button>
          </div>
        </div>
      )}
    </div>
  );
}
