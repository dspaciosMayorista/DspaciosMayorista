# Paquete dinámico: hotel negociado + vuelo "por sistema" (sin record)

> Idea del dueño (jun-2026). Plan de diseño antes de construir. NO empezar hasta
> confirmar las decisiones abiertas del final.

## Qué hace el dueño hoy (manual)
- No tiene bloqueo aéreo (sobre todo en **internacionales**).
- Toma **varias fechas de vuelo** de un destino (rutas, fechas, horarios, aerolínea
  = info que da la aerolínea / el sistema), pero **NO compra ni negocia** → **no hay
  record ni sillas**.
- Arma "salidas" combinando esas fechas con **hoteles negociados** (esos sí están en
  el sistema).
- Son **rotativas**: duran ~1 semana porque los tiquetes por sistema se actualizan.
- En esencia: **paquete solo-hotel (porción) + un valor adicional por vuelo + la info
  del vuelo**.

## Cómo encaja (sin romper lo existente)
Es un **4º tipo de paquete**, distinto de los 3 actuales (`bloqueo`,
`porcion_terrestre`, `servicios`):

| Tipo | Vuelo | Hotel | Inventario |
|---|---|---|---|
| bloqueo | record negociado (sillas/cupos) | negociado | **sillas** |
| porción terrestre | — | negociado | — |
| **dinámico (nuevo)** | **por sistema (manual, sin record)** | **negociado** | **sin sillas** |

Clave para "no afectar otras lógicas": **el vuelo dinámico NO toca `bloqueos_vuelo`
ni `sillas`**. Es una tabla nueva y un tipo nuevo. Reusa:
- La **liquidación de hotel noche-por-noche** de porción (`liquidarHotelPaquete`).
- La **vista de salidas** del tarifario (como Bloqueos, pero **sin cupos**).
- **Reservar por habitaciones** (igual que porción), **sin asignar sillas**.

## Modelo propuesto
- **Tipo de paquete** `dinamico` (nuevo valor; los switches `tipo` ya existen para
  bloqueo/porcion/servicios → se añade una rama, no se cambian las otras).
- Tabla nueva **`salidas_dinamicas`** (una salida = un vuelo por sistema):
  `paquete_id` (FK), `aerolinea`, `ruta` (IATA), `fecha_ida`, `fecha_regreso`,
  `hora_salida_ida/llegada_ida/salida_reg/llegada_reg`, `valor_tiquete` (neto por
  pax), `aplica_mk` / `ta` (markup o tarifa administrativa, como el vuelo de bloqueo),
  `valor_tiquete_nino` (opcional), `compra_inicio`/`compra_fin` (vigencia ~1 semana),
  `activo`, `notas`. **Sin `cupos` ni `sillas`.**
- Armado del paquete `dinamico`: elegir **destino + hoteles negociados** (reusa el
  picker de porción) + definir **N salidas** (las fechas/info/valor del vuelo).
- **Generar tarifario**: por cada `salida × hotel × categoría/régimen` →
  una fila con las fechas de la salida, **hotel liquidado por esas noches** + **valor
  del vuelo por pax** (`valor_tiquete/(1−mk)` o `+TA`). Se publica en un módulo
  **"Salidas dinámicas"** del tarifario (como Bloqueos pero sin cupos; respeta la
  vigencia de compra, igual que ya ocultamos lo vencido).
- **Reservar**: como porción (por habitaciones, re-liquida por las fechas de la
  salida), **sin sillas**; los **pasajeros van en el contrato** (no en una silla); el
  **costo aéreo** = `valor_tiquete × pax` → entra a `ventas.costo_aereo` + CxP del
  proveedor aéreo. La info del vuelo (ruta/horarios/aerolínea) se muestra en el
  contrato igual que un bloqueo.

## Por qué NO usar `bloqueos_vuelo` con un flag
- Toda la lógica de sillas/cupos/cambios/histórico de `bloqueos_vuelo` asume
  inventario; meter ahí "salidas sin record" obliga a poner `if` en muchos lados
  (cupos, sillas, dashboards). Una tabla aparte mantiene esa lógica intacta.

## Decisiones (RESPONDIDAS por el dueño · jun-2026)
1. **Salidas = por paquete.** Un **form** donde agrega las salidas que considere para ese
   paquete. Cada salida agregada = una **opción en lista desplegable** al reservar; el
   **hotel se liquida por las noches de ESA salida** (fecha_ida→fecha_regreso). ✔️
