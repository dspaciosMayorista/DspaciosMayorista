-- 345 · POSTCHECK (solo lectura, UNA consulta): ¿quedó bien aplicada la migración 345? control · observado · esperado · estado.
-- Las cifras de referencia (soportes, avisos, abonos) deben coincidir con las del preflight: la 345 no escribe ninguna fila.
with c(orden, control, observado, esperado) as (
  select 1, 'f281_soportes_insert es la de la 345 (md5 sin CR)', coalesce((select md5(replace(p.prosrc, chr(13), '')) from pg_proc p where p.oid = to_regprocedure('public.f281_soportes_insert()')), 'ausente'), 'fb2584f6f98101659e4e70c1dfe9542f'
  union all select 2, 'f281_soportes_update es la de la 345 (md5 sin CR)', coalesce((select md5(replace(p.prosrc, chr(13), '')) from pg_proc p where p.oid = to_regprocedure('public.f281_soportes_update()')), 'ausente'), '89b9ca09d12272dd4040d2cb3c037961'
  union all select 3, 'los 3 triggers de soportes (insert/update/delete) siguen habilitados', (select count(*)::text from pg_trigger t where t.tgrelid = 'public.contrato_soportes_pago'::regclass and not t.tgisinternal and t.tgenabled = 'O' and t.tgname in ('trg_f281_soportes_insert', 'trg_f281_soportes_update', 'trg_f281_soportes_delete')), '3'
  union all select 4, 'columna corrige_id (bigint) existe', coalesce((select data_type from information_schema.columns where table_schema = 'public' and table_name = 'contrato_soportes_pago' and column_name = 'corrige_id'), 'ausente'), 'bigint'
  union all select 5, 'índice único uq_soportes_corrige (una corrección por rechazo)', coalesce((select (i.indisunique)::text from pg_index i join pg_class k on k.oid = i.indexrelid where k.relname = 'uq_soportes_corrige'), 'ausente'), 'true'
  union all select 6, 'CHECK de motivo_retiro admite rechazo', coalesce((select (pg_get_constraintdef(oid) like '%rechazo%')::text from pg_constraint where conrelid = 'public.contrato_soportes_pago'::regclass and conname = 'contrato_soportes_pago_motivo_retiro_check'), 'ausente'), 'true'
  union all select 7, 'CHECK soportes_rechazo_motivo (motivo obligatorio al rechazar) y soportes_corrige_o_reemplaza existen', (select count(*)::text from pg_constraint where conrelid = 'public.contrato_soportes_pago'::regclass and conname in ('soportes_rechazo_motivo', 'soportes_corrige_o_reemplaza')), '2'
  union all select 8, 'tabla soporte_rechazo_aviso con RLS activa', coalesce((select c.relrowsecurity::text from pg_class c where c.oid = to_regclass('public.soporte_rechazo_aviso')), 'ausente'), 'true'
  union all select 9, 'soporte_rechazo_aviso: anon no accede; authenticated solo lee', coalesce((select (not has_table_privilege('anon', 'public.soporte_rechazo_aviso', 'select, insert, update, delete')
        and not has_table_privilege('authenticated', 'public.soporte_rechazo_aviso', 'insert, update, delete') and has_table_privilege('authenticated', 'public.soporte_rechazo_aviso', 'select'))::text where to_regclass('public.soporte_rechazo_aviso') is not null), 'ausente'), 'true'
  union all select 10, 'las 5 funciones nuevas existen y son SECURITY DEFINER', (select count(*)::text from (values ('public.soporte_rechazar(bigint,uuid,text)'), ('public.soporte_corregir(bigint,uuid,text,text,text,bigint,text)'), ('public.soporte_rechazo_aviso_reclamar(bigint)'), ('public.soporte_rechazo_aviso_cerrar(bigint,text,integer,text)'), ('public.f345_destinatarios_rechazo(bigint)')) f(s)
        join pg_proc p on p.oid = to_regprocedure(f.s) where p.prosecdef), '5'
  union all select 11, 'solo service_role ejecuta las 5 funciones (anon y authenticated NO)', (select count(*)::text from (values ('public.soporte_rechazar(bigint,uuid,text)'), ('public.soporte_corregir(bigint,uuid,text,text,text,bigint,text)'), ('public.soporte_rechazo_aviso_reclamar(bigint)'), ('public.soporte_rechazo_aviso_cerrar(bigint,text,integer,text)'), ('public.f345_destinatarios_rechazo(bigint)')) f(s)
        where to_regprocedure(f.s) is not null and has_function_privilege('service_role', f.s, 'execute') and not has_function_privilege('anon', f.s, 'execute') and not has_function_privilege('authenticated', f.s, 'execute')), '5'
  union all select 12, 'soporte_registrar/reemplazar/retirar NO cambiaron (md5 de la 285)', coalesce((select string_agg(md5(replace(p.prosrc, chr(13), '')), ',' order by p.proname) from pg_proc p where p.oid in (to_regprocedure('public.soporte_registrar(text,uuid,text,text,text,bigint,text)'), to_regprocedure('public.soporte_reemplazar(bigint,uuid,text,text,text,bigint,text)'), to_regprocedure('public.soporte_retirar(bigint,uuid,text)'))), 'ausente'),
       '9bbca598c56ea9affd60ef17dcb16b6d,436e5fdacd3218e9b2c8a234327ed4ac,6c2ae7e0a675c5edd275537977f247f6'
  union all select 13, 'ninguna función nueva escribe abonos, ventas, asientos, CxP ni comisiones (el cuerpo no los toca)', (select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('soporte_rechazar', 'soporte_corregir', 'soporte_rechazo_aviso_reclamar', 'soporte_rechazo_aviso_cerrar')
        and p.prosrc ~* '(insert into|update|delete from)\s+public\.(abonos|ventas|asientos_contables|asiento_lineas|cuentas_por_pagar|aliados_b2b)'), '0'
  union all select 14, 'soportes rechazados hasta ahora (referencia; 0 si aún nadie rechazó)', (select count(*)::text from public.contrato_soportes_pago where motivo_retiro = 'rechazo'), 'informativo'
  union all select 15, 'soportes totales (debe coincidir con el preflight)', (select count(*)::text from public.contrato_soportes_pago), 'informativo'
  union all select 16, 'soportes vigentes (debe coincidir con el preflight)', (select count(*)::text from public.contrato_soportes_pago where vigente and archivado_en is null), 'informativo'
  union all select 17, 'avisos (debe coincidir con el preflight)', (select count(*)::text from public.avisos), 'informativo'
  union all select 18, 'abonos (debe coincidir con el preflight)', (select count(*)::text from public.abonos), 'informativo'
)
select orden, control, observado, esperado, case when esperado = 'informativo' then 'INFO' when observado = esperado then 'OK' else 'FALLA' end as estado from c
union all
select 99, 'VEREDICTO', (select count(*) filter (where esperado <> 'informativo' and observado <> esperado)::text from c), '0 fallas',
       case when (select count(*) filter (where esperado <> 'informativo' and observado <> esperado) from c) = 0 then 'CORRECTA' else 'REVISAR' end
order by 1;
