-- ─────────────────────────────────────────────────────────────────────────
-- DIAGNÓSTICO · aislamiento por tenant de `cotizaciones`/`cotizacion_servicios`
-- Se pega completo en el editor SQL de Supabase y se ejecuta.
--
-- Sin escrituras persistentes; utiliza objetos temporales dentro de una
-- transacción que termina en rollback. No inserta, no actualiza ni borra
-- ninguna fila de una tabla real, no crea funciones ni policies permanentes.
-- Las únicas tablas que este script escribe son temporales (`create temp
-- table ... on commit drop`) y desaparecen solas al terminar la transacción,
-- incluso si el rollback no se ejecutara por algún corte de conexión.
--
-- ⚠️ REPORTE CONSOLIDADO: el editor SQL de Supabase solo muestra el
-- resultado del ÚLTIMO statement cuando se corre el script completo de una
-- vez — todos los `select` intermedios que este script ejecutaba antes se
-- calculaban igual, pero su resultado quedaba invisible. Ahora cada bloque
-- vuelca su resultado (mismo cálculo, misma lógica, solo cambia cómo se
-- empaqueta) a una tabla temporal `_reporte(orden, seccion, resultado
-- jsonb)`, y el ÚNICO `select` final antes del `rollback` devuelve todas las
-- secciones en un solo resultado, una fila por sección, ordenadas.
-- ─────────────────────────────────────────────────────────────────────────
--
-- SECCIONES DEL REPORTE FINAL (columna `seccion`, en el orden que trae
-- `select seccion, resultado from _reporte order by orden`)
--    1  conteos                                    → total de filas de cada tabla
--    2  estados_y_tipos                             → cotizaciones por estado × tipo
--    3  D1_3_usuarios_sospechosos                    → SOLO los usuarios marcados
--       SOSPECHOSO en la auditoría de confiabilidad de `usuarios.tenant`
--    4  D1_4_conteos                                 → solo_tenant_b /
--       solo_tenant_b_de_usuario_sospechoso
--    5  clasificacion_5_6                            → clasificación completa por
--       confianza de evidencia, con cantidades
--    6  servicios_huerfanos                          → huérfanas en cotizacion_servicios
--    7  policies_resumen                             → policies reales de ambas tablas
--    8  cruce_autenticado_cotizaciones                → prueba cruzada por usuario/tenant
--    9  cruce_autenticado_servicios                   → misma prueba, extendida a
--       cotizacion_servicios (fuga vía el padre)
--   10  resultado_anonimo                             → acceso del rol `anon`
--   11  controles_de_integridad                       → resultado de los DOS controles
--       (emparejamiento id↔numero_contrato del bloque 9, y el control negativo
--       sintético que prueba que el mecanismo de fuga sí detecta una fuga)
--   12  cotizaciones_ambiguas_o_revision_manual        → id y datos mínimos (SIN
--       payload/detalle completos ni datos personales del cliente) de las filas
--       que la clasificación del punto 5 dejó en AMBIGUA o REVISIÓN MANUAL, para
--       poder decidir su tenant caso por caso
--
-- Los bloques 8 y 9 (y sus DO blocks de origen) son los únicos que impersonan
-- un rol de PostgREST; el resto son cálculos directos como superusuario (ven
-- todo, sin RLS, porque el editor SQL de Supabase corre como superusuario).
--
-- ⚠️ Si CUALQUIERA de los dos controles de integridad falla, el DO block
-- correspondiente sigue haciendo `raise exception` — igual que antes — y
-- TODA la transacción aborta (no llega a producir el reporte final). Eso es
-- intencional: un control roto no debe disfrazarse de reporte exitoso.
--
-- ⚠️ SOBRE LA CLASIFICACIÓN (sección 5): NUNCA combina señales de distinta
-- confianza con `coalesce` para decidir un tenant automáticamente. `tenant_c`
-- (coincidencia de NOMBRE — el mismo mecanismo que ya falló en
-- `ventas.asesor`) nunca convierte sola una fila en inequívoca; `tenant_b`
-- (creado_por) se marca "CANDIDATA" pendiente de auditar su fiabilidad
-- (sección 3); las contradicciones entre señales se reportan aparte.
-- ─────────────────────────────────────────────────────────────────────────

begin;

create temp table _reporte (
  orden     integer,
  seccion   text,
  resultado jsonb
) on commit drop;

