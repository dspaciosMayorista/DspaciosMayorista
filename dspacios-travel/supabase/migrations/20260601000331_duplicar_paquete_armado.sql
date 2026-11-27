-- 331 · #61 — duplicar un paquete ARMADO (Bloqueo / Porción terrestre / Servicios / Dinámico del módulo de paquetes) como un BORRADOR nuevo, en UNA transacción.
-- Por qué una función: un paquete armado vive en seis tablas (armado_paquetes + armado_vuelos/empaquetados/hoteles/servicios/destinos_aereos + salidas_dinamicas) y no existía ningún camino atómico
-- de varias tablas. Copiar desde la aplicación en pasos sueltos podía dejar un borrador incompleto que parece usable si un paso fallaba. Aquí todo se copia o nada se copia.
--
-- SE COPIA (configuración): cabecera (nombre + « (copia)», tipo, noches, destino, vigencias de compra/viaje, markup, infante fijo, impuesto, moneda, imagen, notas, condición de pago,
--   restricción comercial, textos del programa, destinos aéreos alternativos, modo de oferta/TRM/moneda de publicación) y los hijos: vuelos de bloqueo, empaquetados «Promoción», hoteles (categorías/
--   regímenes/prioridad), servicios (modo/incluido), destinos aéreos alternativos y salidas dinámicas. Las fechas y los precios se REVISAN antes de publicar (la TRM, si existe, también).
-- SE REUTILIZA POR REFERENCIA (no se clona): bloqueos_vuelo, empaquetados, hoteles, servicios_adicionales, destinos, proveedores. La copia no consume cupos ni sillas.
-- NUNCA SE COPIA: activo (la copia nace INACTIVA = no publicable), ni nada del estado de publicación (tarifario_resultado*, tarifario_estado/revisiones/generación, manifiestos, lotes, cola de publicación,
--   filas ocultas), ni contratos/ventas, abonos, sillas/ocupación, ni identificadores consumidos. Nunca llama a generar el tarifario: publicar sigue siendo una acción explícita posterior.
-- SALIDAS DINÁMICAS vinculadas a un empaquetado: se intentan copiar; si ese vuelo ya no es elegible (p. ej. ya tiene record) la salida se OMITE y la función lo DICE (contador en la respuesta). Una salida
--   manual que no se pueda copiar aborta TODA la copia (no queda un borrador incompleto).
-- SECURITY INVOKER: rige la RLS y la auditoría del usuario que llama; solo roles de producto (superadmin, gerencia, administracion, operaciones).
-- Rollback: supabase/scripts/rollback_331_duplicar_paquete_armado.sql (solo borra la función; los borradores ya creados son paquetes normales). Solo la corre el dueño.
do $$ begin
  if to_regclass('public.armado_paquetes') is null or to_regclass('public.armado_vuelos') is null or to_regclass('public.armado_empaquetados') is null
     or to_regclass('public.armado_hoteles') is null or to_regclass('public.armado_servicios') is null or to_regclass('public.armado_paquete_destinos_aereos') is null
     or to_regclass('public.salidas_dinamicas') is null then
    raise exception '331: faltan tablas del paquete armado (armado_* / salidas_dinamicas).';
  end if;
  if to_regprocedure('public.mi_rol()') is null then raise exception '331: falta mi_rol().'; end if;
end $$;

create or replace function public.duplicar_paquete_armado(p_origen bigint)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  o public.armado_paquetes;
  s public.salidas_dinamicas;
  v_rol text;
  v_nuevo bigint;
  v_vuelos integer := 0; v_emp integer := 0; v_hot integer := 0; v_srv integer := 0; v_dest integer := 0; v_sal integer := 0; v_sal_omitidas integer := 0;
