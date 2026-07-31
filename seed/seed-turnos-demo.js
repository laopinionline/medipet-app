'use strict';
// SEED demo de TURNOS — 1 agenda del vet de guardia (mañana, 09:00–13:00, slots de 30min, activa).
// Idempotente (doc id fijo). dry-run por default; --write ejecuta. GUARDRAIL: aborta si el key NO es de medipaw-demo.
// Uso:  node seed/seed-turnos-demo.js            (dry-run)
//       node seed/seed-turnos-demo.js --write     (escribe en medipaw-demo)

const path = require('path'), fs = require('fs');
const EXPECTED_PROJECT = 'medipaw-demo';
const KEY_PATH = path.resolve(__dirname, 'serviceAccountKey.demo.json');
const WRITE = process.argv.includes('--write');

if (!fs.existsSync(KEY_PATH)) { console.error(`ABORT: falta ${KEY_PATH}. No se tocó nada.`); process.exit(1); }
const key = require(KEY_PATH);
if (key.project_id !== EXPECTED_PROJECT) {
  console.error(`ABORT (guardrail): key del proyecto '${key.project_id}', NO '${EXPECTED_PROJECT}'. No se tocó nada.`);
  process.exit(1);
}
const admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.cert(key) });
const running = admin.app().options.projectId || key.project_id;
if (running !== EXPECTED_PROJECT) { console.error(`ABORT (guardrail 2): admin app en '${running}'. No se tocó nada.`); process.exit(1); }

const db = admin.firestore();
const FV = () => admin.firestore.FieldValue.serverTimestamp();
const { addDiasStr } = require('../vetia/turnos.js'); // misma lógica de fecha BA que el endpoint

const AGENDA_ID = 'demo-agenda-guardia';
const fecha = addDiasStr(Date.now(), 1); // MAÑANA en Buenos Aires (dentro de la ventana [hoy, hoy+7])
const franja = { fecha, horaInicio: '09:00', horaFin: '13:00', duracionSlotMin: 30, activa: true, slotsTomados: [] };

(async () => {
  const ref = db.collection('agenda_turnos').doc(AGENDA_ID);
  const snap = await ref.get();
  console.log(`Agenda demo '${AGENDA_ID}': fecha ${fecha}, 09:00–13:00, slot 30min, activa. (${snap.exists ? 'ya existe → se refresca' : 'nueva'})`);
  console.log('  slots del día:', ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30'].join(' '));
  if (!WRITE) { console.log('\n=== DRY-RUN (nada escrito; correr con --write) ==='); process.exit(0); }
  const creadoEn = (snap.exists && snap.data().creadoEn) ? snap.data().creadoEn : FV();
  await ref.set({ ...franja, creadoEn, actualizadoEn: FV() });
  console.log('\n=== ESCRITO en medipaw-demo ===');
  process.exit(0);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
