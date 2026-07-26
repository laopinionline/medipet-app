// ─────────────────────────────────────────────────────────────────────────────
// SEED del ENTORNO DEMO (medipaw-demo) — NO correr contra prod.
// Idempotente (set() con IDs deterministas). dry-run por default; --write ejecuta.
//
// GUARDRAIL DURO: aborta si el service account NO es del proyecto 'medipaw-demo',
// TAMBIÉN en dry-run. Nunca puede tocar medipet-c3a4d (prod).
//
// Prerequisitos (los prepara Lucas):
//   1. seed/serviceAccountKey.demo.json  → key del proyecto medipaw-demo (git-ignored).
//   2. seed/demo-secrets.json            → { "titular":"…","admin":"…","vet":"…" } passwords fijos (git-ignored).
//      (Los passwords NO van en el repo; se documentan en el vault.)
//
// Uso:  node seed/seed-demo.js            (dry-run: muestra qué haría)
//       node seed/seed-demo.js --write    (escribe en medipaw-demo)
// ─────────────────────────────────────────────────────────────────────────────
const path = require('path'), fs = require('fs');

const EXPECTED_PROJECT = 'medipaw-demo';
const KEY_PATH     = path.resolve(__dirname, 'serviceAccountKey.demo.json');
const SECRETS_PATH = path.resolve(__dirname, 'demo-secrets.json');
const WRITE = process.argv.includes('--write');

// ── GUARDRAIL 1 (antes de TODO, también en dry-run): el key debe ser del proyecto demo ──
if (!fs.existsSync(KEY_PATH)) {
  console.error(`ABORT: falta ${KEY_PATH}. Lucas: crear medipaw-demo y bajar el service account ahí. No se tocó nada.`);
  process.exit(1);
}
const key = require(KEY_PATH);
if (key.project_id !== EXPECTED_PROJECT) {
  console.error(`ABORT (guardrail): el key es del proyecto '${key.project_id}', NO '${EXPECTED_PROJECT}'. ` +
                `Este seed SOLO corre contra el demo. No se tocó nada.`);
  process.exit(1);
}
if (!fs.existsSync(SECRETS_PATH)) {
  console.error(`ABORT: falta ${SECRETS_PATH} con { "titular":"…","admin":"…","vet":"…" } (passwords fijos, git-ignored). No se tocó nada.`);
  process.exit(1);
}
const SECRETS = require(SECRETS_PATH);

const admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.cert(key) });
// ── GUARDRAIL 2 (post-init, doble control) ──
const runningProject = admin.app().options.projectId || key.project_id;
if (runningProject !== EXPECTED_PROJECT) {
  console.error(`ABORT (guardrail 2): admin app apunta a '${runningProject}', NO '${EXPECTED_PROJECT}'. No se tocó nada.`);
  process.exit(1);
}
const db = admin.firestore(), auth = admin.auth();
const MC = require(path.resolve(__dirname, '../lib/medipaw-core.js')); // fuente única de plan/cuota
const TS = admin.firestore.Timestamp;
const ts = (iso) => TS.fromDate(new Date(iso)); // fecha FIJA (idempotente; no serverTimestamp)

// ── CONFIG de la data demo (nombres claramente ficticios) ────────────────────
// ⚠️ roles del titular: el núcleo esTitular() exige 'afiliado' → un titular funcional es ['afiliado']
//    (NO ['] vacío, que no rutea a /socio/). No es staff (sin admin/vet) → sirve para verificar N3.
const USERS = {
  titular: { uid: 'demo-titular-0001', email: 'demo.titular@medipaw.ar', pw: SECRETS.titular,
             nombre: 'Juana',  apellido: 'Demo', roles: ['afiliado'], nroSocio: 'DEMO-0001', telefono: '2477000001' },
  admin:   { uid: 'demo-admin-0001',   email: 'demo.admin@medipaw.ar',   pw: SECRETS.admin,
             nombre: 'Admin',  apellido: 'Demo', roles: ['admin'] },
  vet:     { uid: 'demo-vet-0001',     email: 'demo.vet@medipaw.ar',     pw: SECRETS.vet,
             nombre: 'Vet',    apellido: 'Demo', roles: ['veterinario'] },
};

// Servicios estándar (mismo template que la ficha pública; para que el carnet demo se vea completo).
const SERVICIOS_STD = [
  { key: 'salud',     nombre: 'Cobertura de salud',      detalle: 'Segun tu plan MEDIPaw',              estado: 'activo' },
  { key: 'descuento', nombre: 'Descuento 10%',           detalle: 'En comercios adheridos',            estado: 'disponible' },
  { key: 'gps',       nombre: 'GPS MEDIPaw',             detalle: 'Localizador para tu mascota',       estado: 'disponible' },
  { key: 'tienda',    nombre: 'Tienda MEDIPaw',         detalle: 'Productos exclusivos para socios',  estado: 'disponible' },
  { key: 'vacuna',    nombre: 'Recordatorio de vacunas', detalle: 'Te avisamos cuando toque',          estado: 'disponible' },
];

