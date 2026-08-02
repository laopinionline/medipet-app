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

console.log('\n— COBERTURA POR MASCOTA (estado activo Y plan del catálogo) —');
var PLAN_OK = 'MEDIPaw Joven'; // plan real del catálogo
// Bug (a): la cobertura es de LA MASCOTA, no del titular. Activo + plan del catálogo ⇒ cubierta.
check(C.coberturaMascota({ estado: 'activo', plan: PLAN_OK }).ok === true, 'activa + plan del catálogo → cubierta');
check(C.coberturaMascota({ estado: 'suspendido', plan: PLAN_OK }).ok === false, 'suspendida → NO cubierta (aunque el titular esté activo)');
check(C.coberturaMascota({ estado: 'baja', plan: PLAN_OK }).ok === false, 'de baja → NO cubierta');
// Bug (b): sin estado (o basura) NUNCA se asume activo — el carnet no puede mentir "Activo".
check(C.coberturaMascota({ plan: PLAN_OK }).ok === false, 'sin estado → NO cubierta (no se asume activo)');
check(C.coberturaMascota({ estado: 'cualquiercosa', plan: PLAN_OK }).ok === false, 'estado inválido → NO cubierta');
// Bug (c) NUEVO: activo pero SIN plan del catálogo ("Sin definir" o legacy) ⇒ NO es cobertura vigente.
check(C.coberturaMascota({ estado: 'activo', plan: 'Sin definir' }).ok === false, 'activo + "Sin definir" → NO cubierta (falta plan)');
check(C.coberturaMascota({ estado: 'activo', plan: '' }).ok === false, 'activo + plan vacío → NO cubierta');
check(C.coberturaMascota({ estado: 'activo' }).ok === false, 'activo sin campo plan → NO cubierta');
check(C.coberturaMascota({ estado: 'activo', plan: 'Premium' }).ok === false, 'activo + plan LEGACY fuera de catálogo (Premium) → NO cubierta');
eq(C.coberturaMascota({ estado: 'activo', plan: 'Sin definir' }).chip, 'Sin plan', 'chip "Sin plan" para activo sin plan');
eq(C.coberturaMascota({ estado: 'activo', plan: PLAN_OK }).chip, 'Activo', 'chip activo');
eq(C.coberturaMascota({ estado: 'suspendido', plan: PLAN_OK }).chip, 'Suspendido', 'chip suspendido');
eq(C.coberturaMascota({ estado: 'baja', plan: PLAN_OK }).chip, 'Baja', 'chip baja');
check(C.planEnCatalogo('MEDIPaw Senior') === true && C.planEnCatalogo('Premium') === false && C.planEnCatalogo('Sin definir') === false, 'planEnCatalogo: catálogo sí, legacy/sin-definir no');

console.log('\n— ALTA EMBUDO: plan Básico + asignación por especie/edad (fuente única) —');
eq(C.planCuota('MEDIPaw Básico'), 40000, 'Básico $40.000 en catálogo');
check(C.planEnCatalogo('MEDIPaw Básico') === true, 'planEnCatalogo reconoce Básico');
check(C.especieValida('perro') && C.especieValida('gato') && C.especieValida('ave') && C.especieValida('otros'), 'las 4 especies válidas');
check(C.especieValida('pez') === false, 'especie fuera de lista → inválida');
// ASIGNACIÓN POR EDAD APROXIMADA (bucket) — lo que maneja el plan y lo que valida la regla.
// MATRIZ COMPLETA especie×edad → plan (fuente única; embudo Y activación admin usan MC.planPorEdadAprox).
// Mapeo corregido: perro/gato cachorro/joven→Joven · adulto→Adulto · mayor→Senior · ave/otros→Básico (cualquier edad).
eq(C.EDADES_APROX, ['cachorro','joven','adulto','mayor'], '4 buckets de edad');
var MATRIZ_PLAN = {
  perro: { cachorro: 'MEDIPaw Joven', joven: 'MEDIPaw Joven', adulto: 'MEDIPaw Adulto', mayor: 'MEDIPaw Senior' },
  gato:  { cachorro: 'MEDIPaw Joven', joven: 'MEDIPaw Joven', adulto: 'MEDIPaw Adulto', mayor: 'MEDIPaw Senior' },
  ave:   { cachorro: 'MEDIPaw Básico', joven: 'MEDIPaw Básico', adulto: 'MEDIPaw Básico', mayor: 'MEDIPaw Básico' },
  otros: { cachorro: 'MEDIPaw Básico', joven: 'MEDIPaw Básico', adulto: 'MEDIPaw Básico', mayor: 'MEDIPaw Básico' },
};
Object.keys(MATRIZ_PLAN).forEach(function (esp) {
  C.EDADES_APROX.forEach(function (ed) {
    eq(C.planPorEdadAprox(esp, ed), MATRIZ_PLAN[esp][ed], 'matriz: ' + esp + ' ' + ed + ' → ' + MATRIZ_PLAN[esp][ed]);
  });
});
// Caso Luna (referencia del bug): gato joven → MEDIPaw Joven $58.788 (NO Adulto).
eq(C.planPorEdadAprox('gato', 'joven'), 'MEDIPaw Joven', 'Luna: gato joven → Joven (no Adulto)');
eq(C.planCuota(C.planPorEdadAprox('gato', 'joven')), 58788, 'Luna: cuota gato joven = $58.788');
eq(C.planCuota(C.planPorEdadAprox('perro', 'mayor')), 70788, 'cuota del plan asignado (Senior)');
// EDAD EXACTA (opcional) — solo para el recálculo cuando hay fecha real.
var now = 1000 * 365.25 * 24 * 3600 * 1000;
var haceAnios = function (a) { return now - a * C.ANIO_MS; };
eq(C.planPorEspecieEdad('perro', haceAnios(9), now), 'MEDIPaw Senior', 'recálculo por fecha: perro 9 años → Senior');
eq(C.franjaEtaria('perro', haceAnios(0.5), now), 'Joven', 'franja exacta legible');

