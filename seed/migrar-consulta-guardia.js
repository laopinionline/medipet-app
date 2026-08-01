'use strict';
// MIGRACIÓN demo — atenciones tipo:'consulta' (legacy) → 'consultaGuardia' (desdoble de consulta, regla Lucas 01/08).
// Las del demo fueron del vet demo (guardia) → mapean a la consulta de guardia (ilimitada). Idempotente (al re-correr
// no encuentra ninguna). dry-run por default; --write ejecuta. GUARDRAIL: aborta si el key NO es de medipaw-demo.
// Uso:  node seed/migrar-consulta-guardia.js            (dry-run)
//       node seed/migrar-consulta-guardia.js --write     (escribe en medipaw-demo)

const path = require('path'), fs = require('fs');
const EXPECTED_PROJECT = 'medipaw-demo';
const KEY_PATH = path.resolve(__dirname, 'serviceAccountKey.demo.json');
const WRITE = process.argv.includes('--write');

if (!fs.existsSync(KEY_PATH)) { console.error(`ABORT: falta ${KEY_PATH}. No se tocó nada.`); process.exit(1); }
const key = require(KEY_PATH);
if (key.project_id !== EXPECTED_PROJECT) { console.error(`ABORT (guardrail): key de '${key.project_id}', NO '${EXPECTED_PROJECT}'. No se tocó nada.`); process.exit(1); }
const admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.cert(key) });
if ((admin.app().options.projectId || key.project_id) !== EXPECTED_PROJECT) { console.error('ABORT (guardrail 2). No se tocó nada.'); process.exit(1); }
const db = admin.firestore();

(async () => {
  const snap = await db.collection('atenciones').where('tipo', '==', 'consulta').get();
  console.log(`Atenciones legacy tipo:'consulta' a migrar → 'consultaGuardia': ${snap.size}`);
  snap.docs.forEach((d) => { const a = d.data(); console.log(`  · ${d.id}  (${a.mascotaNombre || a.mascotaId || '—'}, prestador ${a.prestadorId || '—'})`); });
  if (!snap.size) { console.log('\nNada que migrar (idempotente).'); process.exit(0); }
  if (!WRITE) { console.log('\n=== DRY-RUN (nada escrito; correr con --write) ==='); process.exit(0); }
  const batch = db.batch();
  snap.docs.forEach((d) => batch.update(d.ref, { tipo: 'consultaGuardia' }));
  await batch.commit();
  console.log('\n=== ESCRITO: ' + snap.size + " atención(es) → tipo:'consultaGuardia' ===");
  process.exit(0);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
