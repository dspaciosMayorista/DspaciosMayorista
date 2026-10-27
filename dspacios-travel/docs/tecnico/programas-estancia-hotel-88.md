# Programas terrestres por hotel y vigencia, con noches adicionales (#88)

> Referencia de **código** (no de negocio). Reglas comerciales confirmadas por el dueño al final del
> documento. Migraciones **244** (`20260601000244_programa_hotel_vigencia_noches.sql`) y **245**
> (`20260601000245_programa_hotel_asistencia_trm.sql`, correcciones previas al PR); scripts en
> `supabase/scripts/*_244_*` y `*_245_*`.

## 1. Qué es

Una tercera estructura de precio de Programas, junto a `categoria` y `salida` (que **no cambian**):
`programas.modo_precio = 'hotel'`. El precio base es **neto por persona para toda la estancia incluida**,
por **hotel × vigencia (fecha de ENTRADA) × acomodación × modalidad de servicios** (privados | regulares).
Sobre esa base se pueden vender **noches adicionales** *después* de la estancia incluida, cada una con la
tarifa de la vigencia de **su propia fecha**, cobrada **por persona o por habitación** (unidad declarada).

No es #89 (precio por hotel × *salida*): aquí la vigencia es un rango de fechas de entrada, no una salida.

## 2. Mapa de archivos

