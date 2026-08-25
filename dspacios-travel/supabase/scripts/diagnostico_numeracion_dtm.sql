-- ═══════════════════════════════════════════════════════════════════════════
-- DIAGNÓSTICO — Reenumeración de contratos MAYORISTA a formato DTM-####
--
-- SOLO LECTURA. No hace INSERT/UPDATE/DELETE, no crea tablas/vistas/funciones,
-- no llama nextval() (lee la secuencia con SELECT directo, que no la consume).
-- Seguro de correr en producción tal cual, cuantas veces se quiera.
--
-- Cómo leerlo: es UNA sola consulta (UNION ALL de ~25 sub-bloques) que
-- devuelve UN solo resultado con columnas (orden, seccion, sub_orden,
-- resumen, detalle). `resumen` es para lectura rápida en la grilla;
-- `detalle` es jsonb con el dato completo de esa fila (útil si se exporta a
-- CSV/se filtra). Viene ordenado por `orden` y `sub_orden` — no hace falta
-- reordenar nada en el editor de Supabase.
--
-- Corresponde a la Etapa 1 (auditoría) del pendiente "consecutivo DTM-####
-- para mayorista". No ejecutar nada de implementación hasta revisar esto.
-- ═══════════════════════════════════════════════════════════════════════════

with

-- Clasificación de CADA fila de ventas por tenant + patrón de numero_contrato
-- + su posición numérica extraída (para ordenar/detectar el máximo real).
clasificado as (
  select
    v.numero_contrato,
    v.tenant,
    v.created_at,
    case
      when v.numero_contrato is null or btrim(v.numero_contrato) = '' then 'VACÍO/NULL'
      when v.numero_contrato ~ '^00-[0-9]+$'        then 'mayorista: 00-NNNN (estándar)'
      when v.numero_contrato ~ '^MIN-00-[0-9]+$'    then 'minorista: MIN-00-NNNN (estándar)'
      when v.numero_contrato ~ '^MIN-'              then 'minorista: MIN- + formato atípico'
      when v.numero_contrato ~ '^DTM-[0-9]+$'       then '¡YA EXISTE DTM-! (colisión potencial)'
      else 'formato atípico / inesperado'
    end as patron,
    nullif(regexp_replace(coalesce(v.numero_contrato, ''), '\D', '', 'g'), '')::bigint as num_extraido
  from public.ventas v
),

-- Propuesta de reenumeración SOLO para mayorista: orden determinista por
-- created_at asc, desempate por el número actual (numérico, luego texto).
propuesta as (
  select
    numero_contrato, tenant, created_at, num_extraido,
    row_number() over (
      order by created_at asc, num_extraido asc nulls last, numero_contrato asc
    ) as posicion
  from clasificado
  where tenant = 'mayorista'
)

-- ─────────────────────────────────────────────────────────────────────────
-- 0. RESUMEN EJECUTIVO
-- ─────────────────────────────────────────────────────────────────────────
select 0, '0. Resumen ejecutivo', 1,
  format('Total ventas=%s · mayorista=%s · minorista=%s', total, mayorista, minorista),
  jsonb_build_object('total_ventas', total, 'mayorista', mayorista, 'minorista', minorista)
from (
  select count(*) as total,
    count(*) filter (where tenant = 'mayorista') as mayorista,
    count(*) filter (where tenant = 'minorista') as minorista
  from public.ventas
) r

union all
select 0, '0. Resumen ejecutivo', 2,
  format('Mayorista: primer contrato %s, último %s', min(created_at), max(created_at)),
  jsonb_build_object('mayorista_created_min', min(created_at), 'mayorista_created_max', max(created_at))
from public.ventas where tenant = 'mayorista'

union all
select 0, '0. Resumen ejecutivo', 3,
  format('Si se reenumera TODO mayorista hoy: DTM-0001 .. %s (%s contratos)', 'DTM-' || lpad(max(posicion)::text, 4, '0'), count(*)),
  jsonb_build_object('ultimo_numero_propuesto', 'DTM-' || lpad(max(posicion)::text, 4, '0'), 'cantidad', count(*))
from propuesta

