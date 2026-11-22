-- PREFLIGHT 317 (#48: cotización dinámica B2B normal con precio NETO) — UNA sola consulta, SOLO LECTURA. Correr ANTES de la 317.
-- Los INFO se anotan: el postcheck debe dar las MISMAS cifras (la 317 no cambia ninguna fila). Los controles 2-4 confirman que las funciones que la 317 reemplaza
-- (sellar_hija de la 222 y bloquear_para_editar de la 216) siguen siendo EXACTAMENTE las auditadas: si no, la 317 se niega a aplicarse.
with f as (
  select
    to_regprocedure('p50_priv.sellar_hija(bigint,text,boolean,boolean,uuid)') as sellar,
    to_regprocedure('p39_priv.bloquear_para_editar(bigint,uuid,integer,text)') as bloquear,
    to_regprocedure('public.crear_cotizacion_manual(uuid,text,jsonb,jsonb)') as crear,
    to_regprocedure('public.crear_cotizacion_manual_neto(uuid,text,jsonb,jsonb,bigint,boolean,boolean)') as nueva,
    to_regprocedure('p97_priv.validar(bigint)') as p97_validar,
    to_regclass('public.cotizacion_neto') as sello
), t as (
  select f.*,
    (select prosrc from pg_proc where oid = f.sellar) as src_sellar,
    (select prosrc from pg_proc where oid = f.bloquear) as src_bloquear
  from f
)
select orden, control, observado, esperado, estado from (
  select 1 as orden, 'Piezas previas presentes (216, 222, 286)' as control,
         (sellar is not null and bloquear is not null and crear is not null and p97_validar is not null and sello is not null)::text as observado, 'true' as esperado,
         case when sellar is not null and bloquear is not null and crear is not null and p97_validar is not null and sello is not null then 'OK' else 'REVISAR' end as estado from t
  union all select 2, 'sellar_hija trae la guarda de la 222 (antes de la 317) o la de la 317 (ya aplicada)',
         case when src_sellar is null then 'sin función'
              when position('h.cotizacion_origen_id is null or h.tipo is distinct from ''manual''' in src_sellar) > 0 then 'guarda de la 222 (falta aplicar)'
              when position('h.paquete_din_id is not null' in src_sellar) > 0 then 'guarda de la 317 (ya aplicada)' else 'DESCONOCIDA' end,
         '222 o 317', case when src_sellar is not null and (position('h.cotizacion_origen_id is null or h.tipo is distinct from ''manual''' in src_sellar) > 0 or position('h.paquete_din_id is not null' in src_sellar) > 0) then 'OK' else 'REVISAR' end from t
  union all select 3, 'bloquear_para_editar es el cuerpo de la 216 (sin la guarda NETO) o ya trae la de la 317',
         case when src_bloquear is null then 'sin función'
              when position('NETO fijado' in src_bloquear) > 0 then 'guarda de la 317 (ya aplicada)'
              when position('solo se editan cotizaciones dinámicas simples' in src_bloquear) > 0 then 'cuerpo de la 216 (falta aplicar)' else 'DESCONOCIDA' end,
         '216 o 317', case when src_bloquear is not null and (position('NETO fijado' in src_bloquear) > 0 or position('solo se editan cotizaciones dinámicas simples' in src_bloquear) > 0) then 'OK' else 'REVISAR' end from t
  union all select 4, 'La función nueva aún no existe (false antes de la 317; true si ya se corrió)', (nueva is not null)::text, 'false antes de la 317', 'INFO' from t
  union all select 5, 'La frontera de #39 está activa', coalesce((select p39_priv.frontera_activa())::text, 'sin frontera'), 'true',
         case when coalesce((select p39_priv.frontera_activa()), false) then 'OK' else 'REVISAR' end from t
  union all select 6, 'Sellos NETO existentes: total / de cotizaciones SIN origen de comparativa (histórico; anotar, igual en el postcheck)',
         (select count(*) from public.cotizacion_neto where modalidad = 'neto')::text || ' / ' ||
         (select count(*) from public.cotizacion_neto n join public.cotizaciones c on c.id = n.cotizacion_id where n.modalidad = 'neto' and c.cotizacion_origen_id is null)::text,
         'anotar', 'INFO' from t
) r order by orden;
