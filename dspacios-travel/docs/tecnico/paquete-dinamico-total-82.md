# Paquete 100 % dinámico (#82) — hoja técnica

> Índice: [`README.md`](./README.md) · Relacionado: [`tarifario-y-paquetes.md`](./tarifario-y-paquetes.md) ·
> [`programas-y-cotizacion-manual.md`](./programas-y-cotizacion-manual.md) ·
> [`cotizaciones-comparativas-211-despliegue.md`](./cotizaciones-comparativas-211-despliegue.md)

## 0. Qué es (y qué NO es)

Producto **reutilizable** de Paquetes armado con vuelo, hotel y servicios **propios del paquete**, sin
exigir fichas con vigencias ni tarifas previas. **No** es:

- el tipo `armado_paquetes.tipo = 'dinamico'` (hotel del catálogo + vuelo de sistema en `salidas_dinamicas`,
  snapshot en `tarifario_resultado`). Ese flujo, `generarTarifario` y su enum **no se tocan**;
- una cotización manual (se crea una cotización por cliente *a partir* del producto).

Separación de cambios: familia de tablas propia `paquete_din*` + RPC propias; la cotización reutiliza
`cotizaciones` (tipo `manual`) y `cotizacion_servicios`, y la conversión reutiliza
`convertir_cotizacion_manual_controlada` (216/242). Decisión del dueño (2026-11-03).

## 1. Dónde vive

| Pieza | Archivo |
|---|---|
| Migración | `supabase/migrations/20260601000274_paquete_dinamico_puro.sql` (+ `scripts/rollback_274…`, `preflight_274…`, `postcheck_274…`, `test_274_paquete_dinamico.sql`, `test_274_rls_por_rol.sql`) |
| Cálculo puro (esquemas, acomodaciones, menores, cuadre, costos pendientes) | `lib/paqueteDinamico/calculo.ts` |
| Filas BD → opción vendible | `lib/paqueteDinamico/modelo.ts` |
| Entrada del formulario + validación de forma | `lib/paqueteDinamico/entrada.ts` |
| Cabecera/componentes de la cotización (documento, payload) | `lib/paqueteDinamico/cotizacion.ts` |
| Vista pública SOLO PVP (sin netas/markup/proveedores) | `lib/paqueteDinamico/publico.ts`, `cargarPublico.ts` |
| Administración (checks → pestañas, hoteles/vuelos/servicios existentes o manuales) | `app/(dashboard)/dashboard/paquetes/total/*` |
| Cotizar, editar con versión, costos reales, versión mostrada | `app/(dashboard)/dashboard/cotizaciones/din-actions.ts`, `[id]/PanelDinamico.tsx` |
| Documento público por token de una cotización manual (corrige «$ NaN») | `lib/paqueteDinamico/documentoPublico.ts`, rama manual en `app/cot/[token]/page.tsx`, prueba `pruebas/cotPublicoManual82.react.ts` |
| Sección pública «Dinámicos» | `app/tarifario/PorDinamicos.tsx` (pestaña en `TarifarioPublic.tsx`) |
| Conversión | `convertirCotizacionManualAContrato` (`manual-actions.ts`) enruta a `convertir_cotizacion_din` si la cotización tiene `paquete_din_id` |

## 2. Reglas de cálculo

- Precios **por persona por la estadía** del paquete (no por noche); servicios por persona (no aplican a infantes).
- `neta_markup`: PVP = `redondearVenta(neto/(1-mk))` (COP al millar, USD al dólar entero), igual que `lib/calc/paquetes.ts`.
- `solo_pvp` + `por_componente`: PVP por vuelo (adulto/niño/infante), hotel (7 acomodaciones) y servicio.
- `solo_pvp` + `general`: un precio por acomodación para todo el paquete; los componentes quedan con costo pendiente.
- Menores: `nino`, `nino2`, `infante`; **0 = gratis explícito**, ausente = no cargado (se rechaza).
- Cada línea se redondea antes de sumar → el total es siempre Σ líneas (`verificarCuadre`). Un `totalDeclarado`
  opcional se contrasta con el desglose y se rechaza si no cuadra.
- **Nunca se inventa un costo desde el PVP**: en solo PVP cada componente nace con `exige_costo = true` y costo 0.

## 3. Cotización, versiones y conversión

