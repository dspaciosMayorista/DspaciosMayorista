-- ───────────────────────────────────────────────────────────────────────────
-- POSTCHECK · migración 202 (CRM leads) — SOLO LECTURA.
--
-- Corre DESPUÉS de aplicar la 202. Cada fila debe salir con ok = true.
-- No escribe nada y no depende de que haya leads cargados.
-- ───────────────────────────────────────────────────────────────────────────
-- Tablas y RLS ----------------------------------------------------------------
select 'las dos tablas existen' as chequeo,
  to_regclass('public.crm_leads') is not null
  and to_regclass('public.crm_lead_actividades') is not null as ok
union all
select 'RLS activa en ambas',
  coalesce((select bool_and(relrowsecurity) from pg_class
             where oid in (to_regclass('public.crm_leads'), to_regclass('public.crm_lead_actividades'))), false)
union all
select 'ninguna policy abierta a public',
  not exists (select 1 from pg_policies
               where schemaname = 'public'
                 and tablename in ('crm_leads', 'crm_lead_actividades')
                 and roles::text = '{public}')
union all
select 'no hay policy de DELETE (el borrado fisico esta prohibido)',
  not exists (select 1 from pg_policies
               where schemaname = 'public'
                 and tablename in ('crm_leads', 'crm_lead_actividades')
                 and cmd = 'DELETE')
union all
-- Alcance de la auditoría genérica: SOLO las dos tablas de esta migración.
select 'trg_auditoria en las DOS tablas del CRM',
  (select count(*) from pg_trigger
    where not tgisinternal and tgname = 'trg_auditoria'
      and tgrelid in (to_regclass('public.crm_leads'), to_regclass('public.crm_lead_actividades'))) = 2
union all
-- Este es el cruce con la 203: sus historiales son inmutables y auditarlos
-- duplicaría cada versión en `auditoria`.
select 'los historiales de la 203 siguen SIN triggers propios',
  not exists (select 1 from pg_trigger
               where not tgisinternal
                 and tgrelid in ('public.tarifa_hotel_historial'::regclass, 'public.hotel_temporadas_historial'::regclass))
union all
-- Triggers propios de la 202 -----------------------------------------------------
select 'lead bloquea delete y cambio de tenant',
  (select count(*) from pg_trigger where not tgisinternal
     and tgrelid = 'public.crm_leads'::regclass
     and tgname in ('trg_crm_leads_bloquear_delete', 'trg_crm_leads_bloquear_cambio_tenant')) = 2
union all
select 'bitacora append-only (update y delete)',
  (select count(*) from pg_trigger where not tgisinternal
     and tgrelid = 'public.crm_lead_actividades'::regclass
     and tgname in ('trg_crm_lead_actividades_append_only_update', 'trg_crm_lead_actividades_append_only_delete')) = 2
union all
-- Funciones de negocio -----------------------------------------------------------
select 'las cinco funciones de escritura existen',
  to_regprocedure('public.crm_lead_crear(jsonb)') is not null
  and to_regprocedure('public.crm_lead_actualizar(bigint, jsonb)') is not null
  and to_regprocedure('public.crm_lead_tomar(bigint)') is not null
  and to_regprocedure('public.crm_lead_cambiar_etapa(bigint, text)') is not null
  and to_regprocedure('public.crm_lead_registrar_actividad(bigint, text, text, timestamptz)') is not null
union all
-- Las RPC de escritura son SECURITY DEFINER porque `authenticated` ya no tiene
-- INSERT/UPDATE/DELETE sobre las tablas: son la ÚNICA vía de escritura y no
-- pueden apoyarse en la RLS. La contrapartida es que cada una valida al actor
-- por su cuenta; eso se comprueba en las filas siguientes.
select 'las funciones de escritura son SECURITY DEFINER (son la unica via de escritura)',
  coalesce((select bool_and(prosecdef) from pg_proc
             where oid in (
               to_regprocedure('public.crm_lead_crear(jsonb)'),
               to_regprocedure('public.crm_lead_actualizar(bigint, jsonb)'),
               to_regprocedure('public.crm_lead_tomar(bigint)'),
               to_regprocedure('public.crm_lead_cambiar_etapa(bigint, text)'),
               to_regprocedure('public.crm_lead_registrar_actividad(bigint, text, text, timestamptz)'))), false)
