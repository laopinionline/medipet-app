'use strict';
/*
 * VETIA — SMOKE del cinturón determinista de R10 (filtro-plan.js). Determinista, sin modelo, sin red.
 * Verifica: DETECTA preguntas por el plan/estado/afiliación (lo prohibido, incluido el caso EXACTO de Lucas), NO marca
 * afirmaciones ni respuestas normales, y SUPRIME la oración ofensiva conservando el resto.
 * Corré:  node vetia/smoke-filtro-plan.js
 */
const { preguntaPorPlan, suprimirPreguntaPlan } = require('./filtro-plan.js');

let ok = 0, fail = 0;
const t = (label, cond) => { cond ? ok++ : fail++; console.log(`${cond ? '✓' : '✗ FALLO'} ${label}`); };

console.log('== DETECTA la pregunta-por-plan (violación de R10) ==');
t('caso EXACTO de Lucas', preguntaPorPlan('¿Ya tiene plan activo Valentin, o está en carnet free?'));
t('"¿tiene plan activo?"', preguntaPorPlan('Primero decime, ¿tiene plan activo?'));
t('"¿está afiliada?"', preguntaPorPlan('¿Valentin está afiliada a MEDIPaw?'));
t('"¿está en carnet free?"', preguntaPorPlan('¿Está en carnet free todavía?'));
t('"¿tiene cobertura vigente?"', preguntaPorPlan('¿Michi tiene cobertura vigente?'));
t('pregunta mezclada en un párrafo', preguntaPorPlan('Puedo ayudarte. ¿Ya activaste su plan o sigue en free? Contame.'));

console.log('== NO marca afirmaciones ni respuestas normales ==');
t('afirmación "tiene su plan activo" (sin ?)', !preguntaPorPlan('Valentin tiene su plan MEDIPaw Adulto activo, así que tiene cobertura.'));
t('afirmación "está en carnet free" (sin ?)', !preguntaPorPlan('Michi está en carnet free, todavía sin cobertura.'));
t('respuesta clínica normal con pregunta NO-plan', !preguntaPorPlan('Eso lo tiene que ver un veterinario. ¿Notaste si cojea o la tiene inflamada?'));
t('derivación al flujo sin preguntar por plan', !preguntaPorPlan('Desde la app, entrá en "Valentin no está bien" y contanos qué le pasa.'));
t('texto vacío', !preguntaPorPlan(''));

console.log('== SUPRIME la oración ofensiva y conserva el resto ==');
{
  const r = 'Entiendo que a Valentin le duele la patita. ¿Ya tiene plan activo o está en carnet free? Igual, que lo vea un veterinario.';
  const limpio = suprimirPreguntaPlan(r);
  t('quita la pregunta-por-plan', !preguntaPorPlan(limpio));
  t('conserva la primera oración', /le duele la patita/.test(limpio));
  t('conserva la última oración', /que lo vea un veterinario/.test(limpio));
}
{
  // si TODA la respuesta fuese la pregunta (peor caso), suprimir deja '' → el server cae al fallback
  const solo = '¿Valentin tiene plan activo?';
  t('respuesta que es SOLO la pregunta → suprime a vacío', suprimirPreguntaPlan(solo) === '');
}

console.log(`\n== RESULTADO: ${ok} ok, ${fail} fail ==`);
process.exit(fail ? 1 : 0);