- `crear_cotizacion_din` (SECURITY DEFINER, solo service_role) envuelve `crear_cotizacion_manual`, enlaza
  `cotizaciones.paquete_din_id`, marca `componente`/`exige_costo` y crea la **versión 1** — todo en una transacción.
- Los precios salen **siempre de la base** (la acción no confía en importes del navegador).
- `editar_cotizacion_din`: valores (y costos) por componente, motivo obligatorio, revisión optimista
  (`economico_rev`), reglas de `p39_priv.bloquear_para_editar` (abierta, sin pagos previos, vigente, autor para `venta`).
  Cada edición crea una versión nueva en `cotizacion_versiones` (inmutable; solo se puede marcar como mostrada una vez).
  La versión guarda documento y valores por componente, **sin costos**.
- `marcar_version_mostrada`: registra qué versión se mostró/envió al cliente; el panel avisa si la vigente difiere.
- `registrar_costos_cotizacion_din` (roles de producto): costo > 0 y proveedor por componente, en la moneda de la cotización.
- `convertir_cotizacion_din`: si faltan costos reales **rechaza antes de numerar** (no crea contrato, CxP ni asientos);
  si no, delega en la conversión controlada, que crea las CxP una por componente con el costo real y la moneda de la cotización.
- Guardas de red de seguridad: el editor manual no puede tocar componentes/precio de una cotización dinámica
  (`DIN_82_USAR_EDITOR`) y ninguna `venta` nace con costos pendientes (trigger en `ventas`).

## 4. Reglas vigentes y límites (migración 275 + verificación local)

### 4.1 Por qué existe un editor propio
El editor de la cotización manual recalcula `valor` desde `costo_neto`: una línea solo-PVP (costo 0) quedaría en 0. Por eso la cotización de un
paquete dinámico se edita con `editar_cotizacion_din` (valores, versión y motivo) y un trigger impide tocar sus componentes por el camino manual.

### 4.2 Aislamiento por agencia (275)
- `paquete_din*` guardan netas y proveedores. La RLS filtra por AGENCIA con `puede_producto_din(tenant)`: superadmin cruza; gerencia, administración y
  operaciones solo ven y escriben la suya (más estricto que `puede_ver_tenant`, que deja a gerencia ver las dos). Los hijos heredan la visibilidad del
  padre. `venta`, `agencia`/`freelance` y `anon` no leen nada (probado con JWT real vía PostgREST).
- Al borrar un destino, el conteo de uso necesita ver las dos agencias: `uso_destino_din` (solo números) lo hace para `paquete_din`, `paquete_din_vuelos` y
  `paquete_din_servicios` (lista `TABLAS_CONTEO_PRIVILEGIADO` en `lib/producto/usoDestino.ts`; las demás tablas se cuentan con la sesión).

### 4.3 Destinos adicionales (`paquete_din.destinos_extra`, arreglo SIN FK)
- **Existencia:** el trigger `trg_din_destinos_extra_validos` rechaza ids inexistentes y valores vacíos al insertar o actualizar el arreglo, así que cubre
  `guardar_paquete_din` (crear y editar) y cualquier escritura directa por PostgREST. Usa `FOR SHARE` para que un destino no se borre a mitad de guardado.
- **Borrado:** el conteo de `uso_destino_din` incluye los paquetes donde el destino solo está en el arreglo (el modal ofrece fusionar); además
  `trg_din_destino_extra_guard` rechaza el DELETE directo (`DIN_82_DESTINO_EN_USO`) para no dejar ids huérfanos.
- **Fusión:** `fn_fusionar_destino` fue redefinida por la 275 como copia exacta de la 237 más un único `UPDATE` que reapunta el arreglo del origen al destino
  (sin duplicados, conservando el orden y sin repetir el destino principal). `pruebas/usoDestino.test.ts` compara ambos cuerpos y falla si cambia algo más.
  El rollback de la 275 restaura la versión de la 237.

### 4.4 Publicación y guardado
- Editar un paquete lo deja **sin publicar** (hay que volver a publicarlo); el formulario lo avisa.
- Guardar es atómico: `guardar_paquete_din` (SECURITY INVOKER, una transacción) crea o reemplaza paquete e hijos; un error en cualquier hijo deja todo como
  estaba. Ya no hay borrar/insertar desde TypeScript.
