-- ───────────────────────────────────────────────────────────────────────────
-- DIAGNÓSTICO — vouchers que podrían contener proveedores.contacto (interno).
-- SOLO LECTURA. Funciona antes y después de la migración 191 (usa
-- proveedores.contacto, que la 191 no retira, y
-- proveedores_datos_sensibles.voucher_contacto, que existe desde la 189).
--
-- Por qué: desde la primera versión de los vouchers (PR #57, 2026-06-08),
-- generarVouchersServicios usaba proveedores.contacto como respaldo cuando el
-- proveedor no tenía voucher_contacto, y lo escribía dentro de
-- vouchers.contenido->>'infoImportante' ("... puede comunicarse al <contacto>.").
-- El contenido es editable, así que el valor pudo quedar en cualquier campo,
-- a cualquier profundidad.
--
-- Qué devuelve: SOLO identificadores, conteos, banderas y RUTAS de campo
-- (nombres de claves del JSON, p. ej. ".infoImportante" o ".incluye[1]").
-- Nunca teléfonos, nombres de contacto ni contenido del voucher.
--
-- D1 y D2 comparten EXACTAMENTE el mismo bloque WITH (recorrido del JSON y
-- criterio de coincidencia): D2 lista todos y solo los vouchers que D1 cuenta
-- en vouchers_con_contacto_interno. Si se edita uno, copiar el bloque al otro
-- (pruebas/diagnosticoVouchers.wiring.test.ts lo comprueba).
--
-- Límites (es una heurística, no una prueba):
--   - Compara contra el contacto ACTUAL del catálogo; si alguien lo cambió
--     después de generar el voucher, el valor viejo no se detecta.
--   - Coincidencia exacta de texto (contacto de >= 7 caracteres, para no
--     marcar nombres cortos), o de la secuencia de dígitos (>= 7) del
--     contacto dentro de los dígitos de un mismo valor de texto del voucher.
--   - No marca un voucher cuando el mismo número está en el voucher_contacto
--     público de ese proveedor (ahí el número ya era publicable).
--
-- Ejecutar cada SELECT por separado en el editor SQL de Supabase.
-- ───────────────────────────────────────────────────────────────────────────

-- D1. Resumen. Conteos, sin valores.
with recursive
nodos(voucher_id, ruta, valor) as (
  -- Todo el árbol del contenido: objetos y arreglos a cualquier profundidad.
  select v.id, ''::text, v.contenido
  from public.vouchers v
  union all
  select n.voucher_id, h.ruta, h.valor
  from nodos n
  cross join lateral (
    select n.ruta || '.' || o.key, o.value
    from jsonb_each(case when jsonb_typeof(n.valor) = 'object' then n.valor else '{}'::jsonb end) as o
    union all
    select n.ruta || '[' || (a.pos - 1) || ']', a.value
    from jsonb_array_elements(case when jsonb_typeof(n.valor) = 'array' then n.valor else '[]'::jsonb end)
         with ordinality as a(value, pos)
  ) as h(ruta, valor)
),
textos as (
  select voucher_id, ruta, valor #>> '{}' as texto
  from nodos
  where jsonb_typeof(valor) = 'string'
),
contactos as (
  select p.id as proveedor_id,
         p.nombre,
         btrim(p.contacto) as contacto,
         regexp_replace(p.contacto, '\D', '', 'g') as contacto_digitos,
         regexp_replace(coalesce(s.voucher_contacto, ''), '\D', '', 'g') as publico_digitos,
         nullif(btrim(coalesce(s.voucher_contacto, '')), '') is null as sin_voucher_contacto
  from public.proveedores p
  left join public.proveedores_datos_sensibles s
    on s.proveedor_id = p.id and s.tenant = 'mayorista'
  where nullif(btrim(p.contacto), '') is not null
),
coincidencias as (
  select x.voucher_id, x.ruta, c.proveedor_id, c.nombre as proveedor_nombre, c.sin_voucher_contacto
  from textos x
  join contactos c
    on (length(c.contacto) >= 7 and position(c.contacto in x.texto) > 0)
    or (length(c.contacto_digitos) >= 7
        and position(c.contacto_digitos in regexp_replace(x.texto, '\D', '', 'g')) > 0)
  -- Si el número es el mismo del voucher_contacto público, no es una filtración.
  where not (length(c.contacto_digitos) >= 7 and position(c.contacto_digitos in c.publico_digitos) > 0)
),
por_voucher as (
  select v.id as voucher_id, v.numero_contrato, v.tipo, v.created_at, m.proveedor_id,
         (v.proveedor is not distinct from m.proveedor_nombre) as mismo_proveedor,
         m.sin_voucher_contacto,
         string_agg(distinct m.ruta, ', ' order by m.ruta) as rutas
  from coincidencias m
  join public.vouchers v on v.id = m.voucher_id
  group by v.id, v.numero_contrato, v.tipo, v.created_at, m.proveedor_id, v.proveedor, m.proveedor_nombre, m.sin_voucher_contacto
)
select
  (select count(*) from public.vouchers) as vouchers_totales,
  (select count(*) from public.vouchers where tipo <> 'hotel') as vouchers_de_servicios,
  (select count(*) from public.vouchers
    where contenido->>'infoImportante' like '%puede comunicarse al %') as con_frase_de_contacto,
  (select count(distinct voucher_id) from por_voucher) as vouchers_con_contacto_interno,
  (select count(distinct voucher_id) from por_voucher where mismo_proveedor) as de_su_propio_proveedor,
  (select count(distinct voucher_id) from por_voucher where mismo_proveedor and sin_voucher_contacto) as proveedor_sigue_sin_voucher_contacto,
  (select count(distinct voucher_id) from por_voucher where not mismo_proveedor) as de_otro_proveedor,
  (select count(distinct proveedor_id) from por_voucher) as proveedores_afectados,
  (select count(distinct numero_contrato) from por_voucher) as contratos_afectados;

-- D2. Detalle: una fila por (voucher, proveedor cuyo contacto aparece).
-- Solo identificadores, banderas y rutas de campo.
with recursive
nodos(voucher_id, ruta, valor) as (
  -- Todo el árbol del contenido: objetos y arreglos a cualquier profundidad.
  select v.id, ''::text, v.contenido
  from public.vouchers v
  union all
  select n.voucher_id, h.ruta, h.valor
  from nodos n
  cross join lateral (
    select n.ruta || '.' || o.key, o.value
    from jsonb_each(case when jsonb_typeof(n.valor) = 'object' then n.valor else '{}'::jsonb end) as o
    union all
    select n.ruta || '[' || (a.pos - 1) || ']', a.value
    from jsonb_array_elements(case when jsonb_typeof(n.valor) = 'array' then n.valor else '[]'::jsonb end)
         with ordinality as a(value, pos)
  ) as h(ruta, valor)
),
textos as (
  select voucher_id, ruta, valor #>> '{}' as texto
  from nodos
  where jsonb_typeof(valor) = 'string'
),
contactos as (
  select p.id as proveedor_id,
         p.nombre,
         btrim(p.contacto) as contacto,
         regexp_replace(p.contacto, '\D', '', 'g') as contacto_digitos,
         regexp_replace(coalesce(s.voucher_contacto, ''), '\D', '', 'g') as publico_digitos,
         nullif(btrim(coalesce(s.voucher_contacto, '')), '') is null as sin_voucher_contacto
  from public.proveedores p
  left join public.proveedores_datos_sensibles s
    on s.proveedor_id = p.id and s.tenant = 'mayorista'
  where nullif(btrim(p.contacto), '') is not null
),
coincidencias as (
  select x.voucher_id, x.ruta, c.proveedor_id, c.nombre as proveedor_nombre, c.sin_voucher_contacto
  from textos x
  join contactos c
    on (length(c.contacto) >= 7 and position(c.contacto in x.texto) > 0)
    or (length(c.contacto_digitos) >= 7
        and position(c.contacto_digitos in regexp_replace(x.texto, '\D', '', 'g')) > 0)
  -- Si el número es el mismo del voucher_contacto público, no es una filtración.
  where not (length(c.contacto_digitos) >= 7 and position(c.contacto_digitos in c.publico_digitos) > 0)
),
por_voucher as (
  select v.id as voucher_id, v.numero_contrato, v.tipo, v.created_at, m.proveedor_id,
         (v.proveedor is not distinct from m.proveedor_nombre) as mismo_proveedor,
         m.sin_voucher_contacto,
         string_agg(distinct m.ruta, ', ' order by m.ruta) as rutas
  from coincidencias m
  join public.vouchers v on v.id = m.voucher_id
  group by v.id, v.numero_contrato, v.tipo, v.created_at, m.proveedor_id, v.proveedor, m.proveedor_nombre, m.sin_voucher_contacto
)
select voucher_id,
       numero_contrato,
       tipo,
       created_at::date as creado,
       proveedor_id,
       mismo_proveedor,
       sin_voucher_contacto as proveedor_sigue_sin_voucher_contacto,
       rutas as campos_con_coincidencia
from por_voucher
order by created_at, voucher_id, proveedor_id;
