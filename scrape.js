// Robot Machu Picchu — v14 COLECTOR (rápido: espera por respuesta de red, no por tiempo fijo)
const { chromium } = require('playwright');
const fs = require('fs');

const URL = `https://tuboleto.cultura.pe/${process.env.TICKET || 'llaqta_machupicchu'}`;
const CIRCUITS = (process.env.CIRCUITS || 'Circuito 1|Circuito 2|Circuito 3').split('|');
const MONTHS = parseInt(process.env.MONTHS || '7');

const INIT = `
(() => {
  try { Object.defineProperty(navigator,'webdriver',{get:()=>undefined});
    Object.defineProperty(navigator,'languages',{get:()=>['es-PE','es','en']});
    Object.defineProperty(navigator,'plugins',{get:()=>[1,2,3,4,5]}); window.chrome={runtime:{}}; } catch(e){}
  const orig=JSON.parse; window.__cap=[];
  JSON.parse=function(){const r=orig.apply(this,arguments);try{const s=JSON.stringify(r);if(/dhora_ini|ncupo/i.test(s))window.__cap.push(r);}catch(e){}return r;};
  window.__clear=()=>{window.__cap=[];};
})();
`;
const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const pad = (n) => String(n).padStart(2, '0');
const MAB = { ENE: 0, FEB: 1, MAR: 2, ABR: 3, MAY: 4, JUN: 5, JUL: 6, AGO: 7, SET: 8, SEP: 8, OCT: 9, NOV: 10, DIC: 11 };
const daysInMonth = (y, mo) => new Date(y, mo + 1, 0).getDate();

