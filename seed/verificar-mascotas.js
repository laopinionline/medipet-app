'use strict';
// Verificación post-migración: lee la colección mascotas y valida cobertura/facturación con el núcleo puro.
const path = require('path'), admin = require('firebase-admin'), C = require('../lib/medipaw-core');
admin.initializeApp({ credential: admin.credential.cert(require(path.resolve(__dirname, 'serviceAccountKey.json'))) });
const db = admin.firestore();
(async () => {
  const s = await db.collection('mascotas').get();
  console.log('docs en colección mascotas:', s.size);
  s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => String(a.mascotaId).localeCompare(String(b.mascotaId))).forEach(m => {
    const c = C.coberturaMascota(m);
    console.log('  ' + m.mascotaId + ' · ' + m.nombre + ' · plan=' + m.plan + ' · estado=' + m.estado + ' · cuota=$' + m.cuota + ' · titularUid=' + m.titularUid + ' · cobertura.ok=' + c.ok + ' · token=' + (m.token ? 'sí' : 'no') + ' · creadoEn=' + (m.creadoEn && m.creadoEn.toDate ? m.creadoEn.toDate().toISOString() : m.creadoEn));
  });
  const rn = C.resumenNegocio(s.docs.map(d => d.data()));
  console.log('RESUMEN: mascotasActivas=' + rn.mascotasActivas + ' · facturacion=$' + rn.facturacion + ' · planCount=' + JSON.stringify(rn.planCount));
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
