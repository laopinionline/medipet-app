// ─────────────────────────────────────────────────────────────────────────────
// SMOKE del MOTOR DE COBERTURAS (Fase 1) — núcleo puro, sin Firestore, sin framework.
//   node seed/smoke-coberturas.js   → corre los casos; exit 1 si algo falla.
// Casos mínimos (pedido Lucas 27/07): carencia justa en el día límite, cupo al límite y agotado,
// senior con tope distinto, plan que no incluye, mascota legacy 'Sin definir', aniversario que
// resetea cupos, alta el 29/02.
// ─────────────────────────────────────────────────────────────────────────────
const path = require('path');
const MC = require(path.resolve(__dirname, '../lib/medipaw-core.js'));

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + (extra ? '  → ' + extra : '')); }
}
function eq(a, b, label) { ok(a === b, label, 'got ' + JSON.stringify(a) + ' ≠ ' + JSON.stringify(b)); }

const DIA = MC.DIA_MS;
const U = (y, m, d) => Date.UTC(y, m - 1, d); // mes 1-based para legibilidad
// Mascota helper: activa + plan del catálogo → cobertura vigente; altaMs = alta.
const masc = (plan, altaMs, estado) => ({ plan: plan, estado: estado || 'activo', altaMs: altaMs });

console.log('\n=== SMOKE motor de coberturas ===\n');

// ── 1) Carencia justa en el día límite (análisis, carencia 60 días, plan Adulto) ──
console.log('1) Carencia en el día límite (análisis, 60 días):');
{
  const alta = U(2026, 1, 1);
  const m = masc('MEDIPaw Adulto', alta);
  const antes = MC.carenciaCumplida(m, 'analisis', alta + 60 * DIA - 1);
  const justo = MC.carenciaCumplida(m, 'analisis', alta + 60 * DIA);
  eq(antes.cumplida, false, 'un ms antes de 60 días → NO cumplida');
  eq(justo.cumplida, true, 'exacto a 60 días → cumplida');
  eq(justo.carenciaDias, 60, 'carenciaDias efectiva = 60');
  // Urgencias override carenciaDias 0 (C4) → cumplida siempre
  const mu = masc('MEDIPaw Urgencias', alta);
  eq(MC.carenciaCumplida(mu, 'analisis', alta).cumplida, true, 'Urgencias análisis carencia 0 → cumplida al alta');
}

// ── 2) Cupo al límite y agotado (consultaExterna, cupo 2) ──
console.log('2) Cupo al límite y agotado (consultaExterna, cupo 2):');
{
  const at = (n) => Array.from({ length: n }, () => ({}));
  const m = masc('MEDIPaw Adulto', U(2026, 1, 1));
  eq(MC.cupoDisponible(m, 'consultaExterna', at(1)).agotado, false, '1 usado de 2 → NO agotado');
  eq(MC.cupoDisponible(m, 'consultaExterna', at(1)).restantes, 1, '1 usado → resta 1');
  eq(MC.cupoDisponible(m, 'consultaExterna', at(2)).agotado, true, '2 usados de 2 → agotado');
  // Ilimitado (veterinario online) nunca se agota
  eq(MC.cupoDisponible(m, 'vetOnline', at(99)).agotado, false, 'vetOnline ilimitado → nunca agotado');
}

// ── 2b) Desdoble de consulta (Lucas 01/08): guardia propia ilimitada vs consulta externa con cupo ──
console.log('2b) Desdoble consulta: consultaGuardia (sin límite en los 5 planes) vs consultaExterna (cupo 2, tope 35k):');
{
  const PLANES = ['MEDIPaw Urgencias', 'MEDIPaw Básico', 'MEDIPaw Joven', 'MEDIPaw Adulto', 'MEDIPaw Senior'];
  for (const plan of PLANES) {
    const rg = MC.reglaCobertura('consultaGuardia', plan);
    ok(rg && rg.cupoAnual === null && rg.tope === null, 'consultaGuardia SIN límite ni tope en ' + plan, JSON.stringify(rg));
    const m = masc(plan, U(2024, 1, 1));
    eq(MC.cupoDisponible(m, 'consultaGuardia', Array.from({ length: 50 }, () => ({}))).agotado, false, 'consultaGuardia nunca se agota en ' + plan);
  }
  // consultaExterna conserva los números viejos de 'consulta' (cupo 2, tope 35000, 100% pleno, carencia 0)
  const re = MC.reglaCobertura('consultaExterna', 'MEDIPaw Adulto');
  eq(re.cupoAnual, 2, 'consultaExterna cupo 2');
  eq(re.tope, 35000, 'consultaExterna tope 35.000');
  eq(re.carenciaDias, 0, 'consultaExterna carencia 0');
  // 'consulta' legacy ya NO existe en el catálogo
  eq(MC.reglaCobertura('consulta', 'MEDIPaw Adulto'), null, "'consulta' legacy fuera del catálogo (desdoblada)");
}

