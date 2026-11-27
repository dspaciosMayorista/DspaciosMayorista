-- 332 · Correcciones del bloque #95/#61/#41/#42/#51/#33 (auditoría Codex B95-1 y B95-5). TRES piezas, todas reemplazables (create or replace) y sin tocar datos existentes.
--
-- 1) B95-1 (#42) — reemplazar el plan de cobro de un contrato en UNA transacción, SERIALIZADA por contrato.
--    Antes la aplicación leía los ids viejos, insertaba el plan nuevo y borraba los viejos en pasos separados: dos regeneraciones simultáneas dejaban dos planes (la suma de cuotas = el doble del contrato),
--    un error al leer los ids viejos se ignoraba y un fallo al borrar dejaba ambos planes guardados.
--    · plan_cobro_fuentes(numero)    SECURITY DEFINER, solo LECTURA de agregados (pagado, id del último acuerdo de mínimo, valor y fecha de salida). Exige sesión + rol + puede_ver_contrato(): quien no ve el contrato
--                                    no obtiene nada. Existe porque 'abonos' y 'contrato_minimo_acuerdo' no son legibles por todos los roles que sí pueden escribir 'cuotas'.
--    · reemplazar_plan_cobro(numero, fuentes, filas)  SECURITY INVOKER: rige la RLS de 'cuotas' (rol + dueño + tenant) y la identidad del contrato. Toma un candado de aviso por contrato, VUELVE a leer las fuentes con
--                                    el candado (pagos, acuerdo de mínimo, precio, total de cobro, fecha de salida) y, si ya no son las que usó la aplicación para calcular el plan, rechaza con PLAN_COBRO_FUENTES_CAMBIARON
--                                    (nada se guarda). Comprueba que las filas sumen el total, borra el plan anterior, inserta el nuevo y verifica el conteo: cualquier fallo revierte TODO (el contrato conserva su plan).
--    R2-1: la base DERIVA el total a cobrar, la moneda efectiva y el porcentaje de mínimo (acuerdo → condiciones congeladas → config_cobros, con la regla única p75_priv.regla_confirmacion) y los compara con lo que usó la
--    aplicación; la suma de las cuotas se valida contra ese total de la base, no contra p_fuentes.total. Un cambio en cualquiera de esas fuentes entre calcular y guardar se rechaza con el plan anterior intacto.
--
-- 2) B95-5 (#61) — duplicar_paquete_armado: la 331 capturaba WHEN OTHERS y omitía CUALQUIER salida vinculada que fallara. Ahora solo se omite la causa establecida (vuelo de Empaquetados con record, mensaje
--    'salida_vinculada_record:') y se informa; cualquier otro fallo revierte la copia completa. (La 331 sigue siendo inmutable: esta migración reemplaza la función con CREATE OR REPLACE, así que sirve igual si la 331
--    ya se corrió o si se corre después de ella.)
--
-- Orden: preflight (supabase/scripts/preflight_332_correcciones_bloque_95.sql) → 331 (si aún no se corrió) → 332 → postcheck (postcheck_332_...). Rollback: supabase/scripts/rollback_332_correcciones_bloque_95.sql.
do $$ begin
  if to_regclass('public.cuotas') is null or to_regclass('public.abonos') is null or to_regclass('public.contrato_minimo_acuerdo') is null or to_regclass('public.ventas') is null then
    raise exception '332: faltan tablas (cuotas, abonos, contrato_minimo_acuerdo o ventas).';
  end if;
  if to_regprocedure('public.puede_ver_contrato(text)') is null or to_regprocedure('public.mi_rol()') is null then raise exception '332: faltan puede_ver_contrato(text) o mi_rol().'; end if;
  if to_regprocedure('p75_priv.regla_confirmacion(text)') is null or to_regclass('public.config_cobros') is null or to_regclass('public.contrato_condiciones') is null then raise exception '332: falta la 307 (p75_priv.regla_confirmacion) o config_cobros/contrato_condiciones.'; end if;
  if to_regprocedure('public.duplicar_paquete_armado(bigint)') is null then raise exception '332: falta la 331 (duplicar_paquete_armado). Córrela primero.'; end if;
end $$;

