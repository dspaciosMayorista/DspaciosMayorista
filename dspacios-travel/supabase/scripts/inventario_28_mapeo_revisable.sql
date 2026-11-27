-- INVENTARIO 28 · ETAPA 2 DE 2 (SOLO LECTURA): mapa REVISABLE contrato por contrato de las ventas ligadas a un nombre compartido por un usuario `venta` y un `freelance` activos de la misma agencia.
-- Correr SOLO después de revisar los conteos de la etapa 1. UNA sola consulta; no escribe, no reasigna y no propone ninguna actualización: clasifica CADA venta por la evidencia que de verdad tiene.
-- Devuelve números de contrato e identificadores estables (el UUID COMPLETO de cada perfil: los 8 primeros caracteres no son únicos); NO devuelve nombres de cliente, documentos, correos ni importes.
-- Una venta entra por CUALQUIERA de cuatro evidencias, que `evidencias` lista (procedencia): asesor (texto) · freelance_nombre (texto) · b2b_usuario_id · aliado_id (el del perfil freelance, aunque
-- b2b_usuario_id sea NULL y los nombres no coincidan). Cada (par de perfiles, contrato) sale UNA vez aunque coincida por varias evidencias.
-- Clasificación (de la más fuerte a la más débil; el nombre por sí solo NUNCA basta):
--   FUERA_DE_AGENCIA         el identificador estable apunta a este grupo pero la venta es de OTRA agencia (tenant): no se atribuye; revisar el dato.
--   CONFLICTO_ID_VS_TIPO     b2b_usuario_id apunta al perfil freelance pero tipo_asesor dice 'interno': dos evidencias que se contradicen.
--   CONFLICTO_ID_VS_ALIADO   b2b_usuario_id y aliado_id se contradicen: el usuario es el perfil freelance pero el aliado es OTRO, o el aliado es el del perfil freelance pero el usuario es otro/el perfil venta.
--   ID_PERFIL_FREELANCE      b2b_usuario_id apunta al perfil freelance (identificador estable propio del portal B2B) y no hay aliado contradictorio.
--   ID_PERFIL_VENTA          b2b_usuario_id apunta al perfil venta (una venta B2B hecha por quien hoy figura como interno: revisar a mano).
--   ID_ALIADO_FREELANCE      aliado_id coincide con el aliado enlazado al perfil freelance y no hay b2b_usuario_id (identificador del catálogo).
--   ID_OTRO                  hay un identificador estable que apunta a OTRO usuario/aliado: la venta NO es de este grupo aunque comparta nombre.
--   SOLO_TEXTO               coincide únicamente por el texto de `asesor`/`freelance_nombre`: sin identificador estable, NO se puede atribuir sin otra evidencia (acta, correo, comisión pagada).
-- `con_comision_b2b` = el contrato YA tiene fila en aliados_b2b (comisión calculada/registrada): cualquier corrección debe decidir cómo tratarla; esta consulta no la toca.
-- Sin subconsultas correlacionadas. Lo ejecuta el dueño; el resultado es la base de la revisión previa a cualquier corrección (que, si se aprueba, será un script aparte con vista previa y rollback).
with u as (
  select id, tenant, rol::text as rol, aliado_id, lower(btrim(nombre)) as nn
    from public.usuarios
   where activo is true and btrim(coalesce(nombre, '')) <> ''
),
dup as (
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
c as (
  select n, venta_id, freelance_id, freelance_aliado, numero_contrato, tenant, tipo_asesor, canal, b2b_usuario_id, aliado_id, tenant_ok,
         bool_or(por_asesor) as por_asesor, bool_or(por_freelance_texto) as por_freelance_texto, bool_or(por_id_b2b) as por_id_b2b, bool_or(por_id_aliado) as por_id_aliado
    from m
   group by n, venta_id, freelance_id, freelance_aliado, numero_contrato, tenant, tipo_asesor, canal, b2b_usuario_id, aliado_id, tenant_ok
),
com as (select distinct numero_contrato from public.aliados_b2b)
select 'DUP-' || c.n as grupo, c.numero_contrato, c.tenant,
       c.venta_id::text as perfil_venta, c.freelance_id::text as perfil_freelance,
       coalesce(c.tipo_asesor, '(nulo)') as tipo_asesor, coalesce(c.canal, '(nulo)') as canal,
       c.b2b_usuario_id is not null as tiene_b2b_usuario_id, c.aliado_id is not null as tiene_aliado_id,
       c.por_asesor as texto_en_asesor, c.por_freelance_texto as texto_en_freelance_nombre, c.por_id_b2b as coincide_por_b2b_usuario_id, c.por_id_aliado as coincide_por_aliado_id,
       concat_ws('+', case when c.por_asesor then 'asesor' end, case when c.por_freelance_texto then 'freelance_nombre' end,
                      case when c.por_id_b2b then 'b2b_usuario_id' end, case when c.por_id_aliado then 'aliado_id' end) as evidencias,
       (com.numero_contrato is not null) as con_comision_b2b,
       case
         when not c.tenant_ok then 'FUERA_DE_AGENCIA'
         when c.b2b_usuario_id = c.freelance_id and c.tipo_asesor = 'interno' then 'CONFLICTO_ID_VS_TIPO'
         when c.b2b_usuario_id = c.freelance_id and c.aliado_id is not null and c.aliado_id is distinct from c.freelance_aliado then 'CONFLICTO_ID_VS_ALIADO'
         when c.b2b_usuario_id is not null and c.b2b_usuario_id <> c.freelance_id and c.aliado_id is not null and c.freelance_aliado is not null and c.aliado_id = c.freelance_aliado then 'CONFLICTO_ID_VS_ALIADO'
         when c.b2b_usuario_id = c.freelance_id then 'ID_PERFIL_FREELANCE'
         when c.b2b_usuario_id = c.venta_id then 'ID_PERFIL_VENTA'
         when c.b2b_usuario_id is not null then 'ID_OTRO'
         when c.aliado_id is not null and c.freelance_aliado is not null and c.aliado_id = c.freelance_aliado then 'ID_ALIADO_FREELANCE'
         when c.aliado_id is not null then 'ID_OTRO'
         else 'SOLO_TEXTO'
       end as clasificacion,
       'REVISION_HUMANA' as estado
  from c
  left join com on com.numero_contrato = c.numero_contrato
 order by c.n, clasificacion, c.numero_contrato, c.venta_id, c.freelance_id;
