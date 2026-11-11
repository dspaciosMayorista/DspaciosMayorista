-- PREFLIGHT de la migración 291 (#75). SOLO LECTURA: una consulta, un resultado. Columnas: orden | control | observado | esperado | estado.
-- estado: OK · FALLA (no aplicar) · INFO. Última fila: VEREDICTO.
with fn as (
  select md5(replace(p.prosrc, chr(13), '')) as huella, obj_description(p.oid, 'pg_proc') as nota
    from pg_proc p where p.oid = to_regprocedure('public.tg_aliados_b2b_proteger_abonos()')
),
v(orden, control, obs, esp, critico) as (
  values
    (1,  'tg_aliados_b2b_proteger_abonos es la de la 205 (md5 sin CR 0efb4b1c…) o ya la de la 291',
         coalesce((select case when huella = '0efb4b1c4d7961d81ea700b05e9e4ba6' then '205' when nota like 'V291%' then 'YA_291' else 'OTRA:' || huella end from fn), 'sin función'), '205', true),
    (2,  'la RPC reemitir_neto_pendiente aún no existe', (not exists (select 1 from pg_proc where proname = 'reemitir_neto_pendiente' and pronamespace = 'public'::regnamespace))::text, 'true', true),
    (3,  'FK abonos → ventas presente (serializa abono y reemisión: FOR KEY SHARE contra FOR UPDATE)',
         (select count(*)::text from pg_constraint where conrelid = 'public.abonos'::regclass and contype = 'f' and confrelid = 'public.ventas'::regclass), '1', true),
    (4,  'dependencias: identidad (284) ventas.contrato_uid',
         (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'ventas' and column_name = 'contrato_uid'), '1', true),
    (5,  'dependencias: p63_total_cobro, cuotas, contrato_facturacion, contrato_soportes_pago, comision_b2b_total/descontada',
         ((to_regprocedure('public.p63_total_cobro(numeric,text,text,numeric)') is not null) and to_regclass('public.cuotas') is not null
          and to_regclass('public.contrato_facturacion') is not null and to_regclass('public.contrato_soportes_pago') is not null
          and (select count(*) from pg_proc where proname in ('comision_b2b_total', 'comision_b2b_descontada')) >= 2)::text, 'true', true),
    (6,  'guardas de la 205 presentes sobre aliados_b2b (proteger_abonos, neto_sin_segunda, neto_no_borrar)',
         (select count(*)::text from pg_trigger where tgrelid = 'public.aliados_b2b'::regclass and tgenabled <> 'D'
            and tgname in ('trg_aliados_b2b_proteger_abonos', 'trg_aliados_b2b_neto_sin_segunda', 'trg_aliados_b2b_neto_no_borrar')), '3', true),
    (10, 'INFO · contratos NETO pendientes (los que podrían reemitirse si no tienen pagos)',
         (select count(*)::text from public.ventas where comision_estado = 'descontada' and modo_compra = 'neta' and estado = 'pendiente'), 'informativo', false),
    (11, 'INFO · de ellos, sin abonos ni soportes vigentes ni cuotas ni facturación',
         (select count(*)::text from public.ventas v where v.comision_estado = 'descontada' and v.modo_compra = 'neta' and v.estado = 'pendiente'
            and not exists (select 1 from public.abonos a where a.numero_contrato = v.numero_contrato)
            and not exists (select 1 from public.cuotas q where q.numero_contrato = v.numero_contrato)
            and not exists (select 1 from public.contrato_facturacion f where f.numero_contrato = v.numero_contrato)), 'informativo', false)
),
r as (select orden, control, obs as observado, esp as esperado, case when not critico then 'INFO' when obs = esp then 'OK' else 'FALLA' end as estado from v)
select orden, control, observado, esperado, estado from r
union all
select 99, 'VEREDICTO', (select count(*) from r where estado = 'FALLA')::text || ' falla(s)', '0 fallas',
       case when exists (select 1 from r where estado = 'FALLA') then 'NO APLICAR' else 'LISTO PARA APLICAR LA 291' end
order by orden;
