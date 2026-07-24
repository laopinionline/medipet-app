'use strict';
/*
 * Smoke — medipaw-core.js (MEDIPaw F0.5). Prueba la lógica REAL que usan el portal, la migración y
 * el dashboard: cobertura POR MASCOTA (los dos bugs del recon), cuota del titular = Σ mascotas activas,
 * resumen de negocio (unidad = mascota activa) y la transformación de migración (idempotente).
 *   node seed/smoke-medipaw-core.js
 */
var C = require('../lib/medipaw-core');
var ok = 0, fail = 0;
function check(cond, label) { console.log((cond ? '✓' : '✗ FALLO') + '  ' + label); cond ? ok++ : fail++; }
function eq(a, b, label) { check(JSON.stringify(a) === JSON.stringify(b), label + '  (esperado ' + JSON.stringify(b) + ', got ' + JSON.stringify(a) + ')'); }

console.log('\n— COBERTURA POR MASCOTA (bug del vet + bug del carnet) —');
// Bug (a): la cobertura es de LA MASCOTA, no del titular. Titular activo con mascota suspendida ⇒ NO cubierta.
check(C.coberturaMascota({ estado: 'activo' }).ok === true, 'mascota activa → cubierta');
check(C.coberturaMascota({ estado: 'suspendido' }).ok === false, 'mascota suspendida → NO cubierta (aunque el titular esté activo)');
check(C.coberturaMascota({ estado: 'baja' }).ok === false, 'mascota de baja → NO cubierta');
// Bug (b): sin estado (o basura) NUNCA se asume activo — el carnet no puede mentir "Activo".
check(C.coberturaMascota({}).ok === false, 'mascota sin estado → NO cubierta (no se asume activo)');
check(C.coberturaMascota({ estado: 'cualquiercosa' }).ok === false, 'estado inválido → NO cubierta');
eq(C.coberturaMascota({ estado: 'activo' }).chip, 'Activo', 'chip activo');
eq(C.coberturaMascota({ estado: 'suspendido' }).chip, 'Suspendido', 'chip suspendido');
eq(C.coberturaMascota({ estado: 'baja' }).chip, 'Baja', 'chip baja');

console.log('\n— CUOTA DEL TITULAR = Σ cuotas de mascotas ACTIVAS —');
var mascotasTit = [
  { plan: 'MEDIPaw Joven', estado: 'activo' },      // 58788
  { plan: 'MEDIPaw Senior', estado: 'activo' },     // 70788
  { plan: 'MEDIPaw Adulto', estado: 'suspendido' }, // NO cuenta (suspendida)
];
eq(C.cuotaTitular(mascotasTit), 58788 + 70788, 'suma solo las activas (la suspendida no suma)');
eq(C.cuotaTitular([]), 0, 'titular sin mascotas → 0');
eq(C.cuotaTitular([{ plan: 'Sin definir', estado: 'activo' }]), 0, 'plan sin definir activo → 0 (no factura)');

console.log('\n— RESUMEN DE NEGOCIO (unidad = mascota activa, no titular) —');
var universo = [
  { plan: 'MEDIPaw Joven', estado: 'activo' },
  { plan: 'MEDIPaw Joven', estado: 'activo' },
  { plan: 'MEDIPaw Senior', estado: 'activo' },
  { plan: 'MEDIPaw Adulto', estado: 'suspendido' },
  { plan: 'MEDIPaw Urgencias', estado: 'baja' },
];
var r = C.resumenNegocio(universo);
eq(r.mascotasTotales, 5, 'totales = 5');
eq(r.mascotasActivas, 3, 'activas = 3 (excluye suspendida y baja)');
eq(r.facturacion, 58788 + 58788 + 70788, 'facturación = Σ cuota de activas');
eq(r.planCount, { 'MEDIPaw Joven': 2, 'MEDIPaw Senior': 1 }, 'planCount solo cuenta activas');

console.log('\n— PRECIOS / CUOTA —');
eq(C.planCuota('MEDIPaw Adulto'), 54388, 'cuota Adulto');
eq(C.planCuota('Sin definir'), 0, 'cuota sin definir = 0');
eq(C.planCuota(undefined), 0, 'cuota undefined = 0');

console.log('\n— MIGRACIÓN: usuarios.mascotas[] → docs mascotas/{mascotaId} —');
var titularActivo = {
  uid: 'uidA', nroSocio: 'MP-0042', estado: 'activo', creadoEn: { seconds: 111 },
  mascotas: [
    { nombre: 'Pepa', raza: 'Caniche', plan: 'MEDIPaw Joven', token: 'tok1', mascotaId: 'MP-0042-01', servicios: [{ key: 'salud' }] },
    { nombre: 'Moka', raza: 'Mestizo', plan: 'MEDIPaw Senior', token: 'tok2' }, // sin mascotaId → se genera MP-0042-02
  ],
};
var m1 = C.migrarUsuario(titularActivo);
eq(m1.docs.length, 2, 'genera 2 docs');
eq(m1.docs[0].mascotaId, 'MP-0042-01', 'respeta mascotaId existente');
eq(m1.docs[1].mascotaId, 'MP-0042-02', 'genera mascotaId faltante desde nroSocio (1-based)');
eq(m1.docs[0].titularUid, 'uidA', 'estampa titularUid');
eq(m1.docs[0].estado, 'activo', 'titular activo → mascota activo');
eq(m1.docs[0].cuota, 58788, 'estampa cuota desde el plan');
eq(m1.docs[1].cuota, 70788, 'cuota Moka');
eq(m1.docs[0].creadoEn, { seconds: 111 }, 'preserva creadoEn del titular');
eq(m1.saltadas.length, 0, 'sin saltadas');

console.log('\n— MIGRACIÓN: titular pendiente → mascotas suspendidas —');
var titularPend = { uid: 'uidB', nroSocio: 'MP-0043', estado: 'pendiente', mascotas: [{ nombre: 'Fido', plan: 'MEDIPaw Adulto', mascotaId: 'MP-0043-01' }] };
var m2 = C.migrarUsuario(titularPend);
eq(m2.docs[0].estado, 'suspendido', 'titular pendiente → mascota suspendida (no hereda cobertura)');
eq(m2.docs[0].cuota, 0, 'mascota suspendida → cuota 0 (no factura hasta activar)');

console.log('\n— MIGRACIÓN: sin nroSocio ni mascotaId → saltada (no inventa id) —');
var titularSinNro = { uid: 'uidC', estado: 'pendiente', mascotas: [{ nombre: 'X', plan: 'MEDIPaw Joven' }] };
var m3 = C.migrarUsuario(titularSinNro);
eq(m3.docs.length, 0, 'no genera doc sin id estable');
eq(m3.saltadas.length, 1, 'reporta la saltada');

console.log('\n— MIGRACIÓN: IDEMPOTENTE (2ª corrida = mismos docs) —');
var a = JSON.stringify(C.migrarUsuario(titularActivo).docs);
var b = JSON.stringify(C.migrarUsuario(titularActivo).docs);
check(a === b, 'misma entrada → mismos docs (idempotente)');

console.log('\n———');
console.log((fail === 0 ? '✓ TODO EN VERDE' : '✗ HAY FALLOS') + ' — ' + ok + ' ok, ' + fail + ' fallos');
process.exit(fail === 0 ? 0 : 1);
