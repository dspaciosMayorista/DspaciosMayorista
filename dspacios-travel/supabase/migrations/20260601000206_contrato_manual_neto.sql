-- ═════════════════════════════════════════════════════════════════════════
-- 206 · #30 — contrato MANUAL B2B en NETO.
--
-- Número asignado por el Coordinador (WORKSTREAMS.md, 2026-10-12): 204 =
-- Contabilidad (staging DIAN), 205 = #38 (comisiones B2B), 206 = #30 B. Nació
-- como borrador sin número (supabase/borradores/30_contrato_manual_neto.sql);
-- el contenido SQL no cambió al numerarlo. No edita la 205.
--
-- Scripts: supabase/scripts/preflight_206_contrato_manual_neto.sql (antes),
-- postcheck_206_contrato_manual_neto.sql (después) y
-- rollback_206_contrato_manual_neto.sql. Pruebas SOLO en base local
-- desechable: test_206_contrato_manual_neto.sql, test_206_carrera.sh,
-- test_206_secuencia.sh y test_206_app_rpc.sh (app → PostgREST → RPC).
--
-- Orden de despliegue: preflight → 206 → postcheck → código de la app que
-- llama aplicar_neto_contrato_manual. Al revés, un contrato manual NETO fallaría
-- y se revertiría entero (nunca queda NETO sin su comisión).
--
-- Depende de: 107 (puede_ver_tenant), 140 (mi_rol: NULL si inactivo), 142
-- (soy_asesor_del_contrato), 205 (aliados_b2b.base_explicita /
-- descontada_en_precio y sus triggers de NETO). No toca ningún objeto de la
-- 205 ni de otra migración: solo agrega una función y un trigger.
--
-- Decisión del dueño (2026-10-10): el comprador B2B de un contrato manual elige
-- PVP (comisión "Por definir", como dejó #38) o NETO (paga PVP − su comisión,
-- ya descontada). Solo contratos NUEVOS; la modalidad no cambia después de
-- emitir; no se recalcula ningún histórico.
--
-- ── 1. Cómo se evita un NETO cobrable sin comisión ─────────────────────────
-- El contrato manual SIEMPRE nace como hoy: PVP, comisión "Por definir"
-- (modo_compra/comision_* en NULL). Como ÚLTIMO paso obligatorio de la
-- creación, la app llama `aplicar_neto_contrato_manual`, que en UNA transacción:
--   · rebaja ventas.precio_venta a PVP − comisión y marca modo_compra='neta',
--     comision_b2b, comision_estado='descontada';
--   · inserta la fila de aliados_b2b descontada (PVP bruto, base, %,
--     descontada_en_precio = true) — la evidencia que la 205 ya protege.
-- Las dos cosas se confirman juntas o ninguna. Si la llamada falla, la app
-- revierte el contrato entero (revertir_contrato_incompleto); si la reversión
-- también falla o el proceso se interrumpe antes, el contrato queda en el
-- estado seguro de #38 (PVP con comisión "Por definir"), nunca como NETO sin
-- su comisión. No hay conversión automática posterior.
--
-- ── 2. La modalidad no cambia después de emitir ────────────────────────────
-- Trigger BEFORE UPDATE en ventas, para los roles con los que entra la API
-- (authenticated, anon, service_role):
--   · modo_compra / comision_estado / comision_b2b no se cambian por UPDATE
--     directo (hoy ningún código lo hace: la reserva las escribe en el INSERT,
--     que este trigger no toca);
--   · en un contrato NETO (comision_estado = 'descontada') tampoco
--     precio_venta, impuesto, tipo_asesor ni aliado_id: moverlos descuadra el
--     total exigible de la comisión ya descontada.
-- Dentro de la función SECURITY DEFINER current_user es su dueño, así que su
-- propio UPDATE pasa; una corrección manual de un NETO la hace solo el dueño de
-- la base desde el editor SQL (mismo criterio por current_user que la 205).
-- ═════════════════════════════════════════════════════════════════════════

