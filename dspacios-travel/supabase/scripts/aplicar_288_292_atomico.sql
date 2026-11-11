-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- APLICACIÓN ATÓMICA 288 + 292 (#75) — GENERADO por generar_aplicar_288_292_atomico.sh. NO EDITAR A MANO.
-- Fuentes (md5 sin CR): 288 = b9e80720bd03872dcf21647e5b0764ee · 292 = edfa7d2d27d7a37d7bbc7b6623acd8ee
-- Una sola transacción: la 288 nunca queda visible sin la 292. Si cualquier paso falla, no se aplica NADA (repetir tras corregir).
-- Antes: preflight_288 (OK) en una consulta aparte. Después: postcheck_288 y postcheck_292. Luego la 286 (#97) y el resto de la secuencia.
-- lock_timeout: si una sesión de la app retiene ventas/cuentas_por_pagar, falla en 10 s en vez de dejar en cola a toda la app detrás del ALTER.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
begin;
set local lock_timeout = '10s';
-- ─── 288 (cuerpo íntegro) ───
-- ───────────────────────────────────────────────────────────────────────────
-- 288 · Ciclo de vida pendiente → confirmado: las OBLIGACIONES nacen al confirmar (#75, parte 1)
--
-- REGLA (dueño, 2026-11-08): un contrato pendiente, nunca confirmado, guarda información y costos PREVISTOS, pero NO obligaciones: ni cuentas por
-- pagar, ni asientos, ni comisión exigible, ni documento cobrable. Al confirmar (por pago, o por confirmación interna autorizada) se materializan UNA vez.
--
-- CÓMO (sin reescribir la lógica vigente: se conservan COPIAS VERBATIM como «base» y se envuelven):
--   · p75_priv.registrar_financiero_base      = registrar_financiero_contrato de la 236 (verbatim). El envoltorio público, si el contrato está PENDIENTE,
--     traslada las CxP automáticas recién creadas a `contrato_obligaciones_previstas` (clase 'cxp') y las borra de cuentas_por_pagar; el costo previsto
--     (ventas.costo_*) se conserva. Excepción declarada: las CxP ligadas a una aceptación #63 (aceptacion_63_id) NO se trasladan (su trigger de borrado lo
--     impide); siguen naciendo con el contrato hasta la parte 1b.
--   · COMISIÓN B2B (coordinado con #97, único responsable): #97 difiere la comisión exigible en su 286 (`comision_plan`: en pendiente solo existe el PLAN; NETO conserva su fila
--     descontada, nunca por pagar) y expone `public.materializar_comision_b2b(numero)`. Esta migración NO toca `registrar_comision_b2b_reserva`; solo llama a esa función,
--     si existe, dentro de la materialización (misma transacción que la confirmación). ORDEN: aplicar la 288 ANTES de la 286.
--   · p75_priv.materializar_obligaciones(numero): bajo FOR UPDATE de la venta y con el marcador `ventas.obligaciones_materializadas_en`, inserta lo previsto
--     UNA vez (clave única por contrato → un reintento o una carrera no duplican). Un pendiente HISTÓRICO (sin previstas) no recibe nada: se reconoce lo que
--     ya tiene y solo se marca. No borra obligaciones existentes.
--   · confirmar_venta (197): igual + materializa en la MISMA transacción. Quién puede confirmar NO cambia (INVOKER con la RLS de quien llama).
--   · registrar_abono (248): copia verbatim `p75_priv.registrar_abono_base` + decisión de confirmar por pago EN LA MISMA transacción: el abono queda aceptado
--     y, si alcanza el mínimo, confirmar + materializar ocurren en una subtransacción (todo o nada); si fallan, el abono se conserva y la respuesta informa
--     `confirmacion_error` (ni se pierde dinero recibido ni se confirma a medias).
--   · p75_priv.regla_confirmacion(numero) (PARTE 3): ÚNICA regla del mínimo para confirmar por pago, siempre identificada: NETO aliado = TOTAL NETO; condición congelada (Σ monto_exigido, su moneda y TRM);
--     legacy_pct (30 %) SOLO para históricos sin condiciones. Distinta, por diseño, del mínimo para convertir una cotización (pagos previos ≥ monto exigido de la cotización).
--
-- Compatible con el código anterior (sus CxP de pendientes se trasladan solas a «previstas»). Los contratos históricos pendientes que ya tienen
-- CxP/comisión NO se tocan. Requiere 284, 285 y 287 aplicadas. Orden: preflight_288 → esta migración → postcheck_288 → código. Rollback: scripts/rollback_288_*.sql.
-- ───────────────────────────────────────────────────────────────────────────

do $$
declare v record;
begin
  if to_regclass('public.numeros_dtm_liberados') is null or to_regprocedure('public.contrato_verificar_identidad(text,boolean)') is null
     or to_regprocedure('public.soporte_verificar_identidad(text)') is null then
    raise exception '288: faltan la 284, la 285 y/o la 287. Aplicarlas antes.';
  end if;
  if to_regclass('public.contrato_obligaciones_previstas') is not null then
    raise exception '288: ya aplicada (existe contrato_obligaciones_previstas). No se re-aplica.';
  end if;
  -- Las definiciones que esta migración envuelve/reemplaza deben ser EXACTAMENTE las que se copiaron (no se asume que el remoto coincida con el repo).
  for v in select * from (values
      ('public.confirmar_venta(text)',                                                        '97809e36dab24bc4ecfddf37a9ef4016'),
      ('public.registrar_abono(text,text,uuid,numeric,numeric,text,text,date,boolean,uuid)',  'b2e0d1e0aa37bcf11e00c58afbabffd9'),
      ('public.registrar_financiero_contrato(text,text,jsonb,jsonb)',                         '33e309dc1181020d20809a4f79394dbc'),
      ('public.convertir_cotizacion_a_contrato(bigint,uuid)',                             'edc9975010746e53e4af6a75ad9763dc'),
      ('public.transferir_pagos_previos_a_abonos(bigint,text,uuid)',                      '4814691695eb7587c18628ede17f266f'),
      ('public.trg_cxp_borrada_63()',                                                      'c3150ccad0ef87818956ebc1e53f82d9')
    ) t(f, esperado) loop
    if (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p where p.oid = to_regprocedure(v.f)) is distinct from v.esperado then
      raise exception '288: la definición de % en esta base NO es la esperada (md5 %). No se reemplaza una versión distinta.', v.f, v.esperado;
    end if;
  end loop;
end $$;

-- ── 1) Columnas, tabla de previstas y esquema privado ────────────────────────────────────────────────
alter table public.ventas add column if not exists obligaciones_materializadas_en timestamptz;
comment on column public.ventas.obligaciones_materializadas_en is 'Migración 288 (#75): momento en que se materializaron las obligaciones previstas al confirmar. NULL = nunca (pendiente, o histórico anterior a la 288).';
alter table public.cuentas_por_pagar add column if not exists clave_prevista text;
create unique index if not exists cxp_clave_prevista_uq on public.cuentas_por_pagar (numero_contrato, clave_prevista) where clave_prevista is not null;

create schema if not exists p75_priv;
revoke all on schema p75_priv from public, anon;
grant usage on schema p75_priv to authenticated, service_role;

create table public.contrato_obligaciones_previstas (
  id               bigserial primary key,
  numero_contrato  text not null references public.ventas(numero_contrato) on delete cascade,
  clase            text not null check (clase in ('cxp')),
  clave            text not null,
  payload          jsonb not null,
  creado_en        timestamptz not null default now(),
  materializada_en timestamptz,
  unique (numero_contrato, clase, clave)
);
comment on table public.contrato_obligaciones_previstas is 'Migración 288 (#75): obligaciones PREVISTAS de un contrato pendiente (CxP). No son exigibles; se materializan una vez al confirmar. Solo las escriben/leen funciones SECURITY DEFINER.';
alter table public.contrato_obligaciones_previstas enable row level security;
revoke all on public.contrato_obligaciones_previstas from public, anon, authenticated;
grant all on public.contrato_obligaciones_previstas to service_role;
grant usage, select on sequence public.contrato_obligaciones_previstas_id_seq to service_role;
insert into public.contrato_guardas_config (tabla, modo, resolvedor, columnas_exentas, motivo)
values ('contrato_obligaciones_previstas', 'estricto', null, null, 'obligaciones previstas del contrato (288): se escriben y borran con el contrato y la guarda exige su identidad')
on conflict (tabla) do nothing;
select public.contrato_instalar_guardas();

-- ── 2) Copias VERBATIM de las funciones vigentes (renombradas a «base»; su comportamiento no cambia) ─────────────────
CREATE OR REPLACE FUNCTION p75_priv.registrar_financiero_base(p_numero_contrato text, p_tenant text, p_costos jsonb, p_cxp jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_estado     text;
  v_item       jsonb;
  v_ids        jsonb := '[]'::jsonb;
  v_eliminadas jsonb := '[]'::jsonb;
  v_id         bigint;
  v_valor      numeric;
  v_acep       bigint;
  v_moneda     text;
  v_cop        numeric;
  v_trm        numeric;
  v_trm_unica  numeric;
  v_con_eq     boolean := false;
  v_usd_sin_eq boolean := false;
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

  -- K15: la escritura financiera se hace UNA vez (sin cambios respecto de la 227).
  if v_estado is distinct from 'pendiente' then
    delete from public.contrato_financiero_pendiente where numero_contrato = p_numero_contrato;
    return jsonb_build_object('creadas', '[]'::jsonb, 'eliminadas', '[]'::jsonb, 'ya_completo', true, 'estado', v_estado);
  end if;

  -- 227 (#63): un contrato ligado a una aceptación de oferta COP con TRM deriva todo de lo aceptado (sin cambios).
  select v.aceptacion_63_id into v_acep from public.ventas v where v.numero_contrato = p_numero_contrato;
  if v_acep is not null then
    return public.p63_registrar_financiero(p_numero_contrato, p_tenant, p_costos, p_cxp, v_acep);
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

    -- 236 (#90 I): equivalente en COP a la TRM de costos. Las claves son propias (no las `valor_cop`/`trm` de #63, que este camino ignora).
    v_moneda := coalesce(nullif(v_item->>'moneda', ''), 'COP');
    if (nullif(v_item->>'valor_cop_costo', '') is null) <> (nullif(v_item->>'trm_costo', '') is null) then
      raise exception 'registrar_financiero_contrato: la CxP "%" trae el equivalente en COP sin su TRM de costos (o al revés)', coalesce(v_item->>'servicio', '(sin nombre)');
    end if;
    if nullif(v_item->>'valor_cop_costo', '') is not null then
      begin
        v_cop := (v_item->>'valor_cop_costo')::numeric;
        v_trm := (v_item->>'trm_costo')::numeric;
      exception when others then
        raise exception 'registrar_financiero_contrato: equivalente o TRM de costos no numéricos en la CxP "%"', coalesce(v_item->>'servicio', '(sin nombre)');
      end;
      if v_moneda is distinct from 'USD' then
        raise exception 'registrar_financiero_contrato: la CxP "%" lleva equivalente de costos pero no está en USD (moneda %)', coalesce(v_item->>'servicio', '(sin nombre)'), v_moneda;
      end if;
      if v_trm is null or v_trm = 'NaN'::numeric or v_trm <= 0 or v_trm >= 100000000000 or round(v_trm, 4) <= 0
         or v_cop is null or v_cop = 'NaN'::numeric or v_cop < 0 then
        raise exception 'registrar_financiero_contrato: TRM de costos (%) o equivalente en COP (%) inválidos en la CxP "%"', v_trm, v_cop, coalesce(v_item->>'servicio', '(sin nombre)');
      end if;
      if abs(v_cop - round(v_valor * round(v_trm, 4), 2)) > 0.01 then
        raise exception 'registrar_financiero_contrato: el equivalente en COP de la CxP "%" no corresponde a su valor y a la TRM de costos', coalesce(v_item->>'servicio', '(sin nombre)');
      end if;
      if v_trm_unica is not null and round(v_trm, 4) <> v_trm_unica then
        raise exception 'registrar_financiero_contrato: un contrato congela una sola TRM de costos (recibidas % y %)', v_trm_unica, round(v_trm, 4);
      end if;
      v_trm_unica := round(v_trm, 4);
      v_con_eq := true;
    elsif v_moneda = 'USD' and v_valor > 0 then
      v_usd_sin_eq := true;
    end if;
  end loop;
  -- Si una CxP del payload lleva el equivalente, TODA CxP en USD con importe lo lleva: nunca un devengo mixto (algunas por su equivalente, otras nominales).
  if v_con_eq and v_usd_sin_eq then
    raise exception 'registrar_financiero_contrato: hay CxP en USD con equivalente de costos y otras en USD sin él; todas las obligaciones en USD del contrato deben llevarlo';
  end if;

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
      aplica_retencion, pct_retencion, observaciones, valor_cop_costo, trm_costo
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
      coalesce(nullif(v_item->>'observaciones', ''), public.marca_cxp_automatica()),
      nullif(v_item->>'valor_cop_costo', '')::numeric,
      round(nullif(v_item->>'trm_costo', '')::numeric, 4)
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

  update public.ventas
     set financiero_estado = 'completo', financiero_actualizado_en = now(), financiero_registrado_en = now()
   where numero_contrato = p_numero_contrato;
  delete from public.contrato_financiero_pendiente where numero_contrato = p_numero_contrato;

  return jsonb_build_object('creadas', v_ids, 'eliminadas', v_eliminadas);
end;
$function$

;

CREATE OR REPLACE FUNCTION p75_priv.registrar_abono_base(p_numero text, p_tenant text, p_actor uuid, p_monto_cop numeric, p_trm numeric, p_forma text, p_ref text, p_fecha date, p_confirmar boolean, p_operacion uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  u public.usuarios;
  v public.ventas;
  v_tenant text;
  v_op uuid := coalesce(p_operacion, gen_random_uuid());
  v_prev public.abono_operaciones;
  v_fecha date; v_huella text;
  v_mo text; v_mc text; v_moneda text; v_total numeric;
  v_trm numeric; v_valor numeric; v_pagado numeric; v_tol numeric;
  v_id bigint; v_err text;
begin
  u := f208_priv.actor(p_actor, array['superadmin','gerencia','administracion','operaciones']);
  perform pg_catalog.set_config('lock_timeout', '5s', true);
  if p_monto_cop is null or p_monto_cop <= 0 then
    raise exception 'FIN_VALOR_INVALIDO: el valor del abono debe ser mayor a 0.' using errcode = 'F4464';
  end if;

  v_tenant := f208_priv.bloquear_venta(p_numero, 'update');          -- serializa registros, anulaciones y facturas
  perform f208_priv.exigir_agencia(u, p_tenant, v_tenant, array['superadmin','gerencia']);
  select * into v from public.ventas where numero_contrato = p_numero;
  if v.financiero_estado = 'pendiente' then
    raise exception 'FIN_FINANCIERO_PENDIENTE: el contrato % tiene pendiente su registro financiero; no admite abonos hasta completar la reconciliación.', p_numero using errcode = 'F4465';
  end if;

  -- Total a cobrar y moneda de cobro (espejo de lib/finanzas/cobro.ts → cobroDeVenta).
  v_mo := case when upper(coalesce(v.moneda, 'COP')) = 'USD' then 'USD' else 'COP' end;
  v_mc := case when v.moneda_cobro is null then null when upper(v.moneda_cobro) = 'USD' then 'USD' else 'COP' end;
  if v_mc is not null and v_mc <> v_mo and coalesce(v.total_cobro, 0) > 0 and coalesce(v.trm_cobro, 0) > 0 then
    v_moneda := v_mc; v_total := v.total_cobro;
  else
    v_moneda := v_mo; v_total := coalesce(v.precio_venta, 0);
  end if;
  if v_moneda = 'USD' then
    if p_trm is null or p_trm <= 0 then
      raise exception 'FIN_TRM_REQUERIDA: indica la TRM del día para el abono (contrato en USD).' using errcode = 'F4467';
    end if;
    v_trm := p_trm; v_valor := p_monto_cop / p_trm; v_tol := 0.01;
  else
    v_trm := 1; v_valor := p_monto_cop; v_tol := 0.5;
  end if;

  -- Idempotencia: la clave identifica el abono COMPLETO (contrato, agencia, valor, TRM, forma, referencia, fecha y
  -- quien lo registra). Misma clave + mismos datos = el mismo abono (no se duplica); cualquier dato distinto se
  -- rechaza; y si el abono de esa operación ya no existe (anulado) NO se responde éxito apuntando a una fila fantasma.
  v_fecha := coalesce(p_fecha, public.fecha_negocio());
  v_huella := md5(jsonb_build_array(p_numero, v_tenant, p_monto_cop, v_trm, nullif(p_forma, ''), nullif(p_ref, ''), v_fecha, u.id)::text);
  select * into v_prev from public.abono_operaciones where operacion_id = v_op;
  if found then
    if v_prev.huella <> v_huella then
      raise exception 'FIN_OPERACION_DISTINTA: esa operación ya se registró con otros datos; genera una operación nueva.' using errcode = 'F4466';
    end if;
    if not exists (select 1 from public.abonos where id = v_prev.abono_id) then
      raise exception 'FIN_OPERACION_ANULADA: el abono de esa operación ya fue anulado; si de verdad es un pago nuevo, regístralo como una operación nueva.' using errcode = 'F4468';
    end if;
    -- El reintento NO puede afirmar éxito contable por haber encontrado el abono: si el asiento no se escribió la primera vez
    -- (fallo de postear_asiento_abono), se vuelve a intentar aquí. postear_asiento_abono es idempotente (si el asiento ya está,
    -- responde sin_cambios; nunca duplica), y el abono no se toca. Si sigue fallando se informa igual que en el primer intento.
    begin
      perform public.postear_asiento_abono(v_prev.abono_id, v_tenant, p_actor);
    exception when others then
      v_err := sqlerrm;
    end;
    return jsonb_build_object('estado', 'ya_registrado', 'abono_id', v_prev.abono_id)
           || case when v_err is not null then jsonb_build_object('asiento_error', v_err) else '{}'::jsonb end;
  end if;

  -- «¿Ya pagado?» con los abonos vigentes y la venta bloqueada: nadie puede colarse entre esta lectura y el insert.
  select coalesce(sum(valor_abono), 0) into v_pagado from public.abonos where numero_contrato = p_numero;
  if v_total > 0 and v_pagado + v_tol >= v_total and not coalesce(p_confirmar, false) then
    return jsonb_build_object('estado', 'requiere_confirmacion', 'contrato', p_numero, 'total', v_total,
                              'pagado', v_pagado, 'nuevo', v_valor, 'moneda', v_moneda);
  end if;

  perform pg_catalog.set_config('app.registro_abono', p_numero, true);
  insert into public.abonos (numero_contrato, tenant, valor_abono, monto_cop, trm, fecha_abono, forma_pago, referencia)
  values (p_numero, v_tenant, v_valor, p_monto_cop, v_trm, v_fecha, nullif(p_forma, ''), nullif(p_ref, ''))
  returning id into v_id;
  perform pg_catalog.set_config('app.registro_abono', '', true);
  insert into public.abono_operaciones (operacion_id, numero_contrato, tenant, abono_id, huella, actor_id)
  values (v_op, p_numero, v_tenant, v_id, v_huella, u.id);

  -- El asiento va en la misma transacción, pero un fallo suyo no tumba el abono (igual que antes).
  begin
    perform public.postear_asiento_abono(v_id, v_tenant, p_actor);
  exception when others then
    v_err := sqlerrm;
  end;
  return jsonb_build_object('estado', 'registrado', 'abono_id', v_id)
         || case when v_err is not null then jsonb_build_object('asiento_error', v_err) else '{}'::jsonb end;
end $function$

;

CREATE OR REPLACE FUNCTION p75_priv.convertir_cotizacion_base(p_cotizacion_id bigint, p_usuario_id uuid)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare
  -- actor
  v_rol            text;
  v_actor_tenant   text;
  v_actor_email    text;
  -- cotización (re-lectura bajo lock)
  v_tenant         text;
  v_estado         text;
  v_tipo           text;
  v_congelada      timestamptz;
  v_moneda_cong    text;
  v_trm_cong       numeric;
  v_precio_cong    numeric;
  v_exigido_cop    numeric;
  v_cliente        text;
  v_cliente_doc    text;
  v_destino        text;
  v_fsalida        date;
  v_fregreso       date;
  v_pax            int;
  v_precio         numeric;
  v_moneda         text;
  v_asesor         text;
  v_payload        jsonb;
  v_detalle        jsonb;
  -- idempotencia
  v_existente      text;
  -- derivados
  v_tipo_asesor    text;
  v_agencia_nombre text;
  v_freelance_nombre text;
  v_observ         text;
  v_nombre_cliente text;
  v_t_doc          text;
  v_t_numero       text;
  v_t_nacimiento   text;
  v_nNinos         int;
  v_valorNino      numeric;
  v_totalNinos     numeric;
  v_recN           numeric;
  v_recEmp         numeric;
  v_recAli         numeric;
  v_esB2B          boolean;
  v_plan_nombre    text;
  v_tours          text;
  v_asist_med      boolean;
  v_costo_aereo    numeric;
  v_costo_hotel    numeric;
  v_costo_recept   numeric;
  v_costo_asist    numeric;
  v_costo_otro     numeric;
  v_hotel_venta    text;
  -- mín / número / item
  v_pagado         numeric;
  v_numero         text;
  v_pax_ad         int;
  v_adultSubtotal  numeric;
  v_tarifaAd       numeric;
  v_item_desc      text;
  v_dest_u         text;
  v_aliado_nombre  text;
  -- bucles
  r_pago           record;
  r_serv           record;
  -- CxP / asiento
  v_cxp_id         bigint;
  v_tipo_prov      text;
  v_proveedor      text;
  v_etiqueta       text;
  v_servicio       text;
  v_ret_aplica     boolean;
  v_ret_pct        numeric;
  v_hoy            date;
  v_codigos        text[];
  v_cuenta_cost    bigint;
  v_cuenta_prov    bigint;
  v_num_asiento    bigint;
  -- pago→abono
  v_abono_id       bigint;
  v_anticipo_sin   bigint;
  v_anticipo_con   bigint;
begin
  -- 1) Autorización (rol interno + activo) y datos del actor.
  v_rol := public._autorizado_pago_previo(p_usuario_id);
  select tenant, email into v_actor_tenant, v_actor_email
  from public.usuarios where id = p_usuario_id;

  -- 2) Lock de la cotización + RE-lectura (serializa pagos/conversiones).
  select tenant, estado, tipo, condicion_pago_congelada_en, moneda_congelada,
         trm_autoritativa, precio_total_congelado, monto_exigido_total_cop,
         cliente, cliente_documento, destino, fecha_salida, fecha_regreso,
         pax, precio_venta, moneda, asesor, payload, detalle
    into v_tenant, v_estado, v_tipo, v_congelada, v_moneda_cong,
         v_trm_cong, v_precio_cong, v_exigido_cop,
         v_cliente, v_cliente_doc, v_destino, v_fsalida, v_fregreso,
         v_pax, v_precio, v_moneda, v_asesor, v_payload, v_detalle
  from public.cotizaciones where id = p_cotizacion_id for update;
  if v_tenant is null then
    raise exception 'La cotización % no existe.', p_cotizacion_id;
  end if;
  v_payload := coalesce(v_payload, '{}'::jsonb);
  v_detalle := coalesce(v_detalle, '{}'::jsonb);

  -- 2bis) Tenant AUTORITATIVO, ANTES de la idempotencia y de escribir.
  -- superadmin = excepción global documentada (puede_ver_tenant lo incluye).
  if v_rol <> 'superadmin' and v_actor_tenant is distinct from v_tenant then
    raise exception 'No tienes acceso a la agencia (tenant %) de esta cotización.', v_tenant;
  end if;

  -- 3) Idempotencia: si ya se convirtió a UN contrato, devolverlo (replay / ya
  --    convertida). Ocurre bajo el lock y tras el cheque de tenant, así que un
  --    replay desde tenant ajeno se rechaza antes de tocar la venta existente.
  select numero_contrato into v_existente
  from public.ventas where cotizacion_id = p_cotizacion_id;
  if v_existente is not null then
    return v_existente;
  end if;

  -- 4) Frontera reutilizable: solo manual (raise si no).
  perform public._tipo_cotizacion_convertible(v_tipo);

  -- 5) Estado admitido + congelado OBLIGATORIO (fail-closed). El mínimo de abajo
  --    se mide contra el monto exigido CONGELADO en COP.
  if v_estado <> 'abierta' then
    raise exception 'La cotización % no está abierta (estado: %) — no se puede convertir.', p_cotizacion_id, v_estado;
  end if;
  if v_congelada is null or v_moneda_cong is null or v_trm_cong is null
     or v_precio_cong is null or v_exigido_cop is null then
    raise exception 'La cotización % no está congelada (falta snapshot/moneda/TRM/precio o monto exigido). Registra el pago previo que congela la condición antes de convertir.', p_cotizacion_id;
  end if;

  -- 5bis) Titular OBLIGATORIO (va como pasajero del contrato).
  v_nombre_cliente := btrim(coalesce(v_payload#>>'{cliente,nombres}','') || ' ' || coalesce(v_payload#>>'{cliente,apellidos}',''));
  v_t_doc        := btrim(coalesce(v_payload#>>'{cliente,tipoDoc}',''));
  v_t_numero     := btrim(coalesce(v_payload#>>'{cliente,numeroDoc}',''));
  v_t_nacimiento := btrim(coalesce(v_payload#>>'{cliente,nacimiento}',''));
  if v_nombre_cliente = '' or v_t_doc = '' or v_t_numero = '' or v_t_nacimiento = '' then
    raise exception 'Completa los datos del titular antes de generar el contrato: nombre, tipo de documento, número de documento y fecha de nacimiento.';
  end if;

  -- 6) Mínimo: Σ monto_cop de pagos válidos ≥ exigido congelado (anulados NO).
  --    Bloqueamos las filas de pago CONTADAS para serializar con un anular
  --    concurrente (anular_pago_previo bloquea el pago, no la cotización).
  for r_pago in
    select id from public.cotizacion_pagos_previos
    where cotizacion_id = p_cotizacion_id and estado in ('activo','aplicado')
    order by id for update
  loop
    null; -- lock adquirido
  end loop;
  v_pagado := public._monto_cop_pagado(p_cotizacion_id);
  if v_pagado < v_exigido_cop then
    raise exception 'La cotización % no alcanza el mínimo exigido: pagado % COP < exigido % COP (los pagos anulados no cuentan).',
      p_cotizacion_id, v_pagado, v_exigido_cop;
  end if;

  -- 7) Número UNA sola vez (función real con nextval), tras la idempotencia.
  v_numero := public.siguiente_numero_contrato_para_tenant(v_tenant);

  -- Derivados equivalentes al builder manual.
  v_tipo_asesor      := coalesce(v_payload->>'tipoAsesor', 'interno');
  v_agencia_nombre   := v_payload->>'agenciaNombre';
  v_freelance_nombre := v_payload->>'freelanceNombre';
  v_observ           := nullif(v_payload->>'observaciones', '');
  v_pax              := coalesce(v_pax, 0);
  v_precio           := coalesce(v_precio, 0);
  v_moneda           := coalesce(v_moneda, 'COP');

  -- Niños y recobro (mismo cálculo que crear/editar; el recobro va oculto en la
  -- tarifa de adulto). totalNinos = cantidad × tarifa; recobro repartido B2B.
  v_nNinos     := greatest(floor(coalesce((v_payload->>'ninos')::numeric, 0)), 0)::int;
  v_valorNino  := greatest(coalesce((v_payload->>'tarifaNino')::numeric, 0), 0);
  v_totalNinos := v_nNinos * v_valorNino;
  v_recN       := greatest(coalesce((v_payload->>'recobro')::numeric, 0), 0);
  v_esB2B      := v_tipo_asesor <> 'interno';
  v_recAli     := case when v_esB2B then least(greatest(coalesce((v_payload->>'recobroAliado')::numeric, 0), 0), v_recN) else 0 end;
  v_recEmp     := v_recN - v_recAli;

  -- Cajas "Hoteles y Servicios" + costos netos por tipo (cotizacion_servicios).
  select coalesce(string_agg(btrim(coalesce(s.nombre_servicio,'')), ', ' order by s.orden), null)
    into v_plan_nombre
  from public.cotizacion_servicios s
  where s.cotizacion_id = p_cotizacion_id and s.tipo_servicio = 'hotel'
    and btrim(coalesce(s.nombre_servicio,'')) <> '';
  select coalesce(string_agg(btrim(coalesce(s.nombre_servicio,'')), ', ' order by s.orden), null)
    into v_tours
  from public.cotizacion_servicios s
  where s.cotizacion_id = p_cotizacion_id and s.tipo_servicio = 'traslado'
    and btrim(coalesce(s.nombre_servicio,'')) <> '';
  select exists(select 1 from public.cotizacion_servicios s
                where s.cotizacion_id = p_cotizacion_id and s.tipo_servicio = 'asistencia')
    into v_asist_med;
  select
      coalesce(sum(s.costo_neto) filter (where s.tipo_servicio='aereo'), 0),
      coalesce(sum(s.costo_neto) filter (where s.tipo_servicio='hotel'), 0),
      coalesce(sum(s.costo_neto) filter (where s.tipo_servicio='traslado'), 0),
      coalesce(sum(s.costo_neto) filter (where s.tipo_servicio='asistencia'), 0),
      coalesce(sum(s.costo_neto) filter (where s.tipo_servicio='otro'), 0)
    into v_costo_aereo, v_costo_hotel, v_costo_recept, v_costo_asist, v_costo_otro
  from public.cotizacion_servicios s where s.cotizacion_id = p_cotizacion_id;

  -- Hotel/Aerolínea del snapshot (igual que el builder: plan_nombre manda sobre
  -- detalle.venta.hotel; aerolinea solo desde detalle.venta).
  v_hotel_venta := coalesce(nullif(v_plan_nombre,''), nullif(v_detalle->'venta'->>'hotel',''));

  -- 8) Crear la VENTA (reproducción fiel del builder manual + cotizacion_id).
  insert into public.ventas (
    numero_contrato, tenant, cliente, cliente_documento, cliente_telefono, destino,
    tipo_paquete, fecha_salida, fecha_regreso, pax, precio_venta, moneda, asesor,
    canal, tipo_cliente, hotel, aerolinea, plan_nombre, tours_traslados,
    asistencia_medica, costo_aereo, costo_hotel, costo_receptivo, costo_asistencia,
    otros_costos, recobro_total, recobro_empresa, recobro_aliado, comision_b2b,
    comision_estado, estado, observaciones, cotizacion_id
  ) values (
    v_numero, v_tenant, coalesce(v_cliente,''), nullif(v_cliente_doc,''),
    nullif(v_payload#>>'{cliente,telefono}',''), nullif(v_destino,''),
    'dinamico', v_fsalida, v_fregreso, nullif(v_pax,0), nullif(v_precio,0), v_moneda,
    nullif(v_asesor,''),
    case when v_tipo_asesor = 'interno' then 'B2C' else 'B2B' end,
    nullif(v_tipo_asesor,''), nullif(v_hotel_venta,''),
    nullif(v_detalle->'venta'->>'aerolinea',''), nullif(v_plan_nombre,''),
    nullif(v_tours,''), coalesce(v_asist_med,false),
    v_costo_aereo, v_costo_hotel, v_costo_recept, v_costo_asist, v_costo_otro,
    v_recN, v_recEmp, v_recAli,
    case when v_recAli > 0 then v_recAli else null end,
    case when v_recAli > 0 then 'pendiente' else null end,
    'pendiente', v_observ, p_cotizacion_id
  );

  -- 9) Ítem del paquete: adultos + niños. tarifa_adulto incluye el recobro (oculto).
  v_pax_ad        := greatest(v_pax, 1);
  v_adultSubtotal := v_precio - v_totalNinos;
  v_tarifaAd      := round(v_adultSubtotal / v_pax_ad);
  v_dest_u        := upper(btrim(coalesce(v_destino,'')));
  v_dest_u        := case when v_dest_u = '' then 'DESTINO' else v_dest_u end;
  v_item_desc     := 'PAQUETE TURÍSTICO A ' || v_dest_u || ' DEL '
                     || coalesce(to_char(v_fsalida,'DD/MM/YYYY'),'—') || ' AL '
                     || coalesce(to_char(v_fregreso,'DD/MM/YYYY'),'—');
  insert into public.contrato_items
    (numero_contrato, descripcion, adultos, ninos, tarifa_adulto, tarifa_nino, orden)
  values
    (v_numero, v_item_desc, v_pax_ad, v_nNinos, v_tarifaAd, v_valorNino, 0);

  -- Titular como pasajero del contrato.
  insert into public.contrato_pasajeros
    (numero_contrato, nombre, tipo_id, identificacion, fecha_nacimiento, es_infante, orden)
  values
    (v_numero, v_nombre_cliente, coalesce(nullif(v_t_doc,''),'CC'), nullif(v_t_numero,''),
     nullif(v_t_nacimiento,'')::date, false, 0);

  -- Comisión del aliado B2B por el recobro (entra al módulo de comisiones).
  if v_esB2B and v_recAli > 0 then
    v_aliado_nombre := coalesce(nullif(case when v_tipo_asesor='agencia' then v_agencia_nombre else v_freelance_nombre end,''),
                                nullif(coalesce(v_asesor,''),''), 'Aliado');
    insert into public.aliados_b2b
      (numero_contrato, tenant, aliado, tipo_aliado, precio_venta, base_comision,
       recobro_total, pct_recobro_aliado, estado)
    values
      (v_numero, v_tenant, v_aliado_nombre, v_tipo_asesor, v_precio, v_recAli,
       v_recN, case when v_recN > 0 then v_recAli / v_recN else 0 end, 'pendiente');
  end if;

  -- 10) Copiar condiciones congeladas → contrato_condiciones (snapshot por fila).
  insert into public.contrato_condiciones (
    numero_contrato, tipo_componente, referencia_externa, orden, valor_componente,
    condicion_pago_tipo, condicion_pago_pct_aplicable, condicion_pago_dias_saldo,
    condicion_pago_fecha_limite, monto_exigido, restriccion_comercial, moneda, trm
  )
  select v_numero, c.tipo_componente, c.referencia_externa, c.orden, c.valor_componente,
         c.condicion_pago_tipo, c.condicion_pago_pct_aplicable, c.condicion_pago_dias_saldo,
         c.condicion_pago_fecha_limite, c.monto_exigido, c.restriccion_comercial,
         v_moneda_cong, v_trm_cong
  from public.cotizacion_condiciones c
  where c.cotizacion_id = p_cotizacion_id;

  -- 11) Transferir pagos ACTIVOS → ABONOS + reclasificar 280510→280505 + marcar.
  v_anticipo_sin := public._puc_id(v_tenant, '280510');
  v_anticipo_con := public._puc_id(v_tenant, '280505');
  for r_pago in
    select * from public.cotizacion_pagos_previos
    where cotizacion_id = p_cotizacion_id and estado = 'activo'
    order by id for update
  loop
    insert into public.abonos
      (numero_contrato, cliente, fecha_abono, valor_abono, forma_pago, referencia,
       recibido_por, trm, monto_cop, tenant)
    values
      (v_numero, coalesce(v_cliente,''), r_pago.fecha_pago, r_pago.monto_cop,
       r_pago.forma_pago, r_pago.referencia, v_actor_email, r_pago.trm,
       r_pago.monto_cop, v_tenant)
    returning id into v_abono_id;

    v_num_asiento := public._siguiente_numero_asiento(v_tenant);
    insert into public.asientos_contables (tenant, numero, fecha, descripcion, origen, referencia, usuario_email)
    values (v_tenant, v_num_asiento, public.fecha_negocio(),
      'Aplicación pago previo a contrato ' || v_numero,
      'pago_previo_aplicacion', 'pago_previo:' || r_pago.id || ':abono:' || v_abono_id, v_actor_email);
    insert into public.asiento_lineas (tenant, asiento_id, cuenta_id, tercero, descripcion, debe, haber)
    values
      (v_tenant, (select max(id) from public.asientos_contables where tenant=v_tenant and numero=v_num_asiento),
       v_anticipo_sin, v_numero, 'Anticipo sin identificar aplicado', coalesce(r_pago.monto_cop,0), 0),
      (v_tenant, (select max(id) from public.asientos_contables where tenant=v_tenant and numero=v_num_asiento),
       v_anticipo_con, v_numero, 'Anticipo de cliente del contrato', 0, coalesce(r_pago.monto_cop,0));

    update public.cotizacion_pagos_previos
    set estado = 'aplicado', abono_id = v_abono_id
    where id = r_pago.id;
  end loop;

  -- 12) CxP de proveedor + asientos Debe Costo / Haber Proveedores. Equivalencia
  --     de postearAsientoCxP. FALLO ATÓMICO (sin try/catch): cualquier cuenta
  --     ausente revierte toda la conversión. Proveedor = (proveedor o plataforma);
  --     retención por match de nombre en el catálogo (que NO lleva tenant).
  v_hoy := public.fecha_negocio();
  for r_serv in
    select * from public.cotizacion_servicios
    where cotizacion_id = p_cotizacion_id and (coalesce(costo_neto,0)) > 0
    order by orden
  loop
    v_tipo_prov := public._tipo_proveedor_cxp(r_serv.tipo_servicio);
    v_proveedor := coalesce(nullif(btrim(coalesce(r_serv.proveedor,'')), ''),
                            nullif(btrim(coalesce(r_serv.plataforma,'')), ''));
    v_etiqueta  := case coalesce(r_serv.tipo_servicio,'')
      when 'aereo' then 'Aéreo'
      when 'hotel' then 'Hotel'
      when 'traslado' then 'Traslado'
      when 'asistencia' then 'Asistencia médica'
      when 'otro' then 'Otro'
      else 'Servicio' end;
    v_servicio  := btrim(coalesce(v_etiqueta,'') || case when btrim(coalesce(r_serv.nombre_servicio,'')) <> '' then ' ' || btrim(r_serv.nombre_servicio) else '' end);

    -- Retención del catálogo por nombre (coincidencia exacta trim+lower).
    v_ret_aplica := false;
    v_ret_pct    := 0;
    if v_proveedor is not null then
      select coalesce(p.aplica_retencion,false), coalesce(p.pct_retencion,0)
        into v_ret_aplica, v_ret_pct
      from public.proveedores p
      where lower(btrim(p.nombre)) = lower(btrim(v_proveedor))
      order by p.id limit 1;
    end if;

    insert into public.cuentas_por_pagar
      (numero_contrato, tenant, proveedor, tipo_proveedor, servicio, valor_total,
       moneda, fecha_obligacion, fecha_vencimiento, aplica_retencion, pct_retencion,
       observaciones)
    values
      (v_numero, v_tenant, v_proveedor, v_tipo_prov, v_servicio,
       greatest(0, coalesce(r_serv.costo_neto,0)), v_moneda, v_hoy, v_fsalida,
       v_ret_aplica, v_ret_pct, 'Generado automáticamente desde cotización dinámica')
    returning id into v_cxp_id;

    -- Asiento de la CxP (reemplazar es no-op en una conversión fresca, se deja
    -- por fidelidad a postearAsientoCxP): Debe Costo / Haber Proveedores.
    v_codigos     := public._cuentas_cxp(v_tipo_prov);  -- [1]=Proveedores, [2]=Costo
    v_cuenta_prov := public._puc_id(v_tenant, v_codigos[1]);
    v_cuenta_cost := public._puc_id(v_tenant, v_codigos[2]);
    v_num_asiento := public._siguiente_numero_asiento(v_tenant);
    delete from public.asientos_contables
    where tenant = v_tenant and origen = 'cxp' and referencia = 'cxp:' || v_cxp_id;
    insert into public.asientos_contables (tenant, numero, fecha, descripcion, origen, referencia, usuario_email)
    values (v_tenant, v_num_asiento, v_hoy,
      coalesce(nullif(v_servicio,''),'Costo') || ' — ' || coalesce(v_proveedor,'Sin especificar') || ' (' || v_numero || ')',
      'cxp', 'cxp:' || v_cxp_id, v_actor_email);
    insert into public.asiento_lineas (tenant, asiento_id, cuenta_id, tercero, descripcion, debe, haber)
    values
      (v_tenant, (select max(id) from public.asientos_contables where tenant=v_tenant and numero=v_num_asiento),
       v_cuenta_cost, v_numero, v_servicio, greatest(0, coalesce(r_serv.costo_neto,0)), 0),
      (v_tenant, (select max(id) from public.asientos_contables where tenant=v_tenant and numero=v_num_asiento),
       v_cuenta_prov, v_proveedor, v_servicio, 0, greatest(0, coalesce(r_serv.costo_neto,0)));
  end loop;

  -- 13) Enlazar + estado + número en el detalle (snapshot del documento).
  v_detalle := jsonb_set(v_detalle, '{venta,numero_contrato}', to_jsonb(v_numero));
  update public.cotizaciones
  set estado = 'convertida',
      numero_contrato = v_numero,
      condicion_pago_congelada_en = coalesce(v_congelada, now()),
      detalle = v_detalle
  where id = p_cotizacion_id;

  return v_numero;
end;
$function$

;

CREATE OR REPLACE FUNCTION p75_priv.transferir_pagos_previos_base(p_cotizacion_id bigint, p_numero_contrato text, p_usuario_id uuid)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare
  v_rol text := public._autorizado_pago_previo(p_usuario_id);
  v_tenant text;
  v_email text;
  v_cliente text;
  v_estado text;
  v_num_ok bigint;
  v_numero bigint;
  v_anticipo_sin bigint;
  v_anticipo_con bigint;
  r record;
begin
  select tenant, estado, cliente into v_tenant, v_estado, v_cliente
  from public.cotizaciones where id = p_cotizacion_id for update;
  if v_tenant is null then raise exception 'La cotización % no existe.', p_cotizacion_id; end if;
  if v_estado <> 'convertida' then
    raise exception 'La cotización % no está convertida (estado: %) — la transferencia a abonos exige el contrato ya creado.', p_cotizacion_id, v_estado;
  end if;

  -- El contrato debe existir y apuntar a ESTA cotización (UNO-A-UNO).
  select count(*) into v_num_ok
  from public.ventas where numero_contrato = p_numero_contrato and cotizacion_id = p_cotizacion_id;
  if v_num_ok = 0 then
    raise exception 'El contrato % no corresponde a la cotización % (o no existe).', p_numero_contrato, p_cotizacion_id;
  end if;

  select email into v_email from public.usuarios where id = p_usuario_id;

  v_anticipo_sin := public._puc_id(v_tenant, '280510');
  v_anticipo_con := public._puc_id(v_tenant, '280505');

  for r in
    select * from public.cotizacion_pagos_previos
    where cotizacion_id = p_cotizacion_id and estado = 'activo'
    order by id
    for update
  loop
    -- 1) Abono real del contrato (monto en COP, mismo trm del pago).
    insert into public.abonos
      (numero_contrato, cliente, fecha_abono, valor_abono, forma_pago, referencia, recibido_por, trm, monto_cop, tenant)
    values
      (p_numero_contrato, coalesce(v_cliente, ''),
       r.fecha_pago, r.monto_cop, r.forma_pago, r.referencia, v_email, r.trm, r.monto_cop, v_tenant)
    returning id into v_num_ok;

    -- 2) Reclasificación contable: Debe 280510 / Haber 280505 (tercero = contrato).
    v_numero := public._siguiente_numero_asiento(v_tenant);
    insert into public.asientos_contables (tenant, numero, fecha, descripcion, origen, referencia, usuario_email)
    values (v_tenant, v_numero, public.fecha_negocio(),
      'Aplicación pago previo a contrato ' || p_numero_contrato,
      'pago_previo_aplicacion', 'pago_previo:' || r.id || ':abono:' || v_num_ok, v_email);
    insert into public.asiento_lineas (tenant, asiento_id, cuenta_id, tercero, descripcion, debe, haber)
    values
      (v_tenant, (select max(id) from public.asientos_contables where tenant=v_tenant and numero=v_numero),
       v_anticipo_sin, p_numero_contrato, 'Anticipo sin identificar aplicado', coalesce(r.monto_cop,0), 0),
      (v_tenant, (select max(id) from public.asientos_contables where tenant=v_tenant and numero=v_numero),
       v_anticipo_con, p_numero_contrato, 'Anticipo de cliente del contrato', 0, coalesce(r.monto_cop,0));

    -- 3) Marcar aplicado.
    update public.cotizacion_pagos_previos
    set estado = 'aplicado', abono_id = v_num_ok
    where id = r.id;
  end loop;

  return 'OK';
