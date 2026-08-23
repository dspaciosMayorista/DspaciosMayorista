-- ───────────────────────────────────────────────────────────────────────────
-- 157 · VUELOS — editor operativo de vuelos del contrato (filas "Contrato"
-- de la pestaña Empaquetados) + estado de emisión/pago reales
--
-- ⚠️ Número 157 REUTILIZADO: el 157 anterior (cierre individual→serie) se
-- renombró a 158 porque en producción ya corrieron 155/156 pero ese cierre
-- seguía sin ejecutarse — quedaba libre para una migración nueva. Esta
-- migración es TOTALMENTE INDEPENDIENTE de la 158 (modalidad_emision de
-- `bloqueos_vuelo`, negociado/silla) — este archivo trabaja sobre
-- `contrato_vuelos` (vuelos de contratos dinámicos/empaquetados, "Sistema").
-- Puramente ADITIVA: ninguna tabla/vista/función existente pierde una
-- columna ni cambia de significado, solo se agregan objetos nuevos y se
-- AMPLÍA `ventas_vuelo_sistema` con columnas nuevas.
--
-- ⚠️ NO CORRER en el mismo despliegue que la 158 (cierre de modalidad_emision,
-- pendiente, sin relación con esta). Orden de esta migración:
--   1) correr ESTA 157 (aditiva) → 2) fusionar y desplegar el código nuevo
--   (tabla Empaquetados con columnas Record/Contrato separadas + acciones,
--   editor operativo de vuelos) → 3) pruebas operativas con un rol
--   `control_vuelo` real → 4) recién ENTONCES, cuando se decida, correr la
--   158 (cierre de modalidad_emision — sin relación con esta migración,
--   puede ir en cualquier orden relativo a esta).
--
-- PROBLEMA QUE RESUELVE (reportado sobre /dashboard/vuelos?vista=empaquetados)
--   1. Una fila de origen "Contrato" mezclaba record/número de contrato en
--      una sola columna, sin acción clara para completar/editar el vuelo.
--   2. `ContenidoContratoEditor` (el único editor existente de
--      `contrato_vuelos`) es exclusivo de `superadmin`, vive al final de la
--      ficha financiera completa del contrato, y no lo puede usar
--      `control_vuelo` (el rol operativo del módulo Vuelos).
--   3. `ventas_vuelo_sistema.aerolinea` venía de `ventas.aerolinea` aunque
--      el dato correcto/actualizado pudiera existir en `contrato_vuelos.
--      aerolinea` (llenado por el formulario de vuelos por tramo).
--   4. `vuelos/page.tsx` fijaba `estado_emision: null` / `estado_pago: null`
--      A MANO para TODAS las filas de origen Contrato — mostraban siempre
--      "Por confirmar" sin importar el estado real de emisión o de pago.
--
-- AUDITORÍA DE CxP AÉREAS (antes de tocar el estado de pago)
--   Se revisaron los 4 caminos de código que crean `cuentas_por_pagar` para
--   un vuelo — `reservar/actions.ts` (tarifario: bloqueo/empaquetado/
--   dinámico, 3 puntos: reserva nueva, "completar proveedores"),
--   `contratos/actions.ts` (contrato manual, mayorista y minorista),
--   `contratos/importar/actions.ts` (importador histórico minorista) y
--   `cotizaciones/manual-actions.ts` (cotización dinámica → contrato). LOS
--   4 escriben el literal EXACTO `tipo_proveedor = 'aereo'` (sin acento,
--   sin variantes) — es un discriminante estructural CONFIABLE, sin
--   ambigüedad, en el 100% de las CxP aéreas del sistema (histórico
--   incluido: el importador también usa el mismo literal). No se encontró
--   ningún caso donde el tipo aéreo dependiera de texto libre (ej. `servicio
--   ILIKE '%vuelo%'`) — por eso el estado de pago de abajo se deriva
--   filtrando por esta columna, nunca por coincidencia de texto.
--
-- ESTADO DE PAGO — misma matemática que YA usa la pestaña Proveedores del
--   contrato (`GestionTabs.tsx`, `FilaCxP`): `saldo = greatest(0, valor_total
--   - pagado - retenido)`, `pagada = saldo <= 0 and valor_total > 0` — donde
--   `pagado` es la suma de `cxp_pagos.valor` (migración 130, log ilimitado
--   de pagos) y `retenido` la suma de `retenciones_cxp.valor` (migración
--   125). Se REPLICA esa misma fórmula en SQL (dentro de la vista, más
--   abajo) — nunca se inventa una fórmula nueva ni se lee una sola etiqueta.
--   Agregado a nivel de CONTRATO (todas las CxP con tipo_proveedor='aereo'
--   de ese numero_contrato): sin ninguna → null ("Por confirmar"); todas
--   pagadas → 'pagado'; alguna con saldo pendiente (incluye pago parcial)
--   → 'pendiente'. Nunca expone un valor monetario — solo el estado
--   derivado y dos CONTEOS (`cxp_aereas_total`/`cxp_aereas_pagadas`, para un
--   tooltip tipo "3 de 4 cuentas pagadas" en la tabla).
--
-- ESTADO DE EMISIÓN — tabla NUEVA 1:1 por contrato, `contrato_vuelo_control`
--   (numero_contrato es su PK, no se repite por tramo: es un estado del
--   CONTRATO completo, no de cada fila de `contrato_vuelos` — igual
--   criterio que llevó a poner `modalidad_emision`/`estado_emision` en
--   `bloqueos_vuelo` como UNA fila, no por silla). Se analizó extender
--   `contrato_vuelos` con una columna repetida por tramo — descartado: un
--   contrato con 2+ tramos terminaría con el mismo estado escrito N veces,
--   pudiendo desincronizarse entre filas sin que nada lo impida. Mismo
--   patrón EXACTO que `bloqueo_cambios`/`actualizar_control_bloqueo()`
--   (migración 152) y `empaquetado_cambios`/`actualizar_control_empaquetado()`
--   (migración 156): historial con actor (resuelto por `auth.uid()`) y
--   fecha, SELECT...FOR UPDATE + UPDATE/INSERT + INSERT del historial en
--   una sola transacción. null = "Por confirmar" (nunca inferido de que
--   exista un PNR), 'pendiente', 'emitido' — el dominio exacto pedido.
--
-- ⚠️ DIFERENCIA DE DISEÑO con `actualizar_control_bloqueo`/`actualizar_
--   control_empaquetado`: aquellas dos NO son `security definer` porque el
--   rol que las llama (incl. `control_vuelo`) YA tiene una policy de
--   escritura genuina sobre `bloqueos_vuelo`/`empaquetados`. Aquí NO es el
--   caso: `contrato_vuelos: interno` (migración 141) y `ventas` (control de
--   quién ve cada contrato) NUNCA incluyeron a `control_vuelo` — ese rol no
--   tiene HOY ningún SELECT/UPDATE propio sobre `ventas`/`contrato_vuelos`
--   (por eso existe `ventas_vuelo_sistema`/`acceso_ventas_vuelo_sistema()`,
--   migración 156, como su único canal de lectura). Para que `control_vuelo`
--   pueda EDITAR sin ensancharle la RLS de esas tablas a todos los efectos,
--   las funciones nuevas de este archivo SÍ son `security definer` — con
--   `set search_path = public` (obligatorio en toda función definer de este
--   repo) y con su PROPIO chequeo interno de rol+tenant, reutilizando
--   `acceso_ventas_vuelo_sistema()` (no se duplica la lista de roles ni el
--   criterio de tenant: superadmin global, gerencia/administracion/
--   operaciones/control_vuelo solo su tenant, cualquier otro rol —
--   incluido `venta`, a propósito, este editor no es para asesores — sin
--   acceso). El helper `acceso_editar_vuelos_contrato()` es la única pieza
--   nueva de autorización; todo lo demás reutiliza lo que ya existía.
--
-- NO SERVICE_ROLE: todo el acceso de este archivo se resuelve con el
--   usuario autenticado real (rol + `activo` + tenant, vía `mi_rol()`/
--   `mi_tenant()`, que leen `request.jwt.claims`) — nunca con la clave de
--   servicio del lado del servidor. El tenant SIEMPRE se deriva server-side
--   contra `ventas.tenant` — el cliente nunca envía un tenant que el
--   servidor deba confiar.
--
-- REEMPLAZO ATÓMICO DE TRAMOS — `guardar_tramos_contrato()`: recorre el
--   arreglo de tramos que manda el cliente, ACTUALIZA por `id` los que ya
--   existían (conserva su id — no se les asigna uno nuevo) e INSERTA los
--   que no traen `id`; borra al final solo los `id` existentes que YA NO
--   vienen en el arreglo. Todo dentro de una sola función `plpgsql`, que
--   Postgres ejecuta en una única transacción implícita — si CUALQUIER paso
--   falla (ej. el 3er INSERT de 4), la excepción revierte TODO lo anterior
--   (los UPDATE y el DELETE incluidos): el contrato nunca queda con menos
--   vuelos de los que tenía antes de intentar guardar. Exige al menos un
--   tramo en el arreglo — nunca se puede vaciar el itinerario a cero desde
--   este RPC (si de verdad hace falta borrar el último tramo, es una
--   operación aparte, fuera de este editor). Devuelve `setof
--   contrato_vuelos` con los tramos ya guardados (id reales incluidos) —
--   el cliente sincroniza su estado local con esto, nunca solo con
--   `router.refresh()` (que no toca el `useState` de React).
--
-- ⚠️ ORDEN OBLIGATORIO dentro de las dos funciones de escritura de este
--   archivo (`guardar_tramos_contrato`/`actualizar_estado_emision_contrato`):
--   1) autorizar (`acceso_editar_vuelos_contrato`) → 2) validar el payload
--   COMPLETO en Postgres (nunca se confía en la validación del cliente,
--   ambas SON `security definer`) → 3) bloquear la fila PADRE de `ventas`
--   por `numero_contrato` (`select 1 ... for update`, MISMO candado en las
--   dos funciones) → 4) recién ahí escribir. Ninguna fila se toca antes del
--   paso 3, aunque una excepción revertiría igual toda la transacción — el
--   candado del negocio es no empezar a escribir sin saber que el payload
--   completo es válido. El bloqueo sobre `ventas` (no sobre las tablas
--   propias de cada función) sirve para SERIALIZAR cualquier combinación de
--   llamadas concurrentes sobre el MISMO contrato — dos guardados de tramos,
--   dos cambios de estado de emisión, o uno de cada uno — nunca solo una
--   combinación puntual. Validación de `guardar_tramos_contrato` en
--   Postgres (nunca solo en el cliente): `p_tramos` debe ser un arreglo de
--   1 a 20 objetos; cada objeto solo acepta las claves conocidas (un campo
--   no reconocido se rechaza, no se ignora en silencio); `id` ausente/null
--   o entero positivo, sin repetirse dentro del mismo payload, y si viene
--   debe existir y pertenecer a ESTE contrato (ni ajeno a otro contrato ni
--   inexistente); `direccion` solo null/''/'ida'/'regreso'; códigos IATA
--   solo null/'' o exactamente 3 letras, y origen/destino deben venir
--   juntos o ninguno de los dos; `fecha` null/'' o fecha ISO válida; horas
--   null/'' o `HH:MM` en rango real; límites de longitud en
--   aerolínea/record/ciudad/número de vuelo/servicios; un tramo
--   completamente vacío se rechaza. Cualquier error de casteo se atrapa y
--   se traduce a un mensaje de negocio limpio — nunca se filtra un error
--   crudo de Postgres al usuario.
--
-- COMPATIBILIDAD — histórico y datos existentes:
--   · Contratos dinámicos/empaquetados SIN `contrato_vuelos` (creados antes
--     de la ronda anterior de este PR) siguen apareciendo en la lista —
--     `ventas_vuelo_sistema` ya los traía con todo NULL; ahora también
--     `estado_pago`/`estado_emision` les salen NULL (nunca inventados) y la
--     UI los muestra como "Sin PNR" + botón "Completar vuelo".
--   · Ningún backfill: no se infiere aerolínea/proveedor/fecha por texto,
--     no se convierten filas de `contrato_servicios`/Proveedores en tramos
--     de `contrato_vuelos`, no se toca ninguna `cuentas_por_pagar` al
--     editar el itinerario (son lecturas de solo consulta para el estado
--     de pago, el RPC de tramos nunca las escribe).
--
-- ATOMICIDAD DEL ARCHIVO: todo corre en una transacción explícita
-- (`begin`/`commit`).
--
-- ROLLBACK PROBADO: `supabase/scripts/rollback_157_editor_vuelos_contrato.sql`.
-- ───────────────────────────────────────────────────────────────────────────

