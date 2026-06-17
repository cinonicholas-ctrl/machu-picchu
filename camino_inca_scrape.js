// ============================================================================
// Camino Inca — COLECTOR (prototipo, separado del dashboard de Machu Picchu)
// ----------------------------------------------------------------------------
// Extrae la disponibilidad por día de:
//   - DH = Camino Inca 4 días Clásico  (límite 500/día)
//   - eB = Camino Inca - km 104 - Chachabamba (Camino Inca corto, límite 250/día)
// desde caminoincamachupicchu.org (datos del Ministerio de Cultura - DRC Cusco).
//
// NO usa navegador. Es un POST directo al AJAX de WordPress. Cero dependencias
// (solo módulos nativos de Node). Se corre con:  node camino_inca_scrape.js
//
// Regla de oro (igual que el dashboard MP): nunca pisar dato bueno con vacío.
// Si una rebanada (ticket+mes) falla, se conserva lo previo de camino_inca.json.
// ============================================================================

const https = require('https');
const fs = require('fs');

// ---- Config de la fuente (sacada del cURL real de la web) -------------------
const ENDPOINT = 'https://caminoincamachupicchu.org/cmingutd/wp-admin/admin-ajax.php';
const CALENDARIO = '9U7W';            // data-iden-calendar del widget
const GRUPO = '-1';
const PERCENTAGE = '100';
const TICKETS = [
  { id: 'DH', name: 'Camino Inca 4 días Clásico', cap: 500 },
  { id: 'eB', name: 'Camino Inca - km 104 - Chachabamba', cap: 250 },
];

const OUT = process.env.OUT || 'camino_inca.json';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';

const pad = (n) => String(n).padStart(2, '0');
const daysInMonth = (y, m) => new Date(y, m, 0).getDate(); // m en base 1
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

// ---- Un POST al AJAX --------------------------------------------------------
function fetchSlice(ubicacion, anio, mes) {
  const body =
    `action=update-calendar&ubicacion=${ubicacion}&calendario=${CALENDARIO}` +
    `&anio=${anio}&mes=${pad(mes)}&grupo=${GRUPO}&percentage=${PERCENTAGE}`;
  const opts = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body),
      'X-Requested-With': 'XMLHttpRequest',
      'Origin': 'https://caminoincamachupicchu.org',
      'Referer': 'https://caminoincamachupicchu.org/disponibilidad-camino-inca-machu-picchu/',
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
        resolve({ status: res.statusCode, json, raw: d });
      });
    });
    req.on('error', (e) => resolve({ status: 0, json: null, raw: '', error: e.message }));
    req.setTimeout(20000, () => { req.destroy(); resolve({ status: 0, json: null, raw: '', error: 'timeout' }); });
    req.write(body);
    req.end();
  });
}

// ---- Parser: cantidades -> { 'YYYY-MM-DD': cupos } --------------------------
// (función pura, testeable sin red — ver selftest.js)
function buildDays(json, anio, mes) {
  const dim = daysInMonth(anio, mes);
  const days = {};
  const c = (json && json.cantidades) || {};
  for (let d = 1; d <= dim; d++) {
    if (c[d] === undefined || c[d] === null) continue; // sin dato ese día
    days[`${anio}-${pad(mes)}-${pad(d)}`] = Number(c[d]); // "0" -> 0
  }
  return days;
}

// ---- Rango de meses: mes actual -> diciembre 2027 ---------------------------
function targetMonths() {
  const now = new Date();
  let y = now.getFullYear();
  let m = now.getMonth() + 1; // base 1
  const endY = 2027, endM = 12;
  const out = [];
  while (y < endY || (y === endY && m <= endM)) {
    out.push({ anio: y, mes: m });
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

// ---- Main -------------------------------------------------------------------
async function main() {
  log('== Camino Inca colector ==');
  const t0 = Date.now();

  // cargar previo (no perder lo bueno)
  let prev = {};
  try {
    const p = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    (p.tickets || []).forEach((t) => (prev[t.id] = t));
    log('previo cargado:', Object.keys(prev).join(',') || '(nada)');
  } catch (e) { log('sin previo'); }

  // podar meses pasados de lo previo
  const now = new Date();
  const cut = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  Object.values(prev).forEach((t) => {
    if (t.days) for (const k in t.days) if (k.slice(0, 7) < cut) delete t.days[k];
    if (t.conf) for (const k in t.conf) if (k < cut) delete t.conf[k];
  });

  const result = {
    updated: new Date().toISOString(),
    source: 'caminoincamachupicchu.org (Ministerio de Cultura - DRC Cusco)',
    tickets: [],
  };

  const months = targetMonths();
  let okSlices = 0, badSlices = 0;

  for (const ticket of TICKETS) {
    const pr = prev[ticket.id] || {};
    const t = {
      id: ticket.id,
      name: ticket.name,
      cap: ticket.cap,
      days: Object.assign({}, pr.days),   // arranca con lo previo
      conf: Object.assign({}, pr.conf),   // sello "última actualización" por mes
    };
    for (const { anio, mes } of months) {
      const r = await fetchSlice(ticket.id, anio, mes);
      const key = `${anio}-${pad(mes)}`;
      if (r.status === 200 && r.json && r.json.completado == 1 && r.json.cantidades) {
        const days = buildDays(r.json, anio, mes);
        Object.assign(t.days, days);                 // superpone solo este mes
        if (r.json.update) t.conf[key] = r.json.update; // sello del Ministerio
        okSlices++;
        log(`  ok  ${ticket.id} ${key}  (${Object.keys(days).length} días, update ${r.json.update || '?'})`);
      } else {
        badSlices++;
        log(`  --  ${ticket.id} ${key}  sin dato (status ${r.status}${r.error ? ', ' + r.error : ''}) -> conservo lo previo`);
      }
      await sleep(300); // cortesía: no martillar la web
    }
    result.tickets.push(t);
  }

  fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
  log(`\n💾 ${OUT} escrito. ${okSlices} rebanadas ok, ${badSlices} sin dato | ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

if (require.main === module) main();

module.exports = { buildDays, daysInMonth, targetMonths };
