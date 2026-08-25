-- ═══════════════════════════════════════════════════════════════════════════
-- DIAGNÓSTICO v3 — Reenumeración de contratos MAYORISTA a formato DTM-####
--
-- SOLO LECTURA. Inspeccionado a mano y por bootstrap local: NO contiene
-- INSERT/UPDATE/DELETE/MERGE, ninguna sentencia DDL (CREATE/ALTER/DROP), no
-- llama nextval()/setval() ni ninguna función con efectos secundarios. La
-- única lectura de la secuencia es `select * from public.contrato_seq`, que
-- lee su estado sin consumirla (a diferencia de nextval()).
--
-- v2 corrigió 8 defectos de v1 (una fila por sección, asientos contables,
-- share_token, Storage ampliado, FK dinámica, auditoria, identidad, límites
-- de la propuesta). v3 corrige 5 defectos comprobados sobre el SQL real de v2:
--
--   1. La propuesta (sección 3) EXCLUÍA los contratos que ya son DTM-, pero
--      row_number() volvía a arrancar en 1 igual — un contrato antiguo podía
--      quedar propuesto para el MISMO número que un DTM- ya existente
--      (colisión real de PK). Ahora se detecta por coincidencia EXACTA contra
--      ventas.numero_contrato (`colisiones_propuesta_con_ventas`), el estado
--      de la sección pasa a BLOQUEADO si hay al menos una, y el mapa completo
--      se declara `mapa_aplicable: false` mientras existan — sin inventar
--      todavía ninguna política para saltar números ocupados.
--   2. Storage (sección 11) confundía "existe algo bajo ese prefijo"
--      (informativo, puede ser normal) con "el archivo exacto que se movería
--      ya existe" (bloqueante, de verdad impide el move). Ahora son dos
--      campos separados: `prefijo_destino_ya_ocupado_informativo` (prefijo) y
--      `colision_ruta_exacta_bloqueante` (o2.name = ruta_propuesta exacta,
--      mismo bucket), con ruta_actual/ruta_propuesta/objeto_existente.
--   3. Asientos contables (sección 9) marcaba "colisión" cualquier referencia
--      que empezara por DTM-, sin relacionarla con la propuesta real. Ahora
--      `asientos_que_ya_usan_dtm_informativo` es solo informativo, y
--      `colisiones_referencia_futura_bloqueante` exige coincidencia EXACTA
--      entre 'facturacion:'||numero_propuesto y una referencia YA existente
--      en asientos_contables — con el asiento que se migraría (si lo hay),
--      referencia actual, referencia futura y el asiento existente que choca.
--   4. El inventario de FK (sección 6) decidía "OK" en el título mirando SOLO
--      faltantes_nivel1, aunque tablas_nivel2_no_cubiertas_a_mano tuviera
--      contenido y resultado.ok ya diera false — título y dato podían
--      contradecirse. Ahora existe un único booleano (`fk_inventario_ok`,
--      calculado una sola vez) que exige CERO faltantes en nivel 1 Y en
--      nivel 2+, y ese mismo booleano decide tanto el título como
--      resultado.ok. Se agregan además `tablas_manual_nivel1_que_no_son_
--      fk_real` y `tablas_manual_nivel2_que_no_aparecen_en_cadena` (listas
--      manuales que no corresponden a una FK real — no deben quedar
--      invisibles aunque no sean las que bloquean `ok`). Se eliminó `_dummy`
--      (siempre daba true, no aportaba nada).
--   5. share_token (sección 10) resolvía fn_renumerar_contrato por
--      `proname + limit 1` — si existiera una sobrecarga, podía inspeccionar
--      la función equivocada sin avisar. Ahora resuelve por FIRMA EXACTA con
--      `to_regprocedure('public.fn_renumerar_contrato(text, text)')` (la
--      firma real de la migración 115: `p_viejo text, p_nuevo text`). Si esa
--      firma exacta no existe, `fn_renumerar_contrato_existe=false`,
--      `evidencia_fuente_pg_proc=null` y `estado='BLOQUEADO'` — nunca elige
--      una sobrecarga arbitraria.
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

