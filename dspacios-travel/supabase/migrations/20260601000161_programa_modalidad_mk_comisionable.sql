-- ───────────────────────────────────────────────────────────────────────────
-- 161 · PROGRAMAS — segunda modalidad de markup para la tarifa comisionable
--
-- ⚠️ NUMERACIÓN — colisión con PR #276 (PAUSADO): PR #276 (rama
-- `tarifario-rendimiento-carga`) también propone una migración 161
-- (`20260601000161_tarifario_resumen.sql`, vista `tarifario_resumen`) —
-- PAUSADA por instrucción explícita del dueño mientras se prioriza este
-- trabajo, NUNCA ejecutada ni fusionada. Si ESTE PR (el de la modalidad de
-- markup) se fusiona PRIMERO, la migración de PR #276 deberá RENUMERARSE a
-- 162 (o el siguiente número libre en ese momento) antes de poder
-- ejecutarse/fusionarse — nunca coexistir con el mismo número 161. Nombres de
-- archivo completamente distintos (`tarifario_resumen` vs.
-- `programa_modalidad_mk_comisionable`), así que no hay colisión de
-- contenido, solo de número — mismo criterio de renumeración ya documentado
-- en CLAUDE.md para colisiones previas (ej. 157/158 en ago-2026).
--
-- QUÉ ARREGLA — REGLA COMERCIAL CONFIRMADA POR EL DUEÑO
--   Hoy (migración 151, `calcularNetoPrograma()` en lib/calc/programaPrecio.ts,
--   SIN CAMBIOS en su fórmula por esta migración) la única modalidad es:
--     base_comisionable = Tarifa − impuestos_o_%
--     comision          = base_comisionable × %comision
--     base_neta         = base_comisionable − comision
--     neto (persistido) = Tarifa − comision   (= base_neta + "impuestos")
--     Venta = (base_neta + impuestos) / divisor_MK    ← el MK se cobra
--             TAMBIÉN sobre el monto que no es comisionable (impuestos).
--
--   El dueño pide una SEGUNDA modalidad, seleccionable por programa:
--     Venta = (base_neta / divisor_MK) + impuestos    ← el MK NUNCA se aplica
--             sobre "impuestos"; se suman al final, sin markup.
--
--   Ejemplo exacto confirmado (MK 20% → divisor 0,80): tarifa 1.000.000,
--   impuestos 100.000, comisión 10% → base_comisionable 900.000, comisión
--   90.000, base_neta 810.000.
--     Histórica: (810.000+100.000)/0,80 = 1.137.500
--     Nueva:     810.000/0,80 + 100.000 = 1.112.500
--
-- QUÉ AGREGA
--   `programas.regla_comisionable_modalidad_mk` — el discriminante, a nivel
--   de PROGRAMA (una sola modalidad para todas sus salidas — mismo criterio
--   que `regla_comisionable_modo`/`_valor`/`_pct_comision`, migración 151,
--   que también viven a nivel de programa, no de salida).
--     · 'historica'                    → comportamiento EXACTO de siempre.
--     · 'base_neta_impuestos_al_final' → la modalidad nueva.
--   Default EXPLÍCITO 'historica' — todo programa existente (o creado sin
--   tocar este campo) conserva el comportamiento actual byte a byte.
--
-- POR QUÉ NO HACE FALTA TOCAR `programa_salidas` NI `neto_*`
--   `neto_*` (persistido por salida/acomodación) sigue significando EXACTAMENTE
--   lo mismo que hoy: `Tarifa − comision` — la fórmula histórica, sin cambios.
--   La modalidad nueva NO se persiste como un neto distinto: se RECALCULA en
--   caliente, en cada uno de los 4 puntos de consumo (editor en vivo,
--   validación cliente, validación servidor, generación real del tarifario),
--   a partir de los MISMOS datos ya persistidos (`tarifa_*` + la regla del
--   programa) — la misma función pura `calcularNetoProgramaConModalidad()`
--   (lib/calc/programaPrecio.ts) en los 4 lugares, nunca una fórmula
--   duplicada. Esto evita además un problema real: si `neto_*` horneara ya el
--   efecto del %MK, cambiar el %MK del programa más adelante dejaría esos
--   netos desactualizados sin que nada lo notara — al recalcular siempre en
--   caliente con el %MK VIGENTE, ese problema no puede existir.
--
-- REGISTROS EXISTENTES
--   Ningún backfill: la columna nace en 'historica' para TODOS los programas
--   ya creados (incluidos los que ya usan `regla_comisionable=true`) — el
--   comportamiento visible no cambia para ninguno hasta que alguien elija
--   explícitamente la modalidad nueva en un programa puntual.
--
-- ATOMICIDAD — mismo patrón que `guardar_programa_salidas` (151)
--   `guardar_programa_salidas()` se reemplaza (create or replace, misma
--   firma) para leer y persistir `p_regla->>'modalidadMk'` dentro de la MISMA
--   transacción que ya usa para la regla + las salidas — sigue siendo
--   UPDATE + DELETE + INSERT en una sola invocación de Postgres. `language
--   plpgsql` SIN `security definer`, igual que antes: corre con el rol de
--   quien llama, sujeto a las mismas policies de `programas`/`programa_salidas`.
--
-- CONSTRAINTS — última barrera, no la única
--   `programas_regla_comisionable_modalidad_mk_check` (CHECK incondicional,
--   igual criterio que los CHECK de la 151: no depende de si
--   `regla_comisionable` está activa — un valor fuera del enum nunca es
--   válido, esté la regla prendida o no) exige que la columna sea uno de los
--   dos valores del enum de texto. `guardar_programa_salidas()` valida lo
--   mismo ANTES del UPDATE (mensaje claro, `raise exception`) — el CHECK
--   queda como respaldo si algún día se llama la tabla/función directo con un
--   valor manipulado.
--
-- ⚠️ REVISIÓN PR #277 (defectos 1/3/4) — 4 correcciones sobre la primera
-- versión de esta migración, NUNCA ejecutada en producción:
--   1) `guardar_programa_salidas()` ya NO cae a 'historica' cuando el
--      payload no trae `modalidadMk` — eso permitía que un cliente VIEJO
--      (desplegado antes de esta migración) PISARA en silencio la modalidad
--      nueva de un programa ya configurado. Ahora: clave AUSENTE → conserva
--      la modalidad YA GUARDADA (select antes del update); clave PRESENTE
--      (incl. `""`/`null` explícitos) → se valida SIEMPRE, fail-closed —
--      nunca se ensancha una cadena vacía a 'historica'. Solo un programa
--      NUEVO (insertado sin pasar por esta función) recibe 'historica', vía
--      el DEFAULT de la columna.
--   2) Antes de la (misma transacción del) UPDATE+DELETE+INSERT, valida CADA
--      tarifa de `p_salidas` contra `base_neta >= 0` cuando la regla está
--      activa Y la modalidad es la nueva — misma fórmula que
--      `calcularNetoProgramaConModalidad()` (nunca reimplementada distinto).
--      Nunca toca/bloquea datos en modalidad histórica.
--   3) ACL: además de `revoke ... from public`, revoke explícito `from anon`
--      (defensa en profundidad, verificado con `has_function_privilege`).
--   4) El chequeo de existencia del CHECK ahora filtra por
--      `conrelid = 'public.programas'::regclass` (no solo `conname`), y la
--      columna se AUDITA (tipo/nullable/default) antes del `add column if
--      not exists` — si ya existe con una definición distinta, la migración
--      ABORTA con un mensaje claro en vez de aceptarla en silencio.
--
-- ⚠️ REVISIÓN PR #277, RONDA 2 — 3 correcciones más sobre la versión de la
-- ronda 1 (`da875e3d`/`2defd814`), NUNCA ejecutada en producción:
--   5) CONCURRENCIA: `guardar_programa_salidas()` ahora toma
--      `SELECT ... FOR UPDATE` sobre la fila de `programas` como PRIMER paso
--      (antes de leer/validar/escribir nada) — sin esto, dos guardados
--      concurrentes del mismo programa podían intercalar su UPDATE+DELETE+
--      INSERT y dejar una mezcla de regla de un guardado con salidas del
--      otro. La lectura de la modalidad cuando `modalidadMk` está AUSENTE del
--      payload ahora se hace de la fila YA BLOQUEADA (nunca con un SELECT
--      aparte antes de esperar el lock) — así un guardado con payload viejo
--      que gana el lock DESPUÉS de otro hereda la modalidad que ese otro
--      dejó (o la que ya había, si el otro hizo ROLLBACK), nunca una lectura
--      obsoleta. El lock es por FILA: programas distintos no se bloquean
--      entre sí. Prueba real con dos conexiones psql:
--      `supabase/scripts/pruebas/test_concurrencia_modalidad_mk.sh`.
--   6) PARIDAD NUMÉRICA JS↔Postgres: el RPC YA calculaba `base_neta` con
--      aritmética `numeric` EXACTA (Postgres nunca redondea internamente
--      estos pasos) — el desajuste estaba del lado JS, donde
--      `validarTarifaModalidad()` comparaba contra el `baseNeta` YA
--      REDONDEADO a 2 decimales de `calcularNetoProgramaConModalidad()`. Una
--      base apenas negativa (ej. -0,0036) podía redondear a `-0` (que en JS
--      no es `< 0`) y pasar el navegador/Server Action mientras este RPC, con
--      la MISMA tarifa, la rechazaba. Corregido del lado JS
--      (`baseNetaExacta()`, lib/calc/programaPrecio.ts) — este RPC no cambió
--      su aritmética porque ya era la exacta.
--   7) El chequeo del CHECK (punto 4) ahora también compara
--      `pg_get_constraintdef()` contra la expresión esperada cuando el
--      constraint YA existe (mismo `conname`+`conrelid`) — antes, si existía
--      pero con OTRA expresión (ej. de un intento de deploy manual previo),
--      se omitía la creación en silencio sin comprobar que la definición
--      coincidiera. Ahora aborta con mensaje claro si difiere.
-- ───────────────────────────────────────────────────────────────────────────

