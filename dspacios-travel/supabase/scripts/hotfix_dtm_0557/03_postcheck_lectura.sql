-- ───────────────────────────────────────────────────────────────────────────
-- POSTCHECK (SOLO LECTURA) del hotfix DTM-0057 → DTM-0557.
--
-- Una sola sentencia SELECT (el editor de Supabase muestra solo el último
-- resultado). No escribe y no consume la secuencia: el próximo número se
-- calcula de last_value/is_called, nunca con nextval().
-- Toda fila con ok = false es un problema. Las filas `comparar` se cotejan a
-- mano contra la salida del preflight (md5 del share_token y de la función).
--
-- FINAL, PENDIENTE DE REVISIÓN: el bloque `esperado` es el inventario de
-- producción del 2026-10-02, el mismo de ESPERADOS en 02/04 (ver allí cuáles
-- valores son confirmados y cuáles 0 inferido). Toda tabla con FK hacia
-- ventas debe figurar aquí: una sin expectativa sale ok = false.
-- ───────────────────────────────────────────────────────────────────────────

with
p as (select 'DTM-0057'::text as viejo, 'DTM-0557'::text as nuevo),
-- >>> ESPERADOS (filas bajo DTM-0557; deben coincidir con el hotfix) ──────
esperado(tabla, filas) as (values
  ('contrato_pasajeros', 3), ('contrato_vuelos', 2), ('contrato_hoteles', 1),
  ('contrato_items', 1), ('cuentas_por_pagar', 4), ('aliados_b2b', 1),
  ('contrato_servicios', 2),
  ('abonos', 0), ('sillas', 0), ('vouchers', 0), ('liquidacion_comisiones', 0),
  ('rentabilidad', 0), ('facturacion', 0), ('contrato_facturacion', 0),
  ('contrato_adjuntos', 0), ('cotizaciones', 0), ('cuotas', 0),
  ('contrato_vuelo_control', 0), ('contrato_vuelo_control_cambios', 0),
  ('contrato_condiciones', 0), ('restriccion_overrides', 0),
  ('contrato_financiero_pendiente', 0), ('contrato_alojamiento_bernalo', 0),
  -- referencias sin FK autorizadas por el dueño
  ('asientos_contables.descripcion', 4), ('asiento_lineas.tercero', 4)
),
-- <<< ESPERADOS
fk as (
  select c.conname::text, c.conrelid::regclass::text as tabla, a.attname::text as columna,
         c.condeferrable, c.condeferred
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
   where c.contype = 'f'
     and c.confrelid in ('public.ventas'::regclass, 'public.contrato_vuelo_control'::regclass)),
fk_conteo as (
  select fk.*, x.*
    from fk cross join lateral (
      select (xpath('/row/a/text()', r))[1]::text::bigint as con_viejo,
             (xpath('/row/b/text()', r))[1]::text::bigint as con_nuevo
        from query_to_xml(format('select count(*) filter (where %1$I = %3$L) as a,
                                         count(*) filter (where %1$I = %4$L) as b from %2$s',
               fk.columna, fk.tabla, (select viejo from p), (select nuevo from p)), false, true, '') r) x),
cols as (
  select n.nspname::text as esquema, c.relname::text as tabla, a.attname::text as columna
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_type t on t.oid = a.atttypid
   where n.nspname in ('public', 'storage') and c.relkind in ('r', 'p')
     and a.attnum > 0 and not a.attisdropped
     and (t.typcategory in ('S', 'A') or t.typname in ('json', 'jsonb'))),
barrido as (
  select cols.*, (xpath('/row/n/text()', query_to_xml(format(
           'select count(*) as n from %I.%I where %I::text like %L',
           cols.esquema, cols.tabla, cols.columna, '%' || (select viejo from p) || '%'), false, true, '')))[1]::text::bigint as n
    from cols),
seq as (select last_value, is_called, case when is_called then last_value + 1 else last_value end as proximo
          from public.contrato_seq_mayorista),
