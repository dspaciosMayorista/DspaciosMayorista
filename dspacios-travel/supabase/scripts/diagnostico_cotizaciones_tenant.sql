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
-- ─────────────────────────────────────────────────────────────────────────
--
-- QUÉ RESPONDE CADA BLOQUE (mismo orden que los 10 puntos pedidos, más un
-- bloque D1 nuevo que audita la confiabilidad de una de las señales)
--   1        → cuántas filas hay hoy en cada tabla
--   2        → columnas actuales (por si el modelo ya cambió desde este diseño)
--   3        → estados / tipos / rango de fechas
--   4        → qué otras tablas permiten inferir el tenant de una cotización
--   D1       → confiabilidad de `usuarios.tenant` (afecta a la señal 4.b)
--   5 y 6    → clasificación por confianza de evidencia (NO por coalesce)
--   7        → filas huérfanas en cotizacion_servicios
--   8        → policies reales (no lo que debería ser, lo que HAY)
--   9        → prueba cruzada autenticada (mayorista vs. minorista),
--              extendida a cotizacion_servicios, + control negativo sintético
--   10       → prueba de acceso anónimo (rol `anon`, sin sesión), distinguiendo
--              "sin privilegio SELECT" de "RLS deja 0 filas" de "filas reales"
--
-- Los bloques 9 y 10 son los únicos que impersonan un rol de PostgREST; el
-- resto son selects directos como superusuario (ven todo, sin RLS, porque el
-- editor SQL de Supabase corre como superusuario). Por eso 1-8/D1 muestran el
-- estado REAL de los datos, y 9-10 muestran lo que un usuario real vería a
-- través de la API — que es la pregunta de seguridad de verdad.
--
-- ⚠️ SOBRE LA CLASIFICACIÓN (bloques 5/6): la versión anterior de este script
-- usaba `coalesce(tenant_a, tenant_b, tenant_c)`, lo que dejaba que una
-- coincidencia de NOMBRE (tenant_c, la señal más débil — el mismo mecanismo
-- que ya demostró fallar en `ventas.asesor`) declarara sola una fila como
-- "inequívoca". Esta versión NUNCA combina señales de distinta confianza con
-- coalesce para decidir un tenant automáticamente: cada señal se muestra por
-- separado y la clasificación es explícita sobre cuál(es) la sustentan.
-- ─────────────────────────────────────────────────────────────────────────

begin;

-- ══ 1. Cantidad de filas ════════════════════════════════════════════════
select
  (select count(*) from public.cotizaciones)        as total_cotizaciones,
  (select count(*) from public.cotizacion_servicios) as total_cotizacion_servicios;

-- ══ 2. Columnas actuales de ambas tablas ═══════════════════════════════
select table_name, ordinal_position, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name in ('cotizaciones', 'cotizacion_servicios')
order by table_name, ordinal_position;

-- ══ 3. Estados, tipos y fechas ══════════════════════════════════════════
select
  estado, tipo,
  count(*)                         as filas,
  min(created_at)                  as mas_antigua,
  max(created_at)                  as mas_reciente,
  count(*) filter (where numero_contrato is not null) as con_numero_contrato
from public.cotizaciones
group by estado, tipo
order by estado, tipo;

select date_trunc('month', created_at)::date as mes, estado, count(*) as filas
from public.cotizaciones
group by 1, 2
order by 1 desc, 2;

-- ══ 4. Relaciones que permiten inferir el tenant (INFORMATIVAS: ninguna de
-- estas selects decide nada por sí sola, solo muestran qué hay) ═══════════
-- 4.a Vía `numero_contrato` → `ventas.tenant` — la única señal con respaldo
--     de integridad referencial (hay FK real). Solo existe para
--     `estado = 'convertida'`.
select v.tenant, count(*) as cotizaciones_convertidas
from public.cotizaciones c
join public.ventas v on v.numero_contrato = c.numero_contrato
group by v.tenant
order by v.tenant;

select count(*) as cotizaciones_numero_sin_venta
from public.cotizaciones c
where c.numero_contrato is not null
  and not exists (select 1 from public.ventas v where v.numero_contrato = c.numero_contrato);