-- ─────────────────────────────────────────────────────────────────────────
-- 1. CONTRATOS POR TENANT (+ tenant ambiguo/NULL, defensivo)
-- ─────────────────────────────────────────────────────────────────────────
union all
select 1, '1. Contratos por tenant', row_number() over (order by tenant),
  format('tenant=%s → %s contratos', tenant, count(*)),
  jsonb_build_object('tenant', tenant, 'cantidad', count(*))
from public.ventas
group by tenant

union all
select 1, '1. Contratos por tenant — AMBIGUO/NULL (debería ser 0: la columna es NOT NULL)', 99,
  format('%s filas con tenant NULL o fuera de (mayorista,minorista)', count(*)),
  jsonb_build_object('cantidad', count(*))
from public.ventas
where tenant is null or tenant not in ('mayorista', 'minorista')

-- ─────────────────────────────────────────────────────────────────────────
-- 2. FORMATOS / PREFIJOS ACTUALES POR TENANT
-- ─────────────────────────────────────────────────────────────────────────
union all
select 2, '2. Formato de numero_contrato por tenant', row_number() over (order by tenant, patron),
  format('%s | %s → %s', tenant, patron, count(*)),
  jsonb_build_object('tenant', tenant, 'patron', patron, 'cantidad', count(*))
from clasificado
group by tenant, patron

-- ─────────────────────────────────────────────────────────────────────────
-- 3. LISTA DE REENUMERACIÓN PROPUESTA (mayorista) — id/numero actual/fecha/propuesto
--    Criterio: created_at asc, desempate por número actual. Cap informativo
--    de 2000 filas por fila de resultado (evita timeouts en agencias grandes;
--    el conteo real ya salió completo en la sección 0).
-- ─────────────────────────────────────────────────────────────────────────
union all
select 3, '3. Reenumeración propuesta (mayorista)', posicion,
  format('#%s: %s (creado %s) → %s', posicion, numero_contrato, created_at::date, 'DTM-' || lpad(posicion::text, 4, '0')),
  jsonb_build_object(
    'posicion', posicion,
    'numero_contrato_actual', numero_contrato,
    'created_at', created_at,
    'numero_propuesto', 'DTM-' || lpad(posicion::text, 4, '0')
  )
from propuesta
where posicion <= 2000

union all
select 3, '3. Reenumeración propuesta (mayorista) — AVISO SI SE TRUNCÓ', 99999,
  format('Total a reenumerar=%s (mostrando máx. 2000 arriba)', count(*)),
  jsonb_build_object('total', count(*))
from propuesta

-- ─────────────────────────────────────────────────────────────────────────
-- 4. DUPLICADOS (no deberían existir, numero_contrato es PK) E INVÁLIDOS
-- ─────────────────────────────────────────────────────────────────────────
union all
select 4, '4a. Duplicados de numero_contrato (esperado: 0 filas)', row_number() over (),
  format('%s aparece %s veces', numero_contrato, cnt),
  jsonb_build_object('numero_contrato', numero_contrato, 'veces', cnt)
from (select numero_contrato, count(*) cnt from public.ventas group by numero_contrato having count(*) > 1) d

union all
select 4, '4b. Números con formato atípico / vacío / colisión DTM- ya existente', row_number() over (order by created_at),
  format('%s (tenant=%s, creado %s) — %s', numero_contrato, tenant, created_at::date, patron),
  jsonb_build_object('numero_contrato', numero_contrato, 'tenant', tenant, 'created_at', created_at, 'patron', patron)
from clasificado
where patron not like '%estándar%'

-- ─────────────────────────────────────────────────────────────────────────
-- 5. MÁXIMO CONSECUTIVO ACTUAL POR TENANT + ESTADO CRUDO DE contrato_seq
--    (contrato_seq es HOY una secuencia GLOBAL, compartida por los dos
--    tenants — ver hallazgos. SELECT directo a la secuencia no la consume.)
-- ─────────────────────────────────────────────────────────────────────────
union all
select 5, '5. Máximo consecutivo numérico detectado por tenant', row_number() over (order by tenant),
  format('%s → máximo=%s', tenant, max(num_extraido)),
  jsonb_build_object('tenant', tenant, 'maximo_numerico', max(num_extraido))
from clasificado
group by tenant

