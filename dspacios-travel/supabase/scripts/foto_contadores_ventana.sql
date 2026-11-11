-- FOTO de contadores de escritura por tabla (ventana de mantenimiento #75+#97). SOLO LECTURA: una consulta, un resultado (un JSON).
-- Correr justo DESPUÉS de activar y verificar el bloqueo; antes de reabrir se compara con comparar_contadores_ventana.sql. Guardar el JSON.
-- EVIDENCIA AUXILIAR, no un veredicto: `pg_stat_user_tables` cuenta las filas insertadas, actualizadas y borradas en cada tabla, también en las
-- que no tienen auditoría, pero NO distingue quién escribió ni si la escritura era legítima (en una misma tabla se mezclan la migración, la
-- validación y cualquier escritura indebida). Toda tabla que aparezca en la comparación exige revisión humana.
-- Límites: los contadores se publican con unos segundos de retraso. `stats_reset` (pg_stat_database) cambia con un reinicio de toda la base; en la
-- versión probada (PostgreSQL 15.8) también cambió al reiniciar una sola tabla, pero NO se garantiza que delate todo reinicio en otras versiones
-- o de otros tipos: un contador que BAJA respecto de la foto también se marca para revisión.
select json_build_object(
  'tomada_en', now(),
  'stats_reset', (select stats_reset from pg_stat_database where datname = current_database()),
  'tablas', (select json_object_agg(schemaname || '.' || relname, n_tup_ins + n_tup_upd + n_tup_del order by schemaname, relname)
               from pg_stat_user_tables where schemaname in ('public', 'storage', 'auth', 'mant_priv', 'cron'))
)::text as foto;
