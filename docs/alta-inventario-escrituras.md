# MEDIPaw — Inventario de escrituras del alta (autoridad = el código)

Fuente: `socio/index.html` (`doRegistro`, `finalizarAlta`) + `lib/medipaw-core.js`. Verificado byte a byte 2026-07-24.

## Orden de escrituras
1. **Registro** (`doRegistro`) → crea `usuarios/{uid}` (`.set`). PRIMERO, en pantalla de registro.
2. **Embudo** (`finalizarAlta`), acción POSTERIOR y separada, en este orden:
   a. `mascotas/{mascotaId}` (`.set`)
   b. `usuarios/{uid}` (`.update`, espejo del array embebido)
   c. `pesos` (`.add`)
> Cuando corre el create de `mascotas`, el doc `usuarios/{uid}` YA existe (se creó en el registro). Igual conviene
> el orden titular-primero + `getUserRoles` robusto en reglas (ver parche b).

---

## Write 1 — `usuarios/{uid}` (`.set`, en `doRegistro`)
Colección **raíz** `usuarios`, doc id = `uid` de Firebase Auth.

| campo | tipo | valor |
|---|---|---|
| `uid` | string | uid |
| `nombre` | string | del form |
| `apellido` | string | del form |
| `email` | string | del form |
| `telefono` | string | del form (`tel`) |
| `rol` | string | `'afiliado'` (legacy) |
| `roles` | array\<string\> | `['afiliado']` |
| `estado` | string | `'activo'` |
| `mascotas` | array | `[]` (se llena con el espejo del embudo) |
| `creadoEn` | timestamp | serverTimestamp |

---

## Write 2 — `mascotas/{mascotaId}` (`.set`, en `finalizarAlta`)
Colección **raíz** `mascotas`. **doc id = `mascotaId`** = `'MP-' + genCodigo(8)` (8 chars de `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, sin ambiguos).

| campo | tipo | valores posibles |
|---|---|---|
| `mascotaId` | string | `MP-XXXXXXXX` (== doc id) |
| `titularUid` | string | uid del titular |
| `nombre` | string | libre |
| `especie` | string | **`perro` · `gato` · `ave` · `otros`** |
| `edadAprox` | string | **`cachorro` · `joven` · `adulto` · `mayor`** ← ESTE es el campo de franja etaria |
| `raza` | string | libre (obligatorio en el form) |
| `sexo` | string | `macho` · `hembra` |
| `plan` | string | **`MEDIPaw Joven` · `MEDIPaw Adulto` · `MEDIPaw Senior` · `MEDIPaw Básico`** (nunca Urgencias por el embudo) |
| `cuota` | number | `58788` · `54388` · `70788` · `40000` (coincide con el plan) |
| `estado` | string | `'activo'` (fijo) |
| `foto` | string | `''` |
| `token` | string | `''` |
| `servicios` | array | `[]` |
| `creadoEn` | timestamp | serverTimestamp |
| `fechaNacimiento` | timestamp | **OPCIONAL** — solo si el titular cargó la fecha exacta (no la manda si no) |

### Campo de franja etaria: **`edadAprox`** (NO `franja`)
El código escribe `edadAprox`. `firestore.rules` del repo compara `data.edadAprox`. → **CONSISTENTE.** El "franja" del
prompt anterior era el diseño viejo (por fecha); quedó descartado. El campo real es **`edadAprox`**.

### String del plan básico: **`'MEDIPaw Básico'` CON tilde (á)**
Verificado: `Básico` con tilde en núcleo (5), reglas (2) y socio (1); `Basico` sin tilde = 0 en los tres. La regla
`precioDeR` compara `'MEDIPaw Básico'` (tilde) → el código manda lo mismo → `precioDeR` devuelve 40000 (no -1). OK.

### Mapeo `edadAprox → plan`: núcleo vs reglas — IDÉNTICOS
| edadAprox | `planPorEdadAprox` (núcleo) | `planEsperadoR` (reglas) |
|---|---|---|
| cachorro | MEDIPaw Joven | MEDIPaw Joven |
| **joven** | **MEDIPaw Adulto** | **MEDIPaw Adulto** |
| adulto | MEDIPaw Adulto | MEDIPaw Adulto |
| mayor | MEDIPaw Senior | MEDIPaw Senior |
| (ave/otros, cualquier edad) | MEDIPaw Básico | MEDIPaw Básico |

`joven → MEDIPaw Adulto` en AMBOS. Réplica correcta. (Lógica: conserva las franjas <1→Joven, 1–7→Adulto, >7→Senior;
'joven' y 'adulto' caen en el rango Adulto.)

### Precios (PRECIOS del núcleo, fuente única)
`MEDIPaw Urgencias` 23988 · `MEDIPaw Básico` 40000 · `MEDIPaw Joven` 58788 · `MEDIPaw Adulto` 54388 · `MEDIPaw Senior` 70788.
El embudo solo asigna Joven/Adulto/Senior/Básico; Urgencias existe en catálogo/admin pero no lo asigna el alta.

---

## Write 3 — `usuarios/{uid}` (`.update`, espejo embebido, en `finalizarAlta`)
`.update({ mascotas: arr })` — appendea al array `usuarios.mascotas[]` un objeto:

| campo (del item embebido) | tipo | valor |
|---|---|---|
| `nombre` | string | == mascota |
| `raza` | string | == mascota |
| `especie` | string | == mascota |
| `sexo` | string | == mascota |
| `plan` | string | == mascota |
| `mascotaId` | string | == mascota |
| `token` | string | `''` |

> ⚠️ Para las reglas: el titular ESCRIBE su propio `usuarios/{uid}` acá (campo `mascotas`). El parche (a) debe
> incluir `mascotas` en el whitelist del titular, o el embudo se rompe. (El array embebido NO decide cobertura —
> eso es la colección `mascotas`, rule-enforced.)

---

## Write 4 — `pesos` (`.add`, en `finalizarAlta`)
Colección **RAÍZ** `pesos` (NO subcolección). doc id = auto-id de Firestore.

| campo | tipo | valor |
|---|---|---|
| `mascotaId` | string | de la mascota recién creada |
| `titularUid` | string | uid del titular |
| `peso` | number | `Number(peso)` (kg) |
| `fecha` | timestamp | serverTimestamp |
| `origen` | string | `'alta'` (el bloque "Chequeo y peso" agregará puntos con otro origen) |