union all
select 'cada RPC de escritura fija su search_path (sin pg_temp por delante)',
  coalesce((select bool_and(proconfig::text like '%search_path=%public, pg_temp%') from pg_proc
             where oid in (
               to_regprocedure('public.crm_lead_crear(jsonb)'),
               to_regprocedure('public.crm_lead_actualizar(bigint, jsonb)'),
               to_regprocedure('public.crm_lead_tomar(bigint)'),
               to_regprocedure('public.crm_lead_cambiar_etapa(bigint, text)'),
               to_regprocedure('public.crm_lead_registrar_actividad(bigint, text, text, timestamptz)'))), false)
union all
-- Sin esto, un `authenticated` podria editar un lead sin dejar actividad y
-- escribir en la bitacora con un actor_email inventado.
select 'authenticated SOLO lee: sin INSERT/UPDATE/DELETE en las dos tablas',
  has_table_privilege('authenticated', 'public.crm_leads', 'SELECT')
  and not has_table_privilege('authenticated', 'public.crm_leads', 'INSERT')
  and not has_table_privilege('authenticated', 'public.crm_leads', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.crm_leads', 'DELETE')
  and has_table_privilege('authenticated', 'public.crm_lead_actividades', 'SELECT')
  and not has_table_privilege('authenticated', 'public.crm_lead_actividades', 'INSERT')
  and not has_table_privilege('authenticated', 'public.crm_lead_actividades', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.crm_lead_actividades', 'DELETE')
union all
select 'authenticated no usa las secuencias (solo las RPC las necesitan)',
  not has_sequence_privilege('authenticated', 'public.crm_leads_id_seq', 'USAGE')
  and not has_sequence_privilege('authenticated', 'public.crm_leads_id_seq', 'SELECT')
  and not has_sequence_privilege('authenticated', 'public.crm_lead_actividades_id_seq', 'USAGE')
union all
-- Solo lectura: si alguien restituyera por error los privilegios de escritura,
-- la ausencia de policy lo denegaria en vez de dejarlo pasar.
select 'las unicas policies son de SELECT',
  (select count(*) = 2 from pg_policies
    where schemaname = 'public'
      and tablename in ('crm_leads', 'crm_lead_actividades')
      and cmd = 'SELECT')
  and not exists (select 1 from pg_policies
                   where schemaname = 'public'
                     and tablename in ('crm_leads', 'crm_lead_actividades')
                     and cmd <> 'SELECT')
union all
-- Helpers internos: solo se ejecutan desde dentro de las RPC (que corren como el
-- propietario). Si `authenticated` pudiera llamarlos, `crm_lead_email_de`
-- serviria para sacar el correo de cualquier usuario de cualquier agencia.
select 'los helpers internos NO son ejecutables por authenticated',
  not has_function_privilege('authenticated', 'public.crm_lead_actor()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.crm_lead_email_de(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.crm_lead_responsable_valido(uuid, text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.crm_lead_permite_ver(text, uuid, uuid, text, text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.crm_lead_permite_crear(text, uuid, uuid, text, text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.crm_lead_permite_cambiar_responsable(text, uuid, uuid, uuid, text, text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.crm_lead_duplicado_id(text, text, text, bigint, uuid, text, text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.crm_lead_coincidencias(text, text, text, text, text, bigint, uuid, text, text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.crm_lead_tipo_doc_validado(text, text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.crm_lead_normalizar_tipo_doc(text)', 'EXECUTE')
union all
-- La excepción anterior lo exigía: la función que devolvía el correo de otro
-- tenant ya no existe con esa firma.
select 'crm_lead_responsable_email(uuid) ya no existe',
  to_regprocedure('public.crm_lead_responsable_email(uuid)') is null
union all
-- Único helper con EXECUTE para `authenticated`: lo necesitan las policies de
-- lectura y no toma datos de la fila más allá de lo que la fila ya expone.
select 'crm_lead_puede_ver si se ejecuta (solo lo usan las policies de lectura)',
  has_function_privilege('authenticated', 'public.crm_lead_puede_ver(text, uuid)', 'EXECUTE')
union all
-- Ni los normalizadores ni las de trigger tienen por qué ser ejecutables desde
-- fuera: `anon` no ve nada de este módulo.
select 'ninguna funcion crm_lead* es ejecutable por anon',
  not exists (
    select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname like 'crm_lead%'
       and has_function_privilege('anon', p.oid, 'EXECUTE')
  )
union all
select 'authenticated ejecuta las cinco RPC; anon no',
  has_function_privilege('authenticated', 'public.crm_lead_crear(jsonb)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.crm_lead_tomar(bigint)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.crm_lead_registrar_actividad(bigint, text, text, timestamptz)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.crm_lead_crear(jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.crm_lead_tomar(bigint)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.crm_lead_actualizar(bigint, jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.crm_lead_cambiar_etapa(bigint, text)', 'EXECUTE')
union all
select 'anon sin lectura ni escritura de las dos tablas',
  not has_table_privilege('anon', 'public.crm_leads', 'SELECT')
  and not has_table_privilege('anon', 'public.crm_leads', 'INSERT')
  and not has_table_privilege('anon', 'public.crm_leads', 'UPDATE')
  and not has_table_privilege('anon', 'public.crm_leads', 'DELETE')
  and not has_table_privilege('anon', 'public.crm_lead_actividades', 'SELECT')
  and not has_table_privilege('anon', 'public.crm_lead_actividades', 'INSERT')
union all
-- Matriz de permisos, ahora en funciones internas que reciben la identidad del
-- actor como parametros (no leen auth.uid() dentro de un SECURITY DEFINER).
select 'crm_lead_responsable_valido exige u.tenant = p_tenant',
  exists (select 1 from pg_proc
           where oid = to_regprocedure('public.crm_lead_responsable_valido(uuid, text)')
             and prosrc like '%u.tenant = p_tenant%')
union all
select 'crm_lead_permite_cambiar_responsable: venta solo toma leads SIN responsable',
  exists (select 1 from pg_proc
           where oid = to_regprocedure('public.crm_lead_permite_cambiar_responsable(text, uuid, uuid, uuid, text, text)')
             and prosrc like '%p_anterior is null%'
             and prosrc like '%p_nuevo = p_actor_id%')
union all
-- La carrera entre dos asesores se resuelve con la condicion del WHERE, no con
-- un chequeo previo: si el `where responsable_id is null` desapareciera, dos
-- asesores podrian tomar el mismo lead.
select 'crm_lead_tomar condiciona la escritura a responsable_id is null',
  exists (select 1 from pg_proc
           where oid = to_regprocedure('public.crm_lead_tomar(bigint)')
             and prosrc like '%and responsable_id is null%')
union all
-- Y el WHERE tiene que traer su propia validación de tenant y de transición: la
-- policy ya no autoriza escrituras porque las RPC son SECURITY DEFINER.
select 'crm_lead_tomar valida tenant y transición en el propio WHERE',
  exists (select 1 from pg_proc
           where oid = to_regprocedure('public.crm_lead_tomar(bigint)')
             and prosrc like '%crm_lead_permite_ver(%'
             and prosrc like '%crm_lead_permite_cambiar_responsable(%')
union all
-- Tomarse un lead a sí mismo no puede ser una excepción a la regla del
-- responsable: sin esta comprobación, superadmin y gerencia (alcada
-- transversal) se quedan como responsables de leads de la otra agencia.
select 'crm_lead_tomar exige que el actor sea responsable valido del tenant del lead',
  exists (select 1 from pg_proc
           where oid = to_regprocedure('public.crm_lead_tomar(bigint)')
             and prosrc like '%and public.crm_lead_responsable_valido(v_actor.actor_id, tenant);%')
union all
-- Bloqueo de fila antes de leer el estado: dos ediciones concurrentes se
-- serializan y la bitacora describe la transicion real, no una foto obsoleta.
select 'actualizar y cambiar_etapa bloquean la fila con for update',
  exists (select 1 from pg_proc
           where oid = to_regprocedure('public.crm_lead_actualizar(bigint, jsonb)')
             and prosrc like '%for update%')
  and exists (select 1 from pg_proc
                where oid = to_regprocedure('public.crm_lead_cambiar_etapa(bigint, text)')
                  and prosrc like '%for update%')
union all
-- Y toda RPC de escritura pasa por crm_lead_actor(), que exige usuario activo
-- y rol del modulo: es lo que reemplaza a la RLS como filtro de actor.
select 'las cinco RPC validan al actor con crm_lead_actor()',
  (select count(*) = 5 from pg_proc
     where oid in (
       to_regprocedure('public.crm_lead_crear(jsonb)'),
       to_regprocedure('public.crm_lead_actualizar(bigint, jsonb)'),
       to_regprocedure('public.crm_lead_tomar(bigint)'),
       to_regprocedure('public.crm_lead_cambiar_etapa(bigint, text)'),
       to_regprocedure('public.crm_lead_registrar_actividad(bigint, text, text, timestamptz)'))
       and prosrc like '%crm_lead_actor()%')
union all
select 'crm_lead_actor exige usuario activo y rol del modulo',
  exists (select 1 from pg_proc
           where oid = to_regprocedure('public.crm_lead_actor()')
             and prosrc like '%u.activo is true%')
  and exists (select 1 from pg_proc
               where oid = to_regprocedure('public.crm_lead_actor()')
                 and prosrc like '%superadmin%, %gerencia%, %administracion%, %venta%')
union all
-- Atomicidad: las cuatro funciones que ACTUALIZAN una fila existente miran el
-- conteo de filas afectadas, así que cero filas es un error y no un éxito
-- silencioso. `crm_lead_crear` no entra: un INSERT o devuelve la fila o falla.
select 'las funciones que actualizan comprueban row_count (cero filas = error)',
  (select count(*) = 4 from pg_proc
     where oid in (
       to_regprocedure('public.crm_lead_actualizar(bigint, jsonb)'),
       to_regprocedure('public.crm_lead_tomar(bigint)'),
       to_regprocedure('public.crm_lead_cambiar_etapa(bigint, text)'),
       to_regprocedure('public.crm_lead_registrar_actividad(bigint, text, text, timestamptz)'))
       and prosrc like '%row_count%')
union all
-- La bitácora se escribe en la MISMA función que el cambio: si el lead cambia y
-- la actividad se insertara aparte, podrían divergir.
select 'la bitacora se inserta dentro de la misma funcion que el cambio',
  (select count(*) = 4 from pg_proc
     where oid in (
       to_regprocedure('public.crm_lead_actualizar(bigint, jsonb)'),
       to_regprocedure('public.crm_lead_tomar(bigint)'),
       to_regprocedure('public.crm_lead_cambiar_etapa(bigint, text)'),
       to_regprocedure('public.crm_lead_registrar_actividad(bigint, text, text, timestamptz)'))
       and prosrc like '%insert into public.crm_lead_actividades%')
union all
-- Identidad documental -----------------------------------------------------------
-- La identidad es la pareja TIPO + NUMERO. La unica unicidad de negocio es
-- (tenant, numero normalizado, tipo): mismo numero con otro tipo es otra persona.
select 'unicidad documental: indice unico (tenant, documento_norm, tipo_doc) parcial',
  exists (select 1 from pg_indexes
           where schemaname = 'public' and tablename = 'crm_leads'
             and indexname = 'uq_crm_leads_tenant_tipo_documento'
             and indexdef like 'CREATE UNIQUE INDEX%(tenant, documento_norm, tipo_doc)%WHERE (documento_norm IS NOT NULL)%')
union all
-- Varias personas comparten telefono o correo (familia, empresa): esos datos
-- sugieren una coincidencia, nunca bloquean. Ningun indice unico de la tabla
-- puede contenerlos, ni el numero de documento sin el tipo.
select 'telefono y correo NO son unicos; el numero solo tampoco',
  not exists (select 1 from pg_indexes
               where schemaname = 'public' and tablename = 'crm_leads'
                 and indexdef like 'CREATE UNIQUE INDEX%'
                 and (indexdef like '%telefono_norm%' or indexdef like '%email_norm%'
                      or (indexdef like '%documento_norm%' and indexdef not like '%tipo_doc%')))
  and to_regclass('public.uq_crm_leads_tenant_telefono') is null
  and to_regclass('public.uq_crm_leads_tenant_email') is null
  and to_regclass('public.uq_crm_leads_tenant_documento') is null
union all
select 'telefono y correo conservan indice de busqueda (no unico) por tenant',
  exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'crm_leads'
           and indexname = 'idx_crm_leads_tenant_telefono' and indexdef not like 'CREATE UNIQUE%')
  and exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'crm_leads'
               and indexname = 'idx_crm_leads_tenant_email' and indexdef not like 'CREATE UNIQUE%')
