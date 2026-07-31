'use strict';
/*
 * VETIA / TURNOS — SMOKE de la lógica PURA de reserva (sin Firestore). Determinista.
 * Cubre: ventana [hoy, hoy+7], alineación del slot a la grilla, doble-booking (slot ya tomado, simulado con estado en
 * memoria), y máx-1-turno-futuro por mascota. La TX real (Admin SDK) se verifica por REST contra el demo (fase de deploy).
 * Corré:  node vetia/smoke-turnos.js
 */

const T = require('./turnos.js');

const NOW = Date.UTC(2026, 6, 31, 15, 0); // 31/7/2026 12:00 BA (fijo)
const HOY = T.fechaStrBA(NOW);            // 'YYYY-MM-DD' hoy en Buenos Aires
const MANANA = T.addDiasStr(NOW, 1);
const MAS7 = T.addDiasStr(NOW, 7);
const MAS8 = T.addDiasStr(NOW, 8);

let ok = 0, fail = 0;
function assert(cond, etiqueta, extra) { if (cond) { ok++; console.log('✓ ' + etiqueta); } else { fail++; console.log('✗ ' + etiqueta + (extra ? '  <-- ' + extra : '')); } }

console.log('HOY=' + HOY + ' MAÑANA=' + MANANA + ' MAS7=' + MAS7);

console.log('\n== ventanaOk ==');
assert(T.ventanaOk(HOY, NOW), 'hoy dentro de ventana');
assert(T.ventanaOk(MANANA, NOW), 'mañana dentro de ventana');
assert(T.ventanaOk(MAS7, NOW), 'hoy+7 dentro (borde inclusivo)');
assert(!T.ventanaOk(MAS8, NOW), 'hoy+8 FUERA');
assert(!T.ventanaOk(T.addDiasStr(NOW, -1), NOW), 'ayer FUERA');

console.log('\n== horaAlineada (09:00-13:00, slot 30min) ==');
assert(T.horaAlineada('09:00', '09:00', '13:00', 30), '09:00 ok (borde inicio)');
assert(T.horaAlineada('09:30', '09:00', '13:00', 30), '09:30 ok');
assert(T.horaAlineada('12:30', '09:00', '13:00', 30), '12:30 ok (último slot: 12:30+30=13:00)');
assert(!T.horaAlineada('13:00', '09:00', '13:00', 30), '13:00 NO (no entra el slot completo)');
assert(!T.horaAlineada('09:15', '09:00', '13:00', 30), '09:15 NO (desalineado)');
assert(!T.horaAlineada('08:30', '09:00', '13:00', 30), '08:30 NO (antes del inicio)');

console.log('\n== validarReserva ==');
const agenda = { fecha: MANANA, horaInicio: '09:00', horaFin: '13:00', duracionSlotMin: 30, activa: true, slotsTomados: [] };
assert(T.validarReserva(agenda, '09:30', NOW, false).ok, 'reserva válida → ok');
assert(T.validarReserva(null, '09:30', NOW, false).code === 'agenda-inexistente', 'agenda null → agenda-inexistente');
assert(T.validarReserva({ ...agenda, activa: false }, '09:30', NOW, false).code === 'agenda-inactiva', 'inactiva → agenda-inactiva');
assert(T.validarReserva({ ...agenda, fecha: MAS8 }, '09:30', NOW, false).code === 'fuera-de-ventana', 'fecha+8 → fuera-de-ventana');
assert(T.validarReserva(agenda, '09:15', NOW, false).code === 'hora-invalida', 'hora desalineada → hora-invalida');
assert(T.validarReserva({ ...agenda, slotsTomados: ['09:30'] }, '09:30', NOW, false).code === 'slot-ocupado', 'slot ocupado → slot-ocupado (doble-booking)');
assert(T.validarReserva(agenda, '09:30', NOW, true).code === 'ya-tiene-turno', 'ya tiene turno futuro → ya-tiene-turno');

console.log('\n== doble-booking simulado (estado en memoria, como la TX) ==');
const estado = { ...agenda, slotsTomados: [] };
const r1 = T.validarReserva(estado, '10:00', NOW, false);
assert(r1.ok, '1ª reserva del slot 10:00 → ok');
estado.slotsTomados = estado.slotsTomados.concat(['10:00']); // la TX marcaría el slot
const r2 = T.validarReserva(estado, '10:00', NOW, false);
assert(r2.code === 'slot-ocupado', '2ª reserva del MISMO slot → slot-ocupado');
const r3 = T.validarReserva(estado, '10:30', NOW, false);
assert(r3.ok, 'otro slot (10:30) sigue libre → ok');

console.log(`\n== RESULTADO: ${ok} ok, ${fail} fail ==`);
if (fail) { console.error('SMOKE ROJO'); process.exit(1); }
console.log('SMOKE VERDE');
