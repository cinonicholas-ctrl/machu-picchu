// ============================================================================
// Camino Inca — COLECTOR v3 (fuente: inkatrail.com.pe)
// ----------------------------------------------------------------------------
// Cambiamos de MachuPicchuAPI (empezo a dar numeros mal / no confiables) al
// widget de disponibilidad de inkatrail.com.pe, que muestra los mismos cupos
// del Ministerio de Cultura y NO tiene muro anti-bot (es sitio de agencia, no
// el oficial). Un POST simple por ruta+mes, sin navegador headless.
//
// Endpoint (capturado del widget, verificado 2026-07-14):
//   POST https://www.inkatrail.com.pe/modules/availability/import3.php
//   body: r=<ruta>&f=YYYY-MM-01&d=incatrai&t=1
//   resp: fragmento HTML con celdas .ikbox:
//         iknum = dia ; ivs = cupos (ausente/0 = agotado) ; width% = cupo/tope
//   (una request = una ruta, un mes entero)
//
// Rutas confirmadas: r=1 => Camino Inca 4 dias (tope 500) ; r=2 => 2 dias km104 (tope 250)
//
// OJO CONFIABILIDAD (por eso el dashboard lleva nota):
//   - Numero "flaco" (ej. 398, 150) = dato real y vivo.
//   - Mes entero clavado en el TOPE (todo 500 / todo 250) = valor por defecto,
//     ese mes AUN no lo rastrean en vivo -> NO confiar (prueba: feb, con el
//     Camino Inca CERRADO, igual sale 500). Lo marcamos como flat=true.
//   - 0 = agotado.
//   El sitio refresca ~1 vez al dia; guardamos su sello "Updated on ..." por mes.
//
// Sin dependencias (solo https nativo). Correr con:  node camino_inca_scrape.js
// ============================================================================

const https = require('https');
const fs = require('fs');

// ---- CONFIG (lo unico que tocarias si cambia algo) -------------------------
const ENDPOINT = 'https://www.inkatrail.com.pe/modules/availability/import3.php';
const DEST = 'incatrai';   // parametro d= del widget
const SERVICE = '1';       // parametro t= (Classic Service)

// Solo 4D y 2D. IDs I4/I2 = los que el dashboard (index.html) ya conoce.
const TICKETS = [
  { r: '1', id: 'I4', name: 'Camino Inca 4 dias Clasico' },
  { r: '2', id: 'I2', name: 'Camino Inca 2 dias (km104)' },
];

const OUT = process.env.OUT || 'camino_inca.json';
const END_Y = 2027, END_M = 12;   // barre desde el mes actual hasta dic 2027
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';

const pad = (n) => String(n).padStart(2, '0');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

// ---- Un POST al widget (una ruta + un mes) ---------------------------------
function fetchMonth(route, anio, mes) {
  const body = `r=${encodeURIComponent(route)}&f=${anio}-${pad(mes)}-01` +
               `&d=${encodeURIComponent(DEST)}&t=${encodeURIComponent(SERVICE)}`;
  const opts = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Content-Length': Buffer.byteLength(body),
      'X-Requested-With': 'XMLHttpRequest',
      'Referer': 'https://www.inkatrail.com.pe/disponibilidad/incatrai',
      'User-Agent': UA,
      'Accept': '*/*',
    },
  };
  return new Promise((resolve) => {
    const req = https.request(ENDPOINT, opts, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve({ status: res.statusCode, html: d }));
    });
    req.on('error', (e) => resolve({ status: 0, html: '', error: e.message }));
    req.setTimeout(25000, () => { req.destroy(); resolve({ status: 0, html: '', error: 'timeout' }); });
    req.write(body);
    req.end();
  });
}

