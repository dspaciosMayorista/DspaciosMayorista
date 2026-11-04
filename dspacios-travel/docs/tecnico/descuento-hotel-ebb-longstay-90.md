# #90 — Descuentos de hotel EBB y Long Stay (migración 278)

## Regla de negocio
- **EBB**: por días entre la fecha de compra y el check-in. Configuración de ejemplo: ≥30 d → 18 %, ≥60 d → 23 %, ≥90 d → 28 %.
- **Long Stay**: ≥4 noches → 25 %.
- Si se cumplen varias: **un solo descuento, el mayor %** (nunca se suman ni encadenan). Ninguna cumplida = tarifa base.
- Los porcentajes y umbrales son **datos** en `hotel_reglas_descuento` (por hotel), no código. Nada menciona a ningún hotel: lo que se carga para un hotel rige en todos los flujos en que ese hotel se vende.

## Base del descuento
**Neta hotelera de la estadía** (suma noche por noche ya liquidada, cualquier acomodación, niño 1/2 e infante), **antes del markup**. `neta' = neta × (1 − pct)` → `marcar(neta', %mk)` → redondeo de venta de siempre. **No** se descuentan vuelo, servicios incluidos ni impuesto. Una estadía que cruza temporadas se liquida noche por noche con sus netas vigentes y el descuento se aplica al total. COP redondea a peso, USD a centavos. Venta, costo (`netos`) y CxP salen de la misma neta descontada. **Las netas y temporadas base no se tocan**: el descuento nunca se escribe en `tarifa_hotel` ni en `hotel_temporadas`.

## Fechas: cuál se usa en cada momento
| Momento | Fecha de compra usada | Dónde |
|---|---|---|
| Cotizar (porción/empaquetado/dinámico por fechas) | `fechaNegocio()` del servidor, día de hoy (America/Bogotá) | `cargarDatosHotelPaquete` (`cotizar.ts`) → `evaluarHotelPorFechas` |
| Cotizar o reservar lo **publicado** (bloqueo, empaquetado, salida) | `fechaNegocio()` del servidor, día de hoy | `computarReserva` (`computo.ts`) |
| **Convertir** una cotización abierta | el día de la conversión: se recalcula con la fecha de ESE día | `computarReserva` otra vez; `reservar/actions.ts` compara con lo cotizado |
| Confirmar con abono (venta ya creada) | **No se usa**: el precio quedó fijado al crear la venta/contrato | — |

El cliente nunca envía la fecha. La "compra" para el descuento es el instante en que se **crea la reserva** (venta pendiente), no el abono que la confirma después. Si la regla de negocio fuera "la fecha del primer abono", habría que reprecificar en la confirmación: **no está implementado** (ver límites).

**Cotizar un día y convertir otro**: una cotización guarda su precio de hoy; al convertir se recalcula con la fecha de ese día. Más cerca del check-in = menos descuento = precio mayor → la conversión existente rechaza con "el precio cambió desde que se generó la cotización" y pide generar una nueva. Nunca cambia en silencio. Si convierte el mismo día, el precio coincide.

## Cómo llega el descuento a cada flujo
Hay dos mecanismos de precio y las dos rutas aplican el descuento:

1. **Cálculo en vivo** (porción terrestre, dinámico y empaquetado con fechas; buscador por fechas): `evaluarHotelPorFechas` descuenta la neta antes del markup.
2. **Precio publicado** (bloqueo, empaquetado y salida cuando se reserva sobre la fila de `tarifario_resultado`): la fila publicada **guarda siempre la tarifa base**. Al cotizar o reservar, `computarReserva` recompone el PVP con `pvpPublicadoConDescuento` desde la composición que guardó el generador (`tarifario_resultado_composicion`: neta por acomodación, markup, vuelo, fee de infante, servicios): hotel descontado y marcado + servicios + vuelo, mismo redondeo que el motor vivo (probado igual en `descuentoHotelPublicado90.test.ts`). La neta/CxP viva se descuenta con el mismo porcentaje.
   - Por qué no se publica el precio ya descontado: un porcentaje que depende del día de la compra quedaría congelado en la fila y se vencería sin avisar (el viaje de mañana ya no tendría 90 días).
   - Falla cerrado: si hay un descuento aplicable y la composición publicada falta o no coincide exactamente con el PVP publicado, se rechaza con "regenera el tarifario del paquete". No se vende sin descuento ni se inventa un precio.
   - Hotel y paquete en monedas distintas (TRM): la neta se descuenta en la moneda del HOTEL (centavos USD) y luego se convierte (`netosOrigen` + `trm` de la composición), para que PVP, costo del contrato y CxP partan del mismo importe. Descontar la neta ya convertida desfasaba hasta centavos × TRM (ej. 989.412 vs 989.400 COP).
   - PVP fijo del infante: no se compone, queda como está.

| Superficie | Descuento |
|---|---|
| Reservar / cotizar / convertir porción, dinámico, empaquetado por fechas | Sí (en vivo) |
| Reservar / cotizar / convertir bloqueo, empaquetado y salida publicados | Sí (recomposición desde la composición publicada) |
| Tarifario publicado y vitrina ("desde"/lista) | **Muestran tarifa base**; el descuento aparece al cotizar con fechas |
| Porción "desde" sin estadía concreta | No (no hay fecha de ida ni noches) |

## Publicación
El publicador (`paquetes/actions.ts`, `lib/tarifario/vigencia.ts`) **no lee** `hotel_reglas_descuento`: publicar no depende de las reglas ni del día. Prueba de cableado en `descuentoHotelPublicado90.test.ts`.

## Pruebas
- `pruebas/descuentoHotel90.test.ts`: límites 29/30, 59/60, 89/90 días; 3/4 noches; solapamiento EBB+Long Stay; estadía que cruza temporadas; menores; USD; base antes del markup; reglas inválidas/inactivas.
- `pruebas/descuentoHotelPublicado90.test.ts`: lo publicado recompuesto == motor vivo en 10 combinaciones días/noches (con vuelo y fee de infante, menores de 2 años y USD); falla cerrado si el PVP o la neta no coinciden; servicios no se descuentan; fecha del servidor; el publicador no aplica descuento.
- `pruebas/descuentoHotelMonedas90.test.ts`: computarReserva REAL con hotel USD y paquete publicado COP a TRM 4000: PVP, neta, costo del contrato y CxP, límites 29/30, 3/4 noches, mayor descuento y fallas cerradas.
- `supabase/scripts/test_278_hotel_reglas_descuento.sql`: Postgres local desechable (preflight → migración → postcheck → constraints → RLS por rol → no reaplicable → rollback).

## Despliegue
preflight → `20260601000278_hotel_reglas_descuento.sql` → postcheck → código. Rollback: `supabase/scripts/rollback_278_hotel_reglas_descuento.sql`. Tabla vacía = ningún precio cambia; las reglas se cargan a propósito por hotel. **La 278 va ANTES que el código** y no hay tolerancia: si las reglas no se pueden leer (error, tabla ausente) o falta `SUPABASE_SERVICE_ROLE_KEY`, cotizar y convertir se rechazan con "No se pudieron validar las promociones del hotel"; nunca continúan a precio base.

## Límites conocidos
- No se pudo verificar en producción por qué flujos se vende Grand Sirenis San Andrés (sin SQL remoto): el diseño cubre todos los flujos de hotel por igual, así que no depende de la respuesta.
- La vitrina y el listado muestran tarifa base; el cliente ve el descuento al cotizar con fechas. Un contrato/cotización/documento no muestra todavía una línea "Descuento EBB/Long Stay": el precio ya viene descontado.
- Fecha de compra = creación de la reserva, no el primer abono (ver Fechas).
- Un bloqueo/empaquetado/salida publicado antes de la composición (migración 273) o con composición inexistente y un hotel con reglas queda sin vender hasta regenerar el tarifario.
