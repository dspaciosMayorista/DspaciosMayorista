-- ───────────────────────────────────────────────────────────────────────────
-- POSTCHECK 227 · salida vinculada a Empaquetados sin record + modo cop_trm_63. SOLO LECTURA (read only + ROLLBACK).
-- Correr DESPUÉS de aplicar la 227. UNA fila consolidada: veredicto OK si todos los controles dan verdadero.
--   C1  columnas nuevas con tipo y nulabilidad (modo_oferta text not null, trm_oferta, empaquetado_id, moneda x2, valor_cop_63, trm_63)
--   C2  CHECK de la 227 presentes (modo, TRM > 0, modo63 solo Dinámico con TRM, moneda de salida, vinculada sin MK/TA/COP, empaquetados COP, CxP COP)
--   C3  índice único (paquete, empaquetado) parcial y FK RESTRICT salidas_dinamicas → empaquetados
--   C4  publicar_tarifario_resultado (el de la 226) NO se tocó: sigue persistiendo precio_pvp_menor2, con sus guardas y su ACL
--   C5  publicar_tarifario_resultado_63 ENVUELVE al publicador vigente (lo llama, no copia su cuerpo), exige modo/COP/TRM; ACL: authenticated sí, anon no
--   C6  los triggers de invalidación de la 226 sobre empaquetados siguen presentes y el de la 227 coexiste (ninguno reemplaza al otro)
--   C7  triggers de guarda de la 227 presentes (modo, vinculada, vínculo aéreo diferido) y las funciones de trigger no son invocables por la API
--   C8  validar_config_destinos_aereos_67 cuenta también las salidas vinculadas y conserva sus demás guardas (SECURITY DEFINER, search_path)
--   C9  registrar_financiero_contrato: K15 (ya_completo) PRIMERO, desvío a p63_registrar_financiero para contratos #63, el resto = texto de la 210, ACL solo service_role
--   C10 tarifario_oferta_63: RLS activada, sin policies, sin privilegios para anon/authenticated
--   C11 la 227 no tocó datos: ningún paquete en modo 63, ninguna salida vinculada, ninguna CxP con equivalente COP (antes de usarla)
--   C12 las columnas nuevas viven SOLO donde corresponde (solo tablas base; las vistas no cuentan)
--   E/F/G (aceptación atómica):
--   C13 p63_oferta / p63_aceptacion: PRIVADAS (RLS activada, sin policies, sin privilegios para anon/authenticated) y con auditoría (087)
--   C14 crear_cotizacion_oferta_63 / aceptar_oferta_63: SECURITY DEFINER, search_path fijo, SOLO service_role
--   C15 aceptar_oferta_63: candados en el orden fuente → salida → paquete → oferta, NUNCA toma la venta, reloj de Bogotá, guarda 220 reutilizada
--   C16 fencing y protecciones: triggers de ventas/CxP/pendiente/inmutabilidad presentes; las funciones de trigger no son invocables por la API
--   C17 H: p63_registrar_financiero deriva de lo aceptado y rechaza payload alterno / sin pendiente / sin hijos; marca la aceptación completa
--   C18 cobertura de revisión: triggers que suben p63_rev_costos (hoteles, acomodaciones, servicios, proveedores, empaquetados)
--   C19 la 227 no tocó datos de #63: ninguna oferta, aceptación, contrato u obligación marcados (antes de usarla)
--   C20 las columnas/tablas del cierre viven SOLO donde corresponde (solo tablas base)
-- ───────────────────────────────────────────────────────────────────────────
begin transaction read only;

