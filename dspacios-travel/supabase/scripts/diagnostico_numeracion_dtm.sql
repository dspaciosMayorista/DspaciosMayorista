-- ═══════════════════════════════════════════════════════════════════════════
-- DIAGNÓSTICO v2 — Reenumeración de contratos MAYORISTA a formato DTM-####
--
-- SOLO LECTURA. Inspeccionado a mano y por bootstrap local: NO contiene
-- INSERT/UPDATE/DELETE/MERGE, ninguna sentencia DDL (CREATE/ALTER/DROP), no
-- llama nextval()/setval() ni ninguna función con efectos secundarios. La
-- única lectura de la secuencia es `select * from public.contrato_seq`, que
-- lee su estado sin consumirla (a diferencia de nextval()).
--
-- v2 — corrige los 8 defectos señalados sobre v1:
--   1. UNA FILA POR SECCIÓN (antes: la sección 3 sola podía devolver hasta
--      2000 filas y tapar las secciones 4-10 bajo el límite de 100 filas del
--      SQL Editor). Cada sección es ahora un único jsonb_agg/jsonb_build_object,
--      así el reporte completo cabe siempre en el límite normal de 100 filas
--      (quedan ~13 filas totales).
--   2. Nueva sección — asientos_contables de origen 'facturacion': mapea
--      referencia actual → futura, huérfanas, colisiones.
--   3. Nueva sección — share_token: confirma DESDE EL CÓDIGO REAL de
--      fn_renumerar_contrato (leído de pg_proc, no de un archivo) si
--      regenera el token, cuenta contratos con token y cuántos se invalidarían.
--   4. Storage ampliado: mapa ruta actual → ruta propuesta por objeto
--      (embebido en jsonb, no como filas sueltas), conteo por contrato,
--      detección de colisión de ruta destino.
--   5. Inventario DINÁMICO de FK vía pg_constraint/pg_attribute (recursivo,
--      encuentra también la FK anidada de segundo nivel) + comparación
--      automática contra la lista cubierta a mano; si algo real quedó fuera,
--      lo marca como ERROR visible en el propio resultado (no aborta: un
--      diagnóstico que no termina de correr es menos útil que uno que grita
--      "faltó cubrir X" dentro del mismo reporte consolidado).
--   6. auditoria: mide el volumen ANTES de correr el regex sobre registro_id
--      (se omite si la tabla es enorme) y nunca toca las columnas jsonb
--      antes/despues (quedarían fuera de cualquier UPDATE futuro, por diseño:
--      son el historial tal como ocurrió).
--   7. Declara explícitamente que `ventas` no tiene id propio — numero_contrato
--      ES la PK. La tabla de reenumeración usa numero_contrato_actual /
--      numero_propuesto, nunca un id inventado.
--   8. La propuesta reporta created_at NULL (defensivo — la columna es NOT
--      NULL, así que esto debería dar siempre 0), cuántas posiciones pasarían
--      de 9999 (con la consecuencia real: lpad no trunca, el número sigue
--      siendo válido pero dejaría de tener ancho fijo de 4 dígitos) y marca
--      aparte, sin mezclarlos en la reenumeración normal, los contratos que
--      YA tienen prefijo DTM-.
-- ═══════════════════════════════════════════════════════════════════════════

with recursive

-- ─────────────────────────────────────────────────────────────────────────
-- Clasificación base de cada fila de ventas (igual que v1)
-- ─────────────────────────────────────────────────────────────────────────
clasificado as (
  select
    v.numero_contrato,
    v.tenant,
    v.created_at,
    v.share_token,
    case
      when v.numero_contrato is null or btrim(v.numero_contrato) = '' then 'VACÍO/NULL'
      when v.numero_contrato ~ '^00-[0-9]+$'        then 'mayorista: 00-NNNN (estándar)'
      when v.numero_contrato ~ '^MIN-00-[0-9]+$'    then 'minorista: MIN-00-NNNN (estándar)'
      when v.numero_contrato ~ '^MIN-'              then 'minorista: MIN- + formato atípico'
      when v.numero_contrato ~ '^DTM-[0-9]+$'       then '¡YA EXISTE DTM! (colisión potencial / ya renumerado)'
      else 'formato atípico / inesperado'
    end as patron,
    (v.numero_contrato ~ '^DTM-[0-9]+$') as ya_es_dtm,
    nullif(regexp_replace(coalesce(v.numero_contrato, ''), '\D', '', 'g'), '')::bigint as num_extraido
  from public.ventas v
),

