-- PREFLIGHT 338 (ADL-041/042: air vouchers per CONTRACTED SERVICE with a saved service identity + «voucher updated / not current» signal). READ ONLY, ONE QUERY (control | observed | expected | verdict). Run BEFORE applying 338 (after 337).
-- Verdicts: OK · REVIEW (apply is safe, decide first) · BLOCK. No personal data (counts only).
begin transaction read only;

with chequeos as (
  select 1 as n, '338 needs 337: the one-per-contract air voucher index exists' as control,
         (select count(*)::text from pg_indexes where schemaname = 'public' and indexname = 'vouchers_vuelo_uno_por_contrato') as observado, '1' as esperado,
         case when exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'vouchers_vuelo_uno_por_contrato') then 'OK' else 'BLOCK' end as veredicto
  union all
  select 2, '338 needs 309: acknowledgment table and the three Gestión functions exist',
         ((to_regclass('public.contrato_seguimiento') is not null)::int + (to_regprocedure('public.seguimiento_referencia(text,text)') is not null)::int
          + (to_regprocedure('public.registrar_seguimiento_contrato(text,uuid,text,text,text,text)') is not null)::int + (to_regprocedure('public.fn_gestion_contratos(jsonb,text,integer,integer)') is not null)::int)::text, '4',
         case when to_regclass('public.contrato_seguimiento') is not null and to_regprocedure('public.seguimiento_referencia(text,text)') is not null
                   and to_regprocedure('public.registrar_seguimiento_contrato(text,uuid,text,text,text,text)') is not null and to_regprocedure('public.fn_gestion_contratos(jsonb,text,integer,integer)') is not null then 'OK' else 'BLOCK' end
  union all
  select 3, '338 not applied yet: vouchers has none of servicio_clave / revision / actualizado_en / estado / huella and contrato_vuelos has no servicio_aereo',
         ((select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'vouchers' and column_name in ('servicio_clave', 'revision', 'actualizado_en', 'estado', 'huella'))
          + (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'contrato_vuelos' and column_name = 'servicio_aereo'))::text, '0',
         case when not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'vouchers' and column_name in ('servicio_clave', 'revision', 'actualizado_en', 'estado', 'huella'))
                   and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'contrato_vuelos' and column_name = 'servicio_aereo') then 'OK' else 'BLOCK' end
  union all
  select 4, 'air vouchers today (none is deleted; see control 5 for how each is keyed)',
         (select count(*)::text from public.vouchers where tipo = 'vuelo'), 'any', 'OK'
  union all
  select 5, 'air vouchers whose contract legs have NO unambiguous shape (they get the key «legado-<id>» and estado «revisar»: their old link stops serving the itinerary until staff associate the legs and regenerate)',
         (select count(*)::text from public.vouchers v where v.tipo = 'vuelo' and not exists (select 1 from public.contrato_vuelos c where c.numero_contrato = v.numero_contrato group by c.numero_contrato having (count(*) = 1 or (count(*) = 2 and count(*) filter (where direccion = 'ida') = 1 and count(*) filter (where direccion = 'regreso') = 1)))), '0',
         case when exists (select 1 from public.vouchers v where v.tipo = 'vuelo' and not exists (select 1 from public.contrato_vuelos c where c.numero_contrato = v.numero_contrato group by c.numero_contrato having (count(*) = 1 or (count(*) = 2 and count(*) filter (where direccion = 'ida') = 1 and count(*) filter (where direccion = 'regreso') = 1)))) then 'REVIEW' else 'OK' end
  union all
  select 6, 'contracts with more than one air voucher today (impossible after 337)',
         (select count(*)::text from (select 1 from public.vouchers where tipo = 'vuelo' group by numero_contrato having count(*) > 1) d), '0',
         case when exists (select 1 from public.vouchers where tipo = 'vuelo' group by numero_contrato having count(*) > 1) then 'BLOCK' else 'OK' end
  union all
  select 8, 'contracts whose legs stay WITHOUT a saved service after the install (more than one leg and not exactly one outbound + one return): staff must associate them in the flight editor before generating air vouchers; nothing breaks',
         (select count(*)::text from (select 1 from public.contrato_vuelos group by numero_contrato having not (count(*) = 1 or (count(*) = 2 and count(*) filter (where direccion = 'ida') = 1 and count(*) filter (where direccion = 'regreso') = 1))) d), '0',
         case when exists (select 1 from public.contrato_vuelos group by numero_contrato having not (count(*) = 1 or (count(*) = 2 and count(*) filter (where direccion = 'ida') = 1 and count(*) filter (where direccion = 'regreso') = 1))) then 'REVIEW' else 'OK' end
  union all
  select 7, 'voucher acknowledgments already registered (they keep working: no rev = 0; nothing is flagged until a voucher really changes)',
         (select count(*)::text from public.contrato_seguimiento where tipo = 'voucher_entregado'), 'any', 'OK'
)
select control, observado as observed, esperado as expected, veredicto as verdict from chequeos order by n;

rollback;
