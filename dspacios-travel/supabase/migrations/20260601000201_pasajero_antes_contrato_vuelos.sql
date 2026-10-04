-- Ajuste posterior a 199/200: permite capturar el pasajero antes del contrato
-- manual. Una silla sin contrato conserva la matriz de estados manuales,
-- tenga o no datos; Confirmada sigue exigiendo asignar un contrato.
-- Como eso vuelve normal una silla `disponible` con pasajero precargado, la
-- misma migración hace que la reserva desde tarifario la respete: selección,
-- conteo (`cupos_por_bloqueo`) y copia de datos usan `_silla_libre` (194) y
-- Una silla sin contrato con datos es una RETENCIÓN en plazo (pasajero +
-- fecha de plazo), no vendible, que se libera solo a mano al vencer; ver
-- "Retención en plazo SIN contrato".
-- la copia es todo o nada y va en la misma transacción que la reserva; la
-- edición manual del pasajero se rechaza si la silla cambió de contrato
-- mientras se editaba. Ver la sección "Reserva sobre sillas LIBRES DE VERDAD".
-- Orden acordado: 199 (C), 200 (E), 201 (este ajuste). CRM reserva 202;
-- Tarifas usara 203. No ejecutar esta migracion antes de 199 y 200.
begin;

do $$
declare
  v_estado text;
  v_manual text;
  v_nucleo text;
  v_copia  text;
  v_editar text;
  v_env1   text;
  v_env2   text;
  v_vista  text;
  v_quitar text;
  v_guarda text;
  v_liberar text;
  v_lib2   text;
  v_asig3  text;
  v_nasig  text;
  v_lib1   text;
  v_venc   text;
  v_reg    text;
  v_cerr   text;
  v_nueva  text;
  v_prog   text;
  v_canc   text;
  v_mono   text;
  v_quit3  text;
  v_nquit  text;
  v_edcm   text;
begin
  select md5(replace(prosrc, chr(13), '')) into v_estado
    from pg_proc where oid = to_regprocedure('public.cambiar_estado_silla(bigint,text,text,boolean)');
  select md5(replace(prosrc, chr(13), '')) into v_manual
    from pg_proc where oid = to_regprocedure('public.asignar_contrato_manual(bigint,text)');
  select md5(replace(prosrc, chr(13), '')) into v_nucleo
    from pg_proc where oid = to_regprocedure('public._ajustar_sillas_bloqueo_nucleo(text,bigint,integer)');
  select md5(replace(prosrc, chr(13), '')) into v_copia
    from pg_proc where oid = to_regprocedure('public._copiar_datos_sillas_contrato(text,bigint,jsonb,jsonb)');
  select md5(replace(prosrc, chr(13), '')) into v_editar
    from pg_proc where oid = to_regprocedure('public.editar_pasajero_silla(bigint,jsonb)');
  select md5(replace(prosrc, chr(13), '')) into v_env1
    from pg_proc where oid = to_regprocedure('public.crear_pasajeros_contrato_con_sillas(text,jsonb,integer,uuid,jsonb,jsonb)');
  select md5(replace(prosrc, chr(13), '')) into v_env2
    from pg_proc where oid = to_regprocedure('public.crear_pasajeros_contrato_multi_con_sillas(text,jsonb,jsonb,uuid,jsonb,jsonb)');
  select md5(replace(prosrc, chr(13), '')) into v_quitar
    from pg_proc where oid = to_regprocedure('public.quitar_contrato_manual(bigint)');
  select md5(replace(prosrc, chr(13), '')) into v_guarda
    from pg_proc where oid = to_regprocedure('public._sillas_retencion_sin_contrato()');
  select md5(replace(prosrc, chr(13), '')) into v_liberar
    from pg_proc where oid = to_regprocedure('public.liberar_retencion_vencida(bigint,jsonb)');
  select md5(replace(prosrc, chr(13), '')) into v_lib2
    from pg_proc where oid = to_regprocedure('public.liberar_silla(bigint,jsonb)');
  select md5(replace(prosrc, chr(13), '')) into v_asig3
    from pg_proc where oid = to_regprocedure('public.asignar_contrato_manual(bigint,text,jsonb)');
  select md5(replace(prosrc, chr(13), '')) into v_nasig
    from pg_proc where oid = to_regprocedure('public._asignar_contrato_manual(bigint,text,timestamptz)');
  select md5(replace(prosrc, chr(13), '')) into v_lib1
    from pg_proc where oid = to_regprocedure('public.liberar_silla(bigint)');
  select md5(replace(prosrc, chr(13), '')) into v_venc
    from pg_proc where oid = to_regprocedure('public._retencion_vencida(date,date)');
  select md5(replace(prosrc, chr(13), '')) into v_reg
    from pg_proc where oid = to_regprocedure('public._registrar_firma_antigua(text,bigint)');
  select md5(replace(prosrc, chr(13), '')) into v_cerr
    from pg_proc where oid = to_regprocedure('public._firmas_antiguas_cerradas()');
  select md5(replace(prosrc, chr(13), '')) into v_nueva
    from pg_proc where oid = to_regprocedure('public._registrar_firma_nueva()');
  select md5(replace(prosrc, chr(13), '')) into v_prog
    from pg_proc where oid = to_regprocedure('public.programar_cierre_firmas_antiguas(integer,text)');
  select md5(replace(prosrc, chr(13), '')) into v_canc
    from pg_proc where oid = to_regprocedure('public.cancelar_cierre_firmas_antiguas(text)');
  select md5(replace(prosrc, chr(13), '')) into v_mono
    from pg_proc where oid = to_regprocedure('public._vuelos_cierre_firmas_201_monotono()');
  select md5(replace(prosrc, chr(13), '')) into v_quit3
    from pg_proc where oid = to_regprocedure('public.quitar_contrato_manual(bigint,date,jsonb)');
  select md5(replace(prosrc, chr(13), '')) into v_nquit
    from pg_proc where oid = to_regprocedure('public._quitar_contrato_manual(bigint,date,timestamptz,boolean)');
  select md5(replace(prosrc, chr(13), '')) into v_edcm
    from pg_proc where oid = to_regprocedure('public.editar_contrato_manual(bigint,text,jsonb)');
  select pg_get_viewdef(to_regclass('public.cupos_por_bloqueo')) into v_vista;
  if v_vista is null then
    raise exception 'Falta la vista public.cupos_por_bloqueo; revisar antes de aplicar este ajuste.';
  end if;
  if not (
    -- Antes de la 201: 194 y 196 tal como están en el repositorio.
    (v_estado = 'b40b5d863af4f36d091af677256633fc'
     and v_manual = '958c1478ff125f63ab4f8d7bb7d77119'
     and v_nucleo = '94a91ba144bb9ae67599fe048d98df2e'
     and v_copia is null
     and v_editar = '0f1be81fb173b125e591a08abf035a01'
     and v_env1 is null and v_env2 is null
     and v_quitar = 'b9a78b40e2ac74ae8b0cb6b60fee575c'
     and v_guarda is null and v_liberar is null
     and v_lib2 is null and v_asig3 is null and v_nasig is null
     and v_lib1 = 'fa42eef5d8da2db899a180e97dc6f7dc'
     and v_venc is null and v_reg is null
     and v_cerr is null and v_nueva is null and v_prog is null and v_canc is null and v_mono is null
     and to_regclass('public.vuelos_cierre_firmas_201') is null
     and v_quit3 is null and v_nquit is null and v_edcm is null
     and to_regclass('public.vuelos_firmas_antiguas_uso') is null
     and to_regprocedure('public.copiar_datos_sillas_contrato(text,bigint,jsonb,jsonb)') is null
     and position('_silla_libre' in v_vista) = 0)
    or
    -- La 201 ya aplicada completa (re-ejecución sin cambios).
    (v_estado = '49d46cf31a34b9ed6847da116db2169f'
     and v_manual = '170dfb530a5564469657a843ee0fda8f'
     and v_nucleo = '26e514bbbbb1fda58cb024cb85884ef2'
     and v_copia = '600909e403b5c13ef57b3a977cce6085'
     and v_editar = '0cb298519f7f74c5e0b6a89c61ebe5a5'
     and v_env1 = '3d730d7b7664869219f033cceccebcc7'
     and v_env2 = '3302ab3ce0cacb4afb6abc6f83f0d4fc'
     and v_quitar = '8313f296fdc0fb8244a884833045ba11'
     and v_guarda = '8ee1cb4f0919a6e32f913a8ba228d1ae'
     and v_liberar = '202ac68b3bcb699c2240c04717142b8d'
     and v_lib2 = '67a18542caa8241a25efc6800a69d4e5'
     and v_asig3 = '3646964b7e9e57f3d4b93a458493fa3f'
     and v_nasig = 'fa671c71d8fcdca3423c02491fcfd8a1'
     and v_lib1 = '7dae462501f91621565c1ada8a6071cd'
     and v_venc = '10089eae4706ae7fc40547337053a4f2'
     and v_reg = '85c4f3b8a4bd3e68c16924a44cdefc59'
     and v_cerr = '3583b6362e75790b040f00e5574bfa58' and v_nueva = '3f3214f9833352885b10e2c3841f289b' and v_prog = '4ab77a3af695b646ff2de7f912b169df' and v_canc = '8a19678c855c9a50c121df3f3057dc3e' and v_mono = 'e84b482c74c26450557fb7b92ffe0e94'
     and to_regclass('public.vuelos_cierre_firmas_201') is not null
     and v_quit3 = '286d71d03268e14a8f1a8079f6740a75'
     and v_nquit = '2544f1ed450b4b68e2abf17cdc0e80d4'
     and v_edcm = '3e54b2cee8de26f74efea7b5cc10d44b'
     and to_regclass('public.vuelos_firmas_antiguas_uso') is not null
     and position('_silla_libre' in v_vista) > 0)
  ) then
    raise exception 'Las funciones de vuelos cambiaron desde la 194/196 (o la 201 quedó a medias); revisar antes de aplicar este ajuste.';
  end if;
