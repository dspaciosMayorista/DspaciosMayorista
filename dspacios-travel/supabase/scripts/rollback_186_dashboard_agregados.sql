-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK de la migración 186 (6 funciones agregadas del Dashboard).
--
-- Solo funciones nuevas, SECURITY INVOKER, sin tablas ni datos — revertir es
-- seguro e inmediato: elimina las funciones y el Dashboard vuelve a depender
-- de `fetchAllPaginado` (código ya presente y sin tocar) si se revierte
-- también el `dashboard/page.tsx` de esta ronda. Si SOLO se revierte esta
-- migración pero el código de la app sigue esperando estas funciones, el
-- Dashboard fallará al cargar — revertir SIEMPRE junto con el despliegue del
-- código anterior, nunca la migración sola en producción con el código nuevo
-- ya desplegado.
-- ───────────────────────────────────────────────────────────────────────────

-- `drop function` se lleva consigo, sin pasos aparte, TODOS los GRANT
-- execute otorgados en la 186 (authenticated, service_role) — no quedan
-- privilegios residuales apuntando a una función que ya no existe.
drop function if exists public.fn_dashboard_contratos_por_estado(text);
drop function if exists public.fn_dashboard_cupos_resumen();
drop function if exists public.fn_dashboard_retenciones_mes(text, text);
drop function if exists public.fn_dashboard_cxp_resumen(text, date, date);
drop function if exists public.fn_dashboard_cartera_por_moneda(text, date);
drop function if exists public.fn_dashboard_ventas_mes(text, text);

-- ⚠️ Deliberadamente NO se revierte `alter view public.cupos_por_bloqueo set
-- (security_invoker = true)`: es una corrección de seguridad independiente
-- de las 6 funciones (hace que la vista respete la RLS real de
-- bloqueos_vuelo/sillas en vez de correr con los privilegios de su dueño) —
-- revertirla reabriría ese hueco sin ningún beneficio para el rollback. Si
-- de verdad hace falta revertirla (ej. algo específico depende del
-- comportamiento viejo), hacerlo a mano y de forma consciente:
--   alter view public.cupos_por_bloqueo reset (security_invoker);
