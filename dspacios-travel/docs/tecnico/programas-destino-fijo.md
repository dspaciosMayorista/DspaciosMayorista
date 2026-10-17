# Programas — destino fijo (hotfix #23, migración 213)

> Referencia de código. Regla de negocio aprobada por el dueño: el tarifario público agrupa y
> filtra los programas por una **lista comercial fija de destinos**, administrada a mano y
> separada del catálogo de ciudades/IATA y de la Ruta del circuito.

## 1. Regla

- **Lista** `programa_destinos_fijos` ("Lista destino programas"): Producto > Destinos > pestaña
  **Listas fijas**. Alta, renombrar y eliminar (solo si ningún programa lo tiene asignado).
- **Asignación**: pestaña **General** del programa, desplegable "Destino del programa" (UN destino).
  Nunca se deduce de la Ruta ni se asigna solo a los programas existentes.
- **Visibilidad pública** = `publicado` **y** destino fijo asignado (única regla:
  `programaVisibleEnPublico`, `lib/programas/destinoFijo.ts`). Sin destino el programa:
  - sigue visible y editable en el panel interno, con el distintivo **"No visible: falta destino"**;
  - no sale en el tarifario público (`getProgramasResumen(sb, true)` filtra `destino_fijo_id IS NOT NULL`);
  - no aparece en el filtro público (el filtro se arma con `destinosParaFiltro`, solo destinos fijos);
  - responde 404 a quien no es del equipo interno en la **ficha** `/tarifario/programa/[id]` y en el
    **PDF** `/tarifario/programa/[id]/doc` (incluidos agencia/freelance; interno sí puede abrirlos para revisar).
- **Destino provisional «Por clasificar»** (decisión de despliegue): destino marcado `es_provisional` en la base
  (a lo sumo uno; índice único parcial). Se identifica por la **marca**, nunca por el nombre: renombrarlo no le quita
  la marca y un destino real llamado «Por clasificar» no es el provisional. Los programas asignados a él **son
  visibles** en el tarifario (tienen destino), pero quedan pendientes de clasificar; el filtro público **no lo
  ofrece** (no es un destino comercial para el cliente), sus programas salen en «Todos los destinos».
- **Aviso** en `/dashboard/producto/programas`: ventana pequeña, accesible y descartable con **dos conteos
  separados** (programas activos): *sin destino* (**ocultos** del tarifario) y *por clasificar* (**visibles**, falta su
  destino real), cada uno con su mensaje y su botón de filtro. Se muestra cada vez que se entra a la página (no se
  recuerda el descarte; si ambos son 0 no aparece).

## 2. Mapa de código

| Qué | Dónde |
|---|---|
| Migración | `supabase/migrations/20260601000213_programa_destino_fijo.sql` (tabla, índice único, columna, FK RESTRICT, RLS, auditoría) |
| Reglas puras | `lib/programas/destinoFijo.ts` (visibilidad, conteo, mensaje, filtro, validación de nombre) |
| Consultas | `lib/programas.ts` → `getProgramasResumen` (campo `destino`) y `getProgramaDetalle` (`destinoFijo`) |
| Acciones de la lista | `app/(dashboard)/dashboard/producto/destinos/listas-actions.ts` (`crearDestinoFijo`, `crearDestinoProvisional`, renombrar, eliminar) |
| UI de la lista | `…/destinos/DestinosTabs.tsx`, `…/destinos/listas-fijas/{page,ListaDestinoProgramas}.tsx` |
| Asignación | `…/programas/CabeceraForm.tsx` + `actions.ts` (`destinoFijoId`, solo se escribe si el cliente lo envía) |
| Panel interno | `…/programas/page.tsx` + `ProgramasLista.tsx` (aviso y distintivo), `[id]/ProgramaEditor.tsx` (distintivo) |
| Público | `app/tarifario/TarifarioPublic.tsx` (`PorProgramas`), `app/tarifario/programa/[id]/{page,doc/page}.tsx` |

## 3. Permisos

- Lista: lectura pública (`anon` solo `select`); escritura RLS `superadmin/gerencia/administracion/operaciones`
  (igual que `ESCRITURA.producto` en `lib/roles.ts`). Las acciones además verifican `puedeEscribir("producto")`.
