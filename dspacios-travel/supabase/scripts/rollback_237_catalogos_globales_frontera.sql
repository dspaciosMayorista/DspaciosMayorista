-- Rollback de la migración 237 (frontera D8/D9). NO borra datos de catálogos.
-- 1) quita las policies restrictivas, 2) restaura las 4 funciones definer a su
-- definición previa (la de la 235), 3) elimina el contexto por sesión.
-- Efecto: vuelve a regir solo la matriz de roles/tenant home de antes.
begin;
set local lock_timeout = '5s';
do $$
declare t text;
begin
  foreach t in array public.catalogos_globales_registro() loop
    execute format('drop policy if exists %I on public.%I', 'catalogo global: insertar solo Mayorista', t);
    execute format('drop policy if exists %I on public.%I', 'catalogo global: actualizar solo Mayorista', t);
    execute format('drop policy if exists %I on public.%I', 'catalogo global: borrar solo Mayorista', t);
  end loop;
end;
$$;
CREATE OR REPLACE FUNCTION public.fn_fusionar_destino(p_origen bigint, p_destino bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  fk record;
begin
  if public.mi_rol() not in ('superadmin', 'gerencia', 'administracion', 'operaciones') then
    raise exception 'No autorizado para fusionar destinos.';
  end if;
  if p_origen = p_destino then
    raise exception 'El origen y el destino no pueden ser el mismo.';
  end if;
  if not exists (select 1 from public.destinos where id = p_destino) then
    raise exception 'El destino de llegada no existe.';
  end if;
  if not exists (select 1 from public.destinos where id = p_origen) then
    return; -- ya no existe, nada que fusionar
  end if;

  -- Re-apunta cada columna con FK a destinos(id), del origen al destino.
  for fk in
    select c.conrelid::regclass::text as tbl, a.attname as col
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.contype = 'f' and c.confrelid = 'public.destinos'::regclass
  loop
    execute format('update %s set %I = $1 where %I = $2', fk.tbl, fk.col, fk.col)
      using p_destino, p_origen;
  end loop;

  delete from public.destinos where id = p_origen;
end;
$function$

;

CREATE OR REPLACE FUNCTION public.generar_tarifas_hotel_calculadora(p_hotel_id bigint, p_filas jsonb, p_previas jsonb, p_reemplazar_todo boolean DEFAULT false, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_hoy         date := public.fecha_negocio();   -- regla común (migración 198)
  v_protegidas  text[];
  v_promos_pct  text[];
  v_tipo_calc   text;
  v_claves      text[];
  v_fila        jsonb;
  v_hotel_fila  bigint;
  v_choque      text;
  v_borradas    integer;
  v_insertadas  integer := 0;
  v_motivo      text := coalesce(nullif(btrim(coalesce(p_motivo, '')), ''),
                                 case when p_reemplazar_todo then 'calculadora_reemplazar_todo' else 'calculadora_generar' end);
  v_recargar    constant text := 'Recarga la página y vuelve a revisar la vista previa antes de generar.';
begin
  -- Mismo candado que la 179 (coalesce: un rol NULL nunca pasa).
  if coalesce(public.mi_rol()::text, '') not in ('superadmin', 'gerencia', 'administracion', 'operaciones') then
    raise exception 'generar_tarifas_hotel_calculadora: rol sin permiso de escritura sobre tarifa_hotel';
  end if;
  if p_hotel_id is null then
    raise exception 'generar_tarifas_hotel_calculadora: hotel_id requerido';
  end if;
  if v_motivo not in ('calculadora_generar', 'calculadora_reemplazar_todo', 'calculadora_sustituir_manual') then
    raise exception 'generar_tarifas_hotel_calculadora: motivo no permitido: %', v_motivo;
  end if;
  -- El motivo es una etiqueta: debe coincidir con lo que la llamada hace.
  if p_reemplazar_todo and v_motivo <> 'calculadora_reemplazar_todo' then
    raise exception 'generar_tarifas_hotel_calculadora: reemplazar todo solo admite el motivo calculadora_reemplazar_todo';
  end if;
  if not p_reemplazar_todo and v_motivo = 'calculadora_reemplazar_todo' then
    raise exception 'generar_tarifas_hotel_calculadora: el motivo calculadora_reemplazar_todo exige p_reemplazar_todo';
  end if;
  if p_previas is null or jsonb_typeof(p_previas) <> 'array' then
    raise exception 'generar_tarifas_hotel_calculadora: falta la foto de las tarifas cargadas (p_previas). %', v_recargar;
  end if;
  if not exists (select 1 from public.hoteles where id = p_hotel_id) then
    raise exception 'generar_tarifas_hotel_calculadora: el hotel % no existe', p_hotel_id;
  end if;
  if p_filas is null or jsonb_typeof(p_filas) <> 'array' then
    raise exception 'generar_tarifas_hotel_calculadora: p_filas debe ser un arreglo jsonb';
  end if;
  if jsonb_array_length(p_filas) = 0 then
    raise exception 'generar_tarifas_hotel_calculadora: p_filas no puede ser un arreglo vacío';
  end if;

  -- Validación COMPLETA del lote antes de borrar nada.
  for v_fila in select * from jsonb_array_elements(p_filas) loop
    if jsonb_typeof(v_fila) <> 'object' then
      raise exception 'generar_tarifas_hotel_calculadora: cada elemento de p_filas debe ser un objeto jsonb';
    end if;
    if v_fila ? 'hotel_id' and v_fila->>'hotel_id' is not null then
      begin
        v_hotel_fila := (v_fila->>'hotel_id')::bigint;
      exception when others then
        raise exception 'generar_tarifas_hotel_calculadora: hotel_id de una fila no es numérico: %', v_fila->>'hotel_id';
      end;
      if v_hotel_fila <> p_hotel_id then
        raise exception 'generar_tarifas_hotel_calculadora: una fila declara hotel_id % distinto al solicitado (%)', v_hotel_fila, p_hotel_id;
      end if;
    end if;
    if coalesce(btrim(v_fila->>'tipo_habitacion'), '') = ''
       or coalesce(btrim(v_fila->>'alimentacion'), '') = ''
       or coalesce(btrim(v_fila->>'temporada'), '') = '' then
      raise exception 'generar_tarifas_hotel_calculadora: cada fila necesita categoría, régimen y temporada';
    end if;
  end loop;

  select k into v_choque
  from (
    select btrim(f->>'tipo_habitacion') || ' / ' || btrim(f->>'alimentacion') || ' / ' || btrim(f->>'temporada') as k
    from jsonb_array_elements(p_filas) f
  ) x
  group by k having count(*) > 1
  limit 1;
  if v_choque is not null then
    raise exception 'generar_tarifas_hotel_calculadora: la combinación % viene repetida en el lote', v_choque;
  end if;

  -- ── Bloqueos: TODO lo que sigue (comprobar y escribir) ocurre con el hotel
  -- bloqueado, en esta misma transacción. Orden fijo hotel → vigencias →
  -- tarifas. `FOR UPDATE` sobre `hoteles` choca con el `FOR KEY SHARE` que toma
  -- cualquier INSERT concurrente en `tarifa_hotel` de este hotel (FK), así que
  -- una fila nueva escrita a mano espera o hace esperar; `FOR UPDATE` sobre las
  -- tarifas cubre ediciones y borrados concurrentes de filas existentes. En
  -- READ COMMITTED cada sentencia siguiente ve lo que la otra sesión confirmó.
  perform 1 from public.hoteles where id = p_hotel_id for update;
  perform 1 from public.hotel_temporadas where hotel_id = p_hotel_id for share;
  perform 1 from public.tarifa_hotel where hotel_id = p_hotel_id for update;

  -- Vigencias con compra cerrada = histórico: no se reescriben ni se recrean.
  select coalesce(array_agg(nombre), '{}') into v_protegidas
  from (
    select btrim(nombre) as nombre
    from public.hotel_temporadas
    where hotel_id = p_hotel_id and nombre is not null
    group by btrim(nombre)
    having bool_and(compra_fin is not null and compra_fin < v_hoy)
  ) p;

  select btrim(f->>'temporada') into v_choque
  from jsonb_array_elements(p_filas) f
  where btrim(f->>'temporada') = any(v_protegidas)
  limit 1;
  if v_choque is not null then
    raise exception 'generar_tarifas_hotel_calculadora: la vigencia "%" tiene la compra cerrada; sus tarifas se conservan y no se regeneran', v_choque;
  end if;

  -- ── Concurrencia: lo que hay HOY (bajo bloqueo) debe ser lo que se vio en la
  -- vista previa. Reemplazar todo: todo el hotel. Agregar/sustituir: las
  -- claves del lote (una clave que no existía debe seguir sin existir).
  select array_agg(distinct public._tarifa_clave(f)) into v_claves from jsonb_array_elements(p_filas) f;
  if p_reemplazar_todo then
    if public._tarifa_huella((select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.tarifa_hotel t where t.hotel_id = p_hotel_id))
       <> public._tarifa_huella(p_previas) then
      raise exception 'generar_tarifas_hotel_calculadora: las tarifas del hotel cambiaron después de cargar la vista previa; no se escribió nada. %', v_recargar;
    end if;
  else
    if public._tarifa_huella((select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.tarifa_hotel t
                              where t.hotel_id = p_hotel_id and public._tarifa_clave(to_jsonb(t)) = any(v_claves)))
       <> public._tarifa_huella((select coalesce(jsonb_agg(f), '[]'::jsonb) from jsonb_array_elements(p_previas) f
                                 where public._tarifa_clave(f) = any(v_claves))) then
      raise exception 'generar_tarifas_hotel_calculadora: alguna de las tarifas que se iban a escribir cambió después de cargar la vista previa; no se escribió nada. %', v_recargar;
    end if;
  end if;

  -- ── Promos escritas a mano (Mixta + vigencia descuento_pct + sin precio
  -- final): misma definición que la calculadora (`analizarMixta`). Nunca las
  -- borra "generar" ni "reemplazar todo"; "sustituir" solo con sus condiciones.
  select tipo into v_tipo_calc from public.hotel_calculadora where hotel_id = p_hotel_id;
  select coalesce(array_agg(distinct btrim(nombre)), '{}') into v_promos_pct
  from public.hotel_temporadas where hotel_id = p_hotel_id and tipo = 'descuento_pct' and nombre is not null;

  if v_motivo = 'calculadora_sustituir_manual' then
    v_fila := p_filas -> 0;
    if jsonb_array_length(p_filas) <> 1 then
      raise exception 'generar_tarifas_hotel_calculadora: sustituir reemplaza UNA sola fila por llamada';
    end if;
    if coalesce(v_tipo_calc, '') <> 'mixta' or not (btrim(v_fila->>'temporada') = any(v_promos_pct)) then
      raise exception 'generar_tarifas_hotel_calculadora: sustituir solo aplica a una promoción %% de un hotel con calculadora Mixta';
    end if;
    if not coalesce((v_fila->>'precio_final_autoritativo')::boolean, false)
       or not exists (select 1 from public.hotel_temporadas t
                      where t.hotel_id = p_hotel_id and btrim(t.nombre) = btrim(coalesce(v_fila->>'temporada_base', ''))
                        and coalesce(t.tipo, 'tarifa') = 'tarifa') then
      raise exception 'generar_tarifas_hotel_calculadora: sustituir exige una fila marcada como precio final y con temporada_base en una vigencia ''tarifa'' del hotel';
    end if;
    if not exists (select 1 from public.tarifa_hotel t where t.hotel_id = p_hotel_id and public._tarifa_clave(to_jsonb(t)) = any(v_claves))
       or exists (select 1 from public.tarifa_hotel t where t.hotel_id = p_hotel_id and public._tarifa_clave(to_jsonb(t)) = any(v_claves)
                  and coalesce(t.precio_final_autoritativo, false)) then
      raise exception 'generar_tarifas_hotel_calculadora: no hay una promoción escrita a mano que sustituir en esa celda; usa "Generar"';
    end if;
  else
    select btrim(t.temporada) || ' · ' || btrim(t.tipo_habitacion) || ' · ' || btrim(t.alimentacion) into v_choque
    from public.tarifa_hotel t
    where t.hotel_id = p_hotel_id
      and coalesce(v_tipo_calc, '') = 'mixta'
      and not coalesce(t.precio_final_autoritativo, false)
      and btrim(t.temporada) = any(v_promos_pct)
      and case when p_reemplazar_todo
               then not (btrim(t.temporada) = any(v_protegidas))
               else public._tarifa_clave(to_jsonb(t)) = any(v_claves) end
    limit 1;
    if v_choque is not null then
      raise exception 'generar_tarifas_hotel_calculadora: % es una promoción escrita a mano; no se sobrescribe al generar. Sustitúyela celda por celda o déjala como está. %', v_choque, v_recargar;
    end if;
  end if;

  perform set_config('app.tarifa_motivo', v_motivo, true);

  if p_reemplazar_todo then
    delete from public.tarifa_hotel t
    where t.hotel_id = p_hotel_id
      and (t.temporada is null or not (btrim(t.temporada) = any(v_protegidas)));
  else
    delete from public.tarifa_hotel t
    using (
      select distinct btrim(f->>'tipo_habitacion') as tipo, btrim(f->>'alimentacion') as alim, btrim(f->>'temporada') as temp
      from jsonb_array_elements(p_filas) f
    ) k
    where t.hotel_id = p_hotel_id
      and btrim(t.tipo_habitacion) = k.tipo
      and btrim(t.alimentacion) = k.alim
      and btrim(t.temporada) = k.temp;
  end if;
  get diagnostics v_borradas = row_count;

  for v_fila in select * from jsonb_array_elements(p_filas) loop
    insert into public.tarifa_hotel (
      hotel_id, tipo_habitacion, alimentacion, temporada,
      neto_sencilla, neto_doble, neto_triple, neto_multiple,
      neto_nino, neto_nino2, neto_infante, nota_infante, notas,
      edad_infante_min, edad_infante_max, edad_nino_min, edad_nino_max,
      precio_final_autoritativo, temporada_base
    ) values (
      p_hotel_id,
      btrim(v_fila->>'tipo_habitacion'),
      btrim(v_fila->>'alimentacion'),
      btrim(v_fila->>'temporada'),
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

  return jsonb_build_object(
    'borradas', v_borradas,
    'insertadas', v_insertadas,
    'protegidas', to_jsonb(v_protegidas)
  );
end;
$function$

;

CREATE OR REPLACE FUNCTION public.reemplazar_tarifas_hotel_calculadora(p_hotel_id bigint, p_regimenes text[], p_filas jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$

;

CREATE OR REPLACE FUNCTION public.aprobar_solicitud_b2b(p_id bigint, p_modo text DEFAULT 'sugerido'::text, p_aliado_id bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_sol        public.b2b_solicitudes%rowtype;
  v_email_perf text;
  v_rol_perf   public.rol_usuario;
  v_act_perf   boolean;
  v_email_auth text;
  v_aliado     bigint;
  v_quien      text;
  v_n          integer;
begin
  if public.mi_rol() is null or public.mi_rol() not in ('superadmin', 'administracion', 'gerencia') then
    raise exception 'No tienes permiso para aprobar registros B2B.' using errcode = '42501';
  end if;

  select * into v_sol from public.b2b_solicitudes where id = p_id for update;
  if not found then
    raise exception 'Solicitud no encontrada.' using errcode = 'P0002';
  end if;
  if v_sol.estado is distinct from 'pendiente' then
    raise exception 'La solicitud ya fue procesada (estado: %).', v_sol.estado using errcode = '55000';
  end if;
  if v_sol.tipo not in ('agencia', 'freelance') then
    raise exception 'Tipo de solicitud inválido.' using errcode = '22023';
  end if;
  if v_sol.usuario_id is null then
    raise exception 'La solicitud no tiene una cuenta asociada; no se puede aprobar. Pide al aliado que se registre de nuevo.' using errcode = '55000';
  end if;

  select email, rol, activo into v_email_perf, v_rol_perf, v_act_perf
    from public.usuarios where id = v_sol.usuario_id for update;
  if not found then
    raise exception 'La cuenta asociada a la solicitud ya no existe.' using errcode = '55000';
  end if;
  select email into v_email_auth from auth.users where id = v_sol.usuario_id;
  if lower(btrim(coalesce(v_email_perf, ''))) <> lower(btrim(v_sol.email))
     or lower(btrim(coalesce(v_email_auth, ''))) <> lower(btrim(v_sol.email)) then
    raise exception 'El correo de la cuenta no coincide con el de la solicitud; no se aprueba.' using errcode = '55000';
  end if;
  if v_rol_perf::text <> v_sol.tipo then
    raise exception 'La cuenta asociada no es un aliado B2B pendiente (rol %); no se reasigna.', v_rol_perf using errcode = '55000';
  end if;
  if v_act_perf then
    raise exception 'La cuenta asociada ya está activa; no se aprueba desde esta solicitud.' using errcode = '55000';
  end if;

  if p_modo = 'sugerido' then
    v_aliado := v_sol.aliado_sugerido_id;
  elsif p_modo = 'ficha' then
    if p_aliado_id is null or not exists (select 1 from public.aliados where id = p_aliado_id) then
      raise exception 'La ficha de aliado elegida no existe.' using errcode = '22023';
    end if;
    v_aliado := p_aliado_id;
  elsif p_modo = 'nueva' then
    insert into public.aliados (nombre, nit, tipo_documento, tipo, email, telefono, contacto)
    values (
      v_sol.nombre, v_sol.nit,
      coalesce(nullif(btrim(v_sol.tipo_documento), ''), case when v_sol.tipo = 'agencia' then 'NIT' else 'CC' end),
      v_sol.tipo, v_sol.email, v_sol.telefono, v_sol.contacto
    )
    returning id into v_aliado;
  elsif p_modo = 'ninguno' then
    v_aliado := null;
  else
    raise exception 'Modo de enlace inválido.' using errcode = '22023';
  end if;

  -- El enlace queda EXACTAMENTE como lo eligió quien aprueba: con 'ninguno'
  -- (o 'sugerido' sin sugerencia) `aliado_id` queda NULL aunque la cuenta
  -- trajera uno de antes. Y nunca se concede el respaldo legacy por nombre.
  update public.usuarios
     set activo = true,
         aliado_id = v_aliado,
         acceso_legacy_nombre = false
   where id = v_sol.usuario_id
     and activo = false
     and rol::text = v_sol.tipo;
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception 'No se pudo activar la cuenta (filas afectadas: %).', v_n using errcode = '55000';
  end if;

  select coalesce(nullif(btrim(nombre), ''), email) into v_quien
    from public.usuarios where id = auth.uid();

  update public.b2b_solicitudes
     set estado = 'aprobada',
         revisado_por = v_quien,
         revisado_at = now(),
         aliado_sugerido_id = coalesce(v_aliado, aliado_sugerido_id)
   where id = p_id
     and estado = 'pendiente';
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception 'No se pudo marcar la solicitud como aprobada (filas afectadas: %).', v_n using errcode = '55000';
  end if;

  return jsonb_build_object('usuario_id', v_sol.usuario_id, 'aliado_id', v_aliado);
end;
$function$

;

drop trigger if exists usuarios_invalidar_contexto_agencia on public.usuarios;
drop function if exists public.invalidar_contexto_agencia_usuario();
drop function if exists public.cambiar_contexto_agencia(uuid, text);
drop function if exists public.iniciar_contexto_agencia(uuid, text, interval);
drop function if exists public.puede_escribir_catalogo_global();
drop function if exists public.agencia_activa_sesion();
drop function if exists public.catalogos_globales_registro();
drop table if exists public.sesion_agencia;
drop table if exists public.sesion_agencia_inicio;
commit;
