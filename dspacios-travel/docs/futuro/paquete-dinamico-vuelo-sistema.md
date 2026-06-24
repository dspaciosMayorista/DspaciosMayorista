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

## Decisiones abiertas (confirmar con el dueño antes de construir)
1. **¿Las salidas son por paquete** (se definen al armar ese paquete) **o un catálogo
   reutilizable** por destino? → Propongo **por paquete** (rotan semanalmente con él).
2. **Valor del vuelo**: ¿neto del tiquete por pax + markup/TA (como el bloqueo), o un
   valor de venta fijo? → Propongo **neto + markup/TA** (consistente).
3. **Tarifa de niño/infante en el vuelo**: ¿el sistema cobra distinto a niños? ¿hay
   valor de tiquete por niño? → opcional `valor_tiquete_nino`.
4. **Vigencia (rotación)**: la salida deja de venderse pasada su `compra_fin` (~1
   semana) **y** pasada su fecha de ida (igual que ya ocultamos bloqueos vencidos). ✔️
5. **Disponibilidad**: sin cupos (ilimitado por sistema). ¿O quieres un tope manual
   opcional por salida?
6. **Receptivo/servicios**: ¿estas salidas pueden llevar servicios adicionales
   (traslados/asistencia) como los otros paquetes? → Propongo **sí** (reusa el add-on).

## Esqueleto técnico (cuando se apruebe)
1. Migración: `armado_paquetes.tipo` admite `dinamico`; tabla `salidas_dinamicas`.
2. `lib/calc/paquetes.ts`: rama de PVP dinámico = hotel (porción) + vuelo (neto/mk|TA).
3. Armado UI: sección "Salidas dinámicas" (CRUD de salidas) + hoteles (reusa porción).
4. `generarTarifario`: emitir filas `modulo='dinamico'` por salida×hotel×cat/régimen.
5. Tarifario público: módulo "Salidas dinámicas" (vista tipo Bloqueos, sin cupos).
6. Reservar: rama `dinamico` (como porción, sin sillas; costo aéreo + info de vuelo).