-- Resultados de los dos controles de integridad (bloque 9 más abajo), para
-- combinarlos en una sola fila de `_reporte` (sección 11).
create temp table _controles (
  subseccion text,
  resultado  jsonb
) on commit drop;

-- ══ 1. Cantidad de filas ════════════════════════════════════════════════
insert into _reporte (orden, seccion, resultado)
select 1, 'conteos', jsonb_build_object(
  'total_cotizaciones',        (select count(*) from public.cotizaciones),
  'total_cotizacion_servicios', (select count(*) from public.cotizacion_servicios)
);

-- ══ 2. Estados y tipos ══════════════════════════════════════════════════
insert into _reporte (orden, seccion, resultado)
select 2, 'estados_y_tipos', coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
from (
  select
    estado, tipo,
    count(*)                         as filas,
    min(created_at)                  as mas_antigua,
    max(created_at)                  as mas_reciente,
    count(*) filter (where numero_contrato is not null) as con_numero_contrato
  from public.cotizaciones
  group by estado, tipo
  order by estado, tipo
) t;

-- ══ 3. D1.3 — SOLO usuarios marcados SOSPECHOSO ═════════════════════════
-- Misma señal cruzada de siempre (¿`usuarios.tenant` coincide con el tenant
-- de las `ventas` donde ese usuario aparece como `asesor` por nombre?, mismo
-- criterio que ya usa `test_rls_por_rol.sql`), pero el reporte solo incluye
-- las filas donde la evidencia apunta a un `tenant` posiblemente incorrecto
-- (más ventas por nombre en el tenant CONTRARIO al que declara) — candidato
-- a haber quedado con el `default 'mayorista'` que la migración 107 le puso
-- a todo lo preexistente.
insert into _reporte (orden, seccion, resultado)
select 3, 'D1_3_usuarios_sospechosos', coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
from (
  with coincidencias as (
    select u.id, u.email, u.rol, u.tenant as tenant_declarado,
      count(*) filter (where v.tenant = u.tenant) as ventas_mismo_tenant,
      count(*) filter (where v.tenant <> u.tenant) as ventas_otro_tenant
    from public.usuarios u
    left join public.ventas v on lower(btrim(v.asesor)) = lower(btrim(u.nombre))
    group by u.id, u.email, u.rol, u.tenant
  )
  select email, rol, tenant_declarado, ventas_mismo_tenant, ventas_otro_tenant,
    'SOSPECHOSO — más ventas por nombre en el OTRO tenant; no usar su tenant_b para backfill sin revisar' as veredicto
  from coincidencias
  where ventas_otro_tenant > ventas_mismo_tenant
  order by email
) t;

-- ══ 4. D1.4 — solo_tenant_b / solo_tenant_b_de_usuario_sospechoso ═══════
insert into _reporte (orden, seccion, resultado)
select 4, 'D1_4_conteos', jsonb_build_object(
  'solo_tenant_b',                       t.solo_tenant_b,
  'solo_tenant_b_de_usuario_sospechoso',  t.solo_tenant_b_de_usuario_sospechoso
)
from (
  with senal_a as (
    select c.id from public.cotizaciones c join public.ventas v on v.numero_contrato = c.numero_contrato
  ),
  senal_c as (
    select c.id from public.cotizaciones c
    where c.asesor is not null and btrim(c.asesor) <> ''
      and (select count(distinct u.tenant) from public.usuarios u where lower(btrim(u.nombre)) = lower(btrim(c.asesor))) = 1
  ),
  sospechosos as (
    select u.id
    from public.usuarios u
    left join public.ventas v on lower(btrim(v.asesor)) = lower(btrim(u.nombre))
    group by u.id
    having count(*) filter (where v.tenant <> u.tenant) > count(*) filter (where v.tenant = u.tenant)
  )
  select
    count(*) filter (where u.id is not null and c.id not in (select id from senal_a) and c.id not in (select id from senal_c))
      as solo_tenant_b,
    count(*) filter (where u.id in (select id from sospechosos) and c.id not in (select id from senal_a) and c.id not in (select id from senal_c))
      as solo_tenant_b_de_usuario_sospechoso
  from public.cotizaciones c
  left join public.usuarios u on u.email = c.creado_por
) t;

