-- ROLLBACK 319 (#32). Se NIEGA si ya hay logos registrados o archivos en el bucket (no se destruye evidencia). Un script, una transacción.
--
-- B7 — PROTEGIDO CONTRA ESCRITORES CONCURRENTES: (1) espera ACOTADA (5 s) por el candado; (2) candado ACCESS EXCLUSIVE sobre aliado_logos ANTES de contar (espera a las transacciones en curso y
-- bloquea a las nuevas hasta el final); (3) solo entonces se cuenta y se borra. Si el candado no se obtiene en 5 s el script falla sin cambiar nada.
-- LÍMITE HONESTO: los archivos de storage.objects no se pueden bloquear aquí (Supabase aloja ese esquema): la guarda mira los archivos YA confirmados. Una subida en vuelo (archivo subido y fila aún sin registrar)
-- puede no verse; esa persona recibirá un error al registrar (la función ya no existe) y el archivo quedará huérfano en el bucket, sin perder ningún logo ya registrado.
-- IMPACTO: mientras corre, subir/retirar logos y leerlos esperan (milisegundos); después fallan por «no existe».
begin;
set local lock_timeout = '5s';
do $$
begin
  if to_regclass('public.aliado_logos') is not null then
    lock table public.aliado_logos in access exclusive mode;
  end if;
end $$;
do $$
begin
  if to_regclass('public.aliado_logos') is not null and exists (select 1 from public.aliado_logos) then
    raise exception 'ROLLBACK_319_RECHAZADO: hay logos de aliados registrados; no se elimina la tabla.';
  end if;
  if exists (select 1 from storage.objects where bucket_id = 'aliado-logos') then
    raise exception 'ROLLBACK_319_RECHAZADO: el bucket aliado-logos tiene archivos; no se elimina.';
  end if;
end $$;
drop function if exists public.retirar_logo_aliado(uuid, bigint);
drop function if exists public.registrar_logo_aliado(uuid, bigint, text, text, integer, text);
drop function if exists public.p319_actor_puede(uuid, bigint);
drop table if exists public.aliado_logos;
drop index if exists public.idx_comision_plan_cotizacion;
-- El bucket aliado-logos NO se borra aquí: el Supabase alojado prohíbe el DELETE directo sobre las tablas de storage (hay que vaciarlo/eliminarlo por la API de Storage o el panel). Queda vacío y la 319 lo reutiliza si se vuelve a aplicar.
commit;
