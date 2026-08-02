'use strict';
/*
 * TIENDA / PAGO — acreditación del pago de un pedido. Server-side (VPS, Admin SDK).
 * DOS EJES (ver vault Tienda): logística (`estado`) y pago (`pago`) son independientes. Este módulo mueve SOLO el pago.
 *
 * MODO SIMULADO (default, flag `simulado`): acredita el pago directo — `pago:'acreditado'` + `metodo:'mp'` +
 * `pagadoEn` + `simulado:true`. El cliente NUNCA acredita (reglas: el titular no puede tocar `pago`; lo setea solo
 * admin/backend por Admin SDK). El CONTRATO queda listo para MP real en productivo: el mismo endpoint, en modo
 * NO-simulado, creará la preferencia de pago y el webhook la acreditará — se cambia el ADENTRO, no el contrato.
 *
 * No requiere firebase-admin: recibe `db`/`FV` del server. La validación pura se exporta y se testea sin Firestore.
 */

class PagoError extends Error { constructor(code) { super(code); this.code = code; } }

// Validación PURA: ¿este uid puede pagar este pedido? { ok, code }. (idempotente: 'ya-pagado' si ya está acreditado)
function validarPago(pedido, uid) {
  if (!pedido) return { ok: false, code: 'pedido-inexistente' };
  if (pedido.titularUid !== uid) return { ok: false, code: 'no-es-tuyo' };
  if (pedido.pago === 'acreditado') return { ok: false, code: 'ya-pagado' };
  if (pedido.pago !== 'pendiente') return { ok: false, code: 'pago-invalido' };
  return { ok: true };
}

// Acredita el pago de un pedido en una TX (re-lee el pago adentro → sin doble acreditación).
// deps = { db, FV }. args = { uid, pedidoId }. opts = { simulado }. Devuelve { pedidoId, pago, metodo, simulado }.
async function pagar(deps, args, opts, nowMs) {
  const { db, FV } = deps;
  const uid = args.uid, pedidoId = String((args && args.pedidoId) || '');
  const simulado = !!(opts && opts.simulado);
  if (!pedidoId) throw new PagoError('datos-incompletos');
  const ref = db.collection('pedidos').doc(pedidoId);

  return await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const pedido = snap.exists ? snap.data() : null;
    const v = validarPago(pedido, uid);
    if (!v.ok) throw new PagoError(v.code);
    // En productivo (simulado=false): acá se crea la preferencia real de MP y el webhook acredita luego.
    if (!simulado) throw new PagoError('mp-real-no-configurado');
    tx.update(ref, { pago: 'acreditado', metodo: 'mp', pagadoEn: FV(), simulado: true, actualizadoEn: FV() });
    return { pedidoId, pago: 'acreditado', metodo: 'mp', simulado: true };
  });
}

module.exports = { pagar, validarPago, PagoError };
