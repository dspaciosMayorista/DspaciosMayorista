# Programas y Cotización manual/dinámica — hoja técnica

> Índice: [`README.md`](./README.md) · Relacionado: [`tarifario-y-paquetes.md`](./tarifario-y-paquetes.md) ·
> [`finanzas-comisiones.md`](./finanzas-comisiones.md)

Dos motores de precio **independientes** entre sí y respecto al de Paquetes: **Programas**
(circuitos multi-ciudad de un proveedor, PVP en `lib/programas.ts`) y **Cotización
manual/dinámica** (armado a mano de servicios sueltos, `app/(dashboard)/dashboard/cotizaciones/`).

---

## 1. Programas — `lib/programas.ts`

### 1.1 Fórmula exacta de PVP — `pvpPrograma`

```ts
function pvpPrograma(neto: number, opt: {pctMk, asistenciaDia?, dias?, pctFee?, moneda?}): number {
  if (!(neto > 0)) return 0;                          // sin neto → PVP 0 (evita "columna fantasma")
  let sub = (0<mk<1) ? neto/(1-mk) : neto;             // 1) markup (mk = MARGEN: 0.25 ⇒ /0.75)
  sub += asistenciaDia * dias;                          // 2) + asistencia médica (NUNCA se marca up)
  if (0<fee<1) sub = sub/(1-fee);                       // 3) / (1-fee) sobre el TOTAL (mk+asistencia)
  return redondearPvp(sub, opt.moneda);                 // 4) redondeo hacia arriba (ver abajo)
}
```
Orden: neto → +MK → +asistencia → +fee → redondeo. Campos en `programas`: `pct_mk`,
`pct_fee_tarjeta`, `asistencia_medica_dia` (por pax y por día), `dias` (o el `noches` propio de
la salida si `modo_precio='salida'`).

**Redondeo (jul-2026) — `redondearPvp(valor, moneda)`:** reemplazó el `Math.round(sub)` plano
original (redondeaba al peso/centavo exacto, montos poco vendibles tipo "$847.332"). Regla
pedida por el dueño, mismo criterio que `redondearVenta`/`redondearMilArriba` de paquetes:
COP → `Math.ceil(valor/1000)*1000` (al mil de pesos **por encima**); USD → `Math.ceil(valor)`
(al dólar entero **por encima**). Siempre redondea hacia arriba, nunca hacia abajo (el margen no
se erosiona). `opt.moneda` viene de `programas.moneda`; los call sites (`ProgramaEditor.tsx` ×2,
`CalculadoraProgramas.tsx`, `reservarPrograma` en `reservar/actions.ts`) ya pasan la moneda del
programa. **Tours opcionales** (`programa_tours`) antes se mostraban con su **neto** crudo en el
tarifario público (bug: no llevaban markup del programa) — `getProgramaDetalle()` ahora los pasa
también por `pvpPrograma(t.precio, {...pvpOpt, asistenciaDia: 0, dias: 0})` (sin asistencia
médica ni prorrateo por día, que no aplican a un tour puntual), así quedan con el mismo `pct_mk`/
`pct_fee_tarjeta` que el resto del programa.

Existe además `pvpDesdeNeto(neto, pctMk)` — solo markup, sin asistencia/fee, mantenido por
compatibilidad; el que realmente se usa en todo el sistema es `pvpPrograma`.

### 1.2 Derivar el neto desde reglas de comisión del proveedor — `lib/calc/programaPrecio.ts`

