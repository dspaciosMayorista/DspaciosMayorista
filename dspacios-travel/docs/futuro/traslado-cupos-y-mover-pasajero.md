# Traslado de cupos y mover pasajero entre records — diseño

> **Diseño + estado de implementación.** Tareas 2 y 3 de `TASKS.md`. Las fases 1, A (migraciones 192 y 194) y B (acciones e interfaz) están **implementadas en el árbol de trabajo y probadas en local** (§14), **sin commit y sin aplicar en ninguna base remota**. Nada de esto está validado en Producción. Las fases C (cierre de la escritura directa) y E (historial inmutable) siguen siendo solo diseño. El preflight de solo lectura (`supabase/scripts/preflight_traslado_cupos_lectura.sql`) se revisa antes de que el usuario decida si ejecutarlo.
>
> Estado al 2026-09-30. Rutas y líneas verificadas contra `main` `8539732c`; la tarea 1 se integró después (PR #336, `32decc9e`) sin tocar los archivos citados aquí.

## 1. Alcance y aclaraciones del usuario

- "Editable" se refiere a los **datos de cada silla activa** (pasajero, contrato, plazo, hotel, acomodación). Los **cupos no se aumentan manualmente**: se retira la acción "agregar cupo" de la propuesta anterior.
- `cupos_total` de un record solo cambia por tres operaciones: **trasladar cupos libres** (tarea 2), **mover un pasajero con su cupo** (tarea 3, modo B) y **retirar un cupo libre** sin borrar su trazabilidad (§4.4b). El usuario confirmó el 2026-09-30 que retirar (reducir) cupos sí está permitido; aumentarlos a mano no.
- El cambio histórico **se ve**, es **inmutable** y **no cuenta** en `cupos_total`, ocupación ni disponibilidad.
- **Decisión aprobada (2026-09-30): el inventario muestra DOS cifras distintas**, siempre por separado: **cupos activos** (lo único vendible) y **movimientos históricos** (trazabilidad). El historial nunca se suma a los cupos ni se ofrece para vender. Vive en `movimientos_silla` (ampliada, §4.3); **no existe ni se crea una tabla `sillas2`** (era un nombre informal de la conversación). Detalle en §4.7.
- Al mover un pasajero hacia X, la interfaz exige una **elección explícita**: (A) "Usar cupo disponible en X (solo datos)" o (B) "Trasladar el cupo de Y a X (datos + cupo)". Nunca se elige sola según la disponibilidad de X, y nunca se inserta una silla en X sin descontarla de Y.

## 2. Estado actual comprobado

| Pieza | Comportamiento hoy | Problema |
|---|---|---|
| `cambiarSillas` (`app/(dashboard)/dashboard/vuelos/actions.ts:366`) | Marca N sillas del origen como `cambio` (siguen en el origen), inserta N filas `cambio_entrante` nuevas en el destino y ajusta `cupos_total` ±N | 6 llamadas sueltas sin transacción ni bloqueo de filas; 2 filas por silla trasladada; el `update` a `cambio` no filtra por estado (`:390`) |
| `moverPasajeroSilla` (`actions.ts:633`) | Inserta una silla **nueva** en el destino con el pasajero y deja la de origen `disponible` | +1 silla en el sistema sin tocar ningún `cupos_total`; no copia `contrato_manual` ni lo limpia en el origen; no actualiza `ventas.bloqueo_ref_id` ni `contrato_vuelos.record`; se ofrece también en sillas vacías |
| `lib/vuelos/stats.ts:19` (`acumularSilla`) | `total++` para toda fila, incluidas las `cambio` | Ocupación y % de venta dividen entre filas fantasma |
| `movimientos_silla` | Policy `FOR ALL` (migraciones 005/137); la app borra filas en `eliminarCupo`/`eliminarBloqueo` | El historial no es inmutable; `registrado_por` nunca se llena |
| `sillas` | Sin índice único `(bloqueo_id, numero_silla)` | Números repetidos posibles con operaciones simultáneas |
| Lectura de `sillas` | Policy `sillas: lectura operativa` (005) incluye `venta` y ninguna migración la cambia; la 142 afirma lo contrario en un comentario | Verificado en una base LOCAL: un usuario `venta` lee todas las sillas, documento incluido. Producción sin verificar (preflight, bloque B) |
| Costo del contrato | `costo_aereo` = costo neto del record × pax (`reservar/actions.ts:227`); la CxP aérea va al proveedor del record | Mover a un record con otra tarifa o proveedor deja el costo/CxP del contrato desalineado |

## 3. Las tres operaciones sobre el mismo ejemplo

Punto de partida: **Y = 8 cupos (1 confirmado + 7 libres)** y **X = 8 cupos (3 ocupados + 5 libres)**.

| Operación | Y después | X después | Filas de `sillas` | Historial |
|---|---|---|---|---|
| Tarea 2 · trasladar 2 cupos libres Y→X | 6 (1 confirmado + 5 libres) | 10 (3 ocupados + 7 libres) | Y 6 · X 10 (se mueven 2 filas, ninguna se crea) | 2 registros `traslado_cupo` |
| Tarea 3 · (A) usar cupo disponible en X | 8 (8 libres) | 8 (4 ocupados + 4 libres) | Y 8 · X 8 (se copian datos a una silla libre de X y se limpia la de Y) | 1 registro `mover_datos` |
| Tarea 3 · (B) trasladar el cupo de Y a X | 7 (7 libres) | 9 (4 ocupados + 5 libres) | Y 7 · X 9 (se mueve la fila con el pasajero) | 1 registro `mover_con_cupo` |
| **Hoy** `moverPasajeroSilla` | 8 (8 libres; `cupos_total` 8) | 9 filas con `cupos_total` 8 | +1 fila en el sistema | 1 fila sin tipo ni autor |

> Nota: tomo (A) y (B) tal como los define la instrucción de la interfaz. Si los "resultados A/B" acordados antes difieren en algún número, corregir esta tabla antes de implementar.

En los tres casos la suma de cupos de Y+X no cambia, salvo por el traslado explícito, y ninguna fila de historial cuenta como cupo.

## 4. Modelo propuesto

### 4.1 La silla se mueve, no se clona

Trasladar (tarea 2) y mover con cupo (tarea 3-B) **cambian `bloqueo_id` de la misma fila** y le asignan el siguiente `numero_silla` libre del destino. No quedan filas fantasma en el origen: el "cambio" vive solo en el historial. Mover solo datos (tarea 3-A) no mueve filas: copia los datos a una silla libre real de X y limpia la de Y.

### 4.2 Silla libre real

`estado in ('disponible','cambio_entrante')` **y** sin `numero_contrato`, sin `contrato_manual` y sin datos de pasajero (`pasajero_nombres`, `pasajero_apellidos`, `numero_doc`). La carga masiva de pasajeros y `liberarVencidas` dejan sillas "disponibles" con datos de pasajero: el diseño no las cuenta como libres (el preflight las cuenta).

### 4.3 Historial (`movimientos_silla` ampliada, migración nueva)

Columnas nuevas, todas opcionales para las filas antiguas:

| Columna | Uso |
|---|---|
| `tipo` text check (`traslado_cupo`, `mover_datos`, `mover_con_cupo`, `retiro_cupo`, `legado`) | Qué operación fue |
| `operacion_id` uuid (FK a `operaciones_vuelo`, §6.0) | Agrupa las filas de una misma operación; unicidad `(operacion_id, silla_id)` |
| `silla_destino_id` bigint | Solo `mover_datos`: la silla de X que recibió los datos (en los otros tipos es la misma `silla_id`) |
| `numero_silla_origen`, `numero_silla_destino` int | Posición antes y después |
| `numero_contrato`, `contrato_manual` text (copia, sin FK) | Trazabilidad del contrato aunque después cambie |
| `contrato_manual_clase` text (`externo`/`interno`), `contrato_manual_resuelto` text | Solo con `contrato_manual`: cómo se resolvió en el momento del movimiento (§6.0.4) y, si era interno, a qué venta |
| `estado_silla` text (copia) | Estado con el que se movió |
| `cupos_origen_antes/despues`, `cupos_destino_antes/despues` int | Prueba de que el ajuste fue el correcto |
| `registrado_por_id` uuid | `auth.uid()` resuelto dentro de la función, nunca del cliente |

`registrado_por` (texto) se sigue llenando con el nombre del perfil, como en `bloqueo_cambios`. Documento del pasajero: **no** se copia al historial por defecto (decisión D10).

### 4.4 Inmutabilidad

- Policy de `movimientos_silla` pasa de `FOR ALL` a **solo SELECT** para los roles de vuelos. Sin policy de INSERT/UPDATE/DELETE: el historial solo se escribe desde las funciones de §6.
- Trigger `BEFORE UPDATE OR DELETE` que lanza excepción siempre. Frena también a la función dueña y a service-role.
- UPDATE y DELETE se cierran y se verifican **por separado**: privilegio de tabla y policies de cada comando. Un rol con solo DELETE no puede editar el historial, pero un `DELETE` sin `WHERE` lo vacía entero: Postgres solo aplica las policies de SELECT cuando la sentencia lee filas (`WHERE`/`RETURNING`). Comprobado en la base local (§10). La migración de cierre revoca UPDATE y DELETE sobre `movimientos_silla` (y `operaciones_vuelo`) a `authenticated`/`anon` además de quitar las policies; el trigger es la última barrera.
- Consecuencia: una silla o un record con historial **no se pueden borrar físicamente** (la FK `silla_id`/`bloqueo_*` lo impide y el trigger impide limpiar el historial). Afecta a `eliminarCupo` y `eliminarBloqueo` (decisiones D8 y D11).
- Guardas en `sillas` (trigger `BEFORE UPDATE`, se activa en la fase C de §6.5, después de la barrera B→C), porque la RLS de `sillas` sí permite UPDATE directo por la API a los roles de vuelos:
  - Cambiar `bloqueo_id` o poner `estado = 'retirada'` solo lo pueden hacer las funciones de §6. El trigger lo exige con `current_user` = dueño de las funciones: dentro de una función `SECURITY DEFINER`, `current_user` es su dueño; en una petición directa es `authenticated` o `service_role`. Así, un `update` directo (incluida la acción manual `cambiarEstadoSilla`, que hoy no valida el valor) no puede mover una silla de record ni retirarla sin historial.
  - Una fila `retirada` no admite ningún cambio posterior.
  - Esto **no basta** por sí solo: la RLS 137 deja escribir directamente todas las columnas de vínculo y ocupación, crear y borrar sillas y cambiar `cupos_total`. El cierre completo, por fases y sin romper escritores legítimos, está en §6.5.

### 4.4b Retirar un cupo sin borrar trazabilidad

Los cupos no se aumentan manualmente, pero se pueden **reducir** retirando una silla libre (reemplaza el borrado físico de `eliminarCupo`). Diseño:

- Nuevo valor de enum `estado_silla = 'retirada'`. Va en una migración propia antes de usarse: `ALTER TYPE … ADD VALUE` no puede usarse en la misma transacción que lo crea.
- Función `retirar_cupo(p_silla_id, p_motivo, p_operacion_id)`: solo sillas libres reales; `estado → 'retirada'`; `cupos_total − 1`; 1 fila de historial tipo `retiro_cupo` (`bloqueo_origen_id` = el record, `bloqueo_destino_id` null).
- La fila **se conserva** (la FK y el historial quedan intactos), pero **no cuenta como activa** en ningún lado:

| Consumidor | Qué pasa con `retirada` |
|---|---|
| Reservas (`_ajustar_sillas_bloqueo_nucleo`, 167) y `cargarPasajerosMasivo` | Nunca la toman: solo eligen `disponible`/`cambio_entrante`. Sin cambios |
| Vista `cupos_por_bloqueo` y `fn_dashboard_cupos_resumen` | No la cuentan en ocupados ni disponibles, y la capacidad sale de `cupos_total` (ya descontado). Sin cambios |
| `lib/vuelos/stats.ts` | **Hay que excluirla** del total (junto con `cambio`) |
| Tabla de sillas del record, `SillaEstado`, `PasajeroAcciones` | **Hay que sacarla** de la tabla activa, mostrarla en el historial y bloquear sus acciones |

- Por qué no `devuelta`: `devuelta` es un estado comercial (silla devuelta a la aerolínea en plazo), cuenta en el total de las estadísticas y en el conteo por estado, y mezclaría dos significados. Por qué no una columna booleana: la reserva elige sillas por `estado`; una silla `disponible` marcada como inactiva por columna se seguiría vendiendo, salvo que se cambie el núcleo de la 167 (decisión D8).

### 4.4c Numeración e índice único

- Índice propuesto, **sin `WHERE`**:

  ```sql
  create unique index sillas_bloqueo_numero_uq on public.sillas (bloqueo_id, numero_silla);
  ```

- **Decisión explícita:** cubre **todas** las filas, en cualquier estado, `cambio` y `retirada` incluidas. Un número de silla es una identidad dentro del record y no se reutiliza aunque la silla ya no esté activa; así el historial (`numero_silla_origen/destino`) nunca apunta a dos sillas con el mismo número.
- Consecuencia para las funciones: el siguiente número del destino es `max(numero_silla)` sobre **todas** las filas del record, no solo las activas.
- `NULL` no choca con `NULL` (NULLS DISTINCT): las sillas sin número se reportan aparte en el preflight y no bloquean el índice.
- La comprobación de duplicados del preflight usa **exactamente el mismo conjunto** (todas las filas de `public.sillas`, `numero_silla` no nulo, sin filtro de estado). Si da 0, el índice se puede crear; si da más de 0, fallaría. La versión anterior filtraba las filas `cambio` y no veía un duplicado entre una fila `cambio` y una activa, que sí rompe el índice (probado en local, §10).
- Un índice parcial (con `WHERE`) o sobre expresiones no cuenta como cumplido en el preflight: cubriría otro conjunto.

### 4.5 Legado `cambio` / `cambio_entrante`

- Las filas `cambio` son historial físico que hoy referencia `movimientos_silla.silla_id`: **no se borran**. Se excluyen de todos los conteos (stats, dashboard, vista) y salen de la tabla de sillas activas para mostrarse en el historial.
- `cambio_entrante` son sillas reales del destino: siguen contando como libres u ocupadas según su contenido. Decisión D7 si se normalizan a `disponible`.
- Las filas antiguas de `movimientos_silla` reciben `tipo = 'legado'` en la misma migración, antes de activar el trigger.

### 4.6 Visibilidad del historial

Pestaña "Cambios" del record: cada movimiento con tipo, cantidad o silla, record origen→destino, contrato, cupos antes→después, autor y motivo. En la tabla de pasajeros, una marca "llegó desde Y" derivada del historial, no de un estado de la silla. En la ficha del contrato, el historial filtrado por `numero_contrato`, sujeto a D12.

### 4.7 Dos cifras: cupos activos y movimientos históricos (aprobada)

| Cifra | Qué cuenta | Fuente | Dónde se muestra | ¿Vendible? |
|---|---|---|---|---|
| **Cupos activos** | Filas de `sillas` del record con estado distinto de `cambio` (legado) y `retirada`. Debe coincidir con `cupos_total` (I1) | `sillas` (`esSillaActiva`, `lib/vuelos/historial.ts`; `ESTADOS_NO_ACTIVOS`, `lib/vuelos/stats.ts`) | Encabezado del record ("Cupos activos N"), columna "Cupos activos" de la lista y del histórico, tabla de pasajeros (solo filas activas), ocupación y disponibilidad | Sí, las libres |
| **Movimientos históricos** | Filas de `movimientos_silla` que tienen al record como origen o destino (cada fila una vez por record) | `movimientos_silla` (`movimientosPorBloqueo`, `lib/vuelos/stats.ts`) | Encabezado ("Movimientos históricos M · no son cupos"), columna "Mov. hist." de la lista y del histórico, pestaña Cambios agrupada por operación | **No, nunca** |

Las filas físicas `cambio` (legado) y `retirada` no aparecen en la tabla de pasajeros: su rastro está en el historial. Una silla `devuelta` sí es un cupo activo del record (cuenta en el total, como hasta ahora) pero no se vende.

## 5. Invariantes

| # | Invariante | Dónde se verifica |
|---|---|---|
| I1 | `cupos_total(B) = filas de B con estado distinto de cambio y retirada` para todo record tocado por una operación nueva | Diseño: dentro de cada función. **Implementado solo en su forma relativa (I3)**: el desajuste legado se conserva sin agravarse; el I1 absoluto queda pendiente hasta sanear (§14). Preflight §3; postcheck |
| I2 | Ocupación = `en_plazo + confirmada`; disponibilidad = libres reales (§4.2); el historial y las filas `cambio` o `retirada` no cuentan en ninguno ni en `cupos_total` | `lib/vuelos/stats.ts`, vista y funciones de dashboard; pruebas puras |
| I3 | Traslado y mover con cupo (B): `cupos(Y)+cupos(X)` constante; Y−n / X+n exactos; no se crean ni borran filas | Función; prueba SQL con conteos antes/después |
| I4 | Mover solo datos (A): ningún `cupos_total` cambia; ninguna fila se crea ni borra; exige una silla libre real en X al momento del bloqueo, si no hay → error, **nunca** cae a B ni inserta | Función; prueba SQL "X sin libres" |
| I5 | El número de sillas de un contrato (orgánico o manual) no cambia con ningún movimiento; solo cambia su reparto entre records ±1 en A/B | Función: conteo por contrato antes/después |
| I6 | Ninguna silla libre conserva `contrato_manual` ni `numero_contrato`; ninguna tiene ambos (CHECK 085) | Limpieza total del origen en A; preflight §4 |
| I7 | Traslado de cupos nunca toca una silla ocupada ni con datos de pasajero | Selección por "libre real" con el pool bloqueado |
| I8 | Una fila de historial por silla afectada, todas con el mismo `operacion_id`; el historial no se modifica ni borra | Trigger; prueba SQL de UPDATE/DELETE como cada rol |
| I9 | El modo de mover es un parámetro obligatorio sin valor por defecto; no existe camino que elija por disponibilidad | Firma de la función; prueba de interfaz |
| I10 | Dos solicitudes con el mismo `operacion_id`, en serie o **simultáneas**, aplican la operación **una sola vez**; la segunda devuelve el resultado de la primera o un error si los parámetros difieren | Reserva de la clave en `operaciones_vuelo` como primera escritura (§6.0); prueba de concurrencia con dos sesiones |
| I11 | `ventas.bloqueo_ref_id` apunta a un record donde el contrato tiene sillas (o la regla que se decida en D1/D2) | Función de mover; preflight §5 |
| I12 | `numero_silla` único por record entre **todas** sus filas (cualquier estado, `cambio` y `retirada` incluidas) | Índice único completo de §4.4c; el preflight comprueba duplicados sobre el mismo conjunto |
| I13 | Solo las funciones de §6 cambian `sillas.bloqueo_id` o ponen `retirada`; una fila `retirada` no vuelve a cambiar | Trigger de `sillas` (§4.4); prueba SQL con `update` directo como cada rol y como `service_role` |
| I14 | Cada función autoriza actor, records y contrato con datos leídos de la base, nunca con datos del cliente (§6.0) | Revisión de código SQL; pruebas por rol y agencia |
| I15 | Tras la fase C, `authenticated` no inserta ni borra sillas, no cambia columnas E/V de `sillas` ni `cupos_total`; solo el grupo D | Triggers `SECURITY INVOKER` + `revoke insert, delete`. Preflight A solo como indicio (guardas bien formadas; el UPDATE de tabla sigue concedido). **Prueba: preflight bloque C**, todos los casos prohibidos rechazados por la guarda o por privilegio (incluida la edición de datos de una silla con contrato, DIR-2) y los 2 permitidos que prosperan |
| I16 | `contrato_manual` se clasifica con el mismo recorte que `trim()` de la app; lo que queda con espacios no ASCII o controles dentro falla cerrado | `_resolver_contrato_manual`; preflight §5b; prueba de los 13 casos |

## 6. Diseño transaccional

Cuatro funciones SQL: `trasladar_cupos`, `mover_pasajero` y `retirar_cupo` (más la reserva de operación común de §6.0.2). Todas `SECURITY DEFINER` con `set search_path = public, pg_temp`, mismo patrón que `guardar_infante_vuelo` (168). `execute` revocado a `public` y `anon`, concedido **solo** a `authenticated`; `service_role` no las necesita. La opción INVOKER queda en D9.

### 6.0 Común a todas las funciones

#### 6.0.1 Autorización (nunca con datos del cliente)

Como `SECURITY DEFINER` se salta la RLS, cada función repite **explícitamente** todas las comprobaciones con datos leídos de la base. El cliente solo aporta ids y el modo; nunca el tenant, el actor, el contrato ni los cupos.

| Paso | Comprobación | Si falla |
|---|---|---|
| A1 · sesión | `auth.uid()` no nulo | `Sesión requerida.` |
| A2 · rol | `mi_rol()` ∈ {superadmin, administracion, gerencia, operaciones, control_vuelo}: el mismo conjunto que `ESCRITURA.vuelos` (`lib/roles.ts:25`) y que la policy de escritura de `sillas` (137). `mi_rol()` devuelve null para un usuario inactivo (140), así que un inactivo cae aquí | `Sin permiso para operar vuelos.` |
| A3 · agencia del actor | `mi_rol() = 'superadmin'` **o** `mi_tenant() = 'mayorista'`. `bloqueos_vuelo`/`sillas` no tienen columna de tenant, y Vuelos está oculto para minorista en la interfaz (`minoristaOculto`), pero hoy la RLS no se lo impide por la API (decisión AUT-1) | `Sin permiso para operar vuelos.` |
| B1 · records | Y (y X si aplica) existen: se leen con `for update`. Un id inexistente da el mismo mensaje que uno sin permiso | `Record no disponible.` |
| B2 · compatibilidad | Sobre las filas bloqueadas: Y ≠ X; mismo `destino_id` (D4); X no salido, `fecha_ida ≥ hoy` en hora de Colombia (D4); mismo `proveedor_id` (D4b). `tarifa_neta` distinta **no** bloquea, pero exige `p_acepta_tarifa_distinta = true`, que la interfaz solo envía tras mostrar la advertencia (D4b) | Mensaje con el motivo concreto ("X tiene otro proveedor", "X ya salió"…); tarifa distinta sin aceptación: `La tarifa neta de X es distinta; confirma para continuar.` |
| C1 · silla | La silla pertenece a Y **después** de bloquearla (se relee); la silla destino del modo A pertenece a X | `La silla ya no está en este record; recarga.` |
| C2 · estado | Traslado y retiro: silla libre real (§4.2). Mover: silla ocupada movible (D5). Modo A: la silla destino es libre real | Mensaje por caso |
| D1 · contrato orgánico | Si la silla tiene `numero_contrato`: `acceso_editar_vuelos_contrato(numero)` (157) debe ser true. Es la misma regla de rol + agencia **del contrato** que el editor de vuelos del contrato: superadmin global; gerencia, administracion, operaciones y control_vuelo solo su agencia. Se evalúa con el contrato leído de la silla ya bloqueada | `Sin permiso sobre el contrato de esta silla.` (sin revelar si existe ni de qué agencia es) |
| D2 · contrato manual | Resolver la referencia con §6.0.4. **Externo** (0 ventas candidatas): basta A1–A3. **Interno** (1 venta): se aplica D1 a esa venta, con el tenant **de esa venta**. **Ambiguo** (2 o más): falla cerrado | Interno sin permiso: `Sin permiso sobre el contrato de esta silla.` · Ambiguo: `La referencia manual de esta silla corresponde a más de un contrato; corrígela antes de moverla.` |
| D3 · escritura en el contrato | `ventas.bloqueo_ref_id` solo se actualiza si D1 pasó | — |

| Función | A1–A3 | B1 | B2 | C1 | C2 | D1–D3 |
|---|---|---|---|---|---|---|
| `trasladar_cupos` | sí | Y y X | sí | sillas elegidas en Y | libres reales | no (nunca toca sillas con contrato) |
| `mover_pasajero` (A y B) | sí | Y y X | sí | silla en Y; en A además la silla destino en X | ocupada movible; en A destino libre real | sí |
| `retirar_cupo` | sí | Y | no | silla en Y | libre real | no |

#### 6.0.2 Idempotencia segura con solicitudes simultáneas

Tabla nueva **`operaciones_vuelo`**: `operacion_id uuid primary key`, `tipo text`, `huella text`, `actor_id uuid`, `created_at`. Solo lectura para los roles de vuelos, sin policies de escritura y con el mismo trigger de inmutabilidad que el historial.

- La **huella** es el sha256 de los parámetros canónicos: tipo, origen, destino, cantidad o silla, modo y silla destino. El motivo queda fuera (decisión IDEM-2).
- Primera escritura de cada función, **después** de A1–A3 y **antes** de bloquear `ventas`, `bloqueos_vuelo` o `sillas`:

```sql
insert into operaciones_vuelo (operacion_id, tipo, huella, actor_id)
values (p_operacion_id, v_tipo, v_huella, auth.uid())
on conflict (operacion_id) do nothing;
get diagnostics v_filas = row_count;
```

- `v_filas = 1` → esta transacción es la dueña de la operación y sigue.
- `v_filas = 0` → la clave ya existe y **su transacción ya terminó con commit**. Se lee la fila: si coinciden tipo, huella y actor, devuelve `{repetida: true}` con el resumen tomado de `movimientos_silla where operacion_id = …`, sin aplicar nada. Si difiere, error `Operación inválida.`

Por qué es seguro con dos solicitudes **simultáneas** (S1 y S2, mismo id):

1. S1 inserta la clave y sigue. S2 intenta insertar la misma clave: el índice único lo hace **esperar** a que termine la transacción de S1. `ON CONFLICT` no decide sobre una fila de otra transacción en curso.
2. Si S1 hace commit, S2 recibe el conflicto (`v_filas = 0`) y, como en READ COMMITTED cada sentencia toma una foto nueva, su lectura siguiente ya ve la operación de S1 → `repetida`.
3. Si S1 falla y hace rollback, la clave desaparece y la inserción de S2 procede (`v_filas = 1`): S2 aplica la operación como dueña.
4. Sin interbloqueo: mientras espera, S2 todavía no tiene ningún otro bloqueo, porque la reserva es su primera escritura. S1 no espera nada de S2.

Descartado: comprobar primero `exists(…)` y luego insertar (las dos solicitudes ven "no existe" y aplican dos veces); un candado consultivo por `hashtext(id)` (colisiones y sin registro durable); la unicidad sobre `movimientos_silla` (un traslado genera N filas y no se sabe cuántas antes de aplicarlo).

Otros detalles:
- `set local lock_timeout` dentro de la función (valor en decisión IDEM-1): si S1 tarda, S2 falla con `Operación en curso; reintenta` en vez de agotar el tiempo de la petición. El reintento posterior devuelve `repetida`.
- Del lado del cliente, el `operacion_id` (`crypto.randomUUID()`) se genera al abrir la confirmación y se **reutiliza** en los reintentos de ese mismo envío. Se regenera tras una respuesta definitiva o si cambian los parámetros. Nunca lo genera el servidor: si lo hiciera, cada reintento sería una operación nueva.

#### 6.0.3 Orden de bloqueo

Para no interbloquearse con la reconciliación de reservas de la 167 (que bloquea `ventas` y después `sillas`):

1. reserva en `operaciones_vuelo`;
2. `ventas` del contrato, si aplica;
3. `bloqueos_vuelo` de Y y X en orden de id;
4. sillas de cada pool en orden de `bloqueo_id`.

#### 6.0.4 Resolución de `contrato_manual` (AUT-2)

**Evidencia** (`lib/vuelos/contratoManual.ts`): `sillas.contrato_manual` se creó para ventas **externas**, pero en la práctica se usó para enlazar ventas **internas de minorista** escritas sin el prefijo `MIN-` (p. ej. `00-0541` en vez de `MIN-00-0541`), porque minorista no tiene tarifario ni reservar. La app ya resuelve esas referencias de forma segura para el manifiesto:

- recorta con `String.prototype.trim()` y trata el vacío como ausente;
- candidatos = la referencia tal cual y, si no empieza por `MIN-`, `MIN-` + referencia (`candidatosNumeroContrato`, `numeroConTenant`);
- compara **exacto** contra `ventas.numero_contrato` de **ambas agencias**. Por eso usa el cliente admin: con el de sesión, la RLS por tenant ocultaba uno de los candidatos y una ambigüedad real parecía única;
- resultado: 0 candidatos → externa; exactamente 1 → esa venta; 2 o más → no resuelve (falla cerrado).

**Diseño en SQL:** función privada `_resolver_contrato_manual(p_ref text) returns (clase text, numero_contrato text, tenant text)`, llamada solo desde las funciones de §6 (`execute` revocado a todos los roles del cliente). Replica **exactamente** la regla anterior; como corre `SECURITY DEFINER`, ve `ventas` de las dos agencias, igual que el cliente admin de la app.

**Recorte idéntico a `trim()`.** `btrim()` de Postgres solo quita el espacio ASCII: con una tabulación, un salto de línea, un NBSP o un BOM alrededor de `00-0541`, la referencia no casaba y quedaba como **externa** (autorización más laxa), mientras la app la resuelve a `MIN-00-0541`. La función recorta con la misma clase de caracteres que ECMAScript (WhiteSpace + LineTerminator):

```sql
regexp_replace(p_ref,
  '^[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$',
  '', 'g')
```

Comparada contra `trim()` real en 13 casos (tab, LF, CRLF, VT/FF, NBSP, U+3000, BOM, U+2028/2029, U+2000–200A, U+1680/202F/205F, NEL y U+180E, que JS **no** quita, tab interno, solo espacios, texto limpio): 13 de 13 idénticos. `btrim()` difiere en 8.

Después de recortar:
- **vacía** (solo espacios o saltos) → la app la trata como ausente. Aquí la silla **no** cuenta como libre real hasta limpiar el campo (el preflight la reporta);
- **no admitida** → queda **dentro** un espacio no ASCII (NBSP, U+2000–U+200A, U+3000, BOM…) o un carácter de control (tab, salto, U+0000–U+001F, U+007F–U+009F). **Falla cerrado**: no es externa ni interna hasta corregir el texto. La app la trataría como externa; aquí se endurece a propósito, porque un NBSP interno se ve igual que un espacio;
- el **espacio ASCII interno sí se admite** (un contrato externo puede llamarse "VENTA EXTERNA 123"); la comparación exacta es la misma en la app y aquí, así que no hay divergencia.

| Clase | Condición | Autorización al mover | Trazabilidad |
|---|---|---|---|
| `sin_referencia` | Referencia nula o vacía tras recortar | — (la silla no tiene contrato manual); si era solo espacios, no cuenta como libre hasta limpiarla | — |
| `no_admitida` | Espacio no ASCII o carácter de control dentro de la referencia recortada | **Falla cerrado para todos** hasta corregir el texto | Nada se escribe |
| `externo` | 0 ventas candidatas: es un contrato externo genuino | A1–A3 (rol de vuelos y agencia del actor, AUT-1) | Historial guarda el texto de `contrato_manual` y `clase = externo` |
| `interno` | Exactamente 1 venta candidata | D1 sobre esa venta: `acceso_editar_vuelos_contrato(numero)` con el **tenant de la venta**, nunca el del actor. Se bloquea su fila de `ventas` (orden §6.0.3) | Historial guarda el texto manual **y** el `numero_contrato` resuelto |
| `ambiguo` | 2 o más ventas candidatas | **Falla cerrado para todos**, superadmin incluido: no se elige una por su cuenta | Nada se escribe |

Reglas adicionales:
- La silla se lee sin bloquear para resolver, se bloquea la venta resuelta (si es `interno`), después records y sillas, y al final se **relee** la silla y se **vuelve a resolver**. Si cambió el texto o la clase (p. ej. alguien creó la otra venta candidata entre medias) → excepción `La silla cambió; recarga`, sin escribir nada.
- Las funciones que asignan un contrato manual (§6.5) guardan la referencia **ya recortada** y rechazan una `no_admitida`, para que el problema no se repita.
- Con `interno`, la operación **no** convierte el manual en orgánico: `contrato_manual` viaja tal cual (modo A copia, modo B mueve la fila). Tampoco toca `ventas.bloqueo_ref_id`, porque el vínculo durable de la venta con el record no existe para contratos manuales (decisión AUT-2b).
- Un contrato externo genuino cuyo texto coincide **por casualidad** con una venta interna se clasifica `interno`. Eso solo endurece la autorización (nunca la relaja); se corrige editando la referencia.
- La comparación es **exacta**, como la app: una referencia que solo casaría ignorando mayúsculas (`min-00-0541`) se trata como externa. El preflight la cuenta (§5b) para decidir antes (AUT-2c).
- El preflight §5b clasifica todas las referencias actuales con la misma regla: externas, internas por agencia y ambiguas.

### 6.1 `trasladar_cupos(p_origen, p_destino, p_cantidad, p_motivo, p_operacion_id)` — tarea 2

1. A1–A3 (§6.0.1) y parámetros (origen ≠ destino, 1 ≤ cantidad ≤ 100, `operacion_id` no nulo).
2. Reserva de la operación (§6.0.2); si ya estaba aplicada, devolver `repetida` sin tocar nada.
3. `select … from bloqueos_vuelo where id in (Y,X) order by id for update` (B1).
4. Validar compatibilidad (B2 / D4). Si no cumple: excepción con el motivo.
5. Bloquear las sillas de Y y X (`for update`, en orden de `bloqueo_id`).
6. Elegir `p_cantidad` sillas libres reales de Y (orden por decidir, D9b). Si hay menos: excepción "Y tiene N cupos libres".
7. `max(numero_silla)` de X → asignar números consecutivos.
8. `update sillas set bloqueo_id = X, numero_silla = …, updated_at = now()` para las elegidas (el estado queda según D7).
9. `update bloqueos_vuelo`: Y −n (con `check >= 0`), X +n.
10. Insertar n filas de historial `traslado_cupo` con cupos antes/después.
11. Comprobar I1/I3 sobre Y y X; si fallan, excepción y rollback total.

### 6.2 `mover_pasajero(p_silla_id, p_destino, p_modo, p_acepta_tarifa_distinta, p_motivo, p_operacion_id)` — tarea 3

> Implementada (194) **sin** `p_silla_destino_id`: en el modo A la función toma las sillas libres reales de X con número más bajo (D6, pendiente de confirmar). La tarifa distinta exige `p_acepta_tarifa_distinta = true` (D4b).

`p_modo` ∈ {`solo_datos`, `con_cupo`}, obligatorio y sin valor por defecto (I9).

1. A1–A3 y parámetros; reserva de la operación (§6.0.2).
2. Leer la silla de origen (sin bloquear) para conocer Y y el contrato; bloquear `ventas` del contrato si lo hay; bloquear `bloqueos_vuelo` Y/X (B1) y los pools; **releer la silla ya bloqueada** y revalidar C1 (sigue en Y, sigue ocupada, **mismo contrato**: si cambió entre la lectura y el bloqueo, excepción `La silla cambió; recarga`, nunca se reintenta solo).
   Autorizar el contrato leído de la silla ya bloqueada (D1; manual según D2).
3. Validar que la silla sea movible: estado permitido (D5), que no sea `cambio` y que tenga contrato o datos de pasajero.
4. Validar compatibilidad (B2: destino, no salido, proveedor; tarifa distinta solo con aceptación explícita) y **D1 aprobada**: si el contrato de la silla tiene otras sillas en Y, se mueven **todas juntas** en la misma operación (el modal las lista). Nunca queda un contrato repartido entre Y y X. En el modo A, X debe tener tantas sillas libres reales como sillas se mueven; si no, error sin pasar al modo B.
5. **Modo `solo_datos` (A):**
   - La silla destino es `p_silla_destino_id` (elegida en la interfaz) o, si se decide así (D6), la primera libre real de X. Si no existe o no está libre: excepción "X no tiene cupo disponible; elige 'Trasladar el cupo'". Sin inserción ni cambio de modo.
   - Copiar a la silla de X: estado, `numero_contrato` o `contrato_manual`, datos de pasajero, asesor, agencia, hotel, acomodación, plazo, `inf_*`, `responsable_menor`.
   - Limpiar la silla de Y por completo, `contrato_manual` incluido → `disponible`.
   - `cupos_total` sin cambios.
6. **Modo `con_cupo` (B):**
   - `update sillas set bloqueo_id = X, numero_silla = max(X)+1` en la misma fila; los datos y el contrato viajan con ella.
   - Y −1 / X +1.
7. Contrato: actualizar `ventas.bloqueo_ref_id` según D2; `contrato_vuelos` según D3.
8. Insertar 1 fila de historial (`mover_datos` o `mover_con_cupo`) con copia del contrato.
9. Comprobar I1, I3/I4, I5 e I6; si falla, excepción y rollback total.

Los infantes sin silla (`contrato_pasajeros` con responsable) siguen al adulto automáticamente: el manifiesto los empareja por contrato + documento del responsable con las sillas de ESE record. Las columnas `inf_*` de la silla viajan con los datos.

### 6.2b `retirar_cupo(p_silla_id, p_motivo, p_operacion_id)` — reducir cupos sin borrar

1. A1–A3 y parámetros; reserva de la operación (§6.0.2).
2. Leer la silla para conocer Y; bloquear `bloqueos_vuelo` Y y el pool de Y; releer la silla (C1).
3. Exigir silla libre real (C2). Una silla ocupada no se retira: primero hay que liberarla o moverla.
4. `update sillas set estado = 'retirada', updated_at = now()` (la guarda del trigger lo permite porque corre como dueño de la función, §4.4).
5. `cupos_total(Y) − 1` (con `check >= 0`).
6. 1 fila de historial `retiro_cupo` con cupos antes/después y motivo.
7. Comprobar I1 sobre Y; si falla, excepción y rollback total.

La fila sigue existiendo, así que la FK del historial y la auditoría (087) quedan intactas. No hay borrado físico en ningún camino.

### 6.3 Acciones de la app

`cambiarSillas` y `moverPasajeroSilla` pasan a ser envoltorios delgados que validan la forma de los datos y delegan en la función SQL (como `actualizarControlBloqueo`). `revalidatePath` solo después de un resultado sin error. `eliminarCupo` pasa a delegar en `retirar_cupo` (D8) y `eliminarBloqueo` se bloquea si el record tiene historial (D11); ninguna de las dos vuelve a borrar `movimientos_silla`.

### 6.5 Cierre de las vías de escritura directa (RLS 137)

**Por qué hace falta.** Las funciones de §6 solo protegen algo si nadie puede hacer lo mismo **directamente** por la API. Hoy la policy `sillas: escritura control` es `FOR ALL` y `bloqueos: escritura control` también (137): cualquier rol de vuelos, **de cualquier agencia**, escribe cualquier columna.

Evidencia en Postgres local, escritura directa como `authenticated` con JWT de usuarios sintéticos, todo revertido:

| # | Quién | Acción directa | Resultado | Qué se salta |
|---|---|---|---|---|
| T1 | control_vuelo de mayorista (`acceso_editar_vuelos_contrato('MIN-00-0541') = false`) | Poner `contrato_manual = '00-0541'` y `confirmada` a una silla libre | Permitido | Autorización por contrato (AUT-2) |
| T2 | ídem | Poner `numero_contrato = 'MIN-00-0541'` a una silla libre | Permitido | Autorización por contrato (D1) |
| T3 | ídem | Quitar el contrato y liberar la silla de un pasajero minorista | Permitido | D1 e historial |
| T4 | ídem | Poner `disponible` una silla que conserva su contrato | Permitido | I6 |
| T5 | ídem | `cupos_total + 5` | Permitido (10 → 15) | "No aumentar cupos" e I1 |
| T6 | ídem | Insertar una silla en un record existente | Permitido | "No aumentar cupos" |
| T7 | ídem | Borrar físicamente una silla | Permitido | Retiro con historial (§4.4b) |
| T8 | ídem | Cambiar `bloqueo_id` | Permitido | Traslado con historial (I3, I13) |
| T9 | operaciones de **minorista** | `cupos_total + 5` | Permitido | AUT-1 |
| T10 | ídem | Poner `numero_contrato` de una venta **mayorista** | Permitido | AUT-1 y D1 |
| T11–T13 | venta | UPDATE de silla / INSERT de silla / UPDATE de cupos | 0 filas / rechazado / 0 filas | — |

Conclusión: proteger solo `bloqueo_id` y `retirada` (§4.4) **no basta**. Hay que cerrar todas las columnas de estructura, vínculo y ocupación, la creación y el borrado de filas, y `cupos_total`.

**Grupos de columnas de `sillas`** y qué podrá escribir `authenticated` directamente tras el cierre:

| Grupo | Columnas | Escritura directa |
|---|---|---|
| E · estructura | `id`, `bloqueo_id`, `numero_silla` | Nunca |
| V · vínculo y ocupación | `numero_contrato`, `contrato_manual`, `estado` | Nunca: solo funciones, que aplican D1/AUT-2 |
| D · datos operativos | `pasajero_nombres`, `pasajero_apellidos`, `tipo_doc`, `numero_doc`, `nacimiento`, `asesor`, `agencia`, `hotel`, `acomodacion`, `plazo`, `inf_*`, `responsable_menor`, `updated_at` | Sí, **solo en sillas sin contrato** (sin `numero_contrato` ni `contrato_manual`): carga masiva y datos de sillas libres. En sillas **con** contrato, solo por la función `editar_pasajero_silla` (DIR-2 aprobada) |
| Filas | INSERT, DELETE | Nunca |
| `bloqueos_vuelo.cupos_total` | — | Nunca por UPDATE; INSERT de un record solo con `cupos_total = 0` (se crea con `crear_bloqueo`) |
| Resto de `bloqueos_vuelo` | fechas, vuelos, horas, tarifas, notas, destino… | Sí (`actualizarBloqueo`, cambio operacional, control), sin cambios |

**Mecanismo:**
- `revoke insert, delete on public.sillas from authenticated` (privilegio de tabla, sin listas de columnas).
- Triggers `BEFORE UPDATE` **`SECURITY INVOKER`**:
  - `sillas_guarda_escritura`: excepción si `current_user = 'authenticated'` y cambia alguna columna E o V, **o** cambia una columna del grupo D en una silla con `numero_contrato` o `contrato_manual` (DIR-2).
  - `bloqueos_guarda_cupos`: excepción si `current_user = 'authenticated'` y cambia `cupos_total`, o si un INSERT trae `cupos_total <> 0`.
- Comprobado en local: dentro de una función `SECURITY DEFINER` el trigger ve `current_user = postgres` (dueño) y deja pasar; en una escritura directa ve `authenticated` y bloquea. Una función de trigger `SECURITY DEFINER` vería siempre al dueño y no distinguiría nada: **debe ser INVOKER**.
- Se prefiere trigger a privilegios por columna porque solo lista lo **prohibido**. El riesgo inverso (una columna nueva queda escribible por defecto) se cubre con una prueba que falla si `sillas` tiene una columna que no está en ningún grupo.
- **Exentos:** el dueño de las funciones y, hasta la fase D, `service_role`.
- **Error de la guarda:** `raise exception using errcode = 'insufficient_privilege' (42501), message = 'GUARDA_ESCRITURA: …'`. El prefijo permite distinguir en el bloque C del preflight un rechazo de la guarda de uno de la RLS, que también usa 42501 con otro mensaje. Un rechazo por RLS no prueba que la guarda funcione.
- **El privilegio de UPDATE se conserva:** `authenticated` sigue teniendo UPDATE de tabla sobre `sillas` y `bloqueos_vuelo`, porque las columnas del grupo D y el resto del record se siguen editando. Por eso `has_column_privilege('authenticated', …, 'UPDATE')` **seguirá siendo true** para las columnas protegidas también después de la fase C. El preflight lo muestra como dato (INFO), nunca como veredicto; que la escritura se rechace solo lo demuestra el bloque C (prueba efectiva). INSERT y DELETE de `sillas` sí se retiran y ahí el privilegio pasa a false.

**Escritores actuales y su destino** (ninguno legítimo se rompe si se sigue el orden de fases):

| Escritor | Hoy | Toca | Destino |
|---|---|---|---|
| `crearBloqueo` / `cargarBloqueosMasivo` (`vuelos/actions.ts:48, 305`) | sesión: INSERT del record + INSERT de sillas | filas, `cupos_total` | Función `crear_bloqueo` (atómica; cierra de paso `docs/futuro/atomicidad-vuelos-legacy.md` §2) |
| `cambiarSillas` (`:366`) | sesión | E, V, `cupos_total` | `trasladar_cupos` |
| `moverPasajeroSilla` (`:633`) | sesión | filas, V, D | `mover_pasajero` |
| `eliminarCupo` (`:507`) | sesión | DELETE, `cupos_total`, historial | `retirar_cupo` |
| `eliminarBloqueo` (`:541`) | sesión | DELETE de sillas e historial | Función `eliminar_bloqueo`: solo sin historial ni contratos (D11) |
| `cambiarEstadoSilla` (`:441`) | sesión | V (`estado`) | Función `cambiar_estado_silla`: transiciones de DIR-1 + autorización del contrato |
| `asignarContratoManual` / `quitarContratoManual` (`:461, 488`) | sesión | V | Funciones con la resolución de §6.0.4 |
| `borrarPasajeroSilla` (`:611`) | sesión | V + D | Función `liberar_silla` (autorización del contrato; limpia también `contrato_manual`) |
| `editarPasajeroSilla` (`:582`) | sesión | D | Función `editar_pasajero_silla` (autoriza el contrato de la silla, DIR-2). Solo en sillas sin contrato podría seguir directo |
| `cargarPasajerosMasivo` (`:687`) | sesión | D, solo en sillas libres | Sigue directo |
| Núcleo de reservas 167 (`_ajustar_sillas_*`, `crear_pasajeros_contrato*`, `_reemplazar_pasajeros_nucleo`, `guardar_pasajeros_contrato`), `eliminar_contrato`, `revertir_contrato_incompleto`, `guardar_infante_vuelo` | `SECURITY DEFINER` (dueño `postgres`) | V + D | Sin cambios (exentos como dueño) |
| Copia de datos del pasajero al reservar o crear contrato (`reservar/actions.ts:739, 2364`; `contratos/actions.ts:617`) | admin | D | Sin cambios |
| Confirmación `en_plazo → confirmada` (`reservar/actions.ts:2810`, `contratos/actions.ts:983`) | admin **o sesión si falta `SUPABASE_SERVICE_ROLE_KEY`** | V | Fase B: quitar el respaldo de sesión (si falta la clave, error explícito) o función `confirmar_sillas_contrato` |
| `liberarVencidas` (cron, `lib/reservar/liberarVencidas.ts:27`) | admin | V + D | Sin cambios hasta la fase D |

**Fases del cierre** (se integran con §12):

| Fase | Qué | Qué sigue funcionando | Verificación |
|---|---|---|---|
| A · aditiva | Migración con todas las funciones de la tabla anterior + `_resolver_contrato_manual`. Sin guardas | Todo, igual que hoy | Pruebas SQL de cada función en local |
| B · código | Las Server Actions delegan en las funciones; se quita el respaldo de sesión en las confirmaciones. Validar en Preview sobre un record de prueba | Todo; los escritores directos ya no se usan | `test:unit`/`test:react`; pruebas de cableado que exigen que ninguna acción escriba columnas E/V, inserte o borre sillas ni toque `cupos_total` |
| **▶ Barrera B→C** | **El código B desplegado y verificado en Producción** (ver abajo). Sin esto no se activa C | — | Lista de comprobación de la barrera |
| C0 · opcional, modo aviso | Los mismos triggers, pero con `raise warning 'GUARDA_ESCRITURA: …'` en vez de excepción, durante un ciclo operativo acordado | Todo, incluido el código viejo | En los logs de Postgres de Supabase **no** debe aparecer ningún `GUARDA_ESCRITURA`. Si aparece, algún código viejo (un despliegue anterior o un Preview sin rebasar) sigue escribiendo directo |
| C · cierre para `authenticated` | `revoke insert, delete` en `sillas` + los dos triggers en modo rechazo | Reservas, confirmación, cron y copia de datos (admin/dueño); edición de datos y carga masiva (grupo D) | Preflight A: guardas **INDETERMINADO** (bien formadas: habilitadas, BEFORE, por fila, INVOKER); INSERT/DELETE de `sillas` en false; UPDATE de columnas protegidas **sigue concedido** (esperado). Preflight **C**, primero en local y luego en Producción con aprobación: todos los casos prohibidos **RECHAZADA → OK** y los 2 permitidos **OK** |
| D · opcional, `service_role` | Mover confirmación y `liberarVencidas` a funciones; extender la guarda a `service_role` para E/V/filas/`cupos_total` | Copia de datos (grupo D) | Mismas pruebas como `service_role` |
| E · historial | Inmutabilidad de `movimientos_silla`/`operaciones_vuelo` (§4.4) | — | Preflight §1 UPDATE/DELETE del historial |

Cada fase se revierte sola: C con `drop trigger` + `grant insert, delete`, A/B porque son aditivas. Nunca se invierte el orden: con C antes que B **en Producción**, crear bloqueos, cambiar estados, asignar contratos manuales, eliminar cupos y mover pasajeros fallarían.

#### Barrera B→C (Preview y Producción comparten la base)

Las guardas de C son un cambio de **base de datos**, y la base es la misma para Producción y para todos los Preview. En cuanto C corre, cualquier despliegue que siga con el código anterior a B, **Producción incluida**, empieza a fallar en las acciones de vuelos que escriben directo. Que B funcione en un Preview **no** basta: Producción puede seguir con el código viejo. Condiciones, todas obligatorias, antes de ejecutar la migración C:

1. **B integrado en `main`**, con su hash anotado.
2. **Despliegue de Producción de ese commit (o posterior) en estado *Ready* y asignado al dominio de producción** en Vercel. Anotar el id del despliegue. No confiar en "ya se mergeó": comprobar el despliegue activo.
3. **Verificación funcional en Producción con records de prueba separados según dejen historial o no.** El historial es inmutable (§4.4): un record que acumula movimientos **no se puede borrar** y **no se intenta borrar**.

   | Acción | ¿Genera `movimientos_silla` y `operaciones_vuelo`? | Dónde se prueba | Cómo se verifica |
   |---|---|---|---|
   | Trasladar cupos libres | **Sí** (`traslado_cupo`, una fila por silla) | P1 → P1' | Historial del record y cupos Y−n / X+n |
   | Mover pasajero, modo A (solo datos) | **Sí** (`mover_datos`) | P1 → P1' | Historial; ningún total cambia |
   | Mover pasajero, modo B (datos + cupo) | **Sí** (`mover_con_cupo`) | P1 → P1' | Historial; Y−1 / X+1 |
   | Retirar cupo | **Sí** (`retiro_cupo`) | P1 | Historial; silla `retirada`, `cupos_total − 1` |
   | Crear record | No | P2 (y P1/P1' al prepararlos) | Record con `cupos_total` = sillas creadas; auditoría (087) |
   | Cambiar estado a mano (según DIR-1) | No | P2 | Estado nuevo; auditoría (y `bloqueo_cambios` si DIR-1 lo dispone) |
   | Asignar / quitar contrato manual | No | P2 | Silla confirmada/liberada; auditoría |
   | Liberar silla (borrar pasajero) | No | P2 | Silla libre, sin `contrato_manual`; auditoría |
   | Editar datos de una silla sin contrato | No | P2 | Datos guardados |
   | Eliminar record | No (y exige que no tenga historial ni contratos) | **P2** debe borrarse; **P1 debe rechazarse** con mensaje claro | P2 ya no existe; P1 intacto |
   | Confirmar un contrato | No | Solo si se acuerda un contrato de prueba (deja rastro contable); si no, en el siguiente contrato real | Sillas `en_plazo → confirmada` |

   - **P1 y P1'**: par de records de prueba **permanentes**, marcados en notas ("PRUEBA — NO BORRAR"), con el mismo destino y proveedor, fecha de ida futura y la misma tarifa neta. Una segunda variante de P1' con otra tarifa sirve para ver la advertencia de D4b. Conservan su historial para siempre.
   - **P2**: record de prueba **desechable**, sin ningún movimiento; al final se elimina con la función nueva.
   - Se verifican por el historial solo las acciones que lo generan. Las demás, por su efecto y por la tabla `auditoria`, que registra al actor también dentro de las funciones porque lee el JWT.
4. **Previews viejos:** todo Preview construido antes de B (ramas abiertas sin rebasar) escribe en la misma base y dejará de poder operar vuelos tras C. Rebasar o volver a desplegar esas ramas, o aceptar explícitamente que fallen; no validar nada en ellos.
5. **Sin retroceso de Vercel a un despliegue anterior a B** mientras C esté activa. Si hace falta volver atrás el código, **primero se revierte C** (`drop trigger` + `grant insert, delete`) y después se retrocede el despliegue.
6. **Crons:** solo corren en Producción (`vercel.json`) y usan admin, así que no se afectan hasta la fase D. Comprobar igualmente la siguiente ejecución de `liberar-vencidas` después de C.
7. **Opcional, C0:** ningún aviso `GUARDA_ESCRITURA` en los logs durante el ciclo acordado.

La misma lógica aplica a la **barrera D→E**: la inmutabilidad del historial (E) rompe el código viejo de `eliminarCupo`/`eliminarBloqueo`, que borra `movimientos_silla`. Solo se activa cuando el código B (que ya no borra historial) está verificado en Producción.

**Riesgos residuales tras la fase C:**
- `service_role` (código de servidor) sigue pudiendo escribir E/V hasta la fase D. No es una vía para el usuario final, pero un error de código podría romper invariantes.
- Toda función `SECURITY DEFINER` del dueño queda exenta, también las existentes. Revisado en local: de las nueve que mencionan `sillas`, solo tres las actualizan (`_ajustar_sillas_bloqueo_nucleo`, `eliminar_contrato`, `revertir_contrato_incompleto`), y sus `SET` tocan únicamente `estado`, `numero_contrato` y datos del pasajero. Ninguna inserta ni borra sillas ni cambia `bloqueo_id`, `numero_silla` o `cupos_total`. Una función nueva del dueño debe revisarse con este mismo criterio. Precedente en el repo de guarda con escape explícito: `contrato_condiciones` (164/166) usa la bandera de transacción `app.eliminando_contrato`; aquí se prefiere `current_user`, porque no depende de que cada función recuerde activarla.
- El grupo D sigue editable entre agencias (datos personales de pasajeros de la otra agencia) mientras DIR-2 no se decida.
- Otras columnas de `bloqueos_vuelo` siguen editables directo por diseño; `actualizarBloqueo` no escribe historial de fechas (tarea 1, pendiente de horario).

### 6.8 Propuesta de cierre revisada (inventario completo de escritores, 2026-09-30)

> **C y E implementadas solo en local: ver §6.8.5; no activas en Producción.** Revisa §6.5 con el inventario hecho sobre el árbol actual (código + **todas** las migraciones, incluidas las escrituras dinámicas con `execute format`, que un `grep` de `update public.sillas` no encuentra). Hasta que las barreras de esta sección estén verificadas en Producción, **las tareas 2 y 3 no se declaran completas**.

#### 6.8.1 Escritores legítimos de `sillas`, `bloqueos_vuelo` y del historial

Cliente: **sesión** = rol de base `authenticated` (lo que la guarda bloquea); **admin** = `service_role` (exento hasta la fase D); **definer** = función `SECURITY DEFINER` del dueño `postgres` (exenta: el trigger ve `current_user = postgres`).

| # | Escritor | Cliente | Escribe | ¿Se rompe con el cierre C? | Qué hacer antes de C |
|---|---|---|---|---|---|
| W1 | `crearBloqueo` (`vuelos/actions.ts:48`) | sesión | INSERT `bloqueos_vuelo` con `cupos_total = N` + INSERT de N `sillas` (dos llamadas sin transacción) | **Sí** (INSERT de sillas revocado; cupos ≠ 0) | Función `crear_bloqueo(datos, cupos)` atómica (B-bis) |
| W2 | `cargarBloqueosMasivo` (`:305`) | sesión | Igual que W1 por fila; **ignora el error** del INSERT de sillas | **Sí** | Llamar `crear_bloqueo` por fila (B-bis) |
| W3 | `eliminarBloqueo` (`:~500`) | sesión | DELETE de sillas y del record | **Sí** (DELETE revocado) | Función `eliminar_bloqueo(id)`: rechaza si hay historial, contrato, manual o pasajero (B-bis) |
| W4 | `actualizarBloqueo`, `registrarCambioOperacional` | sesión | Columnas de vuelo/fechas/tarifas de `bloqueos_vuelo`, **nunca** `cupos_total` | No | — |
| W5 | `cargarPasajerosMasivo` (`:~740`) | sesión | Grupo D en sillas **sin** contrato | No (permitido) | — (ver W11: hoy también llena sillas con residuos) |
| W6 | Acciones de la 194 (`cambiarSillas`, `moverPasajeroSilla`, `retirarCupo`, `cambiarEstadoSilla`, manual, liberar, editar) | definer | E, V, D, `cupos_total`, historial | No | Ya hecho (fase B) |
| W7 | `confirmarVenta` (`reservar/actions.ts:2810`), `recalcularEstadoAbono` (`contratos/actions.ts:984`) | admin; **sesión si falta `SUPABASE_SERVICE_ROLE_KEY`** | V (`en_plazo → confirmada`) | Solo sin la clave | Quitar el respaldo de sesión: error explícito si falta la clave (B-bis) |
| W8 | Copia de datos al reservar (`reservar/actions.ts:739, 2364`; `contratos/actions.ts:618`) | admin | D en sillas recién asignadas | No (hasta D) | — |
| W9 | `crear_pasajeros_contrato(_multi)` → `_ajustar_sillas_bloqueo_nucleo` (167) | definer (llamada por admin) | V: asigna y libera sillas por estado | No | — |
| W10 | `eliminar_contrato` (166), `revertir_contrato_incompleto` (172) | definer | V + D: libera las sillas del contrato **sin filtrar el estado** | No | Ver riesgo R2 |
| W11 | `liberarVencidas` (cron `/api/cron/liberar-vencidas`, y al entrar a Reservar) | admin | V + parte de D: **no borra nombre, documento ni nacimiento** | No (hasta D) | Origen de las sillas "disponibles con datos" (R1) |
| W12 | `fn_renumerar_contrato`, `fn_arreglar_numeros_minorista` (115/117) | definer, **dinámico** | V: `sillas.numero_contrato` | No | — |
| W13 | `fn_fusionar_destino` (112) | definer, **dinámico** | `bloqueos_vuelo.destino_id` | No | — |
| W14 | `actualizar_control_bloqueo` (158) | definer | Modalidad/emisión/pago | No | — |
| W15 | `_reservar_operacion` + funciones de la 194 | definer | INSERT en `operaciones_vuelo` y `movimientos_silla` | No | **Únicos escritores del historial** |
| W16 | Código **anterior a B** aún desplegado (Producción hoy, Previews viejos) | sesión | INSERT/DELETE de `movimientos_silla`, sillas extra, `cupos_total` | **Sí** (es lo que se quiere cerrar) | Barrera B→C (§6.5) |

`guardar_infante_vuelo` (168), el editor de vuelos del contrato (157) y la auditoría (087) **no** escriben `sillas` ni `bloqueos_vuelo`. La semilla de la migración 012 fue única. Ningún flujo legítimo **inserta** sillas fuera de W1/W2, ni **borra** fuera de W3.

Riesgos encontrados en el inventario (existentes, no los introduce el cierre):
- **R1.** `liberarVencidas` deja `disponible` sillas con nombre, documento y nacimiento del pasajero cuyo contrato venció. Reservar elige sillas solo por estado, así que un contrato nuevo puede quedar sobre una silla con datos de otra persona, y esas sillas no cuentan como "libres reales" para trasladar ni mover. Corrección propuesta (decisión del usuario): `liberar_vencidas()` que limpie todo el grupo D. Las sillas ya afectadas solo se corrigen después de contarlas con el preflight y con aprobación.
- **R2.** `eliminar_contrato` y `revertir_contrato_incompleto` ponen `disponible` cualquier silla del contrato, sin mirar el estado. Con DIR-1 ninguna silla con contrato puede quedar `devuelta`/`no_vendida`, pero filas legadas sí: eliminar ese contrato revive un cupo devuelto. Propuesta: filtrar `estado in ('en_plazo','confirmada')` en una migración aparte.

#### 6.8.1b Fase B-bis implementada (2026-10-01, árbol de trabajo, sin commit, sin aplicar en remoto)

- **Migración 195** (`20260601000195_crear_eliminar_bloqueo_atomico.sql`, aditiva; requiere la 194): `crear_bloqueo(p_datos jsonb, p_cupos)` crea el record y sus N sillas `disponible` en una transacción, con `cupos_total` = sillas creadas (comprobado); `eliminar_bloqueo(p_bloqueo_id)` borra sillas y record en una transacción y rechaza, sin borrar nada y listando todos los motivos, si hay historial de movimientos, sillas con contrato, contrato manual o datos de pasajero/infante, ventas vinculadas (`bloqueo_ref_id`), contratos con ese PNR en su vuelo, o paquetes, tarifario o itinerarios que lo usen. Ambas con AUT-1 (`_vuelos_actor`). No cambia tablas, policies, privilegios ni datos: el código anterior sigue funcionando mientras se despliega. Rollback: `supabase/scripts/rollback_195_crear_eliminar_bloqueo.sql`.
- **W1–W3:** `crearBloqueo`, `cargarBloqueosMasivo` (una llamada atómica por fila; el error de cada fila se reporta y la fila no cuenta como insertada) y `eliminarBloqueo` solo llaman a esas funciones. Ningún INSERT/DELETE directo de sillas o records queda en `vuelos/actions.ts` (guarda de cableado).
- **W7:** `confirmarVenta` y `recalcularEstadoAbono` usan `lib/reservar/confirmarSillas.ts`: sin `SUPABASE_SERVICE_ROLE_KEY` fallan explícitamente **antes** de su primera escritura (ni venta ni sillas cambian); el error del UPDATE de sillas se devuelve y la venta vuelve a su estado anterior. `registrarAbono`/`actualizarAbono` informan "el abono quedó registrado, pero la venta no se pudo confirmar"; `EstadoVenta` muestra el error (antes lo ignoraba).
- **Hallazgo nuevo, sin tocar (W8):** `convertirCotizacionCarrito` (`reservar/actions.ts`, cliente `admin` con respaldo de sesión si falta la clave) copia datos de pasajeros a sillas ya asignadas. La fase C rechazaría esa escritura con la sesión (grupo D en sillas con contrato). Antes de C debe fallar explícitamente igual que W7.
- **Pruebas:** `supabase/scripts/test_crear_eliminar_bloqueo.sql` (local, ROLLBACK): permisos (sin sesión, venta, operaciones de Minorista, inactivo, anon), creación individual con todos los campos y con 0 cupos, validaciones, fallo forzado a mitad de la creación (sin record ni sillas sueltas) y reintento, eliminación permitida (con cascada de `bloqueo_cambios`), cada motivo de rechazo y varios a la vez, fallo forzado a mitad del borrado (record y sillas intactos) y compatibilidad (policies y privilegios sin cambios; el camino directo anterior sigue funcionando). Pruebas de acciones (cliente simulado) y de W7 (`pruebas/confirmarSillasW7.test.ts`).

#### 6.8.2 Qué se cierra y cómo

**`sillas`** (migración C):
1. `revoke insert, delete, truncate on public.sillas from authenticated, anon`.
2. Trigger `sillas_guarda_escritura` `BEFORE UPDATE`, **`SECURITY INVOKER`**, solo si `current_user in ('authenticated','anon')`: rechaza (42501, `GUARDA_ESCRITURA: …`) cualquier cambio en E (`id`, `bloqueo_id`, `numero_silla`) o V (`numero_contrato`, `contrato_manual`, `estado`), y cualquier cambio en D si la silla tiene `numero_contrato` o `contrato_manual` (DIR-2).
3. Policy de UPDATE directo (reemplaza la `FOR ALL` de la 137): roles de vuelos **y** AUT-1 (`superadmin` o tenant `mayorista`), para que un usuario de Minorista tampoco edite datos de pasajeros por la API.

**`bloqueos_vuelo`** (misma migración):
1. `revoke insert, delete, truncate` a `authenticated`/`anon`: con W1–W3 en funciones, nadie los necesita.
2. Trigger `bloqueos_guarda_cupos` `BEFORE UPDATE` (INVOKER): rechaza cambiar `cupos_total` desde `authenticated`/`anon`.
3. La policy de UPDATE queda con AUT-1.

**Historial** (migración E, después de la barrera D→E):
1. `movimientos_silla` y `operaciones_vuelo`: quitar la policy `FOR ALL` (005/137) y dejar solo SELECT para los roles de vuelos; `revoke insert, update, delete, truncate` a `authenticated`, `anon` **y `service_role`**.
2. Trigger `BEFORE UPDATE OR DELETE` que rechaza siempre, también al dueño. Única salida: una corrección de mantenimiento que active `set local app.correccion_historial = 'on'` en una transacción revisada y dejada en `auditoria`. Ninguna función de la app la activa.
3. La FK `movimientos_silla.silla_id → sillas` ya impide borrar una silla con historial (coherente con `retirada`).

**Fase D (opcional, después de C):** `confirmar_sillas_contrato()` y `liberar_vencidas()` como funciones; extender la guarda de `sillas` a `service_role` para E/V. Así el único camino para cambiar el vínculo de una silla serían funciones revisadas.

**Prueba de cobertura:** una prueba SQL falla si `sillas` tiene una columna que no está clasificada en E, V o D, para que una columna nueva no quede escribible por defecto.

#### 6.8.3 Orden propuesto (cada paso con su verificación)

| Paso | Qué | Migración | Verificación antes de seguir |
|---|---|---|---|
| 0 | Preflight A (y B) en Producción, **ejecutado por el usuario** | — | Conteos de §2–§5b; sillas con datos residuales (R1) |
| 1 | Integrar y desplegar lo ya hecho: 192 → 194 → código B | 192, 194 | Smoke en Preview y luego en Producción sobre P1/P1'/P2 (§6.5, barrera B→C, punto 3) |
| 2 | **B-bis**: `crear_bloqueo`, `eliminar_bloqueo`; W1–W3 pasan a ellas; W7 sin respaldo de sesión; opcional `liberar_vencidas` (R1) y filtro de estado de R2 | 195 (aditiva) | Pruebas SQL + de cableado (ninguna acción inserta/borra sillas ni toca `cupos_total` directo); crear, cargar por CSV y eliminar un record P2 en Producción |
| 3 | **Barrera B→C** completa (§6.5, 7 condiciones) | — | Despliegue activo de Producción ≥ paso 2; Previews viejos resueltos |
| 4 | C0: guardas en modo **aviso** durante un ciclo operativo acordado (al menos un día con reservas, una carga masiva y una corrida del cron) | C0 (script, §6.8.5) | Tabla `vuelos_guarda_avisos` vacía durante el ciclo |
| 5 | C: guardas en modo **rechazo** + revokes + policies con AUT-1 | **199** | Preflight C: en local y, con aprobación, en Producción; cada caso prohibido RECHAZADO, cada permitido OK. Smoke: una reserva, una confirmación por abono, una carga masiva de pasajeros, la siguiente corrida de `liberar-vencidas` |
| 6 | D (opcional) | 197 | Preflight C como `service_role` |
| 7 | **Barrera D→E**: ninguna versión desplegada escribe ni borra el historial | — | Revisión del despliegue activo y de los Previews |
| 8 | E: historial inmutable | **200** | En local y en Producción: UPDATE/DELETE del historial rechazados para `authenticated` y `service_role`; las funciones siguen insertando |
| 9 | Recién aquí: tareas 2 y 3 **completas** | — | Checklist de §6.5 y de esta sección firmada por el usuario |

Reversión: C y E con `drop trigger` + `grant` (scripts de rollback por migración). Antes de retroceder Vercel a una versión anterior a B, revertir primero C y E.

#### 6.8.4 R1 y R2

> **Estado (2026-10-01, árbol de trabajo, sin aplicar en remoto).** Decisión del usuario: las liberaciones futuras limpian todos los datos de la silla conservando el historial contractual; al eliminar un contrato, `devuelta` y `no_vendida` conservan su estado; las reservas solo toman sillas realmente libres, pero sin publicar el cambio de cupo vendible antes de presentar el conteo. Implementado: migración **196** (`_vaciar_sillas` como regla única; `liberar_vencidas` atómica con la fecha de negocio de Bogotá; eliminar/revertir contrato y el núcleo 167 la usan; pruebas `test_liberaciones_r1_r2.sql`) y `_silla_con_datos`/`_silla_libre` sobre las 16 columnas (194). **Sin publicar**: "reservas solo con sillas libres" queda como propuesta (`supabase/propuestas/reservas_solo_sillas_libres.sql`, prueba `test_propuesta_reservas_solo_libres.sql`) hasta revisar el diagnóstico de solo lectura `supabase/scripts/diagnostico_r1_r2_lectura.sql` en Producción. Ningún dato existente se limpia.
>
> W7 pasa a ser transaccional (migración **197**, `confirmar_venta` con la RLS de quien llama; prueba `test_confirmar_venta.sql`) y W8 queda sin respaldo de sesión.
>
> **Corrección de seguridad en la 197 (2026-10-02, antes de Producción):** el ayudante `_confirmar_sillas_de_venta` es SECURITY DEFINER y authenticated lo puede ejecutar directo (lo necesita `confirmar_venta`, que es INVOKER). No validaba nada: un usuario de Minorista o uno inactivo confirmaba por la API la silla en plazo de una venta mayorista ajena ya confirmada (comprobado en local con la versión anterior: silla cambiada y fila de auditoría). Ahora, antes de leer ninguna venta, exige sesión, usuario activo, un rol de las policies de UPDATE de ventas y el testigo de transacción `app.confirmar_venta_token = <número>|<usuario>` que solo fija `confirmar_venta` después de autorizar con la RLS. Luego exige la agencia (`puede_ver_tenant`) y la venta confirmada. Cualquier fallo responde 42501 con el mismo mensaje, sin revelar existencia ni estado. El testigo se limpia tras cada uso. La RLS efectiva de `confirmar_venta` y su atomicidad no cambian.

Propuesta original:

**R1 — silla `disponible` que conserva datos de un pasajero.** Orígenes encontrados:
- `liberarVencidas` (cron diario y, además, cada vez que alguien abre Reservar) libera las sillas `en_plazo` de contratos vencidos y borra contrato, asesor, hotel, acomodación y plazo, pero **no** nombre, apellidos, documento, nacimiento, `inf_*`, `agencia` ni `responsable_menor`. Además calcula "hoy" en UTC: desde las 7 p. m. de Bogotá libera contratos cuyo plazo vence ese mismo día en Colombia (por la ruta de Reservar; el cron de las 06:00 UTC no lo sufre).
- `eliminar_contrato` (166), `revertir_contrato_incompleto` (172) y la liberación del núcleo 167 limpian los datos del adulto pero no `inf_*`/`agencia`/`responsable_menor`.
- La carga masiva pone pasajeros **legítimos sin contrato** en sillas `disponible`: indistinguibles de un residuo por el estado.
- Consecuencia: la reserva (núcleo 167) elige sillas solo por estado `disponible`/`cambio_entrante`, así que puede asignar una silla con datos de otra persona y el paso de copia (W8) los **sobrescribe**; un pasajero de carga masiva se pierde sin aviso.

Propuesta en tres pasos, cada uno con decisión del usuario:
1. **Un solo "limpiar silla"**: función privada que borre TODO el grupo D (adulto, `inf_*`, `agencia`, `responsable_menor`, `plazo`…). La usan una nueva `liberar_vencidas()` atómica (fecha de negocio de Bogotá, `fechaNegocio`), y los tres caminos SQL anteriores. Los datos del pasajero no se pierden: siguen en `contrato_pasajeros` y en `auditoria`.
2. **Reservas solo sobre sillas libres reales** (`_silla_libre`): el núcleo 167 y los conteos de disponibilidad dejan de tomar sillas con datos. Cambia el cupo vendible de records con pasajeros de carga masiva (que hoy se cuentan como libres sin estarlo). Toca el núcleo de reservas: requiere aprobación y pruebas propias.
3. **Datos existentes**: diagnóstico de solo lectura primero (sillas `disponible` con datos, clasificadas por si su documento aparece en `contrato_pasajeros` de un contrato cancelado/eliminado → residuo, o no → posible pasajero de carga masiva). Limpieza solo de los residuos y solo con aprobación.

**R2 — eliminar o revertir un contrato no debe revivir una silla `devuelta`.** `eliminar_contrato` y `revertir_contrato_incompleto` hacen `estado = 'disponible'` en todas las sillas del contrato, sin mirar el estado. El núcleo 167 y `liberarVencidas` ya filtran (`en_plazo`/`confirmada`). Con DIR-1 una silla con contrato ya no puede pasar a `devuelta`/`no_vendida` a mano, pero sí hay filas legadas de antes. Propuesta: en esas dos funciones, quitar contrato y datos de **todas** las sillas del contrato (la FK obliga al eliminar), pero cambiar el estado a `disponible` **solo** si era `en_plazo`, `confirmada`, `disponible` o `cambio_entrante`; `devuelta` (definitiva), `retirada` y `cambio` conservan su estado; dejar constancia en `bloqueo_cambios`. Alcance por decidir: (a) `no_vendida` con contrato: ¿conserva `no_vendida` (recomendado, conservador) o vuelve a `disponible`?; (b) ¿bloquear la eliminación del contrato en vez de soltar la silla devuelta?; (c) diagnóstico de solo lectura previo: cuántas sillas `devuelta`/`no_vendida` tienen hoy `numero_contrato`.

#### 6.8.5 Fases C y E implementadas (2026-10-01, árbol de trabajo, sin commit, sin aplicar en remoto)

> **Escritas y probadas solo en la base local desechable. No están activas ni completas en Producción.** Las tareas 2 y 3 siguen incompletas hasta pasar las dos barreras y verificar en Producción.

**Numeración real** (comprobada contra todo el árbol, incluida la 198 de otra sesión): C = **199** `20260601000199_cierre_escritura_directa_vuelos.sql`; E = **200** `20260601000200_historial_vuelos_inmutable.sql`. Los números 196a/196b/197/198 de §6.8.3 y "195" de §12 eran tentativos. D (opcional) no se implementó.

**C (199).** Lo descrito en §6.8.2 con estas precisiones:
- Triggers `BEFORE INSERT OR UPDATE OR DELETE` (no solo UPDATE) y `BEFORE TRUNCATE` por sentencia, todos `SECURITY INVOKER`, activos solo para `current_user in ('authenticated','anon')`. Así, si alguien vuelve a conceder INSERT/DELETE, el trigger rechaza igual.
- La guarda de `sillas` lista lo **permitido**, no lo prohibido: solo el grupo D (16 columnas + `updated_at`) y solo en sillas sin `numero_contrato` ni `contrato_manual`. Cualquier otra columna, incluida una que se agregue en el futuro, falla cerrada. `created_at` cuenta como estructura. Una silla `retirada` no admite cambios. Un valor igual al anterior no cuenta como cambio (PostgREST puede mandar la fila completa).
- `bloqueos_vuelo`: se rechazan INSERT, DELETE y cambios de `id` o `cupos_total`. Todo lo demás sigue editable (`actualizarBloqueo`, cambio operacional, control).
- Privilegios: INSERT, DELETE y TRUNCATE revocados a `authenticated` y `anon`; además, UPDATE revocado a `anon`. `authenticated` conserva UPDATE (esperado).
- Policies: las `FOR ALL` de la 137 pasan a `FOR UPDATE` con AUT-1. **Cambio de comportamiento:** un usuario de Minorista ya no actualiza `bloqueos_vuelo`, tampoco por `actualizar_control_bloqueo` (es INVOKER).
- Error: 42501 con mensaje `GUARDA_ESCRITURA: …` que nombra las columnas.
- `service_role` y el dueño (funciones DEFINER) siguen exentos hasta D.
- Si C0 estaba instalado, la 199 retira sus triggers y funciones y conserva la tabla de avisos.
- Código: la carga masiva ahora elige solo sillas sin contrato ni contrato manual. Prueba de cableado: `pruebas/cierreEscrituraVuelos.wiring.test.ts`.

**E (200).** Lo descrito en §4.4 y §6.8.2 con estas precisiones:
- El trigger también rechaza INSERT a `authenticated`, `anon` y `service_role` (el dueño inserta: así siguen las funciones). UPDATE y DELETE se rechazan **a todos**, dueño incluido, y también una función DEFINER. `DELETE` sin `WHERE` se corta en la primera fila y se revierte entero.
- Privilegios INSERT, UPDATE, DELETE y TRUNCATE revocados en las dos tablas a `authenticated`, `anon` y `service_role`. Policy solo SELECT (los mismos cinco roles de antes).
- **Salida de mantenimiento:** solo el dueño o un administrador de la base, con `set local app.correccion_historial = 'on'`. Un rol de la API que active la bandera sigue rechazado. La corrección queda en `auditoria`.
- **Excepción acotada para `mover_pasajero`** (la 194 hace un UPDATE de `tramos_contrato_actualizados`; no se edita la 194). Solo pasa si cambia únicamente esa columna, de NULL a un número, si quien escribe no es un rol de la API, y si la operación (`operaciones_vuelo.created_at = now()`) es de la misma transacción. Una fila ya confirmada nunca vuelve a cambiar.
- Riesgo residual: el dueño de la tabla puede deshabilitar o borrar triggers con DDL. Eso queda fuera de la API.
- La limpieza de `test_traslado_concurrencia.sh` usa la salida de mantenimiento.

**Pruebas locales** (`pf_traslado`, todas terminan en ROLLBACK salvo los .sh, que limpian):

| Prueba | Resultado |
|---|---|
| `test_cierre_escritura_directa.sql` (C): capa de privilegio para 9 usuarios reales simulados + anon; capa de policy (AUT-1, venta, inactivo = 0 filas, medido como policy); capa de trigger con la policy a favor (todas las columnas E/V, datos con contrato o manual, retirada, `cupos_total` ±, `id`) y con privilegio y policy **concedidos** dentro de la transacción (INSERT, DELETE, DELETE sin WHERE, TRUNCATE para authenticated de varios roles y anon); permitidos (16 columnas, mismo valor, editar record, control, carga masiva); columna nueva falla cerrada; fallo a mitad de sentencia sin cambios parciales; exentos (service_role W8, crear/eliminar record, trasladar, retirar, estado, manual, editar, liberar, mover en los dos modos, confirmar, liberar vencidas, renumerar contrato y fusionar destino dinámicos, núcleo de reservas) | 287 OK |
| Mutaciones de C: sin cada uno de los 4 triggers, con INSERT/DELETE reconcedidos, sin AUT-1 | cada una hace fallar la batería en el caso exacto |
| `test_historial_inmutable.sql` (E): las funciones insertan (trasladar, retirar, reintento idempotente, mover en los dos modos con D3-c); por tabla y por comando (UPDATE, DELETE con y sin WHERE, TRUNCATE, INSERT) capa de privilegio para 4 usuarios + anon + service_role; capa de trigger con todo concedido, con y sin la bandera; dueño y función DEFINER rechazados; mantenimiento y su auditoría; excepción de tramos (permitido, otra columna, segunda vez, a NULL, operación vieja, fila legado, roles de API); fallo a mitad y reintento | 203 OK |
| Mutaciones de E: sin cada uno de los 4 triggers, sin la excepción de tramos, con DELETE reconcedido | cada una falla en el caso exacto (con DELETE reconcedido, el borrado afecta 0 filas por la policy: no cuenta como prueba de la guarda, por eso la capa de trigger se prueba aparte) |
| Suites 194–197 + propuesta R1 en cuatro estados (C+E, solo E, solo C, sin ninguna) | 143 / 53–54 / 21 / 18 / 6 en todos |
| Concurrencia con C+E | 16 OK; limpieza con la salida de mantenimiento |
| `test_c0_aviso.sql` (C0) | 8 OK; C0 → 199 retira C0 y conserva la tabla |
| `test_barrera_vuelos.sh` (señales de barrera con transacciones reales) | flujos B: 0 señales; código viejo: las 8 firmas exactas |
| Postchecks 199/200 | todo `true` con la migración; `false` sin ella |
| Bloque C del preflight con un usuario sintético | 10 casos OK; 2 SIN_PRUEBA (la copia no tiene sillas con contrato) |

**Barrera B→C (antes de la 199).** Todas son obligatorias:
1. 192 a 197 aplicadas (postchecks propios) y código B integrado en `main`, con su hash anotado.
2. **Despliegue activo de Producción** = ese commit o posterior. En Vercel → Deployments → Production: estado *Ready*, asignado al dominio de producción y "Source" con el hash. Anotar el id y la hora de activación (`desde`). Desde la app no hay otra forma de verlo: no se expone el SHA.
3. Verificación funcional en Producción sobre P1/P1'/P2 (§6.5, punto 3).
4. `supabase/scripts/barrera_vuelos_c_e_lectura.sql` con `desde` = hora de activación, después de un ciclo operativo acordado (al menos un día con reservas, una confirmación por abono, una carga masiva y una corrida del cron): filas 10–15 y 20–22 en 0 (**RESUMEN B→C = SIN SEÑALES**). Las señales cuentan escrituras con sesión cuya pareja no está en la misma transacción. La fila 5 muestra el SQL sin sesión, para revisar a mano.
5. Opcional, C0 (`c0_aviso_guarda_escritura.sql`): cubre lo que la auditoría no distingue (cambios directos de estado o contrato). Tabla `vuelos_guarda_avisos` en 0 durante el ciclo.
6. **Previews:** hoy `main` y todas las ramas remotas (`docs/condiciones-pago-post-282`, `diagnostico-consecutivo-dtm`, `claude/peaceful-noether-713c7c`, `vuelos-empaquetados-editor-contrato`, `claude/modest-clarke-Ehftt`) tienen el código anterior a B, según las referencias locales al 2026-09-30. `saas-whitelabel` usa otra base. `white-label`: confirmar su base. Antes de C: rebasar sobre B o volver a desplegar esas ramas, o aceptar por escrito que sus Preview no operarán vuelos, y no validar nada en ellos. Lista de PR abiertos: revisar en GitHub (`gh` no está instalado aquí).
7. Plan de reversión acordado (abajo).

Después de la 199: `postcheck_199_…` en `true` y bloque C del preflight con aprobación (prohibidos RECHAZADA, permitidos OK). Luego smoke: una reserva, una confirmación por abono, una carga masiva, la siguiente corrida de `liberar-vencidas` y la barrera otra vez (fila 2 = 1).

**Barrera previa a E (antes de la 200), separada de la anterior:**
1. Despliegue activo de Producción ≥ B (igual que el punto 2) y Previews resueltos (punto 6). C no es requisito técnico de E, pero el orden recomendado es C → E.
2. `barrera_vuelos_c_e_lectura.sql`: filas 20–22 en 0 (**RESUMEN previo a E = SIN SEÑALES**) desde `desde`: sin historial borrado, editado (salvo tramos) ni insertado sin operación.
3. P1/P1' con su historial: es permanente. Una vez activa E no se puede limpiar sin mantenimiento.

Después de la 200: `postcheck_200_…` en `true` (repetirlo más tarde: el conteo de historial no debe bajar), y un traslado y un mover con contrato en P1/P1' (comprueban la inserción y la excepción de tramos).

**Reversión antes de retroceder Vercel.** Si hay que volver a un despliegue anterior a B: **1)** `rollback_200_historial_vuelos_inmutable.sql`, **2)** `rollback_199_cierre_escritura_directa.sql`, **3)** recién entonces retroceder Vercel. Ninguno de los dos toca datos. Verificación: los postchecks dan `false` y la barrera muestra las filas 2 y 3 en 0. Invertir el orden deja Producción sin poder crear, eliminar o mover en vuelos mientras dure el desfase. Si solo falla un escritor legítimo con C o E activas, se revierte únicamente esa migración.