-- ══ 5 y 6. Clasificación por confianza de evidencia (NO coalesce) ═══════
-- tenant_a: numero_contrato → ventas.tenant (FK real, la más fuerte).
-- tenant_b: creado_por → usuarios.tenant, excluyendo superadmin (candidata,
--           su fiabilidad depende de la sección 3 — nunca se asume sola
--           apta para backfill).
-- tenant_c: asesor (texto) → usuarios.nombre, solo si el nombre NO es
--           ambiguo entre tenants (débil — JAMÁS decide sola).
--
-- Prioridad para clasificar (una fila cae en la PRIMERA que aplique):
--   1. Contradicción A vs. B (ambas presentes y distintas)        → AMBIGUA
--   2. Contradicción A vs. C (ambas presentes y distintas)        → AMBIGUA
--   3. Hay A (sola o de acuerdo con B/C)                          → ESTRUCTURAL
--   4. Contradicción B vs. C (sin A, ambas presentes y distintas) → AMBIGUA
--   5. Hay B, sin A                                               → CANDIDATA (pendiente D1)
--   6. Hay solo C (sin A, sin B)                                  → REVISIÓN MANUAL
--   7. Nada                                                       → SIN NINGUNA SEÑAL
insert into _reporte (orden, seccion, resultado)
select 5, 'clasificacion_5_6', coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
from (
  with senal_a as (
    select c.id, v.tenant as tenant_a
    from public.cotizaciones c
    join public.ventas v on v.numero_contrato = c.numero_contrato
  ),
  senal_b as (
    select c.id, u.tenant as tenant_b
    from public.cotizaciones c
    join public.usuarios u on u.email = c.creado_por
    where u.rol <> 'superadmin'
  ),
  senal_c as (
    select c.id,
      (select min(u.tenant) from public.usuarios u where lower(btrim(u.nombre)) = lower(btrim(c.asesor))) as tenant_c
    from public.cotizaciones c
    where c.asesor is not null and btrim(c.asesor) <> ''
      and (select count(distinct u.tenant) from public.usuarios u where lower(btrim(u.nombre)) = lower(btrim(c.asesor))) = 1
  ),
  clasificado as (
    select
      c.id, c.estado, c.tipo,
      senal_a.tenant_a, senal_b.tenant_b, senal_c.tenant_c
    from public.cotizaciones c
    left join senal_a on senal_a.id = c.id
    left join senal_b on senal_b.id = c.id
    left join senal_c on senal_c.id = c.id
  )
  select
    case
      when tenant_a is not null and tenant_b is not null and tenant_a <> tenant_b
        then 'AMBIGUA — contradicción A (numero_contrato) vs. B (creado_por)'
      when tenant_a is not null and tenant_c is not null and tenant_a <> tenant_c
        then 'AMBIGUA — contradicción A (numero_contrato) vs. C (nombre de asesor)'
      when tenant_a is not null
        then 'ESTRUCTURAL — numero_contrato → ventas.tenant (' || tenant_a || ')'
      when tenant_b is not null and tenant_c is not null and tenant_b <> tenant_c
        then 'AMBIGUA — contradicción B (creado_por) vs. C (nombre de asesor)'
      when tenant_b is not null
        then 'CANDIDATA — creado_por → usuarios.tenant (' || tenant_b || '), pendiente auditar D1 antes de backfill'
      when tenant_c is not null
        then 'REVISIÓN MANUAL — solo coincidencia por nombre (' || tenant_c || ')'
      else 'SIN NINGUNA SEÑAL'
    end as clasificacion,
    count(*) as filas
  from clasificado
  group by 1
  order by 2 desc
) t;

