// Build de la carpeta pública del hosting DEMO (medipaw-demo.web.app).
// Copia los fuentes compartidos con prod SIN tocarlos, inyecta el loader de /fb-config.js
// (solo en las COPIAS), escribe fb-config.js con la config del proyecto demo (PÚBLICA), y
// sufija el cache del SW a -demo. hosting-demo/ es artefacto de build (git-ignored).
// Corre en el predeploy de hosting (DESPUÉS del guard: si el target es prod, el guard aborta
// antes de que esto corra).
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'hosting-demo');

// Config web del proyecto DEMO (pública, no secreto). Fuente: `firebase apps:sdkconfig WEB --project medipaw-demo`.
const DEMO_CONFIG = {
  apiKey: 'AIzaSyDJC4LMmRYI0R3O102peBgDeEJ8y9_cXGs',
  authDomain: 'medipaw-demo.firebaseapp.com',
  projectId: 'medipaw-demo',
  storageBucket: 'medipaw-demo.firebasestorage.app',
  messagingSenderId: '348381162460',
  appId: '1:348381162460:web:ca1102760cf63d8c77fd19',
};

const read = (p) => fs.readFileSync(p, 'utf8');
const write = (p, c) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); };

// Inyecta <script src="/fb-config.js"></script> ANTES del <script> del init (queda antes de
// firebase.initializeApp → window.__FB_CONFIG ya seteado). Falla si el marcador no está (no inyecta a ciegas).
function inject(html, file) {
  const marker = '<script>\nfirebase.initializeApp(window.__FB_CONFIG';
  if (!html.includes(marker)) throw new Error(`marcador del init no encontrado en ${file} — abortar`);
  return html.replace(marker, '<script src="/fb-config.js"></script>\n<script>\nfirebase.initializeApp(window.__FB_CONFIG');
}

// ── build (carpeta limpia siempre) ──
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// fb-config.js en la raíz
write(path.join(OUT, 'fb-config.js'), 'window.__FB_CONFIG = ' + JSON.stringify(DEMO_CONFIG, null, 2) + ';\n');

// /socio/  (index con inyección + sw con cache sufijo -demo + assets)
write(path.join(OUT, 'socio/index.html'), inject(read(path.join(ROOT, 'socio/index.html')), 'socio/index.html'));
write(path.join(OUT, 'socio/sw.js'), read(path.join(ROOT, 'socio/sw.js')).replace(/medipaw-socio-v(\d+)/g, 'medipaw-socio-demo-v$1'));
for (const f of ['manifest.json', 'icon.svg']) {
  const src = path.join(ROOT, 'socio', f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(OUT, 'socio', f));
}

// /app/  (el index.html raíz de la app, con inyección)
write(path.join(OUT, 'app/index.html'), inject(read(path.join(ROOT, 'index.html')), 'index.html'));

// /lib/
fs.mkdirSync(path.join(OUT, 'lib'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'lib/medipaw-core.js'), path.join(OUT, 'lib/medipaw-core.js'));

console.log('build-hosting-demo: hosting-demo/ generado — socio (index+sw-demo+assets), app, lib, fb-config.js.');
