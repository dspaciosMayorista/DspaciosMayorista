-- ─────────────────────────────────────────────────────────────────────────
-- ROLLBACK de la migración 148  ·  NO EJECUTAR salvo que haya que devolverse
-- ─────────────────────────────────────────────────────────────────────────
--
-- Deja la base EXACTAMENTE en el estado posterior a la 147 y anterior a la 148.
-- Ni un paso más atrás: no toca nada de la 147, la 146, la 144 ni la 142.
--
-- ⚠️ CUÁNDO SE USA
--   Solo si se corrió la 148 y hay que revertirla. Si además ya se corrió la
--   149, PRIMERO hay que revertir la 149 (bloque 0 de abajo), porque la 149
--   depende de que `venta` no lea `contrato_vuelos` y la 147 lo devuelve.
--
-- ⚠️ QUÉ NO REVIERTE — y no puede
--   Los datos. La 148 no borra ni modifica ninguna fila: solo crea vistas y
--   cambia policies. Por eso este archivo es puro DDL y es seguro correrlo:
--   no hay pérdida de información posible. Si lo que se quiere recuperar son
--   DATOS, esto no sirve — hay que restaurar del backup lógico.
--
-- ⚠️ EFECTO INMEDIATO SOBRE LA APP
--   Si el código nuevo YA está desplegado, revertir la 148 rompe la ficha del
--   contrato y la página imprimible: quedan pidiendo `contrato_vuelos_basica`
--   y `abonos_resumen`, que este archivo elimina. El orden correcto para
--   devolverse es: revertir primero el DESPLIEGUE (volver al deploy anterior
--   en Vercel) y solo después correr esto.
--
-- Idempotente: se puede correr dos veces sin fallar.

begin;

-- ═════════════════════════════════════════════════════════════════════════
-- 0. Si la 149 ya se corrió, deshacerla primero
-- ═════════════════════════════════════════════════════════════════════════
-- La 149 le quitó a `venta` el SELECT sobre `contrato_vuelos`. Se devuelve a
-- como lo dejó la 147 (con `venta` incluido). Si la 149 nunca se corrió, esto
-- reescribe la policy con el mismo contenido que ya tenía: inofensivo.
drop policy if exists "contrato_vuelos: lectura" on public.contrato_vuelos;
create policy "contrato_vuelos: lectura" on public.contrato_vuelos for select
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
         and public.puede_ver_contrato(numero_contrato));

-- ═════════════════════════════════════════════════════════════════════════
-- 1. Storage: volver a la policy única de la migración 046
-- ═════════════════════════════════════════════════════════════════════════
-- ⚠️ Esto REABRE el bucket `contratos` a todo el rol `venta` (cédulas y
-- soportes de pago de cualquier contrato, incluidos los de otros asesores).
-- Es el estado que había antes de la 148 — se documenta para que quede claro
-- qué se está devolviendo, no porque sea deseable.
drop policy if exists "contratos files: lectura"     on storage.objects;
drop policy if exists "contratos files: subir"       on storage.objects;
drop policy if exists "contratos files: reemplazar"  on storage.objects;
drop policy if exists "contratos files: eliminar"    on storage.objects;

drop policy if exists "contratos files: acceso" on storage.objects;
create policy "contratos files: acceso" on storage.objects
  for all
  using (bucket_id = 'contratos' and public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta'))
  with check (bucket_id = 'contratos' and public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta'));

-- ═════════════════════════════════════════════════════════════════════════
-- 2. `vouchers`: volver a las cuatro policies tal como las dejó la 147
-- ═════════════════════════════════════════════════════════════════════════
-- Diferencia con la 148: en la LECTURA no va la condición de propiedad (la 147
-- dejaba a `venta` leyendo los vouchers de toda su agencia, `share_token`
-- incluido). Las tres escrituras son idénticas en ambas.
drop policy if exists "vouchers: interno"     on public.vouchers;
drop policy if exists "vouchers: lectura"     on public.vouchers;
drop policy if exists "vouchers: insertar"    on public.vouchers;
drop policy if exists "vouchers: actualizar"  on public.vouchers;
drop policy if exists "vouchers: eliminar"    on public.vouchers;

create policy "vouchers: lectura" on public.vouchers for select
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
         and public.puede_ver_contrato(numero_contrato));

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

-- ═════════════════════════════════════════════════════════════════════════
-- 3. `abonos`: quitar la policy de lectura que agregó la 148
-- ═════════════════════════════════════════════════════════════════════════
-- Antes de la 148, `abonos` tenía UNA sola policy ("acceso contable", de la
-- 005/116) que NO incluye a `venta`. No se toca: sigue donde estaba.
-- ⚠️ Al quitar esto, el asesor vuelve a ver "Pagado $0 / Saldo = precio
-- completo" en la pestaña Cartera, incluso en sus propios contratos.
drop policy if exists "abonos: venta consulta" on public.abonos;

-- ═════════════════════════════════════════════════════════════════════════
-- 4. Vistas nuevas de la 148: eliminarlas
-- ═════════════════════════════════════════════════════════════════════════
drop view if exists public.abonos_resumen;
drop view if exists public.contrato_vuelos_basica;

-- ═════════════════════════════════════════════════════════════════════════
-- 5. `ventas_basica`: volver a la definición EXACTA de la 147
-- ═════════════════════════════════════════════════════════════════════════
-- Diferencias con la 148 (las tres se revierten aquí):
--   · `cliente_documento` vuelve a salir COMPLETO para toda la agencia;
--   · `cliente_direccion` y `asesor_firma_cc` vuelven a estar FUERA de la vista.
-- Copia literal del bloque de la migración 147.
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

commit;

-- ═════════════════════════════════════════════════════════════════════════
-- COMPROBACIÓN DESPUÉS DE CORRER ESTE ARCHIVO
-- ═════════════════════════════════════════════════════════════════════════
-- Debe devolver 0 filas en las tres consultas:
--
--   select 1 from information_schema.views
--    where table_schema='public' and table_name in ('abonos_resumen','contrato_vuelos_basica');
--
--   select 1 from pg_policies where tablename='abonos' and policyname='abonos: venta consulta';
--
--   select 1 from pg_policies where schemaname='storage'
--    and policyname in ('contratos files: lectura','contratos files: subir',
--                       'contratos files: reemplazar','contratos files: eliminar');
--
-- Esta debe devolver 1 fila (vuelve la policy única de la 046):
--
--   select 1 from pg_policies where schemaname='storage' and policyname='contratos files: acceso';
--
-- Y esta 0 filas — la 147 NO tenía esas columnas en la vista:
--
--   select 1 from information_schema.columns
--    where table_schema='public' and table_name='ventas_basica'
--      and column_name in ('cliente_direccion','asesor_firma_cc');
--
-- El script `verificar_rollback_148.sql` corre las cinco de una vez.