union all
-- Las reglas documentales viven en el dato: un numero sin tipo, un tipo fuera
-- del catalogo o un numero sin letras ni digitos se rechazan aunque alguien
-- escriba por fuera de las RPC.
select 'tipo_doc con catalogo cerrado y emparejado con documento (CHECK)',
  exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'crm_leads' and column_name = 'tipo_doc')
  and (select count(*) = 3 from pg_constraint
         where conrelid = to_regclass('public.crm_leads') and contype = 'c'
           and conname in ('crm_leads_tipo_doc_catalogo', 'crm_leads_documento_con_tipo', 'crm_leads_documento_normalizable'))
union all
select 'crear y actualizar validan la pareja documental y devuelven coincidencias',
  (select count(*) = 2 from pg_proc
     where oid in (to_regprocedure('public.crm_lead_crear(jsonb)'), to_regprocedure('public.crm_lead_actualizar(bigint, jsonb)'))
       and prosrc like '%crm_lead_tipo_doc_validado(%'
       and prosrc like '%crm_lead_coincidencias(%')
union all
-- Restos de un borrador anterior: la firma vieja del duplicado (sin tipo) no
-- puede quedar como sobrecarga.
select 'no queda la firma antigua de crm_lead_duplicado_id (sin tipo de documento)',
  to_regprocedure('public.crm_lead_duplicado_id(text, text, text, text, uuid, text, text)') is null
