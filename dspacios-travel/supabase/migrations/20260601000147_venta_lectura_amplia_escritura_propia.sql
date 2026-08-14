-- Migración 147: separa VER de EDITAR, y cierra la fuga por `share_token`
--
-- Corrige hallazgos de la auditoría del PR #259. Todos son defectos
-- introducidos por las migraciones 144/146, no problemas heredados.
--
-- REGLA DE NEGOCIO (confirmada por el dueño): el rol `venta` SÍ debe consultar
-- la información comercial básica de TODOS los contratos de su agencia — los
-- asesores se cubren entre ellos. Lo que NO puede es ver información sensible
-- ni MODIFICAR lo que no es suyo. Son cuatro cosas distintas y hasta ahora
-- estaban mezcladas en una sola regla:
--
--     ver un contrato de la agencia   ≠   ver información sensible
--     ver                             ≠   editar / eliminar
--
-- ─────────────────────────────────────────────────────────────────────────
-- 1. CRÍTICO — `share_token` permitía saltarse la protección de pasajeros
-- ─────────────────────────────────────────────────────────────────────────
-- La vista `ventas_basica` (migración 144) incluía `share_token`. La ruta
-- `/c/[token]` es PÚBLICA (está en RUTAS_PUBLICAS de proxy.ts), usa
-- `createAdminClient()` — que se salta toda la RLS — y hace `select("*")`
-- sobre `contrato_pasajeros`, es decir identificación y fecha de nacimiento.
--
-- Encadenado: un `venta` leía el token de CUALQUIER contrato de su agencia por
-- `ventas_basica`, abría `/c/<token>` y veía los pasajeros de contratos
-- ajenos. Eso anulaba por completo la restricción de la migración 142, que
-- justamente limita `contrato_pasajeros` a los contratos propios.
--
-- El token sale de la vista. No hay motivo comercial para que un asesor
-- conozca el enlace público de un contrato que no gestiona.
--
-- ─────────────────────────────────────────────────────────────────────────
-- 2. Columnas de `ventas_basica`, clasificadas explícitamente
-- ─────────────────────────────────────────────────────────────────────────
-- FUERA (sensibles, sin necesidad comercial para un asesor que cubre):
--   · share_token      → habilitaba el salto de arriba.
--   · asesor_firma_cc  → cédula de OTRO empleado. Ninguna utilidad comercial.
--   · cliente_direccion→ dato personal que no hace falta para atender/cotizar.
--   · observaciones    → texto libre; es justo donde terminan las notas
--                        internas de margen y negociación. Se saca por
--                        precaución, no porque se sepa que las tiene.
--   · b2b_usuario_id   → ya estaba fuera desde la 144.
--   · todas las financieras (costos, impuesto, comisión, recobro, TRM).
--
-- DENTRO (necesarias para atender un contrato de un colega):
--   · cliente, cliente_documento, cliente_telefono, cliente_email → hay que
--     poder identificar al cliente y llamarlo.
--   · precio_venta → el valor comercial; el dueño pidió expresamente NO
--     quitarlo.
--   · destino, fechas, pax, estado, hotel, aerolínea, plan, tours.
--   · aliado_id / agencia_nombre / freelance_nombre → a nombre de quién va la
--     venta; es información comercial, no un secreto.
--
-- ⚠️ `cliente_documento` queda DENTRO por criterio operativo (identificar al
-- titular). Si se prefiere sacarlo, es quitar una línea de la vista: no rompe
-- nada, porque el documento del titular no se usa para cálculos.
--
-- ─────────────────────────────────────────────────────────────────────────
-- 3. Ver ≠ editar en las tablas hijas
-- ─────────────────────────────────────────────────────────────────────────
-- La 141 dejó las hijas con una sola policy `for all` cuya condición era
-- `puede_ver_contrato()`. Cuando la 144 amplió esa función a "cualquier
-- contrato de mi agencia", esas policies pasaron a permitir también UPDATE y
-- DELETE sobre contratos ajenos — un asesor podía borrar los vuelos o los
-- ítems del contrato de un compañero llamando la API REST directamente.
--
-- `puede_ver_contrato()` significa hoy SOLO "puedo consultarlo porque es de mi
-- agencia". Para escribir se exige además `soy_asesor_del_contrato()`, que sí
-- responde "es mío". Los roles administrativos no cambian: la condición de
-- propiedad solo se aplica al rol `venta`.
--
-- Se separa `for all` en SELECT / INSERT / UPDATE / DELETE explícitos para que
-- no queden dudas de qué permite cada una (una policy `for all` también cubre
-- SELECT, y al ser permisivas se combinan con OR: mezclarlas confunde).