Paso previo/aparte para cuando el proveedor solo da una Tarifa + regla de base comisionable
(la comisión de D'spacios es la utilidad):
```ts
calcularNetoPrograma({tarifa, modo:'pct'|'impuesto'|'ninguno', valor, pctComision}):
  base = modo==='pct' ? tarifa*(1-valor/100) : modo==='impuesto' ? tarifa-valor : tarifa
  comision = base * (pctComision/100)
  neto = tarifa - comision           // esto es lo que se monta y entra a pvpPrograma
```
Solo lo usa la UI "calculadora" (`producto/programas/calculadora/`) para ayudar a calcular qué
`neto` tipear en la matriz — no calcula PVP por sí misma.

**"Tarifa comisionable del proveedor" por salida (migración 151, modo `salida`).** Además de la
calculadora suelta de arriba, `programa_salidas` tiene columnas propias
`tarifa_sencilla/doble/triple/multiple` (la tarifa BRUTA del proveedor por esa salida y
acomodación) junto a los `neto_*` de siempre — y el programa tiene una regla a nivel de
CABECERA (`regla_comisionable, regla_comisionable_modo/valor/pct_comision`) que dice cómo pasar
de tarifa → neto para TODAS sus salidas. `SalidasEditor` (`ProgramaEditor.tsx`) recalcula `neto_*`
en vivo con `calcularNetoPrograma`/`recalcularNetosPorTarifa` cada vez que cambia una tarifa o la
regla; el guardado es atómico vía el RPC `guardar_programa_salidas(programa_id, p_regla,
p_salidas)` (UPDATE regla + DELETE + INSERT salidas en una sola transacción Postgres, sin
`security definer`). `validarReglaComisionable` (mismo archivo) es la ÚNICA validación —
navegador y servidor la llaman igual — y es **incondicional** para el campo `modo`/`valor`/
`pctComision` solo cuando `activa=true`; desactivar la regla conserva los valores tal cual (no
los borra), para poder reactivar sin volver a tipear nada.

**Modalidad de MK sobre la tarifa comisionable (migración 161).** El `neto` de arriba
(`tarifa - comision`) siempre se marca con el MK del programa vía `pvpPrograma`, pero el dueño
pidió una SEGUNDA forma de hacerlo, seleccionable por programa
(`programas.regla_comisionable_modalidad_mk`, `'historica'` default | `'base_neta_impuestos_al_
final'`, CHECK en Postgres):
```
'historica' (de siempre):                  Venta = (base_neta + impuestos) / divisorMK
'base_neta_impuestos_al_final' (nueva):     Venta = (base_neta / divisorMK) + impuestos
```
donde `base_neta = base_comisionable - comision` e `impuestos` (generalizado a los 3 modos) =
`tarifa - base_comisionable` (siempre ≥ 0). La modalidad nueva NUNCA aplica el MK sobre
`impuestos` — se suma DESPUÉS de dividir por el divisor de MK, ANTES del fee bancario (que sí
sigue aplicando sobre el total). **No se persiste como un neto distinto**: se recalcula EN
CALIENTE en cada uno de los 4 puntos de consumo (editor en vivo, validación cliente, validación
servidor, `getProgramaDetalle` al generar/leer el tarifario real) a partir de los mismos
`tarifa_*` + la regla del programa, siempre con el `pct_mk` VIGENTE — así evita que cambiar el
%MK más adelante deje netos horneados desactualizados. Única función que decide el reparto:
`calcularNetoProgramaConModalidad(input, modalidadMk)` en `lib/calc/programaPrecio.ts` — envuelve
`calcularNetoPrograma` (nunca reimplementa su fórmula) y devuelve `{netoParaMarkup,
montoSinMarkup}`, el par que consume el 3er parámetro (opcional, default 0 = no-op) que
`pvpPrograma` ganó para esto — con modalidad `'historica'` o sin pasarlo, el comportamiento de
`pvpPrograma` es byte a byte idéntico al de antes de la 161. `pvpPrograma`/`PvpOpciones` viven en
`lib/calc/programaPrecio.ts` (módulo sin imports con alias `@/`, para que `node:test` pueda
ejecutarlo directo); `lib/programas.ts` los re-exporta, así que ningún call-site del resto de la
app cambia.

**Revisión PR #277 (defectos 1/2/3/4, antes de fusionar; la 161 nunca se corrió en producción).**
- **Payload sin `modalidadMk` ya NO pisa la modalidad.** `guardar_programa_salidas()`: si
  `p_regla` no trae la clave, CONSERVA la modalidad ya guardada del programa (select antes del
  update) — antes caía a `'historica'` en silencio, lo que un cliente desplegado antes de la
  161 podía usar para revertir sin querer un programa ya configurado en la modalidad nueva. Con
  la clave PRESENTE (incl. `""`/`null` explícitos) se valida SIEMPRE, fail-closed. Solo un
  programa NUEVO recibe `'historica'`, vía el DEFAULT de la columna.
- **`getProgramasResumen` (tarjeta "Desde" del tarifario) ahora es consciente de la modalidad.**
  Antes leía el `neto` mínimo persistido sin mirar la regla/modalidad — podía mostrar un precio
  distinto al de `getProgramaDetalle` para la misma salida. Ahora selecciona
  `regla_comisionable*`/`tarifa_*` y, por candidato (fila de `programa_precios` o
  salida×acomodación), calcula su PVP con `calcularNetoProgramaConModalidad` cuando aplica —
  tomando el mínimo sobre los PVP resultantes, no sobre los netos crudos (`montoSinMarkup` varía
  por tarifa). Las filas que no califican (modo categoría siempre; sin tarifa, regla apagada, o
  modalidad histórica) usan EXACTAMENTE el camino de siempre — matemáticamente equivalente byte
  a byte gracias a que `pvpPrograma` es monótona no-decreciente en `neto` para un `opt` fijo.
- **Base neta negativa/cero.** `pvpPrograma` ya no devuelve 0 cuando `neto === 0` con
  `montoSinMarkup > 0` (ej. modo `'pct'` con `valor=100%`: toda la tarifa es "impuesto",
  `baseNeta=0` → `Venta = impuestos`, no 0 — el guard viejo se comía el impuesto). Una `baseNeta`
  NEGATIVA es una configuración inválida: nueva función pura `validarTarifaModalidad(tarifa,
  regla, modalidadMk)` (no-op fuera de la modalidad nueva — los datos históricos JAMÁS quedan
  bloqueados) la rechaza en las 3 fronteras — `SalidasEditor` (bloquea el guardado),
  `guardarSalidas` (Server Action, solo si `regla.activa`), y el propio RPC (antes del
  DELETE/INSERT, misma fórmula `base_neta = base_comisionable * (1 - pct_comision/100)`).
- **ACL/CHECK endurecidos.** `revoke ... from anon` explícito (además de `from public`) sobre
  `guardar_programa_salidas`, verificado con `has_function_privilege`. El chequeo de existencia
  del CHECK de la columna ahora filtra por `conrelid = 'public.programas'::regclass` (no solo
  `conname`). La columna se AUDITA (tipo/nullable/default vía `information_schema.columns`)
  antes del `add column if not exists` — aborta con mensaje claro si ya existiera con una
  definición distinta, en vez de aceptarla en silencio.

**Revisión PR #277, ronda 2 (3 correcciones más, la 161 sigue sin correr en producción).**
- **Concurrencia.** `guardar_programa_salidas()` ahora abre con `SELECT ... FOR UPDATE` sobre la
  fila de `programas` — antes, dos guardados simultáneos del MISMO programa podían intercalar su
  UPDATE+DELETE+INSERT y mezclar la regla de uno con las salidas del otro. La lectura de la
  modalidad cuando `modalidadMk` está AUSENTE del payload se hace de la fila YA BLOQUEADA (nunca
  con un SELECT aparte antes de esperar el lock) — así un guardado con payload viejo que gana el
  lock DESPUÉS de otro hereda la modalidad que ese otro dejó (o la que ya había, si hizo
  ROLLBACK). El lock es por FILA: programas distintos no se bloquean entre sí. Prueba real con
  dos conexiones psql: `supabase/scripts/pruebas/test_concurrencia_modalidad_mk.sh`.
- **Paridad numérica JS↔Postgres.** El RPC siempre calculó `base_neta` con aritmética `numeric`
  exacta (nunca redondeaba). El desajuste estaba del lado JS: `validarTarifaModalidad()`
  comparaba contra el `baseNeta` YA REDONDEADO a 2 decimales de `calcularNetoProgramaConModalidad`
  — una base apenas negativa (ej. -0,0036) podía redondear a `-0` (que en JS no es `< 0`) y pasar
  el navegador/Server Action mientras el RPC, con la MISMA tarifa, la rechazaba. Nueva
  `baseNetaExacta()` (sin redondear ningún paso intermedio, misma secuencia que el RPC) es la que
  usa `validarTarifaModalidad` para la comparación — el redondeo a 2 decimales se conserva SOLO
  para el valor mostrado/persistido.
- **Función compartida `calcularPvpAcomodacionSalida()`.** La decisión "¿esta acomodación usa la
  modalidad nueva o el camino histórico?" estaba reescrita 3 veces (`getProgramaDetalle`/
  `pvpDeSalida`, `getProgramasResumen`, el editor en vivo). Ahora es una sola función pura (lib/calc/
  programaPrecio.ts) que los 3 consumidores llaman — recibe `neto`/`tarifa`/regla/modalidad/`opt`
  (con `dias` YA resuelto por el llamador: `getProgramasResumen` usa un fallback de días distinto
  entre el camino histórico y el nuevo, una asimetría preexistente a este PR que no se toca para
  no cambiar en silencio los números de "Desde" ya mostrados). El CHECK de la migración (punto
  anterior) también se endureció para comparar `pg_get_constraintdef()` contra la expresión
  esperada cuando el constraint YA existe, no solo detectarlo por nombre+tabla.

