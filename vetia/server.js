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
  FIREBASE_SA_PATH: process.env.FIREBASE_SA_PATH || '',
  FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID || 'medipaw-demo',
  TEL_EMERG: process.env.TEL_EMERG || '0800-URGENCIA', // placeholder hasta que Lucas fije el teléfono real de guardia
  MAX_TOKENS: parseInt(process.env.MAX_TOKENS || '512', 10),
  TIMEOUT_MS: parseInt(process.env.TIMEOUT_MS || '18000', 10),
  MAX_MSG_CHARS: parseInt(process.env.MAX_MSG_CHARS || '2000', 10),
};

// --- firebase-admin: verificación del ID token del proyecto demo. Init defensivo (si falta el SA, log y sigue: los
//     requests fallarán la auth con 401, no se cae el proceso). ---
let admin = null;
try {
  admin = require('firebase-admin');
  if (!admin.apps.length) {
    if (CFG.FIREBASE_SA_PATH && fs.existsSync(CFG.FIREBASE_SA_PATH)) {
      const sa = JSON.parse(fs.readFileSync(CFG.FIREBASE_SA_PATH, 'utf8'));
      admin.initializeApp({ credential: admin.credential.cert(sa), projectId: sa.project_id || CFG.FIREBASE_PROJECT_ID });
      console.log('[vetia] firebase-admin listo (proyecto ' + (sa.project_id || CFG.FIREBASE_PROJECT_ID) + ')');
    } else {
      console.warn('[vetia] FALTA FIREBASE_SA_PATH válido — la auth rechazará todo con 401 hasta configurarlo.');
    }
  }
} catch (e) {
  console.warn('[vetia] firebase-admin no disponible:', e.message);
}

if (!CFG.ANTHROPIC_API_KEY) console.warn('[vetia] FALTA ANTHROPIC_API_KEY — el modelo devolverá siempre respuesta de caída.');

// --- Llamada a Claude (haiku) con timeout. Devuelve el texto o rechaza. Sin SDK: https nativo (corre en cualquier Node). ---
function callClaude(system, mensaje) {
  return new Promise((resolve, reject) => {
    if (!CFG.ANTHROPIC_API_KEY) return reject(new Error('sin api key'));
    const payload = JSON.stringify({
      model: CFG.ANTHROPIC_MODEL,
      max_tokens: CFG.MAX_TOKENS,
      temperature: 0.2,
      system,
      messages: [{ role: 'user', content: mensaje }],
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

  if (req.method !== 'POST' || req.url.split('?')[0] !== '/api/vetia') {
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
      // 1) Auth: ID token del demo
      const authz = req.headers['authorization'] || '';
      const m = authz.match(/^Bearer\s+(.+)$/i);
      if (!m) return enviarJSON(res, 401, { error: 'falta token' }, origin);
      if (!admin || !admin.apps.length) return enviarJSON(res, 503, { error: 'auth no configurada' }, origin);
      try {
        await admin.auth().verifyIdToken(m[1]);
      } catch (_) {
        return enviarJSON(res, 401, { error: 'token inválido' }, origin);
      }

      // 2) Payload
      let data = {};
      try { data = JSON.parse(raw || '{}'); } catch (_) { return enviarJSON(res, 400, { error: 'json inválido' }, origin); }
      let mensaje = typeof data.mensaje === 'string' ? data.mensaje.trim() : '';
      if (!mensaje) return enviarJSON(res, 400, { error: 'mensaje vacío' }, origin);
      if (mensaje.length > CFG.MAX_MSG_CHARS) mensaje = mensaje.slice(0, CFG.MAX_MSG_CHARS);
      const contexto = (data.contexto && typeof data.contexto === 'object') ? data.contexto : {};

      // 3) Escaneo determinista (manda en urgencias)
      const scan = escanear(mensaje);

      // 4) System prompt aterrizado en el contexto + 5) modelo con timeout
      const system = buildSystem(contexto, scan.rojo);
      let respuesta;
      try {
        respuesta = await callClaude(system, mensaje);
      } catch (e) {
        console.warn('[vetia] modelo caído:', e.message);
        respuesta = respuestaCaida(scan.rojo);
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
