-- #25 (ADL-039) — La corrección de una ficha por gerencia/superadmin (UPDATE con la SESIÓN de quien corrige, condicionado a lo que vio) deja auditoría con ACTOR y antes/después,
-- y el UPDATE condicionado no toca ninguna fila si el campo cambió entretanto. Sobre la base REAL (copia desechable con 001-317). Una transacción, termina en ROLLBACK.
-- Uso: docker exec -i <ct> psql -U supabase_admin -d <base> -v ON_ERROR_STOP=1 -f - < supabase/scripts/test_25_correccion_auditoria.sql
-- ESTADO: ejecutada sobre la cadena REAL de migraciones en Postgres embebido (pglite, entorno simulado de Supabase) en la ronda de verificación del 2026-11-20; sobre el contenedor Docker real NO ejecutada.
begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000025101', 'ger25@x.test') on conflict do nothing;
insert into public.usuarios (id, email, nombre, rol, activo, tenant)
values ('00000000-0000-0000-0000-000000025101', 'ger25@x.test', 'Gerente 25', 'gerencia', true, 'mayorista')
on conflict (id) do update set rol = 'gerencia', activo = true, tenant = 'mayorista', nombre = 'Gerente 25';
-- Sesión VIVA de la gerente (la política restrictiva de catálogos globales exige session_id en el JWT y la fila en auth.sessions: agencia_activa_sesion()).
insert into auth.sessions (id, user_id) values ('00000000-0000-0000-0000-000000925102', '00000000-0000-0000-0000-000000025101') on conflict do nothing;
insert into public.aliados (id, nombre, tipo, nit, tipo_documento, telefono, email) values (925101, 'Laura 25 Gomes', 'freelance', '925101', 'CC', '3001112222', 'l25@x.test');

do $$
declare n_ok int; n_stale int; a record; n_fila int;
begin
  -- Se actúa como la sesión de gerencia (rol de base `authenticated`; auth.uid() sale de request.jwt.claim.sub).
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000025101', true);
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000025101","role":"authenticated","session_id":"00000000-0000-0000-0000-000000925102"}', true);
  set local role authenticated;

  -- 1) Corrección con el valor esperado correcto: exactamente 1 fila.
  with u as (update public.aliados set nombre = 'Laura 25 Gómez', telefono = '3009998888'
             where id = 925101 and nombre = 'Laura 25 Gomes' and telefono = '3001112222' returning id)
  select count(*) into n_ok from u;
  if n_ok <> 1 then raise exception 'FALLO: la corrección con valores esperados correctos debía tocar 1 fila y tocó %', n_ok; end if;

  -- 2) Edición desfasada (el teléfono ya no es el que se vio): 0 filas, nada cambia.
  with u as (update public.aliados set telefono = '3115550000' where id = 925101 and telefono = '3001112222' returning id)
  select count(*) into n_stale from u;
  if n_stale <> 0 then raise exception 'FALLO: un UPDATE condicionado a un valor viejo no debe tocar filas (tocó %)', n_stale; end if;
  reset role;

  select * into a from public.aliados where id = 925101;
  if a.telefono <> '3009998888' or a.nombre <> 'Laura 25 Gómez' then raise exception 'FALLO: los datos no son los de la corrección válida: % / %', a.nombre, a.telefono; end if;

  -- 3) Auditoría: una fila UPDATE con el actor real (correo y rol) y los campos cambiados con antes/después; la corrección desfasada no dejó nada.
  select count(*) into n_fila from public.auditoria
   where tabla = 'aliados' and registro_id = '925101' and accion = 'UPDATE'
     and actor_email = 'ger25@x.test' and actor_rol = 'gerencia'
     and cambios -> 'nombre' ->> 'antes' = 'Laura 25 Gomes' and cambios -> 'nombre' ->> 'despues' = 'Laura 25 Gómez'
     and cambios -> 'telefono' ->> 'antes' = '3001112222' and cambios -> 'telefono' ->> 'despues' = '3009998888';
  if n_fila <> 1 then raise exception 'FALLO: se esperaba 1 fila de auditoría con actor gerencia y antes/después; hay %', n_fila; end if;
  select count(*) into n_fila from public.auditoria where tabla = 'aliados' and registro_id = '925101' and accion = 'UPDATE';
  if n_fila <> 1 then raise exception 'FALLO: el UPDATE sin efecto no debe auditar; filas UPDATE=%', n_fila; end if;
  raise notice 'OK: corrección auditada con actor y antes/después; el UPDATE condicionado a un valor viejo no toca ni audita';
end $$;
rollback;
