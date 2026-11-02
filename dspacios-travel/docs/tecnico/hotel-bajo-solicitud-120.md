# Hotel bajo solicitud (#120)

Un hotel del catálogo se **marca** `hoteles.tarifa_bajo_solicitud` (migración 270; la 269 es de SalesBot #56; marca apagada por defecto, sin backfill ni heurística) cuando se
ofrece sin tarifa publicada. Puede elegirse en paquetes de **bloqueo, empaquetado y porción terrestre** sin filas en `tarifa_hotel`. Solo aparece en los paquetes donde está
seleccionado (`armado_hoteles`). La marca es la **única fuente de verdad** (no hay modalidad por paquete).

## Flujo
1. **Montaje**: `HotelBajoSolicitudControl` (en `HotelConfigEditor`) → `setHotelBajoSolicitud`. La base impide: marcar con tarifas, marcar un hotel por unidad, cargar tarifas a un
   hotel marcado y **desmarcar** con solicitudes `pendiente_tarifa` o ya valoradas pero aún `abierta`. `generarTarifario` ignora las tarifas de un hotel marcado.
2. **Vista Booking**: `lib/tarifario/datosSolicitud.ts` (fuente paralela, patrón Bernalo) → `SolicitudHotelCard` con «Tarifa y disponibilidad bajo solicitud», sin precio ni «desde»,
   fuera del carrito; aparece aunque sea el único hotel del paquete («Bajo solicitud (N)»). Fechas de porción terrestre a mano (calendario compartido, sin valor por defecto).
3. **Aviso de acomodación ANTES de enviar** (`validarOcupacionSolicitud`, y de nuevo al crear): si la acomodación elegida no admite los niños/infantes declarados se dice el motivo y se
   bloquea el envío. Regla = la del motor (`lib/reservar/solicitudOcupacion.ts`): umbrales de edad del hotel + `hotel_acomodaciones`; **sin `hotel_acomodaciones` rigen los defaults del
   motor** (`defaultAcomConfig`: `pax_max` = pax de tarifa → una doble NO admite menores), así que un hotel sin configurar rechaza a los menores desde la solicitud, como lo haría al valorar o reservar.
4. **Solicitud**: `crearSolicitudHotel` crea una cotización **separada** `pendiente_tarifa` (precio 0, sin importes en payload/detalle; identidad B2B de la sesión; idempotente por clave).
   El cliente entra al CRM al crearla; al registro de personas (#42, migración 219: solo cotizaciones abiertas) entra al valorarse.
5. **Valoración** (`asignarNetaSolicitud`, roles de producto): ver «Regla de reparto». Recalcula el paquete COMPLETO con el motor existente (`evaluarHotelPorFechas` +
   `aplicarNetaSolicitud`: tarifa sintética por tipo en memoria, markup del paquete, vuelo, servicios incluidos, impuesto, redondeo) y la RPC `cargar_neta_solicitud` (271) congela
   neta + elección + precio y abre la cotización.
6. **Conversión**: `convertirCotizacion` lee neta y elección de la base y las **reacredita** (si los conteos por edad/acomodación cambiaron desde la valoración, se rechaza); el precio
   recalculado debe igualar el congelado; el costo del hotel del contrato y su CxP son la neta TOTAL exacta. Una cotización pendiente no se convierte (código y trigger).

## Regla de reparto (CONFIRMADA por el dueño — migración 271)
La neta es el **total del hotel para toda la estadía y todas las habitaciones**.
- **Sin niños**: el hotel se carga a los **adultos** (sin elección).
- **Con niños**: «Cargar hotel a los adultos» (niños con neta hotelera $0) o «Distribuir» (neta por adulto y por niño, para toda la estadía, que debe cumplir
  `adultos × netaAdulto + niños × netaNiño = neta total`, con tolerancia de **un centavo por persona**).
- **Infantes**: SIEMPRE neta hotelera $0 (`neta_infante = 0` por CHECK).
- **Conteos** (desde la solicitud guardada, no del navegador): adultos = los `adultos` reales declarados o, si no se declararon, habitaciones × pax de tarifa (ver «Ocupación REAL»); niños e infantes por edad con los umbrales del hotel (`clasificarMenoresPorEdad`) y repartidos
  por habitación (`distribuirPorHabitaciones`). Niño 1 y niño 2 comparten la neta del niño.
- **Privado**: modo + conteos + importes por tipo viven en `cotizacion_tarifa_solicitud` (RLS de producto), nunca en `payload`/`detalle`. Misma elección = no-op; otra neta u otra distribución = rechazo.
- **PVP por tipo**: el del motor (`marcar`/`componerTarifa`/`redondearVenta`) con la neta por persona de cada tipo; el infante paga servicios y vuelo (o su fee si es menor de 2 años) y hotel $0.

### Mismo total en «adultos» y en «distribuir» (regla CONFIRMADA — cierre #120)
El total vendido NO depende de cómo se reparta la neta. **Total de referencia = el de «Cargar hotel a los adultos»** con la misma neta (el motor de siempre, redondeo por persona al millar en COP / al
dólar en USD). «Distribuir» cambia los importes por viajero; como cada importe se redondea por persona, la suma puede diferir (p. ej. 3.150.000 vs 3.151.000). **Dónde se absorbe el residuo (determinista y
documentado):** en UNA línea explícita «Ajuste de redondeo del reparto del hotel» (puede ser ±; adultos 1 × importe) en los ítems de la cotización y del contrato, y dentro de `precio_venta`. No se esconde en el importe
de un viajero ni toca el costo del hotel, la CxP ni la neta (siguen siendo la neta TOTAL exacta). No es una regla comercial nueva: solo hace que el total sea el mismo que sin repartir; la línea se ve en el documento.
- Cálculo: `computarReserva` corre una segunda vez con el reparto de REFERENCIA (`repartoDeReferencia`: misma neta, todo a adultos, `referencia: true` para no recurrir) y `ajusteRedondeoReparto` fija el residuo.
- **Tope de seguridad**: si el residuo supera una unidad de redondeo por persona que carga hotel (1.000 COP / 1 USD × (adultos + niños)) NO es redondeo y se rechaza la valoración en vez de absorberlo.
- «Cargar hotel a los adultos» nunca lleva ajuste (es la referencia). El total congelado incluye el ajuste; al convertir se recalcula y debe ser idéntico.
- Sin esquema nuevo: el ajuste se recalcula del mismo cómputo (no se guarda aparte).

### Ocupación REAL: una doble con 1 adulto + 1 niño = 2 viajeros (regla CONFIRMADA — cierre #120)
La solicitud puede declarar `adultos` (los que viajan de verdad; opcional, 1..40; en el payload como `adultosReales`). Sin declararlo, los adultos son las plazas de las habitaciones (como siempre).
- **Hotel**: el niño ocupa la plaza que se cobra como adulto (`pax_tarifa`); el hotel sigue cobrando esas plazas pero con la neta por tipo (adultos: neta del adulto; niño: neta del niño, o $0 en «adultos»).
- **Vuelo, sillas, servicios, contrato**: rigen las personas REALES: la línea del hotel lleva los adultos reales (`1 hab Doble (1 pax)` + línea del niño), `paxConSilla` = adultos reales + niños ≥ 2 años (sillas, aéreo, CxP aérea,
  servicios por persona/grupo, impuesto/BNC), `ventas.pax` y `contrato_pasajeros` = personas reales. No se crea ningún pasajero, silla ni ítem ficticio.
- **Reglas** (`repartirAdultosReales`, `errorPlazasLibres`, `distribuirPorHabitaciones` con `adultosPorHabitacion`): al menos 1 adulto por habitación; las plazas libres se quitan de la primera habitación que pueda cederlas; **solo un niño**
  (no un infante) ocupa una plaza libre; los niños adicionales siguen necesitando cupo (`pax_max − adultos reales`); el hotel debe admitir niños en esa habitación (`chd_max`). `adt_min/adt_max` describen las plazas cobradas (`pax_tarifa`), no los adultos reales.
- **Conteos congelados** (`cotizacion_tarifa_solicitud.adultos/ninos/infantes`) son los reales: «Distribuir» usa 1 adulto y 1 niño; «adultos» → ese adulto asume la neta hotelera.
- **Hoteles tarifados sin cambios**: `adultosReales` solo se honra cuando el servidor pasa la neta de una solicitud (`solicitud ? input.adultosReales : undefined`); `distribuirPorHabitaciones`/`validarReservaHabitaciones` ganaron un parámetro opcional que, ausente,
  deja el comportamiento idéntico. Un `adultosReales` colado en una reserva de un hotel tarifado se ignora (probado en el e2e).
- **Hotel sin `hotel_acomodaciones`** (defaults del motor, doble de 2): 1 adulto + 1 niño CABE (2 personas); 1 adulto + 2 niños no.

### Reglas comerciales NO definidas / decisiones señaladas (no inventadas)
1. **Redondeo por persona**: se mantiene por persona (como todo el tarifario); lo que cambia es que el residuo entre modos se acredita en la línea explícita de arriba.
2. **Niño 1 / Niño 2 de un niño en plaza**: el niño que ocupa la plaza libre se cuenta como niño de la habitación (Niño 1 primero); sus importes son los de niño del motor (misma neta de niño).
3. **`chd_min` del hotel**: los niños que ocupan plazas libres cuentan para el mínimo de niños de la habitación (el mínimo efectivo es el mayor entre `chd_min` y las plazas libres).
4. **Hotel sin `hotel_acomodaciones`**: se rechazan los niños ADICIONALES a las plazas; para admitirlos hay que configurar las acomodaciones del hotel.
5. **Neta por persona exacta vs centavos**: en «adultos» la neta por adulto se guarda a 6 decimales; en «distribuir» a centavos. El costo del contrato y la CxP siempre son la neta total exacta.

## Cierre: `cotizaciones.pax`, presentación al cliente y TRM de costos en USD

### `cotizaciones.pax` = personas REALES
`crearSolicitudHotel` creaba la cotización pendiente con `pax = 0` y la valoración nunca lo actualizaba: la ficha interna mostraba «Pasajeros 0» y, al convertir, el formulario pedía **1 solo pasajero** aunque viajaran 2 o 3
(las pruebas llamaban la acción de conversión directamente y no lo veían; lo detectó el navegador). Ahora nace con `adultos + niños + infantes` reales (los mismos conteos con que ya se validó la acomodación). Prueba roja → verde:
`cotizaciones.pax` era 0 y se esperaba 2 (1 adulto + 1 niño) y 3 (con infante). El número de filas del formulario y el `pax` del contrato siguen esa cifra.

### La línea de ajuste de redondeo en los documentos de cliente
`/cot/[token]`, `/cotizacion/[id]` y el documento del contrato (`ContratoDocumento`) la rotulan **«Ajuste por redondeo»**, con «—» en Adultos, Niños, Tarifa Adulto y Tarifa Niño y el importe (±) solo en «Valor total». El texto completo
(«Ajuste de redondeo del reparto del hotel», constante `DESCRIPCION_AJUSTE_REDONDEO`) queda guardado en los ítems de la cotización y del contrato (lo ve el editor interno del contrato y la base); la presentación es solo un render
(`esLineaAjusteRedondeo` compara con esa constante única, `ETIQUETA_AJUSTE_CLIENTE` es el rótulo). **No cambia ningún importe**: la suma de ítems y el total congelado son los mismos (prueba: las filas del documento suman el total). Ninguna otra
lógica depende del texto: las demás apariciones de «Ajuste de redondeo» en el código son de OTRA función (centavos de las comparativas #75).
La ficha interna de la cotización y la ficha del contrato **no listan ítems** (muestran Pasajeros, precio, saldo…); el detalle completo está en el editor de contenido del contrato y en la base.

### TRM de COSTOS: contrato en USD (hotel a solicitud Y hotel tarifado: mismo camino)
**Defecto:** en la reserva por persona (`convertirCotizacion` → `reservarDesdeTarifarioInterno`) con hotel en USD, la CxP se guardaba con el importe en dólares pero `moneda = 'COP'` (el default de la RPC) y sin `trm_costo`/`valor_cop_costo`:
`/dashboard/pagos` la mostraba en pesos y sumaba dólares dentro del resumen de pesos, y el devengo contable usaba el nominal en dólares como si fueran pesos. El carrito (#90 I) y los programas (#88) ya resolvían esto con la migración 236.
**Corrección (reutiliza ese mecanismo, no inventa otro):**
- `convertirCotizacion(..., trmCosto)`: la TRM de costos (pesos por dólar) la ingresa el personal interno (`decidirTrmCosto`, `validarTrmCosto` de `lib/finanzas/costoTrmCarrito.ts`); **no se infiere de ninguna tasa de referencia**.
- Antes de numerar (paso 2e de `reservarDesdeTarifarioInterno`) se calculan las obligaciones; si alguna es positiva y no hay TRM válida, la operación se detiene con el mensaje en español de siempre («…ingresa la TRM de costos…») **sin crear venta, CxP, pasajeros ni sillas**
  (probado: el estado de la base no cambia). También se comprueba antes de numerar que la base tenga las columnas de la 236 (si no, mensaje claro y nada se crea).
- Con TRM: cada CxP se escribe con `moneda = 'USD'`, su importe en USD a centavos, `trm_costo` y `valor_cop_costo = valor × TRM` (`cxpEnUsdConEquivalente`), en la misma transacción financiera (`registrar_financiero_contrato`). El devengo contable usa ese equivalente
  (probado: el asiento del hotel de 1.000 USD a TRM 4.000,5 es 4.000.500). `ventas.costo_*` quedan nominales en USD (como en el carrito).
- UI: campo «TRM de costos (COP por USD)» en la ficha de la cotización cuando está en USD (`pideTrmCosto`), obligatorio.
- `/dashboard/pagos`: una CxP USD aparece en USD (resumen separado por moneda, saldo y pagos en USD con la TRM del día) y el detalle muestra «Equivalente en pesos (TRM de costos …)». El equivalente se consulta aparte y tolerante (sin la 236 la lista sigue funcionando).
- **COP: idéntico.** El bloque solo se ejecuta si la moneda del contrato es USD; las CxP de un contrato en COP no cambian (sin moneda explícita, sin TRM de costos; probado).
**Qué cambia exactamente para USD tarifado (corrección del mismo defecto):** (1) convertir exige la TRM de costos; (2) la CxP queda en USD con su equivalente; (3) solo el personal interno puede convertir un contrato en USD con costos en dólares (un rol externo recibe el mensaje de «solo el personal interno puede
ingresar la TRM de costos»); (4) **requiere la migración 236 aplicada** — sin ella los contratos en USD por persona se detienen antes de numerar (antes se creaban con la CxP mal rotulada en COP). No hay migración nueva ni se tocaron 270/271.
*Límites contables (los mismos del carrito, #43):* diferencia de cambio entre el devengo (TRM de costos) y los pagos (TRM del día) sin reconocer; estados financieros/rentabilidad siguen leyendo el nominal; las CxP en USD históricas no se reclasifican.

## Pruebas
Unitarias/wiring: `pruebas/hotelASolicitud.test.ts`, `hotelASolicitudWiring.test.ts`, `hotelASolicitudReparto.wiring.test.ts`. Postgres real: `test_270_hotel_a_solicitud.{sh,sql}` (esquema, candados).
**Recorrido completo** `supabase/scripts/test_270_e2e.sh` + `pruebas/hotelASolicitud270.pg.ts` (PostgREST local; aplica 255–268, 270 y 271 con preflight/postcheck): solicitud → valoración (adultos / distribuir)
→ conversión → contrato/vuelo/sillas/CxP aérea y de hotel. Preflight/postcheck: `{preflight,postcheck}_270_*`, `{preflight,postcheck}_271_*`; rollback `rollback_270_*`, `rollback_271_*`.
Navegador: `navegador_270.sh` + `revision_navegador_270.mjs` (Playwright con Chrome local).

## Vista Booking y formulario (ajustes PR #432)
- **Portada** (sin búsqueda ni destino): «Hoteles recomendados» primero, con la nota de selección inicial (`NOTA_RECOMENDADOS`), y después, separada por un borde, la sección «Hoteles bajo solicitud» con **máx. 2 tarjetas por paquete** (`limitarPorPaquete`, después de aplicar Pet friendly/Adults Only). `lib/tarifario/solicitudVista.ts` (puro).
- **Resultados de una búsqueda/destino**: los bajo solicitud entran a la MISMA lista (`itemRestoDeSolicitud`, sin precio, condición/política «desconocido») y pasan por zona, estrellas, Pet friendly, Adults Only y el orden; `TarifarioPublic` les aplica además texto, categoría y régimen contra el catálogo configurado del propio hotel (acomodación los excluye: no tienen tarifa por acomodación). Sin límite de 2.
- **Tarjeta**: mismo carrusel y proporción 16:10 que un hotel con tarifa (`CarruselFotoHotel`) con todas las fotos de `hotel_fotos` (portada primero).
- **Formulario**: «¿Viajan menores?» primero; las edades solo con Sí y nunca se envían con No (el servidor también lo rechaza: `viajanMenores`). Tipo de habitación y plan de alimentación son selectores con `hotel_categorias`/`hotel_regimenes` de ESE hotel; el servidor los acredita (`acreditarSeleccionCatalogo`) y guarda el texto canónico. Un hotel sin esos datos configurados no muestra selector (ni texto libre) y queda «A confirmar».
