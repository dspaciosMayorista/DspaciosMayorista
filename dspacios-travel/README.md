# D'spacios Travel — App Next.js

Sistema integral para la mayorista de turismo **D'spacios Travel**. Este README es el
**registro de estado** de la app: qué hay construido, cómo correrlo y qué falta. La fuente
de verdad del diseño global está en `../CLAUDE.md` y la plantilla del contrato en
`../ANEXO_plantilla_contrato.md`. Si retomas el proyecto, lee primero esto.

---

## ⚙️ Contexto de despliegue (YA configurado — NO volver a preguntar)

> Nota a mí mismo (IA): esto **ya está montado y funcionando en producción**. No
> le preguntes al dueño cómo configurar dominio, OAuth ni variables: ya está.

- **Producción:** Vercel, **Production Branch = `main`**. Push a `main` ⇒ deploy automático.
  Root Directory del proyecto en Vercel = `dspacios-travel`.
- **Dominio:** **`portal.dspaciostravel.com`** en línea (DNS en **Hostinger** → CNAME a
  Vercel). La **web y el correo** del cliente siguen en Hostinger (no se tocan). Su web
  está en `www.` / raíz; nosotros usamos el subdominio `portal.`.
- **Variables en Vercel (Production) — YA puestas:** `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. (`CRON_SECRET` opcional.)
- **Supabase:** **un solo proyecto, compartido** entre `main` y las ramas. Las
  **migraciones se aplican A MANO** en el **SQL Editor** (el dueño las corre cuando se le
  indica; no usamos `supabase db push`). Cada PR lista sus migraciones pendientes.
- **Google OAuth — YA configurado:** Supabase Auth → Google. **Site URL** =
  `https://portal.dspaciostravel.com`; **Redirect** incluye `…/auth/callback`. En Google
  Cloud el redirect autorizado es el **callback de Supabase** (`https://<ref>.supabase.co/auth/v1/callback`).
  ⚠️ **Clave:** el middleware `proxy.ts` deja **`/auth` pública** (si no, el login con Google rebota a `/login`).
- **Storage (se crea por migración, no a mano):** `crm` (público, imágenes/flyers),
  `contratos` (privado, adjuntos: cédulas/soportes), `empresa` (en la rama white-label).
- **Ramas:** se trabaja en **`claude/laughing-goodall-e59PS`** → PRs → `main`.
  **`white-label`** es una rama aparte (marca blanca con `empresa_config`, **congelada**).
- **Asesor interno = `usuarios` con rol `venta`** (NO el catálogo `asesores`, que quedó en
  desuso). La escala de comisión y `aplica_retencion` viven en `usuarios`.
- **Email (campañas CRM):** falta que el dueño ponga la **API key de Brevo/Resend** y
  remitente verificado en **CRM → Config email** y marque "Envío activo". El código ya soporta Brevo/Resend.
- **`QUICK_LOGIN_*`** (ingreso rápido por código, solo pruebas) existe gateado por env;
  en producción **no** debe estar definido.
- **Respaldos:** plan **gratis** (sin backups automáticos). Guía + script en
  `supabase/scripts/RESPALDO.md` (`pg_dump` + `respaldo-storage.mjs` → Drive). El `.mjs`
  se corre en la terminal con **Node**, **no** en el SQL Editor.

---

## Stack

- **Next.js 16.2.6** (App Router, React 19, TypeScript estricto, Turbopack).
- **Tailwind CSS v4** + **shadcn/ui** + `lucide-react`.
- **Supabase** (Postgres + Auth + Storage) vía `@supabase/ssr`.
- Gestor de paquetes: **pnpm**.
- Middleware con el nombre nuevo de Next 16: `proxy.ts` (no `middleware.ts`).

## Cómo correrlo

```bash
pnpm install
pnpm dev        # http://localhost:3000
pnpm build      # build de producción (corre TypeScript)
pnpm lint
```

### Variables de entorno (obligatorias)

Crear `.env.local` (está en `.gitignore`, no se commitea):

```
NEXT_PUBLIC_SUPABASE_URL=https://<tu-proyecto>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
```

Sin estas variables la app compila, pero las llamadas a Supabase fallan en runtime.

## Base de datos / Migraciones

Las migraciones versionadas viven en `supabase/migrations/` (son idempotentes y
re-ejecutables). Para aplicarlas hay dos caminos:

- **SQL Editor de Supabase:** pegar cada archivo en orden.
- **Supabase CLI:** `supabase db push` (requiere CLI + login + link al proyecto).

Orden y contenido:

| Archivo | Crea |
|---|---|
| `…0001_schema_base.sql` | `usuarios` (+ trigger `handle_new_user`), `asesores`, `proveedores`, `aliados`, `parametros_tributarios`, enum `rol_usuario` |
| `…0002_schema_gestion.sql` | `ventas`, `abonos`, `cuentas_por_pagar`, `aliados_b2b`, `liquidacion_comisiones`, `facturacion`, `rentabilidad` |
| `…0003_schema_vuelos.sql` | `bloqueos_vuelo`, `sillas`, `movimientos_silla`, vista `cupos_por_bloqueo`, enum `estado_silla` |
| `…0004_schema_tarifario.sql` | `destinos`, `hoteles`, `habitaciones`, `planes_alimentacion`, `temporadas`, `temporada_fechas`, `tarifas`, `tarifa_precios`, `itinerarios`, `inclusiones`, enums `acomodacion_tipo` y `temporada_tipo` |
| `…0005_rls_policies.sql` | RLS + políticas por rol en las 24 tablas + helper `mi_rol()` |
| `…0006_seed_parametros.sql` | Seed de parámetros tributarios y planes de alimentación |
| `…0007_superadmin_first_user.sql` | El primer usuario registrado se vuelve `superadmin` |
| `…0008_tarifario_producto.sql` | Añade `costo_base`, `pct_mk` a `tarifas` + parámetro `COMISION_AGENCIA` (0.12) |
| `…0009_tarifas_unique.sql` | **Índice único** `(hotel_id, plan_id, temporada_id, noches)` en `tarifas` — necesario para el upsert de `guardarTarifa` |
| `…0010_contratos.sql` | Numeración `00-NNNN` (`siguiente_numero_contrato`), campos de contrato en `ventas`, tablas `contrato_pasajeros/_hoteles/_vuelos/_items` + RLS |
| `…0011_share_token.sql` | `share_token` (uuid único) en `ventas` para el enlace público del contrato |
| `…0012_seed_bloqueos_cartagena.sql` | **Seed** opcional: 15 records JETSMART Cartagena + sus sillas |
| `…0013_paquetes.sql` | Módulo de Producto: `paquetes`, `paquete_hoteles`, `paquete_precios`, `paquete_costos` (costos con RLS interno) + enum `paquete_categoria` |

> Además de las dos variables `NEXT_PUBLIC_SUPABASE_*`, para el enlace público del
> contrato y para que los contratos de bloqueo/porción terrestre copien costos y
> descuenten cupos, configura en el servidor (Vercel) **`SUPABASE_SERVICE_ROLE_KEY`**
> (la llave secreta `service_role`; nunca con prefijo `NEXT_PUBLIC_`).

> El `project_id` en `supabase/config.toml` es público (no es secreto). **Rotar las llaves**
> que estuvieron en el `.env` compartido (ver `CLAUDE.md` §12).

## Estado actual (resumen)

App en **producción** (`main`) sobre el subdominio del cliente (Vercel + Supabase).
Flujo de negocio implementado de punta a punta:

**PRODUCTO** (costos netos) → **PAQUETES** (margen) → **TARIFARIO** (interno + público) →
**RESERVAR / NUEVO CONTRATO** (genera venta + PDF) → **GESTIÓN** (cartera, costos,
proveedores, comisiones, facturación, rentabilidad) → **LIQUIDACIÓN** mensual de comisiones.

### Módulos
- **Producto:** Destinos, Proveedores, Configuración (categorías/regímenes), **Hoteles**
  (temporadas, tarifa neta por categoría/régimen/temporada con niño 1/2, config de
  acomodaciones, contacto comercial), **Servicios** (por persona y/o por grupo con rangos
  de pax, categoría tour/asistencia/otro), **Programas** (circuitos USD).
- **Tarifa por fórmula (calculadora):** hoteles especiales que mandan su propia estructura
  (ej. HOTEL DUBAI: base por persona + modificadores + suplementos de régimen). Marco
  extensible en `lib/calc/calculadoras.ts`; **genera** las filas normales de `tarifa_hotel`.
- **Promociones + prioridad + vigencia de compra:** las temporadas pueden cruzarse; gana la
  de mayor `prioridad`. Promo = descuento %, descuento $/pax o tarifa de reemplazo. Toda
  vigencia tiene ventana de compra (si HOY está fuera, no aplica). Motor en `lib/calc/paquetes.ts`.
- **Carga masiva (CSV)** con notas de requisitos previos en: proveedores, hoteles,
  acomodaciones, temporadas (con prioridad/vigencia), tarifas, servicios, bloqueos.
- **Reservar / Nuevo contrato:** asesor interno (usuarios rol venta) + tipo de venta
  B2C/agencia/freelance (dropdowns del catálogo). **BNC** elegible en el contrato
  (tiquetes o fijo ≥ tiquetes). Comisión B2B **automática** con el % del aliado o el default.
- **Gestión del contrato:** Cartera (abonos), Costos, Proveedores (CxP), Comisiones B2B,
  Facturación, Flujo de caja. **Rentabilidad** estructurada (`/dashboard/rentabilidad`).
- **Comisiones internas por ESCALAS:** escalas por rango de PVP (Configuración), asignadas a
  cada **usuario de venta**; **liquidación mensual acumulada** (`/dashboard/liquidacion`):
  Σ PVP del mes → rango → % sobre la base comisionable (PVP − BNC). Motor en `lib/calc/escalas.ts`.
