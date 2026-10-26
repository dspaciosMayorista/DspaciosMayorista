-- ═══════════════════════════════════════════════════════════════════════════
-- Migración 238 · #102 (cotización asistida B2B desde el carrito del Tarifario)
-- (1) Estado ACTIVO del aliado del catálogo y (2) candado de unicidad de la conversión de una cotización B2B.
-- Preflight/postcheck/rollback: supabase/scripts/{preflight,postcheck,rollback}_238_cotizacion_asistida_b2b.sql
--
-- (1) Problema: el catálogo `aliados` (agencias y freelance) no tiene ningún estado. Una venta B2B asistida por personal interno exige "aliado
--     activo" (decisión del dueño, #102) y hoy no hay de dónde leerlo: un aliado que dejó de operar seguía pudiendo ser el beneficiario de una
--     cotización nueva. Qué hace: agrega `aliados.activo boolean not null default true`. Todas las filas existentes quedan ACTIVAS (nada cambia
--     para nadie hasta que alguien desactive a un aliado desde /dashboard/aliados). Solo la venta B2B asistida lo exige; los demás flujos (reservar
--     con aliado, contrato manual, portal B2B) siguen como están: desactivar un aliado NO le quita contratos ni comisiones ya creados.
--
-- (2) Problema: dos conversiones simultáneas de la MISMA cotización (doble envío desde dos pestañas, reintento de red) pasaban ambas la lectura de
--     «¿ya convertida?» y creaban cada una su contrato; en una venta B2B eso duplica además la comisión del aliado. Qué hace: `ventas` gana
--     `cotizacion_origen_id` y `grupo_conversion` (nullable, solo los escribe la conversión B2B del carrito) y un índice ÚNICO PARCIAL sobre el par.
--     El segundo contrato del mismo grupo de la misma cotización lo rechaza la base (23505) ANTES de escribir pasajeros, comisión o CxP. Si un
--     contrato se revierte por una falla (`revertir_contrato_incompleto` borra su fila), el par queda libre y el reintento funciona. Sin llave
--     foránea a propósito: un contrato no debe depender de que su cotización exista. Contratos existentes: ambas columnas NULL, nada cambia.
--
-- (3) Además agrega un disparador que hace inmutable `cotizaciones.payload -> 'b2bAsistido'` (ver más abajo).
--
-- Qué NO hace: no agrega `tenant` al catálogo de aliados (es global por diseño: lo usan las dos agencias) ni toca RLS ni datos.
-- Es aditiva y se puede aplicar con el código viejo arriba. Orden de despliegue: preflight → 238 → postcheck → recién después el código nuevo
-- (el código nuevo lee `aliados.activo` y escribe las dos columnas de `ventas`; sin ellas la venta B2B asistida y la página de aliados fallan
-- de forma explícita, y la cotización B2C/dinámica sigue como siempre).
-- ═══════════════════════════════════════════════════════════════════════════
begin;

do $$
begin
  if to_regclass('public.aliados') is null or to_regclass('public.ventas') is null then
    raise exception '238 ABORTADA: faltan las tablas public.aliados / public.ventas (cadena 001-237).';
  end if;
end;
$$;

-- (1) Aliado activo.
alter table public.aliados
  add column if not exists activo boolean not null default true;

comment on column public.aliados.activo is
  '#102 (238): false = el aliado no se puede elegir como beneficiario de una venta B2B asistida nueva. No afecta contratos, comisiones ni accesos ya existentes.';

-- (2) Candado de unicidad de la conversión: una cotización convierte UNA vez cada grupo (contrato).
alter table public.ventas
  add column if not exists cotizacion_origen_id bigint,
  add column if not exists grupo_conversion text;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.ventas'::regclass and conname = 'ventas_conversion_par_chk') then
    alter table public.ventas
      add constraint ventas_conversion_par_chk
      check ((cotizacion_origen_id is null) = (grupo_conversion is null));
  end if;