- Solo se pueden cotizar paquetes activos y publicados, en su vigencia de compra, con viaje futuro de exactamente `noches`, dentro de la ventana de viaje y
  con las fechas del vuelo elegido (`p82_priv.validar_solicitud`, también espejada en `validarSolicitudDin`).
- El selector «usar ficha de hotel existente» ofrece TODAS las fichas activas del destino (`hoteles_vinculables_din`), con o sin temporadas, tarifas por persona/unidad o calculadora y en cualquier moneda (migración 280). La ficha aporta solo información general (nombre, estrellas, descripción, ubicación, reglas de menores); sus tarifas y vigencias NO se leen ni se copian: el precio es siempre el del paquete (`paquete_din_hoteles.neto/pvp`). Se vuelve a validar al guardar
  (acción + trigger). El hotel manual sigue disponible.

### 4.5 Cotizar desde la pestaña «Dinámicos»: canal, CRM y enlace
El canal lo decide el servidor por la sesión (`resolverCanalDin`), nunca el navegador. La pestaña muestra los paquetes publicados de la agencia que
corresponde (`tenantDinamicosVisibles`): visitante → públicos de Mayorista; aliado B2B → los de su agencia; personal → la agencia activa.

| Canal | Cotización | Registro del titular | Dónde se ve |
|---|---|---|---|
| Visitante (sin sesión) | `crear_cotizacion_din_externa('publico', null)`: sin autor, propietario ni aliado; contacto obligatorio (nombre + correo o teléfono); tope 5/hora por contacto; solo paquetes de Mayorista | **`crm_contactos`** (Mayorista, cliente final, mismo contacto auxiliar del checkout público) | Enlace `/cot/<share_token>` |
| Aliado B2B (agencia/freelance activo) | `'b2b'`: autor, propietario y aliado = el usuario; solo paquetes de su agencia | **Registro de personas** (`cotizacion_participantes`) | Portal `/portal/b2b/cotizaciones` (lista por `creado_por`) y `/cot/<token>` |
| Personal interno | `crear_cotizacion_din` (autor = el usuario) | **Registro de personas** | `/dashboard/cotizaciones/<id>` |

**Por qué el visitante va a `crm_contactos`:** `registrar_personas_cotizacion` solo admite anónimos de tipo `carrito` (`p214_priv.cotizacion_anonima`, migración
219) y esta cotización es de tipo `manual` para poder convertirse. Se comprobó en local (`no_autorizado`); por eso el visitante entra al CRM por el contacto
auxiliar y NO queda en `cotizacion_participantes` (no se amplió esa regla de seguridad).

**`/cot/[token]` con cotización manual:** la ruta pública usaba `ContratoDocumento`, que no entiende los ítems `{cantidad, tarifa_unit, valor}` de la manual y mostraba
«$ NaN» / «Total del contrato $0». Ahora `esSnapshotManual(items)` (`lib/paqueteDinamico/documentoPublico.ts`) elige `CotizacionManualDocumento`. La consulta del enlace
público no cambió ni lee `payload` (lo exigen pruebas de cableado); la fecha de emisión viaja en `detalle.venta.fecha_emision`. Prueba de render:
`pruebas/cotPublicoManual82.react.ts` (incluye la premisa de que el documento del tarifario sí mostraba NaN).

### 4.6 Límites que permanecen
- Servicios solo por persona (sin rangos por grupo ni temporadas, no aplican a infantes); una opción = un hotel + un vuelo.
- El cotizador público no tiene captcha ni límite por IP: solo el tope por contacto en la base.
- Si la agencia no tiene RNT cargado, el documento muestra «RNT» vacío (dato de `agencias`, no del código).
- Un paquete nuevo guardado redirige a su página de edición y el aviso «Paquete guardado» no se alcanza a ver (el formulario se remonta).
- Cotizar con el visitante crea un contacto en el CRM por cada correo o teléfono nuevo; el alta se omite si ya existe (colisión 23505, igual que el checkout).
- `test_274_paquete_dinamico.sql` y `test_274_rls_por_rol.sql` describen la 274 sola; con la 275 sus cotizaciones dejan de pasar (se exige paquete publicado y fechas válidas).

### 4.7 Cómo se verificó (local, desechable)
- PostgreSQL (imagen Supabase) con el esquema hasta la 273, luego 274 → 275: `test_275_paquete_dinamico_auditoria.sql` (90 controles; contra la 274 sola, 74 fallan), preflight,
  postcheck y rollback de ambas, y re-aplicación idempotente.
