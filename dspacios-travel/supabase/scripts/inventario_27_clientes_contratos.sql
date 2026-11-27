-- INVENTARIO 27 (SOLO LECTURA): titulares de contratos frente al CRM operativo. UNA sola consulta; no escribe, no hace backfill, no devuelve nombres, documentos, correos ni teléfonos.
-- Contexto (#27): la superficie «Clientes de contratos» (221) lee `ventas` EN VIVO, una fila por contrato, así que ningún contrato «falta» ahí. Lo que se mide aquí es otra cosa:
-- cuántos titulares de contratos NO están representados en el CRM operativo de personas (`personas`, 214/219) ni en los contactos (`crm_contactos`), por agencia (tenant) y tipo de
-- contrato (`ventas.tipo_paquete`). Es una reconciliación AGREGADA, separada de las audiencias de campañas: no copia ni propone copiar nada a campañas.
-- Identidad: SOLO por documento (número normalizado: letras y dígitos en mayúscula, ≥ 5 caracteres). `ventas` no siempre guarda el tipo documental, así que el cruce es por número y es
-- INDICATIVO: nunca se une por nombre, teléfono ni correo. Un contrato sin documento utilizable se cuenta aparte (no se puede localizar sin inferir).
-- Población: contratos de `ventas` sin los anulados/cancelados. `crm_contactos.tenant` puede ser NULL en filas históricas (107/207): un contacto sin agencia cuenta para ambas.
-- Sin subconsultas correlacionadas (conjuntos distintos + joins). Lo ejecuta el dueño en el editor SQL; el resultado no contiene datos personales.
with v as (
  select v.tenant,
         coalesce(nullif(btrim(v.tipo_paquete), ''), '(sin tipo)') as tipo,
         nullif(regexp_replace(upper(coalesce(v.cliente_documento, '')), '[^A-Z0-9]', '', 'g'), '') as doc,
         v.cliente_tipo_documento as tipo_doc
    from public.ventas v
   where coalesce(v.estado, '') !~* '^(anulad|cancelad)'
),
d as (
  select tenant, tipo, tipo_doc, case when doc is not null and char_length(doc) >= 5 then doc end as doc_ok
    from v
),
cc as (   -- documentos de contactos por agencia efectiva (un contacto sin agencia vale para las dos)
  select distinct x.doc, t.tenant
    from (select regexp_replace(upper(documento), '[^A-Z0-9]', '', 'g') as doc, tenant from public.crm_contactos where documento is not null) x
    join (values ('mayorista'), ('minorista')) t(tenant) on x.tenant is null or x.tenant = t.tenant
   where x.doc <> ''
),
pe as (   -- números de personas documentadas (214: `numero_norm` ya viene normalizado)
  select distinct tenant, numero_norm as doc from public.personas where numero_norm is not null
),
j as (
  select d.tenant, d.tipo, d.tipo_doc, d.doc_ok,
         (cc.doc is not null) as en_contactos,
         (pe.doc is not null) as en_personas
    from d
    left join cc on cc.doc = d.doc_ok and cc.tenant = d.tenant
    left join pe on pe.doc = d.doc_ok and pe.tenant = d.tenant
),
g as (
  select tenant, coalesce(tipo, '(todos los tipos)') as tipo, grouping(tipo) as es_total,
         count(*) as contratos,
         count(distinct doc_ok) as titulares,
         count(*) filter (where doc_ok is null) as sin_doc,
         count(*) filter (where doc_ok is not null and tipo_doc is null) as doc_sin_tipo,
         count(*) filter (where en_contactos) as en_contactos,
         count(*) filter (where en_personas) as en_personas,
         count(*) filter (where doc_ok is not null and not en_contactos and not en_personas) as en_ninguno,
         count(distinct doc_ok) filter (where not en_contactos and not en_personas) as titulares_en_ninguno
    from j
   group by grouping sets ((tenant, tipo), (tenant))
)
select orden, control, tenant, tipo_contrato, observado, esperado, estado from (
  select 1 as orden, 'Contratos vigentes (sin anulados)' as control, tenant, tipo as tipo_contrato, contratos::text as observado, 'n/a' as esperado, 'INFO' as estado, es_total, 0 as sub from g
  union all select 2, 'Titulares distintos por documento utilizable', tenant, tipo, titulares::text, 'n/a', 'INFO', es_total, 0 from g
  union all select 3, 'Contratos SIN documento utilizable (no localizables sin inferir)', tenant, tipo, sin_doc::text, 'n/a', 'INFO', es_total, 0 from g
  union all select 4, 'Contratos con documento pero sin tipo documental guardado (identidad ambigua)', tenant, tipo, doc_sin_tipo::text, 'n/a', 'INFO', es_total, 0 from g
  union all select 5, 'Contratos cuyo titular figura en crm_contactos (por documento)', tenant, tipo, en_contactos::text, 'n/a', 'INFO', es_total, 0 from g
  union all select 6, 'Contratos cuyo titular figura en el registro de personas (por número)', tenant, tipo, en_personas::text, 'n/a', 'INFO', es_total, 0 from g
  union all select 7, 'Contratos con documento utilizable cuyo titular NO figura en contactos ni en personas', tenant, tipo, en_ninguno::text, '0', case when en_ninguno = 0 then 'OK' else 'REVISAR' end, es_total, 0 from g
  union all select 8, 'Titulares distintos ausentes de contactos y personas', tenant, tipo, titulares_en_ninguno::text, '0', case when titulares_en_ninguno = 0 then 'OK' else 'REVISAR' end, es_total, 0 from g
) r order by tenant, es_total desc, tipo_contrato, orden;
