'use strict';
/*
 * BACKFILL — mueve el `token` del array embebido usuarios.mascotas[] a la colección mascotas/{mascotaId}.
 * La colección pasa a ser la fuente del token (ficha pública /m/{token}). IDEMPOTENTE (solo setea si el token de la
 * colección está vacío o difiere) y DRY-RUN por defecto. Detecta colisiones (token embebido ya usado por otra mascota).
 *   node seed/backfill-tokens.js            # DRY-RUN
 *   node seed/backfill-tokens.js --write     # aplica
 */
const path = require('path'), admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.cert(require(path.resolve(__dirname, 'serviceAccountKey.json'))) });
const db = admin.firestore();
const WRITE = process.argv.includes('--write');

(async () => {
  console.log('\n=== BACKFILL tokens embebido → colección — ' + (WRITE ? 'WRITE' : 'DRY-RUN') + ' ===\n');
  const us = await db.collection('usuarios').get();
  const masSnap = await db.collection('mascotas').get();
  const colToken = {};   // mascotaId → token actual en la colección
  const tokenOwner = {}; // token → mascotaId (para colisiones)
  masSnap.docs.forEach(d => { const m = d.data(); colToken[d.id] = m.token || ''; if (m.token) tokenOwner[m.token] = d.id; });

  let movidos = 0, yaOk = 0, colisiones = 0, saltados = 0;
  for (const ud of us.docs) {
    const arr = Array.isArray(ud.data().mascotas) ? ud.data().mascotas : [];
    for (const m of arr) {
      if (!m || !m.mascotaId || !m.token) continue; // sin token embebido → nada que mover
      const actual = colToken[m.mascotaId];
      if (actual === undefined) { console.log('  ⚠ SALTO ' + m.mascotaId + ' (embebida, no está en la colección)'); saltados++; continue; }
      if (actual === m.token) { yaOk++; continue; }
      if (tokenOwner[m.token] && tokenOwner[m.token] !== m.mascotaId) { console.log('  🚨 COLISIÓN token de ' + m.mascotaId + ' ya usado por ' + tokenOwner[m.token] + ' → NO se mueve'); colisiones++; continue; }
      console.log('  ' + (WRITE ? '→ mueve ' : '· (dry) ') + m.mascotaId + '  ' + (actual ? ('[' + actual + ']') : '(vacío)') + ' → [' + m.token + ']  (' + (m.nombre || '') + ')');
      if (WRITE) { await db.collection('mascotas').doc(m.mascotaId).set({ token: m.token }, { merge: true }); tokenOwner[m.token] = m.mascotaId; colToken[m.mascotaId] = m.token; }
      movidos++;
    }
  }

  console.log('\n--- Resumen ---');
  console.log('  a mover / movidos : ' + movidos + (WRITE ? '' : '  (DRY-RUN, no escribió)'));
  console.log('  ya en la colección: ' + yaOk);
  console.log('  colisiones (no mov): ' + colisiones);
  console.log('  saltados (no en col): ' + saltados);
  console.log('\n' + (WRITE ? '✓ backfill aplicado' : 'ℹ DRY-RUN — corré con --write para aplicar') + '\n');
  process.exit(0);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
