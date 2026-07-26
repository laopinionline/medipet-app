// Guarda dura del deploy de reglas Firestore por CLI.
// Aborta si el target es PROD (medipet-c3a4d): las reglas de prod se publican A MANO
// en consola por Lucas (invariante MEDIPaw). Cualquier otro proyecto (demo) pasa.
// firebase-tools expone el proyecto target en GCLOUD_PROJECT (lifecycleHooks.js).
const project = process.env.GCLOUD_PROJECT || '';
if (project === 'medipet-c3a4d') {
  console.error('ABORT (guarda dura): reglas de PROD se publican a mano en consola por Lucas — deploy de reglas a prod por CLI abortado por diseno (invariante MEDIPaw).');
  process.exit(1);
}
console.log('predeploy OK: target ' + (project || '(desconocido)') + ' — no es prod, sigue.');
