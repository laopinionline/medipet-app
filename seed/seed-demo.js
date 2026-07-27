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

// Atenciones = registro clínico del vet, LEGIBLE por el titular dueño (es la Historia). Campos clínicos
// (fecha/tipo/prestadorNombre/diagnostico/tratamiento/adjuntos) + `monto` y `estado` del REINTEGRO + N3/ruteo
// (titularUid, mascotaId, mascotaNombre). MEDIPaw es matriz de cobertura por prestación (topes/%/frecuencia/carencia
// por plan): el `monto` es la base del cálculo y `estado` (pendiente/pagado/rechazado) es el circuito de reintegro.
// En Historia v1 el monto/estado van como DATO informativo del reintegro (sin cálculo; el motor de coberturas es
// subsistema aparte, no entra en v1). Montos verosímiles vs. los topes de la landing.
const ATENCIONES = [
  // Firulais (DEMO-perro-01): 3 atenciones variadas — cubre los 3 estados de reintegro
  { id: 'DEMO-aten-perro-01', mascotaId: 'DEMO-perro-01', tipo: 'consulta', fecha: '2026-06-05T11:00:00-03:00',
    diagnostico: 'Control anual — mascota sana.', tratamiento: 'Sin medicación. Refuerzo de vacunas al día.',
    adjuntos: [], monto: 35000, estado: 'pagado' },
  { id: 'DEMO-aten-perro-02', mascotaId: 'DEMO-perro-01', tipo: 'vacuna', fecha: '2026-06-20T16:30:00-03:00',
    diagnostico: 'Vacunación antirrábica anual.', tratamiento: 'Vacuna aplicada. Próximo refuerzo en 12 meses.',
    adjuntos: [], monto: 15000, estado: 'pendiente' },
  { id: 'DEMO-aten-perro-03', mascotaId: 'DEMO-perro-01', tipo: 'estudio', fecha: '2026-07-10T10:15:00-03:00',
    diagnostico: 'Otitis leve en oído derecho.', tratamiento: 'Limpieza + gotas óticas 2 veces/día por 7 días. Control en 10 días.',
    adjuntos: [], monto: 25000, estado: 'rechazado' },
  // Michi (DEMO-gato-01): 1 atención — sin reintegro (monto 0)
  { id: 'DEMO-aten-gato-01', mascotaId: 'DEMO-gato-01', tipo: 'consulta', fecha: '2026-07-12T09:45:00-03:00',
    diagnostico: 'Primera consulta de cachorro — buen estado general.', tratamiento: 'Desparasitación interna. Se inicia plan de vacunación.',
    adjuntos: [], monto: 0, estado: 'pagado' },
  // Pipo (DEMO-ave-01): SIN atenciones → empty state de Historia.
];

// casos_clinico SEÑUELO: doc INTERNO del vet que el titular ['afiliado'] NUNCA debe poder leer (prueba N3 en demo).
const CASO_CLINICO_DECOY = { id: 'DEMO-caso-01', fecha: '2026-07-10T10:00:00-03:00',
  prioridadInterna: 'media', notasVet: 'SEÑUELO N3 — nota clínica interna del vet. El titular NO debe poder leer esto.',
  tomadoPor: 'demo-vet-0001' };

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

  // 4) atenciones (registro clínico, LEGIBLE por el titular dueño = Historia). Solo campos clínicos (sin monto/estado).
  console.log('\n— atenciones (Historia) —');
  const nombreDe = Object.fromEntries(MASCOTAS.map(m => [m.mascotaId, m.nombre]));
  for (const a of ATENCIONES) {
    await setDoc(`atenciones/${a.id}`, {
      prestadorId: USERS.vet.uid, prestadorNombre: `${USERS.vet.nombre} ${USERS.vet.apellido}`,
      mascotaId: a.mascotaId, mascotaNombre: nombreDe[a.mascotaId] || '', titularUid: USERS.titular.uid,
      tipo: a.tipo, diagnostico: a.diagnostico, tratamiento: a.tratamiento, adjuntos: a.adjuntos, fecha: ts(a.fecha),
      monto: a.monto, estado: a.estado,
    }, `${nombreDe[a.mascotaId]} · ${a.tipo} · $${a.monto} ${a.estado}`);
  }
  console.log(`  (Pipo/DEMO-ave-01 SIN atenciones → empty state de Historia)`);

  // 5) casos_clinico SEÑUELO (prueba N3: el titular ['afiliado'] debe RECHAZAR get/list de esto).
  console.log('\n— casos_clinico (señuelo N3) —');
  await setDoc(`casos_clinico/${CASO_CLINICO_DECOY.id}`, {
    prioridadInterna: CASO_CLINICO_DECOY.prioridadInterna, notasVet: CASO_CLINICO_DECOY.notasVet,
    tomadoPor: CASO_CLINICO_DECOY.tomadoPor, tomadoEn: ts(CASO_CLINICO_DECOY.fecha),
  }, '(señuelo — el titular NO debe poder leerlo)');

  console.log(`\n=== ${WRITE ? 'ESCRITO' : 'DRY-RUN (nada escrito; correr con --write)'} ===`);
  console.log(`Titular: ${USERS.titular.email} · Admin: ${USERS.admin.email} · Vet: ${USERS.vet.email}`);
  console.log(`Mascotas: ${MASCOTAS.map(m => `${m.nombre}(${m.plan.replace('MEDIPaw ', '')}/${m.pesos.length}pts)`).join(' · ')}`);
  console.log(`Atenciones: ${ATENCIONES.length} (Firulais 3 · Michi 1 · Pipo 0) · casos_clinico señuelo: 1`);
  process.exit(0);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
