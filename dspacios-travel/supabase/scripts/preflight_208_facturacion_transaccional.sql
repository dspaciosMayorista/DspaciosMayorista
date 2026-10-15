-- ───────────────────────────────────────────────────────────────────────────
-- PREFLIGHT 208 · facturación transaccional. SOLO LECTURA (termina en ROLLBACK).
-- Correr ANTES de aplicar la 208. Una fila por verificación:
--   código | nivel | cantidad | detalle
-- Niveles: BLOQUEANTE (no aplicar hasta resolver) · REVISAR (aplicar es seguro,
-- pero el dueño debe conocer el caso) · INFO.
-- No corrige nada: ningún backfill ni reparación automática de históricos.
-- ───────────────────────────────────────────────────────────────────────────
begin transaction read only;

with
ventas_t as (select numero_contrato, tenant from public.ventas),
fact as (
  select a.referencia, substr(a.referencia, 13) as numero, a.tenant,
         count(*) filter (where a.origen = 'facturacion') as f,
         count(*) filter (where a.origen = 'facturacion_reversion') as r
    from public.asientos_contables a
   where a.origen in ('facturacion', 'facturacion_reversion')
   group by a.referencia, a.tenant
),
vacios as (
  select a.id, a.referencia, a.origen from public.asientos_contables a
   where a.origen in ('facturacion', 'facturacion_reversion')
     and not exists (select 1 from public.asiento_lineas l where l.asiento_id = a.id)
),
abonos_fuera as (
  select b.id, b.numero_contrato, b.tenant, coalesce(b.monto_cop, 0) as cop
    from public.abonos b
   where coalesce(b.monto_cop, b.valor_abono, 0) <> 0
     and not exists (select 1 from public.asientos_contables a
                      where a.tenant = b.tenant
                        and ((a.origen = 'abono' and a.referencia = 'abono:' || b.id)
                          or (a.origen = 'pago_previo_aplicacion' and a.referencia like 'pago_previo:%:abono:' || b.id)))
),
pucs as (
  select t.tenant, c.codigo
    from (select distinct tenant from public.ventas) t
    cross join unnest(array['110505','111005','111010','130505','280505','281510','413505','280510']) c(codigo)
   where not exists (select 1 from public.puc_cuentas p where p.tenant = t.tenant and p.codigo = c.codigo)
),
chequeos as (
  select 'P1' as codigo, case when to_regprocedure('public.aplicar_neto_contrato_manual(text,bigint,numeric)') is null then 'BLOQUEANTE' else 'INFO' end as nivel,
         (to_regprocedure('public.aplicar_neto_contrato_manual(text,bigint,numeric)') is not null)::int as cantidad,
         'Migración 206 aplicada (secuencia 207 → #44 → 206 → 208)' as detalle
  union all
  select 'P2', case when to_regclass('public.factura_revision_fuera_libros') is not null or to_regnamespace('f208_priv') is not null then 'BLOQUEANTE' else 'INFO' end,
         (to_regclass('public.factura_revision_fuera_libros') is not null)::int + (to_regnamespace('f208_priv') is not null)::int,
         '208 aún no aplicada (ni tabla de constancias ni esquema f208_priv)'
  union all
  select 'P3', case when count(*) = 5 then 'INFO' else 'BLOQUEANTE' end, count(*)::int,
         'Funciones base: _siguiente_numero_asiento, _cuenta_disponible, fecha_negocio, mi_rol, puede_ver_tenant'
    from (values (to_regprocedure('public._siguiente_numero_asiento(text)')), (to_regprocedure('public._cuenta_disponible(text,text)')),
                 (to_regprocedure('public.fecha_negocio(timestamptz)')), (to_regprocedure('public.mi_rol()')),
                 (to_regprocedure('public.puede_ver_tenant(text)'))) x(f) where f is not null
  union all
  select 'P4', case when count(*) = 0 then 'INFO' else 'BLOQUEANTE' end, count(*)::int,
         'Cuentas PUC faltantes por agencia (facturar/postear darían F4416): ' || coalesce(string_agg(tenant || ':' || codigo, ', '), 'ninguna')
    from pucs
  union all
  select 'P5', case when count(*) = 0 then 'INFO' else 'REVISAR' end, count(*)::int,
         'Facturas vigentes SIN configuración (residuo RACE-1): ' || coalesce(string_agg(f.numero, ', '), 'ninguna')
    from fact f where f.f - f.r = 1 and not exists (select 1 from public.contrato_facturacion c where c.numero_contrato = f.numero)
  union all
  select 'P6', case when count(*) = 0 then 'INFO' else 'REVISAR' end, count(*)::int,
         'Configuraciones SIN factura vigente (PVP 0, COMP-1 o históricas): ' || coalesce(string_agg(c.numero_contrato, ', '), 'ninguna')
    from public.contrato_facturacion c
    join ventas_t v on v.numero_contrato = c.numero_contrato
   where coalesce((select f.f - f.r from fact f where f.numero = c.numero_contrato and f.tenant = v.tenant), 0) <> 1
  union all
  select 'P7', case when count(*) = 0 then 'INFO' else 'BLOQUEANTE' end, count(*)::int,
         'Encabezados de factura/reversa SIN líneas (residuo COMP-1; falsean la vigencia): ' || coalesce(string_agg(referencia || '#' || id, ', '), 'ninguno')
    from vacios
  union all
  select 'P8', case when count(*) = 0 then 'INFO' else 'REVISAR' end, count(*)::int,
         'Factura vigente en una agencia distinta a la del contrato (facturar daría F4412): ' || coalesce(string_agg(f.numero || '@' || f.tenant, ', '), 'ninguna')
    from fact f join ventas_t v on v.numero_contrato = f.numero where f.tenant <> v.tenant and f.f > f.r
  union all
  select 'P9', case when count(*) = 0 then 'INFO' else 'BLOQUEANTE' end, count(*)::int,
         'Contratos con MÁS de una factura vigente o más reversas que facturas: ' || coalesce(string_agg(f.numero || '(' || f.f || '/' || f.r || ')', ', '), 'ninguno')
    from fact f where f.f - f.r > 1 or f.f - f.r < 0
  union all
  select 'P10', case when count(*) = 0 then 'INFO' else 'REVISAR' end, count(*)::int,
         'Marcadas DIAN SIN factura vigente (tras la 208 la marca es inmutable): ' || coalesce(string_agg(c.numero_contrato, ', '), 'ninguna')
    from public.contrato_facturacion c join ventas_t v on v.numero_contrato = c.numero_contrato
   where c.dian_emitida and coalesce((select f.f - f.r from fact f where f.numero = c.numero_contrato and f.tenant = v.tenant), 0) <> 1
  union all
  select 'P11', case when count(*) = 0 then 'INFO' else 'REVISAR' end, count(*)::int,
         'Asientos de factura de contratos que ya no existen: ' || coalesce(string_agg(distinct f.numero, ', '), 'ninguno')
    from fact f where not exists (select 1 from ventas_t v where v.numero_contrato = f.numero)
  union all
  select 'P12', 'INFO', count(*)::int,
         'Abonos sin asiento (fuera de libros; al facturar pedirán revisión + constancia): '
         || coalesce((select string_agg(tenant || ' ' || n || ' abonos / ' || c || ' contratos / $' || to_char(s, 'FM999G999G999G990'), '; ')
                        from (select tenant, count(*) n, count(distinct numero_contrato) c, sum(cop) s from abonos_fuera group by tenant) z), 'ninguno')
    from abonos_fuera
  union all
  select 'P13', 'INFO', count(*)::int, 'Asientos de abono cuyo abono ya no existe (huérfanos previos; la 208 no los toca)'
    from public.asientos_contables a
   where a.origen = 'abono' and a.referencia ~ '^abono:[0-9]+$'
     and not exists (select 1 from public.abonos b where 'abono:' || b.id = a.referencia)
  union all
  select 'P14', case when count(*) = 0 then 'INFO' else 'REVISAR' end, count(*)::int,
         'Disparadores ajenos sobre contrato_facturacion/asientos (verificar que no choquen): ' || coalesce(string_agg(tgrelid::regclass || '.' || tgname, ', '), 'ninguno')
    from pg_trigger
   where tgrelid in ('public.contrato_facturacion'::regclass, 'public.asientos_contables'::regclass, 'public.asiento_lineas'::regclass)
     and not tgisinternal and tgname not like 'trg_f208_%'
  union all
  select 'P15', 'INFO', count(*)::int, 'Abonos existentes (quedan ANTES del corte de la 208; los nuevos de la app deben tener asiento)'
    from public.abonos
  union all
  select 'P16', 'INFO', 1,
         'PostgREST: confirma en Settings → API → Exposed schemas que NO se agregue f208_priv (solo public/graphql_public).'
)
select codigo, nivel, cantidad, left(detalle, 900) as detalle from chequeos order by length(codigo), codigo;

select case when exists (
  select 1 from (values (1)) x
   where to_regprocedure('public.aplicar_neto_contrato_manual(text,bigint,numeric)') is null
      or to_regclass('public.factura_revision_fuera_libros') is not null
) then 'PREFLIGHT: hay BLOQUEANTES estructurales; revisa P1/P2 (y P3/P4/P7/P9 arriba).'
  else 'PREFLIGHT: revisa la tabla; aplicar solo si no hay filas BLOQUEANTE.' end as veredicto;

rollback;