end;
$function$

;


-- ── 3) PARTE 3 — Regla ÚNICA del mínimo para CONFIRMAR por pago (pantalla, documento, conversión, abono y reintento leen la misma) ───────────────────
-- Tres reglas, SIEMPRE identificadas (nunca se mezclan):
--   · 'neto_total'          NETO aliado (comision_estado = 'descontada'): el mínimo para confirmar es el TOTAL NETO exigible (100 % de precio_venta) en la moneda de cobro.
--   · 'condicion_congelada' contrato con condiciones congeladas (contrato_condiciones): Σ monto_exigido, en la moneda y con la TRM CONGELADAS de esas condiciones.
--   · 'legacy_pct'          SOLO contratos históricos sin condiciones congeladas: el % de config_cobros (30 % por defecto) sobre el total de cobro. Ningún contrato con condiciones ni NETO lo usa.
-- DISTINTO por diseño: el mínimo para EMITIR/CONVERTIR una cotización (pagos previos ≥ monto exigido congelado de la cotización, lo valida convertir_cotizacion_a_contrato).
-- Para contratos con condiciones los dos coinciden (las condiciones del contrato son copia de las de la cotización); en NETO el de confirmar es mayor (el total).
create or replace function p75_priv.regla_confirmacion(p_numero text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v public.ventas; v_mo text; v_mc text; v_total numeric; v_moneda text; v_pct numeric; n integer; s numeric; m text; t numeric;
begin
  select * into v from public.ventas where numero_contrato = p_numero;
  if not found then return null; end if;
  -- Total de cobro y moneda de cobro: espejo de registrar_abono / lib/finanzas/cobro.ts → cobroDeVenta.
  v_mo := case when upper(coalesce(v.moneda, 'COP')) = 'USD' then 'USD' else 'COP' end;
  v_mc := case when v.moneda_cobro is null then null when upper(v.moneda_cobro) = 'USD' then 'USD' else 'COP' end;
  if v_mc is not null and v_mc <> v_mo and coalesce(v.total_cobro, 0) > 0 and coalesce(v.trm_cobro, 0) > 0 then
    v_total := v.total_cobro; v_moneda := v_mc;
  else
    v_total := coalesce(v.precio_venta, 0); v_moneda := v_mo;
  end if;
  if v.comision_estado = 'descontada' then
    return jsonb_build_object('regla', 'neto_total', 'minimo', v_total, 'moneda', v_moneda, 'trm', null);
  end if;
  select count(*), coalesce(sum(c.monto_exigido), 0), min(upper(c.moneda)), max(c.trm) into n, s, m, t
    from public.contrato_condiciones c where c.numero_contrato = p_numero;
  if n > 0 then
    return jsonb_build_object('regla', 'condicion_congelada', 'minimo', s, 'moneda', coalesce(m, v_moneda), 'trm', t);
  end if;
  select c.pct_abono into v_pct from public.config_cobros c where c.tipo_paquete = coalesce(v.tipo_paquete, '');
  return jsonb_build_object('regla', 'legacy_pct', 'minimo', v_total * coalesce(v_pct, 0.3), 'moneda', v_moneda, 'trm', null);
end $$;
revoke all on function p75_priv.regla_confirmacion(text) from public, anon, authenticated;
grant execute on function p75_priv.regla_confirmacion(text) to service_role;

-- Lo pagado, EXPRESADO en la moneda de la regla: misma moneda de cobro → valor_abono; en COP → monto_cop; en USD con abonos en COP → a la TRM congelada (sin TRM no se convierte: 0, falla cerrado).
create or replace function p75_priv.pagado_en(p_numero text, p_moneda text, p_trm numeric) returns numeric
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v public.ventas; v_mo text; v_mc text; v_cobro text; r numeric;
begin
  select * into v from public.ventas where numero_contrato = p_numero;
  if not found then return 0; end if;
  v_mo := case when upper(coalesce(v.moneda, 'COP')) = 'USD' then 'USD' else 'COP' end;
  v_mc := case when v.moneda_cobro is null then null when upper(v.moneda_cobro) = 'USD' then 'USD' else 'COP' end;
  v_cobro := case when v_mc is not null and v_mc <> v_mo and coalesce(v.total_cobro, 0) > 0 and coalesce(v.trm_cobro, 0) > 0 then v_mc else v_mo end;
  if upper(p_moneda) = v_cobro then
    select coalesce(sum(a.valor_abono), 0) into r from public.abonos a where a.numero_contrato = p_numero;
  elsif upper(p_moneda) = 'COP' then
    select coalesce(sum(coalesce(a.monto_cop, a.valor_abono)), 0) into r from public.abonos a where a.numero_contrato = p_numero;
  elsif coalesce(p_trm, 0) > 0 then
    select coalesce(sum(coalesce(a.monto_cop, a.valor_abono)), 0) / p_trm into r from public.abonos a where a.numero_contrato = p_numero;
  else
    r := 0;
  end if;
  return coalesce(r, 0);
end $$;
revoke all on function p75_priv.pagado_en(text, text, numeric) from public, anon, authenticated;
grant execute on function p75_priv.pagado_en(text, text, numeric) to service_role;

-- Estado del mínimo: regla + pagado + alcanza (hay al menos un pago Y pagado ≥ mínimo, con la misma tolerancia de redondeo que registrar_abono: 0,5 COP / 0,01 USD).
create or replace function p75_priv.estado_minimo(p_numero text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare g jsonb; v_pagado numeric; v_tol numeric;
begin
  g := p75_priv.regla_confirmacion(p_numero);
  if g is null then return null; end if;
  v_pagado := p75_priv.pagado_en(p_numero, g->>'moneda', nullif(g->>'trm', '')::numeric);
  v_tol := case when upper(g->>'moneda') = 'USD' then 0.01 else 0.5 end;
  return g || jsonb_build_object('pagado', v_pagado, 'alcanza', v_pagado > 0 and v_pagado + v_tol >= (g->>'minimo')::numeric);
end $$;
revoke all on function p75_priv.estado_minimo(text) from public, anon, authenticated;
grant execute on function p75_priv.estado_minimo(text) to service_role;

-- ── 5) Materialización (UNA vez; solo desde confirmar_venta, con su testigo de transacción) ──────────────────────────
create or replace function p75_priv.materializar_obligaciones(p_numero text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v public.ventas; r record; v_id bigint; v_ids jsonb := '[]'::jsonb; v_com bigint; v_p jsonb; v_cols text;
begin
  -- Mismo testigo que _confirmar_sillas_de_venta (197): solo lo fija confirmar_venta DESPUÉS de que la RLS de quien llama dejó actualizar la venta.
  if auth.uid() is null or current_setting('app.confirmar_venta_token', true) is distinct from p_numero || '|' || auth.uid()::text then
    raise exception using errcode = '42501', message = 'Sin permiso para confirmar esta venta.';
  end if;
  select * into v from public.ventas where numero_contrato = p_numero for update;
  if not found or v.estado is distinct from 'confirmado' then
    raise exception using errcode = 'P0001', message = 'Solo se materializan las obligaciones de una venta confirmada.';
  end if;
  if v.obligaciones_materializadas_en is not null then
    return jsonb_build_object('ya_materializadas', true, 'cxp', '[]'::jsonb, 'comision_id', null);
  end if;

  for r in select * from public.contrato_obligaciones_previstas
            where numero_contrato = p_numero and clase = 'cxp' and materializada_en is null order by id loop
    -- Solo las columnas PRESENTES (sin nulos): los DEFAULT de la tabla aplican a lo que el flujo de origen no trajo (jsonb_populate_record los pisaría con NULL).
    v_p := jsonb_strip_nulls((r.payload - 'id') || jsonb_build_object('clave_prevista', r.clave, 'created_at', now()));
    if v_p ? 'aceptacion_63_id' then perform set_config('app.p63_h', 'on', true); end if;   -- obligación de oferta #63: su trigger exige el modo «escritura financiera»
    select string_agg(quote_ident(k), ',') into v_cols from jsonb_object_keys(v_p) k
     where exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = 'cuentas_por_pagar' and c.column_name = k);
    execute format('insert into public.cuentas_por_pagar (%1$s) select %1$s from jsonb_populate_record(null::public.cuentas_por_pagar, $1) on conflict (numero_contrato, clave_prevista) where clave_prevista is not null do nothing returning id', v_cols)
      into v_id using v_p;
    perform set_config('app.p63_h', '', true);
    if v_id is not null then v_ids := v_ids || to_jsonb(v_id); end if;
    update public.contrato_obligaciones_previstas set materializada_en = now() where id = r.id;
    v_id := null;
  end loop;

  -- Comisión B2B exigible: la materializa #97 (286), UNA vez, copiando su plan sellado; si la 286 no está aplicada no hay comisión diferida y no se hace nada.
  if to_regprocedure('public.materializar_comision_b2b(text)') is not null then
    v_com := public.materializar_comision_b2b(p_numero);
  end if;

  update public.ventas set obligaciones_materializadas_en = now() where numero_contrato = p_numero;
  return jsonb_build_object('ya_materializadas', false, 'cxp', v_ids, 'comision_id', v_com);
end $$;
revoke all on function p75_priv.materializar_obligaciones(text) from public, anon;
grant execute on function p75_priv.materializar_obligaciones(text) to authenticated, service_role;

-- ── 6) confirmar_venta (197) + materialización en la MISMA transacción. Autorización y reglas: IDÉNTICAS a la 197. ──────
create or replace function public.confirmar_venta(p_numero text)
 returns jsonb
 language plpgsql
 set search_path to 'public', 'pg_temp'
 set lock_timeout to '5s'
