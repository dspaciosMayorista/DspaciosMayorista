-- Migración 148: archivos del contrato, tokens de voucher y columnas sensibles
--
-- Segunda ronda de la auditoría del PR #259/#260. Parte del estado REAL
-- posterior a la 147 (ya aplicada en producción) y es idempotente.
--
-- ═════════════════════════════════════════════════════════════════════════
-- ⚠️ ESTA MIGRACIÓN ES **PREPARATORIA**: NO QUITA NINGÚN ACCESO QUE EL CÓDIGO
--    EN PRODUCCIÓN ESTÉ USANDO HOY. Se puede correr con el código VIEJO
--    todavía desplegado, sin ventana de caída.
--
--    Lo único que sí quita acceso —el SELECT de `venta` sobre la TABLA BASE
--    `contrato_vuelos`— se movió a la **migración 149**, que se corre DESPUÉS
--    de desplegar el código nuevo. Si se quitara aquí, entre correr la
--    migración y terminar el despliegue habría un rato en que el código viejo
--    pide `contrato_vuelos` (ya sin permiso) y el nuevo pide
--    `contrato_vuelos_basica` (que aún no existiría si el orden fuera al
--    revés): en ambos sentidos los vuelos desaparecen de la pantalla.
--
--    ORDEN EXACTO — ver el bloque "ORDEN DE DESPLIEGUE" al final del archivo.
-- ═════════════════════════════════════════════════════════════════════════
--
-- Por qué el endurecimiento de Storage y de `vouchers` SÍ puede ir aquí: ambos
-- restringen a `venta` a sus contratos propios, y en las dos el código viejo ya
-- se queda sin datos por otra vía. Los adjuntos ajenos ya estaban cerrados en
-- la tabla `contrato_adjuntos` desde la 142, así que la pantalla ya no lista
-- ningún archivo ajeno que pudiera intentar abrir; y los vouchers ajenos, al
-- dejar de devolverse, hacen que el panel salga vacío — no que falle. Ninguno
-- de los dos deja al código pidiendo un objeto que no existe, que es lo que
-- sí pasaría con la vista de vuelos.
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
--   contrato_vuelos    → TODA MENOS `record`.  ← la VISTA se crea aquí; el
--                        cierre de la tabla base va en la 149.
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
--
-- ─────────────────────────────────────────────────────────────────────────
-- 4. `ventas_basica.cliente_documento` — enmascarado para contratos ajenos
-- ─────────────────────────────────────────────────────────────────────────
-- La 147 lo dejó DENTRO de la vista y lo anotó como decisión revisable. Es
-- incoherente con el resto del criterio: `contrato_pasajeros` está limitado a
-- contratos propios precisamente porque guarda documento y fecha de
-- nacimiento — pero el titular de la venta es también un pasajero, y su
-- documento salía completo en la vista para toda la agencia. La protección de
-- la 142 se caía por el titular.
--
-- Un asesor que cubre a un colega necesita IDENTIFICAR al cliente (confirmar
-- por teléfono que habla con el titular), no la cédula completa. Se deja el
-- documento íntegro para el contrato propio y los últimos cuatro dígitos para
-- los ajenos, que es lo que se usa al verificar identidad. Mismo mecanismo
-- que ya se usó con `share_token`: la columna sigue existiendo, cambia su
-- contenido según quién pregunta.
--
-- ─────────────────────────────────────────────────────────────────────────
-- 5. REGRESIÓN de la 144: `venta` no podía imprimir NI SU PROPIO contrato
-- ─────────────────────────────────────────────────────────────────────────
-- La 144 le quitó a `venta` toda policy de SELECT sobre `ventas`. La página
-- imprimible `/contrato/[numero]` leía la tabla base, así que devolvía null y
-- caía en `notFound()`: el botón "Ver / Imprimir contrato" quedó roto para
-- TODOS los asesores, incluso en sus propios contratos. No es un problema de
-- permisos mal puestos sino de una pantalla que quedó consultando la puerta
-- que se cerró; se corrige apuntándola a la vista (ver el cambio de la app).
--
-- El documento imprimible no usa ninguna columna financiera, pero sí dos que
-- la 147 sacó de la vista: `cliente_direccion` (va impresa en el contrato del
-- cliente) y `asesor_firma_cc` (va en el bloque de firma). Vuelven a la
-- vista, pero SOLO para el contrato propio — mismo criterio que
-- `share_token`: para el contrato de un colega llegan en null y el documento
-- se imprime con esos campos vacíos.

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

