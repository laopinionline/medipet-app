'use strict';
/*
 * SEED — productos demo de la Tienda MEDIPaw (Fase 1). Idempotente (IDs fijos, set con merge).
 * Guardrail: SOLO corre contra medipaw-demo. Dry-run por defecto; --write aplica.
 *   node seed/seed-productos.js            # dry-run (muestra qué haría)
 *   node seed/seed-productos.js --write    # escribe
 * Fotos = placeholders SVG dignos embebidos como data-URI base64 (patrón F1: foto inline, sin Storage).
 */
const path = require('path'), admin = require('firebase-admin');
const ESPROD = process.argv.includes('prod');
const KEY = path.resolve(__dirname, ESPROD ? 'serviceAccountKey.json' : 'serviceAccountKey.demo.json');
const cred = require(KEY);
const EXPECTED = ESPROD ? 'medipet-c3a4d' : 'medipaw-demo';
if (cred.project_id !== EXPECTED) { console.error('ABORT: proyecto ' + cred.project_id + ' != esperado ' + EXPECTED + ' (arg prod → medipet-c3a4d)'); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(cred) });
const db = admin.firestore();
const WRITE = process.argv.includes('--write');

// Placeholder digno: gradiente de marca (azul→navy) + inicial en Baloo 2. Chico (~0.5KB base64).
function svgPlaceholder(inicial, color) {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">' +
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + color + '"/><stop offset="1" stop-color="#0D1B3E"/></linearGradient></defs>' +
    '<rect width="200" height="200" rx="24" fill="url(#g)"/>' +
    '<text x="100" y="132" font-family="Baloo 2, Arial, sans-serif" font-size="98" font-weight="800" fill="#ffffff" text-anchor="middle" opacity="0.92">' + inicial + '</text></svg>';
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}

const PRODUCTOS = [
  { id: 'DEMO-PROD-01', nombre: 'Alimento Balanceado Perro Adulto 15kg', descripcion: 'Bolsa 15kg, todas las razas.', categoria: 'alimento',   precio: 18500, precioSocio: 15900, stock: 12, estado: 'visible', inicial: 'A', color: '#1A5FB4' },
  { id: 'DEMO-PROD-02', nombre: 'Alimento Gato Castrado 7.5kg',          descripcion: 'Control de peso, castrados.',   categoria: 'alimento',   precio: 12800, precioSocio: 10900, stock: 8,  estado: 'visible', inicial: 'A', color: '#2272D9' },
  { id: 'DEMO-PROD-03', nombre: 'Collar ajustable con correa',           descripcion: 'Nylon reforzado, talle M/L.',   categoria: 'accesorios', precio: 6500,  precioSocio: null,  stock: 20, estado: 'visible', inicial: 'C', color: '#1A5FB4' },
  { id: 'DEMO-PROD-04', nombre: 'Comedero doble de acero',               descripcion: 'Antideslizante, 2x350ml.',      categoria: 'accesorios', precio: 4200,  precioSocio: null,  stock: 15, estado: 'visible', inicial: 'C', color: '#2272D9' },
  { id: 'DEMO-PROD-05', nombre: 'Shampoo hipoalergénico 500ml',          descripcion: 'Piel sensible, pH neutro.',     categoria: 'higiene',    precio: 3800,  precioSocio: null,  stock: 25, estado: 'visible', inicial: 'S', color: '#1A5FB4' },
  { id: 'DEMO-PROD-06', nombre: 'Juguete mordillo resistente',           descripcion: 'Caucho atóxico (borrador).',    categoria: 'juguetes',   precio: 2900,  precioSocio: null,  stock: 0,  estado: 'oculto',  inicial: 'J', color: '#F2B84D' },
];

(async () => {
  const TS = admin.firestore.FieldValue.serverTimestamp();
  console.log('=== SEED productos demo · ' + (WRITE ? 'WRITE' : 'DRY-RUN') + ' (proyecto medipaw-demo) ===');
  for (const p of PRODUCTOS) {
    const foto = svgPlaceholder(p.inicial, p.color);
    const doc = { nombre: p.nombre, descripcion: p.descripcion, categoria: p.categoria, precio: p.precio,
      precioSocio: p.precioSocio, stock: p.stock, estado: p.estado, foto: foto, actualizadoEn: TS };
    const soc = p.precioSocio != null ? ' · socio $' + p.precioSocio : '';
    console.log('  ' + (WRITE ? '✓' : '·') + ' ' + p.id + ' [' + p.estado + '] ' + p.nombre + ' — $' + p.precio + soc + ' · stock ' + p.stock + ' · foto ' + foto.length + 'B');
    if (WRITE) {
      const ref = db.collection('productos').doc(p.id);
      const snap = await ref.get();
      if (!snap.exists) doc.creadoEn = TS;
      await ref.set(doc, { merge: true });
    }
  }
  console.log(WRITE ? '\n✓ ' + PRODUCTOS.length + ' productos escritos (idempotente).' : '\n(dry-run — nada escrito; correr con --write)');
  process.exit(0);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
