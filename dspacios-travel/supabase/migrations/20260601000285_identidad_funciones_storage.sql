-- ============================================================================
-- 285 — Identidad del contrato: funciones, pendiente financiero y Storage (#75, entrega 2)
-- ============================================================================
-- Requiere la 284 (contrato_uid, guardas, contrato_verificar_identidad). Aditiva e inerte mientras ningún contrato haya nacido de un número reutilizado:
-- ningún cambio de esta migración altera un contrato de siempre sin identidad. Se aplica ANTES de desplegar el código de la entrega 2 (el código viejo sigue
-- funcionando) y, en todo caso, antes de habilitar el reuso.
--
-- QUÉ HACE
--   1. `contrato_financiero_pendiente.contrato_uid`: el registro pendiente CONSERVA la identidad del contrato desde su creación. El cron de reconciliación
--      declara ESA identidad (no la vigente). Un trigger completa el uid solo para contratos de siempre (código viejo sin uid), exige uid explícito si el
--      contrato nació de reuso, y nunca deja cambiar un uid ya guardado.
--   2. `liberar_vencidas`: tarea AUTOMÁTICA genuina (no recibe contratos; los elige por estado bajo bloqueo): declara la identidad que LEYÓ bajo bloqueo.
--      Es la ÚNICA función que se auto-declara en esta entrega; las funciones que invocan usuarios con un número/ID NO declaran: la guarda de las tablas
--      verifica la identidad que manda la pantalla.
--   3. `soporte_registrar/reemplazar/retirar`: comprueban la identidad ANTES de escribir y rechazan con SOPORTE_IDENTIDAD (SQLSTATE F4521), prefijo que
--      el clasificador de lib/soportes/operaciones.ts ya trata como RECHAZO DEFINITIVO (nada quedó registrado → se puede limpiar el archivo nuevo).
--      `soporte_verificar_identidad(numero)` es la precomprobación de solo lectura que el portal llama ANTES de subir el archivo.
--   4. Storage (bucket `contratos`): las cuatro políticas exigen además `contrato_identidad_ok_archivo(name)`: identidad declarada = contrato vigente, y
--      identidad obligatoria si el contrato nació de reuso (superadmin incluido).
-- Rollback: supabase/scripts/rollback_285_identidad_funciones_storage.sql
-- ============================================================================
begin;

do $$
begin
  if to_regclass('public.contrato_guardas_config') is null or to_regprocedure('public.contrato_verificar_identidad(text,boolean)') is null then
    raise exception 'La 285 requiere la 284 (identidad del contrato) aplicada.';
  end if;
end $$;

-- 1) Pendiente financiero ----------------------------------------------------
alter table public.contrato_financiero_pendiente add column if not exists contrato_uid uuid;
update public.contrato_financiero_pendiente p set contrato_uid = v.contrato_uid
  from public.ventas v where v.numero_contrato = p.numero_contrato and p.contrato_uid is null;

create or replace function public.fn_financiero_pendiente_identidad() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid; v_reuso boolean;
begin
  if tg_op = 'UPDATE' then
    if old.contrato_uid is not null and new.contrato_uid is distinct from old.contrato_uid then
      raise exception 'IDENTIDAD_INMUTABLE: el registro pendiente de % pertenece a otro contrato (otra identidad); no se sobrescribe.', old.numero_contrato using errcode = 'F4603';
    end if;
    if new.contrato_uid is not null then return new; end if;
  elsif new.contrato_uid is not null then
    return new;
  end if;
  -- Sin uid explícito (código anterior a la 285): solo se completa para un contrato de SIEMPRE.
  select contrato_uid, nacio_de_reuso into v_uid, v_reuso from public.ventas where numero_contrato = new.numero_contrato;
  if found and coalesce(v_reuso, false) then
    raise exception 'IDENTIDAD_REQUERIDA: el contrato % nació de un número reutilizado; el registro pendiente debe llevar su contrato_uid.', new.numero_contrato using errcode = 'F4602';
  end if;
  new.contrato_uid := v_uid;
  return new;
end $$;
revoke all on function public.fn_financiero_pendiente_identidad() from public, anon, authenticated;
drop trigger if exists trg_financiero_pendiente_identidad on public.contrato_financiero_pendiente;
create trigger trg_financiero_pendiente_identidad before insert or update on public.contrato_financiero_pendiente
  for each row execute function public.fn_financiero_pendiente_identidad();

-- 2) liberar_vencidas: tarea automática ---------------------------------------
create or replace function public.liberar_vencidas(p_hoy date default null) returns jsonb
language plpgsql security definer set search_path = 'public', 'pg_temp' set lock_timeout = '5s' as $function$
declare
  v_hoy date := coalesce(p_hoy, (now() at time zone 'America/Bogota')::date);
  v_nums text[];
  v_sillas integer := 0;
