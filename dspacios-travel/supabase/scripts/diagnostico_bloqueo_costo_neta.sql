-- READ-ONLY diagnostic (one integral query). It only SELECTs; it writes nothing. Run remotely only by the owner.
-- Purpose: find CANDIDATES for the bug "bloqueo air cost/CxP taken from tarifa_para_empaquetar instead of tarifa_neta".
--
-- IMPORTANT — these are ESTIMATES, not confirmed historical errors. Basis (also repeated in the output):
--   * CURRENT bloqueos_vuelo.tarifa_neta / tarifa_para_empaquetar / fee_infante (a tariff edited after the sale can create or hide a match);
--   * CURRENT seats: sillas.numero_contrato with estado en_plazo/confirmada (transfers, returned seats or later state changes alter the count);
--   * infants without seat bounded by fee_infante × (ventas.pax − seats); a match inside the interval is not proof of the original inputs;
--   * contracts with a bloqueo flight but no current seat link are listed as NO_EVALUABLE, never as unaffected.
-- Nothing is inferred or backfilled. Whether and how to correct anything is an owner/accounting decision after reviewing the candidates.
--
-- Columns: control | detalle | observado | esperado_neta | esperado_reventa | veredicto | base
-- Verdicts: CONSISTENTE_CON_NETA | CANDIDATO_REVENTA (cost matches the resale estimate, not the net) | SIN_DIFERENCIA_POSIBLE (net = resale) |
--           SIN_NETA_ACTUAL (bloqueo has no net today) | REVISAR (other currency, several currencies or no match) | NO_EVALUABLE (no current seat link).
with hoy as (select (now() at time zone 'America/Bogota')::date as fecha),
asientos as (
  select s.numero_contrato, s.bloqueo_id, count(*) as sillas
  from public.sillas s
  where s.numero_contrato is not null and s.estado in ('en_plazo', 'confirmada')
  group by s.numero_contrato, s.bloqueo_id
),
por_contrato as (
  select a.numero_contrato,
         string_agg(distinct b.record, ',' order by b.record) as records,
         count(distinct b.moneda) as monedas,
         bool_or(b.tarifa_neta is null or b.tarifa_neta <= 0) as sin_neta,
         bool_and(coalesce(b.tarifa_neta, -1) = b.tarifa_para_empaquetar) as neutro,
         sum(a.sillas) as sillas,
         sum(a.sillas * coalesce(b.tarifa_neta, 0)) as neta_min,
         sum(a.sillas * b.tarifa_para_empaquetar) as reventa_min,
         max(b.moneda) as moneda_bloqueo,
         sum(b.fee_infante) as fee
  from asientos a
  join public.bloqueos_vuelo b on b.id = a.bloqueo_id
  group by a.numero_contrato
),
detalle as (
  select v.numero_contrato, pc.records, v.estado, v.moneda as moneda_contrato,
         v.costo_aereo as observado, pc.neta_min as esperado_neta, pc.reventa_min as esperado_reventa,
         case
           when pc.sin_neta then 'SIN_NETA_ACTUAL'
           when pc.monedas > 1 or coalesce(v.moneda, 'COP') <> coalesce(pc.moneda_bloqueo, 'COP') then 'REVISAR'
           when pc.neutro then 'SIN_DIFERENCIA_POSIBLE'
           when v.costo_aereo between pc.neta_min and pc.neta_min + greatest(coalesce(v.pax, 0) - pc.sillas, 0) * pc.fee then 'CONSISTENTE_CON_NETA'
           when v.costo_aereo between pc.reventa_min and pc.reventa_min + greatest(coalesce(v.pax, 0) - pc.sillas, 0) * pc.fee then 'CANDIDATO_REVENTA'
           else 'REVISAR'
         end as veredicto
  from por_contrato pc
  join public.ventas v on v.numero_contrato = pc.numero_contrato
),
no_evaluables as (
  select v.numero_contrato, string_agg(distinct cv.record, ',' order by cv.record) as records, v.estado, v.moneda as moneda_contrato, v.costo_aereo as observado
  from public.ventas v
  join public.contrato_vuelos cv on cv.numero_contrato = v.numero_contrato
  join public.bloqueos_vuelo b on b.record = cv.record
  where coalesce(v.costo_aereo, 0) > 0 and v.numero_contrato not in (select numero_contrato from por_contrato)
  group by v.numero_contrato, v.estado, v.moneda, v.costo_aereo
),
base as (select 'ESTIMADO con tarifas y sillas ACTUALES; no confirma el costo original' as txt)
select 'contrato (candidato/estimado)' as control,
       d.numero_contrato || ' [' || d.records || '] ' || coalesce(d.estado, '-') || ' ' || coalesce(d.moneda_contrato, '-') as detalle,
       d.observado, d.esperado_neta, d.esperado_reventa, d.veredicto, (select txt from base) as base
from detalle d
where d.veredicto in ('CANDIDATO_REVENTA', 'REVISAR', 'SIN_NETA_ACTUAL')
union all
select 'contrato NO evaluable (sin sillas vigentes enlazadas; no se presume sin error)',
       n.numero_contrato || ' [' || n.records || '] ' || coalesce(n.estado, '-') || ' ' || coalesce(n.moneda_contrato, '-'),
       n.observado, null, null, 'NO_EVALUABLE', (select txt from base)
from no_evaluables n
union all
select 'resumen: contratos por veredicto (estimado)', d.veredicto || ' (' || count(*) || ')', null, null, null, d.veredicto, (select txt from base)
from detalle d group by d.veredicto
union all
select 'resumen: contratos NO evaluables', count(*)::text, null, null, null, 'NO_EVALUABLE', (select txt from base) from no_evaluables
union all
select 'resumen: diferencia ESTIMADA de los candidatos (sillas × (reventa − neta) actuales; no confirmada)',
       d.moneda_contrato, sum(d.esperado_reventa - d.esperado_neta), null, null, 'CANDIDATO_REVENTA', (select txt from base)
from detalle d where d.veredicto = 'CANDIDATO_REVENTA' group by d.moneda_contrato
union all
select 'resumen: bloqueos vigentes sin neta (bloquean nuevas reservas hasta cargar la neta; corte = hoy en Bogotá ' || (select fecha from hoy)::text || ')',
       coalesce(string_agg(b.record, ',' order by b.record), '-'), count(*), 0, null,
       case when count(*) = 0 then 'OK' else 'REVISAR' end, 'dato actual de bloqueos_vuelo'
from public.bloqueos_vuelo b
where (b.tarifa_neta is null or b.tarifa_neta <= 0) and coalesce(b.fecha_ida, (select fecha from hoy)) >= (select fecha from hoy)
order by 1, 2;