as $function$
declare v record; v_n integer; v_sillas integer; v_obl jsonb;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Sesión requerida.';
  end if;
  -- Con la RLS de quien llama (INVOKER): si no la ve, no la confirma.
  select estado, financiero_estado into v from public.ventas where numero_contrato = p_numero for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'Contrato no encontrado o sin acceso.';
  end if;
  if v.financiero_estado = 'pendiente' then
    raise exception using errcode = 'P0001', message =
      'Este contrato tiene el registro de costos/cuentas por pagar incompleto (fallo técnico al crearlo) — no se puede confirmar todavía. Un administrador debe reintentarlo antes de continuar.';
  end if;
  if v.estado = 'confirmado' then
    perform set_config('app.confirmar_venta_token', p_numero || '|' || auth.uid()::text, true);
    v_sillas := public._confirmar_sillas_de_venta(p_numero);
    perform set_config('app.confirmar_venta_token', '', true);
    return jsonb_build_object('ok', true, 'ya_confirmado', true, 'sillas_confirmadas', v_sillas);
  end if;
  if v.estado is distinct from 'pendiente' then
    raise exception using errcode = 'P0001', message =
      format('Solo se confirma una venta pendiente (estado actual: %s).', coalesce(v.estado, 'sin estado'));
  end if;
  update public.ventas set estado = 'confirmado' where numero_contrato = p_numero;
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception using errcode = '42501', message = 'Sin permiso para confirmar esta venta.';
  end if;
  perform set_config('app.confirmar_venta_token', p_numero || '|' || auth.uid()::text, true);
  v_sillas := public._confirmar_sillas_de_venta(p_numero);
  -- 288 (#75): las obligaciones previstas (CxP, comisión exigible) nacen AQUÍ, una vez, en esta transacción.
  v_obl := p75_priv.materializar_obligaciones(p_numero);
  perform set_config('app.confirmar_venta_token', '', true);
  return jsonb_build_object('ok', true, 'ya_confirmado', false, 'sillas_confirmadas', v_sillas, 'obligaciones', v_obl);
end $function$;

-- ── 7) Confirmación por pago: el abono aceptado y la confirmación+materialización son consistentes ───────────────────
-- registrar_abono lo llama el SERVIDOR con service_role (sin sesión de usuario) y ya validó al actor (roles y agencia). Aquí se confirma con la identidad de ESE actor
-- (claims locales a la transacción, restaurados al salir) para que confirmar_venta, el testigo de la 197 y la auditoría vean al usuario real. NO es invocable por
-- usuarios: sin ello cualquiera podría confirmar «como» otro. La autorización es la del abono (mismos 4 roles que pueden confirmar a mano); no se amplía nada.
create or replace function p75_priv.confirmar_por_pago(p_numero text, p_actor uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.ventas; e jsonb; v_r jsonb; o_claims text; o_sub text;
begin
  select * into v from public.ventas where numero_contrato = p_numero;
  if not found or v.estado is distinct from 'pendiente' or v.financiero_estado = 'pendiente' then
    return jsonb_build_object('confirmada', false);
  end if;
  e := p75_priv.estado_minimo(p_numero);
  if (e->>'alcanza')::boolean is not true then return jsonb_build_object('confirmada', false) || e; end if;
  o_claims := coalesce(current_setting('request.jwt.claims', true), ''); o_sub := coalesce(current_setting('request.jwt.claim.sub', true), '');
  perform set_config('request.jwt.claim.sub', p_actor::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_actor, 'role', 'authenticated')::text, true);
  begin
    v_r := public.confirmar_venta(p_numero);
  exception when others then
    perform set_config('request.jwt.claims', o_claims, true); perform set_config('request.jwt.claim.sub', o_sub, true);
    raise;
  end;
  perform set_config('request.jwt.claims', o_claims, true); perform set_config('request.jwt.claim.sub', o_sub, true);
  return jsonb_build_object('confirmada', true, 'resultado', v_r) || e;