end;
$$;

create unique index if not exists ux_ventas_conversion_cotizacion_grupo
  on public.ventas (cotizacion_origen_id, grupo_conversion)
  where cotizacion_origen_id is not null;

comment on column public.ventas.cotizacion_origen_id is
  '#102 (238): cotización de carrito de la que nació este contrato en una venta B2B asistida. Junto con grupo_conversion hace imposible convertir dos veces el mismo grupo.';
comment on column public.ventas.grupo_conversion is
  '#102 (238): clave del grupo de la conversión (destino, o __sin_destino__ si es un solo contrato). NULL = contrato no creado por la conversión B2B del carrito.';


-- (3) Frontera del plan congelado. Problema: la política «cotizaciones: actualizar» deja a cualquier rol comercial (incluido `venta`) hacer PATCH del
--     `payload` de cualquier cotización de su agencia. Con eso podía BORRAR `payload.b2bAsistido` (la conversión la leería como B2C: contrato sin
--     aliado ni comisión) o REESCRIBIRLO (otro %, otra modalidad), y el código solo detecta un bloque inconsistente consigo mismo, no uno rehecho con
--     coherencia. Qué hace: un disparador BEFORE UPDATE rechaza (42501) cualquier cambio de `payload -> 'b2bAsistido'` — también agregarlo a una
--     cotización que nació sin él, porque eso se saltaría la autorización del actor que solo se evalúa al crear. El bloque nace UNA vez, en el INSERT
--     de `crearSolicitudReserva`; después es inmutable para todos los roles (incluido service_role y superusuario; mantenimiento: ALTER TABLE ... DISABLE
--     TRIGGER). Además, mientras la cotización lleve el bloque, quedan congeladas las UNIDADES ECONÓMICAS que ese bloque resume —`payload.items`, `payload.tours` y
--     `payload.serviciosIncluidos`—: sus líneas (`item-N`/`tour-N`) y PVP solo describen un precio, no QUÉ se vende; sin esto un PATCH podía cambiar servicioId, paqueteId,
--     nombre o destino de un tour (manteniendo tour-0 y el PVP) y la conversión creaba un contrato o una CxP distintos de lo cotizado. NO bloquea nada más: `detalle` (progreso y cobro de la conversión), `estado`, `numero_contrato`, `vigencia_hasta`, el resto del `payload`
--     (p. ej. el alta de personas, que hace jsonb_set de otras llaves) y los demás campos se actualizan como siempre.
create or replace function public.tg_cot_b2b_asistido_inmutable()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if (old.payload -> 'b2bAsistido') is distinct from (new.payload -> 'b2bAsistido') then
    raise exception 'B2B_ASISTIDO_INMUTABLE: los términos B2B congelados de la cotización % no se pueden agregar, modificar ni quitar.', old.id
      using errcode = '42501';
  end if;
  -- Con bloque vigente, las unidades que lo componen tampoco cambian (jsonb ignora el orden de las llaves, no el de los arreglos).
  if coalesce(old.payload -> 'b2bAsistido', 'null'::jsonb) <> 'null'::jsonb
     and ((old.payload -> 'items') is distinct from (new.payload -> 'items')
          or (old.payload -> 'tours') is distinct from (new.payload -> 'tours')
          or (old.payload -> 'serviciosIncluidos') is distinct from (new.payload -> 'serviciosIncluidos')) then
    raise exception 'B2B_ASISTIDO_INMUTABLE: las unidades cotizadas (ítems, tours y servicios incluidos) de la cotización % no se pueden modificar.', old.id
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.tg_cot_b2b_asistido_inmutable() from public, anon, authenticated;

drop trigger if exists trg_cot_b2b_asistido_inmutable on public.cotizaciones;
create trigger trg_cot_b2b_asistido_inmutable
  before update on public.cotizaciones
  for each row execute function public.tg_cot_b2b_asistido_inmutable();

commit;
