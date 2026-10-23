-- ───────────────────────────────────────────────────────────────────────────
-- PREFLIGHT · traslado de cupos libres (tarea 2) y mover pasajero con cupo o
-- solo datos (tarea 3). Bloques A y B: EXCLUSIVAMENTE DE LECTURA.
-- Bloque C: prueba EFECTIVA de escritura, NO es de solo lectura (ver abajo).
--
-- Diseño: docs/futuro/traslado-cupos-y-mover-pasajero.md
--
-- Qué NO hace: no crea tablas (ni temporales), no escribe, no cambia roles
-- ni configuración. El BLOQUE A es UNA sola sentencia SELECT; se puede pegar
-- tal cual en el editor SQL de Supabase (muestra una tabla de resultados).
-- El BLOQUE B (opcional) prueba la lectura EFECTIVA de `sillas` como un
-- usuario real con rol `venta`; va en una transacción READ ONLY que termina
-- en ROLLBACK y está pensado para psql (ver instrucciones en el bloque).
-- El BLOQUE C (opcional) intenta las escrituras DIRECTAS que el diseño
-- prohíbe (§6.5) como un usuario real de vuelos, cada una en su propia
-- subtransacción revertida, y todo el bloque termina en ROLLBACK. Es la
-- ÚNICA prueba de que las guardas rechazan de verdad: el bloque A solo ve
-- privilegios concedidos y si el trigger existe. Ejecutar primero en local;
-- en Producción solo con aprobación explícita (deja huecos en secuencias y
-- toma bloqueos de fila unos milisegundos).
--
-- Privacidad: solo devuelve conteos, ids de bloqueo, records (PNR) y números
-- de contrato de muestra (máx. 10). Nunca nombres, documentos ni fechas de
-- nacimiento.
--
-- Columnas del reporte: seccion · control · estado · valor · detalle
--   estado = OK (comprobación determinista y esperada) · REVISAR (requiere
--   decisión o limpieza antes de migrar) · INDETERMINADO (no se puede
--   concluir con análisis estático) · INFO (contexto, sin juicio).
--
-- ⚠️ Estático vs efectivo. Las filas de acceso de la sección 1 son ANÁLISIS
-- ESTÁTICO de pg_policies y NUNCA devuelven OK: lo mejor que pueden decir es
-- "SIN HALLAZGO ESTÁTICO". Cada policy PERMISSIVE aplicable se clasifica:
--   · amplia        → USING ausente, `true` o `(true)`            ⇒ SÍ accede
--   · lista_roles   → exactamente `mi_rol() = ANY (ARRAY['x'::rol_usuario, …])`
--                     o `mi_rol() = 'x'::rol_usuario`             ⇒ SÍ si el rol está en la lista
--   · no_reconocida → cualquier otra expresión                     ⇒ INDETERMINADO
-- Una policy aplica a un caso solo si sus `roles` incluyen `public` o el rol
-- de base de datos del caso (`authenticated` para los roles de la app,
-- `anon` para visitantes). RLS desactivada ⇒ SÍ. Solo el BLOQUE B (lectura
-- EFECTIVA suplantando a un usuario real) puede devolver OK, y solo para el
-- usuario probado.
--
-- UPDATE y DELETE del historial se evalúan POR SEPARADO, cada uno con su
-- propio privilegio de tabla y sus propias policies (UPDATE/ALL y DELETE/ALL).
-- Un DELETE sin WHERE solo necesita la policy de DELETE (Postgres aplica las
-- de SELECT solo si la sentencia lee filas con WHERE o RETURNING), así que
-- un rol con solo DELETE puede vaciar el historial aunque no pueda editarlo
-- ni leerlo. La prueba EFECTIVA de escritura no cabe aquí (este script es
-- de solo lectura): se hace en una base local/desechable.
--
-- Índice único propuesto (diseño §4.4c), MISMO conjunto de filas que la
-- comprobación de duplicados de la sección 3:
--   create unique index sillas_bloqueo_numero_uq on public.sillas (bloqueo_id, numero_silla);
-- Sin WHERE: cubre TODOS los estados, incluidos `cambio` y `retirada` (un
-- número de silla no se reutiliza dentro del record aunque la silla ya no
-- esté activa). NULL no choca con NULL (NULLS DISTINCT, el valor por
-- defecto): las sillas sin número se reportan aparte.
-- ───────────────────────────────────────────────────────────────────────────