end $$;
revoke all on function p75_priv.confirmar_por_pago(text, uuid) from public, anon, authenticated;
grant execute on function p75_priv.confirmar_por_pago(text, uuid) to service_role;

grant execute on function p75_priv.registrar_abono_base(text, text, uuid, numeric, numeric, text, text, date, boolean, uuid) to service_role;
revoke all on function p75_priv.registrar_abono_base(text, text, uuid, numeric, numeric, text, text, date, boolean, uuid) from public, anon, authenticated;
revoke all on function p75_priv.registrar_financiero_base(text, text, jsonb, jsonb) from public, anon, authenticated, service_role;

create or replace function public.registrar_abono(p_numero text, p_tenant text, p_actor uuid, p_monto_cop numeric, p_trm numeric, p_forma text, p_ref text, p_fecha date, p_confirmar boolean, p_operacion uuid)
 returns jsonb
 language plpgsql
 set search_path to ''
as $function$
declare r jsonb; v_c jsonb; v_e text;
begin
  r := p75_priv.registrar_abono_base(p_numero, p_tenant, p_actor, p_monto_cop, p_trm, p_forma, p_ref, p_fecha, p_confirmar, p_operacion);
  if r->>'estado' in ('registrado', 'ya_registrado') then
    -- Subtransacción: confirmar + materializar son todo-o-nada, y NUNCA arrastran el abono ya aceptado. El reintento de la misma operación
    -- ('ya_registrado') vuelve a evaluar la confirmación, así que una confirmación fallida se repara sola.
    begin
      v_c := p75_priv.confirmar_por_pago(p_numero, p_actor);
    exception when others then
      v_e := sqlerrm;
    end;
    if v_c is not null and (v_c->>'confirmada')::boolean then r := r || jsonb_build_object('confirmacion', v_c); end if;
    if v_e is not null then r := r || jsonb_build_object('confirmacion_error', v_e); end if;
  end if;
  return r;
