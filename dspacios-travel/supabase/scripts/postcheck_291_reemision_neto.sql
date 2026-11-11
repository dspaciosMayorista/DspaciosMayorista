-- POSTCHECK de la migración 291 (#75). SOLO LECTURA: una consulta, un resultado. Última fila: VEREDICTO («CORRECTA» solo sin FALLA).
with rpc as (select p.oid, p.prosecdef, p.proconfig, p.prosrc from pg_proc p where p.oid = to_regprocedure('public.reemitir_neto_pendiente(text,jsonb,boolean)')),
tg as (select p.prosrc, obj_description(p.oid, 'pg_proc') as nota from pg_proc p where p.oid = to_regprocedure('public.tg_aliados_b2b_proteger_abonos()')),
v(orden, control, obs, esp, critico) as (
  values
    (1,  'la RPC existe, SECURITY DEFINER con search_path = public, pg_temp', (select (count(*) = 1 and bool_and(prosecdef and proconfig @> array['search_path=public, pg_temp']))::text from rpc), 'true', true),
    (2,  'anon NO ejecuta la RPC; authenticated SÍ (y adentro exige superadmin)',
         (select (not has_function_privilege('anon', oid, 'execute') and has_function_privilege('authenticated', oid, 'execute') and prosrc like '%v_rol <> ''superadmin''%')::text from rpc), 'true', true),
    (3,  'la RPC bloquea la venta y exige pendiente sin pagos, soportes, cuotas ni facturación',
         (select (prosrc like '%for update%' and prosrc like '%estado is distinct from ''pendiente''%' and prosrc like '%from public.abonos%'
                  and prosrc like '%contrato_soportes_pago%' and prosrc like '%from public.cuotas%' and prosrc like '%contrato_facturacion%')::text from rpc), 'true', true),
    (4,  'proteger_abonos es la 291 (comentario V291) y conserva las reglas de la 205',
         (select (nota like 'V291%' and prosrc like '%alteraría su total%' and prosrc like '%El asesor solo puede corregir%' and prosrc like '%app.p291_reemision%')::text from tg), 'true', true),
    (5,  'serialización con abonos: la RPC bloquea la venta FOR UPDATE (no NO KEY) y existe la FK abonos → ventas',
         (select (prosrc ~* 'from public\.ventas where numero_contrato = p_numero for update' and prosrc !~* 'for no key update'
                  and exists (select 1 from pg_constraint where conrelid = 'public.abonos'::regclass and contype = 'f' and confrelid = 'public.ventas'::regclass))::text from rpc), 'true', true),
    (6,  'guardas de aliados_b2b intactas (proteger_abonos, neto_sin_segunda, neto_no_borrar)',
         (select count(*)::text from pg_trigger where tgrelid = 'public.aliados_b2b'::regclass and tgenabled <> 'D'
            and tgname in ('trg_aliados_b2b_proteger_abonos', 'trg_aliados_b2b_neto_sin_segunda', 'trg_aliados_b2b_neto_no_borrar')), '3', true),
    (8,  'la RPC aplica la regla de margen de creación (206: 6 % con aprobación superadmin/administración; 222: p50_priv.evaluar_margen y rol_autoriza_margen)',
         (select (prosrc like '%NETO_291_MARGEN%' and prosrc like '%p50_priv.evaluar_margen%' and prosrc like '%p50_priv.rol_autoriza_margen%'
                  and prosrc like '%(''superadmin'', ''administracion'')%')::text from rpc), 'true', true),
    (7,  'ninguna sesión deja la marca de reemisión encendida (vacía fuera de la RPC)', (coalesce(current_setting('app.p291_reemision', true), '') = '')::text, 'true', true)
),
r as (select orden, control, obs as observado, esp as esperado, case when not critico then 'INFO' when obs = esp then 'OK' else 'FALLA' end as estado from v)
select orden, control, observado, esperado, estado from r
union all
select 99, 'VEREDICTO', (select count(*) from r where estado = 'FALLA')::text || ' falla(s)', '0 fallas',
       case when (select count(*) from r where estado = 'FALLA') = 0 then 'CORRECTA' else 'REVISAR' end
order by orden;
