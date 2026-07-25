# MEDIPaw — medipet-app · guía para Claude

Plan de salud para mascotas (Pergamino). App **client-only** (Firebase **Plan Spark, SIN Cloud Functions**),
proyecto Firebase `medipet-c3a4d`. Prod: VPS 186.148.233.122 (Nginx + Cloudflare), deploy **push+curl** (no scp).

## Estructura
- **`/socio/`** — PWA del titular (index.html + sw.js + manifest + icon.svg). Service worker versionado.
- **`/app/`** — panel staff (admin + veterinario). Un solo `index.html`.
- **`/lib/medipaw-core.js`** — **NÚCLEO PURO, fuente única** de la lógica (precios, cobertura, cuota, planes por
  edad, ruteo, casos, comprobantes). Lo cargan el portal (`<script src="/lib/...?v=X">` → `window.MEDIPAW`), los
  smokes (`node`) y las migraciones. Servido en `/lib/` (path absoluto, compartido por `/socio/` y `/app/`).
- `firestore.rules` — se publica A MANO en consola (Lucas). `seed/` — migraciones + verificadores (Admin SDK).
- Login ÚNICO, ruteo por rol (`MC.esStaff`/`MC.esTitular`): staff→`/app/`, titular puro→`/socio/`, mixto usa AMBAS.

## INVARIANTES (no romper sin decisión explícita)

1. **La MASCOTA es el sujeto.** Carnet, cobertura, cuota y estado son **por mascota** (colección `mascotas/{id}`).
   El titular es la cuenta administrativa: paga la **Σ de las cuotas de sus mascotas activas**; no tiene plan propio.
2. **Cobertura vigente ⇔ `estado=='activo'` Y plan del catálogo** (`MC.coberturaMascota` / `planEnCatalogo`).
   'Sin definir' o un plan legacy fuera de catálogo → NO hay cobertura (no factura).
3. **Núcleo = fuente única.** `PRECIOS`, cobertura, `cuotaTitular`, `planPorEdadAprox`, etc. viven en
   `lib/medipaw-core.js`. **Las reglas REPLICAN** la lógica de plan/precio del alta (`planEsperadoR`/`precioDeR`) con
   los MISMOS strings y valores. Si cambiás `PRECIOS` o el mapeo edad→plan, **cambialo en el núcleo Y en las reglas**.
   Strings exactos (con tilde): `MEDIPaw Urgencias` 23988 · `MEDIPaw Básico` 40000 · `MEDIPaw Joven` 58788 ·
   `MEDIPaw Adulto` 54388 · `MEDIPaw Senior` 70788.
4. **Alta = embudo; el SISTEMA fija plan/cuota por especie + `edadAprox`.** El titular NO los elige. La regla
   `mascotas` create revalida `plan==planEsperadoR` y `cuota==precioDeR`. Especies: perro/gato/ave/otros. Buckets:
   cachorro/joven/adulto/mayor (cachorro→Joven, joven+adulto→Adulto, mayor→Senior; ave/otros→Básico). La mascota
   del titular nace **activa**; la fecha exacta es OPCIONAL (solo refina el recálculo, no decide el plan).
   ⚠️ RIESGO ACEPTADO: la edad la declara el titular (puede sub-declarar); lo audita el admin.
5. **Asimetría N3 (INVIOLABLE).** Lo clínico interno (prioridad, notas del vet) vive en `casos_clinico` = **solo
   staff**. El titular NUNCA lo lee. Split de colecciones: `casos` (titular-safe) + `casos_clinico` (staff). Al
   titular se le habla de cuidado y acción, jamás de clasificación.
6. **Contable = snapshot.** `comprobantes` congelan `items[]`/`total` al emitir; **nunca** recalculan contra el
   estado vivo. **Mes completo, SIN prorrateo** (los cambios rigen el próximo período). No hay pasarela: el titular
   ve qué debe, no paga en la app. Comprobantes INTERNOS (no fiscales).
7. **Seguridad de escalada.** El DUEÑO no puede escribir `roles[]`/`rol`/`estado` en su `usuarios/{uid}` (whitelist
   `hasOnly`). Grants de rol = SOLO admin o `seed/agregar-rol.js`. `getUserRoles` es robusto (`exists`+default `[]`).
8. **`mascotas_publicas` write = SOLO admin.** La ficha pública `/m/{token}` nace desde el panel (`generarFichaPublica`);
   sin Cloud Functions no nace sola. `token` crypto (`getRandomValues`), la **colección** es la fuente. `syncMascotaPublica`
   tiene **check de colisión** (aborta si el token ya es de otro mascotaId).
9. **Reads/writes acotados** (parche de seguridad 2026-07-24): `solicitudes` read=admin; `atenciones` create exige
   `titularUid`; `pesos` create = titular-dueño o vet/admin; `mascotas` update titular = solo `nombre`/`foto`.
