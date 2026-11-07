import { useState } from 'react';
import {
  activeContract, applyForJob, businessesForSale, deliver, jobOffer, openOrders, quitJob, takeOrder,
  buyHome, carryCapacity, found, FOUNDABLE, FOUNDING_COST, hasAccess, ITEM_IDS, leaveHome, ownerOrder, propertiesAt, purchaseBusiness,
  purchaseOffer, rentHome, RECIPES, settlementIdOf, store, takeOut, weightOf, WEIGHT, type BusinessKind, type Property,
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
  // des brigands en embuscade ne se laissent pas identifier
  const people = charactersAt(state, loc.id).filter(c => c.activity.kind !== 'ambush');
  const masked = charactersAt(state, loc.id).length - people.length;
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
          {masked > 0 && <p className="warn">{masked} silhouette{masked > 1 ? 's' : ''} masquée{masked > 1 ? 's' : ''}.</p>}
          {people.length === 0 && !masked && <p className="muted">Il n'y a personne ici pour l'instant.</p>}
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
          {propertiesAt(state, loc.id).map(pr => <PropertyCard key={pr.id} game={game} pr={pr} />)}
          {loc.kind === 'square' && <NoticeBoard game={game} />}
          {loc.kind === 'square' && <FoundingCard game={game} />}
          {biz.length === 0 && loc.kind !== 'square' && <p className="muted">Aucun commerce ici.</p>}
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

      <ContractRow game={game} b={b} />
      {b.ownerId === p.id ? <OwnerPanel game={game} b={b} /> : <PurchaseRow game={game} b={b} />}

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

function ContractRow({ game, b }: { game: Game; b: Business }) {
  const { state, act } = game;
  const p = state.characters[state.playerId];
  const k = activeContract(state, p.id);
  const mine = state.orders.filter(o => o.status === 'taken' && o.takerId === p.id && o.businessId === b.id);
  const sale = businessesForSale(state).find(x => x.b.id === b.id);
  const over = !!state.gameOver;
  if (b.kind === 'market' && !mine.length && !sale) return null;
  const offer = jobOffer(state, b, p);
  return (
    <div className="contract-row">
      {k && k.businessId === b.id ? (
        <div className="work-row">
          <div className="work-info"><strong>Ta place</strong><span>{k.wage} d/h · {k.hoursThisWeek}/{k.hoursPerWeek} h cette semaine{k.strikes ? ` · ${k.strikes} avertissement` : ''}</span></div>
          <button className="btn sm ghost" disabled={over} onClick={() => act(quitJob)}>Démissionner</button>
        </div>
      ) : b.kind !== 'market' && (
        <div className="work-row">
          <div className="work-info"><strong>Place salariée</strong><span>{offer.ok ? `${offer.wage} d/h garantis, ${offer.hours} h par semaine au minimum` : offer.reason}</span></div>
          <button className="btn sm" disabled={!offer.ok || over} onClick={() => act(s => applyForJob(s, b.id))}>Demander</button>
        </div>
      )}
      {mine.map(o => (
        <div key={o.id} className="work-row">
          <div className="work-info"><strong>Commande à livrer</strong><span>{o.qty - o.delivered} {ITEMS[o.item].plural} à {o.unitPrice} d · tu en as {qty(p.inventory, o.item)} · avant le jour {o.deadlineDay + 1}</span></div>
          <button className="btn sm" disabled={qty(p.inventory, o.item) < 1 || over} onClick={() => act(s => deliver(s, o.id))}>Livrer</button>
        </div>
      ))}
      {sale && <p className="muted small">À vendre : {sale.price} d {sale.seller ? `(${fullName(state.characters[sale.seller])} veut céder son affaire)` : '(sous tutelle de l’intendance)'}.</p>}
    </div>
  );
}

function NoticeBoard({ game }: { game: Game }) {
  const { state, act } = game;
  const p = state.characters[state.playerId];
  const orders = openOrders(state, settlementIdOf(state, p.locationId));
  const mine = state.orders.filter(o => o.status === 'taken' && o.takerId === p.id);
  return (
    <div className="board">
      <h3 className="sub">Tableau des commandes</h3>
      <p className="muted small">Les établissements en pénurie y affichent leurs besoins. Livrer à temps rapporte un bon prix et la confiance du client ; manquer sa parole se paie.</p>
      {orders.length === 0 && <p className="muted">Aucune commande affichée pour l'instant.</p>}
      <ul className="orders">
        {orders.map(o => (
          <li key={o.id}>
            <span className="ico">{ITEM_ICON[o.item]}</span>
            <div><b>{o.qty} {ITEMS[o.item].plural}</b> pour {state.businesses[o.businessId].name}<div className="muted small">{o.unitPrice} d pièce · 3 jours pour livrer</div></div>
            <button className="btn sm" disabled={!!state.gameOver || mine.length >= 2} onClick={() => act(s => takeOrder(s, o.id))}>Accepter</button>
          </li>
        ))}
      </ul>
      {mine.length > 0 && <p className="small">Tes commandes en cours : {mine.map(o => `${o.qty - o.delivered} ${ITEMS[o.item].plural} → ${state.businesses[o.businessId].name}`).join(' ; ')}</p>}
    </div>
  );
}

function PurchaseRow({ game, b }: { game: Game; b: Business }) {
  const { state, act } = game;
  const p = state.characters[state.playerId];
  if (b.kind === 'manor') return null;
  const o = purchaseOffer(state, b, p);
  return (
    <div className="work-row">
      <div className="work-info"><strong>Racheter l'affaire</strong><span>{o.ok ? `${o.price} d${o.seller ? ` à ${fullName(state.characters[o.seller])}` : ' à l’intendance'}` : o.reason}</span></div>
      <button className="btn sm" disabled={!o.ok || p.money < o.price || !!state.gameOver} onClick={() => act(s => purchaseBusiness(s, b.id))}>Racheter</button>
    </div>
  );
}

function OwnerPanel({ game, b }: { game: Game; b: Business }) {
  const { state, act } = game;
  const over = !!state.gameOver;
  const outputs = b.kind === 'market' ? b.sells : (Object.keys(RECIPES[b.kind]?.outputs ?? {}) as ItemId[]);
  return (
    <div className="owner">
      <div className="owner-head"><strong>Ton affaire</strong><span className="muted small">Ton contremaître achète, vend et embauche selon tes consignes.</span></div>
      <div className="owner-grid">
        <span>Caisse</span><b>{b.treasury} d</b>
        <div className="slot-btns"><button className="btn sm ghost" disabled={over || b.treasury < 1} onClick={() => act(s => ownerOrder(s, b.id, { kind: 'withdraw', amount: 50 }))}>Retirer 50</button><button className="btn sm ghost" disabled={over} onClick={() => act(s => ownerOrder(s, b.id, { kind: 'deposit', amount: 50 }))}>Déposer 50</button></div>
        <span>Salaire</span><b>{b.wage} d/h</b>
        <div className="slot-btns"><button className="btn sm ghost" disabled={over} onClick={() => act(s => ownerOrder(s, b.id, { kind: 'wage', delta: -1 }))}>−</button><button className="btn sm ghost" disabled={over} onClick={() => act(s => ownerOrder(s, b.id, { kind: 'wage', delta: 1 }))}>+</button></div>
        <span>Ouvriers</span><b>{b.employees.length}/{b.maxWorkers}</b>
        <div className="slot-btns"><button className="btn sm ghost" disabled={over} onClick={() => act(s => ownerOrder(s, b.id, { kind: 'workers', delta: -1 }))}>−</button><button className="btn sm ghost" disabled={over} onClick={() => act(s => ownerOrder(s, b.id, { kind: 'workers', delta: 1 }))}>+</button></div>
        {outputs.map(it => (
          <FragmentRow key={it} label={`Stock visé ${ITEM_ICON[it]}`} value={`${b.targets[it] ?? 0}`}
            minus={() => act(s => ownerOrder(s, b.id, { kind: 'target', item: it, factor: 0.75 }))}
            plus={() => act(s => ownerOrder(s, b.id, { kind: 'target', item: it, factor: 1.33 }))} disabled={over} />
        ))}
      </div>
    </div>
  );
}

function FragmentRow({ label, value, minus, plus, disabled }: { label: string; value: string; minus: () => void; plus: () => void; disabled: boolean }) {
  return (<>
    <span>{label}</span><b>{value}</b>
    <div className="slot-btns"><button className="btn sm ghost" disabled={disabled} onClick={minus}>−</button><button className="btn sm ghost" disabled={disabled} onClick={plus}>+</button></div>
  </>);
}

function PropertyCard({ game, pr }: { game: Game; pr: Property }) {
  const { state, act } = game;
  const p = state.characters[state.playerId];
  const mine = hasAccess(pr, p);
  const over = !!state.gameOver;
  const [item, setItem] = useState<ItemId>('grain');
  const owner = pr.ownerId === p.id ? 'toi' : pr.ownerId ? fullName(state.characters[pr.ownerId]) : 'l’intendance';
  const status = pr.ownerId === p.id ? 'Ta maison' : pr.tenantId === p.id ? `Ta location · ${pr.weeklyRent} d chaque lundi` : pr.tenantId ? 'Déjà louée' : 'Libre';
  return (
    <div className="biz property">
      <div className="biz-head">
        <div><div className="biz-name">{pr.name}</div><div className="biz-meta">{status} · propriétaire : {owner} · coffre {pr.storageCap} (poids)</div></div>
        <div className="biz-till">{pr.price ? `${pr.price} d` : 'location'}</div>
      </div>
      {!mine && (
        <div className="work-row">
          <div className="work-info"><span>{pr.weeklyRent} d par semaine{pr.price && !pr.ownerId ? ` · à vendre ${pr.price} d` : ''}</span></div>
          <div className="work-btns">
            <button className="btn sm" disabled={over || !!pr.tenantId || p.money < pr.weeklyRent} onClick={() => act(s => rentHome(s, pr.id))}>Louer</button>
            {pr.price > 0 && !pr.ownerId && <button className="btn sm" disabled={over || p.money < pr.price} onClick={() => act(s => buyHome(s, pr.id))}>Acheter</button>}
          </div>
        </div>
      )}
      {mine && (
        <div className="storage">
          <div className="small">Coffre : {ITEM_IDS.filter(i => qty(pr.storage, i)).map(i => `${ITEM_ICON[i]} ${qty(pr.storage, i)}`).join('  ') || 'vide'} · {weightOf(pr.storage)}/{pr.storageCap} — Besace : {weightOf(p.inventory)}/{carryCapacity(p)}</div>
          <div className="crime-row">
            <select id={`item-${pr.id}`} value={item} onChange={e => setItem(e.target.value as ItemId)}>
              {ITEM_IDS.map(i => <option key={i} value={i}>{ITEMS[i].name} (poids {WEIGHT[i]})</option>)}
            </select>
            <button className="btn sm ghost" disabled={over || qty(p.inventory, item) < 1} onClick={() => act(s => store(s, pr.id, item, qty(p.inventory, item)))}>Tout ranger ({qty(p.inventory, item)})</button>
            <button className="btn sm ghost" disabled={over || qty(pr.storage, item) < 1} onClick={() => act(s => takeOut(s, pr.id, item, Math.min(qty(pr.storage, item), Math.floor((carryCapacity(p) - weightOf(p.inventory)) / WEIGHT[item]))))}>Prendre</button>
            {pr.tenantId === p.id && <button className="btn sm ghost" disabled={over} onClick={() => act(s => leaveHome(s, pr.id))}>Rendre le logement</button>}
          </div>
        </div>
      )}
    </div>
  );
}

function FoundingCard({ game }: { game: Game }) {
  const { state, act } = game;
  const p = state.characters[state.playerId];
  const [capital, setCapital] = useState(100);
  const names: Partial<Record<BusinessKind, string>> = { market: 'Comptoir de négoce', bakery: 'Boulangerie', tavern: 'Cabaret', forge: 'Atelier de forge' };
  return (
    <details className="board founding">
      <summary className="sub">Fonder un établissement</summary>
      <p className="muted small">L’intendance vend un terrain et fait bâtir ; le fonds de roulement part dans la caisse de la nouvelle affaire. Un comptoir achète et revend de tout : idéal pour stocker ce que tu rapportes d’ailleurs.</p>
      <label className="small" htmlFor="capital">Fonds de roulement : <b>{capital} d</b></label>
      <input id="capital" type="range" min={50} max={400} step={25} value={capital} onChange={e => setCapital(Number(e.target.value))} />
      <ul className="orders">
        {FOUNDABLE.map(k => (
          <li key={k}>
            <span className="ico">🏗</span>
            <div><b>{names[k]}</b><div className="muted small">{FOUNDING_COST[k]} d de travaux + {capital} d</div></div>
            <button className="btn sm" disabled={!!state.gameOver || p.money < (FOUNDING_COST[k] ?? 0) + capital} onClick={() => act(s => found(s, k, capital))}>Fonder</button>
          </li>
        ))}
      </ul>
    </details>
  );
}

export type { GameState };
