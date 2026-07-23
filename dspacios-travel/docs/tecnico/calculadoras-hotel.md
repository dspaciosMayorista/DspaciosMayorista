# Calculadoras de tarifa de hotel — hoja técnica

> Índice: [`README.md`](./README.md) · Relacionado: [`tarifas-hotel.md`](./tarifas-hotel.md)

Tres motores **puros** (sin efectos secundarios, fáciles de testear) que, a partir de
parámetros más simples que "tipear cada fila a mano", generan las filas normales de
`tarifa_hotel`. El resto del sistema (tarifario, reservar, contrato) no sabe ni le importa si
una tarifa vino de una calculadora o se tipeó a mano — todas terminan como filas idénticas en
`tarifa_hotel`.

---

## 1. Dónde vive todo

| Pieza | Archivo |
|---|---|
| Motor puro (los 3 tipos + el registro) | `lib/calc/calculadoras.ts` |
| Formulario / UI (selector de tipo + 3 sub-formularios) | `app/(dashboard)/dashboard/producto/hoteles/[id]/CalculadoraEditor.tsx` |
| Server actions (guardar params / generar filas) | `app/(dashboard)/dashboard/producto/hoteles/actions.ts` (`guardarCalculadora`, `generarTarifasCalculadora`) |
| Página que carga todo y pasa los props iniciales | `app/(dashboard)/dashboard/producto/hoteles/[id]/page.tsx` |
| Tabla de persistencia | `hotel_calculadora` (migración `20260601000037_hotel_calculadora.sql`) |

**`hotel_calculadora`**: `hotel_id` (bigint, **unique** — un hotel = una calculadora activa),
`tipo` (text libre, no enum de Postgres — el enum vive solo en TS como `CalcTipo`), `params`
(jsonb — la forma exacta depende de `tipo`), `updated_at`.

## 2. El contrato compartido: `TarifaGenerada`

```ts
export type TarifaGenerada = {
  tipo_habitacion: string;   // categoría
  alimentacion: string;      // régimen
  temporada: string;         // nombre de la temporada del hotel
  neto_sencilla: number;
  neto_doble: number;
  neto_triple: number;
  neto_multiple: number;
  neto_nino: number;
  neto_nino2: number | null;
  neto_infante: number | null;
  nota_infante: string | null;
  notas?: string | null;     // nota general de la fila (ej. "Tarifa no incluye impuestos")
};
```

Cualquier calculadora nueva DEBE devolver un array de esto. `notas` es el campo más reciente
(lo agregó la Calculadora Corporativa, §5) — Dubai/Mixta no lo usan, queda `undefined`.

## 3. Registro — cómo se agrega un 4º tipo

```ts
export type CalcTipo = "dubai" | "mixta" | "corporativa";
export function generarTarifas(tipo: string, params: unknown): TarifaGenerada[] {
  switch (tipo) {
    case "dubai": return generarTarifasDubai(params as DubaiParams);
    case "mixta": return generarTarifasMixta(params as MixtaParams);
    case "corporativa": return generarTarifasCorporativa(params as CorporativaParams);
    default: return [];
  }
}
```

Para sumar un tipo nuevo: (1) nuevo `XxxParams` + `generarTarifasXxx()` puro en
`calculadoras.ts`, (2) agregar el `case` al switch de arriba, (3) agregar `"xxx"` a `CalcTipo`,
(4) en `CalculadoraEditor.tsx`: nueva `<option>` en el `<select>`, nuevo branch condicional
`{tipoCalc === "xxx" && <XxxForm .../>}`, y un `XxxForm` component (copiar el patrón de
`CorporativaForm`/`DubaiForm`), (5) en `hoteles/actions.ts`: agregar el tipo a la unión de
`guardarCalculadora(hotelId, tipo, params: DubaiParams | MixtaParams | CorporativaParams | XxxParams)`,
(6) en `[id]/page.tsx`: `const xxxInicial = calc?.tipo === "xxx" ? (calc.params as unknown as XxxParams) : null;`
y pasarlo como prop a `<CalculadoraEditor>`.

**El "marco" se reutiliza tal cual** (no hay que tocarlo): `guardarCalculadora` hace un
`upsert` en `hotel_calculadora` (onConflict `hotel_id`); `generarTarifasCalculadora(hotelId,
modo)` lee esa fila, llama `generarTarifas(tipo, params)`, y escribe en `tarifa_hotel`:
- `modo: "agregar"` (default): borra solo las tarifas de los **regímenes** generados (`alimentacion
  IN (...)`) y las reinserta — respeta tarifas de otros regímenes ya cargadas a mano o por otra
  calculadora.
- `modo: "reemplazar"`: borra **TODAS** las tarifas del hotel y deja solo las generadas ahora.
- Al terminar, llama `regenerarTarifariosDeHotel(hotelId)` (en `paquetes/actions.ts`) para
  re-liquidar los paquetes activos que usan ese hotel.

## 4. Calculadora "Dubai" — base + modificadores %

Para hoteles donde la tarifa se negocia como **una base por persona/noche en DOBLE** (con el
régimen incluido) por categoría×temporada, y el resto se deriva con porcentajes:

```
sencilla = base × (1 + sencilla%)
doble    = base
triple   = (base×2 + base×(1+pax3%)) / 3
múltiple = (base×2 + base×(1+pax3%) + base×(1+pax4%)) / 4
niño     = base × (1 + niño%)
infante  = max(0, base × (1 + infante%))          — default infante% = −100 (gratis)
```

Cada régimen (además del base) suma un **monto fijo por persona** (`suplementos[]`) DESPUÉS de
derivar — el base suma 0. `DubaiParams.modificadores = {sencilla_pct, pax3_pct, pax4_pct,
nino_pct, infante_pct?}`, `bases: {categoria, temporada, precio}[]`.