begin
  select array_agg(numero_contrato order by numero_contrato) into v_nums
    from (select numero_contrato from public.ventas
           where estado = 'pendiente' and plazo < v_hoy
           order by numero_contrato for update) v;
  if v_nums is null then
    return jsonb_build_object('ok', true, 'hoy', v_hoy, 'liberadas', 0, 'sillas', 0);
  end if;
  -- Tarea automática: no recibe contratos de ninguna pantalla; los eligió por estado y los bloqueó arriba. Declara lo que LEYÓ bajo bloqueo (#75).
  perform public.contrato_declarar_identidad(x.numero_contrato, x.contrato_uid) from public.ventas x where x.numero_contrato = any (v_nums);
  v_sillas := public._vaciar_sillas(
    array(select id from public.sillas where numero_contrato = any(v_nums) and estado = 'en_plazo'),
    'Reserva vencida');
  update public.ventas set estado = 'cancelado' where numero_contrato = any(v_nums) and estado = 'pendiente';
  return jsonb_build_object('ok', true, 'hoy', v_hoy, 'liberadas', cardinality(v_nums), 'sillas', v_sillas);
end $function$;

-- 3) Soportes ------------------------------------------------------------------
create or replace function public.soporte_verificar_identidad(p_numero text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.contrato_verificar_identidad(p_numero, true);
exception when sqlstate 'F4601' or sqlstate 'F4602' then
  raise exception 'SOPORTE_IDENTIDAD: el contrato % cambió desde que abriste la página. Recárgala antes de continuar.', p_numero using errcode = 'F4521';
end $$;
revoke all on function public.soporte_verificar_identidad(text) from public, anon, authenticated;
grant execute on function public.soporte_verificar_identidad(text) to service_role;

create or replace function public.soporte_registrar(p_numero text, p_actor uuid, p_path text, p_nombre text, p_mime text, p_size bigint, p_sha text) returns jsonb
language plpgsql security definer set search_path = '' as $function$
declare v_tenant text; v_id bigint;
begin
  perform public.f281_exigir_actor(p_actor);
  v_tenant := public.f281_bloquear_venta(p_numero);
  perform public.soporte_verificar_identidad(p_numero);   -- #75: antes de escribir; rechazo definitivo (SOPORTE_*)
  insert into public.contrato_soportes_pago (numero_contrato, tenant, path, nombre_original, mime, size_bytes, sha256, subido_por)
  values (p_numero, v_tenant, p_path, p_nombre, p_mime, p_size, p_sha, p_actor) returning id into v_id;
  insert into public.avisos (usuario_id, tipo, numero_contrato, soporte_id)
    select d.usuario_id, 'soporte_pago_nuevo', p_numero, v_id from public.f281_destinatarios(p_numero, p_actor) d;
  return jsonb_build_object('id', v_id, 'numero_contrato', p_numero);
end $function$;

create or replace function public.soporte_reemplazar(p_id bigint, p_actor uuid, p_path text, p_nombre text, p_mime text, p_size bigint, p_sha text) returns jsonb
language plpgsql security definer set search_path = '' as $function$
declare v_num text; v_tenant text; o public.contrato_soportes_pago; v_id bigint;
begin
  perform public.f281_exigir_actor(p_actor);
  select b.o_numero, b.o_tenant into v_num, v_tenant from public.f281_bloquear_contrato_del_soporte(p_id) b;   -- venta primero (orden de anular_abono)
  perform public.soporte_verificar_identidad(v_num);   -- #75
  select * into o from public.contrato_soportes_pago s where s.id = p_id for update;
  if o.archivado_en is not null then
    raise exception 'SOPORTE_ARCHIVADO: el soporte % pertenece a un contrato que ya no existe.', p_id using errcode = 'F4520';
  end if;
  if not o.vigente then
    raise exception 'SOPORTE_NO_VIGENTE: el soporte % ya no está vigente (otro reemplazo o retiro se adelantó).', p_id using errcode = 'F4513';
  end if;
  update public.contrato_soportes_pago
     set vigente = false, retirado_en = now(), retirado_por = p_actor, motivo_retiro = 'reemplazo'
   where id = p_id;
  insert into public.contrato_soportes_pago (numero_contrato, tenant, path, nombre_original, mime, size_bytes, sha256, subido_por, reemplaza_id)
  values (v_num, v_tenant, p_path, p_nombre, p_mime, p_size, p_sha, p_actor, p_id) returning id into v_id;
  insert into public.avisos (usuario_id, tipo, numero_contrato, soporte_id)
    select d.usuario_id, 'soporte_pago_reemplazado', v_num, v_id from public.f281_destinatarios(v_num, p_actor) d;
  return jsonb_build_object('id', v_id, 'numero_contrato', v_num, 'reemplaza_id', p_id);
end $function$;

create or replace function public.soporte_retirar(p_id bigint, p_actor uuid, p_nota text) returns jsonb
language plpgsql security definer set search_path = '' as $function$
declare v_num text; o public.contrato_soportes_pago;
begin
  perform public.f281_exigir_actor(p_actor);
  select b.o_numero into v_num from public.f281_bloquear_contrato_del_soporte(p_id) b;
  perform public.soporte_verificar_identidad(v_num);   -- #75
  select * into o from public.contrato_soportes_pago s where s.id = p_id for update;
  if o.archivado_en is not null then
    raise exception 'SOPORTE_ARCHIVADO: el soporte % pertenece a un contrato que ya no existe.', p_id using errcode = 'F4520';
  end if;
  if not o.vigente then
    raise exception 'SOPORTE_NO_VIGENTE: el soporte % ya no está vigente.', p_id using errcode = 'F4513';
  end if;
  update public.contrato_soportes_pago
     set vigente = false, retirado_en = now(), retirado_por = p_actor, motivo_retiro = 'retiro', nota_retiro = nullif(btrim(p_nota), '')
   where id = p_id;
  return jsonb_build_object('id', p_id, 'numero_contrato', v_num);
end $function$;

-- 4) Storage: identidad como PRECONDICIÓN adicional (nunca concede acceso) -------------------
create or replace function public.contrato_identidad_ok_archivo(ruta text) returns boolean
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  if ruta is null or position('/' in ruta) = 0 then return true; end if;   -- sin carpeta: lo decide acceso_archivo_contratos
  perform public.contrato_verificar_identidad(split_part(ruta, '/', 1), true);
  return true;
