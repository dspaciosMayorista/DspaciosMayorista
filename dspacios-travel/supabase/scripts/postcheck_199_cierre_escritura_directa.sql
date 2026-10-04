-- ───────────────────────────────────────────────────────────────────────────
-- POSTCHECK 199 · Fase C (cierre de la escritura directa de sillas y
-- bloqueos_vuelo) — SOLO LECTURA.
--
-- Correr DESPUÉS de aplicar la 199. Es UNA sola consulta SELECT sobre el
-- catálogo: no crea, no modifica, no bloquea nada y no devuelve datos de
-- pasajeros. Resultado: una fila por verificación (`ok` + detalle) y una fila
-- final RESUMEN. Todo tiene que dar ok = true.
--
-- Esto prueba que la guarda está BIEN FORMADA, no que RECHACE: el rechazo
-- efectivo lo prueban supabase/scripts/test_cierre_escritura_directa.sql (en
-- local) y el bloque C de preflight_traslado_cupos_lectura.sql (en
-- Producción, con aprobación). Que authenticated conserve UPDATE es lo
-- ESPERADO (grupo D y resto del record siguen editables).
--
-- Los md5 son los de los cuerpos de la 199 tal como está en el repositorio
-- (sin retornos de carro). Si la 199 se edita, recalcularlos.
-- ───────────────────────────────────────────────────────────────────────────
with
fn as (
  select p.proname, p.prosecdef, p.proowner::regrole::text as owner, md5(replace(p.prosrc, chr(13), '')) as cuerpo_md5,
         coalesce(p.proconfig, '{}') as cfg
    from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('_sillas_guarda_escritura', '_bloqueos_guarda_cupos', '_vuelos_guarda_truncate')
),
trg as (
  select t.tgname, t.tgrelid::regclass::text as tabla, t.tgenabled, t.tgtype, p.proname as fn
    from pg_trigger t join pg_proc p on p.oid = t.tgfoid
   where not t.tgisinternal and t.tgrelid in ('public.sillas'::regclass, 'public.bloqueos_vuelo'::regclass)
),
pol as (
  select tablename, policyname, cmd, qual, with_check from pg_policies
   where schemaname = 'public' and tablename in ('sillas', 'bloqueos_vuelo')
),
chk(orden, verificacion, ok, detalle) as (
  values
  (1, 'precondición: funciones 194–197 presentes',
     to_regprocedure('public.crear_bloqueo(jsonb, integer)') is not null and to_regprocedure('public.eliminar_bloqueo(bigint)') is not null
     and to_regprocedure('public.trasladar_cupos(bigint, bigint, integer, text, uuid)') is not null
     and to_regprocedure('public._vaciar_sillas(bigint[], text)') is not null and to_regprocedure('public.confirmar_venta(text)') is not null,
     'crear/eliminar_bloqueo, trasladar_cupos, _vaciar_sillas, confirmar_venta'),
  (2, 'funciones de guarda: 3, SECURITY INVOKER, search_path fijo',
     (select count(*) from fn where not prosecdef and cfg::text like '%search_path=public, pg_temp%') = 3,
     (select string_agg(proname || ' definer=' || prosecdef || ' owner=' || owner, '; ') from fn)),
  (3, 'cuerpos de las funciones = los de la 199 (md5)',
     (select count(*) from fn where (proname, cuerpo_md5) in (
        ('_sillas_guarda_escritura', 'd8f13772909daaba97e16a302e116abc'),
        ('_bloqueos_guarda_cupos',   'dc570672b87e905654c5c0aafaa45e56'),
        ('_vuelos_guarda_truncate',  '2d03cf2c989826e2d3e81301dde62855'))) = 3,
     (select string_agg(proname || '=' || cuerpo_md5, '; ') from fn)),
  (4, 'triggers de fila: BEFORE, FOR EACH ROW, INSERT+UPDATE+DELETE, habilitados',
     (select count(*) from trg where tgname in ('sillas_guarda_escritura', 'bloqueos_guarda_cupos')
        and tgenabled = 'O' and (tgtype & 1) = 1 and (tgtype & 2) = 2 and (tgtype & 28) = 28
        and fn = case tabla when 'sillas' then '_sillas_guarda_escritura' else '_bloqueos_guarda_cupos' end) = 2,
     (select string_agg(tabla || '.' || tgname || ' tipo=' || tgtype || ' estado=' || tgenabled::text, '; ') from trg where tgname like '%guarda%')),
  (5, 'triggers de TRUNCATE: BEFORE, por sentencia, habilitados',
     (select count(*) from trg where tgname in ('sillas_guarda_truncate', 'bloqueos_guarda_truncate')
        and tgenabled = 'O' and (tgtype & 1) = 0 and (tgtype & 2) = 2 and (tgtype & 32) = 32 and fn = '_vuelos_guarda_truncate') = 2,
     'sillas_guarda_truncate, bloqueos_guarda_truncate'),
  (6, 'modo aviso C0 retirado',
     not exists (select 1 from trg where tgname in ('sillas_aviso_escritura', 'bloqueos_aviso_cupos')),
     'sin triggers de aviso'),
  (7, 'authenticated sin INSERT/DELETE/TRUNCATE en sillas y bloqueos_vuelo',
     not has_table_privilege('authenticated', 'public.sillas', 'INSERT') and not has_table_privilege('authenticated', 'public.sillas', 'DELETE')
     and not has_table_privilege('authenticated', 'public.sillas', 'TRUNCATE') and not has_table_privilege('authenticated', 'public.bloqueos_vuelo', 'INSERT')
     and not has_table_privilege('authenticated', 'public.bloqueos_vuelo', 'DELETE') and not has_table_privilege('authenticated', 'public.bloqueos_vuelo', 'TRUNCATE'),
     'revocados'),
  (8, 'anon sin ninguna escritura en sillas y bloqueos_vuelo',
     not exists (select 1 from unnest(array['public.sillas', 'public.bloqueos_vuelo']) t, unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p
                  where has_table_privilege('anon', t, p)),
     'revocados'),
  (9, 'INFO (esperado true): authenticated conserva UPDATE',
     has_table_privilege('authenticated', 'public.sillas', 'UPDATE') and has_table_privilege('authenticated', 'public.bloqueos_vuelo', 'UPDATE'),
     'el grupo D y el resto del record siguen editables; el rechazo de lo protegido lo da el trigger'),
  (10, 'policies: sin FOR ALL / INSERT / DELETE en sillas y bloqueos_vuelo',
     not exists (select 1 from pol where cmd in ('ALL', 'INSERT', 'DELETE')),
     (select string_agg(tablename || ': ' || policyname || ' (' || cmd || ')', '; ' order by tablename, policyname) from pol)),
  (11, 'policies: una FOR UPDATE con AUT-1 por tabla (USING y WITH CHECK)',
     (select count(*) from pol where cmd = 'UPDATE' and policyname like '%edicion directa (AUT-1)%'
        and qual like '%superadmin%' and qual like '%mi_tenant()%mayorista%' and with_check like '%mi_tenant()%mayorista%') = 2,
     'sillas: edicion directa (AUT-1) · bloqueos: edicion directa (AUT-1)'),
  (12, 'lectura sin cambios: policies SELECT de la 137 presentes',
     (select count(*) from pol where cmd = 'SELECT' and policyname in ('sillas: lectura operativa', 'bloqueos: lectura operativa')) = 2,
     'sillas: lectura operativa · bloqueos: lectura operativa'),
  (13, 'RLS activa en las dos tablas',
     (select bool_and(relrowsecurity) from pg_class where oid in ('public.sillas'::regclass, 'public.bloqueos_vuelo'::regclass)),
     'relrowsecurity')
)
select orden, verificacion, ok, detalle from chk
union all
select 99, 'RESUMEN', bool_and(ok), count(*) filter (where not ok) || ' verificación(es) en false' from chk
order by orden;