begin;

-- ═════════════════════════════════════════════════════════════════════════
-- 1) Helper de autorización — reutiliza acceso_ventas_vuelo_sistema()
-- ═════════════════════════════════════════════════════════════════════════
-- SECURITY DEFINER: `control_vuelo` no tiene SELECT propio sobre `ventas`
-- (confirmado: ninguna policy de `ventas` lo incluye), así que una versión
-- no-definer devolvería siempre false para ese rol, aunque su rol/tenant
-- calcen. `set search_path = public` fijo (obligatorio para toda función
-- definer de este repo, evita resolución de esquema manipulable). NO
-- expone ninguna columna de `ventas` — un solo boolean, mismo criterio que
-- `acceso_ventas_vuelo_sistema()`/`acceso_archivo_contratos()`.
create or replace function public.acceso_editar_vuelos_contrato(p_numero_contrato text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.ventas v
    where v.numero_contrato = p_numero_contrato
      and public.acceso_ventas_vuelo_sistema(v.tenant)
  );
$$;

comment on function public.acceso_editar_vuelos_contrato(text) is
  'true si el usuario autenticado (rol + activo + tenant, mi_rol()/mi_tenant()) puede '
  'leer/editar los vuelos del contrato dado. Reutiliza EXACTAMENTE el mismo rol/tenant '
  'que acceso_ventas_vuelo_sistema() (superadmin global; gerencia/administracion/'
  'operaciones/control_vuelo solo su tenant; cualquier otro rol, incluido venta, sin '
  'acceso) — nunca duplica la lista de roles. Si numero_contrato no existe, devuelve '
  'false (nunca lanza), cerrando también el caso "cambiar el número en la URL para '
  'cruzar de agencia": el tenant a comparar es el de ESE contrato, no el del que llama. '
  'Migración 157.';