| Capa | Archivo | Qué hace |
|---|---|---|
| Motor puro | `lib/programas/estanciaHotel88.ts` | Tipos, `resolverVigencia`, `pvpNocheUnidad`, `liquidarNochesAdicionales`, `validarOcupacionHotel`, `itinerarioConNochesExtra`, `itemsContratoNoches`, `planObligacionesPrograma`, `validarHotelesParaGuardar`. Sin Supabase ni `@/`. |
| Precio (#57) | `lib/programas/precioReserva57.ts` | **Punto único**: `liquidarSeleccion` acepta `estancia` y suma las noches a la base que ya liquidaba (la base entra como una "salida": `salidaPrecioDesdeBase`). También `cotizarEstanciaDesdePvp` (lo que calcula el navegador, solo PVP), `construirTablaHotelPvp`, `desdeDobleHoteles`. |
| Fórmula | `lib/calc/programaPrecio.ts` | `pvpProgramaFormula` = la fórmula de `pvpPrograma` sin la guarda de "neto 0 = sin precio" (`pvpPrograma` delega en ella tras su guarda; comportamiento intacto). |
| Datos | `lib/programas/estanciaHotelDatos88.ts` | **Solo servidor.** Lee el catálogo (con netos) con el cliente de servicio; `cargarTablasPvp88` devuelve PVP, nunca netos; `completarDesdeHoteles88` completa el «Desde» de las tarjetas. |
| Captura | `producto/programas/[id]/HotelesVigenciaEditor.tsx` + `guardarHoteles` (`actions.ts`) | Pestaña «Hoteles y vigencias». Valida y llama la RPC atómica `guardar_programa_hoteles`. |
| Ficha | `app/tarifario/programa/[id]/EstanciaHotelesFicha.tsx` (+ `page.tsx`, `doc/page.tsx`) | Tablas de PVP por hotel, vigencia, modalidad y noche. |
| Formulario | `reservar/programa/[id]/ProgramaReservaForm.tsx` (+ `page.tsx`) | Hotel, servicios, entrada, noches adicionales; fechas exactas, vigencia y valor por noche, itinerario desplazado, total. |
| Reserva | `reservar/actions.ts::reservarProgramaInterno` | Rama `modoHotel`: valida, resuelve base por entrada, liquida con #57, congela, crea CxP. |
| Contrato | `components/contrato/EstanciaContratoBloque.tsx` | Foto de la estancia en la ficha del contrato y en el documento imprimible. |

## 3. Datos (migración 244)

* `programa_hoteles` — nombre, zona, tipo de habitación, `max_pax_habitacion`, `max_menores_habitacion`, `proveedor_id` (null = el del programa).
* `programa_hotel_precios` — base: `desde/hasta` (fecha de **entrada**), `modalidad_servicios`, `bajo_solicitud`, `neto_{sencilla,doble,triple,multiple,nino}`.
* `programa_hotel_noches` — noche adicional: `desde/hasta` (fecha de **cada noche**), `unidad_cobro` (`persona`|`habitacion`, **NOT NULL sin default**), `neto_*`. `neto_nino` solo se exige y se usa cuando la unidad es `persona` (`null` = no hay tarifa de menor y no se cotiza con menores; `0` = gratis declarado); con unidad `habitacion` el menor va incluido y un `neto_nino` cargado se ignora.
* `contrato_programa_estancia` — **foto** congelada al reservar (hotel, modalidad, fechas, vigencia base, habitaciones, PVP por noche, itinerario desplazado). Sin netos; la ve quien ve el contrato.
* `contrato_programa_estancia_costo` — netos por noche, asistencia (de las noches y total de la estancia), su proveedor y, en USD, la **TRM de costos** congelada. Solo roles contables. (La 245 retiró `cxp_programa_id`/`cxp_noches_id`: las CxP se vinculan por `numero_contrato` y se escriben DESPUÉS, dentro de la escritura financiera atómica.)
* **Migración 245:** `programas.proveedor_asistencia_id` (FK `proveedores`, `on delete set null`); en el registro de costo `asistencia_total`, `proveedor_asistencia_id`, `trm_costo` (`numeric(15,4)`, solo si `moneda='USD'`, `0 < trm < 1e11`) con sus CHECK; y `programas_modo_hotel_terrestre_chk` (el modo `hotel` no admite `tipo_transporte='aereo'` ni `incluye_aereo`).
* ⚠️ **PostgREST y la segunda FK:** con `proveedor_asistencia_id`, `programas` tiene DOS relaciones con `proveedores`; un embed `proveedores(...)` sin FK da `PGRST201` (relación ambigua). Los tres selects con embed desde `programas` usan `proveedores!programas_proveedor_id_fkey(...)` (compatible antes y después de la 245) y `programaEstancia88.correcciones.test.ts` vigila que no vuelva a quedar uno sin indicarla.
* RLS: el catálogo solo lo leen/escriben roles internos de producto (`superadmin`, `gerencia`, `administracion`, `operaciones`); `venta`, `agencia`, `anon` no leen netos. La ficha pública y el formulario reciben PVP calculado en el servidor. Las tablas de contrato no admiten escritura desde el navegador (solo `service_role`).
* Vigencias solapadas: el guardado las rechaza (TS y RPC) y el motor las **bloquea** igual al cotizar (datos viejos).

## 4. Fórmulas y orden de redondeo

**Base (regla existente de #57, sin cambios):** `(neto + asistencia×días) / (1−mk) / (1−fee)` → **un** techo por persona (USD al dólar, COP al millar) → total = Σ `PVP × pax` en centavos. Días de asistencia = `salida.noches ?? programa.dias`; en modo hotel no hay `noches` de salida, así que son los `dias` del programa (misma regla que una salida con `noches` NULL).

**Noches adicionales:** cada noche es una unidad de venta y se redondea **por separado** (la ficha publica un PVP por noche):
* por persona: `pvpProgramaFormula(neto, dias = 1)`;
* por habitación (adultos): `pvpProgramaFormula(neto_hab, asistenciaDia × ocupantes de esa habitación, dias = 1)` (sencilla 1, doble 2, triple 3, múltiple 4);
* menor: con tarifa por persona paga su tarifa explícita de menor + la asistencia de la noche; con tarifa por habitación va incluido (sin suplemento hotelero) y solo paga la asistencia de la noche.
Total de noches = Σ (noche × unidades × PVP de esa noche). La alternativa (un solo techo por todo el bloque) difiere hasta 1 unidad de moneda por noche y persona (ejemplo en la prueba: 3 noches de neto 100 → 381 por noche vs 379 en bloque). Los infantes no pagan (regla existente).

La regla comisionable 161/163 **no** se aplica a las noches (no hay tarifa de proveedor/impuesto por noche); `ventas.impuesto` sigue saliendo solo de un impuesto fiscal verificable de la base.

## 5. Itinerario

**Noches incluidas** = `dias − 1` (`nochesIncluidasPrograma`). Si el programa trae además `noches` y no coinciden, o no tiene `dias`, la reserva se rechaza y el formulario avisa: las fechas del itinerario, el regreso y la asistencia dependen de ese número y no se adivina cuál vale.

`itinerarioConNochesExtra(dias, k, entrada, hotel, diasPrograma?)` (devuelve `null` si k > 0 y el itinerario no tiene exactamente los días 1..N: `validarItinerarioCompleto`; el servidor lo rechaza antes de numerar y el formulario lo avisa): los días 1..N−1 conservan orden y contenido; por cada noche extra se inserta un **día libre** antes del último día (recogida/salida) y ese último día se desplaza. Ej. 4 días/3 noches + 1 extra: 1-3 igual, 4 = libre, 5 = recogida. `fecha_regreso = entrada + noches incluidas + k`. Nada se duplica. La foto del contrato guarda el itinerario ya desplazado.

## 6. Costo, CxP y asistencia

* `ventas.costo_receptivo` = neto base + neto de las noches. La CxP del programa (tipo `programa`) lleva ese total **si el hotel no tiene proveedor propio o es el mismo del programa**; si es **otro**, la CxP del programa conserva solo la base y las noches van en **su propia CxP** al proveedor del hotel (`planObligacionesPrograma`). Nunca dos veces: la suma de CxP == `costo_receptivo`.
* **Asistencia médica (migración 245):** es un costo más. Cubre la **estancia completa** (días incluidos + noches adicionales) × pax adultos/menores (infantes no pagan) y se registra **una sola vez**: `ventas.costo_asistencia`, `contrato_programa_estancia_costo.asistencia_total` (`asistencia_noches` es solo la parte de las noches, dato) y UNA CxP tipo `asistencia` al `programas.proveedor_asistencia_id`. Si el costo diario es > 0 y el programa no tiene proveedor, la reserva se **rechaza antes de numerar**. Nunca se suma al hotel ni se cobra dos veces (`asegurarCuentasPorPagar` ya no la duplica).
* **Menores por habitación:** si la noche se cobra por **habitación**, los menores ocupantes van **incluidos** (sin suplemento hotelero y sin exigir `neto_nino`; un valor cargado se ignora y el editor no lo pide); solo pagan su asistencia. Si se cobra por **persona**, cada menor exige su tarifa explícita.
* **Redondeo:** cada noche se redondea hacia arriba y luego se suman (decisión del dueño).
* **USD y TRM de costos:** un programa en USD pide, ANTES de numerar, la **TRM de costos** (la ingresa quien reserva, `esInterno`), con `decidirTrmCosto` de la 236. Toda CxP en USD guarda `moneda`, valor nominal, `trm_costo` y `valor_cop_costo` (el CHECK de la 236 exige coherencia); **una sola TRM por contrato**. En COP no hay TRM ni equivalente. No se inventa ninguna tasa.
* **Atomicidad:** el contrato nace `financiero_estado = 'pendiente'`; se escriben ítems, hoteles, pasajeros, foto y registro de costo; recién ahí `registrarFinancieroContrato` (payload durable `contrato_financiero_pendiente` + RPC atómico que reemplaza las CxP generadas, por lo que un reintento no duplica). Si cualquier paso falla se revierte (`revertir_contrato_incompleto`, que borra `ventas` y limpia las hijas por cascada) y se devuelve error: nunca éxito ni un contrato usable a medias. Si la reversión misma falla, el contrato queda pendiente con su carga durable y el cron `reconciliar-financiero` lo completa o lo revierte (la respuesta de error incluye el número). El asiento contable sigue siendo best-effort por diseño y se reporta como `advertencias`.
* **Solo terrestre:** el modo `hotel` no se combina con aéreo — el formulario deshabilita la opción, `guardarCabecera`/`reservarPrograma` lo rechazan y la base lo impide (CHECK de la 245).

## 7. Pruebas

* `pruebas/programaEstanciaHotel88.test.ts` — motor puro (redondeo, vigencias, noches, menores, ocupación, itinerario, validación, paridad navegador↔servidor).
* `pruebas/programaEstancia88.reserva.test.ts` — `reservarPrograma` real contra la BD en memoria (paridad ficha=reserva=contrato=CxP, foto congelada, un proveedor / otro proveedor, cambio de precio, rechazos sin escrituras, modos de siempre).
* `pruebas/programaEstancia88.correcciones.test.ts` — escritas ANTES de implementar: menores por habitación, asistencia (CxP, proveedor, sin duplicar), TRM/equivalente COP, escrituras parciales con fallos inyectados en cada paso, aéreo, itinerario incompleto y la guardia de embeds.
* `pruebas/programaEstancia88.react.ts` (`test:react`) — el formulario de punta a punta (incluye el campo TRM y el itinerario incompleto).
* `supabase/scripts/test_245_*.sql` + `test_245_programa_hotel_asistencia_trm.sh` — cadena 244 → 245 con preflight/postcheck integrales, rollback con candado y reaplicación.
* `supabase/scripts/test_245_app_programa_hotel.sh` + `pruebas/programaHotel245.pg.ts` — `reservarPrograma` REAL contra Postgres + PostgREST locales: contrato, foto, registro de costo, CxP con equivalente COP, asiento, fallos inyectados con triggers, reversión, reconciliación y reintento sin duplicados. Encontró dos defectos que el arnés en memoria no ve (el embed ambiguo y el `modo_precio` nulo en el insert por lote de `contrato_items`).
* `supabase/scripts/test_244_*.sql` + `test_244_*.sh` — esquema real en Docker (RLS, grants, cascade, renumeración, auditoría).

## 8. Reglas comerciales confirmadas

La matriz base es hotel × vigencia × acomodación × modalidad de servicios; el hotel informa zona, tipo de habitación y ocupación permitida. El precio base es neto por persona para toda la estancia incluida (días/noches e itinerario del programa); la vigencia se decide por la fecha de entrada. Las noches adicionales son solo después de la estancia incluida; cada una usa la vigencia de su fecha; la tarifa nocturna depende de hotel, vigencia y acomodación, se cobra por persona o por habitación (unidad expresa) y es la misma para privados y regulares. Una sola moneda por programa; en USD se pide y congela una TRM de costos expresa. Aplican a todos los ocupantes; por persona, el menor exige tarifa adicional explícita (por habitación va incluido, solo asistencia); los infantes conservan la regla existente. Las presta el mismo hotel y su proveedor y amplían la asistencia médica. Sin tarifa para una fecha o con vigencias ambiguas: se bloquea cotización y reserva, sin tarifa cercana de respaldo.

## 9. Límites conocidos

* **Corregido de paso:** `faltantesCxP` (`lib/reservar/cxpCobertura.ts`) no contaba las CxP de tipo `programa` dentro de la "bolsa de servicios", así que al **confirmar** la venta `asegurarCuentasPorPagar` veía `costo_receptivo > 0` sin CxP `receptivo` y creaba una CxP duplicada por TODO el costo del programa (también antes de #88). Ahora la CxP `programa` cubre `costo_receptivo` (por monto). Cubierto en `pruebas/programaEstancia88.reserva.test.ts` y `pruebas/programaEstanciaHotel88.test.ts`. Las CxP ya duplicadas en producción NO se tocan: hay que revisarlas aparte.
* No hay edición posterior de una reserva de programa (cambiar fechas, hotel o acomodación = anular y reservar de nuevo). La edición de ítems del contrato por superadmin (`ContenidoContratoEditor`) puede desalinear precio y foto.
* Blackouts y vigencia del programa solo se validan contra la fecha de entrada (comportamiento existente); las noches extra no se validan contra ellos.
* No se recalcula ningún contrato histórico ni se infiere una estancia para contratos anteriores.
* Los modos `categoria` y `salida` conservan su camino de siempre (CxP best-effort, sin pedir TRM de costos ni proveedor de asistencia): solo el modo por hotel usa la escritura financiera estricta.
* Orden de despliegue: 244 → 245 → código (el código nuevo lee `programas.proveedor_asistencia_id`). Con el código desplegado sin la 245 el listado y la reserva de programas fallarían (columna inexistente).

## 10. PR #409 — capacidad, noches ligadas, editor en diálogo, vista previa, fórmula y B2B

Sin migración nueva: todo es código sobre el esquema 244/245 ya aplicado (no se editaron esas migraciones).

### 10.1 Capacidad del hotel y tarifas publicadas
* Fuente única: `claveCompatible` / `clavesIncompatibles` / `soloCompatibles` en `lib/programas/estanciaHotel88.ts`. Una acomodación para N personas no se admite si `max_pax_habitacion < N` (Triple/Múltiple con máximo 2); la tarifa de menor no se admite con `max_menores_habitacion = 0`.
* **Editor:** no pide esas tarifas (ni en precio base ni en noches). Si ya estaban cargadas (se bajó el máximo), aparecen como **conflicto visible** y «Guardar» queda deshabilitado hasta pulsar «Quitar las tarifas que el hotel no admite» (acción explícita; nunca se descarta en silencio).
* **Servidor:** `guardarHoteles` (y la vista previa) pasan por `prepararHoteles` → `validarHotelesParaGuardar` → `conflictosHotel`: rechaza el guardado incompatible con mensaje de negocio antes de llamar a la RPC.
* **Publicación:** `construirTablaHotelPvp` (único punto por el que pasan la ficha, el tarifario público, el documento y el formulario de reserva) deja en `null` las tarifas incompatibles aunque existan filas antiguas. La guarda de ocupación de la reserva (`validarOcupacionHotel`, incluido el tope POR habitación) se conserva.

### 10.2 Noches adicionales ligadas a las vigencias base
* La noche **elige** una vigencia base existente del hotel (`opcionesVigenciaBase`); no se escriben fechas. Privados y regulares con las mismas fechas son **una sola opción** (la noche tiene una tarifa para ambas).
* Si las vigencias de privados y regulares no coinciden, o una tarifa de noche no coincide con ninguna vigencia base (se editó/quitó la base), `conflictosHotel` lo informa y el guardado se rechaza (editor y servidor): no quedan tarifas huérfanas ni fechas inventadas. Sin noches cargadas las bases pueden diferir.
* La liquidación no cambia: cada noche extra usa la tarifa de la vigencia que cubre su propia fecha.

### 10.3 Editor compacto, diálogo y clonar
`HotelesVigenciaEditor.tsx` (tarjetas), `HotelFormulario.tsx` (formulario), `hotelEstado.ts` (estado puro). «Editar», «Clonar» y «Agregar hotel» abren un diálogo; guardar/cancelar lo cierra y devuelve el foco al botón de origen; los errores del servidor se muestran dentro del diálogo y el borrador se conserva; el clic fuera no lo cierra. **Clonar** = borrador sin guardar con identidad nueva (`id = null`), nombre único (`Hotel (copia)`, `(copia 2)`…) y vigencias/modalidades/tarifas copiadas; cancelar no altera el original.

### 10.4 Vista previa de solo lectura
`calcularVistaPreviaPrograma` (Server Action) → `lib/programas/vistaPrevia409.ts` → `liquidarSeleccion` (el motor de la reserva). Funciona con el catálogo en pantalla (borrador sin guardar ni publicar), muestra vigencia aplicada, tarifa de cada noche, asistencia, MK, fee, redondeo, PVP y total, y la **causa** si falta tarifa o hay conflicto. No escribe nada (ni RPC, ni ventas, ni CxP; no revalida páginas). Exige `ESCRITURA.producto` y solo entonces devuelve costos (netos); sin ese permiso la salida del módulo puro no lleva netos ni desglose.

### 10.5 Itinerario compacto
`ItinerarioEditor`: un día completado (título + descripción) se ve en una fila (día, título, comidas, nota resumida) y «Editar» lo reabre sin perder contenido. La vista previa muestra los días libres añadidos antes del último día y la recogida desplazada.

### 10.6 Fórmula visible (`pvpProgramaDesglose`)
Una sola implementación (`pvpProgramaFormula` delega en ella): **(neto del proveedor + asistencia × días) ÷ (1 − MK) [+ monto sin markup] ÷ (1 − fee) → redondeo hacia arriba (COP al millar, USD al dólar)**. En noches extra se redondea **cada noche** y luego se suma. «Neto del proveedor» ≠ «NETO» de venta B2B (PVP − comisión).

Ejemplo base (USD, MK 15 %, fee 3 %, asistencia 4/día, 4 días): neto 600 → asistencia 4 × 4 = 16 → costo 616 → ÷ 0,85 = 724,70 → ÷ 0,97 = 747,11 → **748** por persona; doble (2 pax) = 1.496.
Ejemplo noche (por persona, neto 100, 1 día de asistencia): (100 + 4) ÷ 0,85 ÷ 0,97 = 126,1 → **127**; doble = 254. Dos noches en vigencias distintas (127 × 2 y 151 × 2) = 254 + 302 = 556 (no se redondea el bloque).
Paridad cubierta en `pruebas/programaHotel409.vistaPrevia.test.ts` (editor = ficha = vista previa = reserva = navegador; líneas del contrato suman el PVP de las noches).

### 10.7 Copia del titular y B2B en Programas
* `lib/personas/copiaTitular.ts` + `BotonCopiarTitular`: «Copiar datos del cliente» solo puede estar en UN pasajero por reserva (los demás quedan inhabilitados; «Deshacer copia» restaura los datos previos y los habilita). Superficies: `ReservaForm.tsx` y `ProgramaReservaForm.tsx`.
* **B2B en Programas** (`reservarProgramaInterno`): agencia/freelance exigen aliado del catálogo (`resolverAliadoAsistencia`, activo y del tipo) y **elección expresa PVP (`comisionable`) o NETO (`neta`)** antes de numerar. Reutiliza `planComisionReserva` (base comisionable = PVP − impuesto no comisionable; % del aliado/general/defecto; comisión) y `registrarComisionReserva` (RPC; si falla, `revertir_contrato_incompleto`). Se congela en `ventas`: `modo_compra`, `comision_b2b`, `comision_estado`, `aliado_id`, nombre del aliado del catálogo. PVP: cliente = la persona, `precio_venta` = PVP. NETO: cliente = el aliado (con su documento del catálogo), **titular = la persona**, `precio_venta` = PVP − comisión (`camposClienteVenta`). En NETO no hay una restricción adicional sobre el importe (la decisión comercial es del asesor). `terminosB2BPrograma` (solo lectura) muestra los términos antes de generar. **No se amplían permisos**: la acción conserva el contexto fail-closed de personal interno (`ESCRITURA.ventas`); ningún rol agencia/freelance llega aquí y `b2b_usuario_id` no se escribe.
* **Estado de la venta:** la RPC real `registrar_comision_b2b_reserva` solo acepta una reserva EN CURSO (`financiero_estado = 'pendiente'`). En modo hotel ya nacía así; fuera de él (categoría/salida) la venta nace 'pendiente' solo si es B2B y se marca 'completo' ÚNICAMENTE después de escribir pasajeros e ítems. Si falla la comisión, los pasajeros, los ítems o la propia transición a 'completo', el contrato B2B se revierte completo (venta, comisión e hijos) y, si la reversión también falla, el mensaje nombra el contrato (que sigue 'pendiente'). B2C y el modo hotel no cambian. Lo reveló la prueba contra la base real: el arnés en memoria no podía verlo.
* Pruebas: `programaReservaPrecio57.test.ts` (reserva real PVP/NETO/rechazos/reversión/vista previa), `programaEstancia88.react.ts` (UI B2B + copia), `copiaTitular409.test.ts`.

### 10.8 Validación en Preview (sin pulsar «Generar reserva»)
1. Programa por hotel → pestaña de hoteles: cada hotel es una tarjeta; «Editar» abre el diálogo; con máximo 2 no hay campos Triple/Múltiple.
2. Bajar el máximo de un hotel con Triple cargado: aparece el conflicto y «Guardar» queda inhabilitado hasta quitar las tarifas.
3. Noche adicional: elegir la vigencia base de la lista (privados+regulares = una opción).
4. «Vista previa del precio»: hotel, servicios, fecha, habitaciones, menores y noches extra → «Calcular vista previa»; abrir «Ver fórmula».
5. Itinerario: completar un día → queda en una fila; «Editar» lo reabre.
6. Reservar el programa como interno: en «Tipo de venta» elegir Agencia o Freelance, el aliado y **PVP** o **NETO**; revisar el panel de términos. **No pulsar «Generar reserva»** hasta revisar.

### 10.9 Prueba de punta a punta contra la base local (244/245)
`sh supabase/scripts/test_245_app_programa_hotel.sh <base_nueva> [contenedor] [plantilla243]` ejecuta `pruebas/programaHotel245.pg.ts`: además de P1–P8, el bloque B1–B9 reserva Programas por hotel y por salida a **PVP** y a **NETO** con la RPC de comisión REAL, verifica `ventas` (precio, modo, comisión, cliente/titular, estado) y `aliados_b2b`, la **reversión por fallo de comisión** (trigger inyectado en `aliados_b2b`), por fallo en **pasajeros** y en **ítems**, por fallo de la transición a 'completo' y cuando la **reversión misma falla** (B6a–B6e: sin venta, comisión ni hijos, reintento limpio; 'pendiente' mientras se escribe y 'completo' solo al final), y que la vista previa de términos no escribe nada.