-- ══ 12. IDs y datos mínimos de las AMBIGUAS / REVISIÓN MANUAL ═══════════
-- Misma clasificación exacta de la sección 5 (mismas señales, misma
-- prioridad), pero a nivel de FILA en vez de conteo, filtrada a solo las
-- dos categorías que necesitan una decisión caso por caso. Sin
-- `payload`/`detalle` completos (podrían traer datos del pasajero) y sin
-- `cliente`/`cliente_documento` (dato personal del cliente, innecesario
-- para decidir el tenant): solo columnas operativas + las tres señales.
insert into _reporte (orden, seccion, resultado)
select 12, 'cotizaciones_ambiguas_o_revision_manual', coalesce(jsonb_agg(to_jsonb(t) order by (t->>'id')::bigint), '[]'::jsonb)
from (
  select to_jsonb(f) as t
  from (
    with senal_a as (
      select c.id, v.tenant as tenant_a
      from public.cotizaciones c
      join public.ventas v on v.numero_contrato = c.numero_contrato
    ),
    senal_b as (
      select c.id, u.tenant as tenant_b
      from public.cotizaciones c
      join public.usuarios u on u.email = c.creado_por
      where u.rol <> 'superadmin'
    ),
    senal_c as (
      select c.id,
        (select min(u.tenant) from public.usuarios u where lower(btrim(u.nombre)) = lower(btrim(c.asesor))) as tenant_c
      from public.cotizaciones c
      where c.asesor is not null and btrim(c.asesor) <> ''
        and (select count(distinct u.tenant) from public.usuarios u where lower(btrim(u.nombre)) = lower(btrim(c.asesor))) = 1
    ),
    clasificado as (
      select
        c.id, c.codigo, c.estado, c.tipo, c.created_at, c.destino, c.numero_contrato, c.asesor, c.creado_por,
        senal_a.tenant_a, senal_b.tenant_b, senal_c.tenant_c
      from public.cotizaciones c
      left join senal_a on senal_a.id = c.id
      left join senal_b on senal_b.id = c.id
      left join senal_c on senal_c.id = c.id
    )
    select
      id, codigo, estado, tipo, created_at, destino, numero_contrato, asesor, creado_por,
      tenant_a, tenant_b, tenant_c,
      case
        when tenant_a is not null and tenant_b is not null and tenant_a <> tenant_b
          then 'AMBIGUA — contradicción A (numero_contrato) vs. B (creado_por)'
        when tenant_a is not null and tenant_c is not null and tenant_a <> tenant_c
          then 'AMBIGUA — contradicción A (numero_contrato) vs. C (nombre de asesor)'
        when tenant_a is not null
          then 'ESTRUCTURAL — numero_contrato → ventas.tenant (' || tenant_a || ')'
        when tenant_b is not null and tenant_c is not null and tenant_b <> tenant_c
          then 'AMBIGUA — contradicción B (creado_por) vs. C (nombre de asesor)'
        when tenant_b is not null
          then 'CANDIDATA — creado_por → usuarios.tenant (' || tenant_b || '), pendiente auditar D1 antes de backfill'
        when tenant_c is not null
          then 'REVISIÓN MANUAL — solo coincidencia por nombre (' || tenant_c || ')'
        else 'SIN NINGUNA SEÑAL'
      end as clasificacion
    from clasificado
  ) f
  where f.clasificacion like 'AMBIGUA%' or f.clasificacion like 'REVISIÓN MANUAL%'
) t;

-- ══ 6. Huérfanas en cotizacion_servicios ════════════════════════════════
insert into _reporte (orden, seccion, resultado)
select 6, 'servicios_huerfanos', jsonb_build_object('servicios_huerfanos', (
  select count(*)
  from public.cotizacion_servicios cs
  where not exists (select 1 from public.cotizaciones c where c.id = cs.cotizacion_id)
));

-- ══ 7. Roles con permiso según las policies REALES (no el diseño) ═══════
insert into _reporte (orden, seccion, resultado)
select 7, 'policies_resumen', coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
from (
  select schemaname, tablename, policyname, cmd, roles, qual, with_check
  from pg_policies
  where schemaname = 'public' and tablename in ('cotizaciones', 'cotizacion_servicios')
  order by tablename, cmd
) t;

-- ══ 8/9. ¿Un usuario autenticado de UNA agencia lee cotizaciones/servicios
-- de la OTRA? ═════════════════════════════════════════════════════════════
--
-- ⚠️ NO se evalúa `ventas.tenant` mientras el rol impersonado sigue activo.
-- `ventas` tiene su PROPIA RLS (filtra por tenant); si se hiciera el join
-- contra `ventas` estando impersonado, una fila ajena que esa RLS le oculte
-- al usuario devolvería `tenant = NULL` — pareciendo "no es de otro tenant"
-- cuando en realidad SÍ es una cotización visible que pertenece a un
-- contrato ajeno.
--
-- Mecánica, en dos fases:
--   Fase 1 (impersonado): leer SOLO columnas nativas de `cotizaciones` (id,
--     numero_contrato) — no se hace ningún join a `ventas` todavía.
--   Fase 2 (reset role, como superusuario): recién ahí cruzar esos
--     numero_contrato capturados contra `ventas.tenant`, ya sin RLS de por
--     medio, para saber el tenant REAL de cada contrato referenciado.
create temp table _visibles_cot (
  usuario text, rol text, tenant_usuario text,
  cotizacion_id bigint, numero_contrato text
) on commit drop;