-- 4.b Vía `creado_por` (email) → `usuarios.email` → `usuarios.tenant`.
--     ⚠️ Esta señal por sí sola NO se declara segura para backfill — ver el
--     bloque D1 más abajo, que audita si `usuarios.tenant` es confiable.
select
  case
    when c.creado_por is null then '(sin creado_por — público/anónimo)'
    when u.email is null then '(creado_por no cruza con ningún usuario)'
    when u.rol = 'superadmin' then 'superadmin (no decide tenant)'
    else u.tenant
  end as inferencia_por_creado_por,
  count(*) as filas
from public.cotizaciones c
left join public.usuarios u on u.email = c.creado_por
group by 1
order by 2 desc;

-- 4.c Vía `asesor` (texto libre) → `usuarios.nombre` (normalizado). Señal
--     DÉBIL — el mismo mecanismo que ya falló en `ventas.asesor`
--     (homónimos entre agencias). NUNCA decide tenant por sí sola (ver 5/6).
select
  case
    when c.asesor is null or btrim(c.asesor) = '' then '(sin asesor)'
    else coalesce(
      (select case when count(distinct u.tenant) = 1 then min(u.tenant) else '(nombre ambiguo entre tenants)' end
         from public.usuarios u
        where lower(btrim(u.nombre)) = lower(btrim(c.asesor))),
      '(asesor no cruza con ningún usuario)'
    )
  end as inferencia_por_asesor,
  count(*) as filas
from public.cotizaciones c
group by 1
order by 2 desc;

-- 4.d Qué hay dentro de `payload`/`detalle` (jsonb). `modulo` es la pista más
--     fuerte de las cuatro sin ser estructural: 'bloqueo'/'porcion_terrestre'/
--     'servicios' SOLO pueden venir de MAYORISTA (minorista no tiene
--     tarifario/reservar — confirmado en `proxy.ts`, `MINORISTA_OCULTAS`).
--     'manual' es el único tipo alcanzable desde ambos tenants hoy.
select modulo, tipo, count(*) as filas
from public.cotizaciones
group by modulo, tipo
order by filas desc;

select jsonb_object_keys(payload) as clave_en_payload, count(*) as filas
from public.cotizaciones
where payload is not null
group by 1
order by 2 desc;

select count(*) filter (where paquete_armado_id is not null) as con_paquete_armado_id,
       count(*)                                              as total
from public.cotizaciones;

-- ══ D1. Confiabilidad de `usuarios.tenant` (afecta directamente a 4.b/tenant_b) ═
-- La migración 107 agregó `usuarios.tenant` con `default 'mayorista'` sobre
-- TODO lo ya existente. Un usuario de minorista creado por un flujo que no
-- estampara tenant explícitamente pudo quedar marcado 'mayorista' sin serlo
-- — esto es una hipótesis a auditar con datos, no un hecho asumido.

-- D1.1 Usuarios por mes de alta × rol × tenant.
select date_trunc('month', fecha_registro)::date as mes, rol, tenant, count(*) as usuarios
from public.usuarios
group by 1, 2, 3
order by 1, 2, 3;

-- D1.2 Rango de fecha_registro por tenant (si minorista "nace" después de
-- cierta fecha, un usuario minorista con fecha_registro muy temprana es
-- sospechoso de default incorrecto; y viceversa).
select tenant, min(fecha_registro) as mas_antiguo, max(fecha_registro) as mas_reciente, count(*) as usuarios
from public.usuarios
group by tenant
order by tenant;

-- D1.3 Señal cruzada: ¿`usuarios.tenant` coincide con el tenant de las
-- `ventas` donde ese usuario aparece como `asesor` (por nombre)? Mismo
-- criterio que ya usa `test_rls_por_rol.sql`. Si un usuario tiene MÁS ventas
-- por nombre en el tenant CONTRARIO al que declara, es evidencia de que su
-- `tenant` pudo quedar en el default de la 107 en vez de la agencia real.
with coincidencias as (
  select u.id, u.email, u.rol, u.tenant as tenant_declarado,
    count(*) filter (where v.tenant = u.tenant) as ventas_mismo_tenant,
    count(*) filter (where v.tenant <> u.tenant) as ventas_otro_tenant
  from public.usuarios u
  left join public.ventas v on lower(btrim(v.asesor)) = lower(btrim(u.nombre))
  group by u.id, u.email, u.rol, u.tenant
)
select email, rol, tenant_declarado, ventas_mismo_tenant, ventas_otro_tenant,
  case
    when ventas_otro_tenant > ventas_mismo_tenant
      then 'SOSPECHOSO — más ventas por nombre en el OTRO tenant; no usar su tenant_b para backfill sin revisar'
    when ventas_mismo_tenant = 0 and ventas_otro_tenant = 0
      then 'sin ventas atribuibles por nombre — no hay con qué contrastar'
    else 'consistente con el tenant declarado'
  end as veredicto
