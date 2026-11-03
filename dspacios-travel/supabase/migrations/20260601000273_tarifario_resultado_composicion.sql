-- 273 · Composición PRIVADA del precio de un tarifario publicado (hotfix desglose interno, camino de bloqueo / empaquetado / salida).
-- `tarifario_resultado` guarda solo el PVP ya compuesto por persona. Para poder explicar una cotización de ese camino (hotel, vuelo, cada servicio incluido,
-- markup global, redondeo) el generador del tarifario guarda AQUÍ, por estadía × hotel × categoría × régimen × origen, los insumos reales con los que compuso esos precios.
-- Lleva netas: tabla aparte, sin políticas, solo service_role (como `tarifario_resultado_neto` y `cotizacion_composicion`). NO se agrega ninguna columna a `tarifario_resultado`
-- ni se toca la vista pública ni las RPC de publicación (por lotes y monolítica): el generador escribe esto con service_role ANTES de publicar la generación.
-- Aditiva y sin datos previos: las cotizaciones y tarifarios anteriores no la tienen y la ficha lo dice. Complementa la 272 (composición guardada en cada cotización).
do $$
begin
  if to_regclass('public.tarifario_resultado_composicion') is not null then
    raise exception '273: tarifario_resultado_composicion ya existe. No se aplicó nada.';
  end if;
  if to_regclass('public.armado_paquetes') is null then
    raise exception '273: falta armado_paquetes.';
  end if;
end $$;

create table public.tarifario_resultado_composicion (
  paquete_id  bigint not null references public.armado_paquetes (id) on delete cascade,
  generacion  bigint not null,
  clave       text   not null,
  composicion jsonb  not null check (jsonb_typeof(composicion) = 'object'),
  created_at  timestamptz not null default now(),
  primary key (paquete_id, generacion, clave)
);
alter table public.tarifario_resultado_composicion enable row level security;
-- Sin políticas: ningún usuario autenticado ni anónimo la alcanza por la API.
revoke all on public.tarifario_resultado_composicion from public, anon, authenticated;
grant select, insert, update, delete on public.tarifario_resultado_composicion to service_role;
comment on table public.tarifario_resultado_composicion is
  'Insumos con que el generador compuso los precios de cada estadía publicada (netos, markup, vuelo, servicios). Privada (service_role). Migración 273.';
