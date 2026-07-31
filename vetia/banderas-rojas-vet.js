'use strict';
/*
 * VETIA — ESCANEO DETERMINISTA DE BANDERAS ROJAS VETERINARIAS. NO usa el modelo.
 * Portado del scanner de MEDICAR (functions/banderas-rojas.js): misma mecánica —
 *   normalización (minúsculas + sin tildes) → regex por categoría + PROXIMIDAD (ancla + síntoma en ~30 chars,
 *   cualquier orden) → AMBIGÜEDAD dispara igual → NEGACIÓN solo si es limpia y adyacente.
 * CRITERIO: el falso positivo (aviso de más) es barato; el falso negativo es carísimo → ante la duda, dispara.
 * Corre sobre el mensaje del titular y decide —y solo esto— si VETIA marca urgencia y deriva a Emergencia.
 *
 * ⚠️ CONTENIDO EN DRAFT — PARA VETO DE LUCAS. Los patrones veterinarios (qué cuenta como urgencia real) los
 * revisa/aprueba Lucas antes de deployar. La MECÁNICA es la de MEDICAR (probada); lo que se veta es la LISTA.
 */

// Normalización EXPLÍCITA antes del match: minúsculas + sin tildes + espacios colapsados.
function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}
// Proximidad bidireccional: (a cerca de b) | (b cerca de a), ventana W chars (default 30).
function prox(a, b, W) { W = W || 30; return '(?:' + a + ').{0,' + W + '}(?:' + b + ')|(?:' + b + ').{0,' + W + '}(?:' + a + ')'; }

// Anclas de ingestión (para tóxicos por proximidad: "comió … chocolate").
const INGESTA = 'comio|se comio|trago|se trago|ingirio|lamio|mastico|le di|se metio|agarro y comio';
const TOXICO  = 'veneno|raticida|rodenticida|chocolate|anticongelante|xilitol|uvas?|pasas|cebolla|\\bajo\\b|lavandina|detergente|pastilla|ibuprofen|paracetamol|ivermectin|medicamento|planta toxica|marihuana|porro|cafe\\b|cafeina|masa cruda|masa con levadura';

