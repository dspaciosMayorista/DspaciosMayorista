-- 205 · Comisiones B2B (#38): base explícita, valor al peso, comisión
-- descontada en el precio (modo NETO), abonos protegidos y permisos.
--
-- Numeración: 201 Vuelos, 202 CRM, 203 Tarifas y 204 Contabilidad; la 205
-- queda reservada para Comisiones. Son trabajos separados: esta migración no
-- exige aplicar 202–204 (ver "Dependencias reales" abajo).
--
-- HACIA ADELANTE, SIN TOCAR DATOS. Ninguna sentencia de este archivo hace
-- UPDATE/DELETE/INSERT sobre filas existentes: las comisiones históricas ya
-- se cuadraron a mano (ajustando el %) y se leen EXACTAMENTE igual que antes.
--
--  1. aliados_b2b.base_explicita — discriminador durable, SIN default: NULL =
--     lectura legado (base 0/NULL cae al PVP). Así una fila que inserte el
--     CÓDIGO VIEJO entre esta migración y el despliegue conserva exactamente
--     su importe. El código nuevo marca TRUE explícitamente en cada alta
--     (las dos funciones de abajo: pestaña —que cubre también el contrato
--     manual, ver punto 7— y reservar): base 0 es
--     comisión base 0; NULL sigue siendo "sin base definida" y cae al PVP.
--  2. aliados_b2b.comision_valor — "Ingresar por valor": el importe escrito se
--     guarda al peso. NULL (filas existentes) = base × %.
--  3. aliados_b2b.descontada_en_precio — la agencia ya descontó la comisión del
--     precio (reservar en modo neta). Las filas existentes quedan en false y se
--     reconocen por la regla legado: ventas.comision_estado = 'descontada' y
--     aliados_b2b.estado = 'pagada' (la firma exacta con la que reservar las
--     crea; ningún otro flujo escribe esa combinación desde la 131).
--  4. Abonos protegidos: la FK de comision_b2b_pagos pasa de ON DELETE CASCADE
--     a RESTRICT, y triggers impiden (incluso a service-role y a funciones
--     SECURITY DEFINER como eliminar_contrato) borrar una comisión con abonos,
--     cambiar el total de una comisión con abonos o descontada, y registrar
--     abonos a una comisión descontada en el precio — ni a ninguna otra fila
--     B2B de un contrato vendido NETO, ni aumentar por UPDATE un abono que ya
--     tengan (corregirlo a la baja o cambiar su fecha sí), ni crear una
--     segunda comisión B2B en él (los abonos y filas que ya existan se
--     conservan). Una comisión descontada
--     tampoco se borra suelta (API ni service-role), aunque no tenga abonos:
--     solo se va con el contrato entero (eliminar_contrato,
--     revertir_contrato_incompleto).
--  5. RLS: LEER = superadmin, gerencia, administración, operaciones y venta
--     según su acceso al tenant (puede_ver_tenant); control_vuelo NO ve
--     comisiones. INSERTAR directo sigue igual (los 4 roles de gestión
--     operativa); EDITAR = superadmin, gerencia y administración + tenant, y
--     además el asesor `venta` en SU contrato, solo los campos del cálculo
--     (base, %, valor, recobro) y solo mientras la comisión no tenga abonos;
--     BORRAR = superadmin, gerencia y administración + tenant. Abonos
--     (comision_b2b_pagos): sin cambios (131) — `venta` no los gestiona.
--  6. registrar_comision_b2b_reserva(numero, aliado): la comisión de una
--     reserva del tarifario. La convierten roles que la RLS de aliados_b2b no
--     deja escribir (`venta`), y antes el error se descartaba: el contrato
--     quedaba sin comisión. SECURITY DEFINER que valida usuario, rol, tenant,
--     aliado y venta EN CURSO (pendiente y con menos de 5 minutos: un contrato
--     histórico, o uno atascado en pendiente, no recibe comisión por aquí),
--     recalcula el importe y no duplica.
--  7. registrar_comision_b2b_manual(...): el alta desde la pestaña Comisiones
--     del contrato (decisión del dueño: el contrato manual B2B ya NO genera
--     comisión automática; nace "Por definir"). La puede usar el asesor
--     `venta` SOLO sobre su propio contrato B2B y solo si todavía no tiene
--     comisión. Luego puede corregirla (punto 5) antes de que tenga abonos;
--     no la borra ni gestiona abonos. PVP e impuesto salen de la venta; el
--     aliado, del contrato y del catálogo.
--
-- Dependencias reales: 107/116 (tenant, puede_ver_tenant), 131
-- (comision_b2b_pagos), 140 (mi_rol), 154 (puede_ver_tenant_cotizacion), 172
-- (ventas.financiero_estado). NO depende de 201–204: no toca sus objetos.
--
-- Efecto conocido: eliminar_contrato (superadmin) ya no puede borrar un
-- contrato cuya comisión B2B tiene abonos — antes los borraba en cascada sin
-- dejar rastro. Hay que deshacer esos abonos primero (queda en auditoría).
--
-- Orden: preflight → 205 → postcheck → desplegar código. Reversión: ACOTADA y
-- solo antes de que existan datos con la semántica nueva; después se niega
-- (contención + corrección hacia adelante). Todo en
-- docs/tecnico/comisiones-205-despliegue.md; scripts preflight_/postcheck_/
-- rollback_/test_205_* en supabase/scripts.

begin;

-- ── 1–3. Columnas (sin backfill) ─────────────────────────────────────────
alter table public.aliados_b2b add column if not exists base_explicita boolean;
-- Sin default a propósito (ver punto 1). Si un borrador anterior lo dejó en
-- true, se quita.
alter table public.aliados_b2b alter column base_explicita drop default;

alter table public.aliados_b2b add column if not exists comision_valor numeric(15,2);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'aliados_b2b_comision_valor_no_negativa') then
    alter table public.aliados_b2b
      add constraint aliados_b2b_comision_valor_no_negativa check (comision_valor is null or comision_valor >= 0);
  end if;
