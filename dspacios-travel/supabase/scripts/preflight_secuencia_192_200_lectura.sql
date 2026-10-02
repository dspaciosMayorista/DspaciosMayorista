-- ───────────────────────────────────────────────────────────────────────────
-- PREFLIGHT de la secuencia 192 → 200 (vuelos + los frentes 193 y 198) —
-- 199 y 200 son números PROVISIONALES (decisión del usuario, opción B): si
-- se renumeran, este script los detecta por sus funciones, no por el número;
-- actualizar solo las etiquetas.
-- SOLO LECTURA. Diseño docs/futuro/traslado-cupos-y-mover-pasajero.md §6.8.6.
--
-- Correr en Producción ANTES de cada paso de la secuencia (y otra vez si pasa
-- tiempo entre pasos). Una sola consulta SELECT sobre el catálogo: no crea, no
-- modifica, no bloquea nada y no devuelve datos de negocio.
--
-- Responde tres preguntas:
--   1. ¿Qué migraciones de la secuencia ya están aplicadas? (por el objeto que
--      cada una deja; la base no registra las corridas desde el editor SQL).
--   2. ¿El orden es coherente? Ninguna aplicada con una anterior sin aplicar.
--   3. ¿La 196 puede correr sin pisar nada? La 196 REEMPLAZA tres funciones
--      existentes (eliminar_contrato, revertir_contrato_incompleto,
--      _ajustar_sillas_bloqueo_nucleo) con cuerpos generados desde su última
--      versión del repositorio (166/167/172) y no se protege sola. Si en la
--      base hay OTRA versión (editada a mano o por una migración ajena), la 196
--      la revertiría en silencio. Aquí cada una debe estar en la versión previa
--      conocida o ya en la de la 196.
--
-- Columna `veredicto`: OK · PENDIENTE (falta aplicar, es normal) · DETENER ·
-- VERIFICAR (privilegios de service_role, filas 350–351: medidos en Producción,
-- deben quedar en OK antes de aplicar la 193; en una copia local restaurada
-- pueden faltar y las pruebas los simulan).
-- Cualquier DETENER: no seguir con la secuencia hasta entenderlo.
-- ───────────────────────────────────────────────────────────────────────────
with
mig(n, nombre, aplicada) as (values
  (190, 'guardar_proveedor_atomico',        to_regproc('public.guardar_proveedor') is not null),
  (191, 'proveedores_retirar_columnas_legacy',
        not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'proveedores' and column_name = 'razon_social')),
  (192, 'estado_silla_retirada',            exists (select 1 from pg_enum where enumtypid = 'public.estado_silla'::regtype and enumlabel = 'retirada')),
  -- 193: su rollback conserva la columna acceso_legacy_nombre; el marcador
  -- reversible es la policy de solo lectura que reemplaza al registro público.
  (193, 'registro_b2b_endurecido',          exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'b2b_solicitudes' and policyname = 'b2b_solicitudes: lectura admin')
                                            and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'b2b_solicitudes' and policyname = 'b2b_solicitudes: registro público')),
  (194, 'traslado_sillas_atomico',          to_regprocedure('public.trasladar_cupos(bigint,bigint,integer,text,uuid)') is not null),
  (195, 'crear_eliminar_bloqueo_atomico',   to_regprocedure('public.crear_bloqueo(jsonb,integer)') is not null),
  (196, 'liberaciones_sin_residuos',        to_regprocedure('public._vaciar_sillas(bigint[],text)') is not null),
  (197, 'confirmar_venta_atomica',          to_regprocedure('public.confirmar_venta(text)') is not null),
  (198, 'fecha_negocio_bogota',             to_regprocedure('public.fecha_negocio(timestamptz)') is not null),
  (199, 'cierre_escritura_directa_vuelos',  to_regprocedure('public._sillas_guarda_escritura()') is not null),
  (200, 'historial_vuelos_inmutable',       to_regprocedure('public._historial_vuelos_inmutable()') is not null)
),
hueco as (
  select m.n from mig m where m.aplicada and exists (select 1 from mig a where a.n < m.n and not a.aplicada)
),
v196(firma, md5_previo, md5_196) as (values
  ('public.eliminar_contrato(text,boolean)',                     '865a392d8fce38070366f6388e3dcc74', 'dcb90b8387d26b522d916c9ca8cfe685'),
  ('public.revertir_contrato_incompleto(text,text)',             '7f09e8d6a454afd5ac5ad1c8ef4b01ec', '50c51150154cf2f3bf90059732db652a'),
  ('public._ajustar_sillas_bloqueo_nucleo(text,bigint,integer)', '2e0ca54ed73a141f86cb92964d7f47c7', '94a91ba144bb9ae67599fe048d98df2e')
),
f196 as (
  select v.*, md5(replace(p.prosrc, chr(13), '')) as md5_real
    from v196 v left join pg_proc p on p.oid = to_regprocedure(v.firma)
),
-- Nombres que crea la secuencia: no deben existir con OTRA firma antes de aplicarla.
nombres(nombre, firma) as (values
  ('trasladar_cupos', 'public.trasladar_cupos(bigint,bigint,integer,text,uuid)'),
  ('mover_pasajero', 'public.mover_pasajero(bigint,bigint,text,boolean,text,uuid)'),
  ('retirar_cupo', 'public.retirar_cupo(bigint,text,uuid)'),
  ('cambiar_estado_silla', 'public.cambiar_estado_silla(bigint,text,text,boolean)'),
  ('asignar_contrato_manual', 'public.asignar_contrato_manual(bigint,text)'),
  ('quitar_contrato_manual', 'public.quitar_contrato_manual(bigint)'),
  ('liberar_silla', 'public.liberar_silla(bigint)'),
  ('editar_pasajero_silla', 'public.editar_pasajero_silla(bigint,jsonb)'),
  ('crear_bloqueo', 'public.crear_bloqueo(jsonb,integer)'),
  ('eliminar_bloqueo', 'public.eliminar_bloqueo(bigint)'),
  ('liberar_vencidas', 'public.liberar_vencidas(date)'),
  ('confirmar_venta', 'public.confirmar_venta(text)')
),
sr_tablas as (
  select t.tabla, t.priv, has_table_privilege('service_role', 'public.' || t.tabla, t.priv) as ok
    from (values ('b2b_solicitudes', 'SELECT'), ('b2b_solicitudes', 'INSERT'), ('usuarios', 'SELECT'), ('usuarios', 'UPDATE'),
                 ('sillas', 'SELECT'), ('sillas', 'UPDATE'), ('bloqueos_vuelo', 'SELECT'),
                 ('ventas', 'SELECT'), ('ventas', 'UPDATE'), ('contrato_pasajeros', 'SELECT'), ('contrato_pasajeros', 'INSERT')) t(tabla, priv)
),
sr_fn as (
  select p.oid::regprocedure::text as firma, has_function_privilege('service_role', p.oid, 'EXECUTE') as ok
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('crear_pasajeros_contrato', 'crear_pasajeros_contrato_multi', 'revertir_contrato_incompleto', 'liberar_vencidas')
),
fila(orden, verificacion, veredicto, detalle) as (
  select m.n, format('%s %s', m.n, m.nombre),
         case when m.aplicada then 'OK' when m.n <= 191 then 'DETENER' else 'PENDIENTE' end,
         case when m.aplicada then 'aplicada'
              when m.n <= 191 then 'falta una migración anterior a la secuencia: aplicarla primero'
              else 'sin aplicar' end
    from mig m
  union all
  select 300, 'orden coherente (sin huecos)',
         case when exists (select 1 from hueco) then 'DETENER' else 'OK' end,
         coalesce('aplicadas con una anterior pendiente: ' || (select string_agg(n::text, ', ') from hueco), 'sin huecos')
  union all
  select 310 + row_number() over (order by firma), '196 puede reemplazar ' || split_part(firma, '(', 1),
         case when md5_real is null then 'DETENER'
              when md5_real = md5_previo then 'OK'
              when md5_real = md5_196 then 'OK'
              else 'DETENER' end,
         case when md5_real is null then 'la función no existe'
              when md5_real = md5_previo then 'versión previa conocida (166/167/172): la 196 la reemplaza sin pisar nada'
              when md5_real = md5_196 then 'ya está en la versión de la 196'
              else 'versión DESCONOCIDA (md5 ' || md5_real || '): la 196 la pisaría; comparar antes de seguir' end
    from f196
  union all
  select 330, 'sin choques de nombre con otras firmas',
         case when exists (select 1 from nombres n join pg_proc p on p.proname = n.nombre and p.pronamespace = 'public'::regnamespace
                            where p.oid is distinct from to_regprocedure(n.firma)) then 'DETENER' else 'OK' end,
         coalesce((select string_agg(p.oid::regprocedure::text, '; ') from nombres n join pg_proc p on p.proname = n.nombre
                    and p.pronamespace = 'public'::regnamespace where p.oid is distinct from to_regprocedure(n.firma)), 'ninguno')
  union all
  -- service_role: lo que el código usa con el cliente admin (registro y
  -- aprobación B2B, copia de datos al reservar W8, cron, núcleo de reservas).
  -- En Supabase real lo tiene por defecto; en una copia restaurada puede faltar
  -- (pasó en local), y las pruebas locales lo simulan. Aquí se mide de verdad.
  select 350, 'service_role: privilegios de tabla que usa el código (medir en Producción)',
         case when exists (select 1 from sr_tablas where not ok) then 'VERIFICAR' else 'OK' end,
         coalesce((select string_agg(tabla || ' ' || priv, ', ') from sr_tablas where not ok), 'todos presentes')
  union all
  select 351, 'service_role: EXECUTE de las RPC que llama con el cliente admin',
         case when exists (select 1 from sr_fn where not ok) then 'VERIFICAR' else 'OK' end,
         coalesce((select string_agg(firma, ', ') from sr_fn where not ok), 'todas presentes')
  union all
  select 340, 'siguiente paso',
         'INFO',
         case
           when exists (select 1 from hueco) then 'resolver el hueco de orden'
           when not (select aplicada from mig where n = 192) then 'aplicar 192 SOLA (alter type no puede ir en la misma transacción que la 194)'
           when not (select aplicada from mig where n = 193) then 'preflight_193, aplicar 193, postcheck_193 (fila 12 = service_role en Producción) y desplegar pronto el código B2B aislado'
           when not (select aplicada from mig where n = 197) then 'bloque A de preflight_traslado_cupos_lectura + filas 311–313 en OK; aplicar 194, 195, 196 y 197 en orden (cada una en su propia ejecución); luego postcheck_192_197_vuelos_fase_b.sql'
           when not (select aplicada from mig where n = 198) then 'aplicar 198 (frente fechas; independiente del código)'
           when not (select aplicada from mig where n = 199) then 'desplegar el código de vuelos (tras el de fechas, que trae lib/fechaNegocio.ts, y con W7 decidido) y cumplir la barrera B→C (§6.8.5) ANTES de la migración C (número provisional: renumerar si ya hay otra migración posterior)'
           when not (select aplicada from mig where n = 200) then 'cumplir la barrera previa a E (§6.8.5) ANTES de la migración E (número provisional: renumerar si hace falta)'
           else 'secuencia completa: postcheck_199 y postcheck_200' end
)
select orden, verificacion, veredicto, detalle from fila
union all
select 999, 'RESUMEN',
       case when exists (select 1 from fila where veredicto = 'DETENER') then 'DETENER' else 'OK' end,
       (select count(*) from fila where veredicto = 'DETENER') || ' DETENER · ' || (select count(*) from fila where veredicto = 'VERIFICAR') || ' VERIFICAR · '
         || (select count(*) from fila where veredicto = 'PENDIENTE') || ' pendiente(s)'
order by orden;