// ── 3) Senior con tope distinto (periodontal: Adulto $60.000 vs Senior $80.000) ──
console.log('3) Senior con tope distinto (periodontal 60k vs 80k):');
{
  const alta = U(2020, 1, 1); // carencia 90 días ya cumplida
  const fecha = U(2026, 6, 1);
  const ctx = { fechaMs: fecha, atenciones: [] };
  const rAd = MC.cobertura(masc('MEDIPaw Adulto', alta), 'periodontal', 200000, ctx);
  const rSe = MC.cobertura(masc('MEDIPaw Senior', alta), 'periodontal', 200000, ctx);
  // pct 0.50 → 100.000, capado al tope del plan
  eq(rAd.reintegro, 60000, 'Adulto: 50% de 200k = 100k → capado a tope 60k');
  eq(rSe.reintegro, 80000, 'Senior: 50% de 200k = 100k → capado a tope 80k');
  eq(rAd.aCargoSocio, 140000, 'Adulto a cargo del socio = 200k - 60k');
  ok(rAd.tope !== rSe.tope, 'topes por plan distintos (60k ≠ 80k)');
  // Cirugía: Senior tope 300k vs default 200k
  eq(MC.cobertura(masc('MEDIPaw Senior', alta), 'cirugia', 700000, ctx).reintegro, 300000, 'Senior cirugía: 50% de 700k = 350k → capado a 300k');
  eq(MC.cobertura(masc('MEDIPaw Adulto', alta), 'cirugia', 700000, ctx).reintegro, 200000, 'Adulto cirugía: capado a 200k');
}

// ── 4) Plan que NO incluye la prestación (Urgencias + internación) ──
console.log('4) Plan que no incluye la prestación:');
{
  const r = MC.cobertura(masc('MEDIPaw Urgencias', U(2020, 1, 1)), 'internacion', 100000, { fechaMs: U(2026, 6, 1), atenciones: [] });
  eq(r.cubre, false, 'Urgencias no incluye internación → NO cubre');
  ok(/no incluye/i.test(r.motivo), 'motivo dice "no incluye"', r.motivo);
  eq(r.aCargoSocio, 100000, 'todo a cargo del socio');
  eq(MC.reglaCobertura('resonancia', 'MEDIPaw Adulto'), null, 'resonancia solo Senior → Adulto = null');
}

// ── 5) Mascota legacy plan 'Sin definir' (sin cobertura) ──
console.log('5) Legacy "Sin definir" (sin cobertura vigente):');
{
  const r = MC.cobertura(masc('Sin definir', U(2020, 1, 1)), 'consultaExterna', 35000, { fechaMs: U(2026, 6, 1), atenciones: [] });
  eq(r.cubre, false, 'plan fuera de catálogo → NO cubre');
  ok(/no tiene cobertura vigente/i.test(r.motivo), 'motivo dice "no tiene cobertura vigente"', r.motivo);
  // suspendida con plan del catálogo tampoco cubre
  eq(MC.cobertura(masc('MEDIPaw Adulto', U(2020, 1, 1), 'suspendido'), 'consultaExterna', 1000, { fechaMs: U(2026, 6, 1) }).cubre, false, 'suspendida → NO cubre');
}

