-- 323 · #78 — «Solicitar contrato» (acción explícita del aliado, separada de «Guardar cotización») con aviso INTERNO a los responsables configurados.
-- · `cotizacion_solicitudes_contrato`: un evento por solicitud; como mucho UNO abierto ('solicitada') por cotización (índice único parcial). Pedir de nuevo con la
--   cotización SIN cambios es idempotente; pedir de nuevo tras un cambio (precio, moneda, fechas, pax, importe B2B) reemplaza el evento anterior ('reemplazada').
-- · `avisos` (281): se amplía el CHECK de `tipo` con 'solicitud_contrato' y se añade `cotizacion_id` (sin FK: la cotización puede borrarse al reutilizar un número).
-- · Destinatarios = usuarios internos ACTIVOS cuyo correo figura en `config_solicitudes.emails` (la configuración de «quién recibe las solicitudes» que ya existe),
--   con rol superadmin/gerencia/administración/operaciones y de la agencia de la cotización (superadmin, de cualquiera). Sin responsables configurados el evento SE GUARDA
--   igual (notificados = 0) y la app lo dice sin inventar destinatarios. NINGÚN canal externo: no hay correo, WhatsApp ni webhook en esta migración.
-- · La RPC es SECURITY DEFINER y solo service_role: el actor se pasa como id y TODO (rol, propiedad de la cotización, estado) se re-verifica aquí, no en el navegador.
-- Aditiva: no toca datos existentes ni funciones previas.
do $$ begin
  if to_regclass('public.cotizacion_solicitudes_contrato') is not null then raise exception '323: ya aplicada (existe cotizacion_solicitudes_contrato).'; end if;
  if to_regclass('public.avisos') is null then raise exception '323: falta public.avisos (281).'; end if;
end $$;

create table public.cotizacion_solicitudes_contrato (
  id             bigserial primary key,
  cotizacion_id  bigint not null references public.cotizaciones(id) on delete cascade,
  solicitante_id uuid not null,
  aliado_id      bigint,
  estado         text not null default 'solicitada' check (estado in ('solicitada', 'reemplazada')),
  huella         text not null,
  notificados    integer not null default 0,
  creado_en      timestamptz not null default now()
);
create unique index uq_solicitud_contrato_abierta on public.cotizacion_solicitudes_contrato (cotizacion_id) where estado = 'solicitada';
create index idx_solicitud_contrato_cot on public.cotizacion_solicitudes_contrato (cotizacion_id, id desc);
alter table public.cotizacion_solicitudes_contrato enable row level security;
revoke all on public.cotizacion_solicitudes_contrato from public, anon, authenticated;
revoke all on sequence public.cotizacion_solicitudes_contrato_id_seq from public, anon, authenticated;
grant select on public.cotizacion_solicitudes_contrato to service_role;
comment on table public.cotizacion_solicitudes_contrato is '323 (#78): solicitudes de contrato hechas por el aliado desde una cotización. Solo se escribe vía solicitar_contrato_cotizacion().';

alter table public.avisos drop constraint if exists avisos_tipo_check;
alter table public.avisos add constraint avisos_tipo_check check (tipo in ('soporte_pago_nuevo', 'soporte_pago_reemplazado', 'solicitud_contrato'));
alter table public.avisos add column if not exists cotizacion_id bigint;

