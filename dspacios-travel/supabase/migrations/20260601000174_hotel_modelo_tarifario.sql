-- ───────────────────────────────────────────────────────────────────────────
-- 174 · MODELO TARIFARIO DEL HOTEL (persona | unidad)
--
-- QUÉ RESUELVE
-- Un hotel administra su tarifa con UN SOLO editor a la vez: el de siempre
-- ("Tarifa neta" por categoría/régimen/temporada, columnas fijas por
-- acomodación en `tarifa_hotel`) o el nuevo de fase 2 Bernalo ("Tarifas por
-- unidad", `hotel_tarifas_unidad`, migración 173). Hasta ahora no había
-- ningún campo que dijera cuál de los dos está activo para un hotel dado —
-- esta migración agrega esa única decisión.
--
-- `hoteles.modelo_tarifario` es EXCLUSIVAMENTE un interruptor de qué EDITOR
-- se muestra en la pantalla de administración de producto. No decide nada
-- de cotización: ni el tarifario público, ni Reservar, ni el motor de
-- paquetes leen esta columna en esta entrega — ambos motores (`tarifa_hotel`
-- por un lado, `lib/calc/unidadAlojamiento.ts` + `hotel_tarifas_unidad` por
-- el otro) siguen sin estar integrados a ningún flujo comercial. Cambiar el
-- valor de esta columna NO inserta, actualiza ni borra una sola fila de
-- `tarifa_hotel` ni de `hotel_tarifas_unidad`: son datos independientes que
-- persisten intactos sin importar qué editor esté activo en un momento dado.
--
-- DEFAULT 'persona' — decisión deliberada, no un descuido: TODOS los hoteles
-- existentes hoy administran su tarifa por persona (el único editor que
-- existía antes de la fase 2). Un `not null default 'persona'` sobre una
-- columna nueva backfillea automáticamente cada fila ya existente sin
-- tocarla ni requerir un UPDATE aparte, y ningún hotel queda "sin modelo".
--
-- ADITIVA, IDEMPOTENTE y TRANSACCIONAL (`begin`/`commit`, mismo criterio que
-- 126/154/163/164/169/172/173): la columna se agrega con `add column if not
-- exists` y el CHECK se agrega solo si no existe ya, con verificación de
-- definición compatible en vez de asumir a ciegas (mismo patrón que la 163).
--
-- Preflight / postcheck / rollback en `supabase/scripts/` (174). Deben
-- verificarse contra una base Postgres local desechable antes de aplicar la
-- migración fuera de desarrollo.
-- ───────────────────────────────────────────────────────────────────────────

begin;

do $$
declare
  v_tipo text;
  v_nullable text;
  v_default text;
begin
  select data_type, is_nullable, column_default
    into v_tipo, v_nullable, v_default
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'hoteles'
     and column_name = 'modelo_tarifario';

  if found and (
    v_tipo is distinct from 'text'
    or v_nullable is distinct from 'NO'
    or v_default is distinct from '''persona''::text'
  ) then
    raise exception 'ABORTADO: hoteles.modelo_tarifario existe con una definicion incompatible (tipo=%, nullable=%, default=%).', v_tipo, v_nullable, v_default;
  end if;
end $$;

alter table public.hoteles
  add column if not exists modelo_tarifario text not null default 'persona';

do $$
declare
  v_def text;
begin
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint
   where conname = 'hoteles_modelo_tarifario_check'
     and conrelid = 'public.hoteles'::regclass;

  if not found then
    alter table public.hoteles
      add constraint hoteles_modelo_tarifario_check
      check (modelo_tarifario in ('persona', 'unidad'));
  elsif v_def is distinct from 'CHECK ((modelo_tarifario = ANY (ARRAY[''persona''::text, ''unidad''::text])))' then
    raise exception 'ABORTADO: el CHECK hoteles_modelo_tarifario_check existe con otra definicion: %.', v_def;
  end if;
end $$;

comment on column public.hoteles.modelo_tarifario is
  'Decisión comercial: qué editor de tarifas está activo para este hotel — persona (default, tarifa_hotel: columnas fijas por acomodación) | unidad (fase 2 Bernalo, hotel_tarifas_unidad: payload por unidadCobro persona/pareja/habitación/apartamento). Un hotel usa UN SOLO editor/modelo activo a la vez; esta columna no participa en ninguna cotización ni integración comercial, solo decide qué pantalla de administración de producto se muestra. Cambiarla no inserta, actualiza ni borra filas de tarifa_hotel ni de hotel_tarifas_unidad — ambos conjuntos de datos persisten intactos.';

commit;
