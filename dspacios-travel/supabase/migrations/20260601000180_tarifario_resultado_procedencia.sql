-- ───────────────────────────────────────────────────────────────────────────
-- 180 · PROCEDENCIA REAL (Base/Promoción) EN tarifario_resultado
--
-- Corrige un defecto confirmado en la ronda de validación de la migración 179:
-- la identidad "Base"/"Promoción" del precio publicado NO se puede reconstruir
-- después usando `tarifario_resultado.fecha_ida`. En Porción terrestre
-- (`masBarato`, `lib/calc/paquetes.ts::liquidarHotelMasBaratoConTemporada`) el
-- precio publicado es el MÁS BARATO de cualquier fecha dentro de la ventana de
-- viaje del paquete — así que `fecha_ida` puede pertenecer a una temporada
-- BASE aunque el precio ganador haya salido de una noche PROMOCIONAL más
-- adelante en la ventana (o al revés). Cualquier intento de la UI de
-- re-derivar la identidad a partir de `fecha_ida` es, en el mejor caso, una
-- coincidencia, y en el peor, una etiqueta FALSA mostrada al cliente.
--
-- ⚠️ SEGUNDO defecto, corregido en esta misma migración antes de aplicarse:
-- la primera versión solo persistía la identidad de la NOCHE DE ENTRADA
-- (checkin) para estadías de fecha FIJA (bloqueo) — incorrecto cuando la
-- estadía CRUZA temporadas dentro de sí misma (ej. noche 1 tarifa base,
-- noche 2 promoción: el total ya suma ambas noches, pero la fila publicada
-- solo "recordaba" la de la noche 1). `liquidarHotelNochesConTemporadas`
-- ahora devuelve la procedencia REAL de TODAS las noches que aportaron al
-- total, deduplicada — nunca elige el checkin arbitrariamente. Este archivo
-- ya nace con la representación para ambos casos (uniforme y mixta) — nunca
-- se aplicó la versión "solo checkin" en ningún entorno.
--
-- ⚠️ TERCER defecto, corregido en esta misma migración antes de aplicarse:
-- `promo_noche_gratis` ("N noches, 1 gratis") reduce el TOTAL
-- (`promoNocheGratisFactor`/hoy `resolverNocheGratisDetallado` en
-- `lib/calc/paquetes.ts`) pero `resolverNetoNocheDetallado` la excluye
-- explícitamente de la resolución noche-por-noche (no aporta un neto propio
-- por noche) — así que sin un cambio en el motor, la procedencia de una
-- estadía toda en tarifa base con noche gratis se reportaba como "Tarifa
-- base" sin mencionar la promoción que sí descontó el total. Ahora
-- `resolverNocheGratisDetallado` es la ÚNICA fuente que decide si aplica (la
-- reutilizan los 4 liquidadores: `liquidarHotelNoches`/
-- `liquidarHotelNochesConTemporadas`/`liquidarHotelMasBarato`/
-- `liquidarHotelMasBaratoConTemporada`, así que cálculo y procedencia nunca
-- pueden divergir) y, cuando aplica, agrega su propia entrada de procedencia
-- (`esPromocion: true`, `precioFinalAutoritativo: false` — no aporta una
-- fila de neto propia) a la lista ya deduplicada.
--
-- ⚠️ CUARTO defecto, corregido en esta misma migración antes de aplicarse en
-- ningún entorno real (encontrado en la validación contra PostgreSQL en
-- Docker, después de aplicar esta migración pero antes del postcheck final):
-- `_procedencia_temporadas_elementos_validos` comparaba con `<>`
-- (`jsonb_typeof(elem->'campo') <> 'tipo'`) — con una CLAVE ausente,
-- `elem->'campo'` es SQL NULL y `NULL <> 'tipo'` es NULL, no `true`; esa
-- condición NULL no selecciona la fila en el `where` de `not exists`, así
-- que un elemento con una clave FALTANTE (nunca uno con el tipo equivocado,
-- que sí producía un string real) podía colarse como "válido" dentro de un
-- arreglo MIXTO. Corregido con `IS DISTINCT FROM` en las 4 comparaciones de
-- tipo (nunca produce NULL) — ver el comentario junto a la función para el
-- detalle completo.
--
-- Columnas:
--
-- `temporada_ganadora text null` / `es_promocion boolean null` /
-- `precio_final_autoritativo boolean null` — atajo de lectura para el caso
-- COMÚN: la estadía completa resolvió UNA sola temporada (todas las noches
-- de la fila coinciden, incluida la eventual entrada de noche gratis).
-- Poblados SOLO en ese caso; si la estadía cruzó más de una temporada
-- (`procedencia_mixta = true`), las 3 quedan NULL — NUNCA se elige una
-- identidad arbitraria (ni la del checkin, ni la más barata, ni la última)
-- para rellenarlas. `es_promocion`: clasificación GENERAL por
-- `hotel_temporadas.tipo` de la vigencia ganadora (cualquier
-- descuento_pct/descuento_monto/promo_noche_gratis, generado por la
-- calculadora Dubai o creado a mano) — nunca sinónimo de
-- `precio_final_autoritativo`, que es un detalle técnico de trazabilidad
-- (si la fila de `tarifa_hotel` que produjo el neto estaba marcada precio
-- final autoritativo, migración 179) y NUNCA se usa para decidir
-- Base/Promoción en la UI.
--
-- `procedencia_temporadas jsonb null` — la lista COMPLETA, deduplicada, de
-- TODAS las temporadas que aportaron al total de esta fila (una acomodación
-- de un combo categoría/régimen), como arreglo de objetos
-- `{temporada, es_promocion, precio_final_autoritativo}` — NUNCA una lista
-- serializada como texto/CSV (estructurado y auditable: se puede filtrar/
-- consultar con operadores jsonb nativos). SIEMPRE se puebla cuando hay
-- procedencia resuelta, incluido el caso "uniforme" (un solo elemento) — es
-- la fuente única de auditoría; las 3 columnas planas de arriba son solo un
-- atajo para el caso simple, nunca la única fuente de verdad.
--
-- `procedencia_mixta boolean not null default false` — `true` cuando
-- `procedencia_temporadas` tiene MÁS DE UN elemento (la estadía de esta fila
-- cruzó temporadas, incluida la mezcla con la entrada de noche gratis).
-- Filtrable sin parsear jsonb.
--
-- NULL/`false` en TODAS las columnas de procedencia en filas generadas ANTES
-- de esta migración (sin backfill — un tarifario viejo simplemente no tiene
-- procedencia hasta que se regenere, "Generar tarifario" la puebla desde ese
-- momento) y también pueden quedar así en filas nuevas si el liquidador no
-- resolvió identidad por algún motivo (nunca se inventa un valor).
--
-- ── Integridad estricta: exactamente 3 estados posibles, ninguno más ──
--
-- 1) SIN PROCEDENCIA: `procedencia_temporadas IS NULL`, `procedencia_mixta =
--    false`, y las 3 columnas planas en NULL.
-- 2) UNIFORME: `procedencia_temporadas` es un arreglo de EXACTAMENTE 1
--    objeto, `procedencia_mixta = false`, las 3 columnas planas pobladas Y
--    EXACTAMENTE IGUALES al único objeto del arreglo (nunca un valor "cerca"
--    o "derivado" — el mismo dato, dos veces, por diseño de atajo de lectura).
-- 3) MIXTA: `procedencia_temporadas` es un arreglo de 2 o más objetos,
--    `procedencia_mixta = true`, y las 3 columnas planas en NULL.
-- Un arreglo VACÍO (`[]`) no es ninguno de los 3 estados — se rechaza.
--
-- Cada elemento del arreglo, cuando existe, debe ser un objeto jsonb con:
-- `temporada` string no vacío (después de `btrim`), `es_promocion` boolean,
-- `precio_final_autoritativo` boolean — nunca un elemento suelto (string,
-- número, null) ni un objeto con un campo del tipo equivocado o faltante.
--
-- Implementación: 2 funciones SQL `immutable` (nunca `security definer` —
-- no tocan tablas, no hay privilegio que elevar) + 4 CHECK guardados por
-- `conrelid`. Cada CHECK usa `CASE` (no `AND`/`OR` sueltos) para garantizar
-- el ORDEN de evaluación: Postgres NO garantiza que un operando de `AND`/
-- `OR` deje de evaluarse aunque el resultado ya esté decidido, así que
-- `jsonb_array_length`/`jsonb_array_elements` (que ERRORAN si el jsonb no es
-- un arreglo) SIEMPRE están detrás de un `when jsonb_typeof(...) = 'array'`
-- dentro del MISMO `case` — nunca se llaman "confiando" en que otro CHECK ya
-- validó el tipo (cada CHECK es independiente; Postgres evalúa TODOS los
-- CHECK de una fila, no se detiene en el primero que falla).
--
-- `_procedencia_temporadas_elementos_validos(jsonb)`: valida cada elemento
-- del arreglo (objeto + los 3 campos con su tipo exacto). `NOT EXISTS` sobre
-- `jsonb_array_elements` SOLO se ejecuta cuando el `case` ya confirmó que el
-- jsonb es un arreglo — la función es total (nunca lanza, siempre boolean).
-- `_tarifario_resultado_procedencia_valida(...)`: el estado-máquina de los 3
-- estados de arriba, comparando los objetos jsonb DIRECTO (`= to_jsonb(...)`
-- sobre jsonb, nunca `::boolean` sobre texto — un cast de texto a boolean
-- SÍ puede lanzar con datos malformados; la comparación jsonb=jsonb nunca
-- lanza, solo compara). Ambas funciones devuelven SIEMPRE `true`/`false`,
-- nunca `NULL` (Postgres trata un CHECK que da `NULL` como SATISFECHO, así
-- que un resultado `NULL` sería un colador silencioso) — cada rama del
-- `case` es una conjunción de comparaciones `is null`/`is not null`
-- (siempre booleanas) y comparaciones sobre valores ya confirmados no-nulos
-- por una rama anterior del mismo `case`.
--
-- CHECK 1 `..._es_arreglo_check`: `procedencia_temporadas` es NULL o un
-- arreglo jsonb (nunca un objeto/string/número suelto) — sin cambios,
-- `jsonb_typeof` es total (nunca lanza para ningún jsonb válido).
-- CHECK 2 `..._elementos_validos_check`: cada elemento del arreglo (cuando
-- existe) es un objeto bien formado (ver arriba).
-- CHECK 3 `..._no_vacia_check`: un arreglo, si existe, tiene AL MENOS 1
-- elemento — `[]` no es un estado válido.
-- CHECK 4 `..._estado_check`: el estado-máquina completo (los 3 casos de
-- arriba, incluida la igualdad EXACTA columnas-planas↔único-objeto en el
-- caso uniforme).
--
-- Migración ADITIVA e idempotente (`add column if not exists`, `create or
-- replace function`, guardas `if not exists` en los CHECK) — se puede
-- re-correr sin duplicar. Sin RLS propia: hereda la de `tarifario_resultado`
-- (lectura pública `for select using (true)`, ya son campos sin costo neto).
--
-- ⚠️ Riesgo de despliegue — mismo patrón que 177/178/179: el código de
-- ESCRITURA (`generarTarifario`, `app/(dashboard)/dashboard/paquetes/
-- actions.ts`, vía `lib/tarifario/procedenciaTarifario.ts`) intenta insertar
-- las 5 columnas de procedencia en cada fila de `tarifario_resultado` — si se
-- despliega antes de correr esta migración, el insert falla con "column does
-- not exist" y bloquea "Generar tarifario" para CUALQUIER paquete (no solo
-- los que usan promociones Dubai). El código de LECTURA (`detalle-actions.ts`,
-- lee estas columnas directo con `select(...)`, sin recalcular nada) las
-- recibe como `undefined` si la migración no se ha corrido — no rompe, pero
-- la UI no muestra identidad hasta que se aplique y se regenere el tarifario.
--
--  ORDEN OBLIGATORIO:
--    1) correr `preflight_180_tarifario_resultado_procedencia.sql` en el
--       entorno REMOTO real;
--    2) aplicar ESTA migración (180) en el entorno REMOTO;
--    3) correr `postcheck_180_tarifario_resultado_procedencia.sql` en el
--       mismo entorno REMOTO;
--    4) desplegar el código;
--    5) correr "Generar tarifario" en cada paquete (o esperar el
--       auto-recálculo) para poblar la procedencia — las filas existentes
--       quedan sin procedencia hasta que se regeneren.
--
-- Preflight / postcheck / rollback: ver
-- supabase/scripts/{preflight,postcheck,rollback}_180_tarifario_resultado_procedencia.sql
-- ───────────────────────────────────────────────────────────────────────────

