-- 272 · Composición PRIVADA del precio de una cotización (hotfix desglose interno).
-- Guarda, al generar la cotización, los componentes que produjo el motor en ese momento (hotel, vuelo, cada servicio incluido, markup global, redondeo).
-- Lleva netas y markup: por eso NO vive en `cotizaciones.detalle` (que leen roles sin acceso a costos) sino en una tabla que solo lee service_role,
-- como `cotizacion_neto`. Aditiva: no cambia ninguna tabla ni función existente. El código escribe aquí en mejor esfuerzo (si la tabla no existe, la cotización se crea igual).
do $$
begin
  if to_regclass('public.cotizacion_composicion') is not null then
    raise exception '272: cotizacion_composicion ya existe. No se aplicó nada.';
  end if;
end $$;

create table public.cotizacion_composicion (
  cotizacion_id bigint primary key references public.cotizaciones (id) on delete cascade,
  tenant        text not null,
  composicion   jsonb not null check (jsonb_typeof(composicion) = 'object'),
  created_at    timestamptz not null default now()
);
alter table public.cotizacion_composicion enable row level security;
-- Sin políticas: ningún usuario autenticado ni anónimo la alcanza por la API.
revoke all on public.cotizacion_composicion from public, anon, authenticated;
grant select, insert on public.cotizacion_composicion to service_role;