-- Reenumeración propuesta SOLO para mayorista que aún NO tiene prefijo DTM-.
-- Orden determinista: created_at asc, desempate numérico, desempate texto.
propuesta as (
  select
    numero_contrato, tenant, created_at, share_token, num_extraido, ya_es_dtm,
    row_number() over (
      order by created_at asc nulls last, num_extraido asc nulls last, numero_contrato asc
    ) as posicion
  from clasificado
  where tenant = 'mayorista' and not ya_es_dtm
),

propuesta_map as (
  select
    numero_contrato as numero_contrato_actual,
    'DTM-' || lpad(posicion::text, 4, '0') as numero_propuesto,
    posicion, created_at, share_token
  from propuesta
),

-- ─────────────────────────────────────────────────────────────────────────
-- Inventario DINÁMICO de FK hacia ventas(numero_contrato), recursivo.
-- No asume nombres de tabla: camina pg_constraint/pg_attribute buscando,
-- nivel 1, cualquier FK de una sola columna cuyo lado referenciado sea
-- ventas.numero_contrato; nivel 2+, cualquier FK que a su vez referencie a
-- una tabla ya encontrada, siempre que la columna en ambos lados se llame
-- numero_contrato (así es en las 158 migraciones reales; si algún día deja
-- de serlo, esta consulta simplemente no la encontraría — por eso el punto
-- 5 la contrasta contra la lista manual y marca el hueco como ERROR).
-- ─────────────────────────────────────────────────────────────────────────
fk_chain as (
  select
    c.conrelid::regclass::text as tabla,
    c.conrelid as tabla_oid,
    c.confrelid::regclass::text as tabla_referenciada,
    c.confupdtype,
    c.condeferrable,
    1 as nivel
  from pg_constraint c
  join pg_class cl on cl.oid = c.conrelid and cl.relnamespace = 'public'::regnamespace
  join pg_attribute a  on a.attrelid  = c.conrelid  and a.attnum  = c.conkey[1]
  join pg_attribute ra on ra.attrelid = c.confrelid and ra.attnum = c.confkey[1]
  where c.contype = 'f'
    and array_length(c.conkey, 1) = 1
    and a.attname = 'numero_contrato'
    and ra.attname = 'numero_contrato'
    and c.confrelid = 'public.ventas'::regclass

  union all

  select
    c.conrelid::regclass::text,
    c.conrelid,
    c.confrelid::regclass::text,
    c.confupdtype,
    c.condeferrable,
    fk.nivel + 1
  from pg_constraint c
  join pg_class cl on cl.oid = c.conrelid and cl.relnamespace = 'public'::regnamespace
  join pg_attribute a  on a.attrelid  = c.conrelid  and a.attnum  = c.conkey[1]
  join pg_attribute ra on ra.attrelid = c.confrelid and ra.attnum = c.confkey[1]
  join fk_chain fk on c.confrelid = fk.tabla_oid
  where c.contype = 'f'
    and array_length(c.conkey, 1) = 1
    and a.attname = 'numero_contrato'
    and ra.attname = 'numero_contrato'
),