create temp table _visibles_serv (
  usuario text, tenant_usuario text, servicio_id bigint, cotizacion_id bigint
) on commit drop;

do $$
declare
  u record;
  v_cot_ids   bigint[];
  v_cot_nums  text[];
  v_serv_ids  bigint[];
  v_serv_cids bigint[];
begin
  for u in
    select id, email, rol::text as rol, tenant
    from public.usuarios
    where activo and rol <> 'superadmin' and rol in ('gerencia','administracion','operaciones','venta')
    order by tenant, rol, email
  loop
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims',
      json_build_object('sub', u.id, 'role', 'authenticated')::text, true);

    -- Fase 1: solo columnas nativas de cotizaciones/cotizacion_servicios,
    -- SIN tocar `ventas` mientras el rol impersonado sigue activo. El
    -- resultado se guarda en ARRAYS de variables PL/pgSQL — no en la tabla
    -- temporal directamente: el rol `authenticated` no tiene privilegio de
    -- escritura sobre una tabla temporal creada por la sesión superusuario,
    -- y forzarlo requeriría un GRANT que este script, al ser de solo
    -- lectura, no debe otorgar. El mismo patrón (capturar en variables,
    -- escribir recién tras `reset role`) ya lo usa `test_rls_por_rol.sql`.
    --
    -- ⚠️ Los dos array_agg de cada select DEBEN llevar el MISMO `order by`
    -- explícito. Sin él, PostgreSQL no garantiza que ambos agregados
    -- procesen las filas en el mismo orden — son dos acumuladores
    -- independientes, y aunque en la práctica casi siempre comparten el
    -- mismo plan de escaneo, eso es un detalle de implementación, no una
    -- garantía del estándar. Emparejarlos después por POSICIÓN vía
    -- `unnest` en paralelo sin ese orden explícito sería depender de un
    -- orden incidental. Ordenar ambos por `id` hace la correspondencia
    -- correcta por construcción, no por suerte del planificador.
    select array_agg(c.id order by c.id), array_agg(c.numero_contrato order by c.id)
      into v_cot_ids, v_cot_nums
      from public.cotizaciones c;

    select array_agg(s.id order by s.id), array_agg(s.cotizacion_id order by s.id)
      into v_serv_ids, v_serv_cids
      from public.cotizacion_servicios s;

    reset role;
    perform set_config('request.jwt.claims', '{}', true);

    -- Fase 1.b (ya como superusuario, pero con los datos capturados MIENTRAS
    -- estaba impersonado): vuelca los arrays a la tabla temporal.
    insert into _visibles_cot (usuario, rol, tenant_usuario, cotizacion_id, numero_contrato)
    select u.email, u.rol, u.tenant, x.id, x.num
    from unnest(coalesce(v_cot_ids, '{}'), coalesce(v_cot_nums, '{}')) as x(id, num);

    insert into _visibles_serv (usuario, tenant_usuario, servicio_id, cotizacion_id)
    select u.email, u.tenant, x.id, x.cid
    from unnest(coalesce(v_serv_ids, '{}'), coalesce(v_serv_cids, '{}')) as x(id, cid);
  end loop;
end $$;

-- ── Control de integridad del emparejamiento (real, no sintético) ───────
-- Verifica, contra los datos REALES de esta corrida (no un caso fabricado
-- aparte), que cada `cotizacion_id` capturado en `_visibles_cot` conserva
-- el `numero_contrato` que de verdad tiene esa fila en `cotizaciones` —
-- es decir, que `array_agg(... order by id)` + `unnest` en paralelo no
-- desordenó ninguna pareja al capturar y reconstruir. Si alguna vez se
-- quita el `order by` o se cambia el criterio de orden entre los dos
-- array_agg de un mismo select, este bloque lo detecta con
-- `raise exception` en vez de dejar pasar un diagnóstico con parejas
-- cruzadas en silencio — ese `raise exception` (y el de más abajo) siguen
-- intactos: si cualquiera de los dos controles falla, la transacción entera
-- aborta y NO se llega a producir el reporte final.
do $$
declare
  v_desajustes_cot  bigint;
  v_desajustes_serv bigint;
  v_n_visibles_cot  bigint;
  v_n_visibles_serv bigint;
  v_n_contratos_distintos bigint;