end $$;

create or replace function public.cambiar_estado_silla(
  p_silla_id bigint, p_estado text, p_motivo text, p_devolucion_real boolean)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp set lock_timeout = '5s' as $$
declare
  v_actor record; v_s public.sillas%rowtype; v_desde text;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  select * into v_actor from public._vuelos_actor();
  if v_motivo is null then raise exception using errcode = '22023', message = 'Escribe el motivo del cambio de estado.'; end if;
  select * into v_s from public.sillas where id = p_silla_id for update;
  if v_s.id is null then raise exception using errcode = 'P0001', message = 'Silla no disponible.'; end if;
  if v_s.numero_contrato is not null or v_s.contrato_manual is not null then
    raise exception using errcode = 'P0001',
      message = 'Esta silla tiene contrato: su estado se cambia con las acciones del contrato (confirmar, liberar...).';
  end if;
  v_desde := case when v_s.estado::text = 'cambio_entrante' then 'disponible' else v_s.estado::text end;
  if v_desde = 'devuelta' then
    raise exception using errcode = 'P0001', message = 'Una silla devuelta es definitiva: no vuelve a otro estado.';
  end if;
  if p_estado is null or p_estado not in ('disponible', 'no_vendida', 'devuelta') then
    raise exception using errcode = 'P0001',
      message = 'Ese cambio de estado no se hace a mano: usa reservar, confirmar venta, liberar silla o retirar cupo.';
  end if;
  if v_desde = p_estado then return jsonb_build_object('ok', true, 'sin_cambios', true); end if;
  if not ((v_desde = 'disponible' and p_estado in ('no_vendida', 'devuelta'))
       or (v_desde = 'no_vendida' and p_estado = 'disponible')
       or (v_desde = 'no_vendida' and p_estado = 'devuelta')) then
    raise exception using errcode = 'P0001', message = format('Cambio no permitido de %s a %s.', v_desde, p_estado);
  end if;
  if v_desde = 'no_vendida' and p_estado = 'devuelta' and not coalesce(p_devolucion_real, false) then
    raise exception using errcode = 'P0001',
      message = 'Pasar de "No vendida" a "Devuelta" solo registra una devolución real a la aerolínea; confírmala.';
  end if;
  update public.sillas set estado = p_estado::public.estado_silla, updated_at = now() where id = p_silla_id;
  insert into public.bloqueo_cambios (bloqueo_id, detalle, nota, registrado_por)
  values (v_s.bloqueo_id, format('Silla %s: %s → %s', v_s.numero_silla, v_s.estado, p_estado), v_motivo, v_actor.actor_nombre);
  return jsonb_build_object('ok', true, 'sin_cambios', false, 'desde', v_s.estado::text, 'hacia', p_estado);
end $$;

-- Firma anterior, SIN versión: se conserva para poder desplegar la migración
-- antes que el código (ver "Acciones con la VERSIÓN de la silla"). El código
-- nuevo usa asignar_contrato_manual(bigint, text, jsonb).
create or replace function public.asignar_contrato_manual(p_silla_id bigint, p_referencia text)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp set lock_timeout = '5s' as $$
begin
  perform public._registrar_firma_antigua('asignar_contrato_manual(bigint,text)', p_silla_id);
  return public._asignar_contrato_manual(p_silla_id, p_referencia, null);
end $$;

-- ═══ Reserva sobre sillas LIBRES DE VERDAD ═════════════════════════════════
-- Con este ajuste una silla puede tener pasajero precargado SIN contrato y
-- seguir `disponible`. Antes, la reserva desde tarifario (núcleo de la 167/196)
-- contaba y tomaba cualquier silla `disponible`/`cambio_entrante` por número:
-- se quedaba con la precargada y la app le pisaba los datos en una copia
-- best-effort que tragaba los errores. Ahora selección, conteo y copia usan
-- la MISMA definición de silla libre, `_silla_libre` (194):
--   · el núcleo cuenta y toma solo sillas libres (bajo el candado del pool);
--   · `cupos_por_bloqueo.cupos_disponibles` cuenta lo mismo (tarifario,
--     pantalla de reserva, chequeo previo de la app y dashboard);
--   · la copia de datos del pasajero (`_copiar_datos_sillas_contrato`) es
--     todo o nada, solo sobre sillas del contrato y vacías, y corre en la
--     MISMA transacción que reserva las sillas (crear_pasajeros_contrato*_con_sillas);
--   · editar_pasajero_silla rechaza la edición si la silla cambió de contrato
--     desde que quien edita la vio (`p_datos.esperado`).
-- La identidad de la silla (id, numero_silla, record) no cambia: el núcleo
-- solo escribe estado/numero_contrato y la copia solo el grupo D.

-- ── Núcleo de sillas (167/196): solo cambian el conteo y la selección ──────
CREATE OR REPLACE FUNCTION public._ajustar_sillas_bloqueo_nucleo(p_numero_contrato text, p_bloqueo_id bigint, p_holders_nuevo integer)
 RETURNS TABLE(holders_total integer, silla_ids bigint[])
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_estado_muestra  public.estado_silla;
  v_holders_actual  integer;
  v_delta           integer;
  v_disponibles     integer;
  v_ids             bigint[];
begin
  if p_numero_contrato is null or length(p_numero_contrato) = 0 or length(p_numero_contrato) > 30 then
    raise exception 'Número de contrato inválido.';
  end if;
  if p_bloqueo_id is null or p_bloqueo_id <= 0 then
    raise exception 'Bloqueo inválido.';
  end if;
  if p_holders_nuevo is null or p_holders_nuevo < 0 or p_holders_nuevo > 100 then
    raise exception 'Cantidad de pasajeros con silla inválida.';
  end if;

  -- Bloquea la fila padre (mismo orden/candado que actualizar_estado_emision_contrato,
  -- migración 157) para serializar con cualquier otra operación sobre ESTE contrato.
  perform 1 from public.ventas where ventas.numero_contrato = p_numero_contrato for update;

  -- Bloquea TODO el pool de sillas de ESTE bloqueo (asignadas al contrato +
  -- libres) — necesario para que dos reservas/ediciones concurrentes del
  -- MISMO bloqueo nunca sub-cuenten la disponibilidad real. A diferencia de
  -- la versión original (migración 167), `p_bloqueo_id` es un parámetro
  -- EXPLÍCITO del llamador — nunca se descubre aquí (ver
  -- `_ajustar_sillas_nucleo` más abajo, que sigue descubriéndolo para el
  -- caso de un solo bloqueo). Esto es lo que permite que un mismo contrato
  -- reconcilie VARIOS bloqueos distintos, uno por llamada, dentro de la
  -- MISMA transacción (revisión de alto riesgo, ronda 3 — B6; ver
  -- `crear_pasajeros_contrato_multi`, parte E) sin necesitar una columna
  -- `bloqueo_ref_id` que solo admite un valor por contrato.
  perform 1 from public.sillas where bloqueo_id = p_bloqueo_id for update;

  -- Todo scoped por `bloqueo_id` ADEMÁS de `numero_contrato` — con un solo
  -- bloqueo por contrato (caso original) es redundante; con varios bloqueos
  -- bajo el mismo contrato (B6) es lo que evita que reconciliar el bloqueo A
  -- cuente o libere sillas que en realidad pertenecen al bloqueo B.
  select count(*) into v_holders_actual
    from public.sillas
   where numero_contrato = p_numero_contrato
     and bloqueo_id = p_bloqueo_id
     and estado in ('en_plazo', 'confirmada');

  v_delta := p_holders_nuevo - v_holders_actual;

  if v_delta > 0 then
    -- 201: cuenta y toma solo sillas LIBRES DE VERDAD (`_silla_libre`, 194):
    -- vendible, sin contrato orgánico ni manual y sin NINGÚN dato del grupo D.
    -- Una silla con pasajero precargado sin contrato ya no es inventario.
    select count(*) into v_disponibles
      from public.sillas s
     where s.bloqueo_id = p_bloqueo_id
       and public._silla_libre(s);

    if v_disponibles < v_delta then
      raise exception 'No hay suficientes sillas disponibles en el bloqueo (% disponibles, % requeridas).', v_disponibles, v_delta;
    end if;

    -- El estado de las sillas NUEVAS hereda el de las que el contrato YA
    -- tenía en ESTE bloqueo (en_plazo o confirmada) — nunca un estado
    -- inventado; si el contrato no tenía ninguna silla previa de este
    -- bloqueo (holders_actual = 0, primera vez que gana pasajeros con
    -- silla aquí), nace en_plazo.
    select estado into v_estado_muestra
      from public.sillas
     where numero_contrato = p_numero_contrato
       and bloqueo_id = p_bloqueo_id
       and estado in ('en_plazo', 'confirmada')
     limit 1;
    v_estado_muestra := coalesce(v_estado_muestra, 'en_plazo');

    update public.sillas
       set estado = v_estado_muestra, numero_contrato = p_numero_contrato
     where id in (
       select s.id from public.sillas s
        where s.bloqueo_id = p_bloqueo_id
          and public._silla_libre(s)
        order by s.numero_silla
        limit v_delta
     );
  elsif v_delta < 0 then
    -- Migración 196 (R1): la silla que se suelta queda sin ningún dato.
    perform public._vaciar_sillas(
      array(select id from public.sillas
             where numero_contrato = p_numero_contrato
               and bloqueo_id = p_bloqueo_id
               and estado in ('en_plazo', 'confirmada')
             order by numero_silla desc
             limit (-v_delta)),
      format('Contrato %s: menos pasajeros', p_numero_contrato));
  end if;

  select array_agg(id order by numero_silla) into v_ids
    from public.sillas
   where numero_contrato = p_numero_contrato
     and bloqueo_id = p_bloqueo_id
     and estado in ('en_plazo', 'confirmada');

  return query select p_holders_nuevo, coalesce(v_ids, array[]::bigint[]);
end;
$function$;


