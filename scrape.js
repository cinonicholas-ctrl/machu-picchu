// Probe del robot Machu Picchu — solo CARGA la pagina y captura los cupos
// reales con el mismo truco que funciono en la consola (enganchar JSON.parse).
// Objetivo: confirmar que GitHub Actions NO es bloqueado por el sitio.
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
      if (/fecha|cupo|dispon|hora|aforo|cantidad|stock|ncupo/i.test(s)) window.__cap.push(r);
    } catch (e) {}
    return r;
  };
})();
`;

(async () => {
  console.log('==============================================');
  console.log(' PROBE Machu Picchu');
  console.log(' URL:', URL);
  console.log('==============================================');

  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] });
  const ctx = await browser.newContext({
    locale: 'es-PE',
    timezoneId: 'America/Lima',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  });
  const page = await ctx.newPage();
  await page.addInitScript(INIT);

  const apiHits = [];
  page.on('response', (resp) => {
    const u = resp.url();
    if (u.includes('api-tuboleto') || u.includes('consulta-')) apiHits.push(resp.status() + '  ' + u);
  });

  try {
    await page.goto(URL, { waitUntil: 'networkidle', timeout: 90000 });
  } catch (e) {
    console.log('Aviso al cargar (seguimos):', e.message);
  }
  await page.waitForTimeout(9000);

  const cap = await page.evaluate(() => window.__cap || []);
  let title = '';
  try { title = await page.title(); } catch (e) {}

  console.log('\\nTitulo de la pagina:', title);
  console.log('Llamadas al API detectadas:', apiHits.length);
  apiHits.slice(0, 15).forEach((h) => console.log('   ', h));
  console.log('\\nObjetos capturados (cupos desencriptados):', cap.length);

  cap.slice(0, 8).forEach((o, i) => {
    const s = JSON.stringify(o);
    console.log(`\\n--- captura[${i}]  (${s.length} caracteres) ---`);
    console.log(s.slice(0, 900));
  });

  fs.writeFileSync('capture.json', JSON.stringify({ when: new Date().toISOString(), url: URL, title, apiHits, cap }, null, 2));
  console.log('\\n💾 Guardado capture.json');

  await browser.close();

  if (cap.length === 0) {
    console.log('\\n⚠️  No se capturo nada. Posible bloqueo del sitio a GitHub, o la pagina cargo distinto.');
    console.log('    Revisa arriba las "Llamadas al API": si hay 0, es bloqueo de red.');
    process.exit(1);
  }
  console.log('\\n✅ CAPTURA OK — el robot puede leer los cupos reales desde la nube.');
})();