-- Tablas que este script SÍ mide a mano (conteo real: total/de-mayorista/
-- huérfanas) en la sección "Referencias por tabla". Nivel 1 = FK directa a
-- ventas; nivel 2 = FK anidada. Se contrasta contra fk_chain más abajo.
manual_nivel1(tabla) as (
  values
    ('abonos'), ('cuentas_por_pagar'), ('aliados_b2b'), ('liquidacion_comisiones'),
    ('facturacion'), ('rentabilidad'), ('sillas'), ('contrato_pasajeros'),
    ('contrato_hoteles'), ('contrato_vuelos'), ('contrato_items'),
    ('contrato_adjuntos'), ('cotizaciones'), ('vouchers'), ('cuotas'),
    ('contrato_facturacion'), ('contrato_servicios'), ('contrato_vuelo_control')
),
manual_nivel2(tabla) as (
  values ('contrato_vuelo_control_cambios')
),

fk_comparacion as (
  select
    (select coalesce(jsonb_agg(f.tabla order by f.tabla), '[]'::jsonb)
       from (select distinct tabla from fk_chain where nivel = 1) f
      where f.tabla not in (select tabla from manual_nivel1)) as faltantes_nivel1,
    (select coalesce(jsonb_agg(f.tabla order by f.tabla), '[]'::jsonb)
       from (select distinct tabla from fk_chain where nivel = 1) f
      where f.tabla not in (select tabla from manual_nivel1)) is not null as _dummy
),

-- ─────────────────────────────────────────────────────────────────────────
-- Asientos contables de facturación cuya referencia embebe numero_contrato
-- como texto libre (`facturacion:<numero>`), sin FK. Solo se PARSEA/COMPARA,
-- nunca se toca.
-- ─────────────────────────────────────────────────────────────────────────
asientos_facturacion as (
  select
    ac.id, ac.tenant, ac.referencia,
    regexp_replace(ac.referencia, '^facturacion:', '') as numero_extraido
  from public.asientos_contables ac
  where ac.origen = 'facturacion' and ac.referencia like 'facturacion:%'
),

-- ─────────────────────────────────────────────────────────────────────────
-- Confirmación DESDE EL CÓDIGO REAL (pg_proc, no un archivo leído una vez)
-- de si fn_renumerar_contrato regenera share_token.
-- ─────────────────────────────────────────────────────────────────────────
fn_renumerar_src as (
  select p.prosrc
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'fn_renumerar_contrato'
  limit 1
),

-- ─────────────────────────────────────────────────────────────────────────
-- Storage — objetos del bucket `contratos` cuyo prefijo es un numero_contrato
-- de mayorista a renumerar. Mapa actual→propuesto embebido en jsonb (tope
-- informativo de 500 objetos por sección para no inflar una sola celda; si
-- se trunca, el conteo real igual se reporta aparte).
-- ─────────────────────────────────────────────────────────────────────────
storage_mayorista as (
  select
    o.name as ruta_actual,
    split_part(o.name, '/', 1) as numero_actual,
    pm.numero_propuesto,
    pm.numero_propuesto || substring(o.name from position('/' in o.name)) as ruta_propuesta
  from storage.objects o
  join propuesta_map pm on pm.numero_contrato_actual = split_part(o.name, '/', 1)
  where o.bucket_id = 'contratos'
),

storage_colisiones as (
  select distinct sm.numero_actual, sm.numero_propuesto
  from storage_mayorista sm
  where exists (
    select 1 from storage.objects o2
    where o2.bucket_id = 'contratos'
      and split_part(o2.name, '/', 1) = sm.numero_propuesto
  )
),

auditoria_stats as (
  select count(*) as total_filas from public.auditoria
)

-- ═══════════════════════════════════════════════════════════════════════════
-- REPORTE — una fila por sección
-- ═══════════════════════════════════════════════════════════════════════════