create or replace function public.plan_cobro_fuentes(p_numero text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v public.ventas; v_mo text; v_mc text; v_total numeric; v_moneda text; v_regla jsonb; v_min numeric; v_trm_r numeric; v_min_cobro numeric; v_pct_cfg numeric; v_pct numeric;
begin
  if auth.uid() is null or public.mi_rol() is null or not public.puede_ver_contrato(p_numero) then
    raise exception 'plan_cobro_fuentes: sin acceso al contrato' using errcode = '42501';
  end if;
  select * into v from public.ventas where numero_contrato = p_numero;
  if not found then return null; end if;
  -- R2-1: el total a cobrar y la moneda de cobro se DERIVAN aquí de las columnas del contrato (espejo de p75_priv.regla_confirmacion / lib/finanzas/cobro.ts → cobroDeVenta); la aplicación no es la autoridad.
  v_mo := case when upper(coalesce(v.moneda, 'COP')) = 'USD' then 'USD' else 'COP' end;
  v_mc := case when v.moneda_cobro is null then null when upper(v.moneda_cobro) = 'USD' then 'USD' else 'COP' end;
  if v_mc is not null and v_mc <> v_mo and coalesce(v.total_cobro, 0) > 0 and coalesce(v.trm_cobro, 0) > 0 then
    v_total := v.total_cobro; v_moneda := v_mc;
  else
    v_total := coalesce(v.precio_venta, 0); v_moneda := v_mo;
  end if;
  -- El mínimo EFECTIVO sale de la misma regla única que decide la confirmación (acuerdo → condiciones congeladas → % de config_cobros): lee contrato_condiciones y config_cobros bajo esta misma consulta.
  v_regla := p75_priv.regla_confirmacion(p_numero);
  v_min := (v_regla->>'minimo')::numeric;
  v_trm_r := nullif(v_regla->>'trm', '')::numeric;
  v_min_cobro := case when upper(v_regla->>'moneda') = v_moneda then v_min
                      when upper(v_regla->>'moneda') = 'USD' and coalesce(v_trm_r, 0) > 0 then v_min * v_trm_r
                      else null end;
  select coalesce((select c.pct_abono from public.config_cobros c where c.tipo_paquete = coalesce(v.tipo_paquete, '')), 0.3) into v_pct_cfg;
  -- Misma elección de porcentaje que la aplicación: el de la regla si se puede expresar en la moneda de cobro; si no (o regla histórica), el % configurado.
  v_pct := case when v_regla->>'regla' = 'legacy_pct' or v_min_cobro is null or v_total <= 0 then v_pct_cfg
                else least(1, greatest(0, v_min_cobro / v_total)) end;
  return jsonb_build_object(
    'pagado', coalesce((select sum(a.valor_abono) from public.abonos a where a.numero_contrato = p_numero), 0),
    'acuerdo_id', (select max(m.id) from public.contrato_minimo_acuerdo m where m.numero_contrato = p_numero),
    'precio_venta', v.precio_venta, 'total_cobro', v.total_cobro, 'fecha_salida', v.fecha_salida,
    'moneda', v.moneda, 'moneda_cobro', v.moneda_cobro, 'trm_cobro', v.trm_cobro,
    'total', v_total, 'moneda_efectiva', v_moneda, 'pct_abono', v_pct, 'regla', v_regla->>'regla');
end $$;
revoke all on function public.plan_cobro_fuentes(text) from public, anon;
grant execute on function public.plan_cobro_fuentes(text) to authenticated;

create or replace function public.reemplazar_plan_cobro(p_numero text, p_fuentes jsonb, p_filas jsonb)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_act jsonb; v_n integer; v_suma numeric; v_total numeric; v_visibles integer;
begin
  if p_numero is null or btrim(p_numero) = '' then raise exception 'reemplazar_plan_cobro: falta el contrato' using errcode = '22023'; end if;
  if jsonb_typeof(p_filas) is distinct from 'array' or jsonb_array_length(p_filas) = 0 then raise exception 'reemplazar_plan_cobro: el plan no trae filas' using errcode = '22023'; end if;
  if jsonb_typeof(p_fuentes) is distinct from 'object' then raise exception 'reemplazar_plan_cobro: faltan las fuentes del cálculo' using errcode = '22023'; end if;

  -- Un solo reemplazo a la vez por contrato: la segunda llamada espera a que termine la primera y entonces vuelve a comprobar las fuentes.
  perform pg_advisory_xact_lock(hashtextextended('plan_cobro:' || p_numero, 0));

  v_act := public.plan_cobro_fuentes(p_numero);   -- falla 42501 si la sesión no ve el contrato
  if v_act is null then raise exception 'reemplazar_plan_cobro: el contrato no existe' using errcode = 'P0002'; end if;
  -- R2-1: TODA fuente que determina el total y el mínimo se compara con lo que la base lee AHORA, bajo el candado: pagos, acuerdo, precio, total y TRM de cobro, monedas, fecha de salida y el
  -- porcentaje efectivo (que resume condiciones congeladas + config_cobros + acuerdo). Si algo cambió o la aplicación calculó con otra cosa, se rechaza y el plan anterior queda intacto.
  if abs(coalesce((v_act->>'pagado')::numeric, 0) - coalesce((p_fuentes->>'pagado')::numeric, 0)) > 0.005
     or (v_act->>'acuerdo_id') is distinct from (p_fuentes->>'acuerdo_id')
     or nullif(v_act->>'precio_venta', '')::numeric is distinct from nullif(p_fuentes->>'precio_venta', '')::numeric
     or nullif(v_act->>'total_cobro', '')::numeric is distinct from nullif(p_fuentes->>'total_cobro', '')::numeric
     or nullif(v_act->>'trm_cobro', '')::numeric is distinct from nullif(p_fuentes->>'trm_cobro', '')::numeric
     or (v_act->>'moneda') is distinct from (p_fuentes->>'moneda')
     or (v_act->>'moneda_cobro') is distinct from (p_fuentes->>'moneda_cobro')
     or (v_act->>'moneda_efectiva') is distinct from (p_fuentes->>'moneda_efectiva')
     or (v_act->>'fecha_salida') is distinct from (p_fuentes->>'fecha_salida')
     or abs(coalesce((v_act->>'total')::numeric, 0) - coalesce((p_fuentes->>'total')::numeric, -1)) > 0.005
     or p_fuentes->>'pct_abono' is null
     or abs((v_act->>'pct_abono')::numeric - (p_fuentes->>'pct_abono')::numeric) * coalesce((v_act->>'total')::numeric, 0) > 0.01 then
    raise exception 'PLAN_COBRO_FUENTES_CAMBIARON: los pagos, el valor, el mínimo o la moneda de cobro del contrato cambiaron (o no coinciden con los de la base) mientras se calculaba el plan' using errcode = '40001';
  end if;

  if exists (select 1 from jsonb_array_elements(p_filas) e
             where coalesce(e->>'tipo', '') not in ('abono', 'cuota', 'total') or nullif(e->>'fecha_limite', '') is null or nullif(e->>'monto', '') is null or (e->>'monto')::numeric < 0) then
    raise exception 'reemplazar_plan_cobro: una fila del plan es inválida' using errcode = '22023';
  end if;
  select count(*), coalesce(sum((e->>'monto')::numeric), 0) into v_n, v_suma from jsonb_array_elements(p_filas) e;
  v_total := (v_act->>'total')::numeric;   -- R2-1: el total sale de la base, no de lo que diga el llamador
  if v_total is null or v_total <= 0 or abs(v_suma - v_total) > 0.01 then
    raise exception 'reemplazar_plan_cobro: las cuotas (%) no suman el total a cobrar (%)', v_suma, v_total using errcode = '22023';
  end if;

  delete from public.cuotas where numero_contrato = p_numero;
  insert into public.cuotas (numero_contrato, orden, tipo, fecha_limite, monto)
    select p_numero, (e.ord - 1)::integer, e.v->>'tipo', (e.v->>'fecha_limite')::date, (e.v->>'monto')::numeric
    from jsonb_array_elements(p_filas) with ordinality as e(v, ord);
  -- Si la RLS impidió borrar alguna fila del plan anterior quedaría un plan doble: se verifica y se revierte.
  select count(*) into v_visibles from public.cuotas where numero_contrato = p_numero;
  if v_visibles <> v_n then raise exception 'PLAN_COBRO_INCOMPLETO: quedaron % cuotas en lugar de %', v_visibles, v_n using errcode = 'P0001'; end if;
  return jsonb_build_object('n', v_n);
end $$;
revoke all on function public.reemplazar_plan_cobro(text, jsonb, jsonb) from public, anon;
grant execute on function public.reemplazar_plan_cobro(text, jsonb, jsonb) to authenticated;
comment on function public.reemplazar_plan_cobro(text, jsonb, jsonb) is '332 (B95-1): reemplaza el plan de cobro de un contrato en una transacción serializada por contrato; revalida pagos/acuerdo/valor con el candado. SECURITY INVOKER.';

-- B95-5: duplicar_paquete_armado con la omisión de salidas vinculadas ACOTADA (ver encabezado).
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
    exception when raise_exception then
      -- B95-5: SOLO una omisión ESTABLECIDA se cuenta y se cuenta con nombre: la salida vinculada a un vuelo de Empaquetados que ya tiene record (PNR) (trg_salida_vinculada_63, 'salida_vinculada_record').
      -- Cualquier otro fallo (otra guarda, permisos, restricciones, errores inesperados) NO se omite: se vuelve a lanzar y la transacción completa se revierte (no queda ningún paquete nuevo).
      -- Solo se capturan los errores lanzados con RAISE EXCEPTION (SQLSTATE P0001); los de permisos/restricciones/datos ni siquiera entran aquí.
      if s.empaquetado_id is not null and sqlerrm like 'salida_vinculada_record:%' then
        v_sal_omitidas := v_sal_omitidas + 1;
      else
        raise;
      end if;
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
comment on function public.duplicar_paquete_armado(bigint) is '#61 (331, acotada por la 332): duplica un paquete armado como borrador inactivo y sin publicar (configuración + hijos), atómico, SECURITY INVOKER. Solo omite la salida vinculada cuyo vuelo de Empaquetados ya tiene record; cualquier otro fallo revierte todo.';
