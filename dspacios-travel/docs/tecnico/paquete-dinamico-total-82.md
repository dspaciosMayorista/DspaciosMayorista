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
- El selector «traer hotel con ficha» ofrece solo fichas activas sin vigencias ni tarifas (`hoteles_vinculables_din`); se vuelve a validar al guardar
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
- **Moneda.** El servicio y el hotel ficha vinculados deben estar en la moneda del paquete (`DIN_82_MONEDA`); el montaje solo los ofrece de esa moneda y cambiar la moneda con vinculados en otra se rechaza.
- **Guardado.** `guardar_paquete_din` se redefine (multidestino, IATA) y borra los hijos ANTES de actualizar la cabecera, para que las reglas de destino/moneda no choquen con hijos que el mismo guardado reemplaza.
  `hoteles_vinculables_din()` devuelve también la moneda.
- **Venta.** La tarjeta de «Dinámicos» solo elige hotel, habitaciones, vuelo/fechas y precio, y continúa a `/tarifario/checkout/dinamico` (el servidor vuelve a leer el paquete publicado de la agencia de la sesión y recalcula el precio).
  Ahí se captura al cliente con las mismas piezas del checkout habitual: sesión interna → número de documento + `BuscarTitular` (búsqueda de personas por documento existente); aliado B2B → titular del contrato; visitante → «Tus datos».
  El canal lo sigue resolviendo el servidor por la sesión. La tarjeta ya no tiene formulario de identidad ni recibe la Server Action.
- **Límite:** el carrito/checkout habitual (`/tarifario/checkout`) re-liquida desde las tablas del tarifario y no modela estos paquetes; por eso la continuación es una página hermana que reutiliza sus piezas de captura de cliente, no el mismo carrito. La venta asistida (interno a nombre de un aliado) no está en este flujo.
- **Pruebas SQL anteriores:** `test_275_*.sql` describe la 275 sola (con la 276 puesta, su fixture de vuelo con ruta libre «BOG-CTG» se rechaza por diseño); se corre antes de la 276 o tras su rollback.

## 5. Auditoría: los cuatro bloqueos (migración 275, aditiva sobre la 274)

| Bloqueo | Corrección |
|---|---|
| Aislamiento por agencia | RLS de `paquete_din*` por AGENCIA con `puede_producto_din(tenant)`: superadmin cruza; gerencia/administración/operaciones solo su agencia (más estricto que `puede_ver_tenant`, porque guardan netas). Los hijos heredan del padre. `venta` y B2B no leen nada. El conteo para borrar destinos sale de `uso_destino_din` (solo números; ve las dos agencias). |
| Cotizar desde la pestaña pública | `crearCotizacionDin` resuelve el canal en el servidor (`resolverCanalDin`): sin sesión → **visitante** (`crear_cotizacion_din_externa('publico', null)`: sin autor ni propietario, `share_token` para `/cot/<token>`, contacto obligatorio, tope 5/hora por contacto, solo paquetes de mayorista); agencia/freelance activo → **B2B** (`'b2b'`, autor/propietario/aliado = el usuario; aparece en el portal por `creado_por`); personal → interno. Nunca se usa una identidad interna ficticia ni llegan costos al navegador. El titular entra al CRM por canal: el visitante en `crm_contactos`, el aliado B2B y el personal en el registro de personas (ver 4.5). |
| Publicación y fechas | `p82_priv.validar_solicitud` (usada por el camino interno y el externo): paquete **activo y publicado**, vigencia de compra, viaje futuro de exactamente `noches`, ventana de viaje, hotel/vuelo pertenecen al paquete y las fechas coinciden con las del vuelo. Espejo en TS: `validarSolicitudDin`. Todo en una transacción: un rechazo no deja cotización ni versión. |
| Hoteles vinculables | `hotel_vinculable_din`: ficha activa **sin** `hotel_temporadas`, `tarifa_hotel`, `hotel_tarifas_unidad` ni `hotel_calculadora`. El selector usa `hoteles_vinculables_din`; al guardar se valida de nuevo (acción + trigger `trg_din_hotel_vinculable`). El hotel manual sigue disponible. |
| Guardado parcial | `guardar_paquete_din` (SECURITY INVOKER, una transacción): ya no hay borrar/insertar hijos desde TypeScript ni restauración manual. Editar deja el paquete sin publicar. |

Pruebas: `supabase/scripts/test_275_paquete_dinamico_auditoria.sql` (JWT real por rol y agencia, canales, rechazos, atomicidad), `pruebas/paqueteDinamico82Auditoria.test.ts` (reglas puras y cableado). `test_274_paquete_dinamico.sql` y `test_274_rls_por_rol.sql` describen el comportamiento de la 274 sola.
