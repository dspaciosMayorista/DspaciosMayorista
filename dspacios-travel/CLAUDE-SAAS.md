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

- Las migraciones **001 → 113** son **heredadas de D'spacios** (el código base). Se
  corren igual en la base del SaaS. ⚠️ **OJO:** D'spacios siguió creando migraciones más
  allá de la 088; al sincronizar `main` se **renumeraron las del SaaS** para quedar
  **consecutivas DESPUÉS** de la última heredada (hoy la 113), conservando su orden.
- Las migraciones **114 → 118** son **EXCLUSIVAS del SaaS** (no existen en D'spacios). Van
  DESPUÉS de todas las heredadas, así el backfill de `org_id` alcanza también las tablas
  nuevas que trajo `main` (contabilidad, conciliaciones, punto_equilibrio, agencias, etc.).
  - **114** `saas_organizaciones` — Fase 0: tabla `organizaciones`, `usuarios.org_id`,
    helper `mi_org()`, RLS de `organizaciones`. *(antes 100)*
  - **115** `saas_org_id_backfill` — Fase 1/Paso 1: org #1 (D'spacios), asigna usuarios,
    agrega `org_id` (default temporal = org #1) + índice + backfill a TODAS las tablas
    de negocio (loop sobre `public`, menos `organizaciones`/`usuarios`/`auditoria`).
    *(antes 101 — al correr tras la 113 ahora abarca las tablas nuevas de D'spacios.)*
  - **116** `saas_org_default_mi_org` — Fase 1/Paso 2 (parcial): el DEFAULT de `org_id`
    pasa a `coalesce(mi_org(), org#1)` → los inserts CON SESIÓN reciben el org del
    usuario automáticamente. Los service-role/públicos caen a org #1 (puente). *(antes 102)*
  - **117** `saas_rls_org_isolation` — Fase 1/Paso 3a: policy RESTRICTIVE `org_isolation`
    (`org_id = mi_org() OR auth.uid() is null`) en toda tabla con RLS + `org_id`. Aísla
    a los usuarios logueados por su org; el anónimo queda exento (lo público se acota por
    el path en Paso 4). No cambia nada en mono-tenant. *(antes 103)*
  - **118** `saas_uniques_por_org` — Fase 2: convierte los UNIQUE globales de catálogos
    (`parametros_tributarios.parametro`, `destinos.nombre`, `planes_alimentacion.codigo`,
    `categorias_habitacion.nombre`, `formas_pago.nombre`) a UNIQUE por org `(org_id, col)`.
    ⚠️ **Correr antes de crear la 2ª org**. *(antes 104)*
- ⚠️ Antes de crear una nueva: `ls supabase/migrations/ | sort | tail` y tomar el
  **siguiente número libre** (la SaaS va por la **118**; la próxima es **119**). Si vuelves
  a sincronizar `main` y trajo heredadas más allá de la 118, **renumera otra vez** las del
  SaaS para que sigan consecutivas al final.
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
  - ✅ **Paso 4 (completo para superficies públicas):** mecanismo `/o/<slug>` (proxy
    reescribe → header `x-org-slug`; `orgPorSlug`/`orgDelRequest`; tipo `organizaciones`).
    Aislado por org: **tarifario** (`tarifario_resultado`, **programas**, detalle de
    programa por id, cupos/fotos/hoteles transitivos), **sitio web** (`app/sitio_web`:
    todos los getters de `lib/sitio` filtran `web_*` por org), **branding** (logo +
    colores de marca via CSS vars), **inserts públicos** con `org_id` del slug (registro
    B2B, contacto CRM y **cotización** del checkout). Sin slug = org default → mono-tenant
    igual. Branding de colores también en `app/sitio_web` ✅. ⏳ Pendiente menor: lecturas
    por id/token sueltas (vouchers/recibos) siguen por unicidad de id (no enumerable).
    **Falta VALIDAR corriendo con una 2ª org** — guía paso a paso en
    `docs/saas/validar-multitenant.md`.
- 🚧 **Fase 2 — Marca por org + onboarding.**
  - ✅ **Admin de organizaciones** (`/dashboard/organizaciones`, solo superadmin de la
    plataforma): listar/crear/editar tenants (slug, datos, **colores**, logos, plan,
    estado) por **service-role** (gateado; la RLS normal solo deja ver la propia org).
    Al crear puede crear el **primer superadmin** de la org (email + contraseña temporal),
    dejándola usable. Botón "Ver tarifario ↗" a `/o/<slug>/tarifario`. **Esto desbloquea
    crear la 2ª org para validar el Paso 4.**
  - ✅ **UNIQUE por org** (migr. 104) + **siembra de catálogos** al crear org: copia
    `parametros_tributarios` y `formas_pago` de la org default → la nueva nace usable
    (best-effort; requiere la migr. 104 corrida).
  - ⏳ FALTA: des-hardcodear "D'spacios" (~55 referencias) en contrato/PDF/emails →
    leer de `organizaciones`; wizard self-service; (luego) subdominios.
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
  header `x-org-slug`; `orgDelRequest()`; el tarifario público filtra por `org.id`.
- **Fase 1/Paso 4 (programas + branding + inserts)** — tarifario filtra **programas** por org;
  header usa el **logo del org**; registro B2B y contacto CRM del checkout estampan el `org_id`
  del slug.
- **Fase 1/Paso 4 (sitio + colores + cotización + detalle programa)** — `app/sitio_web`
  acotado por org (todos los getters de `lib/sitio`); branding de **colores** (CSS vars);
  `crearCotizacion` estampa el org del slug; `getProgramaDetalle` verifica que el programa
  sea de la org. **Paso 4 completo** para superficies públicas. Falta validar con 2ª org.
- **Sync `main` → saas-whitelabel** (sesión actual) — traídos de D'spacios: **multitenant
  mayorista/minorista** (columna `tenant` — concepto de D'spacios, distinto de `org_id`;
  en el SaaS es inerte/heredada), **Contabilidad** (facturación/DIAN, movimientos,
  conciliaciones, estados financieros, datos de agencia), **Punto de equilibrio**, **USD/TRM**
  (servicios en USD, reservar redondea a dólar, formato `USD $`), **Programas** (doc comercial,
  marca blanca, highlights/obs internas, **piezas subibles** flyer/historia/portada, fix
  columna fantasma), **destinos** (fusionar/eliminar duplicados) y **editar nombre/destino del
  hotel**. Conflictos (5) resueltos a favor del SaaS conservando los features. **Migraciones
  del SaaS renumeradas 100-104 → 114-118** (consecutivas tras la heredada 113). Build OK.
  > ⏳ **PENDIENTE (org_id de las tablas nuevas de D'spacios):** el backfill (migr. 115) ya
  > corre tras la 113, así que las tablas nuevas (contabilidad_*, conciliacion*, pe_*,
  > agencias, contrato_facturacion…) **reciben la columna `org_id`** y, con sesión, el default
  > `coalesce(mi_org(),org#1)` las estampa. **Falta revisar los inserts**: los de **service-role**
  > (p. ej. el **importador de histórico minorista**, que usa admin client) NO estampan `org_id`
  > explícito → caen a org #1 (ok en mono-tenant, NO en multi-org). Auditar cada feature nuevo
  > con §4 antes de habilitar multi-org. (El módulo minorista es específico de D'spacios; en el
  > SaaS probablemente se retire o se reinterprete como otra organización.)

---

## 7. Despliegue desde cero

Ver **`docs/saas/DESPLIEGUE-DESDE-CERO.md`** — guía paso a paso (Supabase nuevo,
migraciones en orden, buckets, OAuth, env vars, Vercel, crons, primera org + primer
superadmin). Mantenerla actualizada cada vez que se agregue una env var, un bucket o
un paso de configuración.

---

*Fin. Este documento manda en la rama `saas-whitelabel`. Mantenerlo al día.*
