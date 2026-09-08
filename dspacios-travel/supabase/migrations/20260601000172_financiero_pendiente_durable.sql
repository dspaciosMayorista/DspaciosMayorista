-- ───────────────────────────────────────────────────────────────────────────
-- 172 · ESTADO FINANCIERO DURABLE + REVERSIÓN REAL (cierra B7 de verdad)
--
-- La migración 171 hizo ATÓMICA la escritura financiera EN SÍ MISMA
-- (`registrar_financiero_contrato`), pero el flujo completo seguía siendo
-- COMPENSATORIO, no transaccional de punta a punta:
--
--   1) insert ventas               (su propio commit)
--   2) ... pasajeros/hoteles/vuelos/condiciones ... (sus propios commits)
--   3) registrar_financiero_contrato   (su propio commit)
--   4) si (3) falla: revertir_contrato_incompleto (su propio commit)
--
-- Cuatro huecos reales, verificados EMPÍRICAMENTE contra Postgres local
-- (no supuestos):
--
--   BUG A — `revertir_contrato_incompleto` (171) borra `ventas` SIN el flag
--   `app.eliminando_contrato`. Como `contrato_condiciones` (migración 164)
--   tiene un trigger que bloquea CUALQUIER delete —incluido el que llega por
--   cascada desde `ventas`— sin ese flag, y `congelarCondicionesContrato-
--   BestEffort` corre en el paso 6bis (ANTES del financiero), la reversión
--   FALLA para prácticamente todo contrato real. Reproducido: crear
--   condiciones + forzar fallo financiero + revertir → excepción
--   "contrato_condiciones es permanente...", el contrato queda vivo.
--
--   BUG B — `revertir_contrato_incompleto` no borra `aliados_b2b` antes de
--   `ventas`, y `aliados_b2b.numero_contrato` referencia `ventas` SIN
--   cascada (RESTRICT por defecto). Un contrato B2B con comisión ya creada
--   (el insert ocurre ANTES del paso financiero) hace que el DELETE de
--   `ventas` falle con `foreign_key_violation`. Reproducido igual: contrato
--   vivo, `aliados_b2b` huérfana.
--
--   BUG C — el reset de `sillas` en la reversión no limpia `asesor`, `hotel`,
--   `acomodacion` (sí lo hace `eliminar_contrato`, `liberarVencidas` y el
--   propio núcleo `_ajustar_sillas_nucleo` de la 167) — deja residuo
--   cosmético de un contrato borrado sobre una silla "disponible".
--
--   BUG D (estructural, no de código) — TODO lo anterior solo se ejecuta si
--   el PROCESO SIGUE VIVO para llamar a `revertir_contrato_incompleto`. Una
--   caída (crash, timeout de función serverless, pérdida de conexión) entre
--   el insert de `ventas` y el `registrar_financiero_contrato` —o entre el
--   fallo de este último y el intento de reversión— deja el contrato en el
--   estado exacto de los bugs A/B/C, PERO SIN QUE NADA LO DETECTE: no hay
--   columna, no hay cron, no hay consulta que distinga "en curso" de
--   "abandonado para siempre". Es un contrato fantasma silencioso.
--
-- Esta migración corrige A/B/C directamente y resuelve D con una GARANTÍA
-- DURABLE (opción B del pedido de revisión: un estado explícito, detectable,
-- recuperable tras caída, con reintento idempotente, que nunca depende
-- exclusivamente de la reversión compensatoria) porque envolver TODO el
-- flujo de creación (pasajeros/sillas/hoteles/vuelos/condiciones/financiero)
-- en una única transacción Postgres exigiría fusionar `crear_pasajeros_
-- contrato[_multi]` (166 migraciones de historia, atómico en sí mismo) y
-- `registrar_financiero_contrato` en un solo RPC gigante — una reescritura
-- estructural del núcleo de reservar, fuera de alcance seguro para esta
-- revisión puntual.
--
-- ── El nuevo estado: `ventas.financiero_estado` ──────────────────────────
-- NO es `ventas.estado` (ese es el estado COMERCIAL: pendiente/confirmado/
-- activo/cancelado, y ya significa algo — "pendiente de pago/confirmación",
-- una decisión humana). `financiero_estado` es un estado TÉCNICO interno:
-- "¿la escritura financiera de este contrato terminó?". Dos valores:
-- `pendiente` (recién nacido, financiero en curso) | `completo` (costos +
-- TODAS sus CxP ya quedaron, atómicamente, por `registrar_financiero_
-- contrato`).
--
-- Default = `completo` (NO `pendiente`) — decisión deliberada, no un
-- descuido: por defecto un contrato NO tiene nada pendiente. Esto es
-- OBLIGATORIO porque `reservarDesdeTarifarioInterno`/`convertirCotizacion-
-- Carrito` NO son los únicos caminos que crean `ventas` — `contratos/
-- actions.ts` (contrato manual), `reservarProgramaInterno` (programas) y el
-- importador de histórico minorista escriben su propio costo/CxP por fuera
-- de este mecanismo (fuera del alcance de ESTA revisión — B7 solo pidió
-- verificar los dos flujos de arriba). Si el default fuera `pendiente`,
-- CADA contrato creado por esos otros caminos —y CADA fila ya existente en
-- producción, vía el backfill automático de un `not null default` sobre una
-- columna nueva— quedaría marcado "financiero incompleto para siempre" y
-- el candado de `confirmarVenta` (abajo) los dejaría a todos inconfirmables.
-- Por eso: default `completo` (cero efecto en cualquier camino que no toca
-- esta migración), y SOLO los dos flujos de esta revisión insertan
-- `financiero_estado: 'pendiente'` explícito en su propio `insert` de
-- `ventas` — la única forma de que un contrato nazca "pendiente" es que el
-- código que lo crea lo pida a propósito.
--
-- ── El nuevo estado durable: `contrato_financiero_pendiente` ─────────────
-- Guarda el PAYLOAD YA CALCULADO (costos + cxp) que se va a intentar
-- registrar, escrito en SU PROPIO commit —una llamada aparte, ANTES de
-- invocar `registrar_financiero_contrato`— para que sobreviva aunque el
-- proceso muera justo después de escribirlo y antes/durante el intento del
-- RPC financiero. `registrar_financiero_contrato` la borra al tener éxito
-- (mismo commit que marca `completo`); así que su sola EXISTENCIA es la
-- señal durable de "este contrato tiene un intento financiero sin terminar,
-- y aquí está EXACTAMENTE lo que hay que reintentar" — reintento
-- IDEMPOTENTE real (repetir la llamada con el mismo payload no duplica
-- nada, `registrar_financiero_contrato` ya lo garantiza desde la 171).
-- `intentos`/`ultimo_error`/`ultimo_intento_en` hacen que un reintento
-- fallido deje RASTRO durable también (no un mensaje que se pierde en una
-- sola respuesta HTTP): son columnas de una fila que sigue ahí, consultable
-- para siempre hasta que se resuelva.
--
-- ── Cómo queda cerrado cada punto de interrupción pedido ─────────────────
--   1) Caída entre `ventas` y el RPC financiero → `financiero_estado`
--      queda en 'pendiente' (columna, no un mensaje). Si la caída fue
--      DESPUÉS de escribir `contrato_financiero_pendiente`, la reconciliación
--      (lib/reservar/reconciliacionFinanciera.ts) reintenta con el payload
--      exacto. Si fue ANTES (nunca se llegó a computar/perseverar el
--      payload), la reconciliación no inventa un payload — revierte
--      (mismo criterio de "nunca inventar dinero").
--   2) Pérdida de conexión entre el fallo del RPC financiero y la llamada a
--      reversión → mismo mecanismo: `financiero_estado` sigue 'pendiente',
--      el payload (si se alcanzó a persistir) sigue en la tabla, la
--      reconciliación lo recoge después, sin depender de que el proceso
--      original haya podido llamar a la reversión.
--   3) Reversión que falla (dinero real: abonos/pagos/retenciones) → el
--      contrato queda vivo, `financiero_estado='pendiente'` (detectable),
--      NUNCA se informa como creado con éxito (la Server Action ya
--      devuelve error explícito en este caso, sin cambios de esta
--      migración) y NO se reintenta solo automáticamente — exige revisión
--      humana, que es la garantía correcta cuando ya hubo dinero real.
--   4) Contrato con sillas/pasajeros/hoteles/vuelos/condiciones/ítems ya
--      escritos → la reversión corregida (bug A/B/C) los limpia TODOS sin
--      huérfanos, verificado reproduciendo los dos bugs y re-ejecutando
--      contra el código corregido.
--   5) CxP registrada sin asiento (o asiento sin CxP) → el asiento contable
--      sigue siendo una PROYECCIÓN recuperable (convención ya establecida
--      en lib/contabilidad/asientos.ts para TODO el proyecto: "la acción de
--      negocio nunca debe fallar por un problema de contabilidad"), pero
--      ahora es DETECTABLE por construcción —nunca se guarda una bandera
--      redundante que pueda desincronizarse: la ausencia del asiento ES el
--      hecho, siempre re-consultable comparando `cuentas_por_pagar` contra
--      `asientos_contables` (origen='cxp', referencia='cxp:<id>')— y la
--      reconciliación reintenta con `postearAsientoCxP` (ya idempotente,
--      reemplaza en vez de duplicar).
--
-- Pruebas de comportamiento REAL para los 5 escenarios:
-- supabase/scripts/test_172_financiero_pendiente_durable.sql
-- ───────────────────────────────────────────────────────────────────────────

begin;

-- ── A) financiero_estado ─────────────────────────────────────────────────
alter table public.ventas
  add column if not exists financiero_estado text not null default 'completo';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ventas_financiero_estado_check'
  ) then
    alter table public.ventas
      add constraint ventas_financiero_estado_check
      check (financiero_estado in ('pendiente', 'completo'));
  end if;
