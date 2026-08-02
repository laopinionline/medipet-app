/*
 * MEDIPaw — NÚCLEO PURO (F0.5). Fuente ÚNICA de verdad para: precios/cuota, decisión de
 * cobertura POR MASCOTA, resumen de negocio (mascotas activas + facturación) y la transformación
 * de migración usuarios.mascotas[] -> colección mascotas/{mascotaId}.
 *
 * Sin dependencias, sin I/O. Corre igual en Node (seed/smokes lo `require`) y en el browser
 * (el portal lo carga por <script> y lo expone en window.MEDIPAW). Determinista: el mismo
 * `usuario` migra siempre a los mismos docs (id estable MP-XXXX-NN) → migración idempotente.
 *
 * REGLA DE ORO F0.5: la MASCOTA es el sujeto. Cada mascota tiene su plan, su cuota y su ESTADO.
 * El titular es una cuenta administrativa (paga la SUMA de las cuotas de sus mascotas activas);
 * el titular NO tiene plan ni define la cobertura. La cobertura se decide por mascota, nunca por titular.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MEDIPAW = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Catálogo de precios de lista (fuente: landing/comercial). La cuota de la mascota = PRECIOS[plan].
  // 'Sin definir' y desconocidos → 0 (no facturan hasta asignar un plan real).
  var PRECIOS = {
    'MEDIPaw Urgencias': 23988,
    'MEDIPaw Básico': 40000,     // ave / otros (prestaciones del plan estándar)
    'MEDIPaw Joven': 58788,
    'MEDIPaw Adulto': 54388,
    'MEDIPaw Senior': 70788,
  };

  // Plantilla de SERVICIOS (fuente única). Cada mascota nace con estos 5 en su `servicios[]`: 'salud' activo, el resto
  // 'disponible'. La usan el ALTA (embudo /socio/), el seed y cualquier alta futura — antes estaba duplicada en /app/
  // (CATALOGO_SERVICIOS) y seed (SERVICIOS_STD), y el embudo escribía []. `plantillaServicios()` devuelve una COPIA
  // fresca (objetos nuevos) para que nadie mute la plantilla compartida.
  var SERVICIOS_PLANTILLA = [
    { key: 'salud',     nombre: 'Cobertura de salud',      detalle: 'Segun tu plan MEDIPaw',             estado: 'activo' },
    { key: 'descuento', nombre: 'Descuento 10%',           detalle: 'En comercios adheridos',            estado: 'disponible' },
    { key: 'gps',       nombre: 'GPS MEDIPaw',             detalle: 'Localizador para tu mascota',       estado: 'disponible' },
    { key: 'tienda',    nombre: 'Tienda MEDIPaw',         detalle: 'Productos exclusivos para socios',  estado: 'disponible' },
    { key: 'vacuna',    nombre: 'Recordatorio de vacunas', detalle: 'Te avisamos cuando toque',          estado: 'disponible' },
  ];
  function plantillaServicios() {
    return SERVICIOS_PLANTILLA.map(function (s) { return { key: s.key, nombre: s.nombre, detalle: s.detalle, estado: s.estado }; });
  }

  // ══ ALTA COMO EMBUDO (especie → edad → plan del SISTEMA) ══
  // El plan y la cuota los fija el SISTEMA por especie/edad; el titular NO los elige. Esta lógica es la FUENTE ÚNICA;
  // las REGLAS Firestore replican el mapeo por BUCKET (planEsperadoR, sin math de request.time) — la fecha exacta
  // (bandas de abajo) solo refina el recálculo. Cortes perro/gato (confirmados Lucas 02/08): Joven <3 · Adulto 3–7 · Senior ≥8.
  var ESPECIES = ['perro', 'gato', 'ave', 'otros'];
  var ANIO_MS = 31557600000; // 365.25 días
  function especieValida(e) { return ESPECIES.indexOf(String(e || '')) >= 0; }

  // ── ASIGNACIÓN POR EDAD APROXIMADA (obligatoria, nunca traba el alta) ──
  // El plan lo maneja la EDAD APROXIMADA (4 buckets). La fecha exacta es OPCIONAL (refina el recálculo futuro).
  // Mapeo perro/gato por bucket de edad aproximada (lo declara el titular en el embudo):
  //   cachorro/joven→Joven · adulto→Adulto · mayor→Senior. ave/otros→Básico (sin importar edad).
  var EDADES_APROX = ['cachorro', 'joven', 'adulto', 'mayor'];
  function planPorEdadAprox(especie, edadAprox) {
    if (especie === 'perro' || especie === 'gato') {
      if (edadAprox === 'cachorro' || edadAprox === 'joven') return 'MEDIPaw Joven';
      if (edadAprox === 'mayor') return 'MEDIPaw Senior';
      return 'MEDIPaw Adulto'; // adulto
    }
    return 'MEDIPaw Básico'; // ave, otros
  }
  var EDAD_APROX_LABEL = { cachorro: 'Cachorro', joven: 'Joven', adulto: 'Adulto', mayor: 'Mayor' };

  // ── EDAD EXACTA (opcional): solo para REFINAR el recálculo cuando el titular cargó la fecha real ──
  function edadAnios(fnacMs, nowMs) { var d = Number(nowMs) - Number(fnacMs); return d > 0 ? d / ANIO_MS : 0; }
  // Bandas confirmadas por Lucas (02/08): Joven <3 · Adulto 3–7 · Senior ≥8. Coherentes con planPorEdadAprox.
  function planPorEspecieEdad(especie, fnacMs, nowMs) {
    if (especie === 'perro' || especie === 'gato') {
      var e = edadAnios(fnacMs, nowMs);
      if (e < 3) return 'MEDIPaw Joven';
      if (e >= 8) return 'MEDIPaw Senior';
      return 'MEDIPaw Adulto'; // 3–7
    }
    return 'MEDIPaw Básico';
  }
  function franjaEtaria(especie, fnacMs, nowMs) {
    if (especie !== 'perro' && especie !== 'gato') return 'Básico';
    var e = edadAnios(fnacMs, nowMs);
    return e < 3 ? 'Joven' : (e >= 8 ? 'Senior' : 'Adulto');
  }

  // Estados válidos de una MASCOTA (no del titular). 'activo' = cobertura vigente.
  // 'free' (Fase 4): mascota registrada gratis, SIN plan asignado, esperando activación por el admin. Distinto de
  // 'activo'+plan legacy 'Sin definir' (eso es plan sobre activo, no un estado). El plan se asigna recién al activar.
  var ESTADOS_MASCOTA = ['activo', 'free', 'suspendido', 'baja'];

  // Roles que trabajan en el PANEL staff (/app/). El titular (afiliado) usa la PWA (/socio/).
  // Ruteo del login único (TRAMO A): mixto staff+afiliado puede usar AMBAS (se queda donde entró); por eso son
  // dos preguntas independientes, no un único destino: /app/ exige esStaff; /socio/ exige esTitular.
  var STAFF_ROLES = ['admin', 'veterinario'];
  function normRoles(roles) { return (Array.isArray(roles) ? roles : []).map(function (r) { return r === 'prestador' ? 'veterinario' : r; }); }
  function esStaff(roles) { var r = normRoles(roles); return r.some(function (x) { return STAFF_ROLES.indexOf(x) >= 0; }); }
  function esTitular(roles) { return normRoles(roles).indexOf('afiliado') >= 0; }

  // CASOS (F1-B). Estados del caso. Al TITULAR se le habla de cuidado y acción, JAMÁS de clasificación/prioridad (N3).
  var ESTADOS_CASO = ['nuevo', 'en_curso', 'cerrado'];
  // Texto cara-al-titular por estado. NUNCA menciona prioridad, clasificación ni score (eso vive en casos_clinico).
  function estadoCasoTitular(estado) {
    switch (String(estado || 'nuevo')) {
      case 'en_curso': return { texto: 'Un veterinario está viendo lo que nos contaste', tono: 'en_curso' };
      case 'cerrado': return { texto: 'Cerramos este caso. Ante cualquier cosa, escribinos de nuevo', tono: 'cerrado' };
      default: return { texto: 'Lo recibimos — un veterinario lo va a revisar y te contactamos', tono: 'nuevo' };
    }
  }
  // Campos titular-safe de un caso (defensa en profundidad además de las reglas). Prioridad/notas NO están acá.
  var CAMPOS_CASO_TITULAR = ['mascotaId', 'mascotaNombre', 'relato', 'desdeCuando', 'urgenciaTitular', 'estado', 'respuestaTitular', 'atencionId', 'creadoEn'];

  // ══ COMPROBANTES (F1-C · contable del titular) ══
  // REGLA DE PRORRATEO (explícita, decisión Lucas 2026-07-24): MES COMPLETO, SIN PRORRATEO. El comprobante de un
  // período cobra las mascotas con cobertura vigente AL MOMENTO DE EMITIR, cada una a su cuota entera. Suspender o
  // agregar una mascota a mitad de mes NO proratea el período en curso: impacta el PRÓXIMO comprobante (calco MEDICAR).
  //
  // EL COMPROBANTE ES UNA FOTO (snapshot), NO un cálculo en vivo: `armarComprobante` congela los ítems (mascota, plan,
  // monto) al emitir. El comprobante guardado se lee tal cual (items/total); NUNCA se recalcula contra el estado
  // actual de las mascotas → un comprobante de marzo no cambia porque alguien cambie de plan en julio.
  var COMPROBANTE_PREFIJO = 'MP-C-';
  var COMPROBANTE_DIA_VENCIMIENTO = 10; // día del mes del período; constante única (cambiarla acá)
  function fmtComprobante(n) { return COMPROBANTE_PREFIJO + String(n).padStart(6, '0'); }
  // Ítem congelado de una mascota (foto al emitir).
  function itemComprobante(m) { return { mascotaId: (m && m.mascotaId) || '', mascotaNombre: (m && m.nombre) || '', plan: (m && m.plan) || '', monto: coberturaMascota(m).ok ? planCuota(m && m.plan) : 0 }; }
  // Arma el snapshot del comprobante de un titular para un período: SOLO mascotas con cobertura vigente (activo + plan
  // del catálogo). Devuelve { periodo, items[], total }. La numeración/venceEl/estado los agrega quien emite (admin).
  function armarComprobante(mascotas, periodo) {
    var items = (mascotas || []).filter(function (m) { return coberturaMascota(m).ok; }).map(itemComprobante);
    var total = items.reduce(function (s, it) { return s + (Number(it.monto) || 0); }, 0);
    return { periodo: periodo, items: items, total: total };
  }
  // Vencimiento: día fijo del mes del período, fin del día en hora AR (UTC-3 fijo). ISO con offset; null si período inválido.
  function venceComprobanteISO(periodo) {
    if (!/^[0-9]{4}-[0-9]{2}$/.test(String(periodo || ''))) return null;
    return periodo + '-' + String(COMPROBANTE_DIA_VENCIMIENTO).padStart(2, '0') + 'T23:59:59-03:00';
  }
  // Estado DERIVADO cara al titular (no toca el estado guardado): pagada | vencida | pendiente.
  function estadoComprobante(comp, ahoraMs, venceMs) {
    if (comp && comp.estado === 'pagada') return 'pagada';
    if (venceMs && ahoraMs && ahoraMs > venceMs) return 'vencida';
    return 'pendiente';
  }

  // ID estable por mascota. Calco EXACTO del portal (generarMascotaId): MP-<nnnn>-<NN> 1-based.
  function generarMascotaId(nroSocio, index) {
    var num = nroSocio ? String(nroSocio).replace('MP-', '') : '0000';
    return 'MP-' + num + '-' + String(index + 1).padStart(2, '0');
  }

  // Cuota mensual de un plan (0 si no está en catálogo).
  function planCuota(plan) {
    return PRECIOS[plan] || 0;
  }

  // ¿El plan es un plan REAL del catálogo? 'Sin definir', '' o nombres legacy fuera de catálogo → false.
  // Es requisito de cobertura vigente: sin plan del catálogo NO hay cobertura (aunque el estado sea 'activo').
  function planEnCatalogo(plan) {
    return Object.prototype.hasOwnProperty.call(PRECIOS, plan);
  }

  // Normaliza el estado de una mascota al set válido. Default conservador: 'suspendido'
  // (sin cobertura) ante ausencia/valor raro — NUNCA asumir 'activo' por defecto.
  function normalizarEstado(estado) {
    var e = String(estado || '').toLowerCase().trim();
    return ESTADOS_MASCOTA.indexOf(e) >= 0 ? e : 'suspendido';
  }

  // Mapea el estado del TITULAR (legacy: pendiente|activo|suspendido) al estado inicial de la
  // MASCOTA al migrar. Solo 'activo' hereda cobertura; el resto arranca 'suspendido'.
  function estadoDesdeTitular(estadoTitular) {
    return String(estadoTitular || '').toLowerCase().trim() === 'activo' ? 'activo' : 'suspendido';
  }

  /*
   * DECISIÓN DE COBERTURA — POR MASCOTA. Reemplaza los dos bugs del recon:
   *   (a) el vet validaba u.estado (TITULAR); ahora valida el estado de LA MASCOTA.
   *   (b) el carnet mostraba "Activo" hardcodeado; ahora refleja el estado real.
   * `ok` = la mascota tiene cobertura vigente AHORA. Devuelve todo lo que la UI necesita pintar.
   */
  function coberturaMascota(mascota) {
    var estado = normalizarEstado(mascota && mascota.estado);
    var planOk = planEnCatalogo(mascota && mascota.plan);
    // Cobertura vigente ⇔ estado 'activo' Y plan asignado del catálogo. Sin plan real → NO hay cobertura.
    var ok = estado === 'activo' && planOk;
    if (ok) {
      return { ok: true, estado: estado, planOk: true, label: 'Plan activo — cobertura vigente', color: '#166534', emoji: '✅', chip: 'Activo' };
    }
    // No vigente: distinguir el motivo. 'activo' pero sin plan del catálogo = "sin plan asignado".
    if (estado === 'activo' && !planOk) {
      return { ok: false, estado: estado, planOk: false, label: 'Sin plan asignado — sin cobertura', color: '#991b1b', emoji: '❌', chip: 'Sin plan' };
    }
    // FREE (Fase 4): registrada gratis, sin plan aún. NO es cobertura; el UI la muestra en gris con CTA de activación.
    if (estado === 'free') {
      return { ok: false, free: true, estado: 'free', planOk: false, label: 'Carnet free — activá su plan', color: '#8a5a00', emoji: '🔒', chip: 'Free' };
    }
    var META = {
      suspendido: { label: 'Plan suspendido — sin cobertura', chip: 'Suspendido' },
      baja: { label: 'Dada de baja — sin cobertura', chip: 'Baja' },
    };
    var m = META[estado] || META.suspendido;
    return { ok: false, estado: estado, planOk: planOk, label: m.label, color: '#991b1b', emoji: '❌', chip: m.chip };
  }

  // Suma de cuotas de las mascotas ACTIVAS de un titular. Es lo que paga la cuenta administrativa.
  // El titular NO tiene plan propio: su cuota = Σ cuotas de sus mascotas con cobertura vigente.
  function cuotaTitular(mascotas) {
    return (mascotas || []).reduce(function (acc, m) {
      return acc + (coberturaMascota(m).ok ? planCuota(m.plan) : 0);
    }, 0);
  }

  // Resumen de negocio para el dashboard admin: la unidad es la MASCOTA ACTIVA (estado 'activo', operativa).
  // `mascotasActivas` cuenta por ESTADO (no exige plan del catálogo) → una activa "Sin definir" cuenta como
  // operativa pero factura $0 y NO tiene cobertura vigente (ver coberturaMascota). `mascotasConCobertura` es
  // el subconjunto con cobertura real (activo + plan del catálogo). facturacion = Σ cuota de las activas.
  function resumenNegocio(mascotas) {
    var lista = mascotas || [];
    var activas = lista.filter(function (m) { return normalizarEstado(m && m.estado) === 'activo'; });
    var planCount = {};
    activas.forEach(function (m) {
      var p = (m && m.plan) || 'Sin definir';
      planCount[p] = (planCount[p] || 0) + 1;
    });
    return {
      mascotasTotales: lista.length,
      mascotasActivas: activas.length,
      mascotasConCobertura: lista.filter(function (m) { return coberturaMascota(m).ok; }).length,
      facturacion: activas.reduce(function (acc, m) { return acc + planCuota(m && m.plan); }, 0),
      planCount: planCount,
    };
  }

  /*
   * TRANSFORMACIÓN DE MIGRACIÓN — un usuario (doc `usuarios`) -> array de docs `mascotas/{mascotaId}`.
   * PURA: no lee ni escribe; el script de migración la usa y persiste. Idempotente por construcción
   * (mismo input → mismos mascotaId → mismos docs). Cada mascota embebida se proyecta a un doc con:
   *   titularUid, nombre, raza, fechaNacimiento, foto, plan, cuota, estado, token, servicios, creadoEn.
   * Reglas:
   *   - mascotaId: se respeta el existente; si falta, se genera con el nroSocio del titular.
   *   - si la mascota NO tiene mascotaId y el titular NO tiene nroSocio → NO se puede asignar id estable:
   *     se OMITE y se reporta en `saltadas` (se materializa recién al activar al titular).
   *   - estado: se hereda del titular (activo→activo; resto→suspendido).
   *   - cuota: PRECIOS[plan] (0 si sin plan).
   *   - creadoEn: se preserva el del titular si viene; si no, lo estampa el caller (no inventamos fecha acá).
   */
  function migrarUsuario(usuario) {
    var out = { docs: [], saltadas: [] };
    var u = usuario || {};
    var mascotas = Array.isArray(u.mascotas) ? u.mascotas : [];
    var estadoM = estadoDesdeTitular(u.estado);
    mascotas.forEach(function (m, i) {
      var mascotaId = (m && m.mascotaId) ? m.mascotaId : (u.nroSocio ? generarMascotaId(u.nroSocio, i) : '');
      if (!mascotaId) {
        out.saltadas.push({ titularUid: u.uid || null, nombre: (m && m.nombre) || null, motivo: 'sin nroSocio ni mascotaId' });
        return;
      }
      out.docs.push({
        mascotaId: mascotaId,
        titularUid: u.uid || null,
        nombre: (m && m.nombre) || '',
        raza: (m && m.raza) || '',
        fechaNacimiento: (m && m.fechaNacimiento) || '',
        foto: (m && m.foto) || '',
        plan: (m && m.plan) || 'Sin definir',
        // cuota = lo que se factura HOY por esta mascota: el precio del plan si tiene cobertura, si no 0.
        cuota: estadoM === 'activo' ? planCuota(m && m.plan) : 0,
        estado: estadoM,
        token: (m && m.token) || '',
        servicios: (m && Array.isArray(m.servicios)) ? m.servicios : [],
        creadoEn: (u.creadoEn != null) ? u.creadoEn : null,
      });
    });
    return out;
  }

  /* ═══════════════════════════════════════════════════════════════════════════════════════════
   * MOTOR DE COBERTURAS — FASE 1 (matriz + funciones puras). Fuente única, patrón PRECIOS.
   * Transcripción de la tabla comparativa de la landing (medipaw.com.ar) al 2026-07-27.
   * REGLAS DE NEGOCIO (Lucas 2026-07-27):
   *   R1. Cupos anuales y carencias corren por AÑO DE ANIVERSARIO del alta de cada mascota (no calendario).
   *   R2. Cupo agotado → precio socio (descuento base 25%), NUNCA precio de calle.
   *   R3. Cambio de franja etaria → en el ANIVERSARIO: el año se cursa entero con un plan y sus reglas; al
   *       renovar entra con la edad que tiene, plan que corresponde, cupos frescos. Sin prorrateos ni arrastres.
   *
   * ✔ REGLAS CONFIRMADAS POR LUCAS (2026-07-27) — ya NO son asunciones:
   *   C1. 'MEDIPaw Básico' ($40.000, ave/otros) = PLAN DE ACCESO: consulta, veterinario online, medicamentos,
   *       traslado, descuentos y asesoramiento legal. SIN prestaciones clínicas (cirugía, internación, estudios,
   *       vacunas, desparasitación, resonancia, periodontal, nutricionista, etólogo, especialidades, higiene, baño,
   *       cremación → ❌).
   *   C2. Tope sin % = 100% hasta el tope (PCT_PLENO = 1.0).
   *   C3. Carencia: UNA vez desde el alta; NO se re-aplica por aniversario.
   *   C4. Urgencias: carencia 0 en todo lo que incluye.
   *   C5. Sin tope explícito (medicamentos, vacunas, desparasitación, higiene, baño) = solo %, sin tope.
   *   C6. 'hasta 25%' = 25% fijo (ídem 'hasta 10km' = 10km).
   *   C7. Traslado: capea distancia (10km); el excedente queda a cargo del socio (pct/tope null → sin reintegro en $).
   *   C8. Cremación: 1/año.
   *   C9. Beneficios de acceso (Vet online, Descuentos, Legal): sin cupo/tope/pct.
   *   + Tope = monto máximo que REINTEGRA MEDIPaw. Post-cupo = 25% descuento socio, UNIFORME en toda prestación (R2).
   *   Pendiente: lectura fina de la tabla por Lucas (el motor computa exactamente lo que la tabla dice).
   * ═══════════════════════════════════════════════════════════════════════════════════════════ */
  var DIA_MS = 86400000;
  var DESCUENTO_SOCIO = 0.25; // R2: precio socio = 25% off (post-cupo). También piso de beneficio.
  var PCT_PLENO = 1.0;        // C2: reintegro asumido cuando la landing da solo tope (sin %).
  var PLANES_COB = ['MEDIPaw Urgencias', 'MEDIPaw Básico', 'MEDIPaw Joven', 'MEDIPaw Adulto', 'MEDIPaw Senior']; // C1: Básico = plan de acceso.

  // Cada entrada = una PRESTACIÓN. Campos default + `planes` (qué planes la incluyen + overrides por plan).
  //   Plan AUSENTE de `planes` = NO cubre (❌ en la landing). `{}` = incluido con los defaults.
  //   Override por plan puede pisar: cupoAnual | pct | tope | carenciaDias | postCupo.
  //   cupoAnual null = ilimitado · tope null = sin límite de monto · pct null = beneficio sin reintegro en $.
  var COBERTURAS = {
    // DESDOBLE (Lucas 2026-08-01): la consulta es de DOS tipos. La GUARDIA propia es ilimitada (como vetOnline); la
    // consulta a un veterinario EXTERNO va por reintegro con cupo/tope (los números que tenía 'consulta').
    consultaGuardia: { nombre: 'Consulta con veterinario MEDIPaw', categoria: 'Consulta veterinaria',
      cupoAnual: null, pct: null, tope: null, carenciaDias: 0, postCupo: 'socio', nota: 'Guardia propia MEDIPaw — sin límite',
      planes: { 'MEDIPaw Urgencias': {}, 'MEDIPaw Básico': {}, 'MEDIPaw Joven': {}, 'MEDIPaw Adulto': {}, 'MEDIPaw Senior': {} } },
    consultaExterna: { nombre: 'Consulta veterinario externo (reintegro)', categoria: 'Consulta veterinaria',
      cupoAnual: 2, pct: PCT_PLENO /*C2*/, tope: 35000, carenciaDias: 0, postCupo: 'socio', nota: 'Subsiguientes con 25% (post-cupo)',
      planes: { 'MEDIPaw Urgencias': {}, 'MEDIPaw Básico': {}, 'MEDIPaw Joven': {}, 'MEDIPaw Adulto': {}, 'MEDIPaw Senior': {} } },
    vetOnline: { nombre: 'Veterinario online', categoria: 'Consulta veterinaria', nota: 'Acceso ilimitado los 365 días (C9)',
      cupoAnual: null, pct: null, tope: null, carenciaDias: 0, postCupo: 'socio',
      planes: { 'MEDIPaw Urgencias': {}, 'MEDIPaw Básico': {}, 'MEDIPaw Joven': {}, 'MEDIPaw Adulto': {}, 'MEDIPaw Senior': {} } },
    medicamentos: { nombre: 'Medicamentos', categoria: 'Cuidado regular',
      cupoAnual: 2, pct: 0.25, tope: null /*C5*/, carenciaDias: 0, postCupo: 'socio',
      planes: { 'MEDIPaw Urgencias': {}, 'MEDIPaw Básico': {}, 'MEDIPaw Joven': {}, 'MEDIPaw Adulto': {}, 'MEDIPaw Senior': {} } },
    vacunas: { nombre: 'Vacunas', categoria: 'Cuidado regular',
      cupoAnual: 2, pct: 0.25, tope: null /*C5*/, carenciaDias: 0, postCupo: 'socio',
      planes: { 'MEDIPaw Joven': { cupoAnual: 5 }, 'MEDIPaw Adulto': { cupoAnual: 2 }, 'MEDIPaw Senior': { cupoAnual: 2 } } }, // URGENCIAS ❌
    desparasitacion: { nombre: 'Desparasitación', categoria: 'Cuidado regular',
      cupoAnual: 2, pct: 0.25, tope: null /*C5*/, carenciaDias: 0, postCupo: 'socio',
      planes: { 'MEDIPaw Joven': {}, 'MEDIPaw Adulto': {}, 'MEDIPaw Senior': {} } }, // URGENCIAS ❌
    traslado: { nombre: 'Traslado con mascota', categoria: 'Cuidado regular', nota: 'hasta 10km c/u; excedente a cargo del socio (C7)',
      cupoAnual: 2, pct: null /*C7*/, tope: null, carenciaDias: 0, postCupo: 'socio',
      planes: { 'MEDIPaw Urgencias': {}, 'MEDIPaw Básico': {}, 'MEDIPaw Joven': {}, 'MEDIPaw Adulto': {}, 'MEDIPaw Senior': {} } },
    analisis: { nombre: 'Análisis bioquímico', categoria: 'Estudio y tratamiento de alta complejidad',
      cupoAnual: 1, pct: PCT_PLENO /*C2*/, tope: 25000, carenciaDias: 60, postCupo: 'socio',
      planes: { 'MEDIPaw Urgencias': { carenciaDias: 0 /*C4*/ }, 'MEDIPaw Joven': {}, 'MEDIPaw Adulto': {}, 'MEDIPaw Senior': {} } },
    imagen: { nombre: 'Diagnóstico por imagen y estudio cardiológico', categoria: 'Estudio y tratamiento de alta complejidad',
      cupoAnual: 1, pct: PCT_PLENO /*C2*/, tope: 35000, carenciaDias: 60, postCupo: 'socio',
      planes: { 'MEDIPaw Urgencias': { carenciaDias: 0 /*C4*/ }, 'MEDIPaw Joven': {}, 'MEDIPaw Adulto': {}, 'MEDIPaw Senior': {} } },
    resonancia: { nombre: 'Resonancia magnética', categoria: 'Estudio y tratamiento de alta complejidad',
      cupoAnual: 1, pct: 0.50, tope: 80000, carenciaDias: 60, postCupo: 'socio',
      planes: { 'MEDIPaw Senior': {} } }, // solo SENIOR
    periodontal: { nombre: 'Tratamiento periodontal', categoria: 'Estudio y tratamiento de alta complejidad',
      cupoAnual: 1, pct: 0.50, tope: null, carenciaDias: 90, postCupo: 'socio',
      planes: { 'MEDIPaw Adulto': { tope: 60000 }, 'MEDIPaw Senior': { tope: 80000 } } }, // URG/JOVEN ❌; tope por plan
    cirugia: { nombre: 'Intervención quirúrgica', categoria: 'Intervención quirúrgica e internación',
      cupoAnual: 1, pct: 0.50, tope: 200000, carenciaDias: 90, postCupo: 'socio',
      planes: { 'MEDIPaw Urgencias': { carenciaDias: 0 /*C4*/ }, 'MEDIPaw Joven': {}, 'MEDIPaw Adulto': {}, 'MEDIPaw Senior': { tope: 300000 } } },
    internacion: { nombre: 'Internación', categoria: 'Intervención quirúrgica e internación',
      cupoAnual: 1, pct: 0.50, tope: 100000, carenciaDias: 90, postCupo: 'socio',
      planes: { 'MEDIPaw Joven': {}, 'MEDIPaw Adulto': {}, 'MEDIPaw Senior': {} } }, // URGENCIAS ❌
    nutricionista: { nombre: 'Nutricionista', categoria: 'Control y tratamiento con especialistas',
      cupoAnual: 3, pct: PCT_PLENO /*C2*/, tope: null, carenciaDias: 0, postCupo: 'socio',
      planes: { 'MEDIPaw Joven': {}, 'MEDIPaw Adulto': {}, 'MEDIPaw Senior': {} } }, // URGENCIAS ❌
    etologo: { nombre: 'Etólogo (conducta y comportamiento)', categoria: 'Control y tratamiento con especialistas',
      cupoAnual: 3, pct: PCT_PLENO /*C2*/, tope: 30000, carenciaDias: 0, postCupo: 'socio',
      planes: { 'MEDIPaw Joven': { cupoAnual: 3 }, 'MEDIPaw Adulto': { cupoAnual: 2 }, 'MEDIPaw Senior': { cupoAnual: 3 } } }, // URGENCIAS ❌
    especialidades: { nombre: 'Especialidades (dermato, oftalmo, nefro/urología, gastro, endocrino, clínico, odonto, traumato, fisio, onco)',
      categoria: 'Control y tratamiento con especialistas',
      cupoAnual: 2, pct: 0.50, tope: 30000, carenciaDias: 0, postCupo: 'socio',
      planes: { 'MEDIPaw Adulto': { cupoAnual: 2 }, 'MEDIPaw Senior': { cupoAnual: 3 } } }, // URG/JOVEN ❌; 50% off
    higiene: { nombre: 'Higiene complementaria', categoria: 'Cuidado adicional',
      cupoAnual: 1, pct: 0.25, tope: null, carenciaDias: 0, postCupo: 'socio',
      planes: { 'MEDIPaw Adulto': {}, 'MEDIPaw Senior': {} } }, // URG/JOVEN ❌
    bano: { nombre: 'Baño / peluquería', categoria: 'Cuidado adicional',
      cupoAnual: 1, pct: 0.25, tope: null, carenciaDias: 0, postCupo: 'socio',
      planes: { 'MEDIPaw Adulto': {}, 'MEDIPaw Senior': {} } }, // URG/JOVEN ❌
    descuentos: { nombre: 'Descuentos en alimentos y accesorios', categoria: 'Cuidado adicional',
      cupoAnual: null, pct: null, tope: null, carenciaDias: 0, postCupo: 'socio',
      planes: { 'MEDIPaw Urgencias': {}, 'MEDIPaw Básico': {}, 'MEDIPaw Joven': {}, 'MEDIPaw Adulto': {}, 'MEDIPaw Senior': {} } },
    legal: { nombre: 'Asesoramiento legal telefónico', categoria: 'Cuidado adicional',
      cupoAnual: null, pct: null, tope: null, carenciaDias: 0, postCupo: 'socio',
      planes: { 'MEDIPaw Urgencias': {}, 'MEDIPaw Básico': {}, 'MEDIPaw Joven': {}, 'MEDIPaw Adulto': {}, 'MEDIPaw Senior': {} } },
    cremacion: { nombre: 'Cremación', categoria: 'Cuidado adicional',
      cupoAnual: 1 /*C8*/, pct: PCT_PLENO /*C2*/, tope: 100000, carenciaDias: 0, postCupo: 'socio',
      planes: { 'MEDIPaw Adulto': {}, 'MEDIPaw Senior': {} } }, // URG/JOVEN ❌
  };

  // Etiquetas humanas por clave de prestación (para el <select> del vet y el render de Historia en /socio/).
  // Fuente única: el string `tipo` de una atención = clave de COBERTURAS; la UI muestra ETIQUETAS_PRESTACION[tipo].
  // Atenciones viejas con tipo fuera de este mapa (ej. 'estudio', 'urgencia') → la UI cae a capitalizar el crudo.
  var ETIQUETAS_PRESTACION = {
    consultaGuardia: 'Consulta con veterinario MEDIPaw', consultaExterna: 'Consulta veterinario externo (reintegro)',
    vetOnline: 'Veterinario online', medicamentos: 'Medicamentos',
    vacunas: 'Vacunas', desparasitacion: 'Desparasitación', traslado: 'Traslado con mascota',
    analisis: 'Análisis bioquímico', imagen: 'Diagnóstico por imagen / cardiológico', resonancia: 'Resonancia magnética',
    periodontal: 'Tratamiento periodontal', cirugia: 'Intervención quirúrgica', internacion: 'Internación',
    nutricionista: 'Nutricionista', etologo: 'Etólogo (conducta)', especialidades: 'Especialidades',
    higiene: 'Higiene complementaria', bano: 'Baño / peluquería', descuentos: 'Descuentos alimentos/accesorios',
    legal: 'Asesoramiento legal', cremacion: 'Cremación',
  };
  // Prestaciones agrupadas por categoría, en el orden de COBERTURAS (para armar el <select> con <optgroup>).
  function prestacionesPorCategoria() {
    var out = [], idx = {};
    Object.keys(COBERTURAS).forEach(function (k) {
      var cat = COBERTURAS[k].categoria || 'Otras';
      if (idx[cat] === undefined) { idx[cat] = out.length; out.push({ categoria: cat, items: [] }); }
      out[idx[cat]].items.push({ key: k, label: ETIQUETAS_PRESTACION[k] || (COBERTURAS[k].nombre || k) });
    });
    return out;
  }

  function _prestacion(prest) { return (typeof prest === 'string') ? COBERTURAS[prest] : prest; }
  // Regla efectiva (default de la prestación + override del plan). null si el plan NO incluye la prestación.
  function reglaCobertura(prest, plan) {
    var P = _prestacion(prest); if (!P || !P.planes) return null;
    var ov = P.planes[plan]; if (!ov) return null;
    function pick(k) { return (ov[k] !== undefined) ? ov[k] : P[k]; }
    return { nombre: P.nombre, plan: plan, cupoAnual: pick('cupoAnual'), pct: pick('pct'),
      tope: pick('tope'), carenciaDias: pick('carenciaDias'), postCupo: pick('postCupo') };
  }
  // Extrae ms de valores heterogéneos: number | Firestore Timestamp (toMillis) | {seconds,nanoseconds} | Date | ISO.
  // ⚠️ FIX Fase 2 (2026-07-28): la app pasa `fecha`/`creadoEn` como Timestamp de Firestore; `Number(Timestamp)` daba
  // NaN → la atención caía FUERA de la ventana de aniversario → el cupo no la contaba ("quedan 2 de 2" en vez de 1).
  function _toMs(x) {
    if (x == null) return null;
    if (typeof x === 'number') return isFinite(x) ? x : null;
    if (typeof x === 'string') { var ns = Number(x); if (x.trim() !== '' && isFinite(ns)) return ns; var ps = Date.parse(x); return isFinite(ps) ? ps : null; }
    if (typeof x.toMillis === 'function') { var mm = x.toMillis(); return isFinite(mm) ? mm : null; }               // Firestore Timestamp
    if (typeof x.toDate === 'function') { var dd = x.toDate(); return (dd instanceof Date && isFinite(dd.getTime())) ? dd.getTime() : null; }
    if (typeof x.seconds === 'number') return x.seconds * 1000 + (typeof x.nanoseconds === 'number' ? Math.floor(x.nanoseconds / 1e6) : 0);   // Timestamp plano
    if (typeof x._seconds === 'number') return x._seconds * 1000 + (typeof x._nanoseconds === 'number' ? Math.floor(x._nanoseconds / 1e6) : 0); // Timestamp serializado {_seconds}
    if (x instanceof Date) return isFinite(x.getTime()) ? x.getTime() : null;
    return null; // shape desconocido → null (y el llamador decide; carencia falla SEGURA, ver carenciaCumplida)
  }
  // Alta en ms. Contrato: mascota.altaMs (number). Tolera también un doc crudo con creadoEn Timestamp.
  function _altaMs(m) {
    if (!m) return null;
    var a = _toMs(m.altaMs);
    return (a != null) ? a : _toMs(m.creadoEn);
  }
  // Suma k años CALENDARIO (UTC), clampeando 29/02 → 28/02 en años no bisiestos (R1; alta 29/02).
  function addAnios(ms, k) {
    var d = new Date(ms), Y = d.getUTCFullYear() + k, M = d.getUTCMonth(), D = d.getUTCDate();
    var ultimo = new Date(Date.UTC(Y, M + 1, 0)).getUTCDate();
    if (D > ultimo) D = ultimo;
    return Date.UTC(Y, M, D, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds());
  }
  // Ventana del AÑO DE ANIVERSARIO que contiene fechaMs: [inicio, fin). indice = años cumplidos desde el alta.
  function ventanaAniversario(altaMs, fechaMs) {
    if (altaMs == null) return null;
    var k = 0;
    if (Number(fechaMs) >= altaMs) { while (addAnios(altaMs, k + 1) <= Number(fechaMs)) k++; }
    return { indice: k, inicio: addAnios(altaMs, k), fin: addAnios(altaMs, k + 1) };
  }
  function _fmtDM(ms) { var d = new Date(ms); return d.getUTCDate() + '/' + (d.getUTCMonth() + 1); }

  // ── carenciaCumplida(mascota, prestacion, fechaMs) ──
  // ¿La carencia (medida desde el alta, C3) está cumplida a `fechaMs`? { cumplida, incluida, carenciaDias, desdeMs }.
  function carenciaCumplida(mascota, prestacion, fechaMs) {
    var r = reglaCobertura(prestacion, mascota && mascota.plan);
    if (!r) return { cumplida: false, incluida: false, carenciaDias: null, desdeMs: null, sinAlta: false };
    var dias = r.carenciaDias || 0;
    if (dias <= 0) return { cumplida: true, incluida: true, carenciaDias: 0, desdeMs: null, sinAlta: false }; // sin carencia (nada que esperar)
    var alta = _altaMs(mascota);
    // ⚠️ FAIL-SAFE (bug Fase 2): si el alta NO se puede resolver, la carencia NO se da por cumplida (nunca fail-open).
    if (alta == null) return { cumplida: false, incluida: true, carenciaDias: dias, desdeMs: null, sinAlta: true };
    var desde = alta + dias * DIA_MS;
    return { cumplida: (Number(fechaMs) >= desde), incluida: true, carenciaDias: dias, desdeMs: desde, sinAlta: false };
  }
  // ── cupoDisponible(mascota, prestacion, atencionesDelAnio) ──
  // Cuenta atencionesDelAnio (de esta prestación, ya acotadas al año de aniversario vigente) contra el cupo.
  function cupoDisponible(mascota, prestacion, atencionesDelAnio) {
    var r = reglaCobertura(prestacion, mascota && mascota.plan);
    if (!r) return { incluida: false, cupoAnual: null, usados: 0, restantes: 0, agotado: true, ilimitado: false };
    var usados = (atencionesDelAnio || []).length;
    if (r.cupoAnual == null) return { incluida: true, cupoAnual: null, usados: usados, restantes: Infinity, agotado: false, ilimitado: true };
    return { incluida: true, cupoAnual: r.cupoAnual, usados: usados, restantes: Math.max(0, r.cupoAnual - usados), agotado: usados >= r.cupoAnual, ilimitado: false };
  }
  // ── cobertura(mascota, prestacion, monto, contexto) ──
  // contexto = { fechaMs, atenciones }  (atenciones = TODAS las de esta mascota+prestación; se filtran al año vigente).
  // → { cubre, pct, tope, aCargoSocio, motivo } (+ reintegro, restantes informativos).
  function cobertura(mascota, prestacion, monto, contexto) {
    monto = Number(monto) || 0; contexto = contexto || {};
    var fechaMs = Number(contexto.fechaMs) || 0, plan = mascota && mascota.plan;
    var P = _prestacion(prestacion), nombre = (P && P.nombre) || 'esta prestación';
    // 1) ¿la mascota tiene cobertura vigente? (activo + plan del catálogo). Legacy 'Sin definir' → no.
    var cob = coberturaMascota(mascota);
    if (!cob.ok) return { cubre: false, pct: 0, tope: null, aCargoSocio: monto, reintegro: 0, motivo: 'La mascota no tiene cobertura vigente (' + cob.chip + ')' };
    // 2) ¿el plan incluye la prestación?
    var r = reglaCobertura(prestacion, plan);
    if (!r) return { cubre: false, pct: 0, tope: null, aCargoSocio: monto, reintegro: 0, motivo: 'Tu plan (' + plan + ') no incluye ' + nombre };
    // 3) carencia (desde el alta). FAIL-SAFE: sin alta verificable → NO cubre (motivo distinto).
    //    REGLA CONFIRMADA (Lucas 2026-07-28): durante la carencia el reintegro es 0 (NO 25% socio). Fundamento: la
    //    carencia protege contra afiliación oportunista (servicio caro → una cuota → desafiliación); descontar 25% ahí
    //    subsidiaría esa conducta.
    var car = carenciaCumplida(mascota, prestacion, fechaMs);
    if (!car.cumplida) {
      var motC = car.sinAlta
        ? 'Sin fecha de alta verificable — no se puede confirmar la carencia'
        : 'En carencia hasta el ' + (car.desdeMs != null ? _fmtDM(car.desdeMs) : '—');
      return { cubre: false, pct: 0, tope: null, aCargoSocio: monto, reintegro: 0, motivo: motC };
    }
    // 4) cupo del AÑO DE ANIVERSARIO vigente (R1). ⚠️ BUG Fase 2: antes contaba TODAS las atenciones de la ventana
    //    contra CUALQUIER prestación. Ahora filtra por prestación (a.tipo === clave) Y por ventana.
    var key = (typeof prestacion === 'string') ? prestacion : null;
    var vent = ventanaAniversario(_altaMs(mascota), fechaMs);
    var atsAnio = (contexto.atenciones || []).filter(function (a) {
      if (key != null && !(a && a.tipo === key)) return false;        // SOLO esta prestación
      var t = _toMs(a && (a.fechaMs != null ? a.fechaMs : a.fecha));   // maneja Timestamp/Date/number/ISO
      if (t == null) return false;
      return vent ? (t >= vent.inicio && t < vent.fin) : true;         // dentro de la ventana de aniversario
    });
    var cupo = cupoDisponible(mascota, prestacion, atsAnio);
    // 5) cupo agotado → precio socio (R2), nunca precio de calle
    if (cupo.agotado) {
      var reintS = Math.round(monto * DESCUENTO_SOCIO);
      return { cubre: false, pct: DESCUENTO_SOCIO, tope: null, aCargoSocio: monto - reintS, reintegro: reintS, restantes: 0, motivo: 'Cupo anual agotado — precio socio (' + Math.round(DESCUENTO_SOCIO * 100) + '% off)' };
    }
    // 6) dentro del cupo → reintegro por % y/o tope
    if (r.pct == null && r.tope == null) return { cubre: true, pct: null, tope: null, aCargoSocio: monto, reintegro: 0, restantes: cupo.restantes, motivo: 'Beneficio incluido en tu plan' };
    var reint = (r.pct == null) ? monto : monto * r.pct;
    if (r.tope != null) reint = Math.min(reint, r.tope);
    reint = Math.round(reint);
    var det = (r.pct != null ? ('reintegro ' + Math.round(r.pct * 100) + '%') : 'reintegro pleno') + (r.tope != null ? (' hasta $' + r.tope) : '');
    return { cubre: true, pct: r.pct, tope: r.tope, aCargoSocio: monto - reint, reintegro: reint, restantes: cupo.restantes,
      motivo: 'Cubierto — ' + det + (cupo.ilimitado ? '' : (' · quedan ' + cupo.restantes + ' de ' + cupo.cupoAnual)) };
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // ══  TIENDA (Fase 1) — productos + pedidos. FUENTE ÚNICA del precio/total.                     ══
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // El pedido CONGELA el precio al comprar (snapshot, como el comprobante): `armarPedido` fija
  // `precioAplicado` y `total`; nunca se recalculan contra el precio vivo del producto después.
  // `precioSocio` es palanca freemium: lo paga el titular con mascota con cobertura vigente (esSocio).
  var CATEGORIAS_TIENDA = ['alimento', 'accesorios', 'higiene', 'juguetes', 'otros'];
  var ESTADOS_PEDIDO = ['nuevo', 'confirmado', 'en_camino', 'entregado', 'cancelado'];
  var METODOS_PAGO = ['efectivo', 'mp'];
  // Precio que paga ESTE titular: precioSocio si es socio y el producto lo define (>0); si no, precio de lista.
  function precioAplicado(prod, esSocio) {
    var base = Number((prod && prod.precio) || 0);
    var soc = (prod && prod.precioSocio != null && prod.precioSocio !== '') ? Number(prod.precioSocio) : null;
    return (esSocio && soc != null && soc > 0) ? soc : base;
  }
  // Ítem congelado del pedido (foto del precio al comprar). cant entero >= 1.
  function itemPedido(prod, cant, esSocio) {
    var c = Math.max(1, Math.floor(Number(cant) || 1));
    return {
      productoId: (prod && (prod.id || prod.productoId)) || '',
      nombre: (prod && prod.nombre) || '',
      precio: Number((prod && prod.precio) || 0),
      precioAplicado: precioAplicado(prod, esSocio),
      cant: c
    };
  }
  // Arma el snapshot de un pedido desde líneas [{prod, cant}]. Devuelve { items[], total }.
  // total = Σ(precioAplicado * cant). Estado/entrega/método los agrega quien crea el pedido.
  function armarPedido(lineas, esSocio) {
    var items = (lineas || []).map(function (l) { return itemPedido(l.prod || l, l.cant, esSocio); });
    var total = items.reduce(function (s, it) { return s + it.precioAplicado * it.cant; }, 0);
    return { items: items, total: total };
  }

  return {
    PRECIOS: PRECIOS,
    SERVICIOS_PLANTILLA: SERVICIOS_PLANTILLA,
    plantillaServicios: plantillaServicios,
    ESTADOS_MASCOTA: ESTADOS_MASCOTA,
    generarMascotaId: generarMascotaId,
    planCuota: planCuota,
    planEnCatalogo: planEnCatalogo,
    ESPECIES: ESPECIES,
    ANIO_MS: ANIO_MS,
    especieValida: especieValida,
    EDADES_APROX: EDADES_APROX,
    EDAD_APROX_LABEL: EDAD_APROX_LABEL,
    planPorEdadAprox: planPorEdadAprox,
    edadAnios: edadAnios,
    planPorEspecieEdad: planPorEspecieEdad,
    franjaEtaria: franjaEtaria,
    STAFF_ROLES: STAFF_ROLES,
    esStaff: esStaff,
    esTitular: esTitular,
    ESTADOS_CASO: ESTADOS_CASO,
    estadoCasoTitular: estadoCasoTitular,
    CAMPOS_CASO_TITULAR: CAMPOS_CASO_TITULAR,
    COMPROBANTE_PREFIJO: COMPROBANTE_PREFIJO,
    COMPROBANTE_DIA_VENCIMIENTO: COMPROBANTE_DIA_VENCIMIENTO,
    fmtComprobante: fmtComprobante,
    itemComprobante: itemComprobante,
    armarComprobante: armarComprobante,
    venceComprobanteISO: venceComprobanteISO,
    estadoComprobante: estadoComprobante,
    normalizarEstado: normalizarEstado,
    estadoDesdeTitular: estadoDesdeTitular,
    coberturaMascota: coberturaMascota,
    cuotaTitular: cuotaTitular,
    resumenNegocio: resumenNegocio,
    migrarUsuario: migrarUsuario,
    // ── Motor de coberturas (Fase 1) ──
    COBERTURAS: COBERTURAS,
    ETIQUETAS_PRESTACION: ETIQUETAS_PRESTACION,
    prestacionesPorCategoria: prestacionesPorCategoria,
    PLANES_COB: PLANES_COB,
    DESCUENTO_SOCIO: DESCUENTO_SOCIO,
    PCT_PLENO: PCT_PLENO,
    DIA_MS: DIA_MS,
    reglaCobertura: reglaCobertura,
    addAnios: addAnios,
    ventanaAniversario: ventanaAniversario,
    carenciaCumplida: carenciaCumplida,
    cupoDisponible: cupoDisponible,
    cobertura: cobertura,
    // ── Tienda (Fase 1) ──
    CATEGORIAS_TIENDA: CATEGORIAS_TIENDA,
    ESTADOS_PEDIDO: ESTADOS_PEDIDO,
    METODOS_PAGO: METODOS_PAGO,
    precioAplicado: precioAplicado,
    itemPedido: itemPedido,
    armarPedido: armarPedido,
  };
});
