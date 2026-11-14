-- 281 · PREFLIGHT (solo lectura, UNA consulta): ¿se puede aplicar la migración 281? Todos los controles en una tabla: control · observado · esperado · estado.
with c(orden, control, observado, esperado) as (
  select 1, 'ventas, abonos y usuarios existen', (to_regclass('public.ventas') is not null and to_regclass('public.abonos') is not null and to_regclass('public.usuarios') is not null)::text, 'true'
  union all select 2, 'funciones base (mi_rol, mi_tenant, puede_ver_contrato, soy_asesor_del_contrato)',
    (to_regprocedure('public.mi_rol()') is not null and to_regprocedure('public.mi_tenant()') is not null
     and to_regprocedure('public.puede_ver_contrato(text)') is not null and to_regprocedure('public.soy_asesor_del_contrato(text)') is not null)::text, 'true'
  union all select 3, 'anular_abono (248) presente: la 281 convive con ella sin modificarla', (to_regprocedure('public.anular_abono(bigint,text,text,uuid,text)') is not null)::text, 'true'
  union all select 4, 'storage.buckets tiene file_size_limit y allowed_mime_types',
    (select count(*)::text from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name in ('file_size_limit', 'allowed_mime_types')), '2'
  union all select 5, 'contrato_soportes_pago NO existe todavía', (to_regclass('public.contrato_soportes_pago') is null)::text, 'true'
  union all select 6, 'avisos NO existe todavía', (to_regclass('public.avisos') is null)::text, 'true'
  union all select 7, 'ninguna función soporte_*/avisos_* ni f281_* preexistente',
    (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and (p.proname like 'soporte\_%' or p.proname like 'avisos\_%' or p.proname like 'f281\_%')), '0'
  union all select 8, 'el bucket soportes-pago NO existe todavía', (select count(*) = 0 from storage.buckets where id = 'soportes-pago')::text, 'true'
  union all select 9, 'ventas NO tiene ya un trigger trg_f281_archivar_evidencia', (select count(*)::text from pg_trigger where tgrelid = 'public.ventas'::regclass and tgname = 'trg_f281_archivar_evidencia'), '0'
  union all select 10, 'quien ejecute la migración puede crear triggers en ventas (privilegio TRIGGER)', has_table_privilege(current_user, 'public.ventas', 'TRIGGER')::text, 'true'
  union all select 11, 'policies actuales de storage.objects (referencia; la 281 no las toca)', (select count(*)::text from pg_policies where schemaname = 'storage' and tablename = 'objects'), 'informativo'
  union all select 12, 'abonos que respaldarán el límite (referencia)', (select count(*)::text from public.abonos), 'informativo'
  -- La 281 REEMPLAZA fn_renumerar_contrato. Se aplica solo sobre la definición exacta de la migración 115; una distinta BLOQUEA la aplicación.
  union all select 13, 'fn_renumerar_contrato: existe UNA sola versión (text,text)', (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'fn_renumerar_contrato'), '1'
  union all select 14, 'fn_renumerar_contrato: el cuerpo es EXACTAMENTE el de la migración 115 (md5 sin CR)',
    (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p where p.oid = to_regprocedure('public.fn_renumerar_contrato(text,text)')), '9199d3146e04c44d949a1c4703e2e81e'
  union all select 15, 'fn_renumerar_contrato: SECURITY DEFINER con search_path=public (como la 115)',
    (select (p.prosecdef::text || '|' || coalesce(p.proconfig::text, '')) from pg_proc p where p.oid = to_regprocedure('public.fn_renumerar_contrato(text,text)')), 'true|{search_path=public}'
  union all select 16, 'fn_renumerar_contrato: permisos y propietario actuales (REFERENCIA que la 281 debe dejar idéntica; guárdala)',
    (select coalesce(p.proacl::text, '<defecto>') || ' / ' || p.proowner::regrole::text from pg_proc p where p.oid = to_regprocedure('public.fn_renumerar_contrato(text,text)')), 'informativo'
)
select orden, control, observado, esperado,
       case when esperado = 'informativo' then 'INFO' when observado = esperado then 'OK' else 'FALLA' end as estado
  from c
union all
select 99, 'VEREDICTO', (select count(*) filter (where esperado <> 'informativo' and observado <> esperado)::text from c), '0 fallas',
       case when (select count(*) filter (where esperado <> 'informativo' and observado <> esperado) from c) = 0 then 'APLICABLE' else 'NO APLICAR' end
order by 1;