const PATRONES = [
  // Convulsión / ataque / actividad epiléptica.
  { k: 'convulsion',       re: /convuls|ataque de epilep|epilep|le agarro un ataque|se convulsion|temblor(es)? generaliz|espasmos? generaliz|rigido y tembl|pedaleando (en el|el) (piso|suelo)/ },
  // Dificultad respiratoria / cianosis (encías/lengua azules).
  { k: 'no_respira',       re: /no (puede|podia) respirar|le cuesta respirar|dificultad para respirar|respir.{0,16}(con dificultad|dificultad|agitad|entrecortad)|(cuesta|costando).{0,12}respir|jadea.{0,14}(sin parar|sin freno|intens|desesperad)|encias? (azul|morad|violet|palid|blanc)|lengua (azul|morad|violet)|se (esta )?ahog|asfixi|respiracion (agitad|dificultos)/ },
  // Sangrado / hemorragia.
  { k: 'sangrado',         re: /sangr|hemorragia|perdida de sangre|sangre en (el|la|los|las) (vomito|orina|caca|materia|heces|pis|pipi)|vomit.{0,10}con sangre|caca con sangre|sangre por (la nariz|la boca|el ano|el hocico|los oidos)|no para de sangrar/ },
  // Tóxico / ingestión (proximidad ingesta+tóxico, o intoxicación declarada).
  { k: 'toxico',           re: new RegExp(prox(INGESTA, TOXICO, 34) + '|comio veneno|se intoxic|intoxicacion|veneno para rata|se envenen|le pico (una vibora|un alacran|un escorpion)') },
  // Inconsciencia / colapso.
  { k: 'inconsciente',     re: /no reacciona|no responde a nada|no se despierta|esta inconsciente|se desmay|se desplom|colaps|no se levanta|tirado y no (responde|reacciona|se mueve)/ },
  // Distensión abdominal / torsión gástrica (GDV): panza hinchada / arcadas improductivas.
  { k: 'torsion_gastrica', re: /(panza|abdomen|barriga|vientre|guata).{0,20}(hinchad|distendid|dur[ao]\b|inflad|como un tambor)|(hinchad|distendid|inflad).{0,14}(panza|abdomen|barriga|vientre|guata)|arcadas sin (vomitar|que salga|resultado|nada)|intenta vomitar y no (puede|sale|vomita|expulsa)|nauseas sin vomitar/ },
  // Obstrucción urinaria (emergencia felina, gato macho): hace fuerza y no orina.
  { k: 'obstruccion_urinaria', re: /no (puede|logra|consigue) orinar|no orina (hace|desde)|hace fuerza (para|y no) (orinar|hacer pis|sale nada)|quiere orinar y no (puede|sale)|no hace (pis|pipi) (hace|desde)|obstru.{0,10}(urin|ureter|vejiga)|se queja (en|al) (la caja|el arenero)/ },
  // Parto / distocia.
  { k: 'parto_distocia',   re: /no puede parir|cachorro (trabado|atascad|atorad)|distocia|hace (horas|mucho).{0,22}(pariendo|de parto|con contracciones)|trabajo de parto.{0,20}(no avanza|no sale|horas)|no expulsa (el|la) (cachorro|cria)/ },
  // Golpe de calor / insolación.
  { k: 'golpe_calor',      re: /golpe de calor|insolacion|(se recalent|temperatura altisim|muy caliente).{0,22}(jadea|colaps|no reacciona|tiembla)|jadea sin parar.{0,20}(sol|calor|auto|encerrad)/ },
  // Trauma grave.
  { k: 'trauma',           re: /atropell|lo (piso|choco) (un|el) (auto|coche|camion|moto)|se cayo de (altura|un balcon|una ventana|un (primer|segundo|tercer) piso)|caida de altura|fractura expuesta|hueso (afuera|expuesto|salido)|mordid.{0,16}(grave|profund|sangra)|pelea.{0,16}(grave|sangra|herid)/ },
  // Proptosis ocular (ojo fuera de la órbita).
  { k: 'ojo',              re: /ojo (salido|afuera|colgando|fuera de (la orbita|lugar|su lugar))|se le salio el ojo|globo ocular (afuera|salido|colgando)|proptosis/ },
  // Vómito / diarrea severos.
  { k: 'gastro_severo',    re: /vomit.{0,20}(sin parar|todo el dia|no para|un monton|muchas veces|no retiene)|diarrea con sangre|no (retiene|para de vomitar)|vomita y no (para|retiene) (agua|nada|liquid)/ },
  // Reacción alérgica / hinchazón facial.
  { k: 'alergia',          re: /(cara|hocico|cabeza|labios|parpados|jeta).{0,16}(hinchad|inflad)|(hinch|inflad|inflam).{0,16}(cara|hocico|cabeza|labios|parpados|jeta)|ronchas|reaccion alergica|picadura.{0,16}(hinch|inflam|reaccion)|urticaria/ },
  // Parálisis / no mueve el tren trasero (daño espinal).
  { k: 'paralisis',        re: /no mueve (las|sus|el|los) (patas|piernas|tren trasero|miembros)|arrastra (las|sus|el) (patas|piernas|tren)|no siente (las patas|el tren trasero)|paraliz|no puede (caminar|pararse|incorporarse)|tren trasero (caido|no responde|dormido)/ },
  // Dolor agudo evidente.
  { k: 'dolor_agudo',      re: /(llora|grita|chilla|aulla|gime) de dolor|tiembla de dolor|no se deja tocar.{0,16}(dolor|duele|queja|grita)|se queja (mucho|todo el tiempo) (de dolor|del dolor)|dolor (insoportable|muy fuerte|terrible)/ },
  // Electrocución (mordió un cable). [VETO Lucas 31/07]
  { k: 'electrocucion',    re: /electrocut|descarga electrica|choque electrico|se electrizo|(mordio|mastico|mordisque).{0,14}(un |el )?cable|cable.{0,14}(mordio|pelado con)/ },
  // Quemadura (agua hirviendo, plancha, fuego, química). [VETO Lucas 31/07]
  { k: 'quemadura',        re: /quemadura|se quemo|quemo (con|la|el|una)|agua hirviendo|aceite hirviendo|se prendio fuego|quemadura quimica|le cayo (agua|aceite) (caliente|hirviendo)/ },
  // Neonato que no mama / no come / frío y quieto. El propio "no mama" ES la bandera (no lo suprime la negación). [VETO Lucas 31/07]
  { k: 'neonato_no_mama',  re: /(recien nacid|neonato|cachorr|gatit|mamon).{0,34}(no mama|no come|no toma la teta|no se prende|frio y quieto|no se mueve)|(no mama|no toma la teta|no se prende).{0,24}(recien nacid|neonato|cachorr|gatit)/ },
  // Hipotermia / cuerpo frío (sobre todo neonatos y cachorros). [VETO Lucas 31/07]
  { k: 'hipotermia',       re: /hipotermia|frio extremo|temperatura (muy baja|bajisima)|cuerpo (muy )?frio|esta (helad|congelad)|frio y no reacciona|lo siento (helado|muy frio)/ },
  // Picaduras múltiples de abeja/avispa / enjambre. [VETO Lucas 31/07]
  { k: 'picaduras_multiples', re: /muchas picaduras|varias picaduras|un monton de picaduras|picaduras de (abeja|avispa)|un enjambre|avispero|lo (picaron|atacaron) (las |un monton de )?(abeja|avispa)/ },
];