end $$;

alter table public.aliados_b2b add column if not exists descontada_en_precio boolean not null default false;

comment on column public.aliados_b2b.base_explicita is
  'NULL = fila anterior a la 205 (base 0/NULL cae al PVP). TRUE = base_comision manda (0 vale 0; NULL = sin base definida, cae al PVP).';
comment on column public.aliados_b2b.comision_valor is
  'Comisión base escrita en pesos ("Ingresar por valor"). Si no es NULL manda sobre base × pct_comision; pct_comision queda solo informativo.';
comment on column public.aliados_b2b.descontada_en_precio is
  'TRUE = la agencia ya descontó esta comisión del precio (reservar en modo neta). No es un saldo por pagar ni admite abonos.';

-- ── Total de una comisión: espejo EXACTO de calcComisionB2B (lib/calc/finanzas.ts)
create or replace function public.comision_b2b_total(a public.aliados_b2b)
returns numeric
language sql
immutable
set search_path = public, pg_temp
as $$
  with x as (
    select
      coalesce(a.precio_venta, 0) as pvp,
      case when a.base_explicita
           then coalesce(a.base_comision, coalesce(a.precio_venta, 0))
           else coalesce(nullif(a.base_comision, 0), coalesce(a.precio_venta, 0)) end as base
  )
  select (coalesce(a.comision_valor, x.base * coalesce(a.pct_comision, 0))
          + coalesce(a.recobro_total, 0) * coalesce(a.pct_recobro_aliado, 0.5))
         * (1 - case when a.aplica_retencion then coalesce(a.pct_retencion, 0) else 0 end)
  from x
$$;