- App local (`next dev`) sobre PostgREST real, con un gateway mínimo que solo sustituye `/auth/v1/user` de GoTrue (cookie de sesión fabricada): cotización pública y B2B (Mayorista y
  Minorista), `/cot/<token>`, portal B2B, y el montaje del paquete en el dashboard (validación, checks → pestañas, ficha vinculable, vuelo de Empaquetados, servicio manual, guardar,
  recargar, publicar, ver en «Dinámicos», editar → queda sin publicar). No se probó login real ni renovación de sesión.
- 276: `test_276_paquete_dinamico_multidestino_ruta_proveedor.sql` (39 controles), preflight y postcheck de una consulta cada uno, rollback (deja la 275 con sus 90 controles en OK) y re-aplicación idempotente;
  recorrido en navegador del montaje (multidestino, ruta, proveedor de ficha, moneda, publicación) y de la venta tarjeta → checkout → cotización para visitante, aliado B2B e interno, más escrituras directas por PostgREST.

### 4.8 Feedback de Preview (migración 276, aditiva; no modifica la 274 ni la 275)
- **Multidestino explícito.** `paquete_din.multidestino`. Apagado, no hay destinos adicionales: el montaje oculta y vacía el selector y la base rechaza la escritura directa (`DIN_82_MULTIDESTINO`).
  Activo, solo se ofrecen y se aceptan destinos del MISMO país que el principal (`destinos.pais` comparado con `pais_comparable_67` de la 220); principal sin país, principal repetido o adicional de otro país → `DIN_82_PAIS`.
  Un vuelo o servicio solo puede ser de un destino del paquete (`DIN_82_DESTINO`). Los paquetes que ya tenían adicionales quedan con `multidestino = true` (backfill).
- **Ruta de vuelo derivada.** Vinculado a Empaquetados → la ruta es la del empaquetado (sin ruta → `DIN_82_RUTA`). Manual → `origen_iata` + `destino_iata` (3 letras, distintos) y la ruta se calcula
  (`BOG - CTG - BOG` con regreso, `BOG - CTG` sin él). El texto enviado se ignora: lo recalculan el servidor (`completarDesdeFichas`) y el trigger. Los vuelos manuales anteriores conservan su ruta libre hasta volver a guardar el paquete.
- **Proveedor de servicios vinculados.** Sale de `servicios_adicionales.proveedor_id` y su ficha en `proveedores`; no se escribe. Si la ficha no tiene proveedor, el formulario lo muestra («La ficha de X no tiene proveedor…»),
  el guardado avisa y **publicar se rechaza** (acción y trigger, que además relee la ficha al publicar). Sin proveedor tampoco habría a quién registrar el costo al convertir (el costo real ya exige proveedor).
- **Moneda.** El SERVICIO vinculado debe estar en la moneda del paquete (`DIN_82_MONEDA`; el montaje solo los ofrece de esa moneda). El HOTEL con ficha ya NO: la moneda de la ficha no lo oculta ni lo rechaza (migración 280 elimina `tg_din_hotel_moneda`) porque los importes manuales se ingresan en la moneda del paquete.
- **Guardado.** `guardar_paquete_din` se redefine (multidestino, IATA) y borra los hijos ANTES de actualizar la cabecera, para que las reglas de destino/moneda no choquen con hijos que el mismo guardado reemplaza.
  `hoteles_vinculables_din()` devuelve también la moneda.
- **Venta.** La tarjeta de «Dinámicos» solo elige hotel, habitaciones, vuelo/fechas y precio, y continúa a `/tarifario/checkout/dinamico` (el servidor vuelve a leer el paquete publicado de la agencia de la sesión y recalcula el precio).
  Ahí se captura al cliente con las mismas piezas del checkout habitual: sesión interna → número de documento + `BuscarTitular` (búsqueda de personas por documento existente); aliado B2B → titular del contrato; visitante → «Tus datos».
  El canal lo sigue resolviendo el servidor por la sesión. La tarjeta ya no tiene formulario de identidad ni recibe la Server Action.