-- Defecto 1: row_number() arranca en 1 sin importar que DTM-0001..N ya
-- existan como PK real de OTRO contrato (uno que ya tiene prefijo DTM- y por
-- eso quedó fuera de `propuesta`). Coincidencia EXACTA contra ventas.
propuesta_colisiones as (
  select pm.numero_contrato_actual, pm.numero_propuesto
  from propuesta_map pm
  where exists (select 1 from public.ventas v where v.numero_contrato = pm.numero_propuesto)
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
       from (select distinct tabla from fk_chain where nivel >= 2) f
      where f.tabla not in (select tabla from manual_nivel2)) as faltantes_nivel2,
    -- Informativas: tablas que SÍ mido a mano pero que no corresponden a una
    -- FK real en el nivel que les asigné. No deciden fk_inventario_ok (eso lo
    -- decide únicamente si hay FK real sin cubrir), pero no deben quedar
    -- invisibles: pueden delatar un error en la lista manual.
    (select coalesce(jsonb_agg(m.tabla order by m.tabla), '[]'::jsonb)
       from manual_nivel1 m
      where m.tabla not in (select distinct tabla from fk_chain where nivel = 1)) as manual_nivel1_no_reales,
    (select coalesce(jsonb_agg(m.tabla order by m.tabla), '[]'::jsonb)
       from manual_nivel2 m
      where m.tabla not in (select distinct tabla from fk_chain)) as manual_nivel2_no_en_cadena
),

