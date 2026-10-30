-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK de la 233 (moneda de publicación + TRM condicional). Restaura el texto exacto de las funciones de la 227/230 y las
-- restricciones originales. SE NIEGA si ya hay datos que el esquema anterior no admite (ofertas, publicaciones u obligaciones
-- aceptadas sin TRM, o paquetes en modo 63 sin TRM): en ese caso hay que decidir antes qué hacer con ellos.
-- Conserva la columna armado_paquetes.moneda_publicacion solo hasta el final: se elimina (no hay otra fuente de esa elección).
-- ───────────────────────────────────────────────────────────────────────────
begin;

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'armado_paquetes' and column_name = 'moneda_publicacion') then
    raise exception 'ROLLBACK 233 ABORTADO: la 233 no está aplicada.';
  end if;
  if exists (select 1 from public.armado_paquetes where modo_oferta = 'cop_trm_63' and trm_oferta is null) then
    raise exception 'ROLLBACK 233 ABORTADO: hay paquetes en modo cop_trm_63 sin TRM (el esquema anterior la exige). Asígnales una TRM o pásalos a legacy.';
  end if;
  if exists (select 1 from public.p63_oferta where trm is null) or exists (select 1 from public.tarifario_oferta_63 where trm is null) then
    raise exception 'ROLLBACK 233 ABORTADO: hay ofertas o publicaciones #63 sin TRM.';
  end if;
  if exists (select 1 from public.cuentas_por_pagar where trm_63 is null and valor_cop_63 is not null) then
    raise exception 'ROLLBACK 233 ABORTADO: hay obligaciones aceptadas sin TRM (equivalente COP sin TRM).';
  end if;
end $$;

drop trigger if exists tr_inv_moneda_publicacion_90 on public.armado_paquetes;
drop function if exists public.trg_invalidar_moneda_publicacion_90();

alter table public.armado_paquetes drop constraint armado_paquetes_modo63_moneda_chk;
alter table public.armado_paquetes drop constraint armado_paquetes_modo63_chk;
alter table public.armado_paquetes
  add constraint armado_paquetes_modo63_chk check (modo_oferta = 'legacy' or (tipo::text = 'dinamico' and trm_oferta is not null));

alter table public.tarifario_oferta_63 alter column trm set not null;
alter table public.p63_oferta alter column trm set not null;

alter table public.cuentas_por_pagar drop constraint cuentas_por_pagar_cop63_chk;
alter table public.cuentas_por_pagar
  add constraint cuentas_por_pagar_cop63_chk check (
    (valor_cop_63 is null) = (trm_63 is null)
    and (valor_cop_63 is null or valor_cop_63 >= 0)
    and (trm_63 is null or trm_63 > 0)
  );

