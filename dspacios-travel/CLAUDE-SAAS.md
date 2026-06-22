# CLAUDE-SAAS.md — Edición SaaS White-Label (multi-tenant)

> **Este documento es el CEREBRO de ESTE producto.** Léelo completo antes de tocar
> código en la rama `saas-whitelabel`. Si algo cambia, actualízalo: es la fuente de
> verdad de la edición SaaS. (El `CLAUDE.md` de la raíz es el de D'spacios Travel —
> ese NO manda aquí salvo para entender el código heredado.)

---

## 0. Regla de oro — SEPARACIÓN TOTAL de D'spacios

- Esta rama (`saas-whitelabel`) es un **PRODUCTO INDEPENDIENTE**: la versión genérica,
  multi-tenant y revendible del sistema.
- **NUNCA se mergea a `main`.** El flujo es de **una sola dirección**:
  `main (D'spacios) → saas-whitelabel` (para traer mejoras del código base). **Jamás**
  `saas-whitelabel → main`.
- Se va a **extraer a su propio repositorio** y se despliega en **otra cuenta**
  (su propio Supabase + su propio Vercel). No comparte base de datos ni dominio con
  D'spacios.
- Cualquier dato/branding "D'spacios" que quede en el código es **temporal** (la org #1
  de prueba) y debe terminar saliendo de la configuración de cada organización.

### Cómo sincronizar mejoras de `main` (cuando haga falta)
```
git checkout saas-whitelabel
git merge origin/main      # SOLO esta dirección. Resolver conflictos a favor del SaaS.
npm run build              # verificar
```
Tras sincronizar, revisar que las tablas/inserts nuevos de `main` reciban el trato
multi-tenant (org_id) — ver §4.

### Cómo extraerla a su propio repo (cuando esté lista)
1. `git checkout saas-whitelabel`
2. Crear repo nuevo vacío en GitHub (cuenta del SaaS).
3. `git remote add saas <url-del-repo-nuevo>` y `git push saas saas-whitelabel:main`.
   (O `git subtree split`/`filter-repo` si se quiere solo la carpeta `dspacios-travel/`.)
4. En el repo nuevo, renombrar `CLAUDE-SAAS.md` → `CLAUDE.md` y borrar referencias a la
   estructura del monorepo de D'spacios.
5. Despliegue desde cero: seguir **`docs/saas/DESPLIEGUE-DESDE-CERO.md`** al pie de la letra.

---

## 1. Qué es

Una sola aplicación (Next.js 16 + Supabase) que sirve a **muchas agencias de viajes**
(tenants = "**organizaciones**") con:
- **Aislamiento de datos por `org_id` + RLS** (mismo Postgres, separación lógica).
- **Marca propia por agencia** (logo, colores, datos, plantilla de contrato).
- **Onboarding self-service** y **planes/cobro** (fases posteriores).

El **plano arquitectónico completo** está en `docs/saas/arquitectura-multitenant.md`
(léelo: explica tenant, RLS, resolución por tenant, onboarding, billing, riesgos).

---

## 2. Decisiones cerradas (no re-litigar sin avisar al dueño)

| Tema | Decisión |
|---|---|
| Modelo | **SaaS multi-tenant** (una sola app), aislamiento **lógico** (org_id + RLS). |
| Identificación del tenant | **Path `/o/<slug>/...`** para lo público; el tenant interno sale del **usuario logueado** (`usuarios.org_id`). El **subdominio** (`slug.dominio.com`) se añade después sin rehacer. |
| Catálogos base (tributarios, edades, regímenes, formas de pago, categorías) | **Copiados por organización** (defaults colombianos sembrados al crear cada org; cada agencia los edita sin afectar a las demás). |
| Marca | Sale de `organizaciones` (no de constantes "D'spacios"). |

---

## 3. Migraciones — convención CRÍTICA

- Las migraciones **001 → 088** son **heredadas de D'spacios** (el código base). Se
  corren igual en la base del SaaS.