begin
  v_rol := public.mi_rol();
  if v_rol is null or v_rol not in ('superadmin', 'gerencia', 'administracion', 'operaciones') then
    raise exception 'F6101: tu rol no puede duplicar paquetes.' using errcode = 'F6101';
  end if;
  if p_origen is null then raise exception 'F6102: falta el paquete a duplicar.' using errcode = 'F6102'; end if;
  select * into o from public.armado_paquetes where id = p_origen;   -- con la RLS de quien llama: lo que no ve, no existe
  if not found then raise exception 'F6102: no se encontró el paquete a duplicar.' using errcode = 'F6102'; end if;

  -- Cabecera: solo configuración. activo = false y todo el estado de publicación con sus valores por defecto.
  insert into public.armado_paquetes (
    nombre, tipo, noches, destino_id, fecha_compra_inicio, fecha_compra_fin, fecha_viaje_inicio, fecha_viaje_fin, pct_mk, pvp_infante_fijo, impuesto_tipo, impuesto_fijo, moneda, imagen_url, notas,
    condicion_pago_tipo, condicion_pago_pct_inicial, condicion_pago_dias_saldo, restriccion_comercial,
    programa_incluye, programa_no_incluye, programa_tarifas_especiales, programa_condiciones_comerciales,
    destinos_aereos_alternativos, modo_oferta, trm_oferta, moneda_publicacion, activo
  ) values (
    o.nombre || ' (copia)', o.tipo, o.noches, o.destino_id, o.fecha_compra_inicio, o.fecha_compra_fin, o.fecha_viaje_inicio, o.fecha_viaje_fin, o.pct_mk, o.pvp_infante_fijo, o.impuesto_tipo, o.impuesto_fijo, o.moneda, o.imagen_url, o.notas,
    o.condicion_pago_tipo, o.condicion_pago_pct_inicial, o.condicion_pago_dias_saldo, o.restriccion_comercial,
    o.programa_incluye, o.programa_no_incluye, o.programa_tarifas_especiales, o.programa_condiciones_comerciales,
    o.destinos_aereos_alternativos, o.modo_oferta, o.trm_oferta, o.moneda_publicacion, false
  ) returning id into v_nuevo;

  insert into public.armado_vuelos (paquete_id, bloqueo_id, aplica_mk, ta)
    select v_nuevo, bloqueo_id, aplica_mk, ta from public.armado_vuelos where paquete_id = p_origen;
  get diagnostics v_vuelos = row_count;

  insert into public.armado_empaquetados (paquete_id, empaquetado_id, aplica_mk, ta)
    select v_nuevo, empaquetado_id, aplica_mk, ta from public.armado_empaquetados where paquete_id = p_origen;
  get diagnostics v_emp = row_count;

  insert into public.armado_hoteles (paquete_id, hotel_id, categorias, regimenes, prioridad)
    select v_nuevo, hotel_id, categorias, regimenes, prioridad from public.armado_hoteles where paquete_id = p_origen;
  get diagnostics v_hot = row_count;

  insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido)
    select v_nuevo, servicio_id, modo, incluido from public.armado_servicios where paquete_id = p_origen;
  get diagnostics v_srv = row_count;

  insert into public.armado_paquete_destinos_aereos (paquete_id, destino_id)
    select v_nuevo, destino_id from public.armado_paquete_destinos_aereos where paquete_id = p_origen;
  get diagnostics v_dest = row_count;

  for s in select * from public.salidas_dinamicas where paquete_id = p_origen order by orden, id loop
    begin
      insert into public.salidas_dinamicas (
        paquete_id, aerolinea, ruta, origen, fecha_ida, fecha_regreso, hora_salida_ida, hora_llegada_ida, hora_salida_reg, hora_llegada_reg,
        valor_tiquete, aplica_mk, ta, fee_infante, compra_inicio, compra_fin, activo, notas, orden, empaquetado_id, moneda
      ) values (
        v_nuevo, s.aerolinea, s.ruta, s.origen, s.fecha_ida, s.fecha_regreso, s.hora_salida_ida, s.hora_llegada_ida, s.hora_salida_reg, s.hora_llegada_reg,
        s.valor_tiquete, s.aplica_mk, s.ta, s.fee_infante, s.compra_inicio, s.compra_fin, s.activo, s.notas, s.orden, s.empaquetado_id, s.moneda
      );
      v_sal := v_sal + 1;
    exception when others then
      -- Una salida vinculada a un empaquetado que ya no es elegible se omite y se cuenta; una manual no puede omitirse (la copia quedaría incompleta): se aborta todo.
      if s.empaquetado_id is null then raise; end if;
      v_sal_omitidas := v_sal_omitidas + 1;
    end;
  end loop;

  return jsonb_build_object(
    'id', v_nuevo, 'nombre', o.nombre || ' (copia)',
    'vuelos', v_vuelos, 'empaquetados', v_emp, 'hoteles', v_hot, 'servicios', v_srv, 'destinos_aereos', v_dest,
    'salidas', v_sal, 'salidas_vinculadas_omitidas', v_sal_omitidas
  );
end $$;

revoke all on function public.duplicar_paquete_armado(bigint) from public, anon;
grant execute on function public.duplicar_paquete_armado(bigint) to authenticated;
comment on function public.duplicar_paquete_armado(bigint) is '#61 (331): duplica un paquete armado como borrador inactivo y sin publicar (configuración + hijos), atómico, SECURITY INVOKER. Nunca copia estado de publicación, ventas, sillas ni identificadores consumidos.';
