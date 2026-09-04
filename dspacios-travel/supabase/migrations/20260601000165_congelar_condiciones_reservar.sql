-- ─────────────────────────────────────────────────────────────────────────
-- Migración 165 — congelar_condiciones_contrato (Rama B: catálogo → contrato
-- fuera de la cotización manual).
--
-- La migración 164 (YA aplicada en Supabase real, INMUTABLE — no se toca ni
-- se re-ejecuta aquí) construyó el motor puro (`condicionPago.ts`), el
-- snapshot (`snapshotCondiciones.ts`) y la tabla PERMANENTE
-- `contrato_condiciones`, pero el único camino que la escribe hoy es
-- `convertir_cotizacion_a_contrato` — exclusivo de la cotización MANUAL
-- (copia desde `cotizacion_condiciones`, su tabla de staging propia).
--
-- Los contratos que nacen DIRECTO de catálogo/tarifario/reservar/programas
-- (`reservarDesdeTarifarioInterno`, `reservarProgramaInterno`,
-- `convertirCotizacionCarrito` — ver `app/(dashboard)/dashboard/reservar/
-- actions.ts`) NO pasan por ninguna cotización con etapa de "primer pago":
-- crean la `venta`/`contrato_hoteles` directo, en una sola pasada. Por eso no
-- hay ninguna tabla de staging (`cotizacion_condiciones`) de la cual copiar
-- — el snapshot se calcula en TypeScript (mismos módulos puros de la 164,
-- sin tocarlos: `condicionDesdeCatalogo.ts` ya sabe traducir una fila real
-- de `hotel_temporadas`/`armado_paquetes`/`programas`) y se pasa DIRECTO a
-- esta función, que lo inserta en `contrato_condiciones` sin tabla
-- intermedia — mismo destino final, mismo candado de inmutabilidad
-- (`trg_contrato_condiciones_inmutable`, definido en la 164, sigue
-- aplicando sin cambios: bloquea UPDATE/DELETE sobre estas filas también).
--
-- Sin cambios de esquema: ni columnas nuevas, ni tablas nuevas. Solo dos
-- funciones nuevas (`_autorizado_congelar_condiciones` y
-- `congelar_condiciones_contrato`), aditivas, `SECURITY DEFINER` de facto
-- (dueña de la migración = superusuario), `EXECUTE` revocado a
-- `public/anon/authenticated` y otorgado solo a `service_role` — mismo
-- patrón que `registrar_pago_previo`/`convertir_cotizacion_a_contrato` de
-- la 164, para no introducir un segundo criterio de seguridad para dinero.
--
-- Rol autorizado: el MISMO que ya escribe `ventas` hoy (`ESCRITURA.ventas`
-- en lib/roles.ts = superadmin/administracion/gerencia/operaciones/venta).
-- Es DISTINTO del rol de pagos previos de la 164 (que excluye 'venta') a
-- propósito: congelar condiciones al crear un contrato es parte del mismo
-- flujo de reservar que ya puede ejecutar el rol 'venta' — no es una
-- operación de dinero post-hecho como un pago previo o un override.
--
-- No-op seguro ante doble llamada: a diferencia de `convertir_cotizacion_a_
-- contrato` (protegido por el `for update` + estado de la cotización, un
-- camino único), aquí no hay ningún candado previo que impida invocar la
-- función dos veces para el MISMO contrato (reintento de red, doble clic) —
-- el trigger de inmutabilidad de la 164 SOLO bloquea UPDATE/DELETE, nunca un
-- segundo INSERT. Por eso esta función verifica explícitamente "¿ya hay
-- filas para este numero_contrato?" y, si las hay, no hace nada (retorna sin
-- insertar) en vez de fallar o duplicar.
-- ─────────────────────────────────────────────────────────────────────────

-- ───────────────────────────────────────────────────────────────────────────
-- A) _autorizado_congelar_condiciones — mismo patrón que
--    `_autorizado_pago_previo` (migración 164), rol distinto (incluye
--    'venta').
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public._autorizado_congelar_condiciones(p_usuario_id uuid)
returns text language plpgsql as $$
declare v_rol text; v_activo boolean;
begin
  if p_usuario_id is null then
    raise exception 'Se requiere un usuario interno autorizado.';
  end if;
  select rol, activo into v_rol, v_activo
  from public.usuarios where id = p_usuario_id;
  if v_rol is null then
    raise exception 'El usuario % no existe en el sistema.', p_usuario_id;
  end if;
  if not coalesce(v_activo, false) then
    raise exception 'El usuario está desactivado.';
  end if;
  -- Mismo criterio que ESCRITURA.ventas (lib/roles.ts): quien puede crear
  -- una venta puede congelar las condiciones de SU contrato recién creado.
  if v_rol not in ('superadmin','administracion','gerencia','operaciones','venta') then
    raise exception 'Rol % no autorizado para congelar condiciones de un contrato.', v_rol;
  end if;
  return v_rol;
