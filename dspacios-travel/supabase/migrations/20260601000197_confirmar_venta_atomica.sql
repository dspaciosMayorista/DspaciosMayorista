-- ───────────────────────────────────────────────────────────────────────────
-- Migración 197 · confirmar una venta y sus sillas en UNA transacción (W7).
-- Tareas 2 y 3, diseño §6.8.
--
-- POR QUÉ: `confirmarVenta` y `recalcularEstadoAbono` hacían dos peticiones
-- separadas (UPDATE de la venta con la sesión, UPDATE de las sillas con
-- service-role) y, si la segunda fallaba, intentaban "compensar" con una
-- tercera cuyo resultado se ignoraba: no había atomicidad, solo una
-- reparación optimista. Ahora es una sola llamada.
--
-- AUTORIZACIÓN (sin cambio de quién puede confirmar):
--   · `confirmar_venta(p_numero)` es SECURITY INVOKER: lee y actualiza `ventas`
--     con la RLS de quien llama, exactamente como antes lo hacía el cliente de
--     sesión (policies "ventas: actualizar operaciones" y "ventas: venta
--     actualiza sus contratos"). Si la RLS no le deja ver o actualizar la
--     venta, falla y no cambia nada.
--   · Las sillas las actualiza `_confirmar_sillas_de_venta` (SECURITY DEFINER,
--     porque desde la fase C la sesión no escribe el vínculo/estado de una
--     silla). Como es DEFINER, NO confía en quien la llama: authenticated
--     necesita EXECUTE (confirmar_venta es INVOKER y la llama con los
--     privilegios de la sesión), así que también se puede invocar DIRECTO por
--     la API. Antes de leer ninguna venta exige:
--       1. sesión (auth.uid());
--       2. usuario activo (mi_rol() es nulo si está inactivo — 140) con uno de
--          los roles de las policies de UPDATE de ventas;
--       3. el TESTIGO de esta transacción que solo fija confirmar_venta
--          (`app.confirmar_venta_token` = '<numero>|<auth.uid()>'), DESPUÉS de
--          haber leído la venta con FOR UPDATE (aplica las policies de
--          UPDATE) y, si estaba pendiente, de actualizarla, todo con la RLS de
--          quien llama. Una llamada directa por la API corre en su propia
--          transacción y no puede fijarlo: PostgREST no deja fijar parámetros
--          `app.*` y ninguna función expuesta usa set_config.
--     Y luego, ya con la venta bloqueada: misma agencia según
--     `puede_ver_tenant(tenant)` (el criterio de agencia de todas las policies
--     de ventas: no es más estricto que la RLS) y estado `confirmado`.
--     Cualquier fallo lanza 42501 con el mismo mensaje y sin tocar nada: no
--     revela si el contrato existe ni en qué estado está.
--   · La guarda financiera (172) pasa a la función: no se confirma con
--     `financiero_estado = 'pendiente'`.
--
-- CAMBIO DE ALCANCE (informado): solo se confirma una venta `pendiente`; una
-- ya `confirmado` responde ok sin cambios (alinea sillas en plazo si las
-- hubiera); cualquier otro estado (cancelado, activo…) se rechaza. Antes el
-- UPDATE no miraba el estado. Ya no hace falta SUPABASE_SERVICE_ROLE_KEY para
-- confirmar.
-- ADITIVA: solo crea funciones. El código anterior sigue funcionando.
-- ───────────────────────────────────────────────────────────────────────────

create or replace function public._confirmar_sillas_de_venta(p_numero text)
returns integer language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_estado text; v_tenant text; v_n integer;
begin
  -- Nada se lee antes de comprobar sesión, usuario activo y el testigo que
  -- solo fija confirmar_venta en esta misma transacción.
  -- Roles: los de las policies de UPDATE de ventas ("actualizar operaciones"
  -- y "venta actualiza sus contratos"); no es más estricto que la RLS.
  if v_uid is null
     or public.mi_rol() is null
     or public.mi_rol()::text not in ('superadmin', 'administracion', 'gerencia', 'operaciones', 'venta')
     or nullif(btrim(coalesce(p_numero, '')), '') is null
     or current_setting('app.confirmar_venta_token', true) is distinct from p_numero || '|' || v_uid::text then
    raise exception using errcode = '42501',
      message = 'Operación no permitida: las sillas se confirman solo a través de confirmar_venta.';
  end if;
  select estado, tenant into v_estado, v_tenant from public.ventas where numero_contrato = p_numero for update;
  if not found or not public.puede_ver_tenant(v_tenant) then
    raise exception using errcode = '42501',
      message = 'Operación no permitida: las sillas se confirman solo a través de confirmar_venta.';
  end if;
  if v_estado is distinct from 'confirmado' then
    raise exception using errcode = 'P0001',
      message = 'Las sillas solo se confirman cuando la venta ya está confirmada.';
  end if;
  update public.sillas set estado = 'confirmada', updated_at = now()
   where numero_contrato = p_numero and estado = 'en_plazo';
  get diagnostics v_n = row_count;
  return v_n;
end $$;
comment on function public._confirmar_sillas_de_venta(text) is
  'W7 (197): confirma las sillas en plazo de una venta ya confirmada. Solo actúa con sesión, usuario activo, el testigo de transacción que fija confirmar_venta y la agencia de la venta; una llamada directa falla con 42501 sin leer ni tocar nada.';
revoke all on function public._confirmar_sillas_de_venta(text) from public, anon;
grant execute on function public._confirmar_sillas_de_venta(text) to authenticated;

create or replace function public.confirmar_venta(p_numero text)
returns jsonb language plpgsql security invoker
set search_path = public, pg_temp set lock_timeout = '5s' as $$
declare v record; v_n integer; v_sillas integer;
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
    -- Testigo para el ayudante DEFINER (ver cabecera): solo después de que la
    -- RLS de quien llama dejó leer la venta con FOR UPDATE.
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
  perform set_config('app.confirmar_venta_token', '', true);
  return jsonb_build_object('ok', true, 'ya_confirmado', false, 'sillas_confirmadas', v_sillas);
end $$;
revoke all on function public.confirmar_venta(text) from public, anon;
grant execute on function public.confirmar_venta(text) to authenticated;

comment on function public.confirmar_venta(text) is
  'W7: confirma una venta pendiente y sus sillas en plazo en una sola transacción, con la RLS de quien llama (INVOKER). Migración 197.';
