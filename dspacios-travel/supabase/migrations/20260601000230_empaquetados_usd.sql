-- ───────────────────────────────────────────────────────────────────────────
-- 230 · EMPAQUETADOS (y sus salidas vinculadas) EN USD  (#90 · levanta D9)
--
-- CONTEXTO MEDIDO POR EL DUEÑO EN PRODUCCIÓN: 17 empaquetados MDE-SDQ-MDE (ids 3-9 y 11-20) con tarifa_para_empaquetar 415-445 y
-- fee 45 guardados como COP son en realidad USD (regla del dueño: todo tiquete que diga COP con valor por debajo de mil es USD).
-- 16 están vinculados al paquete 70 (Dinámico, modo cop_trm_63, inactivo). La 227 solo admitía COP (empaquetados_moneda_cop_chk y
-- salidas_dinamicas_vinculada_chk con moneda = 'COP'). Esta migración NO corrige datos (ver supabase/scripts/correccion_230_*.sql).
--
-- QUÉ HACE (ADITIVA; no edita la 227, no toca datos, no cambia policies ni ACL)
--   1. empaquetados.moneda: el CHECK admite 'COP' y 'USD' (se reemplaza empaquetados_moneda_cop_chk por empaquetados_moneda_chk).
--   2. salidas_dinamicas: una vinculada sigue sin markup ni TA, pero su moneda puede ser USD; el CHECK deja de fijar 'COP'.
--      La COHERENCIA con su vuelo de Empaquetados (misma moneda) la exige trg_salida_vinculada_63 (se reemplaza y vigila 'moneda').
--   3. Invalidación: el trigger de la 226 sobre empaquetados (Bloqueo/Porción vía armado_empaquetados) no vigilaba 'moneda': ahora sí.
--      El de costos de #63 (trg_p63_costos_empaquetados, que mueve p63_rev_costos) tampoco: ahora sí (la moneda del costo cambia la deuda).
--      (El de la 227 sobre salidas vinculadas y el de salidas_dinamicas (181) ya vigilaban la moneda.)
--   4. aceptar_oferta_63 (227) se reemplaza con el MISMO cuerpo salvo dos validaciones: el vuelo vinculado puede estar en COP o USD
--      (antes exigía COP) y la salida debe tener la MISMA moneda que su vuelo.
--
-- QUÉ NO HACE
--   No cambia publicar_tarifario_resultado_63 (el tarifario sigue publicándose en COP: el tiquete USD se convierte × TRM en la capa
--   de aplicación, una sola vez, antes del markup/impuesto), ni crear_cotizacion_oferta_63, ni p63_registrar_financiero (ya acepta
--   COP/USD por obligación con su equivalente), ni registrar_financiero_contrato, ni ninguna tabla privada de #63.
--
-- ORDEN DE DESPLIEGUE: esta migración va ANTES del código nuevo (el código anterior sigue funcionando con ella aplicada, porque todo
--   empaquetado existente sigue en COP). La corrección de datos va DESPUÉS del código desplegado.
-- Rollback: supabase/scripts/rollback_230_empaquetados_usd.sql (se niega si ya hay empaquetados o salidas vinculadas en USD).
-- ───────────────────────────────────────────────────────────────────────────

begin;

-- ═══ 0. Prerrequisitos (fallan cerrado) ═══════════════════════════════════
do $$
begin
  if to_regclass('public.tarifario_oferta_63') is null
     or to_regprocedure('public.aceptar_oferta_63(bigint, text, uuid, text, text)') is null
     or to_regprocedure('public.trg_salida_vinculada_63()') is null
     or to_regprocedure('public.tarifario_trg_bump_por_empaquetado()') is null
     or to_regprocedure('public.trg_p63_costos_empaquetados()') is null then
    raise exception '230 ABORTADA: falta la 227 (#63) o la 226/181.';
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.empaquetados'::regclass and conname = 'empaquetados_moneda_cop_chk') then
    raise exception '230 ya aplicada o la 227 no está en su forma original (falta empaquetados_moneda_cop_chk). No se re-aplica.';
  end if;
end $$;

-- ═══ 1. empaquetados.moneda: COP o USD ════════════════════════════════════
alter table public.empaquetados drop constraint empaquetados_moneda_cop_chk;
alter table public.empaquetados add constraint empaquetados_moneda_chk check (moneda in ('COP', 'USD'));
comment on column public.empaquetados.moneda is
  'Moneda de tarifa_proveedor / tarifa_para_empaquetar / fee_infante: COP o USD. Todo empaquetado existente sigue en COP hasta que se corrija a mano (script de datos de la 230). Migración 227, ampliada por la 230.';

-- ═══ 2. salidas_dinamicas: una vinculada puede ser USD (sin markup ni TA) ═══
alter table public.salidas_dinamicas drop constraint salidas_dinamicas_vinculada_chk;
alter table public.salidas_dinamicas add constraint salidas_dinamicas_vinculada_chk check (empaquetado_id is null or (aplica_mk = false and ta = 0));
comment on column public.salidas_dinamicas.moneda is
  'Moneda acreditada de valor_tiquete/ta/fee_infante. Una salida MANUAL en modo cop_trm_63 la convierte × la TRM del paquete; una VINCULADA copia la moneda de su vuelo de Empaquetados (la exige trg_salida_vinculada_63). Migración 227, ampliada por la 230.';

-- Guarda inmediata de una vinculada (227) + misma moneda que su fuente (230).
create or replace function public.trg_salida_vinculada_63()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tipo   text;
  v_modo   text;
  v_existe boolean;
  v_record text;
  v_moneda text;
begin
  if NEW.empaquetado_id is null then
    return NEW;
  end if;
  select p.tipo::text, p.modo_oferta into v_tipo, v_modo from public.armado_paquetes p where p.id = NEW.paquete_id;
  if v_tipo is distinct from 'dinamico' or v_modo is distinct from 'cop_trm_63' then
    raise exception 'salida_vinculada_modo: una salida vinculada a Empaquetados solo existe en un paquete Dinámico en modo cop_trm_63 (paquete %)', NEW.paquete_id;
  end if;
  select true, e.record, e.moneda into v_existe, v_record, v_moneda from public.empaquetados e where e.id = NEW.empaquetado_id;
  if not coalesce(v_existe, false) then
    raise exception 'salida_vinculada_fuente: el vuelo de Empaquetados % no existe', NEW.empaquetado_id;
  end if;
  if nullif(btrim(coalesce(v_record, '')), '') is not null then
    raise exception 'salida_vinculada_record: el vuelo de Empaquetados % ya tiene record (PNR); solo se vinculan vuelos de sistema sin record', NEW.empaquetado_id;
  end if;
  if NEW.moneda is distinct from v_moneda then
    raise exception 'salida_vinculada_moneda: la salida debe tener la misma moneda que su vuelo de Empaquetados % (salida %, vuelo %)', NEW.empaquetado_id, NEW.moneda, v_moneda;
  end if;
  return NEW;
end;
$$;
revoke all on function public.trg_salida_vinculada_63() from public, anon, authenticated;

drop trigger if exists tr_salida_vinculada_63 on public.salidas_dinamicas;
create trigger tr_salida_vinculada_63
  before insert or update of empaquetado_id, paquete_id, moneda on public.salidas_dinamicas
  for each row execute function public.trg_salida_vinculada_63();

-- ═══ 3. Invalidación: cambiar la moneda de un empaquetado invalida lo que lo usa ═══
-- (a) Bloqueo/Porción (armado_empaquetados): el trigger de la 226 + 'moneda'.
drop trigger if exists tarifario_trg_empaquetados on public.empaquetados;
create trigger tarifario_trg_empaquetados
  after insert or delete or update of activo, compra_inicio, compra_fin, tarifa_para_empaquetar, fee_infante, fecha_ida, fecha_regreso, ruta, moneda
  on public.empaquetados
  for each row execute function public.tarifario_trg_bump_por_empaquetado();

-- (b) #63: el contador de costos (p63_rev_costos) también cambia con la moneda del costo.
drop trigger if exists trg_p63_costos_empaquetados on public.empaquetados;
create trigger trg_p63_costos_empaquetados
  after update of proveedor_id, tarifa_proveedor, moneda on public.empaquetados
  for each row execute function public.trg_p63_costos_empaquetados();

-- ═══ 4. aceptar_oferta_63: el vuelo vinculado puede estar en USD (misma moneda que la salida) ═══
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

commit;
