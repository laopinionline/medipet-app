'use strict';
/*
 * VETIA / TURNOS — reserva y cancelación de turnos del vet de guardia MEDIPaw. Server-side (VPS, Admin SDK).
 * Patrón MEDICAR adaptado a AGENDA ÚNICA (un solo vet → sin medicoId). La atomicidad del slot (evitar doble-booking)
 * va en una TRANSACCIÓN de Firestore; el cliente NO crea turnos (reglas: create=false) → la reserva es la única vía.
 * Acople al motor = INFORMATIVO: se devuelve el cupo de 'consulta' (núcleo), sin bloquear ni descontar. El consumo
 * real lo registra la atención del vet.
 *
 * Este módulo NO requiere firebase-admin: recibe `db` (admin.firestore()) y `FV` (FieldValue.serverTimestamp) del
 * server. Los helpers puros (ventana/slot/validación) son exportados y se testean sin Firestore.
 */

// 'YYYY-MM-DD' en zona Buenos Aires (agenda y ventana se comparan como strings — orden lexicográfico = cronológico).
function fechaStrBA(ms) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}
function addDiasStr(ms, dias) { return fechaStrBA(ms + dias * 86400000); }
// Ventana de reserva: [hoy, hoy+7] inclusive.
function ventanaOk(fechaStr, nowMs) { const hoy = fechaStrBA(nowMs); return fechaStr >= hoy && fechaStr <= addDiasStr(nowMs, 7); }

function horaAMin(hhmm) { const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '')); if (!m) return null; return Number(m[1]) * 60 + Number(m[2]); }
// Hora válida: cae en [horaInicio, horaFin), alineada a la grilla de duracionSlotMin (mismo criterio que genera los slots).
function horaAlineada(hora, horaInicio, horaFin, dur) {
  const h = horaAMin(hora), ini = horaAMin(horaInicio), fin = horaAMin(horaFin);
  if (h == null || ini == null || fin == null || !(dur > 0)) return false;
  return h >= ini && h + dur <= fin && (h - ini) % dur === 0;
}

// Validación PURA de la reserva (lo que corre dentro de la TX, ya con la franja y el estado leídos). { ok, code }.
function validarReserva(agenda, hora, nowMs, yaTieneTurnoFuturo) {
  if (!agenda) return { ok: false, code: 'agenda-inexistente' };
  if (agenda.activa !== true) return { ok: false, code: 'agenda-inactiva' };
  if (!ventanaOk(agenda.fecha, nowMs)) return { ok: false, code: 'fuera-de-ventana' };
  if (!horaAlineada(hora, agenda.horaInicio, agenda.horaFin, agenda.duracionSlotMin)) return { ok: false, code: 'hora-invalida' };
  const tomados = Array.isArray(agenda.slotsTomados) ? agenda.slotsTomados : [];
  if (tomados.includes(hora)) return { ok: false, code: 'slot-ocupado' };
  if (yaTieneTurnoFuturo) return { ok: false, code: 'ya-tiene-turno' };
  return { ok: true };
}

// Veredicto INFORMATIVO del cupo de 'consulta' para la mascota (núcleo). Nunca bloquea; si falla, devuelve ''.
function infoConsulta(MC, m, atsMasc, nowMs) {
  try {
    const r = MC.reglaCobertura('consulta', m.plan);
    if (!r) return 'Tu plan no incluye consultas cubiertas.';
    const car = MC.carenciaCumplida(m, 'consulta', nowMs);
    if (!car.cumplida) return car.sinAlta ? '' : ('Las consultas están en carencia hasta el ' + fechaStrBA(car.desdeMs) + '.');
    if (r.cupoAnual == null) return 'Tu plan cubre consultas sin límite este año.';
    const c = MC.cobertura(m, 'consulta', 0, { fechaMs: nowMs, atenciones: atsMasc || [] });
    if (c.restantes <= 0) return 'Ya usaste tus ' + r.cupoAnual + ' consultas cubiertas del año; la próxima tiene 25% de descuento. (El turno no descuenta: se cuenta cuando el vet registra la atención.)';
    return 'Consultas cubiertas: te ' + (c.restantes === 1 ? 'queda' : 'quedan') + ' ' + c.restantes + ' de ' + r.cupoAnual + ' este año. (El turno no descuenta: se cuenta cuando el vet registra la atención.)';
  } catch (_) { return ''; }
}

class TurnoError extends Error { constructor(code) { super(code); this.code = code; } }

