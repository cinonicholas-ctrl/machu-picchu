// Robot Machu Picchu — v10: leer el calendario (dias habilitados = con cupo) por varios meses
const { chromium } = require('playwright');
const fs = require('fs');

const URL = `https://tuboleto.cultura.pe/${process.env.TICKET || 'llaqta_machupicchu'}`;
const INIT = `
(() => {
  try { Object.defineProperty(navigator,'webdriver',{get:()=>undefined});
    Object.defineProperty(navigator,'languages',{get:()=>['es-PE','es','en']});
    Object.defineProperty(navigator,'plugins',{get:()=>[1,2,3,4,5]}); window.chrome={runtime:{}}; } catch(e){}
  const orig=JSON.parse; window.__cap=[];
  JSON.parse=function(){const r=orig.apply(this,arguments);try{const s=JSON.stringify(r);if(/dfecha|dhora|ncupo|cupo/i.test(s))window.__cap.push(r);}catch(e){}return r;};
  window.__clear=()=>{window.__cap=[];};
})();
`;
const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const out = { meses: [] };

(async () => {
  log('======= v10 leer calendario =======');
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] });
  const ctx = await browser.newContext({
    locale: 'es-PE', timezoneId: 'America/Lima', viewport: { width: 1366, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    extraHTTPHeaders: { 'Accept-Language': 'es-PE,es;q=0.9,en;q=0.8' }
  });
  const page = await ctx.newPage();
  await page.addInitScript(INIT);
  try { await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 }); } catch (e) { log('goto:', e.message); }

  const b0 = await page.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');
  if (/IP restringida|automatizado/i.test(b0)) { log('⛔ 403 bloqueado, reintenta luego.'); fs.writeFileSync('capture.json', '{"blocked":true}'); await browser.close(); process.exit(0); }

  let ready = false;
  for (let t = 0; t < 45; t += 3) { if (await page.locator('mat-select').count().catch(() => 0) >= 2) { ready = true; break; } await sleep(3000); }
  log('[listo]:', ready); if (!ready) { fs.writeFileSync('capture.json', '{"ready":false}'); await browser.close(); process.exit(0); }
  await sleep(2000);

  async function pick(idx, contains) {
    await page.locator('mat-select').nth(idx).click({ timeout: 8000 });
    await sleep(800);
    const opt = page.locator('mat-option', { hasText: contains }).first();
    if (await opt.count()) await opt.click(); else await page.keyboard.press('Escape');
    await sleep(2500);
  }
  log('[1] Circuito 2 / Ruta 2-A');
  await pick(0, 'Circuito 2');
  await pick(1, '2-A');
  await sleep(2500);

  // asegurar calendario abierto (sin clickear el toggle que choca con el backdrop)
  let hasCal = await page.locator('.mat-calendar-body-cell').count().catch(() => 0);
  if (!hasCal) {
    log('   calendario no abierto, intento abrir el input...');
    try { await page.locator('input.mat-datepicker-input').click({ force: true }); await sleep(1500); } catch (e) {}
    hasCal = await page.locator('.mat-calendar-body-cell').count().catch(() => 0);
  }
  log('   celdas de calendario:', hasCal);

  async function readMonth() {
    return page.evaluate(() => {
      const period = document.querySelector('.mat-calendar-period-button');
      const cells = [...document.querySelectorAll('.mat-calendar-body-cell')];
      const enabled = cells.filter(c => !c.classList.contains('mat-calendar-body-disabled') && c.getAttribute('aria-disabled') !== 'true').map(c => (c.innerText || '').trim());
      return { mes: period ? period.innerText.trim() : '?', total: cells.length, enabled };
    }).catch(() => ({ err: 1 }));
  }

  log('\\n[2] Dias disponibles por mes (Circuito 2 / Ruta 2-A):');
  for (let m = 0; m < 7; m++) {
    const r = await readMonth();
    log(`   ${r.mes}: ${r.enabled && r.enabled.length ? r.enabled.join(', ') : '(ninguno)'}`);
    out.meses.push(r);
    const next = page.locator('.mat-calendar-next-button').first();
    if (await next.count() && !(await next.getAttribute('disabled'))) { await next.click().catch(() => {}); await sleep(1200); }
    else break;
  }

  // un horario de muestra: clic en el primer dia habilitado del mes actual
  log('\\n[3] Horarios de muestra (primer dia habilitado del mes mostrado):');
  try {
    await page.evaluate(() => window.__clear());
    const cell = page.locator('.mat-calendar-body-cell:not(.mat-calendar-body-disabled)').first();
    if (await cell.count()) { await cell.click(); await sleep(4000); }
    const c = await page.evaluate(() => window.__cap || []);
    const h = c.find(o => Array.isArray(o) && o[0] && o[0].dhora_ini);
    if (h) { h.forEach(x => log(`   ${x.dhora_ini}-${x.dhora_fin} cupos ${x.ncupo_actual}/${x.ncupo}`)); out.horarios = h; }
    else log('   NO capturado');
  } catch (e) { log('   error:', e.message); }

  fs.writeFileSync('capture.json', JSON.stringify(out, null, 2));
  log('\\n💾 capture.json guardado.');
  await browser.close();
  log('== fin v10 ==');
})();
