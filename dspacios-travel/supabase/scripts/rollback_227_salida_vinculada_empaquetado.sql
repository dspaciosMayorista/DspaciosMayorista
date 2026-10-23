-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK 227 · salida de Dinámico vinculada a Empaquetados sin record + modo cop_trm_63.
--
-- SOLO ANTES DE USARLA. Se NIEGA (excepción, sin cambiar nada) si ya hay un paquete en modo cop_trm_63, una salida
-- vinculada, una obligación (CxP) con equivalente COP congelado, una publicación 63, una OFERTA cotizada, una ACEPTACIÓN
-- o un contrato/obligación marcados como aceptados: a partir de ahí la 227 es FORWARD-ONLY (borrar esas tablas y columnas
-- destruiría el snapshot con que se vendió, el número reservado y la deuda acordada).
-- ORDEN: se corre ANTES que los rollbacks de la 226 y la 220 (la 227 depende de ambas).
-- Restaura el texto vigente de las dos funciones que la 227 reemplazó (validar_config_destinos_aereos_67 de la 220 y
-- registrar_financiero_contrato de la 210) y retira, en orden inverso, todo lo demás. Una sola transacción.
-- ───────────────────────────────────────────────────────────────────────────
begin;

do $$
declare
  v_n bigint;
begin
  if not exists (
    select 1 from information_schema.columns c
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
     where c.table_schema = 'public' and c.table_name = 'salidas_dinamicas' and c.column_name = 'empaquetado_id'
  ) then
    raise exception 'rollback 227 ABORTADO: la 227 no está aplicada (no existe salidas_dinamicas.empaquetado_id).';
  end if;
  select count(*) into v_n from public.armado_paquetes where modo_oferta <> 'legacy' or trm_oferta is not null;
  if v_n > 0 then raise exception 'rollback 227 ABORTADO: % paquete(s) ya están en modo cop_trm_63 (la 227 se usó; es forward-only).', v_n; end if;
  select count(*) into v_n from public.salidas_dinamicas where empaquetado_id is not null;
  if v_n > 0 then raise exception 'rollback 227 ABORTADO: % salida(s) vinculada(s) a Empaquetados (la 227 se usó; es forward-only).', v_n; end if;
  select count(*) into v_n from public.cuentas_por_pagar where valor_cop_63 is not null or trm_63 is not null;
  if v_n > 0 then raise exception 'rollback 227 ABORTADO: % obligación(es) con equivalente COP congelado (la 227 se usó; es forward-only).', v_n; end if;
  select count(*) into v_n from public.tarifario_oferta_63;
  if v_n > 0 then raise exception 'rollback 227 ABORTADO: % publicación(es) 63 registradas (la 227 se usó; es forward-only).', v_n; end if;
  select count(*) into v_n from public.salidas_dinamicas where moneda <> 'COP';
  if v_n > 0 then raise exception 'rollback 227 ABORTADO: % salida(s) manual(es) con moneda acreditada USD (la 227 se usó; es forward-only).', v_n; end if;
  -- E/F/G (aceptación atómica): ofertas cotizadas, aceptaciones (incluidos los números descartados = tombstones) y marcas.
  select count(*) into v_n from public.p63_oferta;
  if v_n > 0 then raise exception 'rollback 227 ABORTADO: % oferta(s) cotizada(s) con snapshot privado (la 227 se usó; es forward-only).', v_n; end if;
  select count(*) into v_n from public.p63_aceptacion;
  if v_n > 0 then raise exception 'rollback 227 ABORTADO: % aceptación(es) de oferta, con su número reservado (la 227 se usó; es forward-only).', v_n; end if;
  select count(*) into v_n from public.ventas where aceptacion_63_id is not null;
  if v_n > 0 then raise exception 'rollback 227 ABORTADO: % contrato(s) de oferta aceptada (la 227 se usó; es forward-only).', v_n; end if;
  select count(*) into v_n from public.cuentas_por_pagar where aceptacion_63_id is not null or obligacion_63 is not null;
  if v_n > 0 then raise exception 'rollback 227 ABORTADO: % obligación(es) aceptada(s) (la 227 se usó; es forward-only).', v_n; end if;
  select count(*) into v_n from public.armado_paquetes where p63_rev_costos <> 0;
  if v_n > 0 then raise exception 'rollback 227 ABORTADO: % paquete(s) con revisión de costos acumulada (la 227 se usó; es forward-only).', v_n; end if;
