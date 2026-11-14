-- 281 · POSTCHECK (solo lectura, UNA consulta): ¿quedó bien aplicada la migración 281? control · observado · esperado · estado.
with fn(nombre, firma) as (values
  ('soporte_registrar', 'public.soporte_registrar(text,uuid,text,text,text,bigint,text)'),
  ('soporte_reemplazar', 'public.soporte_reemplazar(bigint,uuid,text,text,text,bigint,text)'),
  ('soporte_retirar', 'public.soporte_retirar(bigint,uuid,text)'),
  ('avisos_reclamar', 'public.avisos_reclamar(uuid,integer)'),
  ('avisos_marcar_leidos', 'public.avisos_marcar_leidos(uuid,bigint[])')
), c(orden, control, observado, esperado) as (
  select 1, 'tablas contrato_soportes_pago y avisos existen', (to_regclass('public.contrato_soportes_pago') is not null and to_regclass('public.avisos') is not null)::text, 'true'
  union all select 2, 'RLS activa en ambas', (select count(*)::text from pg_class where oid in ('public.contrato_soportes_pago'::regclass, 'public.avisos'::regclass) and relrowsecurity), '2'
  union all select 3, 'triggers de integridad en soportes (insert, update, delete, truncate, reemplazo completo)',
    (select count(*)::text from pg_trigger where tgrelid = 'public.contrato_soportes_pago'::regclass and not tgisinternal
       and tgname in ('trg_f281_soportes_insert', 'trg_f281_soportes_update', 'trg_f281_soportes_delete', 'trg_f281_soportes_truncate', 'trg_f281_reemplazo_completo')), '5'
  union all select 4, 'el trigger de reemplazo es DIFERIDO (se comprueba al confirmar)',
    (select (tgdeferrable and tginitdeferred)::text from pg_trigger where tgname = 'trg_f281_reemplazo_completo'), 'true'
  union all select 5, 'índice único parcial por reemplaza_id', (select count(*)::text from pg_indexes where schemaname = 'public' and indexname = 'uq_soportes_reemplaza'), '1'
  union all select 6, 'NO hay columna abono_id (el límite es por contrato, sin vínculo con abonos)',
    (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'contrato_soportes_pago' and column_name = 'abono_id'), '0'
  union all select 7, 'anon/authenticated/service_role SIN escritura directa en soportes',
    (select count(*)::text from (values ('anon'), ('authenticated'), ('service_role')) r(rol), (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) p(priv)
      where has_table_privilege(r.rol, 'public.contrato_soportes_pago', p.priv)), '0'
  union all select 8, 'authenticated y service_role pueden LEER soportes; anon no',
    (has_table_privilege('authenticated', 'public.contrato_soportes_pago', 'SELECT') and has_table_privilege('service_role', 'public.contrato_soportes_pago', 'SELECT')
     and not has_table_privilege('anon', 'public.contrato_soportes_pago', 'SELECT'))::text, 'true'
  union all select 9, 'una sola policy en soportes (lectura interna) y ninguna en avisos',
    (select (count(*) filter (where tablename = 'contrato_soportes_pago')::text || '/' || count(*) filter (where tablename = 'avisos')::text) from pg_policies where schemaname = 'public'), '1/0'
  union all select 10, 'avisos: ni anon ni authenticated tienen ningún privilegio',
    (select count(*)::text from (values ('anon'), ('authenticated')) r(rol), (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) p(priv)
      where has_table_privilege(r.rol, 'public.avisos', p.priv)), '0'
  union all select 11, 'las 5 funciones públicas existen', (select count(*)::text from fn where to_regprocedure(fn.firma) is not null), '5'
  union all select 12, 'service_role ejecuta las 5; authenticated y anon, ninguna',
    (select (count(*) filter (where has_function_privilege('service_role', firma, 'EXECUTE'))::text || '/'
          || count(*) filter (where has_function_privilege('authenticated', firma, 'EXECUTE') or has_function_privilege('anon', firma, 'EXECUTE'))::text) from fn), '5/0'
  union all select 13, 'las 5 son SECURITY DEFINER con search_path fijo',
    (select count(*)::text from fn join pg_proc p on p.oid = to_regprocedure(fn.firma) where p.prosecdef and exists (select 1 from unnest(p.proconfig) k where k like 'search_path=%')), '5'
  union all select 14, 'bucket soportes-pago privado, 5 MB, pdf/jpeg/png',
    (select public::text || '|' || file_size_limit || '|' || array_to_string(allowed_mime_types, ',') from storage.buckets where id = 'soportes-pago'), 'false|5242880|application/pdf,image/jpeg,image/png'
  union all select 15, 'ninguna policy de storage.objects menciona soportes-pago',
    (select count(*)::text from pg_policies where schemaname = 'storage' and tablename = 'objects' and (coalesce(qual, '') || coalesce(with_check, '')) like '%soportes-pago%'), '0'
  union all select 16, 'las policies del bucket contratos siguen intactas (150)',
    (select count(*)::text from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'contratos files:%'), '4'
  union all select 17, 'anular_abono (248) sigue presente', (to_regprocedure('public.anular_abono(bigint,text,text,uuid,text)') is not null)::text, 'true'
  union all select 19, 'trigger de archivado en ventas (identidad del contrato vs consecutivo reutilizable)', (select count(*)::text from pg_trigger where tgrelid = 'public.ventas'::regclass and tgname = 'trg_f281_archivar_evidencia' and not tgisinternal and tgenabled = 'O'), '1'
  union all select 20, 'columna archivado_en en soportes y avisos', (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name in ('contrato_soportes_pago', 'avisos') and column_name = 'archivado_en'), '2'
  union all select 21, 'fn_renumerar_contrato ahora llama al traslado de evidencia', (select (p.prosrc like '%f281_trasladar_evidencia%')::text from pg_proc p where p.oid = to_regprocedure('public.fn_renumerar_contrato(text,text)')), 'true'
  union all select 27, 'fn_renumerar_contrato bloquea la venta VIEJA antes de copiarla (venta primero, sin interbloqueo con anular_abono)',
    (select (position('perform 1 from public.ventas where numero_contrato = p_viejo for update' in p.prosrc) > 0 and position('perform 1 from public.ventas where numero_contrato = p_viejo for update' in p.prosrc) < position('execute format(''insert into public.ventas' in p.prosrc) and position('f281_trasladar_evidencia' in p.prosrc) < position('delete from public.ventas where numero_contrato = p_viejo' in p.prosrc))::text from pg_proc p where p.oid = to_regprocedure('public.fn_renumerar_contrato(text,text)')), 'true'
  union all select 22, 'el cuerpo actual coincide con el que dejó la 281 (nada cambió después)',
    (select (md5(replace(p.prosrc, chr(13), '')) = r.prosrc_md5_281)::text from pg_proc p, public.f281_respaldo_funciones r where r.nombre = 'fn_renumerar_contrato' and p.oid = to_regprocedure('public.fn_renumerar_contrato(text,text)')), 'true'
  union all select 23, 'permisos y propietario de fn_renumerar_contrato IDÉNTICOS a los originales (respaldo vs actual)',
    (select (coalesce(p.proacl::text, '<defecto>') = r.acl_original and coalesce(p.proacl::text, '<defecto>') = r.acl_tras_281 and p.proowner::regrole::text = r.propietario)::text
       from pg_proc p, public.f281_respaldo_funciones r where r.nombre = 'fn_renumerar_contrato' and p.oid = to_regprocedure('public.fn_renumerar_contrato(text,text)')), 'true'
  union all select 24, 'f281_trasladar_evidencia SIN ejecutores (ni public, ni anon, ni authenticated, ni service_role)',
    ((select count(*) from (values ('anon'), ('authenticated'), ('service_role')) r(rol) where has_function_privilege(r.rol, 'public.f281_trasladar_evidencia(text,text)', 'EXECUTE'))
     + (select count(*) from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.oid = to_regprocedure('public.f281_trasladar_evidencia(text,text)') and a.grantee = 0 and a.privilege_type = 'EXECUTE'))::text, '0'
  union all select 25, 'la tabla de respaldo existe (1 fila) y nadie salvo el propietario la toca',
    (select count(*) from public.f281_respaldo_funciones)::text || '/' || (select count(*) from (values ('anon'), ('authenticated'), ('service_role')) r(rol), (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) q(priv) where has_table_privilege(r.rol, 'public.f281_respaldo_funciones', q.priv))::text, '1/0'
  union all select 26, 'ya no existe el check ruta↔número (la ruta física no cambia al renumerar)',
    (select count(*)::text from pg_constraint where conrelid = 'public.contrato_soportes_pago'::regclass and conname = 'soportes_ruta_del_contrato'), '0'
  union all select 18, 'tablas nuevas vacías tras aplicar (nada se sembró)', ((select count(*) from public.contrato_soportes_pago) + (select count(*) from public.avisos))::text, '0'
)
select orden, control, observado, esperado, case when observado = esperado then 'OK' else 'FALLA' end as estado from c
union all
select 99, 'VEREDICTO', (select count(*) filter (where observado <> esperado)::text from c), '0 fallas',
       case when (select count(*) filter (where observado <> esperado) from c) = 0 then 'CORRECTA' else 'REVISAR' end
order by 1;