end $$;

comment on column public.ventas.financiero_estado is
  'Estado TÉCNICO de la escritura financiera (costos+CxP), NUNCA el estado comercial (esa es la columna estado). Default completo — solo reservarDesdeTarifarioInterno/convertirCotizacionCarrito lo insertan en pendiente explícitamente al nacer; pasa a completo atómicamente dentro de registrar_financiero_contrato (migración 171/172). Ningún otro camino de creación de ventas lo toca.';

-- `fecha_venta` es solo `date` (sin hora) — no alcanza para distinguir "un
-- contrato pendiente hace 2 segundos, request todavía en curso" de "lleva
-- 10 minutos abandonado, hay que reconciliarlo". Esta columna nace con
-- `now()` (precisa desde el momento de creación, incluso si nunca se
-- alcanzó a escribir un payload en contrato_financiero_pendiente) y se
-- vuelve a tocar cuando pasa a 'completo' — la reconciliación filtra por
-- edad sobre ESTA columna, nunca sobre `fecha_venta`.
alter table public.ventas
  add column if not exists financiero_actualizado_en timestamptz not null default now();

comment on column public.ventas.financiero_actualizado_en is
  'Marca de tiempo del último cambio de financiero_estado (o de creación, si nunca cambió). Usada por la reconciliación (lib/reservar/reconciliacionFinanciera.ts) para no tocar un contrato cuya escritura financiera puede seguir en curso en este mismo instante.';

