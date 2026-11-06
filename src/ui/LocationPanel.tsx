import { useState } from 'react';
import {
  askPrice, businessesAt, buy, canWork, charactersAt, fullName, getRelation, isOpen, ITEMS, ITEM_ICON, moodOf,
  PROFESSION_NAMES, priceForCharacter, relationLabel, sell, steal, toDate, tradeRefusal, work, qty, outputCap,
  type Business, type GameState, type ItemId,
} from '../engine';
import { Crest } from './icons';
import { ACTIVITY_COLOR } from './VillageMap';
import type { Game } from './useGame';

export function LocationPanel({ game, onTalk }: { game: Game; onTalk: (id: string) => void }) {
  const { state } = game;
  const p = state.characters[state.playerId];
  const loc = state.locations[p.locationId];
  const people = charactersAt(state, loc.id);
  const biz = businessesAt(state, loc.id);
  return (
    <section className="panel location-panel">
      <div className="panel-head">
        <h2>{loc.name}</h2>
        <p className="flavor">{loc.description}</p>
      </div>
      <div className="loc-grid">
        <div>
          <h3 className="sub">Personnes présentes <span className="count">{people.length}</span></h3>
          {people.length === 0 && <p className="muted">Il n'y a personne ici pour l'instant.</p>}
          <div className="people">
            {people.map(c => {
              const r = getRelation(state, c.id, p.id);
              return (
                <button key={c.id} className="person" onClick={() => onTalk(c.id)} disabled={!!state.gameOver}>
                  <Crest id={c.id} initials={c.firstName[0] + c.lastName[0]} size={34} />
                  <div className="person-body">
                    <div className="person-name">{fullName(c)}</div>
                    <div className="person-meta">{PROFESSION_NAMES[c.profession]} · {c.age} ans · {moodOf(c)}</div>
                    <div className="person-act"><i style={{ background: ACTIVITY_COLOR[c.activity.kind] }} />{c.activity.note}</div>
                  </div>
                  <span className={`rel-chip ${r.affinity >= 10 ? 'good' : r.affinity <= -10 ? 'bad' : ''}`}>{relationLabel(r)}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div>
          {biz.length > 0 && <h3 className="sub">Établissements</h3>}
          {biz.length === 0 && <p className="muted">Aucun commerce ici.</p>}
          {biz.map(b => <BusinessCard key={b.id} game={game} b={b} />)}
        </div>
      </div>
    </section>
  );
}

function BusinessCard({ game, b }: { game: Game; b: Business }) {
  const { state, act } = game;
  const p = state.characters[state.playerId];
  const hour = toDate(state.time).hour;
  const open = isOpen(b, hour);
  const owner = b.ownerId ? state.characters[b.ownerId] : undefined;
  const refusal = tradeRefusal(state, b, p);
  const wc = canWork(state, b, p);
  const [stealItem, setStealItem] = useState<ItemId | ''>('');
  const items = Array.from(new Set([...b.sells, ...b.buys, ...(Object.keys(b.stock) as ItemId[])]));
  const shopItems = items.filter(i => b.sells.includes(i) || (b.buys.includes(i) && qty(p.inventory, i) > 0));
  const stealable = (Object.keys(b.stock) as ItemId[]).filter(i => qty(b.stock, i) > 0);

  return (
    <div className={`biz ${open ? '' : 'closed'}`}>
      <div className="biz-head">
        <div>
          <div className="biz-name">{b.name}</div>
          <div className="biz-meta">{owner ? `Tenu par ${fullName(owner)}` : 'Géré par l’intendance'} · {open ? <span className="ok">Ouvert</span> : <span className="ko">Fermé</span>} ({b.openFrom}h–{b.openTo}h)</div>
        </div>
        <div className="biz-till" title="Trésorerie de l'établissement">{b.treasury} d</div>
      </div>

      {shopItems.length > 0 && (
        <table className="shop">
          <thead><tr><th>Marchandise</th><th>Stock</th><th>Achat</th><th>Revente</th><th /></tr></thead>
          <tbody>
            {shopItems.map(i => {
              const canBuy = b.sells.includes(i);
              const canSell = b.buys.includes(i);
              const bp = canBuy ? priceForCharacter(state, b, p, i, 'buy') : null;
              const sp = canSell ? priceForCharacter(state, b, p, i, 'sell') : null;
              const mine = qty(p.inventory, i);
              const sellBlocked = !canSell || mine < 1 || qty(b.stock, i) + 1 > outputCap(b, i) || b.treasury < (sp ?? 0);
              return (
                <tr key={i}>
                  <td><span className="ico">{ITEM_ICON[i]}</span>{ITEMS[i].name}</td>
                  <td>{qty(b.stock, i)}</td>
                  <td>{bp !== null ? <span title={`Prix affiché : ${askPrice(state, b, i)} d`}>{bp} d</span> : '—'}</td>
                  <td>{sp !== null ? `${sp} d` : '—'}</td>
                  <td className="row-actions">
                    {canBuy && <button className="btn sm" disabled={!open || !!refusal || p.money < (bp ?? 0) || qty(b.stock, i) < 1 || !!state.gameOver} onClick={() => act(s => buy(s, b.id, i, 1))}>Acheter</button>}
                    {canSell && <button className="btn sm ghost" disabled={!open || !!refusal || sellBlocked || !!state.gameOver} onClick={() => act(s => sell(s, b.id, i, 1))} title={mine ? `Tu en as ${mine}` : "Tu n'en as pas"}>Vendre</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {refusal && owner && <p className="warn">{fullName(owner)} refuse de traiter avec toi.</p>}

      {b.kind !== 'market' && (
        <div className="work-row">
          <div className="work-info">
            <strong>Travailler</strong>
            <span>{wc.ok ? `${wc.wage} d/h · jusqu'à ${wc.maxHours} h` : wc.reason}</span>
          </div>
          <div className="work-btns">
            {(wc.ok ? Array.from(new Set([2, 4, 8].map(h => Math.min(h, wc.maxHours)))) : [2, 4, 8]).map(h => (
              <button key={h} className="btn sm" disabled={!wc.ok || !!state.gameOver}
                onClick={() => act(s => work(s, b.id, h))}>{h} h</button>
            ))}
          </div>
        </div>
      )}

      {stealable.length > 0 && (
        <details className="crime">
          <summary>Larcin…</summary>
          <div className="crime-row">
            <select value={stealItem} onChange={e => setStealItem(e.target.value as ItemId)}>
              <option value="">Choisir un objet</option>
              {stealable.map(i => <option key={i} value={i}>{ITEMS[i].name}</option>)}
            </select>
            <button className="btn sm danger" disabled={!stealItem || !!state.gameOver} onClick={() => stealItem && act(s => steal(s, b.id, stealItem))}>Dérober</button>
          </div>
          <p className="muted small">Chaque témoin éveillé peut te surprendre. Discrétion {p.skills.discretion}, agilité {p.attributes.agilite}.</p>
        </details>
      )}
    </div>
  );
}

export type { GameState };