end $$;

-- 0. E/F/G (cierre de la aceptación atómica) — se retira PRIMERO, en orden inverso a como se creó.
drop trigger if exists trg_cxp_borrada_63 on public.cuentas_por_pagar;
drop trigger if exists trg_cxp_aceptacion_63 on public.cuentas_por_pagar;
drop trigger if exists trg_p63_pendiente on public.contrato_financiero_pendiente;
drop trigger if exists trg_ventas_costos_63 on public.ventas;
drop trigger if exists trg_ventas_borrada_63 on public.ventas;
drop trigger if exists trg_ventas_aceptacion_63_ins on public.ventas;
drop trigger if exists trg_p63_costos_parametros_ins on public.parametros_tributarios;
drop trigger if exists trg_p63_costos_parametros_upd on public.parametros_tributarios;
drop trigger if exists trg_p63_costos_aliados on public.aliados;
drop trigger if exists trg_p63_costos_empaquetados on public.empaquetados;
drop trigger if exists trg_p63_costos_proveedores on public.proveedores;
drop trigger if exists trg_p63_costos_servicios on public.servicios_adicionales;
drop trigger if exists trg_p63_costos_acomodaciones on public.hotel_acomodaciones;
drop trigger if exists trg_p63_costos_hoteles on public.hoteles;
drop trigger if exists trg_p63_aceptacion_inmutable on public.p63_aceptacion;
drop trigger if exists trg_p63_oferta_inmutable on public.p63_oferta;
alter table public.ventas drop constraint if exists ventas_aceptacion_63_fk;
alter table public.cuentas_por_pagar drop constraint if exists cuentas_por_pagar_aceptacion_63_fk;
drop index if exists public.ventas_aceptacion_63_uk;
drop index if exists public.cuentas_por_pagar_obligacion_63_uk;
alter table public.cuentas_por_pagar drop constraint if exists cuentas_por_pagar_marca63_chk;
alter table public.cuentas_por_pagar drop column if exists aceptacion_63_id, drop column if exists obligacion_63;
alter table public.ventas drop column if exists aceptacion_63_id;
alter table public.armado_paquetes drop column if exists p63_rev_costos;
drop table if exists public.p63_aceptacion;
drop table if exists public.p63_oferta;
drop function if exists public.p63_registrar_financiero(text, text, jsonb, jsonb, bigint);
drop function if exists public.aceptar_oferta_63(bigint, text, uuid, text, text);
drop function if exists public.crear_cotizacion_oferta_63(uuid, text, jsonb, jsonb, text, text, jsonb);
drop function if exists public.p63_validar_pendiente(text, jsonb, jsonb);
drop function if exists public.p63_payload_alterno(bigint, jsonb, jsonb);
drop function if exists public.p63_hijos_pendientes(bigint);
drop function if exists public.p63_financiero_derivado(bigint);
drop function if exists public.p63_hoy_bogota();
drop function if exists public.p63_bump_costos(bigint[]);
drop function if exists public.p63_bump_costos_todos();
drop function if exists public.trg_p63_costos_b2b();
drop function if exists public.trg_cxp_borrada_63();
drop function if exists public.trg_cxp_aceptacion_63();
drop function if exists public.trg_p63_pendiente();
drop function if exists public.trg_ventas_costos_63();
drop function if exists public.trg_ventas_borrada_63();
drop function if exists public.trg_ventas_aceptacion_63_ins();
drop function if exists public.trg_p63_costos_empaquetados();
drop function if exists public.trg_p63_costos_proveedores();
drop function if exists public.trg_p63_costos_servicios();
drop function if exists public.trg_p63_costos_acomodaciones();
drop function if exists public.trg_p63_costos_hoteles();
drop function if exists public.trg_p63_inmutable();

