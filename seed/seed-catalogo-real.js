'use strict';
/*
 * SEED — catálogo real de la Tienda MEDIPaw (9 fotos, mapeo aprobado por Lucas 02/08).
 * Procesa cada imagen al estándar de la casa: sips -Z 200 (lado mayor ≤200px) → JPEG q72 → data-URI base64.
 * REEMPLAZA = update del doc existente (foto/nombre/precio/precioSocio/categoria; conserva id/stock/estado).
 * NUEVO = create con id fijo, stock 10, visible. Idempotente. Guardrail medipaw-demo. Dry-run por defecto.
 *   node seed/seed-catalogo-real.js            # dry-run (procesa imágenes, muestra tamaños, NO escribe)
 *   node seed/seed-catalogo-real.js --write    # escribe a Firestore
 * Imágenes en ~/Downloads/tienda-fotos/ (los nombres deben coincidir con `file` de abajo).
 */
const path = require('path'), fs = require('fs'), os = require('os');
const { execFileSync } = require('child_process');
const admin = require('firebase-admin');
const cred = require(path.resolve(__dirname, 'serviceAccountKey.demo.json'));
if (cred.project_id !== 'medipaw-demo') { console.error('ABORT: catálogo real SOLO contra medipaw-demo (cred: ' + cred.project_id + ')'); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(cred) });
const db = admin.firestore();
const WRITE = process.argv.includes('--write');
const IMG_DIR = path.join(os.homedir(), 'Downloads', 'tienda-fotos');

// Procesa una imagen a data-URI JPEG ≤200px con sips (macOS). Devuelve el data-URI.
function fotoBase64(file) {
  const src = path.join(IMG_DIR, file);
  if (!fs.existsSync(src)) throw new Error('falta la imagen: ' + src);
  const out = path.join(os.tmpdir(), '_prod_' + Date.now() + '.jpg');
  execFileSync('sips', ['-Z', '200', '-s', 'format', 'jpeg', '-s', 'formatOptions', '72', src, '--out', out], { stdio: 'ignore' });
  const b64 = fs.readFileSync(out).toString('base64');
  fs.unlinkSync(out);
  return 'data:image/jpeg;base64,' + b64;
}

