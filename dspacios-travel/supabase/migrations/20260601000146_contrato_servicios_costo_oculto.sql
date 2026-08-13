-- Migración 146: `venta` deja de poder leer el costo de los servicios
--
-- Cierra el último resto de la auditoría que motivó la 144. Ahí se sacó a
-- `venta` de `ventas` porque podía pedir las columnas de costo por la API REST.
-- Faltaba revisar las tablas hijas: `contrato_servicios` tiene una columna
-- `costo` (el neto que se le paga al proveedor) y su policy incluía a `venta`,
-- así que seguía siendo legible con:
--     GET /rest/v1/contrato_servicios?select=costo
--
-- Es la misma falla que la 144, en pequeño: la app nunca le pinta ese costo,
-- pero la app no interviene en esa llamada.
--
-- Resultado de revisar las demás hijas (punto 5 de la auditoría):
--   · cuentas_por_pagar → YA excluía a `venta` desde la 116. Es la tabla con
--     TODOS los costos por proveedor, así que ese, que era el riesgo grande,
--     estaba bien.
--   · contrato_items → sus tarifas son PVP (lo que paga el cliente), no costo.
--     El asesor las necesita y las ve en el documento. No se toca.
--   · contrato_hoteles, contrato_vuelos, contrato_pasajeros, vouchers, cuotas →
--     no tienen columnas de costo.
--
-- SOLUCIÓN
-- `venta` conserva la ESCRITURA (crea contratos con sus servicios: la acción
-- `crearContrato` inserta ahí sin leer de vuelta) y pierde la LECTURA. Se
-- separa la policy `for all` en una de SELECT y otra de escritura, porque el
-- problema es solo de lectura y quitarle el insert rompería crear contratos.
--
-- Lo único que consulta esta tabla en la app es el editor de contenido del
-- contrato, que ya es exclusivo de superadmin.

drop policy if exists "contrato_servicios: interno" on public.contrato_servicios;

-- Lectura: sin `venta`.
create policy "contrato_servicios: lectura" on public.contrato_servicios
  for select
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones')
         and public.puede_ver_contrato(numero_contrato));

-- Escritura: mismo conjunto de roles que antes, `venta` incluido.
create policy "contrato_servicios: escritura" on public.contrato_servicios
  for insert
  with check (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
              and public.puede_ver_contrato(numero_contrato));

create policy "contrato_servicios: actualizar" on public.contrato_servicios
  for update
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
         and public.puede_ver_contrato(numero_contrato))
  with check (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
              and public.puede_ver_contrato(numero_contrato));

create policy "contrato_servicios: eliminar" on public.contrato_servicios
  for delete
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
         and public.puede_ver_contrato(numero_contrato));

notify pgrst, 'reload schema';