create index if not exists ventas_financiero_pendiente_idx
  on public.ventas (financiero_actualizado_en)
  where financiero_estado = 'pendiente';

-- ── B) contrato_financiero_pendiente — payload durable para reintento ────
create table if not exists public.contrato_financiero_pendiente (
  numero_contrato    text primary key references public.ventas(numero_contrato) on delete cascade,
  tenant             text not null,
  costos             jsonb not null default '{}'::jsonb,
  cxp                jsonb not null default '[]'::jsonb,
  intentos           int not null default 0,
  creado_en          timestamptz not null default now(),
  ultimo_intento_en  timestamptz,
  ultimo_error       text
);

comment on table public.contrato_financiero_pendiente is
  'Payload YA CALCULADO (costos+cxp) de un contrato cuya escritura financiera está en curso o falló — se escribe ANTES de intentar registrar_financiero_contrato (su propio commit, sobrevive a una caída del proceso) y se borra automáticamente al tener éxito. Su existencia es la señal durable de "reintentar esto exactamente". Solo service_role: RLS activa, sin policies.';

alter table public.contrato_financiero_pendiente enable row level security;

-- ── C) registrar_financiero_contrato — ahora también cierra el estado ────
-- Se agrega, dentro de la MISMA transacción que ya escribe costos+CxP (no
-- se toca nada del cuerpo anterior salvo estas dos líneas finales): marcar
-- financiero_estado='completo' y borrar el payload pendiente. Así
-- 'completo' NUNCA puede quedar sin costos/CxP reales detrás — nace en la
-- misma transacción que los crea.
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
  v_existe    boolean;
  v_item      jsonb;
  v_ids       jsonb := '[]'::jsonb;
  v_eliminadas jsonb := '[]'::jsonb;
  v_id         bigint;
  v_valor      numeric;