- Las migraciones **100+** son **EXCLUSIVAS del SaaS** (no existen en D'spacios). Se
  numeran a partir de 100 para no chocar con D'spacios.
  - **100** `saas_organizaciones` — Fase 0: tabla `organizaciones`, `usuarios.org_id`,
    helper `mi_org()`, RLS de `organizaciones`.
  - **101** `saas_org_id_backfill` — Fase 1/Paso 1: org #1 (D'spacios), asigna usuarios,
    agrega `org_id` (default temporal = org #1) + índice + backfill a TODAS las tablas
    de negocio (loop sobre `public`, menos `organizaciones`/`usuarios`/`auditoria`).
  - **102** `saas_org_default_mi_org` — Fase 1/Paso 2 (parcial): el DEFAULT de `org_id`
    pasa a `coalesce(mi_org(), org#1)` → los inserts CON SESIÓN reciben el org del
    usuario automáticamente. Los service-role/públicos caen a org #1 (puente).
  - **103** `saas_rls_org_isolation` — Fase 1/Paso 3a: policy RESTRICTIVE `org_isolation`
    (`org_id = mi_org() OR auth.uid() is null`) en toda tabla con RLS + `org_id`. Aísla
    a los usuarios logueados por su org; el anónimo queda exento (lo público se acota por
    el path en Paso 4). No cambia nada en mono-tenant.
- ⚠️ Antes de crear una nueva: `ls supabase/migrations/ | sort | tail` y tomar el
  **siguiente número libre** (la SaaS va por la **103**; la próxima es **104**).
- Idempotentes (`add column if not exists`, `on conflict do nothing`). No editar una ya
  creada: crear la siguiente.

---

## 4. Convenciones multi-tenant (NO romper el aislamiento)

- **Toda tabla de negocio lleva `org_id uuid` → `organizaciones(id)`** (+ índice).
- Helper SQL **`mi_org()`** = `select org_id from usuarios where id = auth.uid()`.
- **Cada insert** debe quedar con el `org_id` correcto:
  - Inserts con **sesión de usuario** (anon key + JWT): el `org_id` puede salir del
    default `mi_org()` o setearse explícito desde `lib/org.ts`.
  - Inserts con **service-role** (sillas/costos al reservar, CxP, crons): `mi_org()` =
    null → **hay que pasar `org_id` explícito** (resolverlo del contexto: la venta, el
    usuario que inició, o el slug del path).
- **RLS por org** en cada tabla: `using (org_id = mi_org()) with check (org_id = mi_org())`,
  combinado con el rol cuando aplique. **Las tablas con lectura pública** (tarifario_resultado,
  web_*, hoteles, destinos, programas, servicios…) resuelven el org desde el **path
  `/o/<slug>`** (no desde `mi_org()`, porque el visitante anónimo no tiene sesión).
- ⚠️ **Ninguna query sin filtro de org.** RLS es la red de seguridad; el código además
  setea/filtra por org.
- Storage: prefijo por org (`<org_id>/...`) dentro de cada bucket (pendiente de aplicar).

---

## 5. Estado por FASES (registro vivo — actualizar al avanzar)

- ✅ **Fase 0 — Fundación** (migr. 100). `organizaciones` + `usuarios.org_id` + `mi_org()`.
- 🚧 **Fase 1 — `org_id` en todo + RLS por org** (EN CURSO, el grueso, por pasos):
  - ✅ **Paso 1** (migr. 101): org #1, backfill de `org_id` a todas las tablas (default
    temporal = org #1). No cambia el comportamiento (sigue mono-tenant).
  - ✅ **Paso 2 (inserts org-aware):** los inserts CON SESIÓN reciben `org_id` por el
    default `coalesce(mi_org(), org#1)` (migr. 102). Los inserts **service-role** ya
    estampan `org_id` con `orgActual()` (helper `lib/org.ts`), de forma segura (solo si
    hay sesión; público/anónimo cae al default). Cubiertos: usuarios (nuevo→org del
    admin), reservar (CxP×3 + cotización), cotización manual (CxP), checkout
    (crm_contactos), crm/b2b (aliado nuevo→org del admin). contratos = solo updates.
    registro B2B = público (su org saldrá del path en Paso 4). Tipos: `org_id` agregado
    a usuarios, cuentas_por_pagar, cotizaciones, crm_contactos.
    **Falta del Paso 2:** quitar el default temporal y poner `org_id NOT NULL` (después
    del Paso 4, cuando las rutas públicas resuelvan el org).
  - ✅ **Paso 3a (aislamiento RLS):** policy RESTRICTIVE `org_isolation` (migr. 103) en
    todas las tablas con RLS + `org_id`. Usuario logueado → solo su org; anónimo exento;
    service-role bypasea. Excluye `usuarios`/`organizaciones`/`auditoria`.
  - ⏳ **Paso 3b:** scope por org de las lecturas PÚBLICAS (tarifario/sitio) — depende del
    Paso 4; + RLS de `usuarios` por org + `org_id NOT NULL` (quitar default).
  - 🚧 **Paso 4 (en curso):** ✅ mecanismo — `proxy.ts` reescribe `/o/<slug>/...` → `/...`
    con header `x-org-slug` (sin duplicar rutas); `lib/org.ts: orgPorSlug(slug)` +
    `orgDelRequest()` (org del header o la default `dspacios`); tipo `organizaciones`.
    ✅ tarifario público filtra `tarifario_resultado` por `org.id` (sin slug → org default,
    mono-tenant sigue igual). ⏳ FALTA (mismo patrón `orgDelRequest()` + `.eq("org_id")`):
    resto de consultas públicas del tarifario (programas, cupos, fotos), `app/sitio_web`,
    inserts públicos (registro B2B, checkout) con el `org_id` del slug, y branding por org.
    Validar corriendo con una 2ª org.
- ⏳ **Fase 2 — Marca por org + onboarding self-service.** Fusionar marca en
  `organizaciones`, des-hardcodear "D'spacios" (~55 referencias), wizard de alta de
  agencia + semilla de catálogos, (luego) subdominios.
- ⏳ **Fase 3 — Planes, límites y cobro.** Tabla `planes`, estados `suspendida/cancelada`,
  rol `plataforma_admin` + panel de administración del SaaS, pasarela (Stripe/Wompi/MP).

---

## 6. Registro de avances (changelog)

> Anotar aquí cada sesión de trabajo (qué se hizo, migración, archivos clave).

- **Fase 0** — migr. 100. Fundación multi-tenant.
- **Fase 1/Paso 1** — migr. 101. Org #1 + `org_id` + backfill en todas las tablas.
  Rama sincronizada con `main` (trae auditoría, recargo de servicios, CMS in-situ,
  imagen OG, etc.) antes de empezar.
- **Fase 1/Paso 2** — migr. 102 (default `org_id` = `coalesce(mi_org(), org#1)`) +
  `lib/org.ts`. Inserts con sesión org-scoped por default; inserts service-role estampan
  `org_id` con `orgActual()` en los 7 archivos. Docs creados: `CLAUDE-SAAS.md`,
  `docs/saas/DESPLIEGUE-DESDE-CERO.md`.
- **Fase 1/Paso 3a** — migr. 103. Policy RESTRICTIVE `org_isolation` (aísla a usuarios
  logueados por org; anónimo y service-role exentos). Sin cambio en mono-tenant.
- **Fase 1/Paso 4 (base)** — `lib/org.ts: orgPorSlug()` + tipo `organizaciones`. Resuelve
  el tenant por el slug del path para lo público.
- **Fase 1/Paso 4 (mecanismo + tarifario)** — `proxy.ts` reescribe `/o/<slug>/...` con
  header `x-org-slug`; `orgDelRequest()`; el tarifario público filtra por `org.id`. Falta
  rescopear el resto de superficies públicas (sitio, programas, checkout/registro) y branding.

---

## 7. Despliegue desde cero

Ver **`docs/saas/DESPLIEGUE-DESDE-CERO.md`** — guía paso a paso (Supabase nuevo,
migraciones en orden, buckets, OAuth, env vars, Vercel, crons, primera org + primer
superadmin). Mantenerla actualizada cada vez que se agregue una env var, un bucket o
un paso de configuración.

---

*Fin. Este documento manda en la rama `saas-whitelabel`. Mantenerlo al día.*
