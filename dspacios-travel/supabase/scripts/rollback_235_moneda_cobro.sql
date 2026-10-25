-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK de la 235 (moneda de cobro del contrato). Restaura el texto EXACTO de las funciones y la vista que la 235 reemplaza (234 / 227 / 156),
-- elimina la fórmula p63_total_cobro, el trigger de cobro congelado y las columnas moneda_cobro / trm_cobro / total_cobro.
-- SE NIEGA si ya hay contratos o aceptaciones con una conversión de cobro (moneda de cobro distinta de la de la oferta): el esquema anterior no
-- sabe cobrar en otra moneda y perdería el total convertido y su TRM. Hay que decidir antes qué hacer con ellos.
-- Las columnas de contratos que cobran en la moneda de su oferta (sin conversión) se descartan: era informativa.
-- ───────────────────────────────────────────────────────────────────────────
begin;

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ventas' and column_name = 'moneda_cobro') then
    raise exception 'ROLLBACK 235 ABORTADO: la 235 no está aplicada (no existe ventas.moneda_cobro).';
  end if;
  if exists (select 1 from public.ventas v where v.moneda_cobro is not null and v.moneda_cobro is distinct from coalesce(v.moneda, 'COP')) then
    raise exception 'ROLLBACK 235 ABORTADO: hay contratos que se cobran en una moneda distinta de la de su oferta (conversión congelada con TRM de cobro).';
  end if;
  if exists (select 1 from public.p63_aceptacion a where a.total_cobro is not null or a.trm_cobro is not null) then
    raise exception 'ROLLBACK 235 ABORTADO: hay aceptaciones #63 con conversión de cobro congelada.';
  end if;
end $$;

drop trigger if exists trg_p235_cf_cobro_guarda on public.contrato_facturacion;
drop function if exists public.p235_cf_cobro_guarda();
drop trigger if exists trg_p63_aceptacion_cobro_requerido on public.p63_aceptacion;
drop function if exists public.trg_p63_aceptacion_cobro_requerido();
drop trigger if exists trg_ventas_cobro_congelado on public.ventas;
drop function if exists public.trg_ventas_cobro_congelado();

-- La vista vuelve a su definición de la 156 (sin las columnas de cobro: CREATE OR REPLACE no puede quitar columnas).
drop view if exists public.ventas_basica;
create view public.ventas_basica as
  select
    v.numero_contrato, v.fecha_venta, v.asesor, v.canal, v.tipo_cliente,
    v.cliente,
    case
      when public.mi_rol() <> 'venta' or public.soy_asesor_del_contrato(v.numero_contrato)
        then v.cliente_documento
      when v.cliente_documento is null then null
      when length(v.cliente_documento) <= 4 then '••••'
      else '••••' || right(v.cliente_documento, 4)
    end as cliente_documento,
    v.cliente_telefono, v.cliente_email,
    v.destino, v.tipo_paquete, v.fecha_salida, v.fecha_regreso, v.fecha_emision,
    v.pax, v.hotel, v.aerolinea, v.receptivo, v.asistencia, v.otros_proveedores,
    v.precio_venta, v.moneda, v.estado, v.facturado, v.numero_documento,
    v.plan_nombre, v.tours_traslados, v.asistencia_medica, v.plazo,
    v.tipo_asesor, v.agencia_nombre, v.agencia_asesor, v.freelance_nombre, v.aliado_id,
    v.asesor_firma_nombre, v.asesor_firma_cargo, v.asesor_firma_tel,
    v.paquete_armado_id, v.bloqueo_ref_id, v.empaquetado_ref_id, v.tenant,
    case
      when public.mi_rol() <> 'venta' or public.soy_asesor_del_contrato(v.numero_contrato)
        then v.cliente_direccion
      else null
    end as cliente_direccion,
    case
      when public.mi_rol() <> 'venta' or public.soy_asesor_del_contrato(v.numero_contrato)
        then v.asesor_firma_cc
      else null
    end as asesor_firma_cc,
    case
      when public.mi_rol() <> 'venta' or public.soy_asesor_del_contrato(v.numero_contrato)
        then v.share_token
      else null
    end as share_token,
    v.created_at, v.updated_at
  from public.ventas v
  where
    public.mi_rol() in ('superadmin','gerencia')
    or (public.mi_rol() in ('administracion','operaciones','venta')
        and public.puede_ver_tenant(v.tenant));

