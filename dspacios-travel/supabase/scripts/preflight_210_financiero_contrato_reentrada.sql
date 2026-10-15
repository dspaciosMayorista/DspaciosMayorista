-- ───────────────────────────────────────────────────────────────────────────
-- PREFLIGHT 210 · cierre de K15. SOLO LECTURA (termina en ROLLBACK).
-- Correr ANTES de aplicar la 210. Una fila por verificación: código | nivel | cantidad | detalle.
-- Niveles: BLOQUEANTE (no aplicar hasta resolver) · REVISAR (aplicar es seguro, pero conviene
-- conocer el caso) · INFO.  No corrige nada: ningún backfill ni reparación de históricos.
-- ───────────────────────────────────────────────────────────────────────────
begin transaction read only;

with
cxp_dup as (
  select referencia, count(*) n from public.asientos_contables where origen = 'cxp' group by referencia having count(*) > 1
),
pendientes as (
  select v.numero_contrato, v.tenant, v.financiero_actualizado_en from public.ventas v where v.financiero_estado = 'pendiente'
),
residuo as (
  select p.numero_contrato from public.contrato_financiero_pendiente p
    join public.ventas v on v.numero_contrato = p.numero_contrato where v.financiero_estado <> 'pendiente'
),
cxp_sin_asiento as (
  select c.id from public.cuentas_por_pagar c
   where not exists (select 1 from public.asientos_contables a where a.origen = 'cxp' and a.referencia = 'cxp:' || c.id)
),
pend_con_cxp as (
  select distinct c.numero_contrato from public.cuentas_por_pagar c
    join public.ventas v on v.numero_contrato = c.numero_contrato
   where v.financiero_estado = 'pendiente' and c.observaciones like public.marca_cxp_automatica() || '%'
),
chequeos as (
  select 'P1' as codigo,
         case when to_regprocedure('public.registrar_financiero_contrato(text,text,jsonb,jsonb)') is null
                or to_regprocedure('public.revertir_contrato_incompleto(text,text)') is null
                or to_regclass('public.contrato_financiero_pendiente') is null then 'BLOQUEANTE' else 'INFO' end as nivel,
         (to_regprocedure('public.registrar_financiero_contrato(text,text,jsonb,jsonb)') is not null)::int
           + (to_regprocedure('public.revertir_contrato_incompleto(text,text)') is not null)::int as cantidad,
         'Funciones de las migraciones 171/172 y tabla contrato_financiero_pendiente presentes' as detalle
  union all
  select 'P2', case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ventas' and column_name = 'financiero_registrado_en')
                      or to_regclass('public.asientos_contables_cxp_referencia_uk') is not null then 'BLOQUEANTE' else 'INFO' end,
         (exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ventas' and column_name = 'financiero_registrado_en'))::int,
         '210 aún no aplicada (ni la columna financiero_registrado_en ni el índice único de asientos cxp)'
  union all
  select 'P3', case when count(*) = 0 then 'INFO' else 'BLOQUEANTE' end, count(*)::int,
         'Asientos origen=cxp DUPLICADOS por referencia (el índice único no se puede crear; la migración se niega): '
         || coalesce(string_agg(referencia || ' x' || n, ', '), 'ninguno')
    from cxp_dup
  union all
  select 'P4', 'INFO', count(*)::int,
         'Contratos en financiero_estado=pendiente ahora: ' || count(*) || ' (de ellos, con más de 5 min: '
         || count(*) filter (where financiero_actualizado_en < now() - interval '5 minutes') || ')'
    from pendientes
  union all
  select 'P5', case when count(*) = 0 then 'INFO' else 'REVISAR' end, count(*)::int,
         'Filas de contrato_financiero_pendiente sobre contratos YA completos (residuo histórico; la 210 no las borra ni las repara, solo evita nuevas y la RPC limpia la del contrato que toque): '
         || coalesce(string_agg(numero_contrato, ', '), 'ninguna')
    from residuo
  union all
  select 'P6', case when count(*) = 0 then 'INFO' else 'REVISAR' end, count(*)::int,
         'Contratos PENDIENTES que ya tienen CxP automáticas (anomalía: un reintento las reemplazará una vez): '
         || coalesce(string_agg(numero_contrato, ', '), 'ninguno')
    from pend_con_cxp
  union all
  select 'P7', 'INFO', count(*)::int, 'CxP sin asiento de devengo (las completa la reconciliación; la 210 no toca asientos)' from cxp_sin_asiento
  union all
  select 'P8', 'INFO', 1, 'Despliegue: el código nuevo de financieroContrato.ts funciona sin la 210 (la RPC vieja no responde ya_completo) y la 210 funciona con el código viejo. Ver el plan de contención del informe.'
)
select codigo, nivel, cantidad, left(detalle, 900) as detalle from chequeos order by length(codigo), codigo;

select case when exists (
  select 1 from (values (1)) x
   where to_regprocedure('public.registrar_financiero_contrato(text,text,jsonb,jsonb)') is null
      or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ventas' and column_name = 'financiero_registrado_en')
      or exists (select 1 from public.asientos_contables where origen = 'cxp' group by referencia having count(*) > 1)
) then 'PREFLIGHT: hay BLOQUEANTES (P1/P2/P3); no aplicar.' else 'PREFLIGHT: sin bloqueantes; revisa P5/P6.' end as veredicto;

rollback;
