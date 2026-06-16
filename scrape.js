// Robot Machu Picchu — v13 COLECTOR (escribe data.json real)
// Recorre circuitos/rutas -> meses -> dias con cupo -> cupos por horario.
// Primera carga: solo Circuito 2 (para no gatillar el anti-bot). Luego se expande.
const { chromium } = require('playwright');
const fs = require('fs');

const URL = `https://tuboleto.cultura.pe/${process.env.TICKET || 'llaqta_machupicchu'}`;
const CIRCUITS = (process.env.CIRCUITS || 'Circuito 2').split('|');   // ej "Circuito 1|Circuito 2|Circuito 3"
const MONTHS = parseInt(process.env.MONTHS || '7');
const DAY_WAIT = 3500;

const INIT = `
(() => {
  try { Object.defineProperty(navigator,'webdriver',{get:()=>undefined});
    Object.defineProperty(navigator,'languages',{get:()=>['es-PE','es','en']});
    Object.defineProperty(navigator,'plugins',{get:()=>[1,2,3,4,5]}); window.chrome={runtime:{}}; } catch(e){}
  const orig=JSON.parse; window.__cap=[];
  JSON.parse=function(){const r=orig.apply(this,arguments);try{const s=JSON.stringify(r);if(/dhora_ini|dfecha|ncupo/i.test(s))window.__cap.push(r);}catch(e){}return r;};
  window.__clear=()=>{window.__cap=[];};
})();
`;
const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const pad = (n) => String(n).padStart(2, '0');
const MAB = { ENE: 0, FEB: 1, MAR: 2, ABR: 3, MAY: 4, JUN: 5, JUL: 6, AGO: 7, SET: 8, SEP: 8, OCT: 9, NOV: 10, DIC: 11 };
const daysInMonth = (y, mo) => new Date(y, mo + 1, 0).getDate();

