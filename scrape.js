// Robot Machu Picchu — v9: manejar los menus (mat-select) + calendario en la pagina de compra
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
const out = {};
const getCap = (p) => p.evaluate(() => window.__cap || []);
const findFechas = (c) => c.find(o => Array.isArray(o) && o[0] && o[0].dfecha);
const findHor = (c) => c.find(o => Array.isArray(o) && o[0] && o[0].dhora_ini);

(async () => {
  log('======= v9 manejar menus =======');
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] });
  const ctx = await browser.newContext({
    locale: 'es-PE', timezoneId: 'America/Lima', viewport: { width: 1366, height: 768 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    extraHTTPHeaders: { 'Accept-Language': 'es-PE,es;q=0.9,en;q=0.8' }
  });
  const page = await ctx.newPage();
  await page.addInitScript(INIT);
  try { await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 }); } catch (e) { log('goto:', e.message); }

  const b0 = await page.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');
  if (/IP restringida|automatizado/i.test(b0)) { log('⛔ 403 bloqueado, reintenta luego.'); fs.writeFileSync('capture.json', '{"blocked":true}'); await browser.close(); process.exit(0); }

  // esperar mat-select
  let ready = false;
  for (let t = 0; t < 45; t += 3) { const n = await page.locator('mat-select').count().catch(() => 0); if (n >= 2) { ready = true; break; } await sleep(3000); }
  log('[listo mat-select]:', ready);
  if (!ready) { fs.writeFileSync('capture.json', '{"ready":false}'); await browser.close(); process.exit(0); }
  await sleep(2000);

  async function openSelectAndPick(idx, contains) {
    await page.locator('mat-select').nth(idx).click({ timeout: 8000 });
    await sleep(900);
    const opts = await page.locator('mat-option').allInnerTexts().catch(() => []);
    log(`   select[${idx}] opciones: ${JSON.stringify(opts)}`);
    const opt = page.locator('mat-option', { hasText: contains }).first();
    if (await opt.count()) { await opt.click(); log(`   -> elegido "${contains}"`); }
    else { log(`   !! no hay opcion "${contains}"`); await page.keyboard.press('Escape'); }
    await sleep(2500);
  }

  log('\\n[1] Circuito 2');
  await openSelectAndPick(0, 'Circuito 2');
  log('[2] Ruta 2-A');
  await openSelectAndPick(1, '2-A');

  await sleep(3500);
  let c = await getCap(page);
  const f = findFechas(c);
  log('\\n[3] DIAS DISPONIBLES (Circuito 2 / Ruta 2-A):');
  if (f) { const d = f.map(x => x.dfecha); log(`   total: ${d.length}`); log('   ' + d.join(', ')); }
  else log('   NO capturado');
  out.fechas2A = f || null;

  // abrir calendario y ver dias habilitados/deshabilitados
  log('\\n[4] calendario: intentar abrir y leer dias');
  try {
    const tgl = page.locator('mat-datepicker-toggle button, mat-datepicker-toggle').first();
    if (await tgl.count()) { await tgl.click(); await sleep(1500); }
    const cal = await page.evaluate(() => {
      const period = document.querySelector('.mat-calendar-period-button, mat-calendar .mat-calendar-period-button');
      const cells = [...document.querySelectorAll('.mat-calendar-body-cell')];
      const enabled = cells.filter(c => !c.classList.contains('mat-calendar-body-disabled') && c.getAttribute('aria-disabled') !== 'true').map(c => (c.innerText || '').trim());
      const disabled = cells.filter(c => c.classList.contains('mat-calendar-body-disabled') || c.getAttribute('aria-disabled') === 'true').map(c => (c.innerText || '').trim());
      return { mes: period ? period.innerText.trim() : '(?)', total: cells.length, habilitados: enabled, deshabilitados: disabled.length };
    }).catch(e => ({ err: e.message }));
    log('   mes mostrado:', cal.mes, '| celdas:', cal.total, '| deshabilitados:', cal.deshabilitados);
    log('   dias habilitados:', JSON.stringify(cal.habilitados));
    out.calendario = cal;

    // clic en el primer dia habilitado -> horarios
    await page.evaluate(() => window.__clear());
    const firstEnabled = page.locator('.mat-calendar-body-cell:not(.mat-calendar-body-disabled)').first();
    if (await firstEnabled.count()) { await firstEnabled.click(); log('   -> clic en primer dia habilitado'); await sleep(4000); }
    c = await getCap(page);
    const h = findHor(c);
    log('\\n[5] HORARIOS del dia elegido:');
    if (h) h.forEach(x => log(`   ${x.dhora_ini}-${x.dhora_fin}  cupos ${x.ncupo_actual}/${x.ncupo}`));
    else log('   NO capturado');
    out.horarios = h || null;
  } catch (e) { log('   error calendario:', e.message); }

  fs.writeFileSync('capture.json', JSON.stringify(out, null, 2));
  log('\\n💾 capture.json guardado.');
  await browser.close();
  log('== fin v9 ==');
})();
