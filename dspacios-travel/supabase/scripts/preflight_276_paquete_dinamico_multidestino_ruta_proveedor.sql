-- PREFLIGHT de la 276 (#82, feedback de Preview). SOLO LECTURA. UNA consulta: control, observado, esperado, veredicto.
-- FALLA = no correr la 276. AVISO = datos existentes que la 276 NO borra pero que fallarán al volver a guardarse/publicarse (revisar).
-- REVISAR = vínculos cuya ficha fuente ya no coincide en destino con el paquete: NADA se modifica ni se borra, el equipo decide caso por caso.
with d as (
  select 'vuelo' as tipo, v.paquete_id, p.publicado, coalesce(nullif(v.ruta, ''), v.id::text) as item, e.destino_id as ficha, coalesce(v.destino_id, p.destino_id) as declarado
    from public.paquete_din_vuelos v join public.paquete_din p on p.id = v.paquete_id join public.empaquetados e on e.id = v.empaquetado_id
   where e.destino_id is not null and e.destino_id is distinct from coalesce(v.destino_id, p.destino_id)
  union all
  select 'servicio', s.paquete_id, p.publicado, s.nombre, x.destino_id, coalesce(s.destino_id, p.destino_id)
    from public.paquete_din_servicios s join public.paquete_din p on p.id = s.paquete_id join public.servicios_adicionales x on x.id = s.servicio_id
   where x.destino_id is not null and x.destino_id is distinct from coalesce(s.destino_id, p.destino_id)
)
select * from (
  select 1 as n, 'la 274 y la 275 están aplicadas (guardar_paquete_din y el trigger de destinos_extra)' as control,
         (select count(*)::text from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname in ('guardar_paquete_din', 'tg_din_destinos_extra_validos', 'hotel_vinculable_din')) as observado,
         '3' as esperado,
         case when (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname in ('guardar_paquete_din', 'tg_din_destinos_extra_validos', 'hotel_vinculable_din')) = 3 then 'OK' else 'FALLA' end as veredicto
  union all
  select 2, 'existen pais_comparable_67 (220), destinos.pais, hoteles.moneda y servicios_adicionales.moneda/proveedor_id',
         (select (case when to_regprocedure('public.pais_comparable_67(text)') is not null then 1 else 0 end)
               + (select count(*) from information_schema.columns where table_schema = 'public' and ((table_name = 'destinos' and column_name = 'pais') or (table_name = 'hoteles' and column_name = 'moneda') or (table_name = 'servicios_adicionales' and column_name in ('moneda', 'proveedor_id'))))::int)::text,
         '5',
         case when (select (case when to_regprocedure('public.pais_comparable_67(text)') is not null then 1 else 0 end)
               + (select count(*) from information_schema.columns where table_schema = 'public' and ((table_name = 'destinos' and column_name = 'pais') or (table_name = 'hoteles' and column_name = 'moneda') or (table_name = 'servicios_adicionales' and column_name in ('moneda', 'proveedor_id'))))::int) = 5 then 'OK' else 'FALLA' end
  union all
  select 3, 'la 276 aún no está aplicada (no existe paquete_din.multidestino)',
         (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'paquete_din' and column_name = 'multidestino'),
         '0 (si es 1, ya se aplicó: es idempotente)',
         case when (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'paquete_din' and column_name = 'multidestino') = 0 then 'OK' else 'AVISO' end
  union all
  select 4, 'paquetes con destinos adicionales de OTRO país que el principal, o principal sin país (seguirán existiendo; el próximo guardado los rechazará)',
         (select count(*)::text from public.paquete_din p where coalesce(cardinality(p.destinos_extra), 0) > 0 and (
            public.pais_comparable_67((select d.pais from public.destinos d where d.id = p.destino_id)) is null
            or exists (select 1 from public.destinos d where d.id = any (p.destinos_extra) and public.pais_comparable_67(d.pais) is distinct from public.pais_comparable_67((select x.pais from public.destinos x where x.id = p.destino_id))))),
         '0',
         case when (select count(*) from public.paquete_din p where coalesce(cardinality(p.destinos_extra), 0) > 0 and (
            public.pais_comparable_67((select d.pais from public.destinos d where d.id = p.destino_id)) is null
            or exists (select 1 from public.destinos d where d.id = any (p.destinos_extra) and public.pais_comparable_67(d.pais) is distinct from public.pais_comparable_67((select x.pais from public.destinos x where x.id = p.destino_id))))) = 0 then 'OK' else 'AVISO' end
  union all
  select 5, 'vuelos manuales sin origen/destino IATA (su ruta libre se conserva hasta volver a guardar el paquete)',
         (select count(*)::text from public.paquete_din_vuelos where empaquetado_id is null),
         'informativo', 'OK'
  union all
  select 6, 'vuelos vinculados a un empaquetado sin ruta (el próximo guardado pedirá completarla)',
         (select count(*)::text from public.paquete_din_vuelos v join public.empaquetados e on e.id = v.empaquetado_id where e.ruta is null or btrim(e.ruta) = ''),
         '0',
         case when (select count(*) from public.paquete_din_vuelos v join public.empaquetados e on e.id = v.empaquetado_id where e.ruta is null or btrim(e.ruta) = '') = 0 then 'OK' else 'AVISO' end
  union all
  select 7, 'servicios vinculados cuya ficha NO tiene proveedor (no podrán publicarse hasta cargarlo)',
         (select count(*)::text from public.paquete_din_servicios ps join public.servicios_adicionales s on s.id = ps.servicio_id where s.proveedor_id is null),
         '0',
         case when (select count(*) from public.paquete_din_servicios ps join public.servicios_adicionales s on s.id = ps.servicio_id where s.proveedor_id is null) = 0 then 'OK' else 'AVISO' end
  union all
  select 8, 'hoteles o servicios vinculados en otra moneda que su paquete (el próximo guardado los rechazará)',
         ((select count(*) from public.paquete_din_hoteles h join public.paquete_din p on p.id = h.paquete_id join public.hoteles x on x.id = h.hotel_id where x.moneda is distinct from p.moneda)
          + (select count(*) from public.paquete_din_servicios s join public.paquete_din p on p.id = s.paquete_id join public.servicios_adicionales x on x.id = s.servicio_id where x.moneda is distinct from p.moneda))::text,
         '0',
         case when ((select count(*) from public.paquete_din_hoteles h join public.paquete_din p on p.id = h.paquete_id join public.hoteles x on x.id = h.hotel_id where x.moneda is distinct from p.moneda)
          + (select count(*) from public.paquete_din_servicios s join public.paquete_din p on p.id = s.paquete_id join public.servicios_adicionales x on x.id = s.servicio_id where x.moneda is distinct from p.moneda)) = 0 then 'OK' else 'AVISO' end
  union all
  select 9, 'vuelos o servicios de un destino que no está en su paquete',
         ((select count(*) from public.paquete_din_vuelos v join public.paquete_din p on p.id = v.paquete_id where v.destino_id is not null and v.destino_id is distinct from p.destino_id and v.destino_id <> all (coalesce(p.destinos_extra, '{}')))
          + (select count(*) from public.paquete_din_servicios v join public.paquete_din p on p.id = v.paquete_id where v.destino_id is not null and v.destino_id is distinct from p.destino_id and v.destino_id <> all (coalesce(p.destinos_extra, '{}'))))::text,
         '0',
         case when ((select count(*) from public.paquete_din_vuelos v join public.paquete_din p on p.id = v.paquete_id where v.destino_id is not null and v.destino_id is distinct from p.destino_id and v.destino_id <> all (coalesce(p.destinos_extra, '{}')))
          + (select count(*) from public.paquete_din_servicios v join public.paquete_din p on p.id = v.paquete_id where v.destino_id is not null and v.destino_id is distinct from p.destino_id and v.destino_id <> all (coalesce(p.destinos_extra, '{}')))) = 0 then 'OK' else 'AVISO' end
  union all
  select 10, 'vuelos y servicios vinculados cuyo destino en la ficha fuente NO coincide con el declarado en el paquete (no se modifican: la 276 los rechazará al guardar, publicar o cotizar)',
         (select count(*)::text || coalesce(' → ' || (select string_agg(tipo || ' «' || item || '» (paquete ' || paquete_id || case when publicado then ' PUBLICADO' else '' end || ', ficha: destino ' || ficha || ', declarado: ' || coalesce(declarado::text, '—') || ')', '; ' order by paquete_id, tipo, item) from (select * from d order by paquete_id, tipo, item limit 20) z), '') from d),
         '0',
         case when (select count(*) from d) = 0 then 'OK' else 'REVISAR' end
) q order by n;
