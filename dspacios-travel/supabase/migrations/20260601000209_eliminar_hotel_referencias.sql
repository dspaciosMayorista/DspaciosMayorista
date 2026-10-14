-- ═══════════════════════════════════════════════════════════════════════════
-- Migración 209 (número reservado por Coordinación en exclusiva para el borrado
-- seguro de hoteles). Rama fix/eliminar-hotel-referencias.
--
-- armado_hoteles.hotel_id: ON DELETE CASCADE  →  ON DELETE RESTRICT
--
-- Problema: borrar un hotel del catálogo que está marcado en el armado de un
-- paquete (armado_hoteles) lo QUITABA del paquete en silencio (CASCADE, 018).
-- Ningún borrado debe quitar un hotel de un paquete sin que nadie lo decida.
-- Con RESTRICT, un hotel en el armado de cualquier paquete no se puede borrar:
-- hay que desmarcarlo del paquete primero (la app ya guía ese paso).
--
-- Por qué RESTRICT y no NO ACTION: RESTRICT se comprueba al instante y no
-- puede diferirse; es la intención ("bloquear") escrita en el propio esquema.
-- (tarifario_resultado.hotel_id ya bloquea el borrado: NO ACTION desde 018.)
--
-- Carrera "vincular hotel a paquete" vs "eliminar hotel": el INSERT en
-- armado_hoteles toma FOR KEY SHARE sobre la fila del hotel y el DELETE
-- necesita FOR UPDATE sobre ella, así que se serializan: o el DELETE gana y el
-- INSERT falla por FK (sin vínculo huérfano), o el INSERT gana y el DELETE
-- falla por RESTRICT (el hotel sigue en el paquete). Probado en
-- supabase/scripts/test_209_eliminar_hotel_referencias.sh con dos sesiones reales.
--
-- ADITIVA en datos (no toca filas), IDEMPOTENTE, TRANSACCIONAL. Solo cambia la
-- acción de borrado de UNA clave foránea; el resto de FK a hoteles (tarifas,
-- temporadas, fotos…, que sí son datos propios del hotel) no cambia.
-- DROP CONSTRAINT toma ACCESS EXCLUSIVE en armado_hoteles; ADD FOREIGN KEY
-- toma SHARE ROW EXCLUSIVE también en hoteles. El bloqueo de armado_hoteles
-- se mantiene hasta el COMMIT, incluida la revalidación de la FK. Ejecutar
-- en una ventana de baja actividad: lock_timeout limita solo la espera para
-- adquirir bloqueos, no la duración de la revalidación.
-- Rollback: supabase/scripts/rollback_209_eliminar_hotel_referencias.sql
-- ═══════════════════════════════════════════════════════════════════════════
begin;
set local lock_timeout = '5s';

do $$
declare
  v_oid   oid;
  v_name  text;
  v_del   "char";
  v_n     int;
begin
  if to_regclass('public.armado_hoteles') is null or to_regclass('public.hoteles') is null then
    raise exception 'armado_hoteles/hoteles no existen: la base no tiene la migración 018';
  end if;

  -- La FK de armado_hoteles(hotel_id) → hoteles(id), por definición (no por nombre).
  select count(*) into v_n
    from pg_constraint c
    where c.conrelid = 'public.armado_hoteles'::regclass
      and c.confrelid = 'public.hoteles'::regclass
      and c.contype = 'f'
      and c.conkey = array[(select attnum from pg_attribute
                              where attrelid = 'public.armado_hoteles'::regclass and attname = 'hotel_id')];
  if v_n <> 1 then
    raise exception 'se esperaba exactamente 1 FK armado_hoteles.hotel_id → hoteles, hay %', v_n;
  end if;

  select c.oid, c.conname, c.confdeltype into v_oid, v_name, v_del
    from pg_constraint c
    where c.conrelid = 'public.armado_hoteles'::regclass
      and c.confrelid = 'public.hoteles'::regclass
      and c.contype = 'f'
      and c.conkey = array[(select attnum from pg_attribute
                              where attrelid = 'public.armado_hoteles'::regclass and attname = 'hotel_id')];

  if v_del = 'r' then
    raise notice 'armado_hoteles.hotel_id ya es ON DELETE RESTRICT: nada que hacer';
    return;
  end if;
  if v_del <> 'c' then
    raise exception 'armado_hoteles.hotel_id tiene confdeltype % (se esperaba CASCADE o RESTRICT); revisar a mano', v_del;
  end if;

  lock table public.hoteles, public.armado_hoteles in share row exclusive mode;
  execute format('alter table public.armado_hoteles drop constraint %I', v_name);
  alter table public.armado_hoteles
    add constraint armado_hoteles_hotel_id_fkey
    foreign key (hotel_id) references public.hoteles(id) on delete restrict;
end $$;

-- Postcheck dentro de la misma transacción: si no quedó RESTRICT, aborta todo.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'armado_hoteles_hotel_id_fkey'
      and conrelid = 'public.armado_hoteles'::regclass
      and confrelid = 'public.hoteles'::regclass
      and confdeltype = 'r' and convalidated
  ) then
    raise exception 'postcheck: armado_hoteles_hotel_id_fkey no quedó ON DELETE RESTRICT validada';
  end if;
end $$;

commit;