// URGENCIA DECLARADA por tiempo (sin síntoma): pide un veterinario CON inmediatez → urgencia; salvo consulta de agenda.
const INMEDIATEZ = 'hoy mismo|\\bahora\\b|ahora mismo|ya mismo|\\bya\\b|en este momento|urge|no puede esperar|no da para esperar|de inmediato|inmediat|cuanto antes|lo antes posible|enseguida|es una emergencia|es urgente';
const ATENCION   = 'veterinari[oa]s?\\b|que (?:lo|la|me) vea[n]?|(?:lo|la) atiend|una urgencia|emergencia|a la guardia';
const EXCL_AGENDA = /\bturno|\bcita|\bagend|\breprogram|\bhorario|\bsobreturno|\bdisponible|precio|cuanto (sale|cuesta)|cobertura|\bplan\b/;
const URGENCIA_DECLARADA = new RegExp(prox(INMEDIATEZ, ATENCION, 40));

// Marcadores de AMBIGÜEDAD/duda/hedge: si aparecen junto a una bandera, DISPARA IGUAL (conservador).
const AMBIGUO = /\b(pero|sino|igual|tanto|no se|capaz|creo|medio|mas o menos|un poco|algo|todavia|aun|a veces|por momentos|parece|como que)\b/;
// Negador LIMPIO y adyacente antes del síntoma ("no ...", "ya no ...", "no tiene ...", "no presenta ...").
// Admite UN completador de negación ("tiene/hay/presenta/esta...") entre el "no" y el síntoma. Sigue siendo
// conservador: si hay hedge/contraste ("pero", "igual", "capaz"…) AMBIGUO dispara igual, aunque parezca negado.
const NEG_ADYACENTE = /\b(no|ya no|tampoco|nunca)\s(me\s|le\s|se\s|la\s|lo\s|tiene\s|hay\s|presenta\s|esta\s|estan\s)?$/;

function escanear(texto) {
  const t = norm(texto);
  const hits = [];
  for (const p of PATRONES) { const m = p.re.exec(t); if (m) hits.push({ k: p.k, idx: m.index }); }
  const mu = URGENCIA_DECLARADA.exec(t);
  if (mu && !EXCL_AGENDA.test(t)) hits.push({ k: 'urgencia_declarada', idx: mu.index });
  if (!hits.length) return { rojo: false, matched: [] };
  if (AMBIGUO.test(t)) return { rojo: true, matched: hits.map((h) => h.k) };
  const negadoLimpio = (idx) => NEG_ADYACENTE.test(t.slice(Math.max(0, idx - 16), idx));
  const vivos = hits.filter((h) => !negadoLimpio(h.idx));
  return { rojo: vivos.length > 0, matched: hits.map((h) => h.k) };
}

module.exports = { escanear, norm, prox, PATRONES };