-- ── 3. `contrato_vuelos_basica`: la vista, SIN cerrar todavía la tabla ────
-- Aquí solo se CREA la vista sin `record`. La policy de la tabla base sigue
-- como la dejó la 147 (con `venta` incluido), a propósito: mientras el código
-- viejo esté desplegado tiene que poder seguir leyendo `contrato_vuelos`.
-- El cierre —quitar `venta` de esa policy— es la migración 149, después del
-- despliegue.
--
-- La vista ya enmascara el record desde este momento, así que en cuanto el
-- código nuevo esté arriba el PNR ajeno deja de mostrarse. La 149 cierra el
-- acceso por la API REST directa, que es lo que la pantalla no controla.
drop view if exists public.contrato_vuelos_basica;
create view public.contrato_vuelos_basica as
  select
    v.id, v.numero_contrato, v.aerolinea, v.direccion,
    v.origen_codigo, v.origen_ciudad, v.destino_codigo, v.destino_ciudad,
    v.numero_vuelo, v.fecha_salida, v.hora_salida, v.hora_llegada,
    v.servicios, v.orden,
    -- Columnas viejas (ida+regreso en una sola fila, anteriores a la 135): el
    -- documento imprimible todavía las renderiza para los contratos que ya
    -- estaban generados, así que la vista tiene que traerlas o esos vuelos
    -- saldrían en blanco. No son sensibles: números y horas de vuelo.
    v.vuelo_ida, v.vuelo_regreso, v.hora_salida_ida, v.hora_llegada_ida,
    v.hora_salida_reg, v.hora_llegada_reg, v.fecha_regreso,
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

-- ── 3.bis `abonos`: el asesor consulta los pagos, no los registra ─────────
-- Hallazgo al revisar el modo de solo lectura: `abonos` tiene UNA sola policy
-- (la "acceso contable", 005/116) y NO incluye a `venta`. O sea que un asesor
-- no ve NINGÚN abono — tampoco los de SU PROPIO contrato. La pestaña Cartera,
-- que es la única que le queda, le mostraba desde siempre "Pagado $0" y
-- "Saldo = precio completo" en todos los contratos, y el formulario
-- "Registrar abono" fallaba en silencio. No es algo que rompiera esta tanda de
-- migraciones: viene de antes.
--
-- Se agrega SOLO LECTURA, y solo sobre contratos que ya puede ver: cuánto ha
-- pagado el cliente es información comercial que el asesor necesita para
-- atender. Es aditivo — nadie pierde nada — por eso puede ir en esta
-- migración preparatoria.
--
-- NO se agrega escritura a propósito. Registrar, corregir o eliminar un pago es
-- función contable; `venta` nunca la tuvo (los botones existían pero fallaban).
-- Dársela ahora sería ampliar permisos dentro de un PR de endurecimiento. Los
-- controles de escritura se ocultan en la interfaz para que deje de haber
-- botones que no hacen nada.
drop policy if exists "abonos: venta consulta" on public.abonos;
create policy "abonos: venta consulta" on public.abonos for select
  using (public.mi_rol() = 'venta' and public.puede_ver_contrato(numero_contrato));