#### 6.8.6 Auditoría de preparación para despliegue (2026-10-02, árbol de trabajo, solo local)

> Nada de esto se ejecutó en Producción. Las tareas 2 y 3 siguen incompletas.

**Ensayo en orden numérico.** En una base local desechable (`pf_secuencia`, clon de la copia registrada hasta la 182) se aplicaron 183 → 200 una por una, en orden y sin errores. Sobre esa base pasan las baterías de la 193 (50 OK), la 198 (TODO OK) y las de vuelos (143 / 54 / 21 / 18 / 287 / 203 / propuesta 6). Revertir 200 → 193 con sus rollbacks y reaplicar 193 → 200 también corre limpio, y los postchecks vuelven a verdadero. El postcheck de la 193 da un falso solo en local (fila 12): la copia no trae los privilegios de tabla de `service_role` ni siquiera antes de la secuencia; en Supabase real sí existen.

**Objetos.** 193 (B2B) y 198 (fechas) no tocan ningún objeto de 192/194–200, y ninguna de 194–200 usa `fecha_negocio()`: calculan la fecha de Bogotá en línea. En código sí hay acoplamiento: `lib/reservar/vencimiento.ts` y `lib/vuelos/compatibles.ts` importan `lib/fechaNegocio.ts`, que es del frente 198. Acordado con esa sesión: el archivo lo entrega ese frente y vuelos se integra después o se rebasea sobre él; el orden final lo decide el usuario. Archivos con cambios de dos frentes, que se separan por hunk y no por archivo: `contratos/actions.ts` (vuelos + fechas), `types/database.ts` (vuelos + B2B) y `package.json` (los tres).

