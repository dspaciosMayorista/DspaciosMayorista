-- ROLLBACK 299 (#43/#60 entrega 3c). Separado y PROTEGIDO: aborta sin tocar nada si hay grupos ACTIVOS o
-- tarifas por grupo en tarifa_hotel (deshacer dejaría vigencias sin tarifa o con tarifas que nada puede leer).
-- Para llegar a 0: «Volver a todos los días» en cada vigencia que se vende por grupos.
-- Restaura LITERALMENTE las funciones de la 295, la 297 y la 237 que la 299 redefinió (generado desde esos
-- archivos), el candado de inactividad de la 293 y la escritura directa de grupos para authenticated.
-- ANTES de correrlo: revertir el código que llama a las RPC de la 299.
begin;
set local lock_timeout = '8s';
set local statement_timeout = '60s';

do $$
declare v_activos bigint; v_filas bigint;
begin
  select count(*) into v_activos from public.hotel_temporada_grupos where activo;
  select count(*) into v_filas from public.tarifa_hotel where grupo_id is not null;
  if v_activos > 0 or v_filas > 0 then
    raise exception 'ROLLBACK 299 ABORTADO (REVISAR): hay % grupo(s) activo(s) y % tarifa(s) por grupo. Vuelve a «todos los días» primero.', v_activos, v_filas;
  end if;
end $$;

drop trigger if exists trg_43_empates_marca on public.tarifa_hotel;
drop trigger if exists trg_43_empates_marca on public.hotel_temporadas;
drop trigger if exists trg_43_empates_marca on public.hotel_temporada_grupos;
drop trigger if exists trg_empates_43 on public.tarifa_hotel;
drop trigger if exists trg_empates_43 on public.hotel_temporadas;
drop trigger if exists trg_empates_43 on public.hotel_temporada_grupos;
drop trigger if exists trg_tarifa_hotel_grupo_rpc_43 on public.tarifa_hotel;
drop trigger if exists trg_hotel_temporada_grupos_activo_43 on public.hotel_temporada_grupos;

drop function if exists public.grupos_dias_alcance(bigint);
drop function if exists public.grupos_dias_activar(bigint, text, jsonb);
drop function if exists public.grupos_dias_descartar(bigint, text);
drop function if exists public.grupos_dias_volver_todos(bigint, text, jsonb);

-- Definiciones ORIGINALES (295, 297, 237):
create or replace function public._grupos_43_config(p_temporada_id bigint)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v public.hotel_temporadas;
  r jsonb;
begin
  select * into v from public.hotel_temporadas where id = p_temporada_id;
  if not found then
    raise exception 'La vigencia % no existe.', p_temporada_id using errcode = 'P0002';
  end if;
  with
  grupos as (select g.* from public.hotel_temporada_grupos g where g.temporada_id = v.id),
  props as (select p.* from public.hotel_grupo_tarifa_propuesta p join grupos g on g.id = p.grupo_id),
  origen as (
    select t.* from public.tarifa_hotel t
    where t.hotel_id = v.hotel_id and btrim(coalesce(t.temporada, '')) = btrim(v.nombre) and t.grupo_id is null),
  promo_filas as (
    select t.* from public.tarifa_hotel t
    where t.hotel_id = v.hotel_id and btrim(coalesce(t.temporada_base, '')) = btrim(v.nombre)),
  promo_vigs as (
    select ht.* from public.hotel_temporadas ht
    where ht.hotel_id = v.hotel_id and btrim(ht.nombre) in (select btrim(coalesce(temporada, '')) from promo_filas))
  select jsonb_build_object(
    'vigencia', jsonb_build_object('id', v.id, 'nombre', v.nombre, 'hotel_id', v.hotel_id, 'tipo', coalesce(v.tipo, 'tarifa'),
                  'prioridad', v.prioridad, 'fecha_inicio', v.fecha_inicio, 'fecha_fin', v.fecha_fin,
                  'nombre_repetido', exists (select 1 from public.hotel_temporadas o
                                             where o.hotel_id = v.hotel_id and o.id <> v.id and btrim(o.nombre) = btrim(v.nombre))),
    'hotel', (select jsonb_build_object('id', h.id, 'modelo_tarifario', h.modelo_tarifario) from public.hoteles h where h.id = v.hotel_id),
    'categorias', coalesce((select jsonb_agg(c.nombre order by c.nombre) from public.hotel_categorias hc
                            join public.categorias_habitacion c on c.id = hc.categoria_id where hc.hotel_id = v.hotel_id), '[]'),
    'regimenes', coalesce((select jsonb_agg(pa.codigo order by pa.codigo) from public.hotel_regimenes hr
                           join public.planes_alimentacion pa on pa.id = hr.plan_id where hr.hotel_id = v.hotel_id), '[]'),
    'grupos', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'nombre', g.nombre, 'dias', g.dias, 'activo', g.activo)
                                         order by g.dias[1], g.id) from grupos g), '[]'),
    'propuestas', coalesce((select jsonb_agg((to_jsonb(p) - 'confirmado_por') order by p.id) from props p), '[]'),
    'origen', coalesce((select jsonb_agg(jsonb_build_object(
        'id', t.id, 'tipo_habitacion', t.tipo_habitacion, 'alimentacion', t.alimentacion,
        'neto_sencilla', t.neto_sencilla, 'neto_doble', t.neto_doble, 'neto_triple', t.neto_triple, 'neto_multiple', t.neto_multiple,
        'neto_nino', t.neto_nino, 'neto_nino2', t.neto_nino2, 'neto_infante', t.neto_infante, 'nota_infante', t.nota_infante, 'notas', t.notas,
        'edad_infante_min', t.edad_infante_min, 'edad_infante_max', t.edad_infante_max, 'edad_nino_min', t.edad_nino_min, 'edad_nino_max', t.edad_nino_max,
        'huella', md5(to_jsonb(t)::text)) order by t.id) from origen t), '[]'),
    'promociones', coalesce((select jsonb_agg(jsonb_build_object('temporada', x.temporada, 'filas', x.n) order by x.temporada)
                             from (select temporada, count(*) as n from promo_filas group by temporada) x), '[]'),
    'huella', md5(concat_ws('|',
        to_jsonb(v)::text,
        coalesce((select jsonb_agg(to_jsonb(g) order by g.id) from grupos g)::text, '[]'),
        coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from props p)::text, '[]'),
        coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from origen t)::text, '[]'),
        coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from promo_filas t)::text, '[]'),
        coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from promo_vigs t)::text, '[]'))))
  into r;
  return r;