-- ── 4. `ventas_basica`: documento del titular enmascarado si no es propio ──
-- Se re-declara la vista COMPLETA (no se puede alterar una columna suelta), con
-- exactamente las mismas columnas que dejó la 147 y un solo cambio:
-- `cliente_documento`.
drop view if exists public.ventas_basica;
create view public.ventas_basica as
  select
    v.numero_contrato, v.fecha_venta, v.asesor, v.canal, v.tipo_cliente,
    v.cliente,
    -- Documento completo solo para quien gestiona el contrato. Para un colega
    -- de la misma agencia, los últimos cuatro dígitos: alcanza para verificar
    -- identidad al teléfono y no reconstruye la cédula.
    case
      when public.mi_rol() <> 'venta' or public.soy_asesor_del_contrato(v.numero_contrato)
        then v.cliente_documento
      when v.cliente_documento is null then null
      -- Un documento de 4 caracteres o menos no se puede enmascarar
      -- parcialmente sin entregarlo entero: se oculta completo.
      when length(v.cliente_documento) <= 4 then '••••'
      else '••••' || right(v.cliente_documento, 4)
    end as cliente_documento,
    v.cliente_telefono, v.cliente_email,
    v.destino, v.tipo_paquete, v.fecha_salida, v.fecha_regreso, v.fecha_emision,
    v.pax, v.hotel, v.aerolinea, v.receptivo, v.asistencia, v.otros_proveedores,
    v.precio_venta, v.moneda, v.estado, v.facturado, v.numero_documento,
    v.plan_nombre, v.tours_traslados, v.asistencia_medica, v.plazo,
    v.tipo_asesor, v.agencia_nombre, v.agencia_asesor, v.freelance_nombre, v.aliado_id,
    v.asesor_firma_nombre, v.asesor_firma_cargo, v.asesor_firma_tel,
    v.paquete_armado_id, v.bloqueo_ref_id, v.tenant,
    -- Punto 5: vuelven a la vista para que el asesor pueda imprimir SU
    -- contrato completo; en null para el de un colega.
    case
      when public.mi_rol() <> 'venta' or public.soy_asesor_del_contrato(v.numero_contrato)
        then v.cliente_direccion
      else null
    end as cliente_direccion,
    case
      when public.mi_rol() <> 'venta' or public.soy_asesor_del_contrato(v.numero_contrato)
        then v.asesor_firma_cc
      else null
    end as asesor_firma_cc,
    case
      when public.mi_rol() <> 'venta' or public.soy_asesor_del_contrato(v.numero_contrato)
        then v.share_token
      else null
    end as share_token,
    v.created_at, v.updated_at
  from public.ventas v
  where
    public.mi_rol() in ('superadmin','gerencia')
    or (public.mi_rol() in ('administracion','operaciones','venta')
        and public.puede_ver_tenant(v.tenant));

grant select on public.ventas_basica to authenticated;

notify pgrst, 'reload schema';

-- ═════════════════════════════════════════════════════════════════════════
-- ORDEN DE DESPLIEGUE — sin ventana de caída
-- ═════════════════════════════════════════════════════════════════════════
--
--   1. Correr ESTA migración (148) en Supabase, con el código VIEJO todavía
--      desplegado. Es aditiva: crea `contrato_vuelos_basica`, agrega columnas
--      a `ventas_basica` y endurece Storage/vouchers. Nada de lo que el código
--      viejo usa deja de funcionar.
--
--   2. Fusionar el PR y esperar a que Vercel termine de desplegar `main`.
--      Desde ese momento la app lee `contrato_vuelos_basica` (sin el PNR
--      ajeno) y `ventas_basica` (con el documento enmascarado).
--
--   3. VALIDAR en producción, con un usuario de rol `venta` real:
--        · abrir `/dashboard/contratos/<contrato propio>`   → edita normal;
--        · abrir `/dashboard/contratos/<contrato de un colega>` → solo lectura;
--        · abrir `/contrato/<numero>` de ambos → el documento imprimible sale,
--          con los vuelos, y el PNR solo en el propio;
--        · un rol administrativo sigue operando igual que siempre.
--
--   4. Correr la migración **149**, que le quita a `venta` el SELECT sobre la
--      tabla base `contrato_vuelos`. A partir de ahí el PNR ajeno tampoco se
--      alcanza llamando la API REST directamente.
--
--   5. Correr `supabase/scripts/test_venta_tokens_y_escritura.sql` (espera el
--      estado posterior a la 149) y `test_rls_por_rol.sql`.
--
-- Si hubiera que devolverse entre el paso 2 y el 4, basta con revertir el
-- despliegue: la 148 por sí sola no le quita a nadie nada que estuviera
-- usando. Después del paso 4 el retroceso ya exige volver a agregar `venta` a
-- la policy de `contrato_vuelos`.
-- ═════════════════════════════════════════════════════════════════════════