**Artefactos nuevos:**
- `supabase/scripts/preflight_secuencia_192_200_lectura.sql` (solo lectura): indica qué migraciones de la secuencia están aplicadas, si hay huecos de orden y el siguiente paso. Comprueba además que las tres funciones que reemplaza la 196 estén en la versión previa conocida (o ya en la de la 196): la 196 no se protege sola y, ante una versión editada a mano, la pisaría. Probado con un caso simulado de versión desconocida (DETENER).
- `supabase/scripts/postcheck_192_197_vuelos_fase_b.sql` (solo lectura): enum, 29 funciones con su huella md5, DEFINER/INVOKER, `search_path`, privilegios por clase (válidos también con los privilegios por defecto de Supabase), `operaciones_vuelo` y las columnas e índices del historial. Da verdadero con las migraciones y 10 falsos sin ellas.

**Privilegios.** La copia local no tiene el privilegio por defecto de Supabase que da EXECUTE a `anon`, `authenticated` y `service_role` sobre funciones nuevas. Verificado en el texto: toda función nueva de 194–200 revoca explícitamente a `anon`, y las privadas también a `authenticated`. `service_role` puede conservar EXECUTE sobre las privadas en Producción; no amplía nada, porque ya tiene acceso total a las tablas. `eliminar_contrato` conserva su EXECUTE para PUBLIC heredado de la 060 (la 196 no lo cambia; el rol se valida dentro, desde la 117).

