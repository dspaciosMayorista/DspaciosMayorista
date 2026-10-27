-- SOLO LECTURA. Una sola consulta (SQL Editor de Producción). Control de las salidas de los programas 7, 8, 9, 11 y 13 (traslado previo).
-- Regla (confirmada por el inventario: programa_salidas.noches = programas.dias − 1, no cuenta el traslado):
--     fecha_hasta debe ser  fecha_desde + noches + 1  (el día del traslado previo se cuenta una vez).
-- Una salida que no la cumple REVISAR: la app se negará a reservarla (antes de numerar) hasta que se corrija el dato.
-- No presupone cuál fecha está mal: ofrece las dos lecturas posibles (corregir fecha_hasta o corregir fecha_desde) para que decidas con el operador.
-- Sirve igual antes y después de la 246 (no usa programa_dias.tipo_tramo).
select p.id as programa_id,
       p.nombre,
       p.publicado,
       s.id as salida_id,
       s.etiqueta,
       s.fecha_desde,
       s.fecha_hasta,
       (s.fecha_hasta - s.fecha_desde) as dif_fechas,
       p.dias as dias_programa,
       s.noches as noches_salida,
       case when s.fecha_desde is null or s.fecha_hasta is null then 'SIN FECHAS (la app no puede validarla)'
            when s.fecha_hasta = s.fecha_desde + s.noches + 1 then 'OK'
            else 'REVISAR' end as estado,
       (s.fecha_desde + s.noches + 1) as fecha_hasta_esperada,
       (s.fecha_hasta - s.noches - 1) as fecha_desde_si_hasta_es_correcta,
       case when s.fecha_desde is null or s.fecha_hasta is null or s.fecha_hasta = s.fecha_desde + s.noches + 1 then null
            when s.fecha_hasta - s.fecha_desde = s.noches then 'su rango NO cuenta el traslado: ¿fecha_desde es la del primer día en destino y no la de salida?'
            else 'confirmar con el operador: ¿fecha_hasta o fecha_desde? (o las noches, si la salida es otra)' end as que_confirmar
  from public.programa_salidas s
  join public.programas p on p.id = s.programa_id
 where p.id in (7, 8, 9, 11, 13)
   and s.noches is not null
 order by (case when s.fecha_desde is null or s.fecha_hasta is null then 1 when s.fecha_hasta = s.fecha_desde + s.noches + 1 then 2 else 0 end), p.id, s.fecha_desde, s.id;
