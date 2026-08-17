-- ───────────────────────────────────────────────────────────────────────────
-- 153 · COTIZACIONES: aislamiento por tenant — FASE ADITIVA
--
-- `cotizaciones`/`cotizacion_servicios` nacieron sin columna `tenant` (no
-- existía el concepto multitenant cuando se crearon, migración 054). La RLS
-- actual (`cotizaciones: interno`/`cotizacion_servicios: interno`) es SOLO
-- por rol — cualquier interno de CUALQUIER agencia lee/escribe todo. Esta
-- migración es el primer paso (aditivo) de dos para cerrar eso:
--
--   153 (esta)  → agrega `tenant` NULLABLE + backfill de lo confirmado.
--   154 (aparte)→ NOT NULL + policies con aislamiento real. NO se corre en
--                 el mismo despliegue: el código viejo (sin desplegar
--                 todavía) puede seguir creando cotizaciones mientras esta
--                 migración ya corrió, y esas filas nuevas nacerían con
--                 `tenant = NULL` — cerrar la RLS antes de que el código
--                 nuevo esté sirviendo tráfico las dejaría inaccesibles.
--
-- BACKFILL: el dueño de los datos confirmó explícitamente que las 18
-- cotizaciones existentes a la fecha (incluidas las 6 manuales) son TODAS de
-- mayorista, ninguna de minorista. Por eso el backfill es una lista de IDs
-- explícita, uno por uno — NUNCA un `update` general por `tipo`, `asesor`,
-- `creado_por` ni un default: esa clase de asignación masiva por suposición
-- es exactamente lo que este backfill evita (ver el diagnóstico ejecutado en
-- producción, que ya mostró que `asesor`/`creado_por` son señales débiles o
-- candidatas, nunca estructurales).
--
-- Idempotente: se puede correr más de una vez sin efecto adicional.
-- ───────────────────────────────────────────────────────────────────────────

-- 1) Columna nullable (sin default — no hay valor "correcto" para asumir).
alter table public.cotizaciones add column if not exists tenant text;

-- 2) Restringe los valores permitidos, aceptando NULL durante la transición
--    (se cierra a NOT NULL recién en la 154, una vez el código nuevo esté
--    desplegado y no queden filas nuevas sin tenant).
alter table public.cotizaciones drop constraint if exists cotizaciones_tenant_check;
alter table public.cotizaciones add constraint cotizaciones_tenant_check
  check (tenant is null or tenant in ('mayorista', 'minorista'));

create index if not exists idx_cotizaciones_tenant on public.cotizaciones(tenant);

-- 3) Backfill EXPLÍCITO — únicamente estos 18 IDs, confirmados por el dueño
--    de los datos como mayorista. El `where ... and tenant is distinct from`
--    evita reescribir la fila si ya está correcta (re-correr la migración no
--    genera writes de más ni dispara triggers sin necesidad).
update public.cotizaciones
   set tenant = 'mayorista'
 where id in (1,2,3,4,5,6,7,8,9,10,11,12,14,15,16,17,18,19)
   and tenant is distinct from 'mayorista';

-- 6) Verificación: de los 18 IDs confirmados, los que TODAVÍA existan deben
--    haber quedado en tenant='mayorista' — ni NULL ni el tenant contrario.
--    Si algo no cuadra, la migración ABORTA (falla ruidosamente) en vez de
--    dejar el backfill a medias en silencio. Nótese que un ID de la lista
--    que ya no exista (borrado por algún otro motivo) NO cuenta como error:
--    esta comprobación solo mira los que siguen ahí.
do $$
declare
  v_mal bigint;
  v_ids bigint[];
begin
  select count(*), coalesce(array_agg(id order by id), '{}')
    into v_mal, v_ids
  from public.cotizaciones
  where id in (1,2,3,4,5,6,7,8,9,10,11,12,14,15,16,17,18,19)
    and (tenant is null or tenant <> 'mayorista');

  if v_mal > 0 then
    raise exception '153 FALLÓ: % de los 18 IDs confirmados como mayorista no quedaron con tenant=''mayorista'' (ids: %). Backfill incompleto — revisar antes de continuar.',
      v_mal, v_ids;
  end if;
end $$;

-- 8) Consulta de verificación (SOLO LECTURA, no se ejecuta como parte de la
-- migración — se deja aquí, comentada, para correrla manualmente ENTRE el
-- despliegue del código nuevo y la migración 154, tal como indica el orden
-- de despliegue documentado). Debe dar 0 filas antes de correr la 154: toda
-- cotización nueva creada después de este punto la debe estar estampando el
-- código ya desplegado. Si aparece alguna fila, hay que resolverla a mano
-- (no hay un tenant "por defecto" seguro) antes de cerrar con la 154.
--
-- select id, codigo, tipo, estado, creado_por, asesor, numero_contrato, created_at
--   from public.cotizaciones
--  where tenant is null
--  order by created_at desc;