-- ── 1 y 2: vista sin token ni columnas sensibles ──────────────────────────
drop view if exists public.ventas_basica;
create view public.ventas_basica as
  select
    v.numero_contrato, v.fecha_venta, v.asesor, v.canal, v.tipo_cliente,
    v.cliente, v.cliente_documento, v.cliente_telefono, v.cliente_email,
    v.destino, v.tipo_paquete, v.fecha_salida, v.fecha_regreso, v.fecha_emision,
    v.pax, v.hotel, v.aerolinea, v.receptivo, v.asistencia, v.otros_proveedores,
    v.precio_venta, v.moneda, v.estado, v.facturado, v.numero_documento,
    v.plan_nombre, v.tours_traslados, v.asistencia_medica, v.plazo,
    v.tipo_asesor, v.agencia_nombre, v.agencia_asesor, v.freelance_nombre, v.aliado_id,
    v.asesor_firma_nombre, v.asesor_firma_cargo, v.asesor_firma_tel,
    v.paquete_armado_id, v.bloqueo_ref_id, v.tenant,
    -- El token del enlace público SOLO para el contrato propio. Quitarlo del
    -- todo habría roto el botón de compartir del asesor con SUS clientes, que
    -- es legítimo; dejarlo abierto era la fuga. Para un contrato ajeno queda
    -- en null, así que no hay token que llevar a `/c/[token]`.
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

-- ── 3: hijas — leer toda la agencia, escribir solo lo propio ──────────────
-- Mismo tratamiento para las cinco tablas, así que se hace en bucle: escribir
-- veinte policies a mano invita a que una quede distinta por descuido, que es
-- exactamente el problema que arrastramos desde la 137.
do $$
declare
  t     text;
  roles constant text := $r$'superadmin','gerencia','administracion','operaciones','venta'$r$;
begin
  foreach t in array array['contrato_hoteles','contrato_vuelos','contrato_items','vouchers','cuotas'] loop
    -- Nombres viejos y nuevos: la migración debe poder re-correrse sin fallar.
    execute format('drop policy if exists %I on public.%I', t || ': interno', t);
    execute format('drop policy if exists %I on public.%I', t || ': lectura', t);
    execute format('drop policy if exists %I on public.%I', t || ': insertar', t);
    execute format('drop policy if exists %I on public.%I', t || ': actualizar', t);
    execute format('drop policy if exists %I on public.%I', t || ': eliminar', t);

    -- LECTURA: toda la agencia (regla de negocio 1).
    execute format(
      'create policy %I on public.%I for select using (public.mi_rol() in (%s) and public.puede_ver_contrato(numero_contrato))',
      t || ': lectura', t, roles);

    -- ESCRITURA: `venta` solo sobre contratos propios; el resto de roles igual
    -- que antes.
    execute format(
      'create policy %I on public.%I for insert with check (public.mi_rol() in (%s) and public.puede_ver_contrato(numero_contrato) and (public.mi_rol() <> ''venta'' or public.soy_asesor_del_contrato(numero_contrato)))',
      t || ': insertar', t, roles);

    execute format(
      'create policy %I on public.%I for update using (public.mi_rol() in (%s) and public.puede_ver_contrato(numero_contrato) and (public.mi_rol() <> ''venta'' or public.soy_asesor_del_contrato(numero_contrato))) with check (public.mi_rol() in (%s) and public.puede_ver_contrato(numero_contrato) and (public.mi_rol() <> ''venta'' or public.soy_asesor_del_contrato(numero_contrato)))',
      t || ': actualizar', t, roles, roles);

    execute format(
      'create policy %I on public.%I for delete using (public.mi_rol() in (%s) and public.puede_ver_contrato(numero_contrato) and (public.mi_rol() <> ''venta'' or public.soy_asesor_del_contrato(numero_contrato)))',
      t || ': eliminar', t, roles);
  end loop;