union all
-- El normalizador de tipo solo reduce la sigla con puntos; un tipo mal formado
-- sale tal cual (en mayuscula) para que el catalogo lo rechace. Son llamadas a
-- una funcion inmutable: no escriben nada.
select 'normalizar_tipo_doc: admite "c.c." y no limpia tipos mal formados (CC2, C-C, C C)',
  public.crm_lead_normalizar_tipo_doc(' c.c. ') = 'CC'
  and public.crm_lead_normalizar_tipo_doc('p.a.s') = 'PAS'
  and public.crm_lead_normalizar_tipo_doc('CC2') = 'CC2'
  and public.crm_lead_normalizar_tipo_doc('C-C') = 'C-C'
  and public.crm_lead_normalizar_tipo_doc('C C') = 'C C'
  and public.crm_lead_normalizar_tipo_doc('..CC') = '..CC'
  and public.crm_lead_normalizar_tipo_doc('   ') is null
union all
-- Formulario completo: un JSON parcial vaciaria en silencio los campos omitidos.
-- La RPC exige las once claves (texto o null) ANTES de bloquear la fila.
select 'crm_lead_actualizar exige el payload completo antes de bloquear la fila',
  exists (select 1 from pg_proc
           where oid = to_regprocedure('public.crm_lead_actualizar(bigint, jsonb)')
             and prosrc like '%crm_lead_payload_incompleto%'
             and prosrc like '%crm_lead_payload_invalido%'
             and prosrc like '%''canal'', ''nombre'', ''telefono'', ''email'', ''tipo_doc'', ''documento'', ''interes'',%'
             and prosrc like '%''origen_detalle'', ''notas'', ''responsable_id'', ''proxima_accion_at''%'
             and position('crm_lead_payload_incompleto' in prosrc) < position('for update' in prosrc))
union all
-- Índices -----------------------------------------------------------------------
select 'indice de proxima accion y de bitacora por lead',
  exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'crm_leads' and indexname = 'idx_crm_leads_proxima_accion')
  and exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'crm_lead_actividades' and indexname = 'idx_crm_lead_actividades_lead');