union all
select 5, '5. Estado crudo de public.contrato_seq (secuencia compartida hoy)', 99,
  format('last_value=%s, is_called=%s (si is_called=false, ese valor todavía NO fue entregado)', last_value, is_called),
  jsonb_build_object('last_value', last_value, 'is_called', is_called)
from public.contrato_seq

-- ─────────────────────────────────────────────────────────────────────────
-- 6. REFERENCIAS POR TABLA AFECTADA — total / de-mayorista / huérfanas
--    (huérfana = tiene numero_contrato pero esa fila ya no existe en ventas;
--    para las tablas con FK real esto DEBERÍA dar 0 siempre)
-- ─────────────────────────────────────────────────────────────────────────
union all
select 6, '6. Referencias — abonos (FK directa a ventas)', null,
  format('total=%s, de_mayorista=%s, huérfanas=%s', total, mayorista, huerfanas),
  jsonb_build_object('tabla', 'abonos', 'fk', 'directa a ventas', 'total', total, 'de_mayorista', mayorista, 'huerfanas', huerfanas)
from (select count(*) total, count(*) filter (where v.tenant = 'mayorista') mayorista,
             count(*) filter (where t.numero_contrato is not null and v.numero_contrato is null) huerfanas
      from public.abonos t left join public.ventas v on v.numero_contrato = t.numero_contrato) x

union all
select 6, '6. Referencias — cuentas_por_pagar (FK directa a ventas)', null,
  format('total=%s, de_mayorista=%s, huérfanas=%s', total, mayorista, huerfanas),
  jsonb_build_object('tabla', 'cuentas_por_pagar', 'fk', 'directa a ventas', 'total', total, 'de_mayorista', mayorista, 'huerfanas', huerfanas)
from (select count(*) total, count(*) filter (where v.tenant = 'mayorista') mayorista,
             count(*) filter (where t.numero_contrato is not null and v.numero_contrato is null) huerfanas
      from public.cuentas_por_pagar t left join public.ventas v on v.numero_contrato = t.numero_contrato) x

union all
select 6, '6. Referencias — aliados_b2b (FK directa a ventas)', null,
  format('total=%s, de_mayorista=%s, huérfanas=%s', total, mayorista, huerfanas),
  jsonb_build_object('tabla', 'aliados_b2b', 'fk', 'directa a ventas', 'total', total, 'de_mayorista', mayorista, 'huerfanas', huerfanas)
from (select count(*) total, count(*) filter (where v.tenant = 'mayorista') mayorista,
             count(*) filter (where t.numero_contrato is not null and v.numero_contrato is null) huerfanas
      from public.aliados_b2b t left join public.ventas v on v.numero_contrato = t.numero_contrato) x

union all
select 6, '6. Referencias — liquidacion_comisiones (FK directa a ventas)', null,
  format('total=%s, de_mayorista=%s, huérfanas=%s', total, mayorista, huerfanas),
  jsonb_build_object('tabla', 'liquidacion_comisiones', 'fk', 'directa a ventas', 'total', total, 'de_mayorista', mayorista, 'huerfanas', huerfanas)
from (select count(*) total, count(*) filter (where v.tenant = 'mayorista') mayorista,
             count(*) filter (where t.numero_contrato is not null and v.numero_contrato is null) huerfanas
      from public.liquidacion_comisiones t left join public.ventas v on v.numero_contrato = t.numero_contrato) x

union all
select 6, '6. Referencias — facturacion (FK directa a ventas)', null,
  format('total=%s, de_mayorista=%s, huérfanas=%s', total, mayorista, huerfanas),
  jsonb_build_object('tabla', 'facturacion', 'fk', 'directa a ventas', 'total', total, 'de_mayorista', mayorista, 'huerfanas', huerfanas)
from (select count(*) total, count(*) filter (where v.tenant = 'mayorista') mayorista,
             count(*) filter (where t.numero_contrato is not null and v.numero_contrato is null) huerfanas
      from public.facturacion t left join public.ventas v on v.numero_contrato = t.numero_contrato) x

union all
select 6, '6. Referencias — rentabilidad (FK directa a ventas)', null,
  format('total=%s, de_mayorista=%s, huérfanas=%s', total, mayorista, huerfanas),
  jsonb_build_object('tabla', 'rentabilidad', 'fk', 'directa a ventas', 'total', total, 'de_mayorista', mayorista, 'huerfanas', huerfanas)
