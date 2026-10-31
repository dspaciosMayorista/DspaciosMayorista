-- 255 · Traslados: suplementos por FRANJA HORARIA dentro de la vigencia de un servicio.
--
-- Una franja (`servicio_suplementos_franja`) cuelga de UNA vigencia (`servicio_temporadas.id`, FK con ON DELETE CASCADE: renombrar la vigencia no la
-- huérfana y borrarla la borra) y define hora inicial/final, tramo (llegada / salida / ambos), tipo (monto fijo o % del neto base) y cobro (una vez
-- por grupo o por persona). El suplemento se suma al COSTO NETO del traslado y el margen del paquete se aplica después (lib/calc/trasladoFranjas.ts,
-- lib/calc/servicioTarifa.ts). La franja es [desde, hasta): el inicio se incluye, el fin no; desde > hasta cruza la medianoche; `24:00` solo como fin.
--
-- Es ADITIVA: no modifica ni borra ninguna tarifa, vigencia, precio general ni dato histórico. El retiro de la tarifa «GENERAL» como fuente de precio
-- es un cambio de CÓDIGO (la liquidación ya no cae a ella); los valores GENERAL quedan intactos en la base para auditoría y por si hay que volver atrás.
--
-- Integridad en la base (además de la validación de la aplicación): formato de horas, valor > 0, dominios cerrados y un trigger que rechaza que dos
-- franjas de la MISMA vigencia que comparten tramo cubran alguna hora común (solape ambiguo). Los tramos de «ambos» chocan con llegada y con salida.
-- Preflight: supabase/scripts/preflight_255_servicio_suplementos_franja.sql · Postcheck: postcheck_255_… · Rollback: rollback_255_….
-- Inventario de servicios que quedan sin tarifa al retirar GENERAL (solo lectura): supabase/scripts/auditoria_255_servicios_sin_vigencia.sql.
begin;

do $$
begin
  if to_regclass('public.servicio_temporadas') is null then
    raise exception '255 ABORTADA: falta public.servicio_temporadas (migración 089).';
  end if;
  if to_regprocedure('public.mi_rol()') is null then
    raise exception '255 ABORTADA: falta public.mi_rol().';
  end if;
end $$;

create table if not exists public.servicio_suplementos_franja (
  id                    bigserial primary key,
  servicio_temporada_id bigint not null references public.servicio_temporadas(id) on delete cascade,
  hora_desde            text   not null,
  hora_hasta            text   not null,
  tramo                 text   not null,
  tipo                  text   not null,
  valor                 numeric(15,2) not null,
  cobro                 text   not null,
  created_at            timestamptz not null default now(),
  constraint servicio_suplementos_franja_desde_chk check (hora_desde ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  constraint servicio_suplementos_franja_hasta_chk check (hora_hasta ~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$'),
  constraint servicio_suplementos_franja_distintas_chk check (hora_desde <> hora_hasta),
  constraint servicio_suplementos_franja_tramo_chk check (tramo in ('llegada', 'salida', 'ambos')),
  constraint servicio_suplementos_franja_tipo_chk check (tipo in ('monto', 'porcentaje')),
  constraint servicio_suplementos_franja_cobro_chk check (cobro in ('grupo', 'persona')),
  constraint servicio_suplementos_franja_valor_chk check (valor > 0)
);
create index if not exists idx_servicio_suplementos_franja_temporada on public.servicio_suplementos_franja(servicio_temporada_id);

-- Minutos desde 00:00 de un 'HH:MM' ya validado ('24:00' = 1440).
create or replace function public.fn_franja_minutos(p_hora text)
returns integer
language sql
immutable
set search_path = public, pg_temp
as $$
  select (split_part(p_hora, ':', 1)::int * 60) + split_part(p_hora, ':', 2)::int;
$$;

-- ¿La hora x (minutos) cae en [d, h) sobre el reloj circular? d < h: intervalo normal; d > h: cruza la medianoche.
create or replace function public.fn_franja_contiene(p_x integer, p_d integer, p_h integer)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select case when p_d < p_h then p_x >= p_d and p_x < p_h else p_x >= p_d or p_x < p_h end;
$$;

-- Dos arcos [d1,h1) y [d2,h2) no vacíos se solapan si y solo si el inicio de uno cae dentro del otro.
create or replace function public.tg_servicio_suplementos_franja_solape()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_d1 integer := public.fn_franja_minutos(new.hora_desde);
  v_h1 integer := public.fn_franja_minutos(new.hora_hasta);
  v_otra record;
begin
  -- Serializa las altas/ediciones de franjas de una misma vigencia (dos inserciones simultáneas no pueden esquivar la comprobación).
  perform pg_advisory_xact_lock(hashtextextended('servicio_suplementos_franja:' || new.servicio_temporada_id::text, 0));
  for v_otra in
    select id, hora_desde, hora_hasta, tramo
      from public.servicio_suplementos_franja
     where servicio_temporada_id = new.servicio_temporada_id
       and id is distinct from new.id
       and (tramo = 'ambos' or new.tramo = 'ambos' or tramo = new.tramo)
  loop
    if public.fn_franja_contiene(public.fn_franja_minutos(v_otra.hora_desde), v_d1, v_h1)
       or public.fn_franja_contiene(v_d1, public.fn_franja_minutos(v_otra.hora_desde), public.fn_franja_minutos(v_otra.hora_hasta)) then
      raise exception 'La franja % a % (%) se solapa con la franja % a % (%) de la misma vigencia.',
        new.hora_desde, new.hora_hasta, new.tramo, v_otra.hora_desde, v_otra.hora_hasta, v_otra.tramo
        using errcode = '23P01';
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists servicio_suplementos_franja_solape on public.servicio_suplementos_franja;
create trigger servicio_suplementos_franja_solape
  before insert or update on public.servicio_suplementos_franja
  for each row execute function public.tg_servicio_suplementos_franja_solape();

-- RLS: mismo criterio que servicio_temporadas (catálogo interno; el tarifario público lee por el servidor con service-role).
alter table public.servicio_suplementos_franja enable row level security;
drop policy if exists "servicio_suplementos_franja: interno" on public.servicio_suplementos_franja;
create policy "servicio_suplementos_franja: interno" on public.servicio_suplementos_franja for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones'))
  with check (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones'));

revoke all on public.servicio_suplementos_franja from anon;
revoke all on function public.tg_servicio_suplementos_franja_solape() from public, anon, authenticated;

comment on table public.servicio_suplementos_franja is
  'Suplementos de traslado por franja horaria dentro de una vigencia de servicio (255). [desde, hasta): inicio incluido, fin excluido; desde > hasta cruza la medianoche. Se suma al costo NETO; el margen se aplica después.';

commit;
