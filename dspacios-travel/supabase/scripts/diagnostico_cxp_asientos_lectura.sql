-- ───────────────────────────────────────────────────────────────────────────
-- DIAGNÓSTICO · INTEGRIDAD CxP ↔ ASIENTOS · EXCLUSIVAMENTE DE LECTURA.
--
-- Por qué existe: la migración 172 estableció que una cuenta por pagar puede
-- vivir sin su asiento contable —el posteo es "best-effort" a propósito: la
-- acción de negocio nunca falla por un problema contable— y que la ausencia
-- del asiento ES el hecho, siempre re-consultable comparando
-- `cuentas_por_pagar` contra `asientos_contables` con origen='cxp' y
-- referencia='cxp:<id>'.
--
-- Esta es la MÉTRICA que decide si una reconstrucción histórica es siquiera
-- posible: si hay asientos `cxp` cuya cuenta por pagar ya no existe, o cuentas
-- por pagar sin asiento, el libro y la operación no coinciden, y cualquier
-- "traer los comprobantes históricos" partiría de una base que no cuadra.
--
-- Privacidad: SOLO conteos y sumas. Nunca nombres de proveedor, correos ni
-- detalle de línea. La "muestra" devuelve las referencias numéricas del
-- proveedor (con las que se cruza el staging) y el `numero_contrato`.
--
-- Cómo usarlo (el usuario lo corre a mano; no se ejecuta automáticamente):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/scripts/diagnostico_cxp_asientos_lectura.sql
--
-- Corre en una transacción READ ONLY y termina en `rollback`: no deja rastro.
-- No depende de las migraciones 201/202/203.
--
-- Salida: columnas `o · seccion · control · valor · detalle`. Si una sección
-- agrupa y no hay filas, no imprime nada para esa sección (tabla vacía).
-- ───────────────────────────────────────────────────────────────────────────
begin transaction read only;

