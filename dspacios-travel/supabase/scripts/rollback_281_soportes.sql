-- 281 · ROLLBACK. Una sola transacción. Se NIEGA, sin tocar nada, si:
--   · ya hay soportes registrados o archivos en el bucket (son evidencia: no se destruye con un rollback);
--   · no existe el respaldo de la renumeración, o fn_renumerar_contrato / sus permisos CAMBIARON después de la 281 (no se sobrescribe en silencio un cambio posterior).
-- Si todo coincide con lo que dejó la 281, restaura la definición ORIGINAL de fn_renumerar_contrato (CREATE OR REPLACE conserva propietario y permisos) y comprueba
-- que sus permisos y propietario vuelven a ser exactamente los originales.
begin;
do $$
declare r public.f281_respaldo_funciones; v_md5 text; v_acl text; v_dueno text;
begin
  if to_regclass('public.contrato_soportes_pago') is not null and exists (select 1 from public.contrato_soportes_pago) then
    raise exception '281 rollback: hay soportes registrados; son evidencia y no se borran con un rollback.';
  end if;
  if exists (select 1 from storage.objects where bucket_id = 'soportes-pago') then
    raise exception '281 rollback: el bucket soportes-pago tiene archivos; no se borran con un rollback.';
  end if;
  if to_regclass('public.f281_respaldo_funciones') is null then
    raise exception '281 rollback: falta public.f281_respaldo_funciones; no se puede restaurar fn_renumerar_contrato con seguridad.';
  end if;
  select * into r from public.f281_respaldo_funciones where nombre = 'fn_renumerar_contrato';
  if r.nombre is null or r.prosrc_md5_281 is null then
    raise exception '281 rollback: el respaldo de fn_renumerar_contrato no está completo.';
  end if;
  select md5(replace(p.prosrc, chr(13), '')), coalesce(p.proacl::text, '<defecto>'), p.proowner::regrole::text
    into v_md5, v_acl, v_dueno
    from pg_proc p where p.oid = 'public.fn_renumerar_contrato(text,text)'::regprocedure;
  if v_md5 is distinct from r.prosrc_md5_281 then
    raise exception '281 rollback: fn_renumerar_contrato ya no es la versión que dejó la 281 (cambió después). No se sobrescribe; revisa y restaura a mano.';
  end if;
  if v_acl is distinct from r.acl_tras_281 or v_dueno is distinct from r.propietario then
    raise exception '281 rollback: los permisos o el propietario de fn_renumerar_contrato cambiaron después de la 281 (antes: % / %, ahora: % / %). No se sobrescribe.', r.acl_tras_281, r.propietario, v_acl, v_dueno;
  end if;
  -- Restaura la definición original (cuerpo de la migración 115).
  execute r.definicion;
  select md5(replace(p.prosrc, chr(13), '')), coalesce(p.proacl::text, '<defecto>'), p.proowner::regrole::text
    into v_md5, v_acl, v_dueno
    from pg_proc p where p.oid = 'public.fn_renumerar_contrato(text,text)'::regprocedure;
  if v_md5 is distinct from r.prosrc_md5 or v_acl is distinct from r.acl_original or v_dueno is distinct from r.propietario then
    raise exception '281 rollback: tras restaurar, fn_renumerar_contrato no quedó idéntica a la original (cuerpo / permisos / propietario). Se revierte todo.';
  end if;
end $$;
drop trigger if exists trg_f281_archivar_evidencia on public.ventas;
drop function if exists public.f281_archivar_evidencia();
drop function if exists public.f281_trasladar_evidencia(text, text);
drop table if exists public.f281_respaldo_funciones;
drop function if exists public.avisos_marcar_leidos(uuid, bigint[]);
drop function if exists public.avisos_reclamar(uuid, integer);
drop function if exists public.soporte_retirar(bigint, uuid, text);
drop function if exists public.soporte_reemplazar(bigint, uuid, text, text, text, bigint, text);
drop function if exists public.soporte_registrar(text, uuid, text, text, text, bigint, text);
drop function if exists public.f281_bloquear_contrato_del_soporte(bigint);
drop function if exists public.f281_exigir_actor(uuid);
drop function if exists public.f281_bloquear_venta(text);
drop function if exists public.f281_destinatarios(text, uuid);
drop table if exists public.avisos;
drop table if exists public.contrato_soportes_pago;
drop function if exists public.f281_reemplazo_completo();
drop function if exists public.f281_soportes_no_borrar();
drop function if exists public.f281_soportes_update();
drop function if exists public.f281_soportes_insert();
delete from storage.buckets where id = 'soportes-pago';
commit;
