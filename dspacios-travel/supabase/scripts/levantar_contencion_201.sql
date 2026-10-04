-- ───────────────────────────────────────────────────────────────────────────
-- LEVANTAR la contención de una función de Vuelos de la 201
-- (contener_funcion_201.sql): devuelve el EXECUTE al mismo rol. Se usa cuando
-- el hotfix ya está aplicado y verificado, o si la contención fue un error.
-- Solo admite la misma lista de funciones CON versión: nunca reabre una firma
-- vieja ni toca el estado del cierre.
-- ───────────────────────────────────────────────────────────────────────────
begin;

do $$
declare
  v_funcion text := 'PEGAR_FIRMA';   -- la misma firma que se contuvo
  v_rol     text;
begin
  v_rol := case v_funcion
    when 'public.editar_pasajero_silla(bigint,jsonb)'                     then 'authenticated'
    when 'public.liberar_silla(bigint,jsonb)'                             then 'authenticated'
    when 'public.asignar_contrato_manual(bigint,text,jsonb)'              then 'authenticated'
    when 'public.quitar_contrato_manual(bigint,date,jsonb)'               then 'authenticated'
    when 'public.editar_contrato_manual(bigint,text,jsonb)'               then 'authenticated'
    when 'public.liberar_retencion_vencida(bigint,jsonb)'                 then 'authenticated'
    when 'public.cambiar_estado_silla(bigint,text,text,boolean)'          then 'authenticated'
    when 'public.crear_pasajeros_contrato_con_sillas(text,jsonb,integer,uuid,jsonb,jsonb)'       then 'service_role'
    when 'public.crear_pasajeros_contrato_multi_con_sillas(text,jsonb,jsonb,uuid,jsonb,jsonb)'   then 'service_role'
  end;
  if v_rol is null then
    raise exception 'Función fuera de la lista de contención: %. No se cambió nada.', v_funcion;
  end if;
  execute format('grant execute on function %s to %I', v_funcion::regprocedure, v_rol);
  raise notice 'Contención levantada: % vuelve a estar disponible para %.', v_funcion, v_rol;
end $$;

commit;