// ── 6) Aniversario que resetea cupos (alta 2024-01-15; cupo consultaExterna 2) ──
console.log('6) Aniversario resetea cupos:');
{
  const alta = U(2024, 1, 15);
  const m = masc('MEDIPaw Adulto', alta);
  const dosDelAnio0 = [{ tipo: 'consultaExterna', fecha: U(2024, 3, 1) }, { tipo: 'consultaExterna', fecha: U(2024, 9, 1) }]; // ambas en el año 0 (con tipo, shape real)
  // Evento en el año 0 con 2 usados → agotado → precio socio
  const enAnio0 = MC.cobertura(m, 'consultaExterna', 40000, { fechaMs: U(2024, 12, 1), atenciones: dosDelAnio0 });
  ok(/cupo anual agotado/i.test(enAnio0.motivo), 'año 0 con 2 previas → cupo agotado (precio socio)', enAnio0.motivo);
  eq(enAnio0.reintegro, 10000, 'precio socio = 25% de 40k');
  // Mismo par de atenciones, evento en el año 1 (2025) → esas 2 quedan fuera de la ventana → cupo fresco
  const enAnio1 = MC.cobertura(m, 'consultaExterna', 40000, { fechaMs: U(2025, 2, 1), atenciones: dosDelAnio0 });
  eq(enAnio1.cubre, true, 'año 1: las 2 del año 0 NO cuentan → cupo fresco → cubre');
  eq(enAnio1.reintegro, 35000, 'cubierto pleno capado a tope 35k');
  // ventana del año 1 arranca en el aniversario 2025-01-15
  const v = MC.ventanaAniversario(alta, U(2025, 2, 1));
  eq(v.indice, 1, 'índice de año = 1');
  eq(v.inicio, U(2025, 1, 15), 'inicio de ventana = aniversario 2025-01-15');
}

// ── 7) Alta el 29/02 (aniversario en año no bisiesto → 28/02) ──
console.log('7) Alta el 29/02 (bisiesto):');
{
  const alta = U(2024, 2, 29); // 2024 bisiesto
  const v = MC.ventanaAniversario(alta, U(2025, 6, 1));
  const ini = new Date(v.inicio);
  eq(ini.getUTCMonth(), 1, 'mes de inicio = febrero (índice 1)');
  eq(ini.getUTCDate(), 28, '2025 no bisiesto → aniversario clampeado a 28/02');
  eq(v.indice, 1, 'un año de aniversario cumplido');
  // el 2028 sí es bisiesto → vuelve a 29/02
  const iniLeap = new Date(MC.addAnios(alta, 4));
  eq(iniLeap.getUTCDate(), 29, '2028 bisiesto → 29/02 de nuevo');
}

// ── 8) Sanity: reintegro % simple (medicamentos 25%, sin tope) ──
console.log('8) Reintegro % simple (medicamentos 25%):');
{
  const r = MC.cobertura(masc('MEDIPaw Joven', U(2020, 1, 1)), 'medicamentos', 10000, { fechaMs: U(2026, 6, 1), atenciones: [] });
  eq(r.reintegro, 2500, 'medicamentos: 25% de 10k = 2500');
  eq(r.aCargoSocio, 7500, 'a cargo del socio = 7500');
}

// ── 9) Plan BÁSICO ($40.000, ave/otros) = plan de acceso (confirmado Lucas 27/07) ──
console.log('9) Plan Básico (acceso):');
{
  const alta = U(2020, 1, 1), fecha = U(2026, 6, 1);
  const m = masc('MEDIPaw Básico', alta);
  // consultaExterna CUBIERTA (tope $35.000, 100%)
  const c1 = MC.cobertura(m, 'consultaExterna', 20000, { fechaMs: fecha, atenciones: [] });
  eq(c1.cubre, true, 'Básico: consultaExterna cubierta');
  eq(c1.reintegro, 20000, 'consultaExterna $20k < tope → reintegro pleno 20k');
  eq(MC.cobertura(m, 'consultaExterna', 50000, { fechaMs: fecha, atenciones: [] }).reintegro, 35000, 'consultaExterna $50k → capado a tope 35k');
  // medicamentos 25%, traslado/vetOnline/descuentos/legal incluidos
  eq(MC.cobertura(m, 'medicamentos', 8000, { fechaMs: fecha, atenciones: [] }).reintegro, 2000, 'Básico: medicamentos 25% de 8k');
  eq(MC.reglaCobertura('vetOnline', 'MEDIPaw Básico') !== null, true, 'Básico incluye veterinario online');
  eq(MC.reglaCobertura('descuentos', 'MEDIPaw Básico') !== null, true, 'Básico incluye descuentos');
  // cirugía y demás clínicas NO incluidas
  const cir = MC.cobertura(m, 'cirugia', 300000, { fechaMs: fecha, atenciones: [] });
  eq(cir.cubre, false, 'Básico: cirugía NO incluida');
  ok(/no incluye/i.test(cir.motivo), 'motivo cirugía dice "no incluye"', cir.motivo);
  eq(MC.reglaCobertura('internacion', 'MEDIPaw Básico'), null, 'Básico no incluye internación');
  eq(MC.reglaCobertura('vacunas', 'MEDIPaw Básico'), null, 'Básico no incluye vacunas');
  // post-cupo de consultaExterna (2 usadas este año) → precio socio 25%
  const dos = [{ tipo: 'consultaExterna', fecha: U(2026, 2, 1) }, { tipo: 'consultaExterna', fecha: U(2026, 4, 1) }];
  const post = MC.cobertura(m, 'consultaExterna', 40000, { fechaMs: fecha, atenciones: dos });
  ok(/cupo anual agotado/i.test(post.motivo), 'Básico consultaExterna post-cupo → precio socio', post.motivo);
  eq(post.reintegro, 10000, 'post-cupo = 25% de 40k = 10k');
}