from (select count(*) total, count(*) filter (where v.tenant = 'mayorista') mayorista,
             count(*) filter (where t.numero_contrato is not null and v.numero_contrato is null) huerfanas
      from public.rentabilidad t left join public.ventas v on v.numero_contrato = t.numero_contrato) x

union all
select 6, '6. Referencias — sillas (FK directa a ventas, nullable)', null,
  format('total_con_contrato=%s, de_mayorista=%s, huérfanas=%s', total, mayorista, huerfanas),
  jsonb_build_object('tabla', 'sillas', 'fk', 'directa a ventas (nullable)', 'total_con_contrato', total, 'de_mayorista', mayorista, 'huerfanas', huerfanas)
from (select count(*) filter (where t.numero_contrato is not null) total,
             count(*) filter (where v.tenant = 'mayorista') mayorista,
             count(*) filter (where t.numero_contrato is not null and v.numero_contrato is null) huerfanas
      from public.sillas t left join public.ventas v on v.numero_contrato = t.numero_contrato) x

union all
select 6, '6. Referencias — contrato_pasajeros (FK directa a ventas, cascade)', null,
  format('total=%s, de_mayorista=%s, huérfanas=%s', total, mayorista, huerfanas),
  jsonb_build_object('tabla', 'contrato_pasajeros', 'fk', 'directa a ventas (on delete cascade)', 'total', total, 'de_mayorista', mayorista, 'huerfanas', huerfanas)
from (select count(*) total, count(*) filter (where v.tenant = 'mayorista') mayorista,
             count(*) filter (where t.numero_contrato is not null and v.numero_contrato is null) huerfanas
      from public.contrato_pasajeros t left join public.ventas v on v.numero_contrato = t.numero_contrato) x

union all
select 6, '6. Referencias — contrato_hoteles (FK directa a ventas, cascade)', null,
  format('total=%s, de_mayorista=%s, huérfanas=%s', total, mayorista, huerfanas),
  jsonb_build_object('tabla', 'contrato_hoteles', 'fk', 'directa a ventas (on delete cascade)', 'total', total, 'de_mayorista', mayorista, 'huerfanas', huerfanas)
from (select count(*) total, count(*) filter (where v.tenant = 'mayorista') mayorista,
             count(*) filter (where t.numero_contrato is not null and v.numero_contrato is null) huerfanas
      from public.contrato_hoteles t left join public.ventas v on v.numero_contrato = t.numero_contrato) x

union all
select 6, '6. Referencias — contrato_vuelos (FK directa a ventas, cascade)', null,
  format('total=%s, de_mayorista=%s, huérfanas=%s', total, mayorista, huerfanas),
  jsonb_build_object('tabla', 'contrato_vuelos', 'fk', 'directa a ventas (on delete cascade)', 'total', total, 'de_mayorista', mayorista, 'huerfanas', huerfanas)
from (select count(*) total, count(*) filter (where v.tenant = 'mayorista') mayorista,
             count(*) filter (where t.numero_contrato is not null and v.numero_contrato is null) huerfanas
      from public.contrato_vuelos t left join public.ventas v on v.numero_contrato = t.numero_contrato) x

union all
select 6, '6. Referencias — contrato_items (FK directa a ventas, cascade)', null,
  format('total=%s, de_mayorista=%s, huérfanas=%s', total, mayorista, huerfanas),
  jsonb_build_object('tabla', 'contrato_items', 'fk', 'directa a ventas (on delete cascade)', 'total', total, 'de_mayorista', mayorista, 'huerfanas', huerfanas)
from (select count(*) total, count(*) filter (where v.tenant = 'mayorista') mayorista,
             count(*) filter (where t.numero_contrato is not null and v.numero_contrato is null) huerfanas
      from public.contrato_items t left join public.ventas v on v.numero_contrato = t.numero_contrato) x

union all
select 6, '6. Referencias — contrato_adjuntos (FK directa a ventas, cascade)', null,
  format('total=%s, de_mayorista=%s, huérfanas=%s', total, mayorista, huerfanas),
  jsonb_build_object('tabla', 'contrato_adjuntos', 'fk', 'directa a ventas (on delete cascade)', 'total', total, 'de_mayorista', mayorista, 'huerfanas', huerfanas)
