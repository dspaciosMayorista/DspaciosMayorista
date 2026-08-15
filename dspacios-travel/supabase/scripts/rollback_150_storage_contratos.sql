-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK de la migración 150 (Storage: bucket `contratos` por agencia)
--
-- Deja el bucket EXACTAMENTE como lo dejó la migración 148: las mismas cuatro
-- policies, con el mismo texto, y sin el helper.
--
-- ⚠️ VOLVER ATRÁS REABRE EL AGUJERO.
--   Con estas policies, cualquier `gerencia`/`administracion`/`operaciones` de
--   cualquiera de las dos agencias vuelve a alcanzar TODOS los archivos del
--   bucket, y un `venta` vuelve a alcanzar los de un contrato de la otra
--   agencia si su nombre coincide con `ventas.asesor`. Úsalo solo si la 150
--   rompe un flujo real y hace falta tiempo para arreglarla.
--
-- Se pega en el editor SQL de Supabase. Es idempotente.
-- ───────────────────────────────────────────────────────────────────────────

drop policy if exists "contratos files: lectura"    on storage.objects;
drop policy if exists "contratos files: subir"      on storage.objects;
drop policy if exists "contratos files: reemplazar" on storage.objects;
drop policy if exists "contratos files: eliminar"   on storage.objects;

-- Texto idéntico al de la migración 148.
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

-- El helper se va con las policies: nada más lo usa.
drop function if exists public.acceso_archivo_contratos(text);
