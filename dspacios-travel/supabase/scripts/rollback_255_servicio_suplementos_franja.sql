-- Rollback de la 255: elimina la tabla de franjas, su trigger y las tres funciones de apoyo.
-- ABORTA si la tabla tiene filas (franjas ya configuradas por el negocio): se pierden y no se borran sin que lo decidas.
-- Para borrarlas a propósito, exporta antes `select * from public.servicio_suplementos_franja` y reejecuta con la variable de abajo en 'si'.
-- No toca servicio_temporadas, tarifas, contratos ni cotizaciones. Un contrato ya numerado conserva sus importes (los suplementos quedaron dentro del
-- precio/costo congelados); lo que deja de existir es la regla para COTIZAR suplementos nuevos.
begin;

do $$
declare
  v_borrar_con_datos text := 'no';  -- cambiar a 'si' SOLO tras exportar las franjas
  v_filas bigint;
begin
  if to_regclass('public.servicio_suplementos_franja') is null then
    raise notice 'ROLLBACK 255: la tabla no existe; solo se limpian funciones sobrantes.';
  else
    execute 'select count(*) from public.servicio_suplementos_franja' into v_filas;
    if v_filas > 0 and v_borrar_con_datos <> 'si' then
      raise exception 'ROLLBACK 255 ABORTADO: la tabla tiene % franja(s) configuradas. Expórtalas y cambia v_borrar_con_datos a ''si'' para borrarlas.', v_filas;
    end if;
  end if;
end $$;

drop trigger if exists servicio_suplementos_franja_solape on public.servicio_suplementos_franja;
drop table if exists public.servicio_suplementos_franja;
drop function if exists public.tg_servicio_suplementos_franja_solape();
drop function if exists public.fn_franja_contiene(integer, integer, integer);
drop function if exists public.fn_franja_minutos(text);

commit;