with
-- SOLO tablas base: information_schema.columns incluye también las VISTAS (lección del C10 de la 226).
cols as (
  select c.table_name, c.column_name, c.data_type, c.is_nullable, c.column_default
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
   where c.table_schema = 'public'
),
prof as (
  select p.proname, p.prosecdef, p.proconfig, p.prosrc, p.oid
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
),
c as (
  select 'C1' as codigo,
         exists (select 1 from cols where table_name = 'armado_paquetes' and column_name = 'modo_oferta' and data_type = 'text' and is_nullable = 'NO' and column_default like '%legacy%')
         and exists (select 1 from cols where table_name = 'armado_paquetes' and column_name = 'trm_oferta' and data_type = 'numeric' and is_nullable = 'YES')
         and exists (select 1 from cols where table_name = 'salidas_dinamicas' and column_name = 'empaquetado_id' and data_type = 'bigint' and is_nullable = 'YES')
         and exists (select 1 from cols where table_name = 'salidas_dinamicas' and column_name = 'moneda' and data_type = 'text' and is_nullable = 'NO' and column_default like '%COP%')
         and exists (select 1 from cols where table_name = 'empaquetados' and column_name = 'moneda' and data_type = 'text' and is_nullable = 'NO' and column_default like '%COP%')
         and exists (select 1 from cols where table_name = 'cuentas_por_pagar' and column_name = 'valor_cop_63' and data_type = 'numeric' and is_nullable = 'YES')
         and exists (select 1 from cols where table_name = 'cuentas_por_pagar' and column_name = 'trm_63' and data_type = 'numeric' and is_nullable = 'YES')
         and exists (select 1 from cols where table_name = 'armado_paquetes' and column_name = 'p63_rev_costos' and data_type = 'bigint' and is_nullable = 'NO' and column_default like '0%')
         and exists (select 1 from cols where table_name = 'ventas' and column_name = 'aceptacion_63_id' and data_type = 'bigint' and is_nullable = 'YES')
         and exists (select 1 from cols where table_name = 'cuentas_por_pagar' and column_name = 'aceptacion_63_id' and data_type = 'bigint' and is_nullable = 'YES')
         and exists (select 1 from cols where table_name = 'cuentas_por_pagar' and column_name = 'obligacion_63' and data_type = 'text' and is_nullable = 'YES') as ok,
         'Columnas nuevas con tipo y nulabilidad correctos (incluidas las marcas de aceptación y el contador de costos)' as detalle
  union all
  select 'C2',
         (select count(*) from pg_constraint where contype = 'c' and conname in (
            'armado_paquetes_modo_oferta_chk', 'armado_paquetes_trm_oferta_chk', 'armado_paquetes_modo63_chk',
            'salidas_dinamicas_moneda_chk', 'salidas_dinamicas_vinculada_chk', 'empaquetados_moneda_cop_chk', 'cuentas_por_pagar_cop63_chk', 'cuentas_por_pagar_marca63_chk')) = 8
         and (select pg_get_constraintdef(oid) from pg_constraint where conname = 'salidas_dinamicas_vinculada_chk') ~* 'aplica_mk = false'
         and (select pg_get_constraintdef(oid) from pg_constraint where conname = 'salidas_dinamicas_vinculada_chk') ~* 'ta = .?0'
         and (select pg_get_constraintdef(oid) from pg_constraint where conname = 'armado_paquetes_modo63_chk') ~* 'dinamico',
         'Los 8 CHECK de la 227 presentes; la vinculada exige sin markup, sin TA y COP; el modo 63 exige Dinámico; marca y equivalente van juntos'
  union all
  select 'C3',
         exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'salidas_dinamicas'
                  and indexname = 'salidas_dinamicas_paquete_empaquetado_uk' and indexdef ilike '%unique%' and indexdef ilike '%empaquetado_id is not null%')
         and exists (select 1 from pg_constraint where contype = 'f' and conrelid = 'public.salidas_dinamicas'::regclass
                      and confrelid = 'public.empaquetados'::regclass and confdeltype = 'r'),
         'Único parcial (paquete, empaquetado) y FK ON DELETE RESTRICT hacia empaquetados'
  union all
  select 'C4',
         exists (select 1 from prof where proname = 'publicar_tarifario_resultado' and prosecdef
                  and coalesce(proconfig::text, '') like '%search_path%'
                  and prosrc like '%precio_pvp_menor2%'
                  and prosrc like '%mi_rol()%' and prosrc like '%tarifario_generacion%' and prosrc like '%tarifario_revision_fuente%'
                  and prosrc like '%p_moneda%' and prosrc like '%tarifario_snapshot_publicable%'
                  and prosrc not like '%tarifario_oferta_63%')
         and not has_function_privilege('anon', 'public.publicar_tarifario_resultado(bigint, bigint, bigint, text, jsonb)', 'EXECUTE')
         and has_function_privilege('authenticated', 'public.publicar_tarifario_resultado(bigint, bigint, bigint, text, jsonb)', 'EXECUTE'),
         'El publicador de la 226 NO se tocó (misma lógica, sin referencias a la 227) y su ACL sigue igual'
  union all
  select 'C5',
         exists (select 1 from prof where proname = 'publicar_tarifario_resultado_63' and prosecdef
                  and coalesce(proconfig::text, '') like '%search_path%'
                  and prosrc like '%public.publicar_tarifario_resultado(%'
                  and prosrc like '%cop_trm_63%' and prosrc like '%p_trm%' and prosrc like '%mi_rol()%'
                  and prosrc like '%tarifario_oferta_63%'
                  and prosrc not like '%precio_pvp_menor2%')
         and not has_function_privilege('anon', 'public.publicar_tarifario_resultado_63(bigint, bigint, bigint, text, jsonb, text, numeric)', 'EXECUTE')
         and has_function_privilege('authenticated', 'public.publicar_tarifario_resultado_63(bigint, bigint, bigint, text, jsonb, text, numeric)', 'EXECUTE'),
         'El envoltorio llama al publicador vigente (no copia su cuerpo), exige modo cop_trm_63, COP y TRM > 0; anon sin acceso'
  union all
  select 'C6',
         exists (select 1 from pg_trigger t where t.tgname = 'tarifario_trg_empaquetados' and not t.tgisinternal and t.tgrelid = 'public.empaquetados'::regclass
                  and pg_get_triggerdef(t.oid) like '%fee_infante%')
         and exists (select 1 from prof where proname = 'tarifario_trg_bump_por_empaquetado' and prosecdef)
         and exists (select 1 from pg_trigger t where t.tgname = 'tarifario_trg_empaquetado_vinculadas_63' and not t.tgisinternal and t.tgrelid = 'public.empaquetados'::regclass
                      and pg_get_triggerdef(t.oid) like '%record%' and pg_get_triggerdef(t.oid) like '%tarifa_proveedor%' and pg_get_triggerdef(t.oid) like '%destino_id%')
         and exists (select 1 from pg_trigger t where t.tgname = 'tr_inv_destino_empaquetado_67' and not t.tgisinternal and t.tgrelid = 'public.empaquetados'::regclass),
         'Coexisten el trigger de la 226 (fee_infante…), el de la 220 (destino) y el propio de la 227 (record, costo, destino…)'
  union all
  select 'C7',
         (select count(*) from pg_trigger t where not t.tgisinternal and t.tgname in (
            'tr_modo_oferta_vinculadas_63', 'tr_inv_modo_oferta_63', 'tr_salida_vinculada_63', 'tr_vinculo_aereo_67_salida')) = 4
         and exists (select 1 from pg_trigger t where t.tgname = 'tr_vinculo_aereo_67_salida' and t.tgconstraint <> 0 and t.tgdeferrable and t.tginitdeferred)
         and not exists (select 1 from prof where proname in (
            'trg_modo_oferta_vinculadas_63', 'trg_invalidar_modo_oferta_63', 'trg_salida_vinculada_63', 'trg_vinculo_aereo_67_salida', 'tarifario_trg_empaquetado_vinculadas_63')
            and (has_function_privilege('anon', oid, 'EXECUTE') or has_function_privilege('authenticated', oid, 'EXECUTE'))),
         'Triggers de guarda presentes (el del vínculo aéreo es diferido, como los de la 220) y las funciones no son invocables por la API'
  union all
  select 'C8',
         exists (select 1 from prof where proname = 'validar_config_destinos_aereos_67' and prosecdef
                  and coalesce(proconfig::text, '') like '%search_path%'
                  and prosrc like '%salidas_dinamicas%' and prosrc like '%armado_vuelos%' and prosrc like '%armado_empaquetados%'
                  and prosrc like '%destino_aereo_vinculos%' and prosrc like '%destino_aereo_config%'),
         'La guarda de configuración de la 220 cuenta las salidas vinculadas y conserva vuelos y Sistema'
  union all
  select 'C9',
         exists (select 1 from prof where proname = 'registrar_financiero_contrato' and prosecdef
                  and coalesce(proconfig::text, '') like '%search_path%'
                  and prosrc like '%p63_registrar_financiero(%' and prosrc like '%aceptacion_63_id%'
                  and prosrc like '%ya_completo%' and prosrc like '%financiero_registrado_en%' and prosrc like '%marca_cxp_automatica%'
                  and position('ya_completo' in prosrc) < position('p63_registrar_financiero(' in prosrc)
                  and position('p63_registrar_financiero(' in prosrc) < position('jsonb_typeof(p_cxp)' in prosrc)
                  and prosrc not like '%valor_cop_63%')
         and not has_function_privilege('anon', 'public.registrar_financiero_contrato(text, text, jsonb, jsonb)', 'EXECUTE')
         and not has_function_privilege('authenticated', 'public.registrar_financiero_contrato(text, text, jsonb, jsonb)', 'EXECUTE')
         and has_function_privilege('service_role', 'public.registrar_financiero_contrato(text, text, jsonb, jsonb)', 'EXECUTE'),
         'La RPC financiera responde ya_completo PRIMERO, desvía a p63_registrar_financiero SOLO los contratos con aceptación, deja el camino de siempre sin marcas #63 y su ACL es solo service_role. Huella del camino de siempre (debe igualar la de preflight P12, ambas normalizadas): '
         || coalesce((select md5(regexp_replace(regexp_replace(replace(pg_get_functiondef(oid), E'\r', ''), E'  v_acep       bigint;\n', ''),
                                  E'\n  [-][-] 227 \\(#63\\): un contrato ligado.*?return public\\.p63_registrar_financiero\\([^\n]*\n  end if;\n', ''))
                        from prof where proname = 'registrar_financiero_contrato'), 'n/d')
  union all
  select 'C10',
         coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.tarifario_oferta_63')), false)
         and (select count(*) from pg_policies where schemaname = 'public' and tablename = 'tarifario_oferta_63') = 0
         and not has_table_privilege('anon', 'public.tarifario_oferta_63', 'SELECT')
         and not has_table_privilege('authenticated', 'public.tarifario_oferta_63', 'SELECT')
         and not has_table_privilege('authenticated', 'public.tarifario_oferta_63', 'INSERT')
         and not has_table_privilege('authenticated', 'public.tarifario_oferta_63', 'UPDATE')
         and not has_table_privilege('authenticated', 'public.tarifario_oferta_63', 'DELETE'),
         'tarifario_oferta_63 es PRIVADA: RLS activada, sin policies y sin privilegios para anon ni authenticated'
  union all
  select 'C11',
         not exists (select 1 from public.armado_paquetes where modo_oferta <> 'legacy' or trm_oferta is not null)
         and not exists (select 1 from public.salidas_dinamicas where empaquetado_id is not null)
         and not exists (select 1 from public.cuentas_por_pagar where valor_cop_63 is not null or trm_63 is not null)
         and not exists (select 1 from public.tarifario_oferta_63),
         'La 227 no tocó datos: ningún paquete en modo 63, ninguna salida vinculada, ninguna CxP con equivalente COP (válido hasta empezar a usarla)'
  union all
  select 'C12',
         not exists (select 1 from cols
                      where (column_name in ('modo_oferta', 'trm_oferta') and table_name <> 'armado_paquetes')
                         or (column_name in ('valor_cop_63', 'trm_63') and table_name <> 'cuentas_por_pagar')),
         'Las columnas nuevas viven solo donde corresponde (solo tablas base; las vistas no cuentan)'
  union all
  select 'C13',
         (select count(*) from pg_class where oid in (to_regclass('public.p63_oferta'), to_regclass('public.p63_aceptacion')) and relrowsecurity) = 2
         and (select count(*) from pg_policies where schemaname = 'public' and tablename in ('p63_oferta', 'p63_aceptacion')) = 0
         and not has_table_privilege('anon', 'public.p63_oferta', 'SELECT') and not has_table_privilege('authenticated', 'public.p63_oferta', 'SELECT')
         and not has_table_privilege('authenticated', 'public.p63_oferta', 'INSERT') and not has_table_privilege('authenticated', 'public.p63_oferta', 'UPDATE')
         and not has_table_privilege('anon', 'public.p63_aceptacion', 'SELECT') and not has_table_privilege('authenticated', 'public.p63_aceptacion', 'SELECT')
         and not has_table_privilege('authenticated', 'public.p63_aceptacion', 'INSERT') and not has_table_privilege('authenticated', 'public.p63_aceptacion', 'UPDATE')
         and (select count(*) from pg_trigger where tgname = 'trg_auditoria' and not tgisinternal and tgrelid in (to_regclass('public.p63_oferta'), to_regclass('public.p63_aceptacion'))) = 2,
         'p63_oferta y p63_aceptacion son PRIVADAS (RLS, sin policies, sin privilegios para anon/authenticated) y tienen auditoría'
  union all
  select 'C14',
         (select count(*) from prof where proname in ('crear_cotizacion_oferta_63', 'aceptar_oferta_63') and prosecdef and coalesce(proconfig::text, '') like '%search_path%') = 2
         and has_function_privilege('service_role', 'public.aceptar_oferta_63(bigint, text, uuid, text, text)', 'EXECUTE')
         and has_function_privilege('service_role', 'public.crear_cotizacion_oferta_63(uuid, text, jsonb, jsonb, text, text, jsonb)', 'EXECUTE')
         and not has_function_privilege('authenticated', 'public.aceptar_oferta_63(bigint, text, uuid, text, text)', 'EXECUTE')
         and not has_function_privilege('anon', 'public.aceptar_oferta_63(bigint, text, uuid, text, text)', 'EXECUTE')
         and not has_function_privilege('authenticated', 'public.crear_cotizacion_oferta_63(uuid, text, jsonb, jsonb, text, text, jsonb)', 'EXECUTE')
         and not has_function_privilege('anon', 'public.crear_cotizacion_oferta_63(uuid, text, jsonb, jsonb, text, text, jsonb)', 'EXECUTE'),
         'Las dos RPC de la aceptación son SECURITY DEFINER con search_path fijo y SOLO service_role las ejecuta'
  union all
  select 'C15',
         exists (select 1 from prof where proname = 'aceptar_oferta_63'
                  and position('from public.empaquetados e where e.id = v_emp for share' in prosrc) > 0
                  and position('from public.empaquetados e where e.id = v_emp for share' in prosrc) < position('from public.salidas_dinamicas s where s.id = v_salida for share' in prosrc)
                  and position('from public.salidas_dinamicas s where s.id = v_salida for share' in prosrc) < position('for no key update' in prosrc)
                  and position('for no key update' in prosrc) < position('from public.p63_oferta where id = v_o.id for update' in prosrc)
                  and prosrc not like '%from public.ventas%' and prosrc not like '%update public.ventas%'
                  and prosrc like '%p63_hoy_bogota()%' and prosrc like '%validar_vinculo_aereo_67%' and prosrc like '%siguiente_numero_contrato_para_tenant%'
                  and prosrc like '%p63_oferta_cambio%' and prosrc like '%p63_oferta_cerrada%'
                  and prosrc like '%v_snap -> ''vigencias''%' and prosrc like '%vigencia de compra%'
                  and position('v_hoy := public.p63_hoy_bogota()' in prosrc) < position('v_snap -> ''vigencias''' in prosrc))
         and exists (select 1 from prof where proname = 'p63_hoy_bogota' and prosrc like '%America/Bogota%' and prosrc like '%clock_timestamp%'),
         'aceptar_oferta_63: candados fuente → salida → paquete → oferta, jamás la venta; fecha de negocio de Bogotá tomada con clock_timestamp; reutiliza la guarda 220'
  union all
  select 'C16',
         (select count(*) from pg_trigger t where not t.tgisinternal and t.tgname in (
            'trg_ventas_aceptacion_63_ins', 'trg_ventas_borrada_63', 'trg_ventas_costos_63', 'trg_cxp_aceptacion_63', 'trg_cxp_borrada_63',
            'trg_p63_pendiente', 'trg_p63_oferta_inmutable', 'trg_p63_aceptacion_inmutable')) = 8
         and exists (select 1 from pg_trigger t where t.tgname = 'trg_cxp_borrada_63' and t.tgconstraint <> 0 and t.tgdeferrable and t.tginitdeferred)
         and exists (select 1 from pg_trigger t where t.tgname = 'trg_ventas_aceptacion_63_ins' and t.tgrelid = 'public.ventas'::regclass and (t.tgtype & 2) = 2 and (t.tgtype & 4) = 4)
         and exists (select 1 from prof where proname = 'trg_p63_pendiente' and not prosecdef and prosrc like '%anon%' and prosrc like '%authenticated%')
         and not exists (select 1 from prof where (proname like 'trg\_p63\_%' or proname like 'p63\_%' or proname in (
              'trg_ventas_aceptacion_63_ins', 'trg_ventas_borrada_63', 'trg_ventas_costos_63', 'trg_cxp_aceptacion_63', 'trg_cxp_borrada_63'))
            and (has_function_privilege('anon', oid, 'EXECUTE') or has_function_privilege('authenticated', oid, 'EXECUTE'))),
         'Fencing de la cabecera (BEFORE INSERT), tombstone, protección de costos y obligaciones (borrado diferido), guarda del pendiente (INVOKER) e inmutabilidad presentes; ninguna es invocable por la API'
  union all
  select 'C17',
         exists (select 1 from prof where proname = 'p63_registrar_financiero' and prosecdef and coalesce(proconfig::text, '') like '%search_path%'
                  and prosrc like '%p63_payload_alterno%' and prosrc like '%p63_sin_pendiente%' and prosrc like '%p63_hijos_pendientes%'
                  and prosrc like '%app.p63_h%' and prosrc like '%''completa''%' and prosrc like '%p63_financiero_derivado%'
                  and prosrc like '%aceptacion_63_id%' and prosrc like '%obligacion_63%')
         and exists (select 1 from prof where proname = 'p63_financiero_derivado' and prosecdef)
         and not has_function_privilege('authenticated', 'public.p63_registrar_financiero(text, text, jsonb, jsonb, bigint)', 'EXECUTE'),
         'La finalización #63 deriva costos y obligaciones del snapshot, rechaza payload alterno / sin pendiente / sin hijos y marca la aceptación completa'
  union all
  select 'C18',
         (select count(*) from pg_trigger t where not t.tgisinternal and t.tgname in (
            'trg_p63_costos_hoteles', 'trg_p63_costos_acomodaciones', 'trg_p63_costos_servicios', 'trg_p63_costos_proveedores', 'trg_p63_costos_empaquetados',
            'trg_p63_costos_aliados', 'trg_p63_costos_parametros_upd', 'trg_p63_costos_parametros_ins')) = 8
         and exists (select 1 from prof where proname = 'p63_bump_costos' and prosecdef and prosrc like '%modo_oferta = ''cop_trm_63''%'),
         'Cada cambio de proveedor, retención, regla de hotel o %/parámetro de comisión B2B sube el contador de costos de los paquetes en modo 63 (en la misma transacción)'
  union all
  select 'C19',
         not exists (select 1 from public.p63_oferta) and not exists (select 1 from public.p63_aceptacion)
         and not exists (select 1 from public.ventas where aceptacion_63_id is not null)
         and not exists (select 1 from public.cuentas_por_pagar where aceptacion_63_id is not null or obligacion_63 is not null)
         and not exists (select 1 from public.armado_paquetes where p63_rev_costos <> 0),
         'La 227 no creó ofertas, aceptaciones, contratos ni obligaciones aceptados (válido hasta empezar a usarla)'
  union all
  select 'C20',
         not exists (select 1 from cols where (column_name = 'aceptacion_63_id' and table_name not in ('ventas', 'cuentas_por_pagar'))
                                           or (column_name = 'obligacion_63' and table_name <> 'cuentas_por_pagar')
                                           or (column_name = 'p63_rev_costos' and table_name <> 'armado_paquetes'))
         and not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name in ('p63_oferta', 'p63_aceptacion') and table_type <> 'BASE TABLE'),
         'Las columnas/tablas del cierre E/F/G viven solo donde corresponde (solo tablas base)'
),
-- Un NULL (objeto ausente) cuenta como FALLA: bool_and ignoraría los NULL.
c2 as (select codigo, coalesce(ok, false) as ok, detalle from c)
select case when bool_and(ok) then 'OK' else 'FALLA' end as veredicto,
       count(*) filter (where ok) as ok,
       count(*) filter (where not ok) as fallos,
       count(*) as chequeos,
       coalesce(string_agg(codigo, ',' order by length(codigo), codigo) filter (where not ok), 'ninguno') as fallidos,
       string_agg(codigo || '=' || case when ok then 't' else 'f' end, ';' order by length(codigo), codigo) as resumen,
       jsonb_agg(jsonb_build_object('codigo', codigo, 'ok', ok, 'detalle', detalle) order by length(codigo), codigo) as detalle
  from c2;

rollback;
