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
    'MEDIPaw Joven': 58788,
    'MEDIPaw Adulto': 54388,
    'MEDIPaw Senior': 70788,
  };

  // Estados válidos de una MASCOTA (no del titular). 'activo' = cobertura vigente.
  var ESTADOS_MASCOTA = ['activo', 'suspendido', 'baja'];

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

  return {
    PRECIOS: PRECIOS,
    ESTADOS_MASCOTA: ESTADOS_MASCOTA,
    generarMascotaId: generarMascotaId,
    planCuota: planCuota,
    planEnCatalogo: planEnCatalogo,
    STAFF_ROLES: STAFF_ROLES,
    esStaff: esStaff,
    esTitular: esTitular,
    ESTADOS_CASO: ESTADOS_CASO,
    estadoCasoTitular: estadoCasoTitular,
    CAMPOS_CASO_TITULAR: CAMPOS_CASO_TITULAR,
    normalizarEstado: normalizarEstado,
    estadoDesdeTitular: estadoDesdeTitular,
    coberturaMascota: coberturaMascota,
    cuotaTitular: cuotaTitular,
    resumenNegocio: resumenNegocio,
    migrarUsuario: migrarUsuario,
  };
});