grant select on public.ventas_basica to authenticated;

create or replace function public.trg_p63_inmutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'p63_historico: % es historia de lo aceptado y no se borra', tg_table_name;
  end if;
  if tg_table_name = 'p63_oferta' then
    if new.cotizacion_id is distinct from old.cotizacion_id or new.tenant is distinct from old.tenant
       or new.paquete_id is distinct from old.paquete_id or new.salida_id is distinct from old.salida_id
       or new.trm is distinct from old.trm or new.rev_fuente is distinct from old.rev_fuente
       or new.rev_publicada is distinct from old.rev_publicada or new.gen_publicada is distinct from old.gen_publicada
       or new.rev_costos is distinct from old.rev_costos or new.huella is distinct from old.huella
       or new.huella_financiera is distinct from old.huella_financiera or new.snapshot is distinct from old.snapshot
       or new.creada_en is distinct from old.creada_en then
      raise exception 'p63_inmutable: el snapshot y la identidad de una oferta cotizada no se modifican';
    end if;
  else
    if new.oferta_id is distinct from old.oferta_id or new.cotizacion_id is distinct from old.cotizacion_id
       or new.tenant is distinct from old.tenant or new.numero_contrato is distinct from old.numero_contrato
       or new.usuario_id is distinct from old.usuario_id or new.fecha_negocio is distinct from old.fecha_negocio
       or new.snapshot is distinct from old.snapshot or new.creada_en is distinct from old.creada_en
       or new.trm_provisional is distinct from old.trm_provisional then
      raise exception 'p63_inmutable: el snapshot y la identidad de una aceptación no se modifican';
    end if;
    if (old.estado = 'completa' and new.estado <> 'completa') or (old.estado = 'descartada' and new.estado <> 'descartada') then
      raise exception 'p63_inmutable: una aceptación % no vuelve a otro estado', old.estado;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.trg_p63_inmutable() from public, anon, authenticated;

create or replace function public.trg_ventas_aceptacion_63_ins()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_a      public.p63_aceptacion;
  v_c      jsonb;
  v_precio numeric;
  v_b2b    jsonb;
  v_dif    text := '';
