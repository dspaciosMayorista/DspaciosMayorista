-- ───────────────────────────────────────────────────────────────────────────
-- ESQUEMA MÍNIMO para las pruebas LOCALES de la 203 (nunca remoto). Lo
-- incrustan test_203_tarifas_generacion_acotada.sh y test_203_carreras.sh en
-- una base desechable. Solo lo que la migración usa.
-- ───────────────────────────────────────────────────────────────────────────
create schema if not exists auth;
-- Sesión simulada: cada conexión fija test.uid / test.email / test.rol.
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create or replace function auth.jwt() returns jsonb language sql stable as
  $$ select jsonb_build_object('email', nullif(current_setting('test.email', true), '')) $$;
create or replace function public.mi_rol() returns text language sql stable as
  $$ select nullif(current_setting('test.rol', true), '') $$;
-- Misma definición que la migración 198 (regla común de fecha de negocio).
create or replace function public.fecha_negocio(p_instante timestamptz default now()) returns date
  language sql stable parallel safe as $$ select (p_instante at time zone 'America/Bogota')::date $$;

create table public.hoteles (id bigint primary key, nombre text);
create table public.hotel_temporadas (
  id bigserial primary key, hotel_id bigint not null references public.hoteles(id) on delete cascade,
  nombre text not null, tipo text not null default 'tarifa', descuento_valor numeric,
  prioridad integer not null default 1, fecha_inicio date, fecha_fin date,
  compra_inicio date, compra_fin date, regimen_restringido text
);
create table public.hotel_calculadora (
  hotel_id bigint primary key references public.hoteles(id) on delete cascade,
  tipo text not null, params jsonb not null default '{}'::jsonb
);
create table public.tarifa_hotel (
  id bigserial primary key,
  hotel_id bigint not null references public.hoteles(id) on delete cascade,
  tipo_habitacion text, alimentacion text, temporada text,
  neto_sencilla numeric(15,2), neto_doble numeric(15,2), neto_triple numeric(15,2),
  neto_multiple numeric(15,2), neto_nino numeric(15,2), neto_nino2 numeric(15,2),
  neto_infante numeric(15,2), nota_infante text, notas text,
  edad_infante_min integer, edad_infante_max integer, edad_nino_min integer, edad_nino_max integer,
  precio_final_autoritativo boolean not null default false,
  temporada_base text,
  created_at timestamptz not null default now(),
  constraint tarifa_hotel_temporada_base_solo_si_final_check check (
    (precio_final_autoritativo = false and temporada_base is null)
    or (precio_final_autoritativo = true and temporada_base is not null and btrim(temporada_base) <> '')
  )
);

-- `auditoria` como la dejan 087/108 (misma forma de registro_id/antes/despues).
create table public.auditoria (
  id bigserial primary key, creado_en timestamptz not null default now(),
  actor_id uuid, actor_email text, actor_nombre text, actor_rol text,
  accion text not null, tabla text not null, registro_id text,
  antes jsonb, despues jsonb, cambios jsonb, tenant text not null default 'mayorista'
);
create or replace function public.fn_auditoria_prueba() returns trigger language plpgsql as $$
declare v_antes jsonb; v_despues jsonb;
begin
  if tg_op <> 'INSERT' then v_antes := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then v_despues := to_jsonb(new); end if;
  insert into public.auditoria (actor_email, accion, tabla, registro_id, antes, despues)
  values (nullif(current_setting('test.email', true), ''), tg_op, tg_table_name,
          coalesce(v_despues->>'id', v_antes->>'id'), v_antes, v_despues);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger trg_auditoria after insert or update or delete on public.hotel_temporadas
  for each row execute function public.fn_auditoria_prueba();
create trigger trg_auditoria after insert or update or delete on public.tarifa_hotel
  for each row execute function public.fn_auditoria_prueba();

-- Foto de las tarifas de un hotel tal como la recibe la vista previa (p_previas).
create or replace function public._foto_prueba(p_hotel bigint) returns jsonb language sql stable as
  $$ select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from public.tarifa_hotel t where t.hotel_id = p_hotel $$;