// ── 10) BUG Fase 2: la fecha de la atención llega como Timestamp de Firestore, NO como número ──
// La app pasa `fecha` como Timestamp (toMillis) o {seconds,nanoseconds}; el filtro de ventana hacía Number(fecha)=NaN
// → la atención caía fuera de la ventana → el cupo NO la contaba. Reproduce el caso Firulais reportado en vivo.
console.log('10) Cupo con fecha Timestamp-like (regresión Fase 2):');
{
  const TSlike = (ms) => ({ toMillis: () => ms });                 // Firestore Timestamp (instancia)
  const secLike = (ms) => ({ seconds: Math.floor(ms / 1000), nanoseconds: 0 }); // Timestamp plano (de d.data() sin instancia)
  const alta = U(2026, 6, 1), hoy = U(2026, 6, 10);
  const m = masc('MEDIPaw Adulto', alta); // consultaExterna cupo 2
  // Firulais exacto: 1 consultaExterna previa el 5/6 dentro de la ventana 1/6→1/6 (Timestamp)
  const r = MC.cobertura(m, 'consultaExterna', 40000, { fechaMs: hoy, atenciones: [{ tipo: 'consultaExterna', fecha: TSlike(U(2026, 6, 5)) }] });
  eq(r.restantes, 1, 'consultaExterna previa (Timestamp) SÍ descuenta → quedan 1 de 2 (no 2)');
  eq(r.reintegro, 35000, 'reintegro capado al tope 35k');
  eq(r.aCargoSocio, 5000, 'a cargo del socio = 40k - 35k');
  ok(/quedan 1 de 2/.test(r.motivo), 'motivo dice "quedan 1 de 2"', r.motivo);
  // los 3 shapes de fecha cuentan igual
  eq(MC.cupoDisponible(m, 'consultaExterna', [{ tipo: 'consultaExterna', fecha: TSlike(U(2026, 6, 5)) }].filter(a => a.tipo === 'consultaExterna')).usados, 1, 'cupoDisponible cuenta 1 (Timestamp toMillis)');
  const enVentana = (fecha) => MC.cobertura(m, 'consultaExterna', 40000, { fechaMs: hoy, atenciones: [{ tipo: 'consultaExterna', fecha }] }).restantes;
  eq(enVentana(secLike(U(2026, 6, 5))), 1, '{seconds,nanoseconds} plano → descuenta');
  eq(enVentana(new Date(U(2026, 6, 5))), 1, 'Date → descuenta');
  eq(enVentana(U(2026, 6, 5)), 1, 'number (ms) → descuenta (no regresiona el caso viejo)');
  // fecha del año ANTERIOR (Timestamp) NO cuenta
  eq(enVentana(TSlike(U(2025, 6, 5))), 2, 'consultaExterna del año anterior (fuera de ventana) → no descuenta → quedan 2');
  // alta como creadoEn Timestamp (doc crudo, sin altaMs) → ventana igual computada
  const mCreado = { plan: 'MEDIPaw Adulto', estado: 'activo', creadoEn: TSlike(alta) };
  eq(MC.cobertura(mCreado, 'consultaExterna', 40000, { fechaMs: hoy, atenciones: [{ tipo: 'consultaExterna', fecha: TSlike(U(2026, 6, 5)) }] }).restantes, 1, 'mascota con creadoEn Timestamp (sin altaMs) → cupo cuenta bien');
}