end $function$;

-- ── 8) Envoltorios públicos de creación: en PENDIENTE las obligaciones se trasladan a «previstas» ───────────────────────
create or replace function public.registrar_financiero_contrato(p_numero_contrato text, p_tenant text, p_costos jsonb, p_cxp jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare v_estado text; v_fin text; r jsonb; v_quedan jsonb := '[]'::jsonb; v_prev jsonb := '[]'::jsonb; e record; c public.cuentas_por_pagar; v_clave text;
begin
  select v.estado, v.financiero_estado into v_estado, v_fin from public.ventas v where v.numero_contrato = p_numero_contrato and v.tenant = p_tenant;
  if v_estado is distinct from 'pendiente' then
    return p75_priv.registrar_financiero_base(p_numero_contrato, p_tenant, p_costos, p_cxp);
  end if;
  -- Reintento sobre un pendiente: lo previsto anterior (aún sin materializar) se reemplaza, igual que la base reemplaza las CxP automáticas.
  if v_fin = 'pendiente' then   -- solo si la base va a reescribir; un contrato ya completo responde ya_completo y NO pierde lo previsto
    delete from public.contrato_obligaciones_previstas where numero_contrato = p_numero_contrato and clase = 'cxp' and materializada_en is null;
  end if;
  r := p75_priv.registrar_financiero_base(p_numero_contrato, p_tenant, p_costos, p_cxp);
  if coalesce((r->>'ya_completo')::boolean, false) then return r; end if;
  for e in select x.val, x.ord from jsonb_array_elements(coalesce(r->'creadas', '[]'::jsonb)) with ordinality as x(val, ord) loop
    select * into c from public.cuentas_por_pagar where id = (e.val->>'id')::bigint;
    if not found then continue; end if;
    v_clave := 'cxp:' || e.ord || ':' || coalesce(c.tipo_proveedor, '');
    perform p75_priv.mover_cxp_a_prevista(c.id, v_clave);   -- incluye las CxP de oferta #63 (ver 10)
    v_prev := v_prev || jsonb_build_object('clave', v_clave, 'tipo_proveedor', c.tipo_proveedor, 'proveedor', c.proveedor, 'servicio', c.servicio, 'valor_total', c.valor_total);
  end loop;
  return (r - 'creadas') || jsonb_build_object('creadas', v_quedan, 'previstas', v_prev);
end $function$;

-- ── 9) Escritores de la APLICACIÓN que tocan CxP de un contrato (edición de servicios, programa): en PENDIENTE escriben «previstas» ───────
-- Solo service_role (la app, con la identidad del contrato declarada). Si el contrato NO está pendiente responde {aplicado:false} y la app sigue su camino de siempre.
-- p_eliminar: ids de previstas; p_actualizar: [{id, valor_total, servicio, tipo_proveedor, proveedor}]; p_insertar: filas con la forma de cuentas_por_pagar.
create or replace function public.prevista_cxp_aplicar(p_numero text, p_eliminar bigint[], p_actualizar jsonb, p_insertar jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.ventas; e jsonb; n_ins integer := 0; n_upd integer := 0; n_del integer := 0;
begin
  select * into v from public.ventas where numero_contrato = p_numero for update;
  if not found or v.estado is distinct from 'pendiente' then
    return jsonb_build_object('aplicado', false, 'motivo', 'no_pendiente');
  end if;
  delete from public.contrato_obligaciones_previstas
   where numero_contrato = p_numero and clase = 'cxp' and materializada_en is null and id = any (coalesce(p_eliminar, '{}'::bigint[]));
  get diagnostics n_del = row_count;
  for e in select * from jsonb_array_elements(coalesce(p_actualizar, '[]'::jsonb)) loop
    update public.contrato_obligaciones_previstas
       set payload = payload || jsonb_strip_nulls(jsonb_build_object('valor_total', e->'valor_total', 'servicio', e->'servicio', 'tipo_proveedor', e->'tipo_proveedor', 'proveedor', e->'proveedor'))
     where id = (e->>'id')::bigint and numero_contrato = p_numero and clase = 'cxp' and materializada_en is null;
    n_upd := n_upd + 1;
  end loop;
  for e in select * from jsonb_array_elements(coalesce(p_insertar, '[]'::jsonb)) loop
    if coalesce(btrim(e->>'tipo_proveedor'), '') = '' or nullif(e->>'valor_total', '') is null or (e->>'valor_total')::numeric < 0 then
      raise exception 'prevista_cxp_aplicar: fila inválida (tipo_proveedor y valor_total >= 0 son obligatorios)';
    end if;
    insert into public.contrato_obligaciones_previstas (numero_contrato, clase, clave, payload)
    values (p_numero, 'cxp', 'cxp:ed:' || gen_random_uuid()::text,
            jsonb_build_object('numero_contrato', p_numero, 'tenant', v.tenant, 'moneda', coalesce(v.moneda, 'COP')) || e);
    n_ins := n_ins + 1;
  end loop;
  return jsonb_build_object('aplicado', true, 'eliminadas', n_del, 'actualizadas', n_upd, 'insertadas', n_ins);
end $$;
revoke all on function public.prevista_cxp_aplicar(text, bigint[], jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.prevista_cxp_aplicar(text, bigint[], jsonb, jsonb) to service_role;


-- ── 10) PARTE 1b — Cerrar los escritores que creaban obligaciones al nacer un contrato pendiente ──────────────────────────────────
-- (a) Mover una CxP recién creada a «prevista» (sin EXECUTE para ningún rol de la API: solo la llaman las funciones DEFINER de abajo).
--     Borra también su asiento (nació en la misma transacción, p. ej. la conversión de cotización) y NO toca nada con movimientos.
--     Las CxP de oferta #63 (aceptacion_63_id) se trasladan igual: su trigger de borrado (227) respeta el bypass transaccional `app.p75_traslado`
--     (que solo fija esta función; PostgREST no puede fijar parámetros `app.*`) y la materialización las reinserta con el modo `app.p63_h`.
-- Regla monetaria de los abonos que nacen de pagos previos: `valor_abono` va SIEMPRE en la moneda de COBRO del contrato (como registrar_abono: COP → monto_cop; USD → monto_cop / TRM del abono), `monto_cop` y la TRM no cambian.
-- La base legada escribía allí los pesos aunque el contrato cobrara en USD. Pago y cobro en USD → el monto del pago; pago en COP con cobro en USD → pesos / TRM del abono (sin TRM > 1 no se convierte: queda como está).
create or replace function p75_priv.normalizar_abonos_previos(p_numero text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.ventas; v_mo text; v_mc text; v_cobro text;
begin
  select * into v from public.ventas where numero_contrato = p_numero;
  if not found then return; end if;
  v_mo := case when upper(coalesce(v.moneda, 'COP')) = 'USD' then 'USD' else 'COP' end;
  v_mc := case when v.moneda_cobro is null then null when upper(v.moneda_cobro) = 'USD' then 'USD' else 'COP' end;
  v_cobro := case when v_mc is not null and v_mc <> v_mo and coalesce(v.total_cobro, 0) > 0 and coalesce(v.trm_cobro, 0) > 0 then v_mc else v_mo end;
  update public.abonos a set valor_abono = n.nuevo
    from (select a2.id, case when v_cobro = 'COP' then a2.monto_cop
                             when upper(p.moneda) = 'USD' then p.monto_moneda
                             when coalesce(a2.trm, 0) > 1 then a2.monto_cop / a2.trm
                             else null end as nuevo
            from public.abonos a2 join public.cotizacion_pagos_previos p on p.abono_id = a2.id
           where a2.numero_contrato = p_numero and a2.monto_cop is not null) n
   where a.id = n.id and n.nuevo is not null and a.valor_abono is distinct from n.nuevo;
end $$;
revoke all on function p75_priv.normalizar_abonos_previos(text) from public, anon, authenticated;
grant execute on function p75_priv.normalizar_abonos_previos(text) to service_role;

create or replace function p75_priv.mover_cxp_a_prevista(p_cxp_id bigint, p_clave text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.cuentas_por_pagar;
begin
  select * into c from public.cuentas_por_pagar where id = p_cxp_id for update;
  if not found then return; end if;
  if not exists (select 1 from public.ventas v where v.numero_contrato = c.numero_contrato and v.estado = 'pendiente') then
    raise exception 'mover_cxp_a_prevista: solo se trasladan obligaciones de un contrato pendiente (%).', c.numero_contrato;
  end if;
  if exists (select 1 from public.cxp_pagos p where p.cuenta_por_pagar_id = c.id) or exists (select 1 from public.retenciones_cxp r where r.cuenta_por_pagar_id = c.id) then
    raise exception 'mover_cxp_a_prevista: la CxP % tiene pagos o retenciones; no es una obligación solo prevista.', c.id;
  end if;
  insert into public.contrato_obligaciones_previstas (numero_contrato, clase, clave, payload) values (c.numero_contrato, 'cxp', p_clave, to_jsonb(c));
  delete from public.asiento_lineas where asiento_id in (select a.id from public.asientos_contables a where a.origen = 'cxp' and a.referencia = 'cxp:' || c.id);
  delete from public.asientos_contables where origen = 'cxp' and referencia = 'cxp:' || c.id;
  perform set_config('app.p75_traslado', 'on', true);
  delete from public.cuentas_por_pagar where id = c.id;
end $$;
revoke all on function p75_priv.mover_cxp_a_prevista(bigint, text) from public, anon, authenticated, service_role;

-- El trigger de borrado de una obligación #63 (227) respeta el traslado a «prevista» (el bypass dura la transacción de creación).
create or replace function public.trg_cxp_borrada_63() returns trigger
language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
begin
  if coalesce(current_setting('app.p75_traslado', true), '') = 'on' then
    return null;    -- 288 (#75): la obligación #63 pasó a «prevista» dentro de la creación del contrato pendiente; la materialización la repone al confirmar
  end if;
  if exists (select 1 from public.ventas v where v.numero_contrato = old.numero_contrato and v.aceptacion_63_id = old.aceptacion_63_id) then
    raise exception 'p63_cxp_protegida: la obligación aceptada % del contrato % no se elimina mientras el contrato exista', old.obligacion_63, old.numero_contrato;
  end if;
  return null;
end $function$;

-- (b) ¿Los abonos del contrato alcanzan el mínimo? Solo lectura, solo contratos que quien llama puede ver (no filtra importes de contratos ajenos).
create or replace function p75_priv.alcanza_minimo(p_numero text) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v public.ventas;
begin
  if auth.uid() is not null and not public.puede_ver_contrato(p_numero) then return false; end if;
  select * into v from public.ventas where numero_contrato = p_numero;
  if not found or v.estado is distinct from 'pendiente' or v.financiero_estado = 'pendiente' then return false; end if;
  return coalesce((p75_priv.estado_minimo(p_numero)->>'alcanza')::boolean, false);
end $$;
revoke all on function p75_priv.alcanza_minimo(text) from public, anon;
grant execute on function p75_priv.alcanza_minimo(text) to authenticated, service_role;

-- Reintento de la confirmación por pago (abono ya registrado y confirmación pendiente): idempotente, con la MISMA autorización que confirmar a mano (INVOKER).
create or replace function public.reintentar_confirmacion_pago(p_numero text) returns jsonb
language plpgsql set search_path to 'public', 'pg_temp' as $$
begin
  if auth.uid() is null then raise exception using errcode = '42501', message = 'Sesión requerida.'; end if;
  if not p75_priv.alcanza_minimo(p_numero) then
    return jsonb_build_object('confirmada', false, 'motivo', 'sin_minimo_o_no_pendiente');
  end if;
  return jsonb_build_object('confirmada', true, 'resultado', public.confirmar_venta(p_numero));
end $$;
revoke all on function public.reintentar_confirmacion_pago(text) from public, anon;
grant execute on function public.reintentar_confirmacion_pago(text) to authenticated;

-- (c) Conversión de cotización con PAGOS PREVIOS. El contrato nace PENDIENTE: sus CxP (y los asientos que la base les creó) pasan a «previstas»; los pagos previos ya quedaron
-- como abonos (no se descartan ni se duplican). El mínimo se EVALÚA al final de la conversión controlada con confirmar_tras_conversion (inferior → sigue pendiente;
-- igual o superior → confirma y materializa UNA vez). Si ese paso falla, la conversión NO se pierde: queda «abonos suficientes, confirmación pendiente» y se reintenta.
create or replace function p75_priv.trasladar_cxp_a_previstas(p_numero text) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare c record; n integer := 0;
begin
  -- Testigo de la conversión (solo lo fija el envoltorio de abajo en esta transacción).
  if current_setting('app.p75_conv', true) is distinct from p_numero then
    raise exception using errcode = '42501', message = 'trasladar_cxp_a_previstas: solo desde la conversión del propio contrato.';
  end if;
  for c in select id, tipo_proveedor, row_number() over (order by id) as ord from public.cuentas_por_pagar where numero_contrato = p_numero order by id loop
    perform p75_priv.mover_cxp_a_prevista(c.id, 'cxp:c:' || c.ord || ':' || coalesce(c.tipo_proveedor, ''));
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function p75_priv.trasladar_cxp_a_previstas(text) from public, anon;
grant execute on function p75_priv.trasladar_cxp_a_previstas(text) to authenticated, service_role;

create or replace function public.convertir_cotizacion_a_contrato(p_cotizacion_id bigint, p_usuario_id uuid)
 returns text
 language plpgsql
as $function$
declare v_n text; v_rol text; v_t_cot text; v_t_vta text; v_t_act text;
begin
  -- REINTENTO (respuesta perdida, llamada repetida o concurrente): una conversión ya terminada nunca es un error ni se repite. Se serializa con el FOR UPDATE de la cotización y, ANTES de devolver
  -- el contrato existente, se comprueba la autorización VIGENTE del actor: usuario existente, activo y de rol de conversión (_autorizado_pago_previo) y acceso a la agencia de la cotización y del contrato
  -- (superadmin = excepción global). Nada de lo económico ni lo escrito se repite: ni CxP a previstas, ni materialización, ni normalización, ni validaciones de importes.
  v_rol := public._autorizado_pago_previo(p_usuario_id);
  select tenant into v_t_cot from public.cotizaciones where id = p_cotizacion_id for update;
  if found then
    select tenant into v_t_act from public.usuarios where id = p_usuario_id;
    if v_rol <> 'superadmin' and v_t_act is distinct from v_t_cot then
      raise exception 'No tienes acceso a la agencia (tenant %) de esta cotización.', v_t_cot using errcode = '42501';
    end if;
    select numero_contrato, tenant into v_n, v_t_vta from public.ventas where cotizacion_id = p_cotizacion_id;
    if found then
      if v_rol <> 'superadmin' and v_t_act is distinct from v_t_vta then
        raise exception 'No tienes acceso a la agencia (tenant %) de este contrato.', v_t_vta using errcode = '42501';
      end if;
      return v_n;
    end if;
  end if;
  v_n := p75_priv.convertir_cotizacion_base(p_cotizacion_id, p_usuario_id);
  perform set_config('app.p75_conv', v_n, true);
  perform p75_priv.trasladar_cxp_a_previstas(v_n);
  perform set_config('app.p75_conv', '', true);
  perform p75_priv.normalizar_abonos_previos(v_n);   -- valor_abono en la moneda de COBRO (ver la función)
  -- La CONFIRMACIÓN por pagos previos NO va aquí: la conversión controlada (#97) completa después el recobro y el plan de comisión, y confirmar antes dejaría
  -- la comisión sin materializar. Se evalúa al FINAL con confirmar_tras_conversion (paso posterior, mismo gancho confirmar_venta).
  return v_n;
end $function$;

-- ¿Hay abonos suficientes y el contrato sigue pendiente (confirmación pendiente)? Solo un booleano, solo contratos que quien llama puede ver (la ficha lo usa para avisar y ofrecer el reintento).
create or replace function public.estado_confirmacion_pago(p_numero text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('confirmacion_pendiente', p75_priv.alcanza_minimo(p_numero))
$$;
revoke all on function public.estado_confirmacion_pago(text) from public, anon;
grant execute on function public.estado_confirmacion_pago(text) to authenticated, service_role;

-- Parte 3: ¿contrato NETO de aliado? (para presentar el mínimo correcto sin exponer comision_estado en la vista básica). Booleano, solo contratos que quien llama puede ver.
create or replace function public.contrato_es_neto(p_numero text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select v.comision_estado = 'descontada' from public.ventas v where v.numero_contrato = p_numero
                    and (auth.uid() is null or public.puede_ver_contrato(v.numero_contrato))), false)
$$;
revoke all on function public.contrato_es_neto(text) from public, anon;
grant execute on function public.contrato_es_neto(text) to authenticated, service_role;

-- Paso FINAL de una conversión (lo llama la app con service_role, ya con el recobro y el plan de comisión de #97 completos). Mismo criterio que registrar_abono: el actor debe ser uno
-- de los 4 roles que pueden confirmar a mano; si los abonos alcanzan el mínimo confirma con el gancho único (confirmar_venta) y materializa UNA vez. Idempotente; INVOKER
-- (service_role) para que f208_priv.actor valide al actor igual que en el abono. No amplía quién confirma: solo evalúa la regla de pago ya existente.
create or replace function public.confirmar_tras_conversion(p_numero text, p_actor uuid) returns jsonb
language plpgsql set search_path to '' as $$
declare u public.usuarios;
begin
  u := f208_priv.actor(p_actor, array['superadmin','gerencia','administracion','operaciones']);
  return p75_priv.confirmar_por_pago(p_numero, u.id);
end $$;
revoke all on function public.confirmar_tras_conversion(text, uuid) from public, anon, authenticated;
grant execute on function public.confirmar_tras_conversion(text, uuid) to service_role;

-- (d) Transferencia posterior de pagos previos a abonos de un contrato ya convertido: tras transferir, se evalúa el mínimo igual que arriba.
create or replace function public.transferir_pagos_previos_a_abonos(p_cotizacion_id bigint, p_numero_contrato text, p_usuario_id uuid)
 returns text
 language plpgsql
as $function$
declare v_r text;
begin
  v_r := p75_priv.transferir_pagos_previos_base(p_cotizacion_id, p_numero_contrato, p_usuario_id);
  perform p75_priv.normalizar_abonos_previos(p_numero_contrato);
  begin
    if p75_priv.alcanza_minimo(p_numero_contrato) then perform public.confirmar_venta(p_numero_contrato); end if;
  exception when others then
    null;
  end;
  return v_r;
end $function$;

revoke all on function p75_priv.convertir_cotizacion_base(bigint, uuid) from public, anon, authenticated, service_role;
revoke all on function p75_priv.transferir_pagos_previos_base(bigint, text, uuid) from public, anon, authenticated, service_role;
grant execute on function p75_priv.convertir_cotizacion_base(bigint, uuid) to authenticated, service_role;
grant execute on function p75_priv.transferir_pagos_previos_base(bigint, text, uuid) to authenticated, service_role;

-- (e) EDICIÓN DE SERVICIOS de un contrato pendiente: items, precio, costos/resumen y obligaciones previstas (o CxP históricas) en UNA transacción:
--     o se aplica todo o se rechaza todo. Solo service_role (la app autoriza antes con la sesión del usuario). p_ventas: columnas permitidas de `ventas`.
create or replace function public.pendiente_aplicar_servicios(
  p_numero text, p_items_borrar bigint[], p_items_nuevos jsonb, p_ventas jsonb,
  p_prev_eliminar bigint[], p_prev_actualizar jsonb, p_prev_insertar jsonb,
  p_cxp_eliminar bigint[], p_cxp_actualizar jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.ventas; e jsonb; k text; n_prev jsonb;
  permitidas constant text[] := array['precio_venta','costo_receptivo','costo_asistencia','otros_costos','tours_traslados','asistencia_medica'];
begin
  select * into v from public.ventas where numero_contrato = p_numero for update;
  if not found or v.estado is distinct from 'pendiente' then
    raise exception 'pendiente_aplicar_servicios: el contrato % no está pendiente.', p_numero using errcode = 'P0001';
  end if;
  delete from public.contrato_items where numero_contrato = p_numero and id = any (coalesce(p_items_borrar, '{}'::bigint[]));
  for e in select * from jsonb_array_elements(coalesce(p_items_nuevos, '[]'::jsonb)) loop
    insert into public.contrato_items (numero_contrato, descripcion, adultos, ninos, tarifa_adulto, tarifa_nino, orden)
    values (p_numero, e->>'descripcion', coalesce((e->>'adultos')::int, 1), coalesce((e->>'ninos')::int, 0),
            (e->>'tarifa_adulto')::numeric, coalesce((e->>'tarifa_nino')::numeric, 0), coalesce((e->>'orden')::int, 100));
  end loop;
  for k in select jsonb_object_keys(coalesce(p_ventas, '{}'::jsonb)) loop
    if not (k = any (permitidas)) then raise exception 'pendiente_aplicar_servicios: columna no permitida (%)', k; end if;
  end loop;
  update public.ventas set
    precio_venta     = coalesce((p_ventas->>'precio_venta')::numeric, precio_venta),
    costo_receptivo  = coalesce((p_ventas->>'costo_receptivo')::numeric, costo_receptivo),
    costo_asistencia = coalesce((p_ventas->>'costo_asistencia')::numeric, costo_asistencia),
    otros_costos     = coalesce((p_ventas->>'otros_costos')::numeric, otros_costos),
    tours_traslados  = case when p_ventas ? 'tours_traslados' then p_ventas->>'tours_traslados' else tours_traslados end,
    asistencia_medica = case when p_ventas ? 'asistencia_medica' then (p_ventas->>'asistencia_medica')::boolean else asistencia_medica end
   where numero_contrato = p_numero;
  n_prev := public.prevista_cxp_aplicar(p_numero, p_prev_eliminar, p_prev_actualizar, p_prev_insertar);
  if coalesce((n_prev->>'aplicado')::boolean, false) is not true then
    raise exception 'pendiente_aplicar_servicios: no se pudieron aplicar las obligaciones previstas.' using errcode = 'P0001';
  end if;
  -- CxP históricas de un pendiente anterior a la 288 (sin pagos: la app ya lo validó): se ajustan en la MISMA transacción.
  delete from public.cuentas_por_pagar c where c.numero_contrato = p_numero and c.id = any (coalesce(p_cxp_eliminar, '{}'::bigint[]))
     and not exists (select 1 from public.cxp_pagos p where p.cuenta_por_pagar_id = c.id) and not exists (select 1 from public.retenciones_cxp r where r.cuenta_por_pagar_id = c.id);
  for e in select * from jsonb_array_elements(coalesce(p_cxp_actualizar, '[]'::jsonb)) loop
    update public.cuentas_por_pagar set valor_total = (e->>'valor_total')::numeric, servicio = e->>'servicio', tipo_proveedor = e->>'tipo_proveedor', proveedor = e->>'proveedor'
     where id = (e->>'id')::bigint and numero_contrato = p_numero;
  end loop;
  return jsonb_build_object('aplicado', true, 'previstas', n_prev);
end $$;
revoke all on function public.pendiente_aplicar_servicios(text, bigint[], jsonb, jsonb, bigint[], jsonb, jsonb, bigint[], jsonb) from public, anon, authenticated;
grant execute on function public.pendiente_aplicar_servicios(text, bigint[], jsonb, jsonb, bigint[], jsonb, jsonb, bigint[], jsonb) to service_role;

notify pgrst, 'reload schema';
-- ─── 292 (cuerpo íntegro) ───
-- ───────────────────────────────────────────────────────────────────────────
-- 292 · Servicios con obligaciones PREVISTAS (#75, cierre del bloqueo abierto por la 288) — SIN APLICAR
--
-- PROBLEMA: desde la 288 un contrato PENDIENTE no tiene CxP exigibles: lo que antes era una CxP vive en `contrato_obligaciones_previstas` (payload jsonb).
-- Las protecciones de la 265 solo miran `cuentas_por_pagar`:
--   · borrar del catálogo un servicio vendido (ON DELETE SET NULL de contrato_servicios.servicio_id) o borrar/cambiar la línea de traslado por alcance
--     que la prevista enlaza (clave « · enlace:<uuid>») ya no se rechazaba, y
--   · la prevista conservaba un servicio_id o una clave que ya no existen: al CONFIRMAR, la materialización fallaba (FK de servicio_id o
--     tg_cxp_enlace_por_clave) y el contrato no se podía confirmar; o, si la prevista no estaba enlazada, la reconciliación por servicio la perdía.
-- REGLA: una prevista sin materializar protege su servicio y su línea EXACTAMENTE como la CxP que va a ser. La protección es de la base; el aviso de
-- eliminarServicio solo anticipa el motivo.
--
-- QUÉ HACE (aditiva; no toca la 265 aplicada: solo reemplaza con `create or replace` su función de trigger, cuyo md5 se comprueba antes):
--   1) p75_priv.clave_enlace_de(text): la MISMA extracción de la clave que tg_cxp_enlace_por_clave (265).
--   2) tg_linea_enlazada_protegida (265) + previstas: una línea enlazada a una prevista sin materializar no se borra ni cambia de alcance/servicio/clave
--      mientras exista su contrato. Eliminar el contrato (287/289: la venta desaparece y todo cae en cascada) sigue permitido.
--   3) servicio_con_previstas (BEFORE DELETE en servicios_adicionales): no se elimina un servicio con previstas sin materializar (enlazadas o no:
--      la reconciliación de servicios de un pendiente las identifica por servicio_id; anularlas en silencio las dejaría huérfanas).
--   4) prevista_valida (BEFORE INSERT/UPDATE OF payload en contrato_obligaciones_previstas): la prevista se valida como la CxP que será
--      (mismo contrato en el payload; servicio existente; clave → línea existente del MISMO contrato y servicio, con alcance) y BLOQUEA lo que enlaza
--      (línea FOR UPDATE, como la 265; servicio FOR KEY SHARE, como una FK). Así un borrado concurrente espera y luego ve la prevista, o la prevista
--      ve el borrado y falla: no hay carrera que deje una prevista huérfana.
-- Lo que NO cambia: autorización (RLS y grants de siempre; las funciones de trigger no son ejecutables por la API), identidad (guardas 284/285 de cada
-- tabla), la edición autorizada de servicios de un pendiente (pendiente_aplicar_servicios quita la prevista en su transacción; la línea, sin
-- prevista ni CxP, queda libre igual que antes de la 288), la materialización y eliminar_contrato (289).
--
-- ORDEN: inmediatamente después de la 288, ANTES de la 286 y antes de desplegar el código (preflight_292 → 292 → postcheck_292). La migración se
-- aborta sin modificar nada si encuentra previstas que YA violan la regla (p. ej. creadas en la ventana 288→292): esas se revisan, no se corrigen solas.
-- Rollback: supabase/scripts/rollback_292_servicio_obligaciones_previstas.sql.
-- ───────────────────────────────────────────────────────────────────────────

do $$
declare n_malas integer;
begin
  if to_regclass('public.contrato_obligaciones_previstas') is null then
    raise exception '292 ABORTADA SIN MODIFICAR NADA: falta la 288 (contrato_obligaciones_previstas).';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'linea_enlazada_protegida' and tgrelid = 'public.contrato_servicios'::regclass and not tgisinternal) then
    raise exception '292 ABORTADA SIN MODIFICAR NADA: falta la 265 (trigger linea_enlazada_protegida).';
  end if;
  if exists (select 1 from pg_trigger where tgname = 'servicio_con_previstas' and not tgisinternal) then
    raise exception '292: ya aplicada (existe el trigger servicio_con_previstas). No se re-aplica.';
  end if;
  if (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p where p.oid = to_regprocedure('public.tg_linea_enlazada_protegida()')) is distinct from '336c54ae9bd8a9bfacd3127ed7e7d7b7' then
    raise exception '292 ABORTADA SIN MODIFICAR NADA: tg_linea_enlazada_protegida no es la de la 265 (md5 esperado 336c54ae9bd8a9bfacd3127ed7e7d7b7). No se reemplaza una versión distinta.';
  end if;
  -- Previstas que YA violan la regla (misma comprobación que preflight_292, punto 3): no se aplica sobre datos rotos.
  select count(*) into n_malas
    from public.contrato_obligaciones_previstas p
    left join lateral (select substring(coalesce(p.payload->>'observaciones', '') from 'enlace:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\s*$') as clave) k on true
    left join public.contrato_servicios cs on cs.clave_enlace = k.clave::uuid
   where p.materializada_en is null
     and (   (nullif(p.payload->>'numero_contrato', '') is not null and p.payload->>'numero_contrato' <> p.numero_contrato)
          or (nullif(p.payload->>'servicio_id', '') is not null and not exists (select 1 from public.servicios_adicionales s where s.id = (p.payload->>'servicio_id')::bigint))
          or (k.clave is null and nullif(p.payload->>'contrato_servicio_id', '') is not null)
          or (k.clave is not null and (cs.id is null or cs.numero_contrato <> p.numero_contrato or cs.servicio_id is distinct from nullif(p.payload->>'servicio_id', '')::bigint
                                       or cs.alcance_traslado is null or (nullif(p.payload->>'contrato_servicio_id', '') is not null and (p.payload->>'contrato_servicio_id')::bigint <> cs.id))));
  if n_malas > 0 then
    raise exception '292 ABORTADA SIN MODIFICAR NADA: % obligación(es) prevista(s) sin materializar ya apuntan a un servicio o línea inexistente o ajena. Revisarlas con preflight_292 antes de aplicar.', n_malas;
  end if;
end $$;

-- ── 1) La clave de enlace de un texto de observaciones (idéntica a la de tg_cxp_enlace_por_clave, 265) ─────────────────────────────
create or replace function p75_priv.clave_enlace_de(p_obs text) returns uuid
language sql immutable set search_path = pg_catalog, pg_temp as $$
  select substring(coalesce(p_obs, '') from 'enlace:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\s*$')::uuid
$$;
revoke all on function p75_priv.clave_enlace_de(text) from public, anon, authenticated;

-- ¿La línea tiene una prevista SIN materializar que la enlaza (por id o por su clave)? Solo la usan los triggers de abajo.
create or replace function p75_priv.prevista_enlaza_linea(p_numero text, p_linea bigint, p_clave uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.contrato_obligaciones_previstas p
                  where p.numero_contrato = p_numero and p.clase = 'cxp' and p.materializada_en is null
                    and (p.payload->>'contrato_servicio_id' = p_linea::text or (p_clave is not null and p75_priv.clave_enlace_de(p.payload->>'observaciones') = p_clave)))
$$;
revoke all on function p75_priv.prevista_enlaza_linea(text, bigint, uuid) from public, anon, authenticated;

create index if not exists contrato_obligaciones_previstas_servicio_idx
  on public.contrato_obligaciones_previstas ((payload->>'servicio_id')) where materializada_en is null;

-- ── 2) Línea enlazada protegida (265) — ahora también por su obligación PREVISTA ───────────────────────────────────────────────
create or replace function public.tg_linea_enlazada_protegida()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_cxp boolean; v_prev boolean;
begin
  if coalesce(current_setting('app.enlace_cxp_autorizado', true), '') = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  v_cxp := exists (select 1 from public.cuentas_por_pagar c where c.contrato_servicio_id = old.id);
  v_prev := not v_cxp and p75_priv.prevista_enlaza_linea(old.numero_contrato, old.id, old.clave_enlace);   -- 292
  if not v_cxp and not v_prev then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    if exists (select 1 from public.ventas v where v.numero_contrato = old.numero_contrato) then
      if v_cxp then
        raise exception 'contrato_servicios: la línea tiene una cuenta por pagar enlazada y no se puede borrar' using errcode = '23503';
      end if;
      raise exception 'contrato_servicios: la línea tiene una obligación prevista enlazada (su cuenta por pagar al confirmar) y no se puede borrar' using errcode = '23503';
    end if;
    return old;
  end if;
  if new.alcance_traslado is distinct from old.alcance_traslado or new.servicio_id is distinct from old.servicio_id or new.clave_enlace is distinct from old.clave_enlace then
    if v_cxp then
      raise exception 'contrato_servicios: el alcance, el servicio y la clave de una línea con cuenta por pagar enlazada no se editan' using errcode = '42501';
    end if;
    raise exception 'contrato_servicios: el alcance, el servicio y la clave de una línea con obligación prevista enlazada no se editan' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.tg_linea_enlazada_protegida() from public, anon, authenticated;

-- ── 3) Un servicio del catálogo con previstas sin materializar no se elimina ─────────────────────────────────────────────────────
create or replace function public.tg_servicio_con_previstas()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Corre DESPUÉS de bloquear la fila del servicio: una prevista que se estaba creando con FOR KEY SHARE ya terminó y aquí se ve (READ COMMITTED).
  if exists (select 1 from public.contrato_obligaciones_previstas p
              where p.materializada_en is null and p.clase = 'cxp' and p.payload->>'servicio_id' = old.id::text) then
    raise exception 'servicios_adicionales: el servicio % tiene obligaciones previstas de contratos pendientes y no se puede eliminar', old.id using errcode = '42501';
  end if;
  return old;
