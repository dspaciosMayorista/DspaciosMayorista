-- Migración 148: archivos del contrato, tokens de voucher y columnas sensibles
--
-- Segunda ronda de la auditoría del PR #259/#260. Parte del estado REAL
-- posterior a la 147 (ya aplicada en producción) y es idempotente.
--
-- Hilo conductor de los tres hallazgos: en la 147 protegimos las TABLAS pero
-- dejamos abiertas las puertas laterales — los archivos en Storage, el token
-- público del voucher y el localizador del vuelo. Es el mismo patrón que ya
-- había pasado con `share_token` de `ventas`: cerrar el dato y olvidar la llave.
--
-- ─────────────────────────────────────────────────────────────────────────
-- 1. CRÍTICO — el bucket `contratos` estaba abierto a todo el rol `venta`
-- ─────────────────────────────────────────────────────────────────────────
-- La policy de la migración 046 sobre `storage.objects` era:
--     for all using (bucket_id = 'contratos' and mi_rol() in (...,'venta'))
-- Solo chequeo de rol: un asesor podía LEER, REEMPLAZAR y BORRAR cualquier
-- archivo del bucket — cédulas y soportes de pago de contratos ajenos.
--
-- Proteger `contrato_adjuntos` (la 142) no servía de nada: esa tabla es el
-- índice, y el archivo vive en Storage con su propia RLS.
--
-- Los archivos se suben como `{numero_contrato}/{tipo}-{timestamp}.{ext}`
-- (ver AdjuntosContrato.tsx), así que el contrato es el PRIMER SEGMENTO de
-- `name`. Se exige contrato propio a `venta` en las cuatro operaciones.
--
-- ─────────────────────────────────────────────────────────────────────────
-- 2. `vouchers` — token público y contenido operativo
-- ─────────────────────────────────────────────────────────────────────────
-- La 147 dejó a `venta` leyendo los vouchers de toda su agencia. La tabla
-- guarda `share_token`, que abre `/voucher/[token]` — pública y con
-- `createAdminClient()` — y `contenido` (jsonb con el detalle operativo).
-- Es exactamente la fuga que la 147 cerró para `ventas.share_token`, repetida.
--
-- Se limita a contratos PROPIOS, igual que pasajeros y adjuntos. Se eligió eso
-- antes que una vista sin token porque un voucher es un documento operativo de
-- quien gestiona el contrato: no hay caso de negocio para que un asesor vea los
-- vouchers de un colega, y la regla simple es más fácil de sostener.
--
-- ─────────────────────────────────────────────────────────────────────────
-- 3. Clasificación de columnas por tabla hija (lo que `venta` puede consultar)
-- ─────────────────────────────────────────────────────────────────────────
--   contrato_hoteles   → TODA. Hotel, categoría, ciudad, alimentación,
--                        acomodación y fechas son información comercial. Se
--                        conserva `proveedor`: es el hotelero con el que se
--                        opera, no un costo ni un secreto.
--   contrato_items     → TODA. Sus tarifas son PVP (lo que paga el cliente),
--                        no costo; el asesor las necesita para atender.
--   cuotas             → TODA. Plan de pagos: fechas y montos que el asesor
--                        tiene que poder consultarle al cliente.
--   contrato_vuelos    → TODA MENOS `record`.  ← se restringe aquí
--                        El record/PNR permite gestionar o ANULAR la reserva
--                        en el sitio de la aerolínea. No es información
--                        comercial: es una credencial operativa.
--                        `venta` pasa a leer la vista `contrato_vuelos_basica`.
--   contrato_servicios → NINGUNA (tiene `costo`, el neto del proveedor).
--                        Ya restringido en la 146/147.
--   vouchers           → solo contratos PROPIOS (punto 2).
--   contrato_pasajeros → solo contratos PROPIOS (documento y nacimiento).
--   contrato_adjuntos  → solo contratos PROPIOS (+ Storage, punto 1).
--
-- Los roles administrativos conservan acceso completo en todas.

-- ── 1. Storage: bucket `contratos` ────────────────────────────────────────
drop policy if exists "contratos files: acceso" on storage.objects;
drop policy if exists "contratos files: lectura" on storage.objects;
drop policy if exists "contratos files: subir" on storage.objects;
drop policy if exists "contratos files: reemplazar" on storage.objects;
drop policy if exists "contratos files: eliminar" on storage.objects;

