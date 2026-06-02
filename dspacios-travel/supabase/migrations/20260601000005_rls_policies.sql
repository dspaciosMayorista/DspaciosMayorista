-- Migración 005: Row Level Security (idempotente)

-- ──────────────────────────────────────────────────────────────────
-- HELPER: obtener el rol del usuario autenticado
-- ──────────────────────────────────────────────────────────────────
create or replace function public.mi_rol()
returns rol_usuario language sql security definer stable as $$
  select rol from public.usuarios where id = auth.uid();
$$;

-- ──────────────────────────────────────────────────────────────────
-- HABILITAR RLS EN TODAS LAS TABLAS
-- ──────────────────────────────────────────────────────────────────
alter table public.usuarios              enable row level security;
alter table public.asesores              enable row level security;
alter table public.proveedores           enable row level security;
alter table public.aliados               enable row level security;
alter table public.parametros_tributarios enable row level security;
alter table public.ventas                enable row level security;
alter table public.abonos                enable row level security;
alter table public.cuentas_por_pagar     enable row level security;
alter table public.aliados_b2b           enable row level security;
alter table public.liquidacion_comisiones enable row level security;
alter table public.facturacion           enable row level security;
alter table public.rentabilidad          enable row level security;
alter table public.bloqueos_vuelo        enable row level security;
alter table public.sillas                enable row level security;
alter table public.movimientos_silla     enable row level security;
alter table public.destinos              enable row level security;
alter table public.hoteles               enable row level security;
alter table public.habitaciones          enable row level security;
alter table public.planes_alimentacion   enable row level security;
alter table public.temporadas            enable row level security;
alter table public.temporada_fechas      enable row level security;
alter table public.tarifas               enable row level security;
alter table public.tarifa_precios        enable row level security;
alter table public.itinerarios           enable row level security;
alter table public.inclusiones           enable row level security;

-- ──────────────────────────────────────────────────────────────────
-- DROP previo para idempotencia (re-ejecución segura)
-- ──────────────────────────────────────────────────────────────────
drop policy if exists "usuarios: ver propio perfil"            on public.usuarios;
drop policy if exists "usuarios: superadmin gestiona"          on public.usuarios;
drop policy if exists "asesores: lectura interna"              on public.asesores;
drop policy if exists "asesores: escritura admin"              on public.asesores;
drop policy if exists "proveedores: lectura interna"           on public.proveedores;
drop policy if exists "proveedores: escritura admin"           on public.proveedores;
drop policy if exists "aliados: lectura interna"               on public.aliados;
drop policy if exists "aliados: escritura admin"               on public.aliados;
drop policy if exists "params: lectura interna"                on public.parametros_tributarios;
drop policy if exists "params: escritura superadmin"           on public.parametros_tributarios;
drop policy if exists "ventas: lectura operativa"              on public.ventas;
drop policy if exists "ventas: asesor ve sus contratos"        on public.ventas;
drop policy if exists "ventas: escritura operaciones y venta"  on public.ventas;
drop policy if exists "ventas: actualizar operaciones"         on public.ventas;
drop policy if exists "abonos: acceso contable"                on public.abonos;
drop policy if exists "cpp: acceso contable"                   on public.cuentas_por_pagar;
drop policy if exists "aliados_b2b: acceso contable"           on public.aliados_b2b;
drop policy if exists "liquidacion: acceso contable"           on public.liquidacion_comisiones;
drop policy if exists "facturacion: acceso contable"           on public.facturacion;
drop policy if exists "rentabilidad: acceso gerencia"          on public.rentabilidad;
drop policy if exists "bloqueos: lectura operativa"            on public.bloqueos_vuelo;
drop policy if exists "bloqueos: escritura control"            on public.bloqueos_vuelo;
drop policy if exists "sillas: lectura operativa"              on public.sillas;
drop policy if exists "sillas: escritura control"              on public.sillas;
drop policy if exists "movimientos: registro operativo"        on public.movimientos_silla;
drop policy if exists "destinos: lectura pública"              on public.destinos;
drop policy if exists "destinos: escritura admin"              on public.destinos;
drop policy if exists "hoteles: lectura pública"               on public.hoteles;
drop policy if exists "hoteles: escritura admin"               on public.hoteles;
drop policy if exists "habitaciones: lectura pública"          on public.habitaciones;
drop policy if exists "planes: lectura pública"                on public.planes_alimentacion;
drop policy if exists "temporadas: lectura pública"            on public.temporadas;
drop policy if exists "temporada_fechas: lectura pública"      on public.temporada_fechas;
drop policy if exists "tarifas: lectura pública"               on public.tarifas;
drop policy if exists "tarifas: escritura operaciones"         on public.tarifas;
drop policy if exists "tarifa_precios: lectura pública"        on public.tarifa_precios;
drop policy if exists "tarifa_precios: escritura operaciones"  on public.tarifa_precios;
drop policy if exists "itinerarios: lectura pública"           on public.itinerarios;
drop policy if exists "inclusiones: lectura pública"           on public.inclusiones;

-- ──────────────────────────────────────────────────────────────────
-- USUARIOS
-- ──────────────────────────────────────────────────────────────────
create policy "usuarios: ver propio perfil"
  on public.usuarios for select
  using (id = auth.uid() or public.mi_rol() = 'superadmin');

