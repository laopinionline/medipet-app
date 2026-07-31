'use strict';
/*
 * VETIA — SMOKE del armado de contexto de consumos (contexto.js). Determinista, sin red.
 * Foco: SHAPES REALES de fecha (Timestamp de Firestore con toMillis/{seconds}/{_seconds}, number) — la lección de la
 * Fase 2 (Number(Timestamp)=NaN dejaba las atenciones fuera de la ventana → cupo mal contado). Verifica:
 *   - "usó X de Y" con una atención real dentro del año de aniversario (Michi/Joven/vacunas → 1 de 5, quedan 4).
 *   - carencia activa formateada (Firulais/cirugía → "en carencia hasta ...").
 *   - sin-límite listadas por nombre; año de renovación presente.
 *   - docAltaMs tolera los distintos shapes.
 * Corré:  node vetia/smoke-contexto.js
 */

const { armarContexto, consumosDeMascota, docAltaMs } = require('./contexto.js');

const DIA = 86400000;
const NOW = Date.UTC(2026, 6, 31); // 31/7/2026 fijo (determinista)
// Timestamp de Firestore simulado (Admin SDK): tiene toMillis() y seconds.
const TS = (ms) => ({ toMillis: () => ms, seconds: Math.floor(ms / 1000) });

let ok = 0, fail = 0;
function assert(cond, etiqueta, extra) {
  if (cond) { ok++; console.log('✓ ' + etiqueta); }
  else { fail++; console.log('✗ ' + etiqueta + (extra ? '  <-- ' + extra : '')); }
}

// ── Michi: plan Joven, alta hace ~400 días (2º año de aniversario), 1 vacuna usada este año ──
const michi = { mascotaId: 'MICHI', nombre: 'Michi', especie: 'gato', edadAprox: 'adulto', estado: 'activo', plan: 'MEDIPaw Joven', creadoEn: TS(NOW - 400 * DIA) };
const atsMichi = [{ mascotaId: 'MICHI', tipo: 'vacunas', fecha: TS(NOW - 10 * DIA) }]; // dentro del año vigente
const cMichi = consumosDeMascota(michi, atsMichi, NOW);
const lineaVac = (cMichi.conCupo || []).find((l) => /^Vacunas:/.test(l)) || '';
console.log('  Michi vacunas →', lineaVac);
assert(/Vacunas: usó 1 de 5 este año \(quedan 4\)/.test(lineaVac), 'Michi/Joven: vacunas usó 1 de 5 (quedan 4)', lineaVac);
assert(cMichi.vigente && !!cMichi.renueva, 'Michi: cobertura vigente + año de renovación presente', JSON.stringify(cMichi.renueva));
assert((cMichi.sinLimite || []).includes('Veterinario online'), 'Michi: sin-límite incluye Veterinario online', JSON.stringify(cMichi.sinLimite));

// ── Firulais: plan Joven, alta hace 30 días → cirugía (carencia 90d) TODAVÍA en carencia ──
const firu = { mascotaId: 'FIRU', nombre: 'Firulais', especie: 'perro', edadAprox: 'joven', estado: 'activo', plan: 'MEDIPaw Joven', creadoEn: TS(NOW - 30 * DIA) };
const cFiru = consumosDeMascota(firu, [], NOW);
const lineaCir = (cFiru.conCupo || []).find((l) => /^Intervención quirúrgica:/.test(l)) || '';
console.log('  Firulais cirugía →', lineaCir);
assert(/Intervención quirúrgica: en carencia hasta el \d+\/\d+\/\d+ \(todavía no cubre\)/.test(lineaCir), 'Firulais/Joven: cirugía en carencia con fecha', lineaCir);

// ── docAltaMs: tolera Timestamp/{seconds}/{_seconds}/number/Date ──
assert(docAltaMs({ creadoEn: TS(NOW) }) === NOW, 'docAltaMs: Timestamp (toMillis)');
assert(docAltaMs({ creadoEn: { seconds: Math.floor(NOW / 1000) } }) === Math.floor(NOW / 1000) * 1000, 'docAltaMs: {seconds}');
assert(docAltaMs({ creadoEn: { _seconds: Math.floor(NOW / 1000) } }) === Math.floor(NOW / 1000) * 1000, 'docAltaMs: {_seconds} serializado');
assert(docAltaMs({ altaMs: NOW }) === NOW, 'docAltaMs: number (altaMs)');
assert(docAltaMs({}) === null, 'docAltaMs: sin alta → null');

// ── armarContexto: estructura completa + nº socio ──
const ctx = armarContexto([michi, firu], { MICHI: atsMichi, FIRU: [] }, 'DEMO-0001', NOW);
assert(ctx.nroSocio === 'DEMO-0001' && ctx.mascotas.length === 2, 'armarContexto: nº socio + 2 mascotas');
assert(ctx.mascotas[0].cobertura && Array.isArray(ctx.mascotas[0].cobertura.conCupo), 'armarContexto: cada mascota trae cobertura.conCupo');

// ── mascota sin plan de catálogo → sin cobertura vigente ──
const legacy = { mascotaId: 'LEG', nombre: 'Legacy', especie: 'perro', estado: 'activo', plan: 'Sin definir', creadoEn: TS(NOW - 100 * DIA) };
assert(consumosDeMascota(legacy, [], NOW).vigente === false, 'plan legacy → sin cobertura vigente');

console.log(`\n== RESULTADO: ${ok} ok, ${fail} fail ==`);
if (fail) { console.error('SMOKE ROJO'); process.exit(1); }
console.log('SMOKE VERDE');
