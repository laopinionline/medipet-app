# MEDIPaw — firestore.rules · diff del parche de seguridad (2026-07-24)

Cambios respecto del ruleset anterior (el del aviso previo del embudo). El nuevo `firestore.rules` del repo es el
final: listo para pegar en la consola de Firebase (medipet-c3a4d) UNA sola vez.

## 0) `getUserRoles()` — endurecido (raíz del fix b y estabilidad general)
- **Antes:** `get(usuarios/{uid}).data.roles` — si el doc no existe o no tiene `roles`, devuelve null → `'admin' in null`
  **erroreaba** y denegaba la evaluación completa.
- **Ahora:** guarda con `exists()` y default `[]`: `... ? get(...).data.get('roles', []) : []`.
- **Por qué:** un titular legítimo (o cualquier doc sin `roles`) ya no rompe `isAdmin()`/`esVeterinario()`. Base para
  poder ordenar las ramas con tranquilidad.

## a) `/usuarios/{userId}` update — ESCALADA DE PRIVILEGIOS (crítico, rompía N3 en prod)
- **Antes:** `allow update: if request.auth.uid == userId || isAdmin();` → el dueño escribía CUALQUIER campo de su doc,
  incluido `roles[]` → cualquier titular se agregaba `'admin'`/`'veterinario'` y entraba a `casos_clinico` y `prestadores`.
- **Ahora:** admin puede todo; el dueño solo `hasOnly(['mascotas','fotoTitular','nombre','apellido','telefono'])`.
  `roles`/`rol`/`estado` quedan FUERA de su alcance. Grants de rol = solo admin o `seed/agregar-rol.js`.
- **`mascotas` está en el whitelist** porque el embudo espeja ahí (`usuarios.mascotas[]`); ese array NO decide
  cobertura (eso es la colección `mascotas`, rule-enforced), así que no es vector de escalada.
- **Impacto cliente:** la migración `rol→roles` del `/app/` (que el dueño escribía) ahora se denega → se hizo
  NO-FATAL (try/catch): el mapeo local rige la sesión y las reglas aceptan `'prestador'` legacy. Login no se rompe.

## b) `/mascotas` create — ORDEN DE EVALUACIÓN
- **Antes:** `if isAdmin() || (titular...)` → evaluaba `isAdmin()` (con su `get()`) primero.
- **Ahora:** `if (titular...) || isAdmin()` (titular primero) + `getUserRoles` robusto.
- **Por qué:** un titular legítimo pasa por su rama sin depender de `isAdmin()`. (Con getUserRoles robusto ya no
  errorea, pero el orden es defensa extra.) **Orden de escrituras del alta:** usuario PRIMERO (registro), mascota
  DESPUÉS (embudo) → el doc de usuario ya existe cuando corre este create.

## c) `/mascotas_publicas` write
- **Antes:** `allow write: if request.auth != null` → cualquier autenticado pisaba la ficha pública de cualquier mascota.
- **Ahora:** `allow write: if isAdmin();` (la ficha pública la gestiona el admin; el titular no la escribe).

## d) `/solicitudes` read/update/delete
- **Antes:** `if request.auth != null` → cualquier autenticado leía bajas, cambios de plan y leads con datos de contacto.
- **Ahora:** `if isAdmin();` (create sigue público para el "Me interesa"). Solo el admin las lee/gestiona.

## e) `/atenciones` create — exigir `titularUid`
- **Antes:** create no exigía `titularUid` → atenciones sin titularUid que el titular NUNCA podía leer (el read lo pide).
- **Ahora:** create exige `titularUid is string && size() > 0`. El código del vet (`vetGuardarAtencion`) ya lo setea.

## f) `/pesos` create — permitir vet/admin
- **Antes:** solo el titular (`titularUid == uid`) → el vet no podía cargar peso en la guardia.
- **Ahora:** `exists(mascota)` + (`isAdmin() || esVeterinario()` **o** titular dueño). El vet/admin cargan peso de
  cualquier mascota existente; el titular solo de la suya.

## Verificación
- `firestore.rules` llaves balanceadas (31/31). Núcleo/apps sin cambios de comportamiento (solo la migración no-fatal).
- Regresión de la escalada (a) en `seed/gate-b-verif.js` (modo `escalada`): titular puro intentando
  `PATCH usuarios/{uid}` con `roles:['afiliado','admin']` → debe dar **403** (correr DESPUÉS de publicar el parche).
