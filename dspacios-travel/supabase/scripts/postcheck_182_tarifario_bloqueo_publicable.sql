-- Postcheck 182 — SOLO LECTURA. Corre DESPUÉS de aplicar
-- 20260601000182_tarifario_bloqueo_publicable.sql.
-- Objetivo: confirmar que la función, la policy reemplazada y las 2 vistas
-- quedaron con la definición, los grants y el comportamiento de filtrado
-- esperados. Las pruebas de comportamiento POR ROL (anon/authenticated
-- externo/interno) viven en test_182 — este script corre a nivel de
-- catálogo (sin simular sesiones), y una comparación de conteos que no
-- depende de rol.

-- 1) El helper existe: SECURITY DEFINER, STABLE, search_path fijo.
select
  p.proname,
  p.prosecdef as security_definer,
  p.provolatile as volatilidad, -- 's' = stable
  p.proconfig as configuracion -- debe incluir search_path=public, pg_temp
from pg_proc p
where p.pronamespace = 'public'::regnamespace and p.proname = 'tarifario_paquete_publicable';
-- Esperado: 1 fila, security_definer=true, volatilidad='s',
-- configuracion contiene 'search_path=public, pg_temp'.

-- 2) Grants del helper: PUBLIC sin privilegio; anon y authenticated con
--    EXECUTE; ningún otro rol EXTERNO adicional. El dueño de la función
--    (típicamente `postgres`, quien aplicó la migración) SÍ puede aparecer
--    aquí con EXECUTE — es un privilegio implícito de la propiedad del
--    objeto, no algo que este script concedió ni algo que un cliente externo
--    (anon/authenticated) pueda ejercer; no es un hallazgo.
select grantee, privilege_type
from information_schema.role_routine_grants
where routine_schema = 'public' and routine_name = 'tarifario_paquete_publicable'
order by grantee;
-- Esperado: anon y authenticated con EXECUTE; PUBLIC no debe aparecer;
-- puede aparecer también el rol dueño de la función (ver nota arriba).

-- 3) Policy de lectura de tarifario_resultado — reemplazada. Ya NO debe ser
--    "true" a secas; debe mencionar mi_rol() y el helper nuevo.
select tablename, policyname, cmd, qual
from pg_policies
where schemaname = 'public' and tablename = 'tarifario_resultado'
order by policyname;
-- Esperado: 2 filas — "tarifario_resultado: escritura" (ALL, sin cambios) y
-- "tarifario_resultado: lectura" (SELECT, qual menciona mi_rol() Y
-- tarifario_paquete_publicable — NUNCA qual='true').

-- 4) La vista nueva existe, es una vista ordinaria (no materializada), NO
--    tiene security_invoker activado, y SÍ tiene security_barrier=true (P2).
select
  c.relname,
  c.relkind,
  c.reloptions
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'tarifario_resultado_publicable';
-- Esperado: 1 fila, relkind='v', reloptions contiene 'security_barrier=true'
-- y (si Postgres la imprime explícita) 'security_invoker=false' — Postgres
-- puede omitir una opción puesta explícitamente en false por ser el default;
-- lo único que DEBE aparecer siempre es security_barrier=true.

-- 5) tarifario_resumen sigue siendo una vista CON security_invoker=true (sin
--    cambios en esa opción, solo cambió su fuente en la ronda anterior).
select
  c.relname,
  c.relkind,
  c.reloptions
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'tarifario_resumen';
-- Esperado: 1 fila, relkind='v', reloptions contiene 'security_invoker=true'.

-- 6) Grants: anon y authenticated tienen SELECT en ambas vistas, y NADA más
--    (ni insert/update/delete) — mismo criterio que ya tenía tarifario_resumen.
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('tarifario_resultado_publicable', 'tarifario_resumen')
  and grantee in ('anon', 'authenticated')
order by table_name, grantee, privilege_type;
-- Esperado: exactamente 4 filas — (tarifario_resultado_publicable, anon, SELECT),
-- (tarifario_resultado_publicable, authenticated, SELECT),
-- (tarifario_resumen, anon, SELECT), (tarifario_resumen, authenticated, SELECT).

