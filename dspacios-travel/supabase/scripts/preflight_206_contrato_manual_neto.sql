-- PREFLIGHT · #30 contrato manual NETO (migración 206, 20260601000206_contrato_manual_neto.sql) — SOLO LECTURA.
-- Correr ANTES de aplicar la migración. Transacción READ ONLY + ROLLBACK, sin
-- datos personales. Cualquier 'FALLA' detiene la aplicación; 'INFO' no bloquea.
begin;
set transaction read only;

with chequeos(orden, chequeo, ok) as (
  values
  (1, 'mi_rol() (140), puede_ver_tenant(text) (107), soy_asesor_del_contrato(text) (142)',
      to_regprocedure('public.mi_rol()') is not null and to_regprocedure('public.puede_ver_tenant(text)') is not null
      and to_regprocedure('public.soy_asesor_del_contrato(text)') is not null),
  (2, 'la 205 está aplicada: aliados_b2b.base_explicita / descontada_en_precio y comision_b2b_descontada',
      (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'aliados_b2b'
         and column_name in ('base_explicita','descontada_en_precio')) = 2
      and to_regprocedure('public.comision_b2b_descontada(public.aliados_b2b)') is not null),
  (3, 'ventas: created_at / updated_at / modo_compra / comision_b2b / comision_estado / impuesto / aliado_id / tipo_asesor',
      (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'ventas'
         and column_name in ('created_at','updated_at','modo_compra','comision_b2b','comision_estado','impuesto','aliado_id','tipo_asesor')) = 8),
  (4, 'la migración aún no está aplicada',
      to_regprocedure('public.aplicar_neto_contrato_manual(text,bigint,numeric)') is null
      and to_regprocedure('public.tg_ventas_modalidad_b2b_inmutable()') is null
      and not exists (select 1 from pg_trigger where tgname = 'trg_ventas_modalidad_b2b_inmutable'))
)
select orden, case when ok then 'OK' else 'FALLA' end as resultado, chequeo from chequeos
union all
select 20, 'INFO', 'contratos NETO existentes (el trigger los deja inmutables en precio/impuesto/tipo/aliado): '
       || (select count(*) from public.ventas where comision_estado = 'descontada')
union all
select 21, 'INFO', 'contratos con modalidad B2B (modo_compra/comision_*) que ya no se podrán cambiar por UPDATE: '
       || (select count(*) from public.ventas where modo_compra is not null or comision_estado is not null or comision_b2b is not null)
order by 1;

rollback;