begin
  select * into v_a from public.p63_aceptacion a where a.numero_contrato = new.numero_contrato for update;
  if not found then
    if new.aceptacion_63_id is not null then
      raise exception 'p63_cabecera: la aceptación % no existe', new.aceptacion_63_id;
    end if;
    return new;
  end if;
  if new.aceptacion_63_id is distinct from v_a.id then
    raise exception 'p63_cabecera: el número % está reservado por una aceptación #63; solo ese intento puede crear su cabecera', new.numero_contrato;
  end if;
  if v_a.estado <> 'preparada' then
    raise exception 'p63_cabecera: el intento de % no está vigente (estado %); no se crea otra cabecera', new.numero_contrato, v_a.estado;
  end if;
  if v_a.tenant is distinct from new.tenant then
    raise exception 'p63_cabecera: la agencia de la cabecera no es la de la aceptación';
  end if;

  v_c := v_a.snapshot -> 'cabecera';
  v_precio := (v_c ->> 'precio_venta')::numeric;
  v_b2b := v_a.snapshot -> 'b2b';
  if new.estado is distinct from 'pendiente' or new.financiero_estado is distinct from 'pendiente' then v_dif := v_dif || 'estado '; end if;
  if new.tipo_paquete is distinct from (v_c ->> 'tipo_paquete') then v_dif := v_dif || 'tipo_paquete '; end if;
  if new.moneda is distinct from (v_c ->> 'moneda') then v_dif := v_dif || 'moneda '; end if;
  if new.fecha_salida is distinct from nullif(v_c ->> 'fecha_salida', '')::date then v_dif := v_dif || 'fecha_salida '; end if;
  if new.fecha_regreso is distinct from nullif(v_c ->> 'fecha_regreso', '')::date then v_dif := v_dif || 'fecha_regreso '; end if;
  if new.pax is distinct from (v_c ->> 'pax')::int then v_dif := v_dif || 'pax '; end if;
  if new.destino is distinct from (v_c ->> 'destino') then v_dif := v_dif || 'destino '; end if;
  if new.hotel is distinct from (v_c ->> 'hotel') then v_dif := v_dif || 'hotel '; end if;
  if new.plan_nombre is distinct from (v_c ->> 'plan_nombre') then v_dif := v_dif || 'plan '; end if;
  if new.aerolinea is distinct from (v_c ->> 'aerolinea') then v_dif := v_dif || 'aerolinea '; end if;
  if new.paquete_armado_id is distinct from nullif(v_c ->> 'paquete_armado_id', '')::bigint then v_dif := v_dif || 'paquete '; end if;
  if coalesce(new.impuesto, 0) is distinct from coalesce((v_c ->> 'impuesto')::numeric, 0) then v_dif := v_dif || 'impuesto '; end if;
  if coalesce(new.costo_aereo, 0) is distinct from coalesce((v_c ->> 'costo_aereo')::numeric, 0) then v_dif := v_dif || 'costo_aereo '; end if;
  -- Plan B2B ACEPTADO (snapshot.b2b: aliado, % , modo de compra, comisión, estado y precio final). La cabecera se contrasta contra ESE valor, no se
  -- recalcula: si el % del aliado cambió después de aceptar, la cabecera aceptada ya no coincide con lo vivo y la comisión de la base se niega.
  if new.tipo_asesor is distinct from (v_c ->> 'tipo_asesor') then v_dif := v_dif || 'tipo_asesor '; end if;
  if new.canal is distinct from (v_c ->> 'canal') then v_dif := v_dif || 'canal '; end if;
  if jsonb_typeof(v_b2b) = 'object' then
    if new.aliado_id is distinct from (v_b2b ->> 'aliado_id')::bigint then v_dif := v_dif || 'aliado '; end if;
    if new.modo_compra is distinct from nullif(v_b2b ->> 'modo_compra', '') then v_dif := v_dif || 'modo_compra '; end if;
    if new.comision_b2b is distinct from nullif(v_b2b ->> 'comision', '')::numeric then v_dif := v_dif || 'comision_b2b '; end if;
    if new.comision_estado is distinct from nullif(v_b2b ->> 'comision_estado', '') then v_dif := v_dif || 'comision_estado '; end if;
    if new.precio_venta is distinct from (v_b2b ->> 'precio_final')::numeric then v_dif := v_dif || 'precio_venta '; end if;
  else
    if new.aliado_id is not null or new.modo_compra is not null or new.comision_b2b is not null or new.comision_estado is not null then
      v_dif := v_dif || 'b2b ';
    end if;
    if new.precio_venta is distinct from v_precio then v_dif := v_dif || 'precio_venta '; end if;
  end if;
  if v_dif <> '' then
    raise exception 'p63_cabecera: la cabecera no coincide con lo aceptado (%)', btrim(v_dif);
  end if;

  update public.p63_aceptacion set estado = 'materializando', actualizada_en = now() where id = v_a.id;
  return new;
end;
$$;
revoke all on function public.trg_ventas_aceptacion_63_ins() from public, anon, authenticated;

