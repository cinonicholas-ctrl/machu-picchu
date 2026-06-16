// Robot Machu Picchu — v6 (disparar consulta con metodo correcto + probar Ruta 2-A)
const { chromium } = require('playwright');
const fs = require('fs');

const TICKET = process.env.TICKET || 'llaqta_machupicchu';
const URL = `https://tuboleto.cultura.pe/disponibilidad/${TICKET}`;

const INIT = `
(() => {
  try {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'languages', { get: () => ['es-PE','es','en'] });
    Object.defineProperty(navigator, 'plugins', { get: () => [1,2,3,4,5] });
    window.chrome = { runtime: {} };
  } catch(e) {}
  const orig = JSON.parse;
  window.__cap = [];
  JSON.parse = function () {
    const r = orig.apply(this, arguments);
    try { const s = JSON.stringify(r);
      if (/dfecha|dhora|ncupo|cupo|dispon/i.test(s)) window.__cap.push(r);
    } catch (e) {}
    return r;
  };
  window.__clear = () => { window.__cap = []; };
})();
`;
const log = (...a) => console.log(...a);
const out = { when: new Date().toISOString(), url: URL };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const getCap = (page) => page.evaluate(() => window.__cap || []);
const findFechas = (c) => c.find(o => Array.isArray(o) && o[0] && o[0].dfecha);
const findHor = (c) => c.find(o => Array.isArray(o) && o[0] && o[0].dhora_ini);

(async () => {
  log('======= v6 Machu Picchu =======');
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] });
  const ctx = await browser.newContext({
    locale: 'es-PE', timezoneId: 'America/Lima', viewport: { width: 1366, height: 768 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    extraHTTPHeaders: { 'Accept-Language': 'es-PE,es;q=0.9,en;q=0.8' }
  });
  const page = await ctx.newPage();
  await page.addInitScript(INIT);
  try { await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 }); } catch (e) { log('goto:', e.message); }

  const body = await page.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');
  if (/IP restringida|comportamiento automatizado/i.test(body)) { log('\\n⛔ BLOQUEADO 403. Espera y reintenta.'); fs.writeFileSync('capture.json', JSON.stringify({ blocked: true })); await browser.close(); process.exit(0); }

  // esperar listo
  let ready = false;
  for (let t = 0; t < 40; t += 2) {
    const ok = await page.evaluate(() => !!document.querySelector('#fecha')).catch(() => false);
    if (ok) { ready = true; break; }
    await sleep(2000);
  }
  log('[listo]:', ready);
  if (!ready) { fs.writeFileSync('capture.json', JSON.stringify({ ready: false })); await browser.close(); process.exit(0); }
  await sleep(2000);

  function printFechas(label, c) {
    const f = findFechas(c);
    if (f) {
      const dias = f.map(x => x.dfecha);
      log(`   [${label}] dias disponibles: ${dias.length} | primeros: ${dias.slice(0,5).join(', ')} | ultimos: ${dias.slice(-3).join(', ')}`);
    } else log(`   [${label}] dias disponibles: NO capturado`);
  }
  function printHor(label, c) {
    const h = findHor(c);
    if (h) { log(`   [${label}] horarios: ${h.length}`); h.forEach(x => log(`        ${x.dhora_ini}-${x.dhora_fin}  cupos ${x.ncupo_actual}/${x.ncupo}`)); }
    else log(`   [${label}] horarios: NO`);
  }

  // ---- A) poner fecha con page.fill (metodo nativo de Playwright) en ruta por defecto ----
  log('\\n[A] ruta por defecto + fill fecha 2026-08-15');
  await page.evaluate(() => window.__clear());
  try { await page.fill('#fecha', '2026-08-15'); } catch (e) { log('   fill error:', e.message); }
  await sleep(5000);
  let c = await getCap(page); printFechas('A', c); printHor('A', c);

  // ---- B) intentar seleccionar Ruta 2-A clickeando su texto, luego fill ----
  log('\\n[B] click en "Ruta 2-A" + fechas');
  await page.evaluate(() => window.__clear());
  try {
    const loc = page.getByText('2-A', { exact: false }).first();
    if (await loc.count()) { await loc.click({ timeout: 5000 }); log('   click 2-A ok'); }
    else log('   no encontre texto 2-A clickeable');
  } catch (e) { log('   click 2-A error:', e.message); }
  await sleep(4000);
  c = await getCap(page); printFechas('B-tras-click', c);
  // elegir una fecha disponible si la hay, si no usar 2026-10-01
  let target = '2026-10-01';
  const f = findFechas(c);
  if (f && f.length) { const p = f[Math.floor(f.length / 2)].dfecha.split('-'); target = `${p[2]}-${p[1]}-${p[0]}`; }
  log('   probando fecha:', target);
  await page.evaluate(() => window.__clear());
  try { await page.fill('#fecha', target); } catch (e) { log('   fill error:', e.message); }
  await sleep(5000);
  c = await getCap(page); printHor('B', c);

  // ---- C) volcar elementos cercanos a #fecha y posibles selects custom ----
  out.aroundFecha = await page.evaluate(() => {
    const i = document.querySelector('#fecha');
    let html = '';
    let p = i;
    for (let k = 0; k < 4 && p; k++) { p = p.parentElement; }
    if (p) html = p.outerHTML.slice(0, 1500);
    // posibles dropdowns
    const drops = [...document.querySelectorAll('select, [role=listbox], [class*=select], [class*=dropdown]')]
      .slice(0, 8).map(e => ({ tag: e.tagName, cls: (e.className || '').toString().slice(0, 60) }));
    return { html, drops };
  }).catch(() => ({}));
  log('\\n[C] dropdowns detectados:', JSON.stringify((out.aroundFecha.drops || [])));

  out.cap = await getCap(page);
  fs.writeFileSync('capture.json', JSON.stringify(out, null, 2));
  log('\\n💾 capture.json guardado.');
  await browser.close();
  log('== fin v6 ==');
})();