**Decisiones del usuario (2026-10-02):**
- **Opción B para C y E.** 199 y 200 son números **provisionales** y quedan **fuera del PR de código** hasta sus barreras. Si mientras tanto se aplica otra migración, antes de integrarlas se renumeran al siguiente par libre, se actualizan todas las referencias y se repiten las pruebas (procedimiento abajo). No se aplican migraciones fuera de orden ni se congelan otros frentes.
- **193 sin backfill** de `acceso_legacy_nombre`: lo decidió el frente 193. Ya no es un bloqueante, salvo evidencia nueva.
- **Código B2B aislado:** se despliega pronto tras ejecutar y verificar la 193, sin esperar a la 198.
- Los privilegios de `service_role` se comprueban en Producción (preflight, filas 350–351).
- **Pendientes explícitos, sin respuesta:** W7, R1, D5 y D6.

**Secuencia vigente** (cada migración en su propia ejecución; `preflight_secuencia_192_200_lectura.sql` antes de cada paso):

| Paso | Qué | Antes | Después |
|---|---|---|---|
| 0 | Confirmar que Producción tiene ≤191 | preflight: filas 190–191 en OK, sin DETENER | — |
| 1 | **192** sola | — | preflight: fila 192 en OK |
| 2 | **193** | `preflight_193`; preflight filas 350–351 (`service_role`) en OK | `postcheck_193` (incluida la fila 12, `service_role`) |
| 3 | **Código B2B aislado** (frente 193), pronto | — | lo verifica ese frente |
| 4 | **194, 195, 196, 197** | bloque A de `preflight_traslado_cupos_lectura.sql`; preflight filas 311–313 en OK | `postcheck_192_197_vuelos_fase_b` |
| 5 | **198** (frente fechas) | sus diagnósticos | su prueba |
| 6 | Código de fechas (trae `lib/fechaNegocio.ts`) | — | lo verifica ese frente |
| 7 | **Código de vuelos (fase B)**, después del de fechas o rebaseado sobre él | **W7 decidido** (con `diagnostico_w7` de Producción) | P1/P1'/P2 (§6.5) |
| 8 | Barrera B→C (§6.8.5) | ciclo operativo + `barrera_vuelos_c_e_lectura` + Vercel + Previews | — |
| 9 | **Migración C** (provisional 199; renumerar si hay otra posterior) | — | `postcheck_199` + bloque C del preflight |
| 10 | Barrera previa a E | `barrera_vuelos_c_e_lectura` filas 20–22 | — |
| 11 | **Migración E** (provisional 200; idem) | — | `postcheck_200` |