### 1.3 Modelo de datos

`programas` (cabecera): `id, proveedor_id (FK), nombre, subtitulo, dias, noches, moneda (default
USD), salidas` (texto libre), `vigencia_desde/hasta, min_pax/max_pax, pct_mk,
pct_fee_tarjeta, asistencia_medica_dia, modo_precio ('categoria'|'salida'), desde_precio`
(override manual del "Desde"), `nino_edad_max/nino_valor_servicios` (legacy) +
`edad_nino_min/max, edad_infante_max` (migración 081, defaults 2/11/1), `texto_condiciones/
cancelacion/pagos, notas` (interno, nunca en el PDF), `highlights text[]` (migración 111),
`portada_url, flyer_url, historia_url` (migración 113, bucket público `programas`), `video_url`
(migración 069), `incluye_aereo` (legacy, ver `tipo_transporte` abajo), `activo, publicado`.

**`tipo_transporte`** (migración 139, jul-2026, reemplaza `incluye_aereo` como fuente de
verdad): `'ninguno' | 'aereo' | 'terrestre'`. Antes solo existía `incluye_aereo: boolean`
("Solo terrestre" vs "Con aéreo"), pero el dueño distingue un tercer caso real: **Porción
terrestre** = programa con hospedaje/asistencia/tours pero SIN traslado punto-origen→punto-
destino (el cliente llega por su cuenta); **Con aéreo** = el traslado origen→destino es un
vuelo; **Salida terrestre** = el traslado origen→destino es un BUS (puede ser un destino a
pocas horas). `incluye_aereo` se conserva (no se borran columnas) y se sigue derivando en
código (`incluye_aereo: tipoTransporte === "aereo"`) por compatibilidad, pero ya no se lee como
fuente — todo el código nuevo lee `tipo_transporte`. Backfill: `'aereo'` donde
`incluye_aereo=true`, si no `'ninguno'`. UI: `CabeceraForm.tsx` (select de 3 opciones),
`ProgramaEditor.tsx` (carga inicial con fallback a `incluye_aereo` para programas viejos sin el
campo aún poblado). Se refleja como badge (ícono `Plane`/`Bus`/texto plano, 3 colores
distintos) en `TarifarioPublic.tsx` (+ filtro de 4 opciones: Todos/Con aéreo/Salida terrestre/
Porción terrestre), `app/tarifario/programa/[id]/page.tsx` y el documento imprimible
(`doc/page.tsx`, arreglo `sellos`/`SELLO_ICON`).

