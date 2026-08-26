-- ───────────────────────────────────────────────────────────────────────────
-- CONSULTA PREVENTIVA ÚNICA (solo lectura) — correr en producción JUSTO
-- ANTES de aplicar la migración 159 (revisión posterior al PR #274, ronda
-- 2, paso "b" del procedimiento de despliegue corregido).
--
-- Consolida en UNA sola corrida todo lo que el procedimiento de despliegue
-- exige reconfirmar antes de la 159:
--   1) cero contratos con tenant='mayorista';
--   2) cero contratos con numero_contrato que empiece por 'DTM-';
--   3) los formatos presentes en el pool de reciclaje de minorista
--      (numeros_contrato_liberados) son los dos únicos que
--      siguiente_numero_contrato_para_tenant() sabe interpretar sin
--      ambigüedad ('MIN-...' ya prefijado, o '00-NNNN' crudo histórico) —
--      cualquier OTRO formato ahí sería tratado como "crudo" y se le
--      antepondría 'MIN-' a ciegas, lo cual solo es correcto si en efecto
--      lo es;
--   4) `contrato_seq_mayorista` NO existe todavía (si ya existiera, la 159
--      fallaría al intentar crearla — o peor, indicaría que alguien ya la
--      creó por fuera de esta migración);
--   5) `siguiente_numero_contrato_para_tenant()` NO existe todavía (mismo
--      motivo).
--
-- RESULTADO: una fila por chequeo (detalle para diagnosticar SI algo
-- bloquea) más una fila final "── VEREDICTO ──" con BLOQUEADO u OK. Solo se
-- procede con la migración 159 si el veredicto final es OK — cualquier
-- BLOQUEADO exige investigar la fila de detalle correspondiente antes de
-- continuar (nunca I aplicar la 159 "a ver si sirve").
--
-- ⚠️ SOLO LECTURA: ningún INSERT/UPDATE/DELETE/MERGE/DDL. No crea objetos,
-- no llama nextval()/setval(), no modifica ningún dato. Seguro de correr
-- las veces que haga falta.
--
-- ⚠️ OBJETOS EXACTOS, no por relname/proname sueltos (revisión posterior al
-- PR #274, ronda 3): un `where relname = 'contrato_seq_mayorista'` o
-- `where proname = '...'` puede dar un FALSO BLOQUEADO si existe un objeto
-- homónimo en OTRO esquema (relname/proname no llevan esquema), o —para la
-- función— si existe una SOBRECARGA con otra firma (proname tampoco
-- distingue argumentos). Los chequeos 4 y 5 ahora usan
-- `to_regclass('public.contrato_seq_mayorista')` y
-- `to_regprocedure('public.siguiente_numero_contrato_para_tenant(text)')` —
-- ambos resuelven por esquema+nombre (y la función además por firma exacta
-- de argumentos) tal como los resolvería Postgres al ejecutar `CREATE
-- SEQUENCE`/`CREATE FUNCTION` reales, y devuelven NULL (sin lanzar error) si
-- el objeto no existe — a diferencia de `::regclass`/`::regprocedure`, que sí
-- lanzarían un error y romperían esta consulta de solo lectura. El chequeo
-- de la secuencia además confirma que el objeto resuelto es efectivamente
-- una secuencia (`relkind = 'S'`), no cualquier otro tipo de objeto que por
-- casualidad tuviera ese nombre exacto en `public`.
--
-- Complementa (no reemplaza) `preventiva_formatos_pool_reciclaje.sql`, que
-- da el desglose completo por formato del pool si el chequeo 3 bloquea aquí
-- y hace falta ver el detalle fila por fila.
--
-- Pruebas reales (positivo/negativo) de estos dos chequeos:
-- `supabase/scripts/test_preventiva_antes_de_159.sh`.
-- ───────────────────────────────────────────────────────────────────────────

with
  chk_mayorista as (
    select count(*)::bigint as n
      from public.ventas
     where tenant = 'mayorista'
  ),
  chk_dtm as (
    select count(*)::bigint as n
      from public.ventas
     where numero_contrato like 'DTM-%'
  ),
  chk_pool_formato as (
    select count(*)::bigint as n
      from public.numeros_contrato_liberados
     where not (numero like 'MIN-%' or numero ~ '^00-[0-9]+$')
  ),
  chk_secuencia as (
    select case
             when to_regclass('public.contrato_seq_mayorista') is null then 0::bigint
             else (
               select count(*)::bigint
                 from pg_class c
                where c.oid = to_regclass('public.contrato_seq_mayorista')
                  and c.relkind = 'S'
             )
           end as n
  ),
  chk_funcion as (
    select case
             when to_regprocedure('public.siguiente_numero_contrato_para_tenant(text)') is null then 0::bigint
             else 1::bigint
           end as n
  ),
  filas as (
    select 1 as orden, 'contratos_tenant_mayorista'                                as chequeo,
           n, (n = 0) as ok,
           'Debe ser 0 — ver decisión comercial: mayorista arranca en DTM-0001, sin históricos que reenumerar.' as detalle
      from chk_mayorista
    union all
    select 2, 'contratos_numero_dtm',
           n, (n = 0),
           'Debe ser 0 — ningún contrato debería tener ya un numero_contrato DTM- antes de que exista la función que los genera.'
      from chk_dtm
    union all
    select 3, 'formatos_inesperados_en_pool_minorista',
           n, (n = 0),
           'Debe ser 0 — filas de numeros_contrato_liberados que no son ni MIN-... ni 00-NNNN crudo. Si hay alguna, revisar con preventiva_formatos_pool_reciclaje.sql antes de continuar (el generador nuevo tratará cualquier valor sin el prefijo MIN- como "crudo" y le antepondrá MIN- a ciegas).'
      from chk_pool_formato
    union all
    select 4, 'contrato_seq_mayorista_no_existe_todavia',
           n, (n = 0),
           'Debe ser 0 — la secuencia NO debe existir todavía (la crea la 159). Si ya existe, alguien la creó por fuera de esta migración: investigar antes de aplicar la 159 (create sequence fallaría).'
      from chk_secuencia
    union all
    select 5, 'funcion_siguiente_numero_contrato_para_tenant_no_existe_todavia',
           n, (n = 0),
           'Debe ser 0 — la función NO debe existir todavía (la crea la 159). Si ya existe, investigar antes de aplicar la 159 (create or replace la sobrescribiría en silencio).'
      from chk_funcion
  )
select orden, chequeo, n as cantidad, ok, detalle
  from filas
union all
select 99, '── VEREDICTO ──',
       (select count(*) from filas where not ok),
       (select bool_and(ok) from filas),
       case when (select bool_and(ok) from filas)
            then 'OK — los 5 chequeos pasaron. Se puede proceder a aplicar la migración 159.'
            else 'BLOQUEADO — revisar la(s) fila(s) con ok=false antes de aplicar la migración 159. NO continuar.'
       end
order by orden;
