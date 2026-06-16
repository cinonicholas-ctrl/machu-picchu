// Robot Machu Picchu — v12: clic robusto en el dia + abrir menu horario
const { chromium } = require('playwright');
const fs = require('fs');

const URL = `https://tuboleto.cultura.pe/${process.env.TICKET || 'llaqta_machupicchu'}`;
const INIT = `
(() => {
  try { Object.defineProperty(navigator,'webdriver',{get:()=>undefined});
    Object.defineProperty(navigator,'languages',{get:()=>['es-PE','es','en']});
    Object.defineProperty(navigator,'plugins',{get:()=>[1,2,3,4,5]}); window.chrome={runtime:{}}; } catch(e){}
  const orig=JSON.parse; window.__cap=[];
  JSON.parse=function(){const r=orig.apply(this,arguments);try{const s=JSON.stringify(r);if(/dfecha|dhora|ncupo|cupo|tarifa|horario/i.test(s))window.__cap.push(r);}catch(e){}return r;};
  window.__clear=()=>{window.__cap=[];};
})();
`;
const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const out = {};
const dumpCap = async (page, label) => {
  const cap = await page.evaluate(() => window.__cap || []);
  log(`   [${label}] capturados: ${cap.length}`);
  cap.forEach((o, i) => { if (Array.isArray(o) && o[0]) log(`      [${i}] array ${o.length} llaves:${Object.keys(o[0]).join(',')}`); });
  return cap;
};

(async () => {
  log('======= v12 =======');
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] });
  const ctx = await browser.newContext({
    locale: 'es-PE', timezoneId: 'America/Lima', viewport: { width: 1366, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    extraHTTPHeaders: { 'Accept-Language': 'es-PE,es;q=0.9,en;q=0.8' }
  });
  const page = await ctx.newPage();
  await page.addInitScript(INIT);
  page.on('response', (r) => { const u = r.url(); if (/consulta-|horario|tarifa/i.test(u)) log('   [red]', r.status(), u.replace('https://api-tuboleto.cultura.pe', '')); });

  try { await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 }); } catch (e) { log('goto:', e.message); }
  const b0 = await page.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');
  if (/IP restringida|automatizado/i.test(b0)) { log('⛔ 403, reintenta luego.'); fs.writeFileSync('capture.json', '{"blocked":true}'); await browser.close(); process.exit(0); }
  let ready = false;
  for (let t = 0; t < 45; t += 3) { if (await page.locator('mat-select').count().catch(() => 0) >= 2) { ready = true; break; } await sleep(3000); }
  if (!ready) { log('no listo'); fs.writeFileSync('capture.json', '{"ready":false}'); await browser.close(); process.exit(0); }
  await sleep(2000);

  async function pick(idx, contains) {
    await page.locator('mat-select').nth(idx).click({ timeout: 8000 }); await sleep(800);
    const o = page.locator('mat-option', { hasText: contains }).first();
    if (await o.count()) await o.click(); else await page.keyboard.press('Escape');
    await sleep(2500);
  }
  log('[1] Circuito 2 / Ruta 2-A');
  await pick(0, 'Circuito 2'); await pick(1, '2-A'); await sleep(1500);

  log('[2] navegar a NOV 2026');
  for (let i = 0; i < 8; i++) {
    const mes = await page.evaluate(() => { const p = document.querySelector('.mat-calendar-period-button'); return p ? p.innerText.trim() : ''; }).catch(() => '');
    if (/NOV/i.test(mes)) { log('   en', mes); break; }
    const next = page.locator('.mat-calendar-next-button').first();
    if (await next.count()) { await next.click().catch(() => {}); await sleep(1200); } else break;
  }

  // listar celdas habilitadas (para confirmar formato del texto)
  const cells = await page.evaluate(() => [...document.querySelectorAll('.mat-calendar-body-cell')].slice(0, 40).map(c => ({ t: c.innerText.trim(), dis: c.classList.contains('mat-calendar-body-disabled') })));
  log('[3] primeras celdas:', JSON.stringify(cells.filter(c => !c.dis).slice(0, 8)));

  log('[4] clic en dia 15 (via DOM)');
  await page.evaluate(() => window.__clear());
  const clicked = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('.mat-calendar-body-cell')];
    const t = cells.find(c => c.innerText.trim() === '15' && !c.classList.contains('mat-calendar-body-disabled'));
    if (t) { t.click(); return true; } return false;
  });
  log('   clic 15:', clicked);
  await sleep(6000);
  await dumpCap(page, 'tras clic dia');

  log('\\n[5] abrir menu HORARIO (mat-select 2) y ver');
  try {
    await page.locator('mat-select').nth(2).click({ timeout: 6000 }); await sleep(1500);
    const opts = await page.locator('mat-option').allInnerTexts().catch(() => []);
    log('   opciones horario:', JSON.stringify(opts));
    out.horarioOpts = opts;
    await page.keyboard.press('Escape');
  } catch (e) { log('   error abrir horario:', e.message); }
  await sleep(1500);
  const cap = await dumpCap(page, 'tras abrir horario');

  const h = cap.find(o => Array.isArray(o) && o[0] && o[0].dhora_ini);
  log('\\n[6] HORARIOS:');
  if (h) h.forEach(x => log(`   ${x.dhora_ini}-${x.dhora_fin} cupos ${x.ncupo_actual}/${x.ncupo}`));
  else log('   NO en formato dhora_ini — revisa llaves arriba / opciones de horario');
  out.cap = cap;

  fs.writeFileSync('capture.json', JSON.stringify(out, null, 2));
  log('\\n💾 capture.json guardado.');
  await browser.close();
  log('== fin v12 ==');
})();
