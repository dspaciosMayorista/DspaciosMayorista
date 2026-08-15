-- ───────────────────────────────────────────────────────────────────────────
-- 150 · STORAGE — el bucket `contratos` se separa por AGENCIA
--
-- QUÉ ARREGLA
--   Las cuatro policies de la 148 tienen esta forma:
--
--     bucket_id = 'contratos'
--     and mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
--     and (mi_rol() <> 'venta' or soy_asesor_del_contrato(split_part(name,'/',1)))
--
--   Dos agujeros, los dos de lógica pura:
--
--   1. Para cualquier rol que NO sea `venta`, `mi_rol() <> 'venta'` ya es TRUE,
--      así que el `or` se resuelve ahí y `soy_asesor_del_contrato` no llega a
--      evaluarse. La condición de propiedad no participa.
--   2. NINGUNA policy compara el tenant. `soy_asesor_del_contrato` tampoco: es
--      SECURITY DEFINER y empareja solo por nombre contra `ventas.asesor`.
--
--   Resultado: un `gerencia`/`administracion`/`operaciones` de CUALQUIERA de las
--   dos agencias alcanzaba TODOS los archivos del bucket. Y un `venta` alcanzaba
--   los de un contrato de la OTRA agencia si su nombre coincidía con
--   `ventas.asesor` — que no es teórico: el importador de minorista escribe ahí
--   el nombre del freelance que venía en la hoja, así que una persona interna de
--   mayorista que se llame igual cae justo en ese caso.
--
--   El contrato en sí nunca se filtró (`puede_ver_contrato` sí compara el
--   tenant). Lo expuesto eran los ARCHIVOS: cédulas, pasaportes y soportes.
--
-- QUÉ QUEDA DESPUÉS
--   superadmin                              → todo el bucket (alcance global).
--   gerencia / administracion / operaciones → solo contratos de SU agencia.
--   venta                                   → solo contratos de SU agencia
--                                             donde ADEMÁS sea el asesor.
--   cualquier otro rol, o inactivo, o sin sesión → nada.
--
-- ⚠️ ASIMETRÍA DELIBERADA CON `gerencia` — LEER ANTES DE APLICAR
--   `puede_ver_tenant()` (migración 107) deja a `gerencia` ver las FILAS de las
--   dos agencias:
--
--     select mi_rol() in ('superadmin','gerencia') or mi_tenant() = t;
--
--   Esta migración NO reproduce esa excepción: aquí `gerencia` queda acotada a
--   su propia agencia, por instrucción explícita del dueño. La consecuencia es
--   que un `gerencia` podrá ver la ficha de un contrato de la otra agencia pero
--   NO sus adjuntos. Es una inconsistencia real entre las dos reglas, y está
--   escrita aquí a propósito para que se decida a conciencia:
--     · si lo correcto es que gerencia sea cross-agencia, hay que quitarle la
--       comparación de tenant a `es_gerencia` en el helper de abajo;
--     · si lo correcto es que NO lo sea, hay que corregir `puede_ver_tenant`,
--       que es un cambio mucho más amplio y no se hace aquí.
--   Desarrollo completo de las dos salidas, con el checklist de qué auditar
--   antes de tocar `puede_ver_tenant()` (la usan más tablas que `ventas`):
--   `docs/futuro/puede-ver-tenant-gerencia.md`. Trabajo SEPARADO — no mezclar
--   con esta migración.
--
-- ⚠️ ESTE BUCKET NO GUARDA SOLO ADJUNTOS DE CONTRATO
--   Auditadas TODAS las rutas que la aplicación escribe en él. Son dos, y solo
--   dos (verificado por búsqueda de `storage.from("contratos")` en todo el
--   código):
--
--     1. `<numero_contrato>/<tipo>-<epoch>.<ext>`
--        AdjuntosContrato.tsx. El primer segmento ES el número de contrato
--        (`00-0451`, `MIN-00-0460`; nunca lleva `/`).
--
--     2. `pe-empleados/<pe_empleados.id>-<epoch>.<ext>`
--        PuntoEquilibrioClient.tsx — contratos laborales de nómina. El primer
--        segmento NO es un número de contrato.
--
--   La carpeta de nómina SÍ tiene con qué aislarse: el id del empleado va en el
--   nombre y `pe_empleados` tiene columna `tenant`. Se refleja exactamente la
--   RLS de esa tabla, que es la autoridad sobre esos datos:
--
--     pe_empleados: acceso contable
--       mi_rol() in ('superadmin','gerencia','administracion')
--       and puede_ver_tenant(tenant)
--
--   Nota: hoy `operaciones` y `venta` pueden abrir esos archivos por Storage
--   aunque NO puedan leer la tabla `pe_empleados`. Eso también se cierra aquí:
--   son contratos laborales con el salario de cada empleado.
--
-- ⚠️ PREFIJO DESCONOCIDO → SOLO superadmin (falla cerrado)
--   Si un objeto no está bajo `pe-empleados/` y su primer segmento no
--   corresponde a ninguna fila de `ventas`, nadie salvo superadmin lo alcanza.
--   Es deliberado: preferir un archivo inaccesible a un archivo filtrado. Pero
--   PUEDE dejar sin acceso a objetos históricos con otra forma de ruta, así que
--   ANTES de aplicar esta migración conviene listarlos (CONSULTA 1, solo
--   lectura):
--
--     select split_part(o.name, '/', 1) as prefijo, count(*)
--       from storage.objects o
--      where o.bucket_id = 'contratos'
--        and split_part(o.name, '/', 1) <> 'pe-empleados'
--        and not exists (select 1 from public.ventas v
--                         where v.numero_contrato = split_part(o.name, '/', 1))
--      group by 1 order by 2 desc;
--
--   El mismo riesgo existe del lado de nómina: el helper extrae el id de
--   `pe_empleados` de los dígitos iniciales del segundo segmento
--   (`pe-empleados/<id>-<epoch>.<ext>`) y niega el acceso si no puede
--   extraerlo o si ese id no corresponde a ninguna fila de `pe_empleados`.
--   CONSULTA 2, solo lectura, para listar esos objetos ANTES de aplicar la
--   migración. Evita a propósito un `::bigint` sobre el segmento crudo (podría
--   no ser numérico y abortaría una consulta que debe ser inofensiva); compara
--   como texto contra `pe_empleados.id::text` en su lugar:
--
--     select o.name,
--            substring(split_part(o.name, '/', 2) from '^[0-9]+') as id_extraido
--       from storage.objects o
--      where o.bucket_id = 'contratos'
--        and split_part(o.name, '/', 1) = 'pe-empleados'
--        and not exists (
--          select 1 from public.pe_empleados e
--           where e.id::text = substring(split_part(o.name, '/', 2) from '^[0-9]+')
--        )
--      order by 1;
--
--   Cualquier fila que devuelva CUALQUIERA de las dos consultas hay que
--   revisarla y decidir qué hacer con ella ANTES de aplicar esta migración,
--   no después — si se aplica sin revisar, esos objetos quedan fuera del
--   alcance de todos salvo superadmin. Si las dos devuelven vacío, esta
--   migración no deja a nadie sin nada.
--
-- ⚠️ ORDEN DE DESPLIEGUE — el código nuevo va ANTES que esta migración
--   El código de esta rama (manejo de adjuntos huérfanos, ver
--   `lib/adjuntos/operaciones.ts`) funciona igual de bien contra las policies
--   VIEJAS (148) que contra las nuevas de esta migración: no depende de cuál
--   de las dos esté activa. Lo que NO es cierto al revés — el código VIEJO no
--   sabe manejar los fallos de Storage que esta migración puede producir (un
--   objeto que antes era alcanzable y ahora no) de la forma robusta que esta
--   rama corrige. Aplicar la 150 antes de desplegar el código dejaría, durante
--   la ventana entre la migración y el deploy, al código viejo lidiando con
--   esos fallos con el comportamiento de huérfanos que este PR justamente
--   arregla. Por eso el orden correcto es:
--
--     a) Ejecutar las dos consultas preventivas de arriba (solo lectura).
--     b) Si ninguna devuelve objetos problemáticos (o ya se revisaron y
--        resolvieron los que aparecieron), fusionar el PR.
--     c) Esperar el despliegue correcto en producción (Vercel).
--     d) Hacer una prueba básica de adjuntos (subir/ver/eliminar uno) con el
--        código nuevo ya en producción, TODAVÍA sobre las policies viejas.
--     e) Solo entonces ejecutar esta migración (150).
--     f) Ejecutar las pruebas posteriores de Storage y por roles:
--        `supabase/scripts/test_storage_por_tenant.sql`,
--        `supabase/scripts/test_storage_cruce_tenant.sql` y
--        `supabase/scripts/pruebas/storage-adjuntos.mjs --confirmar`.
--
--   Invertir el orden (correr la 150 antes de desplegar, o desplegar antes de
--   revisar las consultas preventivas) reabre temporalmente la misma clase de
--   problema que este PR cierra.
--
-- ROLLBACK: `supabase/scripts/rollback_150_storage_contratos.sql`
--   Restituye exactamente las cuatro policies de la 148 y borra el helper.
-- ───────────────────────────────────────────────────────────────────────────

