-- ───────────────────────────────────────────────────────────────────────────
-- PREFLIGHT 227 · salida de Dinámico vinculada a Empaquetados sin record + modo cop_trm_63. SOLO LECTURA (termina en ROLLBACK).
-- Correr ANTES de aplicar la 227. Una fila por dato: codigo | nivel | cantidad | detalle.
-- CUENTA lo existente y NO bloquea: la migración valida sus propios prerrequisitos y aborta sola. Niveles: INFO · REVISAR.
--
-- Qué hace la 227: columnas nuevas (armado_paquetes.modo_oferta/trm_oferta, salidas_dinamicas.empaquetado_id/moneda,
-- empaquetados.moneda, cuentas_por_pagar.valor_cop_63/trm_63), tabla privada tarifario_oferta_63, envoltorio
-- publicar_tarifario_resultado_63 (llama al publicador vigente), triggers propios y el reemplazo de DOS funciones
-- (validar_config_destinos_aereos_67 de la 220 y registrar_financiero_contrato de la 210). NO regenera tarifarios ni toca
-- contratos, pagos, cuentas por pagar ni cotizaciones existentes.
--
-- Cierre E/F/G (aceptación atómica): además crea las tablas PRIVADAS p63_oferta y p63_aceptacion, las marcas
-- ventas.aceptacion_63_id y cuentas_por_pagar.aceptacion_63_id/obligacion_63, el contador armado_paquetes.p63_rev_costos,
-- las RPC crear_cotizacion_oferta_63 / aceptar_oferta_63 (solo service_role) y los triggers de fencing y protección; y
-- redefine registrar_financiero_contrato (el camino de contratos de siempre queda con el texto EXACTO de la 210).
-- ───────────────────────────────────────────────────────────────────────────
begin transaction read only;

