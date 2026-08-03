'use strict';
/*
 * VETIA — SERVIDOR (VPS, Node + PM2 detrás de nginx). MEDIPaw es Spark (SIN Cloud Functions) → el server-side de
 * VETIA vive en el VPS como servicio Node, NO como Function. Expone POST /api/vetia.
 *
 * Flujo de una consulta:
 *   1) CORS: sólo el origen del demo (ALLOW_ORIGIN). Preflight OPTIONS → 204.
 *   2) Auth: verifica el ID token de Firebase (proyecto medipaw-demo) con firebase-admin. Sin token válido → 401.
 *   3) Escaneo determinista de banderas rojas (banderas-rojas-vet.js) — NO usa el modelo. Manda en urgencias.
 *   4) Arma el system prompt con el contexto del titular (mascotas + plan + cobertura del núcleo).
 *   5) Llama a Claude (haiku) con TIMEOUT. Si cae o tarda → respuesta segura de caída (con derivación a Emergencia si rojo).
 *
 * SECRETOS: ANTHROPIC_API_KEY y la ruta del service account (demo) viajan por .env EN EL VPS (git-ignorado, lo pone
 * Lucas a mano). NUNCA en el repo ni en el cliente. Ver .env.example.
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const { escanear } = require('./banderas-rojas-vet.js');
const { buildSystem } = require('./vetia-prompt.js');
const { armarContexto } = require('./contexto.js');
const { mensajesATurns, armarMessages } = require('./turns.js');
const turnos = require('./turnos.js');
const tienda = require('./tienda.js');
const MC = require('../lib/medipaw-core.js'); // núcleo (fuente única) para el veredicto informativo de la reserva

// --- Carga mínima de .env (sin dependencia dotenv). No pisa variables ya presentes en el entorno (PM2 gana). ---
(function loadEnv() {
  try {
    const p = path.join(__dirname, '.env');
    if (!fs.existsSync(p)) return;
    for (const raw of fs.readFileSync(p, 'utf8').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 0) continue;
      const k = line.slice(0, eq).trim();
      let v = line.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!(k in process.env)) process.env[k] = v;
    }
  } catch (_) { /* si falla, seguimos con el entorno tal cual */ }
})();

const CFG = {
  PORT: parseInt(process.env.PORT || '3001', 10),
  ALLOW_ORIGIN: process.env.ALLOW_ORIGIN || 'https://medipaw-demo.web.app',
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
  ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5',
  FIREBASE_SA_PATH: process.env.FIREBASE_SA_PATH || '',           // demo (medipaw-demo)
  FIREBASE_SA_PATH_PROD: process.env.FIREBASE_SA_PATH_PROD || '',  // prod (medipet-c3a4d) — Lucas lo coloca cuando encienda prod
  FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID || 'medipaw-demo',
  TEL_EMERG: process.env.TEL_EMERG || '0800-URGENCIA', // placeholder hasta que Lucas fije el teléfono real de guardia
  MAX_TOKENS: parseInt(process.env.MAX_TOKENS || '512', 10),
  TIMEOUT_MS: parseInt(process.env.TIMEOUT_MS || '18000', 10),
  MAX_MSG_CHARS: parseInt(process.env.MAX_MSG_CHARS || '2000', 10),
  // Tienda / pago MP: modo SIMULADO por defecto (acredita directo). En productivo, TIENDA_MP_SIMULADO=false + credenciales reales.
  TIENDA_MP_SIMULADO: process.env.TIENDA_MP_SIMULADO !== 'false',
};

// --- firebase-admin: verificación del ID token — DUAL-PROYECTO (demo + prod). Init defensivo (si falta un SA, log y
//     sigue). Un token trae su `aud`=projectId → solo valida en el app de SU proyecto; leemos/escribimos en ESE
//     Firestore. Prod entra solo cuando Lucas coloca FIREBASE_SA_PATH_PROD (hasta entonces, solo demo). ---
let admin = null;
const APPS = []; // [{ app, project }] — un app de firebase-admin por proyecto con SA presente
try {
  admin = require('firebase-admin');
  const initApp = (saPath, nombre) => {
    if (!saPath || !fs.existsSync(saPath)) return;
    try {
      const sa = JSON.parse(fs.readFileSync(saPath, 'utf8'));
      const app = admin.initializeApp({ credential: admin.credential.cert(sa), projectId: sa.project_id }, nombre);
      APPS.push({ app, project: sa.project_id });
      console.log('[vetia] firebase-admin listo (proyecto ' + sa.project_id + ' · ' + nombre + ')');
    } catch (e) { console.warn('[vetia] no se pudo init ' + nombre + ':', e.message); }
  };
  if (!admin.apps.length) {
    initApp(CFG.FIREBASE_SA_PATH, 'demo');
    initApp(CFG.FIREBASE_SA_PATH_PROD, 'prod');
  }
  if (!APPS.length) console.warn('[vetia] FALTA algún SA válido — la auth rechazará todo con 401 hasta configurarlo.');
} catch (e) {
  console.warn('[vetia] firebase-admin no disponible:', e.message);
}