2. **Valor del vuelo:** el dueño **pone el valor del tiquete** y elige **montarlo sobre
   markup (mk)** o ponerle una **TA** (tarifa administrativa). Igual que el vuelo de bloqueo. ✔️
3. **Edades del vuelo:** **NO es el mismo precio.**
   - **0 a 1.99 años (infante):** tarifa de **fee** (opcional, configurable por salida).
   - **2 años en adelante:** **tarifa de adulto** (tiquete completo).
   - (No hay tarifa de "niño" intermedia en el vuelo.)
4. **Vigencia (rotación):** la salida deja de venderse pasada su fecha de ida (igual que
   ya ocultamos bloqueos vencidos) y opcionalmente por `compra_fin`. ✔️
5. **Disponibilidad:** sin cupos (ilimitado por sistema). ✔️
6. **Vista:** tabla aparte **+ vista tipo Booking** para este bloque dinámico. ✔️

## ⚠️ MONEDA (USD) — bloqueante, verificado
La mayoría de estos paquetes son en **USD** (hoteles internacionales y vuelo en dólares).
Estado actual del soporte de moneda:
- ✅ **`ventas.moneda` + `cuentas_por_pagar.moneda` + `cotizaciones.moneda`** existen
  (default COP). Los **Programas** ya venden en USD usándolas.
- ✅ **Programas**: USD nativo (motor aparte `pvpPrograma`).
- ❌ **`tarifa_hotel` y `hoteles`**: NO tienen moneda → hoy las tarifas de hotel son
  **COP implícito**.
- ❌ **`armado_paquetes`**: no tiene moneda (paquetes = COP).
- ❌ **Motor `lib/calc/paquetes.ts`**: redondea a **miles (COP)** (`redondearMilArriba`)
  → para USD hay que redondear distinto.
- ❌ **`ContratoDocumento`**: muestra **"COP" fijo** (hardcode, línea ~344) aunque
  `ventas.moneda` exista.

### Modelo de moneda propuesto (para el paquete dinámico internacional)
- **`hoteles.moneda`** (default `COP`): un hotel internacional = **USD**; sus
  `tarifa_hotel` se cargan en esa moneda. Un hotel es de UNA moneda.
- **`armado_paquetes.moneda`**: el paquete dinámico declara su moneda (toma la de sus
  hoteles; se valida que todos coincidan). El **valor del tiquete** va en esa misma moneda.
- **Motor**: recibe `moneda`; el cálculo (hotel/(1−mk)+vuelo) es igual, solo cambia el
  **redondeo** (miles en COP; centavos/entero en USD).
- **Contrato/cotización/CxP**: usar `ventas.moneda` (ya existe) en vez del "COP" fijo →
  arreglar el hardcode del documento.
- **Caveat tributario:** el detalle de IVA/provisiones/rentabilidad es **colombiano (COP)**.
  Para paquetes en USD queda con la **misma limitación que los Programas** (el detalle
  tributario sigue en COP / se omite). Aceptado para esta fase.

> Decisión pendiente del dueño: ¿confirmas **moneda por hotel** (un hotel internacional
> es un hotel USD con sus tarifas en USD)? Es lo más fiel a "los hoteles que uso son en
> dólares" y lo menos invasivo para los paquetes COP existentes.

## Receptivo/servicios
Estas salidas pueden llevar servicios adicionales como los demás paquetes → se reusa el
add-on (en la moneda del paquete).

## Esqueleto técnico (cuando se apruebe)
1. Migración: `armado_paquetes.tipo` admite `dinamico`; tabla `salidas_dinamicas`.
2. `lib/calc/paquetes.ts`: rama de PVP dinámico = hotel (porción) + vuelo (neto/mk|TA).
3. Armado UI: sección "Salidas dinámicas" (CRUD de salidas) + hoteles (reusa porción).
4. `generarTarifario`: emitir filas `modulo='dinamico'` por salida×hotel×cat/régimen.
5. Tarifario público: módulo "Salidas dinámicas" (vista tipo Bloqueos, sin cupos).
6. Reservar: rama `dinamico` (como porción, sin sillas; costo aéreo + info de vuelo).