-- Descontada en el precio: marca nueva o firma legado de reservar en neta.
create or replace function public.comision_b2b_descontada(a public.aliados_b2b)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select a.descontada_en_precio
      or (a.estado = 'pagada' and exists (
            select 1 from public.ventas v
             where v.numero_contrato = a.numero_contrato
               and v.comision_estado = 'descontada'))
$$;

revoke all on function public.comision_b2b_total(public.aliados_b2b) from public, anon;
revoke all on function public.comision_b2b_descontada(public.aliados_b2b) from public, anon;
grant execute on function public.comision_b2b_total(public.aliados_b2b) to authenticated, service_role;
grant execute on function public.comision_b2b_descontada(public.aliados_b2b) to authenticated, service_role;

-- ── 4a. FK de abonos: CASCADE → RESTRICT ────────────────────────────────
do $$
declare v_fk text;
begin
  select conname into v_fk
    from pg_constraint
   where conrelid = 'public.comision_b2b_pagos'::regclass
     and contype = 'f'
     and confrelid = 'public.aliados_b2b'::regclass;
  if v_fk is not null then
    execute format('alter table public.comision_b2b_pagos drop constraint %I', v_fk);
  end if;
  alter table public.comision_b2b_pagos
    add constraint comision_b2b_pagos_aliado_b2b_id_fkey
    foreign key (aliado_b2b_id) references public.aliados_b2b(id) on delete restrict;
end $$;

