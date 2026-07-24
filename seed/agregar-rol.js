'use strict';
/*
 * MEDIPaw — Agrega rol(es) al array `roles` de un usuario. Admin SDK. ADITIVO (union, no pisa lo existente),
 * IDEMPOTENTE (si ya los tiene, no escribe) y DRY-RUN por defecto. Busca el usuario por email (Auth → uid → doc).
 *   node seed/agregar-rol.js <email> <rol1> [rol2 ...]            # DRY-RUN (muestra, no escribe)
 *   node seed/agregar-rol.js <email> <rol1> [rol2 ...] --write    # aplica
 * Roles válidos: admin | veterinario | afiliado.
 */
const path = require('path'), admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.cert(require(path.resolve(__dirname, 'serviceAccountKey.json'))) });
const db = admin.firestore(), auth = admin.auth();

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const rest = args.filter(a => a !== '--write');
const email = rest[0];
const rolesToAdd = rest.slice(1);
const VALID = ['admin', 'veterinario', 'afiliado'];

if (!email || rolesToAdd.length === 0) { console.error('uso: node seed/agregar-rol.js <email> <rol...> [--write]'); process.exit(1); }
const invalid = rolesToAdd.filter(r => !VALID.includes(r));
if (invalid.length) { console.error('rol(es) inválido(s): ' + invalid.join(', ') + ' · válidos: ' + VALID.join('/')); process.exit(1); }

(async () => {
  console.log('\n=== AGREGAR ROL — modo ' + (WRITE ? 'WRITE' : 'DRY-RUN') + ' ===\n');
  let uid;
  try { uid = (await auth.getUserByEmail(email)).uid; }
  catch (e) { console.error('No hay usuario Auth con email ' + email + ' · ' + e.message); process.exit(1); }

  const ref = db.collection('usuarios').doc(uid);
  const snap = await ref.get();
  if (!snap.exists) { console.error('No existe doc usuarios/' + uid); process.exit(1); }
  const data = snap.data();

  // Roles actuales: respeta `roles[]`; si sólo hay `rol` legacy, lo toma como base (aditivo, no destructivo).
  const actuales = Array.isArray(data.roles) ? data.roles.slice() : (data.rol ? [data.rol] : []);
  const union = Array.from(new Set([...actuales, ...rolesToAdd]));
  const nuevos = rolesToAdd.filter(r => !actuales.includes(r));

  console.log('email            : ' + email);
  console.log('uid              : ' + uid + '  · nroSocio: ' + (data.nroSocio || '—') + '  · ' + (data.nombre || '') + ' ' + (data.apellido || ''));
  console.log('roles actuales   : ' + JSON.stringify(actuales));
  console.log('roles a agregar  : ' + JSON.stringify(rolesToAdd) + '  → realmente nuevos: ' + JSON.stringify(nuevos));
  console.log('roles resultantes: ' + JSON.stringify(union));

  if (nuevos.length === 0) { console.log('\n✓ IDEMPOTENTE: ya tiene esos roles. Nada que escribir.'); process.exit(0); }
  if (WRITE) { await ref.update({ roles: union }); console.log('\n✓ ESCRITO. roles ahora = ' + JSON.stringify(union)); }
  else { console.log('\nℹ DRY-RUN — volvé a correr con --write para aplicar.'); }
  process.exit(0);
})().catch(e => { console.error('ERROR: ' + e.message); process.exit(1); });
