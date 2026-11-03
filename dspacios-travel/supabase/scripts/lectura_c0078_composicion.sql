-- LECTURA C-0078 · solo lectura · UNA consulta con columna `estado` (pegar tal cual en el editor SQL; no escribe nada, no reconstruye desde tarifas actuales).
-- Pregunta: ¿C-0078 tiene datos CONGELADOS suficientes para recuperar su composición de forma exacta?
-- Exacta = la neta total del hotel, el % de markup y el precio de venta quedaron congelados al valorar (cotizacion_tarifa_solicitud) y los renglones de
-- cotizaciones.detalle suman el precio de venta. Lo que NO está congelado (neto por vuelo/servicio incluido, redondeo) se marca FALTA: ahí no hay recuperación exacta.
with c as (
  select * from public.cotizaciones where codigo = 'C-0078'
), it as (
  select c.id,
         count(*) as n_items,
         coalesce(sum(coalesce((i->>'adultos')::numeric, 0) * coalesce((i->>'tarifa_adulto')::numeric, 0)
                    + coalesce((i->>'ninos')::numeric, 0)   * coalesce((i->>'tarifa_nino')::numeric, 0)), 0) as suma_items
    from c left join lateral jsonb_array_elements(case when jsonb_typeof(c.detalle->'items') = 'array' then c.detalle->'items' else '[]'::jsonb end) i on true
   group by c.id
), s as (
  select t.* from public.cotizacion_tarifa_solicitud t join c on c.id = t.cotizacion_id and t.item_ref = 'hotel'
)
select 1 as ord, 'cotización C-0078 existe' as dato,
       case when exists (select 1 from c) then 'OK' else 'NO EXISTE' end as estado,
       coalesce((select 'id=' || id || ' · tenant=' || coalesce(tenant, 'NULL') || ' · estado=' || estado || ' · moneda=' || coalesce(moneda, '?') || ' · precio_venta=' || coalesce(precio_venta::text, 'NULL') from c), '') as detalle
union all
select 2, 'neta del hotel congelada (cotizacion_tarifa_solicitud)',
       case when exists (select 1 from s) then 'OK' else 'FALTA' end,
       coalesce((select 'neta=' || neta || ' ' || moneda || ' · pct_mk=' || pct_mk || ' · precio_venta=' || precio_venta || ' · cargada_en=' || cargada_en from s), 'sin fila: no hubo valoración con neta congelada')
union all
select 3, 'reparto de la neta congelado (modo/conteos/netas por tipo)',
       case when exists (select 1 from s where adultos >= 1) then 'OK' else 'FALTA' end,
       coalesce((select 'modo=' || modo || ' · adultos=' || adultos || ' · ninos=' || ninos || ' · infantes=' || infantes || ' · neta_adulto=' || neta_adulto || ' · neta_nino=' || neta_nino from s), '')
union all
select 4, 'precio congelado coincide con cotizaciones.precio_venta',
       case when not exists (select 1 from s) or not exists (select 1 from c) then 'FALTA'
            when (select abs(s.precio_venta - c.precio_venta) from s, c) <= 0.5 then 'OK' else 'DIFIERE' end,
       coalesce((select 'solicitud=' || s.precio_venta || ' · cotización=' || c.precio_venta from s, c), '')
union all
select 5, 'renglones de detalle suman el precio de venta',
       case when not exists (select 1 from it where n_items > 0) then 'FALTA'
            when (select abs(it.suma_items - c.precio_venta) from it, c) <= 1 then 'OK' else 'DIFIERE' end,
       coalesce((select 'renglones=' || n_items || ' · suma=' || suma_items || ' · precio_venta=' || (select precio_venta from c) from it), '')
union all
select 6, 'composición ya guardada (cotizacion_composicion)',
       case when exists (select 1 from public.cotizacion_composicion x join c on c.id = x.cotizacion_id) then 'YA EXISTE' else 'NO HAY' end,
       coalesce((select 'tenant=' || x.tenant || ' · creada=' || x.created_at from public.cotizacion_composicion x join c on c.id = x.cotizacion_id), '')
union all
select 7, 'neto de vuelo / servicios incluidos por componente congelado',
       'FALTA',
       'No se congela por componente: solo la neta total del hotel y el PVP. Vuelo y servicios incluidos se obtendrían de tarifas actuales (no exacto) → recuperación exacta SOLO del hotel + total, no de cada componente'
union all
select 8, 'veredicto',
       case when exists (select 1 from c) and exists (select 1 from s)
             and (select abs(s.precio_venta - c.precio_venta) from s, c) <= 0.5
             and exists (select 1 from it where n_items > 0 and abs(suma_items - (select precio_venta from c)) <= 1)
            then 'PARCIAL EXACTA' else 'NO EXACTA' end,
       'PARCIAL EXACTA = hotel (neta, markup, reparto) y total se pueden conciliar con datos congelados; el neto por vuelo/servicio no. NO EXACTA = no hay base congelada suficiente.'
order by ord;
