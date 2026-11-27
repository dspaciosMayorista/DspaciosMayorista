-- 340 · #78 (residual) — Aviso INTERNO cuando un visitante SIN sesión (B2C) genera una cotización pública.
-- Pedido del dueño (#34/#78): «Para cotizaciones B2C sin login, avisar al equipo en el dashboard». La 323 ya cubrió la solicitud de contrato del aliado B2B; esta migración cubre
-- el otro evento y NADA más. Política vigente (decisión del dueño, 2026-11-24; sustituye la lista fija de correos de una versión anterior de esta misma migración, nunca aplicada):
--   · Reutiliza `avisos` (281/323): misma campana, mismo sondeo, mismo «reclamado ≠ leído». No crea tablas ni un canal nuevo.
--   · DESTINATARIOS = los usuarios que de verdad PUEDEN generar o asistir cotizaciones, con los límites de acceso vigentes: usuarios ACTIVOS con rol superadmin/gerencia/administración/
--     operaciones/venta (los roles que la RLS de `cotizaciones` deja leer/crear: «cotizaciones: lectura/insertar», migración 154; `control_vuelo` y los roles externos no figuran) y de
--     la agencia de la cotización (superadmin, de cualquiera; gerencia queda acotada a su agencia, igual que `puede_ver_tenant_cotizacion`). Ya no depende de `config_solicitudes`.
--   · «ATENDIDA» = convertida a contrato (`estado = 'convertida'` o `numero_contrato` no nulo; la misma prueba de la 270). Leído/no leído sigue siendo POR PERSONA y no significa atendida;
--     descartar NO es convertir. `avisos_recientes()` devuelve ese estado calculado en la misma consulta del sondeo (sin consultas extra).
--   · NINGÚN canal externo: no hay correo, WhatsApp ni webhook aquí. El enlace voluntario de WhatsApp/correo del visitante no se toca.
--   · Idempotente: un único aviso por (usuario, cotización). Repetir la llamada (reintento, doble clic, reparación por la misma clave de envío) no duplica nada.
--   · La función es SECURITY DEFINER y solo service_role; la base RE-VERIFICA que la cotización sea de un visitante (misma regla de «anónima» que la 308: sin autor, propietario
--     ni aliado, de mayorista, y además SIN correo de autor) y siga pendiente. Una cotización de un aliado B2B, del personal o ya convertida NO genera aviso (respuesta `no_aplica`).
--   · El aviso lleva solo tipo + código de la cotización (no cliente, no montos), igual que los demás.
-- Aditiva: no toca datos existentes ni funciones previas. Requiere la 323 (usa `avisos.cotizacion_id`).
do $$ begin
  if to_regclass('public.avisos') is null then raise exception '340: falta public.avisos (281).'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'avisos' and column_name = 'cotizacion_id') then
    raise exception '340: falta avisos.cotizacion_id (323). Aplica primero la 323.';
  end if;
  if to_regprocedure('public.avisar_cotizacion_publica(bigint)') is not null then raise exception '340: ya aplicada (existe avisar_cotizacion_publica).'; end if;
end $$;

alter table public.avisos drop constraint if exists avisos_tipo_check;
alter table public.avisos add constraint avisos_tipo_check
  check (tipo in ('soporte_pago_nuevo', 'soporte_pago_reemplazado', 'solicitud_contrato', 'cotizacion_publica'));

-- Un aviso por (destinatario, cotización) del tipo nuevo: la idempotencia la garantiza la base, no el código.
create unique index uq_avisos_cotizacion_publica on public.avisos (usuario_id, cotizacion_id) where tipo = 'cotizacion_publica';

create function public.avisar_cotizacion_publica(p_cotizacion_id bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c record; v_n integer;
begin
  select id, codigo, tenant, tipo, estado, numero_contrato, creado_por, creado_por_id, propietario_id, aliado_id, paquete_din_id, paquete_armado_id
    into c from public.cotizaciones where id = p_cotizacion_id;
  -- Fila inexistente, ya convertida o ya no pendiente: nada que avisar (misma respuesta, sin distinguir).
  if not found or c.numero_contrato is not null or c.estado not in ('abierta', 'pendiente_tarifa') then
    return jsonb_build_object('estado', 'no_aplica', 'notificados', 0);
  end if;
  -- Visitante = sin autor (ni correo ni id), sin propietario ni aliado, de mayorista (el tarifario público es solo de mayorista) y de uno de los tres orígenes públicos.
  if c.creado_por is not null or c.creado_por_id is not null or c.propietario_id is not null or c.aliado_id is not null or c.tenant <> 'mayorista'
     or not (c.tipo = 'carrito'
             or (c.tipo = 'manual' and c.paquete_din_id is not null)
             or (c.tipo = 'tarifario' and c.paquete_armado_id is not null)) then
    return jsonb_build_object('estado', 'no_aplica', 'notificados', 0);
  end if;

  -- Quién puede generar o asistir cotizaciones = quién las ve/crea según la RLS de `cotizaciones` (rol de la lista y agencia de la fila; superadmin, global).
  insert into public.avisos (usuario_id, tipo, numero_contrato, cotizacion_id)
  select r.id, 'cotizacion_publica', c.codigo, c.id
    from public.usuarios r
   where r.activo is true
     and r.rol in ('superadmin', 'gerencia', 'administracion', 'operaciones', 'venta')
     and (r.rol = 'superadmin' or r.tenant = c.tenant)
  on conflict (usuario_id, cotizacion_id) where tipo = 'cotizacion_publica' do nothing;
  get diagnostics v_n = row_count;
  return jsonb_build_object('estado', 'avisada', 'notificados', v_n);
end $$;
revoke all on function public.avisar_cotizacion_publica(bigint) from public, anon, authenticated;
grant execute on function public.avisar_cotizacion_publica(bigint) to service_role;
comment on function public.avisar_cotizacion_publica(bigint) is '340 (#78): aviso interno por una cotización pública de un visitante sin sesión, a quienes pueden generar/asistir cotizaciones en su agencia. Idempotente; solo service_role; sin canal externo.';

-- Avisos recientes de UNA persona + «atendida» (convertida a contrato) calculada en la misma consulta. La persona la fija el servidor desde la sesión (nunca el navegador).
create function public.avisos_recientes(p_usuario uuid, p_limite integer default 10)
returns table (id bigint, tipo text, numero_contrato text, creado_en timestamptz, leido_en timestamptz, cotizacion_id bigint, atendida boolean)
language sql stable security definer set search_path = '' as $$
  select a.id, a.tipo, a.numero_contrato, a.creado_en, a.leido_en, a.cotizacion_id,
         (a.tipo = 'cotizacion_publica' and exists (select 1 from public.cotizaciones c where c.id = a.cotizacion_id and (c.estado = 'convertida' or c.numero_contrato is not null))) as atendida
    from public.avisos a
   where a.usuario_id = p_usuario and a.archivado_en is null
   order by a.id desc
   limit greatest(1, least(coalesce(p_limite, 10), 50))
$$;
revoke all on function public.avisos_recientes(uuid, integer) from public, anon, authenticated;
grant execute on function public.avisos_recientes(uuid, integer) to service_role;
comment on function public.avisos_recientes(uuid, integer) is '340 (#78): avisos recientes de una persona con el estado «atendida» (convertida a contrato) de las cotizaciones públicas. Solo service_role.';