revoke all on function public.acceso_editar_vuelos_contrato(text) from public;
revoke all on function public.acceso_editar_vuelos_contrato(text) from anon;
grant execute on function public.acceso_editar_vuelos_contrato(text) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- 2) Estado de emisión del contrato — tabla 1:1 + historial + RPC atómico
-- ═════════════════════════════════════════════════════════════════════════
create table if not exists public.contrato_vuelo_control (
  numero_contrato text primary key references public.ventas(numero_contrato) on delete cascade,
  estado_emision  text,                              -- 'pendiente' | 'emitido'; null = "Por confirmar"
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.contrato_vuelo_control
  add constraint contrato_vuelo_control_estado_emision_check
  check (estado_emision in ('pendiente', 'emitido'));

comment on table public.contrato_vuelo_control is
  'Estado de emisión del vuelo de UN contrato completo (dinámico/empaquetado) — '
  'UNA fila por numero_contrato, nunca repetido por tramo (evita que dos filas de '
  'contrato_vuelos queden con estados distintos para el mismo contrato). null = '
  '"Por confirmar", nunca inferido de que exista un PNR. Migración 157.';

create table if not exists public.contrato_vuelo_control_cambios (
  id              bigserial primary key,
  numero_contrato text not null references public.contrato_vuelo_control(numero_contrato) on delete cascade,
  detalle         text,
  nota            text,
  registrado_por  text,
  created_at      timestamptz not null default now()
);
create index if not exists idx_contrato_vuelo_control_cambios_num
  on public.contrato_vuelo_control_cambios(numero_contrato, created_at desc);

comment on table public.contrato_vuelo_control_cambios is
  'Historial de cambios de estado de emisión de un contrato — mismo patrón que '
  'bloqueo_cambios/empaquetado_cambios. Migración 157.';

-- Mismo patrón exacto que actualizar_control_bloqueo()/actualizar_control_
-- empaquetado() (SELECT...FOR UPDATE + upsert + INSERT del historial, una
-- sola transacción) — con la diferencia de diseño explicada arriba: SÍ es
-- security definer, porque control_vuelo no tiene RLS propia sobre estas
-- tablas ni sobre ventas/contrato_vuelos. El chequeo de acceso reemplaza a
-- la RLS que en los otros dos RPC hace el trabajo.
create or replace function public.actualizar_estado_emision_contrato(
  p_numero_contrato text,
  p_estado_emision  text,
  p_nota            text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_antes           text;
  v_detalle         text := '';
  v_registrado_por  text;
begin
  if not public.acceso_editar_vuelos_contrato(p_numero_contrato) then
    raise exception 'Contrato no encontrado o sin permiso para editarlo.';
  end if;

  if p_estado_emision is not null and p_estado_emision not in ('pendiente', 'emitido') then
    raise exception 'Estado de emisión inválido.';
  end if;

  -- Payload validado. Recién ahora se bloquea la fila PADRE (ventas) por
  -- numero_contrato — mismo candado, mismo orden (autorizar → validar →
  -- bloquear → escribir) que guardar_tramos_contrato(), para que dos
  -- llamadas concurrentes sobre el MISMO contrato (desde cualquiera de los
  -- dos RPC, o una de cada uno) se serialicen aquí y nunca se entrelacen.
  perform 1 from public.ventas where numero_contrato = p_numero_contrato for update;

  select estado_emision into v_antes
    from public.contrato_vuelo_control
   where numero_contrato = p_numero_contrato
     for update;
  -- not found = todavía no existe la fila de control para este contrato:
  -- v_antes queda NULL ("Por confirmar" implícito), el upsert de abajo la crea.

  if coalesce(v_antes, '') <> coalesce(p_estado_emision, '') then
    v_detalle := 'Estado de emisión: '
      || coalesce(case v_antes when 'pendiente' then 'Pendiente' when 'emitido' then 'Emitido' end, 'Por confirmar')
      || ' → '
      || coalesce(case p_estado_emision when 'pendiente' then 'Pendiente' when 'emitido' then 'Emitido' end, 'Por confirmar');
  end if;

  if v_detalle = '' and coalesce(trim(p_nota), '') = '' then
    raise exception 'No hay cambios para registrar.';
  end if;

  insert into public.contrato_vuelo_control (numero_contrato, estado_emision, updated_at)
  values (p_numero_contrato, p_estado_emision, now())
  on conflict (numero_contrato) do update
    set estado_emision = excluded.estado_emision, updated_at = now();

  select coalesce(u.nombre, u.email) into v_registrado_por
    from public.usuarios u
   where u.id = auth.uid();

  insert into public.contrato_vuelo_control_cambios (numero_contrato, detalle, nota, registrado_por)
  values (p_numero_contrato, nullif(v_detalle, ''), nullif(trim(p_nota), ''), v_registrado_por);
end;
$$;

comment on function public.actualizar_estado_emision_contrato(text, text, text) is
  'Actualiza el estado de emisión de un contrato (upsert 1:1 en contrato_vuelo_control) '
  'y registra el cambio en contrato_vuelo_control_cambios en UNA sola transacción. '
  'SECURITY DEFINER — control_vuelo no tiene RLS propia sobre estas tablas; la '
  'autorización la hace acceso_editar_vuelos_contrato() explícitamente. Migración 157.';

revoke all on function public.actualizar_estado_emision_contrato(text, text, text) from public;
revoke all on function public.actualizar_estado_emision_contrato(text, text, text) from anon;
grant execute on function public.actualizar_estado_emision_contrato(text, text, text) to authenticated;

-- ── RLS — solo lectura para los roles autorizados; ESCRITURA solo por el RPC ──
alter table public.contrato_vuelo_control         enable row level security;
alter table public.contrato_vuelo_control_cambios enable row level security;

drop policy if exists "contrato_vuelo_control: lectura control" on public.contrato_vuelo_control;
create policy "contrato_vuelo_control: lectura control"
  on public.contrato_vuelo_control for select
  using (public.acceso_editar_vuelos_contrato(numero_contrato));

drop policy if exists "contrato_vuelo_control_cambios: lectura control" on public.contrato_vuelo_control_cambios;
create policy "contrato_vuelo_control_cambios: lectura control"
  on public.contrato_vuelo_control_cambios for select
  using (public.acceso_editar_vuelos_contrato(numero_contrato));
-- Sin policy de INSERT/UPDATE en ninguna de las dos: la única escritura
-- posible es a través del RPC (SECURITY DEFINER, corre con los privilegios
-- del dueño de la función) — mismo criterio que bloqueo_cambios/
-- empaquetado_cambios ("escritura SOLO por el RPC").

-- ═════════════════════════════════════════════════════════════════════════
-- 3) Vista de solo lectura para el editor — TODOS los tramos de un contrato
-- ═════════════════════════════════════════════════════════════════════════
-- Distinta de `contrato_vuelos_basica` (migración 148, roles superadmin/
-- gerencia/administracion/operaciones/venta — sin control_vuelo, CON venta,
-- justo lo contrario de lo que necesita este editor). Sin PII/financiero:
-- contrato_vuelos no tiene ninguna columna de cliente/costo/precio.
create or replace view public.contrato_vuelos_editor as
  select
    cv.id, cv.numero_contrato, cv.aerolinea, cv.record, cv.direccion,
    cv.origen_codigo, cv.origen_ciudad, cv.destino_codigo, cv.destino_ciudad,
    cv.numero_vuelo, cv.fecha_salida, cv.hora_salida, cv.hora_llegada,
    cv.servicios, cv.orden
  from public.contrato_vuelos cv
  where public.acceso_editar_vuelos_contrato(cv.numero_contrato);

comment on view public.contrato_vuelos_editor is
  'TODOS los tramos de contrato_vuelos de un contrato (a diferencia de ventas_vuelo_'
  'sistema, que solo trae el tramo ida/regreso "principal" para el resumen de la '
  'lista) — fuente para el editor operativo de vuelos. Mismo gate que el RPC de '
  'escritura (acceso_editar_vuelos_contrato). Migración 157.';

grant select on public.contrato_vuelos_editor to authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- 4) Reemplazo atómico de tramos — preserva ids, nunca deja el contrato sin
--    vuelos si algo falla a mitad de camino
-- ═════════════════════════════════════════════════════════════════════════
-- `drop` explícito: el tipo de retorno cambia de `void` a `setof
-- contrato_vuelos` (devuelve los tramos YA guardados, con sus id reales —
-- lo necesita el cliente para no desincronizar sus ids locales entre un
-- guardado y el siguiente), y Postgres no permite cambiar el tipo de
-- retorno de una función con `create or replace`.
drop function if exists public.guardar_tramos_contrato(text, jsonb);

