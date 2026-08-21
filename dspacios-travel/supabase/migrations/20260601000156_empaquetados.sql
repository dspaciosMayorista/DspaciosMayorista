-- ───────────────────────────────────────────────────────────────────────────
-- 156 · VUELOS — inventario de EMPAQUETADOS (tarifas de Sistema)
--
-- ⚠️ EDITADA (revisión de PR #268, defectos 1 y 4 — 155/156/157 aún no se
-- habían corrido, así que se corrige el archivo existente en vez de crear
-- una migración 158 solo para esto):
--   · CHECK `tarifario_resultado_origen_excluyente_check`: impide que una
--     fila tenga `bloqueo_id` Y `empaquetado_id` a la vez (defecto 1, "ORIGEN
--     DOBLE"). Segura de agregar sin revisar histórico: `empaquetado_id` es
--     nueva en esta misma migración, 100% NULL en lo existente.
--   · `ventas.empaquetado_ref_id` (FK nullable a `empaquetados`) + CHECK
--     `ventas_origen_excluyente_check` (mutuamente excluyente con
--     `bloqueo_ref_id`) — trazabilidad fuerte venta→empaquetado (defecto 4).
--     Misma razón: columna nueva, histórico trivialmente en NULL.
--   · `ventas_basica` (vista de la 148, ya en producción) se re-declara para
--     exponer `empaquetado_ref_id` — no se puede alterar una columna suelta
--     de una vista.
-- Ver `lib/reservar/origen.ts` (el discriminante que hace que estas dos
-- columnas nunca lleguen pobladas a la vez desde la aplicación) y el reporte
-- de la ronda de corrección en el PR para el detalle completo.
--
-- ⚠️ EDITADA OTRA VEZ (ronda siguiente, hallazgo 1 "AISLAMIENTO DE
-- GERENCIA"): la vista `ventas_vuelo_sistema` (agregada en la edición
-- anterior de este mismo archivo) usaba `puede_ver_tenant()`, que le da a
-- `gerencia` alcance GLOBAL — para esta vista puntual se pidió que `gerencia`
-- quede acotada a SU tenant (solo `superadmin` es global), sin tocar
-- `puede_ver_tenant()` en general. Se agrega la función dedicada
-- `acceso_ventas_vuelo_sistema(t text)` y la vista pasa a usarla — ver el
-- comentario junto a la definición de la vista, más abajo, para el detalle
-- completo. Aditivo dentro de la misma migración 156, sigue sin ejecutarse.
--
-- QUÉ ES
--   Una salida aérea comprada/cotizada POR SISTEMA (sin cupo negociado con
--   la aerolínea) que la agencia usa para armar promociones. A diferencia de
--   `bloqueos_vuelo` (cupo negociado, silla por silla, con `sillas`):
--     · puede no tener record/PNR todavía (se agrega después, al comprar/
--       emitir) — `record` es NULLABLE, a propósito, sin default.
--     · NO representa cupos negociados ni garantizados — no genera filas en
--       `sillas` (ningún trigger, ninguna Server Action de este archivo lo
--       hace; la garantía la da el código de aplicación, ver PR).
--     · puede existir ANTES de vincularse a un paquete/promoción — por eso
--       NO hay una columna `paquete_id` propietaria en esta tabla (a
--       diferencia de `salidas_dinamicas.paquete_id`, que SÍ es NOT NULL y
--       dueño único — ver la nota de diseño abajo).
--     · se vincula a uno o más paquetes vía una tabla de enlace N:M
--       (`armado_empaquetados`), exactamente el mismo patrón ya usado por
--       `armado_vuelos` para bloqueos negociados (migración 018) — así se
--       reutiliza sin copiar manualmente los datos del vuelo.
--
-- POR QUÉ NO SE EVOLUCIONÓ `salidas_dinamicas` (decisión de diseño)
--   `salidas_dinamicas.paquete_id` es `not null references armado_paquetes
--   (id) on delete cascade` — dueño único obligatorio, y las 8 llamadas que
--   la usan hoy (`generarTarifario`, `SalidasDinamicasEditor`, el costeo y
--   snapshot en `reservar/actions.ts`) asumen esa propiedad. Convertirla en
--   un inventario independiente habría exigido quitarle el NOT NULL,
--   inventar una tabla de enlace de todas formas, y agregarle columnas
--   (`proveedor_id`, `vuelo_ida`/`vuelo_regreso`, `estado_emision`/
--   `estado_pago`) ajenas a su propósito actual (insumo de precio para el
--   motor de un paquete dinámico puntual) — inflando una tabla acotada en
--   una tabla híbrida precio+control operativo. Una tabla nueva, con el
--   patrón de enlace N:M que YA existe en este esquema (`armado_vuelos`),
--   da la propiedad "existe antes de la promoción, se reutiliza sin
--   duplicar" sin tocar el motor de paquetes dinámicos que ya está en
--   producción. El motor de liquidación (`generarTarifario`, rama
--   `tipo='dinamico'`) SÍ se reutiliza — solo cambia el origen de los datos,
--   no la matemática (fuera del alcance de esta migración, es cambio de
--   aplicación).
--
-- MODALIDAD: "Sistema" es la modalidad IMPLÍCITA de toda fila de esta tabla
--   cuando se muestra fusionada en Control Vuelos — NO hay una columna
--   `modalidad` aquí. `bloqueos_vuelo.modalidad_emision` (serie/grupo, ver
--   migración 155) y "Sistema" (esta tabla) son conceptualmente la misma
--   idea de negocio pero vive en dos lugares distintos porque describen dos
--   tipos de fila estructuralmente distintos (con/sin sillas negociadas).
--
-- ESTADO DE EMISIÓN/PAGO: mismos dos campos y mismos dos valores que
--   `bloqueos_vuelo` (migración 152) — `estado_emision` ('pendiente'|
--   'emitido'), `estado_pago` ('pendiente'|'pagado'). Sin default (null =
--   "Por confirmar" en la UI, nunca se infiere 'pendiente' para una fila que
--   no dice nada de sí misma) — mismo razonamiento que la 152: no afirmar lo
--   que no se sabe.
--
-- TARIFA: `tarifa_proveedor` (neto, lo que cobra el proveedor/plataforma) +
--   `tarifa_para_empaquetar` (precio de reventa, ya con margen) — mismo
--   patrón de dos columnas que `bloqueos_vuelo.tarifa_neta`/
--   `tarifa_para_empaquetar`, no el mecanismo de `aplica_mk`/`ta` dinámico
--   de `salidas_dinamicas` (ese mecanismo sigue existiendo, sin cambios, en
--   su tabla — no se duplica ni se reemplaza aquí).
--
-- RLS: mismo criterio que `bloqueos_vuelo` (migración 005/137) para la
--   tabla de inventario — lectura también para `venta` (necesita verla al
--   armar/consultar), escritura sin `venta`. Para la tabla de enlace
--   `armado_empaquetados`, mismo criterio que `armado_vuelos` (migración
--   018) — "el armado es interno", sin `venta` ni `control_vuelo` (arma
--   operación/administración/gerencia, no vende ni controla vuelos).
--
-- BORRADO SEGURO (revisión de PR #268, defecto 4): `armado_empaquetados.
--   empaquetado_id` usa `on delete restrict` (NO `cascade`). Un empaquetado
--   vinculado a uno o más paquetes NO se puede borrar — Postgres rechaza el
--   DELETE con un error de FK antes de que llegue a borrar nada; la Server
--   Action (`eliminarEmpaquetado`) revisa esto de antemano y devuelve un
--   mensaje con la lista de paquetes que lo usan, para no depender solo del
--   mensaje crudo de Postgres. `paquete_id` SÍ sigue en `cascade` (borrar un
--   paquete completo debe limpiar sus propios enlaces — eso no cambia; es
--   la simetría inversa: el paquete es dueño del enlace, el empaquetado no).
--
-- TRAZABILIDAD (defecto 8): `empaquetado_cambios` + el RPC
--   `actualizar_control_empaquetado()` replican EXACTAMENTE el patrón de
--   `bloqueo_cambios`/`actualizar_control_bloqueo()` (migración 152): SELECT
--   ... FOR UPDATE + UPDATE + INSERT en una sola transacción, actor resuelto
--   con `auth.uid()` dentro de la función, SIN `security definer` ni
--   `service_role` — corre con el rol del que llama, sujeto a las mismas
--   policies de `empaquetados`/`empaquetado_cambios`.
--
-- VALIDACIÓN (defecto 6): además de la validación en cliente/servidor
--   (Server Action), estos CHECK a nivel de Postgres son la última línea de
--   defensa — nunca confían solo en que el formulario ponga `min="0"`:
--     · tarifa_proveedor/tarifa_para_empaquetar/fee_infante >= 0.
--     · fecha_regreso >= fecha_ida cuando fecha_regreso no es null.
--     · compra_fin >= compra_inicio cuando ambas no son null.
--
-- ATOMICIDAD: todo el archivo en una transacción explícita
-- (`begin`/`commit`) — aditiva pura (nunca falla salvo un problema real de
-- esquema), pero se envuelve igual por consistencia con el resto de
-- migraciones recientes de este repo y para que un fallo a mitad de camino
-- nunca deje una tabla creada sin su RLS o sus policies.
--
-- ROLLBACK PROBADO: `supabase/scripts/rollback_156_empaquetados.sql`.
-- ───────────────────────────────────────────────────────────────────────────

begin;

create table if not exists public.empaquetados (
  id                    bigserial primary key,
  record                text,                              -- PNR opcional; se agrega después de comprar/emitir.
  aerolinea             text,
  proveedor_id          bigint references public.proveedores(id),
  destino_id            bigint references public.destinos(id),
  ruta                  text,                              -- IATA: "MDE - CTG - MDE"
  origen                text,                              -- código IATA de origen
  vuelo_ida             text,
  fecha_ida             date not null,
  hora_salida_ida       text,
  hora_llegada_ida      text,
  vuelo_regreso         text,
  fecha_regreso         date,
  hora_salida_reg       text,
  hora_llegada_reg      text,
  tarifa_proveedor      numeric(15,2) not null default 0,  -- neto del proveedor/sistema
  tarifa_para_empaquetar numeric(15,2) not null default 0, -- precio de reventa (con margen)
  fee_infante           numeric(15,2) not null default 0,  -- 0-1.99 años
  compra_inicio         date,                              -- vigencia de compra (rotación de oferta)
  compra_fin            date,
  estado_emision        text,                              -- 'pendiente' | 'emitido'; null = "Por confirmar"
  estado_pago           text,                              -- 'pendiente' | 'pagado';  null = "Por confirmar"
  notas                 text,
  activo                boolean not null default true,     -- apagar sin borrar (ej. agotado/retirado de venta)
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

alter table public.empaquetados
  add constraint empaquetados_estado_emision_check
  check (estado_emision in ('pendiente', 'emitido'));
alter table public.empaquetados
  add constraint empaquetados_estado_pago_check
  check (estado_pago in ('pendiente', 'pagado'));

-- Validación de valores monetarios y de fechas (defecto 6) — última línea de
-- defensa, no depende de que el formulario/Server Action no se salte nada.
alter table public.empaquetados
  add constraint empaquetados_tarifas_no_negativas_check
  check (tarifa_proveedor >= 0 and tarifa_para_empaquetar >= 0 and fee_infante >= 0);
alter table public.empaquetados
  add constraint empaquetados_fechas_vuelo_check
  check (fecha_regreso is null or fecha_regreso >= fecha_ida);
alter table public.empaquetados
  add constraint empaquetados_fechas_compra_check
  check (compra_inicio is null or compra_fin is null or compra_fin >= compra_inicio);

create index if not exists idx_empaquetados_destino    on public.empaquetados(destino_id);
create index if not exists idx_empaquetados_fecha_ida  on public.empaquetados(fecha_ida);
create index if not exists idx_empaquetados_activo     on public.empaquetados(activo);

comment on table public.empaquetados is
  'Inventario comercial de salidas aéreas por SISTEMA (sin cupo negociado, sin sillas): '
  'record opcional, puede existir antes de vincularse a un paquete. Modalidad "Sistema" '
  'implícita (no es una columna). Migración 156.';
comment on column public.empaquetados.record is
  'PNR opcional — null hasta que se compra/emite. La UI muestra "Sin record", nunca error.';
comment on column public.empaquetados.estado_emision is
  'Si YA se emitió (independiente de compra_fin). null = "Por confirmar", nunca se infiere ''pendiente''.';
comment on column public.empaquetados.estado_pago is
  'Si YA se pagó al proveedor/plataforma. null = "Por confirmar", nunca se infiere ''pendiente''.';

-- ── Enlace N:M con paquetes — mismo patrón que armado_vuelos ───────────────
-- Un empaquetado puede vincularse a más de un paquete a la vez sin
-- duplicarse (reutilización real); desvincular es un DELETE de esta tabla,
-- nunca borra el empaquetado en sí.
create table if not exists public.armado_empaquetados (
  paquete_id     bigint not null references public.armado_paquetes(id) on delete cascade,
  -- on delete RESTRICT (no cascade, a diferencia de armado_vuelos): borrar un
  -- empaquetado vinculado a un paquete debe fallar explícitamente, nunca
  -- arrastrar en silencio el enlace — ver "BORRADO SEGURO" arriba.
  empaquetado_id bigint not null references public.empaquetados(id) on delete restrict,
  aplica_mk      boolean not null default true,
  ta             numeric(15,2) not null default 0,
  primary key (paquete_id, empaquetado_id)
);
create index if not exists idx_armado_empaquetados_empaquetado on public.armado_empaquetados(empaquetado_id);

comment on table public.armado_empaquetados is
  'Enlace N:M entre paquetes y empaquetados (mismo patrón que armado_vuelos para bloqueos '
  'negociados) — nunca duplica la fila de empaquetados al vincularla a un paquete. '
  'empaquetado_id es ON DELETE RESTRICT (no cascade): un empaquetado en uso no se puede '
  'borrar. Migración 156.';

-- ── Historial de cambios operativos + guardado atómico ──────────────────────
-- Mismo patrón EXACTO que bloqueo_cambios/actualizar_control_bloqueo
-- (migración 152) — ver la nota "TRAZABILIDAD" arriba.
create table if not exists public.empaquetado_cambios (
  id              bigserial primary key,
  empaquetado_id  bigint not null references public.empaquetados(id) on delete cascade,
  detalle         text,
  nota            text,
  registrado_por  text,
  created_at      timestamptz not null default now()
);
create index if not exists idx_empaquetado_cambios_empaquetado on public.empaquetado_cambios(empaquetado_id, created_at desc);

comment on table public.empaquetado_cambios is
  'Historial de cambios operativos de un empaquetado (modalidad implícita "Sistema", '
  'estado de emisión/pago, record, tarifas) — mismo patrón que bloqueo_cambios. Migración 156.';

-- ── Guardado atómico del control operativo + su historial ───────────────────
-- Copia línea por línea de actualizar_control_bloqueo (migración 152), ver
-- la nota "TRAZABILIDAD" arriba: SIN `security definer`, actor resuelto por
-- `auth.uid()` dentro de la función, SELECT...FOR UPDATE + UPDATE + INSERT
-- en una sola transacción.
create or replace function public.actualizar_control_empaquetado(
  p_empaquetado_id  bigint,
  p_record          text,
  p_estado_emision  text,
  p_estado_pago     text,
  p_nota            text
)
returns void
language plpgsql
as $$
declare
  v_record_antes    text;
  v_emision_antes   text;
  v_pago_antes      text;
  v_detalle         text := '';
  v_registrado_por  text;
  v_record_norm     text := nullif(trim(upper(p_record)), '');
begin
  if p_estado_emision is not null and p_estado_emision not in ('pendiente', 'emitido') then
    raise exception 'Estado de emisión inválido.';
  end if;
  if p_estado_pago is not null and p_estado_pago not in ('pendiente', 'pagado') then
    raise exception 'Estado de pago inválido.';
  end if;

  select record, estado_emision, estado_pago
    into v_record_antes, v_emision_antes, v_pago_antes
    from public.empaquetados
   where id = p_empaquetado_id
     for update;

  if not found then
    raise exception 'Empaquetado no encontrado o sin permiso para verlo.';
  end if;

  if coalesce(v_record_antes, '') <> coalesce(v_record_norm, '') then
    v_detalle := v_detalle || (case when v_detalle <> '' then ' · ' else '' end)
      || 'Record: ' || coalesce(v_record_antes, 'Sin record') || ' → ' || coalesce(v_record_norm, 'Sin record');
  end if;

  if coalesce(v_emision_antes, '') <> coalesce(p_estado_emision, '') then
    v_detalle := v_detalle || (case when v_detalle <> '' then ' · ' else '' end)
      || 'Estado de emisión: '
      || coalesce(case v_emision_antes when 'pendiente' then 'Pendiente' when 'emitido' then 'Emitido' end, 'Por confirmar')
      || ' → '
      || coalesce(case p_estado_emision when 'pendiente' then 'Pendiente' when 'emitido' then 'Emitido' end, 'Por confirmar');
  end if;

  if coalesce(v_pago_antes, '') <> coalesce(p_estado_pago, '') then
    v_detalle := v_detalle || (case when v_detalle <> '' then ' · ' else '' end)
      || 'Estado de pago: '
      || coalesce(case v_pago_antes when 'pendiente' then 'Pendiente' when 'pagado' then 'Pagado' end, 'Por confirmar')
      || ' → '
      || coalesce(case p_estado_pago when 'pendiente' then 'Pendiente' when 'pagado' then 'Pagado' end, 'Por confirmar');
  end if;

  if v_detalle = '' and coalesce(trim(p_nota), '') = '' then
    raise exception 'No hay cambios para registrar.';
  end if;

  if v_detalle <> '' then
    update public.empaquetados
       set record = v_record_norm,
           estado_emision = p_estado_emision,
           estado_pago = p_estado_pago,
           updated_at = now()
     where id = p_empaquetado_id;

    if not found then
      raise exception 'No se pudo actualizar el empaquetado (sin permiso de escritura).';
    end if;
  end if;

  select coalesce(u.nombre, u.email) into v_registrado_por
    from public.usuarios u
   where u.id = auth.uid();

  insert into public.empaquetado_cambios (empaquetado_id, detalle, nota, registrado_por)
  values (p_empaquetado_id, nullif(v_detalle, ''), nullif(trim(p_nota), ''), v_registrado_por);
end;
$$;

comment on function public.actualizar_control_empaquetado(bigint, text, text, text, text) is
  'Actualiza record/estado de emisión/estado de pago de un empaquetado y registra el cambio '
  'en empaquetado_cambios en UNA sola transacción (SELECT ... FOR UPDATE + UPDATE + INSERT) — '
  'si el INSERT del historial falla, el UPDATE también se revierte. SIN security definer: '
  'corre con el rol del que llama, sujeta a las mismas policies de empaquetados/empaquetado_cambios. '
  'p_estado_emision/p_estado_pago NULL = "Por confirmar", se conserva NULL (nunca se fuerza '
  'a ''pendiente''). Migración 156.';

revoke all on function public.actualizar_control_empaquetado(bigint, text, text, text, text) from public;
grant execute on function public.actualizar_control_empaquetado(bigint, text, text, text, text) to authenticated;

-- ── Provenance en el tarifario (defecto 2): de dónde salió cada fila ────────
-- Mismo patrón que `salida_id` (migración 094, paquete dinámico): una fila de
-- `tarifario_resultado` de un paquete tipo 'bloqueo' puede venir de un
-- `bloqueo_id` (cupo negociado) O de un `empaquetado_id` (tarifa de Sistema)
-- — nunca ambos a la vez. `modulo` se queda en 'bloqueo' para las dos
-- fuentes (no se agrega un valor de enum nuevo): la distinción de negocio ya
-- la da inequívocamente cuál de las dos columnas está poblada.
alter table public.tarifario_resultado
  add column if not exists empaquetado_id bigint references public.empaquetados(id);
create index if not exists idx_tarifario_resultado_empaquetado on public.tarifario_resultado(empaquetado_id);
comment on column public.tarifario_resultado.empaquetado_id is
  'Origen "Sistema" de la fila (tabla empaquetados) cuando el módulo es ''bloqueo'' pero NO '
  'viene de un bloqueo negociado — mutuamente excluyente con bloqueo_id. Migración 156.';

-- CHECK mínimo (revisión de PR #268, defecto 1 "ORIGEN DOBLE"): una fila de
-- `tarifario_resultado` nunca puede tener `bloqueo_id` Y `empaquetado_id` a
-- la vez — son dos fuentes de vuelo mutuamente excluyentes por diseño (ver
-- el comentario de columna de arriba). Es SEGURA de agregar sin revisar
-- datos históricos: `empaquetado_id` es una columna nueva de ESTA misma
-- migración, así que el 100% de las filas existentes la tiene en NULL antes
-- de que este ALTER corra — el CHECK se satisface trivialmente para todo lo
-- que ya existe. Deliberadamente NO se extiende a `salida_id` (paquete
-- dinámico, migración 094): una exclusión de 3 columnas exigiría revisar el
-- uso histórico real de `salida_id` primero, y el pedido explícito fue el
-- mínimo — bloqueo_id/empaquetado_id.
alter table public.tarifario_resultado
  drop constraint if exists tarifario_resultado_origen_excluyente_check;
alter table public.tarifario_resultado
  add constraint tarifario_resultado_origen_excluyente_check
  check (not (bloqueo_id is not null and empaquetado_id is not null));

-- ── Trazabilidad venta → empaquetado (defecto 4) ────────────────────────────
-- `ventas.bloqueo_ref_id` (migración 022) es la única relación fuerte que
-- existía con el origen del vuelo — un contrato reservado desde un
-- Empaquetado no dejaba NINGÚN rastro estructural de cuál fue. Mismo patrón
-- exacto que `bloqueo_ref_id`: FK nullable, sin ON DELETE (un empaquetado no
-- se puede borrar si está referenciado por una venta real — ver el CHECK de
-- abajo, que además impide que las dos referencias convivan).
alter table public.ventas
  add column if not exists empaquetado_ref_id bigint references public.empaquetados(id);
create index if not exists idx_ventas_empaquetado_ref on public.ventas(empaquetado_ref_id);
comment on column public.ventas.empaquetado_ref_id is
  'Empaquetado de origen del vuelo de este contrato (si lo hay) — excluyente '
  'con bloqueo_ref_id (CHECK ventas_origen_excluyente_check). NULL en '
  'contratos sin vuelo o con vuelo negociado (bloqueo_ref_id) o dinámico '
  '(sin columna de referencia — ver "Novedades" del handoff). Migración 156.';

-- Misma razón que el CHECK de `tarifario_resultado`: `empaquetado_ref_id` es
-- nueva en esta migración, 100% NULL en todo lo existente — el CHECK se
-- satisface trivialmente para el histórico, sin necesidad de revisarlo antes.
alter table public.ventas
  drop constraint if exists ventas_origen_excluyente_check;
alter table public.ventas
  add constraint ventas_origen_excluyente_check
  check (not (bloqueo_ref_id is not null and empaquetado_ref_id is not null));

-- `ventas_basica` (vista de la migración 148, ya en producción) se
-- re-declara COMPLETA con la única columna nueva agregada
-- (`empaquetado_ref_id`, junto a `bloqueo_ref_id`) — no se puede alterar una
-- columna suelta de una vista. El resto queda IDÉNTICO a como lo dejó la 148
-- (enmascarado de `cliente_documento`/`cliente_direccion`/`asesor_firma_cc`/
-- `share_token` incluido). `venta` navega así del contrato al Empaquetado de
-- origen sin necesitar la tabla base `ventas`.
drop view if exists public.ventas_basica;
create view public.ventas_basica as
  select
    v.numero_contrato, v.fecha_venta, v.asesor, v.canal, v.tipo_cliente,
    v.cliente,
    case
      when public.mi_rol() <> 'venta' or public.soy_asesor_del_contrato(v.numero_contrato)
        then v.cliente_documento
      when v.cliente_documento is null then null
      when length(v.cliente_documento) <= 4 then '••••'
      else '••••' || right(v.cliente_documento, 4)
    end as cliente_documento,
    v.cliente_telefono, v.cliente_email,
    v.destino, v.tipo_paquete, v.fecha_salida, v.fecha_regreso, v.fecha_emision,
    v.pax, v.hotel, v.aerolinea, v.receptivo, v.asistencia, v.otros_proveedores,
    v.precio_venta, v.moneda, v.estado, v.facturado, v.numero_documento,
    v.plan_nombre, v.tours_traslados, v.asistencia_medica, v.plazo,
    v.tipo_asesor, v.agencia_nombre, v.agencia_asesor, v.freelance_nombre, v.aliado_id,
    v.asesor_firma_nombre, v.asesor_firma_cargo, v.asesor_firma_tel,
    v.paquete_armado_id, v.bloqueo_ref_id, v.empaquetado_ref_id, v.tenant,
    case
      when public.mi_rol() <> 'venta' or public.soy_asesor_del_contrato(v.numero_contrato)
        then v.cliente_direccion
      else null
    end as cliente_direccion,
    case
      when public.mi_rol() <> 'venta' or public.soy_asesor_del_contrato(v.numero_contrato)
        then v.asesor_firma_cc
      else null
    end as asesor_firma_cc,
    case
      when public.mi_rol() <> 'venta' or public.soy_asesor_del_contrato(v.numero_contrato)
        then v.share_token
      else null
    end as share_token,
    v.created_at, v.updated_at
  from public.ventas v
  where
    public.mi_rol() in ('superadmin','gerencia')
    or (public.mi_rol() in ('administracion','operaciones','venta')
        and public.puede_ver_tenant(v.tenant));

grant select on public.ventas_basica to authenticated;

-- ── Vista mínima: inventario aéreo "por sistema" para el módulo Vuelos ──────
-- (hallazgo 2 de la revisión posterior al PR #268, "LISTA UNIFICADA Y RLS").
-- `/dashboard/vuelos` (pestaña Empaquetados) necesita mostrar records de
-- contratos reales (dinámicos, o reservados desde un Empaquetado) junto a
-- las tarifas promocionales — antes consultaba `public.ventas` directo con
-- el cliente de SESIÓN. `control_vuelo` SÍ entra al módulo Vuelos
-- (lib/constants.ts, LECTURA_MODULO) pero NO tiene NINGUNA policy de SELECT
-- sobre `ventas` (la única lectura operativa de esa tabla, migración 116,
-- es superadmin/gerencia/administracion/operaciones) — así que para
-- control_vuelo la consulta devolvía 0 filas por RLS, sin error, y la
-- pestaña se veía incompleta según el rol, sin ningún aviso. `venta` no
-- entra a este módulo en absoluto (bloqueado por `proxy.ts`/nav) — se deja
-- fuera del set de roles a propósito, no por omisión.
--
-- Mismo patrón que `ventas_basica`/`abonos_resumen`/`contrato_vuelos_basica`:
-- una vista NO es "security definer" per se, pero al no tener `authenticated`
-- ningún GRANT directo sobre la tabla base, el único camino de lectura es
-- A TRAVÉS de esta vista — y su propio `where` (que sí evalúa `mi_rol()`/
-- `puede_ver_tenant()` con la sesión REAL del que llama, porque esas
-- funciones leen `request.jwt.claims`, un ajuste de sesión, no de rol de
-- Postgres) ES la frontera de acceso.
--
-- Expone SOLO lo que un contrato dinámico/empaquetado realmente tiene de
-- vuelo — numero_contrato, tenant (filtrado), aerolínea, fechas, origen
-- (dinámico/empaquetado) y empaquetado_ref_id — NUNCA cliente, precio,
-- costo, comisión ni ningún otro dato financiero o personal de `ventas`.
-- Incluye AMBOS orígenes: `tipo_paquete='dinamico'` (sin empaquetado_ref_id,
-- ese tipo de contrato nunca lo tiene) Y cualquier contrato con
-- `empaquetado_ref_id` poblado (nace con `tipo_paquete='bloqueo'`, no
-- 'dinamico' — se perdería si el filtro fuera solo por tipo_paquete).
--
-- ⚠️ AISLAMIENTO ESTRICTO POR TENANT (hallazgo 1 de la ronda siguiente,
-- "AISLAMIENTO DE GERENCIA"): la primera versión de esta vista reutilizaba
-- `public.puede_ver_tenant()` — la misma función que usa el resto del
-- sistema (`ventas`, `ventas_basica`, etc.), donde `gerencia` tiene alcance
-- GLOBAL a propósito (migración 107). Para ESTA vista puntual (inventario
-- operativo de vuelos, no la ficha financiera del contrato) se pidió que
-- `gerencia` quede acotada a SU tenant, igual que administracion/
-- operaciones/control_vuelo, y que SOLO `superadmin` conserve alcance
-- global — así que NO se puede usar `puede_ver_tenant()` aquí sin cambiar su
-- comportamiento para TODO el resto del sistema (algo que no se pidió y que
-- rompería garantías ya probadas en otras vistas/policies). Se define una
-- función DEDICADA en su lugar, nunca se toca `puede_ver_tenant()`.
--
-- Comportamiento exacto (ver `test_empaquetados.sql`, sección I, para la
-- matriz completa por rol):
--   · superadmin                                    → alcance global.
--   · gerencia / administracion / operaciones /
--     control_vuelo                                 → SOLO su propio tenant
--     (`mi_tenant() = t`), nunca el de la otra agencia.
--   · cualquier otro rol (incl. `venta`, excluido a propósito)  → 0 filas.
--   · `mi_rol()` ya devuelve NULL si el usuario está inactivo o no tiene
--     fila en `public.usuarios` (migración 140, `mi_rol()` filtra
--     `activo`) — con NULL, ninguna rama de este `or` es verdadera, así que
--     un perfil ausente/inactivo obtiene 0 filas sin necesitar un caso
--     aparte aquí.
create or replace function public.acceso_ventas_vuelo_sistema(t text) returns boolean
  language sql stable security definer set search_path = public as $$
  select
    public.mi_rol() = 'superadmin'
    or (
      public.mi_rol() in ('gerencia','administracion','operaciones','control_vuelo')
      and public.mi_tenant() = t
    );
$$;

-- ⚠️ SECURITY DEFINER conserva por defecto EXECUTE para PUBLIC (ronda
-- siguiente, hallazgo 2 "FUNCIÓN SECURITY DEFINER") — cualquier rol de
-- Postgres (incl. `anon`, incl. cualquier función SQL de otro módulo que no
-- debería poder colarse) podía invocarla DIRECTO como RPC
-- (`select public.acceso_ventas_vuelo_sistema('mayorista')` o
-- `/rest/v1/rpc/acceso_ventas_vuelo_sistema`), aunque el resultado (un solo
-- boolean, sin datos) no filtre nada por sí mismo. Mismo patrón YA usado en
-- este mismo repo para `acceso_archivo_contratos()` (migración 150): revocar
-- de PUBLIC y otorgar el mínimo indispensable a `authenticated` (nunca a
-- `anon`) — la vista de abajo sigue funcionando igual para los roles
-- autorizados porque una vista normal (sin `security_invoker`) evalúa el
-- acceso a los objetos que referencia (tablas, funciones) con los privilegios
-- del DUEÑO de la vista, no con los del rol que la consulta — el rol que
-- consulta solo necesita SELECT sobre la VISTA misma (el `grant select`, más
-- abajo). Verificado con una prueba SQL real (`test_empaquetados.sql`,
-- sección I): `anon` no puede invocar la función ni por RPC directo ni a
-- través de la vista; `authenticated` sigue viendo exactamente su tenant a
-- través de la vista, nunca más.
revoke all on function public.acceso_ventas_vuelo_sistema(text) from public;
grant execute on function public.acceso_ventas_vuelo_sistema(text) to authenticated;

-- ⚠️ AMPLIADA (ronda siguiente, hallazgo 1 "CONECTAR CONTRATO_VUELOS CON LA
-- LISTA"): la versión anterior de esta vista solo traía columnas planas de
-- `ventas` — origen_codigo/destino_codigo/ruta/vuelo_ida/vuelo_regreso/
-- horarios quedaban siempre NULL aunque `contrato_vuelos` ya tuviera esos
-- datos (para contratos dinámicos NUEVOS, que sí insertan `contrato_vuelos`
-- desde la salida dinámica — ver la ronda anterior, hallazgo 5). Ahora la
-- vista trae también el detalle aéreo MÍNIMO desde `contrato_vuelos`, vía dos
-- `LEFT JOIN LATERAL` (uno para el tramo `direccion='ida'`, otro para
-- `direccion='regreso'`) — cada uno con `order by orden, id limit 1` para
-- garantizar EXACTAMENTE una fila por dirección incluso si un contrato
-- llegara a tener más de un tramo por sentido (multi-ciudad futuro): nunca
-- se duplica la fila de `ventas`, y nunca se mezclan tramos de DOS contratos
-- distintos (el join siempre filtra por `cv.numero_contrato = v.numero_contrato`).
-- Contratos SIN `contrato_vuelos` (todo el histórico dinámico anterior a esta
-- función, y cualquier contrato futuro cuyo origen no sea bloqueo/empaquetado/
-- salida) devuelven NULL en todas estas columnas — nunca se inventa un dato.
--
-- `ruta` se construye de forma DETERMINISTA a partir de los códigos IATA del
-- propio tramo — NUNCA parseando un string ajeno: `origen–destino` (ida) y,
-- si existe tramo de regreso, se le agrega `–destino_regreso` (que en un
-- viaje redondo normal coincide con el origen de la ida) — mismo formato
-- "MDE - CTG - MDE" que ya usa `bloqueos_vuelo.ruta`/`empaquetados.ruta`.
--
-- `record` sale del tramo (nunca se inventa si no existe) — no se enmascara
-- por rol aquí: a diferencia de `contrato_vuelos_basica` (donde `venta` sí
-- entra y el PNR ajeno es sensible), esta vista YA excluye a `venta` por
-- completo, y los roles que sí quedan (superadmin/gerencia/administracion/
-- operaciones/control_vuelo) ya tienen SELECT directo sobre `bloqueos_vuelo`
-- (con su propio `record`) sin ningún enmascarado — mismo criterio de
-- exposición ya aplicado a esos roles en el resto del módulo Vuelos.
--
-- Las fechas de cada tramo (`vuelo_fecha_ida`/`vuelo_fecha_regreso`) se traen
-- APARTE de `fecha_salida`/`fecha_regreso` (que siguen viniendo de `ventas`,
-- sin cambios, y ya las usa `vuelos/page.tsx`) — nunca se asume que ambas
-- fuentes van a coincidir siempre; son columnas nuevas, no un reemplazo.
--
-- Cero PII, cero valores financieros (sin cambios respecto a la versión
-- anterior): `contrato_vuelos` no tiene ninguna columna de cliente/costo/
-- precio que pudiera colarse por accidente con un `select *` — se listan
-- las columnas una por una, igual que el resto de esta vista.
create or replace view public.ventas_vuelo_sistema as
  select
    v.numero_contrato, v.tenant, v.tipo_paquete, v.aerolinea,
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
    reg.fecha_salida as vuelo_fecha_regreso
  from public.ventas v
  left join lateral (
    select cv.record, cv.origen_codigo, cv.destino_codigo, cv.numero_vuelo,
           cv.hora_salida, cv.hora_llegada, cv.fecha_salida
      from public.contrato_vuelos cv
     where cv.numero_contrato = v.numero_contrato and cv.direccion = 'ida'
     order by cv.orden asc, cv.id asc
     limit 1
  ) ida on true
  left join lateral (
    select cv.record, cv.numero_vuelo, cv.destino_codigo,
           cv.hora_salida, cv.hora_llegada, cv.fecha_salida
      from public.contrato_vuelos cv
     where cv.numero_contrato = v.numero_contrato and cv.direccion = 'regreso'
     order by cv.orden asc, cv.id asc
     limit 1
  ) reg on true
  where (v.tipo_paquete = 'dinamico' or v.empaquetado_ref_id is not null)
    and public.acceso_ventas_vuelo_sistema(v.tenant);

grant select on public.ventas_vuelo_sistema to authenticated;

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.empaquetados        enable row level security;
alter table public.armado_empaquetados enable row level security;
alter table public.empaquetado_cambios enable row level security;

drop policy if exists "empaquetados: lectura operativa" on public.empaquetados;
create policy "empaquetados: lectura operativa"
  on public.empaquetados for select
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta','control_vuelo'));

drop policy if exists "empaquetados: escritura control" on public.empaquetados;
create policy "empaquetados: escritura control"
  on public.empaquetados for all
  using (public.mi_rol() in ('superadmin','administracion','gerencia','operaciones','control_vuelo'))
  with check (public.mi_rol() in ('superadmin','administracion','gerencia','operaciones','control_vuelo'));

drop policy if exists "armado_empaquetados: interno" on public.armado_empaquetados;
create policy "armado_empaquetados: interno"
  on public.armado_empaquetados for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones'))
  with check (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones'));

-- Mismo criterio que bloqueo_cambios: lectura para quien controla vuelos,
-- escritura SOLO por el RPC (que corre como el rol del caller, no necesita
-- policy de INSERT aparte fuera de la que ya cubre "control").
drop policy if exists "empaquetado_cambios: lectura control" on public.empaquetado_cambios;
create policy "empaquetado_cambios: lectura control"
  on public.empaquetado_cambios for select
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta','control_vuelo'));

drop policy if exists "empaquetado_cambios: escritura control" on public.empaquetado_cambios;
create policy "empaquetado_cambios: escritura control"
  on public.empaquetado_cambios for insert
  with check (public.mi_rol() in ('superadmin','administracion','gerencia','operaciones','control_vuelo'));

commit;
