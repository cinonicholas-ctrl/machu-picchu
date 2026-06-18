// report.js — escribe un resumen legible de la corrida en el Summary de GitHub Actions.
// Lee data.json (ya mergeado) y dice, por circuito+mes, qué quedó AL DÍA y qué sigue PENDIENTE.
// Funciona igual en "Todos" y en "Solo bloqueados": siempre refleja el estado real del archivo.
const fs = require('fs');

const TH = 14; // horas: un mes se considera "al día" si se confirmó hace menos de esto
const MON = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'set', 'oct', 'nov', 'dic'];

let d;
try { d = JSON.parse(fs.readFileSync('data.json', 'utf8')); }
catch (e) { console.log('No pude leer data.json'); process.exit(0); }

const now = Date.now();
const n = new Date(), y = n.getFullYear();
const months = []; for (let m = n.getMonth(); m <= 11; m++) months.push(`${y}-${String(m + 1).padStart(2, '0')}`);

const rows = [], pend = [];
(d.routes || []).filter(r => r.group && r.group.startsWith('Circuito')).forEach(r => {
  const fresh = [], stale = [];
  months.forEach(mk => {
    const c = r.conf && r.conf[mk];
    const h = c ? (now - new Date(c).getTime()) / 3.6e6 : Infinity;
    (h < TH ? fresh : stale).push(MON[+mk.slice(5, 7) - 1]);
  });
  rows.push(`| ${r.id} | ${fresh.length}/${months.length} | ${stale.length ? stale.join(', ') : '—'} |`);
  if (stale.length) pend.push(`${r.id}: ${stale.join(', ')}`);
});

let out = `## Robot Machu Picchu — resumen de la corrida\n\n`;
out += `Archivo actualizado: \`${d.updated}\`\n\n`;
out += `| Ruta | Meses al día | Sin refrescar (≥${TH}h) |\n|---|---|---|\n` + rows.join('\n') + `\n\n`;
out += pend.length
  ? `### ⚠ Pendientes: ${pend.length} ruta(s)\nVuelve a correr el robot con la opción **"Solo bloqueados"** para completar:\n\n` + pend.map(p => `- ${p}`).join('\n') + '\n'
  : `### ✅ Todo al día — ningún circuito quedó pendiente.\n`;

const f = process.env.GITHUB_STEP_SUMMARY;
if (f) { try { fs.appendFileSync(f, out); } catch (e) {} }
console.log(out);