with chequeos as (
  select 'P1' as codigo, 'INFO' as nivel,
         (to_regprocedure('public.publicar_tarifario_resultado(bigint, bigint, bigint, text, jsonb)') is not null
          and to_regprocedure('public.registrar_financiero_contrato(text, text, jsonb, jsonb)') is not null
          and to_regprocedure('public.validar_vinculo_aereo_67(bigint, text, bigint)') is not null
          and to_regprocedure('public.validar_config_destinos_aereos_67(bigint)') is not null
          and to_regprocedure('public.tarifario_invalidar(bigint[], boolean)') is not null)::int as cantidad,
         'Prerrequisitos: publicador (181/226), financiero (171/210), guardas de destinos aéreos (220) e invalidación (181) presentes (1 = sí)' as detalle
  union all
  select 'P2', 'INFO',
         (select count(*) from information_schema.columns c
            join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
           where c.table_schema = 'public'
             and ((c.table_name = 'tarifario_resultado' and c.column_name = 'precio_pvp_menor2')
               or (c.table_name = 'salidas_dinamicas' and c.column_name = 'empaquetado_id')
               or (c.table_name = 'armado_paquetes' and c.column_name = 'modo_oferta')))::int,
         'Estado: 1 = solo la 226 aplicada (esperado antes de la 227); 3 = la 227 ya está aplicada (la migración se niega a re-aplicarse)'
  union all
  select 'P3', 'INFO', count(*)::int,
         'Paquetes tipo Dinámico (activos o no): ninguno pasa a modo cop_trm_63 solo; el modo se elige por paquete con su TRM'
    from public.armado_paquetes where tipo::text = 'dinamico'
  union all
  select 'P4', 'INFO', count(*)::int,
         'Salidas dinámicas existentes (todas quedan como MANUALES: empaquetado_id NULL, moneda COP)'
    from public.salidas_dinamicas
  union all
  select 'P5', 'INFO', count(*)::int,
         'Empaquetados activos SIN record (NULL o vacío): candidatos a salida vinculada'
    from public.empaquetados where activo and nullif(btrim(coalesce(record, '')), '') is null
  union all
  select 'P6', case when count(*) > 0 then 'REVISAR' else 'INFO' end, count(*)::int,
         'Empaquetados cuyo record es solo espacios o texto descriptivo tipo PROMOCION: un texto NO vacío cuenta como PNR (no se convierte a NULL ni se borra); '
         || 'solo los de record NULL/vacío son elegibles'
    from public.empaquetados where record is not null and nullif(btrim(record), '') is not null and upper(btrim(record)) in ('PROMOCION', 'PROMOCIÓN', 'SIN PNR', 'N/A', 'NA')
  union all
  select 'P7', case when count(*) > 0 then 'REVISAR' else 'INFO' end, count(*)::int,
         'Empaquetados activos sin destino_id: no son elegibles para ningún paquete (la regla de destinos aéreos de la 220 exige destino)'
    from public.empaquetados where activo and destino_id is null
  union all
  select 'P8', 'INFO', count(*)::int,
         'Empaquetados con tarifa_para_empaquetar = 0: no son elegibles (sin tarifa válida)'
    from public.empaquetados where activo and coalesce(tarifa_para_empaquetar, 0) <= 0
  union all
  select 'P9', 'INFO', count(*)::int,
         'Cuentas por pagar existentes: ninguna se toca (valor_cop_63 y trm_63 nacen NULL)'
    from public.cuentas_por_pagar
  union all
  select 'P10', 'INFO', count(*)::int,
         'Triggers con el nombre de los nuevos ya existentes (la migración los crea con drop if exists): '
         || coalesce(string_agg(tgname, ', ' order by tgname), 'ninguno')
    from pg_trigger where not tgisinternal and tgname in (
      'tr_modo_oferta_vinculadas_63', 'tr_inv_modo_oferta_63', 'tr_salida_vinculada_63', 'tr_vinculo_aereo_67_salida', 'tarifario_trg_empaquetado_vinculadas_63')
  union all
  select 'P11', 'INFO', count(*)::int,
         'Triggers de invalidación sobre empaquetados HOY (la 227 NO los reemplaza; agrega uno propio): '
         || coalesce(string_agg(tgname, ', ' order by tgname), 'ninguno')
    from pg_trigger where not tgisinternal and tgrelid = 'public.empaquetados'::regclass and (tgname like 'tarifario_trg_%' or tgname like 'tr_inv_%empaquetado%')
  union all
  select 'P12', 'INFO', 1,
         'Huellas de las funciones que la 227 reemplaza o envuelve (compárense con el postcheck): publicar_tarifario_resultado md5='
         || coalesce((select md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                       where n.nspname = 'public' and p.proname = 'publicar_tarifario_resultado'), 'ausente')
         || ' · validar_config_destinos_aereos_67 md5='
         || coalesce((select md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                       where n.nspname = 'public' and p.proname = 'validar_config_destinos_aereos_67'), 'ausente')
         || ' · registrar_financiero_contrato md5 (sin CR, para compararla con la huella del camino de siempre del postcheck C9)='
         || coalesce((select md5(replace(pg_get_functiondef(p.oid), E'\r', '')) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                       where n.nspname = 'public' and p.proname = 'registrar_financiero_contrato'), 'ausente')
  union all
  select 'P14', case when count(*) > 0 then 'REVISAR' else 'INFO' end, count(*)::int,
         'Contratos con la escritura financiera EN CURSO (financiero_estado = pendiente) al aplicar: la RPC financiera se redefine, pero para ellos '
         || 'se comporta EXACTAMENTE como la 210 (sin aceptación #63). Conviene aplicar con pocos o ninguno en vuelo.'
    from public.ventas where financiero_estado = 'pendiente'
  union all
  select 'P15', 'INFO', count(*)::int,
         'Pendientes financieros guardados (contrato_financiero_pendiente): el reconciliador los completa como siempre'
    from public.contrato_financiero_pendiente
  union all
  select 'P16', case when count(*) > 0 then 'REVISAR' else 'INFO' end, count(*)::int,
         'Objetos del cierre E/F/G que YA existen (tablas p63_*, marcas, contador): ' || coalesce(string_agg(x, ', ' order by x), 'ninguno') || ' (la migración se niega a re-aplicarse)'
    from (
      select 'tabla ' || table_name as x from information_schema.tables where table_schema = 'public' and table_name in ('p63_oferta', 'p63_aceptacion')
      union all
      select 'columna ' || table_name || '.' || column_name from information_schema.columns c
        join information_schema.tables t using (table_schema, table_name)
       where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
         and ((c.table_name = 'ventas' and c.column_name = 'aceptacion_63_id') or (c.table_name = 'cuentas_por_pagar' and c.column_name in ('aceptacion_63_id', 'obligacion_63'))
           or (c.table_name = 'armado_paquetes' and c.column_name = 'p63_rev_costos'))
    ) q
  union all
  select 'P13', case when count(*) > 0 then 'REVISAR' else 'INFO' end, count(*)::int,
         'Columnas con el nombre de las nuevas en OTRAS tablas BASE distintas de las esperadas: '
         || coalesce(string_agg(c.table_name || '.' || c.column_name, ', ' order by c.table_name), 'ninguna')
    from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
   where c.table_schema = 'public'
     and ((c.column_name in ('modo_oferta', 'trm_oferta') and c.table_name <> 'armado_paquetes')
       or (c.column_name in ('valor_cop_63', 'trm_63') and c.table_name <> 'cuentas_por_pagar'))
)
select codigo, nivel, cantidad, detalle from chequeos order by length(codigo), codigo;

rollback;