-- ── 4b. Guardas sobre aliados_b2b ────────────────────────────────────────
-- SECURITY DEFINER: deben ver TODOS los abonos aunque quien edita no los lea
-- por RLS (p. ej. operaciones no lee comision_b2b_pagos).
create or replace function public.tg_aliados_b2b_proteger_abonos()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_con_abonos boolean;
begin
  -- La fila ya está bloqueada por el UPDATE/DELETE en curso; una inserción
  -- concurrente de abono la bloquea también (tg_comision_b2b_pagos_guardas),
  -- así que esta lectura ve el abono comprometido antes de decidir.
  v_con_abonos := exists (select 1 from public.comision_b2b_pagos p where p.aliado_b2b_id = old.id);

  if tg_op = 'DELETE' then
    if v_con_abonos then
      raise exception 'La comisión B2B % del contrato % tiene abonos registrados: deshaz los abonos antes de eliminarla.',
        old.id, old.numero_contrato
        using errcode = 'P0001';
    end if;
    return old;
  end if;

  -- UPDATE
  -- Asesor `venta` (#38): la policy "edicion asesor" ya exige que sea SU
  -- contrato y su tenant. Aquí: solo antes de abonos, nunca una NETO
  -- descontada, y solo los campos del cálculo (base, %, valor, recobro).
  if public.mi_rol() = 'venta' then
    if v_con_abonos then
      raise exception 'La comisión B2B % ya tiene abonos: solo administración puede cambiarla.', old.id
        using errcode = '42501';
    end if;
    if public.comision_b2b_descontada(old) then
      raise exception 'La comisión B2B % se descontó del precio de venta: no se edita.', old.id
        using errcode = '42501';
    end if;
    if (new.id, new.numero_contrato, new.tenant, new.aliado, new.nit, new.tipo_aliado, new.aliado_id, new.contacto,
        new.precio_venta, new.aplica_retencion, new.pct_retencion, new.estado, new.fecha_pago, new.created_at,
        new.descontada_en_precio)
       is distinct from
       (old.id, old.numero_contrato, old.tenant, old.aliado, old.nit, old.tipo_aliado, old.aliado_id, old.contacto,
        old.precio_venta, old.aplica_retencion, old.pct_retencion, old.estado, old.fecha_pago, old.created_at,
        old.descontada_en_precio) then
      raise exception 'El asesor solo puede corregir la base, el porcentaje, el valor y el recobro de su comisión.'
        using errcode = '42501';
    end if;
  end if;

  if new.descontada_en_precio is distinct from old.descontada_en_precio then
    raise exception 'No se puede cambiar si la comisión B2B % fue descontada en el precio.', old.id
      using errcode = 'P0001';
  end if;

  if v_con_abonos or public.comision_b2b_descontada(old) then
    if new.estado is distinct from old.estado then
      raise exception 'La comisión B2B % ya está abonada o descontada: su estado no se edita.', old.id
        using errcode = 'P0001';
    end if;
    if round(public.comision_b2b_total(new), 2) <> round(public.comision_b2b_total(old), 2) then
      raise exception 'La comisión B2B % ya tiene abonos o se descontó del precio: el cambio alteraría su total (% → %).',
        old.id, round(public.comision_b2b_total(old), 2), round(public.comision_b2b_total(new), 2)
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_aliados_b2b_proteger_abonos on public.aliados_b2b;
create trigger trg_aliados_b2b_proteger_abonos
  before update or delete on public.aliados_b2b
  for each row execute function public.tg_aliados_b2b_proteger_abonos();

-- ── 4c. Guardas sobre comision_b2b_pagos ─────────────────────────────────
create or replace function public.tg_comision_b2b_pagos_guardas()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v public.aliados_b2b;
begin
  -- UPDATE (la policy de la 131 es FOR ALL para gestión y `authenticated`
  -- tiene UPDATE): si deja el abono en la MISMA comisión y no aumenta su
  -- valor —corrección a la baja, o de fecha u otro dato— no paga nada nuevo
  -- y se permite siempre, también en una comisión bloqueada. Aumentarlo o
  -- moverlo a otra comisión equivale a un abono nuevo: mismas reglas.
  if tg_op = 'UPDATE'
     and new.aliado_b2b_id is not distinct from old.aliado_b2b_id
     and coalesce(new.valor, 0) <= coalesce(old.valor, 0) then
    return new;
  end if;
  -- Bloquea la comisión: serializa este abono contra una edición o un
  -- borrado concurrentes de la misma comisión.
  select * into v from public.aliados_b2b where id = new.aliado_b2b_id for update;
  if not found then
    return new; -- la FK rechaza la fila con su propio error
  end if;
  if public.comision_b2b_descontada(v) then
    raise exception 'La comisión B2B % se descontó del precio de venta (modo neta): no admite abonos ni aumentos de abonos.', v.id
      using errcode = 'P0001';
  end if;
  -- Contrato vendido NETO (decisión del dueño, 2026-10-09): la comisión B2B
  -- del aliado ya se descontó del precio; ninguna otra fila B2B de ese
  -- contrato admite abonos NUEVOS ni aumentos de los existentes. Los abonos
  -- que ya existan se conservan tal cual (revisión manual). La comisión del
  -- asesor interno no vive en esta tabla y no se ve afectada.
  if exists (select 1 from public.ventas vt
              where vt.numero_contrato = v.numero_contrato and vt.comision_estado = 'descontada') then
    raise exception 'La comisión B2B % es de un contrato vendido en modo neta: la comisión B2B ya se descontó del precio y no admite abonos ni aumentos de abonos.', v.id
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- En TODO update (no solo de aliado_b2b_id): un aumento de `valor` es un pago.
drop trigger if exists trg_comision_b2b_pagos_guardas on public.comision_b2b_pagos;
create trigger trg_comision_b2b_pagos_guardas
  before insert or update on public.comision_b2b_pagos
  for each row execute function public.tg_comision_b2b_pagos_guardas();

-- ── 4d. Una NETO descontada no se borra suelta ───────────────────────────
-- Aunque no tenga abonos: el precio guardado (ventas.precio_venta = PVP −
-- comisión) sigue neto de ella, y borrarla sola la sacaría de Comisiones y
-- de Rentabilidad. Solo se va con el contrato ENTERO: eliminar_contrato (166)
-- y revertir_contrato_incompleto (172), funciones SECURITY DEFINER que corren
-- como su dueño. Por eso esta función es SECURITY INVOKER y decide por
-- current_user: una sesión de la API (authenticated/anon) o service_role
-- borrando directo → se niega; dentro de esas funciones → se permite.
create or replace function public.tg_aliados_b2b_neto_no_borrar()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if current_user::text in ('authenticated', 'anon', 'service_role')
     and public.comision_b2b_descontada(old) then
    raise exception 'La comisión B2B % se descontó del precio de venta (modo neta): no se borra suelta; se elimina con el contrato.', old.id
      using errcode = 'P0001';
  end if;
  return old;
end;
$$;

drop trigger if exists trg_aliados_b2b_neto_no_borrar on public.aliados_b2b;
create trigger trg_aliados_b2b_neto_no_borrar
  before delete on public.aliados_b2b
  for each row execute function public.tg_aliados_b2b_neto_no_borrar();

-- ── 4e. Contrato NETO: no se crea una segunda comisión B2B ─────────────
-- La única fila B2B que admite un contrato vendido en modo neta es la
-- descontada: la marca nueva (registrar_comision_b2b_reserva) o la firma
-- legado (estado 'pagada'), que es como la sigue creando el código viejo de
-- reservar mientras se despliega — comision_b2b_descontada() reconoce ambas.
-- registrar_comision_b2b_manual ya rechaza el resto; esto cierra la inserción
-- directa (API con RLS de alta, o service-role). Solo hacia adelante: las
-- filas que ya existan no se tocan.
create or replace function public.tg_aliados_b2b_neto_sin_segunda()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.comision_b2b_descontada(new)
     and exists (select 1 from public.ventas vt
                  where vt.numero_contrato = new.numero_contrato and vt.comision_estado = 'descontada') then
    raise exception 'El contrato % se vendió en modo neta: la comisión B2B ya se descontó del precio; no corresponde otra comisión B2B.', new.numero_contrato
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_aliados_b2b_neto_sin_segunda on public.aliados_b2b;
create trigger trg_aliados_b2b_neto_sin_segunda
  before insert or update of numero_contrato on public.aliados_b2b
  for each row execute function public.tg_aliados_b2b_neto_sin_segunda();

revoke all on function public.tg_aliados_b2b_proteger_abonos() from public, anon, authenticated;
revoke all on function public.tg_aliados_b2b_neto_sin_segunda() from public, anon, authenticated;
revoke all on function public.tg_comision_b2b_pagos_guardas() from public, anon, authenticated;
revoke all on function public.tg_aliados_b2b_neto_no_borrar() from public, anon, authenticated;

-- ── 6. Comisión de una reserva del tarifario ─────────────────────────────
create or replace function public.registrar_comision_b2b_reserva(p_numero text, p_aliado_id bigint)
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
  v_id     bigint;
begin
  -- Usuario y rol: quienes convierten una cotización en contrato (RLS de
  -- cotizaciones, 154) y el propio aliado. mi_rol() es NULL sin sesión o con
  -- el usuario inactivo (140).
  if v_rol is null or v_rol not in ('superadmin','gerencia','administracion','operaciones','venta','agencia','freelance') then
    raise exception 'No autorizado para registrar la comisión de la reserva.' using errcode = '42501';
  end if;

  -- Venta: bloqueada para serializar llamadas concurrentes del mismo contrato.
  select * into v from public.ventas where numero_contrato = p_numero for update;
  if not found then
    raise exception 'El contrato % no existe.', p_numero using errcode = 'P0001';
  end if;
  -- Tenant: mismo criterio que convertir la cotización (solo superadmin cruza).
  if not public.puede_ver_tenant_cotizacion(v.tenant) then
    raise exception 'No autorizado para el contrato %.', p_numero using errcode = '42501';
  end if;
  -- Solo una reserva EN CURSO (nace con financiero_estado = pendiente, 172):
  -- esta función no sirve para meterle comisiones a contratos viejos. Un
  -- contrato histórico quedó 'completo' (default de la 172); uno que se quedó
  -- atascado en 'pendiente' tampoco cuenta: pasados 5 minutos de
  -- financiero_actualizado_en (nace con now()), la reconciliación de la 172
  -- ya lo trata como abandonado. Misma frontera aquí.
  if v.financiero_estado is distinct from 'pendiente'
     or v.financiero_actualizado_en < now() - interval '5 minutes' then
    raise exception 'La comisión de reserva solo se registra mientras se crea el contrato %.', p_numero using errcode = 'P0001';
  end if;
  if v.tipo_asesor not in ('agencia','freelance') then
    raise exception 'El contrato % no es una venta B2B.', p_numero using errcode = 'P0001';
  end if;
  if v.aliado_id is distinct from p_aliado_id then
    raise exception 'El aliado no coincide con el de la venta %.', p_numero using errcode = 'P0001';
  end if;

  -- Aliado.
  select * into a from public.aliados where id = p_aliado_id;
  if not found then
    raise exception 'El aliado % no existe.', p_aliado_id using errcode = 'P0001';
  end if;
  if a.tipo is not null and a.tipo <> v.tipo_asesor then
    raise exception 'El aliado es de tipo %, la venta es %.', a.tipo, v.tipo_asesor using errcode = 'P0001';
  end if;
  if v_rol in ('agencia','freelance')
     and (select u.aliado_id from public.usuarios u where u.id = auth.uid()) is distinct from p_aliado_id then
    raise exception 'Un aliado solo registra su propia comisión.' using errcode = '42501';
  end if;

  -- Sin duplicados.
  if exists (select 1 from public.aliados_b2b b where b.numero_contrato = p_numero) then
    raise exception 'El contrato % ya tiene comisión B2B.', p_numero using errcode = '23505';
  end if;

  -- Importe recalculado (espejo de planComisionReserva / pctComisionAliado):
  -- % del aliado, si no el parámetro general de su tipo, si no 12 %/11 %.
  select pt.valor into v_param from public.parametros_tributarios pt
   where pt.parametro = case when v.tipo_asesor = 'agencia' then 'COMISION_AGENCIA' else 'COMISION_FREELANCE' end;
  v_pct := coalesce(a.pct_comision, v_param, case when v.tipo_asesor = 'agencia' then 0.12 else 0.11 end);
  -- En neta, ventas.precio_venta ya es PVP − comisión.
  v_bruto := coalesce(v.precio_venta, 0) + case when v.modo_compra = 'neta' then coalesce(v.comision_b2b, 0) else 0 end;
  v_base  := greatest(0, v_bruto - coalesce(v.impuesto, 0));
  if v.modo_compra in ('neta','comisionable')
     and abs(round(v_base * v_pct) - coalesce(v.comision_b2b, -1000000)) > 1 then
    raise exception 'La comisión de la venta % (%) no coincide con la calculada (%).',
      p_numero, v.comision_b2b, round(v_base * v_pct) using errcode = 'P0001';
  end if;

  insert into public.aliados_b2b (
    numero_contrato, tenant, aliado, nit, tipo_aliado, aliado_id,
    precio_venta, base_comision, base_explicita, pct_comision,
    recobro_total, pct_recobro_aliado, aplica_retencion, pct_retencion,
    estado, descontada_en_precio
  ) values (
    v.numero_contrato, v.tenant, a.nombre, a.nit, v.tipo_asesor, a.id,
    v_bruto, v_base, true, v_pct,
    0, 0, coalesce(a.aplica_retencion, false), coalesce(a.pct_retencion, 0),
    case when v.modo_compra = 'neta' then 'pagada' else 'pendiente' end,
    v.modo_compra = 'neta'
  ) returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.registrar_comision_b2b_reserva(text, bigint) from public, anon;
grant execute on function public.registrar_comision_b2b_reserva(text, bigint) to authenticated;

-- ── 7. Comisión registrada a mano desde la pestaña del contrato ──────────
create or replace function public.registrar_comision_b2b_manual(
  p_numero             text,
  p_aliado             text,
  p_nit                text,
  p_tipo_aliado        text,
  p_aliado_id          bigint,
  p_pct                numeric,
  p_recobro            numeric,
  p_pct_recobro        numeric,
  p_aplica_retencion   boolean,
  p_pct_retencion      numeric
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol      text := public.mi_rol()::text;
  v          public.ventas;
  a          public.aliados;
  v_nombre   text;
  v_nit      text;
  v_tipo     text;
  v_ret      boolean;
  v_pct_ret  numeric;
  v_id       bigint;
begin
  -- Usuario y rol (mi_rol() es NULL sin sesión o con el usuario inactivo).
  -- control_vuelo y los externos no registran comisiones.
  if v_rol is null or v_rol not in ('superadmin','gerencia','administracion','operaciones','venta') then
    raise exception 'No autorizado para registrar comisiones B2B.' using errcode = '42501';
  end if;

  -- Contrato y tenant (bloqueado: serializa altas concurrentes del mismo contrato).
  select * into v from public.ventas where numero_contrato = p_numero for update;
  if not found then
    raise exception 'El contrato % no existe.', p_numero using errcode = 'P0001';
  end if;
  if not public.puede_ver_tenant(v.tenant) then
    raise exception 'No autorizado para el contrato %.', p_numero using errcode = '42501';
  end if;
  -- NETO: la comisión ya se descontó del precio; registrarla la pagaría dos veces.
  if v.comision_estado = 'descontada' then
    raise exception 'El contrato % se vendió en modo neta: la comisión ya se descontó del precio.', p_numero using errcode = 'P0001';
  end if;

  -- Importes (el % 0 es legítimo; NULL no).
  if p_pct is null or p_pct < 0 or p_pct > 1
     or coalesce(p_recobro, 0) < 0
     or coalesce(p_pct_recobro, 0) < 0 or coalesce(p_pct_recobro, 0) > 1
     or (p_aplica_retencion and (p_pct_retencion is null or p_pct_retencion < 0 or p_pct_retencion > 1)) then
    raise exception 'Valores de comisión inválidos.' using errcode = '22023';
  end if;

  v_nombre := nullif(btrim(coalesce(p_aliado, '')), '');
  v_nit := nullif(btrim(coalesce(p_nit, '')), '');
  v_tipo := nullif(btrim(coalesce(p_tipo_aliado, '')), '');
  v_ret := coalesce(p_aplica_retencion, false);
  v_pct_ret := case when v_ret then p_pct_retencion else 0 end;

  if v_rol = 'venta' then
    -- Solo SU contrato (misma regla que usan las policies del contrato).
    if not public.soy_asesor_del_contrato(p_numero) then
      raise exception 'Solo puedes registrar la comisión de tus propios contratos.' using errcode = '42501';
    end if;
    if v.tipo_asesor not in ('agencia','freelance') or v.aliado_id is null then
      raise exception 'El contrato % no es una venta B2B con aliado del catálogo.', p_numero using errcode = 'P0001';
    end if;
    if p_aliado_id is distinct from v.aliado_id then
      raise exception 'La comisión debe ser del aliado del contrato.' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.aliados_b2b b where b.numero_contrato = p_numero) then
      raise exception 'El contrato % ya tiene comisión registrada; cualquier cambio lo hace administración.', p_numero using errcode = '23505';
    end if;
    -- Identidad y retención del aliado salen del catálogo, no del formulario.
    select * into a from public.aliados where id = v.aliado_id;
    if not found then
      raise exception 'El aliado del contrato no existe en el catálogo.' using errcode = 'P0001';
    end if;
    v_nombre := a.nombre;
    v_nit := a.nit;
    v_tipo := v.tipo_asesor;
    v_ret := coalesce(a.aplica_retencion, false);
    v_pct_ret := case when v_ret then coalesce(a.pct_retencion, 0) else 0 end;
  elsif p_aliado_id is not null then
    select * into a from public.aliados where id = p_aliado_id;
    if not found then
      raise exception 'El aliado % no existe.', p_aliado_id using errcode = 'P0001';
    end if;
    -- Enlazada al catálogo, el tipo es el del catálogo, no el del formulario:
    -- decide si hay cuenta de cobro (solo freelance; la agencia factura).
    v_tipo := coalesce(a.tipo, v_tipo);
  end if;

  if v_nombre is null then
    raise exception 'Indica el aliado de la comisión.' using errcode = '22023';
  end if;

  insert into public.aliados_b2b (
    numero_contrato, tenant, aliado, nit, tipo_aliado, aliado_id,
    precio_venta, base_comision, base_explicita, pct_comision,
    recobro_total, pct_recobro_aliado, aplica_retencion, pct_retencion, estado
  ) values (
    v.numero_contrato, v.tenant, v_nombre, v_nit, v_tipo, p_aliado_id,
    coalesce(v.precio_venta, 0), greatest(0, coalesce(v.precio_venta, 0) - coalesce(v.impuesto, 0)), true, p_pct,
    coalesce(p_recobro, 0), coalesce(p_pct_recobro, 0), v_ret, v_pct_ret, 'pendiente'
  ) returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.registrar_comision_b2b_manual(text, text, text, text, bigint, numeric, numeric, numeric, boolean, numeric) from public, anon;
grant execute on function public.registrar_comision_b2b_manual(text, text, text, text, bigint, numeric, numeric, numeric, boolean, numeric) to authenticated;

-- ── 5. RLS: separar lectura/alta de edición/borrado ─────────────────────
drop policy if exists "aliados_b2b: acceso contable" on public.aliados_b2b;
drop policy if exists "aliados_b2b: lectura contable" on public.aliados_b2b;
drop policy if exists "aliados_b2b: alta contable" on public.aliados_b2b;
drop policy if exists "aliados_b2b: edicion contable" on public.aliados_b2b;
drop policy if exists "aliados_b2b: edicion asesor" on public.aliados_b2b;
drop policy if exists "aliados_b2b: borrado contable" on public.aliados_b2b;

-- Lectura: también `venta` (decisión del dueño), según su tenant. control_vuelo no.
create policy "aliados_b2b: lectura contable" on public.aliados_b2b for select
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
         and public.puede_ver_tenant(tenant));

create policy "aliados_b2b: alta contable" on public.aliados_b2b for insert
  with check (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones')
              and public.puede_ver_tenant(tenant));

create policy "aliados_b2b: edicion contable" on public.aliados_b2b for update
  using (public.mi_rol() in ('superadmin','gerencia','administracion')
         and public.puede_ver_tenant(tenant))
  with check (public.mi_rol() in ('superadmin','gerencia','administracion')
              and public.puede_ver_tenant(tenant));

-- El asesor `venta` corrige la comisión de SU contrato (qué campos y cuándo:
-- trigger trg_aliados_b2b_proteger_abonos). Nunca la de un colega.
create policy "aliados_b2b: edicion asesor" on public.aliados_b2b for update
  using (public.mi_rol() = 'venta'
         and public.puede_ver_tenant(tenant)
         and public.soy_asesor_del_contrato(numero_contrato))
  with check (public.mi_rol() = 'venta'
              and public.puede_ver_tenant(tenant)
              and public.soy_asesor_del_contrato(numero_contrato));

create policy "aliados_b2b: borrado contable" on public.aliados_b2b for delete
  using (public.mi_rol() in ('superadmin','gerencia','administracion')
         and public.puede_ver_tenant(tenant));

commit;
