-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- PRUEBAS SQL · #32 (migración 319). Logo del aliado: tabla privada + RPC con segunda llave del actor. SOLO base desechable.
-- Una transacción; termina en ROLLBACK. Uso (desde supabase/scripts):  psql -v ON_ERROR_STOP=1 -f test_319_aliado_logo.sql <base>
-- Exige las migraciones hasta la 319 aplicadas. Reutiliza las fixtures de usuarios de la 216.
-- ESTADO DE EJECUCIÓN: 35/35 sobre un Postgres embebido (pglite) con esquema STUB (ver supabase/scripts/pglite_319_parcial.mjs); sobre el ESQUEMA COMPLETO (Docker) NO ejecutado todavía.
--   Ver docs/tecnico/b2b-32-logo-aliado-2026-11-20.md.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
begin;
\ir test_216_fixtures.sql

do $$ begin
  if to_regprocedure('public.registrar_logo_aliado(uuid,bigint,text,text,integer,text)') is null then raise exception 'test_319 exige la 319 aplicada.'; end if;
end $$;

insert into public.aliados (id, nombre, nit, tipo) values (933201, 'C319 Freelance', '933201', 'freelance'), (933202, 'C319 Agencia', '933202', 'agencia');
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000319001', 'c319-laura@x.test'), ('00000000-0000-4000-8000-000000319002', 'c319-sol@x.test'),
  ('00000000-0000-4000-8000-000000319003', 'c319-agente@x.test'), ('00000000-0000-4000-8000-000000319004', 'c319-inactiva@x.test') on conflict do nothing;
insert into public.usuarios (id, email, nombre, rol, activo, tenant, aliado_id, agencia_id) values
  ('00000000-0000-4000-8000-000000319001', 'c319-laura@x.test', 'C319 Laura', 'freelance', true, 'mayorista', 933201, null),
  ('00000000-0000-4000-8000-000000319002', 'c319-sol@x.test', 'C319 Sol', 'agencia', true, 'mayorista', 933202, null),
  ('00000000-0000-4000-8000-000000319003', 'c319-agente@x.test', 'C319 Agente', 'agencia', true, 'mayorista', 933202, '00000000-0000-4000-8000-000000319002'),
  ('00000000-0000-4000-8000-000000319004', 'c319-inactiva@x.test', 'C319 Inactiva', 'freelance', false, 'mayorista', 933201, null)
on conflict (id) do update set rol = excluded.rol, activo = excluded.activo, aliado_id = excluded.aliado_id, agencia_id = excluded.agencia_id;

create schema t319;
create function t319.laura() returns uuid language sql immutable as $$ select '00000000-0000-4000-8000-000000319001'::uuid $$;
create function t319.sol() returns uuid language sql immutable as $$ select '00000000-0000-4000-8000-000000319002'::uuid $$;
create function t319.agente() returns uuid language sql immutable as $$ select '00000000-0000-4000-8000-000000319003'::uuid $$;
create function t319.inactiva() returns uuid language sql immutable as $$ select '00000000-0000-4000-8000-000000319004'::uuid $$;
create function t319.sha(p text) returns text language sql immutable as $$ select repeat(p, 64) $$;   -- 64 caracteres hexadecimales
-- Llama a la RPC como service_role (el servidor), devolviendo el jsonb como texto o 'ERR …'.
create function t319.reg(p_actor uuid, p_aliado bigint, p_sha text) returns jsonb language plpgsql as $$
declare v text;
begin
  v := t216.escalar('service_role', null, format('select public.registrar_logo_aliado(%L, %s, %L, ''image/png'', 10, %L)::text', p_actor, p_aliado, p_aliado || '/' || p_sha || '.png', p_sha));
  return case when v like 'ERR %' then jsonb_build_object('error', v) else v::jsonb end;
end $$;
create function t319.ret(p_actor uuid, p_aliado bigint) returns jsonb language plpgsql as $$
declare v text;
begin
  v := t216.escalar('service_role', null, format('select public.retirar_logo_aliado(%L, %s)::text', p_actor, p_aliado));
  return case when v like 'ERR %' then jsonb_build_object('error', v) else v::jsonb end;
end $$;
create function t319.vig(p_aliado bigint) returns bigint language sql stable as $$ select count(*) from public.aliado_logos where aliado_id = p_aliado and vigente $$;
create function t319.tot(p_aliado bigint) returns bigint language sql stable as $$ select count(*) from public.aliado_logos where aliado_id = p_aliado $$;

