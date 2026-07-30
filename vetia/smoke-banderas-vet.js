'use strict';
/*
 * VETIA — SMOKE del escáner de banderas rojas (estilo MEDICAR). Determinista, sin modelo, sin red.
 * Verifica: casos ROJOS (deben disparar), casos LIMPIOS (no deben), NEGACIONES limpias (no disparan),
 * y robustez a TILDES/MAYÚSCULAS (la normalización debe igualarlos al caso base).
 * CRITERIO rojo-primero: el falso negativo es el caro → los casos rojos son la parte dura del gate.
 * Corré:  node vetia/smoke-banderas-vet.js
 */

const { escanear } = require('./banderas-rojas-vet.js');

let ok = 0, fail = 0;
function esperar(texto, esperado, etiqueta) {
  const r = escanear(texto);
  const pass = r.rojo === esperado;
  if (pass) ok++; else fail++;
  const marca = pass ? '✓' : '✗';
  const det = pass ? '' : `  <-- esperaba rojo=${esperado}, dio rojo=${r.rojo} [${r.matched.join(',')}]`;
  console.log(`${marca} [${etiqueta}] "${texto}"${det}`);
}

console.log('== ROJOS (deben disparar) ==');
esperar('mi perro está convulsionando', true, 'convulsion');
esperar('el gato no puede respirar, le cuesta un montón', true, 'no_respira');
esperar('tiene las encías moradas', true, 'no_respira/cianosis');
esperar('está sangrando mucho de la boca', true, 'sangrado');
esperar('vomitó con sangre', true, 'sangrado');
esperar('se comió una barra de chocolate entera', true, 'toxico');
esperar('creo que tragó veneno para ratas', true, 'toxico+ambiguo');
esperar('no reacciona, está tirado y no responde', true, 'inconsciente');
esperar('tiene la panza muy hinchada y dura', true, 'torsion_gastrica');
esperar('hace arcadas sin vomitar nada', true, 'torsion_gastrica');
esperar('mi gato no puede orinar hace horas', true, 'obstruccion_urinaria');
esperar('la perra hace horas de parto y no expulsa el cachorro', true, 'parto_distocia');
esperar('creo que es un golpe de calor, jadea sin parar al sol', true, 'golpe_calor');
esperar('lo atropelló un auto recién', true, 'trauma');
esperar('se le salió el ojo de la órbita', true, 'ojo');
esperar('vomita sin parar desde la mañana', true, 'gastro_severo');
esperar('se le hinchó toda la cara de golpe', true, 'alergia');
esperar('no mueve las patas traseras, las arrastra', true, 'paralisis');
esperar('llora de dolor cuando lo toco', true, 'dolor_agudo');
esperar('necesito un veterinario ahora mismo, es una emergencia', true, 'urgencia_declarada');

console.log('\n== TILDES / MAYÚSCULAS (misma decisión que el caso base) ==');
esperar('Mi Perro Está CONVULSIONANDO', true, 'convulsion+mayus');
esperar('se comió CHOCOLATE', true, 'toxico+mayus');
esperar('tiene la pánza muy hínchada y dúra', true, 'torsion+tildes-raras');
esperar('NO PUEDE RESPIRAR', true, 'no_respira+mayus');

console.log('\n== NEGACIONES LIMPIAS (no deben disparar) ==');
esperar('no convulsiona, está tranquilo', false, 'neg-convulsion');
esperar('ya no sangra, se le cortó', false, 'neg-sangrado');
esperar('no tiene dificultad para respirar', false, 'neg-respira');

console.log('\n== LIMPIOS (consultas de plan/cuidado — no deben disparar) ==');
esperar('¿qué me cubre el plan Joven?', false, 'plan');
esperar('¿cuándo tengo que vacunar a mi perro?', false, 'vacunas');
esperar('quiero saber cuánto sale sumar otra mascota', false, 'precio');
esperar('¿el plan cubre la castración?', false, 'cirugia-consulta');
esperar('mi gato está jugando y comiendo bien', false, 'sano');
esperar('quiero pedir un turno para la próxima semana', false, 'turno-no-urgente');
esperar('¿qué comida le recomiendan para un cachorro?', false, 'nutricion');

console.log(`\n== RESULTADO: ${ok} ok, ${fail} fail ==`);
if (fail) { console.error('SMOKE ROJO'); process.exit(1); }
console.log('SMOKE VERDE');