begin
  if p_numero_contrato is null or btrim(p_numero_contrato) = '' then
    raise exception 'registrar_financiero_contrato: numero_contrato vacío';
  end if;
  if p_tenant is null or btrim(p_tenant) = '' then
    raise exception 'registrar_financiero_contrato: tenant vacío';
  end if;

  select true into v_existe
  from public.ventas
  where numero_contrato = p_numero_contrato and tenant = p_tenant
  for update;
  if not coalesce(v_existe, false) then
    raise exception 'registrar_financiero_contrato: el contrato % no existe en la agencia %', p_numero_contrato, p_tenant;
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
  end loop;

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
      aplica_retencion, pct_retencion, observaciones
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
      coalesce(nullif(v_item->>'observaciones', ''), public.marca_cxp_automatica())
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

  -- Migración 172: el estado financiero solo puede llegar a 'completo' EN
  -- LA MISMA transacción donde ya quedaron escritos los costos y CADA CxP —
  -- nunca antes, nunca por separado. El payload pendiente (si existía, de un
  -- intento anterior o del intento actual persistido antes de esta llamada)
  -- se borra: ya cumplió su propósito.
  update public.ventas set financiero_estado = 'completo', financiero_actualizado_en = now()
   where numero_contrato = p_numero_contrato;
  delete from public.contrato_financiero_pendiente where numero_contrato = p_numero_contrato;

  return jsonb_build_object('creadas', v_ids, 'eliminadas', v_eliminadas);
end;
$$;

comment on function public.registrar_financiero_contrato(text, text, jsonb, jsonb) is
  'Escribe EN UNA TRANSACCIÓN los costos, las cuentas por pagar y marca financiero_estado=completo de un contrato (migración 172) — o queda todo o no queda nada, y "completo" nunca aparece sin costo/CxP detrás. Idempotente. Solo service_role.';

