-- PREFLIGHT del CICLO DE VIDA de la comisión (#97/#75): ¿se puede ENCENDER? SOLO LECTURA: una consulta, un resultado. Columnas: control | observado | esperado | estado.
-- Se ejecuta DESPUÉS de aplicar la 286 y la 288 (de #75) y de desplegar el código. La 286 deja el ciclo APAGADO; no cambia la regla comercial por detectar funciones.
with dep as (
  select d.dependencia, d.cumplida, d.detalle, row_number() over () as n from p97_priv.dependencias_ciclo() d
),
v(orden, control, obs, esp, critico) as (
  select 10 + n, 'DEPENDENCIA · ' || dependencia, case when cumplida then 'cumplida' else 'FALTA: ' || detalle end, 'cumplida', true from dep
  union all
  select 1, 'la 286 está aplicada (existe p97_priv.ciclo)', (to_regclass('p97_priv.ciclo') is not null)::text, 'true', true
  union all
  select 2, 'el ciclo está APAGADO hoy (primera activación o reactivación)', coalesce((select (not c.activo)::text from p97_priv.ciclo c limit 1), 'sin tabla'), 'true', true
  union all
  select 30, 'INFO · planes de contrato escritos hasta hoy (un contrato pendiente registra plan con el ciclo encendido o apagado; los NETO y los internos no tienen plan)', (select count(*)::text from public.comision_plan where contrato_uid is not null), 'informativo', false
  union all
  select 31, 'INFO · contratos B2B PENDIENTES con comisión exigible HISTÓRICA (no se tocan: se diagnostican con diagnostico_286_comisiones_historicas.sql)',
         (select count(distinct b.numero_contrato)::text from public.aliados_b2b b join public.ventas x on x.numero_contrato = b.numero_contrato
           where x.estado = 'pendiente' and not coalesce(b.descontada_en_precio, false) and b.plan_id is null), 'informativo', false
  union all
  select 32, 'INFO · contratos manuales creados en los últimos 30 min en estado ''activo'' (si hay, el código anterior aún sirve: los manuales nuevos nacerán pendientes con el código nuevo, y su comisión será solo plan con el ciclo en cualquier posición)',
         (select count(*)::text from public.ventas x where x.estado = 'activo' and x.created_at > now() - interval '30 minutes'), 'informativo', false
),
r as (
  select orden, control, obs as observado, esp as esperado,
         case when not critico then 'INFO' when obs = esp then 'OK' else 'FALLA' end as estado
  from v
)
select orden, control, observado, esperado, estado from r
union all
select 99, 'VEREDICTO', (select count(*) from r where estado = 'FALLA')::text || ' falla(s)', '0 fallas',
       case when (select count(*) from r where estado = 'FALLA') = 0 then 'LISTO PARA ENCENDER EL CICLO' else 'NO ENCENDER (ver las dependencias que faltan)' end
order by orden;