-- Funciones: texto exacto de la 227 (publicar, cotizar, registrar) y de la 230 (aceptar).
create or replace function public.publicar_tarifario_resultado_63(
  p_paquete_id bigint,
  p_generacion bigint,
  p_revision_capturada bigint,
  p_moneda text,
  p_filas jsonb,
  p_modo text,
  p_trm numeric
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_modo      text;
  v_trm       numeric;
  v_publicado boolean;
  v_revision  bigint;
  v_fuentes   jsonb;
begin
  if coalesce(public.mi_rol()::text, '') not in ('superadmin', 'gerencia', 'administracion', 'operaciones') then
    raise exception 'publicar_tarifario_resultado_63: rol sin permiso de escritura sobre tarifario_resultado';
  end if;
  if p_paquete_id is null or p_generacion is null or p_revision_capturada is null then
    raise exception 'publicar_tarifario_resultado_63: p_paquete_id, p_generacion y p_revision_capturada son obligatorios';
  end if;
  if p_modo is distinct from 'cop_trm_63' then
    raise exception 'publicar_tarifario_resultado_63: p_modo debe ser cop_trm_63, recibido: %', p_modo;
  end if;
  if p_moneda is distinct from 'COP' then
    raise exception 'publicar_tarifario_resultado_63: el modo cop_trm_63 publica en COP, recibido: %', p_moneda;
  end if;
  if p_trm is null or p_trm <= 0 then
    raise exception 'publicar_tarifario_resultado_63: la TRM debe ser positiva, recibida: %', p_trm;
  end if;

  -- Candado del paquete (el mismo que toma el publicador vigente) y coherencia con lo que se calculó: si el modo o la TRM
  -- cambiaron mientras se generaba, esta publicación se descarta (igual que una revisión de fuente superada).
  select p.modo_oferta, p.trm_oferta into v_modo, v_trm from public.armado_paquetes p where p.id = p_paquete_id for update;
  if not found then
    raise exception 'publicar_tarifario_resultado_63: el paquete % no existe', p_paquete_id;
  end if;
  if v_modo is distinct from 'cop_trm_63' or v_trm is distinct from p_trm then
    return false;
  end if;

  -- El publicador VIGENTE (226) hace todo lo demás: token de generación, revisión, snapshot y moneda. No se copia su cuerpo.
  v_publicado := public.publicar_tarifario_resultado(p_paquete_id, p_generacion, p_revision_capturada, p_moneda, p_filas);

  if v_publicado then
    select p.tarifario_revision_publicada into v_revision from public.armado_paquetes p where p.id = p_paquete_id;
    select coalesce(jsonb_agg(jsonb_build_object(
             'salida_id', s.id, 'empaquetado_id', s.empaquetado_id, 'valor_tiquete', s.valor_tiquete, 'fee_infante', s.fee_infante
           ) order by s.id), '[]'::jsonb)
      into v_fuentes
      from public.salidas_dinamicas s
     where s.paquete_id = p_paquete_id and s.empaquetado_id is not null;
    insert into public.tarifario_oferta_63 as o (paquete_id, modo, trm, generacion, revision_fuente, fuentes, publicado_en)
    values (p_paquete_id, p_modo, p_trm, p_generacion, v_revision, v_fuentes, now())
    on conflict (paquete_id) do update
      set modo = excluded.modo, trm = excluded.trm, generacion = excluded.generacion,
          revision_fuente = excluded.revision_fuente, fuentes = excluded.fuentes, publicado_en = excluded.publicado_en;
  end if;
  return v_publicado;
end;
$$;

comment on function public.publicar_tarifario_resultado_63(bigint, bigint, bigint, text, jsonb, text, numeric) is
  '227 (#63): envuelve a publicar_tarifario_resultado (el vigente) para un paquete en modo cop_trm_63: valida modo/TRM contra el paquete bajo candado, publica por el publicador vigente y guarda la TRM/fuentes de esa publicación en la misma transacción.';
revoke all on function public.publicar_tarifario_resultado_63(bigint, bigint, bigint, text, jsonb, text, numeric) from public, anon;
grant execute on function public.publicar_tarifario_resultado_63(bigint, bigint, bigint, text, jsonb, text, numeric) to authenticated;

create or replace function public.crear_cotizacion_oferta_63(
  p_usuario           uuid,
  p_tenant            text,
  p_cotizacion        jsonb,
  p_snapshot          jsonb,
  p_huella            text,
  p_huella_financiera text,
  p_t0                jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_paquete   bigint := nullif(p_snapshot ->> 'paquete_id', '')::bigint;
  v_salida    bigint := nullif(p_snapshot ->> 'salida_id', '')::bigint;
  v_trm       numeric := nullif(p_snapshot ->> 'trm', '')::numeric;
  v_modo      text;
  v_tipo      text;
  v_trm_pq    numeric;
  v_rev_f     bigint;
  v_rev_p     bigint;
  v_gen_p     bigint;
  v_rev_c     bigint;
  v_cot       public.cotizaciones;
  v_id        bigint;
begin
  if p_usuario is null or not exists (select 1 from public.usuarios u where u.id = p_usuario and u.activo is true) then
    raise exception 'p63_no_autorizado: usuario inexistente o inactivo';
  end if;
  if p_tenant is distinct from 'mayorista' then
    raise exception 'p63_no_autorizado: la oferta en COP con TRM solo existe en el tarifario de mayorista';
  end if;
  if v_paquete is null or v_trm is null or v_trm <= 0 or coalesce(btrim(p_huella), '') = '' or coalesce(btrim(p_huella_financiera), '') = ''
     or jsonb_typeof(p_snapshot) is distinct from 'object' or p_snapshot -> 'financiero' is null or p_snapshot -> 'cabecera' is null
     or p_t0 is null then
    raise exception 'p63_invalida: snapshot, huellas o revisiones de la oferta incompletos';
  end if;

  -- FOR SHARE: espera a un cambio de fuente en curso y no deja que uno nuevo se cuele hasta que esta cotización quede escrita.
  select p.modo_oferta, p.tipo::text, p.trm_oferta, p.tarifario_revision_fuente, p.tarifario_revision_publicada,
         p.tarifario_generacion_publicada, p.p63_rev_costos
    into v_modo, v_tipo, v_trm_pq, v_rev_f, v_rev_p, v_gen_p, v_rev_c
    from public.armado_paquetes p where p.id = v_paquete for share;
  if not found then
    raise exception 'p63_oferta_cambio: el paquete % ya no existe', v_paquete;
  end if;
  if v_modo is distinct from 'cop_trm_63' or v_tipo is distinct from 'dinamico' or v_trm_pq is distinct from v_trm then
    raise exception 'p63_oferta_cambio: el modo o la TRM del paquete cambiaron mientras se cotizaba';
  end if;
  if v_rev_f is distinct from (p_t0 ->> 'rev_fuente')::bigint
     or v_rev_p is distinct from nullif(p_t0 ->> 'rev_publicada', '')::bigint
     or v_gen_p is distinct from nullif(p_t0 ->> 'gen_publicada', '')::bigint
     or v_rev_c is distinct from (p_t0 ->> 'rev_costos')::bigint then
    raise exception 'p63_oferta_cambio: la configuración del paquete cambió mientras se cotizaba';
  end if;
  if v_salida is not null and not exists (select 1 from public.salidas_dinamicas s where s.id = v_salida and s.paquete_id = v_paquete) then
    raise exception 'p63_oferta_cambio: la salida % ya no pertenece al paquete', v_salida;
  end if;

  v_cot := jsonb_populate_record(null::public.cotizaciones, p_cotizacion);
  if v_cot.tenant is distinct from p_tenant or v_cot.paquete_armado_id is distinct from v_paquete then
    raise exception 'p63_invalida: la cotización no coincide con el paquete o la agencia de la oferta';
  end if;

  insert into public.cotizaciones (
    tenant, payload, detalle, cliente, cliente_documento, destino, hotel, modulo, plan_nombre, pax, precio_venta, moneda,
    fecha_salida, fecha_regreso, vigencia_hasta, paquete_armado_id, asesor, creado_por
  ) values (
    v_cot.tenant, v_cot.payload, v_cot.detalle, v_cot.cliente, v_cot.cliente_documento, v_cot.destino, v_cot.hotel, v_cot.modulo,
    v_cot.plan_nombre, v_cot.pax, v_cot.precio_venta, v_cot.moneda, v_cot.fecha_salida, v_cot.fecha_regreso, v_cot.vigencia_hasta,
    v_cot.paquete_armado_id, v_cot.asesor, v_cot.creado_por
  ) returning id into v_id;

  insert into public.p63_oferta (
    cotizacion_id, tenant, paquete_id, salida_id, trm, rev_fuente, rev_publicada, gen_publicada, rev_costos,
    huella, huella_financiera, snapshot
  ) values (
    v_id, p_tenant, v_paquete, v_salida, v_trm, v_rev_f, v_rev_p, v_gen_p, v_rev_c, p_huella, p_huella_financiera, p_snapshot
  );
  return v_id;
end;
$$;
comment on function public.crear_cotizacion_oferta_63(uuid, text, jsonb, jsonb, text, text, jsonb) is
  '227 (#63): crea en UNA transacción la cotización y su oferta privada (snapshot completo), verificando bajo candado que las revisiones de T0 siguen vigentes. Solo service_role, tras autorizar el servidor.';
revoke all on function public.crear_cotizacion_oferta_63(uuid, text, jsonb, jsonb, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.crear_cotizacion_oferta_63(uuid, text, jsonb, jsonb, text, text, jsonb) to service_role;

create or replace function public.aceptar_oferta_63(
  p_cotizacion        bigint,
  p_tenant            text,
  p_usuario           uuid,
  p_huella            text,
  p_huella_financiera text
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
         p.tarifario_revision_publicada, p.tarifario_generacion_publicada, p.p63_rev_costos
    into v_activo, v_tipo, v_modo, v_trm, v_publica, v_rev_f, v_rev_p, v_gen_p, v_rev_c
    from public.armado_paquetes p where p.id = v_paquete;
  if not found or v_activo is not true or v_tipo is distinct from 'dinamico' or v_modo is distinct from 'cop_trm_63' then
    raise exception 'p63_oferta_cambio: el paquete ya no está activo en modo COP con TRM';
  end if;
  if v_trm is distinct from v_o.trm then
    raise exception 'p63_oferta_cambio: la TRM del paquete cambió desde la cotización';
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

  -- Número reservado en la MISMA transacción (mayorista: secuencia dedicada, nunca se reutiliza) y snapshot congelado.
  v_numero := public.siguiente_numero_contrato_para_tenant(p_tenant);
  insert into public.p63_aceptacion (oferta_id, cotizacion_id, tenant, numero_contrato, usuario_id, fecha_negocio, snapshot)
  values (v_o.id, v_o.cotizacion_id, p_tenant, v_numero, p_usuario, v_hoy, v_o.snapshot)
  returning id into v_id;
  update public.p63_oferta set estado = 'aceptada', actualizada_en = now() where id = v_o.id;

  return jsonb_build_object('estado', 'preparada', 'aceptacion_id', v_id, 'numero_contrato', v_numero, 'fecha_negocio', v_hoy,
                            'snapshot', v_o.snapshot, 'financiero', public.p63_financiero_derivado(v_id));
end;
$$;
comment on function public.aceptar_oferta_63(bigint, text, uuid, text, text) is
  '230 (sobre 227, #63): acepta de forma atómica una oferta cotizada: toma los candados en orden fijo, revalida AHORA (fecha de Bogotá, compra, activo, TRM, revisiones, huellas, moneda COP/USD del vuelo vinculado y de la salida, destino aéreo), reserva el número y congela el snapshot. Reintento = mismo intento. Solo service_role, tras autorizar el servidor.';
revoke all on function public.aceptar_oferta_63(bigint, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.aceptar_oferta_63(bigint, text, uuid, text, text) to service_role;

create or replace function public.p63_registrar_financiero(
  p_numero_contrato text,
  p_tenant          text,
  p_costos          jsonb,
  p_cxp             jsonb,
  p_aceptacion      bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_a        public.p63_aceptacion;
  v_der      jsonb;
  v_item     jsonb;
  v_ids      jsonb := '[]'::jsonb;
  v_id       bigint;
  v_valor    numeric;
  v_cop      numeric;
  v_trm      numeric;
  v_trm_snap numeric;
  v_moneda   text;
  v_msg      text;
begin
  select * into v_a from public.p63_aceptacion where id = p_aceptacion for update;
  if not found or v_a.numero_contrato is distinct from p_numero_contrato or v_a.tenant is distinct from p_tenant then
    raise exception 'registrar_financiero_contrato: la aceptación #63 del contrato % no existe o no coincide', p_numero_contrato;
  end if;
  if v_a.estado <> 'materializando' then
    raise exception 'registrar_financiero_contrato: la aceptación #63 del contrato % no está vigente (estado %)', p_numero_contrato, v_a.estado;
  end if;

  v_der := public.p63_financiero_derivado(v_a.id);
  if public.p63_payload_alterno(v_a.id, p_costos, p_cxp) then
    raise exception 'p63_payload_alterno: el payload financiero recibido no es el de la oferta aceptada del contrato %', p_numero_contrato;
  end if;
  if not exists (
    select 1 from public.contrato_financiero_pendiente cp
     where cp.numero_contrato = p_numero_contrato and cp.costos = (v_der -> 'costos') and cp.cxp = (v_der -> 'cxp')
  ) then
    raise exception 'p63_sin_pendiente: el contrato % no tiene el payload aceptado guardado como pendiente; no se completa por llamada directa', p_numero_contrato;
  end if;
  v_msg := public.p63_hijos_pendientes(v_a.id);
  if v_msg is not null then
    raise exception 'p63_pendiente: los pasos previos del contrato % no están completos (%)', p_numero_contrato, v_msg;
  end if;

  v_trm_snap := (v_a.snapshot ->> 'trm')::numeric;
  for v_item in select * from jsonb_array_elements(v_der -> 'cxp') loop
    if coalesce(btrim(v_item ->> 'tipo_proveedor'), '') = '' or coalesce(btrim(v_item ->> 'obligacion'), '') = '' then
      raise exception 'registrar_financiero_contrato: una obligación aceptada no declara tipo_proveedor u obligacion';
    end if;
    begin
      v_valor := (v_item ->> 'valor_total')::numeric;
      v_cop   := (v_item ->> 'valor_cop')::numeric;
      v_trm   := (v_item ->> 'trm')::numeric;
    exception when others then
      raise exception 'registrar_financiero_contrato: importes no numéricos en la obligación "%"', coalesce(v_item ->> 'servicio', '(sin nombre)');
    end;
    v_moneda := coalesce(nullif(v_item ->> 'moneda', ''), 'COP');
    if v_valor is null or v_valor < 0 or v_cop is null or v_cop < 0 or v_trm is distinct from v_trm_snap or v_moneda not in ('COP', 'USD') then
      raise exception 'registrar_financiero_contrato: obligación aceptada inválida (valor %, equivalente COP %, TRM %, moneda %) en "%"',
        v_valor, v_cop, v_trm, v_moneda, coalesce(v_item ->> 'servicio', '(sin nombre)');
    end if;
    if (v_moneda = 'COP' and v_cop <> v_valor) or (v_moneda = 'USD' and abs(v_cop - round(v_valor * v_trm_snap, 2)) > 0.01) then
      raise exception 'registrar_financiero_contrato: el equivalente en COP de la obligación "%" no corresponde a su valor y a la TRM aceptada', coalesce(v_item ->> 'servicio', '(sin nombre)');
    end if;
  end loop;

  perform set_config('app.p63_h', 'on', true);

  update public.ventas v set
    costo_hotel      = coalesce((v_der -> 'costos' ->> 'costo_hotel')::numeric,      v.costo_hotel),
    costo_aereo      = coalesce((v_der -> 'costos' ->> 'costo_aereo')::numeric,      v.costo_aereo),
    costo_receptivo  = coalesce((v_der -> 'costos' ->> 'costo_receptivo')::numeric,  v.costo_receptivo),
    costo_asistencia = coalesce((v_der -> 'costos' ->> 'costo_asistencia')::numeric, v.costo_asistencia),
    otros_costos     = coalesce((v_der -> 'costos' ->> 'otros_costos')::numeric,     v.otros_costos)
  where v.numero_contrato = p_numero_contrato;

  for v_item in select * from jsonb_array_elements(v_der -> 'cxp') loop
    insert into public.cuentas_por_pagar (
      numero_contrato, tenant, proveedor, tipo_proveedor, servicio, servicio_id,
      valor_total, moneda, fecha_obligacion, fecha_vencimiento,
      aplica_retencion, pct_retencion, observaciones, valor_cop_63, trm_63, aceptacion_63_id, obligacion_63
    ) values (
      p_numero_contrato,
      p_tenant,
      nullif(btrim(coalesce(v_item ->> 'proveedor', '')), ''),
      v_item ->> 'tipo_proveedor',
      nullif(btrim(coalesce(v_item ->> 'servicio', '')), ''),
      nullif(v_item ->> 'servicio_id', '')::bigint,
      (v_item ->> 'valor_total')::numeric,
      coalesce(nullif(v_item ->> 'moneda', ''), 'COP'),
      nullif(v_item ->> 'fecha_obligacion', '')::date,
      nullif(v_item ->> 'fecha_vencimiento', '')::date,
      coalesce((v_item ->> 'aplica_retencion')::boolean, false),
      coalesce((v_item ->> 'pct_retencion')::numeric, 0),
      coalesce(nullif(v_item ->> 'observaciones', ''), public.marca_cxp_automatica()),
      (v_item ->> 'valor_cop')::numeric,
      (v_item ->> 'trm')::numeric,
      v_a.id,
      v_item ->> 'obligacion'
    )
    returning id into v_id;

    v_ids := v_ids || jsonb_build_object(
      'id', v_id,
      'tipo_proveedor', v_item ->> 'tipo_proveedor',
      'proveedor', v_item ->> 'proveedor',
      'servicio', v_item ->> 'servicio',
      'servicio_id', v_item ->> 'servicio_id',
      'valor_total', (v_item ->> 'valor_total')::numeric
    );
  end loop;

  -- 'completo' nace en la MISMA transacción que escribe costos y obligaciones y marca la aceptación como convertida.
  update public.ventas
     set financiero_estado = 'completo', financiero_actualizado_en = now(), financiero_registrado_en = now()
   where numero_contrato = p_numero_contrato;
  update public.p63_aceptacion set estado = 'completa', actualizada_en = now() where id = v_a.id;
  delete from public.contrato_financiero_pendiente where numero_contrato = p_numero_contrato;

  perform set_config('app.p63_h', 'off', true);
  return jsonb_build_object('creadas', v_ids, 'eliminadas', '[]'::jsonb);
end;
$$;
revoke all on function public.p63_registrar_financiero(text, text, jsonb, jsonb, bigint) from public, anon, authenticated;

drop function if exists public.p63_requiere_trm(bigint);

alter table public.armado_paquetes drop constraint armado_paquetes_moneda_publicacion_chk;
alter table public.armado_paquetes drop column moneda_publicacion;

commit;
