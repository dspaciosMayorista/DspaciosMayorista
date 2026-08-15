-- ───────────────────────────────────────────────────────────────────────────
-- 151 · VUELOS — control general por record: modalidad, emisión y pago
--
-- QUÉ AGREGA
--   Tres campos MANUALES a nivel de `bloqueos_vuelo` (todo el record, no una
--   silla puntual), independientes del estado de las sillas:
--
--     modalidad_emision  'individual' | 'grupo'   — cómo se emite el vuelo.
--     estado_emision     'pendiente'  | 'emitido'  — si YA se emitió el vuelo.
--     estado_pago        'pendiente'  | 'pagado'   — si YA se le pagó al
--                         proveedor/aerolínea. **NO** es el pago del cliente
--                         (eso vive en `abonos`/`cuentas_por_pagar` por
--                         contrato) — deliberadamente no se cruza con eso.
--
-- POR QUÉ NO UN DEFAULT 'pendiente'
--   Un registro CREADO ANTES de esta migración no tiene forma de saber si ya
--   se emitió o se pagó — nadie cargó ese dato porque el campo no existía.
--   Si la columna naciera con `default 'pendiente'`, Postgres aplicaría ese
--   valor a TODAS las filas existentes (desde la v11, `add column ... default`
--   es metadata-only pero el efecto lógico es el mismo: toda fila vieja
--   quedaría mostrando 'pendiente'), afirmando algo que no se sabe. Las tres
--   columnas nacen sin default (`null`) — la UI muestra "Sin definir"/"Por
--   confirmar" para null, nunca "Pendiente". Un bloqueo NUEVO sí nace con
--   `estado_emision`/`estado_pago = 'pendiente'`, pero eso lo decide la
--   aplicación en el INSERT (`crearBloqueo`/`cargarBloqueosMasivo`), no un
--   default de columna — ahí sí es una afirmación verdadera: un record recién
--   creado genuinamente empieza pendiente.
--
-- MODALIDAD: sin default en absoluto, ni siquiera en bloqueos nuevos — el
--   formulario de creación la exige (`crearBloqueo` valida y rechaza si falta
--   o no es 'individual'/'grupo'). No hay un valor neutral razonable para
--   "modalidad no elegida" salvo null/"Sin definir".
--
-- QUÉ NO CAMBIA
--   No se toca `fecha_emision` (columna existente desde la 003): sigue siendo
--   la fecha LÍMITE/programada para emitir, no una prueba de que YA se emitió
--   — por eso NO se deduce `estado_emision='emitido'` de que `fecha_emision`
--   exista o haya pasado. La UI la renombra visualmente a "Fecha límite de
--   emisión" para que la distinción quede clara, sin tocar la columna.
--   No se recalculan tarifarios al cambiar solo estos tres campos (a
--   diferencia de `actualizarBloqueo`/`registrarCambioOperacional`, que sí
--   afectan tarifa/fechas del paquete armado).
--
-- REGISTRO DE CAMBIOS
--   Igual que los cambios operacionales (horario/vuelo, migración 070): cada
--   cambio por la pestaña "Control" se loguea en `bloqueo_cambios` con
--   antes→después, quién y cuándo — vía la Server Action
--   `actualizarControlBloqueo`, NO un trigger de BD (mismo patrón que
--   `registrarCambioOperacional`, para poder resolver "quién" desde la sesión
--   igual que ya hace esa función).
--
-- RLS: sin cambios. Estas tres columnas viven en `bloqueos_vuelo`, que ya
--   tiene su policy de escritura (superadmin/administracion/gerencia/
--   operaciones/control_vuelo, migración 137) — una columna nueva en una
--   tabla existente hereda esa policy automáticamente, Postgres no tiene RLS
--   por columna.
-- ───────────────────────────────────────────────────────────────────────────

alter table public.bloqueos_vuelo
  add column if not exists modalidad_emision text,
  add column if not exists estado_emision    text,
  add column if not exists estado_pago       text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'bloqueos_vuelo_modalidad_emision_check'
  ) then
    alter table public.bloqueos_vuelo
      add constraint bloqueos_vuelo_modalidad_emision_check
      check (modalidad_emision in ('individual', 'grupo'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'bloqueos_vuelo_estado_emision_check'
  ) then
    alter table public.bloqueos_vuelo
      add constraint bloqueos_vuelo_estado_emision_check
      check (estado_emision in ('pendiente', 'emitido'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'bloqueos_vuelo_estado_pago_check'
  ) then
    alter table public.bloqueos_vuelo
      add constraint bloqueos_vuelo_estado_pago_check
      check (estado_pago in ('pendiente', 'pagado'));
  end if;
end $$;

comment on column public.bloqueos_vuelo.modalidad_emision is
  'Individual o grupo. Obligatoria en registros nuevos (validada en crearBloqueo); '
  'null en registros anteriores a esta migración = "Sin definir" en la UI, nunca se infiere. Migración 151.';
comment on column public.bloqueos_vuelo.estado_emision is
  'Si el vuelo YA se emitió (independiente de fecha_emision, que es solo el límite). '
  'null = "Por confirmar" (no se sabe), distinto de ''pendiente'' (se sabe que falta). Migración 151.';
comment on column public.bloqueos_vuelo.estado_pago is
  'Si YA se pagó al proveedor/aerolínea. NO es el pago del cliente (abonos/cuentas_por_pagar '
  'son por contrato, esto es por record). null = "Por confirmar". Migración 151.';
