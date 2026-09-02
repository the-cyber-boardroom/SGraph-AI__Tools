import fs from 'node:fs';
import { launch, context, sleep } from '../scripts/browser.mjs';
const S = process.env.S;
for (const [label, url] of [['cross-origin sgit.ai/vault', 'https://sgit.ai/vault/'], ['same-origin tools page', 'http://localhost:10063/en-gb/video-creator/']]) {
  const browser = await launch({ args: ['--auto-select-tab-capture-source-by-title=POC', '--use-fake-ui-for-media-stream', '--auto-accept-this-tab-capture'] });
  const ctx = await context(browser); const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') {} });
  await page.goto('http://localhost:10063/en-gb/capture-poc.html', { waitUntil: 'load' });
  await page.fill('#url', url); await page.click('#load'); await sleep(6000);
  await page.click('#dom'); await page.click('#svg'); await sleep(1500); await page.click('#display'); await sleep(4000);
  const log = await page.evaluate(() => document.querySelector('#log').textContent);
  console.log(`--- ${label}\n${log.trim()}`);
  const shot = await page.evaluate(() => window.__poc.shot || null);
  if (shot) fs.writeFileSync(`${S}/poc-${label.split(' ')[0]}.png`, Buffer.from(shot.split(',')[1], 'base64'));
  await page.screenshot({ path: `${S}/poc-page-${label.split(' ')[0]}.png` });
  await browser.close();
}
