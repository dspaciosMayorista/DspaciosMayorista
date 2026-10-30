-- SOLO LECTURA. Una sola consulta para el SQL Editor de producción, ANTES de aplicar la 246.
-- Pregunta: en los programas 7, 8, 9, 11 y 13, ¿programa_salidas.noches ya cuenta la noche del traslado previo?
-- No presupone la respuesta: muestra los datos y una lectura derivada de ellos (columna «lectura»).
--   dias        = programas.dias (días turísticos; con la 246 el traslado queda fuera de este conteo)
--   filas_dias  = filas de programa_dias HOY (antes de la 246 = traslado + días turísticos)
--   noches_sal  = programa_salidas.noches; dif_fechas = fecha_hasta − fecha_desde del rango de la salida
--   lectura     = 'noches = dias − 1' (no incluye el traslado) · 'noches = dias' (parece incluirlo) · 'sin noches (usa dias − 1)' · 'REVISAR' (otro valor)
select p.id as programa_id,
       p.nombre,
       p.modo_precio,
       p.tipo_transporte,
       p.publicado,
       p.dias,
       p.noches as noches_programa,
       (select count(*) from public.programa_dias d where d.programa_id = p.id) as filas_dias,
       (select min(d.dia) from public.programa_dias d where d.programa_id = p.id) as dia_min,
       (select max(d.dia) from public.programa_dias d where d.programa_id = p.id) as dia_max,
       (select d.titulo from public.programa_dias d where d.programa_id = p.id order by d.dia limit 1) as titulo_primera_fila,
       s.etiqueta as salida,
       s.fecha_desde,
       s.fecha_hasta,
       (s.fecha_hasta - s.fecha_desde) as dif_fechas,
       s.noches as noches_sal,
       case when s.id is null then 'sin salidas (modo ' || p.modo_precio || ': el regreso usa dias − 1)'
            when s.noches is null then 'sin noches (usa dias − 1)'
            when s.noches = p.dias - 1 then 'noches = dias − 1 (no incluye el traslado)'
            when s.noches = p.dias then 'noches = dias (parece incluir el traslado)'
            else 'REVISAR' end as lectura
  from public.programas p
  left join public.programa_salidas s on s.programa_id = p.id
 where p.id in (7, 8, 9, 11, 13)
 order by p.id, s.orden, s.id;