begin;

alter table public.tarifario_resultado
  add column if not exists temporada_ganadora text,
  add column if not exists es_promocion boolean,
  add column if not exists precio_final_autoritativo boolean,
  add column if not exists procedencia_temporadas jsonb,
  add column if not exists procedencia_mixta boolean not null default false;

-- Valida los ELEMENTOS de un arreglo `procedencia_temporadas` ya confirmado
-- arreglo por el llamador (`jsonb_array_elements` lanza sobre un no-arreglo,
-- así que el `case` de abajo SIEMPRE comprueba el tipo antes de iterarlo).
--
-- ⚠️ DEFECTO CORREGIDO (encontrado tras aplicar esta migración en Docker,
-- antes del postcheck final): la primera versión comparaba con `<>`
-- (`jsonb_typeof(elem->'campo') <> 'tipo'`) — cuando la CLAVE está ausente,
-- `elem->'campo'` es SQL NULL, `jsonb_typeof(NULL)` es NULL, y
-- `NULL <> 'tipo'` es NULL (ni true ni false, lógica de 3 valores). Una
-- condición NULL en el `where` de `not exists` NO selecciona esa fila —
-- así que un elemento con una clave FALTANTE (nunca uno con el tipo
-- equivocado, que sí producía un string real) se colaba como "válido" en un
-- arreglo MIXTO donde el resto de condiciones tampoco daban `true`. Todas
-- las comparaciones de tipo ahora usan `IS DISTINCT FROM`, que trata
-- NULL como un valor cualquiera (nunca produce NULL, siempre true/false) —
-- clave ausente ⇒ `NULL IS DISTINCT FROM 'tipo'` ⇒ `true` ⇒ rechazado, igual
-- que un tipo explícitamente equivocado. El JSON `null` explícito (no
-- ausencia de clave) ya se rechazaba antes Y se sigue rechazando: su
-- `jsonb_typeof` es el STRING `'null'`, distinto de `'string'`/`'boolean'`
-- en cualquiera de los dos operadores.
create or replace function public._procedencia_temporadas_elementos_validos(p jsonb)
returns boolean
language sql
immutable
as $$
  select case
    when p is null then true
    when jsonb_typeof(p) <> 'array' then false
    else not exists (
      select 1
      from jsonb_array_elements(p) as elem
      where jsonb_typeof(elem) is distinct from 'object'
         or jsonb_typeof(elem->'temporada') is distinct from 'string'
         -- `coalesce(..., '')` antes de `btrim`: defensa en profundidad —
         -- la comprobación de tipo de arriba YA rechaza clave ausente/JSON
         -- null (su jsonb_typeof no es 'string'), pero esta línea nunca debe
         -- depender de esa otra rama para ser correcta por sí misma; sin el
         -- coalesce, `elem->>'temporada'` en una clave ausente es SQL NULL y
         -- `btrim(NULL) = ''` es NULL (no rechaza) — exactamente el mismo
         -- defecto que motivó esta corrección, aquí evitado sin usar
         -- IS DISTINCT FROM porque el resultado deseado es comparar contra
         -- un string vacío, no contra un tipo.
         or btrim(coalesce(elem->>'temporada', '')) = ''
         or jsonb_typeof(elem->'es_promocion') is distinct from 'boolean'
         or jsonb_typeof(elem->'precio_final_autoritativo') is distinct from 'boolean'
    )
  end;