Los pasos 1, 2, 4 y 5 son compatibles con el código que hoy está en Producción, así que el SQL puede ir por delante de su código. La 197 solo agrega `confirmar_venta`, que el código viejo no llama: **W7 bloquea el paso 7, no la migración 197**. El orden numérico del SQL obliga a que la 198 espere a 194–197, pero estas no dependen de ningún código.

**Procedimiento de renumeración de C/E** (si otra migración ocupa 199/200 o una posterior se aplica antes):
1. Confirmar el siguiente par libre en la rama real (`ls supabase/migrations | sort | tail`).
2. Renombrar `20260601000199_cierre_escritura_directa_vuelos.sql`, `20260601000200_historial_vuelos_inmutable.sql`, `rollback_199_…`, `rollback_200_…`, `postcheck_199_…` y `postcheck_200_…`.
3. Actualizar las referencias de texto al número en:
   - las dos migraciones, sus rollbacks y postchecks;
   - `preflight_secuencia_192_200_lectura.sql` (etiquetas; la detección es por función, no por número);
   - `postcheck_192_197_vuelos_fase_b.sql` (filas INFO 50–51);
   - `barrera_vuelos_c_e_lectura.sql`, `c0_aviso_guarda_escritura.sql`, `c0_retirar_aviso.sql`;
   - `test_cierre_escritura_directa.sql`, `test_historial_inmutable.sql`, `test_c0_aviso.sql`, `test_barrera_vuelos.sh`;
   - los comentarios de `test_crear_eliminar_bloqueo.sql` y `test_traslado_concurrencia.sh`;
   - este diseño y `TASKS.md`.

   El código del PR ya no nombra el número (`vuelos/actions.ts` y `pruebas/cierreEscrituraVuelos.wiring.test.ts` dicen "fase C/E").