console.log('\n— COMPROBANTES: snapshot congelado + no-prorrateo + numeración + vencimiento —');
var msComp = [
  { mascotaId: 'MP-0001-01', nombre: 'Pepa', plan: 'MEDIPaw Joven', estado: 'activo' },   // 58788
  { mascotaId: 'MP-0001-02', nombre: 'Moka', plan: 'MEDIPaw Senior', estado: 'activo' },  // 70788
  { mascotaId: 'MP-0001-03', nombre: 'Fido', plan: 'MEDIPaw Adulto', estado: 'suspendido' }, // NO entra (sin cobertura)
  { mascotaId: 'MP-0001-04', nombre: 'Zoe', plan: 'Sin definir', estado: 'activo' },       // NO entra (sin plan del catálogo)
];
var comp = C.armarComprobante(msComp, '2026-03');
eq(comp.items.length, 2, 'solo las mascotas con cobertura vigente entran (2 de 4)');
eq(comp.total, 58788 + 70788, 'total = Σ cuota de las mascotas del snapshot');
eq(comp.items[0], { mascotaId: 'MP-0001-01', mascotaNombre: 'Pepa', plan: 'MEDIPaw Joven', monto: 58788 }, 'ítem congela mascota+plan+monto');
// SNAPSHOT: cambiar la mascota DESPUÉS no toca el comprobante ya armado (es una foto por valor).
msComp[0].plan = 'MEDIPaw Senior';
eq(comp.items[0].monto, 58788, 'el comprobante NO se recalcula si la mascota cambia de plan después (snapshot)');
eq(comp.total, 58788 + 70788, 'total sigue congelado tras el cambio posterior');
// NO-PRORRATEO: una mascota suspendida no aporta fracción; simplemente no está en el snapshot (mes completo o nada).
eq(C.armarComprobante([{ mascotaId: 'x', nombre: 'S', plan: 'MEDIPaw Joven', estado: 'suspendido' }], '2026-03').total, 0, 'suspendida → no factura (sin prorrateo)');
// Numeración + vencimiento
eq(C.fmtComprobante(1), 'MP-C-000001', 'numeración MP-C-000001');
eq(C.fmtComprobante(42), 'MP-C-000042', 'numeración padded');
eq(C.venceComprobanteISO('2026-03'), '2026-03-10T23:59:59-03:00', 'vence día 10 del período, hora AR');
eq(C.venceComprobanteISO('malformado'), null, 'período inválido → sin vencimiento');
// Estado derivado (no toca el guardado)
eq(C.estadoComprobante({ estado: 'pagada' }, 999, 1), 'pagada', 'pagada manda');
eq(C.estadoComprobante({ estado: 'emitida' }, 100, 50), 'vencida', 'emitida y hoy>vence → vencida');
eq(C.estadoComprobante({ estado: 'emitida' }, 40, 50), 'pendiente', 'emitida y hoy<=vence → pendiente');

console.log('\n— RUTEO POR ROL (login único: /app/ staff · /socio/ titular) —');
check(C.esStaff(['admin']) === true, 'admin → staff (va a /app/)');
check(C.esStaff(['veterinario']) === true, 'veterinario → staff');
check(C.esStaff(['prestador']) === true, 'prestador legacy → staff (mapea a veterinario)');
check(C.esStaff(['afiliado']) === false, 'afiliado puro → NO staff');
check(C.esTitular(['afiliado']) === true, 'afiliado → titular (va a /socio/)');
check(C.esTitular(['admin']) === false, 'admin puro → NO titular');
// Mixto staff+afiliado: es AMBOS → puede usar las dos apps (se queda donde entró; sin loop).
check(C.esStaff(['afiliado', 'admin']) === true && C.esTitular(['afiliado', 'admin']) === true, 'mixto afiliado+admin → staff Y titular (ambas apps)');
check(C.esStaff([]) === false && C.esTitular([]) === false, 'sin roles → ni staff ni titular (cartel honesto)');

