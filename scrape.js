// Robot Machu Picchu — v3 RECON
// 1) Usa el campo de fecha nativo (#fecha) para pedir horarios reales de fechas concretas
//    (default = Ruta 1-A Montaña) -> primer dato para validar contra la realidad.
// 2) Vuelca como estan hechos los menus de circuito/ruta para poder cambiarlos luego.
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

(async () => {
  log('======= RECON v3 Machu Picchu =======');
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

  // ruta por defecto seleccionada
  let cap = await page.evaluate(() => window.__cap || []);
  const routeList = cap.find(o => Array.isArray(o) && o[0] && o[0].nidCircuito);
  log('\\n[rutas] ', routeList ? routeList.map(r => `C${r.nidCircuito}R${r.nidRuta} ${r.ruta}`).join(' | ') : 'no');

  // ---- Probar el campo de fecha con varias fechas ----
  async function tryDate(d) {
    const set = await page.evaluate((d) => {
      const i = document.querySelector('#fecha');
      if (!i) return 'NO-INPUT';
      window.__clear();
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(i, d);
      i.dispatchEvent(new Event('input', { bubbles: true }));
      i.dispatchEvent(new Event('change', { bubbles: true }));
      return i.value;
    }, d);
    await page.waitForTimeout(5000);
    const c = await page.evaluate(() => window.__cap || []);
    const hor = c.find(o => Array.isArray(o) && o[0] && (o[0].dhora_ini || o[0].dhora_ini === ''));
    log(`\\n[fecha ${d}] input quedo en "${set}" | horarios capturados: ${hor ? hor.length : 'NO'}`);
    if (hor) hor.forEach(h => log(`     ${h.dhora_ini}-${h.dhora_fin}  cupos ${h.ncupo_actual} / ${h.ncupo}`));
    return hor || null;
  }

  out.fechaCercana = await tryDate('2026-06-20');
  out.fechaMedia   = await tryDate('2026-08-15');
  out.fechaLejana  = await tryDate('2026-11-15');

  // ---- Volcar como estan hechos los menus de circuito/ruta ----
  const selectors = await page.evaluate(() => {
    const all = [...document.querySelectorAll('*')];
    const pick = (re) => all
      .filter(e => re.test((e.textContent || '')) && e.querySelectorAll('*').length <= 2)
      .slice(0, 6)
      .map(e => ({ tag: e.tagName, id: e.id || '', cls: (e.className || '').toString().slice(0, 70), txt: (e.textContent || '').trim().slice(0, 50) }));
    return { circuito: pick(/Circuito [123]/), ruta: pick(/Ruta [123]-/) };
  });
  log('\\n[menu circuito] candidatos:');
  selectors.circuito.forEach(c => log('   ', JSON.stringify(c)));
  log('[menu ruta] candidatos:');
  selectors.ruta.forEach(c => log('   ', JSON.stringify(c)));
  out.selectors = selectors;

  fs.writeFileSync('capture.json', JSON.stringify(out, null, 2));
  log('\\n💾 capture.json guardado.');
  await browser.close();
  log('\\n== fin recon v3 ==');
})();
