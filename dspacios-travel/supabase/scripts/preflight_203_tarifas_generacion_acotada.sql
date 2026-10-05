-- ───────────────────────────────────────────────────────────────────────────
-- PREFLIGHT · migración 203 — SOLO LECTURA (no escribe nada).
-- Correr en el editor SQL del entorno ANTES de aplicar la migración.
-- ───────────────────────────────────────────────────────────────────────────

-- 0) Orden: la 203 va DESPUÉS de la 201 (Vuelos, ya en Producción). No
--    depende de la 202 (reservada para CRM, otro trabajo): puede aplicarse
--    antes que ella, y este preflight no la exige ni la busca. Si más adelante
--    la 202 instala auditoría global, ver el aviso de la cabecera de la 203.
select to_regclass('public.vuelos_cierre_firmas_201') is not null as vuelos_201_aplicada; -- esperado: true

-- 0b) Requisito: la regla común de fecha de negocio (migración 198), que la
--     203 usa para decidir qué vigencias tienen la compra cerrada.
select to_regprocedure('public.fecha_negocio(timestamptz)') is not null as fecha_negocio_198; -- esperado: true

-- 1) Requisito: la 179 está aplicada (columnas que la 203 inserta).
select column_name
from information_schema.columns
where table_schema = 'public' and table_name = 'tarifa_hotel'
  and column_name in ('precio_final_autoritativo', 'temporada_base', 'neto_nino2', 'neto_infante',
                      'edad_infante_min', 'edad_infante_max', 'edad_nino_min', 'edad_nino_max')
order by column_name;
-- Esperado: 8 filas.

-- 2) No existe todavía nada con los nombres de la 203.
select
  to_regclass('public.tarifa_hotel_historial')                                                   as tabla_historial,          -- esperado: null
  to_regclass('public.hotel_temporadas_historial')                                               as tabla_historial_vigencias, -- esperado: null
  to_regprocedure('public.generar_tarifas_hotel_calculadora(bigint, jsonb, jsonb, boolean, text)')      as funcion_generar,          -- esperado: null
  to_regprocedure('public.consultar_historial_tarifas(bigint, text, timestamptz, bigint, integer)') as funcion_consultar,     -- esperado: null
  to_regprocedure('public.reconstruir_tarifas_desde_auditoria(bigint)')                          as funcion_reconstruir,      -- esperado: null
  (select count(*) from pg_trigger where tgname in ('trg_tarifa_hotel_historial', 'trg_hotel_temporadas_historial')) as triggers; -- esperado: 0

-- 2b) Requisito de `reconstruir_tarifas_desde_auditoria`: la tabla de la 087.
select to_regclass('public.auditoria') is not null as auditoria_existe;  -- esperado: true

-- 3) Hoteles con calculadora, por tipo (contexto: nada cambia hasta que alguien pulse "Generar").
select tipo, count(*) as hoteles from public.hotel_calculadora group by tipo order by tipo;

-- 4) Vigencias % de hoteles con calculadora Mixta: al próximo "Generar" se
--    materializarán como PROMO si su base es única (ver lib/calc/promoCalculadora.ts).
select c.hotel_id, h.nombre as hotel, t.nombre as vigencia, t.descuento_valor, t.prioridad,
       t.regimen_restringido, t.compra_fin, t.fecha_inicio, t.fecha_fin
from public.hotel_calculadora c
join public.hoteles h on h.id = c.hotel_id
join public.hotel_temporadas t on t.hotel_id = c.hotel_id and t.tipo = 'descuento_pct'
where c.tipo = 'mixta'
order by c.hotel_id, t.prioridad desc, t.nombre;

-- 5) Filas que hoy son vigencias con compra cerrada (quedarán protegidas: ni
--    "Generar" ni "Reemplazar TODAS" las tocarán desde la calculadora).
select th.hotel_id, btrim(th.temporada) as temporada, count(*) as filas
from public.tarifa_hotel th
where exists (
  select 1 from public.hotel_temporadas t
  where t.hotel_id = th.hotel_id and btrim(t.nombre) = btrim(th.temporada)
)
and not exists (
  select 1 from public.hotel_temporadas t
  where t.hotel_id = th.hotel_id and btrim(t.nombre) = btrim(th.temporada)
    and (t.compra_fin is null or t.compra_fin >= public.fecha_negocio())
)
group by th.hotel_id, btrim(th.temporada)
order by th.hotel_id, temporada;

-- 5b) Promociones escritas a mano en hoteles Mixta (vigencia descuento_pct,
--     fila sin precio final). Tras la 203, "Generar" y "Reemplazar TODAS" las
--     rechazan; solo se cambian con "Sustituir" celda por celda.
select th.hotel_id, h.nombre as hotel, btrim(th.temporada) as promo, th.tipo_habitacion, th.alimentacion
from public.tarifa_hotel th
join public.hotel_calculadora c on c.hotel_id = th.hotel_id and c.tipo = 'mixta'
join public.hoteles h on h.id = th.hotel_id
where not coalesce(th.precio_final_autoritativo, false)
  and exists (select 1 from public.hotel_temporadas t
              where t.hotel_id = th.hotel_id and btrim(t.nombre) = btrim(th.temporada) and t.tipo = 'descuento_pct')
order by th.hotel_id, promo, th.tipo_habitacion, th.alimentacion;

-- 6) Hotel 59 (BLU BY TAMACÁ), vigencia 674 — solo verificación: la 203 NO
--    restaura ni regenera nada. Esperado hoy: 0 filas con ese nombre.
select t.id, t.nombre, t.compra_fin, t.fecha_fin,
       (select count(*) from public.tarifa_hotel th where th.hotel_id = 59 and btrim(th.temporada) = btrim(t.nombre)) as filas_tarifa
from public.hotel_temporadas t
where t.id = 674;
