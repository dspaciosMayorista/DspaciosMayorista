-- ═══════════════════════════════════════════════════════════════════════════
-- 259 · Publicador del tarifario: límite de ejecución PROPIO y ACOTADO (paquete 73)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Problema (medición real en Preview, paquete 73, generación 8). `generarTarifario` publica 12.669 filas (12.668 de bloqueo + 1 de servicio) con
-- `publicar_tarifario_resultado`, que corre con el `statement_timeout = 8 s` del rol `authenticated` y se cancela (`57014`). El cálculo tarda 662 ms; la
-- llamada de publicación, 19.845 ms (tiempo de la llamada COMPLETA, no de SQL). El paquete 33 publica 3.187 filas en 3.283 ms: no llega al límite.
--
-- Qué se midió en PostgreSQL local (docs/tecnico/publicador-tarifario-259.md, con PostgREST delante como en Supabase):
--   · SQL de la publicación, 12.669 filas: ≈ 0,70 s; por HTTP ≈ 1,25 s. El 33 (3.187): 0,18 s SQL.
--   · Reparto del SQL (12.669 filas): texto→jsonb del cuerpo 348 ms · llaves foráneas (6) 180 ms · CHECK de procedencia 130 ms · parseo a filas 123 ms ·
--     5 índices 70 ms · dos pasadas de validación 57 ms · DELETE 23 ms.
--   · Con la CPU de Postgres limitada para que el 33 tarde lo que en producción (≈ 3,3 s), el 73 se cancela a 8,5 s con `57014`: reproduce el síntoma.
--   · Reducir trabajo por fila rinde poco: payload sin claves null (−27 % de bytes, −34 % del parseo) y fusionar las pasadas de validación (−3 %); con
--     la misma CPU el 73 sigue cancelándose a 8,5 s. NO se tocan las restricciones (FK/CHECK/índices): son integridad.
--
-- Qué hace la 259. SOLO `ALTER FUNCTION … SET` sobre los DOS puntos de entrada que llama la aplicación por PostgREST:
--     publicar_tarifario_resultado(bigint,bigint,bigint,text,jsonb)
--     publicar_tarifario_resultado_63(bigint,bigint,bigint,text,jsonb,text,numeric)
--   · statement_timeout = 30 s  → sube SOLO el techo de estas dos funciones. Justificación: el 73 necesita ≈ 10–11 s en el entorno calibrado (3 × de margen
--     frente al 8 s actual no hace falta; 30 s ≈ 1,5 × la peor llamada completa observada en Preview, 19,8 s, que es cota superior del SQL, y deja ≈ 2,7 ×
--     sobre lo medido). Es un techo, no un objetivo: una publicación sana sigue tardando segundos.
--   · lock_timeout = 8 s       → se FIJA explícitamente el límite de ESPERA por candado (el mismo que ya tiene el rol): subir el de ejecución no vuelve
--     indefinida la espera por la fila del paquete. Se distingue en el error: `55P03 … lock timeout` (espera) vs `57014 … statement timeout` (ejecución).
--
-- Por qué funciona (y por qué solo aquí). PostgREST lee la configuración de la función que llama y la aplica con `set_config(..., is_local)` ANTES de
-- ejecutar la llamada, así que el temporizador de esa sentencia nace con el valor nuevo (probado: con la función en 30 s el 73 publica en ≈ 10–12 s por
-- PostgREST). Un `SET` de función NO reprograma una sentencia ya iniciada: quien llame por SQL directo (editor de Supabase, otra función) sigue con 8 s.
-- Cualquier otra función o ruta de la aplicación conserva el límite de siempre.
--
-- Configuración ajena: si alguna de las dos entradas ya tiene CUALQUIER parámetro propio distinto de los dos que fija la 259 (otro statement_timeout, un
-- lock_timeout suelto, work_mem…), o un search_path distinto, la 259 ABORTA con «259 ABORTADA (REVISAR)» sin cambiar nada: no sobrescribe decisiones ajenas.
-- Reaplicar la 259 ya aplicada es un no-op. El rollback (rollback_259_…) solo actúa sobre una función cuya configuración sea EXACTAMENTE la de la 259.
--
-- NO cambia: cuerpos de las funciones (ni el interno de la 181/226/229/234/254 ni el que redefina la 256), firmas, SECURITY DEFINER, `search_path`, grants,
-- candado de rol (`mi_rol`), `FOR UPDATE` del paquete, rechazo por generación y por revisión, publicación atómica ni el rollback ante error o timeout (las
-- filas anteriores se conservan: la transacción se revierte). No toca la configuración de ningún rol ni de la base. Independiente del orden con las
-- migraciones 255/256/257/258: no depende de ningún cuerpo, solo de que existan los dos puntos de entrada.
--
-- Riesgo conocido (medido): mientras una publicación larga corre, otra escritura sobre la MISMA fila del paquete (un nuevo «Generar», un cambio de fuente
-- que invalida el tarifario) espera el candado hasta `lock_timeout` (8 s) y falla con `55P03` si la publicación sigue. Antes esas publicaciones morían a los
-- 8 s; ahora pueden vivir más. Solo afecta a paquetes grandes (los que hoy no publican).
--
-- Despliegue: preflight → 259 → postcheck → recién después el código que compacta el payload (compatible hacia atrás; ver docs). La base es única para
-- Preview y Producción: la migración es aditiva y compatible con el código actual. PostgREST recarga su caché de esquema solo (disparador de DDL de
-- Supabase); el `notify` de abajo lo asegura.
-- Rollback: supabase/scripts/rollback_259_publicador_tarifario_limite.sql
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- Guarda por función. Cada entrada debe estar en UNO de estos dos estados; cualquier otro es configuración ajena y la 259 ABORTA sin cambiar nada (la
-- transacción se revierte entera; no se sobrescribe ni se «normaliza» una configuración que alguien puso a propósito):
--   · SIN límites propios: su configuración es solo `search_path=public, pg_temp`.
--   · 259 YA aplicada: además, exactamente `lock_timeout=8s` y `statement_timeout=30s` (reaplicarla es un no-op).
-- Ajena = cualquier otro parámetro (p. ej. solo un lock_timeout, otro statement_timeout, work_mem…) o un search_path distinto.
do $$
declare
  v_firma text;
  v_oid   oid;
  v_extra text[];
  v_sp    text[];
