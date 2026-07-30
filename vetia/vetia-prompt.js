'use strict';
/*
 * VETIA — SYSTEM PROMPT del asistente del plan MEDIPaw.
 * El asistente informa sobre el PLAN, la COBERTURA y CUIDADOS GENERALES usando el contexto del titular
 * (sus mascotas, plan, nº de socio) + la matriz de coberturas del NÚCLEO (fuente única). NO diagnostica.
 * Ante cualquier síntoma deriva a "que un veterinario lo vea" / Emergencia. Tono de la casa: cercano, claro, sin jerga.
 *
 * El scanner determinista (banderas-rojas-vet.js) es el que MANDA en urgencias: si marca `rojo`, el server inyecta
 * la instrucción de urgencia y el bloque de emergencia — el modelo no decide eso.
 */

const MC = require('../lib/medipaw-core.js'); // núcleo (UMD → module.exports en Node): PRECIOS, COBERTURAS, etiquetas.

// Resumen COMPACTO de qué cubre un plan, tomado del núcleo (si está disponible). Aterriza al modelo en la oferta real
// sin volcar la matriz entera. Defensivo: si el núcleo no expone la forma esperada, se omite (el modelo habla en general).
function resumenCoberturaPlan(plan) {
  try {
    const cob = MC && MC.COBERTURAS;
    if (!cob || typeof MC.reglaCobertura !== 'function') return '';
    // COBERTURAS está keyeado por PRESTACIÓN; una prestación aplica al plan sólo si reglaCobertura(prestacion, plan) != null.
    const lineas = [];
    for (const prestacion of Object.keys(cob)) {
      const r = MC.reglaCobertura(prestacion, plan);
      if (!r) continue; // el plan no incluye esta prestación
      const cupo = (r.cupoAnual != null) ? `${r.cupoAnual}/año` : 'sin límite anual';
      const pct = (typeof r.pct === 'number') ? `cubre ${Math.round(r.pct * 100)}%` : '';
      const tope = (r.tope != null) ? `tope $${r.tope}` : '';
      const extra = [cupo, pct, tope].filter(Boolean).join(', ');
      lineas.push(`  · ${r.nombre || prestacion}${extra ? ` (${extra})` : ''}`);
    }
    return lineas.length ? `Cobertura del plan ${plan}:\n${lineas.join('\n')}` : '';
  } catch (_) { return ''; }
}

// Arma el bloque de contexto del titular (mascotas + plan + nº socio) para inyectar en el system.
function bloqueContexto(contexto) {
  const c = contexto || {};
  const mascotas = Array.isArray(c.mascotas) ? c.mascotas : [];
  const partes = [];
  if (c.nroSocio) partes.push(`Nº de socio: ${c.nroSocio}.`);
  if (!mascotas.length) {
    partes.push('El titular no tiene mascotas cargadas todavía.');
    return partes.join('\n');
  }
  const planesVistos = new Set();
  partes.push('Mascotas del titular:');
  for (const m of mascotas) {
    const nombre = m.nombre || 'sin nombre';
    const especie = m.especie || 'mascota';
    const plan = m.plan || 'sin plan definido';
    const edad = m.edadAprox ? `, franja ${m.edadAprox}` : '';
    partes.push(`  - ${nombre} (${especie}${edad}) — plan: ${plan}.`);
    if (m.plan) planesVistos.add(m.plan);
  }
  for (const plan of planesVistos) {
    const resumen = resumenCoberturaPlan(plan);
    if (resumen) partes.push(resumen);
  }
  return partes.join('\n');
}

// Construye el system prompt final. `rojo` (del scanner) endurece la derivación a urgencia.
function buildSystem(contexto, rojo) {
  const ctx = bloqueContexto(contexto);
  const base = [
    'Sos VETIA, el asistente del plan de salud para mascotas MEDIPaw (Pergamino).',
    'Tu trabajo es ayudar al titular a entender SU plan, SU cobertura y dar consejos GENERALES de cuidado y prevención.',
    '',
    'REGLAS INVIOLABLES:',
    '1. NO diagnosticás ni recetás. No sos veterinario. No interpretás síntomas ni das dosis de medicamentos.',
    '2. Ante CUALQUIER signo de que la mascota no está bien (síntomas, dolor, cambios de conducta, algo raro),',
    '   tu respuesta es clara: eso lo tiene que ver un veterinario. Si suena grave o urgente, derivá a una urgencia YA.',
    '3. Hablás de cuidado, prevención y del plan. Nunca minimices un síntoma ni sugieras "esperar a ver".',
    '4. Usá SOLO la información del contexto para hablar del plan/cobertura del titular. Si no sabés algo del plan,',
    '   decilo y sugerí consultarlo con MEDIPaw; no inventes cupos, precios ni condiciones.',
    '5. Tono: cercano, tranquilo, claro, en español rioplatense. Frases cortas. Sin jerga médica ni tecnicismos.',
    '6. Respuestas breves (2 a 6 frases). Si hace falta, cerrá con un paso concreto.',
    '',
    'CONTEXTO DEL TITULAR (usalo para responder sobre su plan y sus mascotas):',
    ctx || '(sin contexto)',
  ];
  if (rojo) {
    base.push('');
    base.push('⚠️ ALERTA: el mensaje del titular contiene señales compatibles con una URGENCIA veterinaria.');
    base.push('Priorizá la seguridad: decile con calma pero con firmeza que esto NO puede esperar, que lleve a la');
    base.push('mascota a un veterinario o a una guardia de urgencias de inmediato. No des consejos caseros ni pidas más');
    base.push('datos antes de derivar. Sé breve y directo.');
  }
  return base.join('\n');
}

module.exports = { buildSystem, bloqueContexto, resumenCoberturaPlan };
