-- Migración 141: las tablas hijas del contrato heredan el permiso de `ventas`
--
-- PROBLEMA
-- `ventas` decidía bien quién ve qué (rol + dueño + tenant), pero TODAS sus
-- tablas hijas se quedaron en un chequeo de solo rol:
--
--     using (public.mi_rol() in (...,'venta'))
--
-- Sin dueño y sin tenant. La puerta principal con llave y las ventanas
-- abiertas: un asesor con rol `venta` no podía listar los contratos de sus
-- compañeros en `ventas`, pero sí consultar `contrato_pasajeros` directo y
-- sacar nombre, documento y fecha de nacimiento de TODOS los pasajeros de la
-- empresa — y de las DOS agencias, porque ahí tampoco había filtro de tenant.
-- Con `contrato_items` salían todos los precios. No hacía falta vulnerar nada:
-- son las mismas credenciales de la app llamando la API de Supabase directo.
--
-- SOLUCIÓN — herencia, no copia
-- En vez de repetir "rol + dueño + tenant" en cada hija (ocho copias que se
-- desincronizan, que es justo lo que motivó la migración 137), cada hija
-- pregunta si su contrato padre es visible:
--
--     using (<roles de siempre> and public.puede_ver_contrato(numero_contrato))
--
-- `puede_ver_contrato()` hace un EXISTS contra `ventas`, así que hereda TODO
-- lo que `ventas` ya decide (rol, dueño y tenant) y lo seguirá heredando si
-- esa regla cambia mañana. Una sola fuente de verdad.
--
-- ⚠️ `puede_ver_contrato()` NO puede ser SECURITY DEFINER: necesita correr con
-- los permisos de QUIEN pregunta para que la RLS de `ventas` se le aplique. Si
-- fuera DEFINER se saltaría esa RLS y devolvería siempre true, que es
-- exactamente lo contrario de lo que buscamos.
--
-- BUG DE PASO: el rol `venta` no veía NINGÚN contrato
-- La policy de `ventas` comparaba `asesor` contra el EMAIL del usuario, pero
-- en `asesor` la app siempre guarda el NOMBRE (`perfil.nombre` en el formulario
-- de contrato y en Reservar). Nombre contra email nunca coincide, así que un
-- rol `venta` veía la lista de contratos VACÍA. Ese bug pasaba desapercibido
-- justamente porque las hijas sí le mostraban todo. Al heredar de `ventas` hay
-- que arreglarlo o los asesores quedarían sin acceso a nada.
-- `soy_ese_asesor()` compara contra nombre Y correo, para cubrir también las
-- filas históricas que hubieran quedado guardadas con el email.
--
-- ⚠️ CAMBIO DE COMPORTAMIENTO A VERIFICAR: a partir de aquí un rol `venta` ve
-- sus contratos (antes: ninguno) y deja de ver los ajenos (antes: las hijas de
-- todos). Un `venta` tampoco podrá ya crear un contrato a nombre de OTRO
-- asesor: al insertar las hijas, el EXISTS no encontraría el padre. Los roles
-- superadmin/gerencia/administracion/operaciones no cambian en nada.
--
-- NOTA (deuda conocida): identificar al asesor por nombre es débil — dos
-- usuarios homónimos se verían los contratos. Lo correcto sería una columna
-- `ventas.asesor_id uuid` con FK a `usuarios` y su backfill. Se deja anotado
-- como siguiente paso; esta migración no cambia el modelo de datos.

-- ── Helpers ───────────────────────────────────────────────────────────────

-- SIN security definer: debe heredar la RLS de `ventas` del que pregunta.
create or replace function public.puede_ver_contrato(num text)
returns boolean language sql stable as $$
  select num is not null and exists (
    select 1 from public.ventas v where v.numero_contrato = num
  );
$$;

-- CON security definer: lee la fila propia de `usuarios` (mismo criterio que
-- `mi_rol()`). Exige `activo` por coherencia con la migración 140.
create or replace function public.soy_ese_asesor(a text)
returns boolean language sql stable security definer set search_path = public as $$
  select a is not null and exists (
    select 1 from public.usuarios u
    where u.id = auth.uid() and u.activo and (u.nombre = a or u.email = a)
  );