- Asignar destino = guardar la cabecera del programa (RLS de `programas`, sin cambios).
- Borrar un destino asignado: la acción lo rechaza con el conteo y la FK `ON DELETE RESTRICT` es el respaldo.
- Duplicados: índice único sobre `clave_ciudad_ruta(nombre)` (migración 212): sin mayúsculas, tildes ni
  espacios repetidos.

## 4. Plan de despliegue (H1: programas publicados sin destino)

**Hecho de partida**: la 213 no asigna ni deduce destinos. Si el código se desplegara sin más, todo programa
**publicado y activo sin destino fijo** desaparecería del tarifario público. **Decisión del dueño**: no clasificar
uno por uno con SQL; antes de desplegar el código, crear un destino provisional «Por clasificar» y asignarle allí
todos los programas existentes, para que **permanezcan visibles**. Después, con calma, se crean los destinos
reales en la pantalla nueva y se reasigna cada programa.

**Orden obligatorio** (todo SQL lo ejecuta el usuario; nada se ejecuta remoto desde el código ni desde las pruebas):

1. **Preflight** `supabase/scripts/preflight_213_programa_destino_fijo.sql` (solo lectura). Dos listas **completas,
   sin recortes**, una fila por programa:
   - **N1 = inventario** de TODOS los programas con `destino_fijo_id = NULL` (publicados, borradores e inactivos):
     conteo en `N1` (con el desglose por estado), una fila `N1L` por programa (`id [estado] nombre`) y la fila `N1V`
     con todos los ids en formato `(id),(id),...` — **es la que se pega en la plantilla**;
   - **H1 = verificación de visibilidad pública**: los publicados y activos sin destino (los que se ocultarían del
     tarifario): conteo `H1`, filas `H1L` y `H1V`. H1 está contenido en N1.
   Guardar la salida. Sin bloqueantes P1/P3 (P1 exige la 212).
2. **Aplicar la 213** (aditiva; el código viejo ignora lo nuevo). Siempre **antes** del código.
3. **Postcheck** `postcheck_213_programa_destino_fijo.sql`: 14 filas con `ok = true`.
4. **Plantilla** `supabase/scripts/plantilla_asignacion_213.sql` (crea el provisional si no existe y le asigna
   **exactamente** los ids pegados):
   - pegar la fila `N1V` (inventario completo, no solo H1) en el `INSERT` marcado; la lista debe ser **completa**;
   - ejecutar **tal cual**: termina en `ROLLBACK` y muestra la **vista previa** (provisional, programas que quedarán en
     él, los que siguen sin destino y la **verificación**); no persiste nada;
   - la plantilla **aborta todo** (sin dejar nada, ni con `commit`) si: hay ids **duplicados**, ids **inexistentes**,
     ids que ya tienen un destino **real** (contradictorios: no se pisan), existe un destino real llamado «Por clasificar»,
     quedaría algún programa **publicado y activo sin destino** (verificación H1 de visibilidad pública) o quedaría
     **cualquier** programa sin destino, borradores e inactivos incluidos (verificación de inventario); en ambos casos
     el mensaje lista uno por uno los que faltan, con su estado;
   - **no lee la Ruta** ni los nombres: solo asigna los ids de la lista;
   - revisada la vista previa, cambiar `rollback;` por `commit;` y ejecutar de nuevo (es idempotente).
   Alternativa sin SQL de datos: crear el provisional con el botón «Crear destino provisional» de Listas fijas y
   asignarlo desde General programa por programa (más lento; la plantilla es lo recomendado para cientos de programas).
5. **Preflight de nuevo**: `H1 = 0`, `N1 = 0` y `H1V` / `N1V = (ninguno)`. Recién entonces **desplegar el código**.
6. Después del despliegue, en la app: crear los destinos reales (Producto > Destinos > Listas fijas) y reasignar cada
   programa desde General > «Destino del programa». El aviso del panel muestra cuántos siguen **sin destino** y cuántos
   **por clasificar**; «Ver por clasificar» los filtra. Cuando el provisional queda sin programas se puede eliminar.

