-- ───────────────────────────────────────────────────────────────────────────
-- 137 · Alinear roles de escritura RLS con la intención ya documentada en
-- código: "roles internos ADMIN (superadmin/administracion/gerencia) tienen
-- acceso total, nunca se bloquean" (lib/roles.ts, ADMIN_ROLES).
--
-- El parche puntual de la migración 136 (proveedores) resolvió un síntoma,
-- pero el mismo patrón — un módulo de UI accesible a un rol que la RLS de su
-- tabla no autoriza a escribir — se repite en varias tablas más, encontradas
-- en una auditoría completa. Esta migración es LA fuente única de verdad de
-- "qué rol escribe qué" a nivel de base de datos; el registro equivalente en
-- código vive en `lib/roles.ts` (ambos deben mantenerse sincronizados a mano
-- — Postgres no puede importar una constante de TypeScript).
--
-- Regla general aplicada: TODA política de escritura interna debe incluir
-- como mínimo a superadmin+administracion+gerencia (ADMIN_ROLES), más el o
-- los roles operativos específicos del dominio (operaciones para catálogo de
-- producto, control_vuelo para vuelos, venta para sus propias ventas/
-- contratos). Ningún caso aquí AMPLÍA acceso a roles externos (agencia,
-- freelance, cliente_final) ni cambia las políticas de LECTURA, que ya eran
-- consistentes (todo interno puede consultar).
-- ───────────────────────────────────────────────────────────────────────────

-- ── Producto (catálogo): destinos, hoteles, tarifas, aerolíneas ──────────────
-- Antes: solo superadmin+operaciones. administracion/gerencia veían el botón
-- "editar" en el dashboard (son ADMIN_ROLES) pero el guardado fallaba.
drop policy if exists "destinos: escritura admin" on public.destinos;
create policy "destinos: escritura admin"
  on public.destinos for all
  using (public.mi_rol() in ('superadmin','administracion','gerencia','operaciones'))
  with check (public.mi_rol() in ('superadmin','administracion','gerencia','operaciones'));

drop policy if exists "hoteles: escritura admin" on public.hoteles;
create policy "hoteles: escritura admin"
  on public.hoteles for all
  using (public.mi_rol() in ('superadmin','administracion','gerencia','operaciones'))
  with check (public.mi_rol() in ('superadmin','administracion','gerencia','operaciones'));

drop policy if exists "tarifas: escritura operaciones" on public.tarifas;
create policy "tarifas: escritura operaciones"
  on public.tarifas for all
  using (public.mi_rol() in ('superadmin','administracion','gerencia','operaciones'))
  with check (public.mi_rol() in ('superadmin','administracion','gerencia','operaciones'));

drop policy if exists "tarifa_precios: escritura operaciones" on public.tarifa_precios;
create policy "tarifa_precios: escritura operaciones"
  on public.tarifa_precios for all
  using (public.mi_rol() in ('superadmin','administracion','gerencia','operaciones'))
  with check (public.mi_rol() in ('superadmin','administracion','gerencia','operaciones'));

drop policy if exists "aerolineas: escritura admin" on public.aerolineas;
create policy "aerolineas: escritura admin"
  on public.aerolineas for all
  using (public.mi_rol() in ('superadmin','administracion','gerencia','operaciones'))
  with check (public.mi_rol() in ('superadmin','administracion','gerencia','operaciones'));

drop policy if exists "aerolinea_tarifas: escritura admin" on public.aerolinea_tarifas;
create policy "aerolinea_tarifas: escritura admin"
  on public.aerolinea_tarifas for all
  using (public.mi_rol() in ('superadmin','administracion','gerencia','operaciones'))
  with check (public.mi_rol() in ('superadmin','administracion','gerencia','operaciones'));

-- ── Proveedores (completa la 136: le faltaba gerencia) ───────────────────────
drop policy if exists "proveedores: escritura admin" on public.proveedores;
create policy "proveedores: escritura admin"
  on public.proveedores for all
  using (public.mi_rol() in ('superadmin','administracion','gerencia','operaciones'))
  with check (public.mi_rol() in ('superadmin','administracion','gerencia','operaciones'));

-- ── Aliados / Asesores (catálogos administrativos, sin operaciones) ──────────
-- Antes: solo superadmin+administracion. La página de Agencias y Freelance
-- (/dashboard/aliados) ya dejaba pasar a gerencia (ADMIN_ROLES) sin que la
-- RLS lo respaldara.
drop policy if exists "aliados: escritura admin" on public.aliados;
create policy "aliados: escritura admin"
  on public.aliados for all
  using (public.mi_rol() in ('superadmin','administracion','gerencia'))
  with check (public.mi_rol() in ('superadmin','administracion','gerencia'));

drop policy if exists "asesores: escritura admin" on public.asesores;
create policy "asesores: escritura admin"
  on public.asesores for all
  using (public.mi_rol() in ('superadmin','administracion','gerencia'))
  with check (public.mi_rol() in ('superadmin','administracion','gerencia'));

