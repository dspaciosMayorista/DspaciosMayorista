-- ───────────────────────────────────────────────────────────────────────────
-- PREFLIGHT 193 · SOLO LECTURA (no modifica nada). Correr ANTES de la 193.
--
-- A) Solicitudes PENDIENTES que la aprobación nueva (`aprobar_solicitud_b2b`)
--    va a rechazar, con el motivo. Hay que resolverlas a mano (pedir registro
--    nuevo, o rechazarlas) — la función no las "arregla" buscando por correo.
-- B) Perfiles ACTIVOS que pudieron nacer por alta directa u OAuth con el
--    trigger viejo (rol tomado de la metadata del usuario, o 'venta' por
--    default). No prueba abuso por sí solo: es la lista a revisar.
-- C) Estado actual de las policies de b2b_solicitudes (debe mostrar la
--    "registro público" antes de la 193 y desaparecer después).
-- ───────────────────────────────────────────────────────────────────────────

-- A) Pendientes que no pasarían la aprobación nueva
select s.id, s.email, s.tipo, s.created_at,
       case
         when s.usuario_id is null then 'sin cuenta asociada'
         when u.id is null then 'la cuenta ya no existe'
         when lower(btrim(u.email)) <> lower(btrim(s.email))
           or lower(btrim(coalesce(a.email, ''))) <> lower(btrim(s.email)) then 'correo distinto'
         when u.rol::text <> s.tipo then 'rol de la cuenta: ' || u.rol::text
         when u.activo then 'la cuenta ya está activa'
       end as motivo
  from public.b2b_solicitudes s
  left join public.usuarios u on u.id = s.usuario_id
  left join auth.users a on a.id = s.usuario_id
 where s.estado = 'pendiente'
   and (s.usuario_id is null or u.id is null
        or lower(btrim(u.email)) <> lower(btrim(s.email))
        or lower(btrim(coalesce(a.email, ''))) <> lower(btrim(s.email))
        or u.rol::text <> s.tipo or u.activo)
 order by s.created_at;

-- B) Perfiles activos con indicios de alta directa / OAuth
--    · metadata con un rol que no es agencia/freelance (lo puso quien se
--      registró o una Server Action interna — revisar caso por caso);
--    · proveedor distinto de email (Google) y rol interno.
select u.id, u.email, u.rol, u.activo, u.fecha_registro,
       a.raw_user_meta_data->>'rol'      as rol_en_metadata,
       a.raw_app_meta_data->>'provider'  as proveedor
  from public.usuarios u
  join auth.users a on a.id = u.id
 where u.activo
   and (
     (a.raw_user_meta_data ? 'rol' and a.raw_user_meta_data->>'rol' not in ('agencia', 'freelance'))
     or (coalesce(a.raw_app_meta_data->>'provider', 'email') <> 'email'
         and u.rol in ('superadmin', 'gerencia', 'administracion', 'operaciones', 'venta', 'control_vuelo'))
   )
 order by u.fecha_registro desc;

-- C) Policies vigentes
select policyname, cmd, roles, qual, with_check
  from pg_policies
 where schemaname = 'public' and tablename = 'b2b_solicitudes'
 order by policyname;