-- ═══ BLOQUE A ═══════════════════════════════════════════════════════════════
with
s as (
  select s.*, (s.estado::text = 'cambio') as es_legado_cambio,
         (s.estado::text in ('cambio', 'retirada')) as no_activa,
         (s.estado::text in ('disponible', 'cambio_entrante')
          and s.numero_contrato is null and s.contrato_manual is null
          and s.pasajero_nombres is null and s.pasajero_apellidos is null
          and s.numero_doc is null) as libre_real
  from public.sillas s
),
b as (select * from public.bloqueos_vuelo),
m as (select * from public.movimientos_silla),
pol as (
  select p.tablename, p.policyname, p.permissive, p.cmd, p.roles,
         coalesce(p.qual, '') as qual,
         (p.roles && array['public', 'authenticated']::name[]) as aplica_authenticated,
         (p.roles && array['public', 'anon']::name[]) as aplica_anon,
         case
           when p.qual is null or btrim(p.qual) in ('', 'true', '(true)') then 'amplia'
           when regexp_replace(p.qual, '\s+', ' ', 'g')
                ~ '^\(?mi_rol\(\) = ANY \(ARRAY\[''[a-z_]+''::rol_usuario(, ''[a-z_]+''::rol_usuario)*\]\)\)?$'
             then 'lista_roles'
           when regexp_replace(p.qual, '\s+', ' ', 'g') ~ '^\(?mi_rol\(\) = ''[a-z_]+''::rol_usuario\)?$'
             then 'lista_roles'
           else 'no_reconocida'
         end as clase,
         array(select x[1] from regexp_matches(coalesce(p.qual, ''), '''([a-z_]+)''::rol_usuario', 'g') as x) as roles_app,
         -- Expresión que decide filas NUEVAS: WITH CHECK, o USING si no hay WITH CHECK (regla de Postgres para ALL/UPDATE).
         case
           when coalesce(p.with_check, p.qual) is null or btrim(coalesce(p.with_check, p.qual)) in ('', 'true', '(true)') then 'amplia'
           when regexp_replace(coalesce(p.with_check, p.qual), '\s+', ' ', 'g')
                ~ '^\(?mi_rol\(\) = ANY \(ARRAY\[''[a-z_]+''::rol_usuario(, ''[a-z_]+''::rol_usuario)*\]\)\)?$'
             then 'lista_roles'
           when regexp_replace(coalesce(p.with_check, p.qual), '\s+', ' ', 'g') ~ '^\(?mi_rol\(\) = ''[a-z_]+''::rol_usuario\)?$'
             then 'lista_roles'
           else 'no_reconocida'
         end as clase_check,
         array(select x[1] from regexp_matches(coalesce(p.with_check, p.qual, ''), '''([a-z_]+)''::rol_usuario', 'g') as x) as roles_check
  from pg_policies p where p.schemaname = 'public'
),
-- Casos de acceso a evaluar: (tabla, rol de la app — '*' = cualquiera,
-- null = visitante —, rol de base de datos, comandos que otorgan la acción,
-- privilegio de tabla requerido).
objetivos(orden, tabla, rol_app, via, cmds, priv, accion) as (
  values
    (1, 'sillas', 'venta', 'authenticated', array['SELECT', 'ALL'], 'SELECT', 'lectura'),
    (2, 'sillas', null, 'anon', array['SELECT', 'ALL'], 'SELECT', 'lectura'),
    (3, 'movimientos_silla', 'venta', 'authenticated', array['SELECT', 'ALL'], 'SELECT', 'lectura'),
    (4, 'movimientos_silla', null, 'anon', array['SELECT', 'ALL'], 'SELECT', 'lectura'),
    (5, 'movimientos_silla', '*', 'authenticated', array['UPDATE', 'ALL'], 'UPDATE', 'UPDATE'),
    (6, 'movimientos_silla', '*', 'authenticated', array['DELETE', 'ALL'], 'DELETE', 'DELETE'),
    -- Vías de escritura DIRECTA que el diseño cierra (§6.5): cualquier rol de la app.
    (7, 'sillas', '*', 'authenticated', array['INSERT', 'ALL'], 'INSERT', 'INSERT'),
    (8, 'sillas', '*', 'authenticated', array['UPDATE', 'ALL'], 'UPDATE', 'UPDATE'),
    (9, 'sillas', '*', 'authenticated', array['DELETE', 'ALL'], 'DELETE', 'DELETE'),
    (10, 'bloqueos_vuelo', '*', 'authenticated', array['INSERT', 'ALL'], 'INSERT', 'INSERT'),
    (11, 'bloqueos_vuelo', '*', 'authenticated', array['UPDATE', 'ALL'], 'UPDATE', 'UPDATE')
),
veredicto_estatico as (
  select o.*,
    (select c.relrowsecurity from pg_class c where c.oid = to_regclass('public.' || o.tabla)) as rls,
    has_table_privilege(o.via, 'public.' || o.tabla, o.priv) as con_privilegio,
    a.n_amplia, a.n_lista_con_rol, a.n_no_reconocida, a.detalle,
    (select count(*) from pol r where r.tablename = o.tabla and r.permissive = 'RESTRICTIVE') as n_restrictive
  from objetivos o
  cross join lateral (
    select
      count(*) filter (where k.clase = 'amplia') as n_amplia,
      count(*) filter (where k.clase = 'lista_roles'
                         and (o.rol_app = '*' and cardinality(k.roles) > 0 or o.rol_app = any(k.roles))) as n_lista_con_rol,
      count(*) filter (where k.clase = 'no_reconocida') as n_no_reconocida,
      string_agg(format('%s [%s · %s]', p.policyname, p.cmd, k.clase), ', ' order by p.policyname) as detalle
    from pol p
    -- INSERT se decide por WITH CHECK; lectura/UPDATE/DELETE por USING.
    cross join lateral (select case when o.accion = 'INSERT' then p.clase_check else p.clase end as clase,
                               case when o.accion = 'INSERT' then p.roles_check else p.roles_app end as roles) k
    where p.tablename = o.tabla and p.permissive = 'PERMISSIVE' and p.cmd = any(o.cmds)
      and case o.via when 'anon' then p.aplica_anon else p.aplica_authenticated end
  ) a
),
por_bloqueo as (
  select b.id, b.record, b.cupos_total,
         count(s.id) as filas,
         count(s.id) filter (where not s.no_activa) as filas_activas,
         count(s.id) filter (where s.libre_real) as libres_reales
  from b left join s on s.bloqueo_id = b.id
  group by b.id, b.record, b.cupos_total
),
contrato_bloqueos as (
  select numero_contrato, count(distinct bloqueo_id) as n_bloqueos
  from s where numero_contrato is not null and not es_legado_cambio
  group by numero_contrato
),
manual_bloqueos as (
  select contrato_manual, count(distinct bloqueo_id) as n_bloqueos
  from s where contrato_manual is not null and not es_legado_cambio
  group by contrato_manual
),
mov_pares as (
  select m.*, bo.destino_id as o_dest, bd.destino_id as d_dest, bo.ruta as o_ruta, bd.ruta as d_ruta,
         bo.fecha_ida as o_ida, bd.fecha_ida as d_ida, bo.fecha_regreso as o_reg, bd.fecha_regreso as d_reg,
         bo.aerolinea as o_aer, bd.aerolinea as d_aer, bo.proveedor_id as o_prov, bd.proveedor_id as d_prov,
         bo.tarifa_neta as o_tn, bd.tarifa_neta as d_tn
  from m
  left join b bo on bo.id = m.bloqueo_origen_id
  left join b bd on bd.id = m.bloqueo_destino_id
),
-- Resolución de contrato_manual: MISMA regla que lib/vuelos/contratoManual.ts
-- (candidatosNumeroContrato + resolverReferenciasManuales): referencia
-- recortada; candidatos = ella misma y, si no empieza por 'MIN-', 'MIN-' ||
-- ella; comparación EXACTA con ventas.numero_contrato. 0 → externo,
-- 1 → interno (con su tenant), ≥2 → ambiguo (falla cerrado).
-- Limpieza IDÉNTICA a String.prototype.trim() de la app (ECMAScript
-- WhiteSpace + LineTerminator): TAB, LF, VT, FF, CR, espacio, NBSP, U+1680,
-- U+2000–U+200A, U+2028, U+2029, U+202F, U+205F, U+3000 y U+FEFF. btrim()
-- de Postgres solo quita el espacio: con una tabulación o un salto de línea
-- la referencia no casaba y se clasificaba como EXTERNA (autorización más
-- laxa). Si tras recortar queda DENTRO de la referencia un espacio no ASCII
-- (NBSP, U+2000–U+200A, U+3000, BOM…) o un carácter de control (tab, salto,
-- U+0000–U+001F, U+007F–U+009F), se clasifica 'no_admitida' y falla cerrado.
-- El espacio ASCII interno SÍ se admite: el texto libre externo puede
-- llevarlo y la comparación es exacta, igual en la app que aquí.
manual_norm as (
  select contrato_manual as crudo,
         regexp_replace(contrato_manual,
           '^[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$',
           '', 'g') as ref
  from public.sillas where contrato_manual is not null
),
manual_ref as (
  select ref, count(*) as sillas,
         count(*) filter (where crudo <> ref) as con_espacios,
         ref ~ '[\u0000-\u001f\u007f-\u009f\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]' as no_admitida
  from manual_norm
  where ref <> ''
  group by ref
),
manual_clas as (
  select r.ref, r.sillas, r.con_espacios, r.no_admitida,
         (select count(*) from public.ventas v where v.numero_contrato = any(c.candidatos)) as n_exactos,
         (select min(v.tenant) from public.ventas v where v.numero_contrato = any(c.candidatos)) as tenant_si_unico,
         (select count(*) from public.ventas v
           where upper(v.numero_contrato) = any(array(select upper(x) from unnest(c.candidatos) x))) as n_sin_mayusculas
  from manual_ref r
  cross join lateral (
    select array_remove(array[r.ref, case when left(r.ref, 4) = 'MIN-' then null else 'MIN-' || r.ref end], null) as candidatos
  ) c
),
reporte(seccion, control, estado, valor, detalle) as (

  -- ── 0. Contexto ──────────────────────────────────────────────────────────
  select '0-contexto', 'postgres', 'INFO', current_setting('server_version'), now()::text
  union all
  select '0-contexto', 'objetos requeridos',
    case when to_regclass('public.sillas') is not null and to_regclass('public.movimientos_silla') is not null
          and to_regclass('public.bloqueo_cambios') is not null and to_regclass('public.auditoria') is not null
          and exists (select 1 from pg_constraint where conname = 'sillas_contrato_unico')
          and exists (select 1 from pg_proc where proname = 'mi_rol')
         then 'OK' else 'REVISAR' end,
    null, 'sillas, movimientos_silla, bloqueo_cambios, auditoria, CHECK sillas_contrato_unico (085), mi_rol()'
  union all
  select '0-contexto', 'helpers de autorización que reutiliza el diseño',
    case when exists (select 1 from pg_proc where proname = 'acceso_editar_vuelos_contrato')
          and exists (select 1 from pg_proc where proname = 'mi_tenant') then 'OK' else 'REVISAR' end,
    null, 'acceso_editar_vuelos_contrato() (157) y mi_tenant() (107)'
  union all
  select '0-contexto', 'valores del enum estado_silla', 'INFO',
    (select string_agg(e.enumlabel, ', ' order by e.enumsortorder)
       from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'estado_silla'),
    'El diseño propone agregar retirada (retiro de cupo con historial, decisión D8); hoy no existe.'
  union all
  select '0-contexto', 'totales', 'INFO',
    format('bloqueos=%s · sillas=%s · movimientos=%s', (select count(*) from b), (select count(*) from s), (select count(*) from m)),
    null

  -- ── 1. Política efectiva de lectura/escritura ────────────────────────────
  union all
  select '1-rls', 'RLS activa', case when bool_and(c.relrowsecurity) then 'OK' else 'REVISAR' end,
    string_agg(c.relname || '=' || c.relrowsecurity, ', ' order by c.relname),
    'sillas, movimientos_silla, bloqueos_vuelo, bloqueo_cambios'
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname in ('sillas', 'movimientos_silla', 'bloqueos_vuelo', 'bloqueo_cambios')
  union all
  select '1-rls', 'policies de ' || t.tabla, 'INFO', count(p.policyname)::text,
    string_agg(format('%s [%s %s] roles=%s clase=%s using=%s', p.policyname, p.permissive, p.cmd, p.roles, p.clase, p.qual),
               ' || ' order by p.policyname)
  from (values ('sillas'), ('movimientos_silla')) as t(tabla)
  left join pol p on p.tablename = t.tabla
  group by t.tabla
  union all
  -- ESTÁTICO (nunca OK). La 142 afirma en un comentario que venta no lee
  -- sillas; esta fila dice qué permiten las policies de ESTA base.
  select '1-rls',
    format('[estático] %s de %s — %s', v.accion, v.tabla,
           case when v.rol_app is null then 'visitante (anon)' when v.rol_app = '*' then 'cualquier rol de la app' else 'rol ' || v.rol_app end),
    case
      when v.rls is distinct from true then 'REVISAR'
      when not v.con_privilegio then 'INFO'
      when v.n_amplia > 0 or v.n_lista_con_rol > 0 then 'REVISAR'
      when v.n_no_reconocida > 0 then 'INDETERMINADO'
      else 'INFO'
    end,
    case
      when v.rls is distinct from true then 'SÍ — RLS desactivada'
      when not v.con_privilegio then 'SIN HALLAZGO ESTÁTICO — sin privilegio de tabla para ' || v.via
      when v.n_amplia > 0 then 'SÍ — policy amplia (USING ausente o true)'
      when v.n_lista_con_rol > 0 then 'SÍ — la policy lista el rol'
      when v.n_no_reconocida > 0 then 'INDETERMINADO — expresión no reconocida'
      else 'SIN HALLAZGO ESTÁTICO'
    end,
    'Aplicables: ' || coalesce(v.detalle, 'ninguna')
      || case when v.n_restrictive > 0 then format(' · %s policy(s) RESTRICTIVE: pueden restringir más', v.n_restrictive) else '' end
      || case when v.accion = 'lectura' and v.rol_app = 'venta' then ' · confirmar con el BLOQUE B (lectura efectiva)' else '' end
      || case when v.tabla = 'movimientos_silla' and v.accion in ('UPDATE', 'DELETE') then ' · la migración de cierre debe dejar solo SELECT + trigger de inmutabilidad' else '' end
      || case when v.tabla in ('sillas', 'bloqueos_vuelo') and v.accion <> 'lectura' then ' · vía de escritura directa: ver diseño §6.5 (columnas de vínculo, estado, estructura y cupos solo por funciones)' else '' end
  from veredicto_estatico v
  union all
  select '1-rls', 'usuarios activos con rol venta', 'INFO',
    (select count(*)::text from public.usuarios where rol = 'venta' and activo),
    'Alcance real si venta lee sillas. Si es 0, el BLOQUE B no puede probar nada (SIN_PRUEBA).'
  union all
  -- [privilegio] Dato, NO veredicto: el diseño cierra las columnas con un
  -- trigger y CONSERVA el UPDATE de tabla de authenticated, así que estas
  -- columnas seguirán apareciendo como concedidas también después de la
  -- fase C. Que el privilegio exista no dice si la escritura prospera.
  select '1-rls', '[privilegio] UPDATE concedido a authenticated en columnas protegidas de sillas', 'INFO',
    coalesce(string_agg(col, ', ' order by col) filter (where puede), 'ninguna'),
    'Esperado antes Y después de la fase C: todas. El rechazo lo da el trigger; confirmarlo con el BLOQUE C.'
  from (select c as col, has_column_privilege('authenticated', 'public.sillas', c, 'UPDATE') as puede
        from unnest(array['numero_contrato', 'contrato_manual', 'estado', 'bloqueo_id', 'numero_silla']) c) x
  union all
  select '1-rls', '[privilegio] UPDATE concedido a authenticated en bloqueos_vuelo.cupos_total', 'INFO',
    case when has_column_privilege('authenticated', 'public.bloqueos_vuelo', 'cupos_total', 'UPDATE') then 'concedido' else 'no concedido' end,
    'Esperado antes Y después de la fase C: concedido (el resto de columnas del record se sigue editando). El rechazo lo da el trigger; confirmarlo con el BLOQUE C.'
  union all
  -- Este sí cambia con la fase C: el diseño retira INSERT y DELETE de sillas.
  select '1-rls', '[privilegio] INSERT / DELETE concedidos a authenticated en sillas',
    case when has_table_privilege('authenticated', 'public.sillas', 'INSERT') or has_table_privilege('authenticated', 'public.sillas', 'DELETE') then 'REVISAR' else 'INFO' end,
    format('INSERT=%s · DELETE=%s', has_table_privilege('authenticated', 'public.sillas', 'INSERT'), has_table_privilege('authenticated', 'public.sillas', 'DELETE')),
    'Antes de la fase C: true/true (esperado). Después: false/false. Aun así, confirmar el rechazo efectivo con el BLOQUE C.'
  union all
  -- [guarda] Estático: existe, habilitada, BEFORE, de fila, con los eventos
  -- correctos y función SECURITY INVOKER. Nunca OK: si está bien formada da
  -- INDETERMINADO hasta que el BLOQUE C la vea rechazar.
  select '1-rls', '[guarda] ' || g.tabla || '.' || g.nombre,
    case when t.oid is null then 'INFO'
         when t.tgenabled in ('O', 'A') and (t.tgtype & 1) = 1 and (t.tgtype & 2) = 2 and (t.tgtype & g.eventos) = g.eventos and not p.prosecdef
           then 'INDETERMINADO'
         else 'REVISAR' end,
    case when t.oid is null then 'ausente'
         else concat_ws(', ',
           case when t.tgenabled in ('O', 'A') then 'habilitada' else 'DESHABILITADA' end,
           case when (t.tgtype & 2) = 2 then 'BEFORE' else 'NO es BEFORE' end,
           case when (t.tgtype & 1) = 1 then 'por fila' else 'NO es por fila' end,
           case when (t.tgtype & g.eventos) = g.eventos then 'eventos correctos' else 'FALTAN eventos (' || g.eventos_txt || ')' end,
           case when p.prosecdef then 'función SECURITY DEFINER (vería siempre al dueño: NO sirve)' else 'función INVOKER' end)
    end,
    case when t.oid is null then 'Esperado antes de la fase C.'
         when t.tgenabled in ('O', 'A') and (t.tgtype & 1) = 1 and (t.tgtype & 2) = 2 and (t.tgtype & g.eventos) = g.eventos and not p.prosecdef
           then 'Bien formada no significa que rechace: confirmar con el BLOQUE C.'
         else 'Mal formada: corregirla; el BLOQUE C mostrará que no rechaza.' end
  from (values ('sillas', 'sillas_guarda_escritura', 16, 'UPDATE'),
               ('bloqueos_vuelo', 'bloqueos_guarda_cupos', 4 + 16, 'INSERT y UPDATE')) as g(tabla, nombre, eventos, eventos_txt)
  left join pg_trigger t on t.tgrelid = to_regclass('public.' || g.tabla) and t.tgname = g.nombre and not t.tgisinternal
  left join pg_proc p on p.oid = t.tgfoid
  union all
  select '1-rls', 'trigger de inmutabilidad del historial', 'INFO',
    case when exists (select 1 from pg_trigger t where t.tgrelid = 'public.movimientos_silla'::regclass
                        and not t.tgisinternal and t.tgname <> 'trg_auditoria') then 'hay otros triggers (revisar)' else 'ausente' end,
    'Esperado hoy: ausente. Lo agrega la migración de cierre.'
  union all
  select '1-rls', 'privilegios de tabla (authenticated / anon)', 'INFO',
    format('sillas: auth[S=%s U=%s D=%s] anon[S=%s] · movimientos: auth[I=%s U=%s D=%s] anon[S=%s]',
      has_table_privilege('authenticated', 'public.sillas', 'SELECT'),
      has_table_privilege('authenticated', 'public.sillas', 'UPDATE'),
      has_table_privilege('authenticated', 'public.sillas', 'DELETE'),
      has_table_privilege('anon', 'public.sillas', 'SELECT'),
      has_table_privilege('authenticated', 'public.movimientos_silla', 'INSERT'),
      has_table_privilege('authenticated', 'public.movimientos_silla', 'UPDATE'),
      has_table_privilege('authenticated', 'public.movimientos_silla', 'DELETE'),
      has_table_privilege('anon', 'public.movimientos_silla', 'SELECT')),
    'Con RLS activa, el privilegio de tabla no basta: manda la policy.'
  union all
  select '1-rls', 'vista cupos_por_bloqueo con security_invoker',
    case when exists (select 1 from pg_class where oid = to_regclass('public.cupos_por_bloqueo')
                        and coalesce(array_to_string(reloptions, ','), '') ilike '%security_invoker=true%')
         then 'OK' else 'REVISAR' end,
    null, 'Migración 186. Si no, la vista lee sillas saltándose la RLS.'
  union all
  select '1-rls', 'funciones SECURITY DEFINER que tocan sillas', 'INFO', count(*)::text,
    string_agg(p.proname, ', ' order by p.proname)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef and p.prosrc ~* '\msillas\M'
  union all
  select '1-rls', 'triggers en sillas / movimientos_silla', 'INFO', count(*)::text,
    string_agg(c.relname || '.' || t.tgname, ', ' order by c.relname, t.tgname)
  from pg_trigger t join pg_class c on c.oid = t.tgrelid
  where not t.tgisinternal and c.relname in ('sillas', 'movimientos_silla')
  union all
  select '1-rls', 'FK movimientos_silla / sillas (acción al borrar)', 'INFO', count(*)::text,
    string_agg(format('%s.%s→%s on delete %s', c.conrelid::regclass, c.conname, c.confrelid::regclass,
      case c.confdeltype when 'a' then 'no action' when 'r' then 'restrict' when 'c' then 'cascade'
        when 'n' then 'set null' when 'd' then 'set default' end), ' || ')
  from pg_constraint c
  where c.contype = 'f' and c.conrelid in ('public.movimientos_silla'::regclass, 'public.sillas'::regclass)
  union all
  select '1-rls', 'índice único completo (bloqueo_id, numero_silla)',
    case when exists (
      select 1 from pg_index i
      where i.indrelid = 'public.sillas'::regclass and i.indisunique
        and i.indpred is null and i.indexprs is null and i.indnkeyatts = 2
        and (select array_agg(a.attname::text order by a.attname) from pg_attribute a
             where a.attrelid = i.indrelid and a.attnum = any(i.indkey)) = array['bloqueo_id', 'numero_silla']
    ) then 'OK' else 'REVISAR' end,
    null, 'Esperado hoy: ausente. Un índice parcial (con WHERE) o sobre expresiones NO cuenta: cubriría otro conjunto que la comprobación de duplicados.'

  -- ── 2. Legado cambio / cambio_entrante ───────────────────────────────────
  union all
  select '2-legado', 'sillas por estado', 'INFO',
    string_agg(e || '=' || n, ', ' order by e), null
  from (select estado::text as e, count(*) as n from s group by estado) x
  union all
  select '2-legado', 'records con filas en estado cambio',
    case when count(*) > 0 then 'REVISAR' else 'OK' end, count(*)::text,
    'Muestra: ' || coalesce(string_agg(record, ', ') filter (where rn <= 10), '—')
      || ' · hoy estas filas cuentan en el total de lib/vuelos/stats.ts'
  from (select pb.record, row_number() over (order by pb.id) as rn
        from por_bloqueo pb where pb.filas > pb.filas_activas) x
  union all
  select '2-legado', 'filas cambio con contrato, manual o pasajero',
    case when count(*) = 0 then 'OK' else 'REVISAR' end, count(*)::text,
    'Una silla que salió a otro record no debería conservar dueño.'
  from s where es_legado_cambio
    and (numero_contrato is not null or contrato_manual is not null or pasajero_nombres is not null or numero_doc is not null)
  union all
  select '2-legado', 'filas cambio_entrante (libres / ocupadas)', 'INFO',
    format('libres=%s ocupadas=%s', count(*) filter (where libre_real), count(*) filter (where not libre_real)),
    'Son sillas reales del destino; hoy se venden como disponibles.'
  from s where estado::text = 'cambio_entrante'
  union all
  select '2-legado', 'movimientos sin autor (registrado_por null)', 'INFO',
    format('%s de %s', count(*) filter (where registrado_por is null), count(*)), 'cambiarSillas/moverPasajeroSilla no lo llenan.'
  from m
  union all
  select '2-legado', 'movimientos con origen = destino o extremos nulos',
    case when count(*) = 0 then 'OK' else 'REVISAR' end, count(*)::text, null
  from m where bloqueo_origen_id is null or bloqueo_destino_id is null or bloqueo_origen_id = bloqueo_destino_id
  union all
  -- moverPasajeroSilla deja la silla de origen 'disponible' (no 'cambio') y
  -- CREA una silla nueva en el destino sin tocar cupos_total.
  select '2-legado', 'movimientos de mover pasajero (motivo fijo de la app)',
    case when count(*) = 0 then 'OK' else 'REVISAR' end, count(*)::text,
    'Cada uno creó una silla extra en el destino sin descontarla del origen.'
  from m where motivo = 'Cambio de pasajero a otro record'
  union all
  select '2-legado', 'movimientos cuya silla ya no está en cambio', 'INFO', count(*)::text,
    'Mover pasajero o cambios manuales posteriores: el historial no permite reconstruir el estado.'
  from m join s on s.id = m.silla_id where not s.es_legado_cambio
  union all
  select '2-legado', 'records destino: entradas registradas vs filas cambio_entrante',
    case when count(*) filter (where entradas <> entrantes) = 0 then 'OK' else 'REVISAR' end,
    format('%s records con diferencia', count(*) filter (where entradas <> entrantes)),
    'Diferencia esperable si se vendieron/cambiaron cambio_entrante después; confirmar a mano los casos.'
  from (
    select b.id,
      (select count(*) from m where m.bloqueo_destino_id = b.id and coalesce(m.motivo, '') <> 'Cambio de pasajero a otro record') as entradas,
      (select count(*) from s where s.bloqueo_id = b.id and s.estado::text = 'cambio_entrante') as entrantes
    from b
  ) x

  -- ── 3. Consistencia de cupos (I1) ────────────────────────────────────────
  union all
  select '3-cupos', 'suma global', 'INFO',
    format('cupos_total=%s · filas_activas=%s · filas_todas=%s',
      sum(cupos_total), sum(filas_activas), sum(filas)), 'cupos_total y filas_activas deben coincidir; filas_todas incluye cambio/retirada.'
  from por_bloqueo
  union all
  select '3-cupos', 'records con cupos_total ≠ filas activas (sin cambio ni retirada)',
    case when count(*) = 0 then 'OK' else 'REVISAR' end, count(*)::text,
    'Muestra: ' || coalesce(string_agg(format('%s(%s≠%s)', record, cupos_total, filas_activas), ', ') filter (where rn <= 10), '—')
  from (select *, row_number() over (order by id) as rn from por_bloqueo where coalesce(cupos_total, 0) <> filas_activas) x
  union all
  -- MISMO conjunto que el índice propuesto: todas las filas de public.sillas,
  -- cualquier estado (cambio y retirada incluidos), numero_silla no nulo.
  -- Si esto no es 0, crear el índice fallaría.
  select '3-cupos', 'numero_silla repetido dentro de un record (todas las filas, = índice)',
    case when count(*) = 0 then 'OK' else 'REVISAR' end, count(*)::text,
    format('Grupos repetidos con al menos una fila cambio/retirada: %s (la comprobación anterior, solo filas activas, no los veía). Muestra: %s',
      count(*) filter (where con_inactiva),
      coalesce(string_agg(format('bloqueo %s silla %s ×%s', bloqueo_id, numero_silla, n), ', ') filter (where rn <= 10), '—'))
  from (
    select d.bloqueo_id, d.numero_silla, count(*) as n,
           bool_or(d.estado::text in ('cambio', 'retirada')) as con_inactiva,
           row_number() over (order by d.bloqueo_id, d.numero_silla) as rn
    from public.sillas d
    where d.numero_silla is not null
    group by d.bloqueo_id, d.numero_silla
    having count(*) > 1
  ) x
  union all
  select '3-cupos', 'sillas sin numero_silla', case when count(*) = 0 then 'OK' else 'REVISAR' end, count(*)::text, null
  from s where numero_silla is null

  -- ── 4. Sillas libres reales y residuos (I6, modo A) ──────────────────────
  union all
  select '4-libres', 'libre por estado pero con contrato_manual',
    case when count(*) = 0 then 'OK' else 'REVISAR' end, count(*)::text,
    'Si una reserva la toma, choca con el CHECK sillas_contrato_unico y la transacción entera falla.'
  from s where estado::text in ('disponible', 'cambio_entrante') and contrato_manual is not null
  union all
  select '4-libres', 'libre por estado pero con numero_contrato',
    case when count(*) = 0 then 'OK' else 'REVISAR' end, count(*)::text, null
  from s where estado::text in ('disponible', 'cambio_entrante') and numero_contrato is not null
  union all
  select '4-libres', 'libre por estado con datos de pasajero y sin contrato', 'INFO', count(*)::text,
    'Carga masiva o residuo de liberarVencidas. Hoy la reserva puede asignarlas; el diseño NO las cuenta como libres.'
  from s where estado::text in ('disponible', 'cambio_entrante') and numero_contrato is null and contrato_manual is null
    and (pasajero_nombres is not null or pasajero_apellidos is not null or numero_doc is not null)
  union all
  select '4-libres', 'ocupada (en_plazo/confirmada) sin contrato ni manual',
    case when count(*) = 0 then 'OK' else 'REVISAR' end, count(*)::text, 'Silla ocupada sin dueño: ¿se puede mover?'
  from s where estado::text in ('en_plazo', 'confirmada') and numero_contrato is null and contrato_manual is null
  union all
  select '4-libres', 'records activos (ida ≥ hoy): con/sin cupo libre real', 'INFO',
    format('con libres=%s · sin libres=%s',
      count(*) filter (where pb.libres_reales > 0), count(*) filter (where pb.libres_reales = 0)),
    'Records donde el modo A ("usar cupo disponible en X") sería imposible hoy.'
  from por_bloqueo pb join b on b.id = pb.id where b.fecha_ida >= current_date

  -- ── 5. Contratos repartidos y trazabilidad (I4, I7) ──────────────────────
  union all
  select '5-contratos', 'contratos con sillas en más de un record',
    case when count(*) = 0 then 'OK' else 'REVISAR' end, count(*)::text,
    'Muestra: ' || coalesce(string_agg(numero_contrato, ', ') filter (where rn <= 10), '—')
  from (select numero_contrato, row_number() over (order by numero_contrato) as rn
        from contrato_bloqueos where n_bloqueos > 1) x
  union all
  select '5-contratos', 'contratos manuales en más de un record',
    case when count(*) = 0 then 'OK' else 'REVISAR' end, count(*)::text, null
  from manual_bloqueos where n_bloqueos > 1
  union all
  select '5-contratos', 'ventas.bloqueo_ref_id no coincide con el record de sus sillas',
    case when count(*) = 0 then 'OK' else 'REVISAR' end, count(*)::text,
    'La reconciliación de pasajeros (167) usaría el record equivocado. Muestra: '
      || coalesce(string_agg(numero_contrato, ', ') filter (where rn <= 10), '—')
  from (
    select v.numero_contrato, row_number() over (order by v.numero_contrato) as rn
    from public.ventas v
    where v.bloqueo_ref_id is not null
      and exists (select 1 from s where s.numero_contrato = v.numero_contrato and not s.es_legado_cambio)
      and not exists (select 1 from s where s.numero_contrato = v.numero_contrato and s.bloqueo_id = v.bloqueo_ref_id and not s.es_legado_cambio)
  ) x
  union all
  select '5-contratos', 'contratos con sillas y sin bloqueo_ref_id', 'INFO', count(*)::text,
    'Contratos anteriores al estampado del vínculo; la 167 los descubre por la silla.'
  from public.ventas v
  where v.bloqueo_ref_id is null and exists (select 1 from s where s.numero_contrato = v.numero_contrato and not s.es_legado_cambio)
  union all
  select '5-contratos', 'contrato_vuelos.record distinto del record de sus sillas',
    case when count(*) = 0 then 'OK' else 'REVISAR' end, count(*)::text,
    'El contrato/voucher mostraría un PNR donde el pasajero ya no está.'
  from (
    select distinct cv.numero_contrato
    from public.contrato_vuelos cv
    where cv.record is not null
      and exists (select 1 from s where s.numero_contrato = cv.numero_contrato and not s.es_legado_cambio)
      and not exists (
        select 1 from s join b on b.id = s.bloqueo_id
        where s.numero_contrato = cv.numero_contrato and not s.es_legado_cambio
          and upper(trim(b.record)) = upper(trim(cv.record)))
  ) x

  -- ── 5b. contrato_manual: externo, interno único o ambiguo (AUT-2) ───────
  union all
  select '5b-manual', 'referencias manuales distintas por clase', 'INFO',
    format('externas=%s · internas mayorista=%s · internas minorista=%s · ambiguas=%s · no admitidas=%s',
      count(*) filter (where not no_admitida and n_exactos = 0),
      count(*) filter (where not no_admitida and n_exactos = 1 and tenant_si_unico = 'mayorista'),
      count(*) filter (where not no_admitida and n_exactos = 1 and tenant_si_unico = 'minorista'),
      count(*) filter (where not no_admitida and n_exactos >= 2),
      count(*) filter (where no_admitida)),
    'Interna = la referencia casa con UNA venta real. Mover una silla interna exige permiso sobre el contrato de ESA agencia.'
  from manual_clas
  union all
  select '5b-manual', 'referencias manuales ambiguas (varias ventas candidatas)',
    case when count(*) = 0 then 'OK' else 'REVISAR' end, count(*)::text,
    'Mover estas sillas fallará cerrado hasta corregir la referencia. Muestra: '
      || coalesce(string_agg(ref, ', ') filter (where rn <= 10), '—')
  from (select ref, row_number() over (order by ref) as rn from manual_clas where not no_admitida and n_exactos >= 2) x
  union all
  select '5b-manual', 'referencias no admitidas (espacio no ASCII o carácter de control dentro)',
    case when count(*) = 0 then 'OK' else 'REVISAR' end, count(*)::text,
    'Fallan cerrado al mover (ni externas ni internas) hasta corregir el texto. Se muestran con los caracteres invisibles escapados: '
      || coalesce(string_agg(regexp_replace(ref, '[^\u0021-\u007e]', '·', 'g'), ', ') filter (where rn <= 10), '—')
  from (select ref, row_number() over (order by ref) as rn from manual_clas where no_admitida) x
  union all
  select '5b-manual', 'contrato_manual vacío tras recortar (solo espacios/saltos)',
    case when count(*) = 0 then 'OK' else 'REVISAR' end, count(*)::text,
    'La app lo trata como ausente; el diseño no cuenta esa silla como libre real (contrato_manual no es null) hasta limpiarlo.'
  from manual_norm where ref = ''
  union all
  select '5b-manual', 'externas que casarían ignorando mayúsculas',
    case when count(*) = 0 then 'OK' else 'REVISAR' end, count(*)::text,
    'Hoy se tratan como externas (comparación exacta, igual que la app). Posible venta interna mal escrita: decidir antes de migrar.'
  from manual_clas where not no_admitida and n_exactos = 0 and n_sin_mayusculas > 0
  union all
  select '5b-manual', 'sillas con contrato_manual con espacios al inicio/final (incl. tab, salto, NBSP, BOM)', 'INFO', coalesce(sum(con_espacios), 0)::text,
    'Se resuelven recortando exactamente como trim() de la app; no bloquean.'
  from manual_clas

  -- ── 6. Compatibilidad entre records en los movimientos históricos (D4) ───
  union all
  select '6-compatibilidad', 'movimientos por diferencia entre origen y destino', 'INFO',
    format('total=%s · destino_id=%s · ruta=%s · fecha_ida=%s · fecha_regreso=%s · aerolinea=%s · proveedor=%s · tarifa_neta=%s',
      count(*),
      count(*) filter (where o_dest is distinct from d_dest),
      count(*) filter (where o_ruta is distinct from d_ruta),
      count(*) filter (where o_ida is distinct from d_ida),
      count(*) filter (where o_reg is distinct from d_reg),
      count(*) filter (where upper(trim(coalesce(o_aer, ''))) is distinct from upper(trim(coalesce(d_aer, '')))),
      count(*) filter (where o_prov is distinct from d_prov),
      count(*) filter (where o_tn is distinct from d_tn)),
    'Cómo se ha usado el traslado en la práctica: qué reglas de compatibilidad romperían casos reales.'
  from mov_pares
  union all
  select '6-compatibilidad', 'movimientos hacia un record ya salido', 'INFO', count(*)::text, null
  from mov_pares where d_ida < fecha_movimiento::date
  union all
  select '6-compatibilidad', 'records activos que comparten destino y fecha de ida con otro', 'INFO', count(*)::text,
    'Candidatos naturales de traslado entre sí.'
  from (select destino_id, fecha_ida from b where fecha_ida >= current_date and destino_id is not null
        group by destino_id, fecha_ida having count(*) > 1) x
)
select * from reporte order by seccion, control;


-- ═══ BLOQUE B (OPCIONAL) · lectura EFECTIVA como rol venta ═════════════════
-- Ejecutar APARTE, en psql (psql -f o pegando el bloque sin los "-- ").
-- Se hace pasar por el primer usuario ACTIVO con rol venta, solo dentro de
-- la transacción, y cuenta cuántas sillas y movimientos ve. Solo conteos.
-- READ ONLY + ROLLBACK: no persiste nada, ni el cambio de rol ni los ajustes.
-- En el editor de Supabase el resultado visible puede ser el del ROLLBACK;
-- si es así, usar psql.
--
-- Veredicto (única fuente de OK sobre acceso de este preflight):
--   · SIN_PRUEBA si no hay usuario venta activo (mi_rol() no resulta 'venta')
--     o si la tabla está vacía: un 0 visible no demostraría nada.
--   · REVISAR si ve al menos una fila.
--   · OK solo si mi_rol() = 'venta', la tabla tiene filas y no ve ninguna.
--     Vale para ESE usuario: una policy que dependa de atributos del usuario
--     (agencia, asesor) puede comportarse distinto con otro.
--
-- begin transaction read only;
-- select set_config('preflight.total_sillas', (select count(*)::text from public.sillas), true),
--        set_config('preflight.total_movimientos', (select count(*)::text from public.movimientos_silla), true),
--        set_config('request.jwt.claims', coalesce(
--          (select json_build_object('sub', id::text, 'role', 'authenticated')::text
--             from public.usuarios where rol = 'venta' and activo order by id limit 1), '{}'), true);
-- set local role authenticated;
-- with x as (
--   select public.mi_rol()::text as rol_efectivo,
--          current_setting('preflight.total_sillas')::bigint as sillas_total,
--          (select count(*) from public.sillas) as sillas_visibles,
--          (select count(*) from public.sillas where numero_doc is not null) as con_documento,
--          current_setting('preflight.total_movimientos')::bigint as movimientos_total,
--          (select count(*) from public.movimientos_silla) as movimientos_visibles
-- )
-- select x.*,
--   case when rol_efectivo is distinct from 'venta' then 'SIN_PRUEBA: no hay usuario venta activo que suplantar'
--        when sillas_total = 0 then 'SIN_PRUEBA: sillas vacía'
--        when sillas_visibles > 0 then 'REVISAR: venta lee sillas (efectivo)'
--        else 'OK: venta no lee sillas (efectivo, para este usuario)' end as veredicto_sillas,
--   case when rol_efectivo is distinct from 'venta' then 'SIN_PRUEBA: no hay usuario venta activo que suplantar'
--        when movimientos_total = 0 then 'SIN_PRUEBA: movimientos_silla vacía'
--        when movimientos_visibles > 0 then 'REVISAR: venta lee el historial (efectivo)'
--        else 'OK: venta no lee el historial (efectivo, para este usuario)' end as veredicto_movimientos
-- from x;
-- rollback;

-- ═══ BLOQUE C (OPCIONAL) · rechazo EFECTIVO de escritura directa ════════════
-- ⚠️ NO ES DE SOLO LECTURA. Intenta, como un usuario REAL de vuelos, cada
-- escritura directa que el diseño prohíbe (§6.5), incluida la edición de
-- datos de una silla CON contrato (DIR-2), más dos escrituras que deben
-- seguir permitidas (grupo D en una silla SIN contrato y una columna libre
-- del record). Cada intento corre en su propia subtransacción y se
-- revierte al instante —con éxito o con error—, y el bloque entero termina
-- en ROLLBACK: no persiste ningún dato. Efectos que SÍ quedan: huecos en las
-- secuencias de id de sillas/bloqueos_vuelo (los INSERT consumen un valor)
-- y bloqueos de fila de unos milisegundos sobre las filas usadas.
-- Ejecutar primero en LOCAL; en Producción solo con aprobación explícita.
-- Pensado para psql (el editor de Supabase puede mostrar solo el ROLLBACK).
--
-- Usuario suplantado: el primer usuario ACTIVO de mayorista con rol de
-- escritura de vuelos (control_vuelo, luego operaciones, administracion,
-- gerencia). Si no hay ninguno o faltan filas objetivo → SIN_PRUEBA.
--
-- Veredicto por caso:
--   · prohibido + rechazado con 42501 y mensaje de guarda ('GUARDA_ESCRITURA')
--     o de privilegio ('permission denied for table') → OK
--   · prohibido + la escritura prosperó → REVISAR
--   · prohibido + 0 filas o rechazo por RLS/otro error → INDETERMINADO (el
--     rechazo no vino de la guarda: no prueba nada)
--   · permitido (grupo D / columnas libres) + prosperó → OK; si no → REVISAR
--
-- begin;
-- create temp table prueba_guardas (orden int, caso text, esperado text, resultado text, detalle text);
-- grant insert, select on prueba_guardas to authenticated;
-- -- Objetivos y usuario, leídos ANTES de suplantar (como el dueño).
-- select set_config('pf.usuario', coalesce((select id::text from public.usuarios
--          where activo and tenant = 'mayorista' and rol in ('control_vuelo', 'operaciones', 'administracion', 'gerencia')
--          order by array_position(array['control_vuelo', 'operaciones', 'administracion', 'gerencia']::text[], rol::text), id limit 1), ''), true),
--        set_config('pf.silla_libre', coalesce((select s.id::text from public.sillas s
--          where s.estado::text in ('disponible', 'cambio_entrante') and s.numero_contrato is null and s.contrato_manual is null
--            and s.pasajero_nombres is null and s.numero_doc is null
--            and not exists (select 1 from public.movimientos_silla m where m.silla_id = s.id)
--          order by s.id limit 1), ''), true),
--        set_config('pf.silla_contrato', coalesce((select id::text from public.sillas where numero_contrato is not null order by id limit 1), ''), true);
-- select set_config('pf.bloqueo', coalesce((select bloqueo_id::text from public.sillas where id::text = current_setting('pf.silla_libre')), ''), true);
-- select set_config('pf.bloqueo_otro', coalesce((select id::text from public.bloqueos_vuelo where id::text <> current_setting('pf.bloqueo') order by id limit 1), ''), true),
--        set_config('pf.max_num', coalesce((select max(numero_silla)::text from public.sillas where bloqueo_id::text = current_setting('pf.bloqueo')), '0'), true),
--        set_config('request.jwt.claims', case when current_setting('pf.usuario') = '' then '{}'
--          else json_build_object('sub', current_setting('pf.usuario'), 'role', 'authenticated')::text end, true);
-- set local role authenticated;
-- do $$
-- declare
--   v_libre   bigint := nullif(current_setting('pf.silla_libre'), '')::bigint;
--   v_contr   bigint := nullif(current_setting('pf.silla_contrato'), '')::bigint;
--   v_bloq    bigint := nullif(current_setting('pf.bloqueo'), '')::bigint;
--   v_otro    bigint := nullif(current_setting('pf.bloqueo_otro'), '')::bigint;
--   v_max     int    := current_setting('pf.max_num')::int;
--   v_rol     text   := public.mi_rol()::text;
--   c record; v_n bigint; v_res text; v_det text;
-- begin
--   for c in select * from (values
--     (1, 'UPDATE sillas.numero_contrato',  'prohibido', 'update public.sillas set numero_contrato = null, estado = ''disponible'' where id = $1', v_contr),
--     (2, 'UPDATE sillas.contrato_manual',  'prohibido', 'update public.sillas set contrato_manual = ''PRUEBA-GUARDA'' where id = $1', v_libre),
--     (3, 'UPDATE sillas.estado',           'prohibido', 'update public.sillas set estado = ''no_vendida'' where id = $1', v_libre),
--     (4, 'UPDATE sillas.bloqueo_id',       'prohibido', format('update public.sillas set bloqueo_id = %s where id = $1', coalesce(v_otro, 0)), case when v_otro is null then null else v_libre end),
--     (5, 'UPDATE sillas.numero_silla',     'prohibido', format('update public.sillas set numero_silla = %s where id = $1', v_max + 100000), v_libre),
--     (6, 'INSERT en sillas',               'prohibido', format('insert into public.sillas (bloqueo_id, numero_silla, estado) select %s, %s, ''disponible'' where $1 is not null', coalesce(v_bloq, 0), v_max + 100001), v_bloq),
--     (7, 'DELETE en sillas',               'prohibido', 'delete from public.sillas where id = $1', v_libre),
--     (8, 'UPDATE bloqueos_vuelo.cupos_total', 'prohibido', 'update public.bloqueos_vuelo set cupos_total = cupos_total + 1 where id = $1', v_bloq),
--     (9, 'INSERT bloqueos_vuelo con cupos_total > 0', 'prohibido', 'insert into public.bloqueos_vuelo (record, cupos_total) select ''PRUEBA-GUARDA-'' || $1, 1 where $1 is not null', v_bloq),
--     (10, 'UPDATE sillas.updated_at (grupo D)', 'permitido', 'update public.sillas set updated_at = now() where id = $1', v_libre),
--     (11, 'UPDATE bloqueos_vuelo.notas (columna libre)', 'permitido', 'update public.bloqueos_vuelo set notas = coalesce(notas, '''') where id = $1', v_bloq),
--     -- DIR-2 aprobada: los datos (grupo D) de una silla CON contrato solo se editan por función.
--     (12, 'UPDATE datos (grupo D) en silla con contrato', 'prohibido', 'update public.sillas set updated_at = now() where id = $1', v_contr)
--   ) as t(orden, caso, esperado, sentencia, objetivo)
--   loop
--     if v_rol is null or c.objetivo is null then
--       insert into prueba_guardas values (c.orden, c.caso, c.esperado, 'SIN_PRUEBA',
--         case when v_rol is null then 'sin usuario de vuelos activo de mayorista que suplantar' else 'sin fila objetivo en esta base' end);
--       continue;
--     end if;
--     begin
--       execute c.sentencia using c.objetivo;
--       get diagnostics v_n = row_count;
--       raise exception using errcode = 'P0099', message = v_n::text;   -- revierte SIEMPRE el intento
--     exception when others then
--       if sqlstate = 'P0099' then
--         v_res := case when sqlerrm::bigint > 0 then 'PROSPERÓ' else 'SIN_EFECTO' end;
--         v_det := sqlerrm || ' fila(s)';
--       elsif sqlstate = '42501' and (sqlerrm like 'GUARDA_ESCRITURA%' or sqlerrm like 'permission denied for table%') then
--         v_res := 'RECHAZADA'; v_det := sqlerrm;
--       else
--         v_res := 'OTRO'; v_det := sqlstate || ': ' || sqlerrm;
--       end if;
--     end;
--     insert into prueba_guardas values (c.orden, c.caso, c.esperado, v_res, v_det);
--   end loop;
-- end $$;
-- reset role;
-- select orden, caso, esperado, resultado,
--        case when resultado = 'SIN_PRUEBA' then 'SIN_PRUEBA'
--             when esperado = 'prohibido' and resultado = 'RECHAZADA' then 'OK'
--             when esperado = 'prohibido' and resultado = 'PROSPERÓ' then 'REVISAR'
--             when esperado = 'prohibido' then 'INDETERMINADO'
--             when esperado = 'permitido' and resultado = 'PROSPERÓ' then 'OK'
--             else 'REVISAR' end as veredicto,
--        detalle
-- from prueba_guardas order by orden;
-- rollback;
