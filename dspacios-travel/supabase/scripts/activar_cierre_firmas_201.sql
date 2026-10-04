-- ───────────────────────────────────────────────────────────────────────────
-- ACTIVAR el cierre de las firmas sin versión de Vuelos (migración 201).
-- Operación de DATOS sobre el estado que creó la 201: no es una migración
-- (no usa la 204, reservada para Contabilidad, ni ninguna otra).
--
-- ⚠️ La base NO puede saber si Producción tiene el código nuevo: Producción y
-- los Previews de Vercel usan la MISMA base, y la llamada con versión que la
-- base registra puede venir de un Preview. Por eso este script exige una
-- VERIFICACIÓN HUMANA en Vercel y se niega si no se llena (guía completa:
-- docs/tecnico/vuelos-201-despliegue-y-cierre.md). Antes de correrlo:
--   1. Vercel → Deployments, filtro Production: el despliegue marcado como
--      CURRENT tiene estado READY y su commit es el del merge de la 201 en main
--      (copiar el hash corto o largo).
--   2. Vercel → Settings → Domains: anotar el dominio de PRODUCTION y abrirlo:
--      en Vuelos → un record, la celda de contrato manual muestra "editar" y
--      "quitar" (solo existen en el código nuevo).
--   3. PREVIEWS ANTIGUOS resueltos: ningún despliegue de Preview con código
--      anterior a la 201 sigue accesible contra esta base (borrados, o
--      protegidos con Deployment Protection, o con variables de Preview que
--      apuntan a otra base). Si no, esos Previews fallarán al Borrar /
--      asignar / quitar / editar cuando el cierre se cumpla (sin perder datos,
--      pero confundiendo a quien los use).
--   4. postcheck_cierre_firmas_201.sql: revisar el uso de firmas viejas en las
--      últimas 24 h; si sigue habiendo, buscar quién usa código anterior.
-- Luego llenar el bloque VERIFICACIÓN y correr el script entero.
-- Cancelar (solo antes de que termine la ventana): cancelar_cierre_firmas_201.sql.
-- ───────────────────────────────────────────────────────────────────────────
begin;

create temp table verificacion_vercel on commit drop as select
  -- ═══ VERIFICACIÓN (llenar a mano con lo visto en Vercel) ═══
  'PEGAR_COMMIT'::text            as commit_produccion,       -- hash del deployment Current de Production (7–40 hex)
  'PEGAR_DOMINIO'::text           as dominio_produccion,      -- p. ej. https://app.dominio.com (el de Settings → Domains)
  'no'::text                      as deployment_ready,        -- 'si' si ese deployment está READY y CURRENT en Production
  'no'::text                      as commit_es_merge_201,     -- 'si' si el commit es el del merge de la 201 en main (o posterior)
  'no'::text                      as celda_nueva_vista,       -- 'si' si en el dominio de Production se ven "editar"/"quitar"
  'no'::text                      as previews_resueltos,      -- 'si' si no queda ningún Preview con código anterior contra esta base
  'PEGAR_NOMBRE'::text            as verificado_por,
  7                               as dias_ventana;            -- mínimo 3

do $$
declare v record;
begin
  select * into v from verificacion_vercel;
  if v.commit_produccion !~ '^[0-9a-f]{7,40}$' then
    raise exception 'Falta el commit del deployment de Production (7–40 caracteres hexadecimales). No se programó nada.';
  end if;
  if v.dominio_produccion !~ '^https://[a-z0-9.-]+\.[a-z]{2,}/?$' or v.dominio_produccion ~ '-git-' then
    raise exception 'El dominio de Production no es válido o parece un Preview (contiene -git-): usa el de Settings → Domains. No se programó nada.';
  end if;
  if v.deployment_ready <> 'si' or v.commit_es_merge_201 <> 'si' or v.celda_nueva_vista <> 'si' or v.previews_resueltos <> 'si' then
    raise exception 'La verificación en Vercel está incompleta (Ready/Current, commit, pantalla nueva en Production y Previews antiguos deben ser ''si''). No se programó nada.';
  end if;
  if coalesce(btrim(v.verificado_por), '') = '' or v.verificado_por ~ '^PEGAR_' then
    raise exception 'Indica quién hizo la verificación. No se programó nada.';
  end if;
end $$;

-- Lo que la base sí sabe (informativo; NO prueba Producción).
select c.estado, c.primer_uso_firma_nueva as primer_llamada_con_version_produccion_o_preview, c.cierra_en,
       public._firmas_antiguas_cerradas() as ya_cerradas
  from public.vuelos_cierre_firmas_201 c;
select firma, count(*) as llamadas_viejas_ultimas_24h, max(usado_en) as ultima
  from public.vuelos_firmas_antiguas_uso
 where usado_en >= now() - interval '24 hours'
 group by firma order by firma;

-- Programar, dejando la verificación como constancia en el estado del cierre.
select public.programar_cierre_firmas_antiguas(
         v.dias_ventana,
         format('Verificado en Vercel por %s el %s: Production %s, commit %s, Ready/Current, pantalla nueva vista, Previews antiguos resueltos.',
                v.verificado_por, now(), v.dominio_produccion, v.commit_produccion)) as cierra_en
  from verificacion_vercel v;

commit;
