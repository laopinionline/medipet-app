'use strict';
/*
 * MEDIPaw — EMISIÓN AUTOMÁTICA DE CUOTAS (cron del VPS). Regla de negocio (Lucas 04/08): la cuota se FACTURA el día 5
 * de cada mes y VENCE el 10 (el núcleo ya fija COMPROBANTE_DIA_VENCIMIENTO=10). Este script REPLICA server-side el botón
 * "Emitir" del panel: un comprobante por titular afiliado con mascotas ACTIVAS al correr, congelando plan+monto con el
 * NÚCLEO (fuente única). IDEMPOTENTE: no re-emite si el titular ya tiene comprobante de ese período (mes completo, sin
 * prorrateo — invariante #6; una activación posterior al 5 entra en el ciclo del mes siguiente, automático).
 *
 * SA: MEDIPAW_SA_PROD | FIREBASE_SA_PATH_PROD (el mismo que usa el servicio vetia) | ./serviceAccountKey.json (local).
 * Correr:  MEDIPAW_SA_PROD=/ruta/serviceAccount.json node seed/emitir-cuotas-cron.js
 *   flags: --periodo=YYYY-MM (default: mes corriente en hora AR) · --dry (no escribe, solo informa)
 * Crontab (VPS, día 5 06:00 AR):  CRON_TZ=America/Argentina/Buenos_Aires  0 6 5 * *  cd <repo> && node seed/emitir-cuotas-cron.js >> ~/logs/cuotas-emision.log 2>&1
 */
const path = require('path');
const admin = require('firebase-admin');
const MC = require('../lib/medipaw-core.js');

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const perArg = (args.find(a => a.startsWith('--periodo=')) || '').split('=')[1] || '';
const saPath = process.env.MEDIPAW_SA_PROD || process.env.FIREBASE_SA_PATH_PROD || path.resolve(__dirname, 'serviceAccountKey.json');

admin.initializeApp({ credential: admin.credential.cert(require(path.resolve(saPath))) });
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const Timestamp = admin.firestore.Timestamp;

// Período YYYY-MM del mes corriente en hora de Buenos Aires (no depende del TZ del server).
function periodoAR() {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
  return p.find(x => x.type === 'year').value + '-' + p.find(x => x.type === 'month').value;
}
function getRoles(u) { return Array.isArray(u.roles) ? u.roles : (u.rol ? [u.rol] : []); }
// Nº correlativo — MISMA lógica que el panel (contadores/comprobantes.ultimo, en transacción).
async function siguienteNro() {
  const ref = db.collection('contadores').doc('comprobantes');
  return db.runTransaction(async (tx) => { const s = await tx.get(ref); const n = ((s.exists && s.data().ultimo) || 0) + 1; tx.set(ref, { ultimo: n }, { merge: true }); return n; });
}
const stamp = () => new Date().toISOString();

(async () => {
  const periodo = /^\d{4}-\d{2}$/.test(perArg) ? perArg : periodoAR();
  const [usSnap, masSnap, compSnap] = await Promise.all([
    db.collection('usuarios').get(),
    db.collection('mascotas').get(),
    db.collection('comprobantes').where('periodo', '==', periodo).get(),
  ]);
  const yaEmitido = new Set(compSnap.docs.map(d => d.data().titularUid));
  const masPorTit = {};
  masSnap.docs.forEach(d => { const m = { id: d.id, ...d.data() }; (masPorTit[m.titularUid] = masPorTit[m.titularUid] || []).push(m); });
  const venceISO = MC.venceComprobanteISO(periodo);
  const venceTs = venceISO ? Timestamp.fromDate(new Date(venceISO)) : null;

  let emit = 0, skip = 0, sinAct = 0;
  for (const d of usSnap.docs) {
    const u = { id: d.id, ...d.data() };
    if (!getRoles(u).includes('afiliado')) continue;
    if (yaEmitido.has(u.id)) { skip++; continue; }                    // IDEMPOTENTE
    const snap = MC.armarComprobante(masPorTit[u.id] || [], periodo);  // congela plan+monto (núcleo)
    if (!snap.items.length) { sinAct++; continue; }                   // sin mascotas activas → no factura
    if (DRY) { emit++; continue; }
    const nro = await siguienteNro();
    await db.collection('comprobantes').add({
      titularUid: u.id, titularNombre: ((u.nombre || '') + ' ' + (u.apellido || '')).trim(), nroSocio: u.nroSocio || '',
      periodo, items: snap.items, total: snap.total, estado: 'emitida', fiscal: false,
      venceEl: venceTs, nroComprobante: MC.fmtComprobante(nro), emitidaEn: FieldValue.serverTimestamp(), emitidaPor: 'cron:vps',
    });
    emit++;
  }
  console.log(`[${stamp()}] cuotas ${periodo}${DRY ? ' (DRY)' : ''} · emitidos ${emit} · ya existían ${skip} · sin activas ${sinAct}`);
  process.exit(0);
})().catch((e) => { console.error(`[${stamp()}] ERROR cuotas: ${e.message}`); process.exit(1); });
