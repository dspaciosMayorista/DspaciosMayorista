# D'spacios Travel — App Next.js

Sistema integral para la mayorista de turismo **D'spacios Travel**. Este README es el
**registro de estado** de la app: qué hay construido, cómo correrlo y qué falta. La fuente
de verdad del diseño global está en `../CLAUDE.md` y la plantilla del contrato en
`../ANEXO_plantilla_contrato.md`. Si retomas el proyecto, lee primero esto.

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
| `…0009_tarifas_unique.sql` | **Índice único** `(hotel_id, plan_id, temporada_id, noches)` en `tarifas` — necesario para el upsert de `guardarTarifa` (ver changelog) |

> El `project_id` en `supabase/config.toml` es público (no es secreto). **Rotar las llaves**
> que estuvieron en el `.env` compartido (ver `CLAUDE.md` §12).

## Estado por fases

- **Fase 0 — Cimientos:** ✅ completa. Login por roles, protección de rutas (`proxy.ts`),
  layout del dashboard, tokens de marca, tipos TS del esquema, las 9 migraciones, RLS.
- **Fase 1 — Tarifario:** ✅ funcional.
  - Admin en `/dashboard/tarifario`: CRUD de destinos, hoteles, temporadas + fechas,
    inclusiones, y **Módulo de Producto** (costos → % margen → PVP por acomodación con
    cálculo de tarifa neta de agencia).
  - Público en `/tarifario`: SSR, muestra tarifa neta a agencias con sesión.
  - Lógica de cálculo pura y testeable en `lib/calc/tarifario.ts`.
- **Fase 2 — Generador de contratos:** ⛔ pendiente (siguiente).
- **Fases 3–5** (operaciones de vuelos, finanzas, portal): ⛔ pendientes. El modelo de
  datos ya existe; faltan las pantallas.

## Rutas

| Ruta | Acceso | Estado |
|---|---|---|
| `/` | redirige a `/tarifario` | ✅ |
| `/tarifario` | público (tarifa neta si hay sesión) | ✅ |
| `/login` | público | ✅ |
| `/dashboard` | con sesión | ✅ |
| `/dashboard/tarifario` y `/dashboard/tarifario/[id]` | con sesión | ✅ |
| `/contratos`, `/ventas`, `/vuelos`, `/finanzas` | enlazados en el sidebar | ⛔ aún no existen (404) |

## Pendientes conocidos

- Crear las rutas de los módulos enlazados en el sidebar (Fases 2–5).
- La fuente **Jost** se carga pero no se aplica: `@theme` en `styles/globals.css` define
  `--font-sans` como `var(--font-jost, …)` y `--font-jost` nunca se define, así que cae al
  fallback. Cosmético; arreglar al pulir UI.
- Verificar contra la base real que las migraciones (incluida la 009) quedaron aplicadas.

## Changelog de mantenimiento

- **2026-06-02**
  - 🔴 **Fix:** `guardarTarifa` (`app/(dashboard)/dashboard/tarifario/actions.ts`) hacía
    `upsert` con `onConflict: "hotel_id,plan_id,temporada_id,noches"` pero no existía un
    índice único que respaldara ese `ON CONFLICT`, lo que hacía fallar guardar/editar
    tarifas en runtime. Se agregó la migración `…0009_tarifas_unique.sql` con el índice
    único correspondiente.
  - ✅ Verificado `pnpm install` + `pnpm build`: compila y pasa TypeScript sin errores.
