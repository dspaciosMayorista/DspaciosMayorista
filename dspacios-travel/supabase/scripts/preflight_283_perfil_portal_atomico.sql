-- PREFLIGHT de la migración 283 (guardado atómico de «Mi perfil»). SOLO LECTURA: una consulta, un resultado.
-- Columnas: control | observado | esperado | estado.  estado: OK / FALLA (bloquea) / INFO (contexto, no bloquea).
-- La última fila es el veredicto: «LISTO PARA APLICAR» solo si no hay ninguna FALLA.
with v(orden, control, obs, esp, critico) as (
  values
    (1,  'tabla public.usuarios existe',   (select count(*)::text from information_schema.tables where table_schema = 'public' and table_name = 'usuarios'), '1', true),
    (2,  'tabla public.aliados existe',    (select count(*)::text from information_schema.tables where table_schema = 'public' and table_name = 'aliados'), '1', true),
    (3,  'tabla public.auditoria existe',  (select count(*)::text from information_schema.tables where table_schema = 'public' and table_name = 'auditoria'), '1', true),
    (4,  'usuarios: columnas que usa la función (id, nombre, rol, activo, agencia_id, aliado_id, acceso_legacy_nombre)',
         (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'usuarios'
            and column_name in ('id', 'nombre', 'rol', 'activo', 'agencia_id', 'aliado_id', 'acceso_legacy_nombre')), '7', true),
    (5,  'aliados: columnas editables (id, nombre, contacto, telefono, email, direccion)',
         (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'aliados'
            and column_name in ('id', 'nombre', 'contacto', 'telefono', 'email', 'direccion')), '6', true),
    (6,  'auditoria: columnas que inserta la función (10)',
         (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'auditoria'
            and column_name in ('actor_id', 'actor_email', 'actor_nombre', 'actor_rol', 'accion', 'tabla', 'registro_id', 'antes', 'despues', 'cambios')), '10', true),
    (7,  'auditoria: antes/despues/cambios son jsonb',
         (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'auditoria'
            and column_name in ('antes', 'despues', 'cambios') and data_type = 'jsonb'), '3', true),
    (8,  'rol de base service_role existe', (select count(*)::text from pg_roles where rolname = 'service_role'), '1', true),
    (9,  'la función guardar_perfil_portal NO existe todavía (migración sin aplicar)',
         (select count(*)::text from pg_proc where pronamespace = 'public'::regnamespace and proname = 'guardar_perfil_portal'), '0', true),
    (10, 'INFO · trigger de auditoría (trg_auditoria) en usuarios y aliados',
         (select count(*)::text from pg_trigger where tgname = 'trg_auditoria' and not tgisinternal
            and tgrelid in ('public.usuarios'::regclass, 'public.aliados'::regclass)), '2', false),
    (11, 'INFO · fichas compartidas por más de una cuenta titular activa (no se editarán desde el portal)',
         (select count(*)::text from (select aliado_id from public.usuarios
            where aliado_id is not null and agencia_id is null and activo is true and rol::text in ('agencia', 'freelance')
            group by aliado_id having count(*) > 1) x), 'revisar si > 0', false),
    (12, 'INFO · cuentas aliado activas con acceso heredado por nombre (su nombre de usuario quedará de solo lectura)',
         (select count(*)::text from public.usuarios where activo is true and rol::text in ('agencia', 'freelance') and acceso_legacy_nombre is distinct from false), 'informativo', false),
    (13, 'INFO · agentes con aliado_id puesto (no son titulares: no editan la ficha)',
         (select count(*)::text from public.usuarios where rol::text = 'agencia' and agencia_id is not null and aliado_id is not null), 'informativo', false)
),
r as (
  select orden, control, obs as observado, esp as esperado,
         case when not critico then 'INFO' when obs = esp then 'OK' else 'FALLA' end as estado
  from v
)
select orden, control, observado, esperado, estado from r
union all
select 99, 'VEREDICTO', (select count(*) from r where estado = 'FALLA')::text || ' falla(s)', '0 fallas',
       case when (select count(*) from r where estado = 'FALLA') = 0 then 'LISTO PARA APLICAR' else 'NO APLICAR' end
order by orden;