// 3 mascotas = los 3 estados de "Chequeo y peso": multi-punto · un-punto · vacío.
// Plan/cuota los computa el NÚCLEO por especie+edad (no hardcodeado).  ⚠️ La 3ª especie es elección
// (ave→Básico) para sumar variedad de plan; ajustá libremente.
const MASCOTAS = [
  { key: 'perro', mascotaId: 'DEMO-perro-01', nombre: 'Firulais', especie: 'perro', edadAprox: 'adulto',
    raza: 'Mestizo', sexo: 'macho', token: 'DEMOtokenPerro0001',
    pesos: [ // multi-punto → estado "peso actual + comparación"
      { p: 8.0, fecha: '2026-06-01T12:00:00-03:00', origen: 'alta' },
      { p: 8.3, fecha: '2026-06-15T12:00:00-03:00', origen: 'titular' },
      { p: 8.6, fecha: '2026-07-01T12:00:00-03:00', origen: 'titular' },
      { p: 8.5, fecha: '2026-07-20T12:00:00-03:00', origen: 'titular' },
    ] },
  { key: 'gato', mascotaId: 'DEMO-gato-01', nombre: 'Michi', especie: 'gato', edadAprox: 'cachorro',
    raza: 'Siames', sexo: 'hembra', token: 'DEMOtokenGato0001',
    pesos: [ // un-punto → estado "un solo peso, sin comparación"
      { p: 1.2, fecha: '2026-07-10T12:00:00-03:00', origen: 'alta' },
    ] },
  { key: 'ave', mascotaId: 'DEMO-ave-01', nombre: 'Pipo', especie: 'ave', edadAprox: 'adulto',
    raza: 'Canario', sexo: 'macho', token: 'DEMOtokenAve0001',
    pesos: [] }, // vacío → estado "Todavía no hay mediciones"
].map(m => { const plan = MC.planPorEdadAprox(m.especie, m.edadAprox); return { ...m, plan, cuota: MC.planCuota(plan) }; });

// ── Helpers de escritura (upsert) ────────────────────────────────────────────
async function upsertAuthUser(u) {
  let exists = false;
  try { await auth.getUser(u.uid); exists = true; } catch (e) { if (e.code !== 'auth/user-not-found') throw e; }
  console.log(`  [auth] ${u.email} (uid ${u.uid}) — ${exists ? 'existe → update' : 'nuevo → create'}`);
  if (!WRITE) return;
  if (exists) await auth.updateUser(u.uid, { email: u.email, password: u.pw, displayName: `${u.nombre} ${u.apellido}` });
  else        await auth.createUser({ uid: u.uid, email: u.email, password: u.pw, displayName: `${u.nombre} ${u.apellido}` });
}
async function setDoc(pathStr, data, label) {
  console.log(`  [set] ${pathStr}  ${label || ''}`);
  if (WRITE) await db.doc(pathStr).set(data);
}

(async () => {
  console.log(`\n=== SEED DEMO (${WRITE ? 'WRITE' : 'DRY-RUN'}) · proyecto ${runningProject} ===\n`);

  // 1) Cuentas Auth
  console.log('— Auth users —');
  for (const u of [USERS.titular, USERS.admin, USERS.vet]) await upsertAuthUser(u);

  // 2) usuarios/{uid} (staff = solo identidad+roles; titular = + nroSocio/telefono + espejo mascotas[])
  console.log('\n— usuarios/{uid} —');
  await setDoc(`usuarios/${USERS.admin.uid}`, {
    nombre: USERS.admin.nombre, apellido: USERS.admin.apellido, email: USERS.admin.email, roles: USERS.admin.roles,
  }, '(admin)');
  await setDoc(`usuarios/${USERS.vet.uid}`, {
    nombre: USERS.vet.nombre, apellido: USERS.vet.apellido, email: USERS.vet.email, roles: USERS.vet.roles,
  }, '(veterinario)');

  const embebido = MASCOTAS.map(m => ({ nombre: m.nombre, raza: m.raza, especie: m.especie, sexo: m.sexo, plan: m.plan, mascotaId: m.mascotaId, token: m.token }));
  await setDoc(`usuarios/${USERS.titular.uid}`, {
    nombre: USERS.titular.nombre, apellido: USERS.titular.apellido, email: USERS.titular.email,
    roles: USERS.titular.roles, nroSocio: USERS.titular.nroSocio, telefono: USERS.titular.telefono,
    mascotas: embebido, // espejo transitorio (invariante 10); la colección mascotas es la fuente
  }, '(titular + espejo mascotas[])');

  // 3) mascotas/{mascotaId} (colección = fuente) + serie pesos/{id} determinista
  console.log('\n— mascotas + pesos —');
  for (const m of MASCOTAS) {
    await setDoc(`mascotas/${m.mascotaId}`, {
      mascotaId: m.mascotaId, titularUid: USERS.titular.uid, nombre: m.nombre, especie: m.especie, edadAprox: m.edadAprox,
      raza: m.raza, sexo: m.sexo, plan: m.plan, cuota: m.cuota, estado: 'activo', foto: '', token: m.token,
      servicios: SERVICIOS_STD, creadoEn: ts('2026-06-01T10:00:00-03:00'),
    }, `${m.especie} ${m.edadAprox} → ${m.plan} $${m.cuota}`);
    // serie de pesos con id determinista → set() no duplica al re-correr
    for (let i = 0; i < m.pesos.length; i++) {
      const pt = m.pesos[i];
      await setDoc(`pesos/${m.mascotaId}__p${i + 1}`, {
        mascotaId: m.mascotaId, titularUid: USERS.titular.uid, peso: pt.p, fecha: ts(pt.fecha), origen: pt.origen,
      }, `${pt.p} kg (${pt.origen})`);
    }
    if (!m.pesos.length) console.log(`  [pesos] ${m.mascotaId}: SIN puntos (estado vacío de Chequeo)`);
  }

  console.log(`\n=== ${WRITE ? 'ESCRITO' : 'DRY-RUN (nada escrito; correr con --write)'} ===`);
  console.log(`Titular: ${USERS.titular.email} · Admin: ${USERS.admin.email} · Vet: ${USERS.vet.email}`);
  console.log(`Mascotas: ${MASCOTAS.map(m => `${m.nombre}(${m.plan.replace('MEDIPaw ', '')}/${m.pesos.length}pts)`).join(' · ')}`);
  process.exit(0);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
