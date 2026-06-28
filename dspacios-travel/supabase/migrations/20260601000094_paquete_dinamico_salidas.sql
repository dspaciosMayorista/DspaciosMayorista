-- ───────────────────────────────────────────────────────────────────────────
-- 094 · PAQUETE DINÁMICO — tipo 'dinamico' + salidas por sistema (sin record)
--
--  4º tipo de paquete: hotel NEGOCIADO (liquida por noches, como porción) + un
--  VUELO POR SISTEMA con sus fechas/info y un valor, SIN record ni sillas. Las
--  "salidas" se definen por paquete (rotan semanalmente); cada una es una opción
--  con su fecha_ida/regreso → el hotel se liquida por esas noches.
--
--  Edades del vuelo: 2+ años = tarifa adulto (valor_tiquete); 0–1.99 (infante) =
--  fee_infante. El valor del tiquete se monta sobre markup (aplica_mk) o con TA.
--  La moneda es la del paquete (sus hoteles): normalmente USD.
-- ───────────────────────────────────────────────────────────────────────────

-- 'dinamico' como tipo/módulo (NO se usa en esta misma migración, solo se agrega).
alter type tarifario_modulo add value if not exists 'dinamico';

create table if not exists public.salidas_dinamicas (
  id               bigserial primary key,
  paquete_id       bigint not null references public.armado_paquetes(id) on delete cascade,
  aerolinea        text,
  ruta             text,          -- IATA: "MDE - MIA - MDE"
  origen           text,          -- código IATA de origen (para el buscador)
  fecha_ida        date not null,
  fecha_regreso    date,
  hora_salida_ida  text,
  hora_llegada_ida text,
  hora_salida_reg  text,
  hora_llegada_reg text,
  valor_tiquete    numeric(15,2) not null default 0,  -- NETO adulto (2+) por pax, en la moneda del paquete
  aplica_mk        boolean not null default true,     -- true: valor/(1-mk) · false: valor + ta
  ta               numeric(15,2) not null default 0,  -- tarifa administrativa (si no aplica mk)
  fee_infante      numeric(15,2) not null default 0,  -- 0–1.99 años
  compra_inicio    date,                              -- vigencia de venta (rotación)
  compra_fin       date,
  activo           boolean not null default true,
  notas            text,
  orden            integer not null default 0,
  created_at       timestamptz not null default now()
);
create index if not exists idx_salidas_dinamicas_paquete on public.salidas_dinamicas(paquete_id);

-- El snapshot del tarifario enlaza cada fila dinámica con su salida (para la
-- vista booking y el reservar). NULL en los demás módulos.
alter table public.tarifario_resultado
  add column if not exists salida_id bigint;

alter table public.salidas_dinamicas enable row level security;
drop policy if exists "salidas_dinamicas: interno" on public.salidas_dinamicas;
create policy "salidas_dinamicas: interno" on public.salidas_dinamicas for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones'))
  with check (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones'));
