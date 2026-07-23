# Tarifas de hotel — modelo de datos y el gotcha del texto libre

> Índice: [`README.md`](./README.md) · Relacionado: [`calculadoras-hotel.md`](./calculadoras-hotel.md)

Cómo se guarda y relaciona la tarifa neta de un hotel: categorías de habitación, régimen
(plan de alimentación) y temporadas, y por qué **renombrar cualquiera de los tres puede romper
tarifas ya cargadas** si no se hace con cuidado.

---

## 1. Modelo de datos

```
hoteles (1) ──< hotel_categorias >── categorias_habitacion (catálogo global)
hoteles (1) ──< hotel_regimenes >── planes_alimentacion (catálogo global)
hoteles (1) ──< hotel_temporadas (vigencias propias del hotel)
hoteles (1) ──< tarifa_hotel (las tarifas netas en sí)
hoteles (1) ──< hotel_acomodaciones (config de pax por acomodación)
hoteles (1) ──< hotel_calculadora (0 o 1 — la calculadora configurada, ver calculadoras-hotel.md)
```

- **`hoteles`**: `nombre, destino_id, zona, moneda (COP/USD), pax_min, pax_max,
  edad_infante_min/max, edad_nino_min/max, rangos_edad, adults_only, pet_friendly +
  pet_costo_neto/pet_costo_desc/pet_nota, nino_nota` (nota general de niño, distinta de la
  nota de infante que vive en `tarifa_hotel.nota_infante`).
- **`categorias_habitacion`** (catálogo GLOBAL, no por hotel): `id, nombre` — ej. "Estándar",
  "Superior". **`hotel_categorias`**: tabla puente `hotel_id, categoria_id` — qué categorías
  ofrece ESTE hotel (de las globales).
- **`planes_alimentacion`** (catálogo global): `id, codigo, nombre, descripcion, nota_especial`
  — códigos como PC/PAM/PAE/PA/FULL/FULL TROPICAL/FULL PREMIUM/PA+OPEN BAR. **`hotel_regimenes`**:
  puente `hotel_id, plan_id`.
- **`hotel_temporadas`** (propias del hotel, NO catálogo global): `nombre` (texto libre — "ALTA",
  "ENERO-MARZO", lo que sea), `fecha_inicio/fin` (rango principal, compatibilidad), `rangos`
  jsonb (múltiples rangos de cobertura), `blackouts` jsonb (fechas excluidas dentro de la
  vigencia), `prioridad`, `compra_inicio/fin` (vigencia de COMPRA, no de viaje), `tipo`
  (`'tarifa'|'descuento_pct'|'descuento_monto'|'promo_noche_gratis'`), `descuento_valor`,
  `min_noches`, `regimen_restringido` (texto libre, null = todos los régimen).
- **`tarifa_hotel`** (la tarifa neta en sí, una fila por combo categoría×régimen×temporada):
  `tipo_habitacion` (texto — nombre de categoría), `alimentacion` (texto — código de régimen),
  `temporada` (texto — nombre de la temporada), `neto_sencilla/doble/triple/multiple`,
  `neto_nino, neto_nino2, neto_infante, nota_infante, notas` (general, migración 016 — sin uso
  hasta que la Calculadora Corporativa la empezó a llenar, ver `calculadoras-hotel.md`).
- **`hotel_acomodaciones`**: `acomodacion` (enum `acomodacion_tipo`: sencilla/doble/triple/
  multiple/nino/nino2/infante), `pax_tarifa` (multiplicador de la tarifa por persona de 1
  habitación — ej. doble ×2), `pax_max`, `adt_min/max, chd_min/max, inf_min/max` (mín/máx de
  adultos/niños/infantes que puede llevar esa acomodación) — alimenta la validación de
  `lib/acomodaciones.ts::validarReservaHabitaciones`.

## 2. ⚠️ GOTCHA CRÍTICO: todo se relaciona por TEXTO, sin FK

`tarifa_hotel.tipo_habitacion`, `.alimentacion` y `.temporada` son columnas `text` planas —
**no hay foreign key** a `categorias_habitacion`, `planes_alimentacion` ni `hotel_temporadas`.
El resto del sistema (tarifario público/interno, `lib/reservar/cotizar.ts`, `lib/reservar/
computo.ts`, `lib/calc/paquetes.ts`, `app/(dashboard)/dashboard/paquetes/actions.ts`) hace el
match **comparando el string** en tiempo de consulta.

