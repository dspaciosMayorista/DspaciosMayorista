-- ───────────────────────────────────────────────────────────────────────────
-- PREFLIGHT (SOLO LECTURA) del hotfix DTM-0057 → DTM-0557.
--
-- Una sola sentencia SELECT: no escribe, no bloquea filas y no consume la
-- secuencia (lee last_value/is_called, nunca llama nextval). Es UN resultado
-- para que el editor SQL de Supabase lo muestre completo (solo muestra el
-- último). Exportar el resultado completo (CSV) y enviarlo: con él se
-- finaliza el bloque ESPERADOS del hotfix y del rollback.
--
-- Compatible con el esquema anterior a la migración 194 (movimientos_silla
-- sin numero_contrato/contrato_manual): esas filas salen como 'ausente'.
--
-- Columna `alerta`: 'DETENER' = cambia el alcance, no se finaliza el SQL sin
-- decidir; 'REVISAR' = dato que hay que mirar; vacío = informativo.
--
-- El barrido de la sección 90 recorre TODAS las columnas de texto/json/arrays
-- de public y storage (incluida auditoria) buscando DTM-0057, DTM-0557 y
-- DTM-0558. Es lectura secuencial; en una base del tamaño de producción toma
-- segundos.
-- ───────────────────────────────────────────────────────────────────────────

with
p as (select 'DTM-0057'::text as viejo, 'DTM-0557'::text as nuevo, 'DTM-0558'::text as siguiente),
seq as (select last_value, is_called, (select seqincrement from pg_sequence where seqrelid = 'public.contrato_seq_mayorista'::regclass) as incr
          from public.contrato_seq_mayorista),
fk as (
  select c.conname::text, c.conrelid::regclass::text as tabla, a.attname::text as columna,
         c.confrelid::regclass::text as referenciada, c.condeferrable, c.condeferred,
         case c.confdeltype when 'c' then 'cascade' when 'a' then 'no action' when 'r' then 'restrict' when 'n' then 'set null' else c.confdeltype::text end as on_delete,
         case c.confupdtype when 'c' then 'cascade' when 'a' then 'no action' when 'r' then 'restrict' when 'n' then 'set null' else c.confupdtype::text end as on_update
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
   where c.contype = 'f'
     and c.confrelid in ('public.ventas'::regclass, 'public.contrato_vuelo_control'::regclass)),
fk_conteo as (
  select fk.*, (xpath('/row/n/text()', query_to_xml(format(
           'select count(*) as n from %s where %I = %L', fk.tabla, fk.columna, (select viejo from p)),
           false, true, '')))[1]::text::bigint as filas
    from fk),
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
  select cols.*, x.*
    from cols
   cross join lateral (
     select (xpath('/row/a/text()', r))[1]::text::bigint as con_viejo,
            (xpath('/row/b/text()', r))[1]::text::bigint as con_nuevo,
            (xpath('/row/c/text()', r))[1]::text::bigint as con_siguiente
       from query_to_xml(format(
              'select count(*) filter (where %1$I::text like %4$L) as a,
                      count(*) filter (where %1$I::text like %5$L) as b,
                      count(*) filter (where %1$I::text like %6$L) as c
                 from %2$I.%3$I',
              cols.columna, cols.esquema, cols.tabla,
              '%' || (select viejo from p) || '%', '%' || (select nuevo from p) || '%',
              '%' || (select siguiente from p) || '%'),
            false, true, '') r) x),
refs as (
  -- Referencias sin FK. Antes de la migración 194 movimientos_silla NO tiene
  -- numero_contrato ni contrato_manual: aquí se distingue "la columna no
  -- existe" de "existe y cuenta 0", y solo se consulta si existe (el CASE
  -- evita que query_to_xml llegue a ejecutar SQL sobre una columna ausente).
  select x.*, (a.attnum is not null) as existe
    from (values
      ('conciliacion_sistema',   'numero_contrato', 'igual',    'REVISAR'),
      ('liquidacion_descuentos', 'numero_contrato', 'igual',    'REVISAR'),
      ('movimientos_silla',      'numero_contrato', 'igual',    'DETENER'),
      ('movimientos_silla',      'contrato_manual', 'contiene', 'DETENER'),
      ('sillas',                 'contrato_manual', 'contiene', 'DETENER')
    ) as x(tabla, columna, modo, alerta_si_hay)
    left join pg_attribute a
      on a.attrelid = to_regclass('public.' || x.tabla) and a.attname = x.columna
     and a.attnum > 0 and not a.attisdropped),
