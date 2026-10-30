-- ═══════════════════════════════════════════════════════════════════════════
-- Migración 249 · #64 (servicio manual del carrito) — los manuales cotizados quedan congelados.
-- Preflight/postcheck/rollback: supabase/scripts/{preflight,postcheck,rollback}_249_cotizacion_manuales_inmutables.sql
--
-- Problema: un servicio manual (vuelo libre u otro) viaja en `cotizaciones.payload -> 'manuales'` con el precio, la ruta, las fechas, el nombre, los
-- pasajeros y el impuesto no comisionable que el asesor declaró. La política «cotizaciones: actualizar» deja a cualquier rol comercial hacer PATCH
-- del `payload` por la Data API, así que después de cotizar (y de mostrar el precio al cliente) se podía cambiar un manual, agregar uno o quitarlos todos,
-- y la conversión crearía un contrato distinto de lo cotizado. El disparador de la 238 solo cubre cotizaciones con `b2bAsistido`, y ni siquiera mira `manuales`.
--
-- Qué hace: un disparador BEFORE UPDATE rechaza (42501, MANUALES_INMUTABLES) cualquier cambio de `payload -> 'manuales'` —modificar, agregar a una
-- cotización que nació sin él, o quitar— en TODA cotización, B2C o B2B asistido, y para todos los roles (incluido service_role; mantenimiento: ALTER TABLE ...
-- DISABLE TRIGGER). Es independiente del disparador de la 238.
-- NO bloquea nada más: `detalle` (progreso y cobro de la conversión), `estado`, `numero_contrato`, `vigencia_hasta`, el resto del `payload` (p. ej. el alta
-- de personas, que hace jsonb_set de `payload.cliente`) y los demás campos se actualizan como siempre. Tampoco el INSERT: el bloque nace una vez, al cotizar.
--
-- Aditiva, sin datos: no toca filas. Orden de despliegue: preflight → 249 → postcheck → recién después el código nuevo (que escribe `impuestoNoComisionable`
-- en cada manual y rechaza al convertir un bloque ausente, malformado o distinto de lo cotizado). Con el código viejo arriba, la 249 no estorba: ese código
-- nunca modifica `payload.manuales`.
-- ═══════════════════════════════════════════════════════════════════════════
begin;

do $$
begin
  if to_regclass('public.cotizaciones') is null then
    raise exception '249 ABORTADA: falta public.cotizaciones (cadena 001-248).';
  end if;
end;
$$;

create or replace function public.tg_cot_manuales_inmutables()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if (old.payload -> 'manuales') is distinct from (new.payload -> 'manuales') then
    raise exception 'MANUALES_INMUTABLES: los servicios manuales cotizados de la cotización % no se pueden agregar, modificar ni quitar.', old.id
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.tg_cot_manuales_inmutables() from public, anon, authenticated;

drop trigger if exists trg_cot_manuales_inmutables on public.cotizaciones;
create trigger trg_cot_manuales_inmutables
  before update on public.cotizaciones
  for each row execute function public.tg_cot_manuales_inmutables();

commit;