end;
$$;
revoke all on function public.tg_servicio_con_previstas() from public, anon, authenticated;
drop trigger if exists servicio_con_previstas on public.servicios_adicionales;
create trigger servicio_con_previstas before delete on public.servicios_adicionales for each row execute function public.tg_servicio_con_previstas();

-- ── 4) La prevista se valida como la CxP que será, y bloquea lo que enlaza ────────────────────────────────────────────────────────
create or replace function public.tg_prevista_valida()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_srv bigint; v_clave uuid; v_cs record;
begin
  if new.materializada_en is not null then return new; end if;   -- lo materializado ya es una CxP real y la protegen la 265 y sus FK
  if nullif(new.payload->>'numero_contrato', '') is not null and new.payload->>'numero_contrato' <> new.numero_contrato then
    raise exception 'contrato_obligaciones_previstas: el payload es de otro contrato (%)', new.payload->>'numero_contrato' using errcode = '23514';
  end if;
  v_srv := nullif(new.payload->>'servicio_id', '')::bigint;
  v_clave := p75_priv.clave_enlace_de(new.payload->>'observaciones');
  if v_clave is null then
    if nullif(new.payload->>'contrato_servicio_id', '') is not null or nullif(new.payload->>'alcance_traslado', '') is not null then
      raise exception 'contrato_obligaciones_previstas: el vínculo con una línea de servicio y el alcance solo se asignan con una clave de enlace verificable' using errcode = '23514';
    end if;
  else
    -- Mismo orden de bloqueo que la CxP al materializarse (línea y luego servicio): sin abrazos mortales con confirmar_venta.
    select cs.id, cs.numero_contrato, cs.servicio_id, cs.alcance_traslado into v_cs
      from public.contrato_servicios cs where cs.clave_enlace = v_clave for update;
    if not found then
      raise exception 'contrato_obligaciones_previstas: la clave de enlace % no corresponde a ninguna línea de servicio', v_clave using errcode = '23503';
    end if;
    if v_cs.numero_contrato is distinct from new.numero_contrato then
      raise exception 'contrato_obligaciones_previstas: la clave de enlace % pertenece a otro contrato', v_clave using errcode = '23514';
    end if;
    if v_cs.servicio_id is distinct from v_srv then
      raise exception 'contrato_obligaciones_previstas: la clave de enlace % es de otro servicio del catálogo', v_clave using errcode = '23514';
    end if;
    if v_cs.alcance_traslado is null then
      raise exception 'contrato_obligaciones_previstas: la línea de la clave % no tiene alcance vendido', v_clave using errcode = '23514';
    end if;
    if nullif(new.payload->>'contrato_servicio_id', '') is not null and (new.payload->>'contrato_servicio_id')::bigint <> v_cs.id then
      raise exception 'contrato_obligaciones_previstas: el vínculo declarado no es la línea de la clave %', v_clave using errcode = '23514';
    end if;
  end if;
  if v_srv is not null then
    perform 1 from public.servicios_adicionales s where s.id = v_srv for key share;   -- lo que haría una FK: el borrado concurrente espera
    if not found then
      raise exception 'contrato_obligaciones_previstas: el servicio % del catálogo no existe', v_srv using errcode = '23503';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.tg_prevista_valida() from public, anon, authenticated;
drop trigger if exists prevista_valida on public.contrato_obligaciones_previstas;
create trigger prevista_valida before insert or update of payload on public.contrato_obligaciones_previstas for each row execute function public.tg_prevista_valida();

comment on function public.tg_prevista_valida() is 'Migración 292 (#75): una obligación prevista se valida y bloquea su servicio y su línea como la CxP que será.';
comment on function public.tg_servicio_con_previstas() is 'Migración 292 (#75): un servicio con obligaciones previstas sin materializar no se elimina del catálogo.';
commit;