from (select count(*) total, count(*) filter (where v.tenant = 'mayorista') mayorista,
             count(*) filter (where t.numero_contrato is not null and v.numero_contrato is null) huerfanas
      from public.contrato_adjuntos t left join public.ventas v on v.numero_contrato = t.numero_contrato) x

union all
select 6, '6. Referencias — cotizaciones (FK directa a ventas, nullable)', null,
  format('total_con_contrato=%s, de_mayorista=%s, huérfanas=%s', total, mayorista, huerfanas),
  jsonb_build_object('tabla', 'cotizaciones', 'fk', 'directa a ventas (nullable)', 'total_con_contrato', total, 'de_mayorista', mayorista, 'huerfanas', huerfanas)
from (select count(*) filter (where t.numero_contrato is not null) total,
             count(*) filter (where v.tenant = 'mayorista') mayorista,
             count(*) filter (where t.numero_contrato is not null and v.numero_contrato is null) huerfanas
      from public.cotizaciones t left join public.ventas v on v.numero_contrato = t.numero_contrato) x

union all
select 6, '6. Referencias — vouchers (FK directa a ventas, cascade)', null,
  format('total=%s, de_mayorista=%s, huérfanas=%s', total, mayorista, huerfanas),
  jsonb_build_object('tabla', 'vouchers', 'fk', 'directa a ventas (on delete cascade)', 'total', total, 'de_mayorista', mayorista, 'huerfanas', huerfanas)
from (select count(*) total, count(*) filter (where v.tenant = 'mayorista') mayorista,
             count(*) filter (where t.numero_contrato is not null and v.numero_contrato is null) huerfanas
      from public.vouchers t left join public.ventas v on v.numero_contrato = t.numero_contrato) x

union all
select 6, '6. Referencias — cuotas (FK directa a ventas, cascade)', null,
  format('total=%s, de_mayorista=%s, huérfanas=%s', total, mayorista, huerfanas),
  jsonb_build_object('tabla', 'cuotas', 'fk', 'directa a ventas (on delete cascade)', 'total', total, 'de_mayorista', mayorista, 'huerfanas', huerfanas)
from (select count(*) total, count(*) filter (where v.tenant = 'mayorista') mayorista,
             count(*) filter (where t.numero_contrato is not null and v.numero_contrato is null) huerfanas
      from public.cuotas t left join public.ventas v on v.numero_contrato = t.numero_contrato) x

union all
select 6, '6. Referencias — contrato_facturacion (PK=FK directa a ventas, cascade)', null,
  format('total=%s, de_mayorista=%s, huérfanas=%s', total, mayorista, huerfanas),
  jsonb_build_object('tabla', 'contrato_facturacion', 'fk', 'PK y FK directa a ventas (on delete cascade)', 'total', total, 'de_mayorista', mayorista, 'huerfanas', huerfanas)
from (select count(*) total, count(*) filter (where v.tenant = 'mayorista') mayorista,
             count(*) filter (where t.numero_contrato is not null and v.numero_contrato is null) huerfanas
      from public.contrato_facturacion t left join public.ventas v on v.numero_contrato = t.numero_contrato) x

union all
select 6, '6. Referencias — contrato_servicios (FK directa a ventas, cascade)', null,
  format('total=%s, de_mayorista=%s, huérfanas=%s', total, mayorista, huerfanas),
  jsonb_build_object('tabla', 'contrato_servicios', 'fk', 'directa a ventas (on delete cascade)', 'total', total, 'de_mayorista', mayorista, 'huerfanas', huerfanas)
from (select count(*) total, count(*) filter (where v.tenant = 'mayorista') mayorista,
             count(*) filter (where t.numero_contrato is not null and v.numero_contrato is null) huerfanas
      from public.contrato_servicios t left join public.ventas v on v.numero_contrato = t.numero_contrato) x

union all
select 6, '6. Referencias — contrato_vuelo_control (PK=FK directa a ventas, cascade)', null,
  format('total=%s, de_mayorista=%s, huérfanas=%s', total, mayorista, huerfanas),
  jsonb_build_object('tabla', 'contrato_vuelo_control', 'fk', 'PK y FK directa a ventas (on delete cascade)', 'total', total, 'de_mayorista', mayorista, 'huerfanas', huerfanas)
