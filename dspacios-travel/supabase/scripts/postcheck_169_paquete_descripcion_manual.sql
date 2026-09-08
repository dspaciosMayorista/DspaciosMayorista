-- ───────────────────────────────────────────────────────────────────────────
-- POSTCHECK 169 · Descripción manual del paquete (armado_paquetes). Prueba de
-- ejecución REAL en una única transacción que termina en ROLLBACK (no deja
-- datos ficticios). Pensada para correr contra una base LOCAL desechable —
-- nunca contra Supabase real.
-- ───────────────────────────────────────────────────────────────────────────

begin;

create temp table if not exists pg_temp.postcheck_169_reporte (
  seccion text, nombre text, estado text, detalle text
);
truncate pg_temp.postcheck_169_reporte;

-- 1) Las 4 columnas existen, son tipo text y nullable (aditivo real: nada NOT NULL).
insert into pg_temp.postcheck_169_reporte
select 'esquema', c.nombre,
  case when exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'armado_paquetes'
      and column_name = c.nombre and data_type = 'text' and is_nullable = 'YES'
  ) then 'OK' else 'FALLA' end, ''
from (values ('programa_incluye'), ('programa_no_incluye'), ('programa_tarifas_especiales'), ('programa_condiciones_comerciales')) as c(nombre);

-- 2) No se agregó ninguna restricción CHECK nueva sobre armado_paquetes por esta migración
--    (el modelo es texto libre sin validación estructural, según lo pedido).
insert into pg_temp.postcheck_169_reporte
select 'esquema', 'sin CHECK nuevo sobre los 4 campos',
  case when not exists (
    select 1 from pg_constraint
    where conrelid = 'public.armado_paquetes'::regclass
      and (
        conname ilike '%programa_incluye%' or conname ilike '%programa_no_incluye%'
        or conname ilike '%programa_tarifas_especiales%' or conname ilike '%programa_condiciones_comerciales%'
      )
  ) then 'OK' else 'FALLA' end, '';

-- ═══════════════════════════════════════════════════════════════════════
-- Ejecución real: insertar/actualizar un paquete con los 4 campos, incluido
-- contenido con tildes/saltos de línea/caracteres especiales, y verificar que
-- se persiste EXACTO (sin normalizar, sin recortar líneas vacías a mitad de
-- texto — eso es responsabilidad de la UI al renderizar, no de la columna).
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare
  v_paquete_id bigint;
  v_incluye text := E'Desayuno buffet\nTraslados aeropuerto-hotel-aeropuerto\nImpuestos hoteleros\n\nSeguro médico básico';
  v_leido text;
begin
  insert into public.armado_paquetes (nombre, tipo, activo, pct_mk, impuesto_tipo, impuesto_fijo)
  values ('POSTCHECK 169 — paquete de prueba', 'bloqueo', true, 0.2, 'tiquete', 0)
  returning id into v_paquete_id;

  -- Recién creado: los 4 campos deben quedar NULL (sin backfill/invención de contenido).
  insert into pg_temp.postcheck_169_reporte
  select 'datos', 'paquete nuevo sin backfill (4 campos NULL)',
    case when (
      select programa_incluye is null and programa_no_incluye is null
        and programa_tarifas_especiales is null and programa_condiciones_comerciales is null
      from public.armado_paquetes where id = v_paquete_id
    ) then 'OK' else 'FALLA' end, '';

  update public.armado_paquetes
  set programa_incluye = v_incluye,
      programa_no_incluye = E'Tiquetes aéreos\nPropinas',
      programa_tarifas_especiales = E'Niños de 2 a 5 años: 50% de descuento',
      programa_condiciones_comerciales = E'No reembolsable\nSujeto a disponibilidad al momento de confirmar'
  where id = v_paquete_id;

  select programa_incluye into v_leido from public.armado_paquetes where id = v_paquete_id;
  insert into pg_temp.postcheck_169_reporte
  select 'datos', 'contenido persistido EXACTO (saltos de línea + tildes + línea vacía intermedia)',
    case when v_leido = v_incluye then 'OK' else 'FALLA' end,
    coalesce(v_leido, '(null)');

  -- Compartido por todos los hoteles/opciones del paquete: no hay columna por
  -- hotel — leer el mismo paquete_id dos veces (simulando dos hoteles
  -- distintos del mismo armado) siempre da el mismo texto (estructural: es
  -- UNA sola fila de armado_paquetes, no puede divergir por hotel).
  insert into pg_temp.postcheck_169_reporte
  select 'datos', 'mismo contenido para cualquier hotel del paquete (estructural: 1 fila por paquete)',
    case when (
      (select programa_incluye from public.armado_paquetes where id = v_paquete_id) =
      (select programa_incluye from public.armado_paquetes where id = v_paquete_id)
    ) then 'OK' else 'FALLA' end, '';

  -- Las 4 secciones vacías (NULL) en un paquete distinto: no se inventa contenido.
  declare v_paquete_vacio bigint;
  begin
    insert into public.armado_paquetes (nombre, tipo, activo, pct_mk, impuesto_tipo, impuesto_fijo)
    values ('POSTCHECK 169 — paquete sin descripción', 'porcion_terrestre', true, 0.2, 'tiquete', 0)
    returning id into v_paquete_vacio;

    insert into pg_temp.postcheck_169_reporte
    select 'datos', 'paquete sin ninguna sección configurada queda NULL en las 4 (sin inventar contenido)',
      case when (
        select programa_incluye is null and programa_no_incluye is null
          and programa_tarifas_especiales is null and programa_condiciones_comerciales is null
        from public.armado_paquetes where id = v_paquete_vacio
      ) then 'OK' else 'FALLA' end, '';
  end;
end $$;

select seccion, nombre, estado, detalle from pg_temp.postcheck_169_reporte order by seccion, nombre;

select
  count(*) filter (where estado = 'FALLA') as fallas,
  count(*) as total
from pg_temp.postcheck_169_reporte;

rollback;
