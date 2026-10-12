-- PREFLIGHT · #30 (contratos B2B NETO) — SOLO LECTURA.
-- Correr ANTES de desplegar el código de #30 en Producción. Transacción
-- READ ONLY + ROLLBACK. Sin datos personales ni importes por contrato: solo
-- conteos y sumas agregadas por mes.
--
-- Qué mide: los contratos vendidos en NETO (comision_estado = 'descontada')
-- que ya existen, sobre todo los creados desde #38 (merge e06a00f6,
-- 2026-10-10). #30 cambia la PRESENTACIÓN y la LIQUIDACIÓN de estos contratos
-- sin reescribir ningún dato:
--   · el documento del contrato deja de mostrar como total la suma de ítems a
--     PVP y muestra el total exigible (precio_venta);
--   · la liquidación del asesor interno (se calcula al vuelo, no se guarda)
--     pasa a usar el PVP original = precio_venta + comision_b2b.
-- Si alguno de estos contratos cae en un mes YA liquidado y pagado al asesor,
-- su vista mensual cambiaría: el dueño decide antes de desplegar.
--
-- Fecha de corte: ajustar `desde_38` si el despliegue de #38 en Producción fue
-- en otra fecha.
begin;
set transaction read only;

with params as (
  select date '2026-10-10' as desde_38,
         date_trunc('month', (now() at time zone 'America/Bogota'))::date as mes_actual
),
neto as (
  select v.numero_contrato, v.estado, v.fecha_venta, v.created_at, v.moneda,
         coalesce(v.precio_venta, 0) as total_exigible,
         coalesce(v.comision_b2b, 0) as descuento,
         v.modo_compra,
         exists (select 1 from public.aliados_b2b b
                  where b.numero_contrato = v.numero_contrato and b.descontada_en_precio) as fila_205,
         (select count(*) from public.aliados_b2b b where b.numero_contrato = v.numero_contrato) as filas_b2b,
         coalesce((select sum(a.valor_abono) from public.abonos a where a.numero_contrato = v.numero_contrato), 0) as pagado,
         coalesce((select sum(case when i.modo_precio = 'total' then coalesce(i.valor_total, 0)
                                   else coalesce(i.adultos, 0) * coalesce(i.tarifa_adulto, 0)
                                      + coalesce(i.ninos, 0) * coalesce(i.tarifa_nino, 0) end)
                     from public.contrato_items i where i.numero_contrato = v.numero_contrato), 0) as suma_items
    from public.ventas v
   where v.comision_estado = 'descontada'
)
select 'N1 contratos NETO (total)' as chequeo, count(*)::text as valor from neto
union all
select 'N2 NETO creados desde #38', count(*)::text from neto, params where neto.created_at >= params.desde_38
union all
select 'N3 NETO con fila 205 (descontada_en_precio) / sin ella',
       count(*) filter (where fila_205)::text || ' / ' || count(*) filter (where not fila_205)::text from neto
union all
select 'N4 NETO con modo_compra distinto de neta', count(*) filter (where modo_compra is distinct from 'neta')::text from neto
union all
select 'N5 NETO con 0 o 2+ filas de aliados_b2b', count(*) filter (where filas_b2b <> 1)::text from neto
union all
-- Incidencia del documento: un NETO donde la suma de ítems no es PVP original
-- (precio + descuento) indica ítems editados; uno donde lo pagado supera el
-- total exigible pudo pagarse leyendo el total a PVP del documento viejo.
select 'N6 NETO con ítems ≠ precio + descuento (±1)', count(*) filter (where abs(suma_items - (total_exigible + descuento)) > 1)::text from neto
union all
select 'N7 NETO con pagado > total exigible (posible cobro a PVP)', count(*) filter (where pagado > total_exigible + 1)::text from neto
union all
-- Liquidación del asesor: solo estados que liquida la página (activo/confirmado).
select 'N8 NETO liquidables en meses ANTERIORES al actual (mes: n · suma descuento)',
       coalesce(string_agg(mes || ': ' || n || ' · ' || suma, ', ' order by mes), 'ninguno')
  from (select to_char(fecha_venta, 'YYYY-MM') as mes, count(*) as n, round(sum(descuento))::text as suma
          from neto, params
         where lower(coalesce(estado, '')) in ('activo','confirmado','confirmada')
           and fecha_venta < params.mes_actual
         group by 1) m
union all
select 'N9 NETO liquidables en el mes actual (n · suma descuento)',
       count(*)::text || ' · ' || coalesce(round(sum(descuento))::text, '0')
  from neto, params
 where lower(coalesce(estado, '')) in ('activo','confirmado','confirmada')
   and fecha_venta >= params.mes_actual
union all
select 'N10 NETO por moneda', coalesce(string_agg(moneda || ': ' || n, ', ' order by moneda), 'ninguno')
  from (select coalesce(moneda, '?') as moneda, count(*)::text as n from neto group by 1) x;

rollback;