begin
  select count(*) into v_desajustes_cot
  from _visibles_cot v
  join public.cotizaciones c on c.id = v.cotizacion_id
  where v.numero_contrato is distinct from c.numero_contrato;

  if v_desajustes_cot > 0 then
    raise exception 'CONTROL DE INTEGRIDAD FALLÓ: % filas en _visibles_cot quedaron con un numero_contrato distinto al real de cotizaciones.id — el emparejamiento id↔numero_contrato se corrompió al capturar/reconstruir.', v_desajustes_cot;
  end if;

  select count(*) into v_desajustes_serv
  from _visibles_serv v
  join public.cotizacion_servicios s on s.id = v.servicio_id
  where v.cotizacion_id is distinct from s.cotizacion_id;

  if v_desajustes_serv > 0 then
    raise exception 'CONTROL DE INTEGRIDAD FALLÓ: % filas en _visibles_serv quedaron con un cotizacion_id distinto al real de cotizacion_servicios.id.', v_desajustes_serv;
  end if;

  select count(*) into v_n_visibles_cot from _visibles_cot;
  select count(*) into v_n_visibles_serv from _visibles_serv;
  select count(distinct numero_contrato) into v_n_contratos_distintos
    from public.cotizaciones where numero_contrato is not null;

  raise notice 'CONTROL DE INTEGRIDAD OK: las % filas de _visibles_cot y las % de _visibles_serv conservan exactamente su numero_contrato/cotizacion_id real tras array_agg(order by id)/unnest — verificado contra % cotizaciones con numero_contrato distinto entre sí en esta corrida.',
    v_n_visibles_cot, v_n_visibles_serv, v_n_contratos_distintos;

  insert into _controles (subseccion, resultado) values ('emparejamiento_id_numero_contrato', jsonb_build_object(
    'estado', 'OK',
    'desajustes_cotizaciones', v_desajustes_cot,
    'desajustes_servicios', v_desajustes_serv,
    'filas_visibles_cot_verificadas', v_n_visibles_cot,
    'filas_visibles_serv_verificadas', v_n_visibles_serv,
    'contratos_distintos_en_la_corrida', v_n_contratos_distintos
  ));
end $$;

-- ── 8. Fase 2 (superusuario, sin RLS): resolver el tenant real de cada
-- numero_contrato capturado y comparar contra el tenant del usuario.
insert into _reporte (orden, seccion, resultado)
select 8, 'cruce_autenticado_cotizaciones', coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
from (
  select
    usuario, rol, tenant_usuario as agencia_usuario,
    count(*)                                                                                   as cotizaciones_visibles,
    count(*) filter (where vt.tenant is not distinct from tenant_usuario)                       as de_su_agencia,
    count(*) filter (where vt.tenant is distinct from tenant_usuario and vt.tenant is not null) as de_otra_agencia,
    count(*) filter (where vt.tenant is null and v.numero_contrato is not null)                 as con_numero_contrato_sin_venta,
    count(*) filter (where v.numero_contrato is null)                                           as abiertas_sin_numero_contrato,
    case
      when count(*) filter (where vt.tenant is distinct from tenant_usuario and vt.tenant is not null) > 0
        then 'FUGA — lee cotizaciones convertidas de contratos de la otra agencia'
      else 'sin fuga detectable por esta señal (no cubre lo que sigue "abierta")'
    end as veredicto
  from _visibles_cot v
  left join public.ventas vt on vt.numero_contrato = v.numero_contrato
  group by usuario, rol, tenant_usuario
  order by (count(*) filter (where vt.tenant is distinct from tenant_usuario and vt.tenant is not null)) desc, tenant_usuario, usuario
) t;