// ── RESERVA (TX atómica) ──
// deps = { db, FV, MC }. args = { uid, agendaId, hora, mascotaId }. Devuelve { turno, info }.
async function reservar(deps, args, nowMs) {
  const { db, FV, MC } = deps;
  const uid = args.uid, agendaId = String(args.agendaId || ''), hora = String(args.hora || ''), mascotaId = String(args.mascotaId || '');
  if (!agendaId || !hora || !mascotaId) throw new TurnoError('datos-incompletos');

  // Dueñez + nombre: la mascota debe ser del titular (titularUid==uid). Fuera de la TX (no cambia la atomicidad del slot).
  const mSnap = await db.collection('mascotas').where('titularUid', '==', uid).where('mascotaId', '==', mascotaId).limit(1).get();
  if (mSnap.empty) throw new TurnoError('mascota-no-es-tuya');
  const mascota = { id: mSnap.docs[0].id, ...mSnap.docs[0].data() };
  const mascotaNombre = mascota.nombre || '';

  const agendaRef = db.collection('agenda_turnos').doc(agendaId);
  const turnoRef = db.collection('turnos').doc(); // autoId

  const out = await db.runTransaction(async (tx) => {
    const agSnap = await tx.get(agendaRef);
    const agenda = agSnap.exists ? agSnap.data() : null;
    // ¿ya tiene un turno 'creado' a futuro esta mascota? (máx 1). Query dentro de la TX, filtrada por fecha en código.
    const futSnap = await tx.get(db.collection('turnos').where('mascotaId', '==', mascotaId).where('estado', '==', 'creado'));
    const hoy = fechaStrBA(nowMs);
    const yaTieneTurnoFuturo = futSnap.docs.some((d) => String((d.data() || {}).fecha || '') >= hoy);

    const v = validarReserva(agenda, hora, nowMs, yaTieneTurnoFuturo);
    if (!v.ok) throw new TurnoError(v.code);

    const tomados = Array.isArray(agenda.slotsTomados) ? agenda.slotsTomados : [];
    tx.update(agendaRef, { slotsTomados: tomados.concat([hora]), actualizadoEn: FV() });
    tx.set(turnoRef, {
      fecha: agenda.fecha, hora, agendaId, mascotaId, mascotaNombre,
      titularUid: uid, reservadoPorUid: uid, estado: 'creado', creadoEn: FV(),
    });
    return { fecha: agenda.fecha, hora };
  });

  // Info del motor (fuera de la TX; no bloquea). Lee las atenciones de la mascota para el cupo de 'consulta'.
  let info = '';
  try {
    const aSnap = await db.collection('atenciones').where('titularUid', '==', uid).where('mascotaId', '==', mascotaId).get();
    info = infoConsulta(MC, mascota, aSnap.docs.map((d) => d.data()), nowMs);
  } catch (_) { info = ''; }

  return { turno: { turnoId: turnoRef.id, fecha: out.fecha, hora: out.hora, mascotaId, mascotaNombre, estado: 'creado' }, info };
}

// ── CANCELACIÓN (TX atómica) — valida dueño + turno futuro + libera el slot ──
async function cancelar(deps, args, nowMs) {
  const { db, FV } = deps;
  const uid = args.uid, turnoId = String(args.turnoId || '');
  if (!turnoId) throw new TurnoError('datos-incompletos');
  const turnoRef = db.collection('turnos').doc(turnoId);

  return await db.runTransaction(async (tx) => {
    const tSnap = await tx.get(turnoRef);
    if (!tSnap.exists) throw new TurnoError('turno-inexistente');
    const t = tSnap.data();
    if (t.titularUid !== uid) throw new TurnoError('no-es-tuyo');
    if (t.estado !== 'creado') throw new TurnoError('no-cancelable'); // solo un turno vivo se cancela
    if (String(t.fecha || '') < fechaStrBA(nowMs)) throw new TurnoError('turno-pasado');

    // Liberar el slot en la franja (si sigue existiendo).
    const agendaRef = db.collection('agenda_turnos').doc(String(t.agendaId || ''));
    const agSnap = await tx.get(agendaRef);
    if (agSnap.exists) {
      const tomados = Array.isArray(agSnap.data().slotsTomados) ? agSnap.data().slotsTomados : [];
      tx.update(agendaRef, { slotsTomados: tomados.filter((h) => h !== t.hora), actualizadoEn: FV() });
    }
    tx.update(turnoRef, { estado: 'cancelado', canceladoEn: FV() });
    return { turnoId, estado: 'cancelado' };
  });
}

module.exports = { reservar, cancelar, validarReserva, ventanaOk, horaAlineada, horaAMin, fechaStrBA, addDiasStr, infoConsulta, TurnoError };
