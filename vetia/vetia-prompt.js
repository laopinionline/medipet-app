'use strict';
/*
 * VETIA — SYSTEM PROMPT del asistente del plan MEDIPaw.
 * El asistente informa sobre el PLAN, la COBERTURA y CUIDADOS GENERALES usando el contexto del titular
 * (sus mascotas, plan, CONSUMOS reales del año de aniversario). NO diagnostica. Ante cualquier síntoma deriva a
 * "que un veterinario lo vea" / Emergencia. Tono de la casa: cercano, claro, sin jerga.
 *
 * El contexto de consumos lo arma `contexto.js` con el núcleo (fuente única). El scanner determinista
 * (banderas-rojas-vet.js) MANDA en urgencias: si es `rojo`, el server hace short-circuit y NO llega acá.
 */

// Fecha de hoy en es-AR (zona Buenos Aires) — el modelo no conoce la fecha por su cuenta; se inyecta en cada request.
function fechaHoy(nowMs) {
  const ms = (typeof nowMs === 'number' && isFinite(nowMs)) ? nowMs : Date.now();
  try {
    return new Date(ms).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Argentina/Buenos_Aires' });
  } catch (_) { return new Date(ms).toISOString().slice(0, 10); }
}

// Arma el bloque de contexto del titular a partir del objeto YA computado por contexto.js:
//   { nroSocio, mascotas:[{nombre, especie, plan, edadAprox, cobertura:{vigente, renueva, conCupo[], sinLimite[]}}] }
// Compacto: por mascota, plan + consumos con cupo ("usó X de Y") / carencias + prestaciones sin límite como lista.
function bloqueContexto(contexto) {
  const c = contexto || {};
  const mascotas = Array.isArray(c.mascotas) ? c.mascotas : [];
  const partes = [];
  if (c.nroSocio) partes.push(`Nº de socio: ${c.nroSocio}.`);
  if (!mascotas.length) { partes.push('El titular no tiene mascotas cargadas todavía.'); return partes.join('\n'); }
  partes.push('Mascotas del titular y sus consumos de este año de cobertura:');
  for (const m of mascotas) {
    const nombre = m.nombre || 'sin nombre';
    const especie = m.especie || 'mascota';
    const plan = m.plan || 'sin plan definido';
    const edad = m.edadAprox ? `, franja ${m.edadAprox}` : '';
    partes.push(`- ${nombre} (${especie}${edad}) — plan: ${plan}.`);
    const cob = m.cobertura || null;
    if (!cob) continue;
    if (!cob.vigente) { partes.push(`    Sin cobertura vigente (${cob.chip || 'sin plan activo'}).`); continue; }
    if (cob.renueva) partes.push(`    Su año de cobertura renueva el ${cob.renueva}.`);
    for (const linea of (cob.conCupo || [])) partes.push(`    · ${linea}`);
    if (cob.sinLimite && cob.sinLimite.length) partes.push(`    · Sin límite anual: ${cob.sinLimite.join(', ')}.`);
  }
  return partes.join('\n');
}

// Construye el system prompt final. `nowMs` para la fecha de hoy. (En urgencia el server hace short-circuit y no llama acá.)
function buildSystem(contexto, rojo, nowMs) {
  const ctx = bloqueContexto(contexto);
  const base = [
    'Sos VETIA, el asistente del plan de salud para mascotas MEDIPaw (Pergamino).',
    'Tu trabajo es ayudar al titular a entender SU plan, SU cobertura y dar consejos GENERALES de cuidado y prevención.',
    `Hoy es ${fechaHoy(nowMs)}. Usá esta fecha como referencia (no supongas otro año).`,
    '',
    'REGLAS INVIOLABLES:',
    '1. NO diagnosticás ni recetás. No sos veterinario. No interpretás síntomas ni das dosis de medicamentos.',
    '2. Ante CUALQUIER signo de que la mascota no está bien (síntomas, dolor, cambios de conducta, algo raro),',
    '   tu respuesta es clara: eso lo tiene que ver un veterinario. Si suena grave o urgente, derivá a una urgencia YA.',
    '3. Hablás de cuidado, prevención y del plan. Nunca minimices un síntoma ni sugieras "esperar a ver".',
    '4. Usá SOLO la información del contexto para hablar del plan/cobertura/consumos del titular. Si un dato no está en el',
    '   contexto, decilo y sugerí consultarlo con MEDIPaw; no inventes cupos, fechas, precios ni condiciones.',
    '5. Tono: cercano, tranquilo, claro, en español rioplatense. Frases cortas. Sin jerga médica ni tecnicismos.',
    '6. Respuestas breves (2 a 6 frases). Si hace falta, cerrá con un paso concreto.',
    '7. Respondé SIEMPRE en TEXTO PLANO. NADA de markdown: sin **negritas**, sin # de títulos, sin viñetas con "-" o "*",',
    '   sin tablas. Escribí en frases y párrafos simples; si enumerás, hacelo en la misma oración o con punto y aparte.',
    '',
    'CONTEXTO DEL TITULAR (usalo para responder sobre su plan, su cobertura y sus consumos):',
    ctx || '(sin contexto)',
  ];
  return base.join('\n');
}

module.exports = { buildSystem, bloqueContexto, fechaHoy };
