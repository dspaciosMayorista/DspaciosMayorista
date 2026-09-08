-- ───────────────────────────────────────────────────────────────────────────
-- 169 · DESCRIPCIÓN MANUAL DEL PAQUETE (incluye/no incluye/tarifas especiales/
-- condiciones comerciales)
--
-- Reemplaza la generación automática de "Incluye" (hoy armada en tiempo de
-- consulta a partir de `armado_servicios.incluido=true` + líneas fijas de
-- "Tiquete aéreo"/"Hospedaje en <hotel>", ver lib/tarifario/datos.ts y
-- lib/tarifario/resumen.ts) por CUATRO campos de texto libre configurados UNA
-- sola vez en el paquete (`armado_paquetes`) y compartidos por todos sus
-- hoteles/opciones — el contenido pertenece al paquete, nunca al hotel.
--
-- Cada campo es texto plano, un elemento por línea (sin HTML ni encabezados
-- embebidos); la UI convierte cada línea no vacía en un ítem de lista bajo un
-- encabezado fijo, y omite la sección completa si está vacía.
--
-- NO se toca `programas` (circuitos multi-ciudad de proveedor): ese módulo ya
-- tiene su propio editor manual de inclusiones por fila
-- (`programa_inclusiones`, migración 031) — evidencia revisada antes de
-- escribir esta migración; no se duplica ni se reemplaza.
--
-- Aditiva, idempotente (`add column if not exists`) y transaccional
-- (`begin`/`commit`, mismo criterio que 126/154/164). No agrega ni cambia
-- políticas RLS: `armado_paquetes` ya tiene RLS por fila (migración 137,
-- `alinear_roles_escritura`) — estas 4 columnas nuevas quedan cubiertas por
-- esas mismas policies (RLS filtra FILAS, no columnas) sin ningún cambio
-- adicional.
--
-- Preflight / postcheck / rollback en supabase/scripts/ (169). Verificado
-- ÚNICAMENTE contra una base Postgres local desechable
-- (supabase/scripts/pruebas/local-desde-cero.sh) — NUNCA contra Supabase real.
-- ───────────────────────────────────────────────────────────────────────────

begin;

alter table public.armado_paquetes
  add column if not exists programa_incluye               text,
  add column if not exists programa_no_incluye             text,
  add column if not exists programa_tarifas_especiales     text,
  add column if not exists programa_condiciones_comerciales text;

comment on column public.armado_paquetes.programa_incluye is
  'Texto libre, un elemento por línea (sin HTML). Reemplaza la lista "Incluye" auto-generada. Compartido por todos los hoteles/opciones del paquete.';
comment on column public.armado_paquetes.programa_no_incluye is
  'Texto libre, un elemento por línea (sin HTML). Compartido por todos los hoteles/opciones del paquete.';
comment on column public.armado_paquetes.programa_tarifas_especiales is
  'Texto libre, un elemento por línea (sin HTML). Compartido por todos los hoteles/opciones del paquete.';
comment on column public.armado_paquetes.programa_condiciones_comerciales is
  'Texto libre, un elemento por línea (sin HTML). Compartido por todos los hoteles/opciones del paquete.';

commit;
