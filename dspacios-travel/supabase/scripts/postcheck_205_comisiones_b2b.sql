-- POSTCHECK · migración 205 (comisiones B2B) — SOLO LECTURA.
-- Correr justo DESPUÉS de aplicar la 205 y ANTES de desplegar el código.
-- Transacción READ ONLY + ROLLBACK. Sin datos personales.
-- Cualquier 'FALLA' = no desplegar el código; ver el runbook.
begin;
set transaction read only;

with legado as (
  -- Lectura de origin/main (calcComisionB2B): base 0/NULL → PVP.
  select a.id,
         round(public.comision_b2b_total(a), 2) as nuevo,
         round((coalesce(nullif(a.base_comision, 0), coalesce(a.precio_venta, 0)) * coalesce(a.pct_comision, 0)
                + coalesce(a.recobro_total, 0) * coalesce(a.pct_recobro_aliado, 0.5))
               * (1 - case when a.aplica_retencion then coalesce(a.pct_retencion, 0) else 0 end), 2) as viejo
    from public.aliados_b2b a
   where a.base_explicita is null and a.comision_valor is null
),
chequeos(orden, chequeo, ok) as (
  values
  (1, 'columnas nuevas presentes',
      (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'aliados_b2b'
        and column_name in ('base_explicita','comision_valor','descontada_en_precio')) = 3),
  (2, 'base_explicita SIN default (NULL = legado para el código viejo)',
      (select column_default is null from information_schema.columns where table_schema = 'public' and table_name = 'aliados_b2b' and column_name = 'base_explicita')),
  (3, 'descontada_en_precio NOT NULL default false',
      (select is_nullable = 'NO' and column_default = 'false' from information_schema.columns where table_schema = 'public' and table_name = 'aliados_b2b' and column_name = 'descontada_en_precio')),
  (4, 'FK de abonos en RESTRICT',
      (select confdeltype = 'r' from pg_constraint where conname = 'comision_b2b_pagos_aliado_b2b_id_fkey')),
  (5, 'triggers activos',
      (select count(*) from pg_trigger where tgenabled <> 'D'
        and tgname in ('trg_aliados_b2b_proteger_abonos','trg_comision_b2b_pagos_guardas','trg_aliados_b2b_neto_no_borrar','trg_aliados_b2b_neto_sin_segunda')) = 4),
  (5, 'abonos: el trigger dispara en INSERT y en TODO UPDATE (un aumento de valor es un pago)',
      (select pg_get_triggerdef(t.oid) like '%BEFORE INSERT OR UPDATE ON public.comision_b2b_pagos%'
         from pg_trigger t where t.tgname = 'trg_comision_b2b_pagos_guardas')),
  (5, 'NETO no se borra suelta: trigger SECURITY INVOKER (decide por current_user)',
      (select not p.prosecdef from pg_proc p where p.oid = 'public.tg_aliados_b2b_neto_no_borrar()'::regprocedure)),
  (6, 'reserva: solo venta en curso (pendiente y con menos de 5 minutos)',
      (select p.prosrc like '%financiero_actualizado_en < now() - interval ''5 minutes''%'
         from pg_proc p where p.oid = 'public.registrar_comision_b2b_reserva(text,bigint)'::regprocedure)),
  (6, 'registrar_comision_b2b_reserva: SECURITY DEFINER, authenticated sí, anon no',
      (select p.prosecdef from pg_proc p where p.oid = 'public.registrar_comision_b2b_reserva(text,bigint)'::regprocedure)
      and has_function_privilege('authenticated', 'public.registrar_comision_b2b_reserva(text,bigint)', 'execute')
      and not has_function_privilege('anon', 'public.registrar_comision_b2b_reserva(text,bigint)', 'execute')),
  (6, 'registrar_comision_b2b_manual: SECURITY DEFINER, authenticated sí, anon no',
      (select p.prosecdef from pg_proc p where p.oid = 'public.registrar_comision_b2b_manual(text,text,text,text,bigint,numeric,numeric,numeric,boolean,numeric)'::regprocedure)
      and has_function_privilege('authenticated', 'public.registrar_comision_b2b_manual(text,text,text,text,bigint,numeric,numeric,numeric,boolean,numeric)', 'execute')
      and not has_function_privilege('anon', 'public.registrar_comision_b2b_manual(text,text,text,text,bigint,numeric,numeric,numeric,boolean,numeric)', 'execute')),
  (7, 'lectura: incluye venta y excluye control_vuelo',
      (select pg_get_expr(polqual, polrelid) like '%venta%' and pg_get_expr(polqual, polrelid) not like '%control_vuelo%'
         from pg_policy where polrelid = 'public.aliados_b2b'::regclass and polname = 'aliados_b2b: lectura contable')),
  (7, 'edición del asesor: solo venta y solo su contrato (soy_asesor_del_contrato)',
      (select pg_get_expr(polqual, polrelid) like '%venta%' and pg_get_expr(polqual, polrelid) like '%soy_asesor_del_contrato%'
              and pg_get_expr(polwithcheck, polrelid) like '%soy_asesor_del_contrato%'
         from pg_policy where polrelid = 'public.aliados_b2b'::regclass and polname = 'aliados_b2b: edicion asesor')),
  (7, 'policies: 5 de la 205 y ninguna "acceso contable"',
      (select count(*) from pg_policy where polrelid = 'public.aliados_b2b'::regclass
        and polname in ('aliados_b2b: lectura contable','aliados_b2b: alta contable','aliados_b2b: edicion contable',
                        'aliados_b2b: edicion asesor','aliados_b2b: borrado contable')) = 5
      and not exists (select 1 from pg_policy where polrelid = 'public.aliados_b2b'::regclass and polname = 'aliados_b2b: acceso contable')),
  (8, 'TODA comisión legado da el mismo importe que con el código viejo',
      not exists (select 1 from legado where nuevo <> viejo))
),
info(orden, chequeo, detalle) as (
  values
  (20, 'INFO comisiones legado comparadas', (select count(*)::text from legado)),
  -- Justo tras la migración deben ser 0; tras desplegar el código nuevo
  -- crecen (es lo esperado). Si son > 0, el rollback SQL ya NO es seguro.
  (21, 'INFO filas con semántica 205 (base explícita / por valor / NETO marcada)',
      (select count(*) filter (where base_explicita is not null)::text || ' / ' ||
              count(*) filter (where comision_valor is not null)::text || ' / ' ||
              count(*) filter (where descontada_en_precio)::text from public.aliados_b2b))
)
select orden, case when ok then 'OK' else 'FALLA' end as resultado, chequeo from chequeos
union all
select orden, 'INFO', chequeo || ': ' || detalle from info
order by orden;

rollback;