- **Límite:** el carrito/checkout habitual (`/tarifario/checkout`) re-liquida desde las tablas del tarifario y no modela estos paquetes; por eso la continuación es una página hermana que reutiliza sus piezas de captura de cliente, no el mismo carrito. La venta asistida (interno a nombre de un aliado) no está en este flujo.
- **Pruebas SQL anteriores:** `test_275_*.sql` describe la 275 sola (con la 276 puesta, su fixture de vuelo con ruta libre «BOG-CTG» se rechaza por diseño); se corre antes de la 276 o tras su rollback. `test_276_*.sql` describe la 276 sola (con la 277 su hotel manual de ejemplo, sin capacidad ni edades, se rechaza por diseño).

### 4.9 Experiencia como la de los paquetes normales (migración 277)
- **Montaje del hotel.** Manual: pide la **capacidad máxima de niños por habitación** (0 a 2: el sistema cobra hasta Niño 1 y Niño 2 por habitación; se aplica igual a todas sus acomodaciones, simplificación de este producto) y los umbrales
  «infante hasta / niño hasta» (vienen prellenados con los del sistema, 2 y 10), y elige **categoría de habitación y plan de alimentación** con un selector de búsqueda y escritura (`ComboCreable.tsx`): una existente (catálogo general o ficha) o una NUEVA, que vale solo para este paquete (ver «Migración 280»). Con ficha: sugiere sus categorías y planes
  (si solo tiene uno, ya viene elegido) y **conserva sus reglas** (edades, capacidad por acomodación, pax mín/máx, solo adultos); no se piden otra vez ni se guardan copias. El servidor ya NO exige que estén en el catálogo (solo normaliza espacios y la escritura de una opción conocida, máx. 80); las columnas son `capacidad_ninos`, `edad_infante_max`,
  `edad_nino_max` (CHECK de rangos y trigger que las exige al insertar un hotel manual; los manuales anteriores quedan en NULL = sin validación de capacidad hasta volver a guardar el paquete).
- **Menores.** La tarjeta pregunta **si viajan menores** y solo entonces pide la cantidad y la edad de cada uno. Clasifica con los umbrales del hotel (`clasificarMenoresPorEdad`) y reparte por habitación (`distribuirPorHabitaciones`: Niño 1 y Niño 2 son
  **tarifas por habitación**, no rangos de edad, y así se le explica al cliente junto con las edades de ESE hotel); capacidad y pax con `validarReservaHabitaciones`. Todo está en `lib/paqueteDinamico/menores.ts` y lo usan igual la pantalla y el servidor;
  el servidor **ignora los conteos del navegador** y los recalcula de las edades (`resolverSeleccionDin`).
- **Servicios con ficha.** Ya no se tratan como manuales: en netas+markup el precio sale de la ficha al cotizar (vigencia por fecha del viaje, cobro por persona o por grupo con su rango de pasajeros, liquidación, **menores de 2 años** = tarifa de infante, sin silla y fuera del rango del grupo:
  `lib/paqueteDinamico/servicioFicha.ts` sobre `resolverTarifaServicio`/`costoServicioContrato`); en solo PVP el equipo escribe el PVP, pero la **capacidad** de la ficha se valida igual. Cinco niños con dos adultos en un servicio por grupo de 1–6 se rechazan con
  «cubre de 1 a 6 pasajeros… tu grupo es de 7». Los traslados/combos y los servicios con suplementos por horario no se pueden vincular (su precio depende de alcance y hora).
- **Tarjeta y checkout.** Secciones de hotel, alimentación, habitaciones, viajeros, vuelo (aerolínea, ruta, fechas, números y horarios de Empaquetados) y servicios (elegibles); el precio y las razones de rechazo los da el servidor (`evaluarSeleccionDin`, el mismo núcleo que cotiza). La selección viaja en la URL, se guarda en
  `sessionStorage` y «Cambiar la selección» vuelve a la tarjeta con todo lo elegido. Sesión interna / B2B / visitante igual que antes (BuscarTitular, portal, enlace público).
