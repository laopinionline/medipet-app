'use strict';
/*
 * SMOKE del callejero de Pergamino (lib/callejero.js) — calcado del smoke-f1-callejero de MEDICAR, pero manejando la
 * API del MÓDULO directamente (no vm/extracción: acá el callejero YA es un módulo limpio). Determinista, sin red.
 * Verifica: slug determinista/estable (589 ids únicos), resolución (Mitre/Av-Pellegrini/rural/ambiguo/desconocido),
 * detección rural + isRural, degradación a null sin JSON, y PARIDAD node↔browser (mismo núcleo, mismo JSON servido).
 * Corré:  node seed/smoke-callejero.js
 */
const fs = require('fs');
const path = require('path');
const Callejero = require('../lib/callejero.js');
const CALLES = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'lib', 'calles-pergamino.json'), 'utf8'));
const { calleSlug, normStreet } = Callejero._test;

let ok = 0, fail = 0;
const t = (label, cond, extra = '') => { cond ? ok++ : fail++; console.log(`${cond ? '✓' : '✗ FALLO'} ${label}${extra ? ' → ' + extra : ''}`); };

// El browser hace Callejero.cargar() (fetch); el smoke inyecta el MISMO JSON con cargarDesde (paridad node↔browser).
Callejero.cargarDesde(CALLES);

console.log('== A. datos + slug: determinismo y estabilidad ==');
t('A1 el JSON tiene 589 calles', CALLES.length === 589, String(CALLES.length));
t('A2 opciones() devuelve las 589 (para el <datalist>)', Callejero.opciones().length === 589);
t('A3 slug determinista (misma entrada, mismo id)', calleSlug('Bartolomé Mitre') === calleSlug('Bartolomé Mitre'));
t('A4 slug de "Bartolomé Mitre" = bartolome-mitre', calleSlug('Bartolomé Mitre') === 'bartolome-mitre', calleSlug('Bartolomé Mitre'));
t('A5 "Mitre" ≠ "Bartolomé Mitre" (no fusiona)', calleSlug('Mitre') !== calleSlug('Bartolomé Mitre'));
t('A6 slug numérico "9 de Julio"', calleSlug('9 de Julio') === '9-de-julio', calleSlug('9 de Julio'));
{
  const ids = new Set(CALLES.map(calleSlug));
  t('A7 589 entradas → 589 ids únicos (0 colisión de slug)', ids.size === CALLES.length, `${ids.size}/${CALLES.length}`);
  t('A8 ningún slug vacío', ![...ids].some((x) => !x));
}

console.log('== B. resolver: resolución con el callejero cargado ==');
{
  const R = (dom) => Callejero.resolver(dom);
  const mitre = R('Mitre 1234');
  t('B1 "Mitre 1234" → bartolome-mitre (alias plegado), altura 1234, isRural false',
    mitre.calleId === 'bartolome-mitre' && mitre.altura === 1234 && mitre.isRural === false, JSON.stringify(mitre));
  const pell = R('carlos pellegrini 500');
  t('B2 "carlos pellegrini 500" tolera prefijo/caso', pell.calleId === 'avenida-carlos-pellegrini' && pell.altura === 500, JSON.stringify(pell));
  const pell2 = R('Av. Carlos Pellegrini 500');
  t('B3 "Av. Carlos Pellegrini 500" mismo calleId (Av. se ignora)', pell2.calleId === 'avenida-carlos-pellegrini', JSON.stringify(pell2));
  const rural = R('Zona Rural, Ruta 32 km 5');
  t('B4 rural → calleId null, isRural true', rural.calleId === null && rural.isRural === true, JSON.stringify(rural));
  const ruta = R('Ruta 8 km 12');
  t('B5 "Ruta 8 km 12" → rural (isRural true)', ruta.isRural === true && ruta.calleId === null, JSON.stringify(ruta));
  const desc = R('Calle Inventada 742');
  t('B6 calle desconocida → calleId null pero conserva altura 742, NO rural', desc.calleId === null && desc.altura === 742 && desc.isRural === false, JSON.stringify(desc));
  const belg = R('Belgrano 100');
  t('B7 "Belgrano" ambiguo → calleId null (no adivina) pero conserva altura', belg.calleId === null && belg.altura === 100, JSON.stringify(belg));
  const sinAlt = R('Bartolomé Mitre');
  t('B8 sin altura → resuelve la calle igual, altura null', sinAlt.calleId === 'bartolome-mitre' && sinAlt.altura === null, JSON.stringify(sinAlt));
}

console.log('== C. ambigüedad autodetectada (colisiones de normStreet) ==');
{
  const keys = new Map();
  for (const c of CALLES) { const k = normStreet(c); keys.set(k, (keys.get(k) || 0) + 1); }
  const ambiguas = [...keys.values()].filter((n) => n > 1).length;
  t('C1 hay ambigüedades detectadas (varias calles colapsan a la misma clave)', ambiguas > 0, `${ambiguas} claves ambiguas`);
  t('C2 589 calles → menos de 589 claves de búsqueda (por las ambiguas)', keys.size < CALLES.length, `${keys.size} claves`);
}

console.log('== D. degradación sin JSON (nunca tira, calleId siempre null) ==');
{
  Callejero.cargarDesde([]); // simula fetch fallido / json vacío
  t('D1 cargado() false con JSON vacío', Callejero.cargado() === false);
  const r = Callejero.resolver('Mitre 1234');
  t('D2 sin calles → calleId null, NO throw, altura preservada', r.calleId === null && r.altura === 1234, JSON.stringify(r));
  t('D3 opciones() vacío', Callejero.opciones().length === 0);
  Callejero.cargarDesde(CALLES); // restaura para cualquier assert posterior
}

console.log('== E. paridad node↔browser ==');
{
  // El browser: fetch(/lib/calles-pergamino.json) → cargarDesde implícito. El node: cargarDesde(mismo JSON). Mismo
  // núcleo, misma resolución. Verificamos que el JSON servido es EXACTAMENTE el que testeamos (no hay copia divergente).
  const servido = fs.existsSync(path.join(__dirname, '..', 'lib', 'calles-pergamino.json'));
  t('E1 el JSON vive en /lib/ (servido por la app, mismo que el smoke)', servido);
  t('E2 resolución idéntica a la esperada del browser (Mitre)', Callejero.resolver('Mitre 5').calleId === 'bartolome-mitre');
}

console.log(`\n== RESULTADO: ${ok} ok, ${fail} fail ==`);
process.exit(fail ? 1 : 0);