const CATALOGO = [
  // ── REEMPLAZOS (conservan id/stock/estado; se refresca foto/nombre/precio/precioSocio/categoria/descripcion) ──
  { file: 'Purina Perros 1k.png',           id: 'DEMO-PROD-01', accion: 'reemplaza', nombre: 'Pro Plan Adult Perro Razas Medianas 1kg', categoria: 'alimento',   precio: 9800,  precioSocio: 8300,
    descripcion: 'Alimento súper premium para perros adultos de razas medianas.\nCarne de pollo como primer ingrediente y tecnología OptiHealth con Spirulina.\n26% de proteína para energía y masa muscular. Presentación 1 kg.' },
  { file: 'Comedero para mascotas.png',     id: 'DEMO-PROD-04', accion: 'reemplaza', nombre: 'Comedero doble elevado (acero + antivoracidad)', categoria: 'accesorios', precio: 16500, precioSocio: null,
    descripcion: 'Comedero doble con base elevada: mejora la postura al comer y ayuda a la digestión.\nIncluye bowl de acero inoxidable + bowl antivoracidad para que coma más despacio.\nEstructura firme y estable, fácil de higienizar.' },
  // ── NUEVOS (stock 10, visible) ──
  { file: 'Pro Plan caja x10 unidades.png', id: 'DEMO-PROD-07', accion: 'nuevo', nombre: 'Pro Plan pouch Gato Pollo caja x10', categoria: 'alimento', precio: 18500, precioSocio: 15700,
    descripcion: 'Caja con 10 pouches de Pro Plan Adult para gatos: pollo en salsa.\nSúper premium, 100% completo y balanceado. Con prebióticos para una digestión saludable y cuidado del tracto urinario.\nGatos adultos desde 1 año.' },
  { file: 'Purina Gatos 3k.png',            id: 'DEMO-PROD-08', accion: 'nuevo', nombre: 'Pro Plan LiveClear Gato Adulto 3kg', categoria: 'alimento', precio: 28900, precioSocio: 24500,
    descripcion: 'Reduce significativamente los alérgenos del pelo y la caspa del gato (hasta 47% a partir de la 3ª semana).\nPara gatos adultos de 1 a 7 años, con carne de pollo y 36% de proteína.\nRecomendado por veterinarios. 3 kg.' },
  { file: 'Royal Canin Perros 3k.png',      id: 'DEMO-PROD-09', accion: 'nuevo', nombre: 'Royal Canin Mini Adult 3kg', categoria: 'alimento', precio: 24500, precioSocio: 20800,
    descripcion: 'Royal Canin Mini Adult: nutrición precisa para perros adultos de razas pequeñas (hasta 10 kg).\nCroqueta adaptada a su mandíbula, con nutrientes para la vitalidad y la salud diaria.\nPresentación 3 kg.' },
  { file: 'Caja para gatos.png',            id: 'DEMO-PROD-10', accion: 'nuevo', nombre: 'Caja sanitaria cerrada con pala', categoria: 'higiene', precio: 32000, precioSocio: null,
    descripcion: 'Sanitario cerrado con techo y puerta abatible: más privacidad para tu gato y menos olores y desparrame de arena.\nTapa superior con asa para una limpieza fácil.\nIncluye pala.' },
  { file: 'Comedero automàtico.png',        id: 'DEMO-PROD-11', accion: 'nuevo', nombre: 'Comedero automático por gravedad', categoria: 'accesorios', precio: 19900, precioSocio: null,
    descripcion: 'Comedero automático por gravedad: cargás la tolva y el alimento baja solo a medida que tu mascota come.\nIdeal para dejar comida disponible durante el día.\nFácil de recargar y de limpiar.' },
  { file: 'Cama para gatos.png',            id: 'DEMO-PROD-12', accion: 'nuevo', nombre: 'Cama cueva para gatos', categoria: 'camas_descanso', precio: 21000, precioSocio: null,
    descripcion: 'Cama cueva de peluche suave: un refugio abrigado y acogedor donde tu gato se siente seguro.\nDiseño 2 en 1 (cueva o nido abierto), base mullida.\nIdeal para el descanso y los días fríos.' },
  { file: 'Guante quitapelos.png',          id: 'DEMO-PROD-13', accion: 'nuevo', nombre: 'Guante quitapelos', categoria: 'higiene', precio: 5500, precioSocio: null,
    descripcion: 'Guante quitapelos 2 en 1: cepillá a tu perro o gato y retirá el pelo suelto de ropa, sillones y auto.\nReutilizable y lavable, cómodo para la mano.\nUn pase y listo.' },
];

(async () => {
  const TS = admin.firestore.FieldValue.serverTimestamp();
  console.log('=== SEED catálogo real · ' + (WRITE ? 'WRITE' : 'DRY-RUN') + ' (medipaw-demo) · fotos ' + IMG_DIR + ' ===');
  for (const p of CATALOGO) {
    const foto = fotoBase64(p.file);
    const soc = p.precioSocio != null ? ' · socio $' + p.precioSocio : '';
    const kb = Math.round(foto.length / 1024);
    console.log('  ' + (WRITE ? '✓' : '·') + ' [' + p.accion.toUpperCase() + '] ' + p.id + ' · ' + p.nombre + ' · ' + p.categoria + ' · $' + p.precio + soc + ' · foto ' + kb + 'KB');
    if (!WRITE) continue;
    const ref = db.collection('productos').doc(p.id);
    if (p.accion === 'reemplaza') {
      await ref.update({ nombre: p.nombre, categoria: p.categoria, precio: p.precio, precioSocio: p.precioSocio, foto: foto, descripcion: p.descripcion || '', actualizadoEn: TS });
    } else {
      const snap = await ref.get();
      const doc = { nombre: p.nombre, categoria: p.categoria, precio: p.precio, precioSocio: p.precioSocio, stock: 10, estado: 'visible', foto: foto, descripcion: p.descripcion || '', actualizadoEn: TS };
      if (!snap.exists) doc.creadoEn = TS;
      await ref.set(doc, { merge: true });
    }
  }
  console.log(WRITE ? '\n✓ ' + CATALOGO.length + ' productos cargados (2 reemplazos + 7 nuevos).' : '\n(dry-run — nada escrito; correr con --write)');
  process.exit(0);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
