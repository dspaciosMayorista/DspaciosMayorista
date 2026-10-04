-- ───────────────────────────────────────────────────────────────────────────
-- CONTENER una función de Vuelos de la 201 con un DEFECTO SQL (después del
-- cierre de firmas antiguas). Quita el EXECUTE de esa ÚNICA función al rol
-- que la usa: la acción falla cerrada en la app ("permiso denegado") y deja de
-- poder causar daño mientras se prepara la corrección
-- (plantilla_hotfix_201.sql). No borra ni cambia datos.
--
-- Solo admite las funciones CON versión de la lista: nunca toca las firmas
-- viejas (sin versión) ni el estado del cierre, así que no reabre nada.
-- Revertir la contención: levantar_contencion_201.sql (devuelve exactamente
-- el permiso que quitó). Ver docs/tecnico/vuelos-201-despliegue-y-cierre.md.
-- ───────────────────────────────────────────────────────────────────────────
begin;

do $$
declare
  -- ═══ Llenar: la función con el defecto y el motivo ═══
  v_funcion text := 'PEGAR_FIRMA';   -- p. ej. public.editar_contrato_manual(bigint,text,jsonb)
  v_motivo  text := 'PEGAR_MOTIVO';
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
    raise exception 'Función fuera de la lista de contención (solo funciones CON versión de la 201; nunca firmas viejas): %. No se cambió nada.', v_funcion;
  end if;
  if coalesce(btrim(v_motivo), '') = '' or v_motivo ~ '^PEGAR_' then
    raise exception 'Escribe el motivo de la contención. No se cambió nada.';
  end if;
  if not has_function_privilege(v_rol, v_funcion, 'execute') then
    raise notice 'La función % ya estaba contenida para %; no se cambia nada.', v_funcion, v_rol;
    return;
  end if;
  execute format('revoke execute on function %s from %I', v_funcion::regprocedure, v_rol);
  raise notice 'CONTENIDA: % ya no la puede ejecutar % (motivo: %). El estado del cierre no cambió; postcheck_201 la mostrará como permiso faltante hasta levantarla.', v_funcion, v_rol, v_motivo;
end $$;

commit;
