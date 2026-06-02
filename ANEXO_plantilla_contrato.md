# Anexo — Plantilla del contrato (generador de PDF)

> Especificación del documento "Contrato de Servicios Turísticos" de D'spacios Travel.
> Basada en un contrato real (ref. 00-00481). El generador arma este PDF a partir de
> una venta. **Distingue lo FIJO (plantilla) de lo DINÁMICO (se llena por contrato).**

---

## A. Datos de la empresa (FIJOS — constantes en todos los contratos)

- Razón social: **D'Spacios Travel S.A.S.**
- NIT: **901.654.224**
- RNT: **147090**
- Sitio: **Dspaciostravel.com** · correo: **contacto@dspaciostravel.com**
- Ciudad de emisión: **Medellín, Antioquia**
- Cuenta de pago: **Bancolombia, cuenta corriente 277-000056-23**, a nombre de D'Spacios Travel S.A.S.
- Logo D'spacios Travel (full color) en el encabezado + íconos de redes (Instagram, Facebook, WhatsApp).

## B. Estructura visual del PDF (FIJA)

1. **Encabezado:** logo (izq.) · título "Contrato de Servicios Turísticos" + nº contrato, fecha emisión,
   fecha viaje (centro) · enlace al sitio + redes (der.).
2. **Cliente** — bloque con campos en píldoras.
3. **Vuelos** — tarjetas por trayecto (aerolínea con ícono de avión).
4. **Hoteles y Servicios** — columnas: Asistencia médica · Servicio (plan) · Tours y traslados; debajo,
   tarjetas por hotel.
5. **Pasajeros** — tabla.
6. **Valores y Pagos** — tarjetas de totales + tabla "Detalle de valores".
7. **Cláusulas** (las 18, texto fijo — sección D).
8. **Firma del asesor** + datos bancarios + "Todos los derechos reservados © [año]".

Marca: usar tokens D'spacios (Jelly Bean Blue primario, etc.). El marbete de fondo es una marca de agua
con el isotipo. Mantener el aviso "no imprimir / contrato digital".

## C. Campos DINÁMICOS (se llenan al generar cada contrato, desde la venta)

- **Contrato:** numero_contrato, fecha_emision, fecha_viaje.
- **Cliente:** nombre, n°_documento, telefono, direccion.
- **Vuelos** (0..N trayectos, vienen del módulo de vuelos/sillas): aerolinea, origen (código + ciudad),
  destino (código + ciudad), servicios (equipaje), fecha_salida.
- **Hoteles** (1..N, vienen del tarifario): nombre, ciudad, alimentacion (plan), acomodacion,
  detalle_acomodacion, fecha_ingreso, fecha_salida.
- **Servicios:** asistencia_medica (sí/no), nombre_del_plan, descripcion_tours_y_traslados.
- **Pasajeros** (1..N): nombre, tipo_id, identificacion, fecha_nacimiento, edad (calculada).
- **Valores:** total_contrato, total_pagado, saldo_pendiente, moneda (def. COP);
  detalle por ítem: descripcion, adultos, ninos, tarifa_adulto, tarifa_nino.
- **Asesor que firma:** nombre, cargo, cc, telefono.

## D. Cláusulas (TEXTO FIJO — se escribe una sola vez en la plantilla)

Bloque "CONTRATO DE PRESTACIÓN DE SERVICIOS TURÍSTICOS" con encabezado fijo
("Entre el CLIENTE… y D'Spacios Travel S.A.S. …") y 18 cláusulas:

1. Objeto del contrato
2. Obligaciones de D'Spacios Travel
3. Obligaciones del cliente
4. Precio y formas de pago (incluye la cuenta Bancolombia y el abono inicial: tiquetes o 30%)
5. Penalidades por cancelación o no show (>30 días: 25% · 20–30 días: 40% · <20 días o no show: 100%)
6. Garantía de viaje / reprogramación sin penalidad (aviso dentro de 8 días)
7. Terminación y reembolsos (arras confirmatorias, art. 1859 C. Civil)
8. Responsabilidad (intermediario; presentarse 3h internacional / 2h nacional)
9. Declaración de veracidad y prevención de lavado de activos
10. Exoneración por documentación o requisitos migratorios
11. Garantía legal del servicio (15 días calendario)
12. Compromiso de protección infantil y ética (Ley 679/2001 y Ley 1336/2009)
13. Veracidad de los datos del cliente
14. Declaración de perfeccionamiento del contrato (se perfecciona con el primer pago)
15. Protección de datos personales (Ley 1581/2012)
16. Jurisdicción y ley aplicable (Medellín, Antioquia)
17. Aceptación por medio de pago
18. Contrato digital y compromiso ambiental (Ley 527/1999; solo formato digital)

> El texto íntegro de las cláusulas debe transcribirse tal cual del contrato actual.
> Guardarlas como constante/plantilla (no en base de datos), idealmente versionada,
> para poder actualizarlas si cambia el clausulado.

## E. Notas de implementación

- Generar el PDF en servidor a partir de plantilla HTML + los datos de la venta.
- El nº de contrato sigue el formato `00-00481` (ya es la llave que une venta ↔ sillas ↔ pagos).
- "Total pagado" y "saldo" se calculan desde la tabla `abonos`.
- Edad de cada pasajero se calcula desde fecha_nacimiento contra la fecha de viaje.
- Almacenar el PDF generado en Supabase Storage, vinculado al numero_contrato.