-- ── 9. Extensión a cotizacion_servicios: ¿puede leer servicios cuyo PADRE
-- pertenece a la otra agencia? Misma mecánica de dos fases (el padre se
-- resuelve DESPUÉS de reset role).
insert into _reporte (orden, seccion, resultado)
select 9, 'cruce_autenticado_servicios', coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
from (
  select
    vs.usuario, vs.tenant_usuario as agencia_usuario,
    count(*)                                                                                      as servicios_visibles,
    count(*) filter (where vt.tenant is not distinct from vs.tenant_usuario)                       as con_padre_de_su_agencia,
    count(*) filter (where vt.tenant is distinct from vs.tenant_usuario and vt.tenant is not null)  as con_padre_de_otra_agencia,
    count(*) filter (where vt.tenant is null)                                                       as con_padre_sin_numero_contrato_o_venta,
    case
      when count(*) filter (where vt.tenant is distinct from vs.tenant_usuario and vt.tenant is not null) > 0
        then 'FUGA — lee servicios de una cotización cuyo contrato es de la otra agencia'
      else 'sin fuga detectable por esta señal'
    end as veredicto
  from _visibles_serv vs
  join public.cotizaciones c on c.id = vs.cotizacion_id
  left join public.ventas vt on vt.numero_contrato = c.numero_contrato
  group by vs.usuario, vs.tenant_usuario
  order by (count(*) filter (where vt.tenant is distinct from vs.tenant_usuario and vt.tenant is not null)) desc
) t;

-- ⚠️ Nota de interpretación (aplica a las secciones 8 y 9): esto solo puede
-- confirmarse para lo YA CONVERTIDO (numero_contrato → ventas.tenant). Lo
-- que sigue "abierta" también se cuenta en "…_visibles", pero no hay con qué
-- confirmar su tenant real desde esta prueba — por eso la sección 5 existe
-- aparte y "de_otra_agencia = 0" no se debe leer como "no hay fuga posible",
-- sino como "no hay fuga CONFIRMABLE por esta señal".

-- ── Control negativo (lógica, no datos reales) ───────────────────────────
-- Prueba que el MECANISMO de arriba (capturar visibles → reset role →
-- resolver tenant real) SÍ marca "FUGA" cuando corresponde, usando datos
-- 100% sintéticos en tablas temporales. Nunca toca `cotizaciones` ni
-- `ventas` reales. Si la lógica se rompiera (p. ej. alguien la reescribe mal
-- en el futuro y vuelve a introducir el bug original), este bloque hace
-- `raise exception` y el script entero falla de forma ruidosa en vez de
-- reportar en silencio un diagnóstico incorrecto.
do $$
declare
  v_otro_tenant   bigint;
  v_su_tenant     bigint;
  v_sin_venta     bigint;
begin
  create temp table _test_visibles (tenant_usuario text, cotizacion_id bigint, numero_contrato text) on commit drop;
  create temp table _test_ventas (numero_contrato text, tenant text) on commit drop;

  insert into _test_visibles values
    ('mayorista', 9001, 'TEST-FUGA-0001'),    -- visible, pero el contrato es de la OTRA agencia
    ('mayorista', 9002, 'TEST-PROPIO-0001'),  -- visible y el contrato es de SU agencia
    ('mayorista', 9003, null);                -- visible, sin numero_contrato (abierta) — no debe contar ni a favor ni en contra

  insert into _test_ventas values
    ('TEST-FUGA-0001', 'minorista'),
    ('TEST-PROPIO-0001', 'mayorista');

  select
    count(*) filter (where vt.tenant is distinct from tv.tenant_usuario and vt.tenant is not null),
    count(*) filter (where vt.tenant is not distinct from tv.tenant_usuario),
    count(*) filter (where vt.tenant is null and tv.numero_contrato is null)
  into v_otro_tenant, v_su_tenant, v_sin_venta
  from _test_visibles tv
  left join _test_ventas vt on vt.numero_contrato = tv.numero_contrato;

  if v_otro_tenant <> 1 then
    raise exception 'CONTROL NEGATIVO FALLÓ: se esperaba 1 fila marcada como FUGA, se obtuvieron %', v_otro_tenant;
  end if;
  if v_su_tenant <> 1 then
    raise exception 'CONTROL NEGATIVO FALLÓ: se esperaba 1 fila de la propia agencia, se obtuvieron %', v_su_tenant;
  end if;
  if v_sin_venta <> 1 then
    raise exception 'CONTROL NEGATIVO FALLÓ: se esperaba 1 fila sin numero_contrato (sin señal), se obtuvieron %', v_sin_venta;
  end if;

  raise notice 'CONTROL NEGATIVO OK: de 3 filas sintéticas visibles, el mecanismo marca exactamente 1 como FUGA (contrato de la otra agencia), 1 como propia y 1 sin señal — tal como debe.';

  insert into _controles (subseccion, resultado) values ('control_negativo_sintetico', jsonb_build_object(
    'estado', 'OK',
    'filas_marcadas_fuga', v_otro_tenant,
    'filas_propia_agencia', v_su_tenant,
    'filas_sin_senal', v_sin_venta
  ));