-- 1. Triggers y funciones de trigger propias de la 227
drop trigger if exists tr_vinculo_aereo_67_salida on public.salidas_dinamicas;
drop trigger if exists tr_salida_vinculada_63 on public.salidas_dinamicas;
drop trigger if exists tarifario_trg_empaquetado_vinculadas_63 on public.empaquetados;
drop trigger if exists tr_inv_modo_oferta_63 on public.armado_paquetes;
drop trigger if exists tr_modo_oferta_vinculadas_63 on public.armado_paquetes;
drop function if exists public.trg_vinculo_aereo_67_salida();
drop function if exists public.trg_salida_vinculada_63();
drop function if exists public.tarifario_trg_empaquetado_vinculadas_63();
drop function if exists public.trg_invalidar_modo_oferta_63();
drop function if exists public.trg_modo_oferta_vinculadas_63();

-- 2. Envoltorio de publicación y metadata privada
drop function if exists public.publicar_tarifario_resultado_63(bigint, bigint, bigint, text, jsonb, text, numeric);
drop table if exists public.tarifario_oferta_63;

-- 3. Texto vigente (220) de la guarda de configuración de destinos aéreos
create or replace function public.validar_config_destinos_aereos_67(p_paquete_id bigint)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_destino  bigint;
  v_check    boolean;
  v_alts     bigint[];
  v_pais     text;
  v_malas    text;
  v_ef       bigint[];
  v_lista    text;
  v_n        int;
begin
  select p.destino_id, p.destinos_aereos_alternativos into v_destino, v_check
    from public.armado_paquetes p where p.id = p_paquete_id for no key update;
  if not found then
    return;                                   -- el paquete se eliminó en esta transacción
  end if;
  select array_agg(a.destino_id order by a.destino_id) into v_alts
    from public.armado_paquete_destinos_aereos a where a.paquete_id = p_paquete_id;

  -- 1. Las alternativas guardadas deben ser válidas (estricto, aunque el check esté apagado).
  if v_alts is not null then
    if v_destino is null then
      raise exception 'destino_aereo_config: hay destinos alternativos pero el paquete no tiene destino comercial';
    end if;
    select public.pais_comparable_67(d.pais) into v_pais from public.destinos d where d.id = v_destino;
    if v_pais is null then
      raise exception 'destino_aereo_config: el destino comercial no tiene país registrado; sin país comparable no se admiten destinos alternativos';
    end if;
    select string_agg(coalesce(d.nombre, 'destino #' || a.id::text), ', ' order by a.id) into v_malas
      from unnest(v_alts) as a(id)
      left join public.destinos d on d.id = a.id
     where d.id is null
        or a.id = v_destino
        or not coalesce(d.activo, false)
        or public.pais_comparable_67(d.pais) is distinct from v_pais;
    if v_malas is not null then
      raise exception 'destino_aereo_config: alternativas no válidas (deben ser destinos activos del mismo país que el comercial): %', v_malas;
    end if;
  end if;

  -- 2. Encendido exige destino comercial y al menos una alternativa.
  if v_check then
    if v_destino is null then
      raise exception 'destino_aereo_config: no se puede activar destinos alternativos sin destino comercial';
    end if;
    if coalesce(cardinality(v_alts), 0) = 0 then
      raise exception 'destino_aereo_config: para activar los destinos alternativos elige al menos uno distinto del comercial';
    end if;
  end if;

  -- 3. Ningún vuelo YA vinculado puede quedar fuera de los destinos efectivos.
  v_ef := public.destinos_aereos_efectivos_67(v_destino, v_check, coalesce(v_alts, '{}'::bigint[]));
  with incompatibles as (
    select 'vuelo ' || coalesce(b.record, 'sin record') || coalesce(' ' || b.ruta, '') || ' (#' || b.id || ')' as d
      from public.armado_vuelos av join public.bloqueos_vuelo b on b.id = av.bloqueo_id
     where av.paquete_id = p_paquete_id and (b.destino_id is null or not (b.destino_id = any (v_ef)))
    union all
    select 'vuelo Sistema ' || coalesce(e.record, 'sin record') || coalesce(' ' || e.ruta, '') || ' (#' || e.id || ')'
      from public.armado_empaquetados ae join public.empaquetados e on e.id = ae.empaquetado_id
     where ae.paquete_id = p_paquete_id and (e.destino_id is null or not (e.destino_id = any (v_ef)))
  )
  select count(*), string_agg(d, '; ') into v_n, v_lista from (select d from incompatibles limit 8) x;
  if coalesce(v_n, 0) > 0 then
    raise exception 'destino_aereo_vinculos: hay vuelos vinculados que dejarían de cumplir los destinos aéreos del paquete (desvincúlalos explícitamente): %', v_lista;
  end if;
