// Robot Machu Picchu — v7 RECON del formulario (menu ruta + calendario)
const { chromium } = require('playwright');
const fs = require('fs');

const URL = `https://tuboleto.cultura.pe/disponibilidad/${process.env.TICKET || 'llaqta_machupicchu'}`;
const INIT = `
(() => {
  try { Object.defineProperty(navigator,'webdriver',{get:()=>undefined});
    Object.defineProperty(navigator,'languages',{get:()=>['es-PE','es','en']});
    Object.defineProperty(navigator,'plugins',{get:()=>[1,2,3,4,5]}); window.chrome={runtime:{}}; } catch(e){}
  const orig=JSON.parse; window.__cap=[];
  JSON.parse=function(){const r=orig.apply(this,arguments);try{const s=JSON.stringify(r);if(/dfecha|dhora|ncupo|cupo|dispon/i.test(s))window.__cap.push(r);}catch(e){}return r;};
  window.__clear=()=>{window.__cap=[];};
})();
`;
const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const out = {};

(async () => {
  log('======= v7 RECON formulario =======');
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] });
  const ctx = await browser.newContext({
    locale: 'es-PE', timezoneId: 'America/Lima', viewport: { width: 1366, height: 768 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    extraHTTPHeaders: { 'Accept-Language': 'es-PE,es;q=0.9,en;q=0.8' }
  });
  const page = await ctx.newPage();
  await page.addInitScript(INIT);
  try { await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 }); } catch (e) { log('goto:', e.message); }

  const body0 = await page.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');
  if (/IP restringida|automatizado/i.test(body0)) { log('⛔ 403 bloqueado, reintenta luego.'); fs.writeFileSync('capture.json', '{"blocked":true}'); await browser.close(); process.exit(0); }

  let ready = false;
  for (let t = 0; t < 40; t += 2) { if (await page.evaluate(() => !!document.querySelector('#fecha')).catch(() => false)) { ready = true; break; } await sleep(2000); }
  log('[listo]:', ready); if (!ready) { fs.writeFileSync('capture.json', '{"ready":false}'); await browser.close(); process.exit(0); }
  await sleep(2500);

  const dump = await page.evaluate(() => {
    const clean = (el) => { const c = el.cloneNode(true); c.querySelectorAll('*').forEach(n => [...n.attributes].forEach(a => { if (/^_ng|^ng-/.test(a.name)) n.removeAttribute(a.name); })); return c.outerHTML; };
    // contenedor del formulario: subir desde #fecha
    let p = document.querySelector('#fecha'); for (let i = 0; i < 6 && p.parentElement; i++) p = p.parentElement;
    const formHtml = p ? clean(p).replace(/\\s+/g, ' ').slice(0, 4500) : '';
    const buttons = [...document.querySelectorAll('button')].slice(0, 40).map(b => ({ t: (b.innerText || '').trim().slice(0, 22), c: (b.className || '').slice(0, 45) }));
    // celdas tipo dia (texto = numero 1-31, pocos hijos)
    const dayCells = [...document.querySelectorAll('*')].filter(e => /^([1-9]|[12]\\d|3[01])$/.test((e.textContent || '').trim()) && e.children.length === 0).slice(0, 8)
      .map(e => ({ tag: e.tagName, c: (e.className || '').toString().slice(0, 45), t: e.textContent.trim() }));
    // elementos con clases sospechosas
    const sus = [...document.querySelectorAll('[class*=calendar],[class*=fecha],[class*=date],[class*=picker],[class*=select],[class*=dropdown],[class*=mes],[class*=dia]')].slice(0, 12)
      .map(e => ({ tag: e.tagName, c: (e.className || '').toString().slice(0, 55) }));
    return { formHtml, buttons, dayCells, sus };
  }).catch(e => ({ err: e.message }));

  log('\\n[BOTONES]'); (dump.buttons || []).forEach(b => log('   ', JSON.stringify(b)));
  log('\\n[CELDAS DIA candidatas]'); (dump.dayCells || []).forEach(d => log('   ', JSON.stringify(d)));
  log('\\n[CLASES sospechosas]'); (dump.sus || []).forEach(s => log('   ', JSON.stringify(s)));
  log('\\n[HTML del formulario (limpio)]:\\n', dump.formHtml || '(vacio)');

  out.dump = dump;
  fs.writeFileSync('capture.json', JSON.stringify(out, null, 2));
  log('\\n💾 capture.json guardado.');
  await browser.close();
  log('== fin v7 ==');
})();
