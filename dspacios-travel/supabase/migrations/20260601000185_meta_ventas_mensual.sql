-- ───────────────────────────────────────────────────────────────────────────
-- 185 · Meta general de ventas (mensual, por tenant) — referencia del punto
-- de equilibrio en el Dashboard administrativo
--
--  Auditoría previa a esta migración (ronda de KPI del Dashboard): la única
--  meta persistida en todo el esquema es `asesores.meta_mensual` — una cuota
--  INDIVIDUAL por asesor, usada para el cálculo de comisiones
--  (`pct_sobre_meta` en liquidación). Sumarla como "meta de la agencia" sería
--  inventar una semántica que esa columna no tiene: además el cruce
--  venta↔asesor es por texto libre (`ventas.asesor` vs `asesores.nombre`),
--  ya documentado como deuda técnica frágil (homónimos, tildes) en
--  CLAUDE.md — no es una base confiable para un KPI financiero.
--
--  El módulo "Punto de equilibrio" (`pe_empleados`/`pe_costos`, migración
--  101) tampoco sirve: calcula un breakeven DINÁMICO en caliente (nómina +
--  costos fijos, +15% de margen) cada vez que se abre la pantalla — no hay
--  ninguna columna ahí que represente "la meta que la agencia decidió
--  publicar para octubre" como un valor congelado y consultable en agregado
--  desde el Dashboard sin recalcular todo el módulo.
--
--  Esta tabla es la meta GENERAL, configurada a mano por
--  superadmin/gerencia/administracion (mismo set de roles que ya administra
--  `pe_empleados`/`pe_costos`/`contrato_facturacion`/conciliaciones), una
--  fila por tenant+periodo+moneda — nunca una suma derivada de otra tabla.
-- ───────────────────────────────────────────────────────────────────────────

create table if not exists public.meta_ventas_mensual (
  id              bigserial primary key,
  tenant          text not null default 'mayorista',
  periodo         text not null,                 -- 'YYYY-MM'
  moneda          text not null default 'COP',
  valor           numeric(15,2) not null check (valor > 0),
  actualizado_por text,                          -- email de quien la guardó (mismo patrón que cotizaciones.creado_por)
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tenant, periodo, moneda)
);

create index if not exists idx_meta_ventas_tenant_periodo on public.meta_ventas_mensual(tenant, periodo);

alter table public.meta_ventas_mensual enable row level security;

-- Lectura: mismo set de roles que ya lee cuentas_por_pagar/abonos ("interno"
-- en el Dashboard) — la meta general es una referencia operativa, no un dato
-- sensible como facturación/retenciones/conciliaciones (esos se quedan en el
-- set más estrecho "contable"). Sigue acotada por tenant.
drop policy if exists "meta_ventas: lectura interna" on public.meta_ventas_mensual;
create policy "meta_ventas: lectura interna"
  on public.meta_ventas_mensual for select
  using (
    public.mi_rol() in ('superadmin','gerencia','administracion','operaciones')
    and public.puede_ver_tenant(tenant)
  );

-- Escritura: solo el set "contable" (superadmin/gerencia/administracion) —
-- mismo criterio que pe_empleados/pe_costos/contrato_facturacion. `operaciones`
-- lee pero no fija la meta de la agencia.
drop policy if exists "meta_ventas: escritura contable" on public.meta_ventas_mensual;
create policy "meta_ventas: escritura contable"
  on public.meta_ventas_mensual for insert
  with check (
    public.mi_rol() in ('superadmin','gerencia','administracion')
    and public.puede_ver_tenant(tenant)
  );

drop policy if exists "meta_ventas: actualizar contable" on public.meta_ventas_mensual;
create policy "meta_ventas: actualizar contable"
  on public.meta_ventas_mensual for update
  using (
    public.mi_rol() in ('superadmin','gerencia','administracion')
    and public.puede_ver_tenant(tenant)
  )
  with check (
    public.mi_rol() in ('superadmin','gerencia','administracion')
    and public.puede_ver_tenant(tenant)
  );

drop policy if exists "meta_ventas: eliminar contable" on public.meta_ventas_mensual;
create policy "meta_ventas: eliminar contable"
  on public.meta_ventas_mensual for delete
  using (
    public.mi_rol() in ('superadmin','gerencia','administracion')
    and public.puede_ver_tenant(tenant)
  );

-- ───────────────────────────────────────────────────────────────────────────
-- Privilegios de GRANT (distintos de RLS): la RLS decide qué FILAS ve cada
-- rol, pero sin estos GRANT explícitos de tabla/secuencia, PostgreSQL
-- bloquea el acceso ANTES de que la RLS llegue a evaluarse para cualquier
-- rol que no sea el dueño — `create table` por sí solo NO alcanza a
-- `authenticated`/`anon`/`service_role` en este proyecto (mismo motivo por
-- el que el postcheck inicial dio `ok:false`: la tabla existía y la RLS
-- estaba bien, pero sin GRANT, `authenticated` no tenía ni el privilegio de
-- tabla mínimo para que la RLS aplicara sobre algo).
--   · `anon`/`public`: SIN NINGÚN privilegio — esta tabla nunca se consulta
--     sin sesión.
--   · `authenticated`: select/insert/update/delete de TABLA — la RLS de
--     arriba decide fila por fila quién realmente lee/escribe qué.
--   · `service_role`: acceso total (bypassa RLS por diseño de Supabase,
--     como cualquier otra tabla de este proyecto que usa el cliente
--     service-role en Server Actions).
-- La secuencia del `id bigserial` necesita su propio GRANT — sin `usage`
-- sobre la secuencia, un `insert` de `authenticated` falla aunque la tabla
-- tenga INSERT concedido (Postgres exige poder avanzar la secuencia para
-- resolver el default `nextval(...)`).
revoke all on public.meta_ventas_mensual from public, anon, authenticated;
grant select, insert, update, delete on public.meta_ventas_mensual to authenticated;
grant all on public.meta_ventas_mensual to service_role;

revoke all on sequence public.meta_ventas_mensual_id_seq from public, anon, authenticated;
grant usage, select on sequence public.meta_ventas_mensual_id_seq to authenticated;
grant all on sequence public.meta_ventas_mensual_id_seq to service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- Preflight/postcheck: NO viven como comentario aquí — son scripts SQL
-- ejecutables y de solo lectura, aparte:
--   supabase/scripts/preflight_185_meta_ventas_mensual.sql   (correr ANTES)
--   supabase/scripts/postcheck_185_meta_ventas_mensual.sql   (correr DESPUÉS)
-- El postcheck termina con un resumen `jsonb_build_object('ok', ...)` que da
-- `ok: true` solo si columnas/checks/unicidad/RLS/policies/aislamiento por
-- tenant/roles de lectura-escritura/GRANT de tabla y secuencia (anon sin
-- nada, authenticated con select/insert/update/delete + usage/select de
-- secuencia, service_role con todo) pasan TODOS. Ninguno de los dos se
-- ejecuta desde esta migración ni de forma remota — son para correr a mano
-- contra el entorno donde se aplique (Supabase SQL Editor, formato de una
-- sola fila JSON, sin metacomandos de psql).
-- ───────────────────────────────────────────────────────────────────────────
