// Robot Machu Picchu — v2 RECONOCIMIENTO
// Objetivo: ver como esta armada la pagina por dentro (selectores) y probar
// navegar circuito -> ruta -> fecha para gatillar los cupos por dia/hora.
// Captura todo con el hook JSON.parse y reporta en el log + capture.json.
const { chromium } = require('playwright');
const fs = require('fs');

const TICKET = process.env.TICKET || 'llaqta_machupicchu';
const URL = `https://tuboleto.cultura.pe/disponibilidad/${TICKET}`;

const INIT = `
(() => {
  const orig = JSON.parse;
  window.__cap = [];
  JSON.parse = function () {
    const r = orig.apply(this, arguments);
    try {
      const s = JSON.stringify(r);
      if (/dfecha|dhora|ncupo|cupo|dispon/i.test(s)) window.__cap.push(r);
    } catch (e) {}
    return r;
  };
  window.__clear = () => { window.__cap = []; };
})();
`;

const log = (...a) => console.log(...a);
const out = { when: new Date().toISOString(), url: URL, steps: [] };
function rec(label, data) { out.steps.push({ label, data }); }

(async () => {
  log('======= RECON Machu Picchu =======');
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] });
  const ctx = await browser.newContext({
    locale: 'es-PE', timezoneId: 'America/Lima',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  });
  const page = await ctx.newPage();
  await page.addInitScript(INIT);

  try { await page.goto(URL, { waitUntil: 'networkidle', timeout: 90000 }); }
  catch (e) { log('goto aviso:', e.message); }
  await page.waitForTimeout(7000);

  // ---- 1) Inventario de controles ----
  const selCount = await page.locator('mat-select').count().catch(() => -1);
  log('\\n[1] mat-select encontrados:', selCount);
  for (let i = 0; i < (selCount > 0 ? selCount : 0); i++) {
    const txt = await page.locator('mat-select').nth(i).innerText().catch(() => '(?)');
    log(`    mat-select[${i}] texto: ${JSON.stringify(txt)}`);
  }
  rec('mat-select-count', selCount);

  // inputs (para encontrar el de fecha)
  const inputs = await page.locator('input').elementHandles().catch(() => []);
  log('\\n[2] inputs encontrados:', inputs.length);
  const inputInfo = [];
  for (let i = 0; i < inputs.length; i++) {
    const info = await inputs[i].evaluate(el => ({
      type: el.getAttribute('type'), placeholder: el.getAttribute('placeholder'),
      name: el.getAttribute('name'), cls: el.className, html: el.outerHTML.slice(0, 160)
    })).catch(() => ({}));
    inputInfo.push(info);
    log(`    input[${i}]:`, JSON.stringify(info));
  }
  rec('inputs', inputInfo);

  // datepicker?
  const tgl = await page.locator('mat-datepicker-toggle, [class*=datepicker]').count().catch(() => 0);
  log('\\n[3] elementos tipo datepicker:', tgl);
  rec('datepicker-count', tgl);

  // ---- 4) lista de rutas (de la carga inicial) ----
  let cap = await page.evaluate(() => window.__cap || []);
  const routeList = cap.find(o => Array.isArray(o) && o[0] && o[0].nidCircuito);
  log('\\n[4] lista de rutas detectada:', routeList ? routeList.length + ' rutas' : 'NO');
  if (routeList) routeList.forEach(r => log(`    C${r.nidCircuito} R${r.nidRuta} | ${r.ruta} | ncupo ${r.ncupo} act ${r.ncupoActual}`));
  rec('routeList', routeList || null);

  // ---- 5) intentar seleccionar Circuito 2 -> Ruta 2-A ----
  async function pickSelect(idx, contains) {
    log(`\\n[5] abriendo mat-select[${idx}] para elegir "${contains}"...`);
    await page.locator('mat-select').nth(idx).click({ timeout: 8000 });
    await page.waitForTimeout(800);
    const opts = await page.locator('mat-option').allInnerTexts().catch(() => []);
    log('    opciones visibles:', JSON.stringify(opts));
    rec(`options-select-${idx}`, opts);
    const opt = page.locator('mat-option', { hasText: contains }).first();
    if (await opt.count()) { await opt.click(); log('    -> click en opcion con', contains); }
    else { log('    !! no encontre opcion con', contains); await page.keyboard.press('Escape'); }
    await page.waitForTimeout(1500);
  }

  try {
    await page.evaluate(() => window.__clear());
    if (selCount >= 1) await pickSelect(0, 'Circuito 2');
    if (selCount >= 2) await pickSelect(1, '2-A');
    await page.waitForTimeout(3000);
    cap = await page.evaluate(() => window.__cap || []);
    const fechas = cap.find(o => Array.isArray(o) && o[0] && o[0].dfecha);
    log('\\n[6] fechas-disponibles tras elegir circuito/ruta:', fechas ? fechas.length + ' dias' : 'NO capturado');
    if (fechas) log('    primeras:', JSON.stringify(fechas.slice(0, 8)));
    rec('fechas', fechas || null);
    const horarios = cap.find(o => Array.isArray(o) && o[0] && o[0].dhora_ini);
    log('    horarios capturados de una vez?:', horarios ? horarios.length : 'NO');
    rec('horarios', horarios || null);
  } catch (e) {
    log('\\n[!] error en seleccion:', e.message);
    rec('select-error', e.message);
  }

  // ---- 6) volcar HTML del formulario para análisis ----
  const formHtml = await page.locator('form, .container, app-root').first().innerHTML().catch(() => '');
  out.formHtmlSnippet = formHtml.slice(0, 6000);

  fs.writeFileSync('capture.json', JSON.stringify(out, null, 2));
  log('\\n💾 capture.json guardado (descárgalo de Artifacts si hace falta).');
  await browser.close();
  log('\\n== fin recon ==');
})();
