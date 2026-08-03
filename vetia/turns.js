'use strict';
/*
 * VETIA — memoria de conversación. El front manda el historial de la sesión (los mensajes ya renderizados) en el POST
 * con shape { mensajes: [{ rol:'user'|'vetia', texto }] }. Acá lo convertimos en `turns` para el modelo y lo ensamblamos
 * con el mensaje nuevo en un array `messages` VÁLIDO para la API de Anthropic (empieza en user, roles alternados).
 *
 * El scanner rojo NO usa esto: evalúa SOLO el mensaje nuevo (banderas-rojas-vet.js), no el historial.
 */

const MAX_TURNS = 10;    // últimos N mensajes del historial (techo de cantidad)
const MAX_CHARS = 1500;  // techo por mensaje del historial (recorte defensivo)

// { rol:'user'|'vetia', texto } → { role:'user'|'assistant', content }, filtrado, recortado y acotado a los últimos N.
function mensajesATurns(mensajes, opts) {
  const o = opts || {};
  const maxTurns = o.maxTurns || MAX_TURNS;
  const maxChars = o.maxChars || MAX_CHARS;
  if (!Array.isArray(mensajes)) return [];
  let arr = mensajes
    .filter((m) => m && typeof m.texto === 'string' && m.texto.trim())
    .map((m) => {
      const rol = String(m.rol || '').toLowerCase();
      const role = (rol === 'vetia' || rol === 'assistant' || rol === 'model' || rol === 'bot') ? 'assistant' : 'user';
      let content = m.texto.trim();
      if (content.length > maxChars) content = content.slice(0, maxChars);
      return { role, content };
    });
  if (arr.length > maxTurns) arr = arr.slice(arr.length - maxTurns);
  return arr;
}

// Ensambla el array `messages` final: colapsa roles consecutivos, descarta assistant inicial (la API exige empezar en
// user) y agrega el mensaje NUEVO como user al final (mergeándolo si el último turn ya era user). Siempre válido.
function armarMessages(turns, mensaje) {
  const historia = Array.isArray(turns) ? turns : [];
  const messages = [];
  for (const t of historia) {
    if (!t || (t.role !== 'user' && t.role !== 'assistant') || typeof t.content !== 'string' || !t.content.trim()) continue;
    const last = messages[messages.length - 1];
    if (last && last.role === t.role) last.content += '\n' + t.content.trim();
    else messages.push({ role: t.role, content: t.content.trim() });
  }
  while (messages.length && messages[0].role === 'assistant') messages.shift();
  const nuevo = typeof mensaje === 'string' ? mensaje.trim() : '';
  const last = messages[messages.length - 1];
  if (nuevo) {
    if (last && last.role === 'user') last.content += '\n' + nuevo;
    else messages.push({ role: 'user', content: nuevo });
  } else if (!messages.length) {
    messages.push({ role: 'user', content: '' });
  }
  return messages;
}

module.exports = { mensajesATurns, armarMessages, MAX_TURNS, MAX_CHARS };