10. **Expand/contract.** `usuarios.mascotas[]` embebido es un **espejo transitorio** (para que el admin identifique
    afiliados); la **colección `mascotas` es la fuente**. Retirar el embebido en un tramo de limpieza.
11. **Serie de peso.** El peso NO es un campo que se pisa: colección raíz `pesos` (puntos `{mascotaId, titularUid,
    peso, fecha, origen}`). El primer punto se crea en el alta.

## 🚦 GATE DE DEPLOY (regla dura)
- **Si el tramo TOCA REGLAS nuevas:** **reglas publicadas y CONFIRMADAS por Lucas → recién ahí el código.** NO
  deployar código antes del "reglas publicadas" explícito. Publicar es paso manual de Lucas en la consola. Ya tumbó
  producción por deployar código contra reglas viejas. Orden: aviso previo con el `firestore.rules` COMPLETO →
  esperar "reglas publicadas" → **verificar que se publicó de verdad** → commit+push+curl. Si el tramo NO toca reglas,
  el deploy va directo con aviso previo.
- **Publicado ≠ verificado (eslabón obligatorio entre publicación y código).** Después del "reglas publicadas" de
  Lucas y ANTES de deployar código, correr **`node seed/gate-b-verif.js escalada`** y **exigir 403** (la escalada de
  privilegios rechazada = prueba de que el ruleset nuevo está corriendo, no el viejo). Sin ese verde **no se deploya**.
  Sumar los modos que pruebe el parche (`embudo`, `alta-token`, N3, etc.) según el tramo. Es el control de que "lo
  publicado" y "lo que corre" son lo mismo — complementa el PASO 0 del subagente `auditor-reglas`.
- **El PASO 0 solo cuenta si lo produjo el subagente `auditor-reglas`. Autor y auditor no pueden ser el mismo.** El
  diff repo↔publicado tiene que salir DENTRO de la corrida del subagente. Si lo resolvió el hilo principal (o
  cualquiera que no sea `auditor-reglas`) — p. ej. porque al subagente le denegaron la tool y lo hizo el orquestador —
  el veredicto es **NO VERIFICADO** y **NO habilita publicación**, aunque el diff haya dado idéntico. Un PASO 0 hecho
  por el propio autor del cambio no es control independiente: no vale. Si al subagente le falla el acceso, se
  arregla el acceso (permiso en `.claude/settings.json`) y se re-corre el subagente — no se suple a mano.
- **Antes de tocar Firestore** (migraciones/backfills): aviso previo + **dry-run** primero (mostrar), después `--write`.
- **Mecánica del deploy** (push+curl, NO scp): commit+push a `main` → deploy `/lib/` (si cambió) y curl-verificar que
  sirve JS → deploy `/socio/` (index + sw) → **backup** `/app/index.html.bak-<fecha>` → swap `/app/index.html` →
  curl-verificar markers. Cada deploy del `/socio/` = **bumpear `CACHE` en `sw.js`** (`medipaw-socio-vN`). El `lib`
  se cache-bustea con `?v=` (Cloudflare cachea `.js`).
- **Cloudflare/nginx:** `sw.js` y `manifest.json` del socio se sirven `no-store` (location en el server block de
  medipaw) para que el versionado del SW funcione sin purga. El HTML es DYNAMIC.
- **Verificación:** smokes en verde (`node seed/smoke-medipaw-core.js`) + `node --check` de los HTML + verificación
  en vivo. La UI en vivo se verifica por navegador; lo que necesita rol se prueba con **custom-token** (sin
  password) o **REST con token de rol puro** (ver `seed/gate-*-verif.js`). Limpiar la data de prueba después.

## Herramientas (`seed/`, Admin SDK, requieren `seed/serviceAccountKey.json` git-ignorado)
- `smoke-medipaw-core.js` — smokes del núcleo (gate).
- `migrar-mascotas.js`, `backfill-tokens.js` — migraciones idempotentes (dry-run default).
- `agregar-rol.js` — grant de rol (aditivo, idempotente, dry-run). ÚNICA vía legítima de dar admin/veterinario.
- `auditar-roles.js` — auditoría read-only de roles + write-trace en casos_clinico.
- `gate-b-verif.js` (modos: `escalada`, `embudo`, `alta-token`, `alta-cleanup`, N3), `gate-c-verif.js` — verificación
  de reglas por REST/custom-token (correr DESPUÉS de publicar el parche que prueban).

## Antes de publicar `firestore.rules`
Correr el checklist de seguridad con el subagente **`auditor-reglas`** (`.claude/agents/auditor-reglas.md`).
Docs de referencia: `docs/alta-inventario-escrituras.md`, `docs/alta-reglas-diff.md`. Vault: `04-PROYECTOS/MEDIPAW/`.
