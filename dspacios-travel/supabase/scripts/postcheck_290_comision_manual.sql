-- POSTCHECK de la migración 290 (#97). SOLO LECTURA: una consulta, un resultado. Columnas: orden | control | observado | esperado | estado.
-- Última fila: VEREDICTO («CORRECTA» solo si no hay ninguna FALLA).
with fn as (
  select p.oid, p.prosecdef, p.proconfig, p.prosrc, obj_description(p.oid, 'pg_proc') as nota
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'registrar_comision_b2b_manual'
),
tg as (
  select t.oid, t.tgenabled, t.tgtype, p.oid as fid, p.prosecdef, p.proconfig
    from pg_trigger t join pg_proc p on p.oid = t.tgfoid
   where t.tgrelid = 'public.aliados_b2b'::regclass and t.tgname = 'trg_aliados_b2b_sin_duplicado_aliado'
),
v(orden, control, obs, esp, critico) as (
  values
    (1,  'una sola registrar_comision_b2b_manual (sin sobrecargas)', (select count(*)::text from fn), '1', true),
    (2,  'es la versión 290 (comentario MANUAL_V290)', (select (nota like 'MANUAL_V290%')::text from fn), 'true', true),
    (3,  'la RPC incluye la regla de pendiente; el trigger, la de duplicado por concepto',
         (select ((select prosrc from fn) like '%COMISION_PENDIENTE%'
                  and (select p.prosrc from pg_proc p where p.oid = (select fid from tg)) like '%COMISION_DUPLICADA%'
                  and (select p.prosrc from pg_proc p where p.oid = (select fid from tg)) like '%v_rec%')::text), 'true', true),
    (4,  'conserva las guardas de la 205 (NETO, venta solo su contrato, rol)',
         (select (prosrc like '%se vendió en modo neta%' and prosrc like '%soy_asesor_del_contrato%' and prosrc like '%No autorizado para registrar comisiones B2B%')::text from fn), 'true', true),
    (5,  'SECURITY DEFINER con search_path = public, pg_temp', (select (prosecdef and proconfig @> array['search_path=public, pg_temp'])::text from fn), 'true', true),
    (6,  'anon NO ejecuta; authenticated SÍ (igual que la 205)',
         (select (not has_function_privilege('anon', oid, 'execute') and has_function_privilege('authenticated', oid, 'execute'))::text from fn), 'true', true),
    (10, 'trigger anti-duplicado presente, habilitado, BEFORE INSERT (y UPDATE, ver 11) por fila', (select (count(*) = 1 and bool_and(tgenabled <> 'D') and bool_and((tgtype & 2) <> 0 and (tgtype & 4) <> 0 and (tgtype & 1) <> 0))::text from tg), 'true', true),
    (11, 'dispara en UPDATE solo de las 7 columnas de identidad/concepto, y nunca en DELETE',
         (select bool_and((tgtype & 16) <> 0 and (tgtype & 8) = 0
            and (select array_agg(a.attname::text order by a.attname) from pg_attribute a join pg_trigger t2 on t2.oid = tg.oid
                  where a.attrelid = t2.tgrelid and a.attnum = any(t2.tgattr::int2[]))
                = array['aliado_id','comision_valor','descontada_en_precio','numero_contrato','pct_comision','pct_recobro_aliado','recobro_total'])::text from tg), 'true', true),
    (12, 'su función es SECURITY DEFINER con search_path fijo y sin EXECUTE para anon/authenticated',
         (select (prosecdef and proconfig @> array['search_path=public, pg_temp'] and not has_function_privilege('anon', fid, 'execute') and not has_function_privilege('authenticated', fid, 'execute'))::text from tg), 'true', true),
    (13, 'guardas previas de aliados_b2b intactas (neto_sin_segunda, neto_no_borrar, proteger_abonos)',
         (select count(*)::text from pg_trigger where tgrelid = 'public.aliados_b2b'::regclass and tgenabled <> 'D'
            and tgname in ('trg_aliados_b2b_neto_sin_segunda', 'trg_aliados_b2b_neto_no_borrar', 'trg_aliados_b2b_proteger_abonos')), '3', true),
    (20, 'INFO · duplicados históricos (contrato+aliado con >1 fila): siguen como estaban, sin tocar',
         (select count(*)::text from (select 1 from public.aliados_b2b where aliado_id is not null group by numero_contrato, aliado_id having count(*) > 1) d), 'informativo', false)
),
r as (
  select orden, control, obs as observado, esp as esperado,
         case when not critico then 'INFO' when obs = esp then 'OK' else 'FALLA' end as estado
    from v
)
select orden, control, observado, esperado, estado from r
union all
select 99, 'VEREDICTO', (select count(*) from r where estado = 'FALLA')::text || ' falla(s)', '0 fallas',
       case when (select count(*) from r where estado = 'FALLA') = 0 then 'CORRECTA' else 'REVISAR' end
order by orden;
