-- Rollback de la 266: quita los tres disparadores y sus dos funciones. NO toca datos ni tarifarios publicados (solo deja de invalidar por esas tres fuentes). Idempotente.
drop trigger if exists tarifario_trg_servicio_precio_alcance on public.servicio_precio_alcance;
drop trigger if exists tarifario_trg_servicio_suplementos_franja on public.servicio_suplementos_franja;
drop trigger if exists tarifario_trg_servicios_alcance_catalogo on public.servicios_adicionales;
drop function if exists public.tarifario_trg_bump_por_vigencia_servicio();
drop function if exists public.tarifario_trg_bump_servicio_alcance_catalogo();
