-- 339 · POSTCHECK (solo lectura, UNA consulta): ¿quedó bien aplicada la migración 339? control · observado · esperado · estado.
-- Las cifras de referencia (soportes, avisos, abonos) deben coincidir con las que mostró el preflight: la 339 no escribe ninguna fila.
with c(orden, control, observado, esperado) as (
  select 1, 'existe UNA sola función f281_soportes_insert',
    (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'f281_soportes_insert'), '1'
  union all select 2, 'el cuerpo de f281_soportes_insert es el de la 339 (md5 sin CR)',
    (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p where p.oid = to_regprocedure('public.f281_soportes_insert()')), '9f00935a6536eabed5bdff9c496c45a8'
  union all select 3, 'la condición nueva está en el cuerpo (soportes vigentes + 1 <= abonos + cupo adicional) y la vieja ya no',
    (select (position('v_vigentes + 1 > v_abonos + c_adicionales' in p.prosrc) > 0 and position('v_vigentes + 1 > v_abonos then' in p.prosrc) = 0)::text from pg_proc p where p.oid = to_regprocedure('public.f281_soportes_insert()')), 'true'
  union all select 4, 'el cupo adicional es 1', (select (p.prosrc like '%c_adicionales constant int := 1;%')::text from pg_proc p where p.oid = to_regprocedure('public.f281_soportes_insert()')), 'true'
  union all select 5, 'mismo código de error F4515 / SOPORTE_LIMITE (la aplicación traduce ese mensaje)',
    (select (p.prosrc like '%SOPORTE_LIMITE:%' and p.prosrc like '%errcode = ''F4515''%')::text from pg_proc p where p.oid = to_regprocedure('public.f281_soportes_insert()')), 'true'
  union all select 6, 'trigger trg_f281_soportes_insert presente, habilitado y BEFORE INSERT por fila (uno solo)',
    (select count(*)::text from pg_trigger t where t.tgrelid = 'public.contrato_soportes_pago'::regclass and t.tgname = 'trg_f281_soportes_insert' and not t.tgisinternal
        and t.tgenabled = 'O' and (t.tgtype & 1) = 1 and (t.tgtype & 2) = 2 and (t.tgtype & 4) = 4), '1'
  union all select 7, 'el trigger apunta a f281_soportes_insert',
    (select count(*)::text from pg_trigger t where t.tgrelid = 'public.contrato_soportes_pago'::regclass and t.tgname = 'trg_f281_soportes_insert' and t.tgfoid = to_regprocedure('public.f281_soportes_insert()')), '1'
  union all select 8, 'SECURITY INVOKER con search_path vacío (sin cambios)',
    (select (not p.prosecdef)::text || '|' || coalesce(p.proconfig::text, '') from pg_proc p where p.oid = to_regprocedure('public.f281_soportes_insert()')), 'true|{"search_path=\"\""}'
  union all select 9, 'propietario y permisos de f281_soportes_insert IDÉNTICOS a los de la función hermana f281_soportes_update (misma migración 281)',
    (select (a.proowner = b.proowner and coalesce(a.proacl::text, '<defecto>') = coalesce(b.proacl::text, '<defecto>'))::text
       from pg_proc a, pg_proc b where a.oid = to_regprocedure('public.f281_soportes_insert()') and b.oid = to_regprocedure('public.f281_soportes_update()')), 'true'
  union all select 10, 'las 3 funciones de escritura de la 281 siguen presentes y SECURITY DEFINER (la 339 no las toca)',
    (select count(*)::text from (values ('public.soporte_registrar(text,uuid,text,text,text,bigint,text)'), ('public.soporte_reemplazar(bigint,uuid,text,text,text,bigint,text)'),
                                         ('public.soporte_retirar(bigint,uuid,text)')) f(firma) join pg_proc p on p.oid = to_regprocedure(f.firma) where p.prosecdef), '3'
  union all select 11, 'soporte_registrar sigue SIN tocar abonos, ventas ni asientos (el cuerpo no los escribe)',
    (select (p.prosrc !~* '(insert into|update|delete from)\s+public\.(abonos|ventas|asientos_contables|asiento_lineas|cuentas_por_pagar)')::text from pg_proc p where p.oid = to_regprocedure('public.soporte_registrar(text,uuid,text,text,text,bigint,text)')), 'true'
  union all select 12, 'anular_abono (248) sigue presente', (to_regprocedure('public.anular_abono(bigint,text,text,uuid,text)') is not null)::text, 'true'
  union all select 13, 'la tabla de soportes conserva sus 5 triggers de integridad',
    (select count(*)::text from pg_trigger where tgrelid = 'public.contrato_soportes_pago'::regclass and not tgisinternal
        and tgname in ('trg_f281_soportes_insert', 'trg_f281_soportes_update', 'trg_f281_soportes_delete', 'trg_f281_soportes_truncate', 'trg_f281_reemplazo_completo')), '5'
  union all select 14, 'soportes vigentes (debe coincidir con el preflight: la 339 no escribe filas)', (select count(*)::text from public.contrato_soportes_pago where vigente and archivado_en is null), 'informativo'
  union all select 15, 'soportes totales, vigentes e historial (referencia)', (select count(*)::text from public.contrato_soportes_pago), 'informativo'
  union all select 16, 'avisos existentes (debe coincidir con el preflight)', (select count(*)::text from public.avisos), 'informativo'
  union all select 17, 'abonos registrados (debe coincidir con el preflight)', (select count(*)::text from public.abonos), 'informativo'
  union all select 18, 'contratos que superan abonos+1 (excedidos; solo reemplazar/retirar)',
    (select count(*)::text from (select s.numero_contrato from public.contrato_soportes_pago s where s.vigente and s.archivado_en is null group by s.numero_contrato
        having count(*) > 1 + (select count(*) from public.abonos a where a.numero_contrato = s.numero_contrato)) x), 'informativo'
)
select orden, control, observado, esperado,
       case when esperado = 'informativo' then 'INFO' when observado = esperado then 'OK' else 'FALLA' end as estado
  from c
union all
select 99, 'VEREDICTO', (select count(*) filter (where esperado <> 'informativo' and observado <> esperado)::text from c), '0 fallas',
       case when (select count(*) filter (where esperado <> 'informativo' and observado <> esperado) from c) = 0 then 'CORRECTA' else 'REVISAR' end
order by 1;