select 0 as orden, '0. Resumen ejecutivo' as seccion,
  jsonb_build_object(
    'total_ventas', (select count(*) from public.ventas),
    'mayorista', (select count(*) from public.ventas where tenant = 'mayorista'),
    'minorista', (select count(*) from public.ventas where tenant = 'minorista'),
    'mayorista_ya_con_prefijo_dtm', (select count(*) from clasificado where tenant = 'mayorista' and ya_es_dtm),
    'mayorista_pendientes_de_reenumerar', (select count(*) from propuesta),
    'created_min_mayorista', (select min(created_at) from public.ventas where tenant = 'mayorista'),
    'created_max_mayorista', (select max(created_at) from public.ventas where tenant = 'mayorista'),
    'rango_propuesto', case when (select count(*) from propuesta) = 0 then null
      else 'DTM-0001 .. DTM-' || lpad((select max(posicion) from propuesta)::text, 4, '0') end,
    'nota_identidad', 'ventas NO tiene un id propio: numero_contrato ES la PRIMARY KEY (text). Toda referencia en este reporte usa numero_contrato_actual / numero_propuesto, nunca un id inventado.'
  ) as resultado

union all
select 1, '1. Contratos por tenant',
  jsonb_build_object(
    'por_tenant', (select coalesce(jsonb_agg(jsonb_build_object('tenant', tenant, 'cantidad', cnt) order by tenant), '[]'::jsonb)
                     from (select tenant, count(*) cnt from public.ventas group by tenant) x),
    'tenant_ambiguo_o_null', (select count(*) from public.ventas where tenant is null or tenant not in ('mayorista','minorista'))
  )

union all
select 2, '2. Formato de numero_contrato por tenant',
  jsonb_build_object(
    'detalle', (select coalesce(jsonb_agg(jsonb_build_object('tenant', tenant, 'patron', patron, 'cantidad', cnt) order by tenant, patron), '[]'::jsonb)
                  from (select tenant, patron, count(*) cnt from clasificado group by tenant, patron) x)
  )

union all
select 3, '3. Reenumeración propuesta (mayorista, excluye los que YA tienen prefijo DTM-)',
  jsonb_build_object(
    'total_a_reenumerar', (select count(*) from propuesta),
    'created_at_null', (select count(*) from propuesta where created_at is null),
    'posiciones_mayores_a_9999', (select count(*) from propuesta where posicion > 9999),
    'nota_9999', 'lpad(posicion,4,''0'') NO trunca: a partir de la posición 10000 el número sigue siendo válido (DTM-10000) pero deja de tener ancho fijo de 4 dígitos — cualquier ORDER BY por texto plano sobre numero_contrato dejaría de coincidir con el orden numérico a partir de ahí. Hoy son 0 casos; revisar de nuevo si el conteo de arriba deja de ser 0.',
    'ya_con_prefijo_dtm_excluidos_de_la_lista', (select count(*) from clasificado where tenant = 'mayorista' and ya_es_dtm),
    'lista', (select coalesce(jsonb_agg(jsonb_build_object(
                'posicion', posicion,
                'numero_contrato_actual', numero_contrato_actual,
                'created_at', created_at,
                'numero_propuesto', numero_propuesto
              ) order by posicion), '[]'::jsonb)
              from propuesta_map)
  )

union all
select 4, '4. Duplicados (esperado: 0, numero_contrato es PK) e inválidos',
  jsonb_build_object(
    'duplicados', (select coalesce(jsonb_agg(jsonb_build_object('numero_contrato', numero_contrato, 'veces', cnt)), '[]'::jsonb)
                     from (select numero_contrato, count(*) cnt from public.ventas group by numero_contrato having count(*) > 1) d),
    'formato_atipico_o_vacio', (select coalesce(jsonb_agg(jsonb_build_object(
                'numero_contrato', numero_contrato, 'tenant', tenant, 'created_at', created_at, 'patron', patron
              ) order by created_at), '[]'::jsonb)
              from clasificado where patron not like '%estándar%' and not ya_es_dtm)
  )

union all
select 5, '5. Máximo consecutivo por tenant + estado crudo de contrato_seq (secuencia GLOBAL, compartida hoy por los dos tenants)',
  jsonb_build_object(
    'maximo_por_tenant', (select coalesce(jsonb_agg(jsonb_build_object('tenant', tenant, 'maximo_numerico', mx) order by tenant), '[]'::jsonb)
                             from (select tenant, max(num_extraido) mx from clasificado group by tenant) x),
    'contrato_seq_last_value', (select last_value from public.contrato_seq),
    'contrato_seq_is_called', (select is_called from public.contrato_seq)
  )