end $$;

create or replace function public._grupos_43_bloquear_y_comparar(p_temporada_id bigint, p_huella text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_hotel bigint;
  v_nombre text;
  v_modelo text;
  r jsonb;
begin
  perform 1 from public.hotel_temporada_grupos g where g.temporada_id = p_temporada_id order by g.id for update;
  select t.hotel_id, btrim(t.nombre) into v_hotel, v_nombre from public.hotel_temporadas t where t.id = p_temporada_id for update;
  if not found then
    raise exception 'La vigencia % no existe.', p_temporada_id using errcode = 'P0002';
  end if;
  -- Tarifas de origen («todos los días» de la vigencia) y filas de las promociones vinculadas: se
  -- bloquean en modo compartido ANTES del candado del hotel. Un cambio en curso en cualquiera de ellas
  -- (también un cambio de solo precio, que no pasa por el trigger de la 293) se espera y luego se lee
  -- confirmado; mientras dure esta transacción nadie las cambia.
  perform 1 from public.tarifa_hotel t
   where t.hotel_id = v_hotel
     and ((t.grupo_id is null and btrim(coalesce(t.temporada, '')) = v_nombre) or btrim(coalesce(t.temporada_base, '')) = v_nombre)
   order by t.id for share;
  -- Vigencias de esas promociones: también quietas hasta confirmar.
  perform 1 from public.hotel_temporadas ht
   where ht.hotel_id = v_hotel and ht.id <> p_temporada_id
     and btrim(ht.nombre) in (select btrim(coalesce(t.temporada, '')) from public.tarifa_hotel t
                              where t.hotel_id = v_hotel and btrim(coalesce(t.temporada_base, '')) = v_nombre)
   order by ht.id for share;
  -- Exclusivo: espera a que terminen las altas/cambios de tarifas en curso de este hotel (293 las toma
  -- en modo compartido), así una tarifa de origen NUEVA tampoco se cuela entre la lectura y la escritura.
  perform public.t43_60_candado_hotel(v_hotel, true);
  select h.modelo_tarifario into v_modelo from public.hoteles h where h.id = v_hotel for share;
  if v_modelo = 'unidad' then
    raise exception 'Los hoteles de modelo por unidad no admiten grupos de días.' using errcode = '23514';
  end if;
  r := public._grupos_43_config(p_temporada_id);
  if p_huella is null or r->>'huella' is distinct from p_huella then
    raise exception 'CONFIG_DESACTUALIZADA: la configuración de esta vigencia cambió desde que la abriste. Recarga y revisa de nuevo antes de confirmar.'
      using errcode = 'PT409';
  end if;
  return r;
end $$;

create or replace function public.grupos_dias_guardar(p_temporada_id bigint, p_huella text, p_grupos jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  e jsonb;
  v_id uuid;
  v_dias smallint[];
  v_viejos smallint[];
  n_alta int := 0; n_cambio int := 0;
  pasada int;
begin
  perform public._grupos_43_autorizar(true);
  if jsonb_typeof(p_grupos) is distinct from 'array' then
    raise exception 'p_grupos debe ser un arreglo.' using errcode = '22023';
  end if;
  perform public._grupos_43_bloquear_y_comparar(p_temporada_id, p_huella);
  -- Tres pasadas para que un cambio que libera días no choque con otro que los toma:
  -- 1) cambios que solo QUITAN días, 2) el resto de cambios, 3) altas. (Intercambiar días entre dos
  -- grupos existentes en un solo guardado no es posible: se hace en dos pasos.)
  for pasada in 1..3 loop
    for e in select x from jsonb_array_elements(p_grupos) x loop
      select coalesce(array_agg(d::smallint), '{}') into v_dias from jsonb_array_elements_text(e->'dias') d;
      if e->>'id' is not null then
        v_id := (e->>'id')::uuid;
        select dias into v_viejos from public.hotel_temporada_grupos where id = v_id and temporada_id = p_temporada_id;
        if not found then
          raise exception 'El grupo % no pertenece a esta vigencia.', v_id using errcode = '23514';
        end if;
        if (pasada = 1 and v_dias <@ v_viejos) or (pasada = 2 and not v_dias <@ v_viejos) then
          update public.hotel_temporada_grupos set nombre = e->>'nombre', dias = v_dias where id = v_id;
          n_cambio := n_cambio + 1;
        end if;
      elsif pasada = 3 then
        insert into public.hotel_temporada_grupos (temporada_id, nombre, dias) values (p_temporada_id, e->>'nombre', v_dias);
        n_alta := n_alta + 1;
      end if;
    end loop;
  end loop;
  return jsonb_build_object('altas', n_alta, 'cambios', n_cambio, 'config', public._grupos_43_config(p_temporada_id));
