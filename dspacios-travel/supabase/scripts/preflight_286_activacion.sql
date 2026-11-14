-- PREFLIGHT de la FASE 3 de la 286: ACTIVAR la exigencia del acuerdo de comisión (#97). SOLO LECTURA: una consulta, un resultado.
-- Se ejecuta DESPUÉS de aplicar la 286, de desplegar el código nuevo y de validarlo. Columnas: control | observado | esperado | estado.
-- estado: OK / FALLA (bloquea) / INFO. Última fila: veredicto («LISTO PARA ACTIVAR» solo si no hay ninguna FALLA).
with v(orden, control, obs, esp, critico) as (
  values
    (1, 'la 286 está aplicada (existe p97_priv.corte)', (select (to_regclass('p97_priv.corte') is not null)::text), 'true', true),
    (2, 'la exigencia está APAGADA hoy (primera activación o reactivación tras desactivar)',
        (select coalesce((select (not exigir)::text from p97_priv.corte limit 1), 'sin tabla')), 'true', true),
    (3, 'el código nuevo ya creó al menos un acuerdo (prueba de que está desplegado y funciona)',
        (select (count(*) > 0)::text from public.comision_plan where cotizacion_id is not null), 'true', true),
    -- Si el código VIEJO sigue sirviendo, crea B2B dinámicas sin acuerdo: activar ahora las dejaría bloqueadas. 30 minutos sin ninguna = el viejo ya no sirve.
    (4, 'ninguna cotización dinámica B2B independiente SIN acuerdo creada en los últimos 30 min (el código viejo ya no está sirviendo)',
        (select count(*)::text from public.cotizaciones c
          where c.tipo = 'manual' and c.modo = 'simple' and c.cotizacion_origen_id is null and c.paquete_din_id is null and c.aliado_id is null
            and coalesce(c.payload ->> 'tipoAsesor', 'interno') in ('agencia', 'freelance')
            and c.created_at > now() - interval '30 minutes'
            and not exists (select 1 from public.comision_plan a where a.cotizacion_id = c.id)), '0', true),
    -- En una REACTIVACIÓN el corte ya existe: lo posterior a él sin acuerdo quedaría bloqueado.
    (5, 'ninguna B2B dinámica independiente abierta SIN acuerdo posterior al corte ya fijado (reactivación)',
        (select count(*)::text from public.cotizaciones c, p97_priv.corte k
          where k.cotizacion_id_max is not null and c.id > k.cotizacion_id_max
            and c.tipo = 'manual' and c.modo = 'simple' and c.cotizacion_origen_id is null and c.paquete_din_id is null and c.aliado_id is null and c.estado = 'abierta'
            and coalesce(c.payload ->> 'tipoAsesor', 'interno') in ('agencia', 'freelance')
            and not exists (select 1 from public.comision_plan a where a.cotizacion_id = c.id)), '0', true),
    (6, 'INFO · corte que quedaría FIJADO al activar (mayor id de cotización hoy; en una reactivación se conserva el ya fijado)',
        (select coalesce((select cotizacion_id_max from p97_priv.corte limit 1), (select max(id) from public.cotizaciones), 0)::text), 'informativo', false),
    (7, 'INFO · B2B dinámicas abiertas sin acuerdo que quedarán HISTÓRICAS (se convierten como siempre; no se bloquean)',
        (select count(*)::text from public.cotizaciones c
          where c.tipo = 'manual' and c.modo = 'simple' and c.cotizacion_origen_id is null and c.paquete_din_id is null and c.aliado_id is null and c.estado = 'abierta'
            and coalesce(c.payload ->> 'tipoAsesor', 'interno') in ('agencia', 'freelance')
            and not exists (select 1 from public.comision_plan a where a.cotizacion_id = c.id)), 'informativo', false),
    (8, 'INFO · acuerdos sellados hasta hoy', (select count(*)::text from public.comision_plan), 'informativo', false)
),
r as (
  select orden, control, obs as observado, esp as esperado,
         case when not critico then 'INFO' when obs = esp then 'OK' else 'FALLA' end as estado
  from v
)
select orden, control, observado, esperado, estado from r
union all
select 99, 'VEREDICTO', (select count(*) from r where estado = 'FALLA')::text || ' falla(s)', '0 fallas',
       case when (select count(*) from r where estado = 'FALLA') = 0 then 'LISTO PARA ACTIVAR' else 'NO ACTIVAR' end
order by orden;