create policy "usuarios: superadmin gestiona"
  on public.usuarios for all
  using (public.mi_rol() = 'superadmin');

-- ──────────────────────────────────────────────────────────────────
-- CATÁLOGOS
-- ──────────────────────────────────────────────────────────────────
create policy "asesores: lectura interna"
  on public.asesores for select
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta','control_vuelo'));

create policy "asesores: escritura admin"
  on public.asesores for all
  using (public.mi_rol() in ('superadmin','administracion'));

create policy "proveedores: lectura interna"
  on public.proveedores for select
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta','control_vuelo'));

create policy "proveedores: escritura admin"
  on public.proveedores for all
  using (public.mi_rol() in ('superadmin','administracion'));

create policy "aliados: lectura interna"
  on public.aliados for select
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta','control_vuelo'));

create policy "aliados: escritura admin"
  on public.aliados for all
  using (public.mi_rol() in ('superadmin','administracion'));

-- ──────────────────────────────────────────────────────────────────
-- PARÁMETROS TRIBUTARIOS
-- ──────────────────────────────────────────────────────────────────
create policy "params: lectura interna"
  on public.parametros_tributarios for select
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta'));

create policy "params: escritura superadmin"
  on public.parametros_tributarios for all
  using (public.mi_rol() = 'superadmin');

-- ──────────────────────────────────────────────────────────────────
-- VENTAS
-- ──────────────────────────────────────────────────────────────────
create policy "ventas: lectura operativa"
  on public.ventas for select
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones'));

create policy "ventas: asesor ve sus contratos"
  on public.ventas for select
  using (
    public.mi_rol() = 'venta' and
    asesor = (select email from public.usuarios where id = auth.uid())
  );

-- INSERT requiere WITH CHECK (no USING)
create policy "ventas: escritura operaciones y venta"
  on public.ventas for insert
  with check (public.mi_rol() in ('superadmin','administracion','operaciones','venta'));

create policy "ventas: actualizar operaciones"
  on public.ventas for update
  using (public.mi_rol() in ('superadmin','administracion','operaciones'));

-- ──────────────────────────────────────────────────────────────────
-- TABLAS FINANCIERAS
-- ──────────────────────────────────────────────────────────────────
create policy "abonos: acceso contable"
  on public.abonos for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones'));

create policy "cpp: acceso contable"
  on public.cuentas_por_pagar for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones'));

create policy "aliados_b2b: acceso contable"
  on public.aliados_b2b for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones'));

create policy "liquidacion: acceso contable"
  on public.liquidacion_comisiones for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion'));

create policy "facturacion: acceso contable"
  on public.facturacion for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion'));

create policy "rentabilidad: acceso gerencia"
  on public.rentabilidad for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion'));

-- ──────────────────────────────────────────────────────────────────
-- VUELOS / SILLAS
-- ──────────────────────────────────────────────────────────────────
create policy "bloqueos: lectura operativa"
  on public.bloqueos_vuelo for select
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta','control_vuelo'));

create policy "bloqueos: escritura control"
  on public.bloqueos_vuelo for all
  using (public.mi_rol() in ('superadmin','administracion','operaciones','control_vuelo'));

create policy "sillas: lectura operativa"
  on public.sillas for select
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta','control_vuelo'));

create policy "sillas: escritura control"
  on public.sillas for all
  using (public.mi_rol() in ('superadmin','administracion','operaciones','control_vuelo'));

create policy "movimientos: registro operativo"
  on public.movimientos_silla for all
  using (public.mi_rol() in ('superadmin','administracion','operaciones','control_vuelo'));

-- ──────────────────────────────────────────────────────────────────
-- TARIFARIO (lectura pública)
-- ──────────────────────────────────────────────────────────────────
create policy "destinos: lectura pública"
  on public.destinos for select using (true);

create policy "destinos: escritura admin"
  on public.destinos for all
  using (public.mi_rol() in ('superadmin','operaciones'));

create policy "hoteles: lectura pública"
  on public.hoteles for select using (true);

create policy "hoteles: escritura admin"
  on public.hoteles for all
  using (public.mi_rol() in ('superadmin','operaciones'));

create policy "habitaciones: lectura pública"
  on public.habitaciones for select using (true);

create policy "planes: lectura pública"
  on public.planes_alimentacion for select using (true);

create policy "temporadas: lectura pública"
  on public.temporadas for select using (true);

create policy "temporada_fechas: lectura pública"
  on public.temporada_fechas for select using (true);

create policy "tarifas: lectura pública"
  on public.tarifas for select using (true);

create policy "tarifas: escritura operaciones"
  on public.tarifas for all
  using (public.mi_rol() in ('superadmin','operaciones'));

create policy "tarifa_precios: lectura pública"
  on public.tarifa_precios for select using (true);

create policy "tarifa_precios: escritura operaciones"
  on public.tarifa_precios for all
  using (public.mi_rol() in ('superadmin','operaciones'));

create policy "itinerarios: lectura pública"
  on public.itinerarios for select using (true);

create policy "inclusiones: lectura pública"
  on public.inclusiones for select using (true);