**Consecuencia:** si renombras una categoría, un régimen o una temporada, cualquier fila de
`tarifa_hotel` que todavía tenga el nombre VIEJO deja de matchear con nada — queda huérfana,
invisible para tarifario/reservar, como si no existiera. El síntoma reportado por el dueño:
*"modificamos el nombre de la temporada pero nos obliga a que tengamos que volver a cargar la
información de las tarifas"* — exactamente esto.

**Segunda vuelta del mismo bug:** si el hotel tiene una **calculadora configurada**
(`hotel_calculadora.params`, jsonb — ver `calculadoras-hotel.md`), esos parámetros TAMBIÉN
referencian la temporada/categoría por nombre (`bases[].temporada`, `bases[].categoria`,
`promos[].temporadaBase/temporadaPromo` en Dubai). Si solo arreglas `tarifa_hotel` pero no
`hotel_calculadora.params`, la PRÓXIMA vez que alguien haga clic en "Generar tarifas" el bug
reaparece (vuelve a escribir el nombre viejo).

### Estado del arreglo (cascade de rename)

- **✅ Temporada — arreglado.** `actualizarTemporada()` en `app/(dashboard)/dashboard/
  producto/hoteles/actions.ts` ahora detecta el cambio de nombre (compara contra el `nombre`
  actual, leído ANTES del update) y llama `renombrarTemporadaEnDatos(sb, hotelId, viejo,
  nuevo)`, que cascada: (1) `UPDATE tarifa_hotel SET temporada = nuevo WHERE hotel_id = X AND
  temporada = viejo`, (2) reescribe `bases[].temporada` y (si `tipo === 'dubai'`)
  `promos[].temporadaBase/temporadaPromo` dentro de `hotel_calculadora.params`. Se muestra un
  aviso en la UI (`TemporadasBox` en `HotelDetalleClient.tsx`) con cuántas tarifas se
  actualizaron. **Esto es hacia adelante únicamente** — si una temporada ya se había renombrado
  ANTES de este fix, esas tarifas quedaron huérfanas y no se revinculan solas (no hay forma de
  saber automáticamente cuál era el nombre viejo de cada una); habría que construir una
  herramienta de detección/reparación aparte si hace falta.
- **❌ Categoría (`categorias_habitacion.nombre`) — NO arreglado, mismo riesgo.** No hay UI de
  "editar" categoría hoy (solo crear/eliminar en `HotelCategoriasRegimenesEditor.tsx`), así que
  el riesgo no está expuesto todavía — pero si algún día se agrega edición, necesita el mismo
  cascade a `tarifa_hotel.tipo_habitacion` + `hotel_calculadora.params.bases[].categoria`.
- **❌ Régimen (`planes_alimentacion.codigo`) — NO arreglado, mismo riesgo, y SÍ está expuesto.**
  `actualizarRegimen()` en `app/(dashboard)/dashboard/producto/configuracion/actions.ts` (línea
  ~43) actualiza `planes_alimentacion.codigo` con **cero cascade** — el mismo bug existe hoy
  para régimen, sin haber sido reportado todavía. Si se renombra un código de régimen (ej. "PC"
  → "Desayuno"), las tarifas con `alimentacion = "PC"` quedan huérfanas igual que pasaba con
  temporada. **Pendiente arreglar con el mismo patrón** (cascade a `tarifa_hotel.alimentacion` +
  `hotel_calculadora.params.regimen_base`/`suplementos[].regimen`/`suplementos_regimen[].regimen`).

## 3. Carga masiva (CSV)

`cargarTarifasMasivo` en `hoteles/actions.ts` — plantilla `sep=;`, listas con `|`. Inserta
`temporada: oNull(r.temporada || "")` tal cual viene la columna del CSV — mismo riesgo de typo/
inconsistencia de nombre (si el CSV trae "Alta" y `hotel_temporadas.nombre` es "ALTA", no
matchea). No hay validación cruzada contra las temporadas/categorías/regímenes reales del hotel
al momento de cargar.

## Enlaces cruzados

- **Calculadoras de hotel** (Dubai/Mixta/Corporativa) generan filas de `tarifa_hotel` a partir
  de parámetros más simples — ver [`calculadoras-hotel.md`](./calculadoras-hotel.md).
- **`lib/acomodaciones.ts`** — clasificación de pasajeros por edad y validación contra
  `hotel_acomodaciones` al reservar.
- **`lib/calc/paquetes.ts`** — motor de liquidación noche a noche que lee `tarifa_hotel` +
  `hotel_temporadas` para componer el PVP final (pendiente de hoja técnica propia).
