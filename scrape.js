// Robot Machu Picchu — v15 COLECTOR resiliente (merge: nunca borra lo bueno)
const { chromium } = require('playwright');
const fs = require('fs');

const URL = `https://tuboleto.cultura.pe/${process.env.TICKET || 'llaqta_machupicchu'}`;
const CIRCUITS = (process.env.CIRCUITS || 'Circuito 1|Circuito 2|Circuito 3').split('|');
const MONTHS = parseInt(process.env.MONTHS || '7');
// MODO REBANADA: si pasamos MONTH=YYYY-MM, raspamos SOLO ese mes y escribimos a OUT.
// Así cada job (circuito+mes) corre en su propia IP con poca carga. El merge junta todo.
const OUT = process.env.OUT || 'data.json';
const MONTH = (process.env.MONTH || '').trim();
const SLICE = /^\d{4}-\d{2}$/.test(MONTH);

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

// cargar datos previos (para no borrar lo bueno). En modo rebanada NO cargamos prev:
// solo producimos la rebanada (un circuito + un mes) y el merge la superpone.
let prev = {};
if (!SLICE) {
  try { const p = JSON.parse(fs.readFileSync('data.json', 'utf8')); (p.routes || []).forEach(r => prev[r.id] = r); log('prev cargado:', Object.keys(prev).join(',')); } catch (e) { log('sin prev'); }
  // limpiar meses ya pasados de lo previo (solo guardamos del mes actual en adelante)
  const n = new Date(); const cut = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
  Object.values(prev).forEach(r => { if (r && r.days) { for (const k in r.days) { if (k.slice(0, 7) < cut) delete r.days[k]; } } });
}

