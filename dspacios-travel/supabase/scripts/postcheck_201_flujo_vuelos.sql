-- Solo lectura, despues de la migracion 201 de Vuelos.
-- Clases: api = authenticated sí (con lock_timeout); servicio = solo service_role;
-- privada = ni authenticated ni service_role (solo el dueño, desde otras funciones).
with esperadas(firma, huella, clase) as (values
  ('public.cambiar_estado_silla(bigint,text,text,boolean)', '49d46cf31a34b9ed6847da116db2169f', 'api'),
  ('public.asignar_contrato_manual(bigint,text)', '170dfb530a5564469657a843ee0fda8f', 'api'),
  ('public.quitar_contrato_manual(bigint)', '8313f296fdc0fb8244a884833045ba11', 'api'),
  ('public.quitar_contrato_manual(bigint,date,jsonb)', '286d71d03268e14a8f1a8079f6740a75', 'api'),
  ('public._quitar_contrato_manual(bigint,date,timestamptz,boolean)', '2544f1ed450b4b68e2abf17cdc0e80d4', 'privada'),
  ('public.editar_contrato_manual(bigint,text,jsonb)', '3e54b2cee8de26f74efea7b5cc10d44b', 'api'),
  ('public.liberar_retencion_vencida(bigint,jsonb)', '202ac68b3bcb699c2240c04717142b8d', 'api'),
  ('public.editar_pasajero_silla(bigint,jsonb)', '0cb298519f7f74c5e0b6a89c61ebe5a5', 'api'),
  ('public.liberar_silla(bigint)', '7dae462501f91621565c1ada8a6071cd', 'api'),
  ('public._registrar_firma_antigua(text,bigint)', '85c4f3b8a4bd3e68c16924a44cdefc59', 'privada'),
  ('public._firmas_antiguas_cerradas()', '3583b6362e75790b040f00e5574bfa58', 'privada'),
  ('public._registrar_firma_nueva()', '3f3214f9833352885b10e2c3841f289b', 'privada'),
  ('public.programar_cierre_firmas_antiguas(integer,text)', '4ab77a3af695b646ff2de7f912b169df', 'privada'),
  ('public.cancelar_cierre_firmas_antiguas(text)', '8a19678c855c9a50c121df3f3057dc3e', 'privada'),
  ('public.liberar_silla(bigint,jsonb)', '67a18542caa8241a25efc6800a69d4e5', 'api'),
  ('public.asignar_contrato_manual(bigint,text,jsonb)', '3646964b7e9e57f3d4b93a458493fa3f', 'api'),
  ('public._asignar_contrato_manual(bigint,text,timestamptz)', 'fa671c71d8fcdca3423c02491fcfd8a1', 'privada'),
  ('public._ajustar_sillas_bloqueo_nucleo(text,bigint,integer)', '26e514bbbbb1fda58cb024cb85884ef2', 'privada'),
  ('public._copiar_datos_sillas_contrato(text,bigint,jsonb,jsonb)', '600909e403b5c13ef57b3a977cce6085', 'privada'),
  ('public.crear_pasajeros_contrato_con_sillas(text,jsonb,integer,uuid,jsonb,jsonb)', '3d730d7b7664869219f033cceccebcc7', 'servicio'),
  ('public.crear_pasajeros_contrato_multi_con_sillas(text,jsonb,jsonb,uuid,jsonb,jsonb)', '3302ab3ce0cacb4afb6abc6f83f0d4fc', 'servicio')
), funciones as (
  select e.firma, e.huella, e.clase, p.oid, p.prosecdef, p.proconfig,
         md5(replace(p.prosrc, chr(13), '')) as huella_real
    from esperadas e
    left join pg_proc p on p.oid = to_regprocedure(e.firma)
), verificaciones as (
  select firma as verificacion,
         coalesce(oid is not null and prosecdef
           and huella_real = huella
           and proconfig::text like '%search_path=public%'
           and (clase <> 'api' or (proconfig::text like '%search_path=public, pg_temp%'
                                   and proconfig::text like '%lock_timeout=5s%'))
           and not has_function_privilege('anon', oid, 'EXECUTE')
           and has_function_privilege('authenticated', oid, 'EXECUTE') = (clase = 'api')
           and (clase <> 'servicio' or has_function_privilege('service_role', oid, 'EXECUTE'))
           and (firma <> 'public._copiar_datos_sillas_contrato(text,bigint,jsonb,jsonb)'
                or not has_function_privilege('service_role', oid, 'EXECUTE')), false) as ok,
         format('huella=%s, esperada=%s', coalesce(huella_real, 'ausente'), huella) as detalle
    from funciones
  union all
  select 'cupos_por_bloqueo cuenta con _silla_libre y sigue security_invoker',
         coalesce(position('_silla_libre' in pg_get_viewdef(c.oid)) > 0
           and c.reloptions::text like '%security_invoker=true%', false),
         coalesce(array_to_string(c.reloptions, ','), 'sin opciones')
    from pg_class c where c.oid = to_regclass('public.cupos_por_bloqueo')
  union all
  select 'predicados de silla libre: authenticated si, anon no',
         has_function_privilege('authenticated', 'public._silla_libre(public.sillas)', 'EXECUTE')
           and has_function_privilege('authenticated', 'public._silla_con_datos(public.sillas)', 'EXECUTE')
           and not has_function_privilege('anon', 'public._silla_libre(public.sillas)', 'EXECUTE')
           and not has_function_privilege('anon', 'public._silla_con_datos(public.sillas)', 'EXECUTE'),
         'la vista es invoker y el dashboard la lee como authenticated'
  union all
  select 'guarda de retención: INVOKER, BEFORE UPDATE y después de la guarda 199',
         coalesce((select not p.prosecdef and md5(replace(p.prosrc, chr(13), '')) = '8ee1cb4f0919a6e32f913a8ba228d1ae'
                     and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
                     and not has_function_privilege('service_role', p.oid, 'EXECUTE')
                     from pg_proc p where p.oid = to_regprocedure('public._sillas_retencion_sin_contrato()')), false)
         and exists (select 1 from pg_trigger where tgrelid = 'public.sillas'::regclass and tgname = 'sillas_retencion_sin_contrato' and tgenabled = 'O')
         and exists (select 1 from pg_trigger where tgrelid = 'public.sillas'::regclass and tgname = 'sillas_guarda_escritura')
         and 'sillas_guarda_escritura' < 'sillas_retencion_sin_contrato',
         'una silla sin contrato vendible queda vacía o retenida (pasajero + plazo)'
  union all
  select 'liberar_vencidas sigue siendo la de la 196 (no toca retenciones sin contrato)',
         coalesce((select md5(replace(prosrc, chr(13), '')) = '0b12c63266b2f1a87b75124eedf71245'
                     from pg_proc where oid = to_regprocedure('public.liberar_vencidas(date)')), false),
         'el cron solo atiende contratos pendientes'
  union all
  select 'vencimiento de retención: una sola definición, sin EXECUTE para la API',
         coalesce((select md5(replace(prosrc, chr(13), '')) = '10089eae4706ae7fc40547337053a4f2'
                     and not has_function_privilege('authenticated', oid, 'EXECUTE')
                     and not has_function_privilege('service_role', oid, 'EXECUTE')
                     from pg_proc where oid = to_regprocedure('public._retencion_vencida(date,date)')), false),
         'plazo < día de negocio; la usan asignar y liberar_retencion_vencida'
  union all
  select 'registro de uso de firmas antiguas: existe, con RLS y cerrado a la API',
         coalesce((select c.relrowsecurity
                          and not has_table_privilege('authenticated', c.oid, 'SELECT')
                          and not has_table_privilege('authenticated', c.oid, 'INSERT')
                          and not has_table_privilege('anon', c.oid, 'SELECT')
                          and not has_table_privilege('service_role', c.oid, 'SELECT')
                     from pg_class c where c.oid = to_regclass('public.vuelos_firmas_antiguas_uso')), false),
         'evidencia para el cierre de las firmas sin versión'
  union all
  select 'cierre de firmas sin versión: una fila de estado, triggers de solo-avance activos',
         (select count(*) = 1 from public.vuelos_cierre_firmas_201)
           and (select count(*) = 2 from pg_trigger where tgrelid = 'public.vuelos_cierre_firmas_201'::regclass
                                                     and not tgisinternal and tgenabled = 'O')
           and coalesce((select md5(replace(prosrc, chr(13), '')) = 'e84b482c74c26450557fb7b92ffe0e94'
                           from pg_proc where oid = to_regprocedure('public._vuelos_cierre_firmas_201_monotono()')), false),
         (select format('estado %s; firmas viejas %s', estado,
                        case when public._firmas_antiguas_cerradas() then 'CERRADAS' else 'abiertas' end)
            from public.vuelos_cierre_firmas_201)
  union all
  select 'sin copia de sillas expuesta fuera de la transacción de la reserva',
         to_regprocedure('public.copiar_datos_sillas_contrato(text,bigint,jsonb,jsonb)') is null,
         'la copia solo existe como _copiar_datos_sillas_contrato (privada)'
)
select * from verificaciones
union all
select 'RESUMEN', bool_and(ok), format('%s verificaciones falsas', count(*) filter (where not ok))
  from verificaciones;