union all
select 6,
  case when (select faltantes_nivel1 from fk_comparacion) = '[]'::jsonb
    then '6. Inventario DINÁMICO de FK hacia ventas(numero_contrato) — OK, coincide con lo medido a mano'
    else '6. Inventario DINÁMICO de FK hacia ventas(numero_contrato) — ⚠️ ERROR: hay FK real NO cubierta por este diagnóstico'
  end,
  jsonb_build_object(
    'cadena_completa', (select coalesce(jsonb_agg(jsonb_build_object(
                'tabla', tabla, 'tabla_referenciada', tabla_referenciada, 'nivel', nivel,
                'on_update', case confupdtype
                  when 'a' then 'NO ACTION (bloquea el UPDATE del padre si hay hijas — el caso por defecto en este esquema)'
                  when 'r' then 'RESTRICT'
                  when 'c' then 'CASCADE'
                  when 'n' then 'SET NULL'
                  when 'd' then 'SET DEFAULT'
                  else confupdtype::text
                end,
                'deferrable', condeferrable
              ) order by nivel, tabla), '[]'::jsonb)
              from fk_chain),
    'tablas_nivel1_no_cubiertas_a_mano', (select faltantes_nivel1 from fk_comparacion),
    'tablas_nivel2_encontradas', (select coalesce(jsonb_agg(distinct tabla), '[]'::jsonb) from fk_chain where nivel >= 2),
    'tablas_nivel2_no_cubiertas_a_mano', (select coalesce(jsonb_agg(f.tabla), '[]'::jsonb)
                                             from (select distinct tabla from fk_chain where nivel >= 2) f
                                            where f.tabla not in (select tabla from manual_nivel2)),
    'ok', (select faltantes_nivel1 from fk_comparacion) = '[]'::jsonb
          and (select count(*) from (select distinct tabla from fk_chain where nivel >= 2) f where f.tabla not in (select tabla from manual_nivel2)) = 0
  )

