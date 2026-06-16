// Robot Machu Picchu — v8: PAGINA DE COMPRA (tiene el calendario real + horarios)
const { chromium } = require('playwright');
const fs = require('fs');

// OJO: pagina de COMPRA, no la de "disponibilidad por dia"
const URL = `https://tuboleto.cultura.pe/${process.env.TICKET || 'llaqta_machupicchu'}`;

const INIT = `
(() => {
  try { Object.defineProperty(navigator,'webdriver',{get:()=>undefined});
    Object.defineProperty(navigator,'languages',{get:()=>['es-PE','es','en']});
    Object.defineProperty(navigator,'plugins',{get:()=>[1,2,3,4,5]}); window.chrome={runtime:{}}; } catch(e){}
  const orig=JSON.parse; window.__cap=[];
  JSON.parse=function(){const r=orig.apply(this,arguments);try{const s=JSON.stringify(r);if(/dfecha|dhora|ncupo|cupo|dispon|circuito|ruta/i.test(s))window.__cap.push(r);}catch(e){}return r;};
  window.__clear=()=>{window.__cap=[];};
})();
`;
const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const out = {};
const findFechas = (c) => c.find(o => Array.isArray(o) && o[0] && o[0].dfecha);
const findHor = (c) => c.find(o => Array.isArray(o) && o[0] && o[0].dhora_ini);

(async () => {
  log('======= v8 PAGINA DE COMPRA =======');
  log('URL:', URL);
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

  // esperar a que cargue el formulario (texto "circuito" o captura de fechas)
  let ready = false;
  for (let t = 0; t < 45; t += 3) {
    const st = await page.evaluate(() => ({
      sel: document.querySelectorAll('mat-select').length,
      txt: (document.body ? document.body.innerText : ''),
      cap: (window.__cap || []).length
    })).catch(() => ({}));
    const hasForm = st.txt && /circuito|recorrido|fecha de tu visita/i.test(st.txt);
    log(`   t=${t}s mat-select:${st.sel} capturas:${st.cap} form:${!!hasForm}`);
    if (hasForm || st.sel > 0) { ready = true; break; }
    await sleep(3000);
  }
  log('[listo]:', ready);
  await sleep(4000); // dar tiempo a que dispare fechas-disponibles por defecto

  // ¿que capturo de entrada?
  let c = await page.evaluate(() => window.__cap || []);
  const f = findFechas(c), h = findHor(c);
  log('\\n[captura inicial]');
  if (f) log(`   dias disponibles (ruta por defecto): ${f.length} | primeros: ${f.slice(0,6).map(x=>x.dfecha).join(', ')} | ultimos: ${f.slice(-3).map(x=>x.dfecha).join(', ')}`);
  else log('   dias disponibles: NO capturado');
  if (h) { log(`   horarios: ${h.length}`); h.forEach(x => log(`      ${x.dhora_ini}-${x.dhora_fin} cupos ${x.ncupo_actual}/${x.ncupo}`)); }
  else log('   horarios: NO');

  // inventario de controles
  const inv = await page.evaluate(() => {
    const sels = [...document.querySelectorAll('mat-select')].map(s => (s.innerText || '').trim().slice(0, 40));
    const inputs = [...document.querySelectorAll('input')].map(i => ({ type: i.type, id: i.id, cls: (i.className || '').slice(0, 40) }));
    const cal = [...document.querySelectorAll('[class*=calendar],mat-calendar,[class*=datepicker]')].length;
    return { sels, inputs, cal };
  }).catch(() => ({}));
  log('\\n[controles] mat-select:', JSON.stringify(inv.sels), '| inputs:', JSON.stringify(inv.inputs), '| calendarios:', inv.cal);

  out.fechas = f || null; out.horarios = h || null; out.inv = inv;
  fs.writeFileSync('capture.json', JSON.stringify(out, null, 2));
  log('\\n💾 capture.json guardado.');
  await browser.close();
  log('== fin v8 ==');
})();