-- ── Disponibilidad: la vista cuenta lo mismo que toma el núcleo ────────────
-- Mismas columnas, tipos y orden; se conserva security_invoker (186).
create or replace view public.cupos_por_bloqueo with (security_invoker = true) as
select b.id,
       b.record,
       b.ruta,
       b.fecha_ida,
       b.cupos_total,
       count(s.id) filter (where public._silla_libre(s)) as cupos_disponibles,
       count(s.id) filter (where s.estado = any (array['confirmada'::public.estado_silla, 'en_plazo'::public.estado_silla])) as cupos_ocupados,
       count(s.id) filter (where s.estado = 'devuelta'::public.estado_silla) as cupos_devueltos
  from public.bloqueos_vuelo b
  left join public.sillas s on s.bloqueo_id = b.id
 group by b.id, b.record, b.ruta, b.fecha_ida, b.cupos_total;

-- La vista es security_invoker y `fn_dashboard_cupos_resumen` (186, INVOKER)
-- la lee como `authenticated`: quien la consulte necesita ejecutar el
-- predicado. Son funciones puras e inmutables sobre una fila que el llamador
-- ya puede leer (la RLS de `sillas` sigue filtrando); no exponen nada.
-- `anon` sigue sin ejecutarlas.
grant execute on function public._silla_libre(public.sillas) to authenticated;
grant execute on function public._silla_con_datos(public.sillas) to authenticated;

-- ── Copia de datos del pasajero a las sillas del contrato: todo o nada ─────
-- Privada: solo la llaman, dentro de su misma transacción, las envolturas
-- crear_pasajeros_contrato[_multi]_con_sillas (más abajo).
-- p_comun: {asesor, hotel, acomodacion, plazo} para todas las sillas.
-- p_pasajeros: un objeto por pasajero con silla, en el orden del contrato
--   {pasajero_nombres, pasajero_apellidos, tipo_doc, numero_doc, nacimiento};
--   la i-ésima silla (por numero_silla) recibe el i-ésimo; las sillas de más
--   (piso de habitaciones sin pasajero nombrado) quedan solo con p_comun.
-- Rechaza, sin escribir nada: claves desconocidas, fechas inválidas, más
-- pasajeros que sillas, y cualquier silla del contrato que ya tenga datos
-- (nunca sobrescribe una precarga ni una copia anterior).
create or replace function public._copiar_datos_sillas_contrato(
  p_numero_contrato text, p_bloqueo_id bigint, p_comun jsonb, p_pasajeros jsonb)
returns integer language plpgsql security definer
set search_path = public, pg_temp set lock_timeout = '5s' as $$
declare
  c_comun    constant text[] := array['asesor', 'hotel', 'acomodacion', 'plazo'];
  c_pasajero constant text[] := array['pasajero_nombres', 'pasajero_apellidos', 'tipo_doc', 'numero_doc', 'nacimiento'];
  v_k text;
  v_e jsonb;
  v_t text;
  v_plazo date;
  v_ids bigint[];
  v_con_datos text;
  v_n integer;
  v_np integer;
  v_escritas integer;
begin
  if p_numero_contrato is null or btrim(p_numero_contrato) = '' then
    raise exception using errcode = '22023', message = 'Número de contrato inválido.';
  end if;
  if p_bloqueo_id is null or p_bloqueo_id <= 0 then
    raise exception using errcode = '22023', message = 'Bloqueo inválido.';
  end if;
  if p_comun is null or jsonb_typeof(p_comun) <> 'object' then
    raise exception using errcode = '22023', message = 'Datos comunes de las sillas inválidos.';
  end if;
  for v_k in select jsonb_object_keys(p_comun) loop
    if not (v_k = any (c_comun)) then
      raise exception using errcode = '22023', message = format('Campo no reconocido en los datos de las sillas: %s.', v_k);
    end if;
  end loop;
  v_t := nullif(btrim(coalesce(p_comun ->> 'plazo', '')), '');
  if v_t is not null then
    if v_t !~ '^\d{4}-\d{2}-\d{2}$' then raise exception using errcode = '22023', message = 'Fecha de plazo inválida.'; end if;
    v_plazo := v_t::date;
  end if;
  if p_pasajeros is null or jsonb_typeof(p_pasajeros) <> 'array' then
    raise exception using errcode = '22023', message = 'Los pasajeros de las sillas deben ser un arreglo.';
  end if;
  for v_e in select value from jsonb_array_elements(p_pasajeros) loop
    if jsonb_typeof(v_e) <> 'object' then
      raise exception using errcode = '22023', message = 'Cada pasajero de silla debe ser un objeto.';
    end if;
    for v_k in select jsonb_object_keys(v_e) loop
      if not (v_k = any (c_pasajero)) then
        raise exception using errcode = '22023', message = format('Campo no reconocido en un pasajero de silla: %s.', v_k);
      end if;
    end loop;
    v_t := nullif(btrim(coalesce(v_e ->> 'nacimiento', '')), '');
    if v_t is not null then
      if v_t !~ '^\d{4}-\d{2}-\d{2}$' then raise exception using errcode = '22023', message = 'Fecha de nacimiento inválida.'; end if;
      perform v_t::date;
    end if;
  end loop;
  v_np := jsonb_array_length(p_pasajeros);

  -- Mismo orden de candados que el núcleo: la venta y luego el pool del record.
  perform 1 from public.ventas v where v.numero_contrato = p_numero_contrato for update;
  if not found then
    raise exception using errcode = 'P0001', message = format('El contrato %s no existe.', p_numero_contrato);
  end if;
  perform 1 from public.sillas where bloqueo_id = p_bloqueo_id for update;

  select array_agg(s.id order by s.numero_silla),
         string_agg(s.numero_silla::text, ', ' order by s.numero_silla) filter (where public._silla_con_datos(s))
    into v_ids, v_con_datos
    from public.sillas s
   where s.numero_contrato = p_numero_contrato
     and s.bloqueo_id = p_bloqueo_id
     and s.estado in ('en_plazo', 'confirmada');
  v_n := coalesce(array_length(v_ids, 1), 0);

  if v_np > v_n then
    raise exception using errcode = 'P0001',
      message = format('El contrato %s tiene %s pasajero(s) con silla y solo %s silla(s) en este vuelo; no se copió nada.', p_numero_contrato, v_np, v_n);
  end if;
  if v_con_datos is not null then
    raise exception using errcode = 'P0001',
      message = format('La(s) silla(s) %s del contrato %s ya tienen datos de pasajero; no se sobrescriben.', v_con_datos, p_numero_contrato);
  end if;
  if v_n = 0 then return 0; end if;

  update public.sillas s set
    asesor             = nullif(btrim(coalesce(p_comun ->> 'asesor', '')), ''),
    hotel              = nullif(btrim(coalesce(p_comun ->> 'hotel', '')), ''),
    acomodacion        = nullif(btrim(coalesce(p_comun ->> 'acomodacion', '')), ''),
    plazo              = v_plazo,
    pasajero_nombres   = nullif(btrim(coalesce(x.p ->> 'pasajero_nombres', '')), ''),
    pasajero_apellidos = nullif(btrim(coalesce(x.p ->> 'pasajero_apellidos', '')), ''),
    tipo_doc           = nullif(btrim(coalesce(x.p ->> 'tipo_doc', '')), ''),
    numero_doc         = nullif(btrim(coalesce(x.p ->> 'numero_doc', '')), ''),
    nacimiento         = nullif(btrim(coalesce(x.p ->> 'nacimiento', '')), '')::date,
    updated_at         = now()
    from (select u.id, p_pasajeros -> (u.ord::integer - 1) as p
            from unnest(v_ids) with ordinality as u(id, ord)) x
   where s.id = x.id;
  get diagnostics v_escritas = row_count;
  if v_escritas <> v_n then
    raise exception using errcode = 'P0001', message = 'Las sillas del contrato cambiaron durante la copia; no se guardó nada.';
  end if;
  return v_escritas;
end $$;

comment on function public._copiar_datos_sillas_contrato(text, bigint, jsonb, jsonb) is
  '201: copia (todo o nada) los datos del pasajero a las sillas en_plazo/confirmada de un contrato en un record. '
  'Nunca sobrescribe una silla con datos. Privada: la usan las envolturas *_con_sillas.';

revoke all on function public._copiar_datos_sillas_contrato(text, bigint, jsonb, jsonb) from public, anon, authenticated, service_role;

-- ── Reserva y copia en UNA transacción ─────────────────────────────────────
-- La app ya no copia en una llamada aparte: entre la reserva de sillas y la
-- copia no queda ningún momento en que la silla sea del contrato y esté
-- vacía, así que ninguna edición puede colarse ahí y ninguna copia puede
-- fallar por ella. Si la copia falla, se revierte TODO (pasajeros, vínculos,
-- sillas y copia). Envuelven las RPC de la 167 sin cambiarlas.
--
-- p_datos_pasajeros: un objeto por pasajero del payload, en el MISMO orden
-- ({pasajero_nombres, pasajero_apellidos, tipo_doc, numero_doc, nacimiento}).
-- Ocupan silla los que la base decide (no infantes, según la misma regla con
-- que reservó las sillas), en ese orden, sobre las sillas por numero_silla.

create or replace function public.crear_pasajeros_contrato_con_sillas(
  p_numero_contrato text, p_pasajeros jsonb, p_holders_min integer, p_usuario_id uuid,
  p_comun jsonb, p_datos_pasajeros jsonb)
