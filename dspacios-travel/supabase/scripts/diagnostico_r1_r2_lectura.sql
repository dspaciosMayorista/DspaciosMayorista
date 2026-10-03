-- ───────────────────────────────────────────────────────────────────────────
-- DIAGNÓSTICO R1 / R2 · EXCLUSIVAMENTE DE LECTURA (diseño §6.8.4).
--
-- R1: sillas "disponibles" que conservan datos (residuos de liberaciones
--     antiguas o pasajeros de carga masiva sin contrato) y cuánto cambiaría
--     el cupo vendible si las reservas tomaran solo sillas libres de verdad
--     (propuesta supabase/propuestas/reservas_solo_sillas_libres.sql).
-- R2: sillas devueltas / no vendidas que todavía tienen contrato (las que hoy
--     eliminar_contrato devolvería a "disponible").
--
-- No escribe, no crea objetos, no depende de las migraciones 194–197 (repite
-- la regla de "datos del grupo D" en línea). Corre en una transacción READ
-- ONLY. Privacidad: solo conteos y PNR (record); nunca nombres, documentos
-- ni fechas de nacimiento.
--
-- Columnas: seccion · control · valor · detalle
-- ───────────────────────────────────────────────────────────────────────────
begin transaction read only;

with
hoy as (select (now() at time zone 'America/Bogota')::date as d),
s as (
  select s.*, b.record, b.fecha_ida, (b.fecha_ida >= (select d from hoy)) as futuro,
    (coalesce(btrim(s.pasajero_nombres), '') <> '' or coalesce(btrim(s.pasajero_apellidos), '') <> ''
     or coalesce(btrim(s.tipo_doc), '') <> '' or coalesce(btrim(s.numero_doc), '') <> '' or s.nacimiento is not null) as d_adulto,
    (coalesce(btrim(s.inf_nombres), '') <> '' or coalesce(btrim(s.inf_apellidos), '') <> '' or coalesce(btrim(s.inf_tipo_doc), '') <> ''
     or coalesce(btrim(s.inf_numero), '') <> '' or s.inf_nacimiento is not null or coalesce(btrim(s.responsable_menor), '') <> '') as d_infante,
    (coalesce(btrim(s.agencia), '') <> '' or coalesce(btrim(s.asesor), '') <> '' or coalesce(btrim(s.hotel), '') <> ''
     or coalesce(btrim(s.acomodacion), '') <> '' or s.plazo is not null) as d_operativo
  from public.sillas s join public.bloqueos_vuelo b on b.id = s.bloqueo_id
),
r1 as (  -- vendibles por estado, sin contrato, con algún dato
  select * from s
   where estado::text in ('disponible', 'cambio_entrante') and numero_contrato is null and contrato_manual is null
     and (d_adulto or d_infante or d_operativo)
),
r1c as (
  select r1.*,
    case
      when coalesce(btrim(r1.numero_doc), '') = '' then 'sin_documento'
      when exists (select 1 from public.contrato_pasajeros cp join public.ventas v on v.numero_contrato = cp.numero_contrato
                    where upper(btrim(cp.identificacion)) = upper(btrim(r1.numero_doc)) and v.estado in ('pendiente', 'confirmado', 'activo'))
        then 'documento_en_contrato_vigente'
      when exists (select 1 from public.contrato_pasajeros cp join public.ventas v on v.numero_contrato = cp.numero_contrato
                    where upper(btrim(cp.identificacion)) = upper(btrim(r1.numero_doc)) and v.estado = 'cancelado')
        then 'documento_en_contrato_cancelado'
      else 'documento_sin_contrato'
    end as clase
  from r1
),
impacto as (  -- cupo vendible actual (por estado) vs real (libre de verdad), records futuros
  select record, fecha_ida,
         count(*) filter (where estado::text in ('disponible', 'cambio_entrante')) as vendible_hoy,
         count(*) filter (where estado::text in ('disponible', 'cambio_entrante') and numero_contrato is null and contrato_manual is null
                            and not (d_adulto or d_infante or d_operativo)) as vendible_real
    from s where futuro group by record, fecha_ida
),
r2 as (
  select * from s where estado::text in ('devuelta', 'no_vendida') and (numero_contrato is not null or contrato_manual is not null)
)
select * from (
  select 1 o, 'R1' seccion, 'sillas vendibles por estado con datos (todas)' control, count(*)::text valor,
         'disponible/cambio_entrante sin contrato con algún dato del grupo D' detalle from r1
  union all select 2, 'R1', 'de ellas en records futuros', count(*)::text, 'fecha_ida >= hoy (Bogotá): son las que afectan el cupo vendible' from r1 where futuro
  union all select 3, 'R1', 'con datos de adulto', count(*)::text, 'nombre, apellido, tipo/número de documento o nacimiento' from r1 where d_adulto
  union all select 4, 'R1', 'solo datos de infante/responsable', count(*)::text, 'sin datos de adulto' from r1 where d_infante and not d_adulto
  union all select 5, 'R1', 'solo datos operativos', count(*)::text, 'agencia, asesor, hotel, acomodación o plazo (residuo típico)' from r1 where d_operativo and not d_adulto and not d_infante
  union all select 6, 'R1', 'clase: ' || clase, count(*)::text,
         case clase
           when 'documento_en_contrato_cancelado' then 'probable residuo de reserva vencida (liberarVencidas)'
           when 'documento_en_contrato_vigente' then 'REVISAR: el pasajero tiene un contrato vigente pero su silla figura libre'
           when 'documento_sin_contrato' then 'posible pasajero de carga masiva o residuo de contrato eliminado'
           else 'sin documento: solo datos parciales u operativos' end
    from r1c group by clase
  union all select 20, 'R1-impacto', 'records futuros que cambian de cupo vendible', count(*)::text,
         'records con vendible_real < vendible_hoy' from impacto where vendible_real < vendible_hoy
  union all select 21, 'R1-impacto', 'cupo vendible futuro hoy → real', coalesce(sum(vendible_hoy), 0)::text || ' → ' || coalesce(sum(vendible_real), 0)::text,
         'suma en records futuros; la diferencia dejaría de venderse' from impacto
  union all select 22, 'R1-impacto', 'muestra (máx. 10): PNR · fecha · hoy → real',
         coalesce(string_agg(record || ' · ' || coalesce(fecha_ida::text, '—') || ' · ' || vendible_hoy || ' → ' || vendible_real, ' | '), '—'),
         'los records con mayor diferencia'
    from (select * from impacto where vendible_real < vendible_hoy order by vendible_hoy - vendible_real desc, record limit 10) m
  union all select 30, 'R2', 'sillas devueltas con contrato', count(*)::text, 'hoy eliminar_contrato las volvería disponibles' from r2 where estado::text = 'devuelta'
  union all select 31, 'R2', 'sillas no vendidas con contrato', count(*)::text, 'idem' from r2 where estado::text = 'no_vendida'
  union all select 32, 'R2', 'contratos afectados', count(distinct coalesce(numero_contrato, 'manual:' || contrato_manual))::text, 'orgánicos o manuales' from r2
  union all select 33, 'R2', 'muestra (máx. 10): PNR · estado', coalesce(string_agg(record || ' · ' || estado::text, ' | '), '—'), ''
    from (select record, estado from r2 order by record limit 10) m
) t order by o, control;

rollback;
