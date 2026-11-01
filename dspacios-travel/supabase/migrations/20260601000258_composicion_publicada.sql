-- 258 · Composición PUBLICADA de los servicios incluidos por salida (evidencia para rechazar filas antiguas o desactualizadas).
--
-- Número: la 257 está reservada para B2B (otra línea de trabajo); esta migración es la 258 y NO reutiliza ni edita ninguna existente.
--
-- Problema: en bloqueo/dinámico el PVP sale de la fila publicada (`tarifario_resultado`) y el costo/CxP de la composición VIVA de servicios incluidos. Con la omisión de
-- incluidos sin tarifa vigente por fecha (256+), una fila publicada bajo una regla anterior puede traer horneado el precio de un servicio que la composición actual
-- omite: la reserva no registraría su costo ni su CxP, pero cobraría su PVP. Una instrucción operativa («regenera») no basta: el servidor debe poder ACREDITAR, antes de
-- cotizar o numerar, qué servicios incluidos respaldan el precio de cada salida publicada.
--
-- Diseño (fallo cerrado, sin tocar el publicador ni la vista de la 254/256):
--   · `tarifario_composicion_publicada(paquete_id, fecha_ida, generacion, regla, servicios_incluidos)`: por paquete y fecha de ida de cada salida publicada, los ids de los
--     servicios incluidos que SÍ están horneados en su precio, la generación que los publicó y la versión de la regla de composición.
--   · `registrar_composicion_publicada(paquete, generacion, regla, filas)`: la llama la generación del tarifario justo después de publicar. Solo escribe si esa generación sigue
--     siendo la publicada y vigente (nunca pisa una más nueva); reemplaza TODAS las filas del paquete en una transacción. SECURITY DEFINER con candado de rol (la tabla no
--     tiene acceso directo para anon/authenticated; la leen el servidor con service-role).
--   · Una fila publicada SIN evidencia de la generación vigente y de la regla vigente —toda fila anterior a esta migración, o cuya escritura de evidencia falló— se rechaza:
--     «regenera el tarifario». Si la evidencia existe pero la composición viva ya no coincide, también.
-- Preflight: supabase/scripts/preflight_258_composicion_publicada.sql · Postcheck: postcheck_258_… · Rollback: rollback_258_… · Gates: test_258_gates.sh.
begin;

do $$
begin
  if to_regclass('public.armado_paquetes') is null or to_regclass('public.tarifario_resultado') is null then
    raise exception '258 ABORTADA: faltan armado_paquetes/tarifario_resultado.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'armado_paquetes' and column_name = 'tarifario_generacion_publicada') then
    raise exception '258 ABORTADA: falta armado_paquetes.tarifario_generacion_publicada (migración 181).';
  end if;
  if to_regprocedure('public.mi_rol()') is null then
    raise exception '258 ABORTADA: falta public.mi_rol().';
  end if;
end $$;

create table if not exists public.tarifario_composicion_publicada (
  paquete_id bigint not null references public.armado_paquetes(id) on delete cascade,
  fecha_ida date not null,
  generacion bigint not null,
  regla smallint not null,
  servicios_incluidos jsonb not null default '[]'::jsonb,
  registrado_en timestamptz not null default now(),
  primary key (paquete_id, fecha_ida),
  constraint tarifario_composicion_publicada_servicios_chk check (jsonb_typeof(servicios_incluidos) = 'array')
);
comment on table public.tarifario_composicion_publicada is
  'Servicios incluidos horneados en el precio de cada salida publicada (por paquete y fecha de ida), con la generación y la regla que los publicaron. Evidencia para rechazar filas antiguas. Migración 258.';

alter table public.tarifario_composicion_publicada enable row level security;
revoke all on table public.tarifario_composicion_publicada from public, anon, authenticated;

create or replace function public.registrar_composicion_publicada(
  p_paquete_id bigint,
  p_generacion bigint,
  p_regla smallint,
  p_filas jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_vigente boolean;
begin
  if coalesce(public.mi_rol()::text, '') not in ('superadmin', 'gerencia', 'administracion', 'operaciones') then
    raise exception 'registrar_composicion_publicada: rol sin permiso de escritura sobre armado_paquetes';
  end if;
  if p_filas is null or jsonb_typeof(p_filas) <> 'array' then
    raise exception 'registrar_composicion_publicada: p_filas debe ser un arreglo';
  end if;
  -- Solo si esa generación es la publicada y vigente (misma condición que registrar_diagnostico_tarifario). Bloquea la fila del paquete mientras escribe.
  select true into v_vigente
    from public.armado_paquetes
    where id = p_paquete_id
      and tarifario_estado = 'listo'
      and tarifario_generacion = p_generacion
      and tarifario_generacion_publicada = p_generacion
    for update;
  if v_vigente is not true then
    return false;
  end if;

  delete from public.tarifario_composicion_publicada where paquete_id = p_paquete_id;
  insert into public.tarifario_composicion_publicada (paquete_id, fecha_ida, generacion, regla, servicios_incluidos)
    select p_paquete_id, (e ->> 'fecha_ida')::date, p_generacion, p_regla, coalesce(e -> 'servicios_incluidos', '[]'::jsonb)
    from jsonb_array_elements(p_filas) e
    on conflict (paquete_id, fecha_ida) do update
      set generacion = excluded.generacion, regla = excluded.regla, servicios_incluidos = excluded.servicios_incluidos, registrado_en = now();
  return true;
end;
$$;
comment on function public.registrar_composicion_publicada(bigint, bigint, smallint, jsonb) is
  'Reemplaza la composición publicada del paquete (por fecha de ida) solo si p_generacion es la publicada y vigente. SECURITY DEFINER con candado de rol. Migración 258.';
revoke all on function public.registrar_composicion_publicada(bigint, bigint, smallint, jsonb) from public, anon;
grant execute on function public.registrar_composicion_publicada(bigint, bigint, smallint, jsonb) to authenticated;

commit;
