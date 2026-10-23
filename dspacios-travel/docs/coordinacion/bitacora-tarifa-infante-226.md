# Bitacora - Tarifa de infante 0-1,99 (migracion 226)

Ejecutor unico. **Ciclo 1: SOLO DISENO.** Sin codigo, worktree, rama, migracion, SQL, staging, commit, push ni PR. Todo se leyo con `git show`/`git grep` sobre `origin/main` **328f6f06** (#376, hotfix 224/225 ya fusionado). No se leyo `.env*` ni `sitio-web/node_modules`. Nada se ejecuto: las cifras de la seccion 8 son aritmetica manual contra las formulas leidas (`marcar` = neto/(1-mk), `redondearVenta` COP = techo al mil, USD = techo al dolar entero).

## Tabla de ciclos

| Ciclo | Base y estado Git | Trabajo y archivos | Pruebas ejecutadas | Hallazgos | Gate |
|---|---|---|---|---|---|
| 1 | `origin/main` 328f6f06 (SHA verificado tras `git fetch`). Sin worktree, rama ni commits. | Diseno (este documento). | Ninguna (solo lectura). | Dos criterios de edad distintos (hotel vs vuelo/servicio) que el modelo actual mezcla; el defecto del infante tiene 4 piernas (precio generador, precio de servicios, costo de servicios, precio de Bernalo); 3 triggers de invalidacion que no escuchan los campos nuevos; el publicador de la 181 y las vistas 182 tienen lista fija de columnas. Ver 2, 3 y 11. | Aceptado con resoluciones del suplente + respuestas del dueno (Q3, Q4) |
| 2 / 2026-10-21 | `origin/main` 328f6f06, worktree `.claude/worktrees/tarifa-infante-226`, rama `codex/226-tarifa-infante`; sin staging, commit, push ni PR. | Migracion 226 + preflight/postcheck/rollback + bateria SQL + fases + workflow; motor (`menoresDeDos.ts`, computo, cotizar, generador, reservar, checkout, costos/CxP); catalogo y UI. 33 archivos modificados + 12 nuevos. | Local: 89 TS nuevas, `test:unit` 6507 (12 rojas = las 12 preexistentes), `test:react` 660, tsc 0, eslint 0 errores, build rc 0, parser PG real sobre el SQL. **SQL y API NO ejecutados (sin Docker): pendientes de CI.** | 6 pruebas existentes editadas (regex de fuente), 3 archivos de app fuera del mapa, compat `menoresDelComputo`; no cubre `actualizarServiciosContrato` (pide ampliacion). Ver Ciclo 2 sec. 6 y 7. | Pendiente |
| 3 / 2026-10-22 | PR head `0a70b0a9` (commit del dueno); worktree limpio al empezar; cambios solo en 3 scripts SQL, sin commit. | Fix del POSTCHECK 226: `C10` (y `C1`) leian `information_schema.columns`, que incluye VISTAS; ahora solo tablas base (`information_schema.tables.table_type = 'BASE TABLE'`). Mismo fix en preflight `P2`/`P12`. Bateria: `D8`/`D9` (las vistas publicas exponen `precio_pvp_menor2`/`precio_infante` y ninguna columna de costo). Migracion 226 intacta. | `sh -n` ok; parser PG real sobre los 5 SQL ok; `tarifaInfante226Cableado` 29/29; `git diff --check` limpio. **SQL no ejecutado (CI).** | Falso positivo de C10: `fee_infante` en `empaquetados_basica` (224) y `precio_infante` en `tarifario_resumen` (162/182) son vistas bien puestas; tambien saldria en Produccion. | Pendiente |


---

## Ciclo 1

### 0. Regla del dueno (fija) y lo que ya se confirmo por lectura

- **Infante = 0 a 1,99 anos.** En el vuelo paga solo su **fee de infante** (puede ser $0). En cada servicio paga su propio **precio de infante** (campo nuevo, puede ser $0).
- **De 2 anos en adelante = tarifa de adulto** en vuelo y servicios. Las tarifas de nino del hotel no cambian. El hotel del infante sigue con `tarifa_hotel.neto_infante` (122).
- **"Grupo D" de la 195: verificado, NO hay precio.** `_silla_con_datos` (194, `:195-204`) y la 195 (`:165`) hablan de las 16 columnas de `sillas` que son **identidad y operacion**: `pasajero_*`, `tipo_doc`, `numero_doc`, `nacimiento`, `inf_nombres`, `inf_apellidos`, `inf_tipo_doc`, `inf_numero`, `inf_nacimiento`, `responsable_menor`, `agencia`, `asesor`, `hotel`, `acomodacion`, `plazo`. Ninguna es un valor monetario. `git grep` de `fee_infante|precio_infante|neto_infante|tarifa_infante|costo_inf|...` en las migraciones solo encuentra: `salidas_dinamicas.fee_infante` (094 `:32`), `empaquetados.fee_infante` (156 `:163`), `tarifa_hotel.neto_infante` (122) y los viejos `hoteles.infante_cargo_*` (118, ya sin uso). **Para Bloqueo no existe ningun valor de infante: el campo nuevo en `bloqueos_vuelo` si hace falta.**
- **Defecto confirmado en 4 piernas** (la que cito el suplente es solo la primera):
  1. Generador, precio del vuelo: la fila `infante` recibe `aporteVueloVal` de adulto (`paquetes/actions.ts:1033-1039`, sin caso especial en el bucle `:1008`/`:1029`).
  2. Generador, precio de servicios incluidos: la misma fila recibe `aporteServ` completo (`:979`, `:941-953`).
  3. Venta de servicios opcionales y de grupo: el infante cuenta como un pasajero mas (`totalPax = paxConSilla + numInfantes`, `computo.ts:756`), paga la tarifa de persona (`precioServicio`, `:~862`) y cuenta para el rango de grupo (`cargoGrupoIncluido`, `:~960`).
  4. Costo: el costo aereo si usa `fee_infante` (`reservar/actions.ts:246`), pero el costo de servicios usa `totalPax` con infantes a tarifa de adulto (`reservar/actions.ts:~830-846`, `:878`; `serviciosPaquete.ts:103-123`). El cliente paga adulto y la CxP al proveedor de servicios tambien.
- **Hallazgo central (cambia el diseno): hay dos criterios de edad, no uno.**
  - *Infante de hotel*: configurable por hotel/tarifa (`hoteles.edad_infante_max`, `tarifa_hotel.edad_infante_*` 177), comparado con `edad <= infanteMax` (`lib/acomodaciones.ts:111`) en anos cumplidos. **El default es `edad_infante_max = 2` (016 `:16`)**: un nino de 2 anos es "infante" para el hotel por defecto. Ej. real de CLAUDE.md: Virrey Cartagena, 0-2 anos infante, 3-5 nino.
  - *Infante de vuelo/silla*: constante `EDAD_INFANTE_MAX_VUELO = 2` con `edad < 2` (`lib/reservar/pasajeros.ts:41-57`), ya usada para sillas, manifiestos y `es_infante` del contrato. **Es exactamente la regla del dueno (0-1,99).**
  - Hoy el motor usa SOLO el criterio de hotel para precio (`computo.ts:482-484`, `:677-679`), de modo que el nino de 2 anos de un hotel con default 2 es "infante" para el precio y consume silla para el inventario. La regla del dueno exige separar los dos: el precio del **hotel** sigue la clase del hotel; el del **vuelo y los servicios** sigue `edad < 2`.

### 1. Inventario (ancla `archivo:linea` en 328f6f06; prefijo `dspacios-travel/`)

**1.1 Generador del tarifario** (`app/(dashboard)/dashboard/paquetes/actions.ts`)

| Origen | Donde se arma el precio del infante | Que hace hoy | Defecto |
|---|---|---|---|
| Comun | `ACOMODACIONES` `:46`; bucle `:1008`; `esRoom` `:1029`; `componerTarifa` `:1033-1039`; `aporteServiciosIncluidos` `:941-953`; `aporteServ` `:979` | La fila `infante` = marcar(neto_infante hotel) + `aporteServ` + `aporteVueloVal`, redondeada al mil. Sin caso especial. | Suma vuelo de adulto y servicios de adulto. |
| Bloqueo negociado | `:1190-1200` (`costoTiquete = tarifa_para_empaquetar`, `aporteVuelo(...)`, `filasHoteles(..., "bloqueo", b.id)`) | Igual a lo comun. `bloqueos_vuelo` no tiene fee de infante. | Idem. |
| Sistema (Empaquetados) | `:1203-1226` (`aporteVuelo(R, aplica_mk, mk, ta)`) | Igual. `fee_infante` ni se selecciona en la lectura (`:729`). | Idem. |
| Porcion terrestre | `:1228-1230` (`aporteVuelo = 0`) | Sin vuelo; la fila `infante` lleva los servicios incluidos completos. | Solo servicios. |
| Dinamico manual | `:1231-1247`; `fee_infante` solo se guarda en el CRUD (`:1505`, `:1526`) y nunca entra al precio | Igual a lo comun con `valor_tiquete` (neto) + MK o TA. | Idem. |
| Servicios (modulo) | `:1258-1302` (persona `:1296`; grupo `:1292`; `recargo_individual` `:1300-1302`) | Una fila por servicio (persona) o por rango (grupo), sin precio de infante. | No hay precio de infante. |
| Publicacion | `publicar_tarifario_resultado` (181 `:662-868`) | Inserta una **lista fija de columnas** de la fila. | Una columna nueva no se guardaria. |

**1.2 Liquidacion en vivo por fechas** (porcion/dinamico por fechas, buscador): `lib/reservar/liquidacionHotel.ts` `aporteServ` `:191`, `:210`, `componerTarifa` `:262` (`aporteVuelo: 0`); `lib/reservar/cotizar.ts` `liquidarHotelPaquete` `:204`, `cotizarPorFechas` `:272`, `buscarHoteles` `:515` (infantes `:727-740`; **ya cuenta a los infantes en el rango de grupo**: `paxGrupo = pax + menores.infantes` `:739`), `buscarReceptivos`/`liquidarServicioPuntual` `:944-1063`; `lib/reservar/liquidacionServicio.ts` `calcularPrecioConModoYMarkup` `:192-230` (`precioServicio(modo, neto, grupos, pax)`, `pax === 1` recargo `:213`).

**1.3 Motor de la reserva** (`lib/reservar/computo.ts`): `numInfantes` `:357`; reclasificacion por edad del hotel `:482-484`, `:677-679` (`resolverMenoresPorEdad` `:200-236`); precio del infante `:499-501`, `:685` (`pvpPorAcom["infante"]`, ausente = gratis, asimetria de la 122); neto del hotel del infante `:701-707`; `totalPax` `:756`; servicios opcionales `:757-870` (escalado por temporada `:812-846`, `precioServicio` `:~862`, recargo `:864`); servicios incluidos por persona (solo identidad/CxP, ya horneados) y por grupo `:~930-970` (`cargoGrupoIncluido(..., totalPax, ...)`); BNC `:977-986` (solo `impuesto_fijo`, ignora `impuesto_tipo`; no cuenta infantes porque usa `paxConSilla`).

**1.4 Escritura de la reserva** (`app/(dashboard)/dashboard/reservar/actions.ts`): `resolverDatosVuelo` `:221`; `infantesN` `:241` (de `input.infantes` CRUDO) y `costoAereo` `:246` (`costo_neto*paxConSilla + fee_infante*infantesN`); CxP aerea `:727`; costo y CxP de servicios opcionales `:800-846`, incluidos `:855-882` (`totalPax` con infantes); items del contrato `Infante · cat/regimen` `:660-668` (`tarifa_nino = pvpPorAcom["infante"]`); snapshot de cotizacion `:1090-1092`; conversion de carrito (persona) `:2424-2435`; Bernalo: costo aereo con fee `:2552-2556`, CxP `:2558-2575`. **Checkout publico** (`app/tarifario/checkout/actions.ts`): items del infante `:833-838`, `tarifaInfante` `:861`, `infantes: numInfantes` `:875`.

**1.5 Cotizacion manual, comparativa y contrato manual:** la comparativa y la hija B2B reliquidan con `computarReserva` (`reservar/actions.ts:1804`, `checkout/actions.ts:730`), asi que heredan el cambio sin tocar su codigo. La **cotizacion manual** (`cotizaciones/nueva/CotizacionManualForm.tsx`, `manual-actions.ts`) y el **contrato manual** (`contratos/NuevoContratoForm.tsx`, `contratos/actions.ts`) capturan precios y costos **a mano** por servicio: no tienen motor de infante (la unica mencion es una fila escrita por el usuario, p. ej. "Asistencia Medica Infante", `contratos/actions.ts:419`). Quedan **fuera**.

**1.6 Modelo "unidad" (Bernalo):** `lib/calc/pvpAlojamientoBernalo.ts` (vuelo solo sobre `paxConSilla` = menores cuya `categoriaTarifaria !== "infante"`, `:159`; servicios `persona` con "pax TOTAL real", cabecera `:5-12`); `lib/reservar/computoReservaBernalo.ts` (`paxConSilla` `:109`; `fee_infante` se selecciona pero `void e.fee_infante` `:276-286`: ni entra al PVP ni al costo interno). En Bernalo el infante **no paga vuelo ni fee** en el precio (el fee solo se costea en `reservar/actions.ts:2552-2556`). Ver Q10.

**1.7 Documentos y tarifario publico:** items del contrato/cotizacion (`contrato_items` fila "Infante", `tarifa_nino`) renderizados por `components/contrato/*` sin logica de precio; `lib/tarifario/resumen.ts` (`precio_infante` `:98`), vista `tarifario_resumen` (162 `:157`, 182 `:397`: `min(precio_pvp) filter (acomodacion='infante')`); `lib/tarifario/datos.ts:24` y `app/tarifario/detalle-actions.ts:78` (listas de columnas); `app/tarifario/TarifarioPublic.tsx` (`esRoom` `:976`; recargo `:844`) y `VistaBooking.tsx`; `reservar/nuevo/ReservaForm.tsx` (`numInfantes` `:157`, `totalPax` `:160`, `precioServicio` `:171`; su `totalHotel` **no suma al infante**, `:162-165`).

**1.8 Fuera de alcance por diseno:** Programas (circuitos de terceros; el infante va por cantidad sin precio propio, `reservar/actions.ts:3117`, `precioReserva57.ts`); contrato/cotizacion manual (arriba); `ventas.costo_*` historico.

### 2. Donde esta hoy el fee de infante de cada origen de vuelo

| Origen | Campo | Estado | Donde se usa |
|---|---|---|---|
| Salida dinamica manual | `salidas_dinamicas.fee_infante numeric(15,2) not null default 0` (094 `:32`) | Existe. Editor `SalidasDinamicasEditor.tsx` ("Fee infante (0-1.99)"). | Solo COSTO: `datosVueloSalida` `empaquetadoOrigen.ts:152-168` -> `reservar/actions.ts:246`. **Nunca entra al precio** (el generador no lo lee, `:1505`/`:1526` solo CRUD). |
| Empaquetado (Sistema) | `empaquetados.fee_infante numeric(15,2) not null default 0` + check `>= 0` (156 `:163`, `:185`) | Existe. Formularios Nuevo/Editar. **No** esta en la vista `empaquetados_basica` (224: es un costo). | Solo COSTO: `datosVueloEmpaquetado` `empaquetadoOrigen.ts:143`. No entra al precio. |
| Bloqueo negociado | **ninguno** | `datosVueloBloqueo` fija `fee_infante: 0` con el comentario "el infante no ocupa silla" (`empaquetadoOrigen.ts:107`). `bloqueos_vuelo.tarifa_neta` (071) es el pago por silla, no de infante. | Costo 0 y precio = vuelo completo (defecto). **Campo nuevo necesario.** |
| Vuelos de sistema en cotizaciones | la cotizacion tarifaria guarda `payload` (`ReservaInput`) y reliquida con el origen vivo; el snapshot `datosVueloSnap` (`reservar/actions.ts:~970`) usa `resolverDatosVuelo` | No hay copia del fee en la cotizacion. | Lo lee en vivo al convertir. |
| Cotizacion manual | `cotizacion_servicios` aereo: tarifa manual; sin infante | - | Fuera de alcance. |

Quien escribe `bloqueos_vuelo` (para el campo nuevo): `vuelos/actions.ts:91` (crear), `:127` (actualizar), `:361` (CSV; columnas en `vuelos/page.tsx:22-36`); formularios `NuevoBloqueoForm.tsx:33,58,102` y `[id]/EditarBloqueoForm.tsx:27,35,70,125`; lectura de edicion `vuelos/[id]/page.tsx:273`; RPC `crear_bloqueo_atomico` (195 `:88-100`, lista fija de columnas en `p_datos`); `trasladar_cupos` compara `tarifa_neta` para decidir si dos records son compatibles (194 `:446`, `lib/vuelos/compatibles.ts:19,50`).

### 3. Hallazgos de la lectura que afectan el diseno

1. **Criterio de edad doble** (seccion 0). Es la decision de fondo (Q1).
2. **El infante cuenta hoy como pax en servicios** y, en el buscador, ya cuenta para el rango de grupo (`cotizar.ts:739`). La regla nueva obliga a decidir si sigue contando (Q4).
3. **Invalidacion del tarifario incompleta para los campos nuevos** (181): `tarifario_trg_servicios_adicionales` solo escucha `UPDATE OF nombre, descripcion, precio_persona, recargo_individual, liquidacion, moneda` (`m181 :74-78`); `servicio_temporadas` y `servicio_tarifa_pax` disparan con cualquier cambio (`:33-36`, `:28-31`); `tarifario_trg_bloqueos_vuelo` escucha `tarifa_para_empaquetar, fecha_ida, fecha_regreso, ruta` (`:380-384`); `tarifario_trg_empaquetados` no escucha `fee_infante` (`:407-412`); `salidas_dinamicas` dispara con cualquier cambio (`:416-433`). Cambiar un `precio_infante` o un `fee_infante` hoy no marca el tarifario como pendiente.
4. **El publicador y las vistas tienen lista fija de columnas:** `publicar_tarifario_resultado` inserta columnas explicitas (181 `:700-760`); `tarifario_resultado_publicable` es `select r.*` expandido al crearse (182 `:294-297`); `tarifario_resumen` agrega columnas explicitas. Una columna nueva en `tarifario_resultado` exige reemplazar la funcion y las dos vistas en la 226.
5. **`paxConSilla` sigue la clase de hotel**, no la edad de vuelo (`computo.ts:493-501`): un nino de 2 anos clasificado infante por el hotel se cuenta sin silla en el costo aereo y en la validacion de cupos (`reservar/actions.ts:~210-236`), aunque fisicamente ocupa silla y el contrato lo registra con silla (`esInfantePorEdad`).
6. **`costo_neto` de un Bloqueo es `tarifa_para_empaquetar`** (`empaquetadoOrigen.ts:106`, la reventa), no `tarifa_neta`. Preexistente y ajeno; se reporta porque define la base del costo aereo del Bloqueo (el fee seria el unico costo "real" del infante en ese origen).
7. **Nada de lo anterior toca contratos ya creados:** `contrato_items`, `ventas.*`, `cuentas_por_pagar`, `abonos` guardan importes; esta regla solo cambia calculos hacia adelante.

### 4. Diseno del campo "precio de infante" por servicio

**4.1 Donde va.**
- `servicios_adicionales.precio_infante numeric(15,2) null check (>= 0)`: **neto** del proveedor por infante (misma moneda que el servicio), igual que `precio_persona`.
- `servicio_temporadas.precio_infante numeric(15,2) null check (>= 0)`: una temporada es una tarifa completa (persona + recargo + rangos, 089/090); null en la temporada = hereda el de GENERAL, exactamente como hoy se hereda `precio_persona` (`computo.ts:~823`: `netoTemp` solo si `precio_persona != null`).
- **Rangos por grupo (`servicio_tarifa_pax`): sin columna nueva.** Un precio de infante por rango no tiene sentido comercial; el modo grupo usa el `precio_infante` del servicio (ver 4.2). Q4.

**4.2 Significado.**
- *Cobro por persona:* PVP del infante = `marcar(precio_infante, mk) x factorLiquidacion(liquidacion, noches)`; el adulto/nino mayor de 2 no cambia. En la fila publicada del servicio (modulo servicios, persona) el PVP de infante viaja en la columna nueva (4.5).
- *Cobro por grupo:* **abierto (Q4).** Opcion A: el infante cuenta en el rango y no tiene cargo extra (comportamiento actual de `cotizar.ts:739` / `computo.ts:~960`); entonces `precio_infante` no se usa en grupo. Opcion B: el infante NO cuenta para el rango y paga `precio_infante` como cargo adicional por infante (con la liquidacion del servicio). La diferencia se ve en el vector de grupo (seccion 8). No se elige aqui.
- *Recargo individual:* sigue aplicando solo cuando `pax adultos+ninos = 1`; un infante solo no existe (todo infante requiere adulto responsable, 167).

**4.3 Markup y CxP.** El precio de infante es un **neto de proveedor** y entra al PVP con el MK del paquete (`marcar`, igual que el resto de servicios: decision vigente de #63, "servicios NETO con MK"); su costo al proveedor es el neto por infante (x factor de liquidacion). La CxP de cada servicio pasa de `neto x totalPax` a `neto_adulto x (adultos+ninos) + neto_infante x infantes` (`reservar/actions.ts:~830-846`, `:~855-882`; `costoNetoServicioIncluido`/`cargoGrupoIncluido` en `serviciosPaquete.ts:103-123,161-182`). **Contraste con el vuelo:** el fee de infante es precio = costo, sin MK ni TA (decision de #63 para F). Q2 lo extiende a todos los origenes.

**4.4 Moneda.** La del servicio (`servicios_adicionales.moneda`, 110). Un paquete es de una sola moneda (guardas `paquetes/actions.ts:775-795`); con el modo `cop_trm_63` de #63 (227) la conversion con TRM se aplica **antes** del MK sobre el neto de infante igual que sobre el de adulto, sin cambios en esta migracion.

**4.5 Semantica de NULL (Q3).** Un servicio con `precio_infante` NULL es "pendiente de llenar". Opciones: (a) *fallback a la tarifa de adulto* hasta que se llene (conserva el cobro actual, no cambia nada para servicios no migrados, deja visible un aviso "servicio sin precio de infante"); (b) *bloquear* la generacion del tarifario con un mensaje claro hasta que se llene; (c) *tratar NULL como $0*. La (c) cambiaria en silencio el precio de todos los servicios existentes. Precedente en la 122: NULL en `neto_infante` = gratis y no bloquea (asimetria deliberada de aquel caso).

**4.6 UI y carga masiva.** `producto/servicios/{ServiciosClient.tsx, actions.ts, page.tsx}`: campo "Precio infante (0 a 1,99 anos)" en el formulario base y en el editor de temporadas, columna `precio_infante` en el CSV (`page.tsx:21` lista las columnas) y en la carga de temporadas (`actions.ts:93-112,241-251`); indicador de servicios sin precio de infante.

### 5. Composicion del precio de un menor (modelo propuesto)

Cada menor tiene dos clasificaciones independientes: **clase de hotel** (infante/nino1/nino2 segun el hotel) y **edad de vuelo/servicio** (`< 2` = infante V/S). Precio del menor = parte de hotel (clase de hotel) + parte de vuelo + parte de servicios, con vuelo y servicios decididos por `edad < 2`.

Como la fila publicada hoy mezcla las tres partes en `precio_pvp`, se propone **publicar, junto al `precio_pvp` de siempre, un segundo precio por fila**:
- `tarifario_resultado.precio_pvp_menor2 numeric null` (nombre provisional). En filas de hotel de clase `nino`, `nino2` e `infante` = PVP del mismo hotel/categoria/regimen/salida para un pasajero de **menos de 2 anos**: parte de hotel de esa clase + **F** (fee de la fuente, sin MK/TA) + servicios incluidos por persona con **precio de infante** (con MK). En filas de servicio persona = PVP del infante. En filas de servicio grupo = cargo por infante (solo en la Opcion B de 4.2). NULL en filas de habitacion adulta.
- `precio_pvp` conserva su significado (vuelo y servicios de adulto): sirve tal cual para un menor de **2 anos o mas** de cualquier clase de hotel, incluida la fila `infante` del hotel (que hoy es justamente el precio correcto de un nino de 2 anos clasificado infante por el hotel).

En la venta: `menor < 2` toma `precio_pvp_menor2` de la fila de su clase de hotel; `menor >= 2` toma `precio_pvp`. Sin edades (alta legada por conteo `infantes`), los declarados se tratan como `< 2` (Q12). La fila `infante` se publica **aunque el hotel no tenga `neto_infante`** (parte de hotel = 0) para que F y el servicio de infante se cobren; hoy esa fila se omite y el infante sale "gratis" (Q6). `paxConSilla` y el costo aereo pasan a usar la edad de vuelo (Q14). Esto reemplaza `numInfantes` unico por dos cubetas (`< 2` y `>= 2` dentro de cada clase de hotel), lo que cambia la forma de `ComputoReserva` y de los items "Infante" del contrato.

*Alternativa B (sin columna nueva):* calcular el ajuste en vivo en la venta con los componentes del catalogo (fuente de vuelo + servicios), como ya hace para validar vigencia y costos. Evita tocar publicador, vistas y `types`, pero el precio vendido deja de ser el publicado y el cotizador/tarifario publico deberian replicar la misma resta (riesgo de dos implementaciones). Se recomienda al Coordinador decidir A o B (Q1b).

### 6. Paquetes y tarifarios ya generados

- **Hay que regenerar.** `tarifario_resultado` es una cache: mientras no se regenere, la fila `infante` publicada sigue con vuelo y servicios de adulto, y `precio_pvp_menor2` queda NULL (la venta debe tratar NULL como "regenerar antes de vender", no como gratis). El PVP baja para quien viaja con infantes; los netos y los costos no suben.
- **Disparo:** la 226 no publica nada. La invalidacion de la 181 marca el paquete `pendiente` cuando cambian los datos relevantes, pero **no** escucha los campos nuevos hoy (hallazgo 3); la 226 reemplaza esos triggers para que cambiar un `precio_infante` o un `fee_infante` invalide. Para la puesta en marcha se propone un **paso manual y explicito**: (1) llenar `precio_infante` de servicios y `fee_infante` de bloqueos, (2) correr un "regenerar tarifario" por paquete activo con el boton existente (o un barrido de administracion, Q8). Nunca automatico al aplicar la migracion.
- **Congelado, intocable:** contratos (`ventas`, `contrato_items`, `contrato_vuelos`), pagos (`abonos`), CxP y asientos ya creados, cotizaciones convertidas y las que tienen pago previo. La 226 no escribe en ninguna de esas tablas. Riesgo conocido, no nuevo: una cotizacion tarifaria SIN pago que se convierta despues de regenerar reliquida con los precios vigentes y el precio del infante baja (la guarda de precio al convertir solo existe para Bernalo y comparativas; #63 la limita a salidas vinculadas). Q9.

### 7. Contenido propuesto de la 226 (aditiva, una sola)

**Columnas nuevas:** `servicios_adicionales.precio_infante`, `servicio_temporadas.precio_infante`, `bloqueos_vuelo.fee_infante` (nullable o `not null default 0`, Q7), `tarifario_resultado.precio_pvp_menor2`. Checks `>= 0`. Sin backfill: los datos existentes quedan NULL (excepto el default de bloqueos).

**Funciones y vistas que se reemplazan** (`create or replace`, mismas firmas, sin editar 181/182/195): `publicar_tarifario_resultado` (inserta la columna nueva si viene en cada fila; filas viejas la dejan NULL); `crear_bloqueo_atomico` (acepta `fee_infante` en `p_datos`); `tarifario_resultado_publicable` (agrega la columna al final) y `tarifario_resumen` (redefine `precio_infante` como `min(coalesce(precio_pvp_menor2, precio_pvp)) filter (acomodacion='infante')`, que es el precio de un menor de 2 anos). Postcheck compara que las firmas y los grants no cambiaron.

**Triggers de invalidacion** (helper `tarifario_invalidar` de la 181): `servicios_adicionales` (agregar `precio_infante` a la lista), `bloqueos_vuelo` (agregar `fee_infante`), `empaquetados` (agregar `fee_infante`). `servicio_temporadas`/`salidas_dinamicas` ya disparan con cualquier cambio. 227 (#63) hereda estos y agrega los suyos.

**Compatibilidad de traslado de sillas (194 D4):** `trasladar_cupos` hoy exige igual `tarifa_neta`; decidir si `fee_infante` distinto tambien hace incompatibles dos records (Q7).

**Scripts y CI** (nombres propuestos): `supabase/migrations/20260601000226_tarifa_infante.sql`; `supabase/scripts/{preflight,postcheck,rollback}_226_tarifa_infante.sql`; `test_226_tarifa_infante.sql`, `test_226_fases.sh`; workflow `.github/workflows/test-226-tarifa-infante.yml` con las reglas de siempre (permisos `contents: read`, sin secretos ni Supabase remoto, sin `pull_request_target`, acciones fijadas por SHA, `set +e` antes de cada pipeline con `tee`, esquema armado hasta la 225 real, PostgreSQL desechable) y un job TS aparte.
- *Preflight (solo lectura, no bloquea):* cuenta servicios activos sin `precio_infante`, temporadas, bloqueos/empaquetados/salidas con `fee_infante = 0`, paquetes activos por tipo y filas publicadas con acomodacion `infante`, cotizaciones tarifarias pendientes, definicion actual de las dos vistas y del publicador, columnas con nombre en conflicto.
- *Postcheck (una fila con veredicto):* columnas y checks, publicador acepta y persiste la columna nueva, vistas exponen la columna, `precio_infante` del resumen coincide con la regla, triggers presentes, ACL (anon sin acceso, `venta` sin lectura de netos: los campos nuevos de servicios y bloqueos son costos), sin cambios en objetos ajenos.
- *Rollback:* quita triggers/columnas/definiciones nuevas y restaura las funciones y vistas a su definicion de la 181/182/195 **solo si ningun `tarifario_resultado.precio_pvp_menor2` ni `precio_infante` esta lleno** (forward-only despues del uso), con huella de definiciones para demostrar el estado exacto.
- *Pruebas SQL:* publicar con y sin la columna, vista publicable, resumen, invalidacion por cada campo nuevo, RLS (roles y `venta`), idempotencia, carreras de publicacion con cambio de `fee_infante`.

### 8. Vectores numericos (aritmetica manual; ninguno ejecutado)

Base comun: MK del paquete 20% (`marcar = neto/0,8`); hotel doble, 2 adultos + 1 infante de **1 ano**; hotel adulto neto 400.000 -> **500.000** por persona; `neto_infante` hotel 60.000 -> **75.000**; `neto_nino` 150.000 -> **187.500**; vuelo adulto **1.130.000** (Bloqueo/Sistema con `aplica_mk=false` y TA 0, o una salida manual de neto 904.000 con MK: 904.000/0,8); tour incluido por persona (liquidacion estancia) neto adulto 80.000 -> **100.000**. El fee es precio = costo, sin MK/TA (Q2).

| # | Caso | Calculo | Resultado |
|---|---|---|---|
| V0 | Hoy (defecto) | adulto 500.000+100.000+1.130.000 = 1.730.000; infante 75.000+100.000+1.130.000 | adulto **1.730.000**; infante **1.305.000**; total 2 adultos + 1 inf = **4.765.000** |
| V1 | Fee F = 0, precio infante tour = 0 | infante = 75.000 + 0 + 0 | infante **75.000**; total **3.535.000** |
| V2 | F = 80.000, tour infante 0 | infante = 75.000 + 0 + 80.000 | **155.000**; total **3.615.000** |
| V3 | F = 80.000, tour infante neto 40.000 (-> 50.000) | 75.000 + 50.000 + 80.000 | **205.000**; total **3.665.000** |
| V3c | Costos de V3 (Sistema, N = 1.000.000) | hotel 400.000x2+60.000; aereo 1.000.000x2 + **80.000** (una vez); tour 80.000x2 + 40.000 | hotel **860.000**; aereo **2.080.000**; tour **200.000** (hoy 240.000) |
| V4 | Servicio con `precio_infante` NULL, opcion (a) de 4.5 | infante tour = adulto 100.000 | 75.000 + 100.000 + 80.000 = **255.000** |
| V5 | Redondeo (hotel infante neto 61.000 -> 76.250; F = 80.500) | regla A: techo al mil de la fila entera; regla B (la de #63): redondear solo hotel+servicios y sumar F exacto | A: 156.750 -> **157.000**; B: 77.000 + 80.500 = **157.500** (Q5) |
| V6 | **Nino de 2 anos**, clase de hotel nino | 187.500 + 100.000 + 1.130.000 = 1.417.500 | **1.418.000** (vuelo y tour de adulto) |
| V7 | Nino de **1 ano** en hotel cuya clase infante termina en 0 anos (queda en clase nino) | 187.500 + 50.000 + 80.000 = 317.500 | **318.000** (hotel nino + tarifa V/S de infante) |
| V8 | **Nino de 2 anos en hotel con `edad_infante_max = 2`** (default) | 75.000 + 100.000 + 1.130.000 | **1.305.000** (hotel infante, vuelo y tour de adulto; coincide con la fila actual, por eso `precio_pvp` se conserva) |
| V9 | Opcional por **persona**, 3 noches (liquidacion noche), neto adulto 80.000, infante 20.000 | adulto 100.000x3 = 300.000; infante 25.000x3 = 75.000 | 2 adultos + 1 inf = **675.000** (hoy 900.000) |
| V10 | Tour de **grupo**: rango 1-2 neto 500.000, rango 3-4 neto 600.000; `precio_infante` neto 40.000; 2 adultos + 1 infante | Opcion A (infante cuenta en el rango, sin cargo): 3 pax -> 600.000/0,8 = 750.000. Opcion B (no cuenta, paga `precio_infante`): 2 pax -> 500.000/0,8 = 625.000 + 40.000/0,8 = 50.000 | A **750.000**; B **675.000** (Q4) |
| V11 | **USD** (paquete en USD, salida manual en USD con MK 20%): ticket neto 300 -> 375; fee 25; hotel adulto 100 -> 125; hotel infante 15 -> 18,75; tour adulto 50 -> 62,5; tour infante 10 -> 12,5 | adulto 125+62,5+375 = 562,5; infante 18,75+12,5+25 = 56,25; techo al dolar | adulto **USD 563**; infante **USD 57**; total **USD 1.183** (hoy infante 18,75+62,5+375 = 456,25 -> 457; total 1.583); costos: aereo 300x2+25 = **625**, tour 50x2+10 = **110** |
| V12 | Hotel sin `neto_infante`, F = 80.000, tour infante 0 | parte hotel 0 + 80.000 | infante **80.000** (hoy la fila se omite y el infante sale gratis; Q6) |

### 9. Mapa de archivos a reservar (prefijo `dspacios-travel/`) y coordinacion con #63 (227)

**SQL/CI (nuevos):** `supabase/migrations/20260601000226_tarifa_infante.sql`; `supabase/scripts/{preflight,postcheck,rollback}_226_tarifa_infante.sql`, `test_226_tarifa_infante.sql`, `test_226_fases.sh`; `.github/workflows/test-226-tarifa-infante.yml`; `pruebas/tarifaInfante226*.test.ts` y `.react.ts` (registrado por comando directo, sin tocar `package.json`).

**Catalogo/UI:** `app/(dashboard)/dashboard/producto/servicios/{ServiciosClient.tsx,actions.ts,page.tsx}` (campo, temporadas, CSV); `app/(dashboard)/dashboard/vuelos/{actions.ts,page.tsx,NuevoBloqueoForm.tsx,[id]/EditarBloqueoForm.tsx,[id]/page.tsx}` (fee del bloqueo); `lib/vuelos/compatibles.ts` (solo si Q7 lo pide); `paquetes/[id]/SalidasDinamicasEditor.tsx` y `vuelos/empaquetados/{NuevoEmpaquetadoForm.tsx,[id]/EditarEmpaquetadoForm.tsx}` (solo el texto de ayuda: el fee ya es precio y costo).

**Motor:** `lib/calc/paquetes.ts` (helpers puros: fila V/S de menor, precio y costo por edad), `lib/reservar/{computo.ts,liquidacionHotel.ts,cotizar.ts,liquidacionServicio.ts,serviciosPaquete.ts,empaquetadoOrigen.ts,pasajeros.ts}`; `app/(dashboard)/dashboard/paquetes/actions.ts` (generador y publicacion); `app/(dashboard)/dashboard/reservar/actions.ts` (costo aereo, CxP de servicios, items, snapshots, conversion); `app/tarifario/checkout/actions.ts` (items del infante); `lib/tarifario/{resumen.ts,datos.ts}`, `app/tarifario/{detalle-actions.ts,TarifarioPublic.tsx,VistaBooking.tsx}`, `reservar/nuevo/ReservaForm.tsx` (total con infante y precio de servicios por edad); `types/database.ts`. Condicional (Q10): `lib/calc/pvpAlojamientoBernalo.ts`, `lib/reservar/computoReservaBernalo.ts`.

**Cruces con #63 (227):** mismos archivos y mismas lineas: `paquetes/actions.ts` (rama dinamica, `filasHoteles`, publicacion), `computo.ts` (vigencia y BNC), `reservar/actions.ts` (costo aereo y CxP), `empaquetadoOrigen.ts`, `lib/calc/paquetes.ts`, `SalidasDinamicasEditor.tsx`, `ReservaForm.tsx`, `types/database.ts`, el publicador 181 (227 lo envuelve) y los triggers sobre `empaquetados`. Orden: **226 primero** (decision del suplente); 227 re-basa sobre 226. Consecuencias para 227: (1) la fila infante de las salidas vinculadas ya no se define alli: es `precio_pvp_menor2` de esta tarea con `F = empaquetados.fee_infante`; (2) el fixture FX1 de #63 ("el tour incluido no aplica al infante") queda resuelto por `precio_infante` del servicio (puede ser 0) y debe re-derivarse; (3) la pregunta Q4 y Q5 del re-base de #63 se cierran aqui; (4) los triggers de invalidacion de `fee_infante` los trae la 226. **No tocar** en 226: `bloqueos_vuelo.tarifa_neta` (hotfix aparte), la exposicion de `fee_infante` en `empaquetados` (224/225 ya la cierran para `venta`), el modo `cop_trm_63`.

### 10. Riesgos

1. **Cambio de forma del computo** (dos cubetas de infante) toca items, snapshots y documentos de contrato; hay que probar los 5 caminos que hoy leen `pvpPorAcom["infante"]` (computo x2, reservar x3, checkout x2, cotizar x1).
2. **Publicador, dos vistas y 3 triggers reemplazados** en una migracion aditiva sobre objetos de la 181/182/195: el postcheck debe probar que nada mas cambia.
3. **Bajada de precios** al regenerar: el tarifario publico mostrara infantes mas baratos; conviene avisar a ventas.
4. **Datos sin llenar:** `fee_infante = 0` por defecto en las 3 fuentes y `precio_infante` NULL en servicios hacen que "no lo han llenado" y "es $0" sean indistinguibles salvo por la regla de NULL elegida (Q3, Q7).
5. **`paxConSilla` por edad de vuelo** cambia el costo aereo y la validacion de cupos de Bloqueo (Q14).
6. **Cotizaciones pendientes** convertidas despues de regenerar (Q9).
7. **Dos implementaciones** si se elige la alternativa B de la seccion 5.
8. **Solape con #63**: dos migraciones consecutivas (226, 227) que reemplazan el mismo publicador; el orden y los nombres de columna deben cerrarse antes de reservar.

### 11. Preguntas explicitas (sin resolver por el ejecutor)

- **Q1.** *Dos criterios de edad.* Confirmar que el hotel conserva su clase configurable (default `edad_infante_max = 2`) y que el vuelo y los servicios usan `edad < 2`, de modo que un nino de 2 anos en un hotel de default 2 paga **hotel infante + vuelo de adulto + servicios de adulto** (V8). Alternativa: forzar la clase infante de todos los hoteles a menos de 2 anos (cambia tarifas reales, p. ej. Virrey). **Q1b:** modelo A (columna `precio_pvp_menor2` publicada) o B (ajuste en vivo en la venta).
- **Q2.** *Fee = precio = costo, sin MK ni TA* tambien para salidas dinamicas manuales (hoy traen MK/TA para el adulto) y para Bloqueo. Confirmar.
- **Q3.** *NULL de `precio_infante`:* (a) fallback al precio de adulto con aviso, (b) bloquear la generacion, (c) tratar como $0.
- **Q4.** *Servicios de grupo:* Opcion A (el infante cuenta en el rango, sin cargo) u Opcion B (no cuenta y paga `precio_infante`); y si el rango por grupo necesita su propio precio de infante.
- **Q5.** *Redondeo de la fila del infante:* techo al mil de la fila entera (regla A) o solo hotel+servicios con F exacto (regla B, la de #63).
- **Q6.** *Hotel sin `neto_infante`:* publicar la fila del infante igual (F y servicio se cobran) o conservar la omision actual (infante gratis).
- **Q7.** *`bloqueos_vuelo.fee_infante`:* `not null default 0` (igual a las otras fuentes) o nullable para distinguir "no llenado"; y si un fee distinto vuelve incompatibles dos records en `trasladar_cupos`.
- **Q8.** *Regeneracion:* boton por paquete (a mano) o un barrido unico de administracion tras llenar los datos; quien lo ejecuta y cuando.
- **Q9.** *Cotizaciones tarifarias pendientes* convertidas tras regenerar: aceptar que el precio del infante baje, o extender la guarda de precio (hoy solo Bernalo, comparativas y, en #63, las vinculadas).
- **Q10.** *Alcance Bernalo (unidad):* incluirlo (el fee y el precio del servicio de infante tambien le faltan) o dejarlo para una tarea posterior; y confirmar que Programas, cotizacion manual y contrato manual quedan fuera.
- **Q11.** Confirmar que el precio de infante del servicio es **neto con MK** (como los demas servicios) y no un precio final.
- **Q12.** *Altas sin edad:* los infantes declarados por conteo (sin fecha de nacimiento) se tratan como menores de 2 anos.
- **Q13.** *Tarifario publico:* mostrar para "Infante" el precio del menor de 2 anos y como describir al nino de 2 anos (adulto en vuelo/servicios).
- **Q14.** *`paxConSilla` y cupos:* pasar a la edad de vuelo (un nino de 2 anos ocupa silla y se costea con el tiquete completo) aunque el hotel lo llame infante.
- **Q15.** *Coordinacion con 227:* aceptar que 226 define la columna `precio_pvp_menor2`, los triggers de `fee_infante` y la extension del publicador, y que 227 se re-basa sobre ello (fixtures de #63 re-derivados).

Solo se escribio esta bitacora. Sin codigo, worktree, rama, migracion, SQL, staging, commit, push ni PR. El gate lo decide el Coordinador.

## Gate del Coordinador suplente, ciclo 1 (2026-10-21)

Diseno aceptado como base. Resoluciones del suplente:
- **Q1:** el hotel conserva su clase de infante configurable, porque es la politica de cada hotel (p. ej. Virrey). El vuelo y los servicios usan `edad < 2` (regla del dueno). El caso V8 se acepta: un nino de 2 anos en un hotel con default 2 paga hotel infante, vuelo de adulto y servicios de adulto. **Q1b = modelo A** (columna publicada `precio_pvp_menor2`), coherente con el snapshot del tarifario y la vitrina.
- **Q2:** si. Fee = precio = costo, sin MK ni TA, en todas las fuentes (salidas dinamicas manuales, empaquetados y Bloqueo). Es coherente con la decision ya tomada para empaquetados.
- **Q3 y Q4: van al dueno.**
- **Q5:** regla B (techo al mil solo de hotel + servicios, con el fee exacto), igual que #63.
- **Q6:** se publica la fila del infante aunque el hotel no tenga `neto_infante`: hotel $0, y el fee y los servicios se cobran.
- **Q7:** `not null default 0`, igual que las otras fuentes. Un fee distinto NO vuelve incompatibles dos records en `trasladar_cupos`; la venta usa el fee del record de destino.
- **Q8:** se regenera a mano por paquete con el boton existente. La 226/app agrega un aviso o listado de paquetes pendientes de regenerar. Sin barrido automatico.
- **Q9:** se acepta que el precio del infante baje en las cotizaciones sin pago convertidas despues de regenerar (es el precio correcto). No se extiende la guarda.
- **Q10:** Bernalo queda FUERA, como tarea posterior. Tambien quedan fuera Programas, la cotizacion manual y el contrato manual.
- **Q11:** el precio de infante del servicio es NETO con MK, como el resto de servicios.
- **Q12:** si. Los infantes declarados por conteo se tratan como menores de 2 anos.
- **Q13:** el tarifario publico muestra "Infante (menor de 2 anos)" con su precio. Se agrega una nota de que desde los 2 anos el vuelo y los servicios se cobran como adulto.
- **Q14:** si. `paxConSilla` y los cupos se rigen por la edad de vuelo (`< 2` no ocupa silla).
- **Q15:** se acepta. La 226 define la columna, los triggers y el publicador; #63 (227) se re-basa sobre ella.

**Pendiente del dueno:** Q3 (servicio sin precio de infante) y Q4 (infante en servicios por grupo). Despues: GO LOCAL con la reserva del mapa de la bitacora.

## Respuestas del dueno y GO LOCAL (Coordinador suplente, 2026-10-21)

- **Q3 = (a):** un servicio con `precio_infante` NULL cobra al infante como ADULTO (comportamiento de hoy) y la app muestra un aviso visible en el montaje o generacion del paquete y en el catalogo de servicios. NULL no es $0.
- **Q4: el infante NO cuenta para el rango de pax y NO paga nada extra** en los servicios por grupo. Ejemplo del dueno: 4 adultos + 1 infante = rango de 4, sin cargo de infante. OJO: es distinto de la "Opcion A" de la seccion 11, que decia "cuenta en el rango, sin cargo". El rango por grupo no lleva precio de infante propio.
- El resto, segun el gate del ciclo 1.

**GO LOCAL** a un UNICO ejecutor:
- Worktree nuevo `.claude/worktrees/tarifa-infante-226`, rama `codex/226-tarifa-infante`, base `origin/main` vigente (verificar el SHA).
- **Reserva exclusiva:** la de la seccion 9 (SQL/CI, Catalogo/UI y Motor), SIN Bernalo (Q10) y SIN `lib/vuelos/compatibles.ts` (Q7).
- `package.json`: solo para registrar las `*.react.ts` nuevas en `test:react`.
- Cualquier archivo fuera de esa lista requiere ampliacion. No se editan migraciones existentes.
- #63 (227) NO empieza hasta que la 226 este fusionada y aplicada.


---

## Ciclo 2 (GO LOCAL del Coordinador suplente, 2026-10-21): implementacion local

Ejecutor unico. Implementado el diseno del ciclo 1 con las resoluciones del gate y las respuestas del dueno (Q3 = (a) NULL paga como adulto con aviso; Q4 = el infante NO cuenta para el rango de un servicio por grupo y NO paga extra). Local: TS, React, tsc, eslint, build. **El SQL y la API NO se ejecutaron (no hay Docker): solo corren en GitHub Actions.**

### 1. Base y estado Git

- Worktree `.claude/worktrees/tarifa-infante-226`, rama `codex/226-tarifa-infante`, creada desde `origin/main` **328f6f06** (SHA verificado con `git fetch` y `git rev-parse`; HEAD = 328f6f068ff93363452eb3e6347aabc406a9a34c).
- `node_modules` propio (`pnpm install --frozen-lockfile`, sin junction).
- **Sin staging, commit, push, PR ni Preview.** Cambios solo en el working tree: 33 archivos modificados + 12 nuevos. No se tocaron migraciones existentes. `git diff --check` limpio (tracked) y sin espacios finales en los nuevos.

### 2. Archivos tocados

**Nuevos (dentro de la reserva):**
`supabase/migrations/20260601000226_tarifa_infante.sql` · `supabase/scripts/{preflight,postcheck,rollback}_226_tarifa_infante.sql` · `test_226_tarifa_infante.sql` · `test_226_fases.sh` · `.github/workflows/test-226-tarifa-infante.yml` · `lib/reservar/menoresDeDos.ts` (fuente unica de la cuenta y la tarifa de menores) · `pruebas/tarifaInfante226.test.ts` (57) · `pruebas/tarifaInfante226Cableado.test.ts` (29) · `pruebas/tarifaInfante226Checkout.test.ts` (3) · `pruebas/tarifaInfante226Ui.react.ts` (3, registrada en `test:react`).

**Modificados (dentro de la reserva):**
- Motor: `lib/calc/paquetes.ts` (`precioMenorDeDos`, regla B), `lib/reservar/{computo,cotizar,liquidacionHotel,serviciosPaquete,empaquetadoOrigen}.ts`, `app/(dashboard)/dashboard/reservar/actions.ts`, `app/tarifario/checkout/actions.ts`, `app/(dashboard)/dashboard/paquetes/actions.ts` (generador + lista de pendientes), `types/database.ts`.
- Catalogo/UI: `producto/servicios/{actions.ts,page.tsx,ServiciosClient.tsx}`, `vuelos/{actions.ts,page.tsx,NuevoBloqueoForm.tsx,[id]/EditarBloqueoForm.tsx,[id]/page.tsx}`, `reservar/nuevo/ReservaForm.tsx`, `app/tarifario/{TarifarioPublic.tsx,VistaBooking.tsx,detalle-actions.ts}`, `lib/tarifario/datos.ts`.
- `package.json`: SOLO se agrego `pruebas/tarifaInfante226Ui.react.ts` a `test:react`.
- NO se tocaron: Bernalo (`pvpAlojamientoBernalo`, `computoReservaBernalo`), `lib/vuelos/compatibles.ts` (un fee distinto no vuelve incompatibles dos records; `trasladar_cupos` intacto), Programas, cotizacion manual ni contrato manual. `lib/tarifario/resumen.ts` no hizo falta (la vista cambia `precio_infante`).

### 3. Que hace cada pieza (resumen del diseno aplicado)

- **Cuenta unica de menores** (`menoresDeDos.ts`): cada menor tiene DOS clasificaciones — clase del hotel (infante / Niño 1 / Niño 2, su edad configurable, V8 aceptado) y "menor de 2 años" (`edad < 2`, vuelo y servicios). Con edades se cuenta por edad real; por conteo (flujo legado) los infantes declarados SON menores de 2 años. Los menores de 2 años dentro de la clase niño toman primero Niño 1 y luego Niño 2 (regla determinista; la distribucion por habitacion pierde la edad individual).
- **Generador** (`generarTarifario`): cada fila de niño/niño2/infante publica `precio_pvp_menor2` = `redondearVenta(hotel de su clase + servicios incluidos con su precio de infante) + fee` EXACTO (regla B; el fee entra sin MK ni TA, por la salida dinamica, el empaquetado y el Bloqueo). Servicios incluidos: `precio_infante` NULL = precio de adulto (NULL ≠ $0). Hotel sin tarifa de infante: se publica la fila con hotel $0 (si el combo tiene habitacion y el hotel no es Adults Only). Servicio por persona opcional: la fila publica el PVP del infante (NULL si no lo configuro); por grupo: sin precio de infante. El resultado de la generacion avisa los servicios por persona sin precio de infante.
- **Venta** (`computarReserva`, rama cacheada y rama por fechas): `precio_pvp_menor2` por clase para el menor de 2 años, `precio_pvp` para el de 2+; `paxConSilla` = solo 2+ (el menor de 2 no ocupa silla ni cupo ni BNC); `totalPax` = todos; servicios por persona: adultos al PVP + menores de 2 años a su `precio_pvp_menor2` (adulto si NULL); por grupo y servicios incluidos por grupo: el rango usa solo a los 2+ (4 adultos + 1 infante = rango de 4, sin cargo). Temporadas de servicio: el precio de infante hereda el GENERAL si la temporada no lo define y se escala como el de adulto.
- **Tarifario anterior a la 226**: filas sin `precio_pvp_menor2` + un infante en la reserva => la venta se RECHAZA con "Regenera el tarifario del paquete" (nunca cobra el vuelo de adulto). Sin menores se reserva normal.
- **Costos / CxP**: costo aereo = `costo_neto × paxConSilla + fee_infante × menores de 2` (el conteo sale del computo, no de `input.infantes` crudo); en la conversion del carrito (Bloqueo) tambien suma el fee del bloqueo; CxP de servicios: `neto_adulto × pax 2+ + neto_infante × menores` (temporada vigente > general > adulto), por grupo solo el rango de 2+; CxP de hotel ahora SUMA el neto del infante del hotel (antes no se sumaba; V3c).
- **Documentos**: una fila por clase de hotel y tarifa (`lineasMenores`): "Infante · …" (menor de 2), "Infante (2 años) · …" (clase infante del hotel pero 2 años), "Niño 1 (menor de 2 años) · …". Contrato, cotizacion de reservar, checkout y conversion de carrito usan la misma lista; el residual de servicios por grupo se calcula con ella.
- **Catalogo/UI**: campo "Precio de infante" (servicio, temporadas, CSV; vacio = paga como adulto, 0 = gratis) con aviso en la pantalla de servicios; `fee_infante` del Bloqueo (crear, editar, CSV); tarifario publico con columna "Infante (menor de 2 años)" y la nota de que desde los 2 años vuelo y servicios se cobran como adulto; estimacion de Vista Booking y de `ReservaForm` alineadas; aviso en Paquetes con la lista de los que tienen el tarifario anterior a la 226 (se regeneran A MANO, sin barrido).
- **Migracion 226 (aditiva)**: 4 columnas con CHECK, reemplazo (`create or replace`, mismas firmas y grants) del publicador, `crear_bloqueo` y la funcion de trigger del catalogo de servicios; 3 triggers de invalidacion que ahora escuchan `fee_infante`/`precio_infante`; las dos vistas. Sin policies, privilegios de tablas ni datos. El rollback se genero DESDE el texto real de la 181/182/195 y se niega si las columnas nuevas tienen datos.

### 4. Pruebas reales (ejecutadas por el ejecutor, local)

| Prueba | Resultado |
|---|---|
| `tarifaInfante226.test.ts` (ejecuta `generarTarifario` y `computarReserva` reales con cliente falso, el evaluador por fechas y las funciones puras) | **57 en verde** |
| `tarifaInfante226Cableado.test.ts` (migracion aditiva, workflow, kit completo, caminos de venta, UI) | **29 en verde** |
| `tarifaInfante226Checkout.test.ts` (ejecuta `crearSolicitudReserva`) | **3 en verde** |
| `tarifaInfante226Ui.react.ts` + `editarBloqueoForm.react.ts` | 11 en verde |
| `pnpm run test:unit` completo | 6507 pruebas: 6495 en verde, **12 en rojo = EXACTAMENTE las mismas 12 preexistentes** (`personasConsulta.wiring` x3, `tarjetaCompletaBuscarAlojamiento` x2, `ocupacionBernaloUI3EWiring` x2, `hotelModalOrdenSecciones` x2, `tarjetaHotelExpandible`, `suitesPruebas`, `crmLeads.wiring`). La primera corrida dio 99 en rojo: 87 eran fixtures y regex de pruebas existentes atados al texto/forma anterior (ver 6); ya resueltos. |
| `pnpm run test:react` completo | 660 en verde |
| `tsc --noEmit` | 0 errores |
| ESLint sobre todos los archivos TS tocados | 0 errores; 2 warnings preexistentes (`_tipo`, `_id` en `paquetes/actions.ts:1124`) |
| `pnpm run build` (Turbopack) | rc 0 (dos veces; la segunda con todos los cambios finales) |
| Parser REAL de PostgreSQL (`libpg-query`, en el scratchpad, fuera del repo) sobre la migracion, preflight, postcheck, rollback y bateria, incluidos los cuerpos PL/pgSQL (4 en la migracion, 4 en el rollback, 12 en la bateria) | sintaxis valida |
| `sh -n` del runner; YAML del workflow parseado con js-yaml | validos |
| `git diff --check` | limpio |

**Vectores cubiertos con ejecucion real (COP, salvo V11):** V0/V3/V6 (adulto 1.730.000; infante pvp 1.305.000 y menor2 205.000; niño 1.418.000 y 318.000; total 2 adultos + infante de 1 año = 3.665.000), V1 (fee 0 y tour de infante $0 = 75.000), V2 (155.000), V4 (tour con `precio_infante` NULL: paga como adulto, 255.000, y la app avisa), V5 (redondeo regla B: 157.500 vs 157.000 de la regla A), V8 (niño de 2 años con hotel de infante hasta 2: 1.305.000, ocupa silla), V9 (liquidacion por noche), V11 (USD: adulto 563, infante 457 y menor2 57), V12 (hotel sin tarifa de infante: 130.000), servicio persona (2 adultos + infante = 225.000; NULL = 300.000), **servicio por grupo con 4 adultos + 1 infante = rango de 4 (750.000), sin cargo**, niño de 2 años (adulto en vuelo y servicios), temporadas de servicio (infante hereda o se escala), costos V3c (tour 200.000 en vez de 240.000, NULL = 240.000, $0 = 160.000), tarifario anterior a la 226 (rechazo claro).

### 5. Pendiente de CI (no ejecutado; se declara pendiente, no verde)

Workflow `test-226-tarifa-infante.yml`, dos jobs:
1. **`prueba-226`**: esquema real 001-225 (`preparar_esquema_local.sh ... 225`) y `test_226_fases.sh`: preflight (P1 INFO 1, P2 INFO 0, P3/P8 REVISAR con fixtures, sin BLOQUEANTE), aplicacion sobre datos existentes (contrato DTM-9227 con abono y CxP, servicio, paquete y snapshot) sin cambiar datos, policies ni ACL (huella md5), postcheck `OK|10|0|10|ninguno`, bateria SQL por rol (A columnas/CHECK, B `crear_bloqueo`, C publicador, D vistas, E invalidacion por cada campo, F ACL, G contratos intactos DTM-9226, Z conclusiva), idempotencia, rollback rechazado con datos y exacto sin ellos (huella de policies/ACL y de las definiciones de funciones, vistas y triggers identica a la de antes de la 226), reaplicacion. `set +e` antes del `tee`; una linea `OK` exigida por bloque.
2. **`pruebas-ts-226`**: las tres suites TS en imagen Node 24.14.0.

Riesgos propios que solo el CI puede mostrar (no se pudieron probar sin Docker): SQLSTATE exactos de los rechazos de la bateria, el nombre exacto de las marcas `OK` que el workflow exige, que `iniciar`/valores de generacion y revision del publicador coincidan con los leidos en la bateria, la igualdad de las huellas de ACL/definiciones tras el rollback (se hicieron insensibles al orden de las ACL) y el orden de las columnas de `select r.*` al recrear la vista. **No se escribio script de API (PostgREST)** para la 226: la autorizacion se prueba en SQL con `set local role` por rol (anon, authenticated con rol venta/operaciones/gerencia/control/agencia); si el Coordinador la exige, se agrega en otro ciclo.

### 6. Desviaciones (archivos o comportamientos fuera de lo reservado o de lo acordado) — a ratificar

1. **Archivos de app fuera del mapa de la seccion 9, minimos y necesarios:** `app/(dashboard)/dashboard/paquetes/page.tsx` (aviso con la lista de paquetes a regenerar; el requisito pedia "aviso o listado" y el listado de Paquetes es su lugar natural), `app/(dashboard)/dashboard/reservar/nuevo/page.tsx` (alimenta a `ReservaForm` con el precio del menor de 2 años; sin esto el total en pantalla diferiria del contrato) y `lib/reservar/desglosePersonaCotizacion.ts` (el residual de servicios por grupo acepta `lineasMenores`; compatible hacia atras).
2. **Seis pruebas EXISTENTES editadas** (todas son regex sobre el texto del fuente que cambio a proposito; no se cambio ninguna aserción de negocio, solo la forma): `bernaloIntegracionGuardWiring` (select del hotel con `adults_only`), `checkoutBernaloWiring` (las filas de menores salen de `lineasMenores`; 5 filas -> 3 sitios de `iIdx`), `computoIncluidosLecturaWiring` y `serviciosPaqueteWiring` (el rango usa `paxServAdulto`; `precio_infante` en el select), `empaquetados.test` (`fee_infante` en select y llamada), `precioFinalAutoritativoWiring` (la fila de hotel se publica desde `publicarFila`).
3. **Compatibilidad de consumidores:** `menoresDelComputo()` deja que un computo SIN los campos de la 226 (fixtures de pruebas anteriores) se comporte como antes: sin ella 87 pruebas existentes habrian quedado en rojo por un `TypeError`. El motor real SIEMPRE entrega `lineasMenores`.
4. **Decision tomada por el ejecutor (ratificar):** un tarifario anterior a la 226 + un infante en la reserva => ERROR pidiendo regenerar (en vez de cobrar el vuelo de adulto en silencio o dejar al infante gratis). Es la lectura estricta de "regeneracion manual por paquete + aviso"; el efecto transitorio es que hasta regenerar no se vende con infantes en ese paquete.
5. **Cambios de comportamiento colaterales (correctos, no pedidos):** (a) el costo aereo usaba `input.infantes` CRUDO: en el flujo por edades quedaba en 0 el fee del infante; ahora usa el conteo calculado. (b) la CxP de hotel NO sumaba el neto del infante del hotel (V3c lo asume); ahora si, en reservar y en la conversion del carrito. (c) con la clase niño del hotel, el menor de 1 año toma primero la tarifa de Niño 1.
6. **`libpg-query` instalado solo en el scratchpad** para validar la sintaxis SQL; no entra al repo ni a `package.json`.

### 7. Fuera de alcance / NO resuelto (requiere ampliacion o decision)

- **`contratos/actions.ts::actualizarServiciosContrato` y su editor (`contratos/[numero]/page.tsx:205`)**: al EDITAR servicios de un contrato pendiente se recalculan con `venta.pax` (todos) y la tarifa de adulto; no distinguen menores de 2 años (necesitaria contar los pasajeros infante del contrato). Archivos fuera de la reserva: **pide ampliacion**. Mientras tanto ese camino sigue cobrando al infante como adulto en los servicios editados despues de la venta.
- **Tours/receptivos sueltos del carrito** (`liquidarServicioPuntual`, `buscarReceptivos`): reciben solo un numero de pax, sin edades; no tienen concepto de infante. Sin cambio.
- **Bernalo, Programas, cotizacion manual y contrato manual**: fuera, como se acordo.
- **`ArmadoClient`** (vista administrativa del tarifario por paquete) sigue mostrando solo `precio_pvp`.
- **El listado de "paquetes a regenerar"** detecta los paquetes activos con filas de niño/niño2/infante sin `precio_pvp_menor2`; un tarifario antiguo SIN esas filas no se lista (la venta con infantes en el si pide regenerar).

### 8. Orden de despliegue propuesto (para el dueno; nada de esto se ejecuto)

1. Correr `preflight_226_tarifa_infante.sql` en Produccion (solo lectura) y revisar P3/P4 (servicios sin precio de infante) y P8 (paquetes a regenerar).
2. Aplicar la 226 (**ANTES** del codigo nuevo: el codigo selecciona las columnas nuevas; el codigo anterior sigue funcionando con la 226 aplicada). `postcheck_226_tarifa_infante.sql` => `OK|10|0|10`.
3. Desplegar el codigo.
4. Cargar los precios de infante de los servicios (Producto -> Servicios; vacio = paga como adulto, 0 = gratis) y el `fee_infante` de cada Bloqueo (Empaquetados y salidas dinamicas ya lo tenian, pero hasta hoy solo entraba al costo).
5. Regenerar a mano cada paquete listado en el aviso de Paquetes (el boton de siempre; el resultado avisa los servicios todavia sin precio de infante).
6. Rollback (solo si no hay datos en las columnas nuevas): `rollback_226_tarifa_infante.sql`.

### 9. Preguntas para el Coordinador

- **P1.** ¿Se ratifica el rechazo de reservas con infantes sobre un tarifario anterior a la 226 (desviacion 4)? Alternativa: aceptar el precio de adulto con aviso (reabre el defecto) o dejar al infante gratis (subcobra).
- **P2.** ¿Se amplia la reserva a `contratos/actions.ts` / `contratos/[numero]/page.tsx` (edicion de servicios de un contrato pendiente) y a `paquetes/page.tsx`, `reservar/nuevo/page.tsx`, `desglosePersonaCotizacion.ts` (ya tocados)?
- **P3.** ¿Se ratifica la edicion de las 6 pruebas existentes y la capa `menoresDelComputo`?
- **P4.** ¿Se quiere un script de API (PostgREST) para la 226 como en la 224/225, o basta la autorizacion probada en SQL por rol?
- **P5.** El neto del infante del hotel ahora entra a la CxP del hotel (antes no). ¿Se confirma que el hotel cobra ese neto al reservar un infante de clase infante?
- **P6.** Tours sueltos del carrito: ¿se les agrega un conteo de infantes en otro encargo?

Solo se trabajo en el worktree y en esta bitacora. Sin SQL remoto, staging, commit, push, PR ni Preview. Pendiente de entrega: el Coordinador revisa; el dueno hace commit, push y abre el PR Draft.

## Gate del Coordinador suplente, ciclo 2 (2026-10-22)

**Verificado por el suplente:**
- 45 archivos, sin staging, base `328f6f06` = `main`.
- `package.json` solo agrega `tarifaInfante226Ui.react.ts`.
- Repetidas, todas en verde: `tarifaInfante226` (las tres suites) + `empaquetados` + `serviciosPaqueteWiring` + `salidaDinamicaFlujos62` + `destinosAereosFlujos67` + `netoEmpaquetados224` = 399/399; React 226 = 3/3.
- `bash -n` y `git diff --check` limpios.
- Revisadas las 6 pruebas existentes editadas: se adaptan a la estructura nueva (`lineasMenores`, `paxServAdulto`, columnas nuevas) sin quitar comprobaciones de valores. Se ratifican (**P3**).

**Resoluciones:**
- **P1:** se ratifica el rechazo de la reserva con infante sobre un tarifario anterior a la 226, con mensaje claro de "regenerar". Orden operativo: 226 -> despliegue -> regenerar EN SEGUIDA los paquetes activos que lista el aviso. Mientras tanto, las ventas con infante de un paquete sin regenerar quedan bloqueadas (no se cobra de mas ni de menos).
- **P2:** se ratifican `paquetes/page.tsx`, `reservar/nuevo/page.tsx` y `desglosePersonaCotizacion.ts`. `contratos/actions.ts` (editar servicios de un contrato pendiente) NO se amplia: queda como tarea aparte.
- **P4:** basta con la autorizacion por rol en SQL, siempre que la bateria compruebe que `anon` y `authenticated` leen `precio_pvp_menor2` por las vistas publicas y ninguna columna de costo. Si el CI muestra que falta, se agrega.
- **P5:** confirmado. `neto_infante` de `tarifa_hotel` es el neto que cobra el hotel por el infante, asi que debe ir a la CxP del hotel. Antes faltaba.
- **P6:** los tours sueltos del carrito con infantes quedan como tarea aparte.

**GO a commit, push y PR Draft** (los hace el dueno). NO GO a Ready hasta tener el workflow `test-226-tarifa-infante` en verde.

## CI del PR (head `0a70b0a9`), diagnostico del suplente (2026-10-22)

- **216/217, 219, 220 y 221 en rojo, ajenos a la 226:** los cuatro fallan en el paso "Descargar PostgREST", antes de correr cualquier SQL. Es un fallo transitorio de red o del registro. En el siguiente push se vuelven a correr.
- **226 fases: un error del POSTCHECK, no de la migracion.** C10 ("las columnas nuevas viven solo donde corresponde") lee `information_schema.columns`, que incluye VISTAS. Columnas con esos nombres ya existen legitimamente en vistas:
  - `fee_infante` en `empaquetados_basica` (224);
  - `precio_infante` como columna agregada de las vistas de resumen del tarifario (162/182).
  - El resto del postcheck da 9/9.
  - El mismo falso positivo saldria en Produccion.
- **Correccion pedida:**
  - Que C10 evalue solo tablas base (unir con `information_schema.tables` donde `table_type = 'BASE TABLE'`), o una lista blanca explicita de las vistas conocidas.
  - Que la bateria SQL siga comprobando que las vistas publicas exponen `precio_pvp_menor2` y ningun costo.
  - No tocar la migracion 226.

---

## Ciclo 3 (2026-10-22): falso positivo C10 del postcheck

**Causa.** En el CI de la 226 las fases F3, F5.2 y F7.2 fallaron solo por el control C10 del postcheck (los otros 9, en OK). C10 buscaba columnas `fee_infante`/`precio_infante`/`precio_pvp_menor2` en `information_schema.columns`, que incluye vistas: `empaquetados_basica.fee_infante` (224) y `tarifario_resumen.precio_infante` (162/182) estan bien puestas. Tambien habria fallado en Produccion.

**Cambio (solo scripts; migracion 226 sin tocar).**
1. `postcheck_226`: la CTE `cols` une con `information_schema.tables` (`table_type = 'BASE TABLE'`); C10 y C1 evaluan unicamente tablas base. C5 (columna de la vista publicable) sigue consultando la vista por nombre, a proposito.
2. Misma correccion en `preflight_226` P2 y P12 (P12 habria dado REVISAR por las mismas vistas). `test_226_fases.sh` y `rollback_226` consultan nombres de tablas base concretos: sin cambio.
3. Bateria: se agregan **D8** (las vistas publicas exponen `precio_pvp_menor2` en `tarifario_resultado_publicable` y `precio_infante` en `tarifario_resumen`; D1 a D4 ya lo probaban con datos) y **D9** (ninguna columna de costo en esas dos vistas: `tarifa_proveedor`, `tarifa_neta`, `tarifa_para_empaquetar`, `fee_infante`, `neto_*`, `costo_*`). Aquí si se consulta `information_schema.columns` por nombre de vista, a proposito.

**Verificacion local:** parser PostgreSQL real sobre los 5 SQL, `sh -n test_226_fases.sh`, `tarifaInfante226Cableado` 29/29, `git diff --check` limpio. El workflow no se toco (D8/D9 quedan cubiertos por "ningun FALLO" y "TEST 226 SQL: TODO OK"). **Pendiente de CI:** que F3, F5.2 y F7.2 pasen a `OK|10|0|10|ninguno` y D8/D9 en verde. Sin commit.

## Gate del Coordinador suplente, ciclo 3 (2026-10-22)

Diff revisado: 3 scripts y la migracion intacta.
- C1, C10, P2 y P12 evaluan solo tablas base (union con `information_schema.tables`, `BASE TABLE`).
- D8 y D9 nuevos: las vistas publicas exponen `precio_pvp_menor2` y ninguna columna de costo.
- `bash -n` y `git diff --check` limpios.

**GO a commit y push al mismo PR.** El push vuelve a correr tambien los 4 checks que fallaron por la descarga de PostgREST.
