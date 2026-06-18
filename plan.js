// plan.js — decide qué combinaciones (circuito + mes) hay que correr.
// Imprime un JSON tipo [{"c":"Circuito 1","m":"2026-08"}, ...] que el workflow usa como matriz.
//
// SEL = "Todos"            -> todos los circuitos x todos los meses (mes actual..diciembre)
// SEL = "Circuito N"       -> ese circuito x todos los meses
// SEL = "Solo bloqueados"  -> lee data.json y devuelve SOLO los (circuito,mes) incompletos
const fs = require('fs');
const SEL = process.env.SEL || 'Todos';
const n = new Date(), y = n.getFullYear();
const months = []; for (let m = n.getMonth(); m <= 11; m++) months.push(`${y}-${String(m + 1).padStart(2, '0')}`);
const ALL = ['Circuito 1', 'Circuito 2', 'Circuito 3'];
const pad = (x) => String(x).padStart(2, '0');
const daysIn = (yy, mm) => new Date(yy, mm, 0).getDate(); // mm en base 1

let combos = [];

if (SEL === 'Solo bloqueados') {
  let base = { routes: [] };
  try { base = JSON.parse(fs.readFileSync('data.json', 'utf8')); } catch (e) {}
  for (const c of ALL) {
    const routes = (base.routes || []).filter(r => r.group === c);
    for (const mk of months) {
      const [yy, mm] = mk.split('-').map(Number);
      const nd = daysIn(yy, mm);
      let incomplete = false;
      if (!routes.length) {
        incomplete = true; // no tenemos nada de ese circuito todavía
      } else {
        // un mes está "completo" si CADA ruta tiene SELLO FRESCO (no solo presente) para ese mes
        const TH = 14 * 3.6e6; // ≥14h sin refrescar = volver a correrlo (igual que el reporte/dashboard)
        for (const r of routes) {
          const c = r.conf && r.conf[mk];
          if (!c || (Date.now() - new Date(c).getTime()) >= TH) { incomplete = true; break; }
        }
      }
      if (incomplete) combos.push({ c, m: mk });
    }
  }
} else {
  const circuits = (SEL === 'Todos') ? ALL : [SEL];
  for (const c of circuits) for (const m of months) combos.push({ c, m });
}

console.log(JSON.stringify(combos));
