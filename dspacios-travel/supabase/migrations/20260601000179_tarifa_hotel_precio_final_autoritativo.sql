-- ───────────────────────────────────────────────────────────────────────────
-- 179 · PRECIO FINAL AUTORITATIVO EN tarifa_hotel (identidad de promoción Dubai)
--       + reemplazo TRANSACCIONAL de las tarifas generadas por la calculadora
--
-- Corrige un defecto confirmado: `generarTarifasDubai` (lib/calc/calculadoras.ts)
-- crea, por cada promoción (`promos[]`), una fila NUEVA de `tarifa_hotel` bajo
-- `temporada = promo.temporadaPromo` con el precio final YA calculado (descuento
-- + suplemento propio/general + modificadores de acomodación horneados) y, si
-- la promo los configuró, sus propias edades y su propia condición de tarifa
-- (`notas`). Pero el motor de liquidación (`resolverNetoNocheDetallado`, en
-- `lib/calc/paquetes.ts`) NUNCA leía esa fila: cuando la vigencia ganadora
-- (`hotel_temporadas`) es de tipo `descuento_pct`/`descuento_monto`, el motor
-- ignoraba por completo la fila de `tarifa_hotel` de esa temporada, volvía a
-- tomar la fila de la temporada BASE y le REAPLICABA el descuento (con el
-- `descuento_valor` de `hotel_temporadas`, no con `promo.descuentoPct` — dos
-- fuentes distintas del mismo número, sin garantía de que coincidan) —
-- ignorando el suplemento propio y las edades propias de la promoción, y
-- devolviendo `temporadaTarifa: base.nombre` en vez del nombre de la promo, lo
-- que además hacía que la condición de tarifa de la promoción NUNCA llegara a
-- cotización/contrato (`extraerCondicionesTarifa` busca `notas` por nombre de
-- temporada, y ese nombre nunca era el de la promoción).
--
-- `precio_final_autoritativo boolean not null default false` — SOLO
-- `generarTarifasDubai` la enciende, y solo en las filas que genera para
-- `promos[]` (las de `bases[]`, y TODAS las filas de Mixta/Corporativa, quedan
-- en `false`, el default). Cuando el motor (`resolverNetoNocheDetallado`)
-- encuentra que la vigencia ganadora de la noche está marcada así Y tiene neto
-- cargado para el combo categoría/régimen, usa esa fila DIRECTO — nunca
-- recalcula el descuento, nunca pierde el suplemento propio, y la identidad
-- que devuelve (`temporadaTarifa`) es la de la PROPIA promoción, así que
-- edades y condiciones de tarifa se resuelven correctamente contra su fila.
--
-- `temporada_base text null` — nombre de la temporada BASE de la que se
-- derivó esta fila (`promo.temporadaBase`), SOLO para auditoría/trazabilidad
-- (nunca se usa en el motor de liquidación, que sigue resolviendo la vigencia
-- por `hotel_temporadas`/prioridad como siempre). NULL en filas base y en
-- filas históricas.
--
-- Compatibilidad con promociones LEGACY (temporadas `descuento_pct`/
-- `descuento_monto` creadas a mano en Temporadas, sin pasar por la
-- calculadora Dubai, o generadas por una versión anterior de
-- `generarTarifasDubai` antes de esta migración): NUNCA tienen
-- `precio_final_autoritativo = true` (default `false`, sin backfill) — el
-- motor las sigue resolviendo EXACTAMENTE como hasta hoy (recalcula el
-- descuento desde la base). La semántica de "descuento_pct/descuento_monto"
-- como TIPO DE VIGENCIA no cambia para nadie; lo único nuevo es que una fila
-- de `tarifa_hotel` puntual puede declararse "yo ya soy el precio final,
-- no me recalcules". Nota: legacy también son "promociones" en el sentido de
-- negocio (descuentan sobre una base) — `precio_final_autoritativo` NO es
-- sinónimo de "es promoción", es solo "esta fila concreta ya es el precio
-- final, no recalcular" (la clasificación de UI Base/Promoción vive en
-- `lib/calc/paquetes.ts::resolverNetoNocheDetallado` — campo `esPromocion`,
-- derivado de `hotel_temporadas.tipo` de la vigencia ganadora, no de esta
-- columna — y se persiste por fila en `tarifario_resultado.es_promocion`,
-- migración 180).
--
-- Migración ADITIVA e idempotente (`add column if not exists`, guardas
-- `if not exists` en el CHECK, `create or replace function`) — se puede
-- re-correr sin duplicar. NO hace backfill: todas las filas existentes
-- (incluidas las de promociones Dubai generadas ANTES de esta migración)
-- quedan en `precio_final_autoritativo = false` — conservan el comportamiento
-- legacy hasta que se vuelvan a generar desde la calculadora ("Generar
-- tarifas") con el código nuevo.
--
-- CHECK (FORTALECIDO DOS VECES — revisión de validación: la primera versión
-- de esta migración solo exigía la mitad de la implicación; la segunda la
-- volvió biconditional pero seguía aceptando `temporada_base = ''`/`'   '`
-- como "no nulo"): ahora exige explícitamente
--   · `precio_final_autoritativo = false` ⇒ `temporada_base is null` (NULL
--     exacto, nunca string vacío);
--   · `precio_final_autoritativo = true` ⇒ `temporada_base` no nulo Y con
--     contenido real tras `btrim()` (rechaza vacío/solo espacios).
-- Justificación de que esto no rompe ningún caso real: la ÚNICA fuente que
-- enciende `precio_final_autoritativo` es `generarTarifasDubai`, y esa misma
-- función SIEMPRE puebla `temporada_base` con `promo.temporadaBase` no-vacío
-- (la propia función exige no-vacío para producir la fila — ver el
-- `continue` temprano en el bucle de `promos[]`); nunca existe, en el diseño
-- actual, una fila autoritativa "huérfana" sin su base de origen ni con una
-- base en blanco. Si en el futuro se necesita una fila autoritativa sin
-- `temporada_base` (ej. importación externa), hay que revisar este CHECK a
-- propósito, no relajarlo por default.
--
-- `reemplazar_tarifas_hotel_calculadora(...)` — RPC transaccional que
-- reemplaza (`delete` + `insert`) las filas de `tarifa_hotel` generadas por la
-- calculadora de un hotel. Corrige un hallazgo de la ronda anterior: la
-- versión previa de `generarTarifasCalculadora` hacía
-- select→delete→insert→"restaurar si falla" en 2-3 llamadas HTTP sueltas
-- desde el servidor Next — NO es atómico (una caída de red entre el delete y
-- el insert deja el hotel sin tarifas de verdad, y el propio "restaurar"
-- reinserta las filas con IDS NUEVOS, nunca los originales, así que cualquier
-- referencia externa a esos ids —o simplemente el rastro de auditoría— ya
-- cambió aunque el intento de recuperación "funcione"). Esta función hace
-- TODO en una sola sentencia de function call: Postgres ejecuta el cuerpo de
-- una función dentro de la MISMA transacción que la invoca, así que si
-- cualquier paso falla (constraint, tipo, lo que sea), TODO el cuerpo se
-- revierte automáticamente — el `delete` incluido — y las filas anteriores
-- quedan EXACTAMENTE como estaban, ids incluidos, sin necesidad de ningún
-- código de "restaurar" en la aplicación.
--
-- SECURITY DEFINER + candado de rol EXPLÍCITO adentro (`mi_rol() in
-- ('superadmin','gerencia','administracion','operaciones')`, el MISMO
-- conjunto que ya exige la policy RLS `"tarifa_hotel: interno"` de la
-- migración 016 — SECURITY DEFINER se salta esa policy, así que hay que
-- replicar la misma regla adentro para no abrir una puerta que RLS ya
-- cerraba) — nunca SECURITY INVOKER: una función `plpgsql` con múltiples
-- sentencias SÍ corre dentro de la transacción del caller y por lo tanto
-- también sería atómica en INVOKER, pero mantenerla DEFINER + candado propio
-- es el mismo patrón ya establecido en este proyecto para RPCs de escritura
-- sensible (`eliminar_contrato`, `fn_renumerar_contrato`,
-- `registrar_financiero_contrato` de la migración 171) — consistencia de
-- auditoría y de dónde vive la regla de autorización.
--
-- `p_regimenes` NULL o arreglo vacío ⇒ modo "reemplazar" (borra TODAS las
-- tarifas del hotel); arreglo con regímenes ⇒ modo "agregar" (borra SOLO esos
-- regímenes, respeta el resto) — mismo contrato que los dos modos que ya
-- tenía `generarTarifasCalculadora` en JS, ahora dentro de la transacción.
-- `p_filas` es el arreglo ya calculado por `generarTarifas()` (puro, sin
-- cambios) serializado a jsonb — la función NO reimplementa ninguna regla de
-- negocio (Adults Only, defaults, etc.), solo persiste atómicamente lo que el
-- servidor ya decidió escribir.
--
-- Protección ANTES del DELETE (hallazgo de la ronda de validación — antes se
-- validaba solo "es un arreglo", lo que dejaba pasar un arreglo VACÍO
-- —borraría todas las tarifas del hotel y no insertaría ninguna— o un lote
-- con una fila cuyo `hotel_id` propio no coincidiera con `p_hotel_id`, de
-- llegar a incluirse en el payload):
--   1) `p_filas` debe ser un arreglo jsonb (ya existía);
--   2) `p_filas` NO puede estar vacío (`jsonb_array_length(p_filas) = 0`
--      rechaza — nunca se borra sin nada que insertar a cambio);
--   3) CADA elemento debe ser un objeto jsonb;
--   4) si un elemento declara `hotel_id`, debe coincidir con `p_hotel_id`
--      (defensa en profundidad — el `insert` de abajo siempre usa
--      `p_hotel_id` para TODAS las filas, nunca lee `hotel_id` del payload,
--      así que hoy esta validación es un no-op con el llamador actual, pero
--      cierra la puerta a un llamador futuro que sí lo incluyera).
-- Las 4 validaciones corren en un bucle COMPLETO sobre `p_filas` ANTES de
-- cualquier `delete` — un lote inválido nunca alcanza a borrar ni una sola
-- fila anterior (fail-closed real, no solo "revierte si falla a mitad de
-- camino" — aunque esa segunda garantía también aplica, por ser todo una
-- sola transacción de función).
--
-- ⚠️ Riesgo de despliegue — igual patrón que 177/178 (columnas nuevas
-- seleccionadas explícitamente por nombre desde el código):
--  · `generarTarifasDubai`/`generarTarifasCalculadora` (guardar tarifas desde
--    la calculadora) intentan ESCRIBIR `precio_final_autoritativo`/
--    `temporada_base` en cada fila que insertan vía el RPC — si ese código se
--    despliega antes de correr esta migración, el RPC no existe y la llamada
--    falla con "function does not exist", bloqueando "Generar tarifas" para
--    CUALQUIER hotel con calculadora (no solo los que usan promociones Dubai).
--  · El motor de liquidación (`computo.ts`, `cotizar.ts`/`liquidacionHotel.ts`,
--    `paquetes/actions.ts` al regenerar el tarifario, `tarifario/vigencia.ts`)
--    selecciona `precio_final_autoritativo` explícitamente en su `select` de
--    `tarifa_hotel` — mismo riesgo de "column does not exist" si se despliega
--    antes de la migración, para CUALQUIER hotel persona (no solo Dubai),
--    igual que ya ocurre con la 177.
--  · Deliberadamente NO se implementó un fallback en runtime que atrape ese
--    error y oculte la columna/función faltante — igual criterio que 177/178.
--
--  ORDEN OBLIGATORIO, sin excepciones ni pasos intercambiados:
--    ⚠️ Las migraciones 177 y 178 YA ESTÁN APLICADAS Y VERIFICADAS en el
--    entorno remoto (confirmado por el dueño) — NO se vuelven a correr acá.
--    Lo único pendiente es ESTA migración (179):
--    1) correr `preflight_179_tarifa_hotel_precio_final_autoritativo.sql` en
--       el entorno REMOTO real;
--    2) aplicar ESTA migración (179) en el entorno REMOTO;
--    3) correr `postcheck_179_tarifa_hotel_precio_final_autoritativo.sql` en
--       el mismo entorno REMOTO;
--    4) recién ENTONCES desplegar el código.
--
-- Preflight / postcheck / rollback: ver
-- supabase/scripts/{preflight,postcheck,rollback}_179_tarifa_hotel_precio_final_autoritativo.sql
-- ───────────────────────────────────────────────────────────────────────────