\echo '--- A. Quién puede registrar (la base vuelve a verificar al actor, aunque el servidor ya lo hizo)'
do $$
declare r jsonb;
begin
  r := t319.reg(t319.laura(), 933201, t319.sha('a'));
  perform t216.afirma('A1 la titular freelance registra el logo de SU ficha', (r->>'ok')::boolean and (r->>'sin_cambio')::boolean is false and t319.vig(933201) = 1, r::text);
  r := t319.reg(t319.laura(), 933202, t319.sha('a'));
  perform t216.afirma('A2 la freelance NO puede registrar el logo de OTRA ficha', r->>'codigo' = 'no_autorizado' and t319.tot(933202) = 0, r::text);
  r := t319.reg(t319.sol(), 933202, t319.sha('b'));
  perform t216.afirma('A3 la titular de la agencia registra el de su ficha', (r->>'ok')::boolean and t319.vig(933202) = 1, r::text);
  r := t319.reg(t319.agente(), 933202, t319.sha('c'));
  perform t216.afirma('A4 un AGENTE de la agencia (agencia_id no nulo) no lo cambia', r->>'codigo' = 'no_autorizado' and t319.tot(933202) = 1, r::text);
  r := t319.reg(t319.inactiva(), 933201, t319.sha('c'));
  perform t216.afirma('A5 una cuenta inactiva no lo cambia', r->>'codigo' = 'no_autorizado' and t319.tot(933201) = 1, r::text);
  r := t319.reg(t216.u('admin'), 933201, t319.sha('d'));
  perform t216.afirma('A6 administración NO (solo superadmin y gerencia)', r->>'codigo' = 'no_autorizado', r::text);
  r := t319.reg(t216.u('ventaA'), 933201, t319.sha('d'));
  perform t216.afirma('A7 venta NO', r->>'codigo' = 'no_autorizado', r::text);
  r := t319.reg(t216.u('inactivo'), 933201, t319.sha('d'));
  perform t216.afirma('A8 personal inactivo NO', r->>'codigo' = 'no_autorizado', r::text);
  r := t319.reg('00000000-0000-4000-8000-0000000fffff', 933201, t319.sha('d'));
  perform t216.afirma('A9 un actor que no existe NO', r->>'codigo' = 'no_autorizado', r::text);
  r := t319.reg(t216.u('super'), 933201, t319.sha('d'));
  perform t216.afirma('A10 superadmin sí (vía interno)', (r->>'ok')::boolean and (select via from public.aliado_logos where aliado_id = 933201 and vigente) = 'interno', r::text);
  r := t319.reg(t216.u('gerencia'), 933202, t319.sha('e'));
  perform t216.afirma('A11 gerencia sí', (r->>'ok')::boolean, r::text);
  r := t319.reg(t216.u('super'), 939999, t319.sha('f'));
  perform t216.afirma('A12 un aliado que no existe ⇒ sin_aliado, nada persistido', r->>'codigo' = 'sin_aliado' and t319.tot(939999) = 0, r::text);
end $$;

\echo '--- B. Vigencia: a lo sumo un logo vigente, historial conservado'
do $$
declare r jsonb; n_antes bigint;
begin
  delete from public.aliado_logos where aliado_id = 933201;
  perform t319.reg(t319.laura(), 933201, t319.sha('1'));
  n_antes := t319.tot(933201);
  r := t319.reg(t319.laura(), 933201, t319.sha('1'));
  perform t216.afirma('B1 el mismo archivo otra vez no cambia nada (sin_cambio, sin fila nueva)', (r->>'sin_cambio')::boolean and t319.tot(933201) = n_antes, r::text);
  r := t319.reg(t319.laura(), 933201, t319.sha('2'));
  perform t216.afirma('B2 otro archivo: el anterior queda NO vigente con su fecha de retiro y el nuevo es el único vigente',
    (r->>'ok')::boolean and t319.vig(933201) = 1 and t319.tot(933201) = 2
    and (select not vigente and retirado_en is not null and retirado_por = t319.laura() from public.aliado_logos where aliado_id = 933201 and sha256 = t319.sha('1')), r::text);
  r := t319.reg(t319.laura(), 933201, t319.sha('1'));
  perform t216.afirma('B3 volver al primero lo reactiva (misma ruta) sin duplicar filas', (r->>'ok')::boolean and t319.vig(933201) = 1 and t319.tot(933201) = 2
    and (select vigente from public.aliado_logos where aliado_id = 933201 and sha256 = t319.sha('1')), r::text);
  r := t319.ret(t319.sol(), 933201);
  perform t216.afirma('B4 otra titular NO retira el logo ajeno y el vigente sigue', r->>'codigo' = 'no_autorizado' and t319.vig(933201) = 1, r::text);
  r := t319.ret(t319.laura(), 933201);
  perform t216.afirma('B5 la titular retira el propio: 0 vigentes y el historial intacto', (r->>'ok')::boolean and (r->>'retirados')::int = 1 and t319.vig(933201) = 0 and t319.tot(933201) = 2, r::text);
  r := t319.ret(t319.laura(), 933201);
  perform t216.afirma('B6 retirar sin logo vigente es inofensivo', (r->>'ok')::boolean and (r->>'retirados')::int = 0, r::text);
end $$;

