# Arquitectura SaaS Multi-Tenant — D'spacios Travel → plataforma para muchas agencias

> **Objetivo:** convertir el sistema (hoy de una sola agencia) en una **plataforma
> SaaS multi-tenant**: un solo despliegue y una sola base de datos que sirve a
> MUCHAS agencias (tenants/"organizaciones"), con aislamiento total de datos entre
> ellas, marca propia por agencia, onboarding self-service y planes/cobro.
>
> Este documento es el **plano**. NO se ha tocado código aún (salvo lo que se
> indique). La conversión se hace **por fases** porque toca casi todas las tablas.
> La rama vieja `white-label` (modelo "una copia por cliente") queda como
> referencia; su `empresa_config` se reaprovecha como **config por organización**.

---

## 0. Decisión tomada
**Modelo B — SaaS multi-tenant** (una sola app). Aislamiento **lógico** (misma base,
filtrado por `org_id` + RLS), no físico. Implicación: hay que tocar **todas** las
tablas de negocio y sus consultas. Por eso va por fases.

---

## 1. Concepto central: la "organización" (tenant)

- Nueva tabla **`organizaciones`** = cada agencia cliente del SaaS.
  ```
  organizaciones(
    id uuid pk default gen_random_uuid(),
    slug text unique,            -- subdominio: <slug>.tudominio.com
    nombre text not null,
    nit text, ciudad, pais, contacto, email, telefono,
    -- marca (reemplaza empresa_config):
    logo_url, logo_white_url, color_primario, color_acento,
    -- contrato/legal configurable:
    contrato_encabezado, contrato_pie, contrato_terminos,
    -- estado de la cuenta SaaS:
    plan text default 'trial',   -- trial|basico|pro|enterprise
    estado text default 'activa',-- activa|suspendida|cancelada
    trial_hasta date,
    created_at, updated_at
  )
  ```
- Cada **usuario pertenece a una organización**: `usuarios.org_id uuid → organizaciones(id)`.
  - Roles dentro de la org: los actuales (superadmin de la org, gerencia, …).
  - Nuevo rol de **plataforma** (tú, el dueño del SaaS): `plataforma_admin` — puede
    ver/administrar TODAS las orgs (panel de super-admin del SaaS). No vive en
    ninguna org o vive en una org "sistema".
- **Toda tabla de negocio gana una columna `org_id uuid not null`** (FK a organizaciones),
  con índice. Ejemplos: ventas, abonos, cuentas_por_pagar, sillas, bloqueos_vuelo,
  hoteles, destinos, tarifa_hotel, servicios_adicionales, paquetes, tarifario_resultado,
  programas (+ sus 9 tablas), cotizaciones, crm_contactos, web_paginas/secciones/config,
  parametros_tributarios, formas_pago, rangos_edad, asesores, proveedores, etc.

### ¿Qué es por-org y qué es global?
- **Por organización (la inmensa mayoría):** todo el producto, ventas, finanzas,
  vuelos, CRM, sitio web, config. Cada agencia tiene SUS destinos, hoteles, tarifas.
- **Global / plantilla (semilla al crear org):** `parametros_tributarios`,
  `rangos_edad`, `categorias_habitacion`, `planes_alimentacion`, `formas_pago` →
  se crean como **defaults colombianos** y se **copian a cada org nueva** (la org
  puede editarlos sin afectar a las demás). NO se comparten en vivo.
- **Catálogo IATA / aeropuertos** (lib/iata.ts) puede quedar global de solo lectura.

---

## 2. Resolución del tenant (cómo el sistema sabe a qué org pertenece la petición)

Recomendado: **subdominio por organización** → `agenciaX.tudominio.com`.
- `proxy.ts` (middleware) lee el `host`, extrae el `slug`, busca la org y:
  - inyecta el `org_id` en la request (header interno) o lo deja a la sesión.
- El **portal interno** y el **tarifario público** de cada agencia viven bajo su
  subdominio. El **sitio web/CMS** de cada agencia, igual (ya tenemos `NEXT_PUBLIC_SITIO_HOST`/
  `PORTAL_HOST` — se generaliza a "host → org").
- Alternativa más simple para arrancar: **path** (`/o/<slug>/...`) o el `org_id`
  derivado del usuario logueado (sin subdominio) — útil para el portal interno.
- **Fuente de verdad del tenant en el server:** `usuarios.org_id` del usuario
  autenticado. Para rutas públicas (tarifario/sitio sin login), el tenant sale del
  **host/subdominio**.

---

## 3. Seguridad: RLS por tenant (el corazón del aislamiento)

- Helper SQL: `mi_org()` = `select org_id from usuarios where id = auth.uid()`.
- **Cada policy** de cada tabla se reescribe a:
  ```sql
  using (org_id = public.mi_org())
  with check (org_id = public.mi_org())
  ```
  combinado con el rol cuando aplique (ej. escritura solo roles altos DE ESA org).
- Lectura pública (tarifario/sitio sin login): policy por `org_id` resuelto desde el
  host, no desde `mi_org()` → para esos casos se usa una función que recibe el slug,
  o el server (service-role) filtra por el org_id del host.