begin;

-- ── 1. Programa: discriminante de modalidad de MK ───────────────────────────
-- Auditoría de la columna (revisión PR #277, defecto 4): `add column if not
-- exists` es silencioso si la columna YA existe con OTRA definición (deploy
-- parcial anterior, o alguien la creó a mano) — seguiría sin el tipo/default/
-- nullability correctos sin que nada lo notara. Se audita ANTES de tocarla:
-- si existe pero no coincide EXACTO, aborta con mensaje claro — nunca la
-- sobreescribe en automático.
do $$
declare
  v_data_type text;
  v_is_nullable text;
  v_column_default text;
begin
  select data_type, is_nullable, column_default
    into v_data_type, v_is_nullable, v_column_default
    from information_schema.columns
   where table_schema = 'public' and table_name = 'programas' and column_name = 'regla_comisionable_modalidad_mk';

  if found then
    if v_data_type is distinct from 'text'
       or v_is_nullable is distinct from 'NO'
       or v_column_default is distinct from '''historica''::text' then
      raise exception
        'ABORTADO: public.programas.regla_comisionable_modalidad_mk ya existe pero con un '
        'tipo/nullability/default distinto al esperado (tipo=%, nullable=%, default=%). '
        'Revisa manualmente antes de continuar — esta migración nunca sobreescribe una '
        'columna preexistente en automático.',
        v_data_type, v_is_nullable, v_column_default;
    end if;
  end if;
end $$;

alter table public.programas
  add column if not exists regla_comisionable_modalidad_mk text not null default 'historica';

-- Auditoría del CHECK (revisión PR #277, ronda 2, punto 7): antes, si un
-- constraint con el mismo nombre YA existía atado a public.programas, se
-- omitía la creación sin comprobar que su EXPRESIÓN fuera la esperada — un
-- constraint homónimo con otra definición (ej. un intento de deploy manual
-- previo con una lista distinta) hubiera pasado desapercibido, dejando la
-- columna sin la validación real que el resto de esta migración asume. Se
-- compara `pg_get_constraintdef()` contra el texto EXACTO que Postgres
-- normaliza para `check (col in ('a','b'))` (reescribe `IN` como `= ANY
-- (ARRAY[...])`, verificado empíricamente — no es un texto inventado) y
-- aborta si difiere, en vez de aceptarlo en silencio.
do $$
declare
  v_def text;
  v_esperado constant text :=
    'CHECK ((regla_comisionable_modalidad_mk = ANY (ARRAY[''historica''::text, ''base_neta_impuestos_al_final''::text])))';
begin
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint
   where conname = 'programas_regla_comisionable_modalidad_mk_check'
     and conrelid = 'public.programas'::regclass;

  if not found then
    alter table public.programas
      add constraint programas_regla_comisionable_modalidad_mk_check
      check (regla_comisionable_modalidad_mk in ('historica', 'base_neta_impuestos_al_final'));
  elsif v_def is distinct from v_esperado then
    raise exception
      'ABORTADO: ya existe un CHECK "programas_regla_comisionable_modalidad_mk_check" en '
      'public.programas pero con una definición distinta a la esperada. '
      'Encontrado: %. Esperado: %. Revisa manualmente antes de continuar — esta migración '
      'nunca reemplaza un CHECK preexistente en automático.',
      v_def, v_esperado;
  end if;
end $$;

comment on column public.programas.regla_comisionable_modalidad_mk is
  '''historica'' (default, comportamiento de siempre: Venta=(base_neta+impuestos)/divisorMK) | '
  '''base_neta_impuestos_al_final'' (Venta=base_neta/divisorMK+impuestos, el MK nunca se aplica '
  'sobre impuestos). Solo aplica cuando regla_comisionable=true. Ver '
  'calcularNetoProgramaConModalidad() en lib/calc/programaPrecio.ts. Migración 161.';

-- ── 2. Guardado atómico — misma función, misma firma, ahora también lee/
--    persiste la modalidad y valida cada tarifa dentro de la MISMA
--    transacción ──────────────────────────────────────────────────────────
create or replace function public.guardar_programa_salidas(
  p_programa_id bigint,
  p_regla       jsonb,
  p_salidas     jsonb
)
returns void
language plpgsql
as $$
declare
  v_activa        boolean;
  v_modo          text;
  v_valor         numeric;
  v_pct_comision  numeric;
  v_modalidad_mk  text;
  v_base          numeric;
  v_base_neta     numeric;
  v_programa      record;
  r               record;
begin
  -- Bloqueo de fila (revisión PR #277, defecto de concurrencia). Sin esto,
  -- dos guardados concurrentes del MISMO programa podían intercalar su
  -- UPDATE + DELETE + INSERT — cada sentencia individual es atómica, pero la
  -- SECUENCIA de las tres no lo era entre transacciones: el UPDATE de una
  -- podía quedar seguido del DELETE+INSERT de la otra, mezclando la regla de
  -- un guardado con las salidas del otro. `SELECT ... FOR UPDATE` toma el
  -- lock de la fila de `programas` ANTES de leer/validar/escribir nada —
  -- cualquier otra invocación de esta función sobre el MISMO `p_programa_id`
  -- espera hasta que esta transacción termine (commit o rollback); sobre un
  -- `p_programa_id` DISTINTO no se bloquean entre sí (el lock es por fila).
  -- La comprobación de existencia usa el mismo SELECT (FOUND la resuelve),
  -- no una consulta aparte sin lock.
  select * into v_programa from public.programas where id = p_programa_id for update;
  if not found then
    raise exception 'El programa % no existe.', p_programa_id;
  end if;

  v_activa       := coalesce((p_regla->>'activa')::boolean, false);
  v_modo         := coalesce(p_regla->>'modo', 'pct');
  v_valor        := nullif(p_regla->>'valor', '')::numeric;
  v_pct_comision := nullif(p_regla->>'pctComision', '')::numeric;

  -- Modalidad de MK (revisión PR #277, defecto 1). Clave AUSENTE del payload
  -- (`p_regla ? 'modalidadMk'` = false — un cliente desplegado ANTES de esta
  -- migración nunca la manda) → conserva la modalidad YA GUARDADA del
  -- programa, nunca la pisa con 'historica': el default 'historica' es SOLO
  -- para un programa NUEVO (columna recién creada por el `alter table` de
  -- arriba), no para pisar en silencio un programa ya configurado en la
  -- modalidad nueva. Clave PRESENTE → se valida SIEMPRE, fail-closed: una
  -- cadena vacía o un `null` explícitos NUNCA se ensanchan a 'historica' —
  -- son una señal de bug/payload manipulado, no "no dijo nada", y caen en el
  -- mismo `raise exception` que cualquier otro valor fuera del enum.
  --
  -- ⚠️ Se lee de `v_programa` (la fila YA BLOQUEADA arriba), NUNCA con un
  -- SELECT aparte: si dos guardados con payload viejo compiten por el mismo
  -- programa, el que espera el lock debe heredar la modalidad que el OTRO
  -- dejó al terminar (commit) — o la que ya había si el otro hizo rollback
  -- — nunca una lectura tomada ANTES de esperar el lock (obsoleta).
  if p_regla ? 'modalidadMk' then
    v_modalidad_mk := p_regla->>'modalidadMk';
  else
    v_modalidad_mk := v_programa.regla_comisionable_modalidad_mk;
  end if;

  if v_modalidad_mk is null or v_modalidad_mk not in ('historica', 'base_neta_impuestos_al_final') then
    raise exception 'La modalidad de MK debe ser "historica" o "base_neta_impuestos_al_final".';
  end if;

  -- Misma regla que `validarReglaComisionable` (lib/calc/programaPrecio.ts),
  -- repetida acá para que quien llame la función DIRECTO (sin pasar por
  -- navegador ni Server Action) no pueda dejar la regla activa a medias — ver
  -- "CONSTRAINTS" en la cabecera de la migración 151. Con `v_activa = false`
  -- no se valida nada: los valores previos se conservan tal cual.
  if v_activa then
    if v_pct_comision is null or v_pct_comision < 0 or v_pct_comision > 100 then
      raise exception 'El porcentaje de comision debe ser un numero entre 0 y 100.';
    end if;

    if v_modo = 'pct' then
      if v_valor is null or v_valor < 0 or v_valor > 100 then
        raise exception 'El porcentaje a restar debe ser un numero entre 0 y 100.';
      end if;
    elsif v_modo = 'impuesto' then
      if v_valor is null or v_valor < 0 then
        raise exception 'El impuesto debe ser un numero mayor o igual a 0.';
      end if;
    end if;
    -- modo 'ninguno': el valor no participa del cálculo, no se exige.
  end if;

  -- (Revisión PR #277, defecto 3) Con la regla ACTIVA y la modalidad NUEVA,
  -- cada tarifa de proveedor cargada en `p_salidas` debe producir una base
  -- neta >= 0. `base_neta = base_comisionable * (1 - pct_comision/100)` —
  -- álgebra idéntica a `baseComisionable - comision` (donde
  -- `comision = baseComisionable * pct_comision/100`), MISMA fórmula que
  -- `calcularNetoProgramaConModalidad()` (lib/calc/programaPrecio.ts), nunca
  -- reimplementada distinto. Una base neta negativa es una CONFIGURACIÓN
  -- INVÁLIDA (ej. un impuesto mayor a la tarifa con % de comisión bajo): se
  -- rechaza ANTES del DELETE/INSERT (última barrera — navegador y Server
  -- Action ya la repiten antes de llegar acá). Con la regla apagada o en
  -- modalidad histórica NO se valida nada acá: los datos/programas en
  -- modalidad histórica jamás quedan bloqueados por esta regla nueva.
  if v_activa and v_modalidad_mk = 'base_neta_impuestos_al_final' then
    for r in
      select x.orden, x.tarifa_sencilla, x.tarifa_doble, x.tarifa_triple, x.tarifa_multiple
      from jsonb_to_recordset(coalesce(p_salidas, '[]'::jsonb)) as x(
        orden int, tarifa_sencilla numeric, tarifa_doble numeric, tarifa_triple numeric, tarifa_multiple numeric
      )
    loop
      if r.tarifa_sencilla is not null and r.tarifa_sencilla > 0 then
        v_base := case v_modo when 'pct' then r.tarifa_sencilla * (1 - v_valor/100) when 'impuesto' then r.tarifa_sencilla - v_valor else r.tarifa_sencilla end;
        v_base_neta := v_base * (1 - v_pct_comision/100);
        if v_base_neta < 0 then
          raise exception 'La tarifa sencilla (%) de la salida (orden %) produce una base neta negativa en la modalidad "MK sobre base neta; impuestos al final".', r.tarifa_sencilla, r.orden;
        end if;
      end if;
      if r.tarifa_doble is not null and r.tarifa_doble > 0 then
        v_base := case v_modo when 'pct' then r.tarifa_doble * (1 - v_valor/100) when 'impuesto' then r.tarifa_doble - v_valor else r.tarifa_doble end;
        v_base_neta := v_base * (1 - v_pct_comision/100);
        if v_base_neta < 0 then
          raise exception 'La tarifa doble (%) de la salida (orden %) produce una base neta negativa en la modalidad "MK sobre base neta; impuestos al final".', r.tarifa_doble, r.orden;
        end if;
      end if;
      if r.tarifa_triple is not null and r.tarifa_triple > 0 then
        v_base := case v_modo when 'pct' then r.tarifa_triple * (1 - v_valor/100) when 'impuesto' then r.tarifa_triple - v_valor else r.tarifa_triple end;
        v_base_neta := v_base * (1 - v_pct_comision/100);
        if v_base_neta < 0 then
          raise exception 'La tarifa triple (%) de la salida (orden %) produce una base neta negativa en la modalidad "MK sobre base neta; impuestos al final".', r.tarifa_triple, r.orden;
        end if;
      end if;
      if r.tarifa_multiple is not null and r.tarifa_multiple > 0 then
        v_base := case v_modo when 'pct' then r.tarifa_multiple * (1 - v_valor/100) when 'impuesto' then r.tarifa_multiple - v_valor else r.tarifa_multiple end;
        v_base_neta := v_base * (1 - v_pct_comision/100);
        if v_base_neta < 0 then
          raise exception 'La tarifa múltiple (%) de la salida (orden %) produce una base neta negativa en la modalidad "MK sobre base neta; impuestos al final".', r.tarifa_multiple, r.orden;
        end if;
      end if;
    end loop;
  end if;

  update public.programas
     set regla_comisionable = v_activa,
         regla_comisionable_modo = v_modo,
         regla_comisionable_valor = v_valor,
         regla_comisionable_pct_comision = v_pct_comision,
         regla_comisionable_modalidad_mk = v_modalidad_mk,
         updated_at = now()
   where id = p_programa_id;

  delete from public.programa_salidas where programa_id = p_programa_id;

  insert into public.programa_salidas (
    programa_id, orden, etiqueta, fecha_desde, fecha_hasta, noches, columna,
    neto_sencilla, neto_doble, neto_triple, neto_multiple, neto_nino, bajo_solicitud,
    tarifa_sencilla, tarifa_doble, tarifa_triple, tarifa_multiple
  )
  select
    p_programa_id,
    x.orden,
    x.etiqueta,
    x.fecha_desde,
    x.fecha_hasta,
    x.noches,
    x.columna,
    x.neto_sencilla, x.neto_doble, x.neto_triple, x.neto_multiple, x.neto_nino,
    coalesce(x.bajo_solicitud, false),
    x.tarifa_sencilla, x.tarifa_doble, x.tarifa_triple, x.tarifa_multiple
  from jsonb_to_recordset(coalesce(p_salidas, '[]'::jsonb)) as x(
    orden           int,
    etiqueta        text,
    fecha_desde     date,
    fecha_hasta     date,
    noches          int,
    columna         text,
    neto_sencilla   numeric,
    neto_doble      numeric,
    neto_triple     numeric,
    neto_multiple   numeric,
    neto_nino       numeric,
    bajo_solicitud  boolean,
    tarifa_sencilla numeric,
    tarifa_doble    numeric,
    tarifa_triple   numeric,
    tarifa_multiple numeric
  );
end;
$$;

comment on function public.guardar_programa_salidas(bigint, jsonb, jsonb) is
  'Reemplaza la regla comisionable (incl. modalidad de MK, migración 161) de un programa y '
  'sus salidas en una sola transacción (UPDATE + DELETE + INSERT) — si el INSERT falla, el '
  'DELETE también se revierte y el programa no queda sin salidas. Clave `modalidadMk` AUSENTE '
  'en p_regla conserva la modalidad ya guardada (nunca la pisa con el default); presente pero '
  'vacía/nula/inválida se rechaza (fail-closed). Con la regla activa y la modalidad nueva, '
  'valida cada tarifa contra base_neta >= 0 antes de escribir. SIN security definer: corre '
  'con el rol del que llama, sujeto a las mismas policies de programas/programa_salidas.';

-- ACL (revisión PR #277, defecto 4): `revoke ... from public` ya revoca lo
-- que PUBLIC concede a TODOS los roles (incl. `anon`), pero se agrega el
-- revoke explícito a `anon` como defensa en profundidad — verificado con
-- `has_function_privilege` en el script de pruebas (anon=false, PUBLIC=false,
-- authenticated=true).
revoke all on function public.guardar_programa_salidas(bigint, jsonb, jsonb) from public;
revoke all on function public.guardar_programa_salidas(bigint, jsonb, jsonb) from anon;
grant execute on function public.guardar_programa_salidas(bigint, jsonb, jsonb) to authenticated;

commit;
