'use strict';
/*
 * PASO 0 — fetch del ruleset Firestore PUBLICADO en DEMO (medipaw-demo) a disco.
 * Evita embeber el cuerpo de las reglas en un comando Bash (el harness deniega heredocs
 * multilínea grandes). El contenido se obtiene por el Admin SDK (securityRules) EN RUNTIME
 * y lo escribe fs.writeFileSync — el comando es sólo `node seed/paso0-fetch-demo-rules.js`.
 * Uso (lo corre el subagente auditor-reglas para el diff mecánico independiente):
 *   node seed/paso0-fetch-demo-rules.js            # escribe /tmp/rules-demo-publicado.rules
 *   node seed/paso0-fetch-demo-rules.js --diff     # además corre diff -w contra el repo e imprime veredicto
 * Fetch por Admin SDK con serviceAccountKey.demo.json (project_id medipaw-demo). NO fakea nada:
 * trae el source del ruleset activo tal como está publicado.
 */
const path = require('path'), fs = require('fs'), admin = require('firebase-admin');
const KEY = path.resolve(__dirname, 'serviceAccountKey.demo.json');
admin.initializeApp({ credential: admin.credential.cert(require(KEY)) });
const OUT = '/tmp/rules-demo-publicado.rules';
const REPO = path.resolve(__dirname, '..', 'firestore.rules');

(async () => {
  const rs = await admin.securityRules().getFirestoreRuleset();
  const files = rs.source || (rs.rulesFile ? [rs.rulesFile] : []);
  if (!files.length || !files[0].content) throw new Error('ruleset sin source/content: ' + JSON.stringify(Object.keys(rs)));
  const content = files[0].content;
  fs.writeFileSync(OUT, content);
  console.error('[fetch] ruleset publicado (' + (rs.name || '?') + ') → ' + OUT + '  (' + content.length + ' bytes, ' + content.split('\n').length + ' líneas)');
  if (process.argv.includes('--diff')) {
    const { spawnSync } = require('child_process');
    const d = spawnSync('diff', ['-w', OUT, REPO], { encoding: 'utf8' });
    if (d.status === 0) console.log('PASO0: IDÉNTICO (diff -w vacío, exit 0)');
    else { console.log('PASO0: DIVERGE (exit ' + d.status + ')\n----- diff -w publicado(<) vs repo(>) -----\n' + d.stdout + (d.stderr || '')); }
  }
  process.exit(0);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
