-- ───────────────────────────────────────────────────────────────────────────
-- POSTCHECK 200 · Fase E (historial de vuelos inmutable) — SOLO LECTURA.
--
-- Correr DESPUÉS de aplicar la 200. Una sola consulta SELECT sobre el
-- catálogo (y dos conteos): no crea, no modifica, no bloquea nada y no
-- devuelve datos de pasajeros. Todo tiene que dar ok = true.
--
-- Prueba que la barrera está BIEN FORMADA. El rechazo efectivo de UPDATE,
-- DELETE (con y sin WHERE), TRUNCATE e INSERT, por separado y por rol, lo
-- prueba supabase/scripts/test_historial_inmutable.sql en local.
--
-- Los md5 son los de los cuerpos de la 200 tal como está en el repositorio
-- (sin retornos de carro). Si la 200 se edita, recalcularlos.
-- ───────────────────────────────────────────────────────────────────────────
with
fn as (
  select p.proname, p.prosecdef, md5(replace(p.prosrc, chr(13), '')) as cuerpo_md5, coalesce(p.proconfig, '{}') as cfg
    from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('_historial_vuelos_inmutable', '_historial_vuelos_sin_truncate')
),
trg as (
  select t.tgname, t.tgrelid::regclass::text as tabla, t.tgenabled, t.tgtype, p.proname as fn
    from pg_trigger t join pg_proc p on p.oid = t.tgfoid
   where not t.tgisinternal and t.tgrelid in ('public.movimientos_silla'::regclass, 'public.operaciones_vuelo'::regclass)
),
pol as (
  select tablename, policyname, cmd from pg_policies
   where schemaname = 'public' and tablename in ('movimientos_silla', 'operaciones_vuelo')
),
chk(orden, verificacion, ok, detalle) as (
  values
  (1, 'funciones: 2, SECURITY INVOKER, search_path fijo',
     (select count(*) from fn where not prosecdef and cfg::text like '%search_path=public, pg_temp%') = 2,
     (select string_agg(proname || ' definer=' || prosecdef, '; ') from fn)),
  (2, 'cuerpos de las funciones = los de la 200 (md5)',
     (select count(*) from fn where (proname, cuerpo_md5) in (
        ('_historial_vuelos_inmutable',    '7d3d924cca8dc53fd7b9240f2228c477'),
        ('_historial_vuelos_sin_truncate', '3be9283df8f3235a6752220fddd4a0f5'))) = 2,
     (select string_agg(proname || '=' || cuerpo_md5, '; ') from fn)),
  (3, 'triggers de fila en las dos tablas: BEFORE, FOR EACH ROW, INSERT+UPDATE+DELETE, habilitados',
     (select count(*) from trg where tgname in ('movimientos_historial_inmutable', 'operaciones_historial_inmutable')
        and tgenabled = 'O' and (tgtype & 1) = 1 and (tgtype & 2) = 2 and (tgtype & 28) = 28 and fn = '_historial_vuelos_inmutable') = 2,
     (select string_agg(tabla || '.' || tgname || ' tipo=' || tgtype || ' estado=' || tgenabled::text, '; ') from trg where tgname like '%historial%')),
  (4, 'triggers de TRUNCATE en las dos tablas: BEFORE, por sentencia, habilitados',
     (select count(*) from trg where tgname in ('movimientos_historial_sin_truncate', 'operaciones_historial_sin_truncate')
        and tgenabled = 'O' and (tgtype & 1) = 0 and (tgtype & 2) = 2 and (tgtype & 32) = 32 and fn = '_historial_vuelos_sin_truncate') = 2,
     'movimientos_historial_sin_truncate, operaciones_historial_sin_truncate'),
  (5, 'auditoría 087 sigue en movimientos_silla',
     exists (select 1 from trg where tabla = 'movimientos_silla' and tgname = 'trg_auditoria' and tgenabled = 'O'),
     'trg_auditoria'),
  (6, 'authenticated, anon y service_role sin INSERT/UPDATE/DELETE/TRUNCATE (movimientos_silla)',
     not exists (select 1 from unnest(array['authenticated', 'anon', 'service_role']) r, unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p
                  where has_table_privilege(r, 'public.movimientos_silla', p)),
     'cada comando por separado'),
  (7, 'authenticated, anon y service_role sin INSERT/UPDATE/DELETE/TRUNCATE (operaciones_vuelo)',
     not exists (select 1 from unnest(array['authenticated', 'anon', 'service_role']) r, unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p
                  where has_table_privilege(r, 'public.operaciones_vuelo', p)),
     'cada comando por separado'),
  (8, 'policies: solo SELECT en las dos tablas',
     not exists (select 1 from pol where cmd <> 'SELECT')
     and exists (select 1 from pol where tablename = 'movimientos_silla' and policyname = 'movimientos: lectura vuelos')
     and exists (select 1 from pol where tablename = 'operaciones_vuelo' and policyname = 'operaciones_vuelo: lectura vuelos'),
     (select string_agg(tablename || ': ' || policyname || ' (' || cmd || ')', '; ' order by tablename, policyname) from pol)),
  (9, 'INFO: filas de historial (el conteo no debe bajar nunca entre dos corridas)',
     true,
     (select count(*) from public.movimientos_silla) || ' movimientos · ' || (select count(*) from public.operaciones_vuelo) || ' operaciones')
)
select orden, verificacion, ok, detalle from chk
union all
select 99, 'RESUMEN', bool_and(ok), count(*) filter (where not ok) || ' verificación(es) en false' from chk
order by orden;