-- ── Montaje de producto: paquetes, paquete_hoteles, paquete_precios ──────────
-- paquete_costos ya incluía gerencia; estas tres se habían quedado atrás.
drop policy if exists "paquetes: escritura" on public.paquetes;
create policy "paquetes: escritura" on public.paquetes for all
  using (public.mi_rol() in ('superadmin','administracion','gerencia','operaciones'))
  with check (public.mi_rol() in ('superadmin','administracion','gerencia','operaciones'));

drop policy if exists "paquete_hoteles: escritura" on public.paquete_hoteles;
create policy "paquete_hoteles: escritura" on public.paquete_hoteles for all
  using (public.mi_rol() in ('superadmin','administracion','gerencia','operaciones'))
  with check (public.mi_rol() in ('superadmin','administracion','gerencia','operaciones'));

drop policy if exists "paquete_precios: escritura" on public.paquete_precios;
create policy "paquete_precios: escritura" on public.paquete_precios for all
  using (public.mi_rol() in ('superadmin','administracion','gerencia','operaciones'))
  with check (public.mi_rol() in ('superadmin','administracion','gerencia','operaciones'));

-- ── Vuelos: bloqueos, sillas, movimientos, cambios operacionales ─────────────
drop policy if exists "bloqueos: escritura control" on public.bloqueos_vuelo;
create policy "bloqueos: escritura control"
  on public.bloqueos_vuelo for all
  using (public.mi_rol() in ('superadmin','administracion','gerencia','operaciones','control_vuelo'))
  with check (public.mi_rol() in ('superadmin','administracion','gerencia','operaciones','control_vuelo'));

drop policy if exists "sillas: escritura control" on public.sillas;
create policy "sillas: escritura control"
  on public.sillas for all
  using (public.mi_rol() in ('superadmin','administracion','gerencia','operaciones','control_vuelo'))
  with check (public.mi_rol() in ('superadmin','administracion','gerencia','operaciones','control_vuelo'));

drop policy if exists "movimientos: registro operativo" on public.movimientos_silla;
create policy "movimientos: registro operativo"
  on public.movimientos_silla for all
  using (public.mi_rol() in ('superadmin','administracion','gerencia','operaciones','control_vuelo'))
  with check (public.mi_rol() in ('superadmin','administracion','gerencia','operaciones','control_vuelo'));

drop policy if exists "bloqueo_cambios: escritura control" on public.bloqueo_cambios;
create policy "bloqueo_cambios: escritura control"
  on public.bloqueo_cambios for all
  using (public.mi_rol() in ('superadmin','administracion','gerencia','operaciones','control_vuelo'))
  with check (public.mi_rol() in ('superadmin','administracion','gerencia','operaciones','control_vuelo'));

-- ── Ventas: agregar gerencia (crear y actualizar) + venta puede actualizar
-- SUS PROPIOS contratos (ya podía crearlos, pero no editarlos después) ───────
drop policy if exists "ventas: escritura operaciones y venta" on public.ventas;
create policy "ventas: escritura operaciones y venta"
  on public.ventas for insert
  with check (
    public.mi_rol() in ('superadmin','administracion','gerencia','operaciones','venta')
    and public.puede_ver_tenant(tenant)
  );

drop policy if exists "ventas: actualizar operaciones" on public.ventas;
create policy "ventas: actualizar operaciones"
  on public.ventas for update
  using (
    public.mi_rol() in ('superadmin','administracion','gerencia','operaciones')
    and public.puede_ver_tenant(tenant)
  )
  with check (
    public.mi_rol() in ('superadmin','administracion','gerencia','operaciones')
    and public.puede_ver_tenant(tenant)
  );

drop policy if exists "ventas: venta actualiza sus contratos" on public.ventas;
create policy "ventas: venta actualiza sus contratos"
  on public.ventas for update
  using (
    public.mi_rol() = 'venta'
    and asesor = (select email from public.usuarios where id = auth.uid())
    and public.puede_ver_tenant(tenant)
  )
  with check (
    public.mi_rol() = 'venta'
    and asesor = (select email from public.usuarios where id = auth.uid())
    and public.puede_ver_tenant(tenant)
  );

-- ── Hijas del contrato: el "with check" no incluía gerencia aunque el
-- "using" sí — gerencia podía VER estas filas pero nunca insertarlas/
-- actualizarlas (fallaba en silencio con el mismo error de RLS). ────────────
drop policy if exists "contrato_pasajeros: interno" on public.contrato_pasajeros;
create policy "contrato_pasajeros: interno" on public.contrato_pasajeros for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta'))
  with check (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta'));

drop policy if exists "contrato_hoteles: interno" on public.contrato_hoteles;
create policy "contrato_hoteles: interno" on public.contrato_hoteles for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta'))
  with check (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta'));

drop policy if exists "contrato_vuelos: interno" on public.contrato_vuelos;
create policy "contrato_vuelos: interno" on public.contrato_vuelos for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta'))
  with check (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta'));

drop policy if exists "contrato_items: interno" on public.contrato_items;
create policy "contrato_items: interno" on public.contrato_items for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta'))
  with check (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta'));

drop policy if exists "contrato_servicios: interno" on public.contrato_servicios;
create policy "contrato_servicios: interno" on public.contrato_servicios for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta'))
  with check (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta'));