drop function public.aceptar_oferta_63(bigint, text, uuid, text, text, numeric, text, numeric);
create or replace function public.aceptar_oferta_63(
  p_cotizacion        bigint,
  p_tenant            text,
  p_usuario           uuid,
  p_huella            text,
  p_huella_financiera text,
  p_trm_provisional   numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_o        public.p63_oferta;
  v_a        public.p63_aceptacion;
  v_s        public.salidas_dinamicas;
  v_e        public.empaquetados;
  v_snap     jsonb;
  v_paquete  bigint;
  v_salida   bigint;
  v_emp      bigint;
  v_hoy      date;
  v_activo   boolean;
  v_tipo     text;
  v_modo     text;
  v_trm      numeric;
  v_mp       text;
  v_trm_prov numeric;
  v_publica  boolean;
  v_rev_f    bigint;
  v_rev_p    bigint;
  v_gen_p    bigint;
  v_rev_c    bigint;
  v_numero   text;
  v_id       bigint;
  v_vig      jsonb;
begin
  if p_usuario is null or not exists (select 1 from public.usuarios u where u.id = p_usuario and u.activo is true) then
    raise exception 'p63_no_autorizado: usuario inexistente o inactivo';
  end if;
  select * into v_o from public.p63_oferta where cotizacion_id = p_cotizacion;
  if not found then
    raise exception 'p63_sin_oferta: la cotización % no tiene una oferta en COP con TRM', p_cotizacion;
  end if;
  if v_o.tenant is distinct from p_tenant or p_tenant is distinct from 'mayorista' then
    raise exception 'p63_no_autorizado: la oferta no pertenece a la agencia indicada';
  end if;
  v_snap := v_o.snapshot;
  v_paquete := v_o.paquete_id;
  v_salida := v_o.salida_id;
  v_emp := nullif(v_snap ->> 'empaquetado_id', '')::bigint;

  -- Candados en orden fijo.
  if v_emp is not null then
    perform 1 from public.empaquetados e where e.id = v_emp for share;
  end if;
  if v_salida is not null then
    perform 1 from public.salidas_dinamicas s where s.id = v_salida for share;
  end if;
  perform 1 from public.armado_paquetes p where p.id = v_paquete for no key update;
  select * into v_o from public.p63_oferta where id = v_o.id for update;

  -- Idempotencia: el mismo reintento recibe el MISMO intento (mismo número y mismo snapshot), nunca uno nuevo.
  select * into v_a from public.p63_aceptacion where oferta_id = v_o.id and estado <> 'descartada';
  if found then
    if v_a.estado = 'preparada' then
      return jsonb_build_object('estado', 'preparada', 'aceptacion_id', v_a.id, 'numero_contrato', v_a.numero_contrato,
                                'fecha_negocio', v_a.fecha_negocio, 'snapshot', v_a.snapshot,
                                'financiero', public.p63_financiero_derivado(v_a.id));
    end if;
    return jsonb_build_object('estado', v_a.estado, 'aceptacion_id', v_a.id, 'numero_contrato', v_a.numero_contrato);
  end if;
  if v_o.estado <> 'abierta' then
    raise exception 'p63_oferta_cerrada: la oferta de la cotización % ya fue convertida y no se reabre; genera una cotización nueva', p_cotizacion;
  end if;

  -- Revalidación en ESTE instante (hora de Bogotá).
  v_hoy := public.p63_hoy_bogota();
  select p.activo, p.tipo::text, p.modo_oferta, p.trm_oferta, p.tarifario_snapshot_publicable, p.tarifario_revision_fuente,
         p.tarifario_revision_publicada, p.tarifario_generacion_publicada, p.p63_rev_costos, p.moneda_publicacion
    into v_activo, v_tipo, v_modo, v_trm, v_publica, v_rev_f, v_rev_p, v_gen_p, v_rev_c, v_mp
    from public.armado_paquetes p where p.id = v_paquete;
  if not found or v_activo is not true or v_tipo is distinct from 'dinamico' or v_modo is distinct from 'cop_trm_63' then
    raise exception 'p63_oferta_cambio: el paquete ya no está activo en modo COP con TRM';
  end if;
  if v_trm is distinct from v_o.trm then
    raise exception 'p63_oferta_cambio: la TRM del paquete cambió desde la cotización';
  end if;
  -- 234: la moneda de la oferta es la que se cotizó; si el paquete cambió de moneda de publicación desde entonces, no se acepta.
  if coalesce(v_mp, 'COP') is distinct from coalesce(nullif(v_snap ->> 'moneda', ''), 'COP') then
    raise exception 'p63_oferta_cambio: la moneda de publicación del paquete cambió desde la cotización';
  end if;
  -- 233/234 (#93): una oferta cotizada SIN TRM no se acepta si ahora hay una fuente que convertir (o cambió la moneda) y el paquete sigue sin TRM.
  if v_trm is null and public.p63_requiere_trm(v_paquete) then
    raise exception 'p63_oferta_cambio: ahora hay componentes en USD y el paquete no tiene TRM; genera una cotización nueva';
  end if;
  if v_publica is not true or v_rev_p is distinct from v_o.rev_publicada or v_gen_p is distinct from v_o.gen_publicada then
    raise exception 'p63_oferta_cambio: el tarifario publicado del paquete cambió desde la cotización';
  end if;
  if v_rev_f is distinct from v_o.rev_fuente or v_rev_c is distinct from v_o.rev_costos then
    raise exception 'p63_oferta_cambio: una fuente, un costo, un proveedor o una retención del paquete cambió desde la cotización';
  end if;
  if p_huella is distinct from v_o.huella or p_huella_financiera is distinct from v_o.huella_financiera then
    raise exception 'p63_oferta_cambio: el precio, el vuelo o los costos recalculados ya no coinciden con lo cotizado';
  end if;

  if v_salida is not null then
    select * into v_s from public.salidas_dinamicas where id = v_salida;
    if not found or v_s.paquete_id is distinct from v_paquete or v_s.activo is not true then
      raise exception 'p63_oferta_cambio: la salida ya no existe o fue desactivada';
    end if;
    if v_s.empaquetado_id is distinct from v_emp then
      raise exception 'p63_oferta_cambio: el vínculo de la salida con Empaquetados cambió';
    end if;
    if (v_s.compra_inicio is not null and v_hoy < v_s.compra_inicio) or (v_s.compra_fin is not null and v_hoy > v_s.compra_fin) then
      raise exception 'p63_oferta_cambio: la salida está fuera de su vigencia de compra';
    end if;
    if v_s.fecha_ida is null or v_s.fecha_ida < v_hoy then
      raise exception 'p63_oferta_cambio: la fecha de la salida ya pasó';
    end if;
    if v_emp is not null then
      select * into v_e from public.empaquetados where id = v_emp;
      if not found or v_e.activo is not true then
        raise exception 'p63_oferta_cambio: el vuelo de Empaquetados vinculado ya no existe o fue desactivado';
      end if;
      if nullif(btrim(coalesce(v_e.record, '')), '') is not null then
        raise exception 'p63_oferta_cambio: el vuelo de Empaquetados vinculado ya tiene record (PNR)';
      end if;
      if (v_e.compra_inicio is not null and v_hoy < v_e.compra_inicio) or (v_e.compra_fin is not null and v_hoy > v_e.compra_fin)
         or v_e.fecha_ida is null or v_e.fecha_ida < v_hoy then
        raise exception 'p63_oferta_cambio: el vuelo de Empaquetados vinculado está fuera de vigencia';
      end if;
      -- 230: el vuelo vinculado puede estar en COP o en USD (se convierte × TRM al publicar y al cotizar); sin moneda válida o sin tarifa, no.
      if v_e.moneda is null or v_e.moneda not in ('COP', 'USD') or coalesce(v_e.tarifa_para_empaquetar, 0) <= 0 then
        raise exception 'p63_oferta_cambio: el vuelo de Empaquetados vinculado no tiene una moneda válida (COP o USD) o no tiene tarifa';
      end if;
      if round(coalesce(v_s.valor_tiquete, 0), 2) is distinct from round(v_e.tarifa_para_empaquetar, 2)
         or round(coalesce(v_s.fee_infante, 0), 2) is distinct from round(coalesce(v_e.fee_infante, 0), 2)
         or v_s.moneda is distinct from v_e.moneda
         or v_s.fecha_ida is distinct from v_e.fecha_ida or v_s.fecha_regreso is distinct from v_e.fecha_regreso
         or coalesce(v_s.ruta, '') is distinct from coalesce(v_e.ruta, '')
         or coalesce(v_s.aerolinea, '') is distinct from coalesce(v_e.aerolinea, '') then
        raise exception 'p63_oferta_cambio: la salida ya no coincide con su vuelo de Empaquetados';
      end if;
      -- Destino aéreo permitido (220/#67): misma guarda que al vincular. Re-entra en el candado del paquete que ya tenemos.
      perform public.validar_vinculo_aereo_67(v_paquete, 'empaquetado', v_emp);
    end if;
  end if;

  -- Vigencia de COMPRA de las tarifas de hotel y servicios que respaldan el precio (snapshot.vigencias: la temporada/promoción que ganó cada noche
  -- o cada servicio, con sus límites de compra, tal como se leyeron al cotizar). Con la fecha de negocio de Bogotá de ESTA transacción: una tarifa
  -- cuya compra cerró (o aún no abre) se rechaza aunque ningún UPDATE haya movido una revisión (cruce de medianoche).
  for v_vig in select e from jsonb_array_elements(coalesce(v_snap -> 'vigencias', '[]'::jsonb)) as e loop
    if (nullif(v_vig ->> 'compra_inicio', '') is not null and v_hoy < (v_vig ->> 'compra_inicio')::date)
       or (nullif(v_vig ->> 'compra_fin', '') is not null and v_hoy > (v_vig ->> 'compra_fin')::date) then
      raise exception 'p63_oferta_cambio: la tarifa "%" de % ya no está en su vigencia de compra', v_vig ->> 'ref', v_vig ->> 'origen';
    end if;
  end loop;

  -- 234: una oferta en USD SIN TRM (todas sus fuentes en USD, nada que convertir) tiene obligaciones en USD que la contabilidad (en pesos)
  -- devenga por su equivalente COP. Esa TRM PROVISIONAL la INGRESA expresamente quien convierte la cotización a contrato y queda CONGELADA en la
  -- aceptación (inmutable): las CxP y los asientos en COP salen de ella y no se mueven después. NO hay respaldo automático en
  -- el parámetro de TRM de referencia (aunque exista y sea válido): sin tasa ingresada no se contrata ni se reserva número (nunca 1 ni el
  -- nominal en dólares como pesos). Esto incluye la llamada de 5 argumentos: el 6.º parámetro vale NULL por defecto y entonces se rechaza.
  if v_o.trm is null and coalesce(nullif(v_snap ->> 'moneda', ''), 'COP') = 'USD' then
    if p_trm_provisional is null then
      raise exception 'p63_trm_requerida: la oferta está en USD sin TRM: quien la convierte a contrato debe ingresar la TRM provisional (pesos por dólar) para congelar el equivalente en COP de las obligaciones';
    end if;
    -- Debe ser finita y positiva (y no redondear a 0 con 4 decimales).
    if p_trm_provisional = 'NaN'::numeric or p_trm_provisional <= 0 or p_trm_provisional >= 100000000000 then
      raise exception 'p63_trm_invalida: la TRM provisional debe ser un número positivo y finito (pesos por dólar), recibida: %', p_trm_provisional;
    end if;
    v_trm_prov := round(p_trm_provisional, 4);
    if v_trm_prov <= 0 then
      raise exception 'p63_trm_invalida: la TRM provisional debe ser un número positivo (pesos por dólar), recibida: %', p_trm_provisional;
    end if;
  end if;

  -- Número reservado en la MISMA transacción (mayorista: secuencia dedicada, nunca se reutiliza) y snapshot congelado.
  v_numero := public.siguiente_numero_contrato_para_tenant(p_tenant);
  insert into public.p63_aceptacion (oferta_id, cotizacion_id, tenant, numero_contrato, usuario_id, fecha_negocio, snapshot, trm_provisional)
  values (v_o.id, v_o.cotizacion_id, p_tenant, v_numero, p_usuario, v_hoy, v_o.snapshot, v_trm_prov)
  returning id into v_id;
  update public.p63_oferta set estado = 'aceptada', actualizada_en = now() where id = v_o.id;

  return jsonb_build_object('estado', 'preparada', 'aceptacion_id', v_id, 'numero_contrato', v_numero, 'fecha_negocio', v_hoy,
                            'snapshot', v_o.snapshot, 'financiero', public.p63_financiero_derivado(v_id));
end;
$$;
comment on function public.aceptar_oferta_63(bigint, text, uuid, text, text, numeric) is
  '234 (sobre 233/230/227, #63/#90/#93): acepta de forma atómica una oferta cotizada: toma los candados en orden fijo, revalida AHORA (fecha de Bogotá, compra, activo, TRM, moneda de publicación, revisiones, huellas, moneda COP/USD del vuelo vinculado y de la salida, destino aéreo); en una oferta USD sin TRM exige y congela la TRM provisional ingresada al convertir (sin respaldo en el parámetro de TRM de referencia), reserva el número y congela el snapshot. Reintento = mismo intento. Solo service_role, tras autorizar el servidor.';
revoke all on function public.aceptar_oferta_63(bigint, text, uuid, text, text, numeric) from public, anon, authenticated;
grant execute on function public.aceptar_oferta_63(bigint, text, uuid, text, text, numeric) to service_role;

-- Restaura fn_dashboard_cartera_por_moneda (186) y f208_priv.importes_factura (208) tal como estaban, ANTES de quitar las columnas de cobro.
create or replace function public.fn_dashboard_cartera_por_moneda(p_tenant text, p_hoy date)
returns table(moneda text, al_dia numeric, vencida numeric, sin_fecha numeric, sin_fecha_count bigint)
language sql
security invoker
stable
set search_path = public
as $$
  with abonos_por_contrato as (
    select a.numero_contrato, sum(a.valor_abono) as suma
    from public.abonos a
    where a.tenant = p_tenant
    group by a.numero_contrato
  ),
  saldo as (
    select
      coalesce(v.moneda, 'COP') as moneda,
      (coalesce(v.precio_venta, 0) - coalesce(ap.suma, 0)) as saldo,
      v.fecha_salida
    from public.ventas v
    left join abonos_por_contrato ap on ap.numero_contrato = v.numero_contrato
    where v.tenant = p_tenant and v.estado in ('confirmado', 'activo')
  )
  select
    moneda,
    coalesce(sum(saldo) filter (where fecha_salida is not null and p_hoy <= (fecha_salida - 30)), 0) as al_dia,
    coalesce(sum(saldo) filter (where fecha_salida is not null and p_hoy > (fecha_salida - 30)), 0) as vencida,
    coalesce(sum(saldo) filter (where fecha_salida is null), 0) as sin_fecha,
    coalesce(count(*) filter (where fecha_salida is null), 0)::bigint as sin_fecha_count
  from saldo
  where saldo > 0
  group by moneda;
$$;

create or replace function f208_priv.importes_factura(p_numero text, out pvp numeric, out irt numeric, out tenant text)
language plpgsql stable set search_path = '' as $$
declare v record; v_factor numeric;
begin
  select v2.tenant, coalesce(v2.moneda, 'COP') as moneda, v2.precio_venta, v2.trm_contrato into v
    from public.ventas v2 where v2.numero_contrato = p_numero;
  tenant := v.tenant;
  if v.moneda = 'USD' then
    v_factor := coalesce(nullif(v.trm_contrato, 0), (select nullif(valor, 0)::numeric from public.parametros_tributarios where parametro = 'trm_referencia'));
    if v_factor is null or v_factor <= 0 then
      raise exception 'FIN_SIN_TRM: el contrato es en USD y no tiene TRM para convertir a pesos.' using errcode = 'F4413';
    end if;
  else
    v_factor := 1;
  end if;
  pvp := coalesce(v.precio_venta, 0) * v_factor;
  select coalesce(sum(c.valor_total), 0) * v_factor into irt
    from public.cuentas_por_pagar c
   where c.numero_contrato = p_numero and c.tenant = v.tenant and coalesce(c.clasificacion, 'costo') = 'irt';
end $$;

drop function if exists public.p63_total_cobro(numeric, text, text, numeric);

alter table public.ventas drop constraint if exists ventas_cobro_chk;
alter table public.ventas drop column if exists moneda_cobro, drop column if exists trm_cobro, drop column if exists total_cobro;
alter table public.p63_aceptacion drop constraint if exists p63_aceptacion_cobro_chk;
alter table public.p63_aceptacion drop column if exists moneda_cobro, drop column if exists trm_cobro, drop column if exists total_cobro;

commit;