begin;

alter table public.tarifa_hotel
  add column if not exists precio_final_autoritativo boolean not null default false,
  add column if not exists temporada_base text;

do $$
begin
  -- Se reemplaza por la versión más estricta si existía una anterior de esta
  -- migración (primer intento: solo exigía la mitad de la implicación;
  -- segundo intento: biconditional pero sin exigir texto no-vacío).
  if exists (
    select 1 from pg_constraint
    where conname = 'tarifa_hotel_temporada_base_solo_si_final_check'
      and conrelid = 'public.tarifa_hotel'::regclass
  ) then
    alter table public.tarifa_hotel drop constraint tarifa_hotel_temporada_base_solo_si_final_check;
  end if;

  -- FORTALECIDO otra vez (ronda de validación): la versión anterior
  -- (`(temporada_base is not null) = precio_final_autoritativo`) aceptaba
  -- `temporada_base = ''` o `'   '` (string vacío/solo espacios) como si
  -- fuera un valor válido — técnicamente "not null" pero sin ningún dato de
  -- auditoría real. Ahora exige explícitamente que, cuando
  -- `precio_final_autoritativo = true`, `temporada_base` tenga contenido
  -- real tras `btrim()`; cuando es `false`, exige NULL exacto (nunca
  -- string vacío tampoco).
  alter table public.tarifa_hotel add constraint tarifa_hotel_temporada_base_solo_si_final_check
    check (
      (precio_final_autoritativo = false and temporada_base is null)
      or
      (precio_final_autoritativo = true and temporada_base is not null and btrim(temporada_base) <> '')
    );
