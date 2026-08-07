-- Migración 136: permitir a "operaciones" crear/editar proveedores
--
-- Bug reportado: al crear un proveedor desde /dashboard/producto/proveedores
-- (mismo módulo "Producto (netas)" que Destinos y Hoteles) el INSERT falla con
-- "la nueva fila infringe la política de seguridad a nivel de fila para la
-- tabla proveedores". Causa: la policy de escritura de `proveedores` (migración
-- 005) solo autorizaba a superadmin/administracion, mientras que las demás
-- tablas del mismo módulo (destinos, hoteles) ya autorizan también a
-- operaciones — quien de hecho gestiona el catálogo de producto día a día.

drop policy if exists "proveedores: escritura admin" on public.proveedores;
create policy "proveedores: escritura admin"
  on public.proveedores for all
  using (public.mi_rol() in ('superadmin','administracion','operaciones'))
  with check (public.mi_rol() in ('superadmin','administracion','operaciones'));