-- INFO (no falla): firmas ANTERIORES que siguen existiendo SIN comprobar la
-- versión de la silla. Se conservan para desplegar la migración antes que el
-- código; una vez desplegado, el código nuevo ya no las llama y pueden
-- retirarse en una migración posterior.
select 'INFO firma vieja sin versión' as aviso, p.oid::regprocedure::text as firma,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_puede_llamarla
  from pg_proc p
 where p.oid in (to_regprocedure('public.liberar_silla(bigint)'),
                 to_regprocedure('public.asignar_contrato_manual(bigint,text)'),
                 to_regprocedure('public.quitar_contrato_manual(bigint)'))
union all
select 'INFO editar_pasajero_silla sin esperado.updated_at', 'public.editar_pasajero_silla(bigint,jsonb)', true
union all
select 'privada: _version_silla_esperada sin EXECUTE para la API', 'public._version_silla_esperada(jsonb)',
       not (has_function_privilege('authenticated', 'public._version_silla_esperada(jsonb)', 'EXECUTE')
            or has_function_privilege('anon', 'public._version_silla_esperada(jsonb)', 'EXECUTE')
            or has_function_privilege('service_role', 'public._version_silla_esperada(jsonb)', 'EXECUTE'));

-- INFO (no falla): llamadas registradas a las firmas sin versión. El cierre se
-- activa tras el despliegue (activar_cierre_firmas_201.sql); su estado y el uso
-- desde el código nuevo están en postcheck_cierre_firmas_201.sql.
select 'INFO uso de firma vieja' as aviso, firma, count(*) as llamadas, min(usado_en) as primera, max(usado_en) as ultima
  from public.vuelos_firmas_antiguas_uso
 group by firma
 order by firma;