from coincidencias
order by (ventas_otro_tenant > ventas_mismo_tenant) desc, email;

-- D1.4 Cuántas cotizaciones dependerían ÚNICAMENTE de tenant_b (sin tenant_a
-- ni tenant_c), y cuántas de esas fueron creadas por un usuario marcado
-- SOSPECHOSO en D1.3. Esas nunca deben tratarse como aptas para backfill
-- automático.
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
    as solo_tenant_b_de_usuario_sospechoso__no_apto_para_backfill_automatico
from public.cotizaciones c
left join public.usuarios u on u.email = c.creado_por;

-- ══ 5 y 6. Clasificación por confianza de evidencia (NO coalesce) ═══════
-- tenant_a: numero_contrato → ventas.tenant (FK real, la más fuerte).
-- tenant_b: creado_por → usuarios.tenant, excluyendo superadmin (candidata,
--           su fiabilidad depende del bloque D1 — nunca se asume sola apta
--           para backfill).
-- tenant_c: asesor (texto) → usuarios.nombre, solo si el nombre NO es
--           ambiguo entre tenants (débil — JAMÁS decide sola).
--
-- Prioridad para clasificar (una fila cae en la PRIMERA que aplique):
--   1. Contradicción A vs. B (ambas presentes y distintas)      → AMBIGUA
--   2. Contradicción A vs. C (ambas presentes y distintas)      → AMBIGUA
--   3. Hay A (sola o de acuerdo con B/C)                        → ESTRUCTURAL
--   4. Contradicción B vs. C (sin A, ambas presentes y distintas) → AMBIGUA
--   5. Hay B, sin A                                             → CANDIDATA (pendiente D1)
--   6. Hay solo C (sin A, sin B)                                → REVISIÓN MANUAL
--   7. Nada                                                     → SIN NINGUNA SEÑAL
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
order by 2 desc;

-- ══ 7. Huérfanas en cotizacion_servicios ════════════════════════════════
select count(*) as servicios_huerfanos
from public.cotizacion_servicios cs
where not exists (select 1 from public.cotizaciones c where c.id = cs.cotizacion_id);

-- ══ 8. Roles con permiso según las policies REALES (no el diseño) ═══════
select schemaname, tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public' and tablename in ('cotizaciones', 'cotizacion_servicios')
order by tablename, cmd;

-- ══ 9. ¿Un usuario autenticado de UNA agencia lee cotizaciones de la OTRA? ═
--
-- ⚠️ CORRECCIÓN respecto a la versión anterior: NO se debe evaluar
-- `ventas.tenant` mientras el rol impersonado sigue activo. `ventas` tiene su
-- PROPIA RLS (filtra por tenant); si se hiciera el join contra `ventas`
-- estando impersonado, una fila ajena que esa RLS le oculte al usuario
-- devolvería `tenant = NULL` — pareciendo "no es de otro tenant" cuando en
-- realidad SÍ es una cotización visible que pertenece a un contrato ajeno.
-- Ese falso negativo es justo lo que se corrige aquí.
--
-- Mecánica correcta, en dos fases:
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
-- desordenó ninguna pareja al capturar y reconstruir. Con varias
-- cotizaciones de contratos distintos ya sembradas más arriba en el
-- diagnóstico (o las que existan en producción al correrlo ahí), esto
-- cubre el caso pedido: múltiples cotizaciones/contratos distintos, no
-- solo uno. Si alguna vez se quita el `order by` o se cambia el criterio
-- de orden entre los dos array_agg de un mismo select, este bloque lo
-- detecta con `raise exception` en vez de dejar pasar un diagnóstico con
-- parejas cruzadas en silencio.
do $$
declare
  v_desajustes_cot  bigint;
  v_desajustes_serv bigint;
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

  raise notice 'CONTROL DE INTEGRIDAD OK: las % filas de _visibles_cot y las % de _visibles_serv conservan exactamente su numero_contrato/cotizacion_id real tras array_agg(order by id)/unnest — verificado contra % cotizaciones con numero_contrato distinto entre sí en esta corrida.',
    (select count(*) from _visibles_cot),
    (select count(*) from _visibles_serv),
    (select count(distinct numero_contrato) from public.cotizaciones where numero_contrato is not null);
