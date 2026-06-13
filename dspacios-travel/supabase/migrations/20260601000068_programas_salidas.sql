-- ───────────────────────────────────────────────────────────────────────────
-- 068 · PROGRAMAS — modo de precio "por salida" (fecha × precio, noches variables)
--
-- Algunos circuitos (sobre todo nacionales tipo Cibeles: Amazonas, Caño
-- Cristales…) no tarifan por categoría de hotel sino por **rango de fecha de
-- salida**, y las **noches cambian según la fecha** (ej. alternando 3N/4N).
-- El hotel funciona como "columna" y la fecha como "fila".
--
-- Se agrega un segundo modo de precio al programa:
--   · modo_precio = 'categoria'  → matriz categoría × acomodación (lo de antes).
--   · modo_precio = 'salida'     → tabla programa_salidas (fecha → noches +
--                                   precio por acomodación, opcionalmente por
--                                   "columna"/hotel).
-- Ambos modos comparten la misma fórmula de PVP (pvpPrograma).
-- ───────────────────────────────────────────────────────────────────────────

alter table public.programas
  add column if not exists modo_precio text not null default 'categoria';

-- Cada "salida" es un rango de fecha (o fecha suelta) con sus propias noches y
-- su precio neto por acomodación. `columna` permite varias columnas de precio
-- por salida (ej. 3 hoteles distintos: Zuruma / Siami / Waira).
create table if not exists public.programa_salidas (
  id            bigserial primary key,
  programa_id   bigint not null references public.programas(id) on delete cascade,
  orden         integer not null default 0,
  etiqueta      text,                       -- "MAY 29 AL 01 JUN" o "Temporada alta"
  fecha_desde   date,
  fecha_hasta   date,
  noches        integer,                    -- noches de esta salida (variable)
  columna       text,                       -- hotel/categoría de la columna (opcional)
  neto_sencilla numeric(15,2),
  neto_doble    numeric(15,2),
  neto_triple   numeric(15,2),
  neto_multiple numeric(15,2),
  neto_nino     numeric(15,2),
  bajo_solicitud boolean not null default false
);
create index if not exists idx_programa_salidas_prog on public.programa_salidas(programa_id);

-- ── RLS: misma política que el resto de tablas de programa ────────────────────
alter table public.programa_salidas enable row level security;
create policy "programa_salidas: lectura pública" on public.programa_salidas for select using (true);
create policy "programa_salidas: escritura interna" on public.programa_salidas for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones'))
  with check (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones'));