from (select count(*) total, count(*) filter (where v.tenant = 'mayorista') mayorista,
             count(*) filter (where t.numero_contrato is not null and v.numero_contrato is null) huerfanas
      from public.contrato_vuelo_control t left join public.ventas v on v.numero_contrato = t.numero_contrato) x

-- ⚠️ NIVEL 2 — FK ANIDADA, no apunta directo a ventas. fn_renumerar_contrato
-- (migración 115) solo camina FKs con confrelid = ventas: esta tabla NO
-- aparece en ese barrido y quedaría bloqueando la renumeración de
-- contrato_vuelo_control si tiene filas.
union all
select 6, '6. Referencias — contrato_vuelo_control_cambios (⚠️ FK ANIDADA: → contrato_vuelo_control, NO → ventas directo)', null,
  format('total=%s, de_mayorista=%s (⚠️ fn_renumerar_contrato actual NO camina esta tabla)', total, mayorista),
  jsonb_build_object('tabla', 'contrato_vuelo_control_cambios', 'fk', 'anidada: → contrato_vuelo_control(numero_contrato), NO → ventas', 'total', total, 'de_mayorista', mayorista)
from (
  select count(*) total, count(*) filter (where v.tenant = 'mayorista') mayorista
  from public.contrato_vuelo_control_cambios c
  join public.contrato_vuelo_control cvc on cvc.numero_contrato = c.numero_contrato
  left join public.ventas v on v.numero_contrato = cvc.numero_contrato
) x

-- ── SIN FK (texto suelto) ───────────────────────────────────────────────
union all
select 6, '6. Referencias — conciliacion_sistema.numero_contrato (SIN FK, snapshot)', null,
  format('total_con_contrato=%s, de_mayorista=%s, huérfanas=%s', total, mayorista, huerfanas),
  jsonb_build_object('tabla', 'conciliacion_sistema', 'fk', 'NINGUNA — columna de texto suelto (snapshot al cruzar)', 'total_con_contrato', total, 'de_mayorista', mayorista, 'huerfanas', huerfanas)
from (select count(*) filter (where t.numero_contrato is not null) total,
             count(*) filter (where v.tenant = 'mayorista') mayorista,
             count(*) filter (where t.numero_contrato is not null and v.numero_contrato is null) huerfanas
      from public.conciliacion_sistema t left join public.ventas v on v.numero_contrato = t.numero_contrato) x

union all
select 6, '6. Referencias — liquidacion_descuentos.numero_contrato (SIN FK, trazabilidad opcional)', null,
  format('total_con_contrato=%s, de_mayorista=%s, huérfanas=%s', total, mayorista, huerfanas),
  jsonb_build_object('tabla', 'liquidacion_descuentos', 'fk', 'NINGUNA — columna de texto suelto (opcional)', 'total_con_contrato', total, 'de_mayorista', mayorista, 'huerfanas', huerfanas)
from (select count(*) filter (where t.numero_contrato is not null) total,
             count(*) filter (where v.tenant = 'mayorista') mayorista,
             count(*) filter (where t.numero_contrato is not null and v.numero_contrato is null) huerfanas
      from public.liquidacion_descuentos t left join public.ventas v on v.numero_contrato = t.numero_contrato) x

union all
select 6, '6. Referencias — auditoria.registro_id (SIN FK, histórico — NO debe tocarse en un rename)', null,
  format('total_parece_contrato=%s (heurística: coincide con algún numero_contrato actual o formato 00-/MIN-/DTM-)', total),
  jsonb_build_object('tabla', 'auditoria', 'fk', 'NINGUNA — texto libre + snapshots jsonb antes/despues', 'total_parece_contrato', total)
from (
  select count(*) total from public.auditoria a
  where a.registro_id ~ '^(00-|MIN-|DTM-)'
) x