$$;

-- ── `ventas`: arreglar la identificación del asesor ───────────────────────
drop policy if exists "ventas: asesor ve sus contratos" on public.ventas;
create policy "ventas: asesor ve sus contratos"
  on public.ventas for select
  using (
    public.mi_rol() = 'venta'
    and public.soy_ese_asesor(asesor)
    and public.puede_ver_tenant(tenant)
  );

-- ── Hijas: mismos roles de siempre + herencia del contrato padre ──────────

drop policy if exists "contrato_pasajeros: interno" on public.contrato_pasajeros;
create policy "contrato_pasajeros: interno" on public.contrato_pasajeros for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
         and public.puede_ver_contrato(numero_contrato))
  with check (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
         and public.puede_ver_contrato(numero_contrato));

drop policy if exists "contrato_hoteles: interno" on public.contrato_hoteles;
create policy "contrato_hoteles: interno" on public.contrato_hoteles for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
         and public.puede_ver_contrato(numero_contrato))
  with check (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
         and public.puede_ver_contrato(numero_contrato));

drop policy if exists "contrato_vuelos: interno" on public.contrato_vuelos;
create policy "contrato_vuelos: interno" on public.contrato_vuelos for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
         and public.puede_ver_contrato(numero_contrato))
  with check (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
         and public.puede_ver_contrato(numero_contrato));

drop policy if exists "contrato_items: interno" on public.contrato_items;
create policy "contrato_items: interno" on public.contrato_items for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
         and public.puede_ver_contrato(numero_contrato))
  with check (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
         and public.puede_ver_contrato(numero_contrato));

drop policy if exists "contrato_servicios: interno" on public.contrato_servicios;
create policy "contrato_servicios: interno" on public.contrato_servicios for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
         and public.puede_ver_contrato(numero_contrato))
  with check (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
         and public.puede_ver_contrato(numero_contrato));

drop policy if exists "contrato_adjuntos: interno" on public.contrato_adjuntos;
create policy "contrato_adjuntos: interno" on public.contrato_adjuntos for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
         and public.puede_ver_contrato(numero_contrato))
  with check (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
         and public.puede_ver_contrato(numero_contrato));

drop policy if exists "vouchers: interno" on public.vouchers;
create policy "vouchers: interno" on public.vouchers for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
         and public.puede_ver_contrato(numero_contrato))
  with check (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
         and public.puede_ver_contrato(numero_contrato));

drop policy if exists "cuotas: interno" on public.cuotas;
create policy "cuotas: interno" on public.cuotas for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
         and public.puede_ver_contrato(numero_contrato))
  with check (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
         and public.puede_ver_contrato(numero_contrato));

-- `contrato_facturacion` ya excluía a `venta` (solo roles contables), pero le
-- faltaba el aislamiento por tenant: se lo damos por la misma herencia.
drop policy if exists "contrato_facturacion: acceso contable" on public.contrato_facturacion;
create policy "contrato_facturacion: acceso contable"
  on public.contrato_facturacion for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion')
         and public.puede_ver_contrato(numero_contrato))
  with check (public.mi_rol() in ('superadmin','gerencia','administracion')
         and public.puede_ver_contrato(numero_contrato));

-- El EXISTS pega contra la PK de `ventas` (numero_contrato), que ya está
-- indexada. Estos índices son para el otro lado del join: filtrar la hija por
-- contrato, que es como las lee la app.
create index if not exists idx_contrato_pasajeros_num on public.contrato_pasajeros(numero_contrato);
create index if not exists idx_contrato_hoteles_num   on public.contrato_hoteles(numero_contrato);
create index if not exists idx_contrato_vuelos_num    on public.contrato_vuelos(numero_contrato);
create index if not exists idx_contrato_items_num     on public.contrato_items(numero_contrato);
create index if not exists idx_contrato_servicios_num on public.contrato_servicios(numero_contrato);
create index if not exists idx_contrato_adjuntos_num  on public.contrato_adjuntos(numero_contrato);
create index if not exists idx_vouchers_num           on public.vouchers(numero_contrato);
create index if not exists idx_cuotas_num             on public.cuotas(numero_contrato);

notify pgrst, 'reload schema';