returns table(id bigint, nombre text, tipo_id text, identificacion text, fecha_nacimiento date,
              es_infante boolean, responsable_id bigint, orden integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_filas public._fila_pasajero_167[] := '{}';
  v_reg record;
  v_bloqueo_id bigint;
  v_holders jsonb := '[]'::jsonb;
  f public._fila_pasajero_167;
begin
  if p_datos_pasajeros is null or jsonb_typeof(p_datos_pasajeros) <> 'array' then
    raise exception using errcode = '22023', message = 'Los datos de pasajero para las sillas deben ser un arreglo.';
  end if;
  for v_reg in
    select * from public.crear_pasajeros_contrato(p_numero_contrato, p_pasajeros, p_holders_min, p_usuario_id)
  loop
    v_filas := array_append(v_filas,
      row(v_reg.id, v_reg.nombre, v_reg.tipo_id, v_reg.identificacion, v_reg.fecha_nacimiento,
          v_reg.es_infante, v_reg.responsable_id, v_reg.orden)::public._fila_pasajero_167);
  end loop;
  if jsonb_array_length(p_datos_pasajeros) <> coalesce(array_length(v_filas, 1), 0) then
    raise exception using errcode = '22023',
      message = 'Los datos de pasajero para las sillas no corresponden a los pasajeros del contrato.';
  end if;

  -- El mismo record que acaba de usar el núcleo (ventas.bloqueo_ref_id). Sin
  -- record no hay sillas: nada que copiar.
  select v.bloqueo_ref_id into v_bloqueo_id from public.ventas v where v.numero_contrato = p_numero_contrato;
  if v_bloqueo_id is not null then
    foreach f in array v_filas loop
      if not f.es_infante then
        v_holders := v_holders || jsonb_build_array(p_datos_pasajeros -> f.orden);
      end if;
    end loop;
    perform public._copiar_datos_sillas_contrato(p_numero_contrato, v_bloqueo_id, p_comun, v_holders);
  end if;

  return query select (x).id, (x).nombre, (x).tipo_id, (x).identificacion, (x).fecha_nacimiento,
                      (x).es_infante, (x).responsable_id, (x).orden
                 from unnest(v_filas) as x;
end $$;

-- Varios records: p_comun_por_bloqueo = [{bloqueoId, comun}]; quién ocupa
-- silla en cada record se decide con la fecha de salida de ESE record (B19),
-- igual que crear_pasajeros_contrato_multi al reservarlas. p_reservas_sillas
-- trae las posiciones (1-based) por record; un record sin entrada en
-- p_comun_por_bloqueo se copia con datos comunes vacíos.
create or replace function public.crear_pasajeros_contrato_multi_con_sillas(
  p_numero_contrato text, p_pasajeros jsonb, p_reservas_sillas jsonb, p_usuario_id uuid,
  p_comun_por_bloqueo jsonb, p_datos_pasajeros jsonb)
returns table(id bigint, nombre text, tipo_id text, identificacion text, fecha_nacimiento date,
              es_infante boolean, responsable_id bigint, orden integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_filas public._fila_pasajero_167[] := '{}';
  v_reg record;
  v_elem jsonb;
  v_bloqueo_id bigint;
  v_fecha date;
  v_contrato_fecha date;
  v_pos integer;
  v_comun jsonb;
  v_holders jsonb;
begin
  if p_datos_pasajeros is null or jsonb_typeof(p_datos_pasajeros) <> 'array' then
    raise exception using errcode = '22023', message = 'Los datos de pasajero para las sillas deben ser un arreglo.';
  end if;
  if p_comun_por_bloqueo is null or jsonb_typeof(p_comun_por_bloqueo) <> 'array' then
    raise exception using errcode = '22023', message = 'Los datos comunes por record deben ser un arreglo.';
  end if;
  -- Valida y reserva (pasajeros, vínculos y sillas de todos los records).
  for v_reg in
    select * from public.crear_pasajeros_contrato_multi(p_numero_contrato, p_pasajeros, p_reservas_sillas, p_usuario_id)
  loop
    v_filas := array_append(v_filas,
      row(v_reg.id, v_reg.nombre, v_reg.tipo_id, v_reg.identificacion, v_reg.fecha_nacimiento,
          v_reg.es_infante, v_reg.responsable_id, v_reg.orden)::public._fila_pasajero_167);
  end loop;
  if jsonb_array_length(p_datos_pasajeros) <> coalesce(array_length(v_filas, 1), 0) then
    raise exception using errcode = '22023',
      message = 'Los datos de pasajero para las sillas no corresponden a los pasajeros del contrato.';
  end if;
  select v.fecha_salida into v_contrato_fecha from public.ventas v where v.numero_contrato = p_numero_contrato;

  -- p_reservas_sillas ya pasó la validación de la 167 (forma, rangos, sin
  -- records repetidos). Se copia en orden ascendente de record, el mismo
  -- orden de candados de la 167.
  for v_elem in
    select t.value from jsonb_array_elements(p_reservas_sillas) t
     order by (t.value ->> 'bloqueoId')::bigint
  loop
    v_bloqueo_id := (v_elem ->> 'bloqueoId')::bigint;
    select bv.fecha_ida into v_fecha from public.bloqueos_vuelo bv where bv.id = v_bloqueo_id;
    v_fecha := coalesce(v_fecha, v_contrato_fecha, current_date);
    v_holders := '[]'::jsonb;
    for v_pos in select (p.value)::text::integer from jsonb_array_elements(v_elem -> 'posiciones') p loop
      if not public.es_infante_por_edad((v_filas[v_pos]).fecha_nacimiento, v_fecha) then
        v_holders := v_holders || jsonb_build_array(p_datos_pasajeros -> (v_pos - 1));
      end if;
    end loop;
    select c.value -> 'comun' into v_comun
      from jsonb_array_elements(p_comun_por_bloqueo) c
     where (c.value ->> 'bloqueoId')::bigint = v_bloqueo_id
     limit 1;
    perform public._copiar_datos_sillas_contrato(p_numero_contrato, v_bloqueo_id, coalesce(v_comun, '{}'::jsonb), v_holders);
  end loop;

  return query select (x).id, (x).nombre, (x).tipo_id, (x).identificacion, (x).fecha_nacimiento,
                      (x).es_infante, (x).responsable_id, (x).orden
                 from unnest(v_filas) as x;
end $$;

comment on function public.crear_pasajeros_contrato_con_sillas(text, jsonb, integer, uuid, jsonb, jsonb) is
  '201: crear_pasajeros_contrato + copia de los datos del pasajero a sus sillas, en una sola transacción. Solo service_role.';
comment on function public.crear_pasajeros_contrato_multi_con_sillas(text, jsonb, jsonb, uuid, jsonb, jsonb) is
  '201: crear_pasajeros_contrato_multi + copia por record, en una sola transacción. Solo service_role.';

revoke all on function public.crear_pasajeros_contrato_con_sillas(text, jsonb, integer, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.crear_pasajeros_contrato_multi_con_sillas(text, jsonb, jsonb, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.crear_pasajeros_contrato_con_sillas(text, jsonb, integer, uuid, jsonb, jsonb) to service_role;
grant execute on function public.crear_pasajeros_contrato_multi_con_sillas(text, jsonb, jsonb, uuid, jsonb, jsonb) to service_role;

-- ── Edición del pasajero con el estado que vio quien edita (194 + chequeo) ──
-- Carrera que cierra: la pantalla muestra la silla LIBRE; mientras el usuario
-- edita, una reserva la toma. Sin este chequeo, la edición esperaba el
-- candado de la reserva y se escribía sobre una silla que ya era del
-- contrato; si después la reserva se revertía, el dato se borraba con ella.
-- Ahora quien edita manda en `p_datos.esperado` el contrato que vio
-- ({"numero_contrato": …, "contrato_manual": …}, null = sin contrato). Tras
-- tomar el candado se compara con el de la silla: si cambió, no se guarda
-- nada y se responde con un mensaje claro. Sin `esperado` se comporta como en
-- la 194 (compatibilidad con llamadores anteriores); la app siempre lo manda.
-- El resto del cuerpo es el de la 194, sin cambios.
create or replace function public.editar_pasajero_silla(p_silla_id bigint, p_datos jsonb)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp set lock_timeout = '5s' as $$
declare
  v_actor record; v_s public.sillas%rowtype; v_nac date; v_plazo date;
  t_nac text := nullif(btrim(coalesce(p_datos ->> 'nacimiento', '')), '');
  t_plazo text := nullif(btrim(coalesce(p_datos ->> 'plazo', '')), '');
  v_esperado jsonb;
  v_ident boolean;
begin
  select * into v_actor from public._vuelos_actor();
  if p_datos is null or jsonb_typeof(p_datos) <> 'object' then
    raise exception using errcode = '22023', message = 'Datos del pasajero inválidos.';
  end if;
  if p_datos ? 'esperado' then
    v_esperado := p_datos -> 'esperado';
    if jsonb_typeof(v_esperado) <> 'object'
       or not (v_esperado ?& array['numero_contrato', 'contrato_manual'])
       or jsonb_typeof(v_esperado -> 'numero_contrato') not in ('string', 'null')
       or jsonb_typeof(v_esperado -> 'contrato_manual') not in ('string', 'null') then
      raise exception using errcode = '22023', message = 'Estado esperado de la silla inválido.';
    end if;
  end if;
  if v_esperado is null or not (v_esperado ? 'updated_at') then
    perform public._registrar_firma_antigua('editar_pasajero_silla sin esperado.updated_at', p_silla_id);
  else
    perform public._registrar_firma_nueva();
  end if;
  if t_nac is not null then
    if t_nac !~ '^\d{4}-\d{2}-\d{2}$' then raise exception using errcode = '22023', message = 'Fecha de nacimiento inválida.'; end if;
    v_nac := t_nac::date;
  end if;
  if t_plazo is not null then
    if t_plazo !~ '^\d{4}-\d{2}-\d{2}$' then raise exception using errcode = '22023', message = 'Fecha de plazo inválida.'; end if;
    v_plazo := t_plazo::date;
  end if;
  select * into v_s from public.sillas where id = p_silla_id for update;
  if v_s.id is null then raise exception using errcode = 'P0001', message = 'Silla no disponible.'; end if;
  if v_esperado is not null
     and (v_s.numero_contrato is distinct from (v_esperado ->> 'numero_contrato')
          or v_s.contrato_manual is distinct from (v_esperado ->> 'contrato_manual')) then
    raise exception using errcode = 'P0001', message = format(
      'La silla cambió mientras la editabas: ahora %s. No se guardó nada; recarga la página.',
      case when v_s.numero_contrato is not null then format('es del contrato %s', v_s.numero_contrato)
           when v_s.contrato_manual is not null then format('tiene el contrato manual %s', v_s.contrato_manual)
           else 'no tiene contrato' end);
  end if;
  -- Versión vista (opcional en `esperado`; el código nuevo siempre la manda).
  if v_esperado is not null and v_esperado ? 'updated_at'
     and v_s.updated_at is distinct from public._version_silla_esperada(v_esperado) then
    raise exception using errcode = 'P0001', message = format(
      'La silla %s cambió desde que la viste (otro usuario la editó, asignó o liberó). Recarga la página; no se guardó nada.', v_s.numero_silla);
  end if;
  if v_s.estado::text in ('cambio', 'retirada') then
    raise exception using errcode = 'P0001', message = 'Esta silla es historial; no se edita.';
  end if;
  perform public._autorizar_contrato_silla(v_s.numero_contrato, v_s.contrato_manual, v_actor.actor_rol, true);
  -- Sin contrato, la silla queda vacía o RETENIDA: pasajero y fecha de plazo
  -- (vigente al fijarla). El estado lo deriva la guarda de la retención.
  if v_s.numero_contrato is null and v_s.contrato_manual is null
     and v_s.estado::text in ('disponible', 'cambio_entrante', 'en_plazo') then
    v_ident := nullif(btrim(coalesce(p_datos ->> 'pasajero_nombres', '')), '') is not null
            or nullif(btrim(coalesce(p_datos ->> 'pasajero_apellidos', '')), '') is not null;
    if v_ident or v_plazo is not null or v_nac is not null
       or nullif(btrim(coalesce(p_datos ->> 'tipo_doc', '')), '') is not null
       or nullif(btrim(coalesce(p_datos ->> 'numero_doc', '')), '') is not null
       or nullif(btrim(coalesce(p_datos ->> 'asesor', '')), '') is not null
       or nullif(btrim(coalesce(p_datos ->> 'hotel', '')), '') is not null
       or nullif(btrim(coalesce(p_datos ->> 'acomodacion', '')), '') is not null then
      if not v_ident or v_plazo is null then
        raise exception using errcode = '22023',
          message = 'Para retener una silla sin contrato indica el pasajero (nombre o apellido) y la fecha de plazo. No se guardó nada.';
      end if;
      if v_plazo is distinct from v_s.plazo and v_plazo < public.fecha_negocio(now()) then
        raise exception using errcode = '22023', message = format(
          'La fecha de plazo %s ya pasó (hoy es %s en Bogotá). No se guardó nada.', v_plazo, public.fecha_negocio(now()));
      end if;
    end if;
  end if;
  update public.sillas set
    pasajero_nombres   = nullif(btrim(coalesce(p_datos ->> 'pasajero_nombres', '')), ''),
    pasajero_apellidos = nullif(btrim(coalesce(p_datos ->> 'pasajero_apellidos', '')), ''),
    tipo_doc           = nullif(btrim(coalesce(p_datos ->> 'tipo_doc', '')), ''),
    numero_doc         = nullif(btrim(coalesce(p_datos ->> 'numero_doc', '')), ''),
    nacimiento         = v_nac,
    asesor             = nullif(btrim(coalesce(p_datos ->> 'asesor', '')), ''),
    hotel              = nullif(btrim(coalesce(p_datos ->> 'hotel', '')), ''),
    acomodacion        = nullif(btrim(coalesce(p_datos ->> 'acomodacion', '')), ''),
    plazo              = v_plazo,
    -- Sin contrato: retenida (pasajero + plazo) o, si quedó vacía, disponible.
    estado             = case
                           when v_s.numero_contrato is not null or v_s.contrato_manual is not null
                                or v_s.estado::text not in ('disponible', 'cambio_entrante', 'en_plazo') then v_s.estado
                           when v_ident and v_plazo is not null then 'en_plazo'::public.estado_silla
                           when v_s.estado::text = 'en_plazo' then 'disponible'::public.estado_silla
                           else v_s.estado
                         end,
    updated_at         = now()
  where id = p_silla_id;
  return jsonb_build_object('ok', true);
end $$;

-- ═══ Retención en plazo SIN contrato (decisión del dueño) ══════════════════
-- Una silla sin contrato (ni orgánico ni manual) con datos de pasajero es una
-- RETENCIÓN: exige pasajero (nombre o apellido) y fecha de plazo, y queda en
-- estado `en_plazo`. No es vendible (`_silla_libre` la excluye: no cuenta en
-- `cupos_por_bloqueo` ni la toma una reserva), no crea ni cancela ninguna
-- venta y NO la toca `liberar_vencidas` ni el cron (solo atienden contratos
-- pendientes). Vence cuando plazo < fecha de negocio de Bogotá (el propio día
-- del plazo aún no vence) y se libera SOLO a mano (`liberar_retencion_vencida`).
-- Una silla sin contrato vendible queda, entonces, o vacía (`disponible`) o
-- retenida (`en_plazo`): nunca "aparentemente disponible" con datos.

-- Guarda de la regla para los roles de la API (authenticated/anon/
-- service_role): carga masiva y escritura directa del grupo D que la 199
-- permite sin contrato. Las funciones de vuelos (SECURITY DEFINER, corren
-- como el dueño) aplican la misma regla de forma explícita; igual que en la
-- 199, el dueño queda exento (mantenimiento revisado y datos históricos).
-- Corre DESPUÉS de sillas_guarda_escritura (orden alfabético de los BEFORE):
-- la 199 sigue impidiendo que la API cambie `estado`; aquí se deriva.
-- Para TODOS los escritores mueve `updated_at` en todo cambio real: es la
-- versión que la liberación manual compara con la que vio la pantalla.
create or replace function public._sillas_retencion_sin_contrato()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  -- clock_timestamp(): distinto en cada escritura, también dentro de una misma transacción.
  if (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
    new.updated_at := clock_timestamp();
  end if;
  if current_user not in ('authenticated', 'anon', 'service_role') then
    return new;
  end if;
  if new.numero_contrato is not null or new.contrato_manual is not null
     or new.estado::text not in ('disponible', 'cambio_entrante', 'en_plazo') then
    return new;
  end if;
  if not public._silla_con_datos(new) then
    if new.estado::text = 'en_plazo' then new.estado := 'disponible'; end if;
    return new;
  end if;
  if (coalesce(btrim(new.pasajero_nombres), '') <> '' or coalesce(btrim(new.pasajero_apellidos), '') <> '')
     and new.plazo is not null then
    new.estado := 'en_plazo';
    return new;
  end if;
  raise exception using errcode = '23514',
    message = 'RETENCION_INCOMPLETA: una silla sin contrato solo puede tener datos como retención en plazo: indica el pasajero y la fecha de plazo.';
end $$;

comment on function public._sillas_retencion_sin_contrato() is
  '201: una silla sin contrato vendible queda vacía (disponible) o retenida (en_plazo, con pasajero y plazo); '
  'rechaza cualquier otro estado con datos (23514 RETENCION_INCOMPLETA). Mueve updated_at en todo cambio real.';

drop trigger if exists sillas_retencion_sin_contrato on public.sillas;
create trigger sillas_retencion_sin_contrato
  before update on public.sillas
  for each row execute function public._sillas_retencion_sin_contrato();

revoke all on function public._sillas_retencion_sin_contrato() from public, anon, authenticated, service_role;

-- Quitar un contrato manual. Si el pasajero se queda, la silla queda
-- RETENIDA en plazo, y el plazo se pide EN LA MISMA ACCIÓN (hoy o futuro en
-- Bogotá): nunca una silla "disponible" con nombre, ni una retención que
-- nazca vencida. Sin pasajero, queda disponible. Las sillas de historial o
-- no vendibles (devuelta, no vendida, retirada, cambio) conservan su estado:
-- la retención no entra en esos estados. Núcleo único; la firma vieja
-- (sin versión ni plazo) usa el plazo guardado y se cierra con las demás cuando se activa el cierre.
create or replace function public._quitar_contrato_manual(
  p_silla_id bigint, p_plazo date, p_version timestamptz, p_legado boolean)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp set lock_timeout = '5s' as $$
declare
  v_actor record; v_s public.sillas%rowtype;
  v_hoy date := public.fecha_negocio(now());
  v_activa boolean; v_datos boolean; v_pasajero boolean; v_plazo date;
  v_estado public.estado_silla;
begin
  select * into v_actor from public._vuelos_actor();
  select * into v_s from public.sillas where id = p_silla_id for update;
  if v_s.id is null then raise exception using errcode = 'P0001', message = 'Silla no disponible.'; end if;
  if p_version is not null and v_s.updated_at is distinct from p_version then
    raise exception using errcode = 'P0001', message = format(
      'La silla %s cambió desde que la viste (otro usuario la editó, asignó o liberó). Recarga la página; no se quitó nada.', v_s.numero_silla);
  end if;
  if v_s.contrato_manual is null then raise exception using errcode = 'P0001', message = 'Esta silla no tiene contrato manual.'; end if;
  perform public._autorizar_contrato_silla(null, v_s.contrato_manual, v_actor.actor_rol, true);

  v_activa   := v_s.estado::text not in ('devuelta', 'no_vendida', 'retirada', 'cambio');
  v_datos    := public._silla_con_datos(v_s);
  v_pasajero := coalesce(btrim(v_s.pasajero_nombres), '') <> '' or coalesce(btrim(v_s.pasajero_apellidos), '') <> '';
  v_plazo    := case when p_legado then v_s.plazo else p_plazo end;
  if v_activa and v_datos then
    if not v_pasajero then
      raise exception using errcode = '22023', message =
        'La silla tiene datos sin el nombre del pasajero: complétalo (Editar) o bórralos (Borrar) antes de quitar el contrato manual. No se cambió nada.';
    end if;
    if v_plazo is null then
      raise exception using errcode = '22023', message = case when p_legado
        then 'La silla conserva al pasajero y no tiene fecha de plazo: quita el contrato desde Vuelos, que la pide en la misma acción. No se cambió nada.'
        else 'Indica la fecha de plazo: el pasajero se queda en la silla, retenido en plazo y sin contrato. No se cambió nada.' end;
    end if;
    if v_plazo < v_hoy then
      raise exception using errcode = '22023', message = format(
        'La fecha de plazo %s ya pasó (hoy es %s en Bogotá); indica hoy o una fecha futura. No se cambió nada.', v_plazo, v_hoy);
    end if;
  end if;

  v_estado := case when not v_activa then v_s.estado
                   when v_datos then 'en_plazo'::public.estado_silla
                   else 'disponible'::public.estado_silla end;
  update public.sillas set
    contrato_manual = null,
    plazo = case when v_activa and v_datos then v_plazo else plazo end,
    estado = v_estado,
    updated_at = now()
  where id = p_silla_id;
  insert into public.bloqueo_cambios (bloqueo_id, detalle, nota, registrado_por)
  values (v_s.bloqueo_id,
          format('Silla %s: contrato manual %s quitado → %s', v_s.numero_silla, v_s.contrato_manual,
                 case when v_estado::text = 'en_plazo' then format('retenida en plazo hasta %s', v_plazo)
                      else v_estado::text end),
          'Quitar contrato manual.', v_actor.actor_nombre);
  return jsonb_build_object('ok', true, 'estado', v_estado,
                            'plazo', case when v_estado::text = 'en_plazo' then v_plazo end);
end $$;

create or replace function public.quitar_contrato_manual(p_silla_id bigint, p_plazo date, p_esperado jsonb)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp set lock_timeout = '5s' as $$
begin
  perform public._registrar_firma_nueva();
  return public._quitar_contrato_manual(p_silla_id, p_plazo, public._version_silla_esperada(p_esperado), false);
end $$;

-- Firma ANTERIOR (sin versión ni plazo): compatibilidad de despliegue; usa el
-- plazo guardado (y lo exige vigente); se cierra con las demás firmas viejas.
create or replace function public.quitar_contrato_manual(p_silla_id bigint)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp set lock_timeout = '5s' as $$
begin
  perform public._registrar_firma_antigua('quitar_contrato_manual(bigint)', p_silla_id);
  return public._quitar_contrato_manual(p_silla_id, null, null, true);
end $$;

-- Editar la referencia de un contrato MANUAL: la reemplaza directamente en
-- una sola operación (sin quitarla primero), conservando pasajero, plazo y
-- estado. Valida la referencia nueva y los permisos igual que al asignarla
-- (`_autorizar_contrato_silla`), exige permiso sobre la referencia actual,
-- comprueba bajo el candado la versión que vio la pantalla y deja la línea
-- "anterior → nueva" en bloqueo_cambios (y la fila completa en `auditoria`).
-- Un contrato generado por la aplicación (numero_contrato) no se edita aquí.
create or replace function public.editar_contrato_manual(p_silla_id bigint, p_referencia text, p_esperado jsonb)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp set lock_timeout = '5s' as $$
declare v_actor record; v_s public.sillas%rowtype; v_ref text; v_version timestamptz; r record;
begin
  select * into v_actor from public._vuelos_actor();
  perform public._registrar_firma_nueva();
  v_version := public._version_silla_esperada(p_esperado);
  v_ref := public._ref_manual_normalizada(p_referencia);
  if v_ref is null or v_ref = '' then raise exception using errcode = '22023', message = 'Escribe el número de contrato manual.'; end if;
  select * into r from public._autorizar_contrato_silla(null, v_ref, v_actor.actor_rol, false);
  select * into v_s from public.sillas where id = p_silla_id for update;
  if v_s.id is null then raise exception using errcode = 'P0001', message = 'Silla no disponible.'; end if;
  if v_s.updated_at is distinct from v_version then
    raise exception using errcode = 'P0001', message = format(
      'La silla %s cambió desde que la viste (otro usuario la editó, asignó o liberó). Recarga la página; no se cambió nada.', v_s.numero_silla);
  end if;
  if v_s.numero_contrato is not null then
    raise exception using errcode = 'P0001', message = format(
      'La silla %s es del contrato %s, generado por la aplicación: se gestiona desde el contrato, no aquí.', v_s.numero_silla, v_s.numero_contrato);
  end if;
  if v_s.contrato_manual is null then
    raise exception using errcode = 'P0001', message = 'Esta silla no tiene contrato manual que editar.';
  end if;
  perform public._autorizar_contrato_silla(null, v_s.contrato_manual, v_actor.actor_rol, true);
  if v_s.contrato_manual = v_ref then
    return jsonb_build_object('ok', true, 'sin_cambios', true, 'referencia', v_ref);
  end if;
  update public.sillas set contrato_manual = v_ref, updated_at = now() where id = p_silla_id;
  insert into public.bloqueo_cambios (bloqueo_id, detalle, nota, registrado_por)
  values (v_s.bloqueo_id,
          format('Silla %s: contrato manual %s → %s', v_s.numero_silla, v_s.contrato_manual, v_ref),
          'Editar contrato manual (se conservan pasajero, plazo y estado).', v_actor.actor_nombre);
  return jsonb_build_object('ok', true, 'anterior', v_s.contrato_manual, 'referencia', v_ref,
                            'clase', r.clase, 'contrato_resuelto', r.numero_resuelto);
end $$;

revoke all on function public._quitar_contrato_manual(bigint, date, timestamptz, boolean) from public, anon, authenticated, service_role;
revoke all on function public.quitar_contrato_manual(bigint, date, jsonb) from public, anon;
grant execute on function public.quitar_contrato_manual(bigint, date, jsonb) to authenticated;
revoke all on function public.editar_contrato_manual(bigint, text, jsonb) from public, anon;
grant execute on function public.editar_contrato_manual(bigint, text, jsonb) to authenticated;

-- Liberación MANUAL de una retención vencida. Vuelve a comprobar bajo el
-- candado de la silla que siga sin contrato, en plazo, vencida (plazo <
-- fecha de negocio de Bogotá) y en la MISMA versión que mostró la pantalla
-- (`p_esperado.updated_at`); si algo cambió, no borra nada y lo dice. Deja la
-- silla disponible y sin datos personales; conserva id, record y numero_silla.
-- Auditoría: una línea en bloqueo_cambios (quién, qué silla, qué plazo) y la
-- imagen completa anterior en `auditoria` (trigger 087).
create or replace function public.liberar_retencion_vencida(p_silla_id bigint, p_esperado jsonb)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp set lock_timeout = '5s' as $$
declare
  v_actor record; v_s public.sillas%rowtype; v_version timestamptz;
  v_hoy date := public.fecha_negocio(now());
begin
  select * into v_actor from public._vuelos_actor();
  perform public._registrar_firma_nueva();
  if p_esperado is null or jsonb_typeof(p_esperado) <> 'object' or coalesce(jsonb_typeof(p_esperado -> 'updated_at'), '') <> 'string' then
    raise exception using errcode = '22023', message = 'Falta la versión de la silla que se mostró; recarga la página.';
  end if;
  begin
    v_version := (p_esperado ->> 'updated_at')::timestamptz;
  exception when others then
    raise exception using errcode = '22023', message = 'Versión de la silla inválida; recarga la página.';
  end;
  select * into v_s from public.sillas where id = p_silla_id for update;
  if v_s.id is null then raise exception using errcode = 'P0001', message = 'Silla no disponible.'; end if;
  if v_s.numero_contrato is not null or v_s.contrato_manual is not null then
    raise exception using errcode = 'P0001', message = format(
      'La silla %s ya tiene contrato (%s): no es una retención. No se liberó nada.',
      v_s.numero_silla, coalesce(v_s.numero_contrato, v_s.contrato_manual));
  end if;
  if v_s.estado::text <> 'en_plazo' then
    raise exception using errcode = 'P0001', message = format(
      'La silla %s ya no está retenida en plazo (ahora: %s). No se liberó nada.', v_s.numero_silla, v_s.estado);
  end if;
  if not public._retencion_vencida(v_s.plazo, v_hoy) then
    raise exception using errcode = 'P0001', message = format(
      'La retención de la silla %s aún no vence (plazo %s; hoy es %s en Bogotá). No se liberó nada.',
      v_s.numero_silla, coalesce(v_s.plazo::text, 'sin fecha'), v_hoy);
  end if;
  if v_s.updated_at is distinct from v_version then
    raise exception using errcode = 'P0001', message = format(
      'La silla %s cambió desde que la viste (otro usuario la editó). Recarga la página; no se liberó nada.', v_s.numero_silla);
  end if;
  insert into public.bloqueo_cambios (bloqueo_id, detalle, nota, registrado_por)
  values (v_s.bloqueo_id,
          format('Silla %s: retención vencida (plazo %s) liberada → disponible', v_s.numero_silla, v_s.plazo),
          'Liberación manual de una retención sin contrato; los datos anteriores quedan en la auditoría.',
          v_actor.actor_nombre);
  update public.sillas set
    estado = 'disponible',
    pasajero_nombres = null, pasajero_apellidos = null, tipo_doc = null, numero_doc = null, nacimiento = null,
    inf_nombres = null, inf_apellidos = null, inf_tipo_doc = null, inf_numero = null, inf_nacimiento = null,
    responsable_menor = null, agencia = null, asesor = null, hotel = null, acomodacion = null, plazo = null
  where id = p_silla_id;
  return jsonb_build_object('ok', true, 'numero_silla', v_s.numero_silla, 'plazo', v_s.plazo);
end $$;

comment on function public.liberar_retencion_vencida(bigint, jsonb) is
  '201: libera a mano una retención en plazo SIN contrato y vencida (plazo < fecha de negocio de Bogotá), '
  'solo si la silla sigue igual a la versión mostrada. Nunca toca ventas.';

revoke all on function public.liberar_retencion_vencida(bigint, jsonb) from public, anon;
grant execute on function public.liberar_retencion_vencida(bigint, jsonb) to authenticated;
revoke all on function public.quitar_contrato_manual(bigint) from public, anon;
grant execute on function public.quitar_contrato_manual(bigint) to authenticated;

-- ═══ Acciones con la VERSIÓN de la silla que vio el operador ══════════════
-- `sillas.updated_at` cambia en toda escritura real (lo mueve la guarda de la
-- retención, para cualquier escritor), así que es la versión de la silla. Las
-- acciones de la pantalla la mandan en `p_esperado.updated_at`; bajo el
-- candado de la silla se compara y, si la silla cambió, se rechaza sin borrar
-- ni asignar nada.
-- Compatibilidad para desplegar la migración ANTES que el código: las firmas
-- anteriores siguen existiendo y SIN esta comprobación —
--   · liberar_silla(bigint)                     (194, sin cambios)
--   · asignar_contrato_manual(bigint, text)     (sin versión)
--   · editar_pasajero_silla(bigint, jsonb) sin `esperado.updated_at`
-- El código nuevo usa siempre las versiones con `p_esperado`. Retirar las
-- firmas viejas queda para una migración posterior al despliegue del código.

-- Versión esperada obligatoria (`p_esperado.updated_at`, timestamptz).
create or replace function public._version_silla_esperada(p_esperado jsonb)
returns timestamptz language plpgsql immutable set search_path = public, pg_temp as $$
begin
  if p_esperado is null or jsonb_typeof(p_esperado) <> 'object'
     or coalesce(jsonb_typeof(p_esperado -> 'updated_at'), '') <> 'string' then
    raise exception using errcode = '22023', message = 'Falta la versión de la silla que se mostró; recarga la página.';
  end if;
  begin
    return (p_esperado ->> 'updated_at')::timestamptz;
  exception when others then
    raise exception using errcode = '22023', message = 'Versión de la silla inválida; recarga la página.';
  end;
end $$;

-- Liberar (Borrar pasajero) con la versión vista: 194 + comprobación.
create or replace function public.liberar_silla(p_silla_id bigint, p_esperado jsonb)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp set lock_timeout = '5s' as $$
declare v_actor record; v_s public.sillas%rowtype; v_version timestamptz;
begin
  select * into v_actor from public._vuelos_actor();
  perform public._registrar_firma_nueva();
  v_version := public._version_silla_esperada(p_esperado);
  select * into v_s from public.sillas where id = p_silla_id for update;
  if v_s.id is null then raise exception using errcode = 'P0001', message = 'Silla no disponible.'; end if;
  if v_s.updated_at is distinct from v_version then
    raise exception using errcode = 'P0001', message = format(
      'La silla %s cambió desde que la viste (otro usuario la editó, asignó o liberó). Recarga la página; no se borró nada.', v_s.numero_silla);
  end if;
  if v_s.estado::text in ('cambio', 'retirada', 'devuelta', 'no_vendida') then
    raise exception using errcode = 'P0001', message = format('Esta silla no se puede liberar (estado %s).', v_s.estado);
  end if;
  perform public._autorizar_contrato_silla(v_s.numero_contrato, v_s.contrato_manual, v_actor.actor_rol, true);
  update public.sillas set
    estado = 'disponible', numero_contrato = null, contrato_manual = null,
    pasajero_nombres = null, pasajero_apellidos = null, tipo_doc = null, numero_doc = null, nacimiento = null,
    asesor = null, agencia = null, hotel = null, acomodacion = null, plazo = null,
    inf_nombres = null, inf_apellidos = null, inf_tipo_doc = null, inf_numero = null, inf_nacimiento = null,
    responsable_menor = null, updated_at = now()
  where id = p_silla_id;
  return jsonb_build_object('ok', true);
end $$;

-- Asignar contrato manual: un solo núcleo; la versión es opcional SOLO para la
-- firma vieja (compatibilidad), obligatoria en la nueva.
create or replace function public._asignar_contrato_manual(p_silla_id bigint, p_referencia text, p_version timestamptz)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp set lock_timeout = '5s' as $$
declare v_actor record; v_s public.sillas%rowtype; v_ref text; r record;
begin
  select * into v_actor from public._vuelos_actor();
  v_ref := public._ref_manual_normalizada(p_referencia);
  if v_ref is null or v_ref = '' then raise exception using errcode = '22023', message = 'Escribe el número de contrato manual.'; end if;
  select * into r from public._autorizar_contrato_silla(null, v_ref, v_actor.actor_rol, false);
  select * into v_s from public.sillas where id = p_silla_id for update;
  if v_s.id is null then raise exception using errcode = 'P0001', message = 'Silla no disponible.'; end if;
  if p_version is not null and v_s.updated_at is distinct from p_version then
    raise exception using errcode = 'P0001', message = format(
      'La silla %s cambió desde que la viste (otro usuario la editó, asignó o liberó). Recarga la página; no se asignó nada.', v_s.numero_silla);
  end if;
  if v_s.numero_contrato is not null or v_s.contrato_manual is not null
     or coalesce(v_s.estado::text, '') not in ('disponible', 'cambio_entrante', 'en_plazo') then
    raise exception using errcode = 'P0001', message = 'Solo se asigna un contrato manual a un cupo disponible o retenido en plazo, sin contrato.';
  end if;
  -- Una retención vencida no recibe contrato hasta actualizar su plazo (decisión del dueño).
  if v_s.estado::text = 'en_plazo' and public._retencion_vencida(v_s.plazo, public.fecha_negocio(now())) then
    raise exception using errcode = 'P0001', message = format(
      'La retención de la silla %s venció (plazo %s; hoy es %s en Bogotá). Actualiza el plazo a hoy o a una fecha futura antes de asignarle contrato. No se asignó nada.',
      v_s.numero_silla, v_s.plazo, public.fecha_negocio(now()));
  end if;
  update public.sillas set contrato_manual = v_ref, estado = 'confirmada', updated_at = now() where id = p_silla_id;
  return jsonb_build_object('ok', true, 'clase', r.clase, 'contrato_resuelto', r.numero_resuelto, 'referencia', v_ref);
end $$;

create or replace function public.asignar_contrato_manual(p_silla_id bigint, p_referencia text, p_esperado jsonb)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp set lock_timeout = '5s' as $$
begin
  perform public._registrar_firma_nueva();
  return public._asignar_contrato_manual(p_silla_id, p_referencia, public._version_silla_esperada(p_esperado));
end $$;

revoke all on function public._version_silla_esperada(jsonb) from public, anon, authenticated, service_role;
revoke all on function public._asignar_contrato_manual(bigint, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.liberar_silla(bigint, jsonb) from public, anon;
grant execute on function public.liberar_silla(bigint, jsonb) to authenticated;
revoke all on function public.asignar_contrato_manual(bigint, text, jsonb) from public, anon;
grant execute on function public.asignar_contrato_manual(bigint, text, jsonb) to authenticated;

-- ═══ Vencimiento de una retención: UNA sola definición ═══════════════════
-- Vencida = plazo ANTERIOR al día de negocio de Bogotá (el propio día del
-- plazo aún no vence). La usan la liberación manual y la asignación de
-- contrato: una retención vencida no recibe contrato hasta que se actualice
-- su plazo a hoy o a una fecha futura (decisión del dueño); se libera solo a mano.
create or replace function public._retencion_vencida(p_plazo date, p_hoy date)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select p_plazo is not null and p_hoy is not null and p_plazo < p_hoy
$$;
revoke all on function public._retencion_vencida(date, date) from public, anon, authenticated, service_role;

-- ═══ Firmas ANTERIORES: uso y CIERRE (decisión del dueño) ═════════════════
-- Las firmas sin versión (liberar_silla(bigint), asignar_contrato_manual(bigint,
-- text), quitar_contrato_manual(bigint) y la edición sin esperado.updated_at)
-- se conservan para aplicar esta migración ANTES que el código. Reglas:
--   1. NUNCA se bloquea el código viejo antes de confirmar el despliegue nuevo:
--      el cierre nace ABIERTO y sin fecha; si el despliegue se retrasa (días o
--      meses), el código viejo sigue funcionando.
--   2. El cierre se ACTIVA después del despliegue (programar_cierre_firmas_antiguas).
--      La base exige haber registrado alguna llamada con versión, pero eso es
--      solo una condición NECESARIA: la base es la misma para Producción y para
--      los Previews de Vercel, así que esa llamada puede venir de un Preview y
--      NO prueba que Producción tenga el código nuevo. La verificación real es
--      humana, en Vercel (commit, estado Ready, dominio de Production y Previews
--      antiguos resueltos); la exige supabase/scripts/activar_cierre_firmas_201.sql.
--      Deja una ventana (7 días por defecto, mínimo 3) y, al cumplirse, las
--      firmas viejas se rechazan SOLAS, sin otra migración ni otro script.
--   3. Mientras la ventana no termina, se puede CANCELAR (rollback de código).
--      Una vez cerradas, NUNCA se reabren: un trigger impide reabrir, reprogramar
--      o borrar el estado, re-aplicar esta migración no lo toca, y el rollback
--      de la 201 se niega.
-- Cada llamada vieja admitida queda registrada (evidencia para decidir).
create table if not exists public.vuelos_firmas_antiguas_uso (
  id bigserial primary key,
  firma text not null,
  silla_id bigint,
  actor_id uuid,
  actor_rol text,
  usado_en timestamptz not null default now()
);
comment on table public.vuelos_firmas_antiguas_uso is
  '201: llamadas admitidas a las firmas sin versión de Vuelos (liberar_silla(bigint), asignar_contrato_manual(bigint,text), '
  'quitar_contrato_manual(bigint), editar_pasajero_silla sin esperado.updated_at). Solo la escriben funciones del dueño.';
alter table public.vuelos_firmas_antiguas_uso enable row level security;
revoke all on table public.vuelos_firmas_antiguas_uso from public, anon, authenticated, service_role;
revoke all on sequence public.vuelos_firmas_antiguas_uso_id_seq from public, anon, authenticated, service_role;

-- Estado del cierre: UNA fila, que solo avanza abierto → programado → cerrado.
create table if not exists public.vuelos_cierre_firmas_201 (
  id smallint primary key default 1 check (id = 1),
  estado text not null default 'abierto' check (estado in ('abierto', 'programado', 'cerrado')),
  primer_uso_firma_nueva timestamptz,
  programado_en timestamptz,
  cierra_en timestamptz,
  cerrado_en timestamptz,
  nota text,
  actualizado_en timestamptz not null default now(),
  check ((estado = 'abierto') = (cierra_en is null))
);
comment on table public.vuelos_cierre_firmas_201 is
  '201: cierre de las firmas sin versión de Vuelos. Nace abierto (el código viejo nunca se bloquea antes del despliegue '
  'nuevo); se programa tras verificar el código nuevo; al cumplirse cierra_en queda cerrado para siempre.';
alter table public.vuelos_cierre_firmas_201 enable row level security;
revoke all on table public.vuelos_cierre_firmas_201 from public, anon, authenticated, service_role;
insert into public.vuelos_cierre_firmas_201 (id) values (1) on conflict (id) do nothing;

-- Cerradas = cerrado, o programado con la ventana cumplida. Sin fila: abiertas
-- (nunca se cierra por omisión; la fila no se puede borrar).
create or replace function public._firmas_antiguas_cerradas()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select c.estado = 'cerrado' or (c.estado = 'programado' and now() >= c.cierra_en)
                     from public.vuelos_cierre_firmas_201 c where c.id = 1), false)
$$;
revoke all on function public._firmas_antiguas_cerradas() from public, anon, authenticated, service_role;

-- El estado solo avanza. Corre para TODOS (también el dueño): nadie reabre por error.
create or replace function public._vuelos_cierre_firmas_201_monotono()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare v_cerrado boolean;
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception using errcode = 'P0001', message = 'El estado del cierre de firmas antiguas no se borra.';
  end if;
  if old.primer_uso_firma_nueva is not null and new.primer_uso_firma_nueva is distinct from old.primer_uso_firma_nueva then
    raise exception using errcode = 'P0001', message = 'El primer uso de una firma con versión no se modifica.';
  end if;
  v_cerrado := old.estado = 'cerrado' or (old.estado = 'programado' and now() >= old.cierra_en);
  if v_cerrado then
    if new.estado <> 'cerrado' or new.cierra_en is distinct from old.cierra_en
       or new.programado_en is distinct from old.programado_en then
      raise exception using errcode = 'P0001', message =
        'Las firmas antiguas ya cerraron: no se reabren ni se reprograman. El código anterior a la 201 ya no se puede volver a desplegar; corregir hacia adelante.';
    end if;
    new.cerrado_en := coalesce(old.cerrado_en, new.cerrado_en, old.cierra_en);
  elsif new.estado = 'cerrado' then
    raise exception using errcode = 'P0001', message =
      'El cierre no se hace de golpe: se programa (tras verificar en Vercel el despliegue de Producción) y cierra al terminar la ventana.';
  elsif new.estado = 'programado' then
    if new.primer_uso_firma_nueva is null then
      raise exception using errcode = 'P0001', message =
        'Todavía no hay ninguna llamada con versión registrada (condición necesaria; no prueba por sí sola el despliegue en Producción). No se programó el cierre.';
    end if;
    if new.cierra_en is null or new.cierra_en < now() + interval '3 days' then
      raise exception using errcode = 'P0001', message = 'La ventana de observación es de al menos 3 días. No se programó el cierre.';
    end if;
  elsif new.estado = 'abierto' then
    new.cierra_en := null;
    new.programado_en := null;
  end if;
  new.actualizado_en := now();
  return new;
end $$;
revoke all on function public._vuelos_cierre_firmas_201_monotono() from public, anon, authenticated, service_role;
drop trigger if exists vuelos_cierre_firmas_201_monotono on public.vuelos_cierre_firmas_201;
create trigger vuelos_cierre_firmas_201_monotono
  before update or delete on public.vuelos_cierre_firmas_201
  for each row execute function public._vuelos_cierre_firmas_201_monotono();
drop trigger if exists vuelos_cierre_firmas_201_sin_truncate on public.vuelos_cierre_firmas_201;
create trigger vuelos_cierre_firmas_201_sin_truncate
  before truncate on public.vuelos_cierre_firmas_201
  for each statement execute function public._vuelos_cierre_firmas_201_monotono();

-- Primer uso de una firma con versión (Producción o un Preview: la base es la
-- misma; NO prueba Producción por sí solo): la primera llamada fija la fecha una
-- sola vez (cuando ya está fijada, el UPDATE no encuentra fila ni toma candado).
create or replace function public._registrar_firma_nueva()
returns void language sql security definer set search_path = public, pg_temp as $$
  update public.vuelos_cierre_firmas_201 set primer_uso_firma_nueva = now()
   where id = 1 and primer_uso_firma_nueva is null
$$;
revoke all on function public._registrar_firma_nueva() from public, anon, authenticated, service_role;

-- Uso de una firma vieja: rechazada si ya cerraron; si no, se registra (en la
-- misma transacción: solo constan las que terminan bien, las únicas que cambian datos).
create or replace function public._registrar_firma_antigua(p_firma text, p_silla_id bigint)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if public._firmas_antiguas_cerradas() then
    raise exception using errcode = 'P0001', message =
      'Esta acción viene de una versión anterior de la aplicación que ya no se admite. Recarga la página (Ctrl+F5) y vuelve a intentarlo. No se cambió nada.';
  end if;
  insert into public.vuelos_firmas_antiguas_uso (firma, silla_id, actor_id, actor_rol)
  values (p_firma, p_silla_id, auth.uid(), public.mi_rol()::text);
end $$;
revoke all on function public._registrar_firma_antigua(text, bigint) from public, anon, authenticated, service_role;

-- Activación (SOLO el dueño, desde el editor SQL, tras confirmar el despliegue).
create or replace function public.programar_cierre_firmas_antiguas(p_dias integer default 7, p_nota text default null)
returns timestamptz language plpgsql security definer set search_path = public, pg_temp as $$
declare v_c public.vuelos_cierre_firmas_201%rowtype;
begin
  select * into v_c from public.vuelos_cierre_firmas_201 where id = 1 for update;
  if v_c.id is null then raise exception using errcode = 'P0001', message = 'Falta el estado del cierre (migración 201).'; end if;
  if p_dias is null or p_dias < 3 then
    raise exception using errcode = '22023', message = 'La ventana de observación es de al menos 3 días.';
  end if;
  update public.vuelos_cierre_firmas_201
     set estado = 'programado', programado_en = coalesce(v_c.programado_en, now()),
         cierra_en = now() + make_interval(days => p_dias), nota = coalesce(p_nota, v_c.nota)
   where id = 1;
  return now() + make_interval(days => p_dias);
end $$;

-- Rollback de la activación: SOLO mientras la ventana no ha terminado.
create or replace function public.cancelar_cierre_firmas_antiguas(p_motivo text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_c public.vuelos_cierre_firmas_201%rowtype;
begin
  if nullif(btrim(coalesce(p_motivo, '')), '') is null then
    raise exception using errcode = '22023', message = 'Escribe el motivo de la cancelación.';
  end if;
  select * into v_c from public.vuelos_cierre_firmas_201 where id = 1 for update;
  if v_c.estado = 'abierto' then
    raise exception using errcode = 'P0001', message = 'El cierre no estaba programado; no hay nada que cancelar.';
  end if;
  update public.vuelos_cierre_firmas_201 set estado = 'abierto', nota = p_motivo where id = 1;
end $$;
revoke all on function public.programar_cierre_firmas_antiguas(integer, text) from public, anon, authenticated, service_role;
revoke all on function public.cancelar_cierre_firmas_antiguas(text) from public, anon, authenticated, service_role;

-- liberar_silla(bigint): el cuerpo de la 194 sin cambios de lógica, más el registro de uso.
create or replace function public.liberar_silla(p_silla_id bigint)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp set lock_timeout = '5s' as $$
declare v_actor record; v_s public.sillas%rowtype;
begin
  select * into v_actor from public._vuelos_actor();
  perform public._registrar_firma_antigua('liberar_silla(bigint)', p_silla_id);
  select * into v_s from public.sillas where id = p_silla_id for update;
  if v_s.id is null then raise exception using errcode = 'P0001', message = 'Silla no disponible.'; end if;
  if v_s.estado::text in ('cambio', 'retirada', 'devuelta', 'no_vendida') then
    raise exception using errcode = 'P0001', message = format('Esta silla no se puede liberar (estado %s).', v_s.estado);
  end if;
  perform public._autorizar_contrato_silla(v_s.numero_contrato, v_s.contrato_manual, v_actor.actor_rol, true);
  update public.sillas set
    estado = 'disponible', numero_contrato = null, contrato_manual = null,
    pasajero_nombres = null, pasajero_apellidos = null, tipo_doc = null, numero_doc = null, nacimiento = null,
    asesor = null, agencia = null, hotel = null, acomodacion = null, plazo = null,
    inf_nombres = null, inf_apellidos = null, inf_tipo_doc = null, inf_numero = null, inf_nacimiento = null,
    responsable_menor = null, updated_at = now()
  where id = p_silla_id;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.liberar_silla(bigint) from public, anon;
grant execute on function public.liberar_silla(bigint) to authenticated;

revoke all on function public.cambiar_estado_silla(bigint, text, text, boolean) from public, anon;
revoke all on function public.asignar_contrato_manual(bigint, text) from public, anon;
grant execute on function public.cambiar_estado_silla(bigint, text, text, boolean) to authenticated;
grant execute on function public.asignar_contrato_manual(bigint, text) to authenticated;
revoke all on function public.editar_pasajero_silla(bigint, jsonb) from public, anon;
grant execute on function public.editar_pasajero_silla(bigint, jsonb) to authenticated;

commit;
