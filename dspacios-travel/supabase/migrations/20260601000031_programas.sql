-- ───────────────────────────────────────────────────────────────────────────
-- 031 · PROGRAMAS (circuitos multi-ciudad armados por un proveedor)
--
-- Un "programa" es un circuito completo que nos entrega un proveedor (ej.
-- "Lo mejor de Brasil 2025", 12d/11n, Río–Foz–Manaus–Salvador), con:
--   · itinerario día por día
--   · varias CATEGORÍAS de hotel (cada una define qué hotel se usa por ciudad)
--   · matriz de PRECIOS por categoría × acomodación (sencilla/doble/triple)
--   · incluye / no incluye, tours opcionales, blackouts, condiciones
-- Se montan en USD (neto del proveedor) + % markup → PVP.  No entran al
-- `tarifario_resultado` (que es plano y en COP); el tarifario los lee directo.
-- ───────────────────────────────────────────────────────────────────────────

-- Cabecera del programa ──────────────────────────────────────────────────────
create table if not exists public.programas (
  id                   bigserial primary key,
  proveedor_id         bigint references public.proveedores(id),
  nombre               text not null,
  subtitulo            text,                          -- ruta resumida (Río – Foz – Manaus…)
  dias                 integer,
  noches               integer,
  moneda               text not null default 'USD',
  salidas              text,                          -- "Salidas diarias"
  vigencia_desde       date,
  vigencia_hasta       date,
  min_pax              integer default 2,
  max_pax              integer default 19,
  pct_mk               numeric(6,4) not null default 0,   -- markup (PVP = neto/(1-mk))
  pct_fee_tarjeta      numeric(6,4) not null default 0,   -- suplemento por TDC/link (ej. 0.05)
  nino_edad_max        integer,                       -- edad máx. del niño "free hospedaje"
  nino_valor_servicios numeric(15,2),                 -- lo que paga el niño (servicios)
  texto_condiciones    text,
  texto_cancelacion    text,
  texto_pagos          text,
  notas                text,
  activo               boolean not null default true,
  publicado            boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- Ciudades / tramos del circuito (en orden) ──────────────────────────────────
create table if not exists public.programa_ciudades (
  id           bigserial primary key,
  programa_id  bigint not null references public.programas(id) on delete cascade,
  orden        integer not null default 0,
  nombre       text not null,                         -- "RIO DE JANEIRO"
  codigo_iata  text,
  noches       integer not null default 0
);
create index if not exists idx_programa_ciudades_prog on public.programa_ciudades(programa_id);

-- Itinerario día por día ─────────────────────────────────────────────────────
create table if not exists public.programa_dias (
  id           bigserial primary key,
  programa_id  bigint not null references public.programas(id) on delete cascade,
  dia          integer not null,
  titulo       text,
  desayuno     boolean not null default false,
  almuerzo     boolean not null default false,
  cena         boolean not null default false,
  descripcion  text
);
create index if not exists idx_programa_dias_prog on public.programa_dias(programa_id);

-- Categorías (niveles de hotel del programa) ─────────────────────────────────
create table if not exists public.programa_categorias (
  id           bigserial primary key,
  programa_id  bigint not null references public.programas(id) on delete cascade,
  orden        integer not null default 0,
  nombre       text                                   -- "Categoría A" / "Turista" (opcional)
);
create index if not exists idx_programa_categorias_prog on public.programa_categorias(programa_id);

-- Hotel por categoría y ciudad (texto libre: son hoteles del exterior).
-- La ciudad se referencia por NOMBRE (coincide con programa_ciudades.nombre)
-- para desacoplar la edición de la matriz del listado de ciudades.
create table if not exists public.programa_categoria_hoteles (
  id            bigserial primary key,
  categoria_id  bigint not null references public.programa_categorias(id) on delete cascade,
  ciudad        text not null,
  hotel         text,
  orden         integer not null default 0
);
create index if not exists idx_prog_cat_hoteles_cat on public.programa_categoria_hoteles(categoria_id);

-- Matriz de precios: categoría × acomodación (neto del proveedor) ─────────────
create table if not exists public.programa_precios (
  id             bigserial primary key,
  categoria_id   bigint not null references public.programa_categorias(id) on delete cascade,
  acomodacion    text not null,                       -- sencilla/doble/triple/cuadruple/nino
  neto           numeric(15,2),                       -- neto en la moneda del programa
  bajo_solicitud boolean not null default false
);
create index if not exists idx_programa_precios_cat on public.programa_precios(categoria_id);

-- Inclusiones (incluye / no incluye) — por ciudad (texto) o general (nulo) ────
create table if not exists public.programa_inclusiones (
  id           bigserial primary key,
  programa_id  bigint not null references public.programas(id) on delete cascade,
  ciudad       text,                                  -- null = general
  tipo         text not null,                         -- 'incluye' | 'no_incluye'
  texto        text not null,
  orden        integer not null default 0
);
create index if not exists idx_programa_inclusiones_prog on public.programa_inclusiones(programa_id);

-- Tours opcionales (add-on, por pax, en la moneda del programa) ───────────────
create table if not exists public.programa_tours (
  id             bigserial primary key,
  programa_id    bigint not null references public.programas(id) on delete cascade,
  ciudad         text,
  nombre         text not null,
  precio         numeric(15,2),
  min_pax        integer not null default 2,
  dias_operacion text,
  descripcion    text,
  orden          integer not null default 0
);
create index if not exists idx_programa_tours_prog on public.programa_tours(programa_id);

-- Blackouts (fechas bloqueadas) ──────────────────────────────────────────────
create table if not exists public.programa_blackouts (
  id           bigserial primary key,
  programa_id  bigint not null references public.programas(id) on delete cascade,
  fecha_inicio date,
  fecha_fin    date,
  motivo       text,
  ciudad       text
);
create index if not exists idx_programa_blackouts_prog on public.programa_blackouts(programa_id);

-- Moneda en ventas / cuentas por pagar (para que USD y COP convivan) ──────────
alter table public.ventas
  add column if not exists moneda text not null default 'COP';
alter table public.cuentas_por_pagar
  add column if not exists moneda text not null default 'COP';

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Lectura pública de lo PUBLICADO (vitrina). Escritura solo roles internos.
alter table public.programas                  enable row level security;
alter table public.programa_ciudades          enable row level security;
alter table public.programa_dias              enable row level security;
alter table public.programa_categorias        enable row level security;
alter table public.programa_categoria_hoteles enable row level security;
alter table public.programa_precios           enable row level security;
alter table public.programa_inclusiones       enable row level security;
alter table public.programa_tours             enable row level security;
alter table public.programa_blackouts         enable row level security;

-- Rol con permiso de montaje (producto / operaciones).
-- Se reutiliza el mismo grupo que escribe el resto del producto.
do $$
declare
  t text;
  tablas text[] := array[
    'programas','programa_ciudades','programa_dias','programa_categorias',
    'programa_categoria_hoteles','programa_precios','programa_inclusiones',
    'programa_tours','programa_blackouts'
  ];
begin
  foreach t in array tablas loop
    execute format('create policy "%s: lectura pública" on public.%I for select using (true);', t, t);
    execute format(
      'create policy "%s: escritura interna" on public.%I for all '
      'using (public.mi_rol() in (''superadmin'',''gerencia'',''administracion'',''operaciones'')) '
      'with check (public.mi_rol() in (''superadmin'',''gerencia'',''administracion'',''operaciones''));',
      t, t
    );
  end loop;
end $$;