-- ─────────────────────────────────────────────────────────────────────────
-- 7. DETALLE DE REFERENCIAS HUÉRFANAS (solo las tablas SIN FK real, que son
--    las únicas donde de verdad pueden existir) — cap 300 filas
-- ─────────────────────────────────────────────────────────────────────────
union all
(select 7, '7. Huérfanas — conciliacion_sistema (numero_contrato sin match en ventas)', row_number() over (),
  format('conciliacion_sistema.id=%s → numero_contrato=%s (no existe en ventas)', t.id, t.numero_contrato),
  jsonb_build_object('id', t.id, 'numero_contrato', t.numero_contrato)
from public.conciliacion_sistema t
where t.numero_contrato is not null
  and not exists (select 1 from public.ventas v where v.numero_contrato = t.numero_contrato)
limit 300)

union all
(select 7, '7. Huérfanas — liquidacion_descuentos (numero_contrato sin match en ventas)', row_number() over (),
  format('liquidacion_descuentos.id=%s → numero_contrato=%s (no existe en ventas)', t.id, t.numero_contrato),
  jsonb_build_object('id', t.id, 'numero_contrato', t.numero_contrato)
from public.liquidacion_descuentos t
where t.numero_contrato is not null
  and not exists (select 1 from public.ventas v where v.numero_contrato = t.numero_contrato)
limit 300)

-- ─────────────────────────────────────────────────────────────────────────
-- 8. STORAGE — objetos del bucket `contratos` afectados
-- ─────────────────────────────────────────────────────────────────────────
union all
select 8, '8a. Storage — objetos bajo contratos de mayorista (bucket contratos)', 1,
  format('%s objetos con prefijo = numero_contrato de mayorista', count(*)),
  jsonb_build_object('total_objetos', count(*))
from storage.objects o
join public.ventas v on v.numero_contrato = split_part(o.name, '/', 1)
where o.bucket_id = 'contratos' and v.tenant = 'mayorista'

union all
select 8, '8b. Storage — prefijos SIN contrato asociado (ni pe-empleados) — ya señalado por la migración 150', row_number() over (order by cnt desc),
  format('prefijo=%s → %s objetos (revisar antes de cualquier migración de storage)', prefijo, cnt),
  jsonb_build_object('prefijo', prefijo, 'objetos', cnt)
from (
  select split_part(o.name, '/', 1) as prefijo, count(*) as cnt
  from storage.objects o
  where o.bucket_id = 'contratos'
    and split_part(o.name, '/', 1) <> 'pe-empleados'
    and not exists (select 1 from public.ventas v where v.numero_contrato = split_part(o.name, '/', 1))
  group by 1
) s

-- ─────────────────────────────────────────────────────────────────────────
-- 9. COLISIONES QUE PRODUCIRÍA DTM-0001 EN ADELANTE
-- ─────────────────────────────────────────────────────────────────────────
union all
select 9, '9a. Colisión — numero_contrato ya usa el prefijo DTM- (esperado: 0 filas)', row_number() over (),
  format('%s (tenant=%s) ya existe con prefijo DTM-', numero_contrato, tenant),
  jsonb_build_object('numero_contrato', numero_contrato, 'tenant', tenant)
from public.ventas
where numero_contrato ~ '^DTM-'

union all
select 9, '9b. Colisión — el literal "DTM-" aparece en tablas sin FK (registro_id/snapshots)', row_number() over (),
  format('%s filas en auditoria.registro_id contienen "DTM-"', count(*)),
  jsonb_build_object('tabla', 'auditoria.registro_id', 'coincidencias', count(*))
from public.auditoria where registro_id like '%DTM-%'

-- ─────────────────────────────────────────────────────────────────────────
-- 10. RIESGO CONCRETO — filas de contrato_vuelo_control_cambios que
--     bloquearían fn_renumerar_contrato tal como está hoy si se reusa sin
--     ajustar (ver hallazgo de FK anidada en la sección 6)
-- ─────────────────────────────────────────────────────────────────────────
union all
select 10, '10. Filas de contrato_vuelo_control_cambios bajo contratos de mayorista', 1,
  format('%s filas (si es 0, el gap de fn_renumerar_contrato no tiene impacto HOY, pero sí en cuanto se use el editor de vuelos del contrato)', count(*)),
  jsonb_build_object('filas_en_riesgo', count(*))
from public.contrato_vuelo_control_cambios c
join public.contrato_vuelo_control cvc on cvc.numero_contrato = c.numero_contrato
join public.ventas v on v.numero_contrato = cvc.numero_contrato
where v.tenant = 'mayorista'

order by 1, 3 nulls last;
