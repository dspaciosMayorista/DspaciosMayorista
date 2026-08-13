-- Migración 144: el rol `venta` deja de poder leer columnas financieras
--
-- ⚠️ CORRIGE UNA VULNERABILIDAD INTRODUCIDA POR LA 142
--
-- La 142 le dio a `venta` una policy de SELECT sobre `ventas` para toda su
-- agencia, asumiendo que "información básica" quedaba resuelta porque la app
-- (helper `verFinanzas`) no le pinta costos ni márgenes. Eso es FALSO como
-- control de seguridad:
--
--   · RLS filtra FILAS, no COLUMNAS. Si un rol puede ver la fila, puede pedir
--     TODAS sus columnas.
--   · `verFinanzas` vive en el frontend. Un usuario `venta` con su access token
--     puede llamar la API REST de Supabase directamente:
--         GET /rest/v1/ventas?select=*
--     y obtener costo_hotel, costo_aereo, costo_receptivo, costo_asistencia,
--     otros_costos, comision_b2b, recobro_*, impuesto y trm_contrato de TODOS
--     los contratos de su agencia. La app no interviene en esa llamada.
--
-- Antes de la 142 el daño era nulo por accidente (la policy comparaba `asesor`
-- contra el email y nunca cruzaba, así que veía 0 filas). La 142 lo pasó de 0
-- filas a toda la agencia, con todas las columnas.
--
-- POR QUÉ NO SE ARREGLA CON PERMISOS DE COLUMNA
-- En Supabase todos los usuarios autenticados comparten el MISMO rol de base de
-- datos (`authenticated`); el rol de negocio vive en `usuarios.rol`. Un
-- `revoke select (costo_hotel) ... from authenticated` se lo quitaría también a
-- superadmin y administración. No sirve.
--
-- SOLUCIÓN
--   1. `venta` pierde TODA policy de SELECT sobre `ventas`. Con eso, pedir la
--      tabla por API devuelve 0 filas: no hay columna que filtrar porque no hay
--      fila que leer.
--   2. Se expone la vista `ventas_basica`, que NO incluye ninguna columna
--      financiera y hace ella misma el control de rol y agencia. Es SECURITY
--      DEFINER (el comportamiento por defecto de una vista): corre con los
--      permisos de su dueño, así que puede leer la tabla base aunque quien
--      consulta no pueda. Por eso su `where` ES la frontera de seguridad y
--      tiene que ser explícito.
--   3. `puede_ver_contrato()` pasa a SECURITY DEFINER con la regla escrita a
--      mano. En la 141 se hizo INVOKER a propósito, para heredar la RLS de
--      `ventas` y no duplicar el criterio; ahora `venta` ya no tiene esa RLS,
--      así que si siguiera siendo INVOKER perdería el acceso a pasajeros,
--      hoteles, vuelos, ítems, servicios, vouchers y cuotas de su propia
--      agencia. Es una duplicación que preferiría no hacer, pero es el precio
--      de sacar a `venta` de la tabla base. Queda anotado: si cambia quién ve
--      qué contrato, hay que tocar LOS DOS lugares.
--
-- ⚠️ LO QUE ESTA MIGRACIÓN NO ARREGLA (pendiente, ver notas al dueño)
-- `LECTURA_MODULO` en `lib/roles.ts` deja a `venta` entrar a los módulos de
-- finanzas, cartera, flujo de caja y comisiones. Esas pantallas van a quedar
-- VACÍAS para él (ya no lee `ventas`), que es más seguro que antes, pero lo
-- correcto es sacarle esos módulos del menú.

-- ── 1. `venta` fuera de la tabla base ─────────────────────────────────────
drop policy if exists "ventas: venta ve su agencia" on public.ventas;
drop policy if exists "ventas: asesor ve sus contratos" on public.ventas;

-- ── 2. Vista sin columnas financieras ─────────────────────────────────────
-- Excluidas a propósito: costo_hotel, costo_aereo, costo_receptivo,
-- costo_asistencia, otros_costos, impuesto, comision_b2b, comision_estado,
-- modo_compra, recobro_total, recobro_empresa, recobro_aliado, trm_contrato.
-- `precio_venta` SÍ se incluye: es el valor que el asesor le cotiza al cliente,
-- no un dato interno de margen.
drop view if exists public.ventas_basica;
create view public.ventas_basica as
  select
    v.numero_contrato, v.fecha_venta, v.asesor, v.canal, v.tipo_cliente,
    v.cliente, v.cliente_documento, v.cliente_telefono, v.cliente_email, v.cliente_direccion,
    v.destino, v.tipo_paquete, v.fecha_salida, v.fecha_regreso, v.fecha_emision,
    v.pax, v.hotel, v.aerolinea, v.receptivo, v.asistencia, v.otros_proveedores,
    v.precio_venta, v.moneda, v.estado, v.observaciones, v.facturado, v.numero_documento,
    v.plan_nombre, v.tours_traslados, v.asistencia_medica, v.plazo,
    v.tipo_asesor, v.agencia_nombre, v.agencia_asesor, v.freelance_nombre, v.aliado_id,
    v.asesor_firma_nombre, v.asesor_firma_cargo, v.asesor_firma_cc, v.asesor_firma_tel,
    v.paquete_armado_id, v.bloqueo_ref_id, v.share_token, v.tenant,
    v.created_at, v.updated_at
  from public.ventas v
  where
    -- Los roles con acceso financiero siguen leyendo la tabla base; se les
    -- permite la vista igual para que la app pueda usar una sola consulta.
    public.mi_rol() in ('superadmin','gerencia')
    or (public.mi_rol() in ('administracion','operaciones','venta')
        and public.puede_ver_tenant(v.tenant));

grant select on public.ventas_basica to authenticated;

-- ── 3. Las tablas hijas siguen funcionando para `venta` ───────────────────
-- Pasa a SECURITY DEFINER porque `venta` ya no puede leer `ventas` y un EXISTS
-- con permisos del que consulta devolvería siempre false para él.
create or replace function public.puede_ver_contrato(num text)
returns boolean language sql stable security definer set search_path = public as $$
  select num is not null and exists (
    select 1 from public.ventas v
    where v.numero_contrato = num
      and (
        public.mi_rol() in ('superadmin','gerencia')
        or (public.mi_rol() in ('administracion','operaciones','venta')
            and public.puede_ver_tenant(v.tenant))
      )
  );
$$;

notify pgrst, 'reload schema';
