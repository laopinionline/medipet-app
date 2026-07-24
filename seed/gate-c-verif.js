'use strict';
/*
 * GATE C — setup para probar "Marcar pagado" (custom-token de admin desechable, sin password) + cleanup de la data
 * de prueba (comprobantes + contador). Admin SDK.
 *   node seed/gate-c-verif.js setup     # crea admin desechable, imprime custom-token + comprobantes existentes
 *   node seed/gate-c-verif.js cleanup   # borra admin desechable + TODOS los comprobantes + contadores/comprobantes; confirma 0
 */
const path = require('path'), admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.cert(require(path.resolve(__dirname, 'serviceAccountKey.json'))) });
const db = admin.firestore(), auth = admin.auth();
const MODE = process.argv[2] || 'setup';
const ADM = { email: 'gatec-admin@medipaw.test', pass: 'gatec-desechable-7k1', nombre: 'GateC', apellido: 'Admin' };

async function delUser(email) {
  try { const r = await auth.getUserByEmail(email); await db.collection('usuarios').doc(r.uid).delete().catch(()=>{}); await auth.deleteUser(r.uid); console.log('  borrado', email); }
  catch (_) { console.log('  (no existía)', email); }
}

(async () => {
  if (MODE === 'cleanup') {
    console.log('\n=== CLEANUP GATE C ===');
    await delUser(ADM.email);
    const cs = await db.collection('comprobantes').get();
    for (const d of cs.docs) { await d.ref.delete(); console.log('  borrado comprobante', d.data().nroComprobante || d.id); }
    await db.collection('contadores').doc('comprobantes').delete().catch(()=>{});
    console.log('  borrado contadores/comprobantes');
    const restan = (await db.collection('comprobantes').get()).size;
    console.log('\ncomprobantes restantes:', restan, restan === 0 ? '✓' : '✗');
    process.exit(0);
  }
  console.log('\n=== GATE C — setup ===\n');
  let rec; try { rec = await auth.getUserByEmail(ADM.email); } catch (_) { rec = await auth.createUser({ email: ADM.email, password: ADM.pass, displayName: ADM.nombre }); }
  await db.collection('usuarios').doc(rec.uid).set({ uid: rec.uid, nombre: ADM.nombre, apellido: ADM.apellido, email: ADM.email, roles: ['admin'], estado: 'activo', creadoEn: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  const ct = await auth.createCustomToken(rec.uid);
  const cs = await db.collection('comprobantes').get();
  console.log('comprobantes existentes:', cs.size);
  cs.docs.forEach(d => { const c = d.data(); console.log('  id=' + d.id + ' · ' + (c.nroComprobante||'') + ' · ' + (c.titularNombre||'') + ' · ' + (c.periodo||'') + ' · $' + (c.total||0) + ' · ' + (c.estado||'') + ' · items=' + JSON.stringify((c.items||[]).map(it=>it.mascotaNombre+':$'+it.monto))); });
  console.log('\nADMIN_CUSTOM_TOKEN=' + ct);
  process.exit(0);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
