-- ───────────────────────────────────────────────────────────────────────────
-- 234 · MODO DE OFERTA CON CONVERSIÓN POR TRM TAMBIÉN PUBLICANDO EN USD  (#90 · #63 · #93)
--
-- POR QUÉ (hallazgo de Preview del PR #395)
--   Un paquete Dinámico publicado en USD no podía vincular vuelos de Empaquetados sin record: las salidas vinculadas viven en el modo
--   cop_trm_63, y ese modo estaba atado por CHECK a publicar en COP (233: armado_paquetes_modo63_moneda_chk; publicar_tarifario_resultado_63
--   exigía p_moneda = 'COP'). El selector no aparecía y, aunque apareciera, guardar/publicar/contratar habrían fallado.
--
-- REGLAS DEL DUEÑO (ADL-035, TASKS #90/#93)
--   · El selector muestra todo vuelo de Empaquetados elegible sin importar su moneda; la CONFIGURACIÓN DEL PAQUETE decide el cálculo.
--   · Misma moneda que la publicación: SIN conversión (exacto). Fuente en COP y publicación en USD: COP / TRM. Fuente en USD y publicación en
--     COP: USD × TRM (como hasta hoy). Reventa aérea (R) sin segundo markup ni TA; fee de infante exacto; sin cupos.
--   · La TRM de PUBLICACIÓN es obligatoria, positiva y queda congelada en la oferta SOLO cuando hay fuentes que convertir (en COP: alguna en USD;
--     en USD: alguna en COP). Una publicación en USD con fuentes EXCLUSIVAMENTE en USD se publica y se cotiza SIN TRM.
--   · La contabilidad está en pesos: una obligación en USD se devenga por su equivalente COP. Para una oferta en USD sin TRM, al CONTRATAR (aceptar)
--     se captura y congela la TRM PROVISIONAL ANTES de crear CxP o asientos en COP. La tasa la INGRESA EXPRESAMENTE quien convierte la cotización a
--     contrato; no existe respaldo automático en parametros_tributarios.trm_referencia (aunque exista y sea válido): sin tasa ingresada no se
--     contrata ni se reserva número. Esa TRM no cambia después.
--
-- QUÉ HACE (ADITIVA; la 227, la 230 y la 233 aplicadas NO se editan: sus funciones se reemplazan con CREATE OR REPLACE)
--   1. Elimina armado_paquetes_modo63_moneda_chk: el modo 63 admite moneda_publicacion COP, USD o NULL (NULL = COP, paquetes anteriores a la 233).
--      El CHECK armado_paquetes_moneda_publicacion_chk (COP/USD/NULL) sigue vigente.
--   2. p63_requiere_trm(paquete): true si alguna fuente que aporta está en la moneda OPUESTA a la de publicación (hay que convertirla).
--   3. publicar_tarifario_resultado_63: acepta p_moneda COP o USD; debe ser la ELEGIDA por el paquete (coalesce(moneda_publicacion,'COP')) o se
--      descarta la publicación (devuelve false, como un cambio de modo o de TRM mientras se generaba).
--   4. crear_cotizacion_oferta_63: la moneda del snapshot, la de su cabecera y la de la cotización son la misma y es la elegida por el paquete.
--   5. p63_aceptacion.trm_provisional (nueva, inmutable): TRM capturada al aceptar una oferta USD sin TRM. aceptar_oferta_63 gana un 6.º parámetro
--      (p_trm_provisional numeric default null; la firma de 5 argumentos se elimina): en una oferta USD sin TRM la tasa INGRESADA al convertir es
--      OBLIGATORIA (NULL → p63_trm_requerida, aunque exista trm_referencia, también llamando con 5 argumentos), se valida positiva (p63_trm_invalida)
--      y ambas cosas se rechazan ANTES de reservar número;
--      además rechaza si el paquete cambió de moneda desde la cotización;
--      p63_financiero_derivado le pone esa TRM y su equivalente COP a las obligaciones en USD sin TRM; p63_registrar_financiero la acepta
--      como la TRM de la oferta; trg_p63_inmutable la protege.
--   6. Frontera de publicación (sin banderas de sesión): el cuerpo del publicador (229) pasa a publicar_tarifario_resultado_interno (sin
--      ejecución para anon/authenticated); publicar_tarifario_resultado queda como fachada que rechaza paquetes cop_trm_63 (con o sin filas);
--      publicar_tarifario_resultado_63 delega en el interno; y tarifario_resultado pierde INSERT/UPDATE/DELETE/TRUNCATE para anon/authenticated.
--
-- QUÉ NO HACE
--   No toca datos, RLS ni el CHECK de CxP (cuentas_por_pagar_cop63_chk: toda obligación aceptada en USD termina con TRM y equivalente).
--   Solo cambia ACL en lo dicho en el punto 6. La lógica del publicador de la 229 no cambia (acepta COP/USD); no cambia los triggers de invalidación (cambiar moneda, modo, TRM o fuentes ya invalida el
--   tarifario y mueve las revisiones que la aceptación contrasta). No escribe ventas.trm_contrato (la fija la confirmación por abonos).
--
-- ORDEN DE DESPLIEGUE: esta migración va ANTES del código nuevo; el código anterior sigue funcionando (todo paquete 63 existente es COP).
-- Rollback: supabase/scripts/rollback_234_oferta_usd.sql (se niega si ya hay paquetes 63 en USD, ofertas/aceptaciones/contratos en USD o TRM provisionales).
-- ───────────────────────────────────────────────────────────────────────────

begin;

-- ═══ 0. Prerrequisitos (fallan cerrado) ═══════════════════════════════════
do $$
begin
  -- Primero «ya aplicada» (la 234 elimina la firma de 5 argumentos de aceptar_oferta_63 y entonces faltaría «la 233»).
  if not exists (select 1 from pg_constraint where conrelid = 'public.armado_paquetes'::regclass and conname = 'armado_paquetes_modo63_moneda_chk')
     and to_regprocedure('public.aceptar_oferta_63(bigint, text, uuid, text, text, numeric)') is not null then
    raise exception '234 ya aplicada (aceptar_oferta_63 ya tiene p_trm_provisional y no existe armado_paquetes_modo63_moneda_chk). No se re-aplica.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'armado_paquetes' and column_name = 'moneda_publicacion')
     or to_regprocedure('public.p63_requiere_trm(bigint)') is null
     or to_regprocedure('public.publicar_tarifario_resultado_63(bigint, bigint, bigint, text, jsonb, text, numeric)') is null
     or to_regprocedure('public.crear_cotizacion_oferta_63(uuid, text, jsonb, jsonb, text, text, jsonb)') is null
     or to_regprocedure('public.aceptar_oferta_63(bigint, text, uuid, text, text)') is null
     or to_regprocedure('public.p63_financiero_derivado(bigint)') is null
     or to_regprocedure('public.p63_registrar_financiero(text, text, jsonb, jsonb, bigint)') is null
     or to_regprocedure('public.trg_p63_inmutable()') is null then
    raise exception '234 ABORTADA: falta la 233 (moneda de publicación + TRM condicional).';
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.armado_paquetes'::regclass and conname = 'armado_paquetes_moneda_publicacion_chk') then
    raise exception '234 ABORTADA: falta armado_paquetes_moneda_publicacion_chk (233).';
  end if;
end $$;

-- ═══ 1. El modo 63 deja de estar atado a COP ═══════════════════════════════
alter table public.armado_paquetes drop constraint armado_paquetes_modo63_moneda_chk;

-- ═══ 2. TRM provisional congelada al aceptar (oferta en USD sin TRM) ═══════
alter table public.p63_aceptacion add column trm_provisional numeric(15,4);
alter table public.p63_aceptacion add constraint p63_aceptacion_trm_provisional_chk check (trm_provisional is null or trm_provisional > 0);
comment on column public.p63_aceptacion.trm_provisional is
  'TRM (COP por USD) INGRESADA por quien convierte la cotización a contrato al ACEPTAR una oferta en USD cotizada sin TRM (todas sus fuentes en USD). Congelada e inmutable: las CxP y los asientos en COP de esa aceptación salen de ella. NULL en toda otra aceptación. Migración 234.';

-- La TRM provisional de una aceptación no se modifica.
create or replace function public.trg_p63_inmutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'p63_historico: % es historia de lo aceptado y no se borra', tg_table_name;
  end if;
  if tg_table_name = 'p63_oferta' then
    if new.cotizacion_id is distinct from old.cotizacion_id or new.tenant is distinct from old.tenant
       or new.paquete_id is distinct from old.paquete_id or new.salida_id is distinct from old.salida_id
       or new.trm is distinct from old.trm or new.rev_fuente is distinct from old.rev_fuente
       or new.rev_publicada is distinct from old.rev_publicada or new.gen_publicada is distinct from old.gen_publicada
       or new.rev_costos is distinct from old.rev_costos or new.huella is distinct from old.huella
       or new.huella_financiera is distinct from old.huella_financiera or new.snapshot is distinct from old.snapshot
       or new.creada_en is distinct from old.creada_en then
      raise exception 'p63_inmutable: el snapshot y la identidad de una oferta cotizada no se modifican';
    end if;
  else
    if new.oferta_id is distinct from old.oferta_id or new.cotizacion_id is distinct from old.cotizacion_id
       or new.tenant is distinct from old.tenant or new.numero_contrato is distinct from old.numero_contrato
       or new.usuario_id is distinct from old.usuario_id or new.fecha_negocio is distinct from old.fecha_negocio
       or new.snapshot is distinct from old.snapshot or new.creada_en is distinct from old.creada_en
       or new.trm_provisional is distinct from old.trm_provisional then
      raise exception 'p63_inmutable: el snapshot y la identidad de una aceptación no se modifican';
    end if;
    if (old.estado = 'completa' and new.estado <> 'completa') or (old.estado = 'descartada' and new.estado <> 'descartada') then
      raise exception 'p63_inmutable: una aceptación % no vuelve a otro estado', old.estado;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.trg_p63_inmutable() from public, anon, authenticated;

-- ═══ 2b. Cierre de las vías de entrada ══════════════════════════════════════
-- (1) FRONTERA DE BASE DE DATOS para el modo 63. Un paquete cop_trm_63 SOLO se publica por publicar_tarifario_resultado_63 (valida moneda elegida,
--     fuentes, revisión y TRM bajo candado). No depende de set_config/banderas ni de que el lote tenga filas:
--     a) publicar_tarifario_resultado_interno = el cuerpo del publicador de la 229 (mismas comprobaciones de rol, token de generación/revisión y
--        FOR UPDATE), SIN ejecución para public/anon/authenticated: solo la alcanzan las funciones SECURITY DEFINER de este esquema (dueño).
--     b) publicar_tarifario_resultado (el que ejecuta authenticated, misma firma y grants) pasa a ser una fachada: toma el candado del paquete,
--        rechaza si es cop_trm_63 (aunque p_filas sea []: la decisión sale del paquete, no de las filas) y delega en el interno.
--     c) publicar_tarifario_resultado_63 delega en el interno (no en la fachada), tras validar todo lo suyo.
--     d) tarifario_resultado deja de ser escribible por anon/authenticated (INSERT/UPDATE/DELETE/TRUNCATE): ninguna ruta de la app la escribe directo
--        (solo las funciones SECURITY DEFINER), así que la escritura directa por la API ya no existe. Policies y SELECT no se tocan.
create or replace function public.publicar_tarifario_resultado_interno(
  p_paquete_id bigint,
  p_generacion bigint,
  p_revision_capturada bigint,
  p_moneda text,
  p_filas jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_generacion_actual bigint;
  v_revision_actual   bigint;
  v_activo            boolean;
  v_fila_paquete_txt  text;
  v_fila_paquete      bigint;
begin
  if coalesce(public.mi_rol()::text, '') not in ('superadmin', 'gerencia', 'administracion', 'operaciones') then
    raise exception 'publicar_tarifario_resultado: rol sin permiso de escritura sobre tarifario_resultado';
  end if;
  if p_paquete_id is null or p_generacion is null or p_revision_capturada is null then
    raise exception 'publicar_tarifario_resultado: p_paquete_id, p_generacion y p_revision_capturada son obligatorios';
  end if;
  -- `p_moneda is null or ...`, NUNCA `p_moneda not in (...)` a secas: con NULL esa comparación es NULL y el `if` no
  -- dispararía la excepción (mismo defecto ya corregido en `mi_rol()`, migración 179).
  if p_moneda is null or p_moneda not in ('COP', 'USD') then
    raise exception 'publicar_tarifario_resultado: p_moneda debe ser COP o USD, recibido: %', p_moneda;
  end if;
  if p_filas is null or jsonb_typeof(p_filas) <> 'array' then
    raise exception 'publicar_tarifario_resultado: p_filas debe ser un arreglo jsonb';
  end if;

  -- Candado de fila + lectura del estado actual (serializa dos publicaciones del MISMO paquete). `activo` se lee AQUÍ:
  -- el `paquete_activo` de cada fila sale de esta lectura autoritativa, nunca del payload.
  select tarifario_generacion, tarifario_revision_fuente, activo
    into v_generacion_actual, v_revision_actual, v_activo
    from public.armado_paquetes
    where id = p_paquete_id
    for update;

  if not found then
    raise exception 'publicar_tarifario_resultado: paquete % no encontrado', p_paquete_id;
  end if;

  -- Rechazo #1: alguien más ya pidió (o publicó) una generación más nueva.
  if v_generacion_actual <> p_generacion then
    return false;
  end if;

  -- Rechazo #2: las FUENTES cambiaron durante este cálculo. Queda 'pendiente' (nunca 'recalculando' colgado en falso).
  if v_revision_actual <> p_revision_capturada then
    update public.armado_paquetes set tarifario_estado = 'pendiente' where id = p_paquete_id;
    return false;
  end if;

  -- Validación COMPLETA del lote ANTES de tocar una sola fila (fail-closed). Set-based: UNA consulta para el tipo de
  -- cada elemento, y el cast de paquete_id solo sobre los valores DISTINTOS del payload (normalmente uno).
  if exists (select 1 from jsonb_array_elements(p_filas) e where jsonb_typeof(e) <> 'object') then
    raise exception 'publicar_tarifario_resultado: cada elemento de p_filas debe ser un objeto jsonb';
  end if;
  for v_fila_paquete_txt in
    select distinct e->>'paquete_id' from jsonb_array_elements(p_filas) e
     where e ? 'paquete_id' and e->>'paquete_id' is not null
  loop
    begin
      v_fila_paquete := v_fila_paquete_txt::bigint;
    exception when others then
      raise exception 'publicar_tarifario_resultado: paquete_id de una fila no es numérico: %', v_fila_paquete_txt;
    end;
    if v_fila_paquete <> p_paquete_id then
      raise exception 'publicar_tarifario_resultado: una fila declara paquete_id % distinto al solicitado (%)', v_fila_paquete, p_paquete_id;
    end if;
  end loop;

  delete from public.tarifario_resultado where paquete_id = p_paquete_id;

  -- Carga SET-BASED: un solo INSERT … SELECT. Columnas EXPLÍCITAS (nunca `insert *`): `id` y `created_at` los genera
  -- Postgres; `paquete_id` es SIEMPRE p_paquete_id, `paquete_activo` SIEMPRE v_activo y `moneda` SIEMPRE p_moneda
  -- (un paquete es de UNA sola moneda), nunca lo que traiga la fila. Mismas expresiones y casts que la 226.
  insert into public.tarifario_resultado (
    paquete_id, paquete_nombre, paquete_activo, modulo, bloqueo_id, bloqueo_label,
    empaquetado_id, hotel_id, hotel_nombre, servicio_id, servicio_nombre,
    destino_id, destino_nombre, categoria, regimen, acomodacion, noches,
    fecha_ida, fecha_regreso, pax_desde, pax_hasta, tipo_tarifa,
    base_comisionable, impuesto, precio_pvp, precio_pvp_menor2, descripcion, recargo_individual,
    moneda, salida_id, temporada_ganadora, es_promocion, precio_final_autoritativo,
    procedencia_temporadas, procedencia_mixta
  )
  select
    p_paquete_id,
    f.v->>'paquete_nombre',
    v_activo,
    (f.v->>'modulo')::public.tarifario_modulo,
    (f.v->>'bloqueo_id')::bigint,
    f.v->>'bloqueo_label',
    (f.v->>'empaquetado_id')::bigint,
    (f.v->>'hotel_id')::bigint,
    f.v->>'hotel_nombre',
    (f.v->>'servicio_id')::bigint,
    f.v->>'servicio_nombre',
    (f.v->>'destino_id')::bigint,
    f.v->>'destino_nombre',
    f.v->>'categoria',
    f.v->>'regimen',
    (f.v->>'acomodacion')::public.acomodacion_tipo,
    (f.v->>'noches')::integer,
    (f.v->>'fecha_ida')::date,
    (f.v->>'fecha_regreso')::date,
    (f.v->>'pax_desde')::integer,
    (f.v->>'pax_hasta')::integer,
    f.v->>'tipo_tarifa',
    coalesce((f.v->>'base_comisionable')::numeric, 0),
    coalesce((f.v->>'impuesto')::numeric, 0),
    coalesce((f.v->>'precio_pvp')::numeric, 0),
    -- Migración 226: precio de un MENOR DE 2 AÑOS. NULL = no aplica o fila de un código anterior a la 226.
    (f.v->>'precio_pvp_menor2')::numeric,
    f.v->>'descripcion',
    (f.v->>'recargo_individual')::numeric,
    p_moneda,
    (f.v->>'salida_id')::bigint,
    f.v->>'temporada_ganadora',
    (f.v->>'es_promocion')::boolean,
    (f.v->>'precio_final_autoritativo')::boolean,
    -- Clave ausente O valor `null`::jsonb ⇒ SQL NULL (el escalar jsonb `null` NO es SQL NULL y violaría los CHECK de la
    -- 180); cualquier otro valor, incluido un arreglo vacío `[]`, se inserta tal cual.
    case
      when not (f.v ? 'procedencia_temporadas')
        or f.v->'procedencia_temporadas' = 'null'::jsonb
      then null
      else f.v->'procedencia_temporadas'
    end,
    coalesce((f.v->>'procedencia_mixta')::boolean, false)
  from jsonb_array_elements(p_filas) with ordinality as f(v, ord)
  order by f.ord;

  -- Una publicación exitosa habilita el snapshot SOLO si el paquete sigue activo. `moneda = p_moneda` se escribe EN LA
  -- MISMA transacción que las filas (columna fuera de la lista `UPDATE OF` del trigger de armado_paquetes: no se
  -- re-invalida a sí misma).
  update public.armado_paquetes set
    tarifario_generacion_publicada = p_generacion,
    tarifario_revision_publicada = p_revision_capturada,
    tarifario_estado = 'listo',
    tarifario_error = null,
    tarifario_snapshot_publicable = v_activo,
    tarifario_actualizado_en = now(),
    moneda = p_moneda
  where id = p_paquete_id;

  return true;
end;
$$;

revoke all on function public.publicar_tarifario_resultado_interno(bigint, bigint, bigint, text, jsonb) from public, anon, authenticated;
comment on function public.publicar_tarifario_resultado_interno(bigint, bigint, bigint, text, jsonb) is
  '234: cuerpo del publicador (181/226/229) sin ejecución directa para anon/authenticated. Lo llaman publicar_tarifario_resultado (paquetes que NO son cop_trm_63) y publicar_tarifario_resultado_63 (los que sí, tras validar moneda/TRM/fuentes). Conserva el candado de rol (mi_rol), el FOR UPDATE del paquete y el rechazo por generación/revisión.';

create or replace function public.publicar_tarifario_resultado(
  p_paquete_id bigint,
  p_generacion bigint,
  p_revision_capturada bigint,
  p_moneda text,
  p_filas jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_modo text;
begin
  if coalesce(public.mi_rol()::text, '') not in ('superadmin', 'gerencia', 'administracion', 'operaciones') then
    raise exception 'publicar_tarifario_resultado: rol sin permiso de escritura sobre tarifario_resultado';
  end if;
  if p_paquete_id is null then
    raise exception 'publicar_tarifario_resultado: p_paquete_id, p_generacion y p_revision_capturada son obligatorios';
  end if;
  -- Mismo candado que toma el interno (la fila queda bloqueada hasta el final de la transacción): el modo no puede cambiar entre esta
  -- comprobación y la publicación.
  select p.modo_oferta into v_modo from public.armado_paquetes p where p.id = p_paquete_id for update;
  if found and v_modo = 'cop_trm_63' then
    raise exception 'p63_publicador: un paquete en modo cop_trm_63 solo se publica por publicar_tarifario_resultado_63 (valida la moneda elegida, las fuentes, la revisión y la TRM)';
  end if;
  return public.publicar_tarifario_resultado_interno(p_paquete_id, p_generacion, p_revision_capturada, p_moneda, p_filas);
end;
$fn$;
comment on function public.publicar_tarifario_resultado(bigint, bigint, bigint, text, jsonb) is
  'Publicador base (181/226/229, fachada desde la 234): rechaza los paquetes cop_trm_63 (p63_publicador, con o sin filas) y delega los demás en publicar_tarifario_resultado_interno. SECURITY DEFINER con candado de rol propio.';
revoke all on function public.publicar_tarifario_resultado(bigint, bigint, bigint, text, jsonb) from public, anon;
grant execute on function public.publicar_tarifario_resultado(bigint, bigint, bigint, text, jsonb) to authenticated;

revoke insert, update, delete, truncate on public.tarifario_resultado from public, anon, authenticated;

-- (2) La TRM del paquete debe ser FINITA: NaN pasa el CHECK de «> 0» (NaN es mayor que todo en Postgres) y un UPDATE directo por la API lo guardaba.
alter table public.armado_paquetes drop constraint if exists armado_paquetes_trm_finita_chk;
alter table public.armado_paquetes
  add constraint armado_paquetes_trm_finita_chk check (trm_oferta is null or (trm_oferta <> 'NaN'::numeric and trm_oferta < 100000000000));

-- ═══ 3. ¿Se requiere TRM? (solo si hay fuentes en la otra moneda) ════════════
create or replace function public.p63_requiere_trm(p_paquete bigint)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_hoy     date := public.p63_hoy_bogota();
  v_destino bigint;
  v_check   boolean;
  v_ef      bigint[];
  v_otra    text;
begin
  -- 234: «la otra moneda» es la que habría que CONVERTIR: con publicación en COP, el USD; con publicación en USD, el COP. Lo que ya está en la
  -- moneda de publicación entra exacto y no exige TRM. (Una publicación en USD con TODAS las fuentes en USD se publica sin TRM: al contratar se
  -- congela la TRM provisional para el equivalente COP de las obligaciones; ver aceptar_oferta_63.)
  select case coalesce(p.moneda_publicacion, 'COP') when 'USD' then 'COP' else 'USD' end into v_otra from public.armado_paquetes p where p.id = p_paquete;
  v_otra := coalesce(v_otra, 'USD');

  if exists (
       select 1 from public.armado_hoteles ah join public.hoteles h on h.id = ah.hotel_id
        where ah.paquete_id = p_paquete and h.moneda = v_otra and coalesce(h.modelo_tarifario, '') <> 'unidad')
     or exists (
       select 1 from public.armado_servicios s join public.servicios_adicionales sa on sa.id = s.servicio_id
        where s.paquete_id = p_paquete and sa.moneda = v_otra) then
    return true;
  end if;

  select p.destino_id, coalesce(p.destinos_aereos_alternativos, false) into v_destino, v_check
    from public.armado_paquetes p where p.id = p_paquete;
  v_ef := public.destinos_aereos_efectivos_67(
            v_destino, v_check,
            coalesce((select array_agg(a.destino_id) from public.armado_paquete_destinos_aereos a where a.paquete_id = p_paquete), '{}'::bigint[]));

  return exists (
    select 1
      from public.salidas_dinamicas sd
      left join public.empaquetados e on e.id = sd.empaquetado_id
     where sd.paquete_id = p_paquete
       and sd.activo
       and sd.fecha_ida is not null and sd.fecha_regreso is not null and sd.fecha_regreso > sd.fecha_ida
       and sd.fecha_ida >= v_hoy
       and (sd.compra_inicio is null or v_hoy >= sd.compra_inicio)
       and (sd.compra_fin is null or v_hoy <= sd.compra_fin)
       and case
             when sd.empaquetado_id is null then sd.moneda = v_otra
             else e.id is not null
                  and e.activo
                  and btrim(coalesce(e.record, '')) = ''
                  and e.fecha_ida is not null and e.fecha_regreso is not null
                  and (e.compra_inicio is null or v_hoy >= e.compra_inicio)
                  and (e.compra_fin is null or v_hoy <= e.compra_fin)
                  and e.fecha_ida >= v_hoy
                  and e.moneda in ('COP', 'USD')
                  and coalesce(e.tarifa_para_empaquetar, 0) > 0
                  and e.destino_id is not null and e.destino_id = any (v_ef)
                  and round(coalesce(sd.valor_tiquete, 0), 2) = round(e.tarifa_para_empaquetar, 2)
                  and round(coalesce(sd.fee_infante, 0), 2) = round(coalesce(e.fee_infante, 0), 2)
                  and sd.fecha_ida = e.fecha_ida
                  and sd.fecha_regreso is not distinct from e.fecha_regreso
                  and btrim(coalesce(sd.ruta, '')) = btrim(coalesce(e.ruta, ''))
                  and btrim(coalesce(sd.aerolinea, '')) = btrim(coalesce(e.aerolinea, ''))
                  and sd.moneda = e.moneda
                  and e.moneda = v_otra
           end);
end;
$$;
comment on function public.p63_requiere_trm(bigint) is
  '233/234 (#93): true si alguna fuente que REALMENTE aporta al precio (hotel no por unidad, servicio, o salida dinámica vigente y, si es vinculada, elegible/permitida/al día) está en la moneda OPUESTA a la de publicación (USD en una publicación COP; COP en una publicación USD) y por tanto hay que convertirla con la TRM. Una salida descartada no cuenta. Espejo de lib/reservar/aporteFuentes90.ts. Solo la usan las RPC de #63.';
revoke all on function public.p63_requiere_trm(bigint) from public, anon, authenticated;

-- ═══ 4. Publicación 63 en la moneda elegida ═══════════════════════════════
create or replace function public.publicar_tarifario_resultado_63(
  p_paquete_id bigint,
  p_generacion bigint,
  p_revision_capturada bigint,
  p_moneda text,
  p_filas jsonb,
  p_modo text,
  p_trm numeric
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_modo      text;
  v_trm       numeric;
  v_mp        text;
  v_publicado boolean;
  v_revision  bigint;
  v_fuentes   jsonb;
begin
  if coalesce(public.mi_rol()::text, '') not in ('superadmin', 'gerencia', 'administracion', 'operaciones') then
    raise exception 'publicar_tarifario_resultado_63: rol sin permiso de escritura sobre tarifario_resultado';
  end if;
  if p_paquete_id is null or p_generacion is null or p_revision_capturada is null then
    raise exception 'publicar_tarifario_resultado_63: p_paquete_id, p_generacion y p_revision_capturada son obligatorios';
  end if;
  if p_modo is distinct from 'cop_trm_63' then
    raise exception 'publicar_tarifario_resultado_63: p_modo debe ser cop_trm_63, recibido: %', p_modo;
  end if;
  -- 234: el modo publica en la moneda ELEGIDA del paquete (COP o USD); más abajo se contrasta con la guardada bajo candado.
  if p_moneda is null or p_moneda not in ('COP', 'USD') then
    raise exception 'publicar_tarifario_resultado_63: la moneda de publicación debe ser COP o USD, recibida: %', p_moneda;
  end if;
  -- 233 (#93): la TRM puede ser NULL (todo COP, sin conversión); si llega, debe ser positiva. Nunca se asume 1.
  if p_trm is not null and (p_trm = 'NaN'::numeric or p_trm <= 0 or p_trm >= 100000000000) then
    raise exception 'publicar_tarifario_resultado_63: la TRM debe ser positiva y finita o no enviarse, recibida: %', p_trm;
  end if;

  -- Candado del paquete (el mismo que toma el publicador vigente) y coherencia con lo que se calculó: si el modo, la TRM o la moneda
  -- cambiaron mientras se generaba, esta publicación se descarta (igual que una revisión de fuente superada).
  select p.modo_oferta, p.trm_oferta, p.moneda_publicacion into v_modo, v_trm, v_mp from public.armado_paquetes p where p.id = p_paquete_id for update;
  if not found then
    raise exception 'publicar_tarifario_resultado_63: el paquete % no existe', p_paquete_id;
  end if;
  if v_modo is distinct from 'cop_trm_63' or v_trm is distinct from p_trm then
    return false;
  end if;
  -- 234: la moneda con la que se calculó debe ser la ELEGIDA por el paquete (COP si nunca eligió: paquetes del modo 63 anteriores a la 233). Si
  -- cambió mientras se generaba, esta publicación se descarta (igual que un cambio de modo o de TRM).
  if coalesce(v_mp, 'COP') is distinct from p_moneda then
    return false;
  end if;
  -- 233/234 (#93): sin TRM solo se publica si NINGUNA fuente hay que convertirla (en COP: ninguna en USD; en USD: ninguna en COP). Se mide aquí, bajo el candado, con las monedas guardadas.
  if v_trm is null and public.p63_requiere_trm(p_paquete_id) then
    raise exception 'p63_trm_requerida: hay componentes del paquete en USD y el paquete no tiene una TRM positiva';
  end if;

  -- El publicador INTERNO (cuerpo de la 229, sin ejecución directa) hace todo lo demás: token de generación, revisión, snapshot y moneda. No se copia su cuerpo.
  v_publicado := public.publicar_tarifario_resultado_interno(p_paquete_id, p_generacion, p_revision_capturada, p_moneda, p_filas);

  if v_publicado then
    select p.tarifario_revision_publicada into v_revision from public.armado_paquetes p where p.id = p_paquete_id;
    select coalesce(jsonb_agg(jsonb_build_object(
             'salida_id', s.id, 'empaquetado_id', s.empaquetado_id, 'valor_tiquete', s.valor_tiquete, 'fee_infante', s.fee_infante
           ) order by s.id), '[]'::jsonb)
      into v_fuentes
      from public.salidas_dinamicas s
     where s.paquete_id = p_paquete_id and s.empaquetado_id is not null;
    insert into public.tarifario_oferta_63 as o (paquete_id, modo, trm, generacion, revision_fuente, fuentes, publicado_en)
    values (p_paquete_id, p_modo, p_trm, p_generacion, v_revision, v_fuentes, now())
    on conflict (paquete_id) do update
      set modo = excluded.modo, trm = excluded.trm, generacion = excluded.generacion,
          revision_fuente = excluded.revision_fuente, fuentes = excluded.fuentes, publicado_en = excluded.publicado_en;
  end if;
  return v_publicado;
end;
$$;

comment on function public.publicar_tarifario_resultado_63(bigint, bigint, bigint, text, jsonb, text, numeric) is
  '234 (sobre 233/227, #63/#90/#93): envuelve a publicar_tarifario_resultado (el vigente) para un paquete en modo cop_trm_63: valida modo/TRM/moneda (COP o USD, la ELEGIDA) contra el paquete bajo candado (la TRM puede ser NULL solo si ninguna fuente hay que convertirla), publica por el publicador interno y guarda la TRM/fuentes de esa publicación en la misma transacción.';
revoke all on function public.publicar_tarifario_resultado_63(bigint, bigint, bigint, text, jsonb, text, numeric) from public, anon;
grant execute on function public.publicar_tarifario_resultado_63(bigint, bigint, bigint, text, jsonb, text, numeric) to authenticated;

-- ═══ 5. Cotizar en la moneda elegida ═══════════════════════════════════════
create or replace function public.crear_cotizacion_oferta_63(
  p_usuario           uuid,
  p_tenant            text,
  p_cotizacion        jsonb,
  p_snapshot          jsonb,
  p_huella            text,
  p_huella_financiera text,
  p_t0                jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_paquete   bigint := nullif(p_snapshot ->> 'paquete_id', '')::bigint;
  v_salida    bigint := nullif(p_snapshot ->> 'salida_id', '')::bigint;
  v_trm       numeric := nullif(p_snapshot ->> 'trm', '')::numeric;
  v_mon       text := coalesce(nullif(p_snapshot ->> 'moneda', ''), 'COP');
  v_modo      text;
  v_tipo      text;
  v_trm_pq    numeric;
  v_mp        text;
  v_rev_f     bigint;
  v_rev_p     bigint;
  v_gen_p     bigint;
  v_rev_c     bigint;
  v_cot       public.cotizaciones;
  v_id        bigint;
begin
  if p_usuario is null or not exists (select 1 from public.usuarios u where u.id = p_usuario and u.activo is true) then
    raise exception 'p63_no_autorizado: usuario inexistente o inactivo';
  end if;
  if p_tenant is distinct from 'mayorista' then
    raise exception 'p63_no_autorizado: la oferta en COP con TRM solo existe en el tarifario de mayorista';
  end if;
  if v_paquete is null or (v_trm is not null and (v_trm = 'NaN'::numeric or v_trm <= 0 or v_trm >= 100000000000)) or coalesce(btrim(p_huella), '') = '' or coalesce(btrim(p_huella_financiera), '') = ''
     or jsonb_typeof(p_snapshot) is distinct from 'object' or p_snapshot -> 'financiero' is null or p_snapshot -> 'cabecera' is null
     or p_t0 is null then
    raise exception 'p63_invalida: snapshot, huellas o revisiones de la oferta incompletos';
  end if;

  -- FOR SHARE: espera a un cambio de fuente en curso y no deja que uno nuevo se cuele hasta que esta cotización quede escrita.
  select p.modo_oferta, p.tipo::text, p.trm_oferta, p.tarifario_revision_fuente, p.tarifario_revision_publicada,
         p.tarifario_generacion_publicada, p.p63_rev_costos, p.moneda_publicacion
    into v_modo, v_tipo, v_trm_pq, v_rev_f, v_rev_p, v_gen_p, v_rev_c, v_mp
    from public.armado_paquetes p where p.id = v_paquete for share;
  if not found then
    raise exception 'p63_oferta_cambio: el paquete % ya no existe', v_paquete;
  end if;
  if v_modo is distinct from 'cop_trm_63' or v_tipo is distinct from 'dinamico' or v_trm_pq is distinct from v_trm then
    raise exception 'p63_oferta_cambio: el modo o la TRM del paquete cambiaron mientras se cotizaba';
  end if;
  -- 234: la oferta se cotiza en la moneda ELEGIDA del paquete (COP si nunca eligió); la del snapshot, la de su cabecera y la de la cotización
  -- son la misma. Si el paquete cambió de moneda mientras se cotizaba, no hay cotización.
  if v_mon not in ('COP', 'USD') or coalesce(v_mp, 'COP') is distinct from v_mon then
    raise exception 'p63_oferta_cambio: la moneda de publicación del paquete cambió mientras se cotizaba';
  end if;
  if coalesce(p_snapshot -> 'cabecera' ->> 'moneda', '') is distinct from v_mon then
    raise exception 'p63_invalida: la moneda de la cabecera de la oferta no es la de la oferta';
  end if;
  -- 233/234 (#93): la TRM solo es obligatoria si alguna fuente del paquete hay que convertirla (se mide AHORA, bajo el candado del paquete).
  -- Una oferta en USD con todas sus fuentes en USD se cotiza SIN TRM: su equivalente COP provisional se congela al aceptar.
  if v_trm_pq is null and public.p63_requiere_trm(v_paquete) then
    raise exception 'p63_trm_requerida: hay componentes del paquete en USD y el paquete no tiene una TRM positiva; configúrala antes de cotizar';
  end if;
  if v_rev_f is distinct from (p_t0 ->> 'rev_fuente')::bigint
     or v_rev_p is distinct from nullif(p_t0 ->> 'rev_publicada', '')::bigint
     or v_gen_p is distinct from nullif(p_t0 ->> 'gen_publicada', '')::bigint
     or v_rev_c is distinct from (p_t0 ->> 'rev_costos')::bigint then
    raise exception 'p63_oferta_cambio: la configuración del paquete cambió mientras se cotizaba';
  end if;
  if v_salida is not null and not exists (select 1 from public.salidas_dinamicas s where s.id = v_salida and s.paquete_id = v_paquete) then
    raise exception 'p63_oferta_cambio: la salida % ya no pertenece al paquete', v_salida;
  end if;

  v_cot := jsonb_populate_record(null::public.cotizaciones, p_cotizacion);
  if v_cot.tenant is distinct from p_tenant or v_cot.paquete_armado_id is distinct from v_paquete then
    raise exception 'p63_invalida: la cotización no coincide con el paquete o la agencia de la oferta';
  end if;
  if v_cot.moneda is distinct from v_mon then
    raise exception 'p63_invalida: la moneda de la cotización no es la de la oferta';
  end if;

  insert into public.cotizaciones (
    tenant, payload, detalle, cliente, cliente_documento, destino, hotel, modulo, plan_nombre, pax, precio_venta, moneda,
    fecha_salida, fecha_regreso, vigencia_hasta, paquete_armado_id, asesor, creado_por
  ) values (
    v_cot.tenant, v_cot.payload, v_cot.detalle, v_cot.cliente, v_cot.cliente_documento, v_cot.destino, v_cot.hotel, v_cot.modulo,
    v_cot.plan_nombre, v_cot.pax, v_cot.precio_venta, v_cot.moneda, v_cot.fecha_salida, v_cot.fecha_regreso, v_cot.vigencia_hasta,
    v_cot.paquete_armado_id, v_cot.asesor, v_cot.creado_por
  ) returning id into v_id;

  insert into public.p63_oferta (
    cotizacion_id, tenant, paquete_id, salida_id, trm, rev_fuente, rev_publicada, gen_publicada, rev_costos,
    huella, huella_financiera, snapshot
  ) values (
    v_id, p_tenant, v_paquete, v_salida, v_trm, v_rev_f, v_rev_p, v_gen_p, v_rev_c, p_huella, p_huella_financiera, p_snapshot
  );
  return v_id;
end;
$$;
comment on function public.crear_cotizacion_oferta_63(uuid, text, jsonb, jsonb, text, text, jsonb) is
  '234 (sobre 233/227, #63/#90/#93): crea en UNA transacción la cotización y su oferta privada (snapshot completo; la TRM puede ser NULL si ninguna fuente hay que convertirla; la moneda de la oferta es la ELEGIDA del paquete y coincide con la de su cabecera y la de la cotización), verificando bajo candado que las revisiones de T0 siguen vigentes. Solo service_role, tras autorizar el servidor.';
revoke all on function public.crear_cotizacion_oferta_63(uuid, text, jsonb, jsonb, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.crear_cotizacion_oferta_63(uuid, text, jsonb, jsonb, text, text, jsonb) to service_role;

-- ═══ 6. Payload financiero derivado: TRM provisional en las obligaciones USD sin TRM ═══
create or replace function public.p63_financiero_derivado(p_aceptacion bigint)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
           'costos', coalesce(a.snapshot -> 'financiero' -> 'costos', '{}'::jsonb),
           'cxp', coalesce((
             select jsonb_agg(
                      case
                        -- 234: una obligación en USD sin TRM (oferta en USD sin conversión) lleva la TRM PROVISIONAL congelada al aceptar y su equivalente COP.
                        when a.trm_provisional is not null and coalesce(nullif(e.v ->> 'moneda', ''), 'COP') = 'USD' and nullif(e.v ->> 'trm', '') is null
                          then e.v || jsonb_build_object('trm', a.trm_provisional, 'valor_cop', round((e.v ->> 'valor_total')::numeric * a.trm_provisional, 2))
                        else e.v
                      end || jsonb_build_object('fecha_obligacion', a.fecha_negocio::text) order by e.ord)
               from jsonb_array_elements(coalesce(a.snapshot -> 'financiero' -> 'cxp', '[]'::jsonb)) with ordinality as e(v, ord)
           ), '[]'::jsonb))
    from public.p63_aceptacion a
   where a.id = p_aceptacion
$$;
revoke all on function public.p63_financiero_derivado(bigint) from public, anon, authenticated;

-- ═══ 7. Aceptar: contrasta la moneda y congela la TRM provisional INGRESADA (obligatoria en una oferta USD sin TRM) ═══
drop function public.aceptar_oferta_63(bigint, text, uuid, text, text);
create or replace function public.aceptar_oferta_63(
  p_cotizacion        bigint,
  p_tenant            text,
  p_usuario           uuid,
  p_huella            text,
  p_huella_financiera text,
  p_trm_provisional   numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_o        public.p63_oferta;
  v_a        public.p63_aceptacion;
  v_s        public.salidas_dinamicas;
  v_e        public.empaquetados;
  v_snap     jsonb;
  v_paquete  bigint;
  v_salida   bigint;
  v_emp      bigint;
  v_hoy      date;
  v_activo   boolean;
  v_tipo     text;
  v_modo     text;
  v_trm      numeric;
  v_mp       text;
  v_trm_prov numeric;
  v_publica  boolean;
  v_rev_f    bigint;
  v_rev_p    bigint;
  v_gen_p    bigint;
  v_rev_c    bigint;
  v_numero   text;
  v_id       bigint;
  v_vig      jsonb;
begin
  if p_usuario is null or not exists (select 1 from public.usuarios u where u.id = p_usuario and u.activo is true) then
    raise exception 'p63_no_autorizado: usuario inexistente o inactivo';
  end if;
  select * into v_o from public.p63_oferta where cotizacion_id = p_cotizacion;
  if not found then
    raise exception 'p63_sin_oferta: la cotización % no tiene una oferta en COP con TRM', p_cotizacion;
  end if;
  if v_o.tenant is distinct from p_tenant or p_tenant is distinct from 'mayorista' then
    raise exception 'p63_no_autorizado: la oferta no pertenece a la agencia indicada';
  end if;
  v_snap := v_o.snapshot;
  v_paquete := v_o.paquete_id;
  v_salida := v_o.salida_id;
  v_emp := nullif(v_snap ->> 'empaquetado_id', '')::bigint;

  -- Candados en orden fijo.
  if v_emp is not null then
    perform 1 from public.empaquetados e where e.id = v_emp for share;
  end if;
  if v_salida is not null then
    perform 1 from public.salidas_dinamicas s where s.id = v_salida for share;
  end if;
  perform 1 from public.armado_paquetes p where p.id = v_paquete for no key update;
  select * into v_o from public.p63_oferta where id = v_o.id for update;

  -- Idempotencia: el mismo reintento recibe el MISMO intento (mismo número y mismo snapshot), nunca uno nuevo.
  select * into v_a from public.p63_aceptacion where oferta_id = v_o.id and estado <> 'descartada';
  if found then
    if v_a.estado = 'preparada' then
      return jsonb_build_object('estado', 'preparada', 'aceptacion_id', v_a.id, 'numero_contrato', v_a.numero_contrato,
                                'fecha_negocio', v_a.fecha_negocio, 'snapshot', v_a.snapshot,
                                'financiero', public.p63_financiero_derivado(v_a.id));
    end if;
    return jsonb_build_object('estado', v_a.estado, 'aceptacion_id', v_a.id, 'numero_contrato', v_a.numero_contrato);
  end if;
  if v_o.estado <> 'abierta' then
    raise exception 'p63_oferta_cerrada: la oferta de la cotización % ya fue convertida y no se reabre; genera una cotización nueva', p_cotizacion;
  end if;

  -- Revalidación en ESTE instante (hora de Bogotá).
  v_hoy := public.p63_hoy_bogota();
  select p.activo, p.tipo::text, p.modo_oferta, p.trm_oferta, p.tarifario_snapshot_publicable, p.tarifario_revision_fuente,
         p.tarifario_revision_publicada, p.tarifario_generacion_publicada, p.p63_rev_costos, p.moneda_publicacion
    into v_activo, v_tipo, v_modo, v_trm, v_publica, v_rev_f, v_rev_p, v_gen_p, v_rev_c, v_mp
    from public.armado_paquetes p where p.id = v_paquete;
  if not found or v_activo is not true or v_tipo is distinct from 'dinamico' or v_modo is distinct from 'cop_trm_63' then
    raise exception 'p63_oferta_cambio: el paquete ya no está activo en modo COP con TRM';
  end if;
  if v_trm is distinct from v_o.trm then
    raise exception 'p63_oferta_cambio: la TRM del paquete cambió desde la cotización';
  end if;
  -- 234: la moneda de la oferta es la que se cotizó; si el paquete cambió de moneda de publicación desde entonces, no se acepta.
  if coalesce(v_mp, 'COP') is distinct from coalesce(nullif(v_snap ->> 'moneda', ''), 'COP') then
    raise exception 'p63_oferta_cambio: la moneda de publicación del paquete cambió desde la cotización';
  end if;
  -- 233/234 (#93): una oferta cotizada SIN TRM no se acepta si ahora hay una fuente que convertir (o cambió la moneda) y el paquete sigue sin TRM.
  if v_trm is null and public.p63_requiere_trm(v_paquete) then
    raise exception 'p63_oferta_cambio: ahora hay componentes en USD y el paquete no tiene TRM; genera una cotización nueva';
  end if;
  if v_publica is not true or v_rev_p is distinct from v_o.rev_publicada or v_gen_p is distinct from v_o.gen_publicada then
    raise exception 'p63_oferta_cambio: el tarifario publicado del paquete cambió desde la cotización';
  end if;
  if v_rev_f is distinct from v_o.rev_fuente or v_rev_c is distinct from v_o.rev_costos then
    raise exception 'p63_oferta_cambio: una fuente, un costo, un proveedor o una retención del paquete cambió desde la cotización';
  end if;
  if p_huella is distinct from v_o.huella or p_huella_financiera is distinct from v_o.huella_financiera then
    raise exception 'p63_oferta_cambio: el precio, el vuelo o los costos recalculados ya no coinciden con lo cotizado';
  end if;

  if v_salida is not null then
    select * into v_s from public.salidas_dinamicas where id = v_salida;
    if not found or v_s.paquete_id is distinct from v_paquete or v_s.activo is not true then
      raise exception 'p63_oferta_cambio: la salida ya no existe o fue desactivada';
    end if;
    if v_s.empaquetado_id is distinct from v_emp then
      raise exception 'p63_oferta_cambio: el vínculo de la salida con Empaquetados cambió';
    end if;
    if (v_s.compra_inicio is not null and v_hoy < v_s.compra_inicio) or (v_s.compra_fin is not null and v_hoy > v_s.compra_fin) then
      raise exception 'p63_oferta_cambio: la salida está fuera de su vigencia de compra';
    end if;
    if v_s.fecha_ida is null or v_s.fecha_ida < v_hoy then
      raise exception 'p63_oferta_cambio: la fecha de la salida ya pasó';
    end if;
    if v_emp is not null then
      select * into v_e from public.empaquetados where id = v_emp;
      if not found or v_e.activo is not true then
        raise exception 'p63_oferta_cambio: el vuelo de Empaquetados vinculado ya no existe o fue desactivado';
      end if;
      if nullif(btrim(coalesce(v_e.record, '')), '') is not null then
        raise exception 'p63_oferta_cambio: el vuelo de Empaquetados vinculado ya tiene record (PNR)';
      end if;
      if (v_e.compra_inicio is not null and v_hoy < v_e.compra_inicio) or (v_e.compra_fin is not null and v_hoy > v_e.compra_fin)
         or v_e.fecha_ida is null or v_e.fecha_ida < v_hoy then
        raise exception 'p63_oferta_cambio: el vuelo de Empaquetados vinculado está fuera de vigencia';
      end if;
      -- 230: el vuelo vinculado puede estar en COP o en USD (se convierte × TRM al publicar y al cotizar); sin moneda válida o sin tarifa, no.
      if v_e.moneda is null or v_e.moneda not in ('COP', 'USD') or coalesce(v_e.tarifa_para_empaquetar, 0) <= 0 then
        raise exception 'p63_oferta_cambio: el vuelo de Empaquetados vinculado no tiene una moneda válida (COP o USD) o no tiene tarifa';
      end if;
      if round(coalesce(v_s.valor_tiquete, 0), 2) is distinct from round(v_e.tarifa_para_empaquetar, 2)
         or round(coalesce(v_s.fee_infante, 0), 2) is distinct from round(coalesce(v_e.fee_infante, 0), 2)
         or v_s.moneda is distinct from v_e.moneda
         or v_s.fecha_ida is distinct from v_e.fecha_ida or v_s.fecha_regreso is distinct from v_e.fecha_regreso
         or coalesce(v_s.ruta, '') is distinct from coalesce(v_e.ruta, '')
         or coalesce(v_s.aerolinea, '') is distinct from coalesce(v_e.aerolinea, '') then
        raise exception 'p63_oferta_cambio: la salida ya no coincide con su vuelo de Empaquetados';
      end if;
      -- Destino aéreo permitido (220/#67): misma guarda que al vincular. Re-entra en el candado del paquete que ya tenemos.
      perform public.validar_vinculo_aereo_67(v_paquete, 'empaquetado', v_emp);
    end if;
  end if;

  -- Vigencia de COMPRA de las tarifas de hotel y servicios que respaldan el precio (snapshot.vigencias: la temporada/promoción que ganó cada noche
  -- o cada servicio, con sus límites de compra, tal como se leyeron al cotizar). Con la fecha de negocio de Bogotá de ESTA transacción: una tarifa
  -- cuya compra cerró (o aún no abre) se rechaza aunque ningún UPDATE haya movido una revisión (cruce de medianoche).
  for v_vig in select e from jsonb_array_elements(coalesce(v_snap -> 'vigencias', '[]'::jsonb)) as e loop
    if (nullif(v_vig ->> 'compra_inicio', '') is not null and v_hoy < (v_vig ->> 'compra_inicio')::date)
       or (nullif(v_vig ->> 'compra_fin', '') is not null and v_hoy > (v_vig ->> 'compra_fin')::date) then
      raise exception 'p63_oferta_cambio: la tarifa "%" de % ya no está en su vigencia de compra', v_vig ->> 'ref', v_vig ->> 'origen';
    end if;
  end loop;

  -- 234: una oferta en USD SIN TRM (todas sus fuentes en USD, nada que convertir) tiene obligaciones en USD que la contabilidad (en pesos)
  -- devenga por su equivalente COP. Esa TRM PROVISIONAL la INGRESA expresamente quien convierte la cotización a contrato y queda CONGELADA en la
  -- aceptación (inmutable): las CxP y los asientos en COP salen de ella y no se mueven después. NO hay respaldo automático en
  -- el parámetro de TRM de referencia (aunque exista y sea válido): sin tasa ingresada no se contrata ni se reserva número (nunca 1 ni el
  -- nominal en dólares como pesos). Esto incluye la llamada de 5 argumentos: el 6.º parámetro vale NULL por defecto y entonces se rechaza.
  if v_o.trm is null and coalesce(nullif(v_snap ->> 'moneda', ''), 'COP') = 'USD' then
    if p_trm_provisional is null then
      raise exception 'p63_trm_requerida: la oferta está en USD sin TRM: quien la convierte a contrato debe ingresar la TRM provisional (pesos por dólar) para congelar el equivalente en COP de las obligaciones';
    end if;
    -- Debe ser finita y positiva (y no redondear a 0 con 4 decimales).
    if p_trm_provisional = 'NaN'::numeric or p_trm_provisional <= 0 or p_trm_provisional >= 100000000000 then
      raise exception 'p63_trm_invalida: la TRM provisional debe ser un número positivo y finito (pesos por dólar), recibida: %', p_trm_provisional;
    end if;
    v_trm_prov := round(p_trm_provisional, 4);
    if v_trm_prov <= 0 then
      raise exception 'p63_trm_invalida: la TRM provisional debe ser un número positivo (pesos por dólar), recibida: %', p_trm_provisional;
    end if;
  end if;

  -- Número reservado en la MISMA transacción (mayorista: secuencia dedicada, nunca se reutiliza) y snapshot congelado.
  v_numero := public.siguiente_numero_contrato_para_tenant(p_tenant);
  insert into public.p63_aceptacion (oferta_id, cotizacion_id, tenant, numero_contrato, usuario_id, fecha_negocio, snapshot, trm_provisional)
  values (v_o.id, v_o.cotizacion_id, p_tenant, v_numero, p_usuario, v_hoy, v_o.snapshot, v_trm_prov)
  returning id into v_id;
  update public.p63_oferta set estado = 'aceptada', actualizada_en = now() where id = v_o.id;

  return jsonb_build_object('estado', 'preparada', 'aceptacion_id', v_id, 'numero_contrato', v_numero, 'fecha_negocio', v_hoy,
                            'snapshot', v_o.snapshot, 'financiero', public.p63_financiero_derivado(v_id));
end;
$$;
comment on function public.aceptar_oferta_63(bigint, text, uuid, text, text, numeric) is
  '234 (sobre 233/230/227, #63/#90/#93): acepta de forma atómica una oferta cotizada: toma los candados en orden fijo, revalida AHORA (fecha de Bogotá, compra, activo, TRM, moneda de publicación, revisiones, huellas, moneda COP/USD del vuelo vinculado y de la salida, destino aéreo); en una oferta USD sin TRM exige y congela la TRM provisional ingresada al convertir (sin respaldo en el parámetro de TRM de referencia), reserva el número y congela el snapshot. Reintento = mismo intento. Solo service_role, tras autorizar el servidor.';
revoke all on function public.aceptar_oferta_63(bigint, text, uuid, text, text, numeric) from public, anon, authenticated;
grant execute on function public.aceptar_oferta_63(bigint, text, uuid, text, text, numeric) to service_role;

-- ═══ 8. La RPC financiera acepta la TRM provisional como la TRM de la oferta ═══
create or replace function public.p63_registrar_financiero(
  p_numero_contrato text,
  p_tenant          text,
  p_costos          jsonb,
  p_cxp             jsonb,
  p_aceptacion      bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_a        public.p63_aceptacion;
  v_der      jsonb;
  v_item     jsonb;
  v_ids      jsonb := '[]'::jsonb;
  v_id       bigint;
  v_valor    numeric;
  v_cop      numeric;
  v_trm      numeric;
  v_trm_snap numeric;
  v_moneda   text;
  v_msg      text;
begin
  select * into v_a from public.p63_aceptacion where id = p_aceptacion for update;
  if not found or v_a.numero_contrato is distinct from p_numero_contrato or v_a.tenant is distinct from p_tenant then
    raise exception 'registrar_financiero_contrato: la aceptación #63 del contrato % no existe o no coincide', p_numero_contrato;
  end if;
  if v_a.estado <> 'materializando' then
    raise exception 'registrar_financiero_contrato: la aceptación #63 del contrato % no está vigente (estado %)', p_numero_contrato, v_a.estado;
  end if;

  v_der := public.p63_financiero_derivado(v_a.id);
  if public.p63_payload_alterno(v_a.id, p_costos, p_cxp) then
    raise exception 'p63_payload_alterno: el payload financiero recibido no es el de la oferta aceptada del contrato %', p_numero_contrato;
  end if;
  if not exists (
    select 1 from public.contrato_financiero_pendiente cp
     where cp.numero_contrato = p_numero_contrato and cp.costos = (v_der -> 'costos') and cp.cxp = (v_der -> 'cxp')
  ) then
    raise exception 'p63_sin_pendiente: el contrato % no tiene el payload aceptado guardado como pendiente; no se completa por llamada directa', p_numero_contrato;
  end if;
  v_msg := public.p63_hijos_pendientes(v_a.id);
  if v_msg is not null then
    raise exception 'p63_pendiente: los pasos previos del contrato % no están completos (%)', p_numero_contrato, v_msg;
  end if;

  -- 234: la TRM de la oferta es la del snapshot o, si la oferta se cotizó sin TRM (USD sin conversión), la PROVISIONAL congelada al aceptar.
  v_trm_snap := coalesce((v_a.snapshot ->> 'trm')::numeric, v_a.trm_provisional);
  for v_item in select * from jsonb_array_elements(v_der -> 'cxp') loop
    if coalesce(btrim(v_item ->> 'tipo_proveedor'), '') = '' or coalesce(btrim(v_item ->> 'obligacion'), '') = '' then
      raise exception 'registrar_financiero_contrato: una obligación aceptada no declara tipo_proveedor u obligacion';
    end if;
    begin
      v_valor := (v_item ->> 'valor_total')::numeric;
      v_cop   := (v_item ->> 'valor_cop')::numeric;
      v_trm   := (v_item ->> 'trm')::numeric;
    exception when others then
      raise exception 'registrar_financiero_contrato: importes no numéricos en la obligación "%"', coalesce(v_item ->> 'servicio', '(sin nombre)');
    end;
    v_moneda := coalesce(nullif(v_item ->> 'moneda', ''), 'COP');
    if v_valor is null or v_valor < 0 or v_cop is null or v_cop < 0 or v_trm is distinct from v_trm_snap or v_moneda not in ('COP', 'USD') then
      raise exception 'registrar_financiero_contrato: obligación aceptada inválida (valor %, equivalente COP %, TRM %, moneda %) en "%"',
        v_valor, v_cop, v_trm, v_moneda, coalesce(v_item ->> 'servicio', '(sin nombre)');
    end if;
    -- 233 (#93): una oferta aceptada SIN TRM (todo COP) no admite una obligación en USD: no hay con qué convertirla.
    if v_moneda = 'USD' and v_trm_snap is null then
      raise exception 'registrar_financiero_contrato: la obligación "%" está en USD y la oferta aceptada no tiene TRM', coalesce(v_item ->> 'servicio', '(sin nombre)');
    end if;
    if (v_moneda = 'COP' and v_cop <> v_valor) or (v_moneda = 'USD' and abs(v_cop - round(v_valor * v_trm_snap, 2)) > 0.01) then
      raise exception 'registrar_financiero_contrato: el equivalente en COP de la obligación "%" no corresponde a su valor y a la TRM aceptada', coalesce(v_item ->> 'servicio', '(sin nombre)');
    end if;
  end loop;

  perform set_config('app.p63_h', 'on', true);

  update public.ventas v set
    costo_hotel      = coalesce((v_der -> 'costos' ->> 'costo_hotel')::numeric,      v.costo_hotel),
    costo_aereo      = coalesce((v_der -> 'costos' ->> 'costo_aereo')::numeric,      v.costo_aereo),
    costo_receptivo  = coalesce((v_der -> 'costos' ->> 'costo_receptivo')::numeric,  v.costo_receptivo),
    costo_asistencia = coalesce((v_der -> 'costos' ->> 'costo_asistencia')::numeric, v.costo_asistencia),
    otros_costos     = coalesce((v_der -> 'costos' ->> 'otros_costos')::numeric,     v.otros_costos)
  where v.numero_contrato = p_numero_contrato;

  for v_item in select * from jsonb_array_elements(v_der -> 'cxp') loop
    insert into public.cuentas_por_pagar (
      numero_contrato, tenant, proveedor, tipo_proveedor, servicio, servicio_id,
      valor_total, moneda, fecha_obligacion, fecha_vencimiento,
      aplica_retencion, pct_retencion, observaciones, valor_cop_63, trm_63, aceptacion_63_id, obligacion_63
    ) values (
      p_numero_contrato,
      p_tenant,
      nullif(btrim(coalesce(v_item ->> 'proveedor', '')), ''),
      v_item ->> 'tipo_proveedor',
      nullif(btrim(coalesce(v_item ->> 'servicio', '')), ''),
      nullif(v_item ->> 'servicio_id', '')::bigint,
      (v_item ->> 'valor_total')::numeric,
      coalesce(nullif(v_item ->> 'moneda', ''), 'COP'),
      nullif(v_item ->> 'fecha_obligacion', '')::date,
      nullif(v_item ->> 'fecha_vencimiento', '')::date,
      coalesce((v_item ->> 'aplica_retencion')::boolean, false),
      coalesce((v_item ->> 'pct_retencion')::numeric, 0),
      coalesce(nullif(v_item ->> 'observaciones', ''), public.marca_cxp_automatica()),
      (v_item ->> 'valor_cop')::numeric,
      (v_item ->> 'trm')::numeric,
      v_a.id,
      v_item ->> 'obligacion'
    )
    returning id into v_id;

    v_ids := v_ids || jsonb_build_object(
      'id', v_id,
      'tipo_proveedor', v_item ->> 'tipo_proveedor',
      'proveedor', v_item ->> 'proveedor',
      'servicio', v_item ->> 'servicio',
      'servicio_id', v_item ->> 'servicio_id',
      'valor_total', (v_item ->> 'valor_total')::numeric
    );
  end loop;

  -- 'completo' nace en la MISMA transacción que escribe costos y obligaciones y marca la aceptación como convertida.
  update public.ventas
     set financiero_estado = 'completo', financiero_actualizado_en = now(), financiero_registrado_en = now()
   where numero_contrato = p_numero_contrato;
  update public.p63_aceptacion set estado = 'completa', actualizada_en = now() where id = v_a.id;
  delete from public.contrato_financiero_pendiente where numero_contrato = p_numero_contrato;

  perform set_config('app.p63_h', 'off', true);
  return jsonb_build_object('creadas', v_ids, 'eliminadas', '[]'::jsonb);
end;
$$;
revoke all on function public.p63_registrar_financiero(text, text, jsonb, jsonb, bigint) from public, anon, authenticated;

commit;
