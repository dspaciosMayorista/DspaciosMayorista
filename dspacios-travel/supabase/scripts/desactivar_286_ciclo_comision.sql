-- APAGAR el ciclo de vida de la comisión (#97/#75) SIN perder evidencia. Una transacción.
-- Efecto: SOLO cambia el tratamiento de los contratos NUEVOS que ya nacen confirmados/'activo' (histórico: la comisión nace al crear). Un contrato PENDIENTE (incluido el manual de Mayorista, decisión de #75)
-- conserva SIEMPRE su plan informativo y nunca una comisión exigible, con el interruptor en cualquier posición. Apagar NO materializa planes ni cambia estados comerciales.
-- CONSERVA: todos los planes, las comisiones ya materializadas y los pagos. Los contratos que quedaron PENDIENTES con su plan siguen materializándose al confirmarse
-- (la materialización no depende del interruptor), así que apagar no deja comisiones sin nacer.
begin;
do $$
declare k record; v_pend bigint;
begin
  select * into k from p97_priv.ciclo limit 1;
  if not found then raise exception 'DESACTIVAR_CICLO_286: la 286 no está aplicada.' using errcode = 'P0001'; end if;
  if not k.activo then raise exception 'DESACTIVAR_CICLO_286: el ciclo ya está apagado.' using errcode = 'P0001'; end if;
  update p97_priv.ciclo set activo = false;
  select count(*) into v_pend from public.comision_plan c join public.ventas v on v.contrato_uid = c.contrato_uid
   where v.estado = 'pendiente' and not exists (select 1 from public.aliados_b2b b where b.numero_contrato = v.numero_contrato and b.plan_id is not null);
  raise notice 'DESACTIVAR_CICLO_286: ciclo apagado. Planes conservados = %. Contratos pendientes con plan por materializar al confirmar = %.', (select count(*) from public.comision_plan), v_pend;
end $$;
select activo, activado_en from p97_priv.ciclo;
commit;
