'use strict';
/*
 * VETIA — CINTURÓN DETERMINISTA de la regla R10 (no preguntar por el plan/estado/afiliación). Como el scanner rojo:
 * NO confía en que el modelo se porte. Detecta si la RESPUESTA contiene una PREGUNTA por el plan/estado (lo que R10
 * prohíbe) y permite suprimir esa oración. El server: si detecta → re-pide UNA vez con corrección; si recae → suprime.
 *   preguntaPorPlan(txt) -> bool   ·   suprimirPreguntaPlan(txt) -> string (sin las preguntas-por-plan; '' si no queda nada)
 */

function stripAccents(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, ''); }

// Corta la respuesta en oraciones conservando su signo final (. ? ! o salto de línea), para poder evaluar/suprimir 1x1.
function frases(raw) {
  const s = String(raw || '');
  const out = []; let buf = '';
  for (const ch of s) { buf += ch; if (ch === '.' || ch === '?' || ch === '!' || ch === '\n') { out.push(buf); buf = ''; } }
  if (buf) out.push(buf);
  return out;
}

// Palabras clave del ESTADO del plan/afiliación (normalizadas, sin tildes). Lo que R10 prohíbe preguntar.
var KW = /(plan\s+activ|activ\w*\s+(su\s+|el\s+)?plan|ya\s+tiene\s+.{0,12}plan|tiene[ns]?\s+(un\s+|su\s+)?plan\b|carnet\s+free|esta\s+(en\s+)?(carnet\s+)?free|esta[s]?\s+afiliad|esta\s+activ\w*\s+(su\s+)?(plan|cobertura)|tiene[ns]?\s+cobertura\s+vigente|plan\s+o\s+.{0,10}free)/;

// ¿Esta oración es una PREGUNTA por el plan/estado? Requiere signo de pregunta (¿ o ?) + una keyword de estado.
function esPreguntaPlan(frase) {
  const f = String(frase || '');
  const esPreg = f.indexOf('?') !== -1 || f.indexOf('¿') !== -1; // ? o ¿
  if (!esPreg) return false; // una AFIRMACIÓN ("Valentin tiene su plan activo, así que...") NO se toca
  return KW.test(stripAccents(f).toLowerCase());
}

function preguntaPorPlan(txt) { return frases(txt).some(esPreguntaPlan); }

// Devuelve la respuesta SIN las oraciones que son preguntas-por-plan (trim). '' si no queda nada útil.
function suprimirPreguntaPlan(txt) {
  const limpio = frases(txt).filter((f) => !esPreguntaPlan(f)).join('').replace(/\n{3,}/g, '\n\n').trim();
  return limpio;
}

module.exports = { preguntaPorPlan, suprimirPreguntaPlan, esPreguntaPlan };