-- ── 1. RPC: aplicar NETO a un contrato manual recién creado ───────────────
create or replace function public.aplicar_neto_contrato_manual(
  p_numero            text,
  p_aliado_id         bigint,
  p_comision_esperada numeric
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol    text := public.mi_rol()::text;
  v        public.ventas;
  a        public.aliados;
  v_param  numeric;
  v_pct    numeric;
  v_bruto  numeric;
  v_base   numeric;
  v_com    numeric;
  v_id     bigint;
begin
  -- Usuario y rol: los internos que crean contratos manuales. mi_rol() es NULL
  -- sin sesión o con el usuario inactivo (140). Externos y control_vuelo, no.
  if v_rol is null or v_rol not in ('superadmin','gerencia','administracion','operaciones','venta') then
    raise exception 'No autorizado para registrar un contrato NETO.' using errcode = '42501';
  end if;

  -- Contrato bloqueado: serializa llamadas concurrentes del mismo número.
  select * into v from public.ventas where numero_contrato = p_numero for update;
  if not found then
    raise exception 'El contrato % no existe.', p_numero using errcode = 'P0001';
  end if;
  if not public.puede_ver_tenant(v.tenant) then
    raise exception 'No autorizado para el contrato %.', p_numero using errcode = '42501';
  end if;
  -- El asesor `venta` solo en su propio contrato (misma regla que las policies).
  if v_rol = 'venta' and not public.soy_asesor_del_contrato(p_numero) then
    raise exception 'Solo puedes registrar en NETO tus propios contratos.' using errcode = '42501';
  end if;

  -- Solo mientras se crea: nunca convierte un contrato existente o histórico.
  if v.created_at is null or v.created_at < now() - interval '5 minutes' then
    raise exception 'La modalidad NETO solo se registra al crear el contrato %.', p_numero using errcode = 'P0001';
  end if;
  if v.tipo_asesor is null or v.tipo_asesor not in ('agencia','freelance') then
    raise exception 'El contrato % no es una venta B2B.', p_numero using errcode = 'P0001';
  end if;
  if p_aliado_id is null or v.aliado_id is distinct from p_aliado_id then
    raise exception 'El aliado no coincide con el de la venta %.', p_numero using errcode = 'P0001';
  end if;
  if v.modo_compra is not null or v.comision_estado is not null or v.comision_b2b is not null then
    raise exception 'El contrato % ya tiene modalidad de compra.', p_numero using errcode = 'P0001';
  end if;
  if exists (select 1 from public.aliados_b2b b where b.numero_contrato = p_numero) then
    raise exception 'El contrato % ya tiene comisión B2B.', p_numero using errcode = '23505';
  end if;
  if exists (select 1 from public.abonos ab where ab.numero_contrato = p_numero) then
    raise exception 'El contrato % ya tiene abonos.', p_numero using errcode = 'P0001';
  end if;

  select * into a from public.aliados where id = p_aliado_id;
  if not found then
    raise exception 'El aliado % no existe.', p_aliado_id using errcode = 'P0001';
  end if;
  if a.tipo is not null and a.tipo <> v.tipo_asesor then
    raise exception 'El aliado es de tipo %, la venta es %.', a.tipo, v.tipo_asesor using errcode = 'P0001';
  end if;

  -- Importe: mismo cálculo que registrar_comision_b2b_reserva (205) y
  -- planComisionReserva — % del aliado, si no el parámetro de su tipo, si no
  -- 12 %/11 %; base = PVP − impuesto, nunca negativa.
  select pt.valor into v_param from public.parametros_tributarios pt
   where pt.parametro = case when v.tipo_asesor = 'agencia' then 'COMISION_AGENCIA' else 'COMISION_FREELANCE' end;
  v_pct   := coalesce(a.pct_comision, v_param, case when v.tipo_asesor = 'agencia' then 0.12 else 0.11 end);
  v_bruto := coalesce(v.precio_venta, 0);
  v_base  := greatest(0, v_bruto - coalesce(v.impuesto, 0));
  v_com   := round(v_base * v_pct);
  if v_bruto <= 0 then
    raise exception 'El contrato % no tiene precio de venta.', p_numero using errcode = 'P0001';
  end if;
  -- Lo que el asesor vio en pantalla tiene que ser lo que se descuenta.
  if p_comision_esperada is null or abs(v_com - p_comision_esperada) > 1 then
    raise exception 'La comisión del contrato % (%) no coincide con la calculada (%).',
      p_numero, p_comision_esperada, v_com using errcode = 'P0001';
  end if;

  update public.ventas
     set precio_venta    = v_bruto - v_com,
         modo_compra     = 'neta',
         comision_b2b    = v_com,
         comision_estado = 'descontada',
         updated_at      = now()
   where numero_contrato = p_numero;

  insert into public.aliados_b2b (
    numero_contrato, tenant, aliado, nit, tipo_aliado, aliado_id,
    precio_venta, base_comision, base_explicita, pct_comision,
    recobro_total, pct_recobro_aliado, aplica_retencion, pct_retencion,
    estado, descontada_en_precio
  ) values (
    v.numero_contrato, v.tenant, a.nombre, a.nit, v.tipo_asesor, a.id,
    v_bruto, v_base, true, v_pct,
    0, 0, coalesce(a.aplica_retencion, false), coalesce(a.pct_retencion, 0),
    'pagada', true
  ) returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.aplicar_neto_contrato_manual(text, bigint, numeric) from public, anon;
grant execute on function public.aplicar_neto_contrato_manual(text, bigint, numeric) to authenticated;

comment on function public.aplicar_neto_contrato_manual(text, bigint, numeric) is
  '#30: aplica la modalidad NETO a un contrato manual B2B recién creado (precio = PVP − comisión + fila aliados_b2b descontada) en una sola transacción.';

-- ── 2. La modalidad y los importes de un NETO no cambian por UPDATE ───────
create or replace function public.tg_ventas_modalidad_b2b_inmutable()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  -- Solo los roles con los que entra la API. Las funciones SECURITY DEFINER
  -- (current_user = su dueño) y el dueño de la base no pasan por aquí.
  if current_user not in ('authenticated', 'anon', 'service_role') then
    return new;
  end if;
  if (new.modo_compra, new.comision_estado, new.comision_b2b)
     is distinct from (old.modo_compra, old.comision_estado, old.comision_b2b) then
    raise exception 'La modalidad de compra B2B del contrato % no se cambia después de emitido.', old.numero_contrato
      using errcode = '42501';
  end if;
  if old.comision_estado = 'descontada'
     and (new.precio_venta, new.impuesto, new.tipo_asesor, new.aliado_id)
         is distinct from (old.precio_venta, old.impuesto, old.tipo_asesor, old.aliado_id) then
    raise exception 'Contrato % vendido en NETO: precio, impuesto, tipo de venta y aliado no se cambian después de emitido.', old.numero_contrato
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.tg_ventas_modalidad_b2b_inmutable() from public, anon, authenticated;

drop trigger if exists trg_ventas_modalidad_b2b_inmutable on public.ventas;
create trigger trg_ventas_modalidad_b2b_inmutable
  before update on public.ventas
  for each row execute function public.tg_ventas_modalidad_b2b_inmutable();
