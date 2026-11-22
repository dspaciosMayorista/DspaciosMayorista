-- ROLLBACK de la 324 (#62 B5/B6). Retirar PRIMERO el código de registro que llama a registro_b2b_* (si no, el registro falla por «función inexistente»).
-- Se NIEGA si hay algún registro EN CURSO (pendiente, verificado sin completar o descartando): borrar la tabla perdería la protección de «cuenta verificada no se descarta»
-- y los datos del formulario aún no convertidos en solicitud. Los registros «completado» no se pierden (ya viven en b2b_solicitudes) y se pueden borrar.
-- B7: espera ACOTADA (5 s) y candado ACCESS EXCLUSIVE sobre la tabla ANTES de mirar si hay registros en curso (así uno que se esté creando ahora se ve y se rechaza); una transacción.
begin;
set local lock_timeout = '5s';
do $$ begin
  if to_regclass('public.registro_b2b_estado') is not null then
    lock table public.registro_b2b_estado in access exclusive mode;
  end if;
end $$;
do $$ begin
  if to_regclass('public.registro_b2b_estado') is not null and exists (select 1 from public.registro_b2b_estado where estado <> 'completado') then
    raise exception 'ROLLBACK 324 detenido: hay registros B2B en curso (no completados); no se elimina la tabla de estado.';
  end if;
end $$;
drop function if exists public.registro_b2b_completar(uuid, jsonb);
drop function if exists public.registro_b2b_permitir_reenvio(uuid);
drop function if exists public.registro_b2b_descartar(uuid);
drop function if exists public.registro_b2b_resolver_intento(uuid, text, integer);
drop function if exists public.registro_b2b_reclamar_intento(uuid, integer, integer);
drop function if exists public.registro_b2b_iniciar(uuid, jsonb);
drop function if exists public.p324_borrar_sin_verificar(uuid);
drop function if exists public.p324_correo_confirmado(uuid);
drop table if exists public.registro_b2b_estado;
commit;
