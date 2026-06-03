-- Script de mantenimiento (NO es una migración): ejecutar manualmente en el
-- SQL editor de Supabase cuando haga falta.
--
-- Fusión de destinos "CARTAGENA" duplicados:
--   - Detecta las dos (o más) filas cuyo nombre empieza por "cartagena".
--   - Conserva la que tenga MÁS hoteles asociados.
--   - Reapunta todas las referencias (hoteles, temporadas, itinerarios,
--     inclusiones, servicios, bloqueos, paquetes armados, tarifario) a la que
--     se conserva y borra la(s) sobrante(s).
--   - Normaliza todos los nombres de destino a MAYÚSCULAS.
--
-- Es seguro: si quedara alguna referencia sin reapuntar, el DELETE final
-- fallaría (por la llave foránea) sin dejar datos corruptos.

do $$
declare keep_id bigint; drop_id bigint;
begin
  -- Conserva la Cartagena con más hoteles
  select id into keep_id from public.destinos
   where lower(nombre) like 'cartagena%'
   order by (select count(*) from public.hoteles h where h.destino_id = destinos.id) desc, id
   limit 1;

  if keep_id is null then raise notice 'No hay destino Cartagena'; return; end if;

  -- Reapunta y elimina cada duplicado
  for drop_id in
    select id from public.destinos
     where lower(nombre) like 'cartagena%' and id <> keep_id
  loop
    update public.hoteles               set destino_id = keep_id where destino_id = drop_id;
    update public.temporadas            set destino_id = keep_id where destino_id = drop_id;
    update public.itinerarios           set destino_id = keep_id where destino_id = drop_id;
    update public.inclusiones           set destino_id = keep_id where destino_id = drop_id;
    update public.servicios_adicionales set destino_id = keep_id where destino_id = drop_id;
    update public.bloqueos_vuelo        set destino_id = keep_id where destino_id = drop_id;
    update public.armado_paquetes       set destino_id = keep_id where destino_id = drop_id;
    update public.tarifario_resultado   set destino_id = keep_id where destino_id = drop_id;
    delete from public.destinos where id = drop_id;
    raise notice 'Fusionado destino % en %', drop_id, keep_id;
  end loop;

  -- Normaliza todos los nombres de destino a mayúsculas
  update public.destinos set nombre = upper(nombre) where nombre <> upper(nombre);
end $$;