end $$;

-- ── RPC transaccional: reemplazo atómico de tarifas de calculadora ─────────
create or replace function public.reemplazar_tarifas_hotel_calculadora(
  p_hotel_id  bigint,
  p_regimenes text[],  -- null o vacío = borra TODO el hotel; con valores = borra solo esos regímenes
  p_filas     jsonb    -- arreglo de filas ya calculadas por generarTarifas() (lib/calc/calculadoras.ts)
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_borradas    integer;
  v_insertadas  integer;
  v_fila        jsonb;
  v_hotel_fila  bigint;
begin
  -- ⚠️ `coalesce(...::text, '')`, NUNCA `mi_rol() not in (...)` a secas: si
  -- `mi_rol()` devuelve NULL (usuario `authenticated` sin fila en `usuarios`,
  -- o con `activo = false` — ver migración 140), `NULL not in (...)`
  -- evalúa a NULL, y `if NULL then` en PL/pgSQL es FALSO — la excepción
  -- NUNCA se lanza y la ejecución sigue como si estuviera autorizada. Este
  -- era un defecto real, detectado en la ronda de validación al intentar
  -- probar el rechazo de un usuario no autorizado: un usuario `authenticated`
  -- sin rol (borrado/desactivado) pasaba el candado. `coalesce(...,'')`
  -- convierte NULL en `''`, que nunca está en la lista permitida.
  if coalesce(public.mi_rol()::text, '') not in ('superadmin', 'gerencia', 'administracion', 'operaciones') then
    raise exception 'reemplazar_tarifas_hotel_calculadora: rol sin permiso de escritura sobre tarifa_hotel';
  end if;
  if p_hotel_id is null then
    raise exception 'reemplazar_tarifas_hotel_calculadora: hotel_id requerido';
  end if;
  if p_filas is null or jsonb_typeof(p_filas) <> 'array' then
    raise exception 'reemplazar_tarifas_hotel_calculadora: p_filas debe ser un arreglo jsonb';
  end if;
  if jsonb_array_length(p_filas) = 0 then
    raise exception 'reemplazar_tarifas_hotel_calculadora: p_filas no puede ser un arreglo vacío';
  end if;

  -- Validación COMPLETA del lote ANTES de tocar una sola fila — si cualquier
  -- elemento es inválido, ninguna fila anterior se borra (fail-closed real,
  -- no solo "atómico si falla a mitad de camino"). Defensa en profundidad:
  -- si una fila del payload declara `hotel_id` (hoy `generarTarifasCalculadora`
  -- nunca lo incluye — el insert de abajo siempre usa `p_hotel_id` para
  -- TODAS las filas — pero un llamador futuro/no confiable sí podría) y no
  -- coincide con `p_hotel_id`, se rechaza el lote completo.
  for v_fila in select * from jsonb_array_elements(p_filas) loop
    if jsonb_typeof(v_fila) <> 'object' then
      raise exception 'reemplazar_tarifas_hotel_calculadora: cada elemento de p_filas debe ser un objeto jsonb';
    end if;
    if v_fila ? 'hotel_id' and v_fila->>'hotel_id' is not null then
      begin
        v_hotel_fila := (v_fila->>'hotel_id')::bigint;
      exception when others then
        raise exception 'reemplazar_tarifas_hotel_calculadora: hotel_id de una fila no es numérico: %', v_fila->>'hotel_id';
      end;
      if v_hotel_fila <> p_hotel_id then
        raise exception 'reemplazar_tarifas_hotel_calculadora: una fila declara hotel_id % distinto al solicitado (%)', v_hotel_fila, p_hotel_id;
      end if;
    end if;
  end loop;

  if p_regimenes is null or array_length(p_regimenes, 1) is null then
    delete from public.tarifa_hotel where hotel_id = p_hotel_id;
  else
    delete from public.tarifa_hotel where hotel_id = p_hotel_id and alimentacion = any(p_regimenes);
  end if;
  get diagnostics v_borradas = row_count;

  v_insertadas := 0;
  for v_fila in select * from jsonb_array_elements(p_filas) loop
    insert into public.tarifa_hotel (
      hotel_id, tipo_habitacion, alimentacion, temporada,
      neto_sencilla, neto_doble, neto_triple, neto_multiple,
      neto_nino, neto_nino2, neto_infante, nota_infante, notas,
      edad_infante_min, edad_infante_max, edad_nino_min, edad_nino_max,
      precio_final_autoritativo, temporada_base
    ) values (
      p_hotel_id,
      v_fila->>'tipo_habitacion',
      v_fila->>'alimentacion',
      v_fila->>'temporada',
      (v_fila->>'neto_sencilla')::numeric,
      (v_fila->>'neto_doble')::numeric,
      (v_fila->>'neto_triple')::numeric,
      (v_fila->>'neto_multiple')::numeric,
      (v_fila->>'neto_nino')::numeric,
      (v_fila->>'neto_nino2')::numeric,
      (v_fila->>'neto_infante')::numeric,
      v_fila->>'nota_infante',
      v_fila->>'notas',
      (v_fila->>'edad_infante_min')::integer,
      (v_fila->>'edad_infante_max')::integer,
      (v_fila->>'edad_nino_min')::integer,
      (v_fila->>'edad_nino_max')::integer,
      coalesce((v_fila->>'precio_final_autoritativo')::boolean, false),
      v_fila->>'temporada_base'
    );
    v_insertadas := v_insertadas + 1;
  end loop;

  return jsonb_build_object('borradas', v_borradas, 'insertadas', v_insertadas);
end;
$$;

comment on function public.reemplazar_tarifas_hotel_calculadora(bigint, text[], jsonb) is
  'Reemplaza EN UNA TRANSACCIÓN las tarifas de tarifa_hotel generadas por la calculadora de un hotel (delete + insert dentro del mismo function call de Postgres). Ante cualquier fallo, TODO el cuerpo se revierte automáticamente y las filas anteriores quedan exactamente iguales, ids incluidos — nunca queda el hotel sin tarifas ni se duplica nada en un reintento. SECURITY DEFINER con candado de rol propio (mismo conjunto que la policy RLS de tarifa_hotel de la migración 016).';

revoke all on function public.reemplazar_tarifas_hotel_calculadora(bigint, text[], jsonb) from public, anon;
grant execute on function public.reemplazar_tarifas_hotel_calculadora(bigint, text[], jsonb) to authenticated;

commit;
