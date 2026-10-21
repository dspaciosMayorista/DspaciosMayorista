-- ───────────────────────────────────────────────────────────────────────────
-- POSTCHECK 223 · cierre de #50 (modalidad PVP/NETO obligatoria). SOLO LECTURA (read only + ROLLBACK).
-- Correr DESPUÉS de aplicar la 223. Devuelve UNA sola fila consolidada:
--   veredicto OK solo si las 5 verificaciones (D1-D5) dan true; si no, FALLA. Un nulo cuenta como falla.
-- ───────────────────────────────────────────────────────────────────────────
begin transaction read only;

with
chequeos as (
  select 'D1' as codigo,
         coalesce((select c.exigir_modalidad from p50_priv.config c where c.id), false) as ok,
         'El interruptor p50_priv.config.exigir_modalidad está encendido' as detalle
  union all
  select 'D2', to_regclass('public.cotizacion_neto') is not null and to_regclass('public.cotizacion_neto_componentes') is not null
                and to_regprocedure('public.registrar_validacion_comparativa_n50(bigint,text,text,integer,text,uuid,numeric,text,boolean,jsonb,text,boolean,boolean)') is not null
                and to_regprocedure('public.resolver_solicitud_comparativa_n50(bigint,text,text,text,text,boolean,boolean)') is not null,
         'Los objetos de la 222 siguen presentes'
  union all
  select 'D3', (select count(*) from pg_catalog.pg_trigger t
                 where not t.tgisinternal and t.tgenabled in ('O', 'A')
                   and t.tgname in ('trg_cot_frontera_39', 'trg_cot_economico_rev_39', 'trg_cot_pagos_frontera_39', 'trg_cot_condiciones_frontera_39',
                                    'trg_cot_servicios_rev_39_ins', 'trg_cot_servicios_rev_39_upd', 'trg_cot_servicios_rev_39_del')) = 7,
         'La frontera de #39 sigue íntegra (7 disparadores habilitados)'
  union all
  select 'D4', md5(replace(coalesce((select prosrc from pg_proc where oid = to_regprocedure('public.convertir_cotizacion_a_contrato(bigint,uuid)')), ''), chr(13), ''))
                 = 'edc9975010746e53e4af6a75ad9763dc',
         'La RPC 198 de conversión conserva el cuerpo de main (md5)'
  union all
  select 'D5', true,
         'Informativo: hijas B2B abiertas sin sello (legadas, siguen en PVP): '
           || (select count(*) from public.cotizaciones h where h.cotizacion_origen_id is not null and h.tipo = 'manual' and h.estado = 'abierta'
                 and coalesce(h.payload->>'tipoAsesor', 'interno') <> 'interno'
                 and not exists (select 1 from public.cotizacion_neto n where n.cotizacion_id = h.id))
),
orden as (
  select c.codigo, coalesce(c.ok, false) as ok, c.detalle, row_number() over (order by length(c.codigo), c.codigo) as n
    from chequeos c
)
select case when count(*) filter (where not o.ok) = 0 then 'OK' else 'FALLA' end as veredicto,
       count(*) filter (where o.ok)::int as ok,
       count(*) filter (where not o.ok)::int as fallos,
       count(*)::int as chequeos,
       coalesce(string_agg(o.codigo, ', ' order by o.n) filter (where not o.ok), 'ninguno') as fallidos,
       string_agg(o.codigo || '=' || case when o.ok then 't' else 'f' end, ';' order by o.n) as resumen,
       jsonb_agg(jsonb_build_object('codigo', o.codigo, 'ok', o.ok, 'detalle', o.detalle) order by o.n) as detalle
  from orden o;

rollback;
