-- 339 · PREFLIGHT (solo lectura, UNA consulta): ¿se puede aplicar la migración 339 (cupo adicional de soportes de pago)? control · observado · esperado · estado.
with c(orden, control, observado, esperado) as (
  select 1, 'contrato_soportes_pago y abonos existen (281 aplicada)', (to_regclass('public.contrato_soportes_pago') is not null and to_regclass('public.abonos') is not null)::text, 'true'
  union all select 2, 'existe UNA sola función f281_soportes_insert',
    (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'f281_soportes_insert'), '1'
  union all select 3, 'trigger trg_f281_soportes_insert presente, habilitado y BEFORE INSERT por fila',
    (select count(*)::text from pg_trigger t where t.tgrelid = 'public.contrato_soportes_pago'::regclass and t.tgname = 'trg_f281_soportes_insert' and not t.tgisinternal
        and t.tgenabled = 'O' and (t.tgtype & 1) = 1 and (t.tgtype & 2) = 2 and (t.tgtype & 4) = 4), '1'
  union all select 4, 'el cuerpo de f281_soportes_insert es EXACTAMENTE el de la 281 (md5 sin CR); si ya es el de la 339, esta migración ya está aplicada',
    (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p where p.oid = to_regprocedure('public.f281_soportes_insert()')), 'b0ca477d9cd9917c888a93ff0cb208a4'
  union all select 5, 'f281_soportes_insert: SECURITY INVOKER con search_path vacío (como la 281; create or replace lo conserva)',
    (select (not p.prosecdef)::text || '|' || coalesce(p.proconfig::text, '') from pg_proc p where p.oid = to_regprocedure('public.f281_soportes_insert()')), 'true|{"search_path=\"\""}'
  union all select 6, 'quien ejecute la migración es propietario de la función (o superusuario)',
    (select (pg_has_role(current_user, p.proowner, 'USAGE') or (select rolsuper from pg_roles where rolname = current_user))::text from pg_proc p where p.oid = to_regprocedure('public.f281_soportes_insert()')), 'true'
  union all select 7, 'las funciones de escritura de la 281 siguen presentes (la 339 NO las toca)',
    (select count(*)::text from (values ('public.soporte_registrar(text,uuid,text,text,text,bigint,text)'), ('public.soporte_reemplazar(bigint,uuid,text,text,text,bigint,text)'),
                                         ('public.soporte_retirar(bigint,uuid,text)')) f(firma) where to_regprocedure(f.firma) is not null), '3'
  union all select 8, 'anular_abono (248) presente: la 339 convive con ella sin modificarla', (to_regprocedure('public.anular_abono(bigint,text,text,uuid,text)') is not null)::text, 'true'
  union all select 9, 'soportes vigentes hoy (referencia; la 339 no los toca)', (select count(*)::text from public.contrato_soportes_pago where vigente and archivado_en is null), 'informativo'
  union all select 10, 'contratos que YA superan abonos+1 (quedarán «excedidos»: siguen pudiendo reemplazar/retirar; nada se descarta)',
    (select count(*)::text from (select s.numero_contrato from public.contrato_soportes_pago s where s.vigente and s.archivado_en is null group by s.numero_contrato
        having count(*) > 1 + (select count(*) from public.abonos a where a.numero_contrato = s.numero_contrato)) x), 'informativo'
  union all select 11, 'contratos que YA superan sus abonos con la regla vieja (referencia)',
    (select count(*)::text from (select s.numero_contrato from public.contrato_soportes_pago s where s.vigente and s.archivado_en is null group by s.numero_contrato
        having count(*) > (select count(*) from public.abonos a where a.numero_contrato = s.numero_contrato)) x), 'informativo'
  union all select 12, 'avisos existentes (referencia; la 339 no los toca)', (select count(*)::text from public.avisos), 'informativo'
  union all select 13, 'abonos registrados (referencia; la 339 no los toca)', (select count(*)::text from public.abonos), 'informativo'
)
select orden, control, observado, esperado,
       case when esperado = 'informativo' then 'INFO' when observado = esperado then 'OK' else 'FALLA' end as estado
  from c
union all
select 99, 'VEREDICTO', (select count(*) filter (where esperado <> 'informativo' and observado <> esperado)::text from c), '0 fallas',
       case when (select count(*) filter (where esperado <> 'informativo' and observado <> esperado) from c) = 0 then 'APLICABLE' else 'NO APLICAR' end
order by 1;
