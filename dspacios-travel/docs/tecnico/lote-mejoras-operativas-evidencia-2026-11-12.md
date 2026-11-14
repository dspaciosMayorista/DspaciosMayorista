# Lote de mejoras operativas — evidencia de implementación (2026-11-12)

Complementa el plan `lote-mejoras-operativas-2026-11-12.md`. Rama `codex/lote-mejoras-operativas`, base `8578c266e`. Sin staging, commit, push, Preview, SQL remoto ni servicios Docker. Pendiente de auditoría de Codex.

## Cruces con #43/#60

Ningún archivo de producto del lote coincide con los 87 que toca #43/#60 (worktree `43-vigencias-dia`). Único compartido: `package.json`, **no modificado**. Por eso dos pruebas nuevas de pantalla no están en `test:react`; hay que añadirlas al integrar (ver «Pruebas»).

## #15 — Fechas manuales

- `lib/calendarValue.ts`: `parseCalendarText` acepta `DDMMAAAA`, `DDMMAA`, `DD/MM/AA` además de `DD/MM/AAAA` e ISO (con `trim`). Fechas imposibles devuelven `""` (sin correr a otro día). Mes (`mm/aaaa`) sin cambios.
- `components/ui/DateInput.tsx`: mientras se escribe, el año de dos dígitos no se emite (`anioCorto: false`): `090520` es prefijo de `09052026`. Se confirma al salir del campo o con Enter (`confirmarTexto`), que además normaliza la vista a `dd/mm/aaaa`. Calendario, min/max y validación por campo sin cambios.
- **Año de dos dígitos — regla aprobada por el dueño (2026-11-12): ventana del año actual − 69 al año actual + 30.** `anioDeDosDigitos`; en 2026: 00–56 → 2000–2056 y 57–99 → 1957–1999. El año de cuatro dígitos se usa tal cual (fuera de la ventana también) y el campo muestra la fecha completa `dd/mm/aaaa` al salir, antes de guardar. Pruebas de frontera 56/57, 99, cambio de siglo (2080: 10 → 2110, 11 → 2011) y visualización.
- Pruebas: envío real del formulario con Enter y con clic en Guardar, campo controlado y no controlado, en los cuatro formatos → payload ISO `2026-05-09`; fecha imposible bloquea el envío. Prueba de mutación: quitando la confirmación al salir/Enter fallan 14 pruebas.

## #34 — Rótulos Incluye/No incluye

`lib/tarifario/descripcionPaquete.ts` (secciones), `app/tarifario/tarjetaHotelCompartida.tsx` (ícono por sección) y `ConfigForm.tsx` (formulario del paquete): «El programa incluye/no incluye» → «Incluye/No incluye». Afecta a todos los tipos de paquete (comparten la descripción); los programas (`app/tarifario/programa/[id]/…`) conservan su rótulo, fijado por prueba. Precios y contenido sin cambios. Revisión visual pendiente junto al lote.

## #50 — Seleccionar/Deseleccionar todos

Helpers puros en `lib/paquetes/seleccionMasiva.ts` (`alternarVisibles`, `estadoVisibles`), reutilizando `estadoSeleccionTodos` de #107. Semántica: la casilla maestra actúa solo sobre filas **visibles y habilitadas**, conserva lo seleccionado fuera del filtro y **solo cambia la selección** (no concilia, no guarda, no crea).

| Sitio | Visibles/habilitadas | Notas |
|---|---|---|
| Conciliaciones, lado Sistema | filas que pasan mes/modo/fechas/valores | avisa «N seleccionados fuera del filtro»; los totales siguen incluyéndolos, como antes |
| Servicios del contrato pendiente | servicios con precio para los pax, o ya marcados | no marca un servicio sin rango (deshabilitado), sí lo desmarca; guardar sigue siendo el botón |
| Blackouts (categorías y acomodaciones) | todas las opciones | preserva el orden del catálogo; solo con 2+ opciones |

