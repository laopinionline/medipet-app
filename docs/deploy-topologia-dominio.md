# Topología de deploy de `medipaw.com.ar` — DOS repos, un dominio

**Auditoría:** 2026-07-26 · **Método:** crawl HTTP del árbol servido en `https://medipaw.com.ar` comparado contra
`git ls-files` de `medipet-app` y contra el HEAD de `laopinionline/medipet` (vía `gh api`). El `Last-Modified` de
nginx/Cloudflare da la fecha de subida.

## El dominio lo sirven DOS repos (no confundir)

| Path servido en prod        | Repo fuente                     | Archivo fuente              |
|-----------------------------|---------------------------------|-----------------------------|
| `/` (landing + alta cuenta) | **`laopinionline/medipet`**     | `index.html`                |
| `/m/{token}` (ficha pública)| **`laopinionline/medipet`**     | `m/index.html`              |
| `/app/` (portal staff)      | **`laopinionline/medipet-app`** | `index.html`                |
| `/socio/` (PWA titular)     | **`laopinionline/medipet-app`** | `socio/{index.html,sw.js,…}`|
| `/lib/medipaw-core.js`      | **`laopinionline/medipet-app`** | `lib/medipaw-core.js`       |

`medipet` = sitio público (landing + ficha). `medipet-app` (este repo) = portal + socio + núcleo. El
`index.html` de ESTE repo se sirve en **`/app/`**, NO en `/`.

## Verificación repo↔prod (sin drift al 2026-07-26)

- **`/` == `medipet` HEAD `index.html`** → **idéntico** (69 743 b). `Last-Modified: 2026-06-06 12:08:02`;
  `medipet` `pushedAt: 2026-06-06T12:07:54Z` (8 s de diferencia → mismo release).
- **`/m/{token}` == `medipet` HEAD `m/index.html`** → **idéntico** (16 056 b). `Last-Modified: 2026-06-05`.

Conclusión: **nada que recuperar a `medipet-app`.** Ambas páginas públicas ya están versionadas en `medipet` y prod
coincide con su HEAD. Lo que faltaba era ESTE mapa. Un intento previo de copiar `/m/index.html` a `medipet-app` se
revirtió por ser un duplicado (habría creado una segunda fuente de verdad).

## Rutas que NO son archivos (fallback SPA)

`/manifest.json`, `/robots.txt`, `/favicon.ico`, `/admin/`, `/panel/`, `/app/sw.js`, `/app/manifest.json`,
`/app/index.html.bak`, `/sw.js` → devuelven los mismos 69 743 b de la landing = fallback nginx (`try_files …
/index.html` de la raíz). No son artefactos. El `.bak` del panel **no está expuesto** (cae al fallback).

## Implicancia para el `auditor-reglas` (PASO 0)

Las reglas Firestore son del proyecto `medipet-c3a4d` y aplican a AMBOS repos. Pero el PASO 0 ("el repo es lo que
corre") de las **páginas públicas** (`/`, `/m/`) se verifica contra **`laopinionline/medipet`**, no contra este
repo. Auditar solo `medipet-app` deja fuera la landing y la ficha pública. Si aparece drift en `/` o `/m/`, se
reconcilia en `medipet` (no acá).

## Revisión de seguridad de la ficha pública `/m/{token}` (código de `medipet`)

Sin auth, lee `mascotas_publicas/{token}` y renderiza `plan/foto/nombre/raza/titularNombre/nroSocio/estado/
servicios[]/fechaNacimiento/mascotaId`. Escribe en `solicitudes` (embudo "Me interesa"). `noindex,nofollow`.
- **N3: ✅ no filtra clínico** — cero `prioridad`/`notasVet`/`diagnostico`/`tratamiento`/`casos`/clasificación; el
  doc `mascotas_publicas` tampoco los contiene.
- No-N3 (para `medipet`): PII pública tras el token (`titularNombre`/`nroSocio`/`mascotaId`/`fechaNacimiento` — por
  diseño, invariante 8, token crypto + `noindex`).
- **XSS almacenado (CORREGIDO en `medipet` el 2026-07-26).** La versión original interpolaba `nombre`/`raza`/`foto`/
  etc. en `innerHTML`. **La superficie NO estaba acotada por la regla** `mascotas_publicas` write=admin: el
  contenido lo ORIGINA el titular — `nombre` y `foto` están en el whitelist de `update` de `mascotas`
  (`hasOnly(['nombre','foto'])`) y `syncMascotaPublica` (admin) solo los COPIA al sincronizar, sin sanear. Un
  titular podía guardar `<img src=x onerror=...>` como nombre y ejecutarlo en la página pública sin auth de
  cualquiera que abriera su `/m/{token}`. **Fix:** `renderFicha` reconstruida con `textContent` (helper `mk`) para
  todo campo de origen mascota/titular; `foto` por `img.src` (property, sin breakout); botón "Me interesa" por
  `addEventListener` en vez de `onclick` interpolado. Está en `medipet` `m/index.html`.
La **landing** (`/`) es marketing + alta de cuenta (`createUserWithEmailAndPassword` → `usuarios`); toca solo
`usuarios`, no lee `mascotas`/`casos`/`atenciones`.
