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
  empaquetado_id bigint not null references public.empaquetados(id) on delete cascade,
  aplica_mk      boolean not null default true,
  ta             numeric(15,2) not null default 0,
  primary key (paquete_id, empaquetado_id)
);
create index if not exists idx_armado_empaquetados_empaquetado on public.armado_empaquetados(empaquetado_id);

comment on table public.armado_empaquetados is
  'Enlace N:M entre paquetes y empaquetados (mismo patrón que armado_vuelos para bloqueos '
  'negociados) — nunca duplica la fila de empaquetados al vincularla a un paquete. Migración 156.';

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.empaquetados        enable row level security;
alter table public.armado_empaquetados enable row level security;

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

commit;