// ---- Parser: fragmento HTML -> { 'YYYY-MM-DD': cupos } ----------------------
// Cada dia es un .ikbox con .iknum (dia) y, si hay cupo, .ivs (numero).
function buildDays(html, anio, mes) {
  const days = {};
  if (!html) return days;
  const boxes = html.split('ikbox').slice(1); // 1 por dia
  for (const box of boxes) {
    const dm = box.match(/class="iknum"[^>]*>\s*(\d{1,2})/);
    if (!dm) continue;
    const dia = pad(parseInt(dm[1], 10));
    const am = box.match(/class="ivs"[^>]*>\s*([\d.,]+)/); // "398"
    const cupo = am ? parseInt(am[1].replace(/[.,]/g, ''), 10) : 0; // sin .ivs => 0 (agotado)
    days[`${anio}-${pad(mes)}-${dia}`] = cupo;
  }
  return days;
}

// ---- Sello "Updated on ... UTC" que muestra el sitio -----------------------
function siteStamp(html) {
  const m = (html || '').replace(/<[^>]+>/g, ' ').match(/Updated on\s+([^<]+?UTC)/i);
  return m ? m[1].replace(/\s+/g, ' ').trim() : null;
}

// ---- Rango de meses: mes actual -> END_Y/END_M -----------------------------
function targetMonths() {
  const now = new Date();
  let y = now.getFullYear(), m = now.getMonth() + 1;
  const out = [];
  while (y < END_Y || (y === END_Y && m <= END_M)) {
    out.push({ anio: y, mes: m });
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

// ---- Main -------------------------------------------------------------------
async function main() {
  log('== Camino Inca colector v3 (inkatrail.com.pe) ==');
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
    if (t.flat) for (const k in t.flat) if (k < cut) delete t.flat[k];
    if (t.site_stamp) for (const k in t.site_stamp) if (k < cut) delete t.site_stamp[k];
  });

  const result = {
    updated: new Date().toISOString(),
    source: 'inkatrail.com.pe (widget de disponibilidad - datos del Ministerio de Cultura)',
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
      conf: Object.assign({}, pr.conf),             // cuando consultamos NOSOTROS
      flat: Object.assign({}, pr.flat),             // meses clavados en el tope (sin rastreo real)
      site_stamp: Object.assign({}, pr.site_stamp), // sello "Updated on ..." del sitio, POR MES
    };
    for (const { anio, mes } of months) {
      const r = await fetchMonth(ticket.r, anio, mes);
      const key = `${anio}-${pad(mes)}`;
      const days = r.status === 200 ? buildDays(r.html, anio, mes) : {};
      if (Object.keys(days).length) {
        Object.assign(t.days, days);
        t.conf[key] = nowIso;
        const stamp = siteStamp(r.html);
        if (stamp) t.site_stamp[key] = stamp; // sello del sitio para ESE mes
        const vals = Object.values(days);
        const max = Math.max(0, ...vals);
        const uniq = new Set(vals);
        t.flat[key] = (uniq.size === 1 && max > 0); // mes clavado en el tope = no confiable
        okSlices++;
        log(`  ok  ${ticket.id} ${key}  (${vals.length} dias, max ${max}${t.flat[key] ? ', FLAT/tope' : ''})`);
      } else {
        badSlices++;
        log(`  --  ${ticket.id} ${key}  sin dato (status ${r.status}${r.error ? ', ' + r.error : ''}) -> conservo previo`);
      }
      await sleep(300);
    }
    t.cap = Math.max(1, ...Object.values(t.days).map((v) => Number(v) || 0));
    result.tickets.push(t);
  }

  fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
  log(`\nOK ${OUT} escrito. ${okSlices} ok, ${badSlices} sin dato | ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  log('Caps:', result.tickets.map((t) => `${t.id}=${t.cap}`).join(' '));
  result.tickets.forEach((t) => {
    const flats = Object.keys(t.flat).filter((k) => t.flat[k]);
    log(`  ${t.id}: ${Object.keys(t.days).length} dias | meses flat/tope (no confiables): ${flats.join(', ') || 'ninguno'}`);
  });
}

if (require.main === module) main();

module.exports = { buildDays, siteStamp, targetMonths };