revoke all on function public.registrar_financiero_contrato(text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.registrar_financiero_contrato(text, text, jsonb, jsonb) to service_role;

-- ── D) revertir_contrato_incompleto — corrige los 3 bugs reproducidos ────
create or replace function public.revertir_contrato_incompleto(
  p_numero_contrato text,
  p_tenant          text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existe boolean;
begin
  select true into v_existe
  from public.ventas
  where numero_contrato = p_numero_contrato and tenant = p_tenant
  for update;
  if not coalesce(v_existe, false) then
    return; -- ya no existe: nada que revertir (reintento del propio rollback)
  end if;

  if exists (select 1 from public.abonos a where a.numero_contrato = p_numero_contrato) then
    raise exception 'revertir_contrato_incompleto: el contrato % ya tiene abonos; no se revierte automáticamente', p_numero_contrato;
  end if;
  if exists (
    select 1 from public.cuentas_por_pagar c
    where c.numero_contrato = p_numero_contrato
      and (exists (select 1 from public.cxp_pagos p where p.cuenta_por_pagar_id = c.id)
        or exists (select 1 from public.retenciones_cxp r where r.cuenta_por_pagar_id = c.id))
  ) then
    raise exception 'revertir_contrato_incompleto: el contrato % ya tiene pagos/retenciones a proveedor; no se revierte automáticamente', p_numero_contrato;
  end if;

  -- BUG C corregido: mismo reset completo que eliminar_contrato (166) y
  -- _ajustar_sillas_nucleo (167) — antes esta función dejaba asesor/hotel/
  -- acomodacion residuales en una silla ya "disponible".
  update public.sillas
     set estado = 'disponible', numero_contrato = null, plazo = null,
         pasajero_nombres = null, pasajero_apellidos = null,
         tipo_doc = null, numero_doc = null, nacimiento = null,
         asesor = null, hotel = null, acomodacion = null
   where numero_contrato = p_numero_contrato;

  -- BUG B corregido: aliados_b2b no tiene ON DELETE CASCADE (referencia
  -- RESTRICT por defecto) — sin este delete, el `delete from ventas` de
  -- abajo fallaba con foreign_key_violation para cualquier contrato B2B
  -- (la comisión se inserta ANTES del paso financiero). Se agregan también
  -- facturacion/rentabilidad/liquidacion_comisiones por el mismo motivo
  -- estructural que eliminar_contrato (166) las borra explícito, aunque en
  -- un contrato recién creado e incompleto normalmente estén vacías (nacen
  -- de procesos posteriores a la confirmación, que este mecanismo bloquea).
  delete from public.facturacion            where numero_contrato = p_numero_contrato;
  delete from public.rentabilidad           where numero_contrato = p_numero_contrato;
  delete from public.liquidacion_comisiones where numero_contrato = p_numero_contrato;
  delete from public.aliados_b2b            where numero_contrato = p_numero_contrato;
  delete from public.cuentas_por_pagar      where numero_contrato = p_numero_contrato;
  delete from public.contrato_items         where numero_contrato = p_numero_contrato;
  delete from public.contrato_hoteles       where numero_contrato = p_numero_contrato;
  delete from public.contrato_vuelos        where numero_contrato = p_numero_contrato;
  delete from public.contrato_servicios     where numero_contrato = p_numero_contrato;
  delete from public.contrato_pasajeros     where numero_contrato = p_numero_contrato and responsable_id is not null;
  delete from public.contrato_pasajeros     where numero_contrato = p_numero_contrato;

  -- Migración 172: el payload pendiente ya no tiene contrato que describir.
  delete from public.contrato_financiero_pendiente where numero_contrato = p_numero_contrato;

  -- BUG A corregido: `contrato_condiciones` (migración 164) es INMUTABLE —
  -- su trigger bloquea CUALQUIER delete, incluido el que llega por cascada
  -- desde `ventas` (on delete cascade, migración 164), salvo que la
  -- transacción traiga encendido `app.eliminando_contrato` (el mismo
  -- bypass, mismo nombre de flag, que ya usa `eliminar_contrato`, migración
  -- 166 — ningún cambio al trigger, reutiliza el escape existente). Sin
  -- esto, revertir un contrato con condiciones YA congeladas (el caso
  -- normal: `congelarCondicionesContratoBestEffort` corre en el paso 6bis,
  -- ANTES del financiero) fallaba con "contrato_condiciones es
  -- permanente..." y dejaba el contrato vivo — reproducido empíricamente.
  -- Ventana del bypass: exactamente esta única sentencia (mismo criterio
  -- que 166), no el resto de la función.
  set local app.eliminando_contrato = 'true';
  delete from public.ventas where numero_contrato = p_numero_contrato;
  set local app.eliminando_contrato = 'false';
end;
$$;

comment on function public.revertir_contrato_incompleto(text, text) is
  'Deshace un contrato recién creado cuya escritura financiera falló, sin dejar huérfanos en sillas/pasajeros/hoteles/vuelos/condiciones/ítems/aliados_b2b (migración 172 corrige tres bugs reproducidos empíricamente: bypass de inmutabilidad de contrato_condiciones, borrado de aliados_b2b antes de ventas, reset completo de sillas). Se niega a borrar si ya hay abonos, pagos o retenciones. Solo service_role.';

revoke all on function public.revertir_contrato_incompleto(text, text) from public, anon, authenticated;
grant execute on function public.revertir_contrato_incompleto(text, text) to service_role;

commit;
