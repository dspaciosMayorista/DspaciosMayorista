-- ───────────────────────────────────────────────────────────────────────────
-- 177 · EDADES PROPIAS POR FILA DE tarifa_hotel (hotel + temporada/promoción
-- + categoría + alimentación)
--
-- Propuesta entregada en la ronda de diseño "Dubai edades/suplementos/
-- promoción" (informe previo, alternativas comparadas: override en
-- hotel_temporadas / override en tarifa_hotel / JSONB en tarifa_hotel — se
-- eligió columnas explícitas en tarifa_hotel porque es la ÚNICA alternativa
-- que captura la combinación completa hotel+temporada+categoría+alimentación
-- sin una consulta adicional: el motor de reserva YA trae esta fila para el
-- precio, así que leer la regla de edad del MISMO row no agrega I/O).
--
-- NULL en las 4 columnas = sin override, la fila sigue el fallback histórico
-- (regla general de `hoteles.edad_infante_min/max`/`edad_nino_min/max`, y si
-- tampoco existe, los defaults históricos que ya usaba el motor: infante
-- 0-2, niño 3-10 — ver `lib/calc/reglaEdadTarifa.ts`). NINGUNA fila existente
-- cambia de comportamiento: todas quedan en NULL tras esta migración.
--
-- CHECK: "todas o ninguna" (nunca un override parcial — sería una regla
-- incompleta, fail-closed en la validación de la calculadora también) +
-- rango estructuralmente imposible de solapar/discontinuar:
--   · edad_infante_min debe ser EXACTAMENTE 0 (nunca configurable a otro
--     valor — así lo pidió el encargo, simplifica el rango a 2 grados de
--     libertad reales: infanteMax y ninoMax);
--   · edad_infante_max >= 0;
--   · edad_nino_min debe ser EXACTAMENTE edad_infante_max + 1 (nunca un
--     hueco entre infante y niño, nunca un solape — el "+1" es la única
--     forma estructural de impedir ambos casos a la vez);
--   · edad_nino_max >= edad_nino_min;
--   · edad_nino_max <= 17 (un menor de 18+ no es "niño" para efectos de
--     tarifa, tope comercial pedido explícitamente).
--
-- Migración ADITIVA e idempotente (`add column if not exists`, guardas
-- `if not exists` en los CHECK) — se puede re-correr sin duplicar. NO
-- inserta datos, NO borra nada, NO tiene RLS propia (hereda la de
-- `tarifa_hotel`, sin cambios).
--
-- ⚠️⚠️ RIESGO DE DESPLIEGUE (leer antes de mergear el PR que trae este
-- código) — esta migración se ENTREGA en el repo pero NO se ha aplicado en
-- ningún entorno (ni local ni remoto), pendiente de que el dueño la corra:
--
--  · `computarReserva` (lib/reservar/computo.ts) hace `select` de las 4
--    columnas nuevas (edad_infante_min/max, edad_nino_min/max) de
--    `tarifa_hotel`/`hoteles` en AMBAS ramas de Reservar (bloqueo/salida vía
--    `tarifario_resultado`, y porción/dinámico vía fechas) — para CUALQUIER
--    hotel con `modelo_tarifario = 'persona'`, no solo los que configuraron
--    "edades propias" en la calculadora Dubai. `lib/reservar/cotizar.ts`
--    (`buscarHoteles`/`sugerenciasBusquedaGeneral`, el buscador público) hace
--    lo mismo.
--  · Si ese código se despliega ANTES de correr esta migración en el mismo
--    entorno, esas consultas fallan con "column does not exist"
--    (PostgREST/Postgres) — **rompe TODAS las reservas y búsquedas de hotel
--    con modelo "persona" de ese entorno**, no solo Dubai, no solo las
--    que usan edades propias. Deliberadamente NO se implementó un fallback
--    en runtime que atrape ese error y oculte la columna faltante (seguir
--    funcionando "a medias" sin la migración aplicada disfrazaría el
--    verdadero problema — el orden de despliegue — como si fuera opcional,
--    cuando NO lo es).
--
--  ORDEN OBLIGATORIO, sin excepciones ni pasos intercambiados:
--    1) correr `preflight_177_tarifa_hotel_edades_propias.sql` en el entorno
--       REMOTO real (no basta con local) — confirma que las columnas/CHECK
--       todavía no existen y que no hay volumen inesperado;
--    2) aplicar ESTA migración (177) en el entorno REMOTO;
--    3) correr `postcheck_177_tarifa_hotel_edades_propias.sql` en el mismo
--       entorno REMOTO — confirma columnas/CHECK/comportamiento con una fila
--       real, sin dejar datos modificados (usa ROLLBACK);
--    4) recién ENTONCES desplegar el código (`computo.ts`/`cotizar.ts`/
--       `CalculadoraEditor.tsx`/`calculadoras.ts`) a ese entorno.
--
-- Preflight / postcheck / rollback: ver
-- supabase/scripts/{preflight,postcheck,rollback}_177_tarifa_hotel_edades_propias.sql
-- ───────────────────────────────────────────────────────────────────────────

begin;

alter table public.tarifa_hotel
  add column if not exists edad_infante_min integer,
  add column if not exists edad_infante_max integer,
  add column if not exists edad_nino_min    integer,
  add column if not exists edad_nino_max    integer;

do $$
begin
  -- "Todas o ninguna": nunca un override parcial. `conrelid` filtrado
  -- explícito (no solo `conname`): sin él, una restricción con el MISMO
  -- nombre en otra tabla haría que este guard crea que ya existe y se salte
  -- el `alter table add constraint` en `tarifa_hotel` — un nombre de
  -- constraint es único POR TABLA en Postgres, no global.
  if not exists (
    select 1 from pg_constraint
    where conname = 'tarifa_hotel_edades_todas_o_ninguna_check'
      and conrelid = 'public.tarifa_hotel'::regclass
  ) then
    alter table public.tarifa_hotel add constraint tarifa_hotel_edades_todas_o_ninguna_check
      check (
        (edad_infante_min is null and edad_infante_max is null
         and edad_nino_min is null and edad_nino_max is null)
        or
        (edad_infante_min is not null and edad_infante_max is not null
         and edad_nino_min is not null and edad_nino_max is not null)
      );
  end if;

  -- Rangos: infanteMin fijo en 0; ninoMin fijo en infanteMax+1 (sin hueco ni
  -- solape posible por construcción); ninoMax >= ninoMin y <= 17. Solo se
  -- evalúa cuando las 4 columnas están pobladas (el "or" de arriba ya cubre
  -- el caso NULL; acá basta con que el check sea NULL-safe: cualquier
  -- comparación contra NULL da NULL, que Postgres trata como "no viola" en
  -- un CHECK — coherente con el primer constraint, que ya exige todas o
  -- ninguna).
  if not exists (
    select 1 from pg_constraint
    where conname = 'tarifa_hotel_edades_rangos_check'
      and conrelid = 'public.tarifa_hotel'::regclass
  ) then
    alter table public.tarifa_hotel add constraint tarifa_hotel_edades_rangos_check
      check (
        edad_infante_min is null or (
          edad_infante_min = 0
          and edad_infante_max >= 0
          and edad_nino_min = edad_infante_max + 1
          and edad_nino_max >= edad_nino_min
          and edad_nino_max <= 17
        )
      );
  end if;
end $$;

commit;