**Promociones (`DubaiParams.promos[]`)**: cada promo (`temporadaBase → temporadaPromo, regimen,
descuentoPct`) aplica el % **SOLO sobre la base**, ANTES de derivar sencilla/triple/múltiple/
niño y de sumar el suplemento de régimen — el suplemento **nunca** se descuenta. Aplica **solo
al régimen elegido**, aunque el hotel tenga varios. `temporadaPromo` debe existir como vigencia
REAL en `hotel_temporadas` (con su propia fecha/vigencia de compra) — la calculadora solo
calcula los números y los escribe ahí, no crea la vigencia.

## 5. Calculadora "Mixta" — por hab/pax + IVA

Para hoteles que mezclan tarifas **por habitación** y **por persona**, con IVA opcional por
acomodación. Por cada acomodación (sencilla/doble/triple/multiple) se elige:
- `modo: "hab" | "pax"` — si `"hab"`, el valor cargado se divide entre `pax[acom]` (pax por
  habitación, default 1/2/3/4) para guardarlo por persona (que es como trabaja el resto del
  sistema); si `"pax"`, el valor ya es por persona.
- `iva: boolean` — si true, `× (1 + iva_pct/100)` (default 19%).

Niño/Niño2/Infante siempre son por persona, comparten un solo flag de IVA (`nino.iva`). Una
fila con las 4 acomodaciones en 0 se descarta (`if sencilla+doble+triple+multiple <= 0: skip`).
El régimen es **uno solo por corrida** (`regimen: string`, no un array como Dubai) — cambiar de
régimen en la UI (`cambiarRegimen`) vacía los valores cargados (evita arrastrar/pisar a mano los
del régimen anterior).

## 6. Calculadora "Corporativa" — tarifa por habitación + suplementos

Para tarifarios **negociados de cadena** que traen la tarifa **por HABITACIÓN, no por persona**
(un mismo precio "SGL/DBL" para 1 o 2 adultos — ej. anexos corporativos Faranda/Marriott).
Motivada por un anexo real: Hotel Caribe by Faranda Grand, Cartagena, tarifa PLATINUM 2026.

```ts
export type CorporativaParams = {
  regimen_base: string;
  persona_adicional: number;    // fijo/noche, IGUAL para todas las categorías
  nino_adicional: number;       // fijo/noche, IGUAL para todas las categorías
  impuesto_pct?: number;        // opcional
  descuento_pct?: number;       // opcional — tarifa "Dinámica"
  suplementos_regimen: { regimen: string; adulto: number; nino: number }[];
  bases: { categoria: string; temporada: string; precio: number }[];   // SGL/DBL por habitación
  infante_nota?: string;
};
```

**Reparto por persona** (para encajar con el resto del sistema, que trabaja per-cápita):

```
rack_con_impuesto  = rack × (1 − descuento%) × (1 + impuesto%)     ← descuento SOLO al rack
persona_adicional' = persona_adicional × (1 + impuesto%)
nino_adicional'    = nino_adicional × (1 + impuesto%)

sencilla = rack_con_impuesto + sup_adulto_regimen                  (paga TODA la habitación)
doble    = rack_con_impuesto / 2 + sup_adulto_regimen              (se divide entre 2)
triple   = (rack_con_impuesto + persona_adicional') / 3 + sup_adulto_regimen
múltiple = (rack_con_impuesto + persona_adicional'×2) / 4 + sup_adulto_regimen
niño     = nino_adicional' + sup_nino_regimen
infante  = 0                                                        (siempre cortesía, fijo)
```

- **Régimen base incluido**; subir de régimen suma `suplementos_regimen[].adulto/.nino` **por
  persona/noche**, aparte de la habitación — se suma DESPUÉS del descuento (igual patrón que
  Dubai, nunca se descuenta).
- **`impuesto_pct` opcional**: si no se configura (0), la tarifa queda neta y cada fila
  generada se marca con `notas = "Tarifa no incluye impuestos."` (reusa `tarifa_hotel.notas`,
  columna que ya existía desde la migración 016 sin ningún uso). Si se configura, no lleva
  nota — infla la tarifa de habitación + persona/niño adicional, **pero NO los suplementos de
  régimen** (se asume que esos valores ya vienen tal cual los pasa el hotel — supuesto hecho al
  construir esto, avisado al dueño, corregible si prefiere lo contrario).
- **`descuento_pct` opcional** ("tarifa Dinámica" tipo Faranda: X% sobre el Rack): descuenta
  **solo** la tarifa de habitación — nunca suplementos de régimen ni persona/niño adicional.
  Sin configurar, queda el rack normal.
- **Infante**: siempre `$0` (cortesía), **fijo en el motor, no configurable** — así traen estas
  tarifas de cadena (a diferencia de Dubai/Mixta donde infante sí es editable).
- **`nota_infante`**: campo libre para anotar reglas como "máx. 2 niños por habitación" (visto
  en el anexo real, pero no forzado por el motor — es solo texto informativo).

## Enlaces cruzados

- **Modelo de datos de tarifas** (`tarifa_hotel`, `hotel_temporadas`, categorías/regímenes) y
  el gotcha de "todo por texto, sin FK" que afecta directamente a `bases[].categoria/temporada`
  en las 3 calculadoras — ver [`tarifas-hotel.md`](./tarifas-hotel.md) §2.
- **`lib/acomodaciones.ts`** (`PAX_TARIFA_DEFAULT`) — los defaults de pax por acomodación que
  usa Mixta (`pax: {sencilla:1, doble:2, triple:3, multiple:4}`).
