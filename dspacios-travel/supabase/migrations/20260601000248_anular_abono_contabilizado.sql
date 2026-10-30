-- ───────────────────────────────────────────────────────────────────────────
-- 248 · ANULACIÓN ATÓMICA DE UN ABONO CONTABILIZADO + REGISTRO ATÓMICO E IDEMPOTENTE DE ABONOS
-- (Numeración: RENUMERADA 246 → 248 porque main ya ocupó 244–247 con #88/#409 (programas); esta es la siguiente libre.)
--
-- Problema: `eliminarAbono` borraba la fila de `abonos` y la guarda F4415 (208)
-- lo impide si el abono tiene asiento; el Libro diario tampoco deja borrar ese
-- asiento automático. Resultado: un abono mal registrado (p. ej. contrato
-- minorista 534) no tenía salida.
--
-- Solución (ninguna guarda de la 208 se desactiva; solo `f208_abonos_marca` gana una excepción, ver al final): la RPC `anular_abono`
-- hace, en UNA transacción y con la venta + el abono bloqueados,
--   1. comprueba actor (rol activo), contrato y agencia;
--   2. bloquea con mensaje propio si hay una dependencia que se rompería:
--        F4460 viene de un pago previo aplicado a la cotización
--        F4461 está conciliado con el banco (deshacer el cruce primero)
--        F4418 la factura vigente ya aplicó su anticipo (quitar la factura antes)
--   3. guarda la huella completa (fila del abono + asiento con sus líneas) en
--      `abonos_anulados` (append-only), con actor y motivo;
--   4. borra el asiento del abono (balanceado: el libro queda cuadrado) y luego
--      el abono. La guarda F4415 se cumple sola: al borrar ya no hay asiento.
-- Cualquier fallo revierte todo: nunca queda un asiento huérfano ni un abono
-- sin su asiento. Repetir la llamada (doble pulsación) es idempotente:
-- responde `ya_anulado` y no escribe nada.
--
-- Errores nuevos (anular): F4460 FIN_ABONO_PAGO_PREVIO · F4461 FIN_ABONO_CONCILIADO ·
-- F4462 FIN_MOTIVO_REQUERIDO · F4463 FIN_ANULACION_INMUTABLE.
-- Rollback: supabase/scripts/rollback_248_anular_abono.sql
-- ───────────────────────────────────────────────────────────────────────────

do $$
begin
  if to_regprocedure('f208_priv.actor(uuid,text[])') is null
     or to_regprocedure('f208_priv.bloquear_venta(text,text)') is null
     or to_regprocedure('f208_priv.exigir_agencia(public.usuarios,text,text,text[])') is null
     or to_regprocedure('f208_priv.factura_vigente_id(text)') is null
     or to_regprocedure('f208_priv.abono_tiene_asiento(bigint)') is null then
    raise exception '248: faltan helpers de la 208.';
  end if;
  if to_regclass('public.abonos_anulados') is not null then
    raise exception '248: ya aplicada (existe abonos_anulados). No se re-aplica.';
  end if;
end $$;

-- ── Huella append-only ────────────────────────────────────────────────────
create table public.abonos_anulados (
  id              bigserial primary key,
  abono_id        bigint not null unique,
  numero_contrato text not null,            -- sin FK: la huella sobrevive al contrato
  tenant          text not null,
  abono           jsonb not null,           -- fila completa de `abonos` antes de borrarla
  asientos        jsonb not null default '[]'::jsonb,  -- [{asiento:{…}, lineas:[…]}] retirados del libro
  motivo          text not null check (length(btrim(motivo)) >= 3),
  actor_id        uuid not null,
  actor_email     text,
  anulado_en      timestamptz not null default now()
);
create index idx_abonos_anulados_contrato on public.abonos_anulados (numero_contrato);

alter table public.abonos_anulados enable row level security;
create policy "abonos_anulados: lectura contable" on public.abonos_anulados for select
  using (public.mi_rol()::text in ('superadmin', 'gerencia', 'administracion', 'operaciones') and public.puede_ver_tenant(tenant));

create function public.f248_anulado_inmutable() returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'FIN_ANULACION_INMUTABLE: la huella de un abono anulado no se edita ni se borra.' using errcode = 'F4463';
end $$;
create trigger trg_f248_anulado_inmutable before update or delete on public.abonos_anulados
  for each row execute function public.f248_anulado_inmutable();
create trigger trg_f248_anulado_truncate before truncate on public.abonos_anulados
  for each statement execute function public.f248_anulado_inmutable();

revoke all on public.abonos_anulados from public, anon, authenticated, service_role;
grant select on public.abonos_anulados to authenticated;
grant select, insert on public.abonos_anulados to service_role;
grant usage on sequence public.abonos_anulados_id_seq to service_role;

-- ── RPC ───────────────────────────────────────────────────────────────────
create function public.anular_abono(p_abono_id bigint, p_numero text, p_tenant text, p_actor uuid, p_motivo text)
returns jsonb language plpgsql set search_path = '' as $$
declare
  u public.usuarios;
  v_numero text; v_tenant text;
  b public.abonos;
  v_ref text := 'abono:' || p_abono_id;
  v_prev public.abonos_anulados;
  v_credito text;
  v_huella jsonb;
  v_n int;
begin
  u := f208_priv.actor(p_actor, array['superadmin','gerencia','administracion','operaciones']);
  perform pg_catalog.set_config('lock_timeout', '5s', true);
  if p_motivo is null or length(btrim(p_motivo)) < 3 then
    raise exception 'FIN_MOTIVO_REQUERIDO: indica el motivo de la anulación (mínimo 3 caracteres).' using errcode = 'F4462';
  end if;

  select numero_contrato into v_numero from public.abonos where id = p_abono_id;
  if v_numero is null then
    -- Ya anulado (doble pulsación / reintento): no se escribe nada.
    select * into v_prev from public.abonos_anulados where abono_id = p_abono_id;
    if v_prev.id is not null and v_prev.numero_contrato = p_numero then
      perform f208_priv.exigir_agencia(u, p_tenant, v_prev.tenant, array['superadmin','gerencia']);
      return jsonb_build_object('estado', 'ya_anulado', 'anulacion_id', v_prev.id);
    end if;
    raise exception 'FIN_ABONO_INEXISTENTE: el abono % ya no existe.', p_abono_id using errcode = 'F4405';
  end if;
  if v_numero <> p_numero then
    raise exception 'FIN_ABONO_INEXISTENTE: el abono % no pertenece al contrato %.', p_abono_id, p_numero using errcode = 'F4405';
  end if;

  v_tenant := f208_priv.bloquear_venta(v_numero, 'update');     -- serializa con facturar/quitar
  perform f208_priv.exigir_agencia(u, p_tenant, v_tenant, array['superadmin','gerencia']);
  select * into b from public.abonos where id = p_abono_id for update;
  if b.id is null then
    select * into v_prev from public.abonos_anulados where abono_id = p_abono_id;
    if v_prev.id is not null then
      return jsonb_build_object('estado', 'ya_anulado', 'anulacion_id', v_prev.id);
    end if;
    raise exception 'FIN_ABONO_INEXISTENTE: el abono % ya no existe.', p_abono_id using errcode = 'F4405';
  end if;

  -- Dependencias que impiden anular (se evalúan con todo bloqueado).
  if exists (select 1 from public.cotizacion_pagos_previos where abono_id = p_abono_id)
     or exists (select 1 from public.asientos_contables a where a.tenant = v_tenant and a.origen = 'pago_previo_aplicacion'
                   and a.referencia like 'pago_previo:%:abono:' || p_abono_id) then
    raise exception 'FIN_ABONO_PAGO_PREVIO: el abono % viene de un pago previo aplicado desde la cotización; no se anula desde el contrato. No se cambió nada.', p_abono_id using errcode = 'F4460';
  end if;
  if exists (select 1 from public.conciliacion_sistema where ref = v_ref) then
    raise exception 'FIN_ABONO_CONCILIADO: el abono % está conciliado con el extracto bancario; deshaz el cruce en Conciliaciones antes de anularlo. No se cambió nada.', p_abono_id using errcode = 'F4461';
  end if;
  select p.codigo into v_credito
    from public.asientos_contables a
    join public.asiento_lineas l on l.asiento_id = a.id and l.haber > 0
    join public.puc_cuentas p on p.id = l.cuenta_id
   where a.tenant = v_tenant and a.origen = 'abono' and a.referencia = v_ref
   order by a.id desc, l.id limit 1;
  if v_credito = '280505' and f208_priv.factura_vigente_id(v_numero) is not null then
    raise exception 'FIN_ANTICIPO_APLICADO: la factura vigente de % ya aplicó el anticipo de este abono; quita la factura antes de anularlo. No se cambió nada.', v_numero using errcode = 'F4418';
  end if;

  -- Huella: abono + asiento(s) con sus líneas, antes de tocar nada.
  select coalesce(jsonb_agg(jsonb_build_object(
           'asiento', to_jsonb(a),
           'lineas', (select coalesce(jsonb_agg(to_jsonb(l) order by l.id), '[]'::jsonb) from public.asiento_lineas l where l.asiento_id = a.id)
         ) order by a.id), '[]'::jsonb)
    into v_huella
    from public.asientos_contables a
   where a.tenant = v_tenant and a.origen = 'abono' and a.referencia = v_ref;

  insert into public.abonos_anulados (abono_id, numero_contrato, tenant, abono, asientos, motivo, actor_id, actor_email)
  values (p_abono_id, v_numero, v_tenant, to_jsonb(b), v_huella, btrim(p_motivo), u.id, u.email);

  -- Libro: se retira el asiento completo (balanceado → el libro sigue cuadrado); las líneas caen en cascada.
  delete from public.asientos_contables where tenant = v_tenant and origen = 'abono' and referencia = v_ref;
  get diagnostics v_n = row_count;
  -- La guarda F4415 sigue activa: pasa porque ya no hay asiento que huerfanear.
  delete from public.abonos where id = p_abono_id;

  return jsonb_build_object('estado', 'anulado', 'asientos_retirados', v_n);
end $$;

revoke all on function public.anular_abono(bigint, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.anular_abono(bigint, text, text, uuid, text) to service_role;
revoke all on function public.f248_anulado_inmutable() from public, anon, authenticated;

comment on table public.abonos_anulados is '248: huella append-only de abonos anulados (fila + asiento retirado, actor y motivo). Solo la escribe anular_abono.';

-- ───────────────────────────────────────────────────────────────────────────
-- REGISTRO ATÓMICO E IDEMPOTENTE DE UN ABONO (cierra las carreras del registro)
--
-- Antes la app comprobaba «¿el contrato ya está pagado?» en una llamada, pedía la confirmación y luego insertaba
-- en otra: dos solicitudes simultáneas veían el mismo saldo y ambas se saltaban la confirmación, y una doble
-- pulsación insertaba dos abonos. `registrar_abono` decide TODO bajo el bloqueo de la venta (FOR UPDATE, el mismo
-- orden de bloqueos que facturar/anular: venta → abono):
--   1. actor/agencia revalidados; 2. idempotencia por `p_operacion`: la clave identifica los DATOS COMPLETOS del abono
--      (misma clave + mismos datos = mismo abono; datos distintos = F4466; abono ya anulado = F4468, nunca un éxito fantasma);
--   3. total a cobrar y pagado vigentes leídos con la venta bloqueada; si ya está cubierto y no viene
--      `p_confirmar`, responde `requiere_confirmacion` SIN escribir; 4. inserta el abono y su asiento en la misma
--      transacción. El excedente confirmado a propósito se sigue pudiendo registrar.
-- El asiento no bloquea el registro (igual que antes): si falla, el abono queda y se devuelve `asiento_error`. Un reintento con la
-- misma operación (`ya_registrado`) reintenta el asiento y devuelve `asiento_error` mientras siga faltando.
-- Nuevos errores: F4464 FIN_VALOR_INVALIDO · F4465 FIN_FINANCIERO_PENDIENTE · F4466 FIN_OPERACION_DISTINTA · F4468 FIN_OPERACION_ANULADA ·
-- F4467 FIN_TRM_REQUERIDA.
-- ───────────────────────────────────────────────────────────────────────────
do $$
begin
  if to_regprocedure('public.f208_abonos_marca()') is null or to_regprocedure('public.postear_asiento_abono(bigint,text,uuid)') is null then
    raise exception '248: faltan f208_abonos_marca / postear_asiento_abono (208).';
  end if;
end $$;

-- Operaciones ya procesadas (clave de idempotencia). Persisten aunque el abono se anule: reintentar una operación
-- vieja no re-crea el abono.
create table public.abono_operaciones (
  operacion_id    uuid primary key,
  numero_contrato text not null,
  tenant          text not null,
  abono_id        bigint not null,
  huella          text not null,          -- md5 de los datos completos del abono (ver registrar_abono)
  actor_id        uuid not null,
  creado_en       timestamptz not null default now()
);
alter table public.abono_operaciones enable row level security;
revoke all on public.abono_operaciones from public, anon, authenticated, service_role;
grant select, insert on public.abono_operaciones to service_role;

-- ¿Estamos dentro de `registrar_abono` de ESTE contrato? (INVOKER: necesita el current_user real.)
create function f208_priv.es_rpc_registro_abono(p_numero text)
returns boolean language sql stable security invoker set search_path = '' as $$
  select current_user = 'service_role'
     and coalesce(pg_catalog.current_setting('app.registro_abono', true), '') = coalesce(p_numero, '')
     and p_numero is not null
$$;
revoke all on function f208_priv.es_rpc_registro_abono(text) from public, anon, authenticated, service_role;
grant execute on function f208_priv.es_rpc_registro_abono(text) to authenticated, service_role;

-- La 208 marcaba como NO contabilizable todo abono insertado por service_role (importaciones, pago previo). Un abono
-- que inserta `registrar_abono` sí es contabilizable: solo cambia esa línea, solo dentro de la RPC de ese contrato.
create or replace function public.f208_abonos_marca() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.contabilizable := (current_user <> 'service_role') or f208_priv.es_rpc_registro_abono(new.numero_contrato);
    new.rev := 0;
  else
    if new.contabilizable is distinct from old.contabilizable then
      raise exception 'FIN_ABONO_NO_CONTABILIZABLE: la procedencia del abono % no se cambia.', old.id using errcode = 'F4426';
    end if;
    new.rev := old.rev + 1;
  end if;
  return new;
end $$;

create function public.registrar_abono(
  p_numero text, p_tenant text, p_actor uuid, p_monto_cop numeric, p_trm numeric,
  p_forma text, p_ref text, p_fecha date, p_confirmar boolean, p_operacion uuid)
returns jsonb language plpgsql set search_path = '' as $$
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
end $$;
revoke all on function public.registrar_abono(text, text, uuid, numeric, numeric, text, text, date, boolean, uuid) from public, anon, authenticated;
grant execute on function public.registrar_abono(text, text, uuid, numeric, numeric, text, text, date, boolean, uuid) to service_role;
comment on table public.abono_operaciones is '248: claves de idempotencia del registro de abonos. Solo la escribe registrar_abono.';
