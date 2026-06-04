-- Migración 018: Módulo PAQUETES (armado) + TARIFARIO (resultado)
--
-- Flujo del negocio:  PRODUCTO (costos netos) → PAQUETES (armas + margen) →
-- TARIFARIO (el resultado visible, interno y público).
--
-- Un "paquete armado" tiene una configuración inicial (destino, rango de viaje,
-- %mk, impuesto) y luego se le adicionan, con check, los CICLOS AÉREOS (bloqueos),
-- los HOTELES y los SERVICIOS que cumplan el destino y el rango de fechas.
--
-- Al guardar, se LIQUIDA y se generan las filas de `tarifario_resultado`
-- (tarifa por persona por paquete). Esa tabla es la única con lectura pública;
-- nunca expone costos netos, solo PVP / base comisionable / impuesto.
--
-- NO se tocan las tablas viejas `paquetes`/`paquete_*` (las usa el generador de
-- contratos por ahora). Estas son tablas nuevas e independientes.

-- ── Destino en el bloqueo aéreo (para filtrar vuelos por destino) ──────────
alter table public.bloqueos_vuelo
  add column if not exists destino_id bigint references public.destinos(id);

-- ── Paquete armado: configuración inicial ─────────────────────────────────
do $$ begin
  create type impuesto_tipo as enum ('tiquete','fijo');
exception when duplicate_object then null; end $$;

create table if not exists public.armado_paquetes (
  id                  bigserial primary key,
  nombre              text not null,
  activo              boolean not null default true,
  destino_id          bigint references public.destinos(id),
  -- Vigencia de compra (se muestra en el tarifario)
  fecha_compra_inicio date,
  fecha_compra_fin    date,
  -- Rango de viaje (filtra ciclos aéreos y tarifas de hotel por fecha)
  fecha_viaje_inicio  date,
  fecha_viaje_fin     date,
  -- Margen: PVP = costo / (1 - pct_mk).  Se guarda como fracción (0.20 = 20%).
  pct_mk              numeric(6,4) not null default 0,
  -- Impuesto (no comisionable): el valor del tiquete aéreo, o un valor fijo.
  impuesto_tipo       impuesto_tipo not null default 'tiquete',
  impuesto_fijo       numeric(15,2) not null default 0,
  imagen_url          text,          -- imagen general para el público
  notas               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ── Adición de VUELOS (ciclos aéreos con check) + decisión de margen ──────
-- Solo el VUELO decide margen:
--   aplica_mk = true  → el tiquete entra como costo / (1 - %mk)
--   aplica_mk = false → el tiquete entra como costo + TA (Tarifa Administrativa)
create table if not exists public.armado_vuelos (
  paquete_id  bigint not null references public.armado_paquetes(id) on delete cascade,
  bloqueo_id  bigint not null references public.bloqueos_vuelo(id) on delete cascade,
  aplica_mk   boolean not null default true,
  ta          numeric(15,2) not null default 0,
  primary key (paquete_id, bloqueo_id)
);

-- ── Adición de HOTELES (con check) ────────────────────────────────────────
-- Los hoteles SIEMPRE van con el %mk general del paquete.
create table if not exists public.armado_hoteles (
  id          bigserial primary key,
  paquete_id  bigint not null references public.armado_paquetes(id) on delete cascade,
  hotel_id    bigint not null references public.hoteles(id) on delete cascade,
  unique (paquete_id, hotel_id)
);

-- ── Adición de SERVICIOS (con check) ──────────────────────────────────────
-- Los servicios SIEMPRE van con el %mk general del paquete.
create table if not exists public.armado_servicios (
  id           bigserial primary key,
  paquete_id   bigint not null references public.armado_paquetes(id) on delete cascade,
  servicio_id  bigint not null references public.servicios_adicionales(id) on delete cascade,
  unique (paquete_id, servicio_id)
);

-- ── TARIFARIO (resultado liquidado) ───────────────────────────────────────
-- Cada fila es una tarifa POR PERSONA POR PAQUETE para una combinación
-- (ciclo aéreo · hotel · categoría · régimen · acomodación). Se regenera cada
-- vez que se guarda el paquete. Lectura pública: NO contiene costos netos.
do $$ begin
  create type tarifario_modulo as enum ('bloqueo','porcion_terrestre','servicios');
exception when duplicate_object then null; end $$;

create table if not exists public.tarifario_resultado (
  id                bigserial primary key,
  paquete_id        bigint not null references public.armado_paquetes(id) on delete cascade,
  paquete_nombre    text,          -- denormalizado (display público)
  modulo            tarifario_modulo not null,
  bloqueo_id        bigint references public.bloqueos_vuelo(id),
  bloqueo_label     text,          -- denormalizado: record + ruta del ciclo aéreo
  hotel_id          bigint references public.hoteles(id),
  hotel_nombre      text,          -- denormalizado (display público)
  servicio_id       bigint references public.servicios_adicionales(id),
  servicio_nombre   text,          -- denormalizado (display público)
  destino_id        bigint references public.destinos(id),
  destino_nombre    text,          -- denormalizado (display público)
  categoria         text,          -- tipo de habitación
  regimen           text,          -- plan de alimentación
  acomodacion       acomodacion_tipo,
  noches            integer,
  fecha_ida         date,
  fecha_regreso     date,
  base_comisionable numeric(15,2) not null default 0,
  impuesto          numeric(15,2) not null default 0,
  precio_pvp        numeric(15,2) not null default 0,   -- por persona por paquete
  created_at        timestamptz not null default now()
);

create index if not exists idx_tarifario_resultado_paquete on public.tarifario_resultado(paquete_id);
create index if not exists idx_tarifario_resultado_bloqueo on public.tarifario_resultado(bloqueo_id);
create index if not exists idx_tarifario_resultado_hotel   on public.tarifario_resultado(hotel_id);

-- ── RLS ───────────────────────────────────────────────────────────────────
alter table public.armado_paquetes    enable row level security;
alter table public.armado_vuelos      enable row level security;
alter table public.armado_hoteles     enable row level security;
alter table public.armado_servicios   enable row level security;
alter table public.tarifario_resultado enable row level security;

-- El armado es interno (operación/administración/gerencia arma; el asesor no).
do $$
declare t text;
begin
  foreach t in array array['armado_paquetes','armado_vuelos','armado_hoteles','armado_servicios']
  loop
    execute format('drop policy if exists "%s: interno" on public.%I', t, t);
    execute format(
      'create policy "%s: interno" on public.%I for all '
      'using (public.mi_rol() in (''superadmin'',''gerencia'',''administracion'',''operaciones'')) '
      'with check (public.mi_rol() in (''superadmin'',''gerencia'',''administracion'',''operaciones''))',
      t, t);
  end loop;
end $$;

-- El TARIFARIO resultado: lectura para TODOS (incluye público/anónimo);
-- escritura solo interna.
drop policy if exists "tarifario_resultado: lectura"   on public.tarifario_resultado;
drop policy if exists "tarifario_resultado: escritura" on public.tarifario_resultado;

create policy "tarifario_resultado: lectura" on public.tarifario_resultado
  for select using (true);
create policy "tarifario_resultado: escritura" on public.tarifario_resultado
  for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones'))
  with check (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones'));