end;
$$;

-- 4. Texto vigente (210) de la RPC financiera (sin valor_cop_63/trm_63); se reafirma su ACL (solo service_role)
create or replace function public.registrar_financiero_contrato(
  p_numero_contrato text,
  p_tenant          text,
  p_costos          jsonb,
  p_cxp             jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_estado     text;
  v_item       jsonb;
  v_ids        jsonb := '[]'::jsonb;
  v_eliminadas jsonb := '[]'::jsonb;
  v_id         bigint;
  v_valor      numeric;
begin
  if p_numero_contrato is null or btrim(p_numero_contrato) = '' then
    raise exception 'registrar_financiero_contrato: numero_contrato vacío';
  end if;
  if p_tenant is null or btrim(p_tenant) = '' then
    raise exception 'registrar_financiero_contrato: tenant vacío';
  end if;

  select v.financiero_estado into v_estado
  from public.ventas v
  where v.numero_contrato = p_numero_contrato and v.tenant = p_tenant
  for update;
  if not found then
    raise exception 'registrar_financiero_contrato: el contrato % no existe en la agencia %', p_numero_contrato, p_tenant;
  end if;

  -- K15: la escritura financiera se hace UNA vez. Un contrato que ya no está
  -- pendiente (otra sesión lo completó mientras esta esperaba el candado, un
  -- reintento tras una respuesta perdida, o nunca fue pendiente) NO se toca:
  -- ni se borran sus CxP, ni se tocan los costos, ni se devuelven ids para que
  -- la app mueva asientos. Se limpia, eso sí, un payload residual.
  if v_estado is distinct from 'pendiente' then
    delete from public.contrato_financiero_pendiente where numero_contrato = p_numero_contrato;
    return jsonb_build_object('creadas', '[]'::jsonb, 'eliminadas', '[]'::jsonb, 'ya_completo', true, 'estado', v_estado);
  end if;

  if p_cxp is not null and jsonb_typeof(p_cxp) <> 'array' then
    raise exception 'registrar_financiero_contrato: p_cxp debe ser un arreglo';
  end if;
  for v_item in select * from jsonb_array_elements(coalesce(p_cxp, '[]'::jsonb)) loop
    if coalesce(btrim(v_item->>'tipo_proveedor'), '') = '' then
      raise exception 'registrar_financiero_contrato: una CxP no declara tipo_proveedor';
    end if;
    begin
      v_valor := (v_item->>'valor_total')::numeric;
    exception when others then
      raise exception 'registrar_financiero_contrato: valor_total no numérico en la CxP "%"', coalesce(v_item->>'servicio', '(sin nombre)');
    end;
    if v_valor is null or v_valor < 0 then
      raise exception 'registrar_financiero_contrato: valor_total inválido (%) en la CxP "%"', v_valor, coalesce(v_item->>'servicio', '(sin nombre)');
    end if;
  end loop;

  -- (Contrato pendiente: normalmente sin CxP; si quedaron CxP automáticas de un
  -- intento anterior sin pagos ni retenciones, se reemplazan como en la 172.)
  with borradas as (
    delete from public.cuentas_por_pagar c
    where c.numero_contrato = p_numero_contrato
      and c.observaciones like public.marca_cxp_automatica() || '%'
      and not exists (select 1 from public.cxp_pagos p where p.cuenta_por_pagar_id = c.id)
      and not exists (select 1 from public.retenciones_cxp r where r.cuenta_por_pagar_id = c.id)
    returning c.id
  )
  select coalesce(jsonb_agg(borradas.id), '[]'::jsonb) into v_eliminadas from borradas;

  update public.ventas v set
    costo_hotel      = coalesce((p_costos->>'costo_hotel')::numeric,      v.costo_hotel),
    costo_aereo      = coalesce((p_costos->>'costo_aereo')::numeric,      v.costo_aereo),
    costo_receptivo  = coalesce((p_costos->>'costo_receptivo')::numeric,  v.costo_receptivo),
    costo_asistencia = coalesce((p_costos->>'costo_asistencia')::numeric, v.costo_asistencia),
    otros_costos     = coalesce((p_costos->>'otros_costos')::numeric,     v.otros_costos)
  where v.numero_contrato = p_numero_contrato;

  for v_item in select * from jsonb_array_elements(coalesce(p_cxp, '[]'::jsonb)) loop
    insert into public.cuentas_por_pagar (
      numero_contrato, tenant, proveedor, tipo_proveedor, servicio, servicio_id,
      valor_total, moneda, fecha_obligacion, fecha_vencimiento,
      aplica_retencion, pct_retencion, observaciones
    ) values (
      p_numero_contrato,
      p_tenant,
      nullif(btrim(coalesce(v_item->>'proveedor', '')), ''),
      v_item->>'tipo_proveedor',
      nullif(btrim(coalesce(v_item->>'servicio', '')), ''),
      nullif(v_item->>'servicio_id', '')::bigint,
      (v_item->>'valor_total')::numeric,
      coalesce(nullif(v_item->>'moneda', ''), 'COP'),
      nullif(v_item->>'fecha_obligacion', '')::date,
      nullif(v_item->>'fecha_vencimiento', '')::date,
      coalesce((v_item->>'aplica_retencion')::boolean, false),
      coalesce((v_item->>'pct_retencion')::numeric, 0),
      coalesce(nullif(v_item->>'observaciones', ''), public.marca_cxp_automatica())
    )
    returning id into v_id;

    v_ids := v_ids || jsonb_build_object(
      'id', v_id,
      'tipo_proveedor', v_item->>'tipo_proveedor',
      'proveedor', v_item->>'proveedor',
      'servicio', v_item->>'servicio',
      'servicio_id', v_item->>'servicio_id',
      'valor_total', (v_item->>'valor_total')::numeric
    );
  end loop;

  -- 'completo' nace en la MISMA transacción que escribe costos y CxP, y deja la
  -- marca durable que impide a la compensación borrar este contrato (210).
  update public.ventas
     set financiero_estado = 'completo', financiero_actualizado_en = now(), financiero_registrado_en = now()
   where numero_contrato = p_numero_contrato;
  delete from public.contrato_financiero_pendiente where numero_contrato = p_numero_contrato;

  return jsonb_build_object('creadas', v_ids, 'eliminadas', v_eliminadas);
end;
$$;

comment on function public.registrar_financiero_contrato(text, text, jsonb, jsonb) is
  '210: escribe costos + CxP + estado completo EN UNA TRANSACCIÓN, solo sobre un contrato en financiero_estado=pendiente; en otro estado es un no-op {ya_completo:true} que no toca nada. Solo service_role.';

revoke all on function public.registrar_financiero_contrato(text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.registrar_financiero_contrato(text, text, jsonb, jsonb) to service_role;

-- 5. Columnas, índices y CHECK de la 227 (en orden inverso)
alter table public.cuentas_por_pagar drop constraint if exists cuentas_por_pagar_cop63_chk;
alter table public.cuentas_por_pagar drop column if exists valor_cop_63, drop column if exists trm_63;

drop index if exists public.idx_salidas_dinamicas_empaquetado;
drop index if exists public.salidas_dinamicas_paquete_empaquetado_uk;
alter table public.salidas_dinamicas drop constraint if exists salidas_dinamicas_vinculada_chk;
alter table public.salidas_dinamicas drop constraint if exists salidas_dinamicas_moneda_chk;
alter table public.salidas_dinamicas drop column if exists empaquetado_id, drop column if exists moneda;

alter table public.empaquetados drop constraint if exists empaquetados_moneda_cop_chk;
alter table public.empaquetados drop column if exists moneda;

alter table public.armado_paquetes drop constraint if exists armado_paquetes_modo63_chk;
alter table public.armado_paquetes drop constraint if exists armado_paquetes_trm_oferta_chk;
alter table public.armado_paquetes drop constraint if exists armado_paquetes_modo_oferta_chk;
alter table public.armado_paquetes drop column if exists modo_oferta, drop column if exists trm_oferta;

commit;
