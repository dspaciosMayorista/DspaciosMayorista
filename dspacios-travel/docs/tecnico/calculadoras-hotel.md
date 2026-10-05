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
modo)` lee esa fila y las vigencias del hotel, llama `generarTarifas(tipo, params, { vigencias,
hoy })`, aparta las filas de vigencias con **compra cerrada** (`separarFilasVencidas`: son
histórico, no se reescriben ni se recrean) y escribe con la RPC
`generar_tarifas_hotel_calculadora` (migración 203, transaccional):
- `modo: "agregar"` (default): reemplaza **solo las claves (categoría, régimen, temporada) que
  genera ahora**. Otras temporadas del mismo régimen (p. ej. una promoción), otros regímenes y
  filas manuales quedan intactas. Para quitar una fila hay que borrarla en la tabla (borrado
  explícito). Antes de la 203 borraba TODAS las filas del régimen — así se perdieron las
  promociones PC/PAM del hotel 59 (pendiente #26).
- `modo: "reemplazar"`: borra las tarifas **vigentes** del hotel y deja solo las generadas;
  conserva las de vigencias con compra cerrada.
- Toda fila reemplazada, editada o borrada (por cualquier camino) queda versionada en
  `tarifa_hotel_historial` (trigger), visible solo para roles internos en la ficha del hotel
  ("Historial interno de tarifas"). El motor no lee esa tabla: nunca se cotiza ni se publica.
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
El régimen es **uno solo por corrida** (`regimen: string`, no un array como Dubai): "Generar"
escribe solo el régimen que está en pantalla. Desde los pendientes #15/#26 **cada régimen
conserva sus valores**: el editor los guarda por régimen (`lib/calc/mixtaValores.ts`) y
`params.bases_por_regimen` los persiste todos, así que alternar de régimen, guardar y recargar
ya no borra los del otro. Configuraciones guardadas antes solo traen `bases` (del régimen
guardado) y siguen cargando igual.

**Promociones % (`analizarMixta`, con contexto de vigencias):** cada vigencia
`descuento_pct` del hotel que aplica al régimen se relaciona con su base
(`resolverBasePromo` en `lib/calc/promoCalculadora.ts`) y se materializa como fila de
**precio final**: cada valor por persona de la base × (1 − %), un solo redondeo,
`precio_final_autoritativo = true`, `temporada_base = <base>`. El motor de cotización usa esa
fila tal cual (nunca reaplica `descuento_valor`). Regla de enlace: por cada noche de viaje de
la promo, la base es la vigencia `tarifa` de mayor prioridad que aplica al régimen; solo se
enlaza si TODAS las noches caen en una misma base y la promo tiene mayor prioridad. Si cruza
varias bases, si alguna noche no tiene base, si dos bases empatan o si la promo tiene valores
tecleados a mano, **no se genera** (aviso en la vista previa; falta la regla comercial). Una
promo nunca se calcula desde el precio final de otra. `descuento_monto` y
`promo_noche_gratis` no se derivan (sin regla definida).

**Promos con valores escritos a mano (por categoría):** si una categoría de la promo tiene
valores tecleados en la calculadora o una fila ya guardada en `tarifa_hotel` que no es precio
final calculado (p. ej. SUNSALE1 guardada con los valores de la base), esa categoría **no se
escribe ni se borra** al generar — el resto de categorías se deriva normal. "Reemplazar TODAS"
se niega mientras exista alguna (las borraría). Para cambiarla hay una acción explícita por
celda, **"Sustituir por −% de <base>"** (`sustituirPromoManualMixta`): muestra antes → después,
pide confirmación, guarda la calculadora con esa celda limpia y escribe SOLO esa clave
(motivo `calculadora_sustituir_manual`; la versión anterior queda en el historial). La vista
previa y el servidor usan la misma función pura (`filaSustitucionMixta`); si el servidor no
obtiene exactamente lo que mostró la vista previa, no escribe nada.

**La regla vive también en SQL, bajo bloqueo (migración 203).** La app decide qué conservar,
pero eso solo no alcanza: entre la vista previa y la escritura otra persona puede escribir a
mano una promo. Por eso `generar_tarifas_hotel_calculadora` bloquea el hotel, sus vigencias y
sus tarifas, y en la misma transacción (1) compara las filas actuales con `p_previas` — la foto
que los tres editores mandan con lo que cargaron (`fotoTarifas`) — y rechaza pidiendo recargar
si algo cambió, y (2) se niega a borrar una promo escrita a mano (Mixta, vigencia
`descuento_pct`, fila sin precio final) en "Generar" y "Reemplazar TODAS", aunque la foto
coincida. Solo `calculadora_sustituir_manual` la reemplaza, y únicamente con UNA fila marcada
como precio final cuya `temporada_base` es una vigencia 'tarifa' del hotel, sobre una celda que
hoy es promo escrita a mano. **SQL no recalcula los valores de esa fila**: el −% desde la base
(y el infante intacto) lo verifica la Server Action `sustituirPromoManualMixta`, que recalcula
con `filaSustitucionMixta` y compara con la vista previa antes de llamar. Las promos Dubai antiguas (sin `precio_final_autoritativo` porque la
179 no hizo backfill) no entran en esa regla: Dubai sigue regenerándolas como siempre. Detalle
y pruebas de carreras en [`historial-tarifas.md`](./historial-tarifas.md) §1.bis.

**Regla de niños e infantes (decidida por el dueño, oct-2026):** el mismo % se aplica a
adultos, **Niño 1 y Niño 2** (ej. Niño 1 227.000 → 213.380 con −6 %). **Infante no se
descuenta**: la fila de la promo copia exactamente el infante de su base — un valor fijo se
conserva, `0` sigue en `0` y vacío sigue vacío (no se inventa tarifa de infante). Rige igual
en la vista previa, en "Generar" y en "Sustituir".

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
