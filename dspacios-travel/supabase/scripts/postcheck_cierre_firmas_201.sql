-- ───────────────────────────────────────────────────────────────────────────
-- POSTCHECK del cierre de firmas sin versión de Vuelos (201). Solo lectura.
-- Se corre en cualquier momento: antes de activar, durante la ventana y
-- después. Falla con excepción si las piezas del cierre no están como las
-- dejó la 201; si no, termina en "POSTCHECK CIERRE FIRMAS 201: TODO OK" y
-- muestra el estado efectivo y el uso de firmas viejas.
-- ───────────────────────────────────────────────────────────────────────────
begin read only;

do $$
declare v_rol text; v_n int;
begin
  if to_regclass('public.vuelos_cierre_firmas_201') is null then
    raise exception 'FALLO: falta public.vuelos_cierre_firmas_201 (¿está aplicada la 201?)';
  end if;
  select count(*) into v_n from public.vuelos_cierre_firmas_201;
  if v_n <> 1 then raise exception 'FALLO: el estado del cierre debe tener exactamente 1 fila (tiene %)', v_n; end if;
  if (select count(*) from pg_trigger where tgrelid = 'public.vuelos_cierre_firmas_201'::regclass and not tgisinternal and tgenabled = 'O') <> 2 then
    raise exception 'FALLO: faltan o están desactivados los triggers que impiden reabrir el cierre';
  end if;
  raise notice 'OK 1. estado del cierre: una fila, con sus dos triggers activos (no se reabre, no se borra)';

  foreach v_rol in array array['anon', 'authenticated', 'service_role'] loop
    if has_table_privilege(v_rol, 'public.vuelos_cierre_firmas_201', 'select,insert,update,delete,truncate')
       or has_table_privilege(v_rol, 'public.vuelos_firmas_antiguas_uso', 'select,insert,update,delete,truncate')
       or has_function_privilege(v_rol, 'public.programar_cierre_firmas_antiguas(integer,text)', 'execute')
       or has_function_privilege(v_rol, 'public.cancelar_cierre_firmas_antiguas(text)', 'execute')
       or has_function_privilege(v_rol, 'public._firmas_antiguas_cerradas()', 'execute')
       or has_function_privilege(v_rol, 'public._registrar_firma_nueva()', 'execute') then
      raise exception 'FALLO: % alcanza el estado o las funciones del cierre', v_rol;
    end if;
  end loop;
  raise notice 'OK 2. el cierre solo lo maneja el dueño (la API no lo lee ni lo cambia)';
  raise notice 'POSTCHECK CIERRE FIRMAS 201: TODO OK';
end $$;

-- Estado efectivo.
select c.estado as estado_guardado,
       case when public._firmas_antiguas_cerradas() then 'CERRADAS (no se reabren)'
            when c.estado = 'programado' then format('programadas: cierran el %s', c.cierra_en)
            else 'ABIERTAS sin fecha (el código viejo sigue funcionando)' end as firmas_viejas,
       c.primer_uso_firma_nueva as evidencia_codigo_nuevo,
       c.programado_en, c.cierra_en, c.nota
  from public.vuelos_cierre_firmas_201 c;

-- Uso de firmas viejas: total, desde que hay código nuevo, y últimas 24 h.
select u.firma,
       count(*) as total,
       count(*) filter (where u.usado_en >= c.primer_uso_firma_nueva) as desde_codigo_nuevo,
       count(*) filter (where u.usado_en >= now() - interval '24 hours') as ultimas_24h,
       max(u.usado_en) as ultima
  from public.vuelos_firmas_antiguas_uso u
  cross join public.vuelos_cierre_firmas_201 c
 group by u.firma order by u.firma;

rollback;