Tablas hijas (FK `programa_id` cascade; RLS lectura pública, escritura interna):
`programa_ciudades` (ruta), `programa_dias` (itinerario día a día), `programa_categorias`
(tiers de hotel), `programa_categoria_hoteles` (hotel por ciudad×tier, ciudad referenciada por
NOMBRE de texto, no FK), `programa_precios` (matriz categoría×acomodación: sencilla/doble/
triple/cuadruple/nino), `programa_salidas` (migración 068 — modo alternativo: rango de fechas ×
precio, con **noches variables por salida**, útil para circuitos nacionales tipo Amazonas/Caño
Cristales que alternan 3N/4N; `columna` permite varias columnas de hotel bajo un mismo
programa), `programa_inclusiones`, `programa_tours` (add-ons opcionales, min_pax default 2),
`programa_blackouts`.

Ambos modos de precio (categoría / salida) **comparten la misma `pvpPrograma`** (confirmado en
el comentario de la migración 068).

### 1.4 Lectura/agregación

- `getProgramasResumen(sb, soloPublicados=true)` — vitrina: mínimo neto entre `programa_precios`
  o `programa_salidas` (ignorando `bajo_solicitud`), convertido a PVP. `desde_precio` manual
  ANULA el mínimo calculado si está seteado y `>0`.