end $$;

-- ══ 11. Consolidar los dos controles de integridad en una sola sección ══
insert into _reporte (orden, seccion, resultado)
select 11, 'controles_de_integridad', jsonb_object_agg(subseccion, resultado)
from _controles;

-- ══ 10. ¿Un usuario ANÓNIMO (sin sesión) puede leerlas? ═════════════════
-- Distingue TRES resultados posibles, no dos:
--   a) SELECT ejecutado, 0 filas   → RLS bloquea al anónimo (lo esperado).
--   b) SELECT ejecutado, N>0 filas → ACCESO PÚBLICO ANÓNIMO real.
--   c) permission denied            → el rol `anon` no tiene ni el GRANT de
--      tabla (más restrictivo que "RLS en 0"; NO es lo mismo y no debe
--      reportarse igual). Se captura para que esta excepción no aborte el
--      resto del diagnóstico.
create temp table _anon_cot (tabla text, resultado text, filas bigint) on commit drop;

-- ⚠️ El INSERT del resultado en `_anon_cot` NUNCA puede ir dentro del bloque
-- impersonado: el rol `anon` no tiene privilegio de escritura sobre una
-- tabla temporal creada por la sesión superusuario (mismo problema ya
-- corregido en el bloque 9), y si el INSERT del camino "éxito" corre
-- todavía como `anon`, SU PROPIO permission-denied lo atraparía el mismo
-- `exception when insufficient_privilege` — reportando falsamente que el
-- SELECT contra `cotizaciones` fue lo que falló, cuando en realidad el
-- SELECT sí había funcionado. Por eso el resultado se guarda en variables
-- PL/pgSQL y el INSERT se hace recién después de `reset role`.
do $$
declare
  n bigint;
  err text;
  v_resultado text;
  v_filas bigint;
begin
  begin
    execute 'set local role anon';
    perform set_config('request.jwt.claims', '{}', true);
    select count(*) into n from public.cotizaciones;
    v_resultado := 'select ejecutado';
    v_filas := n;
  exception
    when insufficient_privilege then
      v_resultado := 'sin privilegio SELECT (permission denied)';
      v_filas := null;
    when others then
      get stacked diagnostics err = message_text;
      v_resultado := 'error inesperado: ' || err;
      v_filas := null;
  end;
  reset role;
  perform set_config('request.jwt.claims', null, true);
  insert into _anon_cot values ('cotizaciones', v_resultado, v_filas);
end $$;

do $$
declare
  n bigint;
  err text;
  v_resultado text;
  v_filas bigint;
begin
  begin
    execute 'set local role anon';
    perform set_config('request.jwt.claims', '{}', true);
    select count(*) into n from public.cotizacion_servicios;
    v_resultado := 'select ejecutado';
    v_filas := n;
  exception
    when insufficient_privilege then
      v_resultado := 'sin privilegio SELECT (permission denied)';
      v_filas := null;
    when others then
      get stacked diagnostics err = message_text;
      v_resultado := 'error inesperado: ' || err;
      v_filas := null;
  end;
  reset role;
  perform set_config('request.jwt.claims', null, true);
  insert into _anon_cot values ('cotizacion_servicios', v_resultado, v_filas);
end $$;

insert into _reporte (orden, seccion, resultado)
select 10, 'resultado_anonimo', coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
from (
  select tabla, resultado, filas,
    case
      when resultado = 'select ejecutado' and filas > 0 then 'ACCESO PÚBLICO ANÓNIMO ⚠️'
      when resultado = 'select ejecutado' and filas = 0 then 'sin acceso anónimo (RLS en 0 filas)'
      when resultado like 'sin privilegio%' then 'sin acceso anónimo (bloqueado por GRANT, ni siquiera llega a evaluar RLS)'
      else 'revisar manualmente: ' || resultado
    end as veredicto
  from _anon_cot
) t;

-- ══ REPORTE FINAL CONSOLIDADO — el único resultado que hay que mirar ════
-- Una fila por sección, en el orden de la tabla de arriba. Cada `resultado`
-- es JSON (objeto o arreglo según la sección) — expandible en el editor de
-- Supabase con clic en la celda, o copiable entero como JSON.
select seccion, resultado
from _reporte
order by orden;

rollback;
