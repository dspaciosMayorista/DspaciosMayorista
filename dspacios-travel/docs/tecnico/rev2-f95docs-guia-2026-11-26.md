# Guía del dueño — documentos del bloque #95 (B95-01, B95-02, B95-15, B95-16, B95-18, B95-19, B95-20)

Texto para la guía consolidada (español). Datos de ejemplo sintéticos; las cifras salen de la propia pantalla de revisión. **Antes / ahora** explica qué existía y qué es nuevo.

## B95-01 — Generar el tarifario del paquete «B95 Porción terrestre — Hotel Mar»

- **Cuenta:** operaciones@consolidada.test · **Enlace:** http://localhost:3090/dashboard/paquetes/80101
- **Qué hacer:** abre el paquete, pestaña «Tarifario resultado» y pulsa «Generar tarifario».
- **Qué debe verse:** el estado pasa a «Publicado» con tarifas generadas (doble, sencilla, triple, niño, infante y la asistencia opcional).
- **Antes / ahora:** **no es una función nueva.** El botón existe desde que se armaron los paquetes. Este paso está en la guía solo para **crear con la pantalla** el dato que usan B95-02…B95-04 (la semilla no trae datos derivados a propósito). Es cobertura de regresión y prerrequisito, no una mejora de este lote.

## B95-02 — Reservar con la asistencia opcional: la asistencia ya no lleva precio propio

- **Cuenta:** superadmin@consolidada.test · **Enlace:** http://localhost:3090/dashboard/reservar/nuevo?paquete=80101&hotel=80201&modulo=porcion_terrestre
- **Qué hacer:** como hasta ahora (fechas a 90 días, 1 habitación Doble, marcar «Asistencia médica B95», cliente «Cliente B95 Reserva», 2 pasajeros, «Generar cotización» y «Confirmar → generar contrato»). Después abre **el documento del contrato** (botón «Ver / Imprimir» o `/contrato/<número>`).
- **Qué debe verse:** en «Valores y Pagos» **una sola fila del paquete** (Adultos 2) cuya tarifa por adulto ya incluye la asistencia. Debajo, el bloque «Servicios incluidos» describe «Asistencia médica B95» (qué es, fechas, a quién cubre) **sin ningún importe**; la antigua tabla «Servicios adicionales · Valor total» ya no existe. La suma de las filas es exactamente el «Total del contrato».
- **Antes / ahora:** antes el documento imprimía «Asistencia médica B95 · 2 pax · $76.000» como un valor separado (lo que viste en la captura). Ahora el servicio se explica sin precio y su importe va dentro de la tarifa de los adultos (la tarifa del niño, si hay, no cambia). Lo mismo vale para traslados, tours, «otro» y servicios manuales, en cotización o contrato, PVP o NETO, pesos o dólares. Los costos del proveedor y las obligaciones **siguen igual** en las vistas internas.

## B95-15 — Cotización manual con hotel del catálogo: el documento muestra el hotel

- **Cuenta:** superadmin@consolidada.test · **Enlace:** http://localhost:3090/dashboard/cotizaciones/nueva
- **Qué hacer:** como hasta ahora (hotel del catálogo, categoría «Superior B95», régimen «PAM», pago previo, «Generar cotización»). Abre «Ver / Imprimir cotización».
- **Qué debe verse:** una sección **«Hoteles y Servicios»** con el hotel elegido, su categoría, la **alimentación (PAM)**, la **acomodación** y las fechas del viaje; la fila agrupada «PAQUETE TURÍSTICO A …» sigue siendo una sola. **No** aparecen el proveedor, la plataforma, cómo se compró ni costos.
- **Antes / ahora:** antes la cotización solo decía «PAQUETE TURÍSTICO …» y el cliente no veía qué hotel ni qué plan había elegido. Ahora lo ve (decisión O-3 del informe: confirma que está bien nombrar el hotel en la cotización).

## B95-16 — Comparativa desde el tarifario

- **Qué debe verse / cómo se prueba:** la comparativa que se crea desde el **tarifario** (carrito) **no usa** la conversión de las cotizaciones manuales: sus contratos ya escriben el hotel, la categoría, el régimen y las fechas, y sus documentos usan el resumen por pasajero. Por eso el defecto del hotel ausente era **solo de la ruta manual**. Sí le afectan (y quedan corregidos) la regla «servicios sin precio propio» y la desaparición de la fila de ajuste en el documento. Ver el informe `rev2-f95docs-2026-11-26.md` §B95-16.

## B95-18 — Elegir la opción B y convertirla en contrato

- **Cuenta:** administracion@consolidada.test · **Enlace:** http://localhost:3090/dashboard/cotizaciones
- **Qué hacer:** igual que antes (Elegir esta opción en la Opción B, pagos previos hasta el mínimo, «Generar contrato →»). Abre el documento del contrato.
- **Qué debe verse:** «Hoteles y Servicios» con **Hotel B · Estándar**, ciudad, **Alimentación PC**, acomodación y fechas; «Incluye / No incluye» **de la Opción B** (nada de la A); **una** fila agrupada: 2 adultos, 1 niño, tarifa por adulto **$715.227,50**, tarifa del niño **$150.000** y Valor total **$1.580.455**. **No hay fila «Ajuste por redondeo».**
- **Antes / ahora:** antes el contrato no traía el hotel ni las inclusiones (solo un texto «Servicio / Plan») y mostraba una fila «Ajuste por redondeo» de −$1. Ahora las trae y el −$1 va dentro de la tarifa del adulto (2 × 715.227,50 + 150.000 = 1.580.455). Lo guardado en la base **no cambió**: las líneas siguen sumando el precio exacto (715.228 × 2 − 1 + 150.000).

## B95-19 — Pagar por completo: saldo cero y sin fila de ajuste

- **Cuenta:** administracion@consolidada.test · **Enlace:** http://localhost:3090/dashboard/contratos
- **Qué hacer:** registra el abono por el saldo y abre el documento.
- **Qué debe verse:** «Pagado $1.580.455», «Saldo pendiente $0»; **ninguna** fila «Ajuste por redondeo»; la tarifa del adulto sigue siendo $715.227,50.
- **Antes / ahora:** antes el documento imprimía la fila «Ajuste por redondeo». Ahora no; el total y el saldo cero son los mismos.

## B95-20 — Comparativa en dólares

- **Cuenta:** superadmin@consolidada.test · **Enlace:** http://localhost:3090/dashboard/cotizaciones/nueva
- **Qué debe verse (al abrir el documento del contrato de la Opción B):** total **USD $1,582.55**, niño **USD $150.55**, **sin** fila de ajuste. La tarifa por adulto (3 adultos) sale **USD $477.33**, la del niño **USD $150.55** y el valor total de la fila **USD $1,582.55** (3 adultos = USD 1.432,00 exactos; 3 × 477,33 = 1.431,99: el centavo restante queda dentro del total exacto; es la decisión **O-1** del informe). En 390 px no se corta.
- **Pregunta para ti (O-1):** ¿aceptas que en los casos que no se dividen en centavos exactos se imprima la tarifa a su precisión (USD 477,33) junto al total exacto, como ya hace el resumen por pasajero del carrito? Las alternativas que descartaste (fila de ajuste, reparto «1 × … + 2 × …») no se usan.
