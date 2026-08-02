'use strict';
/*
 * VETIA — armado del CONTEXTO DE CONSUMOS del titular para el prompt. Server-side.
 * Toma los docs crudos de `mascotas` y `atenciones` del titular (ya leídos con el uid del token, sin ampliar reglas de
 * cliente) y computa, POR MASCOTA, los consumos del AÑO DE ANIVERSARIO vigente usando el MISMO núcleo
 * (lib/medipaw-core.js — fuente única). NO reimplementa cupos/carencias: delega en `reglaCobertura`, `cobertura`,
 * `carenciaCumplida`, `ventanaAniversario`.
 *
 * COMPACTO a propósito (control de tamaño del prompt): sólo prestaciones del plan CON cupo finito (las que tienen
 * "usadas X de Y" o carencia); las sin límite van como lista de nombres. NO se vuelca la matriz entera.
 *
 * Robustez de fechas: la app guarda `creadoEn`/`fecha` como Timestamp de Firestore (Admin SDK → tiene toMillis()). El
 * núcleo ya normaliza Timestamp/Date/number/ISO dentro de sus funciones (lección Fase 2). Acá sólo derivamos el alta
 * para la ventana de aniversario, tolerando los mismos shapes.
 */

const MC = require('../lib/medipaw-core.js');

// Alta de la mascota en ms, tolerando Timestamp (toMillis / {seconds} / {_seconds}) | number | Date | ISO. null si no se puede.
function docAltaMs(m) {
  const x = (m && m.altaMs != null) ? m.altaMs : (m && m.creadoEn);
  if (x == null) return null;
  if (typeof x === 'number') return isFinite(x) ? x : null;
  if (typeof x.toMillis === 'function') { const v = x.toMillis(); return isFinite(v) ? v : null; }
  if (typeof x.toDate === 'function') { const d = x.toDate(); return (d instanceof Date && isFinite(d.getTime())) ? d.getTime() : null; }
  if (typeof x.seconds === 'number') return x.seconds * 1000;
  if (typeof x._seconds === 'number') return x._seconds * 1000;
  if (x instanceof Date) return isFinite(x.getTime()) ? x.getTime() : null;
  const p = Date.parse(x); return isFinite(p) ? p : null;
}

// DD/M/AAAA (UTC), mismo formato que la UI del socio.
function fmtFechaMs(ms) { const d = new Date(ms); return d.getUTCDate() + '/' + (d.getUTCMonth() + 1) + '/' + d.getUTCFullYear(); }

// Consumos de UNA mascota: { vigente, chip, renueva, conCupo[], sinLimite[] }.
function consumosDeMascota(m, atsMasc, nowMs) {
  const cobM = MC.coberturaMascota(m);
  // FREEMIUM (Fase 4): free = mascota registrada gratis, sin plan. VETIA no miente cobertura: da cuidado general +
  // cartilla y deriva a activar. `free` la distingue de suspendido/legacy (ambos también !ok pero por otra razón).
  if (!cobM.ok) return { vigente: false, free: cobM.free === true, chip: cobM.chip, renueva: null, conCupo: [], sinLimite: [] };
  const ats = atsMasc || [];
  const conCupo = [], sinLimite = [];
  for (const key of Object.keys(MC.COBERTURAS)) {
    const r = MC.reglaCobertura(key, m.plan);
    if (!r) continue; // el plan no incluye la prestación
    const label = (MC.ETIQUETAS_PRESTACION && MC.ETIQUETAS_PRESTACION[key]) || r.nombre || key;
    if (r.cupoAnual == null) { sinLimite.push(label); continue; } // sin límite → sólo el nombre (compacto)
    const car = MC.carenciaCumplida(m, key, nowMs);
    if (!car.cumplida) {
      conCupo.push(car.sinAlta
        ? `${label}: sin fecha de alta verificable (no se puede confirmar la carencia)`
        : `${label}: en carencia hasta el ${fmtFechaMs(car.desdeMs)} (todavía no cubre)`);
      continue;
    }
    // cupo del año de aniversario vigente: cobertura() filtra por prestación (tipo===key) y ventana.
    const c = MC.cobertura(m, key, 0, { fechaMs: nowMs, atenciones: ats });
    const restantes = (c.restantes === Infinity) ? null : c.restantes;
    const usadas = (restantes == null) ? 0 : Math.max(0, r.cupoAnual - restantes);
    conCupo.push(`${label}: usó ${usadas} de ${r.cupoAnual} este año (quedan ${restantes == null ? 'sin límite' : restantes})`);
  }
  const vent = MC.ventanaAniversario(docAltaMs(m), nowMs);
  return { vigente: true, free: false, chip: cobM.chip, renueva: vent ? fmtFechaMs(vent.fin) : null, conCupo, sinLimite };
}

// Arma el contexto completo. mascotasDocs = docs crudos de `mascotas`; atByMasc = { mascotaId: [atenciones] }.
function armarContexto(mascotasDocs, atByMasc, nroSocio, nowMs) {
  const mascotas = (mascotasDocs || []).map((m) => ({
    nombre: m.nombre || '',
    especie: m.especie || '',
    plan: m.plan || '',
    edadAprox: m.edadAprox || '',
    cobertura: consumosDeMascota(m, (atByMasc && atByMasc[m.mascotaId != null ? m.mascotaId : m.id]) || [], nowMs),
  }));
  return { nroSocio: nroSocio || '', mascotas };
}

module.exports = { armarContexto, consumosDeMascota, docAltaMs, fmtFechaMs };