- **Solo PVP.** «PVP separado por componente» ya no muestra «Total declarado» (se retiró del formulario y el servidor nunca lo guarda); al cambiar de esquema o de modalidad se limpian en pantalla los precios de la inactiva y el servidor igualmente guarda solo los de la activa.
- **Servicios vinculados en solo PVP (unidad de cobro de la ficha).** El equipo sigue escribiendo el precio, pero la UNIDAD es la de la ficha (`lib/paqueteDinamico/serviciosVinculados.ts`, un solo resolutor para tarjeta, checkout, cotización y contrato):
  · **por grupo** → el PVP es el del GRUPO y se cobra **una vez** mientras los pasajeros con silla estén en el rango de la ficha (no una vez por adulto o niño); cantidad guardada = 1 grupo;
  · **por persona** → PVP × pasajeros con silla + PVP de infante × menores de 2 años. Si la ficha cobra al infante (tarifa > 0 o sin tarifa propia) el montaje **exige** el «PVP infante» (0 = gratis explícito; columna `paquete_din_servicios.pvp_infante`, migración 277) y el servidor lo revalida al guardar y al cotizar; si la ficha no lo cobra queda en 0 a la vista;
  · **precio general** → el servicio no lleva PVP, pero su capacidad se valida y guarda la misma cantidad.
  La **cantidad que queda para costos y CxP** se guarda en el nombre del componente («Cena show · 1 grupo (4 pasajeros con silla)», «Tour Islas · 4 personas + 1 infante (menor de 2 años)»), así se ve al registrar el costo real y en la CxP; en netas el costo sale de la ficha y no se pide registrarlo.
  `exige_costo` = true en solo PVP (por componente y general) y false en netas.
- **Vuelo por edades (vinculado a Empaquetados o manual).** Regla de reservas (`lib/reservar/menoresDeDos.ts`): el **menor de 2 años** paga solo el fee/PVP de infante y **no ocupa silla**; **desde los 2 años** paga la tarifa de adulto y **ocupa silla**. Se aplica por la EDAD declarada
  (`vueloPasajeros` en `calculo.ts`), no por las clases Niño 1 / Niño 2 / infante del hotel: un menor de 1 año que el hotel llama «niño» sigue pagando el fee de infante en el vuelo, y uno de 2 años que el hotel llama «infante» paga vuelo de adulto con silla. El vuelo ya no tiene tarifa
  de «niño»: el formulario pide solo adulto (y menor desde 2 años) e infante, con la regla a la vista; el `nino` guardado en paquetes anteriores se conserva pero no se usa ni cambia ningún importe. Tarjeta, checkout y cotización muestran «N sillas + M infantes sin silla»; el componente del vuelo guarda
  esa unidad en su nombre (se ve al registrar el costo y en la CxP del aéreo) y `payload.dinamico.pasajeros` deja `{adultos, menores, menoresDeDos, sillas}`. Los paquetes dinámicos no asignan sillas de inventario (no hay bloqueo): «sillas» es la cantidad que se cobra y se costea.
- **Ficha de servicio del montaje.** Nombre y botón de eliminar en la misma fila, proveedor y precios en rejilla de 2 columnas (1 en móvil) con la ayuda de cada campo debajo de él, y las reglas de cobro en una lista corta; sin desborde horizontal a 390 y 1280 px.
- **Límites:** los hoteles manuales anteriores no validan capacidad; la categoría y el plan son texto propio del paquete: solo la restricción de longitud ≤ 80 (migración 280) y la normalización del servidor; en solo PVP los servicios MANUALES siguen cobrando PVP × (adultos + niños) y el infante no paga (regla anterior, sin ficha);
  `Niño 1 / Niño 2` en el cálculo siguen siendo tarifas de la acomodación del hotel del paquete.

### 4.10 Información del hotel y editor compacto (migración 279, aditiva; no modifica la 274–277)
- **Datos.** Cada hotel del paquete guarda `estrellas` (1–5, NULL = sin dato; son las del HOTEL, no la categoría de habitación), `descripcion` y `ubicacion` (texto para el mapa, ≤ 500) además de `foto_url`. Nada se inventa: vacío = sin dato, y la tarjeta no
  muestra estrellas ni mapa.
- **Ficha vinculada.** Al elegirla, el montaje precarga estrellas/descripción/ubicación de `hoteles` (`catalogos.ts` → `cargarInfoHotelesFicha`); al guardar, el SERVIDOR las vuelve a leer de la ficha (autoritativo: lo que la ficha tiene gana; si no lo tiene, se conserva lo escrito)
  y las copia al hotel del paquete. Es una copia: editar la ficha después no cambia un paquete ya guardado hasta volver a guardarlo. Con ficha, esos campos se ven bloqueados cuando la ficha los aporta. Hotel manual: se escriben a mano.