// ── 11) BUGS Fase 2 (verificación en vivo 28/07): filtro por prestación + carencia fail-safe ──
// REGLA: los tests del motor usan SHAPES REALES de Firestore (Timestamp como único campo de fecha; mascota con
// creadoEn, sin altaMs) y listas CRUDAS/MIXTAS (varias prestaciones juntas). Sin esto, 1 y 2 pasaban de casualidad.
console.log('11) Filtro por prestación + carencia fail-safe (shapes reales):');
{
  const TS = (ms) => ({ toMillis: () => ms, seconds: Math.floor(ms / 1000), nanoseconds: 0 }); // Timestamp real (toMillis+seconds)
  const alta = U(2026, 6, 1), hoy = U(2027, 1, 15); // dentro de la ventana; carencias ya cumplidas
  const mDoc = { plan: 'MEDIPaw Adulto', estado: 'activo', creadoEn: TS(alta) }; // SOLO creadoEn (sin altaMs)

  // (a) LISTA MIXTA cruda: cada prestación cuenta SOLO lo suyo (bug 1). Sin el fix, las 3 contaban contra cualquiera.
  const mixta = [
    { tipo: 'consultaExterna', fecha: TS(U(2026, 6, 5)) },
    { tipo: 'vacunas',  fecha: TS(U(2026, 6, 20)) },
    { tipo: 'cirugia',  fecha: TS(U(2026, 8, 1)) },
  ];
  eq(MC.cobertura(mDoc, 'consultaExterna', 10000, { fechaMs: hoy, atenciones: mixta }).restantes, 1, '(a) consultaExterna cuenta 1 (no 3) → quedan 1 de 2');
  eq(MC.cobertura(mDoc, 'vacunas', 5000, { fechaMs: hoy, atenciones: mixta }).restantes, 1, '(a) vacunas cuenta 1 de 2 → quedan 1');
  const cir = MC.cobertura(mDoc, 'cirugia', 100000, { fechaMs: hoy, atenciones: mixta });
  ok(/cupo anual agotado/i.test(cir.motivo), '(a) cirugia (cupo 1, 1 previa) → agotado, sin mezclar con consultaExterna/vacuna', cir.motivo);

  // (b) creadoEn Timestamp, prestación 90d, alta hace 30d → EN CARENCIA (bug 2: antes fail-open → cubierta)
  const mCar = { plan: 'MEDIPaw Adulto', estado: 'activo', creadoEn: TS(U(2026, 6, 1)) };
  const rCar = MC.cobertura(mCar, 'cirugia', 300000, { fechaMs: U(2026, 7, 1), atenciones: [] }); // +30 días
  eq(rCar.cubre, false, '(b) cirugia a 30 días (carencia 90) → NO cubre');
  ok(/en carencia/i.test(rCar.motivo), '(b) motivo "en carencia"', rCar.motivo);
  eq(rCar.reintegro, 0, '(b) reintegro 0 en carencia');
  eq(MC.cobertura(mCar, 'cirugia', 300000, { fechaMs: U(2026, 9, 15), atenciones: [] }).cubre, true, '(b) pasados 90 días → cubre');
  eq(MC.carenciaCumplida(mCar, 'cirugia', U(2026, 7, 1)).desdeMs != null, true, '(b) carenciaCumplida resuelve el alta (desdeMs != null) con creadoEn Timestamp');

  // (c) mascota SIN ningún campo de fecha → carencia NO cumplida (fail-safe, nunca fail-open)
  const mSF = { plan: 'MEDIPaw Adulto', estado: 'activo' };
  const rSF = MC.cobertura(mSF, 'cirugia', 300000, { fechaMs: hoy, atenciones: [] });
  eq(rSF.cubre, false, '(c) sin fecha de alta + carencia 90 → NO cubre (fail-safe)');
  ok(/sin fecha de alta/i.test(rSF.motivo), '(c) motivo "sin fecha de alta verificable"', rSF.motivo);
  eq(MC.carenciaCumplida(mSF, 'cirugia', hoy).sinAlta, true, '(c) flag sinAlta=true');
  eq(MC.carenciaCumplida(mSF, 'consultaExterna', hoy).cumplida, true, '(c) consultaExterna (carencia 0) sin alta → cumplida (nada que esperar)');
}

console.log('\n=== ' + (fail ? 'FALLÓ (' + fail + ')' : 'TODO VERDE') + ' · ' + pass + ' asserts OK, ' + fail + ' fallidos ===\n');
process.exit(fail ? 1 : 0);