### 4.1 Verificación posterior al despliegue

- `/tarifario` > Programas: los programas siguen visibles; el filtro «Destino» lista solo destinos reales asignados
  (no «Por clasificar»); elegir uno muestra todos sus programas; «Todos los destinos» incluye los del provisional.
- Ficha y PDF de un programa en el provisional abren sin sesión; los de un programa sin destino responden 404 sin sesión
  (y con sesión agencia/freelance); con sesión interna sí abren.
- Producto > Programas: el aviso muestra los dos conteos; al clasificar todos, desaparece.

### 4.2 Rollback / contención

- Si algún programa debe ocultarse o mostrarse: quitarle o darle destino desde General (no requiere código).
- Revertir solo el código vuelve a mostrar todos los publicados (la 213 puede quedarse; es aditiva).
- `rollback_213_programa_destino_fijo.sql` destruye la lista y las asignaciones: solo con el código ya revertido.
- Si el código sale antes que el SQL: la lista de Programas y el tarifario público fallan (la columna no existe).

## 5. Pruebas

- SQL (PostgreSQL real, esquema vigente 001–212 sin la 211). Verificación reproducible:
  ```
  docker run -d --name pgesquema -e POSTGRES_PASSWORD=postgres public.ecr.aws/supabase/postgres:15.8.1.085
  sh supabase/scripts/preparar_esquema_local.sh pgesquema 212 plantilla213     # esquema 001–212, se detiene en el 1.er fallo real
  sh supabase/scripts/test_213_migracion.sh t213_prueba pgesquema plantilla213 # 213: históricos, preflight/postcheck, SQL, carreras, rollback
  ```
  `test_213_programa_destino_fijo.sql` cubre permisos, duplicados, asignación, RESTRICT y lectura anónima.
  `preparar_esquema_local.sh` distingue preparación del entorno (columna `storage.buckets.public`, reintento si el
  servidor se cae y se recupera) de fallos de esquema (detienen el script con el error completo).
- Unitarias: `pruebas/programaDestinoFijo.test.ts` (reglas y consultas con tablas en memoria).
- Integración / interacción: registradas en `npm run test:react` (con el loader complementario
  `pruebas/support/registrarProgramasRuta.mjs` -> `programasRutaLoader.mjs`): `pruebas/programaDestinoFijo.react.ts`, `…interaccion.react.ts`,
  `…filtro.react.ts` y `pruebas/programaRutaAlojamiento.react.ts` (#51).

## 6. Alcance, riesgos conocidos y comportamiento que NO cambia

Este hotfix cubre **la visibilidad en la vitrina pública** (tarifario, su filtro, ficha y PDF públicos). A propósito
**no** se cambió nada de lo siguiente; queda documentado como comportamiento previo vigente:

- **Reserva interna**: `/dashboard/reservar` y `/dashboard/reservar/programa/[id]` (y `reservarPrograma`) siguen sin
  consultar `publicado` ni destino. Un usuario autorizado con el enlace puede reservar un programa sin destino o
  en borrador, igual que antes. El tarifario interno (`/dashboard/tarifario`) y el listado de Reservar siguen
  mostrando los programas activos (con o sin destino); su filtro de destino solo ofrece destinos fijos.
- **Lectura directa de la tabla**: la política RLS de `programas` (lectura pública `using (true)`) es anterior y no
  se tocó. Cualquiera con la clave pública de Supabase puede seguir consultando `programas` por la API, incluso
  borradores y programas sin destino. La regla de visibilidad vive en las consultas y páginas de la aplicación, no
  en la política de la tabla; endurecer RLS sería un cambio aparte, con su propia migración y pruebas.
- **Efecto al desplegar**: con el provisional asignado antes del código no se oculta ningún programa; quien quede sin
  destino (p. ej. un programa nuevo sin clasificar) sí se oculta hasta asignarlo (sección 4).
- **Orden de despliegue invertido** (código antes que SQL): rompe la lista de Programas y el tarifario público.
- Los mensajes de error de la lista fija ya no muestran el detalle de la base al usuario (queda en el log del servidor);
  `guardarCabecera`/`crearPrograma` conservan sus mensajes anteriores.