-- Un único booleano, calculado UNA vez, para que título y resultado.ok nunca
-- puedan contradecirse (el bug de v2: el título solo miraba faltantes_nivel1).
fk_inventario_estado as (
  select
    (select faltantes_nivel1 from fk_comparacion) = '[]'::jsonb
    and (select faltantes_nivel2 from fk_comparacion) = '[]'::jsonb as fk_inventario_ok
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

-- Defecto 3: "una referencia ya usa DTM-" (informativo) no es lo mismo que
-- "esa referencia exacta choca con la que resultaría de renumerar". Coinci-
-- dencia EXACTA entre 'facturacion:'||numero_propuesto y una referencia que
-- YA existe HOY en asientos_contables (LEFT JOIN al asiento que se migraría:
-- puede no haber ninguno y aun así ser una colisión real, si otro asiento no
-- relacionado ya ocupa ese literal).
asientos_colision_futura as (
  select
    pm.numero_contrato_actual,
    pm.numero_propuesto,
    af.id as asiento_a_migrar_id,
    af.referencia as referencia_actual,
    'facturacion:' || pm.numero_propuesto as referencia_futura,
    existente.id as asiento_existente_id,
    existente.referencia as asiento_existente_referencia
  from propuesta_map pm
  left join asientos_facturacion af on af.numero_extraido = pm.numero_contrato_actual
  join public.asientos_contables existente on existente.referencia = 'facturacion:' || pm.numero_propuesto
),

-- ─────────────────────────────────────────────────────────────────────────
-- Confirmación DESDE EL CÓDIGO REAL (pg_proc, no un archivo leído una vez)
-- de si fn_renumerar_contrato regenera share_token. Resuelta por FIRMA
-- EXACTA (to_regprocedure, nunca por proname+limit 1): la firma real de la
-- migración 115 es fn_renumerar_contrato(p_viejo text, p_nuevo text). Si
-- apareciera una sobrecarga con otra firma, NO se elige arbitrariamente —
-- to_regprocedure() solo resuelve la firma exacta pedida, o da NULL si no
-- existe (a diferencia de un cast ::regprocedure, que lanzaría error).
-- ─────────────────────────────────────────────────────────────────────────
fn_renumerar_src as (
  select p.prosrc
  from pg_proc p
  where p.oid = to_regprocedure('public.fn_renumerar_contrato(text, text)')
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

-- Defecto 2: "algo existe bajo ese prefijo" (informativo — normal si el
-- contrato destino ya tiene otros archivos) es distinto de "el archivo EXACTO
-- que se movería ya existe ahí" (bloqueante — el move de verdad chocaría).
storage_prefijo_ocupado as (
  select distinct sm.numero_actual, sm.numero_propuesto
  from storage_mayorista sm
  where exists (
    select 1 from storage.objects o2
    where o2.bucket_id = 'contratos'
      and split_part(o2.name, '/', 1) = sm.numero_propuesto
  )
),

storage_colision_exacta as (
  select distinct sm.ruta_actual, sm.ruta_propuesta, o2.name as objeto_existente
  from storage_mayorista sm
  join storage.objects o2
    on o2.bucket_id = 'contratos' and o2.name = sm.ruta_propuesta
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
    'propuesta_bloqueada_por_colision_con_ventas', exists(select 1 from propuesta_colisiones),
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
    'colisiones_propuesta_con_ventas', (select coalesce(jsonb_agg(jsonb_build_object(
                'numero_contrato_actual', numero_contrato_actual, 'numero_propuesto', numero_propuesto
              ) order by numero_propuesto), '[]'::jsonb)
              from propuesta_colisiones),
    'estado', case when exists(select 1 from propuesta_colisiones) then 'BLOQUEADO' else 'OK' end,
    'mapa_aplicable', not exists(select 1 from propuesta_colisiones),
    'nota_si_bloqueado', case when exists(select 1 from propuesta_colisiones)
      then 'row_number() vuelve a arrancar en 1 sin importar qué números DTM- ya existan como PK real (de otro contrato ya renumerado antes). Al menos un numero_propuesto de la lista de abajo coincide EXACTAMENTE con un numero_contrato que ya existe en ventas — insertarlo tal cual violaría la PK. El mapa queda como diagnóstico únicamente (NO APLICABLE para ejecutar) hasta definir una política explícita para saltar números ya ocupados — deliberadamente no inventada en este script.'
      else null end,
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
  case when (select fk_inventario_ok from fk_inventario_estado)
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
    'tablas_nivel2_no_cubiertas_a_mano', (select faltantes_nivel2 from fk_comparacion),
    'tablas_manual_nivel1_que_no_son_fk_real', (select manual_nivel1_no_reales from fk_comparacion),
    'tablas_manual_nivel2_que_no_aparecen_en_cadena', (select manual_nivel2_no_en_cadena from fk_comparacion),
    'ok', (select fk_inventario_ok from fk_inventario_estado)
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
    'asientos_que_ya_usan_dtm_informativo', (select coalesce(jsonb_agg(jsonb_build_object('asiento_id', af.id, 'referencia', af.referencia)), '[]'::jsonb)
                            from asientos_facturacion af
                           where af.numero_extraido ~ '^DTM-'),
    'colisiones_referencia_futura_bloqueante', (select coalesce(jsonb_agg(jsonb_build_object(
                'numero_contrato_actual', numero_contrato_actual,
                'numero_propuesto', numero_propuesto,
                'asiento_a_migrar_id', asiento_a_migrar_id,
                'referencia_actual', referencia_actual,
                'referencia_futura', referencia_futura,
                'asiento_existente_id', asiento_existente_id,
                'asiento_existente_referencia', asiento_existente_referencia
              ) order by numero_propuesto), '[]'::jsonb)
              from asientos_colision_futura),
    'estado', case when exists(select 1 from asientos_colision_futura) then 'BLOQUEADO' else 'OK' end
  )

union all
select 10, '10. share_token — confirmación desde el código real de fn_renumerar_contrato(text, text)',
  jsonb_build_object(
    'firma_buscada', 'public.fn_renumerar_contrato(text, text)',
    'fn_renumerar_contrato_existe', exists(select 1 from fn_renumerar_src),
    'confirma_que_regenera_share_token', case when exists(select 1 from fn_renumerar_src)
      then (select prosrc ilike '%share_token%' and prosrc ilike '%gen_random_uuid%' from fn_renumerar_src)
      else null end,
    'evidencia_fuente_pg_proc', case when exists(select 1 from fn_renumerar_src)
      then (select substring(prosrc from 'when column_name = ''share_token''[^,]*,?') from fn_renumerar_src)
      else null end,
    'estado', case when exists(select 1 from fn_renumerar_src) then 'OK' else 'BLOQUEADO' end,
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
    'prefijo_destino_ya_ocupado_informativo', (select coalesce(jsonb_agg(jsonb_build_object('numero_actual', numero_actual, 'numero_propuesto', numero_propuesto)), '[]'::jsonb) from storage_prefijo_ocupado),
    'colision_ruta_exacta_bloqueante', (select coalesce(jsonb_agg(jsonb_build_object('ruta_actual', ruta_actual, 'ruta_propuesta', ruta_propuesta, 'objeto_existente', objeto_existente)), '[]'::jsonb) from storage_colision_exacta),
    'estado', case when exists(select 1 from storage_colision_exacta) then 'BLOQUEADO' else 'OK' end,
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
