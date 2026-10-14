-- Rollback de la migración 209 (eliminar_hotel_referencias).
-- Rollback de la 209: vuelve armado_hoteles.hotel_id a ON DELETE CASCADE.
-- Solo si de verdad se quiere recuperar el comportamiento anterior (borrar un
-- hotel lo quita en silencio de los paquetes que lo tengan marcado).
begin;
set local lock_timeout = '5s';
lock table public.hoteles, public.armado_hoteles in share row exclusive mode;
alter table public.armado_hoteles drop constraint if exists armado_hoteles_hotel_id_fkey;
alter table public.armado_hoteles
  add constraint armado_hoteles_hotel_id_fkey
  foreign key (hotel_id) references public.hoteles(id) on delete cascade;
commit;
