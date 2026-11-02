// Visual QA + interaction smoke test against a running EchoSentinel.
//   ES_URL=http://127.0.0.1:8640 ES_USER=admin ES_PASS=... OUT=../docs/screenshots node e2e/visual-qa.mjs
// Exercises navigation, tabs, reconnect, listen, timeline, and captures desktop/tablet/mobile screenshots.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

// Resolved via require so a globally installed Playwright (NODE_PATH=$(npm root -g)) also works.
const { chromium } = createRequire(import.meta.url)('playwright');

const BASE = process.env.ES_URL ?? 'http://127.0.0.1:8640';
const USER = process.env.ES_USER ?? 'admin';
const PASS = process.env.ES_PASS ?? '';
const OUT = process.env.OUT ?? '../docs/screenshots';
const PREFIX = process.env.PREFIX ?? '';
mkdirSync(OUT, { recursive: true });

const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (e) {
    results.push({ name, ok: false, err: String(e).split('\n')[0] });
  }
};

const browser = await chromium.launch();
const errors = [];

async function session(viewport) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: viewport.width < 500 ? 2 : 1, colorScheme: 'dark' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${viewport.width}px pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${viewport.width}px console: ${m.text()}`));
  await page.goto(BASE);
  await page.getByLabel(/username/i).fill(USER);
  await page.getByLabel(/password/i).fill(PASS);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await page.waitForSelector('text=Live Audio Monitor', { timeout: 15000 });
  await page.waitForTimeout(4000); // let live levels / metrics arrive
  return { ctx, page };
}

// ---------------------------------------------------------------- desktop
{
  const { ctx, page } = await session({ width: 1600, height: 900 });
  await page.screenshot({ path: `${OUT}/${PREFIX}desktop-live.png` });

  await check('live: 4 channel cards rendered', async () => {
    for (const n of ['CH01', 'CH02', 'CH03', 'CH04']) await page.getByText(n, { exact: false }).first().waitFor({ timeout: 3000 });
  });
  await check('live: secrets absent from DOM', async () => {
    const html = await page.content();
    if (/s3cretPass|wrongpass/.test(html)) throw new Error('credential found in DOM');
  });
  await check('tabs: AI Recognition tab switches', async () => {
    await page.getByRole('tab', { name: /AI Recognition/i }).click();
    await page.getByRole('tab', { name: /Live Transcription/i }).click();
  });
  await check('reconnect: button on offline card works', async () => {
    const btn = page.getByRole('button', { name: /reconnect/i }).first();
    await btn.click();
  });
  await check('listen: live audio starts', async () => {
    const btn = page.getByRole('button', { name: /^listen|start listening/i }).first();
    await btn.click();
    await page.waitForTimeout(1500);
  });

  for (const [path, name] of [
    ['/recordings', 'recordings'],
    ['/events', 'events'],
    ['/transcripts', 'transcripts'],
    ['/channels', 'channels'],
    ['/analytics', 'analytics'],
    ['/automation', 'automation'],
    ['/system', 'system'],
    ['/settings', 'settings'],
  ]) {
    await check(`nav: ${name}`, async () => {
      await page.goto(BASE + path);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${OUT}/${PREFIX}desktop-${name}.png` });
    });
  }
  await check('timeline: click seeks', async () => {
    await page.goto(BASE + '/recordings');
    await page.waitForTimeout(2000);
    const c = page.locator('canvas').first();
    const box = await c.boundingBox();
    if (!box) throw new Error('no timeline canvas');
    await page.mouse.click(box.x + box.width * 0.8, box.y + box.height / 2);
  });
  await ctx.close();
}

// ---------------------------------------------------------------- tablet + mobile
for (const vp of [
  { width: 820, height: 1180, tag: 'tablet' },
  { width: 390, height: 844, tag: 'mobile' },
]) {
  const { ctx, page } = await session(vp);
  await page.screenshot({ path: `${OUT}/${PREFIX}${vp.tag}-live.png`, fullPage: vp.tag === 'mobile' ? false : true });
  await check(`${vp.tag}: no horizontal overflow`, async () => {
    const w = await page.evaluate(() => document.documentElement.scrollWidth);
    if (w > vp.width + 1) throw new Error(`scrollWidth ${w} > ${vp.width}`);
  });
  await ctx.close();
}

// ---------------------------------------------------------------- reduced motion
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await check('reduced-motion: app loads', async () => {
    await page.goto(BASE);
    await page.getByLabel(/username/i).waitFor();
  });
  await ctx.close();
}

await browser.close();
console.log(JSON.stringify({ results, errors }, null, 2));
process.exit(results.some((r) => !r.ok) ? 1 : 0);