create function public.solicitar_contrato_cotizacion(p_cotizacion_id bigint, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  u record; c record; prev record; v_huella text; v_id bigint; v_n integer; v_reemplazo boolean;
begin
  select id, email, rol, activo, aliado_id into u from public.usuarios where id = p_actor;
  if not found or u.activo is not true or u.rol not in ('agencia', 'freelance') then
    raise exception 'SOLICITUD_ACTOR: solo un aliado B2B activo puede solicitar un contrato.' using errcode = 'F4601';
  end if;
  -- El bloqueo de la cotización serializa solicitudes simultáneas de la MISMA cotización.
  select * into c from public.cotizaciones where id = p_cotizacion_id for update;
  -- Propiedad como en el portal: la generó el aliado (correo de su sesión) o es una asistida con SU ficha congelada. Otra cosa responde igual que «no existe».
  -- Cada lado se fuerza a booleano NO nulo: un NULL (p. ej. cotización sin b2bAsistido en el payload) hacía que NOT(...) fuera NULL y el IF no rechazara (hallado al ejecutar test_323 E1/E6).
  if not found
     or not (coalesce(c.creado_por is not null and lower(c.creado_por) = lower(u.email), false)
             or coalesce(u.aliado_id is not null and (c.payload -> 'b2bAsistido' ->> 'aliado_id') = u.aliado_id::text, false)) then
    raise exception 'SOLICITUD_NO_ENCONTRADA: la cotización no existe o no es tuya.' using errcode = 'F4602';
  end if;
  if c.numero_contrato is not null then raise exception 'SOLICITUD_YA_CONVERTIDA: esta cotización ya es el contrato %.', c.numero_contrato using errcode = 'F4603'; end if;
  if c.estado = 'descartada' or c.modo = 'comparativa' then raise exception 'SOLICITUD_NO_APLICA: esta cotización no admite solicitar contrato.' using errcode = 'F4604'; end if;
  if c.vigencia_hasta is not null and c.vigencia_hasta < (now() at time zone 'America/Bogota')::date then
    raise exception 'SOLICITUD_VENCIDA: la cotización venció; genera una nueva.' using errcode = 'F4605';
  end if;
  if c.fecha_salida is not null and c.fecha_salida < (now() at time zone 'America/Bogota')::date then
    raise exception 'SOLICITUD_SALIDA_PASADA: la fecha de salida ya pasó; genera una nueva.' using errcode = 'F4606';
  end if;

  v_huella := md5(concat_ws('|', c.precio_venta, c.moneda, c.fecha_salida, c.fecha_regreso, c.pax, c.estado, c.payload -> 'b2bAsistido' ->> 'total_exigible'));
  select * into prev from public.cotizacion_solicitudes_contrato where cotizacion_id = c.id and estado = 'solicitada';
  v_reemplazo := found;
  if v_reemplazo and prev.huella = v_huella then
    return jsonb_build_object('estado', 'ya_solicitada', 'id', prev.id, 'creado_en', prev.creado_en, 'notificados', prev.notificados);
  end if;
  if v_reemplazo then update public.cotizacion_solicitudes_contrato set estado = 'reemplazada' where id = prev.id; end if;

  insert into public.cotizacion_solicitudes_contrato (cotizacion_id, solicitante_id, aliado_id, huella)
  values (c.id, u.id, u.aliado_id, v_huella) returning id into v_id;

  insert into public.avisos (usuario_id, tipo, numero_contrato, cotizacion_id)
  select r.id, 'solicitud_contrato', c.codigo, c.id
    from public.usuarios r
    join public.config_solicitudes cfg on cfg.id = 1
   where r.activo is true
     and r.rol in ('superadmin', 'gerencia', 'administracion', 'operaciones')
     and (r.rol = 'superadmin' or r.tenant = c.tenant)
     and lower(r.email) in (select lower(btrim(x)) from regexp_split_to_table(coalesce(cfg.emails, ''), '[,;[:space:]]+') x where btrim(x) <> '');
  get diagnostics v_n = row_count;
  update public.cotizacion_solicitudes_contrato set notificados = v_n where id = v_id;
  return jsonb_build_object('estado', case when v_reemplazo then 'reemplazada' else 'solicitada' end, 'id', v_id, 'notificados', v_n);
end $$;
revoke all on function public.solicitar_contrato_cotizacion(bigint, uuid) from public, anon, authenticated;
grant execute on function public.solicitar_contrato_cotizacion(bigint, uuid) to service_role;
