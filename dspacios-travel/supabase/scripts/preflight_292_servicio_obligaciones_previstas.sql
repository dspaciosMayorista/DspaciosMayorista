-- PREFLIGHT de la migración 292 (#75). SOLO LECTURA: una consulta, un resultado. Última fila: VEREDICTO («APLICAR» solo si todo está OK; REVISAR detiene).
-- Correr inmediatamente después de postcheck_288. El punto 4 cuenta las previstas que YA violan la regla (p. ej. creadas en la ventana 288→292): la 292 las rechaza
-- y no se aplica hasta revisarlas; el punto 5 las lista (máx. 50) para esa revisión.
with prev as (
  select p.id, p.numero_contrato, p.payload,
         substring(coalesce(p.payload->>'observaciones', '') from 'enlace:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\s*$') as clave
    from public.contrato_obligaciones_previstas p where p.materializada_en is null
),
malas as (
  select pv.id, pv.numero_contrato,
         case when nullif(pv.payload->>'numero_contrato', '') is not null and pv.payload->>'numero_contrato' <> pv.numero_contrato then 'payload de otro contrato'
              when nullif(pv.payload->>'servicio_id', '') is not null and not exists (select 1 from public.servicios_adicionales s where s.id = (pv.payload->>'servicio_id')::bigint) then 'servicio inexistente'
              when pv.clave is null and nullif(pv.payload->>'contrato_servicio_id', '') is not null then 'vínculo sin clave'
              when pv.clave is not null and cs.id is null then 'clave sin línea'
              when pv.clave is not null and (cs.numero_contrato <> pv.numero_contrato or cs.servicio_id is distinct from nullif(pv.payload->>'servicio_id', '')::bigint or cs.alcance_traslado is null
                                             or (nullif(pv.payload->>'contrato_servicio_id', '') is not null and (pv.payload->>'contrato_servicio_id')::bigint <> cs.id)) then 'línea ajena o distinta'
         end as motivo
    from prev pv left join public.contrato_servicios cs on cs.clave_enlace = pv.clave::uuid
),
v(orden, control, obs, esp) as (
  values
    (1, 'la 288 está aplicada (contrato_obligaciones_previstas existe)', (to_regclass('public.contrato_obligaciones_previstas') is not null)::text, 'true'),
    (2, 'tg_linea_enlazada_protegida es la de la 265 (md5 336c54ae9bd8a9bfacd3127ed7e7d7b7)',
        coalesce((select md5(replace(prosrc, chr(13), '')) from pg_proc where oid = to_regprocedure('public.tg_linea_enlazada_protegida()')), '-'), '336c54ae9bd8a9bfacd3127ed7e7d7b7'),
    (3, 'la 292 NO está aplicada (sin trigger servicio_con_previstas)', (select count(*) from pg_trigger where tgname = 'servicio_con_previstas' and not tgisinternal)::text, '0'),
    (4, 'previstas sin materializar que ya violan la regla', (select count(*) from malas where motivo is not null)::text, '0'),
    (5, 'detalle (máx. 50): id/contrato/motivo', coalesce((select string_agg(id || '/' || numero_contrato || '/' || motivo, '; ') from (select * from malas where motivo is not null order by id limit 50) m), ''), ''),
    (6, 'INFO: previstas sin materializar con servicio_id (las que protegerá la 292)', (select count(*) from prev where nullif(payload->>'servicio_id', '') is not null)::text, null),
    (7, 'INFO: de ellas, enlazadas a una línea por clave', (select count(*) from prev where clave is not null)::text, null)
),
r as (select orden, control, obs as observado, esp as esperado, case when esp is null then 'INFO' when obs = esp then 'OK' else 'REVISAR' end as estado from v)
select orden, control, observado, esperado, estado from r
union all
select 99, 'VEREDICTO', (select count(*) from r where estado = 'REVISAR')::text || ' punto(s) a revisar', '0', case when (select count(*) from r where estado = 'REVISAR') = 0 then 'APLICAR' else 'NO APLICAR' end
order by orden;
