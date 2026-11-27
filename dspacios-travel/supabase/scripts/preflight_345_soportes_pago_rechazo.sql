-- 345 · PREFLIGHT (solo lectura, UNA consulta): ¿está la base lista para aplicar la migración 345 (rechazo de soportes de pago)? control · observado · esperado · estado.
-- Anota las cifras informativas: el postcheck debe devolver las MISMAS (la 345 no escribe ninguna fila).
with c(orden, control, observado, esperado) as (
  select 1, 'existen contrato_soportes_pago, avisos, ventas, usuarios', (to_regclass('public.contrato_soportes_pago') is not null and to_regclass('public.avisos') is not null and to_regclass('public.ventas') is not null and to_regclass('public.usuarios') is not null)::text, 'true'
  union all select 2, 'f281_soportes_insert es la de la 339 (md5 sin CR)', coalesce((select md5(replace(p.prosrc, chr(13), '')) from pg_proc p where p.oid = to_regprocedure('public.f281_soportes_insert()')), 'ausente'), '9f00935a6536eabed5bdff9c496c45a8'
  union all select 3, 'f281_soportes_update es la de la 281 (md5 sin CR)', coalesce((select md5(replace(p.prosrc, chr(13), '')) from pg_proc p where p.oid = to_regprocedure('public.f281_soportes_update()')), 'ausente'), '02d2cb65affe2219efd794fe22d362c7'
  union all select 4, 'la 345 NO está aplicada (sin columna corrige_id)', (not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'contrato_soportes_pago' and column_name = 'corrige_id'))::text, 'true'
  union all select 5, 'la 345 NO está aplicada (sin tabla soporte_rechazo_aviso)', (to_regclass('public.soporte_rechazo_aviso') is null)::text, 'true'
  union all select 6, 'el CHECK de motivo_retiro es el de la 281 (reemplazo, retiro)', coalesce((select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.contrato_soportes_pago'::regclass and conname = 'contrato_soportes_pago_motivo_retiro_check'), 'ausente'),
       'CHECK ((motivo_retiro = ANY (ARRAY[''reemplazo''::text, ''retiro''::text])))'
  union all select 7, 'los 3 triggers de integridad de soportes existen', (select count(*)::text from pg_trigger where tgrelid = 'public.contrato_soportes_pago'::regclass and not tgisinternal and tgname in ('trg_f281_soportes_insert', 'trg_f281_soportes_update', 'trg_f281_soportes_delete')), '3'
  union all select 8, 'soporte_registrar/reemplazar/retirar existen (la 345 no las toca)', (select count(*)::text from (values ('public.soporte_registrar(text,uuid,text,text,text,bigint,text)'), ('public.soporte_reemplazar(bigint,uuid,text,text,text,bigint,text)'), ('public.soporte_retirar(bigint,uuid,text)')) f(s) where to_regprocedure(f.s) is not null), '3'
  union all select 9, 'existen f281_destinatarios, f281_bloquear_contrato_del_soporte, soporte_verificar_identidad y f281_exigir_actor (las usa la 345)', (select count(*)::text from (values ('public.f281_destinatarios(text,uuid)'), ('public.f281_bloquear_contrato_del_soporte(bigint)'), ('public.soporte_verificar_identidad(text)'), ('public.f281_exigir_actor(uuid)')) f(s) where to_regprocedure(f.s) is not null), '4'
  union all select 10, 'columnas usadas existen: ventas.b2b_usuario_id, ventas.aliado_id, usuarios.aliado_id, usuarios.email', (select count(*)::text from (values ('ventas', 'b2b_usuario_id'), ('ventas', 'aliado_id'), ('usuarios', 'aliado_id'), ('usuarios', 'email')) f(t, col) where exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = f.t and c.column_name = f.col)), '4'
  union all select 11, 'soportes totales (referencia)', (select count(*)::text from public.contrato_soportes_pago), 'informativo'
  union all select 12, 'soportes vigentes (referencia)', (select count(*)::text from public.contrato_soportes_pago where vigente and archivado_en is null), 'informativo'
  union all select 13, 'avisos existentes (referencia)', (select count(*)::text from public.avisos), 'informativo'
  union all select 14, 'abonos (referencia)', (select count(*)::text from public.abonos), 'informativo'
)
select orden, control, observado, esperado, case when esperado = 'informativo' then 'INFO' when observado = esperado then 'OK' else 'FALLA' end as estado from c
union all
select 99, 'VEREDICTO', (select count(*) filter (where esperado <> 'informativo' and observado <> esperado)::text from c), '0 fallas',
       case when (select count(*) filter (where esperado <> 'informativo' and observado <> esperado) from c) = 0 then 'LISTA PARA APLICAR' else 'NO APLICAR' end
order by 1;