-- ── 1. El helper ──────────────────────────────────────────────────────────
--
-- SECURITY DEFINER porque tiene que leer `ventas` y `pe_empleados` por encima
-- de la RLS: desde la migración 144 el rol `venta` NO tiene ninguna policy de
-- SELECT sobre `ventas`, así que como INVOKER esta función devolvería `false`
-- para él siempre y le cerraría hasta sus propios adjuntos. Por eso NO se usa
-- `puede_ver_contrato()`: esa función resuelve "quién ve la FILA del contrato",
-- que es una pregunta distinta y con otra respuesta (a `gerencia` la deja
-- cross-agencia, y a `venta` le da toda su agencia, no solo lo suyo).
--
-- `search_path` fijo con `pg_temp` AL FINAL: es la forma documentada de evitar
-- que una tabla temporal del llamante suplante a una tabla real dentro de una
-- función SECURITY DEFINER.
--
-- La función es deliberadamente mínima: recibe la ruta del objeto y devuelve
-- sí/no. No escribe, no revela por qué dijo que no, y no depende de nada que
-- venga del cliente salvo esa ruta —que es la que el propio Storage va a usar—.
create or replace function public.acceso_archivo_contratos(ruta text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol       text;
  v_tenant    text;
  v_prefijo   text;
  v_id_emp    bigint;
  v_tenant_ob text;    -- tenant del objeto (del contrato o del empleado)
  v_es_asesor boolean;
begin
  if ruta is null then return false; end if;

  -- Sesión real, usuario existente y ACTIVO. No se usa `mi_rol()` (que ya
  -- filtra por `activo` desde la 140) para no depender de eso desde aquí: el
  -- rol y el tenant se leen juntos en una sola consulta explícita.
  if auth.uid() is null then return false; end if;

  select u.rol::text, u.tenant
    into v_rol, v_tenant
    from public.usuarios u
   where u.id = auth.uid()
     and u.activo;

  if v_rol is null then return false; end if;   -- sin perfil, o desactivado

  -- superadmin: alcance global, por diseño.
  if v_rol = 'superadmin' then return true; end if;

  -- Un objeto sin carpeta no pertenece a ningún contrato ni a nómina.
  if position('/' in ruta) = 0 then return false; end if;
  v_prefijo := split_part(ruta, '/', 1);
  if v_prefijo = '' then return false; end if;

  -- ── Carpeta de nómina ───────────────────────────────────────────────────
  -- Refleja la RLS de `pe_empleados`, salvo la excepción cross-agencia de
  -- `puede_ver_tenant` para gerencia (ver el aviso de la cabecera).
  if v_prefijo = 'pe-empleados' then
    if v_rol not in ('gerencia', 'administracion') then return false; end if;

    -- `pe-empleados/<id>-<epoch>.<ext>` → el id son los dígitos iniciales.
    v_id_emp := nullif(substring(split_part(ruta, '/', 2) from '^[0-9]+'), '')::bigint;
    if v_id_emp is null then return false; end if;

    select e.tenant into v_tenant_ob
      from public.pe_empleados e
     where e.id = v_id_emp;

    return v_tenant_ob is not null and v_tenant_ob = v_tenant;
  end if;

  -- ── Adjuntos de contrato ────────────────────────────────────────────────
  select v.tenant, public.soy_ese_asesor(v.asesor)
    into v_tenant_ob, v_es_asesor
    from public.ventas v
   where v.numero_contrato = v_prefijo;

  -- Prefijo que no corresponde a ningún contrato: cerrado (ver cabecera).
  if v_tenant_ob is null then return false; end if;

  -- LA COMPARACIÓN QUE FALTABA. Esto es lo que rechaza a un `venta` con el
  -- mismo nombre en la otra agencia: aunque `soy_ese_asesor` diga que sí
  -- —empareja por texto y no mira la agencia—, el tenant no coincide.
  if v_tenant_ob <> v_tenant then return false; end if;

  if v_rol = 'venta' then
    return coalesce(v_es_asesor, false);
  end if;

  return v_rol in ('gerencia', 'administracion', 'operaciones');
end;
$$;

comment on function public.acceso_archivo_contratos(text) is
  'Decide si el usuario de la sesión puede tocar un objeto del bucket `contratos`. '
  'Comprueba sesión, usuario activo, rol, agencia (tenant) y, para el rol `venta`, '
  'propiedad del contrato. Migración 150.';

revoke all on function public.acceso_archivo_contratos(text) from public;
grant execute on function public.acceso_archivo_contratos(text) to authenticated;

-- ── 2. Las cuatro policies ────────────────────────────────────────────────
-- El MISMO control en SELECT, INSERT, UPDATE y DELETE. En UPDATE va en las dos
-- mitades: `using` decide qué fila se puede tomar y `with check` qué queda
-- después — sin la segunda, se podría mover un objeto propio a la carpeta de
-- otra agencia.
drop policy if exists "contratos files: acceso"     on storage.objects;
drop policy if exists "contratos files: lectura"    on storage.objects;
drop policy if exists "contratos files: subir"      on storage.objects;
drop policy if exists "contratos files: reemplazar" on storage.objects;
drop policy if exists "contratos files: eliminar"   on storage.objects;

create policy "contratos files: lectura" on storage.objects
  for select
  using (bucket_id = 'contratos' and public.acceso_archivo_contratos(name));

create policy "contratos files: subir" on storage.objects
  for insert
  with check (bucket_id = 'contratos' and public.acceso_archivo_contratos(name));

create policy "contratos files: reemplazar" on storage.objects
  for update
  using      (bucket_id = 'contratos' and public.acceso_archivo_contratos(name))
  with check (bucket_id = 'contratos' and public.acceso_archivo_contratos(name));

create policy "contratos files: eliminar" on storage.objects
  for delete
  using (bucket_id = 'contratos' and public.acceso_archivo_contratos(name));