-- `split_part(name,'/',1)` = número de contrato. Los números no llevan "/"
-- (formato 00-0451, o MIN-00-0451 en minorista), así que el primer segmento es
-- siempre el contrato completo.
--
-- ⚠️ Este bucket NO guarda solo adjuntos de contratos: `punto-equilibrio` sube
-- ahí los CONTRATOS LABORALES de los empleados, con prefijo `pe-empleados/`
-- (ver PuntoEquilibrioClient.tsx). Esa carpeta queda cerrada a `venta` por
-- construcción — `soy_asesor_del_contrato('pe-empleados')` es false, porque no
-- existe ningún contrato con ese número — y sigue abierta a los roles
-- administrativos, que es donde vive el módulo. Se deja anotado porque no es
-- evidente al leer solo la policy.
create policy "contratos files: lectura" on storage.objects
  for select
  using (
    bucket_id = 'contratos'
    and public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
    and (public.mi_rol() <> 'venta' or public.soy_asesor_del_contrato(split_part(name, '/', 1)))
  );

create policy "contratos files: subir" on storage.objects
  for insert
  with check (
    bucket_id = 'contratos'
    and public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
    and (public.mi_rol() <> 'venta' or public.soy_asesor_del_contrato(split_part(name, '/', 1)))
  );

create policy "contratos files: reemplazar" on storage.objects
  for update
  using (
    bucket_id = 'contratos'
    and public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
    and (public.mi_rol() <> 'venta' or public.soy_asesor_del_contrato(split_part(name, '/', 1)))
  )
  with check (
    bucket_id = 'contratos'
    and public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
    and (public.mi_rol() <> 'venta' or public.soy_asesor_del_contrato(split_part(name, '/', 1)))
  );

create policy "contratos files: eliminar" on storage.objects
  for delete
  using (
    bucket_id = 'contratos'
    and public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
    and (public.mi_rol() <> 'venta' or public.soy_asesor_del_contrato(split_part(name, '/', 1)))
  );

-- ── 2. `vouchers`: solo contratos propios para `venta` ────────────────────
-- La 147 creó estas cuatro; se re-declaran con la condición de propiedad
-- también en la LECTURA (allí solo estaba en las escrituras).
drop policy if exists "vouchers: interno" on public.vouchers;
drop policy if exists "vouchers: lectura" on public.vouchers;
drop policy if exists "vouchers: insertar" on public.vouchers;
drop policy if exists "vouchers: actualizar" on public.vouchers;
drop policy if exists "vouchers: eliminar" on public.vouchers;

create policy "vouchers: lectura" on public.vouchers for select
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
         and public.puede_ver_contrato(numero_contrato)
         and (public.mi_rol() <> 'venta' or public.soy_asesor_del_contrato(numero_contrato)));

create policy "vouchers: insertar" on public.vouchers for insert
  with check (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
              and public.puede_ver_contrato(numero_contrato)
              and (public.mi_rol() <> 'venta' or public.soy_asesor_del_contrato(numero_contrato)));

create policy "vouchers: actualizar" on public.vouchers for update
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
         and public.puede_ver_contrato(numero_contrato)
         and (public.mi_rol() <> 'venta' or public.soy_asesor_del_contrato(numero_contrato)))
  with check (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
              and public.puede_ver_contrato(numero_contrato)
              and (public.mi_rol() <> 'venta' or public.soy_asesor_del_contrato(numero_contrato)));

create policy "vouchers: eliminar" on public.vouchers for delete
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
         and public.puede_ver_contrato(numero_contrato)
         and (public.mi_rol() <> 'venta' or public.soy_asesor_del_contrato(numero_contrato)));

-- ── 3. `contrato_vuelos`: `venta` no lee el record/PNR ────────────────────
-- Se le quita la LECTURA de la tabla base (RLS no filtra columnas) y se le da
-- una vista sin `record`. Las escrituras siguen como las dejó la 147: solo
-- sobre contratos propios.
drop policy if exists "contrato_vuelos: lectura" on public.contrato_vuelos;
create policy "contrato_vuelos: lectura" on public.contrato_vuelos for select
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones')
         and public.puede_ver_contrato(numero_contrato));

drop view if exists public.contrato_vuelos_basica;
create view public.contrato_vuelos_basica as
  select
    v.id, v.numero_contrato, v.aerolinea, v.direccion,
    v.origen_codigo, v.origen_ciudad, v.destino_codigo, v.destino_ciudad,
    v.numero_vuelo, v.fecha_salida, v.hora_salida, v.hora_llegada,
    v.servicios, v.orden,
    -- El record solo para quien gestiona el contrato: con él se puede entrar al
    -- sitio de la aerolínea y modificar o anular la reserva.
    case
      when public.mi_rol() <> 'venta' or public.soy_asesor_del_contrato(v.numero_contrato)
        then v.record
      else null
    end as record
  from public.contrato_vuelos v
  where public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
    and public.puede_ver_contrato(v.numero_contrato);

grant select on public.contrato_vuelos_basica to authenticated;

notify pgrst, 'reload schema';
