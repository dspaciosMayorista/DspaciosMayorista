-- ─────────────────────────────────────────────────────────────────────────
-- DIAGNÓSTICO · aislamiento por tenant de `cotizaciones`/`cotizacion_servicios`
-- SOLO LECTURA. Se pega completo en el editor SQL de Supabase y se ejecuta.
-- No inserta, no actualiza, no borra, no crea funciones ni policies
-- permanentes. Termina en ROLLBACK: cualquier objeto temporal desaparece
-- al terminar, incluida la sesión con rol `authenticated` impersonado.
-- ─────────────────────────────────────────────────────────────────────────
--
-- QUÉ RESPONDE CADA BLOQUE (mismo orden que los 10 puntos pedidos)
--   1        → cuántas filas hay hoy en cada tabla
--   2        → columnas actuales (por si el modelo ya cambió desde este diseño)
--   3        → estados / tipos / rango de fechas
--   4        → qué otras tablas permiten inferir el tenant de una cotización
--   5 y 6    → cuántas quedan sin ambigüedad vs. cuántas no se pueden asignar
--   7        → filas huérfanas en cotizacion_servicios
--   8        → policies reales (no lo que debería ser, lo que HAY)
--   9        → prueba cruzada autenticada (mayorista vs. minorista)
--   10       → prueba de acceso anónimo (rol `anon`, sin sesión)
--
-- Los bloques 9 y 10 son los únicos que impersonan un rol de PostgREST; el
-- resto son selects directos como superusuario (ven todo, sin RLS, porque el
-- editor SQL de Supabase corre como superusuario). Por eso 1-8 muestran el
-- estado REAL de los datos, y 9-10 muestran lo que un usuario real vería a
-- través de la API — que es la pregunta de seguridad de verdad.
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
-- 3.a Por estado × tipo (cuántas filas, precio total, rango de fechas)
select
  estado, tipo,
  count(*)                         as filas,
  min(created_at)                  as mas_antigua,
  max(created_at)                  as mas_reciente,
  count(*) filter (where numero_contrato is not null) as con_numero_contrato
from public.cotizaciones
group by estado, tipo
order by estado, tipo;

-- 3.b Histórico mensual (para ver si es un problema activo o solo histórico)
select date_trunc('month', created_at)::date as mes, estado, count(*) as filas
from public.cotizaciones
group by 1, 2
order by 1 desc, 2;

-- ══ 4. Relaciones que permiten inferir el tenant ════════════════════════
-- 4.a Vía `numero_contrato` → `ventas.tenant` (el único vínculo estructural
--     hoy: solo existe una vez que `estado = 'convertida'`).
select
  v.tenant,
  count(*) as cotizaciones_convertidas
from public.cotizaciones c
join public.ventas v on v.numero_contrato = c.numero_contrato
group by v.tenant
order by v.tenant;

-- ¿Hay cotizaciones con numero_contrato que NO cruza contra ventas?
-- (no debería pasar, hay FK — es un chequeo de integridad, no de tenant)
select count(*) as cotizaciones_numero_sin_venta
from public.cotizaciones c
where c.numero_contrato is not null
  and not exists (select 1 from public.ventas v where v.numero_contrato = c.numero_contrato);

-- 4.b Vía `creado_por` (email) → `usuarios.email` → `usuarios.tenant`.
--     Aplica sobre todo a `tipo='tarifario'`/`'carrito'` (el checkout público
--     guarda el email del aliado autenticado si lo hay) y a lo creado desde
--     dashboard/cotizaciones. Se separa "usuario interno de un solo tenant"
--     de "superadmin" (alcance global, no decide nada) y de "sin match"
--     (público sin login, o email que ya no existe en usuarios).
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

-- 4.c Vía `asesor` (texto libre) → `usuarios.nombre` (normalizado, mismo
--     criterio que `soy_asesor_del_contrato`). Señal DÉBIL: dos usuarios de
--     tenants distintos pueden compartir nombre (ya documentado como riesgo
--     real en `ventas.asesor`, ver `diagnostico_contratos_b2b.sql`).
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

