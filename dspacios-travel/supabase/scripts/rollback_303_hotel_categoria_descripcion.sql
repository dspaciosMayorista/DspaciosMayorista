-- Rollback 303 (#45). Borra los textos escritos desde la 303: si hay alguno, se detiene salvo confirmación explícita.
do $$
declare n int;
begin
  select count(*) into n from public.hotel_categorias where descripcion is not null or incluye is not null;
  if n > 0 and coalesce(current_setting('rollback303.confirmar', true), '') <> 'si' then
    raise exception 'rollback_303: % fila(s) con descripción o «qué incluye» se perderían. Ejecuta antes: set rollback303.confirmar = ''si'';', n;
  end if;
end $$;

alter table public.hotel_categorias drop constraint if exists hotel_categorias_textos_check;
alter table public.hotel_categorias drop column if exists incluye;
alter table public.hotel_categorias drop column if exists descripcion;