- **Montaje.** `HotelFilaDin.tsx`: una fila resumen (nombre, tipo Manual/Ficha #id, estrellas, habitación, alimentación, proveedor, n.º de precios cargados) y dos ventanas (`components/ui/dialog.tsx`, base-ui: foco atrapado, Escape, clic fuera):
  «Información del hotel» (nombre, foto, estrellas, descripción, ubicación) y «Tarifas y configuración» (categoría, alimentación, proveedor, capacidad/edades de menores del hotel manual o reglas de la ficha, tarifas por acomodación según el esquema). Cada ventana edita una copia:
  «Guardar cambios» la aplica al formulario, «Cancelar»/Escape la descartan. Las ventanas siguen montadas (el foco vuelve al botón que las abrió) y `apertura` reinicia el borrador. El guardado del paquete y todas sus validaciones no cambiaron. `editorUi.tsx` aloja lo compartido (`GridAcom`, estilos).
- **Tarjeta pública.** `PorDinamicos.tsx` usa los componentes del hotel normal (`Categoria` para estrellas, `DescripcionHotelExpandible`, `UbicacionHotel` con mapa), y rotula la categoría de habitación («Habitación X · plan») para no confundirla con las estrellas.
- **Pruebas.** `pruebas/paqueteDinamico82HotelInfo.test.ts` (validación, copia de ficha, migración), `pruebas/hotelFilaDin82.react.ts` (fila, ventanas, teclado, ficha vs manual, tarjeta; en `test:react`), más el scripts `preflight/postcheck/rollback_279_…`.
  Verificado además en Chromium real (390 y 1280 px): sin desborde horizontal, diálogos dentro del viewport, Tab no sale de la ventana y Escape devuelve el foco.
- **Fallo al leer la ficha.** `cargarInfoHotelesFicha` lanza si Supabase devuelve error (nunca se confunde con «la ficha no tiene el dato»); `guardarPaqueteTotal` lo convierte en «No se pudo leer las estrellas, la descripción y la ubicación de la ficha del hotel vinculado. No se guardó nada…» y retorna ANTES de cualquier escritura. El precargado del montaje (`catalogos.ts`) solo degrada a vacío: el guardado vuelve a leer y se detiene. Prueba: `pruebas/paqueteDinamico82FichaFalla.test.ts` (ejecuta el `guardarPaqueteTotal` real con clientes falsos; sin escrituras ni RPC de guardado, paquete existente y nuevo).
- **Numeración.** La 278 es de #90 (`hotel_reglas_descuento`, ya en main); esta es la 279. Al integrar, correr `sh supabase/scripts/verificar_numeracion_migracion.sh 279 20260601000279_paquete_dinamico_hotel_info.sql` (revisa todas las ramas, remotos y worktrees; sale con 1 si hay colisión). Orden: preflight → 279 → postcheck → código.
- **Verificación en PostgreSQL local** (contenedor `pg275`, base desechable desde `plantilla275` + 274→277, todo con `supabase_admin`): preflight OK → 279 → postcheck 4/4 OK → `test_277` 29/29 (mismos resultados que antes de la 279) → `test_279_paquete_dinamico_hotel_info.sql` 16/16 → rollback (columnas fuera, función idéntica a la de la 277, `test_277` 29/29, postcheck da FALLA como debe) → 279 aplicada dos veces (idempotente) y todo de nuevo en verde. Cuerpo de `guardar_paquete_din`: la 279 difiere de la 277 solo en las dos líneas que añaden `estrellas, ubicacion`.

## 5. Auditoría: los cuatro bloqueos (migración 275, aditiva sobre la 274)

| Bloqueo | Corrección |
|---|---|
| Aislamiento por agencia | RLS de `paquete_din*` por AGENCIA con `puede_producto_din(tenant)`: superadmin cruza; gerencia/administración/operaciones solo su agencia (más estricto que `puede_ver_tenant`, porque guardan netas). Los hijos heredan del padre. `venta` y B2B no leen nada. El conteo para borrar destinos sale de `uso_destino_din` (solo números; ve las dos agencias). |
| Cotizar desde la pestaña pública | `crearCotizacionDin` resuelve el canal en el servidor (`resolverCanalDin`): sin sesión → **visitante** (`crear_cotizacion_din_externa('publico', null)`: sin autor ni propietario, `share_token` para `/cot/<token>`, contacto obligatorio, tope 5/hora por contacto, solo paquetes de mayorista); agencia/freelance activo → **B2B** (`'b2b'`, autor/propietario/aliado = el usuario; aparece en el portal por `creado_por`); personal → interno. Nunca se usa una identidad interna ficticia ni llegan costos al navegador. El titular entra al CRM por canal: el visitante en `crm_contactos`, el aliado B2B y el personal en el registro de personas (ver 4.5). |
| Publicación y fechas | `p82_priv.validar_solicitud` (usada por el camino interno y el externo): paquete **activo y publicado**, vigencia de compra, viaje futuro de exactamente `noches`, ventana de viaje, hotel/vuelo pertenecen al paquete y las fechas coinciden con las del vuelo. Espejo en TS: `validarSolicitudDin`. Todo en una transacción: un rechazo no deja cotización ni versión. |
| Hoteles vinculables | `hotel_vinculable_din`: desde la 280, ficha **activa** (antes exigía además no tener `hotel_temporadas`, `tarifa_hotel`, `hotel_tarifas_unidad` ni `hotel_calculadora`; ya no). El selector usa `hoteles_vinculables_din`; al guardar se valida de nuevo (acción + trigger `trg_din_hotel_vinculable`). El hotel manual sigue disponible. |
| Guardado parcial | `guardar_paquete_din` (SECURITY INVOKER, una transacción): ya no hay borrar/insertar hijos desde TypeScript ni restauración manual. Editar deja el paquete sin publicar. |

Pruebas: `supabase/scripts/test_275_paquete_dinamico_auditoria.sql` (JWT real por rol y agencia, canales, rechazos, atomicidad), `pruebas/paqueteDinamico82Auditoria.test.ts` (reglas puras y cableado). `test_274_paquete_dinamico.sql` y `test_274_rls_por_rol.sql` describen el comportamiento de la 274 sola.

## Migración 280 — la ficha aporta solo información; categoría y plan propios (#82)

- **Selector.** «Usar ficha de hotel existente» ofrece todas las fichas **activas** del destino principal, tengan o no temporadas, tarifas por persona/unidad o calculadora, y en cualquier moneda. `hotel_vinculable_din` solo exige `hoteles.activo`; `hoteles_vinculables_din` y el trigger `trg_din_hotel_vinculable` la usan sin redefinirse. Se elimina `tg_din_hotel_moneda` (la moneda de la ficha ya no condiciona: los importes del paquete se escriben en la moneda del paquete). El servicio vinculado sigue exigiendo su moneda.
- **Qué trae la ficha y qué no.** Trae nombre, fotos, estrellas, descripción, ubicación y reglas de menores (`fichas.ts`). **Nunca** lee ni copia `tarifa_hotel`, `hotel_temporadas`, `hotel_tarifas_unidad` ni `hotel_calculadora` (lo verifica `pruebas/paqueteDinamico82FichaSinTarifario.test.ts`). El precio sale solo de `paquete_din_hoteles.neto/pvp`: sin precios propios el guardado falla («Falta el precio del hotel…»), no se publica (`publicarPaqueteTotal` → `validarPaquete`) ni se cotiza (`liquidarPaquete` lanza).
- **Categoría y plan.** Texto del paquete: `ComboCreable` (búsqueda + escritura; ↓/↑/Enter/Escape; clic o toque abre la lista —no el foco, porque el diálogo enfoca el primer campo—; filas de 44 px). Un valor nuevo se normaliza y persiste en `paquete_din_hoteles.categoria/regimen`; no escribe en `categorias_habitacion`, `planes_alimentacion`, `hotel_categorias`/`hotel_regimenes` ni en la ficha. Lógica pura en `lib/paqueteDinamico/opcionesHotel.ts`.
- **Base.** Migración `20260601000280_paquete_dinamico_ficha_sin_tarifario.sql` (aditiva sobre 274–279) + `preflight_280_*`, `postcheck_280_*`, `rollback_280_*`, `test_280_*` (19 controles). Orden: preflight → 280 → postcheck → recién después el código. El rollback restaura la guarda y el trigger de moneda de la 275/276 (los paquetes ya guardados con fichas que tienen tarifario quedan guardados).