- **Agencias y freelance** (`/dashboard/aliados`): catálogo con % de comisión propio y
  retención por entidad; defaults `COMISION_AGENCIA`/`COMISION_FREELANCE` en Configuración.
- **Vuelos:** dashboard de control de bloqueos/sillas (estados, cambios, plazos).
- **Cartera / Pagos a proveedores:** listados contables.
- **Marca / branding** aplicado (logo, degradado, íconos PWA).

## Migraciones

Viven en `supabase/migrations/` (idempotentes). **Correr en orden `0001 → 0046`** en el
**SQL Editor** de Supabase (a mano). La lista detallada está en `../CLAUDE.md` (§13). Hitos:

| Rango | Contenido |
|---|---|
| 016–031 | Producto, config de hoteles, armado de paquetes, dos niños, rangos de edad, reservar por habitaciones, formas de pago, programas |
| 032–034 | BNC en ventas, ítems de factura, pago de comisión B2B |
| 035 | (rama `white-label`) `empresa_config` para marca blanca |
| 036 | Contacto comercial del hotel (`contacto_telefono`, `email_comercial`) |
| 037 | `hotel_calculadora` (tarifa por fórmula, ej. HOTEL DUBAI) |
| 038 | Prioridad + vigencia de compra + promociones en `hotel_temporadas` |
| 039 | `escalas_comision` + `escala_rangos` (+ `asesores.escala_id`) |
| 040 | `aliados.tipo/pct_comision`, `asesores.aplica_retencion`, default `COMISION_FREELANCE` |
| 041 | `usuarios.escala_id` + `usuarios.aplica_retencion` (asesor interno = usuario rol venta) |
| 042 | `crm_contactos` (CRM, categorías + consentimiento Habeas Data) |
| 043 | `crm_email_config` (proveedor/remitente/API key) |
| 044 | `crm_campanas` (registro de envíos) |
| 045 | Bucket Storage `crm` (imágenes/flyers) |
| 046 | Bucket privado `contratos` + `contrato_adjuntos` (cédulas/soportes) |

> Env en Vercel (ya puestas): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
> `SUPABASE_SERVICE_ROLE_KEY` (sillas/costos/liquidación/storage), opcional `CRON_SECRET`.

## CRM (app aparte, mismo código)

Vive en el grupo de rutas **`app/(crm)/`** con **layout propio** (sin sidebar del portal,
fondo de marca, botón **PORTAL** → `/dashboard`). URL **`/crm`**. Para "sacarlo" a
`crm.dspaciostravel.com` solo falta DNS (CNAME `crm` → Vercel) + un rewrite a `/crm` — el
código ya está aislado, no hay que reconstruir. Incluye: contactos por categoría + carga
masiva (Habeas Data), **cruce con ventas** (ficha con historial de compras), **campañas**
amigables (tipo libre, **imagen/flyer**, mensaje normal sin HTML, **vista previa real**),
**cumpleaños**, **cargue B2B** (crea aliado + contacto + acceso al portal) y **Config email**.

## Adjuntos por contrato

Sección **Adjuntos** en `/dashboard/contratos/[numero]`: subir cédula / soporte de pago /
soporte de abono (PDF o imagen, máx 10 MB) al bucket **privado** `contratos/<número>/…`,
descargar con **URL firmada** y eliminar. Tabla `contrato_adjuntos`.

## Pendientes / próximos pasos

- **Exponer el CRM en `crm.dspaciostravel.com`**: DNS (CNAME `crm` → Vercel) + rewrite a
  `/crm`. El módulo ya está listo; es solo enrutamiento.
- **Email real:** el dueño debe cargar API key (Brevo/Resend) + remitente en *CRM → Config
  email*. Opcional: **cron diario** para felicitaciones de cumpleaños automáticas.
- **Importar el histórico de adjuntos** desde la carpeta de Drive del dueño (~500 contratos)
  → subirla a Supabase enlazada por `numero_contrato`. Ojo límite **1 GB** del plan gratis.
- **Marca blanca** (rama `white-label`): `empresa_config` editable; afinar y mergear.
- **Otras calculadoras de hotel** (4–5 hoteles con estructuras propias) sobre el marco actual.
- **Tarifario público en vivo** para promos/vigencia de compra (hoy el publicado es una foto;
  Reservar sí re-liquida en vivo).
- Afinar costos netos de proveedores/servicios (`costo_receptivo`/`otros_costos`) y el
  detalle tributario de programas (hoy en COP).
- **Editar reserva pendiente "completa"** (mismo número) sin anular.
- (Limpieza) El catálogo **`asesores`** quedó en desuso (los asesores internos son
  `usuarios` rol venta); su UI ya se quitó de Configuración. Se puede eliminar a futuro.

> El detalle vivo del estado y las decisiones está en `../CLAUDE.md` §13.