create function public.guardar_tramos_contrato(
  p_numero_contrato text,
  p_tramos          jsonb
)
returns setof public.contrato_vuelos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max_tramos     constant int := 20;
  v_claves_validas constant text[] := array[
    'id', 'aerolinea', 'record', 'direccion', 'origenCodigo', 'origenCiudad',
    'destinoCodigo', 'destinoCiudad', 'numeroVuelo', 'fecha', 'horaSalida',
    'horaLlegada', 'servicios'
  ];
  v_tramo          jsonb;
  v_clave          text;
  v_id             bigint;
  v_ids_mantener   bigint[] := '{}';
  v_ids_vistos     bigint[] := '{}';
  v_direccion      text;
  v_origen         text;
  v_destino        text;
  v_fecha          text;
  v_hora_salida    text;
  v_hora_llegada   text;
  v_aerolinea      text;
  v_record         text;
  v_origen_ciudad  text;
  v_destino_ciudad text;
  v_numero_vuelo   text;
  v_servicios      text;
  v_vacio          boolean;
  v_orden          int := 0;
  v_ajenos         int;
  v_encontrados    int;
begin
  if not public.acceso_editar_vuelos_contrato(p_numero_contrato) then
    raise exception 'Contrato no encontrado o sin permiso para editarlo.';
  end if;

  -- ═══════════════════════════════════════════════════════════════════════
  -- Validación COMPLETA del payload — nada de lo de abajo toca una sola fila
  -- de contrato_vuelos todavía. Aunque cualquier `raise exception` revertiría
  -- igual la transacción entera, el candado del negocio es no empezar a
  -- escribir antes de saber que TODO el payload es válido.
  -- ═══════════════════════════════════════════════════════════════════════
  if p_tramos is null or jsonb_typeof(p_tramos) <> 'array' then
    raise exception 'El listado de tramos debe ser un arreglo.';
  end if;

  if jsonb_array_length(p_tramos) = 0 then
    raise exception 'Debe haber al menos un tramo — este editor no vacía el itinerario a cero.';
  end if;

  if jsonb_array_length(p_tramos) > v_max_tramos then
    raise exception 'No se pueden guardar más de % tramos en un solo contrato.', v_max_tramos;
  end if;

  for v_tramo in select * from jsonb_array_elements(p_tramos)
  loop
    if jsonb_typeof(v_tramo) <> 'object' then
      raise exception 'Cada tramo debe ser un objeto.';
    end if;

    for v_clave in select jsonb_object_keys(v_tramo)
    loop
      if not (v_clave = any(v_claves_validas)) then
        raise exception 'Campo no reconocido en un tramo: %.', v_clave;
      end if;
    end loop;

    -- id: ausente/null, o entero positivo — nunca otro tipo, nunca repetido
    -- dentro del mismo payload.
    v_id := null;
    if v_tramo ? 'id' and jsonb_typeof(v_tramo->'id') <> 'null' then
      if jsonb_typeof(v_tramo->'id') <> 'number' then
        raise exception 'El id de un tramo debe ser numérico.';
      end if;
      begin
        v_id := (v_tramo->>'id')::bigint;
      exception when others then
        raise exception 'El id de un tramo es inválido.';
      end;
      if v_id is null or v_id <= 0 then
        raise exception 'El id de un tramo debe ser un entero positivo.';
      end if;
      if v_id = any(v_ids_vistos) then
        raise exception 'Un tramo repite el id % dentro del mismo guardado.', v_id;
      end if;
      v_ids_vistos := array_append(v_ids_vistos, v_id);
      v_ids_mantener := array_append(v_ids_mantener, v_id);
    end if;

    -- direccion: ausente/null/''/'ida'/'regreso' — cualquier otro tipo o
    -- valor se rechaza.
    if v_tramo ? 'direccion' and jsonb_typeof(v_tramo->'direccion') <> 'null' then
      if jsonb_typeof(v_tramo->'direccion') <> 'string' then
        raise exception 'La dirección de un tramo es inválida.';
      end if;
      v_direccion := v_tramo->>'direccion';
      if v_direccion not in ('', 'ida', 'regreso') then
        raise exception 'La dirección de un tramo debe ser ida, regreso o ninguna.';
      end if;
    end if;

    -- Códigos IATA: ausente/null/'' o EXACTO 3 letras (A-Z tras upper/trim);
    -- origen y destino deben venir juntos, o ninguno de los dos.
    if v_tramo ? 'origenCodigo' and jsonb_typeof(v_tramo->'origenCodigo') not in ('null', 'string') then
      raise exception 'El código de origen de un tramo es inválido.';
    end if;
    if v_tramo ? 'destinoCodigo' and jsonb_typeof(v_tramo->'destinoCodigo') not in ('null', 'string') then
      raise exception 'El código de destino de un tramo es inválido.';
    end if;
    v_origen := nullif(upper(trim(coalesce(v_tramo->>'origenCodigo', ''))), '');
    v_destino := nullif(upper(trim(coalesce(v_tramo->>'destinoCodigo', ''))), '');
    if v_origen is not null and v_origen !~ '^[A-Z]{3}$' then
      raise exception 'El código de origen de un tramo debe tener exactamente 3 letras.';
    end if;
    if v_destino is not null and v_destino !~ '^[A-Z]{3}$' then
      raise exception 'El código de destino de un tramo debe tener exactamente 3 letras.';
    end if;
    if (v_origen is not null) <> (v_destino is not null) then
      raise exception 'Un tramo debe traer origen y destino juntos, o ninguno de los dos.';
    end if;

    -- Fecha: ausente/null/'' o fecha ISO válida (nunca se deja pasar un
    -- error crudo de casteo al usuario).
    v_fecha := nullif(trim(coalesce(v_tramo->>'fecha', '')), '');
    if v_fecha is not null then
      begin
        perform v_fecha::date;
      exception when others then
        raise exception 'La fecha de un tramo no es válida.';
      end;
    end if;

    -- Horas: ausente/null/'' o HH:MM válido (00-23 : 00-59).
    v_hora_salida := nullif(trim(coalesce(v_tramo->>'horaSalida', '')), '');
    v_hora_llegada := nullif(trim(coalesce(v_tramo->>'horaLlegada', '')), '');
    if v_hora_salida is not null and v_hora_salida !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception 'La hora de salida de un tramo no es válida.';
    end if;
    if v_hora_llegada is not null and v_hora_llegada !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception 'La hora de llegada de un tramo no es válida.';
    end if;

    -- Longitudes razonables — nunca texto libre sin tope.
    v_aerolinea := nullif(trim(coalesce(v_tramo->>'aerolinea', '')), '');
    v_record := nullif(trim(coalesce(v_tramo->>'record', '')), '');
    v_origen_ciudad := nullif(trim(coalesce(v_tramo->>'origenCiudad', '')), '');
    v_destino_ciudad := nullif(trim(coalesce(v_tramo->>'destinoCiudad', '')), '');
    v_numero_vuelo := nullif(trim(coalesce(v_tramo->>'numeroVuelo', '')), '');
    v_servicios := nullif(trim(coalesce(v_tramo->>'servicios', '')), '');
    if length(coalesce(v_aerolinea, '')) > 80 then raise exception 'La aerolínea de un tramo es demasiado larga.'; end if;
    if length(coalesce(v_record, '')) > 20 then raise exception 'El record (PNR) de un tramo es demasiado largo.'; end if;
    if length(coalesce(v_origen_ciudad, '')) > 80 or length(coalesce(v_destino_ciudad, '')) > 80 then
      raise exception 'El nombre de una ciudad de un tramo es demasiado largo.';
    end if;
    if length(coalesce(v_numero_vuelo, '')) > 15 then raise exception 'El número de vuelo de un tramo es demasiado largo.'; end if;
    if length(coalesce(v_servicios, '')) > 500 then raise exception 'El campo de servicios de un tramo es demasiado largo.'; end if;

    -- Rechaza un tramo completamente vacío.
    v_vacio := v_aerolinea is null and v_record is null and coalesce(v_direccion, '') = ''
      and v_origen is null and v_destino is null and v_numero_vuelo is null
      and v_fecha is null and v_hora_salida is null and v_hora_llegada is null
      and v_servicios is null;
    if v_vacio then
      raise exception 'Un tramo no puede estar completamente vacío.';
    end if;

    v_direccion := null; -- reinicia para el siguiente tramo del loop
  end loop;

  -- Ningún id del payload puede pertenecer a OTRO contrato (evita colar un
  -- id ajeno para pisar el vuelo de otra agencia/contrato), ni ser un id
  -- que ya no existe en absoluto — ambas se comprueban ANTES del DELETE.
  if array_length(v_ids_mantener, 1) > 0 then
    select count(*) into v_ajenos
      from public.contrato_vuelos cv
     where cv.id = any(v_ids_mantener) and cv.numero_contrato <> p_numero_contrato;
    if v_ajenos > 0 then
      raise exception 'Uno de los tramos no pertenece a este contrato.';
    end if;

    select count(*) into v_encontrados
      from public.contrato_vuelos cv
     where cv.id = any(v_ids_mantener) and cv.numero_contrato = p_numero_contrato;
    if v_encontrados <> array_length(v_ids_mantener, 1) then
      raise exception 'Uno de los tramos ya no existe.';
    end if;
  end if;

  -- ═══════════════════════════════════════════════════════════════════════
  -- Payload validado por completo. Recién AHORA se bloquea la fila PADRE
  -- (ventas) por numero_contrato — mismo candado, mismo orden (autorizar →
  -- validar → bloquear → escribir) que actualizar_estado_emision_contrato(),
  -- para que dos guardados concurrentes del mismo contrato se serialicen
  -- aquí: el segundo espera a que el primero libere el candado (al hacer
  -- commit) y luego reemplaza TODO de nuevo con su propio payload completo
  -- — el resultado final es siempre uno de los dos guardados completos,
  -- nunca una mezcla de campos de ambos.
  -- ═══════════════════════════════════════════════════════════════════════
  perform 1 from public.ventas where numero_contrato = p_numero_contrato for update;

  -- Borra los tramos existentes que YA NO vienen en el payload.
  delete from public.contrato_vuelos
   where numero_contrato = p_numero_contrato
     and (array_length(v_ids_mantener, 1) is null or not (id = any(v_ids_mantener)));

  for v_tramo in select * from jsonb_array_elements(p_tramos)
  loop
    v_id := nullif(v_tramo->>'id', '')::bigint;

    if v_id is not null then
      update public.contrato_vuelos set
        aerolinea      = nullif(trim(v_tramo->>'aerolinea'), ''),
        record         = nullif(trim(v_tramo->>'record'), ''),
        direccion      = nullif(v_tramo->>'direccion', ''),
        origen_codigo  = nullif(upper(trim(v_tramo->>'origenCodigo')), ''),
        origen_ciudad  = nullif(trim(v_tramo->>'origenCiudad'), ''),
        destino_codigo = nullif(upper(trim(v_tramo->>'destinoCodigo')), ''),
        destino_ciudad = nullif(trim(v_tramo->>'destinoCiudad'), ''),
        numero_vuelo   = nullif(trim(v_tramo->>'numeroVuelo'), ''),
        fecha_salida   = nullif(v_tramo->>'fecha', '')::date,
        hora_salida    = nullif(trim(v_tramo->>'horaSalida'), ''),
        hora_llegada   = nullif(trim(v_tramo->>'horaLlegada'), ''),
        servicios      = nullif(trim(v_tramo->>'servicios'), ''),
        orden          = v_orden
      where id = v_id and numero_contrato = p_numero_contrato;

      if not found then
        raise exception 'No se pudo actualizar un tramo (id % no pertenece a este contrato).', v_id;
      end if;
    else
      insert into public.contrato_vuelos (
        numero_contrato, aerolinea, record, direccion,
        origen_codigo, origen_ciudad, destino_codigo, destino_ciudad,
        numero_vuelo, fecha_salida, hora_salida, hora_llegada, servicios, orden
      ) values (
        p_numero_contrato,
        nullif(trim(v_tramo->>'aerolinea'), ''),
        nullif(trim(v_tramo->>'record'), ''),
        nullif(v_tramo->>'direccion', ''),
        nullif(upper(trim(v_tramo->>'origenCodigo')), ''),
        nullif(trim(v_tramo->>'origenCiudad'), ''),
        nullif(upper(trim(v_tramo->>'destinoCodigo')), ''),
        nullif(trim(v_tramo->>'destinoCiudad'), ''),
        nullif(trim(v_tramo->>'numeroVuelo'), ''),
        nullif(v_tramo->>'fecha', '')::date,
        nullif(trim(v_tramo->>'horaSalida'), ''),
        nullif(trim(v_tramo->>'horaLlegada'), ''),
        nullif(trim(v_tramo->>'servicios'), ''),
        v_orden
      );
    end if;

    v_orden := v_orden + 1;
  end loop;

  -- Devuelve los tramos YA guardados (con sus id reales, incluidos los recién
  -- asignados a los que llegaron con id null) — el cliente sincroniza su
  -- estado local con esto en vez de confiar en volver a leer después de un
  -- `router.refresh()`, que no actualiza el estado de React por sí solo.
  return query
    select * from public.contrato_vuelos
     where numero_contrato = p_numero_contrato
     order by orden asc, id asc;