end;
$$;

revoke all on function public._autorizado_congelar_condiciones(uuid) from public, anon, authenticated;
grant execute on function public._autorizado_congelar_condiciones(uuid) to service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- B) congelar_condiciones_contrato — inserta el snapshot YA CALCULADO (por
--    TypeScript, con los módulos puros de la 164) en `contrato_condiciones`.
--    NO recalcula nada: es una frontera de persistencia, igual que
--    `convertir_cotizacion_a_contrato` lo es para su propio paso 10 (la
--    diferencia es que aquí el snapshot llega ya armado en `p_snapshot`, en
--    vez de copiarse desde `cotizacion_condiciones`).
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.congelar_condiciones_contrato(
  p_numero_contrato text,
  p_snapshot jsonb,
  p_moneda text,
  p_trm numeric,
  p_usuario_id uuid
) returns text language plpgsql as $$
declare
  v_rol          text;
  v_actor_tenant text;
  v_tenant       text;
  v_existe       boolean;
  v_insertadas   int;
begin
  v_rol := public._autorizado_congelar_condiciones(p_usuario_id);
  select tenant into v_actor_tenant from public.usuarios where id = p_usuario_id;

  -- Lock del contrato (evita una condición de carrera con otra llamada
  -- concurrente para el MISMO numero_contrato — ver el chequeo de no-op
  -- abajo, que necesita leer un estado consistente).
  select tenant into v_tenant from public.ventas where numero_contrato = p_numero_contrato for update;
  if v_tenant is null then
    raise exception 'El contrato % no existe.', p_numero_contrato;
  end if;

  -- superadmin = excepción global (mismo criterio que convertir_cotizacion_a_contrato).
  if v_rol <> 'superadmin' and v_actor_tenant is distinct from v_tenant then
    raise exception 'No tienes acceso a la agencia (tenant %) de este contrato.', v_tenant;
  end if;

  -- No-op seguro: si YA hay condiciones congeladas para este contrato (otra
  -- llamada ya las insertó — reintento, doble clic), no se duplica ni se
  -- falla: se devuelve el numero_contrato tal cual.
  select exists(select 1 from public.contrato_condiciones where numero_contrato = p_numero_contrato)
    into v_existe;
  if v_existe then
    return p_numero_contrato;
  end if;

  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'array' then
    raise exception 'El snapshot de condiciones debe ser un arreglo JSON.';
  end if;

  insert into public.contrato_condiciones (
    numero_contrato, tipo_componente, referencia_externa, orden, valor_componente,
    condicion_pago_tipo, condicion_pago_pct_aplicable, condicion_pago_dias_saldo,
    condicion_pago_fecha_limite, monto_exigido, restriccion_comercial, moneda, trm
  )
  select
    p_numero_contrato,
    r->>'tipo_componente',
    nullif(r->>'referencia_externa',''),
    coalesce((r->>'orden')::int, 0),
    coalesce((r->>'valor_componente')::numeric, 0),
    coalesce(r->>'condicion_pago_tipo','sin_condicion'),
    nullif(r->>'condicion_pago_pct_aplicable','')::numeric,
    nullif(r->>'condicion_pago_dias_saldo','')::int,
    nullif(r->>'condicion_pago_fecha_limite','')::date,
    coalesce((r->>'monto_exigido')::numeric, 0),
    coalesce(r->>'restriccion_comercial','normal'),
    p_moneda,
    p_trm
  from jsonb_array_elements(p_snapshot) as r;

  get diagnostics v_insertadas = row_count;
  if v_insertadas = 0 then
    raise exception 'El snapshot de condiciones no tiene componentes válidos para el contrato %.', p_numero_contrato;
  end if;

  return p_numero_contrato;
end;
$$;

revoke all on function public.congelar_condiciones_contrato(text, jsonb, text, numeric, uuid) from public, anon, authenticated;
grant execute on function public.congelar_condiciones_contrato(text, jsonb, text, numeric, uuid) to service_role;

notify pgrst, 'reload schema';