-- 4.d Qué hay realmente dentro de `payload`/`detalle` (jsonb) — para saber si
--     ya traen algo aprovechable (ej. un `modulo`/`paqueteId` que a su vez
--     tenga tenant) o si hay que descartarlos como fuente de evidencia.
--     `modulo` es la pista más fuerte: 'bloqueo'/'porcion_terrestre'/'servicios'
--     SOLO existen en el tarifario de MAYORISTA (minorista no tiene
--     tarifario/reservar — ver CLAUDE.md). 'manual' es el único tipo
--     alcanzable desde ambos tenants en el código actual.
select modulo, tipo, count(*) as filas
from public.cotizaciones
group by modulo, tipo
order by filas desc;

-- Claves de primer nivel presentes en `payload` (para ver si hay algo con
-- forma de tenant/agencia que no se haya cableado todavía).
select jsonb_object_keys(payload) as clave_en_payload, count(*) as filas
from public.cotizaciones
where payload is not null
group by 1
order by 2 desc;

-- 4.e `paquete_armado_id` → si algún día `paquetes` tiene tenant, esto
--     serviría como señal adicional para lo generado desde el tarifario.
--     Hoy solo confirma cuántas filas lo traen (por si `paquetes` ya tiene
--     o gana una columna de tenant más adelante).
select count(*) filter (where paquete_armado_id is not null) as con_paquete_armado_id,
       count(*)                                              as total
from public.cotizaciones;

-- ══ 5 y 6. Inequívocas vs. ambiguas ═════════════════════════════════════
-- Aplica, EN ORDEN DE CONFIANZA, las tres señales de arriba (4.a > 4.b > 4.c)
-- y clasifica cada fila. "Inequívoca" = al menos una señal de confianza alta
-- (4.a o 4.b-no-superadmin) apunta a un único tenant, y ninguna señal de
-- igual o mayor confianza la contradice. Todo lo demás es "ambigua".
with senal_a as ( -- numero_contrato → ventas.tenant (la más fuerte: FK real)
  select c.id, v.tenant as tenant_a
  from public.cotizaciones c
  join public.ventas v on v.numero_contrato = c.numero_contrato
),
senal_b as ( -- creado_por → usuarios.tenant (fuerte, pero excluye superadmin)
  select c.id, u.tenant as tenant_b
  from public.cotizaciones c
  join public.usuarios u on u.email = c.creado_por
  where u.rol <> 'superadmin'
),
senal_c as ( -- asesor (texto) → usuarios.tenant, solo si el nombre NO es ambiguo
  select c.id,
    (select min(u.tenant) from public.usuarios u where lower(btrim(u.nombre)) = lower(btrim(c.asesor))) as tenant_c
  from public.cotizaciones c
  where c.asesor is not null and btrim(c.asesor) <> ''
    and (select count(distinct u.tenant) from public.usuarios u where lower(btrim(u.nombre)) = lower(btrim(c.asesor))) = 1
),
clasificado as (
  select
    c.id,
    senal_a.tenant_a, senal_b.tenant_b, senal_c.tenant_c,
    coalesce(senal_a.tenant_a, senal_b.tenant_b, senal_c.tenant_c) as tenant_inferido,
    -- Contradicción: dos señales de confianza distinta apuntan a tenants distintos.
    (senal_a.tenant_a is not null and senal_b.tenant_b is not null and senal_a.tenant_a <> senal_b.tenant_b)
    or (coalesce(senal_a.tenant_a, senal_b.tenant_b) is not null and senal_c.tenant_c is not null
        and coalesce(senal_a.tenant_a, senal_b.tenant_b) <> senal_c.tenant_c) as hay_contradiccion
  from public.cotizaciones c
  left join senal_a on senal_a.id = c.id
  left join senal_b on senal_b.id = c.id
  left join senal_c on senal_c.id = c.id
)
select
  case
    when hay_contradiccion then 'AMBIGUA — señales contradictorias'
    when tenant_inferido is null then 'AMBIGUA — sin ninguna señal'
    else 'INEQUÍVOCA (' || tenant_inferido || ')'
  end as clasificacion,
  count(*) as filas
from clasificado
group by 1
order by 2 desc;

-- ══ 7. Huérfanas en cotizacion_servicios ════════════════════════════════
-- La FK trae `on delete cascade`, así que no debería haber huérfanas reales
-- vía integridad referencial — este chequeo lo confirma en vez de asumirlo.
select count(*) as servicios_huerfanos
from public.cotizacion_servicios cs
where not exists (select 1 from public.cotizaciones c where c.id = cs.cotizacion_id);

-- ══ 8. Roles con permiso según las policies REALES (no el diseño) ═══════
select schemaname, tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public' and tablename in ('cotizaciones', 'cotizacion_servicios')
order by tablename, cmd;

