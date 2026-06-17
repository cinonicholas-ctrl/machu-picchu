// ============================================================================
// Camino Inca — COLECTOR v2 (fuente: MachuPicchuAPI)
// ----------------------------------------------------------------------------
// Cambiamos de caminoincamachupicchu.org (mostraba el TOPE como relleno: 500/250
// clavados, ilógico) a la API de MachuPicchuAPI, que da cupos reales por día
// (0 = agotado de verdad).
//
// Endpoint (capturado del widget):
//   POST https://api.machupicchuapi.com/v5/inca-trail/
//   body: apikey=...&route=N&date=YYYY-MM-01&origin_domain=machu-picchu.org
//   resp: {"error":false,"data":[{"date":"01-07-2026","total":0}, ...]}
//   (una request = una ruta, un mes entero de cupos diarios)
//
// Sin dependencias (solo https nativo). Se corre con:  node camino_inca_scrape.js
//
// ⚠️ La API key es de Traveleez (machu-picchu.org), no nuestra. Si algún día la
//    rotan/bloquean, esto deja de funcionar: cámbiala abajo en API_KEY (o saca
//    la nuestra propia en machupicchuapi.com). Está aislada a propósito acá arriba.
// ============================================================================

const https = require('https');
const fs = require('fs');

// ---- CONFIG (lo único que tocarías si cambia algo) -------------------------
const ENDPOINT = 'https://api.machupicchuapi.com/v5/inca-trail/';
const API_KEY = '188cda8f-566c-4d37-b837-90a7acc094fc'; // key prestada (Traveleez) — cambiar acá si se cae
const ORIGIN_DOMAIN = 'machu-picchu.org';

// Las dos rutas que probaste (1 y 5). Por los datos sabremos cuál es cuál:
// el Camino Inca 4 días se agota MUCHO más en temporada alta que el de 2 días.
// Si al ver el dashboard los nombres salen cambiados, solo intercámbialos aquí.
const TICKETS = [
  { route: '1', id: 'I4', name: 'Camino Inca 4 días Clásico' },     // I4 = clásico 4 días
  { route: '5', id: 'I2', name: 'Camino Inca 2 días (km 104)' },    // I2 = corto 2 días
];

const OUT = process.env.OUT || 'camino_inca.json';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';

const pad = (n) => String(n).padStart(2, '0');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

// ---- Un POST a la API (una ruta + un mes) ----------------------------------
function fetchMonth(route, anio, mes) {
  const body =
    `apikey=${encodeURIComponent(API_KEY)}&route=${route}` +
    `&date=${anio}-${pad(mes)}-01&origin_domain=${encodeURIComponent(ORIGIN_DOMAIN)}`;
  const opts = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body),
      'Origin': 'https://widget.machupicchuapi.com',
      'Referer': 'https://widget.machupicchuapi.com/',
      'User-Agent': UA,
      'Accept': '*/*',
    },
  };
  return new Promise((resolve) => {
    const req = https.request(ENDPOINT, opts, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(d); } catch (e) {}
        resolve({ status: res.statusCode, json });
      });
    });
    req.on('error', (e) => resolve({ status: 0, json: null, error: e.message }));
    req.setTimeout(20000, () => { req.destroy(); resolve({ status: 0, json: null, error: 'timeout' }); });
    req.write(body);
    req.end();
  });
}

// ---- Parser: data[] (date DD-MM-YYYY, total) -> { 'YYYY-MM-DD': cupos } ------
function buildDays(json) {
  const days = {};
  const arr = (json && json.data) || [];
  for (const row of arr) {
    if (!row || !row.date) continue;
    const [dd, mm, yyyy] = String(row.date).split('-'); // DD-MM-YYYY
    if (!yyyy) continue;
    days[`${yyyy}-${mm}-${dd}`] = Number(row.total);
  }
  return days;
}

// ---- Rango de meses: mes actual -> enero 2027 ------------------------------
// (los permisos del Camino Inca están disponibles hasta ~enero 2027; más allá
//  todavía no se libera, así que no tiene sentido pedir esos meses).
function targetMonths() {
  const now = new Date();
  let y = now.getFullYear(), m = now.getMonth() + 1;
  const endY = 2027, endM = 1;
  const out = [];
  while (y < endY || (y === endY && m <= endM)) {
    out.push({ anio: y, mes: m });
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

// ---- Main -------------------------------------------------------------------
async function main() {
  log('== Camino Inca colector v2 (MachuPicchuAPI) ==');
  const t0 = Date.now();

  // cargar previo (no perder lo bueno si una rebanada falla)
  let prev = {};
  try {
    const p = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    (p.tickets || []).forEach((t) => (prev[t.id] = t));
    log('previo cargado:', Object.keys(prev).join(',') || '(nada)');
  } catch (e) { log('sin previo'); }

  // podar meses pasados
  const now = new Date();
  const cut = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  Object.values(prev).forEach((t) => {
    if (t.days) for (const k in t.days) if (k.slice(0, 7) < cut) delete t.days[k];
    if (t.conf) for (const k in t.conf) if (k < cut) delete t.conf[k];
  });

  const result = {
    updated: new Date().toISOString(),
    source: 'MachuPicchuAPI (machupicchuapi.com) — datos del Ministerio de Cultura / SERNANP',
    tickets: [],
  };

  const months = targetMonths();
  let okSlices = 0, badSlices = 0;
  const nowIso = new Date().toISOString();

  for (const ticket of TICKETS) {
    const pr = prev[ticket.id] || {};
    const t = {
      id: ticket.id, name: ticket.name, cap: 0,
      days: Object.assign({}, pr.days),
      conf: Object.assign({}, pr.conf),
    };
    for (const { anio, mes } of months) {
      const r = await fetchMonth(ticket.route, anio, mes);
      const key = `${anio}-${pad(mes)}`;
      if (r.status === 200 && r.json && r.json.error === false && Array.isArray(r.json.data) && r.json.data.length) {
        const days = buildDays(r.json);
        Object.assign(t.days, days);
        t.conf[key] = nowIso; // sello = cuándo consultamos (la API no da fecha del Ministerio)
        okSlices++;
        const max = Math.max(0, ...Object.values(days));
        log(`  ok  ${ticket.id} ${key}  (${Object.keys(days).length} días, máx ${max})`);
      } else {
        badSlices++;
        log(`  --  ${ticket.id} ${key}  sin dato (status ${r.status}${r.error ? ', ' + r.error : ''}) -> conservo previo`);
      }
      await sleep(250);
    }
    // cap = mayor cupo observado (día más lleno) → para colorear de forma realista
    t.cap = Math.max(1, ...Object.values(t.days).map((v) => Number(v) || 0));
    result.tickets.push(t);
  }

  fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
  log(`\n💾 ${OUT} escrito. ${okSlices} ok, ${badSlices} sin dato | ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  log('Caps detectados:', result.tickets.map((t) => `${t.id}=${t.cap}`).join(' '));
}

if (require.main === module) main();

module.exports = { buildDays, targetMonths };
