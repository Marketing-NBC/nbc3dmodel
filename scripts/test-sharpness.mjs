/**
 * Scherpte tijdens beweging meten (zie src/quality.js).
 *
 * Laadt de viewer, sleept de camera en meet de scherpte (variantie van de
 * Laplaciaan, hoger = scherper) van een frame midden in de beweging versus
 * een stilstaand, uitgeconvergeerd frame. Dat doet hij voor de oude situatie
 * (motion-sharpening uit) en voor de nieuwe (aan), optioneel voor meerdere
 * alphaMoving-waarden: `node scripts/test-sharpness.mjs 0.35 0.5 0.65`.
 *
 * Screenshots: scene-inspection/sharpness-<label>-{moving,static}.png
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const alphas = process.argv.slice(2).map(Number).filter((n) => n > 0 && n < 1);
const scene = process.env.SCENE || 'congres';
const W = Number(process.env.W || 900), H = Number(process.env.H || 560);
// px muisbeweging per gerenderd frame; klein (≈1) bootst een echte GPU op 60-120 fps na
const STEP = Number(process.env.STEP || 1);
const STEPS = Number(process.env.STEPS || 30);

mkdirSync('scene-inspection', { recursive: true });
const server = spawn('node', ['scripts/serve.mjs'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Laplaciaan-variantie van een PNG (grijswaarden), in de pagina berekend. */
async function sharpness(page, png) {
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
    const g = new Float32Array(width * height);
    for (let i = 0; i < width * height; i++) g[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    let sum = 0, sum2 = 0, n = 0;
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x;
        const l = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - width] - g[i + width];
        sum += l; sum2 += l * l; n++;
      }
    }
    const mean = sum / n;
    return sum2 / n - mean * mean;
  }, png.toString('base64'));
}

const frames = (page) => page.evaluate(() => window.__frames || 0);

/** Wacht tot er ~600 ms geen frame meer gerenderd is (TAA uitgeconvergeerd). */
async function settle(page, timeout = 60000) {
  const t0 = Date.now();
  let last = await frames(page), lastChange = Date.now();
  while (Date.now() - t0 < timeout) {
    await wait(150);
    const f = await frames(page);
    if (f !== last) { last = f; lastChange = Date.now(); }
    else if (Date.now() - lastChange > 600) return;
  }
}

/** Sleep de camera in stapjes; wacht per stap op minstens één nieuw frame. */
async function drag(page, dir) {
  const cx = W / 2, cy = H / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= STEPS; i++) {
    const before = await frames(page);
    await page.mouse.move(cx + dir * i * STEP, cy + i * STEP * 0.4);
    const t0 = Date.now();
    while ((await frames(page)) === before && Date.now() - t0 < 1500) await wait(20);
  }
}

async function measure(page, label, dir) {
  await drag(page, dir);
  const moving = await page.screenshot();
  await page.mouse.up();
  const sMoving = await sharpness(page, moving);
  await settle(page);
  const still = await page.screenshot({ path: `scene-inspection/sharpness-${label}-static.png` });
  const sStatic = await sharpness(page, still);
  const { writeFileSync } = await import('node:fs');
  writeFileSync(`scene-inspection/sharpness-${label}-moving.png`, moving);
  const ratio = sMoving / sStatic;
  console.log(`${label.padEnd(18)} bewegend ${sMoving.toFixed(1).padStart(7)}  stil ${sStatic.toFixed(1).padStart(7)}  verhouding ${(ratio * 100).toFixed(0)}%`);
  return { label, moving: sMoving, static: sStatic, ratio };
}

try {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await page.route('**://www.gstatic.com/draco/**', (route) => {
    const file = route.request().url().split('/').pop();
    route.fulfill({ path: `node_modules/three/examples/jsm/libs/draco/${file}` }).catch(() => route.abort());
  });
  await page.route('**://unpkg.com/@splinetool/**', (route) => {
    const m = route.request().url().match(/@splinetool\/([a-z-]+)@[^/]+\/(.+)$/);
    if (!m) return route.abort();
    route.fulfill({ path: `node_modules/@splinetool/${m[1]}/${m[2]}` }).catch(() => route.abort());
  });
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('console:', m.text().slice(0, 200)); });

  // vaste pixel ratio 1 en geen adaptieve stap (software-rendering is altijd "traag")
  await page.addInitScript(() => {
    window.NBC3D_QUALITY = { pixelRatio: 1, adaptive: false };
    window.__frames = 0;
    document.addEventListener('rendered', () => { window.__frames++; }, true);
  });

  const cfg = Buffer.from(JSON.stringify({ scenes: [scene], tooltips: false })).toString('base64url');
  await page.goto(`http://127.0.0.1:8787/viewer/#c=${cfg}`);
  await page.waitForSelector('#status.hidden', { timeout: 240000 });
  const st = await page.evaluate(() => window.__nbc3d.quality.state);
  console.log('quality state:', JSON.stringify({ taaPatched: st.taaPatched, pixelRatio: st.pixelRatio, params: st.params }));
  if (!st.taaPatched) throw new Error('TAA-shader is niet gepatcht');
  await settle(page);

  const results = [];
  await page.evaluate(() => window.__nbc3d.quality.setMotionSharpening(false));
  results.push(await measure(page, 'oud-zonder-fix', 1));
  await page.evaluate(() => window.__nbc3d.quality.setMotionSharpening(true));
  results.push(await measure(page, 'nieuw-standaard', -1));
  let dir = 1;
  for (const a of alphas) {
    await page.evaluate((alphaMoving) => window.__nbc3d.quality.setTaaParams({ alphaMoving }), a);
    results.push(await measure(page, `nieuw-alpha-${a}`, dir));
    dir = -dir;
  }
  const oud = results[0], nieuw = results[1];
  console.log(`\nScherpte in beweging t.o.v. stilstand: oud ${(oud.ratio * 100).toFixed(0)}% → nieuw ${(nieuw.ratio * 100).toFixed(0)}%`);
  if (nieuw.ratio <= oud.ratio) { console.log('FAIL: geen verbetering'); process.exitCode = 1; }
  else console.log('OK');
} finally {
  await browser.close();
  server.kill();
}