refs_conteo as (
  select refs.*,
         case when existe then
           (xpath('/row/n/text()', query_to_xml(format(
              case modo when 'igual' then 'select count(*) as n from public.%I where %I = %L'
                        else 'select count(*) as n from public.%I where %I::text ilike %L' end,
              tabla, columna,
              case modo when 'igual' then (select viejo from p) else '%' || (select viejo from p) || '%' end),
              false, true, '')))[1]::text::bigint
         end as n
    from refs),
tablas_hijas as (select distinct tabla from fk union select unnest(array[
  'ventas','conciliacion_sistema','liquidacion_descuentos','movimientos_silla',
  'asientos_contables','asiento_lineas','numeros_contrato_liberados'])),
filas as (
-- 01 · Secuencia y función de numeración ──────────────────────────────────
select 1 as orden, 'secuencia' as seccion, 'contrato_seq_mayorista' as detalle,
       format('last_value=%s is_called=%s increment=%s → próximo=%s',
              last_value, is_called, incr, case when is_called then last_value + incr else last_value end) as valor,
       case when (case when is_called then last_value + incr else last_value end) <> 58 or incr <> 1
            then 'DETENER' else '' end as alerta
  from seq
union all
select 2, 'funcion', 'siguiente_numero_contrato_para_tenant',
       format('md5(prosrc)=%s · formato 4 dígitos=%s · security=%s',
              md5(prosrc),
              prosrc like '%lpad(nextval(''public.contrato_seq_mayorista'')::text, 4, ''0'')%',
              case when prosecdef then 'definer' else 'invoker' end),
       case when prosrc not like '%lpad(nextval(''public.contrato_seq_mayorista'')::text, 4, ''0'')%' then 'DETENER' else '' end
  from pg_proc where oid = 'public.siguiente_numero_contrato_para_tenant(text)'::regprocedure
union all
select 3, 'funcion', 'privilegios EXECUTE', coalesce(array_to_string(proacl, ' '), '(default)'), ''
  from pg_proc where oid = 'public.siguiente_numero_contrato_para_tenant(text)'::regprocedure
-- 10 · Contratos ─────────────────────────────────────────────────────────
union all
select 10, 'ventas', v.numero_contrato,
       format('tenant=%s estado=%s financiero=%s facturado=%s cotizacion_id=%s salida=%s pax=%s md5(share_token)=%s actualizado=%s',
              v.tenant, v.estado, v.financiero_estado, v.facturado, coalesce(v.cotizacion_id::text, 'null'),
              v.fecha_salida, v.pax, md5(v.share_token::text), v.updated_at),
       case when v.numero_contrato = (select viejo from p) and v.tenant <> 'mayorista' then 'DETENER'
            when v.numero_contrato <> (select viejo from p) then 'DETENER'
            when v.financiero_estado = 'pendiente' or v.facturado then 'DETENER' else '' end
  from public.ventas v where v.numero_contrato in ((select viejo from p), (select nuevo from p), (select siguiente from p))
union all
select 11, 'ventas', 'existe ' || x.n, (count(v.numero_contrato) > 0)::text,
       case when (x.n = (select viejo from p)) <> (count(v.numero_contrato) > 0) then 'DETENER' else '' end
  from (select viejo as n from p union all select nuevo from p union all select siguiente from p) x
  left join public.ventas v on v.numero_contrato = x.n group by x.n
union all
select 12, 'ventas', 'DTM: cantidad / mínimo / máximo',
       format('%s / %s / %s', count(*), min(numero_contrato), max(numero_contrato)),
       case when max(substring(numero_contrato from '^DTM-([0-9]+)$')::int) <> 57 then 'DETENER' else '' end
  from public.ventas where numero_contrato like 'DTM-%'
union all
select 13, 'ventas', 'tenant/prefijo cruzados',
       count(*)::text, case when count(*) > 0 then 'DETENER' else '' end
  from public.ventas
 where (numero_contrato like 'DTM-%' and tenant <> 'mayorista')
    or (tenant = 'mayorista' and numero_contrato !~ '^DTM-[0-9]{4,}$')
union all
select 14, 'ventas', 'constraint de formato',
       coalesce((select pg_get_constraintdef(oid) from pg_constraint
                  where conrelid = 'public.ventas'::regclass and conname = 'ventas_numero_contrato_formato_por_tenant'), 'NO EXISTE'),
       ''
-- 20 · Catálogo de FKs + filas de DTM-0057 por tabla ─────────────────────
union all
select 20, 'fk', format('%s.%s → %s', tabla, columna, referenciada),
       format('filas=%s · %s · on_delete=%s on_update=%s · deferrable=%s initially_deferred=%s',
              filas, conname, on_delete, on_update, condeferrable, condeferred),
       case when condeferrable then 'DETENER'
            when filas > 0 and tabla in ('sillas','vouchers','facturacion','contrato_facturacion',
                                         'contrato_adjuntos','restriccion_overrides',
                                         'contrato_financiero_pendiente') then 'DETENER'
            when filas > 0 and tabla not in ('contrato_pasajeros','contrato_vuelos','contrato_hoteles',
                                             'contrato_items','cuentas_por_pagar') then 'REVISAR'
            else '' end
  from fk_conteo
union all
select 21, 'fk', 'total FKs hacia ventas / contrato_vuelo_control', count(*)::text,
       case when count(*) <> 23 then 'REVISAR' else '' end from fk
-- 30 · Referencias sin FK conocidas ──────────────────────────────────────
union all
select 30, 'ref', tabla || '.' || columna,
       case when not existe
            then 'ausente: la columna no existe en este esquema (no es 0; el barrido 90 sigue revisando la tabla)'
            else n::text end,
       case when existe and n > 0 then alerta_si_hay else '' end
  from refs_conteo
union all
select 30, 'ref', 'numeros_contrato_liberados (DTM-%)',
       coalesce(string_agg(numero, ', '), '0'), case when count(*) > 0 then 'DETENER' else '' end
  from public.numeros_contrato_liberados where numero like 'DTM-%'
union all
select 30, 'ref', 'storage.objects (nombre con DTM-0057/0557/0558)',
       coalesce(string_agg(bucket_id || '/' || name, ', '), '0'), case when count(*) > 0 then 'DETENER' else '' end
  from storage.objects
 where name like '%' || (select viejo from p) || '%' or name like '%' || (select nuevo from p) || '%'
    or name like '%' || (select siguiente from p) || '%'
-- 40 · Asientos contables que nombran el contrato (posteo automático) ────
union all
select 40, 'asientos', format('asiento #%s %s origen=%s ref=%s', a.numero, a.fecha, a.origen, a.referencia),
       format('descripcion="%s" · líneas con tercero=%s: %s', a.descripcion, (select viejo from p),
              (select count(*) from public.asiento_lineas l where l.asiento_id = a.id and l.tercero = (select viejo from p))),
       case when a.descripcion not like '%(' || (select viejo from p) || ')%' or a.origen <> 'cxp'
            then 'DETENER' else 'REVISAR' end
  from public.asientos_contables a
 where a.descripcion like '%' || (select viejo from p) || '%'
    or exists (select 1 from public.asiento_lineas l where l.asiento_id = a.id and l.tercero = (select viejo from p))
union all
select 41, 'asientos', 'totales: asientos con DTM-0057 en descripcion / líneas con tercero DTM-0057',
       format('%s / %s',
              (select count(*) from public.asientos_contables where descripcion like '%' || (select viejo from p) || '%'),
              (select count(*) from public.asiento_lineas where tercero = (select viejo from p))),
       'REVISAR'
-- 50 · Detalle sin datos personales ──────────────────────────────────────
union all
select 50, 'pasajeros', format('id=%s orden=%s', id, orden),
       format('es_infante=%s responsable=%s', es_infante, coalesce(responsable_id::text, 'null')), ''
  from public.contrato_pasajeros where numero_contrato = (select viejo from p)
union all
select 51, 'condiciones', format('id=%s %s', id, tipo_componente),
       format('overrides=%s', (select count(*) from public.restriccion_overrides o where o.contrato_condicion_id = cc.id)),
       case when exists (select 1 from public.restriccion_overrides o where o.contrato_condicion_id = cc.id) then 'DETENER' else 'REVISAR' end
  from public.contrato_condiciones cc where numero_contrato = (select viejo from p)
union all
select 52, 'facturacion', format('facturacion: %s · contrato_facturacion: %s',
         (select count(*) from public.facturacion where numero_contrato = (select viejo from p)),
         (select count(*) from public.contrato_facturacion where numero_contrato = (select viejo from p))),
       'documentos fiscales', case when exists (select 1 from public.facturacion where numero_contrato = (select viejo from p))
                                     or exists (select 1 from public.contrato_facturacion where numero_contrato = (select viejo from p))
                                   then 'DETENER' else '' end
-- 60 · Triggers en las tablas involucradas ───────────────────────────────
union all
select 60, 'trigger', format('%s · %s', t.tgrelid::regclass, t.tgname),
       format('%s · enabled=%s', pr.proname, t.tgenabled),
       case when t.tgenabled <> 'O' then 'REVISAR'
            when t.tgname not in ('trg_auditoria','trg_ventas_cotizacion_id_inmutable','trg_bloquear_abono_financiero_pendiente',
                                  'sillas_guarda_escritura','sillas_guarda_truncate','movimientos_historial_inmutable',
                                  'movimientos_historial_sin_truncate','trg_validar_responsable_infante',
                                  'trg_cotizaciones_bloquear_cambio_tenant','trg_cotizaciones_no_descartar_con_pagos',
                                  'trg_contrato_condiciones_inmutable','trg_restriccion_overrides_guardas')
            then 'REVISAR' else '' end
  from pg_trigger t join pg_proc pr on pr.oid = t.tgfoid
 where not t.tgisinternal
   and t.tgrelid::regclass::text in (select tabla from tablas_hijas)
-- 70 · Seguridad / quién ejecuta ─────────────────────────────────────────
union all
select 70, 'ejecucion', 'current_user / dueño de la secuencia y de las tablas involucradas',
       current_user || ' / ' || string_agg(distinct pg_get_userbyid(relowner)::text, ', '),
       case when bool_or(pg_get_userbyid(relowner) <> current_user) then 'DETENER' else '' end
  from pg_class
 where oid = 'public.contrato_seq_mayorista'::regclass
    or (relnamespace = 'public'::regnamespace and relkind = 'r' and relname in (select tabla from tablas_hijas))
union all
select 71, 'ejecucion', 'tablas con FORCE ROW LEVEL SECURITY',
       coalesce(string_agg(relname, ', '), 'ninguna'), case when count(*) > 0 then 'REVISAR' else '' end
  from pg_class where relforcerowsecurity and relname in (select tabla from tablas_hijas)
-- 80 · Escritores concurrentes (foto del momento) ────────────────────────
union all
select 80, 'concurrencia', format('pid=%s %s', pid, coalesce(nullif(application_name, ''), usename::text)),
       format('state=%s xact_desde=%s query=%s', state, xact_start, left(regexp_replace(query, '\s+', ' ', 'g'), 120)),
       case when state <> 'idle' then 'REVISAR' else '' end
  from pg_stat_activity
 where datname = current_database() and pid <> pg_backend_pid() and backend_type = 'client backend'
   and (state <> 'idle' or xact_start is not null)
union all
select 81, 'concurrencia', 'locks vivos sobre tablas involucradas',
       coalesce(string_agg(distinct l.relation::regclass::text || ':' || l.mode, ', '), 'ninguno'),
       case when count(*) > 0 then 'REVISAR' else '' end
  from pg_locks l where l.pid <> pg_backend_pid() and l.relation is not null
   and l.relation::regclass::text in (select tabla from tablas_hijas union select 'contrato_seq_mayorista')
-- 90 · Barrido completo de texto ─────────────────────────────────────────
union all
select 90, 'barrido', format('%s.%s.%s', esquema, tabla, columna),
       format('DTM-0057=%s · DTM-0557=%s · DTM-0558=%s', con_viejo, con_nuevo, con_siguiente),
       case when (con_nuevo > 0 or con_siguiente > 0) then 'DETENER'
            when tabla = 'auditoria' then ''
            when tabla in (select tabla from fk) and columna = 'numero_contrato' then ''
            when tabla = 'ventas' and columna = 'numero_contrato' then ''
            else 'REVISAR' end
  from barrido where con_viejo + con_nuevo + con_siguiente > 0
union all
select 91, 'barrido', 'columnas revisadas / tamaño de tablas recorridas (sin auditoria)',
       format('%s columnas · %s', (select count(*) from cols),
              pg_size_pretty((select sum(pg_total_relation_size(format('%I.%I', esquema, tabla)::regclass))
                                from (select distinct esquema, tabla from cols where tabla <> 'auditoria') d))),
       ''
)
select orden, seccion, detalle, valor, alerta from filas order by orden, seccion, detalle;