$$;

-- Estado-máquina completo de los 3 estados válidos (sin procedencia /
-- uniforme / mixta) — ver la cabecera del archivo para el detalle de cada
-- uno. Compara los objetos jsonb DIRECTO (`= to_jsonb(...)`), nunca con un
-- cast `::boolean` sobre texto que pudiera lanzar con datos malformados.
create or replace function public._tarifario_resultado_procedencia_valida(
  p_temporada_ganadora text,
  p_es_promocion boolean,
  p_precio_final_autoritativo boolean,
  p_procedencia_temporadas jsonb,
  p_procedencia_mixta boolean
)
returns boolean
language sql
immutable
as $$
  select coalesce(
    case
      -- Estado 1: SIN procedencia.
      when p_procedencia_temporadas is null then
        p_procedencia_mixta = false
        and p_temporada_ganadora is null
        and p_es_promocion is null
        and p_precio_final_autoritativo is null

      -- No-arreglo / arreglo vacío: los rechazan los CHECK 1 y 3 por
      -- separado — acá se deja pasar (true) para no duplicar el error ni
      -- llamar jsonb_array_length sobre algo que no es un arreglo.
      when jsonb_typeof(p_procedencia_temporadas) <> 'array' then true
      when jsonb_array_length(p_procedencia_temporadas) = 0 then true

      -- Estado 2: UNIFORME (exactamente 1 objeto) — columnas planas
      -- pobladas y EXACTAMENTE iguales al único objeto del arreglo.
      when jsonb_array_length(p_procedencia_temporadas) = 1 then
        p_procedencia_mixta = false
        and p_temporada_ganadora is not null
        and p_es_promocion is not null
        and p_precio_final_autoritativo is not null
        and (p_procedencia_temporadas->0->>'temporada') = p_temporada_ganadora
        and (p_procedencia_temporadas->0->'es_promocion') = to_jsonb(p_es_promocion)
        and (p_procedencia_temporadas->0->'precio_final_autoritativo') = to_jsonb(p_precio_final_autoritativo)

      -- Estado 3: MIXTA (2 o más objetos) — columnas planas en NULL, nunca
      -- una identidad "representante" elegida arbitrariamente.
      else
        p_procedencia_mixta = true
        and p_temporada_ganadora is null
        and p_es_promocion is null
        and p_precio_final_autoritativo is null
    end,
    false
  );
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'tarifario_resultado_procedencia_es_arreglo_check'
      and conrelid = 'public.tarifario_resultado'::regclass
  ) then
    alter table public.tarifario_resultado add constraint tarifario_resultado_procedencia_es_arreglo_check
      check (
        procedencia_temporadas is null or jsonb_typeof(procedencia_temporadas) = 'array'
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'tarifario_resultado_procedencia_elementos_validos_check'
      and conrelid = 'public.tarifario_resultado'::regclass
  ) then
    alter table public.tarifario_resultado add constraint tarifario_resultado_procedencia_elementos_validos_check
      check (
        public._procedencia_temporadas_elementos_validos(procedencia_temporadas)
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'tarifario_resultado_procedencia_no_vacia_check'
      and conrelid = 'public.tarifario_resultado'::regclass
  ) then
    alter table public.tarifario_resultado add constraint tarifario_resultado_procedencia_no_vacia_check
      check (
        case
          when procedencia_temporadas is null then true
          when jsonb_typeof(procedencia_temporadas) <> 'array' then true
          else jsonb_array_length(procedencia_temporadas) > 0
        end
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'tarifario_resultado_procedencia_estado_check'
      and conrelid = 'public.tarifario_resultado'::regclass
  ) then
    alter table public.tarifario_resultado add constraint tarifario_resultado_procedencia_estado_check
      check (
        public._tarifario_resultado_procedencia_valida(
          temporada_ganadora, es_promocion, precio_final_autoritativo,
          procedencia_temporadas, procedencia_mixta
        )
      );
  end if;
end $$;

commit;
