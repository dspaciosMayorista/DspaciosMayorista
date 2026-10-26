-- INVENTARIO 42 (solo lectura): personas de cotizaciones frente al registro de la 219. No escribe, no hace backfill.
-- Requisito: 219 aplicada (usa public.cotizacion_participantes). Una sola consulta; una fila por control.
with q as (
  select c.id, c.tenant, c.estado, c.payload,
         coalesce(btrim(c.payload #>> '{cliente,numeroDoc}', ' '), '') as t_doc,
         coalesce(btrim(c.payload #>> '{cliente,nombres}',    ' '), '') as t_nom,
         coalesce(btrim(c.payload #>> '{cliente,apellidos}',  ' '), '') as t_ape
    from public.cotizaciones c
),
tit as (  -- titular identificado = misma regla que la app; el relleno "Cliente" sin apellidos ni documento NO es una persona
  select q.tenant, q.estado,
         count(*) as identificados,
         count(*) filter (where not exists (select 1 from public.cotizacion_participantes x
                                             where x.cotizacion_id = q.id and x.rol = 'titular' and x.activo)) as sin_vinculo
    from q
   where jsonb_typeof(q.payload -> 'cliente') = 'object'
     and (q.t_doc <> '' or q.t_nom <> '' or q.t_ape <> '')
     and not (q.t_nom = 'Cliente' and q.t_ape = '' and q.t_doc = '')
   group by 1, 2
),
fil as (  -- una fila por pasajero de payload.pasajeros que traiga documento, nombres o apellidos
  select q.id, q.tenant, q.estado,
         case when (e ->> 'ref') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (e ->> 'ref')::uuid end as ref
    from q
    cross join lateral jsonb_array_elements(case when jsonb_typeof(q.payload -> 'pasajeros') = 'array' then q.payload -> 'pasajeros' else '[]'::jsonb end) e
   where jsonb_typeof(e) = 'object'
     and (coalesce(btrim(e ->> 'numeroDoc',  ' '), '') <> ''
          or coalesce(btrim(e ->> 'nombres',   ' '), '') <> ''
          or coalesce(btrim(e ->> 'apellidos', ' '), '') <> '')
),
pas as (
  select f.tenant, f.estado,
         count(*) filter (where f.ref is not null) as con_ref,
         count(*) filter (where f.ref is not null and exists (select 1 from public.cotizacion_participantes x
                                                             where x.id = f.ref and x.cotizacion_id = f.id and x.rol = 'pasajero' and x.activo)) as con_ref_con_puesto,
         count(*) filter (where f.ref is null) as sin_ref_legado
    from fil f group by 1, 2
)
select 'T1 titular identificado sin puesto activo · ' || t.tenant || ' · ' || t.estado as control,
       t.sin_vinculo || ' de ' || t.identificados as observado,
       'informativo (la 219 no hace backfill; solo las abiertas son registrables)' as esperado,
       case when t.sin_vinculo = 0 then 'OK' else 'INFO' end as estado
  from tit t
union all
select 'P1 pasajero CON ref estable sin puesto activo · ' || p.tenant || ' · ' || p.estado,
       (p.con_ref - p.con_ref_con_puesto) || ' de ' || p.con_ref,
       'pendiente confirmado: el ref existe y no tiene puesto (0 esperado en abiertas)',
       case when p.con_ref = p.con_ref_con_puesto then 'OK' when p.estado = 'abierta' then 'REVISAR' else 'INFO' end
  from pas p
union all
select 'P2 pasajero SIN ref estable (legado) · ' || p.tenant || ' · ' || p.estado,
       p.sin_ref_legado::text,
       'NO acreditable: sin ref no se puede afirmar que falte; no es un faltante confirmado',
       case when p.sin_ref_legado = 0 then 'OK' else 'INFO' end
  from pas p
order by 1;