- El **plataforma_admin** tiene policies que le permiten ver todas las orgs (o se
  opera con service-role desde un panel aparte).
- ⚠️ Regla de oro: **ninguna query puede quedar sin filtro de org**. RLS es la red de
  seguridad; el código además debe setear `org_id` en cada insert.

---

## 4. Onboarding (alta de una agencia nueva, self-service)

Flujo "Crear cuenta de agencia":
1. Registro → crea `organizaciones` (slug, nombre, plan=trial, trial_hasta).
2. Crea el primer **usuario superadmin de esa org** (el dueño de la agencia).
3. **Semilla automática** de la org: copia parámetros tributarios, formas de pago,
   rangos de edad, categorías de habitación, regímenes (defaults colombianos), y
   crea la `web_config`/páginas base del sitio.
4. Asigna subdominio `slug.tudominio.com` (DNS wildcard `*.tudominio.com` → Vercel).
5. Redirige al wizard de marca (logo, colores, datos de empresa, contrato).

---

## 5. Marca y contrato por organización (reaprovecha white-label)
- La `empresa_config` de la rama vieja se **fusiona en `organizaciones`** (logo,
  colores, datos, plantilla de contrato). `lib/empresa.ts` pasa a `lib/org.ts` y lee
  la org actual. El componente `Logo` y `ContratoDocumento` leen de la org, no de
  constantes "D'spacios".
- Se eliminan las **~55 referencias hardcodeadas a "D'spacios"** (títulos, vouchers,
  emails, sitio/CMS, programas) → salen de la config de la org.
- Storage: prefijo por org (`<org_id>/...`) en el bucket, o bucket por org.

---

## 6. Planes y cobro (SaaS billing) — fase posterior
- Tabla `planes` (límites: nº usuarios, contratos/mes, módulos habilitados).
- `organizaciones.plan` + `estado`; middleware bloquea orgs `suspendida`/`cancelada`
  o vencidas de trial (pantalla de "reactiva tu plan").
- Integración pasarela (Stripe/Wompi/Mercado Pago) → webhooks que actualizan `estado`.
- Panel **plataforma_admin**: lista de orgs, su plan, uso, MRR, suspender/activar.

---

## 7. Migración de los datos actuales (D'spacios = primera org)
1. Crear la org #1 "D'spacios Travel" con su marca actual.
2. **Backfill**: `update <tabla> set org_id = '<org_dspacios>'` en TODAS las tablas
   (los datos existentes pasan a ser de esa org).
3. Poner `org_id NOT NULL` + default removido tras el backfill.
4. Verificar que todo sigue operando para D'spacios antes de abrir registro a terceros.

---

## 8. Plan por FASES (no es un solo PR)

**Fase 0 — Fundación (sin romper nada).**
- Migración: tabla `organizaciones`; `usuarios.org_id`; helper `mi_org()`; crear org #1
  (D'spacios) y asignarla a los usuarios actuales. `proxy.ts`: resolver org por host
  (con fallback a la org del usuario). Sin tocar todavía el resto de tablas.
- Entregable verificable: el sistema sigue igual, pero ya existe el concepto de org.

**Fase 1 — `org_id` + RLS en las tablas núcleo + backfill.**
- Agregar `org_id` a las tablas de negocio (en grupos: producto → tarifario → ventas/
  contratos → vuelos → finanzas → CRM → web). Backfill a org #1. Reescribir RLS por org.
- Ajustar TODOS los `insert` para setear `org_id` y las consultas públicas para filtrar
  por el org del host. (Es el grueso del trabajo; se hace por módulos, con pruebas.)

**Fase 2 — Marca por org + onboarding.**
- Fusionar `empresa_config`→`organizaciones`; des-hardcodear "D'spacios"; wizard de alta
  de agencia + semilla de defaults; DNS wildcard + resolución por subdominio.

**Fase 3 — Planes, límites y cobro.**
- `planes`, estados, panel plataforma_admin, pasarela de pago, gating por plan.

---

## 9. Riesgos / decisiones a cerrar contigo
- **Subdominio vs path** para identificar la agencia (recomiendo subdominio + DNS wildcard).
- **Aislamiento:** lógico (RLS, recomendado para SaaS) vs físico (1 base por cliente =
  el modelo viejo). Elegiste multi-tenant → lógico.
- **Catálogos compartidos** (tributarios, IATA): ¿globales con override por org, o
  copiados a cada org? (recomiendo copiados al crear la org).
- **Esfuerzo:** alto y transversal. Fase 0 es rápida; Fase 1 es la grande (toca casi
  todo). Conviene congelar features nuevas mientras se hace la Fase 1 para no perseguir
  un blanco móvil.

---

## 10. Recomendación de arranque
Empezar por **Fase 0** en una **rama nueva desde `main` actual** (no desde la vieja
`white-label`). Es de bajo riesgo (no cambia el comportamiento) y deja la base para
todo lo demás. Cuando Fase 0 esté validada, atacamos la Fase 1 por módulos.

*(Fin del plano. Actualizar conforme se ejecute cada fase.)*
