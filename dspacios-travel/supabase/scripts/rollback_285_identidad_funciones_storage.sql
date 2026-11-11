-- ROLLBACK de la migración 285 (identidad: funciones, pendiente financiero y Storage, #75 entrega 2).
-- Restaura el texto EXACTO de liberar_vencidas y soporte_registrar/reemplazar/retirar que dejó la 281 y las cuatro políticas del bucket «contratos» (150/148),
-- y quita el trigger y la columna del pendiente financiero. SE NIEGA si algún contrato nació de un número reutilizado (la protección debe sobrevivir) o si la
-- 285 no está aplicada. La columna `contrato_uid` que la 285 añadió a ventas_basica se DEJA (una vista no admite quitar columnas con CREATE OR REPLACE; es inofensiva).
begin;
do $$
begin
  if to_regprocedure('public.soporte_verificar_identidad(text)') is null then
    raise exception 'rollback 285: la 285 no está aplicada.';
  end if;
  if exists (select 1 from public.ventas where nacio_de_reuso) then
    raise exception 'rollback 285: % contrato(s) nacieron de un número reutilizado; la protección de funciones y Storage debe sobrevivir.', (select count(*) from public.ventas where nacio_de_reuso);
  end if;
end $$;

drop policy if exists "contratos files: lectura" on storage.objects;
drop policy if exists "contratos files: subir" on storage.objects;
drop policy if exists "contratos files: reemplazar" on storage.objects;
drop policy if exists "contratos files: eliminar" on storage.objects;
create policy "contratos files: lectura" on storage.objects for select using ((bucket_id = 'contratos'::text) and public.acceso_archivo_contratos(name));
create policy "contratos files: subir" on storage.objects for insert with check ((bucket_id = 'contratos'::text) and public.acceso_archivo_contratos(name));
create policy "contratos files: reemplazar" on storage.objects for update using ((bucket_id = 'contratos'::text) and public.acceso_archivo_contratos(name)) with check ((bucket_id = 'contratos'::text) and public.acceso_archivo_contratos(name));
create policy "contratos files: eliminar" on storage.objects for delete using ((bucket_id = 'contratos'::text) and public.acceso_archivo_contratos(name));
drop function if exists public.contrato_identidad_ok_archivo(text);

CREATE OR REPLACE FUNCTION public.liberar_vencidas(p_hoy date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET lock_timeout TO '5s'
AS $function$
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
  v_sillas := public._vaciar_sillas(
    array(select id from public.sillas where numero_contrato = any(v_nums) and estado = 'en_plazo'),
    'Reserva vencida');
  update public.ventas set estado = 'cancelado' where numero_contrato = any(v_nums) and estado = 'pendiente';
  return jsonb_build_object('ok', true, 'hoy', v_hoy, 'liberadas', cardinality(v_nums), 'sillas', v_sillas);
end $function$

;

CREATE OR REPLACE FUNCTION public.soporte_registrar(p_numero text, p_actor uuid, p_path text, p_nombre text, p_mime text, p_size bigint, p_sha text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_tenant text; v_id bigint;
begin
  perform public.f281_exigir_actor(p_actor);
  v_tenant := public.f281_bloquear_venta(p_numero);
  insert into public.contrato_soportes_pago (numero_contrato, tenant, path, nombre_original, mime, size_bytes, sha256, subido_por)
  values (p_numero, v_tenant, p_path, p_nombre, p_mime, p_size, p_sha, p_actor) returning id into v_id;
  insert into public.avisos (usuario_id, tipo, numero_contrato, soporte_id)
    select d.usuario_id, 'soporte_pago_nuevo', p_numero, v_id from public.f281_destinatarios(p_numero, p_actor) d;
  return jsonb_build_object('id', v_id, 'numero_contrato', p_numero);
end $function$

;

CREATE OR REPLACE FUNCTION public.soporte_reemplazar(p_id bigint, p_actor uuid, p_path text, p_nombre text, p_mime text, p_size bigint, p_sha text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_num text; v_tenant text; o public.contrato_soportes_pago; v_id bigint;
begin
  perform public.f281_exigir_actor(p_actor);
  select b.o_numero, b.o_tenant into v_num, v_tenant from public.f281_bloquear_contrato_del_soporte(p_id) b;   -- venta primero (orden de anular_abono)
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
end $function$

;

CREATE OR REPLACE FUNCTION public.soporte_retirar(p_id bigint, p_actor uuid, p_nota text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_num text; o public.contrato_soportes_pago;
begin
  perform public.f281_exigir_actor(p_actor);
  select b.o_numero into v_num from public.f281_bloquear_contrato_del_soporte(p_id) b;
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
end $function$

;

drop function if exists public.soporte_verificar_identidad(text);
drop trigger if exists trg_financiero_pendiente_identidad on public.contrato_financiero_pendiente;
drop function if exists public.fn_financiero_pendiente_identidad();
alter table public.contrato_financiero_pendiente drop column if exists contrato_uid;
notify pgrst, 'reload schema';
commit;
