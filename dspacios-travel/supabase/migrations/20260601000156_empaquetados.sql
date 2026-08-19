-- ───────────────────────────────────────────────────────────────────────────
-- 156 · VUELOS — inventario de EMPAQUETADOS (tarifas de Sistema)
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
