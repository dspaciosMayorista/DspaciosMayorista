-- ───────────────────────────────────────────────────────────────────────────
-- POSTCHECK 192 + 194–197 · Vuelos, fase B (estado `retirada`, traslado y
-- mover atómicos, crear/eliminar record, liberaciones sin residuos,
-- confirmación atómica) — SOLO LECTURA.
--
-- Correr DESPUÉS de aplicar 192, 194, 195, 196 y 197 y ANTES de desplegar el
-- código B. Una sola consulta SELECT sobre el catálogo: no crea, no modifica,
-- no bloquea nada y no devuelve datos de pasajeros. Todo tiene que dar
-- ok = true (las filas INFO no cuentan para el RESUMEN).
--
-- Privilegios: Supabase concede por defecto EXECUTE a anon, authenticated y
-- service_role sobre toda función nueva; las migraciones revocan
-- explícitamente. Aquí solo se exige lo que NO depende de ese default:
--   · api      → authenticated SÍ, anon NO;
--   · servicio → authenticated NO, anon NO, service_role SÍ;
--   · privada  → authenticated NO, anon NO (service_role puede conservar el
--                EXECUTE por defecto: ya tiene acceso total a las tablas).
-- Excepción heredada, no la cambia la 196 (`create or replace` conserva el
-- ACL): eliminar_contrato tiene EXECUTE para PUBLIC desde la 060; su candado
-- de rol está dentro de la función (117). Se informa como INFO.
--
-- Los md5 son los de los cuerpos de 194–197 tal como están en el repositorio
-- (sin retornos de carro), medidos tras aplicar 183→200 en orden numérico en
-- una base local desechable. Si una migración se edita, recalcularlos.
-- ───────────────────────────────────────────────────────────────────────────
with
esperadas(firma, md5_esperado, definer, clase, migracion) as (values
  ('public._vuelos_actor()',                                                  '94145e283498b1dac0ecab925a324cee', true,  'privada',  194),
  ('public._ref_manual_normalizada(text)',                                    '54ebf678c8f9221fe3cd2bfc5b3857db', false, 'privada',  194),
  ('public._resolver_contrato_manual(text)',                                  'e876f8f370a666c165abed9b16907314', true,  'privada',  194),
  ('public._autorizar_contrato_silla(text,text,text,boolean)',                'b7c29e3a60dd6359d15887589a6dd33b', true,  'privada',  194),
  ('public._silla_con_datos(public.sillas)',                                  '8de2a56fc7e1b41c847a24bd67b64ef2', false, 'privada',  194),
  ('public._silla_libre(public.sillas)',                                      '1841942ffda079e2faa286269d18fd8e', false, 'privada',  194),
  ('public._reservar_operacion(uuid,text,text,uuid)',                         'a53dc54da8526f67da1f6f1d0e522a78', true,  'privada',  194),
  ('public._validar_record_destino(public.bloqueos_vuelo,public.bloqueos_vuelo)', '749122f9b7217f8128e250755ab2792a', false, 'privada', 194),
  ('public._sillas_activas(bigint)',                                          'd012fa6f29747c333107af44a1a17e1d', false, 'privada',  194),
  ('public._tramo_legado(public.contrato_vuelos)',                            'b911f589ab63b0d5e3f35b2fb28508b5', false, 'privada',  194),
  ('public._tramo_usa_ida(public.contrato_vuelos)',                           '1bfe6eba50d265ba4d66166085467b46', false, 'privada',  194),
  ('public._tramo_usa_regreso(public.contrato_vuelos)',                       'a27ee5779f1a0829b0d3c86f4f5789bf', false, 'privada',  194),
  ('public.trasladar_cupos(bigint,bigint,integer,text,uuid)',                 'ef5f3ddba390b55e473631c7cb26ffdc', true,  'api',      194),
  ('public.mover_pasajero(bigint,bigint,text,boolean,text,uuid)',             '371f5e3e7948b2f8f2b1529122656138', true,  'api',      194),
  ('public.retirar_cupo(bigint,text,uuid)',                                   '2de74c4b1848a0fc0bd31c88400dfdee', true,  'api',      194),
  ('public.cambiar_estado_silla(bigint,text,text,boolean)',                   'b40b5d863af4f36d091af677256633fc', true,  'api',      194),
  ('public.asignar_contrato_manual(bigint,text)',                             '958c1478ff125f63ab4f8d7bb7d77119', true,  'api',      194),
  ('public.quitar_contrato_manual(bigint)',                                   'b9a78b40e2ac74ae8b0cb6b60fee575c', true,  'api',      194),
  ('public.liberar_silla(bigint)',                                            'fa42eef5d8da2db899a180e97dc6f7dc', true,  'api',      194),
  ('public.editar_pasajero_silla(bigint,jsonb)',                              '0f1be81fb173b125e591a08abf035a01', true,  'api',      194),
  ('public.crear_bloqueo(jsonb,integer)',                                     '4da5bcc012ee4beb1b6adca7b6b68387', true,  'api',      195),
  ('public.eliminar_bloqueo(bigint)',                                         'f04aae8b348e25bed40e9ce8943a1530', true,  'api',      195),
  ('public._vaciar_sillas(bigint[],text)',                                    '5366ff543afadaa0c8aa7a16f349cdfd', true,  'privada',  196),
  ('public.liberar_vencidas(date)',                                           '0b12c63266b2f1a87b75124eedf71245', true,  'servicio', 196),
  ('public._ajustar_sillas_bloqueo_nucleo(text,bigint,integer)',              '94a91ba144bb9ae67599fe048d98df2e', true,  'privada',  196),
  ('public.eliminar_contrato(text,boolean)',                                  'dcb90b8387d26b522d916c9ca8cfe685', true,  'heredada', 196),
  ('public.revertir_contrato_incompleto(text,text)',                          '50c51150154cf2f3bf90059732db652a', true,  'servicio', 196),
  ('public.confirmar_venta(text)',                                            '97809e36dab24bc4ecfddf37a9ef4016', false, 'api',      197),
  ('public._confirmar_sillas_de_venta(text)',                                 'e6e1ca72047d70ecd5c68a47a03d32b0', true,  'api',      197)
),
fn as (
  select e.*, p.oid, p.prosecdef, coalesce(p.proconfig, '{}')::text as cfg,
         md5(replace(p.prosrc, chr(13), '')) as md5_real
    from esperadas e left join pg_proc p on p.oid = to_regprocedure(e.firma)
),
chk(orden, verificacion, ok, detalle) as (
  select 1, '192: estado_silla tiene el valor retirada',
         exists (select 1 from pg_enum where enumtypid = 'public.estado_silla'::regtype and enumlabel = 'retirada'),
         'alter type public.estado_silla add value retirada'
  union all
  select 10 + migracion - 194, format('%s: funciones presentes (%s)', migracion, count(*)),
         bool_and(oid is not null),
         coalesce(string_agg(firma, '; ') filter (where oid is null), 'todas')
    from fn group by migracion
  union all
  select 20 + migracion - 194, format('%s: cuerpos = repositorio (md5)', migracion),
         bool_and(md5_real = md5_esperado),
         coalesce(string_agg(firma || ' = ' || coalesce(md5_real, 'falta'), '; ') filter (where md5_real is distinct from md5_esperado), 'todos coinciden')
    from fn group by migracion
  union all
  select 30, 'SECURITY DEFINER/INVOKER como se diseñó',
         bool_and(prosecdef = definer),
         coalesce(string_agg(firma, '; ') filter (where prosecdef is distinct from definer), 'todas')
    from fn
  union all
  select 31, 'search_path fijado en todas',
         bool_and(cfg like '%search_path=%'),
         coalesce(string_agg(firma, '; ') filter (where cfg not like '%search_path=%'), 'todas')
    from fn where oid is not null
  union all
  select 32, 'anon no ejecuta ninguna (salvo la heredada)',
         not bool_or(has_function_privilege('anon', oid, 'EXECUTE')),
         coalesce(string_agg(firma, '; ') filter (where has_function_privilege('anon', oid, 'EXECUTE')), 'ninguna')
    from fn where oid is not null and clase <> 'heredada'
  union all
  select 33, 'api: authenticated ejecuta',
         bool_and(has_function_privilege('authenticated', oid, 'EXECUTE')),
         coalesce(string_agg(firma, '; ') filter (where not has_function_privilege('authenticated', oid, 'EXECUTE')), 'todas')
    from fn where oid is not null and clase in ('api', 'heredada')
  union all
  select 34, 'privadas y de servicio: authenticated NO ejecuta',
         not bool_or(has_function_privilege('authenticated', oid, 'EXECUTE')),
         coalesce(string_agg(firma, '; ') filter (where has_function_privilege('authenticated', oid, 'EXECUTE')), 'ninguna')
    from fn where oid is not null and clase in ('privada', 'servicio')
  union all
  select 35, 'servicio: service_role ejecuta (cron, reservas)',
         bool_and(has_function_privilege('service_role', oid, 'EXECUTE')),
         coalesce(string_agg(firma, '; ') filter (where not has_function_privilege('service_role', oid, 'EXECUTE')), 'todas')
    from fn where oid is not null and clase = 'servicio'
  union all
  select 40, '194: operaciones_vuelo con RLS y solo lectura para la API',
         to_regclass('public.operaciones_vuelo') is not null
         and (select relrowsecurity from pg_class where oid = to_regclass('public.operaciones_vuelo'))
         and not exists (select 1 from pg_policies where tablename = 'operaciones_vuelo' and cmd <> 'SELECT')
         and not has_table_privilege('authenticated', 'public.operaciones_vuelo', 'INSERT')
         and not has_table_privilege('anon', 'public.operaciones_vuelo', 'INSERT'),
         'tabla, RLS, sin policies de escritura, sin INSERT para authenticated/anon'
  union all
  select 41, '194: movimientos_silla con las 16 columnas del historial',
         (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'movimientos_silla'
            and column_name in ('tipo', 'operacion_id', 'silla_destino_id', 'numero_silla_origen', 'numero_silla_destino', 'numero_contrato',
                                'contrato_manual', 'contrato_manual_clase', 'contrato_manual_resuelto', 'estado_silla', 'cupos_origen_antes',
                                'cupos_origen_despues', 'cupos_destino_antes', 'cupos_destino_despues', 'registrado_por_id',
                                'tramos_contrato_actualizados')) = 16,
         'columnas nuevas de la 194'
  union all
  select 42, '194: índice único (operacion_id, silla_id) e índice por operación',
         exists (select 1 from pg_indexes where tablename = 'movimientos_silla' and indexname = 'movimientos_silla_operacion_silla_uq')
         and exists (select 1 from pg_indexes where tablename = 'movimientos_silla' and indexname = 'idx_movimientos_silla_operacion'),
         'idempotencia por operación'
  union all
  select 43, '194: tipos de movimiento permitidos',
         exists (select 1 from pg_constraint where conname = 'movimientos_silla_tipo_check'
                  and pg_get_constraintdef(oid) like '%legado%' and pg_get_constraintdef(oid) like '%retiro_cupo%'),
         'legado, traslado_cupo, mover_datos, mover_con_cupo, retiro_cupo'
  union all
  select 44, '197: el ayudante DEFINER exige el testigo que fija confirmar_venta (no confía en quien lo llama)',
         coalesce((select prosrc like '%app.confirmar_venta_token%' and prosrc like '%mi_rol()%' and prosrc like '%puede_ver_tenant%'
                     from pg_proc where oid = to_regprocedure('public._confirmar_sillas_de_venta(text)')), false)
         and coalesce((select prosrc like '%set_config(''app.confirmar_venta_token''%'
                     from pg_proc where oid = to_regprocedure('public.confirmar_venta(text)')), false),
         'sesión + usuario activo + rol con UPDATE en ventas + testigo de la transacción + agencia, antes de tocar sillas'
  union all
  select 50, 'INFO: fase C (199) aún NO aplicada (esperado en este paso)',
         to_regprocedure('public._sillas_guarda_escritura()') is null,
         'si da false, la 199 ya corrió: verificar la barrera B→C'
  union all
  select 51, 'INFO: fase E (200) aún NO aplicada (esperado en este paso)',
         to_regprocedure('public._historial_vuelos_inmutable()') is null,
         'si da false, la 200 ya corrió: verificar la barrera previa a E'
  union all
  select 52, 'INFO: eliminar_contrato conserva su ACL heredado (PUBLIC desde la 060)',
         true,
         'anon=' || coalesce(has_function_privilege('anon', to_regprocedure('public.eliminar_contrato(text,boolean)'), 'EXECUTE')::text, '?')
           || '; el rol se valida dentro de la función (117)'
)
select orden, verificacion, ok, detalle from chk
union all
select 99, 'RESUMEN', bool_and(ok), count(*) filter (where not ok) || ' verificación(es) en false'
  from chk where verificacion not like 'INFO:%'
order by orden;
