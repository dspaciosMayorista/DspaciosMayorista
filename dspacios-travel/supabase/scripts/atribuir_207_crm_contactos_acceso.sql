-- ───────────────────────────────────────────────────────────────────────────
-- ATRIBUCIÓN DE CONTACTOS HISTÓRICOS · hotfix de acceso a `crm_contactos`
--
-- ⛔ NO CORRER sin decisión explícita del dueño. Escribe datos.
-- ⛔ NO forma parte del plan de despliegue del hotfix: los históricos se
--    quedan sin agencia (solo superadmin/gerencia los ven) hasta esa decisión.
--
-- Después de la migración las filas históricas quedan con tenant NULL: solo
-- superadmin y gerencia las ven. Este script asigna agencia ÚNICAMENTE a las
-- categorías de evidencia que el dueño apruebe (ver
-- `preflight_207_crm_contactos_acceso.sql`, sección C):
--
--   E1  creador interno de agencia fija → su agencia
--   E2  alta del checkout público (service_role, origen B2C) → mayorista
--   E3  creador superadmin/gerencia → AMBIGUA: este script NUNCA la atribuye
--   E4  sin INSERT auditado → sin evidencia: NUNCA se atribuye aquí
--   E5  otros → NUNCA se atribuye aquí
--
-- Las filas E3/E4/E5 (y las de E1/E2 que el dueño no apruebe) siguen NULL;
-- superadmin/gerencia las atribuyen a mano, una por una, si corresponde.
-- Además se EXCLUYEN siempre las filas modificadas por personal de las dos
-- agencias (señal de base compartida): atribuirlas también es manual.
--
-- Cómo se usa: poner en `true` SOLO lo aprobado en el bloque `aprobado`,
-- correr, revisar el conteo y cambiar el ROLLBACK final por COMMIT.
-- Solo afecta filas con tenant NULL (nunca reescribe una atribución).
-- ───────────────────────────────────────────────────────────────────────────

begin;

with aprobado as (
  select * from (values
    ('E1', false),   -- ← el dueño decide
    ('E2', false)    -- ← el dueño decide
  ) as t(cat, aplicar)
),
ins as (
  select distinct on (a.registro_id)
         a.registro_id, a.actor_id, a.actor_rol, a.despues->>'origen' as origen_ins
    from public.auditoria a
   where a.tabla = 'crm_contactos' and a.accion = 'INSERT'
   order by a.registro_id, a.creado_en desc
),
compartidas as (
  select a.registro_id
    from public.auditoria a
    join public.usuarios u on u.id = a.actor_id
   where a.tabla = 'crm_contactos' and a.accion in ('INSERT', 'UPDATE')
   group by a.registro_id
  having count(distinct u.tenant) > 1
),
candidatas as (
  select c.id,
         case
           when i.actor_id is null and i.origen_ins = 'Cotización tarifario (B2C)' then 'E2'
           when i.actor_rol in ('administracion','operaciones','venta')
                and u.tenant in ('mayorista','minorista') then 'E1'
         end as cat,
         case
           when i.actor_id is null and i.origen_ins = 'Cotización tarifario (B2C)' then 'mayorista'
           when i.actor_rol in ('administracion','operaciones','venta')
                and u.tenant in ('mayorista','minorista') then u.tenant
         end as tenant_nuevo
    from public.crm_contactos c
    join ins i on i.registro_id = c.id::text
    left join public.usuarios u on u.id = i.actor_id
   where c.tenant is null
     and c.id::text not in (select registro_id from compartidas)
),
hecho as (
  update public.crm_contactos c
     set tenant = k.tenant_nuevo
    from candidatas k
    join aprobado a on a.cat = k.cat and a.aplicar
   where c.id = k.id and c.tenant is null and k.tenant_nuevo is not null
  returning k.cat, c.tenant
)
select cat, tenant, count(*) as filas_atribuidas
  from hecho group by cat, tenant order by cat, tenant;

select 'quedan sin atribuir' as estado, count(*) as filas
  from public.crm_contactos where tenant is null;

-- Revisar los conteos. Si cuadran con lo aprobado, cambiar por COMMIT.
rollback;