\echo '--- C. Integridad de la tabla (inserciones directas con la llave de servicio)'
-- Inserta directo como service_role; todos los valores van ya resueltos (el rol no necesita ver los esquemas de prueba).
create function t319.ins(p_path text, p_mime text, p_size int, p_sha text, p_vigente boolean default true) returns text language plpgsql as $$
begin
  return t216.intenta('service_role', null, format('insert into public.aliado_logos (aliado_id, path, mime, size_bytes, sha256, subido_por, via, vigente) values (933201, %L, %L, %s, %L, %L, ''interno'', %L)',
    p_path, p_mime, p_size, p_sha, t216.u('super'), p_vigente));
end $$;
do $$
begin
  perform t216.rechaza('C1 un SVG no entra aunque se inserte directo (check de tipo)', t319.ins('933201/x.svg', 'image/svg+xml', 10, t319.sha('9')), '23514');
  perform t216.rechaza('C2 más de 1 MB no entra', t319.ins('933201/g.png', 'image/png', 1048577, t319.sha('8')), '23514');
  perform t216.rechaza('C3 un hash mal formado no entra', t319.ins('933201/h.png', 'image/png', 10, 'no-es-un-hash'), '23514');
  perform t319.reg(t319.laura(), 933201, t319.sha('3'));
  perform t216.rechaza('C4 dos logos vigentes del mismo aliado son imposibles (índice único parcial)', t319.ins('933201/dos.png', 'image/png', 10, t319.sha('7')), '23505');
  perform t216.rechaza('C5 un logo no vigente exige fecha de retiro (coherencia)', t319.ins('933201/mal.png', 'image/png', 10, t319.sha('6'), false), '23514');
  perform t216.rechaza('C6 no se borra un aliado con logos (FK on delete restrict)', t216.intenta('service_role', null, 'delete from public.aliados where id = 933201'), '23503');
end $$;

\echo '--- D. Lo que ven los roles de la API (anon / authenticated): nada'
do $$
begin
  perform t216.rechaza('D1 anon no lee la tabla', t216.intenta('anon', null, 'select 1 from public.aliado_logos'), '42501');
  perform t216.rechaza('D2 authenticated (cualquier usuario con sesión) no lee la tabla', t216.intenta('authenticated', t319.laura(), 'select 1 from public.aliado_logos'), '42501');
  perform t216.rechaza('D3 authenticated no inserta directo', t216.intenta('authenticated', t319.laura(), format('insert into public.aliado_logos (aliado_id, path, mime, size_bytes, sha256, subido_por, via) values (933201, ''z'', ''image/png'', 1, %L, %L, ''portal'')', t319.sha('5'), t319.laura())), '42501');
  perform t216.rechaza('D4 authenticated no ejecuta la RPC (ni siquiera con su propia ficha)', t216.intenta('authenticated', t319.laura(), format('select public.registrar_logo_aliado(%L, 933201, ''933201/q.png'', ''image/png'', 10, repeat(''4'', 64))', t319.laura())), '42501');
  perform t216.rechaza('D5 anon no ejecuta la RPC', t216.intenta('anon', null, format('select public.registrar_logo_aliado(%L, 933201, ''933201/q.png'', ''image/png'', 10, repeat(''4'', 64))', t319.laura())), '42501');
  perform t216.rechaza('D6 authenticated no retira un logo', t216.intenta('authenticated', t319.laura(), format('select public.retirar_logo_aliado(%L, 933201)', t319.laura())), '42501');
  perform t216.rechaza('D7 authenticated no consulta la función de autorización', t216.intenta('authenticated', t319.laura(), format('select public.p319_actor_puede(%L, 933201)', t319.laura())), '42501');
  perform t216.acepta('D8 service_role sí lee la tabla (el servidor que autoriza antes)', t216.intenta('service_role', null, 'select 1 from public.aliado_logos'));
end $$;

\echo '--- E. Auditoría y bucket'
do $$
begin
  perform t216.afirma('E1 los cambios quedaron en la auditoría (trigger 087 sobre la tabla)', (select count(*) from public.auditoria where tabla = 'aliado_logos') >= 5, (select count(*)::text from public.auditoria where tabla = 'aliado_logos'));
  perform t216.afirma('E2 el bucket aliado-logos es PRIVADO, 1 MB, solo PNG/JPG', exists (select 1 from storage.buckets where id = 'aliado-logos' and public is false and file_size_limit = 1048576 and allowed_mime_types @> array['image/png', 'image/jpeg'] and cardinality(allowed_mime_types) = 2));
  perform t216.afirma('E3 ninguna política de storage.objects menciona el bucket (solo service_role entra)', (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and (coalesce(qual, '') like '%aliado-logos%' or coalesce(with_check, '') like '%aliado-logos%')) = 0);
end $$;

-- ── Resumen ────────────────────────────────────────────────────────────────────────────────────────────────
select count(*) filter (where ok) as aciertos, count(*) filter (where not ok) as fallos, count(*) as total from t216.res;
select nombre, detalle from t216.res where not ok;
do $$ begin
  if exists (select 1 from t216.res where not ok) then raise exception 'test_319: hay % fallos', (select count(*) from t216.res where not ok); end if;
end $$;
rollback;