union all
select 7, '7. Referencias por tabla — FK real (total / de-mayorista / huérfanas; huérfanas debería ser 0 siempre, la FK lo garantiza)',
  jsonb_build_object(
    'tablas', (select coalesce(jsonb_agg(to_jsonb(x) order by x.tabla), '[]'::jsonb) from (
      select 'abonos' tabla, count(*) total, count(*) filter (where v.tenant='mayorista') de_mayorista,
             count(*) filter (where t.numero_contrato is not null and v.numero_contrato is null) huerfanas
        from public.abonos t left join public.ventas v on v.numero_contrato = t.numero_contrato
      union all
      select 'cuentas_por_pagar', count(*), count(*) filter (where v.tenant='mayorista'),
             count(*) filter (where t.numero_contrato is not null and v.numero_contrato is null)
        from public.cuentas_por_pagar t left join public.ventas v on v.numero_contrato = t.numero_contrato
      union all
      select 'aliados_b2b', count(*), count(*) filter (where v.tenant='mayorista'),
             count(*) filter (where t.numero_contrato is not null and v.numero_contrato is null)
        from public.aliados_b2b t left join public.ventas v on v.numero_contrato = t.numero_contrato
      union all
      select 'liquidacion_comisiones', count(*), count(*) filter (where v.tenant='mayorista'),
             count(*) filter (where t.numero_contrato is not null and v.numero_contrato is null)
        from public.liquidacion_comisiones t left join public.ventas v on v.numero_contrato = t.numero_contrato
      union all
      select 'facturacion', count(*), count(*) filter (where v.tenant='mayorista'),
             count(*) filter (where t.numero_contrato is not null and v.numero_contrato is null)
        from public.facturacion t left join public.ventas v on v.numero_contrato = t.numero_contrato
      union all
      select 'rentabilidad', count(*), count(*) filter (where v.tenant='mayorista'),
             count(*) filter (where t.numero_contrato is not null and v.numero_contrato is null)
        from public.rentabilidad t left join public.ventas v on v.numero_contrato = t.numero_contrato
      union all
      select 'sillas', count(*) filter (where t.numero_contrato is not null), count(*) filter (where v.tenant='mayorista'),
             count(*) filter (where t.numero_contrato is not null and v.numero_contrato is null)
        from public.sillas t left join public.ventas v on v.numero_contrato = t.numero_contrato
      union all
      select 'contrato_pasajeros', count(*), count(*) filter (where v.tenant='mayorista'),
             count(*) filter (where t.numero_contrato is not null and v.numero_contrato is null)
        from public.contrato_pasajeros t left join public.ventas v on v.numero_contrato = t.numero_contrato
      union all
      select 'contrato_hoteles', count(*), count(*) filter (where v.tenant='mayorista'),
             count(*) filter (where t.numero_contrato is not null and v.numero_contrato is null)
        from public.contrato_hoteles t left join public.ventas v on v.numero_contrato = t.numero_contrato
      union all
      select 'contrato_vuelos', count(*), count(*) filter (where v.tenant='mayorista'),
             count(*) filter (where t.numero_contrato is not null and v.numero_contrato is null)
        from public.contrato_vuelos t left join public.ventas v on v.numero_contrato = t.numero_contrato
      union all
      select 'contrato_items', count(*), count(*) filter (where v.tenant='mayorista'),
             count(*) filter (where t.numero_contrato is not null and v.numero_contrato is null)
        from public.contrato_items t left join public.ventas v on v.numero_contrato = t.numero_contrato
      union all
      select 'contrato_adjuntos', count(*), count(*) filter (where v.tenant='mayorista'),
             count(*) filter (where t.numero_contrato is not null and v.numero_contrato is null)
        from public.contrato_adjuntos t left join public.ventas v on v.numero_contrato = t.numero_contrato
      union all
      select 'cotizaciones', count(*) filter (where t.numero_contrato is not null), count(*) filter (where v.tenant='mayorista'),
             count(*) filter (where t.numero_contrato is not null and v.numero_contrato is null)
        from public.cotizaciones t left join public.ventas v on v.numero_contrato = t.numero_contrato
      union all
      select 'vouchers', count(*), count(*) filter (where v.tenant='mayorista'),
             count(*) filter (where t.numero_contrato is not null and v.numero_contrato is null)
        from public.vouchers t left join public.ventas v on v.numero_contrato = t.numero_contrato
      union all
      select 'cuotas', count(*), count(*) filter (where v.tenant='mayorista'),
             count(*) filter (where t.numero_contrato is not null and v.numero_contrato is null)
        from public.cuotas t left join public.ventas v on v.numero_contrato = t.numero_contrato
      union all
      select 'contrato_facturacion', count(*), count(*) filter (where v.tenant='mayorista'),
             count(*) filter (where t.numero_contrato is not null and v.numero_contrato is null)
        from public.contrato_facturacion t left join public.ventas v on v.numero_contrato = t.numero_contrato
      union all
      select 'contrato_servicios', count(*), count(*) filter (where v.tenant='mayorista'),
             count(*) filter (where t.numero_contrato is not null and v.numero_contrato is null)
        from public.contrato_servicios t left join public.ventas v on v.numero_contrato = t.numero_contrato
      union all
      select 'contrato_vuelo_control', count(*), count(*) filter (where v.tenant='mayorista'),
             count(*) filter (where t.numero_contrato is not null and v.numero_contrato is null)
        from public.contrato_vuelo_control t left join public.ventas v on v.numero_contrato = t.numero_contrato
      union all
      select 'contrato_vuelo_control_cambios (⚠️ FK ANIDADA: → contrato_vuelo_control, NO → ventas)',
             count(*), count(*) filter (where v.tenant='mayorista'), 0
        from public.contrato_vuelo_control_cambios c
        join public.contrato_vuelo_control cvc on cvc.numero_contrato = c.numero_contrato
        left join public.ventas v on v.numero_contrato = cvc.numero_contrato
    ) x)
  )

