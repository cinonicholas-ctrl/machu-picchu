// merge.js — junta las "rebanadas" (un circuito + un mes cada una) en data.json
// Regla de oro: NUNCA pisar dato bueno con vacío. Solo superpone lo que la rebanada
// realmente leyó (datos reales u "agotado"); si una rebanada vino vacía, conserva lo previo.
const fs = require('fs');

// base = data.json ya commiteado (todo lo que ya teníamos)
let base = { updated: new Date().toISOString(), ticket: 'llaqta_machupicchu', sample: false, routes: [] };
try { base = JSON.parse(fs.readFileSync('data.json', 'utf8')); } catch (e) { console.log('sin data.json previo'); }
const byId = {}; (base.routes || []).forEach(r => { byId[r.id] = r; });

const isEmptyObj = (v) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0;

const files = process.argv.slice(2);
let applied = 0;
for (const f of files) {
  let slice;
  try { slice = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { continue; }
  (slice.routes || []).forEach(sr => {
    let r = byId[sr.id];
    if (!r) { r = { id: sr.id, group: sr.group, name: sr.name, slots: [], cap: 0, days: {}, updated: sr.updated }; byId[sr.id] = r; base.routes.push(r); }
    // superponer SOLO los días que la rebanada tiene
    for (const k in (sr.days || {})) {
      const v = sr.days[k];
      if (isEmptyObj(v)) {
        // "sin dato real": solo lo pongo si la base no tenía nada útil
        if (r.days[k] == null || isEmptyObj(r.days[k])) r.days[k] = v;
        continue;
      }
      r.days[k] = v; // null (agotado) o un objeto con horas/cupos reales
    }
    // metadatos: unión de horarios, cap máximo, nombre/grupo y fecha más reciente
    const ss = new Set([...(r.slots || []), ...(sr.slots || [])]); r.slots = [...ss].sort();
    r.cap = Math.max(r.cap || 0, sr.cap || 0);
    if (sr.name) r.name = sr.name;
    if (sr.group) r.group = sr.group;
    if (sr.updated && (!r.updated || sr.updated > r.updated)) r.updated = sr.updated;
  });
  applied++;
}

// podar meses ya pasados
{ const n = new Date(); const cut = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
  base.routes.forEach(r => { for (const k in r.days) { if (k.slice(0, 7) < cut) delete r.days[k]; } }); }

base.updated = new Date().toISOString();
base.sample = false;
base.routes.sort((a, b) => (a.id || '').localeCompare(b.id || '', undefined, { numeric: true }));
fs.writeFileSync('data.json', JSON.stringify(base));
console.log(`merge ok (${applied} rebanadas). Rutas:`, base.routes.map(r => `${r.id}:${Object.keys(r.days).length}d`).join(' '));
