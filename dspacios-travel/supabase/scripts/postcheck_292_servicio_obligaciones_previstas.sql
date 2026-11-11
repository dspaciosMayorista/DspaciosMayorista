-- POSTCHECK de la migración 292 (#75). SOLO LECTURA: una consulta, un resultado. Última fila: VEREDICTO («CORRECTA» solo sin FALLA).
with fn(oid, nombre) as (
  select to_regprocedure(x), x from unnest(array['public.tg_servicio_con_previstas()', 'public.tg_prevista_valida()', 'public.tg_linea_enlazada_protegida()',
                                                 'p75_priv.clave_enlace_de(text)', 'p75_priv.prevista_enlaza_linea(text,bigint,uuid)']) x
),
v(orden, control, obs, esp) as (
  values
    (1, 'las 5 funciones existen', (select count(*) from fn where oid is not null)::text, '5'),
    (2, 'ninguna es ejecutable por anon ni authenticated', (select count(*) from fn where oid is not null and (has_function_privilege('anon', oid, 'execute') or has_function_privilege('authenticated', oid, 'execute')))::text, '0'),
    (3, 'triggers activos: servicio_con_previstas (BEFORE DELETE servicios_adicionales), prevista_valida (previstas), linea_enlazada_protegida (contrato_servicios)',
        (select count(*) from pg_trigger t where not t.tgisinternal and t.tgenabled = 'O' and (
            (t.tgname = 'servicio_con_previstas' and t.tgrelid = 'public.servicios_adicionales'::regclass) or
            (t.tgname = 'prevista_valida' and t.tgrelid = 'public.contrato_obligaciones_previstas'::regclass) or
            (t.tgname = 'linea_enlazada_protegida' and t.tgrelid = 'public.contrato_servicios'::regclass)))::text, '3'),
    (4, 'la guarda de línea considera las previstas y conserva los mensajes de la 265',
        (select (prosrc like '%p75_priv.prevista_enlaza_linea%' and prosrc like '%cuenta por pagar enlazada y no se puede borrar%' and prosrc like '%app.enlace_cxp_autorizado%')::text
           from pg_proc where oid = to_regprocedure('public.tg_linea_enlazada_protegida()')), 'true'),
    (5, 'la prevista bloquea línea (FOR UPDATE) y servicio (FOR KEY SHARE)',
        (select (prosrc like '%for update%' and prosrc like '%for key share%')::text from pg_proc where oid = to_regprocedure('public.tg_prevista_valida()')), 'true'),
    (6, 'triggers de la 265 en cuentas_por_pagar intactos (cxp_enlace_por_clave, cxp_enlace_inmutable)',
        (select count(*) from pg_trigger where tgrelid = 'public.cuentas_por_pagar'::regclass and tgname in ('cxp_enlace_por_clave', 'cxp_enlace_inmutable') and tgenabled = 'O')::text, '2'),
    (7, 'índice de previstas por servicio', (to_regclass('public.contrato_obligaciones_previstas_servicio_idx') is not null)::text, 'true'),
    (8, 'el reuso DTM sigue apagado', coalesce((select habilitado::text from public.dtm_reuso_config limit 1), 'sin fila'), 'false')
),
r as (select orden, control, obs as observado, esp as esperado, case when obs = esp then 'OK' else 'FALLA' end as estado from v)
select orden, control, observado, esperado, estado from r
union all
select 99, 'VEREDICTO', (select count(*) from r where estado = 'FALLA')::text || ' falla(s)', '0 fallas',
       case when (select count(*) from r where estado = 'FALLA') = 0 then 'CORRECTA' else 'REVISAR' end
order by orden;