- `getProgramaDetalle(sb, id)` — detalle completo (vitrina + reservar). Descarta netos
  `<=0` como "no es una acomodación real" (mismo criterio anti-"columna fantasma"). En modo
  salida, `dias` para `pvpPrograma` = el `noches` propio de la salida si está seteado, si no
  cae al `dias` de cabecera.

### 1.4bis UI de salidas, PDF y reservar (jul-2026)

- **Fix — la fecha real de la salida no se mostraba**: en modo `modo_precio='salida'`, la
  etiqueta de cada salida (`programa_salidas.etiqueta`, ej. "Octubre") se renderizaba SOLA,
  ocultando `fecha_desde` — el cliente veía "Octubre" sin saber el día exacto. Corregido en 3
  lugares independientes que duplicaban la misma lógica de armado del label (no hay un único
  helper compartido, cada uno concatena etiqueta + `formatFecha(fecha_desde)` por su cuenta):
  `app/tarifario/programa/[id]/page.tsx`, `app/tarifario/programa/[id]/doc/page.tsx` (documento
  imprimible) y `app/(dashboard)/dashboard/reservar/programa/[id]/page.tsx` (arma el `nombre`
  de cada opción de salida para el formulario de reservar).
- **`ProgramaReservaForm.tsx` — campo de salida simplificado**: en modo salida existían DOS
  controles redundantes ("Salida (fecha)" un `<select>` de opciones + "Fecha de salida" un
  calendario aparte, que el asesor debía sincronizar a mano). Ahora es **un solo `<select>`**
  (label "Salida") que al elegir una opción setea `categoriaId` Y `fechaIda` juntos desde la
  misma fila de `programa_salidas` — imposible que queden desincronizados. El estado inicial de
  `fechaIda` se deriva de `categorias[0]?.fechaSugerida`. El modo por categoría (no-salida) no
  cambió: sigue con selector de categoría + calendario aparte (ahí sí tiene sentido, la fecha es
  libre dentro de la vigencia).
- **Flyer/Historia — reubicados fuera del documento imprimible**: `flyer_url`/`historia_url`
  (piezas subidas, no generadas — ver §1.3) vivían como botones dentro de `DocToolbar.tsx` (la
  barra del documento imprimible `/tarifario/programa/[id]/doc`). El dueño pidió sacarlos de ahí
  y ponerlos junto al botón "Generar documento PDF" en la página del programa
  (`app/tarifario/programa/[id]/page.tsx`, enlaces directos a `p.flyer_url`/`p.historia_url`).
  `DocToolbar.tsx` quedó solo con el toggle de marca blanca y el botón imprimir.
- **Portada por Google Drive no renderiza**: `portada_url` es un campo de URL libre en
  `CabeceraForm.tsx` — si se pega un link de "compartir" de Google Drive (página visor HTML, no
  la imagen directa), el `<img>` no puede cargarlo y queda roto. No es un bug de la app (mismo
  patrón ya documentado para el CMS del sitio web); la vía correcta es subir el archivo con el
  widget `ProgramaImagenes.tsx` (bucket `programas`), no pegar una URL externa de Drive.

### 1.5 `reservarPrograma()` — `app/(dashboard)/dashboard/reservar/actions.ts`