(async () => {
  log('======= v14 COLECTOR rápido =======', CIRCUITS.join(','), 'meses:', MONTHS);
  const t0 = Date.now();
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] });
  const ctx = await browser.newContext({
    locale: 'es-PE', timezoneId: 'America/Lima', viewport: { width: 1366, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    extraHTTPHeaders: { 'Accept-Language': 'es-PE,es;q=0.9,en;q=0.8' }
  });
  const page = await ctx.newPage();
  await page.addInitScript(INIT);
  const isBlocked = async () => /IP restringida|automatizado/i.test(await page.evaluate(() => document.body ? document.body.innerText : '').catch(() => ''));

  try { await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 }); } catch (e) { log('goto:', e.message); }
  if (await isBlocked()) { log('⛔ 403 inicio'); fs.writeFileSync('capture.json', '{"blocked":true}'); await browser.close(); process.exit(1); }
  let ready = false;
  for (let t = 0; t < 45; t += 3) { if (await page.locator('mat-select').count().catch(() => 0) >= 2) { ready = true; break; } await sleep(3000); }
  if (!ready) { fs.writeFileSync('capture.json', '{"ready":false}'); await browser.close(); process.exit(1); }
  await sleep(1500);

  async function closeCal() {
    if (await isOpen()) { await page.keyboard.press('Escape').catch(() => {}); await sleep(250); }
    if (await isOpen()) { await page.locator('.cdk-overlay-backdrop').first().click({ force: true }).catch(() => {}); await sleep(250); }
  }
  async function pickSelect(idx, contains) {
    await closeCal();
    await page.locator('mat-select').nth(idx).click({ timeout: 8000 }); await sleep(500);
    const o = page.locator('mat-option', { hasText: contains }).first();
    const ok = await o.count(); if (ok) await o.click(); else await page.keyboard.press('Escape');
    await sleep(1500); return !!ok;
  }
  async function optionsOf(idx) {
    await page.locator('mat-select').nth(idx).click({ timeout: 8000 }); await sleep(500);
    const opts = await page.locator('mat-option').allInnerTexts().catch(() => []);
    await page.keyboard.press('Escape'); await sleep(300);
    return opts.map(s => s.trim()).filter(Boolean);
  }
  const isOpen = async () => (await page.locator('.mat-calendar').count().catch(() => 0)) > 0;
  async function openCal() { if (await isOpen()) return; try { await page.locator('mat-datepicker-toggle').first().click({ force: true }); } catch (e) {} await sleep(450); }
  const period = () => page.evaluate(() => { const p = document.querySelector('.mat-calendar-period-button'); return p ? p.innerText.trim() : ''; }).catch(() => '');
  function parseP(s) { const m = s.match(/([A-Z]{3})\.?\s*(\d{4})/i); return m ? { mo: MAB[m[1].toUpperCase()], y: +m[2] } : null; }
  async function navTo(y, mo) {
    await openCal();
    for (let i = 0; i < 20; i++) {
      const p = parseP(await period()); if (!p) { await sleep(400); continue; }
      if (p.y === y && p.mo === mo) return true;
      const fwd = (y > p.y) || (y === p.y && mo > p.mo);
      const b = page.locator(fwd ? '.mat-calendar-next-button' : '.mat-calendar-previous-button').first();
      if (!(await b.count())) return false;
      await b.click().catch(() => {}); await sleep(650);
    }
    return false;
  }
  async function ensureOnMonth(y, mo) {
    await openCal();
    const p = parseP(await period());
    if (!p || p.y !== y || p.mo !== mo) await navTo(y, mo);
  }
  const enabledDays = () => page.evaluate(() => [...document.querySelectorAll('.mat-calendar-body-cell')].filter(c => !c.classList.contains('mat-calendar-body-disabled') && c.getAttribute('aria-disabled') !== 'true').map(c => c.innerText.trim()));
  const clickDay = (d) => page.evaluate((d) => { const t = [...document.querySelectorAll('.mat-calendar-body-cell')].find(c => c.innerText.trim() === String(d) && !c.classList.contains('mat-calendar-body-disabled')); if (t) { t.click(); return true; } return false; }, d);

  async function collectDay(d) {
    await page.evaluate(() => window.__clear());
    const respP = page.waitForResponse(r => /consulta-horarios/.test(r.url()), { timeout: 9000 }).catch(() => null);
    const ok = await clickDay(d);
    if (!ok) return {};
    await respP;
    await sleep(300); // que el sitio desencripte y haga JSON.parse
    const cap = await page.evaluate(() => window.__cap || []);
    const h = cap.find(o => Array.isArray(o) && o[0] && o[0].dhora_ini);
    if (!h) return {};
    const sm = {}; h.forEach(x => { sm[x.dhora_ini.slice(0, 2)] = x.ncupo_actual; });
    return { sm, ncupo: Math.max(...h.map(x => x.ncupo || 0)) };
  }

  const result = { updated: new Date().toISOString(), ticket: process.env.TICKET || 'llaqta_machupicchu', sample: false, routes: [] };
  const now = new Date(); const targets = [];
  for (let m = 0; m < MONTHS; m++) { const dt = new Date(now.getFullYear(), now.getMonth() + m, 1); targets.push({ y: dt.getFullYear(), mo: dt.getMonth() }); }

  let blocked = false;
  for (const circuit of CIRCUITS) {
    if (blocked) break;
    log('\\n#### ' + circuit + ' ####');
    if (!(await pickSelect(0, circuit))) { log('  no pude elegir', circuit); continue; }
    const rutas = await optionsOf(1);
    log('  rutas:', rutas.length);
    for (const ruta of rutas) {
      if (blocked) break;
      await pickSelect(0, circuit);
      await pickSelect(1, ruta.slice(0, 8));
      const idm = ruta.match(/(\d)\s*-\s*([A-Z])/);
      const id = idm ? idm[1] + idm[2] : ruta.slice(0, 6);
      const desc = ruta.includes(':') ? ruta.split(':')[1].trim() : ruta;
      const route = { id, group: circuit, name: `Circuito ${id[0]}-${id[1]} · ${desc}`, slots: [], cap: 0, days: {} };
      const slotSet = new Set();
      const tR = Date.now();
      for (const { y, mo } of targets) {
        if (!(await navTo(y, mo))) continue;
        const en = new Set(await enabledDays());
        for (let d = 1; d <= daysInMonth(y, mo); d++) {
          const key = `${y}-${pad(mo + 1)}-${pad(d)}`;
          if (!en.has(String(d))) { route.days[key] = null; continue; }
          await ensureOnMonth(y, mo);
          const r = await collectDay(d);
          if (r.sm) { route.days[key] = r.sm; Object.keys(r.sm).forEach(s => slotSet.add(s)); if (r.ncupo > route.cap) route.cap = r.ncupo; }
          else route.days[key] = {};
        }
        if (await isBlocked()) { log('  ⛔ 403 — guardo parcial y paro.'); blocked = true; break; }
      }
      route.slots = [...slotSet].sort();
      result.routes.push(route);
      fs.writeFileSync('data.json', JSON.stringify(result));
      log(`  ✓ ${id}: ${Object.keys(route.days).length} dias en ${((Date.now() - tR) / 1000 / 60).toFixed(1)} min`);
    }
  }

  fs.writeFileSync('data.json', JSON.stringify(result));
  fs.writeFileSync('capture.json', JSON.stringify({ blocked, mins: ((Date.now() - t0) / 60000).toFixed(1), routes: result.routes.map(r => ({ id: r.id, dias: Object.keys(r.days).length, cap: r.cap })) }, null, 2));
  log('\\n💾 data.json listo. Rutas:', result.routes.map(r => r.id).join(', '), '| total', ((Date.now() - t0) / 60000).toFixed(1), 'min');
  await browser.close();
  log('== fin v14 ==');
})();