-- ══ 9. ¿Un usuario autenticado de UNA agencia lee cotizaciones de la OTRA? ═
-- Se hace pasar por un usuario interno REAL de cada tenant (activo, no
-- superadmin — superadmin tiene alcance global por diseño y no prueba nada
-- aquí) y cuenta cuántas cotizaciones "inequívocas" de la OTRA agencia
-- alcanza a leer. Usa la misma clasificación del bloque 5/6.
create temp table _cruce_cot (
  usuario text, rol text, tenant_usuario text,
  cotizaciones_visibles bigint,
  de_su_tenant bigint,
  de_otro_tenant bigint
) on commit drop;

do $$
declare
  u record;
  n_total bigint;
  n_mismo bigint;
  n_otro  bigint;
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

    -- Todo lo visible bajo su propia sesión (RLS real, tal cual la ve la app).
    select count(*) into n_total from public.cotizaciones;

    -- De eso, cuánto es de SU tenant vs. del OTRO, usando la inferencia por
    -- numero_contrato (la única señal que no depende de impersonar de nuevo).
    select
      count(*) filter (where v.tenant is not distinct from u.tenant),
      count(*) filter (where v.tenant is distinct from u.tenant and v.tenant is not null)
      into n_mismo, n_otro
      from public.cotizaciones c
      left join public.ventas v on v.numero_contrato = c.numero_contrato;

    reset role;
    perform set_config('request.jwt.claims', '{}', true);

    insert into _cruce_cot values (u.email, u.rol, u.tenant, n_total, n_mismo, n_otro);
  end loop;
end $$;

select
  usuario, rol, tenant_usuario as "agencia del usuario",
  cotizaciones_visibles as "total que puede leer (RLS real)",
  de_su_tenant           as "…de contratos de SU agencia",
  de_otro_tenant         as "…de contratos de la OTRA agencia ⚠️",
  case when de_otro_tenant > 0 then 'FUGA — lee cotizaciones convertidas de la otra agencia' else 'sin fuga detectable por esta señal' end as veredicto
from _cruce_cot
order by de_otro_tenant desc, tenant_usuario, usuario;

-- ⚠️ Nota de interpretación: `cotizaciones_visibles` cuenta TODAS las que la
-- RLS deja pasar (abiertas + convertidas + descartadas, de cualquier tenant),
-- porque la policy actual es solo por ROL, no filtra tenant. El desglose de
-- abajo (de_su_tenant/de_otro_tenant) solo puede confirmarse para las YA
-- CONVERTIDAS (con numero_contrato → ventas.tenant); las que siguen
-- 'abiertas' también las lee, pero no hay con qué confirmar su tenant real
-- — por eso el bloque 5/6 existe aparte. Que `de_otro_tenant = 0` para todos
-- NO prueba que no haya fuga: prueba que hoy no hay (o no se detecta desde
-- esta señal) ninguna cotización CONVERTIDA de la otra agencia. Comparar
-- `cotizaciones_visibles` contra `de_su_tenant + de_otro_tenant`: si el total
-- es mayor a la suma, la diferencia son cotizaciones SIN señal de tenant que
-- igual está leyendo — ambiguas, pero visibles de todas formas.

-- ══ 10. ¿Un usuario ANÓNIMO (sin sesión) puede leerlas? ═════════════════
-- Distinto del bloque 9: aquí no hay JWT en absoluto, es el rol `anon` que
-- usa PostgREST para requests sin `Authorization`. Si esto da > 0, cualquier
-- visitante sin cuenta puede leer cotizaciones por la API REST directa.
create temp table _anon_cot (tabla text, visibles bigint) on commit drop;

do $$
declare n bigint;
begin
  execute 'set local role anon';
  perform set_config('request.jwt.claims', '{}', true);

  select count(*) into n from public.cotizaciones;
  reset role;
  insert into _anon_cot values ('cotizaciones', n);

  execute 'set local role anon';
  select count(*) into n from public.cotizacion_servicios;
  reset role;
  insert into _anon_cot values ('cotizacion_servicios', n);

  perform set_config('request.jwt.claims', null, true);
end $$;

select tabla, visibles,
  case when visibles > 0 then 'ACCESO PÚBLICO ANÓNIMO ⚠️' else 'sin acceso anónimo' end as veredicto
from _anon_cot;

rollback;