Server-autoritativo (re-lee `programas`/`programa_precios`/`programa_salidas`, no confía en
precios enviados por el cliente):
1. Carga programa + proveedor; valida vigencia y blackouts contra `fechaIda`.
2. Resuelve neto por acomodación (categoría o salida); rechaza filas `bajo_solicitud`.
3. PVP por pax vía `pvpPrograma` (días = noches de la salida o de cabecera).
4. **Liquidación por HABITACIONES** (no por pax): `paxPorAcom` = cantidad de habitaciones;
   `paxDeAcomodacion(acom)` (de `lib/acomodaciones.ts`) multiplica habitaciones→pax. Niños se
   cobran por cabeza aparte contra `netoDe['nino']`. Infantes son pax adicionales sin costo/silla
   directo (solo suman a `totalPax`).
5. Validación de edad cruzando `fecha_nacimiento` contra `edad_infante_max`/`edad_nino_max`
   propios del programa (solo si todos los pasajeros tienen fecha de nacimiento).
6. `numero := siguiente_numero_contrato()`.
7. Inserta `ventas` (`tipo_paquete:'programa'`, **moneda del programa** — USD-aware de verdad,
   no forzado a COP), `contrato_pasajeros`, `contrato_items` (1 línea por acomodación + niños),
   `contrato_hoteles` (informativo, desde `programa_categoria_hoteles`).
8. **CxP al proveedor** (service-role, `postearAsientoCxP`): `tipo_proveedor:'programa'`,
   `valor_total=costoNeto`, `moneda` del programa, retención del catálogo `proveedores`. Patch
   `ventas.costo_receptivo=costoNeto`. Todo en try/catch — no bloquea la reserva si falla el
   paso contable (best-effort, igual patrón que cotización manual).

### 1.6 Importador "pegar del proveedor" — `lib/programasImport.ts` (parser puro)

`parsearPrograma(textoRaw)` → `{nombre, dias, noches, ruta, ciudades[], itinerario[], incluye[],
noIncluye[]}` — sin acceso a BD, testeable. Heurísticas: nombre=primera línea no vacía; días/
noches por regex en las primeras 6 líneas; ruta = línea con ≥2 tokens tipo-ciudad separados por
`–—-/·•|`; encabezados de día `^d[íi]a\s*0*(\d{1,2})`; detección de comidas
(desayuno/almuerzo/cena/etc.) por regex sobre título+descripción; bloques incluye/no incluye
cerrados por encabezados de precios/hoteles/notas para no tragar tablas.
`importarDesdeTexto(programaId, texto, opciones)` es el wrapper impuro: reemplaza SOLO las
secciones marcadas (destructivo por sección, nunca todo el programa de una vez).

### 1.7 Regla confirmada: Programas ≠ Paquetes — verificado por código, no solo por CLAUDE.md

`componerTarifa` (motor de paquetes) solo se usa desde `lib/reservar/cotizar.ts` y
`paquetes/actions.ts` — **nunca** desde ningún archivo de programas. `pvpPrograma`/
`calcularNetoPrograma` solo se usan desde `lib/programas.ts`, `lib/calc/programaPrecio.ts`,
`reservarPrograma` y la UI de programas — **nunca** desde `paquetes.ts`/`paquetes/actions.ts`/
`cotizar.ts`. Los dos motores tienen campos con nombres parecidos (`pct_mk` en ambas tablas)
pero viven en tablas distintas y nunca se cruzan en una función compartida. `paquetes.ts` es
estructuralmente distinto (liquidación noche a noche por temporada, impuesto BNC, vuelo
mk-vs-TA) — nada de eso existe en `pvpPrograma`, que es una fórmula plana de 3 pasos por
persona.

---

## 2. Cotización manual/dinámica — `app/(dashboard)/dashboard/cotizaciones/`

### 2.1 Modelo de datos — corrección: no hay tabla `cotizacion_manual`

La migración `084_cotizacion_manual.sql` (nombrada por la funcionalidad, no por una tabla
nueva) en realidad: agrega `tipo` (`'tarifario'|'manual'`) a la tabla YA EXISTENTE
`cotizaciones` (migración 054), relaja `payload` a nullable, y crea la tabla nueva
**`cotizacion_servicios`**.

