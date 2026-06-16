# Futuro — Módulo de vuelos dinámicos (JetSMART / agregador) + empaquetado dinámico

> **Estado:** IDEA / plan a futuro. NO construir hasta que el dueño lo confirme
> ("ya hice X, arranquemos"). Este doc existe para que, cuando llegue ese momento,
> ya sepamos exactamente qué se quiere y cómo encaja.

## Qué quiere el dueño
1. Conectar la API de **JetSMART** para un módulo de **vuelos dinámicos**.
2. Combinar **vuelos dinámicos + los hoteles ya cargados** en el tarifario
   (empaquetado dinámico): vuelo en vivo + tarifa neta de hotel + markup = PVP.

## Realidad de JetSMART (verificado jun-2026)
- **No** hay API pública self-serve. Corre sobre **Navitaire New Skies** (Amadeus).
- Distribuye por **GDS (Amadeus)** y **conexión directa/API**, ambas con
  **channel fee por segmento, por pasajero** y **TTL de 12 h** para pagar/emitir.
- Es **ULCC** (grupo Indigo Partners): **pago inmediato con tarjeta** al reservar;
  no existe "emitir ahora y pagar después por BSP".

## Caminos para conectarse (recomendación: empezar por agregador)
- **A. Agregador (RECOMENDADO):** una sola API trae JetSMART + cientos de
  aerolíneas, resuelve rieles de pago, baja la barrera.
  - **Duffel** — moderno, "zero upfront", pago por uso, maneja el pago a la
    aerolínea (incluye tarjetas virtuales/VCC). El más rápido de arrancar.
  - **Travelfusion** — especialista LCC (370+), Direct Connect XML / Fast API.
    Más profundidad en ULCC pero más "enterprise" (depósito + acuerdo).
  - ⚠️ Confirmar con cada uno que **JetSMART Colombia** esté en su catálogo y
    pedir cotización (precios no públicos). Pedir también Avianca/Latam/Wingo
    para no depender de una sola aerolínea.
- **B. Directo JetSMART (Navitaire NDC):** dejar para cuando haya volumen que
  justifique ahorrarse el channel fee. Tú manejas pago/fraude/VCC.
- **C. GDS Amadeus:** requiere IATA/agencia + contrato Amadeus + fee/segmento.

## Qué necesitamos tener (checklist)
- **Legal:** razón social de agencia + contrato con el agregador (IATA NO es
  obligatorio con Duffel/Travelfusion; SÍ en GDS/directo). KYC del proveedor.
- **Financiero (clave en ULCC):** medio para pagar la aerolínea al instante
  (línea/depósito con el agregador o **tarjetas virtuales VCC**); manejar
  adquirencia y **riesgo de fraude** (reservas LCC con tarjeta son blanco).
- **Técnico:** backend server-side (llaves SOLO en env), flujo
  buscar→tarifar→reservar→pagar/emitir→guardar PNR; **webhooks** de cambios de
  horario y ancillaries (equipaje/asientos); manejo del **TTL 12 h** y
  **re-tarifación al reservar** (precio de vuelo perecedero); **PCI DSS** si se
  tocan datos de tarjeta (se minimiza con pago gestionado/VCC del agregador);
  **Habeas Data / Ley 1581** para PII de pasajeros.
- **Operativo:** reglas tarifarias, equipaje, cambios/cancelaciones, posventa.

## Cómo encaja en NUESTRO código
- Ya existe el tipo de paquete **"Dinámico"** ("vuelo y hotel tomados por sistema,
  no negociados"). Este módulo lo materializa.
- **Empaquetado dinámico = en nuestro sistema** (la aerolínea no sabe de hoteles):
  PVP = (tarifa vuelo en vivo API) + (tarifa neta hotel del tarifario) + markup.
- **Reserva en dos patas (saga):** pagar el vuelo YA (aerolínea) + reservar hotel
  contra allotment propio (flujo de CxP actual, pago después). Si una pata falla,
  compensar la otra — diseñar con cuidado.
- **Inventario:** vuelo = en vivo desde API; hotel = stock cargado.
- Encaja en el flujo actual `PRODUCTO → TARIFARIO → RESERVAR`, solo que el "vuelo"
  sale de la API en vez de un bloqueo.

## Esqueleto técnico propuesto (cuando se apruebe)
- Capa adaptadora `lib/flights/` con interfaz común `FlightProvider`
  (`buscar` / `tarifar` / `reservar`) y una implementación (Duffel o Travelfusion).
- Env vars para credenciales (server-side).
- Tablas nuevas: **ofertas (caché)**, **órdenes/PNR**, **pagos**.
- Paso de búsqueda de vuelos en **Reservar** para el tipo "dinámico".
- Entregable inicial sugerido: stub del adaptador (p. ej. Duffel) listo para
  enchufar la llave, sin lógica real de pago aún.

## Fuentes
- Navitaire PSS para LCCs — AltexSoft
- Navitaire NDC Gateway — navitaire.com/NDC
- JetSMART Centro de ayuda agencias — jetsmart.com
- Travelfusion (integración LCC) — software.travel
- Duffel / proveedores API de viajes 2026 — phptravels.com
