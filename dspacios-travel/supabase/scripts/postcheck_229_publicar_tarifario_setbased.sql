-- ───────────────────────────────────────────────────────────────────────────
-- POSTCHECK 229 · publicar_tarifario_resultado set-based (#100). SOLO LECTURA: una sola sentencia SELECT (sin begin ni rollback, para que el editor SQL de Supabase muestre la tabla).
-- Correr DESPUÉS de aplicar la 229. UNA sola consulta: control · valor · esperado · estado (OK / REVISAR / INFO).
-- Con la 229 aplicada todo debe dar OK. Tras el rollback 229, C5 y C6 dan REVISAR (cuerpo de la 226 con bucle por fila).
-- ───────────────────────────────────────────────────────────────────────────

with
pub as (
  select p.oid, p.prosecdef, p.proconfig, p.prosrc, p.prorettype, p.proacl, p.proowner
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'publicar_tarifario_resultado'
),
w63 as (
  select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'publicar_tarifario_resultado_63'
),
c2 as (
  select count(*) n from pub
   where prosrc like '%mi_rol()%' and prosrc like '%tarifario_generacion%' and prosrc like '%tarifario_revision_fuente%'
     and prosrc like '%p_moneda%' and prosrc like '%tarifario_snapshot_publicable%' and prosrc ilike '%for update%'
),
c3 as (select count(*) n from pub where prosrc like '%precio_pvp_menor2%' and prosrc like '%''null''::jsonb%'),
c4 as (
  select coalesce((select (length(prosrc) - length(replace(lower(prosrc), 'insert into public.tarifario_resultado', '')))
                          / length('insert into public.tarifario_resultado') from pub), -1) n
),
-- PUBLIC (grantee 0) no debe tener EXECUTE; anon sin EXECUTE; authenticated con EXECUTE.
c7 as (
  select (not has_function_privilege('anon', 'public.publicar_tarifario_resultado(bigint, bigint, bigint, text, jsonb)', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.publicar_tarifario_resultado(bigint, bigint, bigint, text, jsonb)', 'EXECUTE')
          and not exists (select 1 from pub, aclexplode(coalesce(pub.proacl, acldefault('f', pub.proowner))) a where a.grantee = 0)) ok
),
chequeos(orden, control, valor, esperado, estado) as (
  select 1, 'C1 una sola función, SECURITY DEFINER, search_path fijo, retorna boolean',
         (select count(*) from pub where prosecdef and coalesce(proconfig::text, '') like '%search_path%' and prorettype = 'boolean'::regtype)::text || ' de ' || (select count(*) from pub), '1 de 1',
         case when (select count(*) from pub) = 1 and (select count(*) from pub where prosecdef and coalesce(proconfig::text, '') like '%search_path%' and prorettype = 'boolean'::regtype) = 1 then 'OK' else 'REVISAR' end
  union all select 2, 'C2 conserva candado de rol, token de generación y revisión, moneda y activo', (select n from c2)::text, '1',
         case when (select n from c2) = 1 then 'OK' else 'REVISAR' end
  union all select 3, 'C3 persiste precio_pvp_menor2 (226) y normaliza el null JSON de procedencia_temporadas', (select n from c3)::text, '1',
         case when (select n from c3) = 1 then 'OK' else 'REVISAR' end
  union all select 4, 'C4 un solo INSERT INTO tarifario_resultado en el cuerpo (sin inserciones duplicadas)', (select n from c4)::text, '1',
         case when (select n from c4) = 1 then 'OK' else 'REVISAR' end
  union all select 5, 'C5 sin bucle de inserción por fila (for v_fila in)',
         (select count(*) from pub where prosrc like '%for v_fila in%')::text, '0',
         case when (select count(*) from pub where prosrc like '%for v_fila in%') = 0 then 'OK' else 'REVISAR' end
  union all select 6, 'C6 carga desde jsonb_array_elements ... with ordinality',
         (select count(*) from pub where prosrc like '%with ordinality%')::text, '1',
         case when (select count(*) from pub where prosrc like '%with ordinality%') = 1 then 'OK' else 'REVISAR' end
  union all select 7, 'C7 ACL intacta: public y anon sin EXECUTE, authenticated con EXECUTE', (select ok::int from c7)::text, '1',
         case when (select ok from c7) then 'OK' else 'REVISAR' end
  union all select 8, 'C8 envoltorio 227 intacto: delega en el publicador vigente',
         (select count(*) from w63 where prosrc like '%public.publicar_tarifario_resultado(p_paquete_id%')::text, '1',
         case when (select count(*) from w63 where prosrc like '%public.publicar_tarifario_resultado(p_paquete_id%') = 1 then 'OK' else 'REVISAR' end
  union all select 9, 'C9 tarifario_resultado sin triggers propios',
         (select count(*) from pg_trigger where tgrelid = 'public.tarifario_resultado'::regclass and not tgisinternal)::text, '0',
         case when (select count(*) from pg_trigger where tgrelid = 'public.tarifario_resultado'::regclass and not tgisinternal) = 0 then 'OK' else 'REVISAR' end
  union all select 10, 'C10 CHECK de tarifario_resultado sin cambios',
         (select count(*) from pg_constraint where conrelid = 'public.tarifario_resultado'::regclass and contype = 'c')::text, '6',
         case when (select count(*) from pg_constraint where conrelid = 'public.tarifario_resultado'::regclass and contype = 'c') = 6 then 'OK' else 'REVISAR' end
  union all select 11, 'C11 filas en tarifario_resultado (la migración no toca datos)', (select count(*) from public.tarifario_resultado)::text, '(igual al preflight P12)', 'INFO'
  union all select 12, 'C12 md5 del cuerpo vigente', coalesce((select md5(replace(prosrc, E'\r', '')) from pub), '<sin función>'), '(distinto del preflight P14)', 'INFO'
)
select control, valor, esperado, estado from chequeos order by orden;

