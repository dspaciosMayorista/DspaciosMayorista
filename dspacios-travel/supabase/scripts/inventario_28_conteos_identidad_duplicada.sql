-- INVENTARIO 28 · ETAPA 1 DE 2 (SOLO LECTURA): conteos agregados de ventas ligadas a un nombre compartido por un usuario `venta` y un usuario `freelance` activos de la misma agencia.
-- UNA sola consulta; no escribe, no reasigna, no recalcula comisiones y NO devuelve nombres, documentos ni correos. Cada perfil se identifica por su UUID COMPLETO (los 8 primeros caracteres
-- NO son una clave de revisión: no son únicos).
-- Contexto (#28): el inventario P9 de la 221 halló dos usuarios activos con el mismo nombre (uno `venta`, otro `freelance`). El nombre por sí solo NO demuestra autoría: `ventas.asesor` es texto libre y
-- no hay `ventas.asesor_id`, así que esta etapa solo CUENTA, por las dimensiones que pidió el dueño: tipo_asesor, canal, b2b_usuario_id y aliado_id. Nada de lo que muestra autoriza un cambio.
-- Una venta entra al grupo si coincide por CUALQUIERA de cuatro evidencias independientes, que se reportan por separado (la procedencia de cada coincidencia):
--   texto en `asesor` · texto en `freelance_nombre` · `b2b_usuario_id` de uno de los dos perfiles · `aliado_id` igual al aliado enlazado al perfil freelance (aunque `b2b_usuario_id` sea NULL y los nombres no coincidan).
-- Una venta que coincide por varias evidencias cuenta UNA sola vez por (par de perfiles, contrato).
-- Consistencia de agencia: el texto exige la misma agencia; los identificadores estables (usuario y aliado) se buscan en TODAS las agencias para no ocultar anomalías, pero una venta de OTRA agencia
-- NO se atribuye al grupo: se cuenta aparte en el control 3 (y la etapa 2 la lista como FUERA_DE_AGENCIA).
-- Sin subconsultas correlacionadas. Lo ejecuta el dueño; con el resultado se decide si hace falta la etapa 2 (`inventario_28_mapeo_revisable.sql`).
with u as (
  select id, tenant, rol::text as rol, aliado_id, lower(btrim(nombre)) as nn
    from public.usuarios
   where activo is true and btrim(coalesce(nombre, '')) <> ''
),
dup as (   -- un par (venta, freelance) con el mismo nombre normalizado y la misma agencia
  select dense_rank() over (order by a.tenant, a.nn) as n, a.tenant, a.nn, a.id as venta_id, f.id as freelance_id, f.aliado_id as freelance_aliado
    from u a
    join u f on f.tenant = a.tenant and f.nn = a.nn and f.rol = 'freelance'
   where a.rol = 'venta'
),
vn as (   -- una sola pasada sobre ventas: solo las filas que pueden pertenecer a algún grupo (semi-join con hash), con el nombre normalizado UNA vez
  select v.numero_contrato, v.tenant, v.tipo_asesor, v.canal, v.b2b_usuario_id, v.aliado_id,
         lower(btrim(v.asesor)) as an, lower(btrim(v.freelance_nombre)) as fn
    from public.ventas v
   where lower(btrim(v.asesor)) in (select nn from dup)
      or lower(btrim(v.freelance_nombre)) in (select nn from dup)
      or v.b2b_usuario_id in (select venta_id from dup union all select freelance_id from dup)
      or v.aliado_id in (select freelance_aliado from dup where freelance_aliado is not null)
),
m as (     -- evidencias, una consulta de igualdad por cada una (hash join sobre el conjunto ya reducido)
  select d.n, d.venta_id, d.freelance_id, d.freelance_aliado, v.numero_contrato, v.tenant, v.tipo_asesor, v.canal, v.b2b_usuario_id, v.aliado_id, true as tenant_ok,
         true as por_asesor, false as por_freelance_texto, false as por_id_b2b, false as por_id_aliado
    from dup d join vn v on v.tenant = d.tenant and v.an = d.nn
  union all
  select d.n, d.venta_id, d.freelance_id, d.freelance_aliado, v.numero_contrato, v.tenant, v.tipo_asesor, v.canal, v.b2b_usuario_id, v.aliado_id, true,
         false, true, false, false
    from dup d join vn v on v.tenant = d.tenant and v.fn = d.nn
  union all
  select d.n, d.venta_id, d.freelance_id, d.freelance_aliado, v.numero_contrato, v.tenant, v.tipo_asesor, v.canal, v.b2b_usuario_id, v.aliado_id, (v.tenant = d.tenant),
         false, false, true, false
    from dup d join vn v on v.b2b_usuario_id = d.venta_id
  union all
  select d.n, d.venta_id, d.freelance_id, d.freelance_aliado, v.numero_contrato, v.tenant, v.tipo_asesor, v.canal, v.b2b_usuario_id, v.aliado_id, (v.tenant = d.tenant),
         false, false, true, false
    from dup d join vn v on v.b2b_usuario_id = d.freelance_id
  union all
  select d.n, d.venta_id, d.freelance_id, d.freelance_aliado, v.numero_contrato, v.tenant, v.tipo_asesor, v.canal, v.b2b_usuario_id, v.aliado_id, (v.tenant = d.tenant),
         false, false, false, true
    from dup d join vn v on v.aliado_id = d.freelance_aliado
),
c as (     -- una fila por (par de perfiles, contrato) con las evidencias combinadas (sin duplicar un contrato que coincide por varias)
  select n, venta_id, freelance_id, freelance_aliado, numero_contrato, tenant, tipo_asesor, canal, b2b_usuario_id, aliado_id, tenant_ok,
         bool_or(por_asesor) as por_asesor, bool_or(por_freelance_texto) as por_freelance_texto, bool_or(por_id_b2b) as por_id_b2b, bool_or(por_id_aliado) as por_id_aliado
    from m
   group by n, venta_id, freelance_id, freelance_aliado, numero_contrato, tenant, tipo_asesor, canal, b2b_usuario_id, aliado_id, tenant_ok
),
com as (   -- contratos que YA tienen comisión B2B registrada (no se tocan: solo se cuentan)
  select distinct numero_contrato from public.aliados_b2b
),
rel as (
  select c.n, c.tenant, c.venta_id::text as venta_ref, c.freelance_id::text as freelance_ref,
         coalesce(c.tipo_asesor, '(nulo)') as tipo_asesor, coalesce(c.canal, '(nulo)') as canal,
         case when c.b2b_usuario_id is null then 'sin b2b_usuario_id'
              when c.b2b_usuario_id = c.freelance_id then 'perfil freelance'
              when c.b2b_usuario_id = c.venta_id then 'perfil venta'
              else 'otro usuario' end as b2b_usuario,
         case when c.aliado_id is null then 'sin aliado_id'
              when c.freelance_aliado is not null and c.aliado_id = c.freelance_aliado then 'aliado del perfil freelance'
              else 'otro aliado' end as aliado,
         c.por_asesor, c.por_freelance_texto, c.por_id_b2b, c.por_id_aliado,
         (com.numero_contrato is not null) as con_comision
    from c left join com on com.numero_contrato = c.numero_contrato
   where c.tenant_ok
),
agg as (
  select n, tenant, venta_ref, freelance_ref, tipo_asesor, canal, b2b_usuario, aliado,
         count(*) as contratos,
         count(*) filter (where por_asesor) as por_texto_asesor,
         count(*) filter (where por_freelance_texto) as por_texto_freelance,
         count(*) filter (where por_id_b2b) as por_id_b2b,
         count(*) filter (where por_id_aliado) as por_id_aliado,
         count(*) filter (where con_comision) as con_comision_b2b
    from rel
   group by n, tenant, venta_ref, freelance_ref, tipo_asesor, canal, b2b_usuario, aliado
)
select orden, control, grupo, tenant, perfil_venta, perfil_freelance, tipo_asesor, canal, b2b_usuario_id, aliado_id, contratos, por_texto_asesor, por_texto_freelance, por_id_b2b, por_id_aliado, con_comision_b2b, estado from (
  select 1 as orden, 'Grupos con nombre compartido venta+freelance (activos, misma agencia)' as control, null::text as grupo, null::text as tenant, null::text as perfil_venta, null::text as perfil_freelance,
         null::text as tipo_asesor, null::text as canal, null::text as b2b_usuario_id, null::text as aliado_id,
         (select count(*) from dup) as contratos, null::bigint as por_texto_asesor, null::bigint as por_texto_freelance, null::bigint as por_id_b2b, null::bigint as por_id_aliado, null::bigint as con_comision_b2b,
         case when (select count(*) from dup) = 0 then 'OK' else 'REVISAR' end as estado
  union all
  select 2, 'Ventas ligadas al grupo (por dimensión)', 'DUP-' || n, tenant, venta_ref, freelance_ref, tipo_asesor, canal, b2b_usuario, aliado,
         contratos, por_texto_asesor, por_texto_freelance, por_id_b2b, por_id_aliado, con_comision_b2b, 'INFO' from agg
  union all
  select 3, 'Ventas ligadas solo por identificador estable pero de OTRA agencia (no se atribuyen al grupo)', null, null, null, null, null, null, null, null,
         (select count(*) from c where not tenant_ok), null, null, null, null, null,
         case when (select count(*) from c where not tenant_ok) = 0 then 'OK' else 'REVISAR' end
) r order by orden, grupo, tenant, perfil_venta, perfil_freelance, tipo_asesor, canal, b2b_usuario_id, aliado_id;
