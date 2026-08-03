'use strict';
/*
 * VETIA — SMOKE de la memoria de conversación (turns.js). Determinista, sin modelo, sin red.
 * Contrato: el front manda { mensajes:[{rol:'user'|'vetia', texto}] }; el server lo pasa como turns al modelo.
 * Verifica: mapeo rol→role, filtrado/recorte/acote (últimos N), y que armarMessages() produzca un array VÁLIDO
 * para Anthropic (empieza en user, roles alternados, mensaje nuevo agregado al final).
 * Corré:  node vetia/smoke-turns.js
 */

const { mensajesATurns, armarMessages } = require('./turns.js');

let ok = 0, fail = 0;
function assert(cond, etiqueta) {
  if (cond) { ok++; console.log(`✓ ${etiqueta}`); }
  else { fail++; console.log(`✗ ${etiqueta}  <-- FALLÓ`); }
}
const alterna = (ms) => ms.every((m, i) => i === 0 || m.role !== ms[i - 1].role);

console.log('== mensajesATurns: mapeo del shape del front ==');
const t1 = mensajesATurns([{ rol: 'user', texto: 'hola' }, { rol: 'vetia', texto: 'buenas' }]);
assert(t1.length === 2 && t1[0].role === 'user' && t1[1].role === 'assistant', 'rol user→user, vetia→assistant');
assert(t1[0].content === 'hola' && t1[1].content === 'buenas', 'texto→content');
assert(mensajesATurns([{ rol: 'user', texto: '  ' }, { rol: 'user', texto: 'ok' }]).length === 1, 'descarta texto vacío/espacios');
assert(mensajesATurns('nope').length === 0 && mensajesATurns(undefined).length === 0, 'no-array → []');
assert(mensajesATurns([{ rol: 'user', texto: 'x'.repeat(3000) }])[0].content.length === 1500, 'recorte por techo de chars');

console.log('== mensajesATurns: acote a los últimos N ==');
const largo = Array.from({ length: 30 }, (_, i) => ({ rol: i % 2 ? 'vetia' : 'user', texto: 'm' + i }));
const tN = mensajesATurns(largo);
assert(tN.length === 10, 'acota a 10 turns');
assert(tN[tN.length - 1].content === 'm29', 'conserva los MÁS recientes');

console.log('== armarMessages: ensamblado válido para el modelo ==');
const m1 = armarMessages(t1, 'lo del gato');
assert(m1[0].role === 'user' && alterna(m1), 'empieza en user y alterna');
assert(m1[m1.length - 1].role === 'user' && m1[m1.length - 1].content === 'lo del gato', 'mensaje nuevo va al final como user');

// historial que empieza con assistant (por el corte de los últimos N) → se descarta el assistant inicial
const m2 = armarMessages([{ role: 'assistant', content: 'a' }, { role: 'user', content: 'b' }, { role: 'assistant', content: 'c' }], 'nuevo');
assert(m2[0].role === 'user', 'descarta assistant inicial (API exige empezar en user)');
assert(alterna(m2), 'sigue alternando tras el descarte');

// historial que termina en user → el mensaje nuevo se mergea (no dos user consecutivos)
const m3 = armarMessages([{ role: 'user', content: 'primero' }], 'segundo');
assert(m3.length === 1 && m3[0].content === 'primero\nsegundo', 'user final se mergea con el mensaje nuevo');

// roles consecutivos del mismo tipo se colapsan
const m4 = armarMessages([{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'assistant', content: 'c' }], 'z');
assert(alterna(m4), 'colapsa assistants consecutivos');

// sin historial → solo el mensaje nuevo
const m5 = armarMessages([], 'solo');
assert(m5.length === 1 && m5[0].role === 'user' && m5[0].content === 'solo', 'sin historial → solo el nuevo');

console.log('== flujo real: diálogo de Lucas (gato 1 año → dale ayudame → lo del gato) ==');
// El front acumula user/vetia y en el 3er envío manda los 4 previos + el mensaje nuevo aparte.
const sesion = [
  { rol: 'user', texto: 'tengo un gato de 1 año' },
  { rol: 'vetia', texto: 'genial, contame en qué te ayudo' },
  { rol: 'user', texto: 'dale ayudame' },
  { rol: 'vetia', texto: '¿con qué necesitás una mano?' },
];
const mensajes = armarMessages(mensajesATurns(sesion), 'lo del gato');
assert(mensajes[0].role === 'user' && alterna(mensajes), 'diálogo real: válido (empieza user, alterna)');
assert(mensajes.some(m => m.content.includes('gato de 1 año')), 'diálogo real: el contexto del gato viaja en el historial');
assert(mensajes[mensajes.length - 1].content === 'lo del gato', 'diálogo real: retoma con el mensaje nuevo al final');

console.log(`\n== RESULTADO: ${ok} ok, ${fail} fail ==`);
process.exit(fail ? 1 : 0);