// Verifica el ID token contra CADA proyecto inicializado. Devuelve { uid, db, project } del que valida (o null).
// Escribir/leer en `db` (el Firestore del proyecto del token) mantiene demo y prod aislados con un solo servicio.
async function verificarToken(token) {
  for (const { app, project } of APPS) {
    try {
      const decoded = await app.auth().verifyIdToken(token);
      return { uid: decoded.uid, db: app.firestore(), project };
    } catch (_) { /* token de otro proyecto → probar el siguiente app */ }
  }
  return null;
}

if (!CFG.ANTHROPIC_API_KEY) console.warn('[vetia] FALTA ANTHROPIC_API_KEY — el modelo devolverá siempre respuesta de caída.');

// --- Llamada a Claude (haiku) con timeout. Devuelve el texto o rechaza. Sin SDK: https nativo (corre en cualquier Node). ---
function callClaude(system, mensaje, turns) {
  return new Promise((resolve, reject) => {
    if (!CFG.ANTHROPIC_API_KEY) return reject(new Error('sin api key'));
    const payload = JSON.stringify({
      model: CFG.ANTHROPIC_MODEL,
      max_tokens: CFG.MAX_TOKENS,
      temperature: 0.2,
      system,
      messages: armarMessages(turns, mensaje), // historial de la sesión + el mensaje nuevo (siempre válido)
    });
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': CFG.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-length': Buffer.byteLength(payload),
      },
    }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error('anthropic ' + res.statusCode + ': ' + body.slice(0, 300)));
        try {
          const j = JSON.parse(body);
          const txt = (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
          if (!txt) return reject(new Error('respuesta vacía'));
          resolve(txt);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(CFG.TIMEOUT_MS, () => { req.destroy(new Error('timeout')); });
    req.write(payload);
    req.end();
  });
}

// --- Respuesta segura de caída del modelo. Si es urgencia, deriva SÍ o SÍ a Emergencia. ---
function respuestaCaida(rojo) {
  if (rojo) {
    return 'Por lo que contás, esto puede ser una urgencia y no conviene esperar. Llevá a tu mascota a un veterinario ' +
      'o a una guardia de inmediato. Si necesitás ayuda urgente de MEDIPaw, comunicate al ' + CFG.TEL_EMERG + '.';
  }
  return 'Perdón, ahora mismo no puedo responder. Probá de nuevo en un rato. Si tu mascota no está bien o tenés una ' +
    'urgencia, no esperes: consultá con un veterinario.';
}

function enviarJSON(res, code, obj, origin) {
  const bodyStr = JSON.stringify(obj);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': origin,
    'vary': 'Origin',
    'content-length': Buffer.byteLength(bodyStr),
  });
  res.end(bodyStr);
}

function corsHeaders(origin) {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-max-age': '3600',
    'vary': 'Origin',
  };
}

