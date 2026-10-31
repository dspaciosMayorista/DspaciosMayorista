-- CONSULTA 265 · SOLO LECTURA (sin DML) · UNA consulta integral: n · control · observado · esperado · veredicto. Pegar COMPLETA en el editor SQL de Supabase (sin begin/rollback).
-- Funciona ANTES de aplicar la 262: no nombra columnas de la 262 (lee alcance_traslado vía to_jsonb, que simplemente no existe en una base sin ella).
-- Qué busca: contratos de carrito con ventas.financiero_estado = 'pendiente' que tengan cuentas_por_pagar creadas con el texto ANTERIOR de OBS_AUTO
--   «Generado automáticamente desde el carrito (tarifario)». La RPC financiera solo reemplaza en un reintento las CxP cuyo texto empieza por marca_cxp_automatica()
--   («Generado automáticamente desde el tarifario»); esas CxP no se reconocen, y reintentar duplicaría las obligaciones. Con el código nuevo el cron NO reintenta esos
--   contratos (los deja 'pendiente' con un error claro); requieren intervención MANUAL. Esta consulta solo los localiza; no corrige ni borra nada.
-- Filas: n = 1..N un contrato por fila (REVISAR) · 90 = CxP con ese texto en contratos ya 'completo' (INFO: NO son un problema) · 99 = VEREDICTO GLOBAL.
with
pend as (
    select v.numero_contrato, v.tenant, v.financiero_actualizado_en
      from public.ventas v where v.financiero_estado = 'pendiente'
),
viejas as (
    select c.id, c.numero_contrato from public.cuentas_por_pagar c where c.observaciones like 'Generado automáticamente desde el carrito (tarifario)%'
),
casos as (
    select p.numero_contrato, p.tenant,
           round(extract(epoch from (now() - p.financiero_actualizado_en)) / 3600.0, 1) as horas_pendiente,
           coalesce(f.intentos, 0) as intentos, left(coalesce(f.ultimo_error, '-'), 120) as ultimo_error, (f.numero_contrato is not null) as con_payload,
           (select count(*) from viejas w where w.numero_contrato = p.numero_contrato) as cxp_texto_anterior,
           (select count(*) from viejas w where w.numero_contrato = p.numero_contrato
               and (exists (select 1 from public.cxp_pagos x where x.cuenta_por_pagar_id = w.id) or exists (select 1 from public.retenciones_cxp r where r.cuenta_por_pagar_id = w.id))) as con_pagos_o_retenciones,
           (select count(*) from public.contrato_servicios s where s.numero_contrato = p.numero_contrato and (to_jsonb(s) ->> 'alcance_traslado') is not null) as lineas_con_alcance
      from pend p left join public.contrato_financiero_pendiente f on f.numero_contrato = p.numero_contrato
     where exists (select 1 from viejas w where w.numero_contrato = p.numero_contrato)
),
c(n, control, observado, esperado, veredicto) as (
    select (row_number() over (order by k.horas_pendiente desc, k.numero_contrato))::int,
           'contrato ' || k.numero_contrato || ' (' || coalesce(k.tenant, '-') || ') pendiente con CxP de texto anterior',
           'pendiente desde hace ' || k.horas_pendiente::text || ' h · payload=' || k.con_payload::text || ' · intentos=' || k.intentos::text || ' · ultimo_error=' || k.ultimo_error
             || ' · CxP texto anterior=' || k.cxp_texto_anterior::text || ' · con pagos/retenciones=' || k.con_pagos_o_retenciones::text || ' · líneas con alcance=' || k.lineas_con_alcance::text,
           'ningún caso (resolver a mano)', 'REVISAR'
      from casos k
    union all
    select 90, 'CxP con el texto anterior en contratos ya COMPLETOS (históricas normales: NO son un problema)',
           (select count(*) from viejas w join public.ventas v on v.numero_contrato = w.numero_contrato where v.financiero_estado = 'completo')::text || ' de ' || (select count(*) from viejas)::text || ' CxP con ese texto en total',
           'informativo', 'INFO'
)
select n, control, observado, esperado, veredicto from c
union all
select 99, 'VEREDICTO GLOBAL', 'contratos pendientes con CxP de texto anterior: ' || (select count(*) from casos)::text, '0',
       case when (select count(*) from casos) > 0 then 'HAY CASOS (' || (select count(*) from casos)::text || ')' else 'LIMPIO' end
order by n;