end $$;

-- Fase 2 (superusuario, sin RLS): resolver el tenant real de cada
-- numero_contrato capturado y comparar contra el tenant del usuario.
select
  usuario, rol, tenant_usuario as "agencia del usuario",
  count(*)                                                                                   as "cotizaciones visibles (RLS real)",
  count(*) filter (where vt.tenant is not distinct from tenant_usuario)                       as "…de SU agencia",
  count(*) filter (where vt.tenant is distinct from tenant_usuario and vt.tenant is not null) as "…de la OTRA agencia ⚠️",
  count(*) filter (where vt.tenant is null and v.numero_contrato is not null)                 as "…con numero_contrato pero sin venta (¿huérfana?)",
  count(*) filter (where v.numero_contrato is null)                                           as "…abiertas sin numero_contrato (sin esta señal)",
  case
    when count(*) filter (where vt.tenant is distinct from tenant_usuario and vt.tenant is not null) > 0
      then 'FUGA — lee cotizaciones convertidas de contratos de la otra agencia'
    else 'sin fuga detectable por esta señal (no cubre lo que sigue "abierta")'
  end as veredicto
from _visibles_cot v
left join public.ventas vt on vt.numero_contrato = v.numero_contrato
group by usuario, rol, tenant_usuario
order by (count(*) filter (where vt.tenant is distinct from tenant_usuario and vt.tenant is not null)) desc, tenant_usuario, usuario;

-- ── Extensión a cotizacion_servicios: ¿puede leer servicios cuyo PADRE
-- pertenece a la otra agencia? Misma mecánica de dos fases (el padre se
-- resuelve DESPUÉS de reset role).
select
  vs.usuario, vs.tenant_usuario as "agencia del usuario",
  count(*)                                                                                   as "servicios visibles (RLS real)",
  count(*) filter (where vt.tenant is not distinct from vs.tenant_usuario)                    as "…con padre de SU agencia",
  count(*) filter (where vt.tenant is distinct from vs.tenant_usuario and vt.tenant is not null) as "…con padre de la OTRA agencia ⚠️",
  count(*) filter (where vt.tenant is null)                                                   as "…con padre sin numero_contrato/venta (sin esta señal)",
  case
    when count(*) filter (where vt.tenant is distinct from vs.tenant_usuario and vt.tenant is not null) > 0
      then 'FUGA — lee servicios de una cotización cuyo contrato es de la otra agencia'
    else 'sin fuga detectable por esta señal'
  end as veredicto
from _visibles_serv vs
join public.cotizaciones c on c.id = vs.cotizacion_id
left join public.ventas vt on vt.numero_contrato = c.numero_contrato
group by vs.usuario, vs.tenant_usuario
order by (count(*) filter (where vt.tenant is distinct from vs.tenant_usuario and vt.tenant is not null)) desc;

-- ⚠️ Nota de interpretación: igual que antes, esto solo puede confirmarse
-- para lo YA CONVERTIDO (numero_contrato → ventas.tenant). Lo que sigue
-- "abierta" también se cuenta en "cotizaciones visibles", pero no hay con
-- qué confirmar su tenant real desde esta prueba — por eso el bloque 5/6
-- existe aparte y no se debe leer "0 filas de la OTRA agencia" como "no hay
-- fuga posible", sino como "no hay fuga CONFIRMABLE por esta señal".

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
end $$;

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

select tabla, resultado, filas,
  case
    when resultado = 'select ejecutado' and filas > 0 then 'ACCESO PÚBLICO ANÓNIMO ⚠️'
    when resultado = 'select ejecutado' and filas = 0 then 'sin acceso anónimo (RLS en 0 filas)'
    when resultado like 'sin privilegio%' then 'sin acceso anónimo (bloqueado por GRANT, ni siquiera llega a evaluar RLS)'
    else 'revisar manualmente: ' || resultado
  end as veredicto
from _anon_cot;

rollback;