4. Los cuerpos de función no contienen el número: los md5 de los postchecks no cambian.
5. Repetir: secuencia en orden sobre una base desechable, las baterías de C y E y las de 194–197, concurrencia, C0, barrera y postchecks.

**GO de la 192 — qué falta exactamente:**
1. **Preflight en Producción** (solo lectura, lo ejecuta el usuario): `preflight_secuencia_192_200_lectura.sql` con filas 190–191 en OK, fila 192 en PENDIENTE, 300 y 330 en OK y ningún DETENER. Las filas 311–313 y 350–351 no condicionan la 192.
2. **Aceptar que es irreversible:** Postgres no permite quitar un valor de un enum. El valor `retirada` queda inerte hasta el paso 7: ninguna fila lo usa y el código actual no lo escribe.
3. **Ejecutarla sola**, en su propia ejecución del editor SQL (no junto a la 193 ni a la 194).
4. **Verificar después:** fila 192 en OK.

Nada más bloquea la 192: W7, R1, D5 y D6 afectan pasos posteriores. En Git (fuera de esta ronda): el archivo de la 192 está sin versionar y debería entrar a `main` no después del de la 193, para que el repositorio no quede con un hueco. Por ejemplo, en el mismo PR del B2B o en uno propio.

**Pruebas que siguen faltando** (no se pueden hacer en local): todo lo de Producción (preflights A/B/C, diagnósticos R1/R2 y W7, barreras, P1/P1'/P2, postchecks); una corrida de las baterías con los privilegios reales de Supabase (la copia local los simula dentro de cada transacción; no existe una base de staging separada, tarea 19); y un smoke de las acciones TS contra una base real (las pruebas de React usan dobles).

### 6.6 Auditoría de `moverPasajeroSilla` tras la fase inicial

La fase inicial oculta "Mover" en sillas libres (`PasajeroAcciones`, prop obligatoria `libre`). **Eso es solo interfaz, no una protección del servidor:**

- `moverPasajeroSilla` (`app/(dashboard)/dashboard/vuelos/actions.ts:633`) es una Server Action exportada de un archivo `"use server"`: cualquier usuario con sesión puede invocarla directamente con cualquier `sillaId` y cualquier record destino.
- La acción **no** comprueba rol, agencia, estado de la silla ni si está libre. Solo la frena la RLS, que la deja pasar a cualquier rol de vuelos de cualquier agencia (§6.5).
- **Comprobado ejecutando la acción real** contra un cliente simulado, con una silla libre (la que la interfaz ya no ofrece mover): devuelve `{ ok: true }`, **inserta una fila nueva** en `sillas` del destino (siguiente número, `disponible`, vacía), deja la de origen igual y no toca `cupos_total` de ningún record. Resultado: **una silla de más** en el sistema.
- Con una silla ocupada ocurre lo mismo (§2): se crea una silla en el destino y la de origen queda libre sin descontarse, además del problema con `contrato_manual`. **Cada uso de "Mover" hoy suma una silla**, visible luego en el preflight §3 (`cupos_total ≠ filas activas`) y en la fila "movimientos de mover pasajero" del §2.
- Aparte de la acción, la escritura directa por la API (§6.5, T6) también permite insertar sillas. Ninguna de las dos vías se cierra hasta las fases A–C.

> **Actualización (implementación 194, en el árbol de trabajo):** `moverPasajeroSilla` ya no inserta nada: valida el modo (solo `solo_datos` o `con_cupo`, sin valor por defecto) y llama a `mover_pasajero`, que rechaza sillas libres, valida rol, agencia, contrato, compatibilidad y cupos dentro de una transacción. Llamarla directamente ya no salta ninguna regla. La escritura directa por la API (T6) sigue abierta hasta la fase C.

**Recomendación sobre publicar la fase inicial** (no se cambia la operación diaria sin aprobación):

| Opción | Efecto | Recomendación |
|---|---|---|
| Publicar la fase inicial tal cual | Estadísticas correctas y fin del choque del CHECK al liberar pasajero. El botón oculto evita el error accidental más obvio, **sin** cerrar la acción | **Sí, publicarla.** El agujero del servidor ya existe hoy en Producción con o sin esta fase; retenerla solo retrasa dos correcciones reales |
| Guardarla sin publicar hasta el traslado atómico | Nada mejora mientras tanto | No: no reduce ningún riesgo |
| Guarda mínima en el servidor: `moverPasajeroSilla` rechaza sillas libres (y sillas `cambio`) | Cierra el caso "silla vacía" también por invocación directa. No afecta la operación diaria (nadie mueve legítimamente una silla vacía). Requiere aprobación porque cambia la acción | **Recomendada** como siguiente paso pequeño, con aprobación |
| Deshabilitar "Mover" por completo hasta el traslado atómico (interfaz + rechazo en servidor) | Deja de sumar sillas en cada uso, pero **cambia la operación diaria**: hasta entonces habría que borrar el pasajero en Y y cargarlo a mano en una silla libre de X | Decidir con datos: ejecutar el preflight §2 en Producción para ver cuántos "movimientos de mover pasajero" hay. Si es frecuente, conviene priorizar la función atómica antes que deshabilitar |

### 6.7 Matriz de cambios manuales de estado (DIR-1, aprobada)

Aprobada por el usuario el 2026-09-30 con una corrección: **`Devuelta` es terminal**. Nunca vuelve manualmente a `Disponible` ni a `No vendida`. **`No vendida → Devuelta`** solo se usa para registrar una **devolución real** a la aerolínea. Las demás transiciones quedan como se propusieron. **Implementada** en `cambiar_estado_silla` (194) y reflejada en la interfaz (`transicionesManuales`, `SillaEstado.tsx`); "sin contrato ni pasajero" usa el mismo criterio que `_silla_libre` (nombres, apellidos, tipo y número de documento, nacimiento).

La hará la función `cambiar_estado_silla` (§6.5). La matriz se valida **en el servidor**, no solo en la interfaz, y en todas las transiciones se pide un motivo, que queda en `bloqueo_cambios`. `cambio_entrante` se trata igual que `disponible`. Solo aplica a sillas **sin contrato ni pasajero**; con contrato se usan las acciones del contrato, con la autorización de AUT-1b.

| Desde → Hacia | Manual | Ejemplo | Si no, usar… |
|---|---|---|---|
| Disponible → No vendida | **Sí** | Cerró el vuelo y quedaron 3 cupos sin vender | — |
| Disponible → Devuelta | **Sí** | Se devuelven 2 cupos a la aerolínea antes de la fecha límite | — |
| No vendida → Devuelta | **Sí, solo si es una devolución real** (el formulario lo confirma explícitamente) | Esos cupos no vendidos se devolvieron de verdad a la aerolínea | — |
| No vendida → Disponible | **Sí** | Se marcó "no vendida" por error y el cupo sigue a la venta | — |
| **Devuelta → cualquier estado** | **No, nunca (terminal)** | Un cupo devuelto no vuelve al inventario | — |
| Disponible → En plazo o Confirmada | No | Venta a un cliente | Reservar, o "Asignar contrato manual" para una venta externa |
| En plazo → Confirmada | No | El cliente pagó | "Confirmar venta" del contrato o su abono |
| En plazo o Confirmada → Disponible | No | El cliente desistió | "Liberar silla" o eliminar el contrato |
| Confirmada → En plazo | No | — | — |
| Cualquiera → Retirada | No | Reducir cupos | "Retirar cupo" (solo desde una silla libre, con historial) |
| Retirada o Cambio → cualquiera | No, nunca | — | Son historial |

Consecuencias:
- Una silla `devuelta` sigue siendo una fila del record y cuenta en su total (como hoy), pero no se puede vender, retirar ni volver atrás.
- Corregir una devolución registrada por error no se hace con un cambio de estado. Requeriría una operación aparte, con historial, que hoy no existe ni se propone.

## 7. Interfaz para mover un pasajero

1. Elegir record destino X (lista filtrada por la regla de compatibilidad, D4).
2. Aparecen **dos opciones, ninguna preseleccionada**, cada una con la vista previa de sus números:
   - "Usar cupo disponible en X (solo datos)" — Y 8→8 · X 8→8. Si X no tiene cupo libre real, la opción se muestra **deshabilitada con el motivo**, sin seleccionar la otra.
   - "Trasladar el cupo de Y a X (datos + cupo)" — Y 8→7 · X 8→9.
3. Si se elige A: selector de la silla libre de X (D6).
4. El botón de confirmar queda deshabilitado hasta elegir. El número de contrato del pasajero se muestra en el modal.
5. El servidor revalida todo; la vista previa es solo informativa.

"Mover" no se ofrece en sillas libres.

## 8. Trazabilidad del contrato

- Cada movimiento guarda `numero_contrato`/`contrato_manual` y el estado en el historial, independiente de lo que pase después con la silla.
- Tras mover, el contrato sigue ligado a sus sillas (A: por copia a la silla de X; B: la misma fila).
- `ventas.bloqueo_ref_id` y `contrato_vuelos.record` se ajustan según D2/D3; si no se ajustan automáticamente, la ficha del contrato debe avisar que el PNR del contrato difiere del record donde viaja el pasajero.
- Costo aéreo y CxP: ver D4b.

### 8.1 D3 con un contrato de ejemplo

> **DECIDIDO (2026-10-01): D3-c, solo para sillas con `numero_contrato`.** Implementado en `mover_pasajero` (194), probado en local; detalle en §8.2. La tabla siguiente es el estado **anterior** que motivó la decisión (antes de D3-c).

`supabase/scripts/demo_d3_contrato_movido.sql` (solo local, termina en ROLLBACK) crea el contrato DTM-9970 con la misma forma que deja la reserva (2 pax en Y, tramos de `contrato_vuelos` copiados de Y, `ventas.fecha_salida/fecha_regreso`, `costo_aereo` = tarifa neta × pax, CxP aérea, hotel con las fechas del vuelo), lo mueve **con su cupo** a X (misma ruta, proveedor y tarifa; **otra fecha**, otros vuelos y horas) y compara. Resultado real:

| Campo | Y (origen) | X (donde viajan) | Contrato hoy | Estado |
|---|---|---|---|---|
| Sillas del contrato | D3YYY1 | D3XXX1 | D3XXX1 | ya en X |
| `ventas.bloqueo_ref_id` | Y | X | X | ya en X (D2) |
| `contrato_vuelos.record` (PNR del documento) | D3YYY1 | D3XXX1 | D3YYY1 | **sigue en Y** |
| Ida: vuelo / fecha / hora | AV9301 / +40 días / 06:00 | AV9451 / +47 días / 10:30 | AV9301 / +40 / 06:00 | **sigue en Y** |
| Regreso: vuelo / fecha | AV9302 / +44 días | AV9452 / +51 días | AV9302 / +44 | **sigue en Y** |
| `ventas.fecha_salida / fecha_regreso` | +40 / +44 | +47 / +51 | +40 / +44 | **sigue en Y** |
| `contrato_hoteles` ingreso / salida | +40 / +44 | +47 / +51 | +40 / +44 | **sigue en Y** |
| `ventas.costo_aereo`, CxP aérea | 800.000 | 800.000 | 800.000 | igual (misma tarifa) |

Es decir: el inventario ya dice X, pero **el documento que recibe el cliente** (PNR, vuelos, horas, fechas) y las fechas del hotel siguen diciendo Y. Con tarifa distinta, además, el costo y la CxP quedarían con la tarifa de Y (D4b aprobada: sin recálculo).

Hallazgo que afecta a D4: D4 aprobado permite mover a un record del mismo destino y proveedor **con otra fecha**. En ese caso no solo cambia el vuelo: cambian las noches de hotel (y quizá la temporada y el precio del hotel), lo que ya no es un ajuste de inventario.

Opciones (no se implementa ninguna sin decisión):

| Opción | Qué haría `mover_pasajero` | Ventaja | Riesgo |
|---|---|---|---|
| **D3-a** (hoy) | Solo aviso; el operador corrige el vuelo en el editor del contrato (157, con su historial) | No toca documentos legales sin revisión | El cliente puede recibir un documento con el vuelo equivocado si nadie corrige |
| **D3-b** | En la misma transacción, reescribir **solo** los tramos de `contrato_vuelos` cuyo `record` = Y con record, vuelo, horas y fechas de X, y `ventas.fecha_salida/fecha_regreso`; dejar hotel e importes | Documento coherente con el vuelo | Si las fechas cambian, el hotel queda desfasado sin aviso fuerte |
| **D3-c** | Restringir D4: X debe tener la **misma fecha de ida y regreso** que Y; con eso aplicar D3-b sin tocar hotel | Cambio de vuelo/PNR sin efectos en hotel ni temporada | Un "cambio de fecha" ya no se puede hacer con Mover: se hace anulando y reservando |
| **D3-d** | D3-b + bloquear mover si cambia la fecha y el contrato tiene hotel, hasta ajustar el hotel a mano | Coherente y explícito | Más pasos para el operador |

Importes con tarifa distinta (hoy: sin recálculo, D4b): mantener; recalcular `costo_aereo` y la CxP aérea si **no** tiene pagos; o registrar un ajuste aparte. Requiere decisión; no se cambia nada.

### 8.2 D3-c implementado (2026-10-01)

**Camino orgánico** (la silla tiene `numero_contrato`, que es FK a `ventas`). Antes de escribir nada, `mover_pasajero` exige, y si no se cumple rechaza sin cambiar nada:
1. Misma `fecha_ida` y misma `fecha_regreso` en X que en Y (comparación con nulos). Así las fechas de `ventas` y del hotel siguen siendo correctas.
2. `ventas.bloqueo_ref_id` nulo, Y o X (si apunta a un tercer record, el contrato está incoherente).
3. Tramos del contrato (bloqueados en la misma transacción, después de la venta, el mismo orden que el editor 157):
   - si el contrato tiene tramos y **ninguno** es del record Y → rechazo (no se sabe cuál actualizar; corregir en el editor de vuelos);
   - un tramo de Y sin dirección `ida`/`regreso` que no sea una fila heredada ida+regreso → rechazo (ambiguo);
   - si hay tramos de Y: misma ruta (sin espacios, sin distinguir mayúsculas) y misma aerolínea en X; si no → rechazo.

Luego, en la misma transacción que mueve las sillas: `ventas.bloqueo_ref_id` pasa a X (D2) y **solo** los tramos cuyo `record` es Y pasan a X: `record`, `numero_vuelo`, `hora_salida`, `hora_llegada` según la dirección (filas nuevas, migración 135), o `vuelo_ida/vuelo_regreso` y sus horas (filas heredadas ida+regreso). Los tramos de otros records (conexiones) no se tocan. Si el número de filas actualizadas no coincide con el contado, se revierte todo. El historial guarda `tramos_contrato_actualizados`; la auditoría (087) registra el cambio de cada tramo con el actor. **Importes sin cambios** (`costo_aereo`, CxP, `precio_venta`).

**Bordes (2026-10-01):**
- **Venta con `bloqueo_ref_id = NULL`** (contratos anteriores al vínculo durable): se **vincula a X** en la misma transacción. Es compatible con `ventas_origen_excluyente_check` (solo prohíbe `bloqueo_ref_id` y `empaquetado_ref_id` a la vez) y coincide con lo que ya haría el núcleo 167, que sin vínculo descubre el bloqueo por las sillas (tras mover, todas en X). Si la venta tiene `empaquetado_ref_id`, vincularla violaría el CHECK y dejarla nula no se admite: se **rechaza antes de mover**. El `UPDATE` de `ventas` se comprueba (exactamente 1 fila y el valor releído = X); si no, se revierte todo. La respuesta incluye `vinculo_anterior` (null = vínculo creado en este movimiento).
- **Datos de vuelo de X:** antes de reescribir, por cada dirección que usan los tramos de Y (`ida`, `regreso`; en una fila heredada, la parte que tiene datos), X debe tener número de vuelo, hora de salida y hora de llegada. Si falta alguno, falla cerrado sin tocar nada. En una fila heredada solo se reescribe la parte que la fila usa; la otra queda igual.

**Camino manual** (la silla usa `contrato_manual`, aunque el texto resuelva a una venta): sin exigir fechas iguales; no se toca `ventas` ni `contrato_vuelos`; la referencia manual viaja tal cual y se mantiene la autorización AUT-2 (un rol de mayorista no mueve un manual que resuelve a una venta minorista; superadmin sí). Si la venta resuelta tiene tramos del record de origen, solo se avisa.

**Interfaz.** `PasajeroAcciones` recibe `contratoOrganico` (obligatoria): con contrato del sistema, los records con otras fechas aparecen deshabilitados y se explica la regla; al terminar informa cuántos tramos del vuelo se actualizaron. Con contrato manual se ofrecen todos los compatibles.

**Pruebas.** `test_traslado_sillas.sql`, sección D3-c: orgánico en ambos modos a otras fechas (rechazado, nada cambia), a las mismas fechas (tramos ida/regreso y fila heredada actualizados, conexión intacta, vínculo y fechas coherentes, importes iguales, historial, reintento `repetida`), sin tramos, tramos solo de otro record, tramo sin dirección, otra ruta, otra aerolínea, venta vinculada a un tercer record; manual externo, resuelto a mayorista y resuelto a minorista en ambos modos a otras fechas (permitido, `ventas` y `contrato_vuelos` idénticos byte a byte, referencia conservada, aviso solo si la venta resuelta tenía tramos del origen) y autorización AUT-2 vigente. Bordes: vínculo NULL en ambos modos (vinculado a X), vínculo NULL con empaquetado (rechazado en ambos modos, nada cambia), X sin vuelo de regreso o sin hora de llegada de ida (rechazo sin borrar), tramo solo de ida y fila heredada solo de ida (permitidos, la parte no usada intacta), rollback con falla forzada al reescribir tramos (vínculo vuelve a NULL, sillas, cupos, tramos, historial y operación intactos; el reintento con la misma operación se aplica una vez), `UPDATE` de ventas sin efecto (detectado, todo revertido) y contrato manual con venta de vínculo NULL hacia records con vuelo incompleto (permitido; `ventas` y `contrato_vuelos` idénticos). Demostración: `demo_d3_contrato_movido.sql`.

## 9. Decisiones indispensables

**Aprobadas por el usuario (2026-09-30):**

| # | Decisión aprobada |
|---|---|
| AUT-1 | Solo Mayorista y superadmin operan vuelos |
| AUT-1b + DIR-2 | Mover **o editar** una silla con contrato de Minorista exige permiso sobre ese contrato (`acceso_editar_vuelos_contrato`, tenant del contrato) |
| D1 | No se reparten contratos entre records: las sillas de un contrato se mueven juntas |
| D4 | El record destino debe tener el **mismo destino** y **no haber salido** |
| D4b | **Proveedor diferente bloquea**; **tarifa diferente** muestra advertencia, sin recálculo automático |
| D8 | El retiro de cupos usa el estado `retirada` |

| DIR-1 | Matriz de cambios manuales de estado (§6.7), con la corrección del usuario: `Devuelta` es terminal y `No vendida → Devuelta` solo registra una devolución real |

Pendiente de decisión: publicar la fase inicial y, con aprobación, la guarda mínima o la desactivación de "Mover" (§6.6). El resto de filas sin marca son decisiones técnicas con recomendación.

| # | Decisión | Opciones | Recomendación |
|---|---|---|---|
| **D1** | **Contratos repartidos** en dos records | (a) Prohibir: mover a un pasajero solo si es el único del contrato en Y, o mover a todo el contrato junto. (b) Permitir, marcando el contrato como multi-record | **APROBADA (a).** La edición de pasajeros (`_ajustar_sillas_nucleo`, 167) asume un solo record por contrato. Consecuencia: `mover_pasajero` mueve todas las sillas del contrato en Y juntas (§6.2) |
| **D2** | `ventas.bloqueo_ref_id` tras mover | Actualizar si todas las sillas del contrato quedan en X; no tocar si quedan repartidas | Actualizar en el mismo movimiento (con D1-a siempre aplica) |
| **D3** | `contrato_vuelos.record`/vuelo del contrato | Actualizar en la misma transacción; o dejarlo y mostrar un aviso | **APROBADA D3-c (2026-10-01), solo con `numero_contrato`:** mismas fechas de ida y regreso y tramos de Y reescritos con X en la misma transacción; rechazo si no quedan coherentes. Con `contrato_manual`: sin exigir fechas ni tocar `ventas`/`contrato_vuelos` (§8.2) |
| **D4** | **Compatibilidad entre records** | Exigir mismo `destino_id`; misma `ruta`; mismas fechas de ida/regreso; misma aerolínea/proveedor; destino no salido (`fecha_ida ≥ hoy`) | **APROBADA:** mismo `destino_id` y X no salido (`fecha_ida ≥ hoy`, hora de Colombia). Otras diferencias (fechas, ruta) no bloquean y se muestran como dato; el proveedor se rige por D4b. El preflight §6 muestra qué reglas habrían roto los movimientos reales |
| **D4b** | Costo aéreo y CxP cuando X tiene otra tarifa neta o proveedor | Bloquear; permitir con aviso sin recalcular; recalcular costo y CxP | **APROBADA:** `proveedor_id` distinto bloquea. `tarifa_neta` distinta no bloquea: la interfaz muestra la advertencia y la función exige `p_acepta_tarifa_distinta = true`; el `costo_aereo` y la CxP del contrato **no** se recalculan |
| D5 | Estados que se pueden mover | `en_plazo` y `confirmada`; ¿también `disponible` con datos de pasajero sin contrato (carga masiva)? | **Implementado (pendiente de confirmar):** cualquier silla ocupada (contrato, manual o datos de pasajero) en `disponible`/`cambio_entrante`/`en_plazo`/`confirmada`. Se incluyen las de carga masiva porque quedan `disponible` con datos y sin contrato: excluirlas dejaría a esos pasajeros sin forma de moverse. `devuelta`, `no_vendida`, `cambio` y `retirada` no se mueven |
| D6 | Silla destino en modo A | La elige el operador; la primera libre por número | **Implementado (pendiente de confirmar):** la primera libre real por número, sin selector. Agregar el selector es aditivo (un parámetro más) |
| D7 | Estado de las sillas trasladadas y del legado `cambio_entrante` | Quedan `disponible`; se conserva `cambio_entrante` | `disponible` (el origen se ve en el historial) |
| **D8** | **Mecanismo** para retirar un cupo (reemplaza el borrado físico de `eliminarCupo`) | (a) Nuevo estado `retirada` (§4.4b). (b) Reutilizar `devuelta`. (c) Columna `retirada_en` sin cambiar el estado | (a). (b) mezcla un estado comercial que hoy cuenta en el total. (c) deja la silla `disponible` y la reserva (167) la seguiría vendiendo salvo que se cambie su núcleo. **APROBADA (2026-09-30): retirar cupos sí está permitido, mediante el estado `retirada` (a).** |
| D9 | `SECURITY DEFINER` vs `INVOKER` | DEFINER permite que el historial solo se escriba por la función | DEFINER con candado de rol explícito |
| D9b | Qué sillas libres salen en un traslado | Números más altos; más bajos | Más altos (se conservan los números bajos del origen) |
| D10 | Documento del pasajero en el historial | Copiarlo; no copiarlo | No copiarlo; basta el contrato y la silla |
| D11 | `eliminarBloqueo` con historial | Bloquear con mensaje; permitir borrando historial | Bloquear |
| D12 | Quién lee el historial | Solo roles de vuelos; también quien ve el contrato | Solo roles de vuelos por ahora |
| D13 | Lectura de `sillas` por `venta` | Quitar `venta` de la policy (migración aparte); mantener | Decidir con el resultado del bloque B del preflight en producción; fuera del alcance de estas tareas |
| **AUT-1** | Agencia del actor para operar records (`bloqueos_vuelo`/`sillas` no tienen tenant) | (a) Solo superadmin o usuarios de mayorista. (b) Cualquier agencia, como la RLS actual | **APROBADA (a).** Vuelos ya está oculto para minorista en la interfaz; es más estricto que la RLS de hoy, que por la API sí se lo permite (se cierra en la fase C) |
| **AUT-1b** | Contrato de otra agencia en un record | (a) `acceso_editar_vuelos_contrato` estricto: solo superadmin mueve el pasajero de un contrato minorista. (b) Cualquier rol de vuelos de mayorista, aunque escriba `bloqueo_ref_id` de un contrato minorista | **APROBADA (a).** Misma regla que el editor de vuelos del contrato (157). Consecuencia: control_vuelo de mayorista no mueve ni edita a un pasajero de contrato minorista; superadmin sí |
| **AUT-2** | Sillas con `contrato_manual` (texto, sin FK; a veces es una venta minorista sin prefijo) | (a) Solo A1–A3. (b) Resolución inequívoca de §6.0.4 con autorización por el tenant de la venta resuelta, externo genuino con A1–A3 y ambiguo cerrado | **(b)** (pedido explícito). La opción (a) permitiría que un rol de mayorista mueva a un pasajero de una venta minorista solo porque la referencia está escrita sin prefijo |
| AUT-2b | Manual resuelto a una venta interna: ¿actualizar su vínculo con el record? | No tocar `bloqueo_ref_id` (el manual no lo usa); convertir el manual en orgánico | No tocar. Convertirlo cambia el modelo del contrato y va aparte |
| AUT-2c | Referencias que solo casan ignorando mayúsculas | Tratarlas como externas (igual que la app); tratarlas como ambiguas y bloquear | Decidir con el conteo del preflight §5b; si es 0, no hace falta decidir |
| **IDEM-1** | `lock_timeout` de la segunda solicitud simultánea | 3 s; 5 s; sin límite (espera hasta el `statement_timeout` de Supabase) | 5 s y mensaje "Operación en curso; reintenta" |
| IDEM-2 | ¿El motivo forma parte de la huella? | Sí (otro motivo = otra operación → error); no | No: corregir el texto del motivo en un reintento no debe fallar |
| D14 | Quién puede cambiar las columnas E/V de `sillas` y `cupos_total` | Solo las funciones; también `service_role` | Fase C: solo funciones y `service_role`; fase D: solo funciones (§6.5) |
| **DIR-1** | Cambios manuales de estado de una silla que operaciones puede hacer sin reserva de por medio (hoy `cambiarEstadoSilla`, sin reglas) | Lista de transiciones permitidas; p. ej. `devuelta` y `no_vendida` solo desde una silla libre; `confirmada`/`en_plazo` solo con contrato; `disponible` solo liberando el contrato | **APROBADA (2026-09-30)**, con la corrección del usuario: matriz de §6.7. `Devuelta` es terminal; `No vendida → Devuelta` solo para una devolución real. Se valida en el servidor (`cambiar_estado_silla`); implementada en la 194 |
| **DIR-2** | ¿Quién puede editar los datos del pasajero (grupo D) de una silla cuyo contrato es de la otra agencia? | Cualquier rol de vuelos, como hoy; solo quien tenga permiso sobre ese contrato (misma regla que D1) | **APROBADA:** misma regla que AUT-1b. Diseño: en sillas **con** contrato los datos se editan solo por la función `editar_pasajero_silla` (autoriza el contrato, §6.0.4 para manuales); la edición directa del grupo D queda para sillas **sin** contrato (§6.5). Hoy un control_vuelo de mayorista todavía puede editar documento y nacimiento de un pasajero minorista |

## 10. Preflight de solo lectura

`supabase/scripts/preflight_traslado_cupos_lectura.sql`

- **Bloque A:** una sola sentencia `SELECT` (no crea ni escribe nada, tampoco tablas temporales). Devuelve `seccion · control · estado · valor · detalle` en 7 secciones: contexto, RLS y lectura, legado `cambio`/`cambio_entrante`, consistencia de cupos, libres reales/residuos, contratos repartidos/trazabilidad y compatibilidad histórica. Solo conteos, ids, records y hasta 10 números de contrato de muestra.
- **Estático vs efectivo.** Las filas de acceso del bloque A (`[estático] …`) clasifican cada policy PERMISSIVE aplicable (`public`/`authenticated`/`anon`) como **amplia** (`USING` ausente o `true` → SÍ), **lista de roles** reconocida (`mi_rol() = ANY (ARRAY[…])` o `mi_rol() = '…'` → SÍ si el rol está) o **no reconocida** (→ INDETERMINADO). RLS desactivada → SÍ. **Nunca devuelven OK**: lo más favorable es "SIN HALLAZGO ESTÁTICO" (INFO). Las policies para otros roles de base de datos (p. ej. `service_role`) no aplican.
- **Bloque B (opcional):** lectura **efectiva** de `sillas` y `movimientos_silla` haciéndose pasar por el primer usuario `venta` activo, en transacción READ ONLY con ROLLBACK. Solo conteos. Es la **única** fuente de OK sobre acceso, y solo para ese usuario: `SIN_PRUEBA` si no hay usuario `venta` activo o la tabla está vacía (un 0 visible no probaría nada), `REVISAR` si ve filas, `OK` solo si el rol efectivo es `venta`, la tabla tiene filas y no ve ninguna.
- **Validado solo en la base LOCAL de Docker** (Postgres 15.8, migraciones hasta la 182), en transacción de solo lectura con ROLLBACK:
  - Con los datos locales: 43 controles; REVISAR en historial mutable, índice único ausente, lectura de `venta` y `security_invoker` (la 186 no está en local).
  - Con un escenario legado sintético (sembrado y revertido): se dispararon todos los REVISAR esperados — filas `cambio`, silla extra de mover pasajero, `cupos_total ≠ filas`, número repetido, libre con `contrato_manual`, contrato repartido, `bloqueo_ref_id` desalineado.
  - Clasificación estática con policies sintéticas (cada caso en transacción revertida): policies actuales → `venta` SÍ (lista de roles); `USING (true)` → SÍ también para visitantes; solo una expresión no reconocida → INDETERMINADO; `USING (true)` solo para `service_role` → no aplica; RLS desactivada en el historial → SÍ. Ningún caso produjo OK.
  - Bloque B: sin usuario `venta` → `SIN_PRUEBA` (antes habría parecido un 0 seguro); `venta` con la policy actual → `REVISAR` (133 de 133 visibles); `venta` excluido por la policy → `OK`; tablas vacías → `SIN_PRUEBA`.
  - Duplicado legado oculto (una silla `cambio` y una activa con el mismo número en un record): la comprobación anterior daba OK con 0; la nueva da REVISAR con 1, y `create unique index … (bloqueo_id, numero_silla)` falla por esa misma clave. Sin el duplicado, la comprobación da 0 y el índice se crea.
  - Rol con solo DELETE en `movimientos_silla` (sin privilegio UPDATE y una policy solo de DELETE para `control_vuelo`): el análisis anterior, que combinaba UPDATE y DELETE, decía "SIN HALLAZGO"; el nuevo dice UPDATE sin hallazgo y DELETE **SÍ**. Prueba efectiva con un usuario `control_vuelo` sintético: UPDATE → `permission denied`; `DELETE` sin `WHERE` → borró las 2 filas del historial.
  - Todas las pruebas de esta ronda se revirtieron (base local intacta: 133 sillas, 0 movimientos, sin índice, policies y privilegios originales).
  - Escritura directa (§6.5): T1–T10 permitidos a control_vuelo de mayorista y a operaciones de minorista; T11–T13 sin efecto para `venta`. El preflight §1 los refleja: INSERT/UPDATE/DELETE de `sillas` y de `bloqueos_vuelo` "SÍ", columnas protegidas escribibles (todas), `cupos_total` escribible y guardas ausentes.
  - Guarda por `current_user`: trigger INVOKER ve `authenticated` en escritura directa (bloquea) y `postgres` dentro de una función `SECURITY DEFINER` (deja pasar); un trigger DEFINER ve siempre al dueño.
  - Privilegio concedido vs rechazo efectivo (preflight A y bloque C, usuario `control_vuelo` sintético, cada escenario revertido):
    - **S1, hoy:** UPDATE de columnas protegidas concedido; INSERT/DELETE `t/t`; guardas ausentes. Bloque C: los 9 casos prohibidos **PROSPERÓ → REVISAR**.
    - **S2, prototipo correcto** (`revoke insert, delete` + triggers INVOKER con 42501 `GUARDA_ESCRITURA`): UPDATE de columnas protegidas **sigue concedido** (INFO), INSERT/DELETE `f/f`, guardas **INDETERMINADO** (bien formadas). Bloque C: 7 casos rechazados por la guarda y 2 por privilegio (INSERT/DELETE) → **OK**; los 2 permitidos (grupo D, columna libre del record) **OK**. Esta es la razón de separar privilegio y prueba efectiva: con las guardas activas `has_column_privilege` sigue siendo true.
    - **S3, guarda mal hecha** (función del trigger `SECURITY DEFINER`): preflight A **REVISAR** ("vería siempre al dueño"); bloque C: los 9 prohibidos **PROSPERÓ → REVISAR**.
    - **S4, sin usuario de vuelos que suplantar:** bloque C todo **SIN_PRUEBA**, nunca OK.
    - **Repetido tras aprobar DIR-2 (caso 12: editar datos de una silla con contrato):** S1 prospera → REVISAR; S2 (prototipo con la regla DIR-2) **rechazado por la guarda → OK**, mientras la edición de datos en una silla sin contrato (caso 10) sigue permitida; S3 prospera → REVISAR; S4 SIN_PRUEBA.
  - `contrato_manual` con espacios: el preflight anterior (btrim) clasificaba como externas las 4 variantes con tab/LF/CRLF/NBSP/BOM alrededor de `00-0541`; el nuevo las agrupa como una referencia interna minorista (igual que la app), marca como **no admitidas** 2 con tab o NBSP interno y como **vacía** 1 con solo espacios; "VENTA EXTERNA 123" sigue externa.
- **No se ha ejecutado contra la base remota.**

Cómo leerlo: REVISAR en §2–§5b son datos que la migración debe respetar (no se corrigen solos). Mientras `records con cupos_total ≠ filas activas` o `numero_silla repetido (todas las filas, = índice)` no estén en 0, la comprobación I1 y el índice único fallarían sobre esos records: decidir primero cómo se sanean. Las referencias manuales ambiguas no impiden migrar, pero esas sillas no se podrán mover hasta corregirlas.

## 11. Pruebas propuestas

**SQL (Postgres local desechable, patrón `test_control_bloqueo_atomico.sql`):**
- Ejemplo de §3 exacto para las tres operaciones: conteos de filas y `cupos_total` antes/después, historial esperado.
- A sin cupo libre real en X → excepción y **ningún** cambio (ni filas, ni cupos, ni historial); A nunca inserta filas.
- B siempre ajusta Y−1/X+1 y no crea filas.
- Contrato manual: viaja en A y B; la silla de Y queda sin `contrato_manual`; una reserva posterior sobre esa silla no choca con el CHECK.
- Traslado de cupos con ocupadas en Y: nunca las toca; si no hay suficientes libres → excepción sin cambios.
- Fallo forzado del insert del historial (trigger de prueba) → rollback total.
- Inmutabilidad: UPDATE y DELETE **por separado** sobre `movimientos_silla` y `operaciones_vuelo`, como cada rol, como `service_role` y como dueño → rechazado. Incluye un `DELETE` sin `WHERE` de un rol con solo DELETE.
- `contrato_manual` (AUT-2): externo genuino → se mueve con A1–A3; referencia sin prefijo que casa con una venta minorista → exige permiso sobre esa venta (un rol de mayorista sin él falla, superadmin pasa); referencia con dos candidatas (`00-0541` y `MIN-00-0541`) → falla cerrado también para superadmin; se crea la segunda candidata entre la lectura y la escritura → `La silla cambió`; espacios sobrantes → se resuelve igual; solo mayúsculas distintas → según AUT-2c.
- Índice (I12): con una fila `cambio` y otra activa con el mismo número, la comprobación del preflight y la creación del índice fallan juntas; asignar número en un traslado nunca reutiliza el de una fila `cambio` o `retirada`.
- Escritura directa (I15), antes y después de la fase C, con los mismos usuarios sintéticos: T1–T10 permitidos antes y **rechazados** después; y un recorrido de escritores legítimos que debe seguir funcionando después: crear record (función), reservar (núcleo 167), confirmar por abono y por botón, `liberarVencidas`, copiar datos del pasajero (admin), editar datos del pasajero y carga masiva (grupo D).
- Columnas nuevas: prueba que falla si `sillas` tiene una columna fuera de los grupos E/V/D.
- Preflight bloque C en local con los cuatro escenarios (sin guardas, guardas correctas, guarda DEFINER, sin usuario) antes de proponer la migración C; en Producción, solo tras la barrera B→C y con aprobación.
- Recorte (I16): los 13 casos contra `trim()` real; asignar un contrato manual con tab interno o NBSP interno es rechazado; con espacios alrededor se guarda recortado.
- Roles: `venta`, `control_vuelo`, usuario inactivo.
- Idempotencia en serie: mismo `operacion_id` dos veces → una sola aplicación; la segunda devuelve `repetida`. Mismo id con otros parámetros u otro actor → `Operación inválida`.
- Idempotencia **simultánea** (dos sesiones con psql, patrón `test_164_concurrencia.sh`): S1 aplica y queda abierta; S2 con el mismo id espera; (i) S1 commit → S2 devuelve `repetida` y hay 1 sola operación; (ii) S1 rollback → S2 aplica una vez; (iii) S1 retenida más que `lock_timeout` → S2 falla con `Operación en curso` sin aplicar.
- Retiro: solo sillas libres reales; `cupos_total − 1`; la fila queda `retirada` con su historial; ninguna reserva ni carga masiva la toma después; cualquier `update` posterior a esa fila se rechaza.
- Guardas de `sillas` (I13): un `update` directo que cambie `bloqueo_id` o ponga `retirada`, como cada rol de vuelos y como `service_role`, se rechaza; los mismos cambios hechos por las funciones pasan.
- Autorización (matriz por función): sin sesión; cada rol (incluidos `venta` y un inactivo); actor minorista vs mayorista (AUT-1); contrato de la otra agencia (AUT-1b); record inexistente con el mismo mensaje que sin permiso; silla que cambió de contrato entre la lectura y el bloqueo.
- Contrato repartido y compatibilidad según lo que se decida en D1/D4.
- Concurrencia (script con dos sesiones, patrón `test_164_concurrencia.sh`): traslado y reserva simultáneos sobre el mismo record sin sillas duplicadas ni interbloqueo.

**TypeScript:**
- `lib/vuelos/stats.ts`: las filas `cambio` y `retirada` no cuentan en total, ocupación ni venta.
- Función pura de vista previa (Y/X antes→después por modo) usada por el modal.

**Interacción React (modal de mover):**
- Ninguna opción preseleccionada; confirmar deshabilitado hasta elegir.
- Con X sin cupos libres, A deshabilitada con motivo y **no** se selecciona B sola.
- El envío lleva `modo` explícito, la silla destino en A y el número de contrato visible.
- "Mover" no aparece en sillas libres.

**Guardas de cableado:**
- La Server Action reenvía el `operacion_id` recibido y nunca genera uno propio.
- `moverPasajeroSilla` y `cambiarSillas` no hacen `insert` en `sillas` y delegan en la función SQL.
- Ningún `.from("movimientos_silla").delete(` / `.update(` en la app.

## 12. Fases y despliegue

Recordatorio: Preview y Producción comparten la base de datos (TASKS "Separar Preview y Producción"). Con historial inmutable, cualquier prueba en Preview deja registros permanentes: probar las funciones en Postgres local y, en Preview, solo sobre un record de prueba acordado.

**Orden de despliegue.** Numeración de migraciones tentativa: confirmar el siguiente número libre en `main` con `ls` al implementar. Cada paso indica qué código puede seguir vivo en Producción mientras corre.

| # | Paso | Tipo | Compatible con el código viejo en Producción | Condición para avanzar |
|---|---|---|---|---|
| 0 | Preflight bloque A (y B si se decide), ejecutado por el usuario en Producción | Lectura | Sí | REVISAR de §2–§5b saneados o decididos |
| 1 | Solo TypeScript sin migración: excluir `cambio`/`retirada` en `stats.ts`, limpiar `contrato_manual` al borrar pasajero, ocultar "Mover" en sillas libres. **Implementado en el árbol de trabajo (2026-09-30), sin commit** | Código | Sí | Integrado y desplegado |
| 2 | Migración A1 (192): `alter type estado_silla add value 'retirada'` (va sola: el valor no puede usarse en la misma transacción que lo crea). **Escrita y probada en local** | Aditiva | Sí (nadie usa el valor todavía) | Aplicada |
| 3 | Migración A2 (**194**; el 193 lo tomó `registro_b2b_endurecido`, otra línea de trabajo): `operaciones_vuelo`, columnas del historial, `tipo = 'legado'` y las funciones de §6. **Sin guardas ni cambios de policy. Sin el índice único de §4.4c** (pendiente del resultado del preflight). **Escrita y probada en local** | Aditiva | Sí | Pruebas SQL en local; aplicada |
| 4 | Código B: todas las acciones de inventario pasan a las funciones. **Implementado en el árbol de trabajo.** Requiere la 194 aplicada: sin ella las acciones responden "falta la migración 194" y no cambian nada. Validar en su Preview (misma base) sobre el record de prueba | Código | Sí: Producción sigue con el código viejo, que aún puede escribir directo | Pruebas de cableado + validación en Preview |
| 5 | Integrar B y desplegar a Producción | Código | — | — |
| **▶** | **Barrera B→C** (§6.5): despliegue de Producción ≥ B activo y verificado acción por acción; Previews viejos resueltos; sin retroceso de Vercel previsto | Verificación | — | Las 6 condiciones obligatorias cumplidas |
| 6 | Opcional C0: guardas en modo aviso durante el ciclo acordado | Aditiva | Sí (solo avisa) | Ningún `GUARDA_ESCRITURA` en los logs |
| 7 | Migración C (**199**, §6.8.5): `revoke insert, delete` en `sillas` + triggers `sillas_guarda_escritura` y `bloqueos_guarda_cupos` en modo rechazo (incluye la guarda de `bloqueo_id`/`retirada`, I13) | Cierre | **No**: solo con B en Producción | Preflight A (guardas INDETERMINADO, INSERT/DELETE false) + preflight **C** en local y luego en Producción con aprobación: prohibidos OK, 2 permitidos OK |
| 8 | Opcional D: confirmación y `liberarVencidas` a funciones; guarda extendida a `service_role` | Código + cierre | No para el código viejo del cron: primero se despliega el código D y luego se extiende la guarda | Preflight C como `service_role` |
| **▶** | **Barrera D→E**: ninguna versión en Producción borra `movimientos_silla` (B ya lo garantiza) | Verificación | — | Revisión del despliegue activo |
| 9 | Migración E (**200**, §6.8.5): historial y `operaciones_vuelo` solo SELECT, `revoke update, delete` a `authenticated`/`anon`, trigger de inmutabilidad | Cierre | No para el código anterior a B | Preflight A: UPDATE y DELETE del historial sin hallazgo; en local, UPDATE/DELETE directos rechazados |

Reversión: C y E se revierten con `drop trigger` + `grant`; antes de retroceder un despliegue de Vercel a una versión anterior a B, revertir C (y E si aplica).

## 13. Riesgos

- Registros de prueba permanentes en producción (base compartida) una vez activa la inmutabilidad.
- Interbloqueos si una función no respeta el orden de bloqueo `ventas → bloqueos → sillas`.
- `cupos_total` legado desalineado: la comprobación I1 rechazaría operaciones sobre esos records hasta sanearlos.
- Sin D4b, un pasajero movido a otro proveedor deja la CxP aérea del contrato apuntando al proveedor anterior.
- La guarda por `current_user` depende de que las funciones las posea el mismo rol que corre las migraciones; si se cambia el dueño, hay que ajustar el trigger.
- Los records de prueba P1/P1' quedan para siempre en Producción con sus sillas: suman capacidad en los indicadores de inventario. Mitigación: fecha de ida lejana, notas visibles y, si se decide, excluirlos del dashboard por un marcador explícito (no por nombre).
- Base compartida: activar C (o E) con código anterior a B vivo en Producción o en un Preview rompe las acciones de vuelos de ese despliegue. La barrera B→C y la regla de revertir C antes de retroceder Vercel lo evitan.
- Hasta la fase C, cualquier rol de vuelos de cualquier agencia puede hacer por la API lo que las funciones impedirían (§6.5, T1–T10). Las funciones sin el cierre dan una falsa sensación de control.
- `retirada` es un valor de enum nuevo: cualquier código que liste los estados a mano (`lib/constants.ts`, filtros de pasajeros, etiquetas) debe conocerlo, o lo mostrará sin etiqueta.

## 14. Implementación (2026-09-30, árbol de trabajo, sin commit)

**Base de datos.** `20260601000192_estado_silla_retirada.sql` (enum) y `20260601000194_traslado_sillas_atomico.sql` (aditiva): `operaciones_vuelo` (idempotencia), columnas nuevas de `movimientos_silla` (`tipo` con `legado` por defecto para las filas existentes) y ocho funciones `SECURITY DEFINER` ejecutables solo por `authenticated`: `trasladar_cupos`, `mover_pasajero`, `retirar_cupo`, `cambiar_estado_silla`, `asignar_contrato_manual`, `quitar_contrato_manual`, `liberar_silla`, `editar_pasajero_silla`. Ayudantes privados sin `execute` para ningún rol del cliente. Rollback: `supabase/scripts/rollback_194_traslado_sillas_atomico.sql` (quita funciones y conserva el historial; el valor `retirada` no se puede quitar).

**Decisiones aplicadas tal como se aprobaron:** AUT-1, AUT-1b, AUT-2, DIR-1, DIR-2, D1, D4, D4b, D8. Técnicas con la recomendación del diseño: D2 (`ventas.bloqueo_ref_id` pasa a X), D3 (solo aviso), D7 (trasladadas quedan `disponible`), D9 (`DEFINER`), D9b (salen las libres de número más alto), D10 (sin documento en el historial), D11 (`eliminarBloqueo` se rechaza si el record tiene historial), IDEM-1 (5 s), IDEM-2 (el motivo no entra en la huella). D5 y D6 implementadas con la opción indicada en §9, pendientes de confirmar.

**Importes.** Ninguna función toca `precio_venta`, `costo_aereo`, otros costos ni `cuentas_por_pagar`. Proveedor distinto se bloquea; tarifa distinta exige confirmación y queda avisada, sin recálculo (D4b aprobada). Trasladar cupos libres no afecta importes: ningún cálculo de la app usa `tarifa × cupos`.

**Aplicación.** `app/(dashboard)/dashboard/vuelos/actions.ts`: `cambiarSillas`, `moverPasajeroSilla` (modo obligatorio), `retirarCupo` (reemplaza a `eliminarCupo`, que borraba), `cambiarEstadoSilla`, `asignarContratoManual`, `quitarContratoManual`, `borrarPasajeroSilla` y `editarPasajeroSilla` solo validan la forma y llaman a su función; `eliminarBloqueo` ya no borra historial. Interfaz: modal Mover con elección A/B explícita, aviso de tarifa y de PNR del contrato; traslado y retiro con identificador de operación reutilizado en reintentos; estados según DIR-1 con motivo; dos cifras (§4.7) en el detalle, la lista y el histórico; destinos ofrecidos solo si son compatibles. Las estadísticas de la lista se leen paginadas (`fetchAllPaginado`) para no truncarse por el límite de filas.

**Pruebas locales (base desechable copiada de la local, nunca remota).** `supabase/scripts/test_traslado_sillas.sql` (87 comprobaciones, termina en ROLLBACK): ejemplo 10/8 → 8/10, reintentos, mismo operación con otros datos u otro usuario, error a mitad de operación y reintento, los dos modos, modo A sin cupo, contratos manuales externo/interno/ambiguo/no admitido, tarifa y proveedor distintos, destino salido, D1, permisos por rol/agencia/usuario inactivo/anon, retiro, DIR-1, DIR-2 e invariantes. `supabase/scripts/test_traslado_concurrencia.sh` (dos sesiones reales): mismo operación simultánea, dos usuarios por los mismos libres, mover contra trasladar, `lock_timeout`; la suma de cupos y de sillas activas no cambia y no hay números repetidos. Pruebas TS y React de las acciones reales (cliente simulado), del modal y de las funciones puras.

**Corrección posterior (2026-09-30).** `mover_pasajero` validaba "destino distinto al actual" ANTES de la idempotencia: tras un `con_cupo` confirmado la silla ya está en X y el reintento con el mismo `operacion_id` fallaba en vez de responder `repetida`. Ahora la reserva de la operación va primero (como en `trasladar_cupos` y `retirar_cupo`). Cubierto por `test_traslado_sillas.sql` (reintento en ambos modos, mismo id con otro modo, otra aceptación de tarifa u otro usuario) y por el caso 5 de `test_traslado_concurrencia.sh` (respuesta perdida con COMMIT real y reintento desde otra conexión). La prueba de concurrencia ahora espera a que la primera sesión retenga el bloqueo antes de lanzar la segunda (antes dependía del tiempo de arranque de `docker exec`).

**D3-c (2026-10-01).** Implementado y probado en local (§8.2).

**Estado: las tareas 2 y 3 NO están completas.** Falta el cierre de §6.8 (B-bis, C y E) verificado en Producción y las decisiones D5 y D6.

**Lo que NO cubre esta implementación.** La escritura directa por la API sigue abierta hasta la fase C (§6.5); el historial es modificable por la API hasta la fase E; `crearBloqueo`, `cargarBloqueosMasivo`, `cargarPasajerosMasivo`, reservar y `liberarVencidas` siguen escribiendo `sillas` directamente (fuera del alcance de las tareas 2 y 3). Ningún dato existente se corrige: los desajustes legados (`cupos_total` ≠ filas activas, sillas de más por el `moverPasajeroSilla` antiguo) se diagnostican con el preflight y una operación nueva sobre un record así **ni lo corrige ni lo agrava**: cada función comprueba que el origen pierde exactamente n sillas activas y el destino gana n, y que `cupos_total` se mueve en la misma cantidad (I3), pero **no exige** `cupos_total = filas activas` (I1 absoluto), porque eso bloquearía la operación diaria sobre records legados antes de que el usuario decida cómo sanearlos. Activar I1 absoluto es una decisión pendiente, posterior al saneamiento.