console.log('\n— CASOS: estado cara-al-titular (N3: cuidado y acción, NUNCA clasificación) —');
check(C.estadoCasoTitular('nuevo').tono === 'nuevo', 'nuevo → tono nuevo');
check(C.estadoCasoTitular('en_curso').tono === 'en_curso', 'en_curso → tono en_curso');
check(C.estadoCasoTitular('cerrado').tono === 'cerrado', 'cerrado → tono cerrado');
check(C.estadoCasoTitular(undefined).tono === 'nuevo', 'sin estado → nuevo');
// N3 duro: ningún texto al titular menciona prioridad/clasificación/urgencia/score.
var prohibidas = /prioridad|clasific|urgen|score|rojo|amarillo|nivel|triage/i;
check(['nuevo','en_curso','cerrado'].every(e => !prohibidas.test(C.estadoCasoTitular(e).texto)), 'ningún texto al titular filtra jerga clínica/clasificación');
check(C.CAMPOS_CASO_TITULAR.indexOf('prioridadInterna') < 0 && C.CAMPOS_CASO_TITULAR.indexOf('notasVet') < 0, 'campos titular-safe NO incluyen prioridadInterna ni notasVet');

console.log('\n— CUOTA DEL TITULAR = Σ cuotas de mascotas ACTIVAS —');
var mascotasTit = [
  { plan: 'MEDIPaw Joven', estado: 'activo' },      // 58788
  { plan: 'MEDIPaw Senior', estado: 'activo' },     // 70788
  { plan: 'MEDIPaw Adulto', estado: 'suspendido' }, // NO cuenta (suspendida)
];
eq(C.cuotaTitular(mascotasTit), 58788 + 70788, 'suma solo las activas (la suspendida no suma)');
eq(C.cuotaTitular([]), 0, 'titular sin mascotas → 0');
eq(C.cuotaTitular([{ plan: 'Sin definir', estado: 'activo' }]), 0, 'plan sin definir activo → 0 (no factura)');

console.log('\n— RESUMEN DE NEGOCIO (activa operativa por estado; cobertura exige plan) —');
var universo = [
  { plan: 'MEDIPaw Joven', estado: 'activo' },
  { plan: 'MEDIPaw Joven', estado: 'activo' },
  { plan: 'MEDIPaw Senior', estado: 'activo' },
  { plan: 'Sin definir', estado: 'activo' },      // operativa pero SIN cobertura vigente (falta plan)
  { plan: 'MEDIPaw Adulto', estado: 'suspendido' },
  { plan: 'MEDIPaw Urgencias', estado: 'baja' },
];
var r = C.resumenNegocio(universo);
eq(r.mascotasTotales, 6, 'totales = 6');
eq(r.mascotasActivas, 4, 'activas (estado) = 4 (incluye la "Sin definir" activa; excluye suspendida y baja)');
eq(r.mascotasConCobertura, 3, 'con cobertura = 3 (la "Sin definir" NO cuenta: falta plan)');
eq(r.facturacion, 58788 + 58788 + 70788, 'facturación = Σ cuota de activas (Sin definir suma $0)');
eq(r.planCount, { 'MEDIPaw Joven': 2, 'MEDIPaw Senior': 1, 'Sin definir': 1 }, 'planCount por estado activo (muestra la que falta remapear)');

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

console.log('\n— PLANTILLA DE SERVICIOS (fuente única; el alta nace con estos 5) —');
var srv = C.plantillaServicios();
check(Array.isArray(srv) && srv.length === 5, '5 servicios');
check(srv[0].key === 'salud' && srv[0].estado === 'activo', 'salud = activo');
check(srv.filter(function (s) { return s.estado === 'disponible'; }).length === 4, 'los otros 4 = disponible');
check(srv.every(function (s) { return s.key && s.nombre && ('detalle' in s) && s.estado; }), 'shape {key,nombre,detalle,estado}');
srv[0].estado = 'PISADO';
check(C.plantillaServicios()[0].estado === 'activo', 'copia fresca: mutar el resultado NO altera la plantilla');

console.log('\n———');
console.log((fail === 0 ? '✓ TODO EN VERDE' : '✗ HAY FALLOS') + ' — ' + ok + ' ok, ' + fail + ' fallos');
process.exit(fail === 0 ? 0 : 1);
