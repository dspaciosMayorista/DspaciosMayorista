-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK de la migración 185 (meta_ventas_mensual)
--
-- Tabla nueva y aditiva (nada más la referencia todavía salvo el Dashboard,
-- que ya maneja su ausencia mostrando "Sin meta general configurada" —
-- revertir esta migración NO rompe ninguna otra pantalla). Elimina la tabla
-- y sus policies; cualquier meta ya cargada por un administrador SE PIERDE
-- — si hace falta conservarla, exportarla antes de correr esto:
--
--   select * from public.meta_ventas_mensual order by tenant, periodo, moneda;
-- ───────────────────────────────────────────────────────────────────────────

drop policy if exists "meta_ventas: lectura interna"      on public.meta_ventas_mensual;
drop policy if exists "meta_ventas: escritura contable"    on public.meta_ventas_mensual;
drop policy if exists "meta_ventas: actualizar contable"   on public.meta_ventas_mensual;
drop policy if exists "meta_ventas: eliminar contable"     on public.meta_ventas_mensual;

-- `drop table` se lleva consigo, sin pasos aparte: la secuencia
-- `meta_ventas_mensual_id_seq` (es propiedad de la columna `id bigserial`,
-- Postgres la dropea en cascada) y TODOS los GRANT de tabla/secuencia
-- otorgados en la 185 (authenticated, service_role) — no quedan privilegios
-- residuales apuntando a un objeto que ya no existe.
drop table if exists public.meta_ventas_mensual;
