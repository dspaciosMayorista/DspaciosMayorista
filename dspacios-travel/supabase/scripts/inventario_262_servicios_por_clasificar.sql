-- INVENTARIO 262 · SOLO LECTURA · servicios que requieren clasificación manual (tipo de receptivo) tras la 262. NO asigna nada.
-- `sugerencia_por_nombre` es solo una PISTA para quien clasifica: el nombre o la categoría antigua no acreditan el tipo ni el trayecto.
-- Correr DESPUÉS de aplicar la 262 (antes falla: no existe tipo_receptivo). Pegar completa en el editor SQL de Supabase.
select s.id, s.nombre, p.nombre as proveedor,
       coalesce(d.nombre, case when s.alcance = 'internacional' then 'Todos internacionales' else 'Todos nacionales' end) as destino,
       s.categoria as categoria_antigua,
       case when s.nombre ~* '(traslado|transfer|aeropuerto)' and s.nombre ~* '(tour|excursi|isla|city)' then 'combo? (el nombre menciona ambos)'
            when s.nombre ~* '(traslado|transfer|aeropuerto)' then 'traslado?'
            when s.nombre ~* '(tour|excursi|isla|city|paseo)' then 'tour?'
            when s.categoria = 'asistencia' or s.nombre ~* '(asistencia|seguro)' then 'asistencia_medica?'
            else 'sin pista' end as sugerencia_por_nombre,
       (select count(*) from public.servicio_temporadas t where t.servicio_id = s.id) as vigencias,
       (select count(*) from public.servicio_suplementos_franja f join public.servicio_temporadas t on t.id = f.servicio_temporada_id where t.servicio_id = s.id) as franjas_horarias,
       (select count(*) from public.armado_servicios a where a.servicio_id = s.id) as paquetes_que_lo_usan,
       (s.precio_persona is not null) as tiene_precio_persona,
       exists (select 1 from public.servicio_tarifa_pax x where x.servicio_id = s.id) as tiene_rangos_grupo
  from public.servicios_adicionales s
  left join public.proveedores p on p.id = s.proveedor_id
  left join public.destinos d on d.id = s.destino_id
 where s.tipo_receptivo is null
 order by (select count(*) from public.armado_servicios a where a.servicio_id = s.id) desc, s.nombre;
