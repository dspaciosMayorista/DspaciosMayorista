-- ═══════════════════════════════════════════════════════════════════════════
-- Migración 236 · #90 (entrega I)
-- Equivalente en COP de las CxP en USD del carrito, congelado a la TRM de COSTOS.
-- Preflight/postcheck/rollback: supabase/scripts/{preflight,postcheck,rollback}_236_cxp_equivalente_costo.sql
--
-- Problema: la conversión de un carrito en USD no podía registrar obligaciones con proveedores en USD (se rechazaban antes de numerar), porque
-- una CxP sin equivalente en COP se devenga por su valor nominal ("USD 210" como "$210").
--
-- Decisión de modelo: columnas PROPIAS `valor_cop_costo` / `trm_costo`, NO las de #63 (`valor_cop_63`/`trm_63`).
--   · Las de #63 solo valen junto a su marca de aceptación (`aceptacion_63_id`/`obligacion_63`, FK a p63_aceptacion, único por obligación) y la RPC de #63
--     deriva el payload del snapshot aceptado; el lector contable (`resolverImporteContable63`) falla cerrado ante un equivalente SIN esa marca. Reutilizarlas
--     sin la aceptación sería o bien rechazado por el lector, o bien una marca falsa. Las del carrito son otra semántica: TRM de costos ingresada por quien
--     convierte, sin oferta aceptada.
--   · Las dos familias son MUTUAMENTE EXCLUYENTES en una fila (CHECK) para que el lector contable nunca tenga que elegir entre dos equivalentes.
--
-- Qué garantiza la base:
--   1. `cuentas_por_pagar_cop_costo_chk`: equivalente y TRM van juntos; solo en una CxP en USD; TRM > 0; equivalente >= 0;
--      equivalente = round(valor_total × TRM, 2) con tolerancia de un centavo; sin marca ni equivalente de #63. Vale para INSERT y para cualquier UPDATE
--      (cambiar valor_total o la moneda de una CxP con equivalente queda rechazado).
--   2. `trg_cxp_costo_inmutable`: el equivalente y su TRM solo nacen con la fila (INSERT); no se agregan, cambian ni quitan después (el asiento de devengo ya
--      se calculó con ellos).
--   3. `registrar_financiero_contrato` (reemplaza la de la 227; el camino #63 y el de siempre quedan IGUALES): valida el par antes de escribir, una sola TRM de
--      costos por contrato, y que si alguna CxP del payload la lleva, toda CxP en USD con importe la lleve. Escribe las dos columnas en la MISMA
--      transacción que la CxP, y reintentar el payload guardado en `contrato_financiero_pendiente` repite exactamente lo mismo (idempotente).
-- No toca datos existentes. Nada se borra.
-- ═══════════════════════════════════════════════════════════════════════════
begin;

do $$
begin
  if to_regclass('public.cuentas_por_pagar') is null
     or to_regprocedure('public.registrar_financiero_contrato(text, text, jsonb, jsonb)') is null
     or to_regprocedure('public.p63_registrar_financiero(text, text, jsonb, jsonb, bigint)') is null
     or to_regprocedure('public.marca_cxp_automatica()') is null then
    raise exception '236 ABORTADA: falta la cadena 001-235 (cuentas_por_pagar, registrar_financiero_contrato, p63_registrar_financiero).';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'cuentas_por_pagar' and column_name in ('valor_cop_costo', 'trm_costo'))
     or to_regprocedure('public.trg_cxp_costo_inmutable()') is not null then
    raise exception '236 ABORTADA: ya existen objetos con estos nombres (la migración se aplica una sola vez).';
  end if;
end $$;

-- ═══ 1. Columnas y CHECK ═══
alter table public.cuentas_por_pagar
  add column valor_cop_costo numeric(15,2),
  add column trm_costo       numeric(15,4);

alter table public.cuentas_por_pagar
  add constraint cuentas_por_pagar_cop_costo_chk check (
    (valor_cop_costo is null) = (trm_costo is null)
    and (
      valor_cop_costo is null
      or (
        moneda = 'USD'
        and trm_costo > 0
        and valor_cop_costo >= 0
        and valor_cop_63 is null and trm_63 is null and aceptacion_63_id is null and obligacion_63 is null
        and abs(valor_cop_costo - round(valor_total * trm_costo, 2)) <= 0.01
      )
    )
  );

comment on column public.cuentas_por_pagar.valor_cop_costo is
  'Equivalente en COP de una CxP en USD, congelado a trm_costo. Solo lo escribe el carrito (registrar_financiero_contrato) al crear la fila; la CxP conserva su valor_total y moneda originales. El asiento de devengo usa este importe. NULL en toda obligación de siempre. Excluyente con valor_cop_63. Migración 236.';
comment on column public.cuentas_por_pagar.trm_costo is
  'TRM de COSTOS (COP por USD) con la que se congeló valor_cop_costo; distinta de la TRM de cobro del contrato. Una sola por contrato. Migración 236.';

-- ═══ 2. Inmutabilidad: nace con la fila ═══
create function public.trg_cxp_costo_inmutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if (NEW.valor_cop_costo, NEW.trm_costo) is distinct from (OLD.valor_cop_costo, OLD.trm_costo) then
    raise exception 'cxp_costo_inmutable: el equivalente en COP y la TRM de costos de la cuenta por pagar % se congelan al crearla y no se modifican', OLD.id
      using errcode = 'Z9610';
  end if;
  return NEW;
end;
$$;
comment on function public.trg_cxp_costo_inmutable() is
  '236 (#90 I): valor_cop_costo/trm_costo no se agregan, cambian ni quitan después de insertar la CxP. SQLSTATE Z9610.';

create trigger trg_cxp_costo_inmutable
  before update of valor_cop_costo, trm_costo on public.cuentas_por_pagar
  for each row execute function public.trg_cxp_costo_inmutable();

-- ═══ 3. RPC financiera: mismo cuerpo de la 227 + equivalente de costos ═══
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
$$;

comment on function public.registrar_financiero_contrato(text, text, jsonb, jsonb) is
  '236 (sobre 227): igual que la 227 (una sola escritura sobre un contrato pendiente; #63 deriva todo de lo aceptado) y, en el camino de siempre, valida y escribe el equivalente en COP a la TRM de costos de las CxP en USD (valor_cop_costo/trm_costo): par completo, solo USD, coherente con valor_total × TRM, una sola TRM por contrato y ninguna CxP en USD sin él cuando otra lo lleva. Solo service_role.';

revoke all on function public.registrar_financiero_contrato(text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.registrar_financiero_contrato(text, text, jsonb, jsonb) to service_role;

commit;