end $$;

-- ── contrato_servicios: además, `venta` nunca lee el costo ────────────────
-- La 146 le quitó la lectura (por la columna `costo`) pero le dejó escritura
-- con `puede_ver_contrato()`, es decir sobre contratos ajenos. Se corrige y de
-- paso se hace idempotente: la 146 creaba estas cuatro sin `drop` previo, así
-- que re-correrla fallaba igual que pasó con la 142.
drop policy if exists "contrato_servicios: interno" on public.contrato_servicios;
drop policy if exists "contrato_servicios: lectura" on public.contrato_servicios;
drop policy if exists "contrato_servicios: escritura" on public.contrato_servicios;
drop policy if exists "contrato_servicios: insertar" on public.contrato_servicios;
drop policy if exists "contrato_servicios: actualizar" on public.contrato_servicios;
drop policy if exists "contrato_servicios: eliminar" on public.contrato_servicios;

-- Lectura sin `venta`: la tabla tiene `costo` (el neto del proveedor) y RLS no
-- filtra columnas. Hoy ninguna pantalla le muestra servicios a un asesor; si
-- algún día hace falta, se resuelve con una vista sin `costo`, igual que
-- `ventas_basica`. No se crea ahora para no dejar código muerto.
create policy "contrato_servicios: lectura" on public.contrato_servicios
  for select
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones')
         and public.puede_ver_contrato(numero_contrato));

create policy "contrato_servicios: insertar" on public.contrato_servicios
  for insert
  with check (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
              and public.puede_ver_contrato(numero_contrato)
              and (public.mi_rol() <> 'venta' or public.soy_asesor_del_contrato(numero_contrato)));

create policy "contrato_servicios: actualizar" on public.contrato_servicios
  for update
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
         and public.puede_ver_contrato(numero_contrato)
         and (public.mi_rol() <> 'venta' or public.soy_asesor_del_contrato(numero_contrato)))
  with check (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
              and public.puede_ver_contrato(numero_contrato)
              and (public.mi_rol() <> 'venta' or public.soy_asesor_del_contrato(numero_contrato)));

create policy "contrato_servicios: eliminar" on public.contrato_servicios
  for delete
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
         and public.puede_ver_contrato(numero_contrato)
         and (public.mi_rol() <> 'venta' or public.soy_asesor_del_contrato(numero_contrato)));

-- ── contrato_pasajeros y contrato_adjuntos: idempotencia ──────────────────
-- Su regla (solo contratos propios para `venta`) ya es correcta desde la 142.
-- Solo se re-declaran para que existan con `drop` previo y la migración se
-- pueda re-correr.
drop policy if exists "contrato_pasajeros: interno" on public.contrato_pasajeros;
create policy "contrato_pasajeros: interno" on public.contrato_pasajeros for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
         and public.puede_ver_contrato(numero_contrato)
         and (public.mi_rol() <> 'venta' or public.soy_asesor_del_contrato(numero_contrato)))
  with check (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
         and public.puede_ver_contrato(numero_contrato)
         and (public.mi_rol() <> 'venta' or public.soy_asesor_del_contrato(numero_contrato)));

drop policy if exists "contrato_adjuntos: interno" on public.contrato_adjuntos;
create policy "contrato_adjuntos: interno" on public.contrato_adjuntos for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
         and public.puede_ver_contrato(numero_contrato)
         and (public.mi_rol() <> 'venta' or public.soy_asesor_del_contrato(numero_contrato)))
  with check (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
         and public.puede_ver_contrato(numero_contrato)
         and (public.mi_rol() <> 'venta' or public.soy_asesor_del_contrato(numero_contrato)));

notify pgrst, 'reload schema';