end $$;

create or replace function public.grupos_dias_borrar(p_grupo_id uuid, p_huella text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_temporada bigint;
  v_props int;
begin
  perform public._grupos_43_autorizar(true);
  select temporada_id into v_temporada from public.hotel_temporada_grupos where id = p_grupo_id;
  if not found then
    raise exception 'CONFIG_DESACTUALIZADA: el grupo ya no existe. Recarga y revisa de nuevo.' using errcode = 'PT409';
  end if;
  perform public._grupos_43_bloquear_y_comparar(v_temporada, p_huella);
  delete from public.hotel_grupo_tarifa_propuesta where grupo_id = p_grupo_id;
  get diagnostics v_props = row_count;
  delete from public.hotel_temporada_grupos where id = p_grupo_id;
  return jsonb_build_object('propuestas_eliminadas', v_props, 'config', public._grupos_43_config(v_temporada));
end $$;

create or replace function public.grupos_dias_guardar_calculadora(
  p_temporada_id bigint, p_huella text, p_grupo_id uuid, p_tipo text,
  p_calc_version bigint, p_bases_version bigint, p_bases jsonb, p_filas jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r jsonb; cfg jsonb; f jsonb; k text;
  v_hotel bigint; v_temporada bigint; v_activo boolean;
  v_calc public.hotel_calculadora;
  v_bases public.hotel_calculadora_grupo_bases;
  v_nueva bigint;
  v_campos constant text[] := array['grupo_id','tipo_habitacion','alimentacion',
    'neto_sencilla','neto_doble','neto_triple','neto_multiple','neto_nino','neto_nino2','neto_infante',
    'origen_tarifa_id','nota_infante','notas','edad_infante_min','edad_infante_max','edad_nino_min','edad_nino_max'];
  v_netos constant text[] := array['neto_sencilla','neto_doble','neto_triple','neto_multiple','neto_nino','neto_nino2','neto_infante'];
begin
  -- Usuario interno y permiso de catálogo (Mayorista). La 295 lo vuelve a comprobar.
  perform public._grupos_43_autorizar(true);
  if p_tipo is null or p_tipo not in ('dubai', 'mixta', 'corporativa') then
    raise exception 'Tipo de calculadora no válido.' using errcode = '22023';
  end if;
  if p_grupo_id is null or p_temporada_id is null then
    raise exception 'Faltan la vigencia o el grupo.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_filas) is distinct from 'array' or jsonb_array_length(p_filas) > 500 then
    raise exception 'p_filas debe ser una lista (máximo 500 filas).' using errcode = '22023';
  end if;
  select g.temporada_id, g.activo into v_temporada, v_activo from public.hotel_temporada_grupos g where g.id = p_grupo_id;
  if not found then
    raise exception 'CONFIG_DESACTUALIZADA: el grupo ya no existe. Recarga y revisa de nuevo.' using errcode = 'PT409';
  end if;
  if v_temporada <> p_temporada_id then
    raise exception 'El grupo no pertenece a esta vigencia.' using errcode = '23514';
  end if;
  if v_activo then
    raise exception 'Los grupos activos no se editan desde la calculadora.' using errcode = '23514';
  end if;

  -- Filas: EXCLUSIVAMENTE del grupo, campos conocidos, valores con tipo, sin «sugerencia aceptada» y con
  -- al menos un neto (la calculadora nunca quita combinaciones: eso se hace en el panel de grupos).
  for f in select x from jsonb_array_elements(p_filas) x loop
    if jsonb_typeof(f) is distinct from 'object' then
      raise exception 'Cada fila debe ser un objeto.' using errcode = '22023';
    end if;
    for k in select jsonb_object_keys(f) loop
      if not k = any (v_campos) then
        raise exception 'Campo no permitido en una fila: %.', k using errcode = '22023';
      end if;
    end loop;
    if f->>'grupo_id' is distinct from p_grupo_id::text then
      raise exception 'Todas las filas deben ser del grupo solicitado.' using errcode = '23514';
    end if;
    if f ? 'origen_tarifa_id' and jsonb_typeof(f->'origen_tarifa_id') <> 'null' then
      raise exception 'Una fila calculada no puede marcarse como sugerencia aceptada.' using errcode = '23514';
    end if;
    if exists (select 1 from unnest(v_netos) n where f ? n and not public._calc_grupos_43_numero(f->n, true)) then
      raise exception 'Los netos deben ser números mayores o iguales a 0, o vacíos.' using errcode = '22023';
    end if;
    if not exists (select 1 from unnest(v_netos) n where f ? n and jsonb_typeof(f->n) = 'number') then
      raise exception 'Una fila calculada necesita al menos un neto (la calculadora no quita combinaciones).' using errcode = '23514';
    end if;
    if exists (select 1 from unnest(array['edad_infante_min','edad_infante_max','edad_nino_min','edad_nino_max']) n
               where f ? n and jsonb_typeof(f->n) <> 'null'
                 and (jsonb_typeof(f->n) <> 'number' or (f->>n)::numeric <> trunc((f->>n)::numeric))) then
      raise exception 'Las edades deben ser números enteros o vacías.' using errcode = '22023';
    end if;
    if exists (select 1 from unnest(array['nota_infante','notas']) n
               where f ? n and jsonb_typeof(f->n) <> 'null' and (jsonb_typeof(f->n) <> 'string' or char_length(f->>n) > 1000)) then
      raise exception 'Las notas deben ser textos de hasta 1000 caracteres.' using errcode = '22023';
    end if;
  end loop;

  -- Propuesta (295, sin cambios): candados en el orden de la 293, huella, catálogo, unidad, restricciones.
  r := public.grupos_dias_guardar_propuesta(p_temporada_id, p_huella, 'actualizar', p_grupo_id, p_filas);
  cfg := r->'config';
  v_hotel := (cfg->'vigencia'->>'hotel_id')::bigint;
  perform public._calc_grupos_43_validar_bases(p_tipo, p_bases, cfg->'categorias', cfg->'regimenes');

  -- Compra cerrada: misma regla que generar_tarifas_hotel_calculadora (203/237). La vigencia ya está
  -- bloqueada por la llamada anterior, así que su compra_fin no cambia hasta terminar.
  if exists (select 1 from public.hotel_temporadas t
              where t.hotel_id = v_hotel and btrim(t.nombre) = btrim(cfg->'vigencia'->>'nombre')
              group by btrim(t.nombre)
              having bool_and(t.compra_fin is not null and t.compra_fin < public.fecha_negocio())) then
    raise exception 'La vigencia "%" tiene la compra cerrada: no se calcula ni se guarda por grupo.', cfg->'vigencia'->>'nombre' using errcode = '23514';
  end if;

  -- Parámetros generales con los que se calculó: misma fila, mismo tipo, misma versión.
  select * into v_calc from public.hotel_calculadora c where c.hotel_id = v_hotel for share;
  if not found then
    raise exception 'CONFIG_DESACTUALIZADA: el hotel ya no tiene calculadora guardada. Recarga y revisa de nuevo.' using errcode = 'PT409';
  end if;
  if v_calc.tipo is distinct from p_tipo then
    raise exception 'CONFIG_DESACTUALIZADA: la calculadora del hotel cambió de tipo. Recarga y revisa de nuevo.' using errcode = 'PT409';
  end if;
  if p_calc_version is null or v_calc.version <> p_calc_version then
    raise exception 'CONFIG_DESACTUALIZADA: la calculadora del hotel cambió desde que la abriste. Recarga y revisa de nuevo.' using errcode = 'PT409';
  end if;

  -- Bases del grupo: versión comparada (cubre también un guardado que no cambió la propuesta).
  select * into v_bases from public.hotel_calculadora_grupo_bases b where b.grupo_id = p_grupo_id and b.tipo = p_tipo for update;
  if found then
    if p_bases_version is distinct from v_bases.version then
      raise exception 'CONFIG_DESACTUALIZADA: las bases de este grupo cambiaron desde que las abriste. Recarga y revisa de nuevo.' using errcode = 'PT409';
    end if;
    update public.hotel_calculadora_grupo_bases set bases = p_bases, updated_by = auth.uid()
     where id = v_bases.id returning version into v_nueva;
  else
    if p_bases_version is not null then
      raise exception 'CONFIG_DESACTUALIZADA: las bases de este grupo cambiaron desde que las abriste. Recarga y revisa de nuevo.' using errcode = 'PT409';
    end if;
    insert into public.hotel_calculadora_grupo_bases (grupo_id, tipo, bases, updated_by)
    values (p_grupo_id, p_tipo, p_bases, auth.uid()) returning version into v_nueva;
  end if;

  return r || jsonb_build_object('bases_version', v_nueva, 'calc_version', v_calc.version);
end $$;

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
  if not public.puede_escribir_catalogo_global() then
    raise exception 'Los catalogos globales solo se editan desde la agencia Mayorista.' using errcode = '42501';
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
$function$;

drop function if exists public._grupos_43_bloquear(bigint, text, boolean);
drop function if exists public._grupos_43_dias_sin_grupo(bigint);
drop function if exists public._grupos_43_pendientes(bigint);
drop function if exists public._grupos_43_obsoletas(bigint);
drop function if exists public._grupos_43_edades_conflicto(bigint);
drop function if exists public._grupos_43_habilitaciones(bigint);
drop function if exists public._grupos_43_vende(text, numeric);
drop function if exists public.tg_empates_43();
drop function if exists public.tg_empates_43_marca();
drop function if exists public._grupos_43_hotel_de(text, bigint, bigint);
drop function if exists public._grupos_43_texto_empates(jsonb);
drop function if exists public._grupos_43_empates(bigint, bigint);
drop function if exists public._fecha_43(text);
drop function if exists public.tg_tarifa_hotel_grupo_rpc_43();
drop function if exists public.tg_hotel_temporada_grupos_activo_43();
drop function if exists public._grupos_43_en_rpc();

-- Permisos de las funciones restauradas (iguales a la 295 / 297; create or replace los conserva, se repiten por claridad).
revoke all on function public._grupos_43_config(bigint) from public, anon, authenticated;
revoke all on function public._grupos_43_bloquear_y_comparar(bigint, text) from public, anon, authenticated;
grant execute on function public.grupos_dias_guardar(bigint, text, jsonb) to authenticated;
grant execute on function public.grupos_dias_borrar(uuid, text) to authenticated;
grant execute on function public.grupos_dias_guardar_calculadora(bigint, text, uuid, text, bigint, bigint, jsonb, jsonb) to authenticated;

grant insert, update, delete on public.hotel_temporada_grupos to authenticated;
alter table public.hotel_temporada_grupos
  add constraint hotel_temporada_grupos_inactivos_43 check (not activo);
comment on table public.hotel_temporada_grupos is
  '#43/#60: grupos de días de la semana (1=lun … 7=dom) de una vigencia. INACTIVOS hasta que el motor los soporte (check hotel_temporada_grupos_inactivos_43).';

commit;