- **`cotizaciones`** (tabla compartida, `tipo='manual'` para este flujo): `id, codigo`
  (auto `C-0001`), `estado ('abierta'|'convertida'|'descartada')`, `tipo, payload` (jsonb — el
  `CotizacionManualInput` completo), `detalle` (jsonb — snapshot listo para el documento del
  cliente), `cliente, cliente_documento, destino, hotel, pax, precio_venta, moneda, fecha_salida/
  regreso, vigencia_hasta, asesor, creado_por, numero_contrato` (FK `ventas`, se llena al
  convertir). RLS: roles internos superadmin/gerencia/administracion/operaciones/venta, sin
  columna tenant.
- **`cotizacion_servicios`** (una fila por servicio suelto): `id, cotizacion_id (FK), orden,
  tipo_servicio ('aereo'|'hotel'|'traslado'|'asistencia'|'otro'), plataforma, nombre_servicio,
  proveedor, costo_neto, modo ('mk'|'ta'), pct_markup, ta, valor`.
- `ventas.recobro_total/recobro_empresa/recobro_aliado` (migración 086) —
  compartido con Programas/Reservar, ver [`finanzas-comisiones.md`](./finanzas-comisiones.md)
  §5.

### 2.2 `manual-actions.ts` — valoración por servicio

```ts
function valorServicio(costo, modo, pctMarkup, ta): number {
  if (modo==='ta') return round(max(0,costo) + ta);
  if (costo<=0 || mk>=1) return 0;
  return round(marcar(costo, pctMarkup/100));   // reusa marcar() de lib/calc/paquetes.ts
}
```
Solo `tipo==='aereo'` puede usar `modo:'ta'`; cualquier otro tipo se fuerza a `'mk'` aunque el
formulario mande `ta`. `marcar()` importado de `lib/calc/paquetes.ts` es el ÚNICO punto de
contacto entre este motor y el de Paquetes — y es solo el helper genérico `costo/(1-mk)`, no
`componerTarifa` ni nada específico de paquetes/programas.

**Ítem único de cara al cliente** — `nombrePaqueteItem()`:
```
"PAQUETE TURÍSTICO A {DESTINO} DEL {ida} AL {regreso}"
```
No revela hoteles ni proveedores (eso va a los vouchers internos); el detalle por servicio
queda solo en `cotizacion_servicios`/`detalle`.

**Recobro + niños** (`calcularRecobroNinos`):
```
totalNinos      = nNinos × valorNino
recobroN        = max(recobro, 0)
esB2B           = tipoAsesor !== 'interno'
recobroAliadoN  = esB2B ? clamp(recobroAliado, 0, recobroN) : 0
recobroEmpresaN = recobroN − recobroAliadoN

adultSubtotal    = totalServicios + recobroN        (recobro ESCONDIDO en la tarifa de adulto)
tarifaAdultoUnit = round(adultSubtotal / adultos)
precioVenta      = adultSubtotal + totalNinos
```
Cliente final → 100% empresa (nunca ve el recobro como línea aparte). Agencia/freelance →
split configurable.

`lib/cotizacion/incluye.ts`: `sugerirIncluye(servicios)` (autogenera línea por servicio, texto
libre editable) + `NO_INCLUYE_DEFAULT` (4 líneas boilerplate).

### 2.3 Editable post-creación — CORRECCIÓN a una nota vieja de CLAUDE.md

CLAUDE.md decía "recobro/niños hoy se editan solo al crear (no hay editor posterior aún)" —
**esto está desactualizado**. Existen y están cableados a la UI (mientras `estado==='abierta'`,
es decir antes de convertir a contrato):
1. `actualizarTitularCotizacionManual` (`TitularEditor.tsx`).
2. `actualizarIncluyeCotizacionManual` (`IncluyeEditor.tsx`).
3. `actualizarRecobroNinosCotizacionManual` (`RecobroNinosEditor.tsx`) — re-corre
   `calcularRecobroNinos` sobre el subtotal YA liquidado de `cotizacion_servicios` (no
   re-liquida los servicios), recalcula `tarifaAdultoUnit`/`precioVenta`.

