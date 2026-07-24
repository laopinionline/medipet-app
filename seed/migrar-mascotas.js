'use strict';
/*
 * MEDIPaw F0.5 — MIGRACIÓN usuarios.mascotas[] -> colección mascotas/{mascotaId}. Admin SDK.
 * NO se corre solo: lo dispara Lucas con AVISO PREVIO. Usa la transformación PURA de lib/medipaw-core
 * (misma que el portal y los smokes) → idempotente y verificable.
 *
 *   node seed/migrar-mascotas.js            # DRY-RUN (default): muestra qué haría, NO escribe nada
 *   node seed/migrar-mascotas.js --write    # escribe de verdad (idempotente: merge por mascotaId)
 *   node seed/migrar-mascotas.js --write --force   # además pisa docs mascota ya existentes
 *
 * Requiere seed/serviceAccountKey.json (proyecto medipet-c3a4d). NO borra usuarios.mascotas[]
 * (el array embebido queda como respaldo; se retira en un tramo posterior, ya con el portal migrado).
 * `creadoEn`: si el titular no lo trae, se estampa serverTimestamp acá (no inventamos fecha).
 */
var path = require('path');
var admin = require('firebase-admin');
var C = require('../lib/medipaw-core');

var WRITE = process.argv.includes('--write');
var FORCE = process.argv.includes('--force');

admin.initializeApp({ credential: admin.credential.cert(require(path.resolve(__dirname, 'serviceAccountKey.json'))) });
var db = admin.firestore();

(async function () {
  console.log('\n=== MIGRACIÓN mascotas — modo ' + (WRITE ? (FORCE ? 'WRITE+FORCE' : 'WRITE') : 'DRY-RUN') + ' ===\n');
  var snap = await db.collection('usuarios').get();
  var totalDocs = 0, totalSaltadas = 0, totalYaExisten = 0, totalEscritos = 0, titulares = 0;

  for (var i = 0; i < snap.docs.length; i++) {
    var d = snap.docs[i];
    var u = Object.assign({ uid: d.id }, d.data());
    if (!Array.isArray(u.mascotas) || u.mascotas.length === 0) continue; // no es titular con mascotas
    titulares++;
    var res = C.migrarUsuario(u);

    for (var j = 0; j < res.docs.length; j++) {
      var doc = res.docs[j];
      totalDocs++;
      // creadoEn: preservar el del titular; si null, estampar serverTimestamp al escribir.
      var payload = Object.assign({}, doc);
      if (payload.creadoEn == null) payload.creadoEn = admin.firestore.FieldValue.serverTimestamp();

      var ref = db.collection('mascotas').doc(doc.mascotaId);
      var existe = (await ref.get()).exists;
      if (existe && !FORCE) {
        totalYaExisten++;
        console.log('  = ya existe  ' + doc.mascotaId + '  (' + doc.nombre + ')  → se omite (usá --force para pisar)');
        continue;
      }
      console.log('  ' + (WRITE ? '→ escribe ' : '· (dry) ') + doc.mascotaId + '  ' + doc.nombre +
        '  [' + doc.plan + ' · ' + doc.estado + ' · $' + doc.cuota + ']  titular=' + doc.titularUid);
      if (WRITE) { await ref.set(payload, { merge: true }); totalEscritos++; }
    }

    res.saltadas.forEach(function (s) {
      totalSaltadas++;
      console.log('  ⚠ SALTADA  titular=' + s.titularUid + '  mascota=' + s.nombre + '  (' + s.motivo + ')  → se materializa al activar');
    });
  }

  console.log('\n--- Resumen ---');
  console.log('  titulares con mascotas : ' + titulares);
  console.log('  mascotas proyectadas   : ' + totalDocs);
  console.log('  ya existían            : ' + totalYaExisten + (FORCE ? ' (pisadas por --force)' : ' (omitidas)'));
  console.log('  saltadas (sin id)      : ' + totalSaltadas);
  console.log('  escritas               : ' + (WRITE ? totalEscritos : 0) + (WRITE ? '' : '  (DRY-RUN, no se escribió nada)'));
  console.log('\n' + (WRITE ? '✓ migración aplicada' : 'ℹ DRY-RUN — volvé a correr con --write para aplicar') + '\n');
  process.exit(0);
})().catch(function (e) { console.error('ERROR:', e.message); process.exit(1); });