exception when sqlstate 'F4601' or sqlstate 'F4602' then
  return false;
end $$;
revoke all on function public.contrato_identidad_ok_archivo(text) from public;
grant execute on function public.contrato_identidad_ok_archivo(text) to anon, authenticated, service_role;

drop policy if exists "contratos files: lectura" on storage.objects;
drop policy if exists "contratos files: subir" on storage.objects;
drop policy if exists "contratos files: reemplazar" on storage.objects;
drop policy if exists "contratos files: eliminar" on storage.objects;
create policy "contratos files: lectura" on storage.objects for select
  using (bucket_id = 'contratos' and public.acceso_archivo_contratos(name) and public.contrato_identidad_ok_archivo(name));
create policy "contratos files: subir" on storage.objects for insert
  with check (bucket_id = 'contratos' and public.acceso_archivo_contratos(name) and public.contrato_identidad_ok_archivo(name));
create policy "contratos files: reemplazar" on storage.objects for update
  using (bucket_id = 'contratos' and public.acceso_archivo_contratos(name) and public.contrato_identidad_ok_archivo(name))
  with check (bucket_id = 'contratos' and public.acceso_archivo_contratos(name) and public.contrato_identidad_ok_archivo(name));
create policy "contratos files: eliminar" on storage.objects for delete
  using (bucket_id = 'contratos' and public.acceso_archivo_contratos(name) and public.contrato_identidad_ok_archivo(name));

-- 5) Las vistas que alimentan pantallas exponen el uid EN LA MISMA CONSULTA que trae el contrato -------------------------
-- El uid debe salir de los mismos datos que la pantalla leyó (no de una consulta posterior por número). Se AÑADE `contrato_uid` al final de la definición VIVA de
-- cada vista (sin copiar su texto: otra rama puede haberla cambiado), idempotente; si su forma no es la esperada la migración aborta.
--   · ventas_basica (rol `venta`) y ventas_vuelo_sistema: la fila ES la venta → v.contrato_uid.
--   · contrato_vuelos_editor (tramos): subconsulta por el número de la MISMA fila en la MISMA sentencia (misma instantánea que los tramos que se muestran).
do $$
declare
  r record; d text; pat text;
begin
  for r in select * from (values
      ('ventas_basica',        '\n(\s+)FROM ventas v\n',          ',
    v.contrato_uid
\1FROM ventas v
'),
      ('ventas_vuelo_sistema', '\n(\s+)FROM ventas v\n',          ',
    v.contrato_uid
\1FROM ventas v
'),
      ('contrato_vuelos_editor', '\n(\s+)FROM contrato_vuelos cv\n', ',
    (select vv.contrato_uid from ventas vv where vv.numero_contrato = cv.numero_contrato) AS contrato_uid
\1FROM contrato_vuelos cv
')
    ) t(vista, patron, reemplazo)
  loop
    d := pg_get_viewdef(('public.' || r.vista)::regclass, true);
    if d ~ 'contrato_uid' then continue; end if;
    if d !~ r.patron then
      raise exception '% tiene una forma inesperada (el FROM esperado no aparece); añade contrato_uid a mano.', r.vista;
    end if;
    execute 'create or replace view public.' || r.vista || ' as ' || regexp_replace(d, r.patron, r.reemplazo);
  end loop;
end $$;

notify pgrst, 'reload schema';
commit;