filas as (
select 1 as orden, 'ventas' as chequeo, 'DTM-0057 ya no existe' as detalle,
       (select count(*) from public.ventas where numero_contrato = (select viejo from p))::text as valor,
       not exists (select 1 from public.ventas where numero_contrato = (select viejo from p)) as ok
union all
select 2, 'ventas', 'DTM-0557 existe y es mayorista',
       coalesce((select tenant || ' · estado=' || estado from public.ventas where numero_contrato = (select nuevo from p)), 'NO EXISTE'),
       exists (select 1 from public.ventas where numero_contrato = (select nuevo from p) and tenant = 'mayorista')
union all
select 3, 'comparar', 'md5(share_token) de DTM-0557 (debe ser el del preflight)',
       coalesce((select md5(share_token::text) || ' · cotizacion_id=' || coalesce(cotizacion_id::text, 'null')
                   from public.ventas where numero_contrato = (select nuevo from p)), '—'),
       true
union all
select 10, 'fk', fc.tabla || ' (' || coalesce('esperado ' || e.filas, 'sin expectativa') || ')',
       format('DTM-0057=%s · DTM-0557=%s', fc.con_viejo, fc.con_nuevo),
       fc.con_viejo = 0 and e.filas is not null and fc.con_nuevo = e.filas
  from fk_conteo fc left join esperado e on e.tabla = fc.tabla
union all
select 11, 'fk', 'ninguna FK quedó DEFERRABLE',
       coalesce(string_agg(conname, ', ') filter (where condeferrable), 'ninguna'),
       not bool_or(condeferrable)
  from fk
union all
select 20, 'asientos', 'asientos con (DTM-0557) / líneas con tercero DTM-0557',
       format('%s / %s',
              (select count(*) from public.asientos_contables where descripcion like '%(' || (select nuevo from p) || ')%'),
              (select count(*) from public.asiento_lineas where tercero = (select nuevo from p))),
       (select count(*) from public.asientos_contables where descripcion like '%(' || (select nuevo from p) || ')%')
         = (select filas from esperado where tabla = 'asientos_contables.descripcion')
       and (select count(*) from public.asiento_lineas where tercero = (select nuevo from p))
         = (select filas from esperado where tabla = 'asiento_lineas.tercero')
union all
select 21, 'pasajeros', 'infantes de DTM-0557 con responsable en el mismo contrato',
       (select count(*) from public.contrato_pasajeros i
          join public.contrato_pasajeros r on r.id = i.responsable_id
         where i.numero_contrato = (select nuevo from p) and i.es_infante
           and r.numero_contrato = (select nuevo from p))::text
       || ' de ' || (select count(*) from public.contrato_pasajeros
                      where numero_contrato = (select nuevo from p) and es_infante),
       (select count(*) from public.contrato_pasajeros i
          left join public.contrato_pasajeros r on r.id = i.responsable_id
         where i.numero_contrato = (select nuevo from p) and i.es_infante
           and r.numero_contrato is distinct from (select nuevo from p)) = 0
union all
select 30, 'barrido', format('%s.%s.%s aún contiene DTM-0057', esquema, tabla, columna), n::text,
       tabla = 'auditoria'
  from barrido where n > 0
union all
select 31, 'auditoria', 'historial de DTM-0057 conservado (filas con registro_id DTM-0057)',
       (select count(*) from public.auditoria where registro_id = (select viejo from p))::text,
       (select count(*) from public.auditoria where registro_id = (select viejo from p)) > 0
union all
select 32, 'auditoria', 'el cambio quedó auditado (UPDATE de ventas DTM-0057 → DTM-0557)',
       (select count(*) from public.auditoria
         where tabla = 'ventas' and accion ilike 'update'
           and antes->>'numero_contrato' = (select viejo from p)
           and despues->>'numero_contrato' = (select nuevo from p))::text,
       exists (select 1 from public.auditoria
                where tabla = 'ventas' and accion ilike 'update'
                  and antes->>'numero_contrato' = (select viejo from p)
                  and despues->>'numero_contrato' = (select nuevo from p))
union all
select 40, 'secuencia', 'próximo consecutivo mayorista',
       format('last_value=%s is_called=%s → próximo %s', last_value, is_called, 'DTM-' || lpad(proximo::text, 4, '0')),
       proximo = 558 and last_value = 557 and is_called
  from seq
union all
select 41, 'secuencia', 'DTM-0558 aún libre',
       (select count(*) from public.ventas where numero_contrato = 'DTM-0558')::text,
       not exists (select 1 from public.ventas where numero_contrato = 'DTM-0558')
union all
select 42, 'funcion', 'siguiente_numero_contrato_para_tenant sigue en 4 dígitos (comparar md5 con el preflight)',
       'md5(prosrc)=' || md5(prosrc),
       prosrc like '%lpad(nextval(''public.contrato_seq_mayorista'')::text, 4, ''0'')%'
  from pg_proc where oid = 'public.siguiente_numero_contrato_para_tenant(text)'::regprocedure
union all
select 43, 'pool', 'numeros_contrato_liberados sin DTM',
       (select count(*) from public.numeros_contrato_liberados where numero like 'DTM-%')::text,
       not exists (select 1 from public.numeros_contrato_liberados where numero like 'DTM-%')
)
select orden, chequeo, detalle, valor, ok from filas order by ok, orden, detalle;
