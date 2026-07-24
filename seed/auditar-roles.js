'use strict';
/* AUDITORÍA READ-ONLY de roles (Admin SDK). NO modifica nada. Lista usuarios/{uid} con email + roles[], marca
 * privilegios (admin/veterinario/prestador) y, para cada privilegiado, rastrea ESCRITURAS en casos_clinico
 * (tomadoPor/actualizadoPor). Las LECTURAS no quedan registradas por Admin SDK (harían falta Cloud Audit Logs).
 *   node seed/auditar-roles.js */
const path = require('path'), admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.cert(require(path.resolve(__dirname, 'serviceAccountKey.json'))) });
const db = admin.firestore(), auth = admin.auth();
const PRIV = ['admin', 'veterinario', 'prestador'];
const ESPERADOS = { 'lucasmarinoaguirre@gmail.com': ['afiliado', 'admin'] }; // Carleti: email desconocido → se lista para que Lucas confirme

(async () => {
  const snap = await db.collection('usuarios').get();
  const docs = [];
  for (const d of snap.docs) {
    const u = d.data();
    let email = u.email || '';
    if (!email) { try { email = (await auth.getUser(d.id)).email || ''; } catch (_) {} }
    const roles = Array.isArray(u.roles) ? u.roles : (u.rol ? [u.rol] : []);
    docs.push({ uid: d.id, email, roles });
  }
  console.log('\n=== TODOS los usuarios (' + docs.length + ') ===');
  docs.forEach(x => {
    const priv = x.roles.filter(r => PRIV.includes(r));
    console.log((priv.length ? '  🔑 ' : '     ') + x.uid + '  ' + (x.email || '(sin email)') + '  roles=' + JSON.stringify(x.roles) + (priv.length ? '  ← ' + priv.join(',') : ''));
  });

  const privis = docs.filter(x => x.roles.some(r => PRIV.includes(r)));
  console.log('\n=== PRIVILEGIADOS (' + privis.length + ') ===');
  const sospechosos = [];
  for (const x of privis) {
    const esperado = ESPERADOS[x.email];
    const okAdmin = x.email === 'lucasmarinoaguirre@gmail.com'; // único admin esperado
    const soloVetAfil = x.roles.every(r => ['veterinario', 'prestador', 'afiliado'].includes(r)); // patrón de vet legítimo (Carleti u otros vets)
    let veredicto;
    if (esperado && JSON.stringify(x.roles.slice().sort()) === JSON.stringify(esperado.slice().sort())) veredicto = 'ESPERADO (Lucas)';
    else if (x.roles.includes('admin') && !okAdmin) { veredicto = '🚨 ADMIN NO ESPERADO'; sospechosos.push(x); }
    else if (soloVetAfil) veredicto = 'vet — confirmar si es Carleti u otro vet legítimo';
    else { veredicto = '🚨 REVISAR'; sospechosos.push(x); }
    console.log('  ' + x.uid + '  ' + (x.email || '(sin email)') + '  ' + JSON.stringify(x.roles) + '  → ' + veredicto);
  }

  // Rastreo de ESCRITURAS en casos_clinico por cada privilegiado (write-trace; lecturas no auditables acá).
  console.log('\n=== ESCRITURAS en casos_clinico por privilegiados ===');
  const cc = await db.collection('casos_clinico').get();
  const porUid = {};
  cc.docs.forEach(d => { const c = d.data(); [c.tomadoPor, c.actualizadoPor].filter(Boolean).forEach(u => { (porUid[u] = porUid[u] || []).push(d.id); }); });
  if (cc.empty) console.log('  (casos_clinico vacío)');
  privis.forEach(x => { const w = porUid[x.uid]; if (w) console.log('  ' + x.uid + ' (' + x.email + ') escribió en casos_clinico: ' + w.join(', ')); });
  const huerfanos = Object.keys(porUid).filter(u => !docs.find(x => x.uid === u));
  if (huerfanos.length) console.log('  ⚠️ uids que escribieron casos_clinico y NO están en usuarios:', huerfanos.join(', '));

  console.log('\n=== RESUMEN ===');
  console.log('  sospechosos (no esperados): ' + (sospechosos.length ? sospechosos.map(s => s.email || s.uid).join(', ') : 'NINGUNO ✓'));
  console.log('  (LECTURAS de casos_clinico: no verificables por Admin SDK; requieren Cloud Audit Logs de Firestore.)');
  process.exit(0);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