-- D) IMPACTO DEL RESPALDO POR NOMBRE (decisión de backfill pendiente).
--    SOLO LECTURA. Una fila por cuenta B2B ACTIVA con nombre que, ANTES de la
--    193, alcanzaba por NOMBRE (normalizado: mayúsculas y espacios) algún
--    contrato sin `ventas.aliado_id` ni `ventas.b2b_usuario_id`.
--
--    Las columnas de conteo son una PARTICIÓN: cada contrato cuenta en una
--    sola de ellas (o en ninguna, si antes tampoco se abría por nombre).
--
--      ventas_mismo_tenant / ventas_otro_tenant
--          El nombre está en ventas.agencia_nombre / freelance_nombre (portal,
--          estado de cuenta y cuenta de cobro lo abrían) y NINGUNA comisión
--          manual tiene ficha. Solo `ventas_mismo_tenant` puede preservarse con
--          la bandera `acceso_legacy_nombre`; `ventas_otro_tenant` se pierde por
--          la regla de tenant.
--
--      solo_comision_mismo_tenant / solo_comision_otro_tenant
--          Lo que la CUENTA DE COBRO concedía de verdad por el nombre de la
--          comisión manual, y nada más (el nombre NO está en ventas). Reproduce
--          `resolverComisionB2B` antes de la 193:
--            · si `modo_compra = 'comisionable'` y `comision_b2b` no es nulo ni
--              0, la comisión se resolvía DESDE VENTAS y el nombre de la
--              comisión manual no participaba → no cuenta aquí;
--            · si no, solo la comisión manual MÁS RECIENTE (mayor id): su
--              `aliado` era el nombre y su `aliado_id`, el id. Si esa última
--              tiene `aliado_id`, no se abría por nombre → no cuenta.
--          Exige además que NINGUNA comisión tenga ficha (si alguna la tiene,
--          va a la columna de exclusión). Tras la 193 todo esto se pierde: el
--          nombre de la comisión manual ya no abre nada.
--
--      excluidas_por_ficha_en_comision
--          Contratos que antes SÍ se abrían por nombre (por ventas o por la
--          comisión más reciente) pero quedan fuera de las columnas anteriores
--          porque ALGUNA comisión manual tiene `aliado_id` (p. ej. una comisión
--          antigua con ficha y una más reciente sin ella). Solo para REVISIÓN:
--          la vía correcta para ellos es revisar y enlazar por id, NO el acceso
--          por nombre.
--
--      fichas_con_ese_nombre / otras_cuentas_con_ese_nombre
--          Ambigüedad: si son > 0, el nombre no identifica a una sola persona
--          o empresa.
--
--    Nota: el código comparaba con trim() de JavaScript (quita cualquier
--    espacio en blanco); aquí btrim() quita solo espacios. Un nombre con
--    tabuladores o saltos de línea en los extremos podría no contarse.
with cuentas as (
  select u.id, u.email, u.nombre, u.rol, u.tenant, lower(btrim(u.nombre)) as n
    from public.usuarios u
   where u.activo
     and u.rol in ('agencia', 'freelance')
     and btrim(coalesce(u.nombre, '')) <> ''
),
contratos as (
  select v.numero_contrato, v.tenant,
         lower(btrim(v.agencia_nombre))   as an,
         lower(btrim(v.freelance_nombre)) as fn,
         -- Exactamente `modo_compra === "comisionable" && !!comision_b2b`: con
         -- modo_compra NULL el `=` daría NULL (no false) y el contrato se
         -- perdería de todas las columnas. Nunca NULL: siempre true/false.
         (coalesce(v.modo_compra = 'comisionable', false)
          and coalesce(v.comision_b2b, 0) <> 0) as comision_desde_ventas,
         ult.id is not null              as hay_comision_manual,
         lower(btrim(ult.aliado))        as ult_aliado,
         ult.aliado_id                   as ult_aliado_id,
         exists (select 1 from public.aliados_b2b b
                  where b.numero_contrato = v.numero_contrato
                    and b.aliado_id is not null) as alguna_ficha
    from public.ventas v
    left join lateral (
      select b.id, b.aliado, b.aliado_id
        from public.aliados_b2b b
       where b.numero_contrato = v.numero_contrato
       order by b.id desc
       limit 1
    ) ult on true
   where v.aliado_id is null
     and v.b2b_usuario_id is null
),
cruce as (
  select c.id as usuario_id,
         k.numero_contrato,
         coalesce(k.tenant = c.tenant, false) as mismo_tenant,
         (coalesce(k.an = c.n, false) or coalesce(k.fn = c.n, false)) as por_ventas,
         (not k.comision_desde_ventas
          and k.hay_comision_manual
          and k.ult_aliado_id is null
          and coalesce(k.ult_aliado = c.n, false)) as por_cobro_manual,
         k.alguna_ficha
    from cuentas c
    join contratos k
      on k.an = c.n or k.fn = c.n or k.ult_aliado = c.n
),
conteos as (
  select x.usuario_id,
         count(*) filter (where x.por_ventas and not x.alguna_ficha and x.mismo_tenant)          as ventas_mismo_tenant,
         count(*) filter (where x.por_ventas and not x.alguna_ficha and not x.mismo_tenant)      as ventas_otro_tenant,
         count(*) filter (where not x.por_ventas and x.por_cobro_manual
                            and not x.alguna_ficha and x.mismo_tenant)                          as solo_comision_mismo_tenant,
         count(*) filter (where not x.por_ventas and x.por_cobro_manual
                            and not x.alguna_ficha and not x.mismo_tenant)                      as solo_comision_otro_tenant,
         count(*) filter (where x.alguna_ficha and (x.por_ventas or x.por_cobro_manual))        as excluidas_por_ficha_en_comision
    from cruce x
   group by x.usuario_id
)
select 'D' as seccion, c.email, c.nombre, c.rol, c.tenant,
       k.ventas_mismo_tenant, k.ventas_otro_tenant,
       k.solo_comision_mismo_tenant, k.solo_comision_otro_tenant,
       k.excluidas_por_ficha_en_comision,
       (select count(*) from public.aliados a where lower(btrim(a.nombre)) = c.n) as fichas_con_ese_nombre,
       (select count(*) from public.usuarios u2
         where u2.id <> c.id and u2.rol in ('agencia', 'freelance')
           and lower(btrim(u2.nombre)) = c.n)                                    as otras_cuentas_con_ese_nombre
  from cuentas c
  join conteos k on k.usuario_id = c.id
 where k.ventas_mismo_tenant + k.ventas_otro_tenant
     + k.solo_comision_mismo_tenant + k.solo_comision_otro_tenant
     + k.excluidas_por_ficha_en_comision > 0
 order by k.ventas_mismo_tenant desc, c.email;