Lo único genuinamente no editable post-creación es la **lista de servicios sueltos** en sí
(costos/markup de `cotizacion_servicios`) — no hay `actualizar*` para esa tabla; cambiar un
servicio exige descartar y recrear la cotización.

### 2.4 `convertirCotizacionManualAContrato()` — flujo exacto

1. Carga cotización `tipo='manual' AND estado='abierta'` + sus `cotizacion_servicios`.
2. **Candado duro**: exige titular con nombre, tipo/número doc Y **fecha de nacimiento** — si
   falta algo, error listando exactamente qué.
3. Suma `costo_neto` por `tipo_servicio` en 5 buckets: `costoAereo, costoHotel,
   costoReceptivo(traslado), costoAsistencia, costoOtros` — cada uno en su lugar de
   rentabilidad/flujo de caja.
4. `numero := siguiente_numero_contrato()`.
5. Re-calcula recobro/niños con la misma `calcularRecobroNinos`.
6. Inserta `ventas` (**`tipo_paquete:'dinamico'`**, canal B2C/B2B, los 5 buckets de costo,
   `recobro_total/empresa/aliado`, `comision_b2b`/`comision_estado:'pendiente'` si aplica).
7. Inserta 1 fila en `contrato_items` (la línea agrupada "PAQUETE TURÍSTICO A...").
8. Si B2B y `recobroAliadoN>0`: inserta `aliados_b2b` (`base_comision=recobroAliadoN,
   pct_recobro_aliado=recobroAliadoN/recobroN, estado:'pendiente'`).
9. Inserta `contrato_pasajeros`: **el titular es el único pasajero** (orden 0).
10. **CxP** (service-role, best-effort): una fila por servicio con `costo_neto>0`;
    **`proveedor` = la `plataforma` del servicio** (cae a `proveedor` si el asesor lo tipeó);
    `tipo_proveedor` mapeado (`aereo→aereo, hotel→hotel, traslado→receptivo, asistencia→
    asistencia, otro→otro`); retención buscada por nombre en el catálogo `proveedores`. Cada
    CxP también postea vía `postearAsientoCxP`.
11. Marca la cotización `estado:'convertida'`, guarda `numero_contrato`.

### 2.5 Moneda
Un solo `moneda` (COP/USD) fijado al crear, propagado a `ventas.moneda` y a cada CxP — sin
conversión FX automática (a diferencia de Programas, que sí es multi-moneda real por programa).

## 3. Mayorista vs. Minorista — ambos módulos son solo gating de UI, no de datos

Tanto Programas como Cotización manual se ocultan de minorista vía `minoristaOculto` en el nav
(`app/(dashboard)/layout.tsx`) — Cotizaciones directamente flagueada; Programas hereda el hide
de su padre `/dashboard/producto` ("Netas").

**Ni `programas`/`programa_*` ni `cotizaciones`/`cotizacion_servicios` tienen columna `tenant`,
ni sus políticas RLS filtran por tenant** — solo por `mi_rol()`. La migración 116
(`rls_tenant_isolation`) NO tocó estas tablas. Es decir: un usuario interno con rol adecuado que
navegue directo a `/dashboard/producto/programas` o `/dashboard/cotizaciones` con el tenant
"minorista" activo en la UI **no sería bloqueado** por ningún chequeo de página ni de RLS — la
exclusión de minorista de estos módulos es una convención de producto/menú, no un límite de
datos forzado (mismo patrón, y misma limitación, que Tarifario/Reservar).

## Enlaces cruzados

- **Tarifario y paquetes** — el motor `componerTarifa`/`lib/calc/paquetes.ts`, deliberadamente
  NUNCA compartido con Programas — ver [`tarifario-y-paquetes.md`](./tarifario-y-paquetes.md).
- **Comisiones/Rentabilidad** — cómo entra `recobro`/`aliados_b2b` al P&L — ver
  [`finanzas-comisiones.md`](./finanzas-comisiones.md).