begin
  foreach v_firma in array array[
    'public.publicar_tarifario_resultado(bigint,bigint,bigint,text,jsonb)',
    'public.publicar_tarifario_resultado_63(bigint,bigint,bigint,text,jsonb,text,numeric)'
  ] loop
    v_oid := to_regprocedure(v_firma);
    if v_oid is null then
      raise exception '259 ABORTADA (REVISAR): no existe %; faltan migraciones anteriores (181/226/227/233/234).', v_firma;
    end if;
    if not (select p.prosecdef from pg_proc p where p.oid = v_oid) then
      raise exception '259 ABORTADA (REVISAR): % ya no es SECURITY DEFINER; hay un cambio ajeno.', v_firma;
    end if;
    select array_agg(c order by c) filter (where c not like 'search_path=%'),
           array_agg(c order by c) filter (where c like 'search_path=%')
      into v_extra, v_sp
      from pg_proc p, unnest(coalesce(p.proconfig, '{}'::text[])) c
     where p.oid = v_oid;
    if v_sp is distinct from array['search_path=public, pg_temp'] then
      raise exception '259 ABORTADA (REVISAR): % no tiene el search_path auditado (public, pg_temp): %; hay un cambio ajeno. No se modificó nada.', v_firma, coalesce(v_sp::text, '(ninguno)');
    end if;
    if v_extra is not null and v_extra is distinct from array['lock_timeout=8s', 'statement_timeout=30s'] then
      raise exception '259 ABORTADA (REVISAR): % ya tiene configuración ajena: %. La 259 no la sobrescribe; revisar con quién la puso. No se modificó nada.', v_firma, v_extra::text;
    end if;
  end loop;
end $$;

alter function public.publicar_tarifario_resultado(bigint, bigint, bigint, text, jsonb)
  set statement_timeout = '30s'
  set lock_timeout = '8s';

alter function public.publicar_tarifario_resultado_63(bigint, bigint, bigint, text, jsonb, text, numeric)
  set statement_timeout = '30s'
  set lock_timeout = '8s';

-- Pide a PostgREST recargar su caché de esquema (lee la configuración de las funciones). Va DENTRO de la transacción: si la 259 aborta, no se envía.
-- El disparador de DDL de Supabase ya lo hace al confirmar el ALTER.
notify pgrst, 'reload schema';

commit;
