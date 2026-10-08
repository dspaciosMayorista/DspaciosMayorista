-- ───────────────────────────────────────────────────────────────────────────
-- PREFLIGHT · migración 202 (CRM leads) — SOLO LECTURA.
--
-- Corre ANTES de aplicar la 202. Cada fila debe salir con ok = true.
-- No escribe nada: la migración crea sus propias tablas, así que el estado
-- esperado es "las tablas del CRM todavía no existen".
--
-- El caso normal es que TODAS las filas den true, incluida la última. La única
-- razón para ver ok = false es que el módulo ya esté aplicado: en ese caso la
-- 202 es idempotente para el esquema (todo lleva `if not exists` / `create or
-- replace`), pero conviene saberlo antes de correrla y no después.
-- ───────────────────────────────────────────────────────────────────────────
select 'no existe crm_leads todavia (aplicar por primera vez)' as chequeo,
  to_regclass('public.crm_leads') is null as ok
union all
select 'no existe crm_lead_actividades todavia',
  to_regclass('public.crm_lead_actividades') is null
union all
-- Prerrequisitos reales de la 202: sin ellos la migración falla a media
-- aplicación y el editor SQL deja un error poco descriptivo.
select 'existe la tabla usuarios (FK de responsable_id y creado_por)',
  to_regclass('public.usuarios') is not null
union all
select 'existe fn_auditoria (trigger de auditoría del CRM)',
  to_regprocedure('public.fn_auditoria()') is not null
union all
select 'existen los helpers de rol y tenant (mi_rol, mi_tenant, puede_ver_tenant)',
  to_regprocedure('public.mi_rol()') is not null
  and to_regprocedure('public.mi_tenant()') is not null
  and to_regprocedure('public.puede_ver_tenant(text)') is not null
union all
select 'usuarios tiene columna tenant (aislamiento por agencia)',
  exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'usuarios' and column_name = 'tenant'
  )
union all
-- `create or replace` no reemplaza una funcion con OTRA firma: crea una
-- sobrecarga. Si en esta base quedo una funcion `crm_lead_*` de un borrador
-- anterior de la 202 (p. ej. `crm_lead_duplicado_id` con dedupe por telefono y
-- sin tipo de documento), seguiria viva junto a la nueva. Antes de aplicar no
-- debe existir ninguna.
select 'ninguna funcion crm_lead* previa (sin restos de un borrador de la 202)',
  not exists (
    select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and (p.proname like 'crm_lead%' or p.proname like 'crm_leads%')
  )
union all
-- La 202 NO debe tocar nada ajeno. Este conteo se compara antes y después:
-- si al aplicar aparece alguno nuevo, la 202 se pasó de alcance.
-- Se filtra por nombre de tabla (no por `::regclass`) para que la consulta no
-- reviente cuando la 203 todavía no está aplicada.
select 'trg_auditoria no cuelga de los historiales de la 203',
  not exists (
    select 1
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
     where not t.tgisinternal
       and t.tgname = 'trg_auditoria'
       and c.relname in ('tarifa_hotel_historial', 'hotel_temporadas_historial')
  );