union all
select 8, '8. Referencias SIN FK (texto suelto) — no las camina fn_renumerar_contrato',
  jsonb_build_object(
    'conciliacion_sistema', jsonb_build_object(
      'nota', 'Snapshot al momento de cruzar (migración 124). Decisión pendiente: ¿se actualiza al renumerar o queda como registro histórico del número con el que se concilió?',
      'total_con_contrato', (select count(*) from public.conciliacion_sistema where numero_contrato is not null),
      'de_mayorista', (select count(*) from public.conciliacion_sistema t join public.ventas v on v.numero_contrato = t.numero_contrato where v.tenant = 'mayorista'),
      'huerfanas', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'numero_contrato', t.numero_contrato)), '[]'::jsonb)
                      from public.conciliacion_sistema t
                     where t.numero_contrato is not null
                       and not exists (select 1 from public.ventas v where v.numero_contrato = t.numero_contrato))
    ),
    'liquidacion_descuentos', jsonb_build_object(
      'nota', 'Trazabilidad opcional a un contrato puntual (migración 132), no obligatoria.',
      'total_con_contrato', (select count(*) from public.liquidacion_descuentos where numero_contrato is not null),
      'de_mayorista', (select count(*) from public.liquidacion_descuentos t join public.ventas v on v.numero_contrato = t.numero_contrato where v.tenant = 'mayorista'),
      'huerfanas', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'numero_contrato', t.numero_contrato)), '[]'::jsonb)
                      from public.liquidacion_descuentos t
                     where t.numero_contrato is not null
                       and not exists (select 1 from public.ventas v where v.numero_contrato = t.numero_contrato))
    ),
    'auditoria', jsonb_build_object(
      'nota', 'registro_id (texto) Y los snapshots jsonb antes/despues de CUALQUIER tabla auditada son historial: describen el estado real en el momento en que ocurrió cada operación. Reescribirlos para reflejar el número nuevo falsificaría el log — por diseño NO se tocan nunca, ni en esta auditoría ni en la futura migración. Por el mismo motivo este diagnóstico tampoco escanea el contenido de antes/despues (sería una búsqueda jsonb costosa y su resultado no cambiaría ninguna decisión: esas filas no se van a modificar de todas formas).',
      'total_filas_auditoria', (select total_filas from auditoria_stats),
      'omitido_por_volumen', (select total_filas from auditoria_stats) > 200000,
      'coincidencias_formato_contrato_en_registro_id', case when (select total_filas from auditoria_stats) <= 200000
        then (select count(*) from public.auditoria a where a.registro_id ~ '^(00-|MIN-|DTM-)')
        else null
      end
    )
  )

union all
select 9, '9. Asientos contables (origen=facturacion) — referencia embebe numero_contrato como texto, sin FK',
  jsonb_build_object(
    'nota', 'asientos_contables.referencia para origen=facturacion es literalmente ''facturacion:<numero_contrato>'' (app/(dashboard)/dashboard/contabilidad/facturacion/actions.ts). Se usa para ENCONTRAR y reversar el asiento — si se renumera el contrato sin actualizar esto, la próxima facturación (que usará el número nuevo) no encontrará el asiento viejo para reversarlo y quedaría un asiento huérfano + uno nuevo duplicado.',
    'total_asientos_facturacion', (select count(*) from asientos_facturacion),
    'de_contratos_mayoristas_a_reenumerar', (select coalesce(jsonb_agg(jsonb_build_object(
                'asiento_id', af.id,
                'referencia_actual', af.referencia,
                'referencia_futura', 'facturacion:' || pm.numero_propuesto
              ) order by af.id), '[]'::jsonb)
              from asientos_facturacion af
              join propuesta_map pm on pm.numero_contrato_actual = af.numero_extraido),
    'huerfanas_ya_hoy', (select coalesce(jsonb_agg(jsonb_build_object('asiento_id', af.id, 'referencia', af.referencia)), '[]'::jsonb)
                            from asientos_facturacion af
                           where not exists (select 1 from public.ventas v where v.numero_contrato = af.numero_extraido)),
    'colisiones_con_referencia_dtm_ya_existente', (select coalesce(jsonb_agg(jsonb_build_object('asiento_id', af.id, 'referencia', af.referencia)), '[]'::jsonb)
                            from asientos_facturacion af
                           where af.numero_extraido ~ '^DTM-')
  )

