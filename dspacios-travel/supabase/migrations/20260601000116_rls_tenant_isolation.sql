-- ───────────────────────────────────────────────────────────────────────────
-- 116 · RLS: aislar datos financieros/contratos por tenant (mayorista/minorista)
--
--  La migración 107 agregó la columna `tenant` y las funciones `mi_tenant()` /
--  `puede_ver_tenant()`, pero ninguna política de RLS las usaba todavía: hasta
--  ahora las políticas de ventas/abonos/cuentas_por_pagar/aliados_b2b/
--  liquidacion_comisiones/facturacion/punto_equilibrio/contabilidad filtraban
--  SOLO por rol, así que un usuario administracion/operaciones/venta de UNA
--  agencia podía leer y escribir datos de la OTRA agencia (la separación por
--  tenant era solo un filtro de UI, no de base de datos). Este script reemplaza
--  esas políticas agregando `and public.puede_ver_tenant(tenant)` — superadmin y
--  gerencia siguen viendo ambas agencias (ya definido en puede_ver_tenant());
--  el resto de roles queda acotado a su agencia (`usuarios.tenant`).
--
--  Idempotente: cada policy se DROPea antes de recrearse. No cambia nombres de
--  policy ni de tabla, solo agrega la condición de tenant.
-- ───────────────────────────────────────────────────────────────────────────

-- ── ventas ──────────────────────────────────────────────────────────────
drop policy if exists "ventas: lectura operativa" on public.ventas;
create policy "ventas: lectura operativa"
  on public.ventas for select
  using (
    public.mi_rol() in ('superadmin','gerencia','administracion','operaciones')
    and public.puede_ver_tenant(tenant)
  );

drop policy if exists "ventas: asesor ve sus contratos" on public.ventas;
create policy "ventas: asesor ve sus contratos"
  on public.ventas for select
  using (
    public.mi_rol() = 'venta' and
    asesor = (select email from public.usuarios where id = auth.uid()) and
    public.puede_ver_tenant(tenant)
  );

drop policy if exists "ventas: escritura operaciones y venta" on public.ventas;
create policy "ventas: escritura operaciones y venta"
  on public.ventas for insert
  with check (
    public.mi_rol() in ('superadmin','administracion','operaciones','venta')
    and public.puede_ver_tenant(tenant)
  );

drop policy if exists "ventas: actualizar operaciones" on public.ventas;
create policy "ventas: actualizar operaciones"
  on public.ventas for update
  using (
    public.mi_rol() in ('superadmin','administracion','operaciones')
    and public.puede_ver_tenant(tenant)
  );

-- ── contable (abonos / cuentas por pagar / comisiones B2B / liquidación / facturación) ──
drop policy if exists "abonos: acceso contable" on public.abonos;
create policy "abonos: acceso contable"
  on public.abonos for all
  using (
    public.mi_rol() in ('superadmin','gerencia','administracion','operaciones')
    and public.puede_ver_tenant(tenant)
  );

drop policy if exists "cpp: acceso contable" on public.cuentas_por_pagar;
create policy "cpp: acceso contable"
  on public.cuentas_por_pagar for all
  using (
    public.mi_rol() in ('superadmin','gerencia','administracion','operaciones')
    and public.puede_ver_tenant(tenant)
  );

drop policy if exists "aliados_b2b: acceso contable" on public.aliados_b2b;
create policy "aliados_b2b: acceso contable"
  on public.aliados_b2b for all
  using (
    public.mi_rol() in ('superadmin','gerencia','administracion','operaciones')
    and public.puede_ver_tenant(tenant)
  );

drop policy if exists "liquidacion: acceso contable" on public.liquidacion_comisiones;
create policy "liquidacion: acceso contable"
  on public.liquidacion_comisiones for all
  using (
    public.mi_rol() in ('superadmin','gerencia','administracion')
    and public.puede_ver_tenant(tenant)
  );

drop policy if exists "facturacion: acceso contable" on public.facturacion;
create policy "facturacion: acceso contable"
  on public.facturacion for all
  using (
    public.mi_rol() in ('superadmin','gerencia','administracion')
    and public.puede_ver_tenant(tenant)
  );

-- ── punto de equilibrio (migración 101) ────────────────────────────────
drop policy if exists "pe_empleados: acceso contable" on public.pe_empleados;
create policy "pe_empleados: acceso contable"
  on public.pe_empleados for all
  using (
    public.mi_rol() in ('superadmin','gerencia','administracion')
    and public.puede_ver_tenant(tenant)
  );

drop policy if exists "pe_costos: acceso contable" on public.pe_costos;
create policy "pe_costos: acceso contable"
  on public.pe_costos for all
  using (
    public.mi_rol() in ('superadmin','gerencia','administracion')
    and public.puede_ver_tenant(tenant)
  );

-- ── contabilidad: movimientos / conciliaciones (migraciones 103/104) ───
drop policy if exists "contabilidad_movimientos: acceso contable" on public.contabilidad_movimientos;
create policy "contabilidad_movimientos: acceso contable"
  on public.contabilidad_movimientos for all
  using (
    public.mi_rol() in ('superadmin','gerencia','administracion')
    and public.puede_ver_tenant(tenant)
  );

drop policy if exists "conc_extracto: contable" on public.conciliacion_extracto;
create policy "conc_extracto: contable"
  on public.conciliacion_extracto for all
  using (
    public.mi_rol() in ('superadmin','gerencia','administracion')
    and public.puede_ver_tenant(tenant)
  );

drop policy if exists "conc: contable" on public.conciliacion;
create policy "conc: contable"
  on public.conciliacion for all
  using (
    public.mi_rol() in ('superadmin','gerencia','administracion')
    and public.puede_ver_tenant(tenant)
  );