(async () => {
  log('======= v13 COLECTOR =======', 'circuitos:', CIRCUITS.join(','), 'meses:', MONTHS);
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] });
  const ctx = await browser.newContext({
    locale: 'es-PE', timezoneId: 'America/Lima', viewport: { width: 1366, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    extraHTTPHeaders: { 'Accept-Language': 'es-PE,es;q=0.9,en;q=0.8' }
  });
  const page = await ctx.newPage();
  await page.addInitScript(INIT);

  let blocked = false;
  const isBlocked = async () => { const b = await page.evaluate(() => document.body ? document.body.innerText : '').catch(() => ''); return /IP restringida|automatizado/i.test(b); };

  try { await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 }); } catch (e) { log('goto:', e.message); }
  if (await isBlocked()) { log('⛔ 403 al inicio. Reintenta luego.'); fs.writeFileSync('capture.json', '{"blocked":true}'); await browser.close(); process.exit(1); }
  let ready = false;
  for (let t = 0; t < 45; t += 3) { if (await page.locator('mat-select').count().catch(() => 0) >= 2) { ready = true; break; } await sleep(3000); }
  if (!ready) { log('no listo'); fs.writeFileSync('capture.json', '{"ready":false}'); await browser.close(); process.exit(1); }
  await sleep(2000);

  // helpers de menus
  async function pickSelect(idx, contains) {
    await page.locator('mat-select').nth(idx).click({ timeout: 8000 }); await sleep(700);
    const o = page.locator('mat-option', { hasText: contains }).first();
    const ok = await o.count();
    if (ok) await o.click(); else await page.keyboard.press('Escape');
    await sleep(2200);
    return !!ok;
  }
  async function optionsOf(idx) {
    await page.locator('mat-select').nth(idx).click({ timeout: 8000 }); await sleep(700);
    const opts = await page.locator('mat-option').allInnerTexts().catch(() => []);
    await page.keyboard.press('Escape'); await sleep(400);
    return opts.map(s => s.trim()).filter(Boolean);
  }
  // calendario
  const isOpen = async () => (await page.locator('.mat-calendar').count().catch(() => 0)) > 0;
  async function openCal() { if (await isOpen()) return; try { await page.locator('mat-datepicker-toggle').first().click({ force: true }); } catch (e) {} await sleep(1200); }
  async function period() { return page.evaluate(() => { const p = document.querySelector('.mat-calendar-period-button'); return p ? p.innerText.trim() : ''; }).catch(() => ''); }
  function parsePeriod(s) { const m = s.match(/([A-Z]{3})\.?\s*(\d{4})/i); if (!m) return null; return { mo: MAB[m[1].toUpperCase()], y: +m[2] }; }
  async function navTo(y, mo) {
    await openCal();
    for (let i = 0; i < 20; i++) {
      const p = parsePeriod(await period()); if (!p) { await sleep(600); continue; }
      if (p.y === y && p.mo === mo) return true;
      const fwd = (y > p.y) || (y === p.y && mo > p.mo);
      const btn = page.locator(fwd ? '.mat-calendar-next-button' : '.mat-calendar-previous-button').first();
      if (!(await btn.count())) return false;
      await btn.click().catch(() => {}); await sleep(900);
    }
    return false;
  }
  async function enabledDays() { return page.evaluate(() => [...document.querySelectorAll('.mat-calendar-body-cell')].filter(c => !c.classList.contains('mat-calendar-body-disabled') && c.getAttribute('aria-disabled') !== 'true').map(c => c.innerText.trim())); }
  async function clickDay(d) { return page.evaluate((d) => { const t = [...document.querySelectorAll('.mat-calendar-body-cell')].find(c => c.innerText.trim() === String(d) && !c.classList.contains('mat-calendar-body-disabled')); if (t) { t.click(); return true; } return false; }, d); }

  const result = { updated: new Date().toISOString(), ticket: process.env.TICKET || 'llaqta_machupicchu', sample: false, routes: [] };

  // meses objetivo: desde hoy
  const now = new Date();
  const targets = [];
  for (let m = 0; m < MONTHS; m++) { const dt = new Date(now.getFullYear(), now.getMonth() + m, 1); targets.push({ y: dt.getFullYear(), mo: dt.getMonth() }); }

  for (const circuit of CIRCUITS) {
    log('\\n#### ' + circuit + ' ####');
    if (!(await pickSelect(0, circuit))) { log('  no pude elegir', circuit); continue; }
    const rutas = await optionsOf(1);
    log('  rutas:', JSON.stringify(rutas));
    for (const ruta of rutas) {
      if (blocked) break;
      await pickSelect(0, circuit);              // re-asegurar circuito
      await pickSelect(1, ruta.slice(0, 8));     // elegir ruta por su inicio "Ruta 2-A"
      const idm = ruta.match(/(\d)\s*-\s*([A-Z])/);
      const id = idm ? idm[1] + idm[2] : ruta.slice(0, 6);
      const desc = ruta.includes(':') ? ruta.split(':')[1].trim() : ruta;
      const route = { id, group: circuit, name: `Circuito ${id[0]}-${id[1]} · ${desc}`, slots: [], cap: 0, days: {} };
      const slotSet = new Set();
      log('  -- Ruta', id, '--');

      for (const { y, mo } of targets) {
        if (!(await navTo(y, mo))) { log(`     no llegue a ${y}-${mo + 1}`); continue; }
        const en = new Set(await enabledDays());
        log(`     ${y}-${pad(mo + 1)}: ${en.size} dias con cupo`);
        for (let d = 1; d <= daysInMonth(y, mo); d++) {
          const key = `${y}-${pad(mo + 1)}-${pad(d)}`;
          if (!en.has(String(d))) { route.days[key] = null; continue; }
          await navTo(y, mo);
          await page.evaluate(() => window.__clear());
          if (!(await clickDay(d))) { route.days[key] = {}; continue; }
          await sleep(DAY_WAIT);
          const cap = await page.evaluate(() => window.__cap || []);
          const h = cap.find(o => Array.isArray(o) && o[0] && o[0].dhora_ini);
          if (h) { const sm = {}; h.forEach(x => { const s = x.dhora_ini.slice(0, 2); sm[s] = x.ncupo_actual; slotSet.add(s); if (x.ncupo > route.cap) route.cap = x.ncupo; }); route.days[key] = sm; }
          else route.days[key] = {};
          if (await isBlocked()) { log('     ⛔ 403 a mitad — guardo lo que tengo y paro.'); blocked = true; break; }
        }
        if (blocked) break;
      }
      route.slots = [...slotSet].sort();
      result.routes.push(route);
      fs.writeFileSync('data.json', JSON.stringify(result));   // guardado incremental
      log('     guardado parcial: ' + route.id + ' (' + Object.keys(route.days).length + ' dias)');
      if (blocked) break;
    }
    if (blocked) break;
  }

  fs.writeFileSync('data.json', JSON.stringify(result));
  fs.writeFileSync('capture.json', JSON.stringify({ blocked, routes: result.routes.map(r => ({ id: r.id, dias: Object.keys(r.days).length, slots: r.slots, cap: r.cap })) }, null, 2));
  log('\\n💾 data.json escrito. Rutas:', result.routes.map(r => r.id).join(', '));
  await browser.close();
  log('== fin v13 ==');
})();