(async () => {
  log('======= v15 resiliente =======', CIRCUITS.join(','), 'meses:', MONTHS);
  const t0 = Date.now();
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] });
  const ctx = await browser.newContext({
    locale: 'es-PE', timezoneId: 'America/Lima', viewport: { width: 1366, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    extraHTTPHeaders: { 'Accept-Language': 'es-PE,es;q=0.9,en;q=0.8' }
  });
  const page = await ctx.newPage();
  await page.addInitScript(INIT);

  let fechasOk = 0, blocked = false;
  page.on('response', (r) => {
    const u = r.url();
    if (/consulta-fechas-disponibles/.test(u) && r.status() === 200) fechasOk++;
    if (r.status() === 403) blocked = true;
  });

  try { await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 }); } catch (e) { log('goto:', e.message); }
  if (/IP restringida|automatizado/i.test(await page.evaluate(() => document.body ? document.body.innerText : '').catch(() => ''))) { log('⛔ 403 inicio — no escribo nada (conservo lo previo).'); await browser.close(); process.exit(1); }
  let ready = false;
  for (let t = 0; t < 45; t += 3) { if (await page.locator('mat-select').count().catch(() => 0) >= 2) { ready = true; break; } await sleep(3000); }
  if (!ready) { log('no listo — conservo lo previo.'); await browser.close(); process.exit(1); }
  await sleep(1500);

  const isOpen = async () => (await page.locator('.mat-calendar').count().catch(() => 0)) > 0;
  async function closeCal() { if (await isOpen()) { await page.keyboard.press('Escape').catch(() => {}); await sleep(250); } if (await isOpen()) { await page.locator('.cdk-overlay-backdrop').first().click({ force: true }).catch(() => {}); await sleep(250); } }
  async function openCal() { if (await isOpen()) return; try { await page.locator('mat-datepicker-toggle').first().click({ force: true }); } catch (e) {} await sleep(450); }
  async function pickSelect(idx, contains) {
    await closeCal();
    await page.locator('mat-select').nth(idx).click({ timeout: 8000 }); await sleep(500);
    const o = page.locator('mat-option', { hasText: contains }).first();
    const ok = await o.count(); if (ok) await o.click(); else await page.keyboard.press('Escape');
    await sleep(1500); return !!ok;
  }
  async function optionsOf(idx) {
    await closeCal();
    await page.locator('mat-select').nth(idx).click({ timeout: 8000 }); await sleep(500);
    const opts = await page.locator('mat-option').allInnerTexts().catch(() => []);
    await page.keyboard.press('Escape'); await sleep(300);
    return opts.map(s => s.trim()).filter(Boolean);
  }
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
  // navega y CONFIRMA esperando la respuesta REAL del sitio para ese mes
  async function navConfirm(y, mo) {
    await openCal();
    for (let i = 0; i < 24; i++) {
      const p = parseP(await period());
      if (!p) { await sleep(350); continue; }
      if (p.y === y && p.mo === mo) return true; // llegamos; la respuesta del mes ya se esperó en el paso anterior
      const fwd = (y > p.y) || (y === p.y && mo > p.mo);
      const b = page.locator(fwd ? '.mat-calendar-next-button' : '.mat-calendar-previous-button').first();
      if (!(await b.count())) return false;
      const [resp] = await Promise.all([
        page.waitForResponse(r => /consulta-fechas-disponibles/.test(r.url()), { timeout: 8000 }).catch(() => null),
        b.click().catch(() => {})
      ]);
      if (resp && resp.status() === 403) { blocked = true; return false; }
      await sleep(250);
    }
    return false;
  }
  async function ensureOnMonth(y, mo) { await openCal(); const p = parseP(await period()); if (!p || p.y !== y || p.mo !== mo) await navTo(y, mo); }
  const enabledDays = () => page.evaluate(() => [...document.querySelectorAll('.mat-calendar-body-cell')].filter(c => !c.classList.contains('mat-calendar-body-disabled') && c.getAttribute('aria-disabled') !== 'true').map(c => c.innerText.trim()));
  const clickDay = (d) => page.evaluate((d) => { const t = [...document.querySelectorAll('.mat-calendar-body-cell')].find(c => c.innerText.trim() === String(d) && !c.classList.contains('mat-calendar-body-disabled')); if (t) { t.click(); return true; } return false; }, d);
  async function collectDay(d) {
    await page.evaluate(() => window.__clear());
    const respP = page.waitForResponse(r => /consulta-horarios/.test(r.url()), { timeout: 9000 }).catch(() => null);
    if (!(await clickDay(d))) return null;
    await respP; await sleep(300);
    const cap = await page.evaluate(() => window.__cap || []);
    const h = cap.find(o => Array.isArray(o) && o[0] && o[0].dhora_ini);
    if (!h) return null;
    const sm = {}; h.forEach(x => { sm[x.dhora_ini.slice(0, 2)] = x.ncupo_actual; });
    return { sm, ncupo: Math.max(...h.map(x => x.ncupo || 0)) };
  }

  const result = { updated: new Date().toISOString(), ticket: process.env.TICKET || 'llaqta_machupicchu', sample: false, routes: [] };
  // del mes actual hasta diciembre de este año (cada mes que pasa, la corrida es más corta)
  const now = new Date(); const targets = [];
  if (SLICE) { targets.push({ y: +MONTH.slice(0, 4), mo: +MONTH.slice(5, 7) - 1 }); }
  else { for (let mo = now.getMonth(); mo <= 11; mo++) targets.push({ y: now.getFullYear(), mo }); }

  for (const circuit of CIRCUITS) {
    if (blocked) break;
    log('\\n#### ' + circuit + ' ####');
    if (!(await pickSelect(0, circuit))) continue;
    const rutas = await optionsOf(1);
    for (const ruta of rutas) {
      if (blocked) break;
      await pickSelect(0, circuit); await pickSelect(1, ruta.slice(0, 8));
      const idm = ruta.match(/(\d)\s*-\s*([A-Z])/);
      const id = idm ? idm[1] + idm[2] : ruta.slice(0, 6);
      const desc = ruta.includes(':') ? ruta.split(':')[1].trim() : ruta;
      const pr = prev[id] || { days: {}, slots: [], cap: 0 };
      const route = { id, group: circuit, name: `Circuito ${id[0]}-${id[1]} · ${desc}`, slots: [], cap: pr.cap || 0, updated: new Date().toISOString(), meses: targets.length, mesesOk: 0, days: Object.assign({}, pr.days) };
      const slotSet = new Set(pr.slots || []);
      let okMonths = 0, badMonths = 0;
      const tR = Date.now();
      for (const { y, mo } of targets) {
        if (blocked) break;
        const confirmed = await navConfirm(y, mo);
        if (!confirmed) { badMonths++; continue; } // mes no confirmado: conservo lo previo
        okMonths++;
        const en = new Set(await enabledDays());
        for (let d = 1; d <= daysInMonth(y, mo); d++) {
          if (blocked) break;
          const key = `${y}-${pad(mo + 1)}-${pad(d)}`;
          if (!en.has(String(d))) { route.days[key] = null; continue; }
          await ensureOnMonth(y, mo);
          const r = await collectDay(d);
          if (r && r.sm) { route.days[key] = r.sm; Object.keys(r.sm).forEach(s => slotSet.add(s)); if (r.ncupo > route.cap) route.cap = r.ncupo; }
          else if (!route.days[key]) route.days[key] = {};
        }
        if (blocked) break;
      }
      route.slots = [...slotSet].sort();
      route.mesesOk = okMonths;
      result.routes.push(route);
      // escribir merge (incluye rutas previas no tocadas)
      const seen = new Set(result.routes.map(r => r.id));
      const merged = result.routes.concat(Object.values(prev).filter(r => !seen.has(r.id)));
      fs.writeFileSync(OUT, JSON.stringify(Object.assign({}, result, { routes: merged })));
      log(`  ${id}: ${okMonths} meses ok, ${badMonths} sin confirmar | ${((Date.now() - tR) / 60000).toFixed(1)} min`);
    }
  }

  // asegurar que TODAS las rutas previas sigan en el archivo
  const seen = new Set(result.routes.map(r => r.id));
  result.routes = result.routes.concat(Object.values(prev).filter(r => !seen.has(r.id)));
  fs.writeFileSync(OUT, JSON.stringify(result));
  fs.writeFileSync('capture.json', JSON.stringify({ blocked, mins: ((Date.now() - t0) / 60000).toFixed(1), rutas: result.routes.map(r => r.id) }, null, 2));
  log('\\n💾 data.json (merge). Rutas:', result.routes.map(r => r.id).join(','), '| bloqueado:', blocked, '|', ((Date.now() - t0) / 60000).toFixed(1), 'min');
  await browser.close();
  log('== fin v15 ==');
  // si hubo 403, salgo con error: ya no se recupera en esta sesión, mejor que el workflow espere y reintente
  if (blocked) { log('⛔ 403 detectado — paro aquí para no perder tiempo; el workflow esperará y reintentará.'); process.exit(1); }
})();