const server = http.createServer((req, res) => {
  const origin = CFG.ALLOW_ORIGIN; // fijamos SIEMPRE el origen del demo (otros orígenes los bloquea el navegador)

  // Preflight
  if (req.method === 'OPTIONS') { res.writeHead(204, corsHeaders(origin)); return res.end(); }

  const ruta = req.url.split('?')[0];
  const RUTAS = ['/api/vetia', '/api/turnos/reservar', '/api/turnos/cancelar', '/api/tienda/pagar'];
  if (req.method !== 'POST' || !RUTAS.includes(ruta)) {
    return enviarJSON(res, 404, { error: 'no encontrado' }, origin);
  }

  // Cuerpo (cap de tamaño para no comer memoria)
  let raw = '';
  let abortado = false;
  req.on('data', (d) => {
    raw += d;
    if (raw.length > 64 * 1024) { abortado = true; req.destroy(); }
  });
  req.on('end', async () => {
    if (abortado) return; // ya se cortó la conexión
    try {
      // 1) Auth: ID token (dual-proyecto). `reqDb` = Firestore del PROYECTO del token (demo o prod).
      const authz = req.headers['authorization'] || '';
      const m = authz.match(/^Bearer\s+(.+)$/i);
      if (!m) return enviarJSON(res, 401, { error: 'falta token' }, origin);
      if (!APPS.length) return enviarJSON(res, 503, { error: 'auth no configurada' }, origin);
      const authInfo = await verificarToken(m[1]);
      if (!authInfo) return enviarJSON(res, 401, { error: 'token inválido' }, origin);
      const uid = authInfo.uid;
      const reqDb = authInfo.db;
      const FV = () => admin.firestore.FieldValue.serverTimestamp();

      // 2) Payload
      let data = {};
      try { data = JSON.parse(raw || '{}'); } catch (_) { return enviarJSON(res, 400, { error: 'json inválido' }, origin); }

      // ── RUTAS DE TURNOS (reserva/cancelación con TX atómica; Admin SDK) ──
      if (ruta === '/api/turnos/reservar' || ruta === '/api/turnos/cancelar') {
        const db = reqDb; // Firestore del proyecto del token (demo o prod)
        try {
          if (ruta === '/api/turnos/reservar') {
            const out = await turnos.reservar({ db, FV, MC }, { uid, agendaId: data.agendaId, hora: data.hora, mascotaId: data.mascotaId }, Date.now());
            return enviarJSON(res, 200, { ok: true, turno: out.turno, info: out.info }, origin);
          }
          const out = await turnos.cancelar({ db, FV }, { uid, turnoId: data.turnoId }, Date.now());
          return enviarJSON(res, 200, { ok: true, cancelado: out }, origin);
        } catch (e) {
          if (e && e.code) return enviarJSON(res, 409, { ok: false, error: e.code }, origin); // rechazo de negocio (slot ocupado, etc.)
          console.error('[turnos] error interno:', e);
          return enviarJSON(res, 500, { ok: false, error: 'error interno' }, origin);
        }
      }

      // ── RUTA TIENDA / PAGO (acreditación del pago; Admin SDK) ──
      // MODO SIMULADO (default): acredita el pago del pedido del titular. El cliente NUNCA acredita por reglas;
      // esta es la vía server-side. En productivo (TIENDA_MP_SIMULADO=false) el mismo camino crea la preferencia MP real.
      if (ruta === '/api/tienda/pagar') {
        const db = reqDb; // Firestore del proyecto del token (demo o prod)
        try {
          const out = await tienda.pagar({ db, FV }, { uid, pedidoId: data.pedidoId }, { simulado: CFG.TIENDA_MP_SIMULADO }, Date.now());
          return enviarJSON(res, 200, { ok: true, pago: out }, origin);
        } catch (e) {
          if (e && e.code) return enviarJSON(res, 409, { ok: false, error: e.code }, origin); // rechazo de negocio (ajeno, ya-pagado, etc.)
          console.error('[tienda] error interno:', e);
          return enviarJSON(res, 500, { ok: false, error: 'error interno' }, origin);
        }
      }

      // ── RUTA VETIA (chat) ──
      let mensaje = typeof data.mensaje === 'string' ? data.mensaje.trim() : '';
      if (!mensaje) return enviarJSON(res, 400, { error: 'mensaje vacío' }, origin);
      if (mensaje.length > CFG.MAX_MSG_CHARS) mensaje = mensaje.slice(0, CFG.MAX_MSG_CHARS);
      const clientCtx = (data.contexto && typeof data.contexto === 'object') ? data.contexto : {};
      // Memoria de conversación: el front manda el historial de la sesión (últimos ~10). Se pasa como turns al modelo
      // para que retome el hilo. El scanner rojo NO lo mira: evalúa SOLO el mensaje nuevo.
      const turns = mensajesATurns(data.mensajes);

      // 3) Escaneo determinista (manda en urgencias) — SOLO el mensaje nuevo, nunca el historial.
      const scan = escanear(mensaje);

      // 4) URGENCIA (rojo) = SHORT-CIRCUIT: NO pasa por el modelo NI lee Firestore (no gastar queries en urgencias).
      //    El escáner es determinista → la urgencia no depende del criterio del modelo (ni de que esté vivo). El front
      //    muestra su banner en base a `rojo`. Sólo las consultas NO-rojas leen consumos y van al modelo.
      let respuesta;
      if (scan.rojo) {
        respuesta = respuestaCaida(true);
      } else {
        // 4b) Contexto REAL de consumos: leo mascotas + atenciones del titular con el uid del token (server-side, sin
        //     ampliar reglas de cliente) y computo consumos con el núcleo. Si la lectura falla, caigo al contexto del
        //     cliente (plan sin consumos) para no romper la respuesta.
        let contexto = clientCtx;
        try {
          const db = reqDb; // Firestore del proyecto del token (demo o prod)
          const [mSnap, aSnap] = await Promise.all([
            db.collection('mascotas').where('titularUid', '==', uid).get(),
            db.collection('atenciones').where('titularUid', '==', uid).get(),
          ]);
          const mascotasDocs = mSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
          const atByMasc = {};
          aSnap.docs.forEach((d) => { const a = d.data(); const k = a.mascotaId || ''; (atByMasc[k] = atByMasc[k] || []).push(a); });
          contexto = armarContexto(mascotasDocs, atByMasc, clientCtx.nroSocio || '', Date.now());
        } catch (e) { console.warn('[vetia] no se pudo armar contexto de consumos:', e.message); }

        const system = buildSystem(contexto, false, Date.now()); // 5) system aterrizado + fecha de hoy + modelo con timeout
        try {
          respuesta = await callClaude(system, mensaje, turns);
        } catch (e) {
          console.warn('[vetia] modelo caído:', e.message);
          respuesta = respuestaCaida(false);
        }
      }

      return enviarJSON(res, 200, {
        respuesta,
        rojo: scan.rojo,
        escalar: scan.rojo,
        matched: scan.matched,
      }, origin);
    } catch (e) {
      console.error('[vetia] error interno:', e);
      return enviarJSON(res, 500, { error: 'error interno' }, origin);
    }
  });
});

server.listen(CFG.PORT, '127.0.0.1', () => {
  console.log('[vetia] escuchando en http://127.0.0.1:' + CFG.PORT + ' (origen permitido: ' + CFG.ALLOW_ORIGIN + ')');
});
