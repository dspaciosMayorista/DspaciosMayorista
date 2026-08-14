-- ─────────────────────────────────────────────────────────────────────────
-- ¿Las policies del bucket `contratos` separan las dos agencias?  ·  SOLO LECTURA
-- Se pega en el editor SQL de Supabase. Termina en ROLLBACK.
-- ─────────────────────────────────────────────────────────────────────────
--
-- QUÉ HACE
--   Evalúa el PREDICADO de las policies del bucket `contratos` haciéndose pasar
--   por cada usuario REAL contra cada contrato REAL. No escribe nada y no toca
--   `storage.objects`: es una consulta booleana.
--
--   Sirve para MEDIR EL ALCANCE en producción: cuántos archivos de la otra
--   agencia alcanza cada persona concreta. Es la pregunta que
--   `test_storage_por_tenant.sql` no responde — ese monta sus propios datos de
--   prueba y comprueba que la regla sea correcta; este dice a quién afecta de
--   verdad.
--
--   ⚠️ DETECTA SOLO LA VERSIÓN QUE ESTÉ APLICADA. Si existe la función
--   `acceso_archivo_contratos` (migración 150) evalúa ESA; si no, evalúa el
--   predicado de la 148. La columna «regla evaluada» dice cuál se usó, para que
--   un resultado limpio no se confunda con haber medido la regla equivocada.
--
-- POR QUÉ EXISTE
--   Las cuatro policies (lectura / subir / reemplazar / eliminar) tienen la
--   MISMA condición:
--
--     bucket_id = 'contratos'
--     and mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
--     and (mi_rol() <> 'venta' or soy_asesor_del_contrato(split_part(name,'/',1)))
--
--   Leída con cuidado, tiene dos agujeros — y los dos son de LÓGICA, no
--   hipótesis:
--
--   1. Para cualquier rol que no sea `venta`, `mi_rol() <> 'venta'` ya es TRUE,
--      así que la disyunción se resuelve sin llegar a evaluar
--      `soy_asesor_del_contrato`. La condición de propiedad no participa.
--
--   2. NINGUNA policy compara el tenant. `soy_asesor_del_contrato` tampoco: es
--      SECURITY DEFINER y empareja solo por nombre contra `ventas.asesor`.
--
--   Consecuencia: un `gerencia`/`administracion`/`operaciones` de CUALQUIERA de
--   las dos agencias alcanza TODOS los archivos del bucket, incluidos los de la
--   otra. Y un `venta` alcanza los archivos de un contrato de la otra agencia si
--   su nombre coincide con `ventas.asesor` de ese contrato — algo que pasa de
--   verdad, porque el importador de minorista escribe ahí el nombre del
--   freelance de la hoja (ver `diagnostico_contratos_b2b.sql`).
--
--   El contrato en sí NO se ve: `puede_ver_contrato` sí filtra por tenant. Lo
--   que se alcanza son los ARCHIVOS, que es donde están las cédulas.
--
-- CÓMO SE LEE
--   Cada fila es (usuario × contrato). `permite` = lo que decidiría la policy.
--   · `permite` TRUE con `tenant del usuario` <> `tenant del contrato`
--     → FUGA ENTRE AGENCIAS.
--   · `evaluó la propiedad` FALSE explica por qué: la condición ni se miró.
--   · superadmin en TRUE siempre es lo correcto (alcance global por diseño).

begin;

create temp table _cruce(
  usuario        text,
  rol            text,
  tenant_usuario text,
  contrato       text,
  tenant_contrato text,
  evaluo_propiedad boolean,
  permite        boolean,
  regla          text
) on commit drop;

do $$
declare
  u record;
  c record;
  no_venta  boolean;
  decide    boolean;
  hay_150   boolean;
  regla     text;
begin
  -- ¿Qué versión de la regla está aplicada?
  select exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'acceso_archivo_contratos'
  ) into hay_150;
  regla := case when hay_150 then '150 (acceso_archivo_contratos)' else '148 (rol + propiedad, sin tenant)' end;
  raise notice 'Regla evaluada: %', regla;

  for u in select id, email, rol::text as rol, tenant from public.usuarios where activo order by rol, email loop
    for c in select numero_contrato, tenant from public.ventas order by numero_contrato loop

      execute 'set local role authenticated';
      perform set_config('request.jwt.claims',
        json_build_object('sub', u.id, 'role', 'authenticated')::text, true);

      no_venta := public.mi_rol() is distinct from 'venta';

      if hay_150 then
        -- La función real de la 150, sobre la ruta que tendría un adjunto.
        decide := public.acceso_archivo_contratos(c.numero_contrato || '/adjunto');
      else
        -- Mismo orden y mismo cortocircuito que la policy de la 148.
        decide := public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
                  and (no_venta or public.soy_asesor_del_contrato(c.numero_contrato));
      end if;

      reset role;
      perform set_config('request.jwt.claims', '{}', true);

      -- El insert va DESPUÉS de `reset role`: la tabla temporal es del rol de
      -- la sesión, y `authenticated` no tiene permiso sobre ella.
      insert into _cruce values (
        u.email, u.rol, u.tenant, c.numero_contrato, c.tenant,
        -- Con la 148 la propiedad solo se evaluaba si el rol era `venta`.
        case when hay_150 then null else not no_venta end,
        decide,
        regla
      );
    end loop;
  end loop;
end $$;

-- Resultado 1 — LAS FUGAS ENTRE AGENCIAS, de primeras.
-- Cualquier fila aquí que no sea superadmin es un archivo de una agencia al
-- alcance de un usuario de la otra.
select
  usuario, rol,
  tenant_usuario   as "agencia del usuario",
  contrato,
  tenant_contrato  as "agencia del contrato",
  evaluo_propiedad as "¿se evaluó soy_asesor_del_contrato? (solo con la 148)",
  regla            as "regla evaluada",
  case
    when rol = 'superadmin' then 'esperado — alcance global por diseño'
    when evaluo_propiedad is false then 'FUGA — el rol entra sin que se mire la propiedad ni el tenant'
    else 'FUGA — coincidencia de nombre en `ventas.asesor` de la otra agencia'
  end as veredicto
from _cruce
where permite and tenant_usuario is distinct from tenant_contrato
order by (rol = 'superadmin'), rol, usuario, contrato;

-- Resultado 2 — resumen por usuario.
select
  usuario, rol,
  tenant_usuario as "agencia del usuario",
  count(*) filter (where permite)                                             as "archivos que alcanza",
  count(*) filter (where permite and tenant_usuario is distinct from tenant_contrato)
                                                                              as "…de la OTRA agencia",
  count(*)                                                                    as "contratos en la base",
  min(regla)                                                                  as "regla evaluada"
from _cruce
group by usuario, rol, tenant_usuario
order by rol, usuario;

rollback;