-- 6bis) ⚠️ Segunda ronda de auditoría, hallazgo 1 — service_role sobre
--    tarifario_resultado_publicable. Este SÍ es parte del contrato de la 182
--    y SE EXIGE exacto: exactamente SELECT, nada más (los lectores reales con
--    createAdminClient() son buscarHoteles/buscarReceptivos/
--    liquidarServicioPuntual, que leen esa vista).
select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'tarifario_resultado_publicable'
  and grantee = 'service_role';
-- Esperado: EXACTAMENTE 1 fila — (service_role, SELECT). Ni más privilegios
-- (INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER) ni menos.

-- 6ter) ⚠️ Tercera ronda de auditoría — service_role sobre tarifario_resumen
--    es SOLO DIAGNÓSTICO, NUNCA parte del contrato de la 182. Esta migración
--    NO modifica ningún privilegio de service_role sobre tarifario_resumen
--    (ni lo agrega ni lo revoca) — lo que sea que aparezca aquí es el ACL
--    HISTÓRICO que ya existía antes de la 182 (típicamente privilegios
--    estructurales heredados de un default privilege del proyecto —
--    TRUNCATE/REFERENCES/TRIGGER — inertes sobre una vista ordinaria, nunca
--    SELECT real, pero eso no se afirma aquí como garantía: es SOLO
--    información, no una aserción que pueda fallar este postcheck). Si algún
--    día se decide sanear estos privilegios históricos, esa es una migración
--    aparte, con su propio inventario y su propio rollback.
select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'tarifario_resumen'
  and grantee = 'service_role';
-- Informativo — SIN "esperado", no es una aserción de este postcheck.

-- 7) tarifario_resultado_publicable expone las MISMAS columnas que
--    tarifario_resultado (select r.* — ninguna columna de armado_paquetes
--    debe aparecer aquí).
select
  (select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'tarifario_resultado') as columnas_tarifario_resultado,
  (select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'tarifario_resultado_publicable') as columnas_vista_publicable,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tarifario_resultado_publicable'
      and column_name in ('tarifario_snapshot_publicable', 'tarifario_estado', 'activo')
  ) as expone_columna_de_armado_paquetes;
-- Esperado: las dos primeras columnas coinciden en cantidad; la tercera es false.

-- 8) Comportamiento de filtrado de la VISTA (a nivel de catálogo, sin rol —
--    esto corre como el rol que ejecuta el script, normalmente postgres/
--    superusuario; la comprobación POR ROL real vive en test_182). Toda fila
--    de la vista debe corresponder a un paquete publicable Y activo; ninguna
--    fila de un paquete bloqueado o inactivo debe colarse.
select
  (select count(*) from public.tarifario_resultado_publicable rp
     join public.armado_paquetes ap on ap.id = rp.paquete_id
     where ap.tarifario_snapshot_publicable = false or ap.activo = false) as filas_bloqueadas_o_inactivas_coladas,
  (select count(*) from public.tarifario_resultado r
     join public.armado_paquetes ap on ap.id = r.paquete_id
     where ap.tarifario_snapshot_publicable = true and ap.activo = true) as filas_publicables_y_activas_esperadas,
  (select count(*) from public.tarifario_resultado_publicable) as filas_en_la_vista;
-- Esperado: filas_bloqueadas_o_inactivas_coladas=0; filas_publicables_y_activas_esperadas = filas_en_la_vista.

-- 9) Conteo total de funciones/policies relacionadas (referencia rápida de
--    "no se creó nada de más").
select count(*) as funciones_tarifario_paquete_publicable
from pg_proc where pronamespace = 'public'::regnamespace and proname = 'tarifario_paquete_publicable';
-- Esperado: 1.

select count(*) as policies_tarifario_resultado
from pg_policies where schemaname = 'public' and tablename = 'tarifario_resultado';
-- Esperado: 2 (lectura + escritura, sin cambios de cantidad, solo de contenido en lectura).
