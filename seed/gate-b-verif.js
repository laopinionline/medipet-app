'use strict';
/*
 * GATE B — verificación de reglas de casos (N3) + setup para probar el flujo del vet SIN entrar contraseñas.
 * Admin SDK + REST (Identity Toolkit + Firestore REST) con la identidad REAL de un titular puro.
 *   node seed/gate-b-verif.js setup     # crea cuentas desechables, prueba N3 por REST, imprime custom-token del vet
 *   node seed/gate-b-verif.js cleanup   # borra las cuentas desechables (NO borra el caso PRUEBA)
 * Requiere seed/serviceAccountKey.json. WEB_API_KEY es la pública del app config.
 */
const path = require('path'), admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.cert(require(path.resolve(__dirname, 'serviceAccountKey.json'))) });
const db = admin.firestore(), auth = admin.auth();
const WEB_API_KEY = 'AIzaSyBW3nLFqr55xYN16rSpapqIb6yVnyKbp-4';
const PROJECT = 'medipet-c3a4d';
const MODE = process.argv[2] || 'setup';

const TIT = { email: 'gateb-titular@medipaw.test', pass: 'gateb-desechable-9f2', nombre: 'GateB', apellido: 'Titular' };
const VET = { email: 'gateb-vet@medipaw.test', pass: 'gateb-desechable-9f2', nombre: 'GateB', apellido: 'Vet' };

async function ensureUser(u, roles) {
  let rec;
  try { rec = await auth.getUserByEmail(u.email); }
  catch (_) { rec = await auth.createUser({ email: u.email, password: u.pass, displayName: u.nombre }); }
  await db.collection('usuarios').doc(rec.uid).set({ uid: rec.uid, nombre: u.nombre, apellido: u.apellido, email: u.email, roles: roles, estado: 'activo', creadoEn: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  return rec.uid;
}
async function delUser(email) {
  try { const r = await auth.getUserByEmail(email); await db.collection('usuarios').doc(r.uid).delete().catch(()=>{}); await auth.deleteUser(r.uid); console.log('  borrado', email); }
  catch (_) { console.log('  (no existía)', email); }
}
async function idTokenDe(uid) {
  const ct = await auth.createCustomToken(uid);
  const r = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=' + WEB_API_KEY,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: ct, returnSecureToken: true }) });
  const j = await r.json();
  if (!j.idToken) throw new Error('no idToken: ' + JSON.stringify(j));
  return j.idToken;
}
async function restGet(idToken, pathDoc) {
  const r = await fetch('https://firestore.googleapis.com/v1/projects/' + PROJECT + '/databases/(default)/documents/' + pathDoc,
    { headers: { Authorization: 'Bearer ' + idToken } });
  return r.status;
}

(async () => {
  if (MODE === 'cleanup') {
    console.log('\n=== CLEANUP cuentas desechables + caso PRUEBA ===');
    await delUser(TIT.email); await delUser(VET.email);
    // borrar el caso PRUEBA (y su clínico)
    const cs = await db.collection('casos').get();
    for (const d of cs.docs) {
      if (String(d.data().relato || '').toUpperCase().includes('PRUEBA GATE B')) {
        await db.collection('casos_clinico').doc(d.id).delete().catch(()=>{});
        await d.ref.delete();
        console.log('  borrado caso PRUEBA', d.id, '+ casos_clinico');
      }
    }
    process.exit(0);
  }
  console.log('\n=== GATE B — setup + prueba N3 ===\n');
  // Caso PRUEBA (lo dejó Lucas)
  const casosSnap = await db.collection('casos').get();
  const prueba = casosSnap.docs.map(d => ({ id: d.id, ...d.data() })).find(c => String(c.relato || '').toUpperCase().includes('PRUEBA GATE B'));
  if (!prueba) { console.log('⚠️ no encontré el caso "PRUEBA GATE B". Casos existentes:', casosSnap.docs.map(d=>d.data().relato).slice(0,5)); process.exit(1); }
  console.log('caso PRUEBA:', prueba.id, '· mascota', prueba.mascotaId, '· estado', prueba.estado, '· relato:', String(prueba.relato).slice(0,40));

  const titUid = await ensureUser(TIT, ['afiliado']);      // titular PURO (sin admin/vet)
  const vetUid = await ensureUser(VET, ['veterinario']);   // vet puro (para correr la UI)
  console.log('titular puro uid:', titUid, '· vet uid:', vetUid);

  // ── PRUEBA N3: titular PURO por REST ──
  console.log('\n— N3: titular PURO leyendo por REST (reglas reales de prod) —');
  const tokTit = await idTokenDe(titUid);
  const s1 = await restGet(tokTit, 'casos_clinico/' + prueba.id);
  console.log('  GET casos_clinico/' + prueba.id + ' → HTTP ' + s1 + '  ' + (s1 === 403 ? '✓ DENIED (N3 OK)' : '✗ ESPERABA 403'));
  const s2 = await restGet(tokTit, 'casos/' + prueba.id);
  console.log('  GET casos/' + prueba.id + ' (no es suyo) → HTTP ' + s2 + '  ' + (s2 === 403 ? '✓ DENIED (no lee casos ajenos)' : '✗ ESPERABA 403'));

  // Custom token del VET para el navegador (signInWithCustomToken, sin password)
  const ctVet = await auth.createCustomToken(vetUid);
  console.log('\n— CUSTOM TOKEN del vet (para el navegador, sin password) —');
  console.log('VET_CUSTOM_TOKEN=' + ctVet);
  console.log('\ncaso PRUEBA id =', prueba.id);
  process.exit(0);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