-- D-detalle) SOLO LECTURA. Lo mismo que D, una fila por cuenta y contrato, con
--    su categoría (misma partición que las columnas de D). Sirve para revisar
--    uno por uno, en especial los `excluidas_por_ficha_en_comision`: la vía para
--    ellos es revisar y enlazar por id, NO conceder acceso por nombre.
with cuentas as (
  select u.id, u.email, u.nombre, u.rol, u.tenant, lower(btrim(u.nombre)) as n
    from public.usuarios u
   where u.activo
     and u.rol in ('agencia', 'freelance')
     and btrim(coalesce(u.nombre, '')) <> ''
),
contratos as (
  select v.numero_contrato, v.tenant,
         lower(btrim(v.agencia_nombre))   as an,
         lower(btrim(v.freelance_nombre)) as fn,
         -- Exactamente `modo_compra === "comisionable" && !!comision_b2b`: con
         -- modo_compra NULL el `=` daría NULL (no false) y el contrato se
         -- perdería de todas las columnas. Nunca NULL: siempre true/false.
         (coalesce(v.modo_compra = 'comisionable', false)
          and coalesce(v.comision_b2b, 0) <> 0) as comision_desde_ventas,
         ult.id is not null              as hay_comision_manual,
         lower(btrim(ult.aliado))        as ult_aliado,
         ult.aliado_id                   as ult_aliado_id,
         exists (select 1 from public.aliados_b2b b
                  where b.numero_contrato = v.numero_contrato
                    and b.aliado_id is not null) as alguna_ficha
    from public.ventas v
    left join lateral (
      select b.id, b.aliado, b.aliado_id
        from public.aliados_b2b b
       where b.numero_contrato = v.numero_contrato
       order by b.id desc
       limit 1
    ) ult on true
   where v.aliado_id is null
     and v.b2b_usuario_id is null
),
cruce as (
  select c.id as usuario_id,
         k.numero_contrato,
         coalesce(k.tenant = c.tenant, false) as mismo_tenant,
         (coalesce(k.an = c.n, false) or coalesce(k.fn = c.n, false)) as por_ventas,
         (not k.comision_desde_ventas
          and k.hay_comision_manual
          and k.ult_aliado_id is null
          and coalesce(k.ult_aliado = c.n, false)) as por_cobro_manual,
         k.alguna_ficha
    from cuentas c
    join contratos k
      on k.an = c.n or k.fn = c.n or k.ult_aliado = c.n
),
clasificados as (
  select x.usuario_id, x.numero_contrato,
         case
           when x.alguna_ficha and (x.por_ventas or x.por_cobro_manual) then 'excluidas_por_ficha_en_comision'
           when x.por_ventas and x.mismo_tenant                         then 'ventas_mismo_tenant'
           when x.por_ventas                                            then 'ventas_otro_tenant'
           when x.por_cobro_manual and x.mismo_tenant                   then 'solo_comision_mismo_tenant'
           when x.por_cobro_manual                                      then 'solo_comision_otro_tenant'
         end as categoria
    from cruce x
)
select 'D-detalle' as seccion, c.email, k.numero_contrato, k.categoria
  from clasificados k
  join cuentas c on c.id = k.usuario_id
 where k.categoria is not null
 order by c.email, k.categoria, k.numero_contrato;