Excluidos: Facturación DIAN (cada casilla aplica una marca irreversible) y `CalculadoraEditor` (#43/#60).

## #89 — Portada de servicios receptivos

Reproducido con datos sintéticos, cargador real (`cargarResumenTarifario`) y búsqueda en vivo real (`buscarReceptivos`) sobre un cliente Supabase falso con retrasos/fallos por tabla (`pruebas/receptivosPortada89.test.ts`). No hizo falta Postgres.

- **Hipótesis A — confirmada y corregida.** `fotosPorServicio` solo pedía `foto_url` de los servicios de `filasVisibles`, que excluye los servicios de paquetes que no son tipo «servicios» (opcionales de Bloqueo/Porción). `buscarReceptivos` sí los devuelve, y las tarjetas de add-ons (`filasAddon`) también usan el mapa → «Sin foto» aunque el servicio tenga portada. Antes: `en vivo=70/1,80/2 fotos=1 sin_foto=2`; después: `fotos=1,2 sin_foto=`. Corrección en `lib/tarifario/resumen.ts`: los ids salen de `filasVisibles` + `filasAddon`. Sigue siendo **una** consulta `servicios_adicionales(id, foto_url)`; solo crece la lista de ids. `lib/tarifario/datos.ts` tiene el mismo patrón pero ninguna página lo usa: no se tocó.
- **Hipótesis B — reproducida, sin defecto.** Respuesta lenta (1,5 s): solo demora; cada portada corresponde a su servicio. Respuesta fallida: mapa vacío («Sin foto»), error registrado como dato auxiliar, una sola consulta y sin reintentos. No se cambió.
- Pantalla (`pruebas/receptivosPortada89.react.ts`): búsqueda lenta → «Limpiar resultados» → nueva búsqueda; la respuesta vieja que llega tarde no reemplaza ni presta su portada; una recarga de props conserva la portada; sin portada en el mapa se muestra «Sin foto»; dos búsquedas = dos llamadas (sin reintentos ni sondeos). Mientras una búsqueda está en curso el botón está deshabilitado.

## #59 — Resuelta en PR #408; cierre local: enlace de la tarjeta

- PR #408, commit `4cd426e86` «feat: mostrar cupos activos y críticos por salida»; migración `20260601000243_dashboard_cupos_activos.sql` con preflight/postcheck/rollback/test en `supabase/scripts/*243*`.
- `fn_dashboard_cupos_activos(p_hoy)`: record activo = `fecha_ida` nula o ≥ hoy; disponibles = suma de `greatest(cupos_disponibles,0)`; records = `count(*) filter (cupos_disponibles > 0)`; próximos = `fecha_ida <= p_hoy + 14` (día 15 fuera). `p_hoy` = fecha de Bogotá enviada por la app.
- `app/(dashboard)/dashboard/page.tsx`: tarjeta «Cupos disponibles» = «X sillas disponibles» + «en Y records»; alerta «Cupos críticos» = sillas disponibles en records con salida en 14 días, enlace `/dashboard/vuelos?vista=inventario`.
- `pruebas/dashboardMetricasAgregadas.test.ts`: pasado fuera, hoy y día 14 dentro, día 15 activo pero no próximo; records sin disponibilidad y negativos; varios records; fecha nula; `sumarDias` cruzando mes/año/bisiesto.
- Cierre local (2026-11-12): la tarjeta «Cupos disponibles» enlaza a `/dashboard/vuelos?vista=inventario` («Ver inventario de vuelos», `prefetch={false}`) solo para los roles de `LECTURA_MODULO.vuelos` (el mismo mapa del menú y de `proxy.ts`; `venta` ve la cifra sin enlace). Sin consultas nuevas: el rol ya se leía y el diff no añade llamadas a Supabase. Corregido el comentario de `cuposBarColor` que aún decía «≤3 cupos». Prueba: `pruebas/dashboardCupos59.react.ts` (página real con cliente sintético: enlace por rol, conteos 15 sillas / 3 records / 25 de 40, lista exacta de consultas y ventana `p_hoy` = hoy Bogotá y salidas hoy..hoy+14). La alerta «Cupos críticos» sigue enlazando para todos los roles no minoristas, como antes (proxy.ts redirige a quien no tiene el módulo); no se cambió.

## #65 — Ya resuelta, sin cambios (evidencia confirmada por Codex)

- PR #418, commit `55bb80b17` «fix: llamar combinaciones al resumen de paquetes».
- `PaquetesListado.tsx`: «N combinaciones publicadas» / «Sin publicar»; `paquetes/page.tsx` cuenta filas de `tarifario_resumen` (una por combinación, no por acomodación) con el lector paginado `cargarFilasResumenPaginado`.
- Prueba: `pruebas/paresPublicadosUnidad.test.ts`.

## Pruebas

- `test:calendar` 43/43 tras la regla aprobada (incluye las de #15) · relacionadas con #34: 62/62 · `pruebas/receptivosPortada89.test.ts` 3/3 (en `test:unit` por glob) · `pruebas/dashboardCupos59.react.ts` 3/3 + `dashboardMetricasAgregadas`/`dashboardShellWiring` 158/158.

### Registro en `test:react` (pendiente, coordinado con #43/#60)

**Reconocido:** hasta registrarlas, el lote **aumenta de 8 a 11** los archivos `.react.ts` sin registrar que detecta «cada pruebas/*.react.ts está en test:react o test:calendar». Que esa prueba ya fallara en la base no lo vuelve neutro.

Esta rama **no modifica `package.json`**. #43/#60 añade al final de `test:react` `calculadoraGrupos297`, `gruposDias299` y `promocionesGrupo43`. Editar la misma línea en las dos ramas daría un conflicto. Al integrar, sobre el `package.json` ya combinado (con la lista de #43/#60 intacta), añadir **al final** solo las que falten:

```sh
node -e 'const f="package.json",fs=require("fs");let t=fs.readFileSync(f,"utf8");
const nuevas=["pruebas/seleccionMasiva50.react.ts","pruebas/receptivosPortada89.react.ts","pruebas/dashboardCupos59.react.ts"];
t=t.replace(/("test:react": "[^"]*)"/,(_,v)=>v+nuevas.filter(n=>!v.includes(n)).map(n=>" "+n).join("")+"\"");
JSON.parse(t);fs.writeFileSync(f,t)'
```

Edita el texto en su sitio (no reserializa el JSON: `JSON.stringify` reformatearía `onlyBuiltDependencies`), es idempotente y no reordena ni quita nada. Probado dos veces sobre una copia del `package.json` de #43/#60: cambia solo la línea `test:react`, que termina en `…promocionesGrupo43.react.ts pruebas/seleccionMasiva50.react.ts pruebas/receptivosPortada89.react.ts pruebas/dashboardCupos59.react.ts`. Comprobar después: el número de archivos sin registrar vuelve a 8 (los ajenos de la base) y `test:react` incluye las 3 (12 pruebas).
- `tsc --noEmit`: limpio.
- `test:unit`: 9.300/9.330 en el lote; los 30 fallos son **los mismos por nombre** que en un worktree desechable limpio de la base `8578c266e` (ya eliminado). Uno es «cada pruebas/*.react.ts está en test:react o test:calendar»: ya fallaba en la base por 8 archivos ajenos; los dos archivos nuevos del lote se suman a esa lista hasta añadirlos a `package.json`.
- `test:react`: 1.681/1.707 en el lote; los 26 fallos son los mismos por nombre que en la base (1.658/1.684).
- Build de producción con la configuración que se entrega (2026-11-12, cierre local): `next build` (Next 16.3.0, Turbopack) **exit 0** con `next.config.ts` sin cambios. `node_modules` físico instalado en el worktree desde el lockfile de la rama (`pnpm install --frozen-lockfile`, como en Vercel; ignorado por git), Supabase con variables ficticias, `--max-old-space-size=8192`. Con una junction a `node_modules` y la configuración real, Turbopack se queda detenido en la etapa `compile` (sin salida, CPU quieta >20 min): por eso no se usa la junction. Los builds anteriores de esta rama ampliaban temporalmente `turbopack.root`; ya no hace falta.
- Revisión visual: componentes reales en jsdom con datos sintéticos, HTML con el CSS del build, capturas con Edge sin interfaz (fuera del repositorio): fechas normalizadas y error de fecha imposible; tarjeta y formulario con «Incluye/No incluye»; las tres casillas maestras en estado parcial/completo, la fila sin rango deshabilitada y el aviso «1 seleccionado fuera del filtro». No es una revisión sobre la app servida con datos: eso queda para el Preview.

## Revisión local en la aplicación (2026-11-12)

Entorno propio del lote (autorizado por el dueño), descrito en `supabase/scripts/local-lote/` y en `lote-mejoras-operativas-recorridos.md`:

- Base desechable `lote_revision` en el contenedor existente `pg4360`, copiada por template de `local4360_base`. Antes se verificó que la plantilla no tuviera datos reales: 0 usuarios, ventas, abonos, pasajeros y contactos; las 133 sillas sin pasajero; sin claves de correo. Los únicos datos (bloqueos de ejemplo, tarifario viejo e identidad de las agencias) los siembran las migraciones 003/012/015/109 del repo.
- A la copia se le aplicaron las migraciones 286 y 288–292 (ausentes en la plantilla) y la 295, más la semilla sintética del lote.
- Roles de acceso propios, para no cambiar las contraseñas de los roles de #43/#60.
- Servicios `lote-auth`, `lote-rest` y `lote-kong` (Kong con 1 worker, caché 16m y 256 MB), sin Storage, gateway en 127.0.0.1:54361.
- App: build de producción en 127.0.0.1:3045, con entorno hijo desde cero, guardia de red, sin `.env` y control de memoria.
- No se tocaron `local4360_base`, `dspacios_local4360`, su foto ni los contenedores `local4360-*`. El uso de `pg4360` se coordinó con la sesión de #43/#60 («libre»).

Recorridos automáticos con Edge sin interfaz (CDP) contra esa app: **28/28 comprobaciones OK** (21 del panel interno y 7 del tarifario público).

- **#59:** tarjeta con «58 sillas disponibles / en 7 records» y enlace al inventario para `operaciones`; sin enlace para `venta`; alerta «17 sillas disponibles en 3 records» (hoy, día 8 y día 14; los dos records del día 15 quedan fuera).
- **#15:** `09052026`, `090526` y `09/05/26` dan 09/05/2026; `010156` da 01/01/2056; `010157` da 01/01/1957; `01011940` da 01/01/1940; `31042026` queda marcada como inválida.
- **#50 Conciliaciones:** el filtro deja 3 visibles con «1 seleccionado fuera del filtro»; «Seleccionar todos (visibles)» marca solo esos 3 y conserva el oculto; nada se concilia.
- **#50 Contrato DTM-9001:** el traslado sin rango queda deshabilitado; «Seleccionar todos» marca solo los habilitados (total 376.000); «Deseleccionar todos» no guarda nada.
- **#50 Blackouts:** «Cierra Estándar, Superior, Suite por completo».
- **#34:** el modal del hotel en Paquetes (Bloqueo) y en Porción terrestre dice «Incluye»/«No incluye» con el contenido del paquete; el programa 915001 conserva «El programa incluye».
- **#89:** la búsqueda en vivo de Receptivos muestra Tour 1 con el isotipo, **Tour 2 (opcional de Porción/Bloqueo) con su logo, no «Sin foto»**, y City tour con el globo.

Hallazgos de entorno, que no son defectos del lote:

- La portada del tarifario solo muestra hoteles recomendados mientras no se elige destino, y el bloque «Incluye/No incluye» viene plegado tras «Ver más». Son reglas vigentes (#52 y regla de recomendados). Por eso la semilla marca el hotel como recomendado.
- El equipo trabaja con 1,3–2,7 GB libres. Dos veces el vigilante detuvo la app al bajar de 400 MB libres: la app ocupaba menos de 180 MB y el consumo venía de Edge sin interfaz y de otros procesos. El control funcionó; los recorridos se repitieron con una sola instancia de Edge.

Estado al cierre: servicios del lote y `pg4360` **detenidos**. Datos conservados para la revisión del dueño. Limpieza posterior con `locallote.ps1 limpiar`.

## Validación del dueño (2026-11-12)

El dueño recorrió en la app local (127.0.0.1:3045, datos sintéticos) los cinco recorridos de `lote-mejoras-operativas-recorridos.md` y los **validó**:

- fechas manuales (#15);
- rótulos «Incluye/No incluye» (#34);
- selección masiva (#50: Conciliaciones, contrato pendiente y blackouts);
- portadas de receptivos (#89);
- cupos (#59).

Durante la revisión, un `tsc --noEmit` de la sesión de #43/#60 (~2,5 GB) dejó el equipo con 50 MB libres y el vigilante detuvo la app una vez (exit 99). Se coordinó con esa sesión, que desde entonces espera aviso antes de procesos pesados, y la app se reinició sin recompilar con el mismo build (sin cambios de código posteriores al build de las 13:05).

Al terminar: app, `lote-kong`/`lote-rest`/`lote-auth` y `pg4360` detenidos con `locallote.ps1 detener -IncluirPostgres`, previa confirmación de #43/#60 («libre»). La base `lote_revision`, los roles `lote_*` y los contenedores detenidos se conservan. La limpieza (`locallote.ps1 limpiar`) queda pendiente de la orden del dueño.

## Revisión focalizada: solicitudes, bucles, sondeos y reintentos

Revisado sobre el diff final (16 archivos modificados, 4 pruebas nuevas):

| Cambio | Solicitudes | Bucles / sondeos / reintentos |
|---|---|---|
| #15 `calendarValue.ts`, `DateInput.tsx` | Ninguna. Parseo puro; `confirmarTexto` se ejecuta solo en blur y Enter. | Ninguno; sin `useEffect`, temporizadores ni efectos nuevos. |
| #34 rótulos (3 archivos) | Ninguna. Solo textos. | Ninguno. |
| #50 `seleccionMasiva.ts` y 3 componentes | Ninguna: solo cambia el estado local de selección; no concilia, no guarda, no crea cierres. | `alternarVisibles`/`estadoVisibles` recorren una vez la lista visible (acotada, en memoria). |
| #89 `resumen.ts` | La **misma** consulta `servicios_adicionales … .in("id", servicioIds)`; solo amplía la lista de ids con `filasAddon` (deduplicada con `Set`). Sin consulta nueva. | Ninguno. Prueba de respuesta lenta: una búsqueda = una solicitud, sin reintentos ni portada de otro servicio. |
| #59 `dashboard/page.tsx` | Ninguna nueva: `LECTURA_MODULO` es constante en código; la prueba fija la lista exacta de consultas y RPC. El enlace usa `prefetch={false}`, así que no precarga el inventario. | Ninguno. |