union all
select 10, '10. share_token — confirmación desde el código real de fn_renumerar_contrato',
  jsonb_build_object(
    'fn_renumerar_contrato_existe', (select fn_renumerar_src is not null from fn_renumerar_src) is true,
    'confirma_que_regenera_share_token', (select prosrc ilike '%share_token%' and prosrc ilike '%gen_random_uuid%' from fn_renumerar_src),
    'evidencia_fuente_pg_proc', (select substring(prosrc from 'when column_name = ''share_token''[^,]*,?') from fn_renumerar_src),
    'mayorista_con_share_token', (select count(*) from public.ventas where tenant = 'mayorista' and share_token is not null),
    'enlaces_que_se_invalidarian_si_se_reenumera_con_la_funcion_actual',
      (select count(*) from propuesta_map pm join public.ventas v on v.numero_contrato = pm.numero_contrato_actual where v.share_token is not null)
  )

union all
select 11, '11. Storage — mapa ruta actual → ruta propuesta (bucket contratos, solo objetos de mayorista a reenumerar)',
  jsonb_build_object(
    'total_objetos_afectados', (select count(*) from storage_mayorista),
    'objetos_por_contrato', (select coalesce(jsonb_agg(jsonb_build_object('numero_actual', numero_actual, 'numero_propuesto', numero_propuesto, 'objetos', cnt) order by numero_actual), '[]'::jsonb)
                                from (select numero_actual, numero_propuesto, count(*) cnt from storage_mayorista group by numero_actual, numero_propuesto) x),
    'mapa_detallado', (select coalesce(jsonb_agg(jsonb_build_object('ruta_actual', ruta_actual, 'ruta_propuesta', ruta_propuesta) order by ruta_actual), '[]'::jsonb)
                          from (select * from storage_mayorista order by ruta_actual limit 500) y),
    'mapa_truncado_a_500', (select count(*) from storage_mayorista) > 500,
    'colisiones_de_ruta_destino', (select coalesce(jsonb_agg(jsonb_build_object('numero_actual', numero_actual, 'numero_propuesto', numero_propuesto)), '[]'::jsonb) from storage_colisiones),
    'prefijos_huerfanos_sin_contrato_ni_pe_empleados', (select coalesce(jsonb_agg(jsonb_build_object('prefijo', prefijo, 'objetos', cnt) order by cnt desc), '[]'::jsonb)
      from (
        select split_part(o.name, '/', 1) as prefijo, count(*) as cnt
        from storage.objects o
        where o.bucket_id = 'contratos'
          and split_part(o.name, '/', 1) <> 'pe-empleados'
          and not exists (select 1 from public.ventas v where v.numero_contrato = split_part(o.name, '/', 1))
        group by 1
      ) z)
  )

union all
select 12, '12. Colisiones con el rango DTM- (esperado: 0 en todo, salvo lo ya señalado en la sección 0/3 como "ya renumerado")',
  jsonb_build_object(
    'ventas_ya_con_dtm', (select coalesce(jsonb_agg(jsonb_build_object('numero_contrato', numero_contrato, 'tenant', tenant)), '[]'::jsonb)
                            from clasificado where ya_es_dtm),
    'auditoria_registro_id_con_dtm', (select case when (select total_filas from auditoria_stats) <= 200000
        then (select count(*) from public.auditoria where registro_id like '%DTM-%')
        else null end),
    'asientos_con_dtm_en_referencia', (select count(*) from asientos_facturacion where numero_extraido ~ '^DTM-')
  )

order by 1;
