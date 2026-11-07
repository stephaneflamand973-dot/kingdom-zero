// Vérifie dans un vrai navigateur (Playwright requis) que l’ambiance sonore produit un signal,
// qu’elle se coupe et se rétablit : `npx vite preview` puis `node scripts/check-sound.cjs [url]`.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 1280, height: 860 } });
  await pg.addInitScript(() => localStorage.clear());
  await pg.goto(process.argv[2] ?? 'http://localhost:4173/');
  await pg.waitForSelector('.topbar');
  const lvl = () => pg.evaluate(() => window.kingdomZeroSound.level());
  const max = async ms => { let m = 0; for (let t = 0; t < ms; t += 50) { m = Math.max(m, await lvl()); await pg.waitForTimeout(50); } return m; };
  console.log('avant tout geste', (await lvl()).toFixed(4));
  await pg.mouse.click(5, 300); // geste utilisateur
  console.log('état', await pg.evaluate(() => window.kingdomZeroSound.ready));
  console.log('ambiance (max sur 2 s)', (await max(2000)).toFixed(4));
  await pg.keyboard.press('a'); // action -> bruitage
  console.log('après une action (max 0,5 s)', (await max(500)).toFixed(4));
  await pg.keyboard.press('s'); // couper
  await pg.waitForTimeout(2500);
  console.log('son coupé (max 1 s)', (await max(1000)).toFixed(5));
  await pg.keyboard.press('s');
  await pg.waitForTimeout(2000);
  console.log('son rétabli (max 1 s)', (await max(1000)).toFixed(4));
  await b.close();
})();
