-- Migración 142: el rol `venta` ve TODOS los contratos de SU agencia
--
-- CONTEXTO
-- La migración 141 dejó al rol `venta` viendo únicamente los contratos donde
-- figura como asesor. En la práctica no alcanza: los asesores se cubren entre
-- ellos y necesitan consultar cualquier contrato de su agencia. Decisión del
-- dueño: que vean todos los de su agencia, pero solo información básica.
--
-- Además, restringir por nombre traía un problema de datos real: los contratos
-- que entraron por el IMPORTADOR DE MINORISTA guardan en `ventas.asesor` el
-- texto libre de la hoja de cálculo ("JUAN PEREZ"), que no coincide carácter a
-- carácter con `usuarios.nombre` ("Juan Pérez"). Esos asesores no veían sus
-- propios contratos aunque la 141 estuviera aplicada.
--
-- QUÉ CAMBIA
--   · `ventas` SELECT para `venta` → todos los de su tenant (antes: solo los
--     suyos, y por comparación exacta de nombre). El aislamiento entre
--     mayorista y minorista se mantiene intacto vía `puede_ver_tenant()`.
--   · Las hijas heredan eso automáticamente (siguen usando
--     `puede_ver_contrato()` de la 141), así que un asesor ve el detalle de
--     cualquier contrato de su agencia.
--   · EXCEPCIÓN — datos personales de pasajeros: `contrato_pasajeros` y
--     `contrato_adjuntos` siguen restringidos a los contratos PROPIOS cuando
--     el rol es `venta`. Un asesor puede consultar el contrato de un colega,
--     pero no el documento y la fecha de nacimiento de sus pasajeros ni sus
--     archivos adjuntos.
--
-- LO QUE NO CAMBIA
--   · "Información básica" a nivel de columnas ya lo resuelve la app: el rol
--     `venta` no está en `verFinanzas`, así que no ve costos ni márgenes en el
--     detalle del contrato. La RLS trabaja por filas, no por columnas.
--   · `ventas` UPDATE sigue vedado a `venta` (solo superadmin/gerencia/
--     administracion/operaciones), así que no puede editar la cabecera de
--     ningún contrato, ni propio ni ajeno.
--   · `sillas` sigue excluyendo a `venta` por completo.
--
-- NOTA: la comparación de asesor queda NORMALIZADA (minúsculas y sin espacios
-- sobrantes) para que los contratos importados sí crucen. Las tildes siguen
-- siendo una diferencia real ("PEREZ" ≠ "Pérez"); si aparecen casos así, lo
-- correcto es la deuda ya anotada en la 141: una columna `ventas.asesor_id
-- uuid` con FK a `usuarios`, en vez de emparejar por texto.

-- ── Helpers ───────────────────────────────────────────────────────────────

-- Comparación normalizada: los contratos importados traen el nombre en
-- mayúsculas y con espacios sobrantes desde la hoja de cálculo.
create or replace function public.soy_ese_asesor(a text)
returns boolean language sql stable security definer set search_path = public as $$
  select a is not null and exists (
    select 1 from public.usuarios u
    where u.id = auth.uid() and u.activo
      and lower(btrim(a)) in (lower(btrim(u.nombre)), lower(btrim(u.email)))
  );
$$;

-- ¿Soy el asesor de ESTE contrato? Devuelve solo un booleano sobre uno mismo,
-- así que puede ser SECURITY DEFINER sin filtrar datos de nadie.
create or replace function public.soy_asesor_del_contrato(num text)
returns boolean language sql stable security definer set search_path = public as $$
  select num is not null and exists (
    select 1 from public.ventas v
    where v.numero_contrato = num and public.soy_ese_asesor(v.asesor)
  );
$$;

-- ── `ventas`: el asesor ve toda su agencia ────────────────────────────────
drop policy if exists "ventas: asesor ve sus contratos" on public.ventas;
create policy "ventas: venta ve su agencia"
  on public.ventas for select
  using (
    public.mi_rol() = 'venta'
    and public.puede_ver_tenant(tenant)
  );

-- ── Datos personales de pasajeros: solo en contratos propios ──────────────
-- El resto de hijas (hoteles, vuelos, items, servicios, vouchers, cuotas) se
-- quedan como las dejó la 141: heredan la visibilidad del contrato padre.

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
