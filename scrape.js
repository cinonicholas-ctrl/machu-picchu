// Robot Machu Picchu — v5 (sigiloso + gentil)
// Se disfraza de navegador normal, va lento y pide poco, para evitar el anti-bot.
const { chromium } = require('playwright');
const fs = require('fs');

const TICKET = process.env.TICKET || 'llaqta_machupicchu';
const URL = `https://tuboleto.cultura.pe/disponibilidad/${TICKET}`;

// Hook de captura + mascara de automatizacion (corre ANTES que los scripts del sitio)
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

(async () => {
  log('======= v5 sigiloso Machu Picchu =======');
  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--disable-features=IsolateOrigins,site-per-process']
  });
  const ctx = await browser.newContext({
    locale: 'es-PE', timezoneId: 'America/Lima',
    viewport: { width: 1366, height: 768 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    extraHTTPHeaders: { 'Accept-Language': 'es-PE,es;q=0.9,en;q=0.8' }
  });
  const page = await ctx.newPage();
  await page.addInitScript(INIT);

  try { await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 }); }
  catch (e) { log('goto aviso:', e.message); }
  await sleep(2000 + Math.random() * 1500);

  // detectar bloqueo temprano
  const early = await page.evaluate(() => (document.body ? document.body.innerText : '')).catch(() => '');
  if (/IP restringida|comportamiento automatizado|403/i.test(early)) {
    log('\\n⛔ BLOQUEADO (403). El sitio rechazo esta IP de GitHub.');
    log('   Texto:', early.slice(0, 200));
    log('   -> Espera ~30-60 min y reintenta; a veces toca otra IP. (Si pasa siempre, es bloqueo del rango de GitHub.)');
    fs.writeFileSync('capture.json', JSON.stringify({ blocked: true, text: early.slice(0, 300) }, null, 2));
    await browser.close(); process.exit(0);
  }

  // espera a que cargue
  let ready = false;
  for (let t = 0; t < 40; t += 2) {
    const st = await page.evaluate(() => ({
      hasInput: !!document.querySelector('#fecha'),
      hasRoutes: (window.__cap || []).some(o => Array.isArray(o) && o[0] && o[0].nidCircuito),
      txt: document.body ? document.body.innerText.length : 0
    })).catch(() => ({}));
    log(`   t=${t}s fecha:${st.hasInput} rutas:${st.hasRoutes} texto:${st.txt}`);
    if (st.hasInput && st.hasRoutes) { ready = true; break; }
    await sleep(2000);
  }

  if (!ready) {
    const txt = await page.evaluate(() => (document.body ? document.body.innerText : '')).catch(() => '');
    log('\\n[!] No cargo a tiempo. Texto visible:', txt.slice(0, 250));
    fs.writeFileSync('capture.json', JSON.stringify({ ready: false, text: txt.slice(0, 300) }, null, 2));
    await browser.close(); process.exit(0);
  }

  const routeList = (await page.evaluate(() => window.__cap || [])).find(o => Array.isArray(o) && o[0] && o[0].nidCircuito);
  log('\\n[rutas]', routeList ? routeList.map(r => `C${r.nidCircuito}R${r.nidRuta} ${r.ruta}`).join(' | ') : 'NO');
  out.routeList = routeList || null;

  // probar 1 fecha (gentil) en la ruta por defecto
  async function tryDate(d) {
    await sleep(1500 + Math.random() * 1500);
    const set = await page.evaluate((d) => {
      const i = document.querySelector('#fecha'); if (!i) return 'NO-INPUT';
      window.__clear();
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(i, d);
      i.dispatchEvent(new Event('input', { bubbles: true }));
      i.dispatchEvent(new Event('change', { bubbles: true }));
      return i.value;
    }, d).catch(e => 'ERR');
    await sleep(5000);
    const c = await page.evaluate(() => window.__cap || []);
    const hor = c.find(o => Array.isArray(o) && o[0] && o[0].dhora_ini);
    log(`\\n[fecha ${d}] input="${set}" | horarios: ${hor ? hor.length : 'NO'}`);
    if (hor) hor.forEach(h => log(`     ${h.dhora_ini}-${h.dhora_fin}  cupos ${h.ncupo_actual}/${h.ncupo}`));
    return hor || null;
  }
  out.fecha = await tryDate('2026-08-15');

  // como estan hechos los menus
  out.selectors = await page.evaluate(() => {
    const all = [...document.querySelectorAll('*')];
    const pick = (re) => all.filter(e => re.test(e.textContent || '') && e.querySelectorAll('*').length <= 2)
      .slice(0, 6).map(e => ({ tag: e.tagName, id: e.id || '', cls: (e.className || '').toString().slice(0, 70), txt: (e.textContent || '').trim().slice(0, 50) }));
    return { circuito: pick(/Circuito [123]/), ruta: pick(/Ruta [123]-/) };
  }).catch(() => ({}));
  log('\\n[menu circuito]'); (out.selectors.circuito || []).forEach(c => log('   ', JSON.stringify(c)));
  log('[menu ruta]'); (out.selectors.ruta || []).forEach(c => log('   ', JSON.stringify(c)));

  fs.writeFileSync('capture.json', JSON.stringify(out, null, 2));
  log('\\n💾 capture.json guardado.');
  await browser.close();
  log('== fin v5 ==');
})();
