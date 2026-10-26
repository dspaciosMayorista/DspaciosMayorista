# Carrito → CxP en USD con equivalente en COP (#90 I · migración 236)

> Estado: **código y migración listos, NO aplicados en producción.** Orden de despliegue al final.
> Alcance: lo **operativo** (moneda correcta de cada costo, CxP en USD con su equivalente en COP congelado, devengo por ese equivalente, reintentos).
> Lo **contable** (diferencia de cambio, reportes en COP, conciliación histórica) sigue siendo C con #43 — ver "Límites".

## 1. Qué resuelve

- **H-1 (moneda mezclada).** Una oferta de carrito en USD cuyo servicio del catálogo pasó a COP después de cotizar (o al revés) sumaba importes de monedas distintas en `ventas.costo_*` o devengaba un nominal como si fuera la moneda del contrato. Ahora la moneda **actual** del costo debe ser la de la oferta; si no, la conversión se detiene **antes de numerar**.
- **CxP en USD del carrito.** Antes toda obligación positiva en USD detenía la conversión (la ruta financiera no tenía equivalente en COP). Ahora se registra: conserva su `valor_total` y `moneda` originales y lleva su equivalente en COP congelado a una **TRM de costos**.

## 2. Reglas (fuente única en `lib/reservar/monedaObligacionesCarrito.ts`)

| Costo (moneda hoy en el catálogo / bloqueo / hotel) | Oferta COP | Oferta USD |
|---|---|---|
| COP, importe > 0 | se crea (COP explícita) | **se rechaza** (H-1) |
| USD, importe > 0 | **se rechaza** (inverso) | se crea (USD) **y exige TRM de costos** |
| cualquier moneda, importe = 0 | no es obligación: no bloquea, no pide TRM | idem |
| sin moneda | COP (default histórico, explícito) | se rechaza (indeterminable) |
| otra moneda (EUR…) | se rechaza | se rechaza |

La revisión previa (`evaluarObligaciones`, antes de `siguienteNumeroContrato`) y la creación (`pushCxP` → `decidirCxP`) usan **la misma función**: no pueden divergir. `ventas.costo_*` queda en la moneda de la oferta (sumas nominales; no hay mezcla porque todo costo creado está en esa moneda).

## 3. TRM de costos ≠ TRM de cobro

- `lib/finanzas/costoTrmCarrito.ts` (puro): `validarTrmCosto`, `equivalenteCopCosto(valorUsd, trm)` (centavos), `decidirTrmCosto`, `leerTrmCostoCongelada`.
- Solo se pide si alguna obligación positiva está en USD; solo la ingresa **personal interno**; se congela en `cotizaciones.detalle.costo = { trm }` junto al primer contrato (un reintento con otra TRM se rechaza, igual que el cobro). Sin obligaciones en USD no se pide ni se guarda.
- La TRM de cobro (`ventas.trm_cobro`, migración 235) solo convierte el total que paga el cliente. Nunca entra al equivalente de costos (hay prueba de cableado).
- UI: campo "TRM de costos" en `ConvertirCarritoBtn.tsx`, solo si la oferta es USD (opcional en pantalla; el servidor decide si es obligatoria).
- Entrada nueva de `convertirCotizacionCarrito`: `opts.trmCosto`.

## 4. Modelo (migración 236)

`cuentas_por_pagar.valor_cop_costo numeric(15,2)` y `trm_costo numeric(15,4)`. **No** se reutilizan `valor_cop_63`/`trm_63`:

- las de #63 solo valen con su marca de aceptación (`aceptacion_63_id`/`obligacion_63`, FK a `p63_aceptacion`, único por obligación) y el lector contable (`resolverImporteContable63`) **falla cerrado** ante un equivalente sin esa marca;
- las del carrito no tienen oferta aceptada: la TRM la ingresa quien convierte.

Las dos familias son **excluyentes** en una fila. La base garantiza:

1. `cuentas_por_pagar_cop_costo_chk`: par completo; solo `moneda = 'USD'`; TRM > 0; equivalente ≥ 0; `|valor_cop_costo − round(valor_total × trm_costo, 2)| ≤ 0.01`; sin marca ni equivalente de #63. Vale en INSERT y en cualquier UPDATE (cambiar `valor_total` o la moneda queda rechazado).
2. `trg_cxp_costo_inmutable` (SQLSTATE `Z9610`): el par solo nace con la fila; no se agrega, cambia ni quita después.
3. `registrar_financiero_contrato` (reemplaza la de la 227; el camino #63 y el de siempre quedan idénticos): valida el par **antes de escribir**, una sola TRM por contrato, y que si una CxP del payload lo lleva, toda CxP en USD con importe lo lleve (nunca devengo mixto). Claves del payload: `valor_cop_costo`, `trm_costo` (distintas de las `valor_cop`/`trm` de #63, que este camino ignora).

## 5. Devengo, reconciliación, pagos

- **Devengo:** `postearAsientoCxP` → `importeCopCxP` lee las dos columnas y `resolverImporteContable63` (rama `resolverEquivalenteCosto`) devenga por el equivalente en COP, validado contra `valorTotal × TRM`, moneda USD, mismo contrato y agencia; cualquier incoherencia → error (nunca cae al nominal).
- **Reconciliación** (`reconciliacion-actions.ts`): reintenta el payload **guardado** en `contrato_financiero_pendiente` (con el equivalente ya decidido) y repone asientos faltantes por la misma lectura. No recalcula nada.
- **Pagos** (`pagos/actions.ts`): siguen en la moneda nominal de la CxP con la TRM del día de pago; la guarda de saldo (228) no cambia. El equivalente de devengo no se mueve al pagar.
- **Edición:** `actualizarCuentaPorPagar` rechaza con mensaje claro cambiar el valor de una CxP con equivalente (la base lo rechazaría igual); proveedor, servicio, vencimiento e IVA siguen editables.

## 6. Límites contables pendientes (C, con #43) — no cerrados aquí

- **Diferencia de cambio:** el devengo sale a la TRM de costos y los pagos a la TRM del día; la diferencia queda como saldo en Proveedores (prueba R8: 850.000 pagados − 780.000 devengados = 70.000 sin reconocer).
- Estados financieros / flujo de caja / rentabilidad siguen leyendo `valor_total` + TRM promedio; no usan `valor_cop_costo`.
- CxP en USD **históricas** o de otras rutas (p. ej. programas) siguen devengándose por su nominal: la 236 no las reclasifica (el preflight las cuenta).
- La rentabilidad por contrato USD sigue en la moneda del contrato.

## 7. Pruebas

- Unidad: `pruebas/monedaObligacionesCarrito.test.ts`, `pruebas/costoTrmCarrito90I.test.ts`, `pruebas/auditoria90H.test.ts` (H-1 activa: ambos sentidos, costo cero, grupo posterior), `pruebas/cobroCarritoConversion.test.ts`.
- SQL (Docker): `supabase/scripts/test_236_cxp_equivalente_costo.sql` (54), fases `test_236_fases.sh` (preflight → aplicar → postcheck → batería → no reaplicar → 10 roturas detectadas → rollback exacto → reaplicar).
- Aplicación contra Postgres (Docker): `supabase/scripts/test_236_app_carrito.sh` + `pruebas/carritoCostoUsd236.pg.ts` (17): contrato → CxP → devengo real → pagos → reconciliación, rechazos antes de numerar, cambios de catálogo y reintentos.
- Regresión #63: `test_235_moneda_cobro.sql` (88) y `test_227_salida_vinculada.sql` (214) pasan con la 236 aplicada encima.

## 8. Orden de despliegue

1. `preflight_236_cxp_equivalente_costo.sql` (una consulta; 0 `REVISAR`).
2. Aplicar `20260601000236_cxp_equivalente_costo_carrito.sql`.
3. `postcheck_236_cxp_equivalente_costo.sql` (una consulta; 0 `REVISAR`, huella igual a la del preflight).
4. **Después** desplegar el código. Si el código llega antes, la conversión con costos en USD se detiene antes de numerar (sondeo de las columnas) en vez de crear CxP sin equivalente.
5. Tras la primera conversión real en USD, repetir el postcheck.
- Rollback: `rollback_236_cxp_equivalente_costo.sql` (se niega si ya hay CxP con equivalente).
