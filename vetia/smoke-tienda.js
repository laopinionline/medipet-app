'use strict';
/*
 * TIENDA / PAGO — SMOKE del contrato del endpoint (sin Firestore real; TX mockeada). Determinista.
 * Cubre: validarPago (dueño / pendiente / idempotencia) + pagar (acredita en simulado, no re-acredita, no toca
 * si es ajeno/inexistente, y en NO-simulado espera MP real sin acreditar). Corré:  node vetia/smoke-tienda.js
 */
const TN = require('./tienda.js');
let ok = 0, fail = 0;
function assert(c, l) { if (c) { ok++; console.log('✓ ' + l); } else { fail++; console.log('✗ ' + l); } }

console.log('== validarPago (pura) ==');
assert(TN.validarPago({ titularUid: 'u1', pago: 'pendiente' }, 'u1').ok, 'dueño + pendiente → ok');
assert(TN.validarPago(null, 'u1').code === 'pedido-inexistente', 'null → pedido-inexistente');
assert(TN.validarPago({ titularUid: 'u2', pago: 'pendiente' }, 'u1').code === 'no-es-tuyo', 'ajeno → no-es-tuyo');
assert(TN.validarPago({ titularUid: 'u1', pago: 'acreditado' }, 'u1').code === 'ya-pagado', 'ya acreditado → ya-pagado (idempotente)');
assert(TN.validarPago({ titularUid: 'u1', pago: 'raro' }, 'u1').code === 'pago-invalido', 'pago inválido → pago-invalido');

function fakeDeps(pedido) {
  const cap = { updated: null, ref: {} };
  const db = {
    collection: () => ({ doc: () => cap.ref }),
    runTransaction: async (fn) => fn({ get: async () => ({ exists: pedido != null, data: () => pedido }), update: (ref, d) => { cap.updated = d; } }),
  };
  return { deps: { db, FV: () => 'TS' }, cap };
}

(async () => {
  console.log('\n== pagar (TX mockeada) ==');
  { const { deps, cap } = fakeDeps({ titularUid: 'u1', pago: 'pendiente' });
    const out = await TN.pagar(deps, { uid: 'u1', pedidoId: 'P1' }, { simulado: true }, 0);
    assert(out.pago === 'acreditado' && out.metodo === 'mp' && out.simulado === true, 'simulado → out { acreditado, mp, simulado }');
    assert(cap.updated && cap.updated.pago === 'acreditado' && cap.updated.metodo === 'mp' && cap.updated.simulado === true && ('pagadoEn' in cap.updated), 'update escribe pago/metodo/simulado/pagadoEn'); }
  { const { deps, cap } = fakeDeps({ titularUid: 'u2', pago: 'pendiente' });
    let err = null; try { await TN.pagar(deps, { uid: 'u1', pedidoId: 'P1' }, { simulado: true }, 0); } catch (e) { err = e; }
    assert(err && err.code === 'no-es-tuyo', 'pedido ajeno → no-es-tuyo'); assert(cap.updated === null, 'ajeno → NO escribe'); }
  { const { deps, cap } = fakeDeps({ titularUid: 'u1', pago: 'acreditado' });
    let err = null; try { await TN.pagar(deps, { uid: 'u1', pedidoId: 'P1' }, { simulado: true }, 0); } catch (e) { err = e; }
    assert(err && err.code === 'ya-pagado', 'ya acreditado → ya-pagado'); assert(cap.updated === null, 'ya-pagado → NO re-escribe (idempotente)'); }
  { const { deps, cap } = fakeDeps({ titularUid: 'u1', pago: 'pendiente' });
    let err = null; try { await TN.pagar(deps, { uid: 'u1', pedidoId: 'P1' }, { simulado: false }, 0); } catch (e) { err = e; }
    assert(err && err.code === 'mp-real-no-configurado', 'simulado=false → mp-real-no-configurado'); assert(cap.updated === null, 'no-simulado → NO acredita (espera MP real)'); }
  { const { deps } = fakeDeps(null);
    let err = null; try { await TN.pagar(deps, { uid: 'u1', pedidoId: 'P1' }, { simulado: true }, 0); } catch (e) { err = e; }
    assert(err && err.code === 'pedido-inexistente', 'inexistente → pedido-inexistente'); }
  { const { deps } = fakeDeps({ titularUid: 'u1', pago: 'pendiente' });
    let err = null; try { await TN.pagar(deps, { uid: 'u1', pedidoId: '' }, { simulado: true }, 0); } catch (e) { err = e; }
    assert(err && err.code === 'datos-incompletos', 'sin pedidoId → datos-incompletos'); }

  console.log(`\n== RESULTADO: ${ok} ok, ${fail} fail ==`);
  if (fail) { console.error('SMOKE ROJO'); process.exit(1); }
  console.log('SMOKE VERDE');
})();