-- Asientos de cuenta por pagar: el motor los crea con origen='cxp' y
-- referencia='cxp:<cuenta_por_pagar.id>'. Solo se toman los que tienen un id
-- numérico detrás, para que un dato raro no rompa el cast.
cxp_asientos as (
  select a.tenant,
         a.id,
         a.fecha,
         a.numero,
         (regexp_replace(a.referencia, '^cxp:', ''))::bigint as cuenta_id
    from public.asientos_contables a
   where a.origen = 'cxp'
     and a.referencia ~ '^cxp:[0-9]+$'
),
-- El desglose de ese asiento, para comparar montos sin exponer líneas.
cxp_asientos_montos as (
  select c.tenant,
         c.cuenta_id,
         sum(coalesce(l.debe, 0) - coalesce(l.haber, 0)) as neto
    from cxp_asientos c
    join public.asiento_lineas l on l.asiento_id = c.id
   group by c.tenant, c.cuenta_id
),
-- Cuentas por pagar vivas. Las de valor cero se ignoran: no generan hecho
-- económico y `postearAsientoCxP` las borra en vez de postearlas.
cxp_vivas as (
  select c.id,
         c.tenant,
         c.numero_contrato,
         c.proveedor,
         c.tipo_proveedor,
         c.valor_total,
         c.fecha_obligacion,
         c.observaciones
    from public.cuentas_por_pagar c
   where coalesce(c.valor_total, 0) <> 0
),
-- Proveedor por NIT: es la llave con la que el staging cruzaría una factura de
-- compras importada por XML. Una CxP sin NIT NO se podría vincular con su XML.
cxp_con_nit as (
  select v.*,
         p.nit
    from cxp_vivas v
    left join public.proveedores p
      on p.nit is not null
     and regexp_replace(p.nit, '[^0-9]', '', 'g')
         = regexp_replace(coalesce(v.proveedor, ''), '[^0-9]', '', 'g')
)
select * from (
  -- ═══ 1) DESCUADRE DE LA INVARIANTE DE LA MIGRACIÓN 172 ════════════════════
  select 1 o, 'invariante-172' seccion,
         'cuentas por pagar VIVAS (valor <> 0)' control,
         count(*)::text valor,
         'universo de la comparación: una CxP de valor cero no genera asiento' detalle
    from cxp_vivas
 union all select 2, 'invariante-172',
         'con asiento contable (origen cxp, referencia cxp:<id>)',
         count(distinct (tenant || ':' || cuenta_id))::text,
         'el número ideal: cada CxP viva posteada exactamente una vez'
    from cxp_asientos
 union all select 3, 'invariante-172',
         'CxP viva SIN asiento',
         count(*)::text,
         'REVISAR: la operación existe y el libro no la refleja (el posteo best-effort no ocurrió)'
    from cxp_vivas v
   where not exists (
     select 1 from cxp_asientos a where a.tenant = v.tenant and a.cuenta_id = v.id
   )
 union all select 4, 'invariante-172',
         'asientos cxp huérfanos (su CxP ya no existe)',
         count(*)::text,
         'REVISAR: hay costo en el libro sin operación que lo origine'
    from cxp_asientos a
   where not exists (
     select 1 from cxp_vivas v where v.tenant = a.tenant and v.id = a.cuenta_id
   )
 union all select 5, 'invariante-172',
         'CxP viva con MÁS de un asiento cxp',
         count(*)::text,
         'REVISAR: `reemplazarAsiento` borra por (tenant, origen, referencia) sin transacción ni índice único; dos cargas simultáneas pueden duplicarlo'
    from (
      select tenant, cuenta_id
        from cxp_asientos
       group by tenant, cuenta_id
      having count(*) > 1
    ) d

 union all
  -- ═══ 2) MONTOS: ¿EL LIBRO CUADRA CON LA OPERACIÓN? ════════════════════════
  select 10, 'montos',
         'CxP vivas: suma de valor_total',
         round(coalesce(sum(valor_total), 0), 2)::text,
         'lo que la operación dice que se debe'
    from cxp_vivas
 union all select 11, 'montos',
         'libro: saldo neto de los asientos cxp (debe − haber)',
         round(coalesce((select sum(m.neto) from cxp_asientos_montos m), 0), 2)::text,
         'lo que dice el libro. Si no cuadra con la fila 10, el motor posteó otra cosa'
 union all select 12, 'montos',
         'diferencia (fila 10 − fila 11)',
         round(coalesce((select sum(valor_total) from cxp_vivas), 0)
             - coalesce((select sum(m.neto) from cxp_asientos_montos m), 0), 2)::text,
         'distinta de cero significa que el libro y las CxP no coinciden'
 union all select 13, 'montos',
         'CxP vivas cuyo asiento difiere en más de $1',
         count(*)::text,
         'REVISAR: tolerancia de un peso; por encima es un posting con otro valor'
    from cxp_vivas v
    join cxp_asientos_montos m on m.tenant = v.tenant and m.cuenta_id = v.id
   where abs(v.valor_total - m.neto) > 1

 union all
  -- ═══ 3) COBERTURA: ¿DESDE CUÁNDO EXISTE EL ASIENTO? ═══════════════════════
  select 20, 'cobertura',
         'mes más antiguo con CxP viva',
         coalesce(to_char(min(coalesce(fecha_obligacion, current_date)), 'YYYY-MM'), '—'),
         'arranque de la deuda con proveedores'
    from cxp_vivas
 union all select 21, 'cobertura',
         'mes más antiguo con asiento cxp',
         coalesce(to_char(min(fecha), 'YYYY-MM'), '—'),
         'arranque del posteo automático; comparar con la fila 20 da el tamaño del hueco histórico'
    from cxp_asientos
 union all select 22, 'cobertura',
         'CxP vivas por mes de obligación',
         count(*)::text,
         'distribución mensual'
    from cxp_vivas
   group by to_char(coalesce(fecha_obligacion, current_date), 'YYYY-MM')
 union all select 23, 'cobertura',
         '…de las cuales SIN asiento',
         count(*)::text,
         'si el mes más antiguo aparece con cero, el hueco es anterior al cableado del posteo automático, no una falla'
    from cxp_vivas v
   where not exists (
     select 1 from cxp_asientos a where a.tenant = v.tenant and a.cuenta_id = v.id
   )
   group by to_char(coalesce(fecha_obligacion, current_date), 'YYYY-MM')

 union all
  -- ═══ 4) CRUCE CONTRA UNA FUTURA IMPORTACIÓN DIAN ══════════════════════════
  select 30, 'cruce-dian',
         'CxP vivas con NIT de proveedor resoluble',
         count(*)::text,
         'las que se podrían vincular con una factura de compras por NIT'
    from cxp_con_nit where nit is not null
 union all select 31, 'cruce-dian',
         'CxP vivas SIN NIT resoluble',
         count(*)::text,
         'REVISAR: sin NIT no hay cruce posible contra el XML; hay que resolver el proveedor antes'
    from cxp_con_nit where nit is null
 union all select 32, 'cruce-dian',
         '…sin NIT, por tipo de proveedor',
         count(*)::text || ' (tipo=' || coalesce(tipo_proveedor, '—') || ')',
         'agrupa las que quedan sin cruce para atacarlas por tipo'
    from cxp_con_nit where nit is null
   group by tipo_proveedor
 union all select 33, 'cruce-dian',
         'CxP vivas marcadas como automáticas',
         count(*)::text,
         'las que crea el sistema (marca_cxp_automatica): son las que un backfill debe identificar ANTES de volver a postear'
    from cxp_vivas
   where observaciones like public.marca_cxp_automatica() || '%'
 union all select 34, 'cruce-dian',
         'CxP vivas con pagos o retenciones ya registrados',
         count(*)::text,
         'estas NO se pueden borrar ni rehacer: la migración 172 las excluye del borrado automático'
    from cxp_vivas v
   where exists (select 1 from public.cxp_pagos p where p.cuenta_por_pagar_id = v.id)
      or exists (select 1 from public.retenciones_cxp r where r.cuenta_por_pagar_id = v.id)
 union all select 35, 'cruce-dian',
         'NIT de proveedor duplicado en el catálogo',
         count(*)::text,
         'REVISAR: con dos proveedores del mismo NIT el cruce es ambiguo; el staging necesita un NIT único'
    from (
      select regexp_replace(nit, '[^0-9]', '', 'g') n
        from public.proveedores
       where nit is not null
       group by regexp_replace(nit, '[^0-9]', '', 'g')
      having count(*) > 1
    ) d
 union all select 36, 'cruce-dian',
         'muestra de CxP sin NIT (máx. 10): referencia del proveedor · contrato',
         coalesce(string_agg(distinct left(regexp_replace(coalesce(proveedor, ''), '[^0-9]', '', 'g'), 12) || ' · ' || numero_contrato, ' | '), '—'),
         'para resolverlas una a una con el usuario; sin nombres ni importes'
    from (
      select proveedor, numero_contrato
        from cxp_con_nit
       where nit is null
       order by numero_contrato
       limit 10
    ) m
) t
order by o, control;

rollback;
