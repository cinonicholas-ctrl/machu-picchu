// Robot Machu Picchu — v4 RECON (espera inteligente + diagnostico)
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
  log('======= RECON v4 Machu Picchu =======');
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] });
  const ctx = await browser.newContext({
    locale: 'es-PE', timezoneId: 'America/Lima',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  });
  const page = await ctx.newPage();
  await page.addInitScript(INIT);

  try { await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 }); }
  catch (e) { log('goto aviso:', e.message); }

  // ---- Espera inteligente: hasta 50s, revisando cada 2s ----
  log('\\n[espera] revisando que la pagina cargue...');
  let ready = false;
  for (let t = 0; t < 50; t += 2) {
    const st = await page.evaluate(() => ({
      hasInput: !!document.querySelector('#fecha'),
      cap: (window.__cap || []).length,
      hasRoutes: (window.__cap || []).some(o => Array.isArray(o) && o[0] && o[0].nidCircuito),
      txt: document.body ? document.body.innerText.length : 0
    })).catch(() => ({ err: 1 }));
    log(`   t=${t}s  fecha:${st.hasInput}  capturas:${st.cap}  rutas:${st.hasRoutes}  textoPagina:${st.txt}`);
    if (st.hasInput && st.hasRoutes) { ready = true; break; }
    await page.waitForTimeout(2000);
  }
  log('[espera] pagina lista?:', ready);

  // ---- Diagnostico de la pagina ----
  const diag = await page.evaluate(() => ({
    title: document.title,
    captchaIframe: !!document.querySelector('iframe[src*="captcha"], iframe[src*="hcaptcha"], iframe[title*="aptcha"]'),
    bodyStart: (document.body ? document.body.innerText : '').replace(/\\n+/g, ' | ').slice(0, 1000)
  })).catch(() => ({}));
  log('\\n[diag] titulo:', diag.title);
  log('[diag] captcha iframe presente?:', diag.captchaIframe);
  log('[diag] texto visible (inicio):', diag.bodyStart);
  out.diag = diag;

  // ruta por defecto
  let cap = await page.evaluate(() => window.__cap || []);
  const routeList = cap.find(o => Array.isArray(o) && o[0] && o[0].nidCircuito);
  log('\\n[rutas]', routeList ? routeList.map(r => `C${r.nidCircuito}R${r.nidRuta} ${r.ruta}`).join(' | ') : 'NO');
  out.routeList = routeList || null;

  // ---- Probar el campo de fecha ----
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
    }, d).catch(e => 'ERR:' + e.message);
    await page.waitForTimeout(5000);
    const c = await page.evaluate(() => window.__cap || []);
    const hor = c.find(o => Array.isArray(o) && o[0] && o[0].dhora_ini);
    log(`\\n[fecha ${d}] input="${set}" | horarios: ${hor ? hor.length : 'NO'}`);
    if (hor) hor.forEach(h => log(`     ${h.dhora_ini}-${h.dhora_fin}  cupos ${h.ncupo_actual}/${h.ncupo}`));
    return hor || null;
  }
  if (ready) {
    out.fechaCercana = await tryDate('2026-06-20');
    out.fechaMedia = await tryDate('2026-08-15');
    out.fechaLejana = await tryDate('2026-11-15');
  } else {
    log('\\n[!] No pude continuar porque la pagina no cargo. Mira el diagnostico de arriba.');
  }

  // menus circuito/ruta
  const selectors = await page.evaluate(() => {
    const all = [...document.querySelectorAll('*')];
    const pick = (re) => all.filter(e => re.test(e.textContent || '') && e.querySelectorAll('*').length <= 2)
      .slice(0, 6).map(e => ({ tag: e.tagName, id: e.id || '', cls: (e.className || '').toString().slice(0, 70), txt: (e.textContent || '').trim().slice(0, 50) }));
    return { circuito: pick(/Circuito [123]/), ruta: pick(/Ruta [123]-/) };
  }).catch(() => ({}));
  log('\\n[menu circuito]'); (selectors.circuito || []).forEach(c => log('   ', JSON.stringify(c)));
  log('[menu ruta]'); (selectors.ruta || []).forEach(c => log('   ', JSON.stringify(c)));
  out.selectors = selectors;

  try { await page.screenshot({ path: 'pantalla.png', fullPage: true }); log('\\n📸 pantalla.png guardada'); } catch (e) {}
  fs.writeFileSync('capture.json', JSON.stringify(out, null, 2));
  log('💾 capture.json guardado.');
  await browser.close();
  log('\\n== fin recon v4 ==');
})();