end;
$$;

comment on function public.guardar_tramos_contrato(text, jsonb) is
  'Reemplaza ATÓMICAMENTE los tramos de contrato_vuelos de un contrato: actualiza por '
  'id los que ya existían (conserva el id), inserta los que no traen id, borra los que '
  'ya no vienen en el payload — todo en UNA transacción (función plpgsql): si cualquier '
  'paso falla, Postgres revierte TODO, el contrato nunca queda sin vuelos a medio '
  'guardar. Exige al menos un tramo, valida el payload COMPLETO (tipos, longitudes, '
  'IATA, fechas/horas, ids duplicados/ajenos/inexistentes) antes de tocar una sola fila, '
  'y bloquea (SELECT...FOR UPDATE) la fila padre de ventas por numero_contrato recién '
  'después de validar y antes de escribir, para serializar guardados concurrentes del '
  'mismo contrato. Devuelve los tramos ya guardados (con id real). SECURITY DEFINER por '
  'el mismo motivo que actualizar_estado_emision_contrato() — ver comentario de cabecera '
  'de la migración 157.';

revoke all on function public.guardar_tramos_contrato(text, jsonb) from public;
revoke all on function public.guardar_tramos_contrato(text, jsonb) from anon;
grant execute on function public.guardar_tramos_contrato(text, jsonb) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- 5) ventas_vuelo_sistema — aerolínea desde contrato_vuelos, estado de
--    emisión real, estado de pago derivado de las CxP aéreas reales
-- ═════════════════════════════════════════════════════════════════════════
-- Se re-declara COMPLETA (no se puede ALTER una columna suelta de una
-- vista). Todas las columnas de la versión anterior se conservan tal cual;
-- se agregan: `aerolinea` deja de ser solo `v.aerolinea` (pasa a
-- coalesce(tramo, ventas) — respaldo histórico), `estado_emision`,
-- `estado_pago`, `cxp_aereas_total`, `cxp_aereas_pagadas`.
create or replace view public.ventas_vuelo_sistema as
  select
    v.numero_contrato, v.tenant, v.tipo_paquete,
    -- Aerolínea: PRIMERO contrato_vuelos (dato estructurado, llenado por el
    -- formulario de vuelos por tramo), ventas.aerolinea SOLO como respaldo
    -- histórico (contratos sin contrato_vuelos, o con contrato_vuelos sin
    -- aerolinea cargada todavía).
    coalesce(ida.aerolinea, reg.aerolinea, v.aerolinea) as aerolinea,
    v.fecha_salida, v.fecha_regreso, v.empaquetado_ref_id,
    case when v.empaquetado_ref_id is not null then 'empaquetado' else 'dinamico' end as origen,
    coalesce(ida.record, reg.record) as record,
    ida.origen_codigo, ida.destino_codigo,
    case
      when ida.origen_codigo is not null and ida.destino_codigo is not null then
        ida.origen_codigo || ' - ' || ida.destino_codigo
        || case when reg.destino_codigo is not null then ' - ' || reg.destino_codigo else '' end
      else null
    end as ruta,
    ida.numero_vuelo as vuelo_ida,
    reg.numero_vuelo as vuelo_regreso,
    ida.hora_salida as hora_salida_ida,
    ida.hora_llegada as hora_llegada_ida,
    reg.hora_salida as hora_salida_reg,
    reg.hora_llegada as hora_llegada_reg,
    ida.fecha_salida as vuelo_fecha_ida,
    reg.fecha_salida as vuelo_fecha_regreso,
    -- Estado de emisión REAL del contrato (tabla 1:1, migración 157) — null
    -- si el contrato todavía no tiene fila de control ("Por confirmar").
    cvc.estado_emision,
    -- Estado de pago derivado de las CxP aéreas reales (nunca hardcodeado a
    -- null, nunca por texto/ILIKE) — misma fórmula que GestionTabs.tsx
    -- (saldo = valor_total - pagado - retenido; pagada = saldo<=0 y
    -- valor_total>0). Sin CxP aéreas → null; todas pagadas → 'pagado';
    -- alguna con saldo (incl. pago parcial) → 'pendiente'. Nunca expone un
    -- valor monetario — solo el estado y dos conteos.
    cxp_aer.total as cxp_aereas_total,
    cxp_aer.pagadas as cxp_aereas_pagadas,
    case
      when coalesce(cxp_aer.total, 0) = 0 then null
      when cxp_aer.pagadas = cxp_aer.total then 'pagado'
      else 'pendiente'
    end as estado_pago
  from public.ventas v
  left join lateral (
    -- Prefiere el tramo etiquetado 'ida'; si NINGÚN tramo trae esa etiqueta
    -- (ej. un itinerario multi-ciudad donde todos quedaron "Suelto"), cae al
    -- de menor `orden` entre los que no son 'regreso' — así el resumen nunca
    -- sale completamente en blanco solo porque nadie marcó una 'ida'
    -- explícita, aunque el contrato SÍ tenga tramos cargados.
    select cv.record, cv.origen_codigo, cv.destino_codigo, cv.numero_vuelo,
           cv.hora_salida, cv.hora_llegada, cv.fecha_salida, cv.aerolinea
      from public.contrato_vuelos cv
     where cv.numero_contrato = v.numero_contrato and cv.direccion is distinct from 'regreso'
     order by (case when cv.direccion = 'ida' then 0 else 1 end), cv.orden asc, cv.id asc
     limit 1
  ) ida on true
  left join lateral (
    select cv.record, cv.numero_vuelo, cv.destino_codigo,
           cv.hora_salida, cv.hora_llegada, cv.fecha_salida, cv.aerolinea
      from public.contrato_vuelos cv
     where cv.numero_contrato = v.numero_contrato and cv.direccion = 'regreso'
     order by cv.orden asc, cv.id asc
     limit 1
  ) reg on true
  left join public.contrato_vuelo_control cvc on cvc.numero_contrato = v.numero_contrato
  left join lateral (
    select
      count(*) as total,
      count(*) filter (
        where greatest(0, cp.valor_total - coalesce(pg.pagado, 0) - coalesce(rt.retenido, 0)) <= 0
          and cp.valor_total > 0
      ) as pagadas
    from public.cuentas_por_pagar cp
    left join lateral (select sum(x.valor) as pagado from public.cxp_pagos x where x.cuenta_por_pagar_id = cp.id) pg on true
    left join lateral (select sum(x.valor) as retenido from public.retenciones_cxp x where x.cuenta_por_pagar_id = cp.id) rt on true
    where cp.numero_contrato = v.numero_contrato and cp.tipo_proveedor = 'aereo'
  ) cxp_aer on true
  where (v.tipo_paquete = 'dinamico' or v.empaquetado_ref_id is not null)
    and public.acceso_ventas_vuelo_sistema(v.tenant);

grant select on public.ventas_vuelo_sistema to authenticated;

commit;
