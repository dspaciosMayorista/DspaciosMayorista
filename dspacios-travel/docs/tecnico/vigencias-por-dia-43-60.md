# Vigencias netas por grupos de días (#43) + promociones por grupo (#60) — diseño

> **Esto es el HISTORIAL del diseño. La especificación vigente, breve y sin contradicciones, es [`vigencias-por-dia-43-60-especificacion.md`](./vigencias-por-dia-43-60-especificacion.md).** Las secciones A–L conservan alternativas y recomendaciones que luego se decidieron distinto; las secciones M a AE (al final) las corrigen y mandan sobre las anteriores.


Estado: **diseño, sin implementación** (2026-11-10). Rama `claude/43-60-vigencias-por-dia` desde origin/main `e39224313`.
IDs vigentes (TASKS.md): **#43** (antes #85) vigencias netas por día y rangos en calendario · **#60** (antes #119) promociones por día de semana.
Nota: `CURRENT_GOAL.md` aún habla de «#85 horarios de vuelos» con la numeración vieja; no se tocó (ver «Coordinación»).

Evidencia leída (entrega 0): `lib/calc/paquetes.ts` (motor noche a noche), `lib/calc/promoCalculadora.ts` (vínculo promoción-base), `lib/calc/descuentoHotel.ts` (EBB / Long Stay, #90), `docs/tecnico/tarifas-hotel.md`, migración 179 (cabecera).
**Resultado del diagnóstico remoto y conclusiones: ver §K (decisiones D1–D12 en §K.9).** **Optimización del diagnóstico por timeout (2026-11-10): ver §J.** **Entrega E1 (2026-11-10): verificación hecha — ver §E (hallazgos) y §F (recomendaciones). Entrega E2 (2026-11-10): diagnóstico de solo lectura y diseño final — ver §G (manda sobre §D.1 y sobre lo anterior) y §H (decisiones con ejemplos).** E1 corrigió varias afirmaciones de §A–§D; donde hay contradicción **manda §E/§F**. Los importes de §E y §F se ejecutaron en scripts desechables fuera del repo (motor real para el comportamiento actual; prototipo aritmético para lo propuesto); nada de eso es código del repo.

---

## A. Estado actual

### A.1 Dónde se configura
- **Vigencias** = filas de `hotel_temporadas`: `nombre` (texto), `fecha_inicio/fin` + `rangos` jsonb (varios rangos), `blackouts` jsonb, `prioridad`, `compra_inicio/fin`, `tipo` (`tarifa | descuento_pct | descuento_monto | promo_noche_gratis`), `descuento_valor`, `min_noches`, `regimen_restringido`. UI: `TemporadasBox` en `HotelDetalleClient.tsx`.
- **Tarifas netas** = filas de `tarifa_hotel` por categoría × régimen × temporada (todo por **texto**, sin FK): `neto_sencilla/doble/triple/multiple/nino/nino2/infante`, `notas`, `precio_final_autoritativo` (mig. 179). Hoy **no existe ningún concepto de día de semana** (búsqueda de `dias_semana` en lib/app/migraciones: sin resultados).
- **Calculadoras** (Dubai / Mixta / Corporativa, `lib/calc/calculadoras.ts`) generan filas de `tarifa_hotel`. Dubai además genera la fila de cada promoción (`promos[]`) con el precio final ya horneado.
- **Reglas de hotel #90** (EBB y Long Stay, `lib/calc/descuentoHotel.ts`, UI `HotelPromociones.tsx`): descuento % sobre la **neta hotelera de la estadía ya liquidada, antes del markup**, nunca vuelo/servicios; si varias cumplen, **gana el mayor %, no se suman**.

### A.2 Cómo se resuelve una noche (hechos del código)
1. `entradasNoche`: vigencias que **cubren la fecha** (rangos − blackouts), están en **vigencia de compra** hoy y coinciden con el **régimen** (si están restringidas), ordenadas por **prioridad desc**.
2. `resolverNetoNocheDetallado`: recorre esas entradas en orden y usa **la primera que tenga fila materializada** en `tarifa_hotel` para el combo; si una promoción no tiene fila, **se ignora y baja a la siguiente** (hasta la base). Si ninguna, `null` → la estadía no se vende. **Regla definitiva ya decidida: una vigencia nunca calcula ni deriva precios; el único precio válido es una fila materializada** (el camino legacy «base × (1−%)» fue retirado; mig. 179).
3. `promo_noche_gratis` **no** es por noche: se resuelve sobre la estadía (ancla = noche de entrada, `min_noches` = noches mínimas de la estadía) y descuenta `1/N` del total ya liquidado.
4. La fecha de salida no se cobra: los liquidadores iteran `numNoches` desde `fechaIda`.
5. «Desde»: `buscarNocheMasBarata` toma la noche más barata de la ventana × `numNoches`.
6. Después: markup `costo/(1−mk)` y `redondearVenta` (al final, sobre el total).

### A.3 Por persona vs por habitación/unidad
- Persona: filas `tarifa_hotel` por acomodación; `hotel_acomodaciones.pax_tarifa` multiplica por habitación.
- Corporativa: tarifa por **habitación** en el insumo, pero **se reparte a filas por persona** al generar → los grupos de días entran por la generación, sin cambio de motor.
- Modelo **por unidad** («Bernalo», `hoteles.modelo_tarifario = 'unidad'`): **verificado en E1 (§E.3): NO es compatible con grupos de días sin otro motor.** Resuelve UNA temporada y UNA tarifa por estadía completa (`hotel_tarifas_unidad`) y bloquea cualquier estadía que cruce más de una temporada (`estadia_multitemporada_no_soportada`). La v1 de grupos queda limitada al modelo por persona.

### A.4 Reutilizable
- `coberturaTemporada` / `nochesCubiertas` (fechas efectivas = rangos − blackouts) para la vista de fechas efectivas.
- `resolverNetoNocheDetallado` ya devuelve **la vigencia ganadora por noche** → base natural del desglose noche por noche.
- Patrón «promo = fila materializada con precio final autoritativo» (mig. 179) → la promoción por grupo es **más filas del mismo tipo**, no una regla nueva de cálculo.
- `resolverBasePromo` (promoción ↔ base) → se amplía con grupos; hoy exige una sola base y prioridad mayor.
- `etiquetaFilaTarifa` y procedencia de noche (`ProcedenciaNoche`) para rotular.

---

## B. Propuesta de interfaz

### B.1 Recorrido para crear una vigencia con grupos
1. Crear/editar vigencia como hoy (nombre, rangos con calendario, blackouts, prioridad, compra, régimen). #43 añade **selector de rango en calendario** y la lista «Fechas efectivas» (rangos − blackouts).
2. Sección nueva **«Días de aplicación»**. Por defecto un solo grupo implícito **«Todos los días»** (comportamiento actual, sin filas nuevas).
3. «Dividir por días»: se agregan grupos con nombre libre y casillas L M X J V S D. Cantidad libre, días no necesariamente consecutivos.
4. Validación en vivo: solape entre grupos (error), días sin grupo (aviso informativo: «esos días quedan fuera de esta vigencia y se resuelven con otra vigencia aplicable»; D13, §N).

```
Vigencia: ALTA ENE-MAR     Rango: 02/01/2027 – 31/03/2027   Prioridad 1
Días de aplicación
  ┌ Grupo "Semana"         [L][M][X][J][ ][ ][ ]   (Lun–Jue)
  └ Grupo "Fin de semana"  [ ][ ][ ][ ][V][S][D]   (Vie–Dom)
  [+ Agregar grupo]                         Cobertura: 7/7 días  ✓
```

### B.2 Matriz de tarifas por grupo
La tabla actual (categoría × régimen) gana una **pestaña/segmento por grupo** dentro de cada vigencia; la matriz de acomodaciones no cambia.

```
Vigencia ALTA ENE-MAR · Cat. Estándar · PAM
                 Sencilla   Doble    Triple   Múltiple  Niño
 Semana          140.000    100.000   95.000   90.000   60.000
 Fin de semana   210.000    150.000  140.000  135.000   90.000
```
Calculadoras: cada base (categoría × temporada) se captura **por grupo**; se generan las filas por grupo.

### B.3 Promoción con descuentos distintos por grupo
La promoción declara **a qué vigencia(s) base aplica** (explícito, sin trasladarse a otra base ganadora) y una regla por grupo de esa base:

```
Promoción "Reserva ya"   Prioridad 2   Compra: 01/11–15/12   Tipo: porcentaje
Aplica a: [x] ALTA ENE-MAR
   Semana          -10 %
   Fin de semana    -5 %
   (grupo sin regla = conserva la base)
```

### B.4 Vista previa noche por noche (calculadora, tarifas, cotización)
Entrada jue 07/01 → salida dom 10/01, Estándar, PAM, doble (por persona):

```
Noche       Grupo          Vigencia ganadora   Base      Promo      Neto noche
Jue 07/01   Semana         Reserva ya          100.000   -10 %       90.000
Vie 08/01   Fin de semana  Reserva ya          150.000    -5 %      142.500
Sáb 09/01   Fin de semana  Reserva ya          150.000    -5 %      142.500
(Dom 10/01  salida: no se cobra)
Total neto alojamiento                                            375.000
Sin promoción                                                     400.000
```
Regla de presentación: el redondeo comercial (`redondearVenta`) se aplica **solo al total** tras el markup; el desglose por noche muestra neto sin redondear, para no mostrar una suma que no coincida.

---

## C. Reglas

Leyenda: **[D]** ya decidido por el dueño o por el código vigente · **[P]** propuesta a confirmar · **[?]** decisión de negocio pendiente.

### C.1 Cobertura, solapes, empates (las propuestas [P] de esta sección quedan matizadas por §F.4)
- **[D]** Dentro de una vigencia, grupos con días superpuestos: prohibido (bloqueo al guardar, también en servidor).
- **[D]** Una noche sin precio materializado no se vende; ni promoción ni cierre la «arreglan».
- **[D]** (D13, §N) Un día no incluido en ningún grupo equivale a «la vigencia no cubre esa noche» (igual que un blackout): se resuelve otra vigencia aplicable por fechas, compra y prioridad; si ninguna aplica, la noche no se vende. Es **cobertura del día**, distinta de la **disponibilidad de la acomodación** (grupo que sí cubre la noche pero no trae precio: no se vende, sin rescate).
- **[P]** Aviso en el editor si una vigencia no cubre los 7 días y no hay otra vigencia debajo que complete.
- **[D]** Empate de prioridad entre **vigencias** distintas: se mantiene la regla actual (`base_empatada` bloquea el vínculo promoción-base; el motor toma la primera del orden). No se crean prioridades entre grupos: la prioridad es de la vigencia.
- **[P]** Sin grupos definidos = grupo implícito «Todos los días» (`grupo_id` nulo): resultado idéntico al de hoy.

### C.2 Festivos y vigencias especiales
- **[P]** No habrá calendario automático de festivos. Un festivo/puente se configura **expresamente** como vigencia propia (rango corto, prioridad mayor, grupo «Todos los días» o los suyos). Evita sorpresas y es lo que el motor ya soporta.
- **[?]** ¿Se necesita «Festivo» como tipo de día seleccionable dentro de un grupo? Se descarta para esta primera versión.

### C.3 Editar o eliminar un grupo usado por una promoción
- **[P]** Los grupos se referencian por **id**, no por nombre (evita el «huérfano por texto» documentado en `tarifas-hotel.md` §2). Renombrar un grupo no rompe nada.
- **[P]** Eliminar: bloqueado mientras una promoción lo referencie o existan filas de tarifa del grupo; el mensaje lista dónde se usa. Opción explícita «eliminar también sus tarifas y reglas» con confirmación.
- **[P]** Cambiar los días de un grupo: permitido (revalida solapes), cada guardado ya dispara la republicación automática del tarifario del hotel (como cualquier edición de vigencia o tarifa hoy); el diseño exige mostrar el efecto en la vista previa antes de guardar. Ver §G.1. No recalcula nada ya emitido (ver D.4).
- **[P]** Eliminar la última división vuelve a «Todos los días» solo si el usuario elige qué fila de tarifa conserva; nunca se fusionan precios automáticamente.

### C.4 Prioridad base y de promociones
- **[D]** La prioridad es la de la vigencia (base o promoción). Gana la primera vigencia con precio materializado, como hoy.
- **[D]** La promoción identifica expresamente las vigencias y grupos a los que aplica; no migra a otra base ganadora.
- **[D]** Grupo sin descuento conserva la base.
- **[P]** Cálculo: la calculadora (o el guardado manual) materializa **una fila por grupo con regla**, con el neto final y `precio_final_autoritativo`. El motor solo hace lookup: ninguna promoción se aplica dos veces.

Ejemplo (base prioridad 1, promo prioridad 2, noche de viernes): la promo tiene regla para «Fin de semana» → gana la fila promo (142.500). Si la promo solo tuviera regla para «Semana», el viernes no tendría fila promo → el motor baja a la base (150.000).

### C.5 Cambio de vigencia durante la estadía
- **[D]** Cada noche se resuelve con su propia vigencia (ya ocurre). Con grupos, cada noche usa además el grupo de **su** día de semana en **su** vigencia.
- **[D]** No se aplica a toda la estadía la tarifa del día de entrada.
- Efectos conservados: `min_noches` y noche gratis anclan a la noche de entrada (comportamiento actual).

### C.6 Tratamiento de cada tipo de promoción existente
| Tipo | Con grupos de días |
|---|---|
| `descuento_pct` (Dubai o manual) | Por grupo: % distinto, materializado en la fila del grupo. Descuenta **solo la tarifa base**, nunca suplementos de régimen (regla Dubai vigente). |
| `descuento_monto` | Por grupo, monto por persona y por noche **[?: confirmar para hoteles por habitación/unidad]**. |
| `promo_noche_gratis` | Hoy descuenta `(N−1)/N` del total (promedio), sin importar qué noche. Con noches de precio distinto el importe cambia según la noche bonificada: ver §F.1. **[?]** pendiente. No es por grupo; sin grupos se conserva el promedio actual. |
| EBB / Long Stay (#90) | Aplican sobre la neta de la estadía ya liquidada, mayor % gana entre ellas. **Verificado en E1: hoy SÍ se acumulan con una promoción materializada** (el descuento #90 se aplica sobre el total que ya trae la fila promocional ganadora). Sin grupos se conserva tal cual. **DECIDIDO (D9, §Q):** la acumulación y la precedencia las define el proveedor, promoción por promoción y solo cuando una promoción puede coincidir con una regla EBB / Long Stay; las existentes conservan el comportamiento actual. |
| Mínimo de noches (`min_noches`) | Sigue siendo de la vigencia (no por grupo). |
| Compra anticipada (`compra_inicio/fin`) | De la vigencia/promoción (no por grupo). |
| Restricción de régimen | Se mantiene; la regla por grupo existe por régimen. |
| Precio final autoritativo | Las filas por grupo de una promoción son autoritativas; nunca se vuelve a descontar. |

### C.7 Decisiones de negocio pendientes (resumen)
Con importes y recomendación en §F:
1. **[?]** Noche bonificada en «N noches, 1 gratis» con noches de distinto precio (§F.1).
2. **[D]** Acumulación con EBB/Long Stay (D9, §Q): se configura por promoción cuando hay coincidencia posible; lo existente sigue acumulándose como hoy.
3. **[D]** Unidad del descuento absoluto: se elige explícitamente (D10, §S.2); descuento mayor que la tarifa ⇒ no aplica y sin selector de pasajeros (§T).
4. **[?]** Cobertura incompleta: grupo sin fila, día sin grupo, empate de prioridades (§F.4).
5. **[D]** Cálculo del «Desde» de porción terrestre para hoteles con grupos (D11, §U).
6. **[?]** ¿«Festivo» como tipo de día? (propuesta: no en v1).

---

## D. Alcance técnico

### D.1 Modelo de datos recomendado (aditivo) — REEMPLAZADO por §G.2
- `hotel_temporada_grupos`: `id uuid`, `temporada_id` FK → `hotel_temporadas`, `nombre`, `dias smallint[]` (1=lunes … 7=domingo), `orden`. Restricción de no solape entre grupos de una misma vigencia (función + trigger/exclusión; **[verificar]** patrón de validación usado en otras migraciones).
- `tarifa_hotel.grupo_id uuid null` FK → grupos. `null` = «Todos los días» (todo el dato existente). **[verificar]** índices/unicidades actuales de `tarifa_hotel` (la llave debe incluir `grupo_id` tratando null de forma coherente).
- Promociones por grupo: `hotel_promo_grupo_reglas` (`promo_temporada_id`, `base_temporada_id`, `grupo_id`, `tipo` pct/monto, `valor`) como **insumo/auditoría** de la calculadora. El precio efectivo sigue siendo la fila materializada de `tarifa_hotel`; la tabla evita guardar el % solo dentro de `hotel_calculadora.params` jsonb.
- Resolución: la clave de lookup pasa de `nombre` a `(nombre, grupo_id)`. Para una promoción, el grupo de la noche se obtiene de la **base referenciada** (mismo `grupo_id`), no de grupos propios.

**Alternativas descartadas**
| Alternativa | Motivo |
|---|---|
| Duplicar la vigencia por grupo (una por «Semana», otra por «Fin de semana») | Rompe prioridad/compra/blackouts compartidos, multiplica filas, impide ver la vigencia como una unidad y complica el vínculo con promociones. |
| Columnas de días (`aplica_lunes…`) en `tarifa_hotel` | Un solo conjunto por fila, no permite grupos con nombre ni validar solapes; no escala al corregir días. |
| Grupo por **texto** (`tarifa_hotel.grupo = 'Semana'`) | Repite el defecto documentado de huérfanos por renombre (`tarifas-hotel.md` §2). |
| Calcular el descuento en el motor sobre la base del grupo | Contradice la regla definitiva (mig. 179): vigencias no derivan precios; reabre el doble descuento y la divergencia entre preview y reserva. |
| Descuento por grupo en jsonb dentro de `hotel_temporadas` | Sin integridad referencial ni consultas; no resiste renombres ni eliminaciones de grupo. |

### D.2 Compatibilidad
- Sin grupos ⇒ `grupo_id` nulo en todo; el resolver trata «sin grupos» como «Todos los días». Resultado numérico idéntico al actual (se demuestra con pruebas de caracterización antes de tocar nada).
- Sin backfill obligatorio. No se editan migraciones existentes ni se borran columnas.
- Datos ya publicados (`tarifario_resultado`) no cambian hasta que alguien regenere.

### D.3 Impacto por pieza
| Pieza | Impacto |
|---|---|
| `lib/calc/paquetes.ts` | **Revisado en E1 (cambio menor, no reescribir liquidadores):** `TemporadaRango` gana `grupos` opcional; `resolverNetoNocheDetallado` calcula el día de la semana de la noche, elige el grupo de la vigencia y busca el neto con clave `nombre` o `nombre::grupo`. Los cuatro `liquidar*` no cambian de firma. Un helper exportado construye `netoPorTemporada` desde las filas (hoy cada llamador lo arma a mano en 5 sitios, ver §E.3). El desglose noche por noche sale de la misma función por noche. «Desde» de porción: función aparte solo para hoteles con grupos (§F.5). |
| `lib/calc/promoCalculadora.ts` | `resolverBasePromo` considera grupos (promoción ↔ base y grupo). |
| `lib/calc/calculadoras.ts` + `CalculadoraEditor.tsx` | Dubai/Mixta/Corporativa capturan base y promo por grupo y generan filas por grupo. **[verificar]** (no leído). |
| Tarifas manuales / CSV | Segmento por grupo; la plantilla CSV necesita columna de grupo **[verificar]** `cargarTarifasMasivo`. |
| Generación/publicación (`paquetes/actions.ts`, `lib/tarifario/vigencia.ts`, `resumen.ts`) | Pasar grupos al liquidador; persistir procedencia. **[verificar]** |
| Cotización/Reserva (`cotizar.ts`, `computo.ts`, `liquidacionHotel.ts`, cotización dinámica/carrito) | Mismo resolver por noche (§E.3); sin reescribir liquidadores. **[verificar]** |
| Modelo por unidad | Fuera de la v1: la UI no ofrece «Dividir por días» y el servidor rechaza grupos si `modelo_tarifario = 'unidad'` (§E.3). |
| `lib/calc/reglaEdadTarifa.ts` | **Punto crítico hallado en E1:** `resolverReglaEdadEstadiaSegura` falla cerrado si hay más de una fila por categoría+régimen+temporada («temporada duplicada»). Con grupos, TODA reserva y cotización de ese hotel quedaría bloqueada. Hay que tolerar varias filas de una misma temporada cuando coinciden en la regla de edad (§E.3). |
| RPC `generar_tarifas_hotel_calculadora` y `_tarifa_clave` (mig. 203; `reemplazar_tarifas_hotel_calculadora`, mig. 179) | La clave de reemplazo es (categoría, régimen, temporada): al generar un grupo borraría el otro y rechazaría «claves repetidas». Requiere `create or replace` con el grupo en la clave (§E.3). |
| Cierre de ancho de ventana | Rangos con calendario (#43): componente de calendario reutilizable en vigencias; `nochesCubiertas` para fechas efectivas. |

### D.4 Preservación de lo emitido
- Cotizaciones y contratos guardan snapshot (`contrato_items`, `itemsSnap`, `snapshotCondiciones`, `congelarCondicionesContrato`): **no se recalculan**. Se verificará que ninguna lectura de documento reconstruya precios desde `tarifa_hotel` **[verificar]**.
- Eliminar/editar un grupo usado por una cotización o contrato vigente: bloquear la eliminación de filas referenciadas por acuerdos, o conservar el snapshot de grupo/vigencia en el ítem (propuesta: snapshot del desglose por noche al emitir).

### D.5 Migraciones y archivos (sin escribir)
- Una migración aditiva (tablas de grupos y reglas, `tarifa_hotel.grupo_id`, funciones/triggers de solape, RLS acorde a `hoteles`), con preflight, postcheck y rollback en **una sola consulta cada uno** (regla del repo).
- **Número:** no asumir. origin/main llega a 283; hay números tomados por otros frentes (284/285/287 aplicadas, 286 = #97 sin aplicar, #75 desde 288 según el registro del equipo). Correr `ls supabase/migrations | sort | tail` en la rama al escribirla y coordinar con #97/#75.
- Archivos probables: ver D.3 más `types/database.ts`, `HotelDetalleClient.tsx` (TemporadasBox y TarifasBox), `docs/tecnico/tarifas-hotel.md` y `calculadoras-hotel.md`.

### D.6 Plan por entregas
Reemplazado tras E1: el plan vigente está en §F.6 (E1 hecha; E2 preflight y diseño de migración; E3 pruebas de caracterización; E4 migración; E5 motor; E6 UI y calculadoras; E7 promoción por grupo; E8 «Desde» y paridad).
### D.7 Pruebas que demuestran paridad
Un fixture único («hotel de ejemplo») ejecutado por **todos** los recorridos (vista previa de calculadora, generación de tarifario, «Desde», cotización por fechas, cotización dinámica/carrito, reserva) con el mismo desglose y total esperados:
1. **Ejemplo obligatorio**: base L–J 100.000, V–D 150.000; promo L–J −10 %, V–D −5 %; entrada jueves, salida domingo ⇒ 90.000 + 142.500 + 142.500 = **375.000**; sin promo **400.000**; la salida no cobra noche.
2. Sin grupos ⇒ resultados idénticos a los de hoy (golden files).
3. Grupo sin regla en la promo ⇒ conserva la base; sin fila ⇒ cae a la base; sin base ⇒ no vendible.
4. Estadía que cruza dos vigencias y dos grupos.
5. Promoción vencida en compra / fuera de régimen.
6. Noche gratis y EBB/Long Stay sin doble aplicación.
7. USD vs COP (redondeo al total), Adults Only, niño/infante.
8. Edición/eliminación de grupo con promoción y con cotización emitida (snapshot intacto).
9. Solape de grupos rechazado en cliente y servidor.

---

## Coordinación
- No duplica tareas: se enlaza desde las filas #43 y #60 de `TASKS.md`.
- `CURRENT_GOAL.md` no se modificó. Dice «#85 horarios de vuelos» con numeración antigua y TASKS.md lista #97 como frente en curso; conviene que quien coordine lo actualice antes de elegir el objetivo único.
- Sin tocar #75, #97 ni PR #442. Sin migraciones, SQL remoto, regeneración ni publicación de tarifas.

---

# E. Verificación E1 (2026-11-10)

**Leído en E1:** `lib/reservar/liquidacionHotel.ts` (evaluador por fechas), `lib/reservar/cotizar.ts` (diagnóstico), `lib/reservar/computo.ts` (reserva), `app/(dashboard)/dashboard/paquetes/actions.ts` (generación/publicación), `lib/tarifario/vigencia.ts` (visibilidad), `lib/tarifario/resumen.ts` y `dinamicoBooking.ts` (cabeceras), `lib/calc/calculadoras.ts` (Mixta completa; Dubai/Corporativa por índice), `lib/calc/reglaEdadTarifa.ts` y `condicionesTarifa.ts`, modelo por unidad (`resolverTemporadaEstadia.ts`, `resolverTarifaAlojamiento.ts`, `orquestarCotizacionAlojamientoBernalo.ts`, cabeceras de `unidadAlojamiento.ts`), `hoteles/actions.ts` (CSV y generación), migraciones 016, 179 y 203 (claves y RPC).
**Ejecutado:** `ejemplos_motor_actual.mjs` (llama al `lib/calc/paquetes.ts` real) y `prototipo_grupos.mjs` (aritmética del diseño, no es código del repo), ambos en el scratchpad de la sesión.
**No leído a fondo (quedan como riesgo):** `HotelDetalleClient.tsx` y `CalculadoraEditor.tsx` (UI), `tarifasUnidadActions.ts`, `TarifasUnidadEditor.tsx`, `datosBernalo.ts`, `evaluarDisponibilidadUnidad.ts`, programas y servicios (otros motores).

## E.1 «Una vigencia nunca deriva precios»: regla vigente, legado y propuesta

| Ámbito | Qué ocurre (verificado) | Clasificación |
|---|---|---|
| Cotización, reserva, publicación, visibilidad (modelo por persona) | Ningún liquidador usa `descuento_valor`; el precio es solo la fila de `tarifa_hotel`. Búsqueda de `descuento_valor/pct/monto` en lib y app: aparece en lecturas (`select`), etiquetas de historial/UI y en `resolverBasePromo`, nunca en un cálculo de precio de estadía. | **Regla vigente** |
| Calculadora **Dubai** | La promo vive en `params.promos[]` (`temporadaBase`→`temporadaPromo`, `descuentoPct`); escribe fila final con `precio_final_autoritativo` y `temporada_base`. | Vigente |
| Calculadora **Mixta** | **Sí deriva desde la vigencia:** toma el `descuento_valor` de cada vigencia `descuento_pct` y la base inferida por `resolverBasePromo` (por fechas y prioridad) y escribe filas finales. La regla «la vigencia no deriva» es cierta para el motor de cotización, **falsa para la generación Mixta**. | Vigente, con matiz |
| Calculadora **Corporativa** | Su `descuento_pct` está en `params` (descuento sobre el rack), no en una vigencia promocional. | Vigente |
| Filas escritas a mano / CSV | Aceptadas tal cual (`cargarTarifasMasivo` inserta sin validar). Mixta las protege de sobrescritura (`bloqueadas`). | Vigente |
| `descuento_monto` | Existe en el selector de la UI («$ por pax») y en el historial, pero **ningún generador lo produce**: solo sirve con filas manuales. | Legado a aclarar |
| Comentarios en `liquidacionHotel.ts` (≈ líneas 85–101) y `HotelDetalleClient.tsx` (≈ 504–513) | Describen el camino retirado «recalcular base × (1−%)». Desactualizados respecto de `paquetes.ts`. | **Legado** (documentación) |
| `tarifa_hotel.temporada_base` | Es solo auditoría: el motor **no** lo consulta al cotizar. De ahí la brecha de E.2-caso 2. | Brecha vigente |
| **Modelo por unidad** | Elige la tarifa unidad por **nombre** de la temporada ganadora. `resolverNocheDetallado` no filtra por tipo ni recibe régimen, así que una vigencia `descuento_*` o `promo_noche_gratis` ganadora se buscaría como nombre de tarifa unidad (observado en código, **no ejecutado**). | Observado |
| Promociones por grupo | Filas materializadas por grupo, como Dubai/Mixta hoy. Sin cálculo nuevo en el motor. | **Propuesta** |

## E.2 Prioridades: ejemplos con el motor real (comportamiento ACTUAL)

Datos: ALTA (base, prioridad 1, 1–31 ene); PUENTE (base, prioridad 3, 10–12 ene); PROMO-ALTA (`descuento_pct`, prioridad 4, 1–31 ene, fila derivada de ALTA). Precios 100.000 / 200.000 / 90.000. Estadía 9 ene, 4 noches (9, 10, 11, 12).

| # | Caso | Hoy (ejecutado) | Propuesta |
|---|---|---|---|
| 1 | Gana otra vigencia base | 100.000 + 3 × 200.000 = **700.000** (PUENTE gana 10–12) | Igual. |
| 2 | Promo con fila de una base que **perdió** (PROMO-ALTA prioridad 4 cubre 10–12, donde gana PUENTE) | 4 × 90.000 = **360.000**: la promo «rescata» ALTA sobre noches donde le corresponde PUENTE | Una fila promo con `temporada_base` solo gana la noche si esa base es la **ganadora de la noche**. Resultado 90.000 + 3 × 200.000 = **690.000**. Filas sin `temporada_base` (manuales antiguas) conservan el comportamiento actual hasta auditarlas. |
| 3 | Promo sin fila para el combo/grupo | Cae a la base: 700.000 | Igual («grupo sin descuento conserva la base»). |
| 4 | Falta tarifa en la vigencia **base** de mayor prioridad (PUENTE sin fila para el combo) | Cae en silencio a ALTA: 4 × 100.000 = **400.000** | Sin grupos: sin cambio (legado). Con grupos: la noche cubierta por un grupo sin fila **no se vende** (ver F.4). |
| 5 | Empate de prioridad entre dos bases | Decide el **orden de lectura**: ejemplo ejecutado con A,B da 100.000/noche; con B,A da 150.000/noche | Sin grupos: sin cambio (legado, riesgo señalado). Con grupos: validación al guardar y, si aparece en datos, noche no vendible. |

Lectura del caso 2: el hueco existe en el motor para cualquier promo cuya vigencia cubra noches donde gana otra base; hoy lo contienen `resolverBasePromo` (Mixta, falla cerrado con `varias_bases`) pero no Dubai ni las filas manuales. **No se sabe si hay datos reales afectados.** Antes de endurecer filas existentes se necesita una consulta de solo lectura (una sola, con control, observado, esperado y estado, como exige el repo) que liste promociones con noches donde la base ganadora distinta de `temporada_base`, vigencias base con igual prioridad solapadas, y filas duplicadas por (hotel, categoría, régimen, temporada). Se redacta en E2; no se ejecuta ahora.

## E.3 Modelos, calculadoras, unicidades, CSV, generación y publicación

**Unicidades (verificado).** `tarifa_hotel` tiene solo `id` como llave (migración 016); en las migraciones leídas no hay índice único por (hotel, categoría, régimen, temporada). Hoy un duplicado se resuelve en silencio con «la última fila gana» en los mapas de `liquidacionHotel.ts`, `vigencia.ts` y `paquetes/actions.ts`, y `resolverReglaEdadEstadiaSegura` lo trata como error («temporada duplicada»). `hotel_tarifas_unidad` solo es única por `tarifa_id + version`.
Propuesta: índice único **parcial** sobre las filas con `grupo_id` (no toca el legado) más validación en la aplicación; los duplicados legados se miden en el preflight y no se corrigen sin decisión.

**Hallazgo crítico (regla de edad).** `reglaEdadTarifa.ts` busca la fila por (categoría, régimen, temporada) y, si hay más de una, **falla cerrado**. Con grupos habría varias filas por temporada y todas las reservas/cotizaciones de ese hotel quedarían bloqueadas. Cambio menor: aceptar varias filas de la misma temporada cuando su regla de edad efectiva coincide (si difieren, sigue siendo error). `condicionesTarifa.ts` ya deduplica por temporada+texto.

**Matriz de compatibilidad**

| Recorrido | ¿Grupos con cambio menor? | Punto de contacto |
|---|---|---|
| Motor por noche (`paquetes.ts`) | Sí | `resolverNetoNocheDetallado`: día de semana → grupo → clave `nombre`/`nombre::grupo`. Firmas de `liquidar*` sin cambio. |
| Armado de mapas de neto (5 sitios) | Sí | `liquidacionHotel.ts` 294–325, `computo.ts` (`netoPorTemporadaDe`), `paquetes/actions.ts` ≈1330–1396, `vigencia.ts` 49–61. Se centraliza en un helper. |
| Cotización y carrito (por fechas) | Sí | Usa `evaluarHotelPorFechas`. El diagnóstico de `cotizar.ts` 345–375 (qué temporada falta) sigue válido; opcional afinar el mensaje por grupo. |
| Reserva (`computo.ts`) | Sí | Mismos mapas; regla de edad (arriba). |
| Publicación de tarifario (bloqueo, empaquetado, dinámico, porción) | Sí | Cada fila publicada es una estadía real; porción usa `masBarato` (F.5). `procedencia_temporadas` no necesita el grupo. |
| Calculadoras Dubai/Mixta/Corporativa | Sí, expandiendo | Cada base se clona por grupo antes de generar; `TarifaGenerada` gana `grupo_id`. Mixta: con grupos exige base **explícita** (no la inferencia de `resolverBasePromo`). |
| Carga manual de tarifa | Sí | Segmento por grupo. |
| **CSV** | Sí | `cargarTarifasMasivo`: columna `grupo` (nombre, resuelto dentro de la vigencia; error si es ambiguo o no existe). `cargarTemporadasMasivo`: los grupos se definen en la UI en v1. |
| RPC de generación (mig. 203 `generar_tarifas_hotel_calculadora` y `_tarifa_clave`; mig. 179 `reemplazar_...`) | Requiere migración | La clave de reemplazo y la validación de «claves repetidas» deben incluir el grupo; si no, generar un grupo borra el otro. |
| Historial (`tarifa_hotel_historial`, `hotel_temporadas_historial`) | Probable | Los triggers guardan la fila previa; **[verificar]** que la columna nueva viaja sin cambio. |
| Visibilidad por vigencia de compra (`vigencia.ts`) | Sí | Es un predicado «¿alguna noche vendible?», no un precio. |
| **Modelo por unidad** | **No en v1** | Una tarifa y una temporada por estadía; estadías multi-temporada bloqueadas. Grupos de día exigirían un motor por noche para unidad. UI sin «Dividir por días» y rechazo en servidor si `modelo_tarifario = 'unidad'`. |
| Programas, servicios, cotización manual | Fuera | Motores propios. |

**Corrección de alcance.** La propuesta de §D.3 de «reescribir los liquidadores» queda **descartada**: el cambio mínimo es el resolver por noche + helper de mapas + regla de edad + RPC. Los cuatro `liquidar*`, `evaluarHotelPorFechas` y la publicación conservan firma y flujo.

## E.4 «Desde», módulo por módulo

| Módulo | Cómo se calcula hoy | ¿Corresponde a una estadía vendible? | Con grupos |
|---|---|---|---|
| Bloqueo / empaquetado / salida dinámica (`filasHoteles`, fecha fija) | Estadía exacta noche por noche; la tarjeta muestra el mínimo de las filas publicadas (`resumen.ts` `desde_adulto`, `minRoomPvpResumen`; dinámico = doble, `dinamicoBooking.ts`) | Sí | Sin cambio de definición. |
| **Porción terrestre publicada** (`masBarato = true`) | Noche más barata de la ventana × noches (`liquidarHotelMasBarato*`). `neto_hotel` queda NULL (fila no verificable). | **No siempre.** Ya hoy puede ser inalcanzable; con precios por día de semana se agrava | Función aparte para hoteles con grupos (F.5). Sin grupos se conserva el comportamiento actual. |
| Búsqueda por fechas (Booking, `cotizarPorFechas`) | `evaluarHotelPorFechas` con la estadía pedida | Sí | Sin cambio. |
| Visibilidad (`vigencia.ts` `rango`) | Predicado, no precio | n/a | Sin cambio. |
| Programas, servicios, modelo unidad | Motores propios (`desde_precio`, `referenciaPublicacion`, `datosBernalo`) | No evaluados | Fuera de alcance. |

---

# F. Recomendaciones y ejemplos para decidir

Base de los ejemplos: Estándar, PAM, por persona y noche: lunes–jueves 100.000, viernes–domingo 150.000. Importes verificados con el prototipo.

## F.1 ¿Qué noche se bonifica? («N noches, 1 gratis»)
Hoy: se descuenta `(N−1)/N` del total, es decir el **promedio**.

| Estadía | Noches | Promedio (hoy) | Más barata gratis | Entrada gratis | Más cara gratis |
|---|---|---|---|---|---|
| Jue 07 → Dom 10 | 100.000 / 150.000 / 150.000 | 266.667 | 300.000 | 300.000 | 250.000 |
| Dom 10 → Mié 13 | 150.000 / 100.000 / 100.000 | 233.333 | 250.000 | 200.000 | 200.000 |

> **DECIDIDO (D8, §P):** las promociones **nuevas** eligen explícitamente la noche bonificada (más barata, más cara o última) sin opción preseleccionada; las **existentes** conservan el promedio. La recomendación original de abajo queda superada; se conserva como registro.

**Recomendación (original):** conservar el promedio en hoteles sin grupos. Para hoteles con grupos, adoptar «la noche de menor tarifa es cortesía» **solo si el proveedor así lo pacta**; si no hay pacto escrito, mantener el promedio (menos sorpresas, paridad con hoy). Es una decisión de política comercial; no se implementa nada sin ella.

## F.2 Acumulación con EBB / Long Stay
Estadía jue→dom, promo −10 % semana / −5 % fin de semana (375.000), EBB 12 % (reserva 90 días antes; Long Stay 7 % no gana por la regla del mayor), base sin promo 400.000.

| Alternativa | Qué hace | Importe | Cambio de código |
|---|---|---|---|
| **A. Pipeline vigente** | La promo ya está en la fila y EBB/LS se aplican después sobre el total (**así funciona hoy**) | 375.000 × 0,88 = **330.000** | Ninguno. |
| B. Excluyente, gana el menor importe | Compara promo (375.000) con EBB/LS sobre la base (400.000 × 0,88 = 352.000) | **352.000** | Grande: exige tener a la vez neto base y neto promo; la composición publicada guarda un solo neto por combo. |
| C. Excluyente, prevalece la promo | Si ganó una promo (ya viaja `esPromocion` en la procedencia) no se aplica EBB/LS | **375.000** | Pequeño. |
| D. Sumar porcentajes | −10 %/−5 % más −12 % por noche | 327.000 | Descartada: mezcla familias de descuento sobre la misma base. |

> **SUPERADA por §Q (D9).** La recomendación original («mantener A para todo») ya no rige como regla única: el proveedor elige por promoción si se acumula (A) o cuál prevalece (la promoción = C, EBB / Long Stay = B). Se conserva el texto como registro.

**Recomendación (original):** no cambiar la regla vigente (A) en esta entrega, para no alterar importes de hoteles existentes. Si el dueño no quiere dos descuentos, C es el único cambio proporcionado; B solo con justificación comercial clara. Sin grupos, ninguna alternativa cambia el comportamiento actual.

## F.3 Unidad del descuento absoluto (20.000)
> **Recomendación superada por §S.2:** el dueño decidió que la unidad se elige explícitamente; no se preselecciona «por persona y noche». Los importes del ejemplo siguen siendo los aprobados.
2 adultos, 1 doble, 3 noches jue→dom (base de habitación 800.000):

| Unidad | Cálculo | Resultado |
|---|---|---|
| Por persona y noche | 20.000 × 2 × 3 | **680.000** |
| Por habitación y noche | 20.000 × 3 | 740.000 |
| Por persona y estadía | 20.000 × 2 | 760.000 |

**Recomendación:** por **persona y noche**, en la moneda del hotel, sobre la tarifa de la noche del grupo y antes del markup (coincide con la etiqueta vigente «$ por pax»), con piso de 0 por noche, sin tocar infantes en $0 y materializado en la fila como el porcentaje. Para hoteles por unidad (fuera de v1) habría que definir «por unidad y noche».

## F.4 Cobertura incompleta

| Situación | Alternativa | Recomendación |
|---|---|---|
| Un día de la semana sin grupo | **DECIDIDO (D13, §N):** el día queda fuera de la cobertura de esa vigencia; se resuelve otra vigencia aplicable (fechas, compra, prioridad); si ninguna aplica, no se vende. **No** hay opción «usar vigencia inferior» ni «días cerrados»: la distinción cobertura del día / disponibilidad de la acomodación resuelve ambos casos. | Aviso informativo en el editor, no bloqueo. |
| Grupo cubierto pero sin fila para el combo (base ganadora) | Hoy sin grupos: cae a la vigencia inferior (400.000 en vez de bloquear). Con grupos: noche no vendible | **DECIDIDO (§M): noche no vendible con grupos**, sin rescate por otro grupo ni por una vigencia inferior. El mensaje del editor es **informativo** («Fin de semana no vende doble en Estándar/PAM»), no un aviso de «falta»: quitar el precio es el mecanismo para no vender una ocupación. Sin grupos se conserva lo actual. |
| Promoción sin regla/fila en un grupo | Conserva la base | Decidido. |
| Empate de prioridad entre bases | Validar al guardar; en datos existentes, noche no vendible | Aplicar a hoteles con grupos; auditar los demás. |
| Promo con fila de una base que no gana la noche | Guard por `temporada_base` | Solo para filas con `temporada_base`; antes, preflight para ver el impacto. |

## F.5 Cálculo del «Desde» (solo porción terrestre publicada)
> **Decidido por el dueño en §U (D11):** opción 4 (estadía completa más económica realmente vendible, con su fecha de entrada), solo para hoteles que adopten grupos. Los demás conservan «noche más barata × noches».
Ventana 4–10 ene, 5 noches. Hoy: noche más barata × 5 = **500.000** (inalcanzable: toda estadía real de 5 noches incluye al menos una noche de 150.000). Mejor estadía real: entrada el 4 ene = 4 × 100.000 + 150.000 = **550.000** (entrar el 5 sale 600.000).

| Alternativa | Resultado | Comentario |
|---|---|---|
| 1. Conservar noche mínima × N | 500.000 | Anuncia un precio que no se puede comprar. |
| 2. Mínimo de estadías reales con entrada y salida dentro de la ventana | 550.000 | Recorre fechas de entrada; costo acotado y medible. |
| 3. Opción 2 respetando `min_noches`, compra vigente, blackouts y régimen (solo estadías vendibles) | 550.000 | Es la anterior completa. |
| 4. Opción 3 mostrando además la fecha de entrada | «desde 550.000 entrando 04/01» | La más transparente. |

**Recomendación:** 3 (y 4 si la tarjeta admite la fecha), **solo para hoteles con grupos**. Cambiar el «desde» de los hoteles sin grupos podría subir importes ya publicados (por ejemplo con temporadas distintas dentro de la ventana): se trata como decisión aparte, no se arrastra a esos hoteles.

## F.6 Entregas ajustadas

| # | Entrega | Gate |
|---|---|---|
| E2 | **HECHA:** diagnóstico `supabase/scripts/preflight_vigencias_grupos_43_60_lectura.sql` (pendiente que el dueño lo ejecute) y diseño final §G. **Sin número asignado**: #75 trabaja desde 288/289 y puede necesitar más; el número se toma con `ls supabase/migrations`, orden por nombre, al escribirla y coordinando con #75 y #97. | Resultado del preflight y decisiones F.1–F.5. |
| E3 | **HECHA (parte de motor y evaluador):** 27 pruebas de caracterización, ver §I.5. Falta la caracterización SQL (generación 203, historial) para E4. | Verdes sin cambio de comportamiento. |
| E4 | Migración aditiva (grupos, `grupo_id`, índice parcial, RPC con grupo en la clave). Orden: preflight, migración, postcheck, código. | Ejecuta el dueño. |
| E5 | Motor: resolver por noche con grupos + helper de mapas + regla de edad tolerante + guard por `temporada_base` (solo filas nuevas). | Paridad E3 intacta sin grupos. |
| E6 | UI (calendario de rangos #43, grupos, matriz) y calculadoras/CSV por grupo. | Revisión visual. |
| E7 | Promoción por grupo (#60) y vista previa noche por noche. | F.1–F.3 resueltas. |
| E8 | «Desde» de porción con grupos y paridad entre recorridos. | F.5 resuelta. |

**Riesgo de datos conocido:** los casos E.2-2, E.2-4 y E.2-5 pueden estar ya presentes en datos reales; hasta el preflight no se sabe. No se modifica ninguna fila existente en este frente.

---

# G. Diseño final (E2, 2026-11-10) — PROPUESTA; §I (revisión posterior) manda sobre §G.0, §G.2, §G.6, H6, H7 y H9

**Este apartado manda sobre §A–§F donde haya contradicción** (en particular sobre §D.1, que se reemplaza). Sin implementación, migraciones ni ejecución sobre datos reales.

## G.0 Diagnóstico de solo lectura
Archivo: `supabase/scripts/preflight_vigencias_grupos_43_60_lectura.sql`. Es **un solo `SELECT`** (con CTE), sin escribir ni crear nada; devuelve 10 filas con control, observado, esperado, estado y un ejemplo. Debe ejecutarlo el dueño en el editor SQL de Supabase; no se ejecutó contra ninguna base real.

| # | Mide | Estado esperado |
|---|---|---|
| 1 | Tarifas duplicadas por clave exacta (hotel, categoría, régimen, temporada): lo que ve el motor | OK = 0 |
| 2 | Duplicadas solo tras recortar espacios: lo que ve la generación de la migración 203 | OK = 0 |
| 3 | Noches con empate de prioridad entre vigencias con tarifa cargada | OK = 0 |
| 4 | Noches en que una promoción con precio final gana con una base distinta de su `temporada_base` | OK = 0 |
| 5 | Noches en que la base prioritaria no tiene tarifa para una combinación ofertada y se vende con otra vigencia | OK = 0 |
| 6 | Noches sin precio alguno en una combinación ofertada | OK = 0 |
| 7 | Nombres de vigencia con más de una fila en `hotel_temporadas` | INFO: decide si los hoteles afectados pueden usar grupos en v1 |
| 8 | Hoteles por unidad con noches cubiertas por varias vigencias | INFO |
| 9 | Combinaciones configuradas sin ninguna tarifa | INFO |
| 10 | Promociones con tarifa escrita a mano (sin `temporada_base`) | INFO: no tendrían protección contra el rescate |

Réplica de las reglas del motor: rangos (o fecha inicio/fin si no hay), blackouts, vigencia de compra contra hoy en Bogotá, restricción de régimen, prioridad más alta, `promo_noche_gratis` excluida; horizonte hoy → +365 días; "combinación ofertada" = categoría × régimen del hotel con al menos una tarifa cargada.
**Validación hecha:** se corrió en un Postgres 17 local desechable (contenedor ya eliminado) con 8 hoteles sintéticos. Resultado: 1 duplicado exacto y 1 recortado, 5 noches de empate, 3 de promoción que rescata una base, 3 de base sin tarifa que cae a otra, 2 sin precio, 1 nombre repetido, 4 noches de unidad con cruce, 1 combinación sin tarifa y 1 promoción manual; el hotel limpio (con blackout, rangos múltiples y una vigencia de compra vencida) no aparece. **Límites:** valida la lógica de la consulta, no datos reales; no distingue acomodaciones (cuenta una fila con cualquier neto de habitación) y los rangos con fechas mal formadas se descartan en vez de fallar.

## G.1 Cómo se captura, genera, edita y conserva hoy (verificado) y qué cambia con grupos

| Pieza | Hoy | Con grupos |
|---|---|---|
| **Vigencias** (`TemporadasBox`, `crearTemporada`/`actualizarTemporada`) | Un formulario: nombre, un rango principal más rangos extra con entradas de fecha (no hay calendario), blackouts, prioridad, compra, tipo, régimen, condición de pago. Guarda y llama `regenerarTarifariosDeHotel` (republica el tarifario en el acto, best-effort). Renombrar cascada a `tarifa_hotel` y a los parámetros de la calculadora en pasos separados, **no atómicos** (el propio código lo advierte). Eliminar borra solo la vigencia: las tarifas quedan huérfanas sin aviso. | Sección «Días de aplicación» dentro del mismo formulario. Se guarda en **una función de base de datos transaccional** (vigencia + grupos), no en llamadas sueltas. Renombrar pasa a ser atómico para este caso. Eliminar una vigencia con grupos exige confirmar y borra sus tarifas y grupos en la misma transacción. |
| **Tarifas** (`TarifasBox`, `crearTarifa`/`actualizarTarifa`/`eliminarTarifa`) | Una fila por vez, sin comprobar duplicados; tabla agrupada por vigencia × régimen. | Un segmento por grupo; la edad y las notas se capturan **una vez por combinación** y se copian a todos los grupos; duplicado dentro de un grupo se rechaza. |
| **CSV** (`cargarTarifasMasivo`) | Inserta fila a fila, sin validar contra vigencias ni duplicados. | Columna opcional `grupo`; solo se acepta si la vigencia tiene grupos y el nombre existe y es único; sin la columna, la vigencia con grupos se rechaza (no se asigna a «todos los días» en silencio). |
| **Calculadoras** | Los parámetros se guardan en `hotel_calculadora.params` (jsonb) con llaves de texto `categoría\|temporada`; la vista previa corre en el navegador con funciones puras y la generación manda una **foto** de las tarifas vistas (`fotoTarifas`) que el servidor compara con una huella antes de escribir. | Las bases se capturan por categoría × (temporada, grupo); `params` guarda el **id** del grupo (el renombre del grupo no toca parámetros). `TarifaGenerada`, `TarifaExistente` y `FotoTarifa` ganan `grupo_id`, así la huella distingue grupos. Dubai: promos con descuento por grupo. Mixta: con grupos, la promoción exige base y grupo base **explícitos**. |
| **Historial** (`fn_tarifa_hotel_historial`, `hotel_temporadas_historial`) | Los triggers copian `to_jsonb(old)`: la columna nueva `grupo_id` se conserva sola. La foto de la vigencia se toma por **nombre** y no incluiría los grupos; la pantalla identifica cada versión por categoría\|régimen\|temporada. | Los grupos tienen su propio historial (misma técnica que `hotel_temporadas_historial`) y la fila histórica de tarifa guarda además una foto del grupo (nombre y días en ese momento). La pantalla muestra el grupo. Sin esto, cambiar los días de un grupo reescribiría en silencio cómo se lee una versión antigua. |
| **Modelo por unidad** | `TemporadasBox` y `CalculadoraEditor` se muestran siempre; `ModeloTarifarioEditor` cambia el modelo sin comprobar nada. | Ver G.5. |

## G.2 Modelo de datos final (reemplaza §D.1)

**Identidad de la vigencia.** En el código y en los datos una vigencia es su **nombre** (`tarifa_hotel.temporada`, parámetros de calculadora, historial, vínculo promoción-base). Por eso los grupos cuelgan de (hotel, nombre de vigencia) y no del `id` de una fila. Condición de v1: una vigencia con grupos tiene **una sola fila** en `hotel_temporadas` con ese nombre (los rangos múltiples ya viven dentro de `rangos`). El control 7 dice cuántos hoteles quedarían fuera hasta consolidar.

- `hotel_vigencia_grupos`: `id uuid`, `hotel_id` (FK a `hoteles`, cascade), `vigencia_nombre`, `nombre`, `dias smallint[]` (1 = lunes … 7 = domingo; no vacío, sin repetidos), `orden`, `grupo_base_id uuid null` (solo en promociones: grupo de la base del que deriva), único por (hotel, vigencia, nombre). Los días de los grupos de una misma vigencia no se solapan (validación por trigger, no por exclusión: no hay soporte de índice para `smallint[]`).
- `tarifa_hotel.grupo_id uuid null`, FK **`on delete restrict`** a los grupos. `null` = «todos los días» (todo el dato actual). Trigger diferido: el grupo pertenece al mismo hotel y su `vigencia_nombre` coincide con `temporada`; **no se permite mezclar** filas con y sin grupo para la misma combinación (categoría, régimen, vigencia).
- Índice único **parcial** sobre (hotel, categoría, régimen, temporada, `grupo_id`) donde `grupo_id` no es nulo; el legado queda sin tocar (los duplicados legados se miden con el control 1/2).
- `hotel_vigencia_grupos_historial` y una columna `grupo jsonb` en `tarifa_hotel_historial` (foto del grupo en el momento).
- **Promociones por grupo:** la promoción tiene **sus propios grupos**; cada uno deriva de **un** grupo de la base (`grupo_base_id`) y sus días son un **subconjunto** de los días de ese grupo. Esto cubre #60 por completo, incluida la restricción a días sueltos (ej. −10 % solo lunes a miércoles dentro de un grupo «Semana» de lunes a jueves; el jueves vende la base). El precio sigue siendo la fila materializada con `precio_final_autoritativo` y `temporada_base`.

**Alternativas ya descartadas y por qué** (además de §D.1): colgar los grupos de `hotel_temporadas.id` (un nombre puede ser varias filas y todas las tarifas apuntan por nombre); guardar los grupos como jsonb dentro de la vigencia (se pierde la integridad referencial con `tarifa_hotel` y no se puede bloquear un borrado); grupos de la promoción que apunten directamente a los de la base (rompe la coherencia «el grupo es de su vigencia» y complica el renombre).

## G.3 Motor: precedencia final con grupos
Orden por noche (se conserva todo lo existente):
1. Entradas que cubren la noche (rangos − blackouts), con compra vigente y régimen aplicable, por prioridad descendente. **Nuevo con grupos:** si la vigencia tiene grupos, cubre la noche solo si el día de la semana pertenece a alguno; la clave de tarifa es (vigencia, grupo).
2. Gana la primera con fila materializada. **Nuevos, identificados y acotados (G.8):** guard de la promoción (su `temporada_base` y su grupo base deben ser los de la base ganadora de esa noche) y noche no vendible cuando una base con grupo no tiene fila para la combinación.
3. Sin grupos, nada de lo anterior cambia.

La implementación sigue siendo mínima: el resolver por noche, un helper único que arma el mapa de netos desde las filas (hoy se arma a mano en 5 sitios) y, en los cargadores (cotización por fechas, reserva, generación y publicación, visibilidad y contexto de la calculadora), **una lectura más** de los grupos. Los liquidadores conservan firma.

## G.4 Regla de edad (sin relajar la falla cerrada)
`resolverReglaEdadEstadiaSegura` hoy falla si hay más de una fila por (categoría, régimen, temporada). Cambio exacto:

| Situación | Resultado |
|---|---|
| 0 filas | Error (igual que hoy). |
| 1 fila | Igual que hoy. |
| Varias filas, **todas con `grupo_id` distinto y no nulo**, y la **regla de edad efectiva** (override de la fila ?? general del hotel ?? defecto) **idéntica** | Se acepta; la regla es esa. |
| Varias filas con alguna sin grupo (mezcla legado + grupo) | **Error** («transición incompleta»). |
| Varias filas con el mismo `grupo_id` (duplicado) | **Error** (temporada duplicada, como hoy). |
| Varias filas con reglas efectivas distintas | **Error** con los grupos en conflicto; no se elige ninguna. |
| Override incompleto (alguna de las 4 columnas nula) en cualquier fila | **Error** (igual que hoy). |

Se evalúa sobre **todas** las filas de la combinación y no solo sobre los grupos de las noches de la estadía: es más estricto (un grupo sin uso con regla distinta también bloquea) pero no requiere pasar los grupos por los liquidadores. Para que no ocurra en la práctica, la edad se captura **una vez por combinación** y se copia a todos sus grupos (validación al guardar). `condicionesTarifa` (notas) ya deduplica por vigencia + texto; las notas también se capturan por combinación. Pruebas: ver G.7.

## G.5 Modelo por unidad: expresamente fuera de v1
No se muestra ningún control de grupos para hoteles `unidad` y no se promete soporte. Cierres:
1. **Interfaz:** `TemporadasBox`, `TarifasBox`, `CalculadoraEditor` y la carga CSV reciben el modelo del hotel y no renderizan «Dividir por días» ni columna `grupo` para `unidad`.
2. **Servidor:** la función transaccional de grupos y la inserción de tarifas con `grupo_id` rechazan si `hoteles.modelo_tarifario = 'unidad'`.
3. **Cambio de modelo:** `actualizarModeloTarifarioHotel` hoy no comprueba nada; deberá rechazar pasar a `unidad` mientras el hotel tenga grupos (con el mensaje que indica cuáles) y no activa nada al volver a `persona`.
4. **Motor:** la ruta por unidad (`resolverTemporadaEstadia`, `resolverTarifaAlojamiento`, `orquestarCotizacionAlojamientoBernalo`) no se toca y no lee grupos.
5. **Documentación:** el diseño y la interfaz dicen «solo hoteles por persona». El control 8 del diagnóstico mide cuántos hoteles unidad ya tienen vigencias cruzadas, solo para informar.

## G.6 Generación: clave con grupo y regeneración parcial
Cambios en `generar_tarifas_hotel_calculadora` (migración 203) mediante una migración nueva (no se edita la 203):
- `_tarifa_clave` incluye el grupo (`categoría ␟ régimen ␟ temporada ␟ grupo_id`, vacío para el legado). `_tarifa_huella` y el chequeo de «claves repetidas» heredan el cambio; la foto `p_previas` debe traer `grupo_id` (una foto de un navegador antiguo sin él no coincide con la huella y la función **rechaza pidiendo recargar**; nunca asume).
- Borrado «agregar/actualizar»: compara también el grupo con `is not distinct from`; solo toca las claves del lote → **regenerar un grupo conserva los demás**.
- «Reemplazar todo»: sigue siendo todo el hotel salvo vigencias protegidas; el texto de confirmación nombra los grupos.
- Validaciones nuevas del lote: el `grupo_id` existe, pertenece al hotel y a la vigencia de la fila; no se mezcla legado con grupo; vigencias de hoteles `unidad` se rechazan.
- Promociones escritas a mano: la protección actual (Mixta + descuento % + sin precio final) pasa a evaluarse **por grupo**.
- La RPC `reemplazar_tarifas_hotel_calculadora` (migración 179) no la llama ningún código de la aplicación; queda como está.

## G.7 Pruebas que el diseño exige (se escriben antes o con cada entrega)
**Renombre**
- Renombrar una vigencia con grupos actualiza, en una sola transacción, la vigencia, `tarifa_hotel.temporada`, `hotel_vigencia_grupos.vigencia_nombre` y los parámetros de la calculadora; un fallo a mitad no deja nada cambiado (a diferencia de hoy).
- Renombrar un grupo no toca tarifas ni parámetros (viajan por id).
- Renombrar una vigencia cuyo nombre aparece en más de una fila queda bloqueado si tiene grupos.
- Renombrar con una promoción cuya `temporada_base` apunta a ella actualiza también esa columna.

**Borrado**
- Borrar un grupo con tarifas, reglas de promoción o referencias en `hotel_calculadora.params` se bloquea y lista dónde se usa; con confirmación explícita borra las tarifas (queda historial con motivo) y poda los parámetros.
- Borrar una vigencia con grupos exige confirmar y deja cero huérfanos (grupos, tarifas, historial de grupo).
- La FK `restrict` impide borrar por SQL directo un grupo con tarifas.
- Cambiar los días de un grupo revalida solapes y que las promociones derivadas sigan siendo subconjunto; si no, se bloquea.

**Regeneración parcial**
- Generar el grupo A de (categoría, régimen, vigencia) deja intactas, con el mismo `id` y valores, las filas del grupo B.
- «Agregar/actualizar» solo toca claves del lote; «reemplazar todo» borra todos los grupos (y el historial lo registra).
- Lote con la misma clave y grupo repetida, o mezcla legado + grupo, se rechaza antes de escribir.
- Foto sin `grupo_id` (cliente antiguo) se rechaza pidiendo recargar.
- Dos personas generando grupos distintos a la vez: la que llega segunda ve la huella cambiada y se rechaza.
- Promoción manual protegida en un grupo no se sobrescribe; en otro grupo sí se regenera.

**Regla de edad** (extender `reglaEdadTarifaSegura.test.ts`): los 7 casos de G.4.
**Motor y paridad** (E3 y E5): los 5 casos de §E.2, el ejemplo obligatorio de 375.000, mezcla de grupos y cambio de vigencia durante la estadía, y la misma entrada por todos los recorridos (vista previa de calculadora, generación, «Desde», cotización por fechas, carrito, reserva).
**Historial:** la versión antigua de una tarifa muestra el grupo tal como era aunque luego cambie de nombre o de días.
**Unidad:** `hotelModeloTarifario.test.ts` ampliado: un hotel unidad no recibe controles de grupos, el servidor los rechaza y no se puede cambiar a `unidad` con grupos.
**Pruebas SQL en Postgres local** con el patrón existente (`supabase/scripts/test_*.sh`) para trigger de solape, FK, índice parcial, clave de generación e historial.

## G.8 Hoteles sin grupos y cambios de precedencia nuevos (identificados)
**Garantía.** Un hotel sin grupos (ninguna vigencia suya tiene grupos) sigue exactamente la ruta actual: mismas claves, mismos resultados. Se demuestra con las pruebas de caracterización de E3 sobre datos y fixtures existentes, antes de cualquier cambio. Cotizaciones, contratos y tarifarios publicados son fotos y no se recalculan; una publicación se regenera igual que hoy cuando alguien edita el hotel.

**Cambios nuevos y su alcance** (ninguno se aplica a datos históricos sin una decisión explícita):

| # | Cambio | Alcance en v1 | Para extenderlo a lo existente |
|---|---|---|---|
| N1 | **DECIDIDO (§X):** primero la base de la noche; solo una promoción vinculada a esa base (y grupo base) puede aplicar | Promociones de vigencias **con grupos** | Preflight control 4 en 0, o decisión caso por caso. Mostraría hoy el caso 2 de §E.2 (360.000 → 690.000). |
| N2 | Grupo cubierto sin fila para la combinación = noche no vendible (no cae a otra vigencia) | Vigencias con grupos | Controles 5 y 6; hoy el legado cae en silencio a la vigencia inferior. |
| N3 | Día de la semana sin grupo = la vigencia no cubre esa noche | Vigencias con grupos | No aplica al legado. |
| N4 | **DECIDIDO (§W):** empate de prioridad que puede competir ⇒ se exige resolver antes de activar; en el cotizador la opción no se muestra y se registra el motivo | Vigencias con grupos | Control 3; hoy decide el orden de lectura. |
| N5 | «Desde» de porción = mínima estadía real vendible | Hoteles con grupos | **DECIDIDO (D11, §U).** Para los demás hoteles sigue «noche más barata × noches». |
| N6 | Regla de edad con varias filas por grupo | Solo filas con `grupo_id` | No aplica. |
| N7 | Duplicados: índice único parcial | Solo filas con `grupo_id` | Control 1/2; el legado no se corrige sin decisión. |

Los hoteles con grupos se identifican en pantalla con una marca «Tarifas por días» y no hay ninguna bandera oculta: la ruta se decide por la existencia de grupos de la vigencia.

---

# H. Decisiones comerciales pendientes, con ejemplos — H1–H10 son PROPUESTAS, NO aprobadas por el dueño

Base de los ejemplos (por persona y noche, Estándar, PAM): lunes–jueves 100.000, viernes–domingo 150.000. Detalle y recomendación de las cinco primeras en §F.

| # | Decisión | Ejemplo | Mi recomendación |
|---|---|---|---|
| H1 | Noche bonificada en «N noches, 1 gratis» | Jue → dom: promedio 266.667 · más barata gratis 300.000 · más cara gratis 250.000 | **DECIDIDA (§P):** promociones nuevas eligen más barata, más cara o última, sin valor por defecto; las existentes siguen en promedio. |
| H2 | Promoción por grupo con EBB / Long Stay | Promo 375.000 + EBB 12 %: acumula 330.000 (hoy) · gana el menor 352.000 · prevalece la promo 375.000 | **DECIDIDA (§Q):** configurable por promoción; las existentes conservan A (acumulan). |
| H3 | Unidad del descuento absoluto de 20.000 (2 adultos, 3 noches) | Por persona y noche 680.000 · por habitación y noche 740.000 · por persona y estadía 760.000 | **DECIDIDA (§S.2):** el proveedor elige la unidad, sin valor por defecto. |
| H4 | Cobertura incompleta | Día sin grupo: **cobertura** (D13: otra vigencia o no se vende) frente a grupo que cubre sin precio para la acomodación: **disponibilidad** (no se vende, sin rescate) | **DECIDIDA (§M y §N).** |
| H5 | «Desde» de porción | 5 noches del 4 al 10 ene: hoy 500.000 (no comprable); real 550.000 | **DECIDIDA (§U):** estadía completa más económica realmente vendible, con noches, precio por persona y fecha de entrada. |
| H6 | **Transición al dividir una vigencia que ya tiene tarifas** | ALTA tiene doble 120.000 «todos los días»; se divide en Semana y Fin de semana. (a) Copiar 120.000 a ambos grupos. (b) Dejar los grupos vacíos: todas las noches de ALTA quedan sin precio hasta cargar los dos valores. | **REABIERTA por §M.** La recomendación anterior («copiar, marcado pendiente») queda **retirada**: copiar es decidir qué se vende sin que nadie lo haya confirmado, y una acomodación sin precio significa «no se vende». Solo cabría una **propuesta que el usuario confirma fila por fila** (y que pone en venta solo lo confirmado); queda como parte de D12. |
| H7 | Qué hace «Reemplazar todas» con grupos | El hotel tiene Semana 100.000 y Fin de semana 150.000; se pulsa «Reemplazar todas» con un lote que solo trae Semana. (a) Borra ambos grupos y deja Fin de semana vacío. (b) Solo borra los grupos que vienen en el lote. | (a) es lo que significa hoy «todo el hotel»; pedir confirmación que nombre los grupos y mostrar qué se perderá. |
| H8 | Eliminar un grupo que tiene tarifas | Fin de semana tiene 12 tarifas y 1 promoción derivada. (a) Bloquear siempre. (b) Permitir con confirmación que enumera lo que se borra. | (b), con el historial guardando todo. |
| H9 | Vigencias cuyo nombre ocupa más de una fila | Control 7 lista, por ejemplo, «ALTA» con dos filas de régimen distinto. (a) No pueden usar grupos hasta consolidar. (b) Soportarlo con grupos por fila. | (a) en v1; (b) solo si el control 7 muestra que es frecuente. |
| H10 | Promoción restringida a días sueltos dentro de un grupo base | Semana (lunes–jueves) con promo −10 % solo lunes a miércoles: el jueves se vende a 100.000. | Permitirlo (subconjunto del grupo base): es lo que pide #60. **DECIDIDA (§Y):** por noche, noche gratis y persona/estadía, con «Todos los días» o «Elegir días». |

## Cómo seguir
Primero el dueño ejecuta el diagnóstico y comparte las 10 filas. Con ese resultado se decide qué cambios de G.8 pueden extenderse a hoteles existentes y se cierran H1–H10. Después E3 (pruebas de caracterización), E4 (migración con preflight, postcheck y rollback; número a asignar al escribirla, sin asumir: #75 trabaja desde 288/289 y puede necesitar más).

---

# I. Revisión previa a entregar el diagnóstico (2026-11-10) — manda sobre §G.0, §G.2, §G.6, H6, H7 y H9

**Estado de las decisiones:** el diseño completo sigue siendo una **propuesta**. **H1–H10 no están aprobadas por el dueño**; las «recomendaciones» de §F, §G y §H son mías y no deciden nada. Sin implementación de grupos ni promociones.

## I.1 Diagnóstico de solo lectura, versión 2

Archivo: `supabase/scripts/preflight_vigencias_grupos_43_60_lectura.sql` (un solo `SELECT`; no escribe ni crea objetos). Cambios pedidos:

**Por acomodación, no «algún neto».** Se evalúa cada una por separado:
- Habitación (sencilla, doble, triple, múltiple): tiene precio si el neto es **mayor que 0** (0 es «no aplica» para el motor).
- Niño 1 y niño 2: tiene precio si el neto **no es nulo** (0 es gratis y válido); no se evalúan en hoteles Adults Only.
- Infante: no se evalúa (hoy un infante sin tarifa viaja gratis por decisión vigente).
- **Ofertada** = el hotel la tiene habilitada en `hotel_acomodaciones` (fila con `pax_max` y `pax_tarifa` > 0) **o** tiene precio para ella en alguna fila del hotel; aplica a toda combinación (categoría × régimen) con al menos un precio.
- Dos controles distintos: **7/8** (la acomodación sí se vende en otra vigencia de la combinación pero la base prioritaria de esa noche no la trae; el ejemplo dice si «tiene fila pero sin precio en esa acomodación» o «no tiene fila», y hay filas de detalle `7.xxxx`/`8.xxxx` por hotel, combinación, acomodación y vigencia con número de noches y rango) y **9** (ofertada y **sin precio en ninguna vigencia**; detalle `9.xxxx`).
- **El caso pedido:** hotel con sencilla con precio y doble habilitada sin precio → aparece en el control 9 como «doble sin precio en ninguna vigencia». Y sencilla con precio + doble con precio solo en una vigencia → aparece en el 7 como falta de la doble en la otra vigencia; la sencilla no aparece.
- **Lectura corregida por la decisión del dueño (§M):** los controles 5–9 y 15 **no miden carga pendiente ni defectos**. Una acomodación sin precio significa «no se vende»; esos conteos son inventario descriptivo, no autorizan correcciones, copias ni habilitaciones, y no deben convertirse en avisos de «tarifa faltante».
- Limitación declarada: no existen restricciones por categoría (#44); una categoría que no vende una acomodación saldrá como falta. Es información para decidir, no un error por sí sola. Control 15 lista las acomodaciones deshabilitadas por configuración.

**Fechas inválidas, sin abortar ni ocultar.** Cada rango y blackout se valida **sin lanzar errores** (formato AAAA-MM-DD, mes 1–12, día existente en ese mes —por ejemplo `2027-02-30` queda inválido—, inicio ≤ fin, elemento con forma de objeto, columna con forma de lista). Resultado:
- Control 3: total de elementos inválidos en **todas** las vigencias, con una fila de detalle por elemento (hotel, id de la vigencia, clase, contenido y si la compra sigue vigente).
- Control 4: hoteles con elementos inválidos en vigencias **con compra vigente**. Esos hoteles quedan marcados y la columna `hoteles_incompletos` y el estado de los controles 5–9 y 11 lo reflejan: `INCOMPLETO` (observado 0 pero con datos inválidos) o `REVISAR (INCOMPLETO)` (observado > 0 y además faltan casos por ver). Nunca `OK` si hay datos inválidos relevantes.
- **Corrección verificada:** el motor NO trata igual todas las fechas inválidas. JavaScript desborda un día inexistente al mes siguiente (`2027-02-30` se lee como 2 de marzo, y el motor cubre o excluye con esa fecha); un mes 13 o un día 32 produce fecha inválida y no cubre ni excluye. El diagnóstico **no imita el desborde**: trata toda fecha inválida como no cubre/no excluye, por eso esos hoteles quedan `INCOMPLETO` hasta corregir el dato (el desborde queda fijado en una prueba de caracterización). Si todos los rangos de una vigencia son objetos con texto, el rango principal de la fila **no** se usa como alternativa (igual que el motor).

**Horizonte visible.** Fila 0: «horizonte 365 días, del <hoy> al <hoy+365>» (hoy en Bogotá). Los controles por noche llevan «horizonte 365 d» en su nombre y el control 12 cuenta las vigencias con noches posteriores, que **no se analizan**.

**Una sola consulta** con 16 controles más filas de detalle. La columna de orden sale como texto (`7`, `7.0001`…) para que el detalle quede bajo su control.

**Cómo se validó (reproducible):** `supabase/scripts/test_preflight_vigencias_grupos_43_60.sh` crea un Postgres 17 local desechable, carga `fixture_preflight_vigencias_grupos_43_60.sql` (12 hoteles sintéticos), ejecuta la consulta en una sesión de solo lectura y comprueba valores y estados exactos; además verifica que **no modifica datos** (misma huella antes y después). Tres pasadas: fixture completo, solo hoteles limpios + el de fechas inválidas (los controles 5–9 salen `INCOMPLETO`, no `OK`) y sin el de fechas inválidas (todo `OK`). Resultado de la última corrida: **todas las comprobaciones OK** (≈ 12 s; el contenedor se elimina solo). Para repetirla: `sh supabase/scripts/test_preflight_vigencias_grupos_43_60.sh` desde `dspacios-travel/`, con Docker y la imagen `postgres:17`.
**Límites:** valida la lógica de la consulta, no los datos reales; las «combinaciones ofertadas» siguen siendo una definición operativa (arriba); no mide las filas `neto_infante`.

## I.2 Identidad de vigencias y grupos (reemplaza §G.2)

Se mantiene `grupo_id` **estable** (uuid que no cambia nunca) y los grupos se enlazan al **id de la vigencia**, no a su nombre.

- `hotel_vigencia_grupos`: `id uuid` (estable), `vigencia_id bigint` FK a `hotel_temporadas(id)` **`on delete restrict`** (el hotel se deduce de la vigencia: no se duplica), `nombre`, `dias smallint[]` (1 = lunes … 7 = domingo; no vacío, sin repetidos), `orden`, `grupo_base_id uuid null` FK al grupo de la base (solo promociones, `restrict`), único por (`vigencia_id`, `nombre`). Los días de los grupos de una vigencia no se solapan (trigger).
- `tarifa_hotel.grupo_id uuid null` FK a los grupos, **`on delete restrict`**; `null` = «todos los días» (todo el dato actual). **Trigger de consistencia (diferido):** la vigencia del grupo es del mismo hotel y su nombre, recortado, coincide con `tarifa_hotel.temporada`. No se permite mezclar filas con y sin grupo para una misma (categoría, régimen, vigencia).
- Índice único **parcial** (hotel, categoría, régimen, temporada, `grupo_id`) para las filas con `grupo_id`.
- Historial de grupos por **id de grupo** (estable) y foto del grupo en cada versión de tarifa.

**Qué se gana y qué sigue siendo por nombre.** La relación grupo → vigencia ya no puede desviarse ni depende de que dos textos coincidan, y renombrar una vigencia no toca las tablas de grupos. Siguen por nombre, por herencia del código legado y **sin extender esa dependencia a datos nuevos**: `tarifa_hotel.temporada` (que el trigger valida contra el nombre real de la vigencia), los parámetros de la calculadora, `temporada_base` de las promociones y el historial de tarifas. Por eso renombrar una vigencia **con grupos** debe ser una **función transaccional única** (nombre de la vigencia + `tarifa_hotel.temporada` + `temporada_base` + parámetros de la calculadora) con el trigger de consistencia validando al confirmar; hoy el renombre son pasos separados sin transacción.

**Restricción que habilita los grupos (nombres repetidos).** Las tarifas apuntan a la vigencia por nombre; si dos filas de `hotel_temporadas` del mismo hotel comparten nombre, una tarifa con `grupo_id` sería ambigua (¿de cuál fila?). Restricción propuesta:
> Una vigencia puede tener grupos solo si **ninguna otra fila del mismo hotel** tiene su mismo nombre (comparado sin espacios sobrantes). Se valida al crear el primer grupo y con un trigger que rechaza después insertar o renombrar otra fila con ese nombre. No se crea un índice único sobre todos los nombres: el dato legado con repetidos queda como está.

**Casos afectados:** son los del control 10 del diagnóstico. Cada caso aparece con su detalle (`10.xxxx`: hotel, nombre, id de cada fila, tipo, prioridad, régimen restringido, ventana de compra y fechas de viaje), pero **no se sabe cuántos hay hasta que el dueño ejecute el diagnóstico**. Para cada uno decide el dueño; **el sistema no consolida nada**:

| Opción | Cuándo cabe | Qué implica |
|---|---|---|
| Consolidar a mano en una sola fila con varios rangos | Las filas coinciden en tipo, prioridad, compra y régimen restringido | Edición manual; las tarifas ya cargadas por nombre siguen valiendo. |
| Diferenciar los nombres (p. ej. «ALTA PC» y «ALTA PAM») | Las filas son en realidad vigencias distintas con el mismo nombre | Renombrar obliga a decidir a mano qué tarifas corresponden a cada fila: el sistema no puede inferirlo. |
| Dejar la vigencia sin grupos | No necesita precios por día | Sin cambios; esa vigencia sigue como hoy. |

Efecto colateral que el diseño debe cubrir: **«Copiar temporadas desde otro hotel»** (`copiarTemporadasDesdeHotel`) crea filas nuevas con ids nuevos. Si la vigencia de origen tiene grupos, debe copiar también sus grupos (con uuid nuevos y las promociones remapeadas a ellos); copiar solo la vigencia dejaría un hotel que cobra «todos los días» sin avisar.

## I.3 Transición y reemplazo con confirmación explícita (reemplaza §G.6 en lo que se refiere a reemplazos, y H6/H7)

**Principio:** el sistema **no copia ni borra tarifas por sí solo**, y **no existe un precio vendible «pendiente de ajustar»**. Toda copia o borrado exige elegir una opción y confirmarla viendo exactamente qué ocurre.

**Dividir una vigencia que ya tiene tarifas «todos los días»** (no se puede dejar legado y grupos a la vez, ver I.2). El diálogo muestra la tabla exacta de filas existentes (categoría, régimen, valores por acomodación) y obliga a elegir:
1. *(RETIRADA por §M y §U.9: copiar y vender sin confirmar cada precio contradice «sin tarifa, no se vende».)* **Copiar estos precios a cada grupo y venderlos desde ya.** Casilla de confirmación que dice: «todas las noches de esta vigencia seguirán vendiéndose a estos precios en cada grupo y el tarifario se republicará». Se crean filas por grupo con sus valores visibles en el diálogo.
2. **Eliminar las tarifas de «todos los días» y cargar por grupo.** Lista las filas que se borrarán y avisa que esas noches **dejan de venderse** hasta cargar cada grupo; el historial conserva lo borrado.
3. **Cancelar:** los grupos no se guardan.
No hay opción preseleccionada. Quitar los grupos (volver a «todos los días») funciona igual: lista las filas de cada grupo y se elige entre usar los precios de un grupo concreto como «todos los días» (copia explícita) o eliminar todo.

**Reemplazo de tarifas generadas: tres modos distintos, cada uno con su botón y su texto.**

| Modo | Qué elimina | Qué conserva | Confirmación |
|---|---|---|---|
| **Agregar/actualizar** (el actual) | Solo las filas cuya clave (categoría, régimen, vigencia, grupo) está en el lote | Todo lo demás, incluidos los otros grupos | El diálogo lista las claves que se sobrescriben. |
| **Reemplazar ESTE grupo** (nuevo) | Todas las filas con ese `grupo_id` (cualquier categoría/régimen) | Los demás grupos, las demás vigencias y el resto del hotel | Lista las filas a eliminar (categoría, régimen, valores) y cuántas filas se conservan de cada otro grupo y vigencia. El lote solo puede traer ese grupo. |
| **Reemplazar TODO el hotel** (el actual «reemplazar todas») | Todas las tarifas del hotel excepto las de vigencias protegidas (compra cerrada) | Las vigencias con compra cerrada y las promociones escritas a mano que protege la regla vigente (que bloquean la operación) | Lista por vigencia y grupo cuántas filas se eliminan y cuáles se conservan, exige escribir una frase de confirmación distinta («REEMPLAZAR TODO EL HOTEL») y el nombre del hotel. |

En los tres modos el servidor **recalcula** lo que se eliminará y lo compara (huella) con la foto que mostró el diálogo; si cambió, rechaza y pide recargar. El historial registra cada fila borrada con el motivo del modo.

## I.4 Decisiones H1–H10: propuestas, ninguna aprobada
Se mantiene la tabla de §H como material para decidir. Quedan corregidas así:
- **H6 (transición):** ya no se recomienda ningún valor por defecto. Las tres opciones de I.3 se muestran siempre; la decisión del dueño es cuál de ellas se ofrece en la versión 1 (por ejemplo, solo 1 y 3 si no se quiere permitir borrados masivos).
- **H7 (reemplazo):** el diseño ofrece los tres modos de I.3; la decisión es si «Reemplazar este grupo» entra en la versión 1.
- **H9 (nombres repetidos):** se aplica la restricción de I.2; la decisión del dueño es el destino de cada caso listado por el diagnóstico.
- H1–H5, H8 y H10 siguen como están, también como propuestas.

## I.5 E3 — pruebas de caracterización (sin cambiar comportamiento productivo)
Se agregaron 27 pruebas que fijan el comportamiento **actual** y que, por lo tanto, deben seguir pasando para los hoteles sin grupos en cualquier entrega futura:

| Archivo | Qué fija |
|---|---|
| `pruebas/vigenciasPrecedencia43.caracterizacion.test.ts` (motor `paquetes.ts`) | **Fecha con día inexistente: `2027-02-30` se desborda al 2 de marzo (cubre hasta el 2, no el 3); un mes 13 no cubre nada.** Gana otra base por prioridad (700.000); **riesgo conocido** de la promoción que rescata una base que perdió (360.000, con guard serían 690.000); promoción sin fila cae a la base; base prioritaria sin fila cae a la inferior (400.000); empate de prioridad decidido por el orden; «N noches, 1 gratis» = promedio (266.667 y 233.333); «desde» de ventana = 500.000 mientras la mejor estadía real es 550.000; no existe día de la semana; la noche de salida no se cobra. |
| `pruebas/hotelPorFechas43.caracterizacion.test.ts` (`evaluarHotelPorFechas`) | Solo se publican acomodaciones con precio de habitación > 0 (sencilla con precio y doble sin precio ⇒ la doble no aparece); neto 0 = no aplica; niño sin tarifa no se publica e infante sin tarifa viaja con hotel en 0; duplicados: gana la última fila; por acomodación, la base prioritaria sin precio cae a la inferior (doble 700.000 y sencilla 600.000); noche gratis dentro del evaluador; **EBB acumulado sobre una promoción** (264.000 con promo frente a 330.000 sin ella); empate decidido por el orden. |

Resultado: las 27 pasan y las 120 pruebas existentes relacionadas (`liquidarHotelNochesConTemporadas`, `precioFinalAutoritativo`, `vigenciaNuncaDerivaPrecio`, `reglaEdadTarifaSegura`, `liquidacionHotel`) también. `git status` confirma que **no se tocó ningún archivo de código productivo**. Ya existían pruebas de la regla «la vigencia no deriva precios», de procedencia y de fila duplicada en la regla de edad; las nuevas cubren solo lo que faltaba. Se ejecutan con el mismo comando de siempre (`test:unit` toma `pruebas/**/*.test.ts`).
**Pendiente de E3:** la caracterización a nivel de base de datos (la función de generación de la migración 203, el historial y la clave de reemplazo) necesita la plantilla de esquema completa en Docker; queda para E4 con el patrón de `supabase/scripts/test_*.sh`. Tampoco se corrió `tsc`/`build` (el worktree no tiene `node_modules`).

---

# J. Optimización del diagnóstico por «upstream timeout» (2026-11-10)

El dueño ejecutó la versión 2 de `preflight_vigencias_grupos_43_60_lectura.sql` y Supabase respondió «SQL query ran into an upstream timeout». Se optimizó **solo ese diagnóstico**, sin tocar datos, índices ni configuración, y se conservó **una sola consulta de solo lectura** con todos los controles, el horizonte completo de 365 días, todos los hoteles y los avisos `INCOMPLETO`.

## J.1 Reproducción y medición (Postgres 17 local desechable, datos sintéticos)
Máquina de desarrollo con Docker, configuración por defecto de Postgres (`work_mem` 4 MB, `shared_buffers` 128 MB). Los datos son sintéticos y reproducibles (`fixture_volumen_preflight_vigencias_grupos_43_60.sql`): por hotel 20 vigencias (70 % base, 22 % promoción, 5 % «N noches gratis»), 5 categorías y 3 regímenes, con rangos múltiples, blackouts, regímenes restringidos y compras cerradas.

**Versión 2 (la que dio timeout)**

| Hoteles | Vigencias | Tarifas | Duración | JIT |
|---|---|---|---|---|
| 8 | 160 | 2.056 | **292 s** | desactivado |
| 8 | 160 | 2.056 | **268 s** | activado |
| 8 | 160 | 2.056 | 273,5 s (en la prueba de equivalencia) | desactivado |
| 15 | 300 | ≈ 3.800 | **cancelada a los 300 s** (límite que se le puso) | desactivado |
| 50 | 1.000 | 12.770 | **cancelada a los 600 s** | activado |

Con 8 hoteles —muy por debajo del tamaño de cualquier cartera real— ya tarda cerca de cinco minutos, y el tiempo crece más rápido que el volumen (50 hoteles no terminó en 10 minutos). Con JIT activado o desactivado el tiempo es similar: **el costo de la versión 2 no es JIT, es algorítmico**.

## J.2 Dónde estaba el costo (con evidencia, y con sus límites)
- El plan de la versión 2 (`EXPLAIN`, sin `ANALYZE`) muestra `CTE Scan` sobre `ent` y `px_a` dentro de subconsultas correlacionadas (`SubPlan`) y bucles anidados: esas CTE se materializan sin índices, así que cada fila candidata las recorre completas.
- **No se obtuvo `EXPLAIN ANALYZE` completo de la versión 2: no termina.** La cuantificación sale de una versión intermedia que conservaba la misma estructura en dos puntos (50 hoteles, 29,5 s en total): en `sin_precio`, un bucle anidado descartó **118.478.808** y **131.611.464** comparaciones (cruce con `con_precio_en_combo` y con la CTE de filas existentes) y, en `rescates`, **6.417.016**. El planificador estimaba 1 fila en esos nodos (la estimación real era 17.721 y 2.729), por lo que eligió bucles anidados que releían CTE enteras.
- **No se atribuye una causa única exacta a la versión 2:** la evidencia muestra el patrón (subconsultas correlacionadas + bucles anidados sobre CTE sin índices, con estimaciones de 1 fila) y que desaparecer ese patrón elimina el costo; no se midió cuánto aportaba cada subconsulta por separado en la versión original.
- La expansión diaria de vigencias (`dias`) **no** era el cuello de botella: 204.026 filas en 157 ms con 300 hoteles.

## J.3 Qué se cambió (y qué no)
1. **Firmas de días.** Los días de un hotel y régimen con exactamente las mismas vigencias activas se agrupan (26.804 firmas para 204.026 combinaciones día-vigencia con 300 hoteles); el análisis se hace una vez por firma y se multiplica por su número de días. La suma de días de las firmas es el horizonte completo.
2. **Sin subconsultas correlacionadas.** La prioridad máxima de cada firma y la existencia de precio se obtienen con funciones de ventana y agregaciones sobre uniones etiquetadas (su costo no depende de que el planificador estime bien), y el cruce con `con_precio_en_combo` se hace con `INTERSECT`.
3. **Máscara de acomodaciones.** Cada candidato lleva las seis acomodaciones a la vez (máscara de bits) y solo al final se abre en una fila por acomodación faltante: 164 mil filas candidatas en lugar de 949 mil con 300 hoteles.
4. **Ejemplos deterministas.** Los desempates del texto «ejemplo» ahora son estables (la versión 2 elegía entre empates sin criterio).

**No cambia:** ningún control, regla, umbral ni estado; los 16 controles y sus filas de detalle (con el tope de 200 filas por bloque de detalle que ya tenía la versión 2, mientras que los conteos de los controles son totales); el horizonte de 365 días; la lista de hoteles; la validación de fechas inválidas y los avisos `INCOMPLETO`.

## J.4 Equivalencia verificada
- **Fixture pequeño** (12 hoteles con todos los casos de §I.1): la salida de la versión final y la de la versión 2 es **idéntica en todas las columnas** (28 filas).
- **Datos de volumen, 8 hoteles** (la versión 2 todavía termina): **idénticas** las columnas orden, control, observado, esperado, estado y hoteles incompletos de los controles principales, y **las 416 filas incluyendo el texto de todas las filas de detalle**. Lo único que se excluye en esa comparación es el texto «ejemplo» de los controles principales, porque la versión 2 resolvía los empates al azar.
- La consulta final se ejecuta en una sesión con `default_transaction_read_only=on`, sin errores, y deja las tablas con la misma huella md5 antes y después.
- Todo es reproducible: `supabase/scripts/test_volumen_preflight_vigencias_grupos_43_60.sh` (equivalencia + volumen) y `supabase/scripts/test_preflight_vigencias_grupos_43_60.sh` (fixture pequeño y estados `INCOMPLETO`). La versión 2 se conserva solo como referencia en `supabase/scripts/referencia/…_v2_LENTA_solo_referencia.sql` (**no ejecutar en producción**).

## J.5 Duración de la versión final
Mismas condiciones locales; tiempos de pared de la ejecución completa (incluye generar las filas de salida).

| Hoteles | Vigencias | Tarifas | JIT activado | JIT desactivado |
|---|---|---|---|---|
| 8 | 160 | 2.056 | — | 0,5 s |
| 50 | 1.000 | 12.770 | 3,2 s | 2,6 s |
| 150 | 3.000 | 38.288 | 7,7 s | 2,0 s |
| 300 | 6.000 | 76.356 | 9,0 s | 3,7 s |
| 600 | 12.000 | 152.164 | 15,6 s | 8,8 s |
| 1.000 | 20.000 | 254.303 | 18,7 s | 13,6 s |
| 100 (hoteles anchos: 60 vigencias, 8 categorías, 5 regímenes) | 6.000 | 203.664 | 17,4 s | 11,4 s |

Comparación: con 8 hoteles, 273 s → 0,5 s; con 50 hoteles, más de 600 s (cancelada) → 2,6–3,2 s.

## J.6 Límites que hay que tener presentes
- **Los datos son sintéticos.** No se conoce el volumen real; las tablas anteriores permiten ubicarlo. El tiempo crece de forma aproximadamente lineal con el volumen en el rango medido, pero depende de la forma de los datos (vigencias que se solapan, categorías y regímenes por hotel), como muestra la fila de hoteles anchos.
- **JIT.** En el Postgres local la compilación JIT sumó entre ~2,4 s (arranque fijo, incluso con una consulta que no lee nada) y varios segundos en los tamaños mayores. Se ignora si el servidor remoto la tiene activada; la consulta **no cambia ninguna configuración** y por eso no la desactiva.
- **Máquina y configuración.** Un portátil con Docker y `work_mem` de 4 MB (las ordenaciones grandes se derraman a disco); un servidor remoto puede ser más lento o más rápido, y se desconoce el límite de tiempo del editor SQL. No se hizo ninguna prueba contra la base real.
- **Dependencia residual del planificador.** Los cruces más grandes (entradas por firma × precios; candidatos × entradas) siguen siendo uniones por igualdad que el planificador resuelve con hash o merge; en los volúmenes medidos eligió siempre esos planes, pero no se puede demostrar que no pudiera elegir un bucle anidado con otras estadísticas. Las comprobaciones difíciles (existencia de precio, prioridad máxima, existencia de fila) ya no dependen de esa elección.
- **Memoria.** Con los volúmenes más grandes las ordenaciones usan decenas de MB en disco temporal (130 MB en una prueba intermedia, bastante menos en la versión final); si el servidor limita el espacio temporal podría fallar por esa causa y no por tiempo.
- **Igualdad por nombre, no por id.** Como en el motor actual, las vigencias se emparejan con sus tarifas por nombre de temporada (no por id): es una propiedad del dato legado que el diagnóstico replica.
- **Cobertura del horizonte.** Sigue siendo hoy → hoy + 365 días; el control 12 cuenta las vigencias con noches posteriores, que no se analizan.

## J.7 Qué falta
Que el dueño ejecute el archivo `supabase/scripts/preflight_vigencias_grupos_43_60_lectura.sql` (una sola consulta) en el editor SQL de Supabase. **No se pide hasta que decidas hacerlo**: antes de ello están los resultados anteriores. Si volviera a agotar el tiempo, el dato útil sería cuántos hoteles, vigencias y tarifas tiene su base (`select count(*)` de `hoteles`, `hotel_temporadas` y `tarifa_hotel`), para situarlo en la tabla de J.5.

---

# K. Resultado del diagnóstico remoto y conclusiones (2026-11-10)

El dueño ejecutó `preflight_vigencias_grupos_43_60_lectura.sql` (versión 3) en Supabase: **terminó sin timeout** y devolvió las filas de abajo. Esta sección interpreta el resultado, **no corrige nada** y no autoriza cambiar el comportamiento de ningún hotel existente. Los cambios de precedencia nuevos (§G.8, N1–N7) siguen acotados a vigencias con grupos de días.

## K.0 Lectura general

| Control | Observado | Estado | Qué significa |
|---|---|---|---|
| 0 Horizonte | 365 días (10-nov-2026 → 10-nov-2027) | INFO | — |
| 1 Tarifas duplicadas exactas | **1** (hotel 78) | REVISAR | K.3 |
| 2 Duplicadas tras recortar espacios | 0 | OK | — |
| 3 Fechas/estructura inválidas | **2** (hotel 9 y hotel 53) | REVISAR | K.2 |
| 4 Hoteles con datos inválidos en vigencias con compra vigente | 2 (hoteles 9 y 53) | INCOMPLETO | Los controles 5–9 y 11 pueden no ver casos de esos dos hoteles |
| 5 Noches con empate de prioridad | **161** (ejemplo: hotel 7, PA, 10-nov-2026) | REVISAR (INCOMPLETO) | K.5 — **sin detalle por hotel**: solo se ve el primer ejemplo |
| 6 Promoción que gana con una base distinta de su `temporada_base` | **0** | INCOMPLETO | Ningún caso en los hoteles bien medidos; los hoteles 9 y 53 podrían ocultar alguno |
| 7 Base sin precio para la acomodación y se vende con otra vigencia | 1.651 noches×acomodación; **29** filas de detalle (completas) | REVISAR (INCOMPLETO) | K.6 |
| 8 Sin precio alguno | 22.883 noches×acomodación; detalle **limitado a 200 filas** (llega hasta el hotel 166) | REVISAR (INCOMPLETO) | K.6 |
| 9 Acomodación ofertada sin precio en ninguna vigencia | 394 combinaciones; detalle **limitado a 200 filas** (llega hasta el hotel 105) | REVISAR (INCOMPLETO) | K.6 |
| 10 Nombres de vigencia con más de una fila | **1** (hotel 172, «ABRIL 2027») | INFO | K.4 |
| 11 Hoteles por unidad con noches cubiertas por varias vigencias | 1 hotel×día (hotel 188, 18-dic-2026) | INFO | Informativo; fuera de v1 |
| 12 Vigencias con noches posteriores al horizonte | 198 (ejemplo: hotel 224, «BAJA» hasta 31-dic-2028) | INFO | No analizadas más allá de 365 días |
| 13 Combinaciones configuradas sin ningún precio | 185 (ejemplo: hotel 39, Estándar (Vista al mar) / PAM) | INFO | Configuradas pero nunca cargadas |
| 14 Promociones escritas a mano, sin `temporada_base` | 12 (ejemplo: hotel 64, «PROMO SUNSALE1 6 %…» / FULL) | INFO | Sin protección contra el rescate de base |
| 15 Acomodaciones de habitación deshabilitadas | 23 (ejemplo: hotel 7, múltiple) | INFO | — |

Tamaño aproximado de la base que se deduce del resultado: hay hoteles con id hasta al menos 224 y vigencias con id hasta al menos 1.077 (no son conteos exactos). Es un volumen dentro del rango medido en §J.

**Cómo leer los conteos:** son el universo que había que mirar, **no una lista de defectos**. Los conteos de los controles 7–9 mezclan casos legítimos (una categoría que no admite 4 personas, una promoción que no incluye sencilla) con vacíos reales de carga (una vigencia creada sin tarifas). K.6 los separa con los ejemplos visibles; para el resto hace falta la consulta complementaria de K.8 o un detalle mayor.

## K.1 Límites del resultado
- Los bloques de detalle de los controles 8 y 9 se cortan en **200 filas** (por hotel ascendente): no se ven los hoteles posteriores al 166 (control 8) ni al 105 (control 9). El control 7 está completo (29 filas).
- El control 5 (161 noches de empate) **no trae detalle**: solo se conoce el hotel 7. No sabemos cuántos hoteles ni qué pares de vigencias hay detrás.
- Los hoteles 9 y 53 están marcados `INCOMPLETO`: el diagnóstico trata sus fechas inválidas como si no cubrieran nada, y el motor no siempre lo hace así (K.2).
- Ningún dato del resultado dice cuáles son los valores de las tarifas ni las condiciones de pago; por eso K.3–K.5 plantean hipótesis y piden mirar filas concretas con la consulta de K.8.

## K.2 Fechas inválidas: hoteles 9 y 53

| Hotel | Vigencia | Dato guardado | Qué hace el motor (verificado) | Lectura |
|---|---|---|---|---|
| **9** | id 46 «MEDIA» | `fecha_inicio` 2026-06-26, `fecha_fin` **`62026-06-29`** | `new Date("62026-06-29T00:00:00")` es **fecha inválida**: ese rango **no cubre ninguna noche**. | Parece un 6 de más (2026-06-29). Aunque se corrigiera, el rango ya pasó (hoy es 10-nov-2026), así que **hoy no afecta ninguna noche**; el diagnóstico lo marca porque la compra de esa vigencia sigue abierta. |
| **53** | id 140 «ALTA» | `fecha_inicio` **`0206-12-24`**, `fecha_fin` 2027-01-03 | `new Date("0206-12-24T00:00:00")` es **fecha válida (año 206)**: el rango **cubre todas las noches desde el año 206 hasta el 3-ene-2027**, es decir, **hoy mismo**. | Parece 2026-12-24 con un cero y un dos intercambiados. **Efecto real hoy:** ALTA se aplica desde el 10-nov-2026 y no desde el 24-dic-2026. Si su prioridad es igual o mayor que la de las otras vigencias, las noches del 10-nov al 23-dic se podrían estar cotizando con tarifa ALTA. |

**El caso del hotel 53 es el único de esta lista con posible efecto comercial inmediato.** No se sabe la prioridad de ALTA frente a las demás vigencias del hotel: la consulta de K.8 (bloque C) la muestra.
**Por qué entraron:** el guardado de vigencias (`limpiarRangos`) solo comprueba que el inicio y el fin no estén vacíos y que el fin, comparado como texto, no sea menor que el inicio; **no valida el formato ni el año**. `62026-06-29` pasa porque, como texto, es mayor que `2026-06-26`; `0206-12-24` pasa porque es menor que el fin.
**Sin correcciones automáticas.** Corrección **propuesta** (a confirmar por el dueño o el proveedor): hotel 9 → `2026-06-29` (o reemplazar el rango si la vigencia ya no se usa); hotel 53 → `2026-12-24`. Después, volver a correr el diagnóstico: con esos dos hoteles sanos, los controles 5–9 y 11 dejan de estar `INCOMPLETO`.
**Diseño (pendiente de aprobación):** el selector de calendario de #43 y una validación de formato/año al guardar evitan que se repita; cambia el editor, no los datos existentes.

## K.3 Tarifa duplicada: hotel 78
- Duplicado exacto: **Junior Suites / PAM / MEDIA 2027**, 2 filas. No es un problema de espacios (el control 2 da 0).
- **Efecto hoy (según el código):** el evaluador por fechas se queda con la última fila leída (el orden de lectura no está definido), así que el precio puede depender del orden; y la regla de edad (`resolverReglaEdadEstadiaSegura`), que corre en la reserva, falla cerrada con «temporada duplicada» → **una reserva de Junior Suites PAM que use MEDIA 2027 sería rechazada**. Es lo que dice el código, no se probó con datos reales.
- **Hipótesis a verificar:** en la misma vigencia y categoría el control 7 y el 8 muestran que **Junior Suites / PA no tiene fila en MEDIA 2027** (12 noches caen a otra vigencia, del 7-may al 7-jun-2027; 21 noches sin precio, del 11 al 31-ene-2027). Es decir: PAM aparece dos veces y PA ninguna. **Es posible que una de las dos filas «PAM» sea en realidad la de PA mal etiquetada.** No se puede afirmar sin ver las dos filas (bloque A de K.8).
- **Sin corrección automática.** Decisión del dueño sobre cuál fila queda (o cuál pasa a PA). Mientras tanto, el hotel 78 no puede usar grupos de días en esa combinación.

## K.4 Dos vigencias «ABRIL 2027»: hotel 172
- Fila **id 598**: tarifa, prioridad 1, todos los regímenes, compra 2026-07-24 → 2027-04-30, viaje 2027-04-01 → 2027-04-30.
- Fila **id 1077**: tarifa, prioridad 1, todos los regímenes, compra **2026-10-01** → 2027-04-30, viaje 2027-04-01 → 2027-04-30.
- **Clasificación:** misma vigencia comercial duplicada con ventanas de compra distintas (una más reciente), **no** dos ofertas distintas: mismo nombre, mismo tipo, misma prioridad, mismo régimen y mismas fechas de viaje. Hoy ambas están con compra abierta.
- **Efecto sobre el precio:** ninguno por esto solo, porque las tarifas se buscan por **nombre** y ambas filas dan el mismo precio; la ventana efectiva es la unión (desde el 24-jul-2026). Puede haber diferencias que el diagnóstico no ve (bloqueos, mínimo de noches, condición de pago): se comparan con el bloque B de K.8.
- **Efecto sobre grupos:** esta es exactamente la restricción propuesta en §I.2 (un nombre repetido impide habilitar grupos). Es el **único** caso en la base medida. Opciones, ninguna automática: (a) consolidar en una sola fila (por ejemplo con compra desde 2026-07-24, si no hay diferencias), (b) conservar la más reciente, (c) no habilitar grupos en «ABRIL 2027».

## K.5 Empate del hotel 7: «BAJA (NO REEMBOLSABLE)» y «BAJA (TARIFA FLEXIBLE)»
- Lo que se ve: el 10-nov-2026, régimen PA, dos vigencias con el mismo peso (**«BAJA (NO REEMBOLSABLE)» = «BAJA (TARIFA FLEXIBLE)»**). El control cuenta 161 noches de empate en total; solo se conoce este ejemplo.
- **Cómo distinguir una alternativa comercial de un conflicto de prioridad**

| | Alternativa comercial legítima | Conflicto de prioridad (error) |
|---|---|---|
| Nombre | Distingue el plan: «No reembolsable», «Flexible» | Mismo producto con nombres parecidos o sin distinción |
| Fechas | Iguales o casi iguales a propósito | Se cruzan por casualidad |
| Condiciones | Distintas (pago total frente a anticipo/saldo; reembolsable o no) | Iguales |
| Precio | Distinto y con razón (el no reembolsable más barato) | Iguales o sin razón comercial |
| Intención | El cliente podría elegir cualquiera | Solo una debería venderse |

- **Conclusión para el hotel 7 con la información disponible:** por los nombres, es **muy probable una alternativa comercial** (dos planes de tarifa), no un conflicto. Falta confirmar las condiciones de pago y los precios de las dos vigencias (bloque D de K.8).
- **Cómo se comporta hoy:** el sistema solo puede vender **un** precio por noche. Con igual prioridad gana la primera vigencia que llegue en la lectura (orden no definido), así que el cliente ve una tarifa u otra sin criterio, y la otra es inalcanzable. Para que se venda siempre la flexible habría que darle más prioridad; entonces la no reembolsable nunca se vende. **El sistema no tiene hoy un concepto de «dos planes de tarifa simultáneos».**
- **Para los grupos (propuesta, sin tocar lo existente):** en una vigencia con grupos el empate seguiría sin permitirse (N4), por lo que el hotel 7 **no podría pasar a grupos mientras no exista una forma explícita de declarar alternativas** (decisión D1). El empate de los demás hoteles queda como está.
- Antes de decidir conviene conocer los otros hoteles con empate: el bloque E de K.8 los lista todos (aproximación por fechas principales).

## K.6 Faltantes: clasificación de los ejemplos visibles
> **Superada en su interpretación por §M (decisión del dueño).** La categoría **(A) «tarifa realmente ausente / falta cargar»**, las etiquetas «probable», «urgente», «riesgo de precio» y la idea de «completar» o «verificar con urgencia» **ya no aplican como conclusión**: una acomodación, régimen o categoría sin precio es, hasta que el dueño diga lo contrario, **una decisión de no vender**. Esta tabla se conserva solo como descripción de lo que el diagnóstico encontró; ninguna fila autoriza cargar, copiar o corregir precios. Lo único que sigue siendo un asunto distinto es el **riesgo de venta con precio de otra vigencia** (control 7: hoy el sistema vende con la tarifa inferior), que es comportamiento vigente de hoteles sin grupos y no se cambia aquí.
Categorías: **(O)** ocupación no admitida o no ofrecida · **(R)** régimen o categoría no vendido en esa vigencia · **(A)** tarifa realmente ausente (la vigencia existe, falta cargar) · **(P)** diseño de una promoción · **(H)** hueco de calendario · **(?)** no se puede clasificar con este dato.

| Ejemplo (hotel · combinación · vigencia) | Dato del diagnóstico | Clasificación | Razonamiento y siguiente paso |
|---|---|---|---|
| Hoteles 1, 2, 5, 6, 12, 13, 17, 27, 35, 44, 47, 51, 55, 67, 71, 73–75, 84–86, 88, 96, 98, 105… · **múltiple, triple y niño 2** «sin precio en ninguna vigencia» (control 9) | Nunca cargada en esa combinación | **(O)** probable | Son las acomodaciones de más ocupantes; una categoría pequeña suele no admitirlas. Hasta que existan reglas por categoría (#44) el sistema no puede expresarlo y el diagnóstico las cuenta como faltantes. **No son defectos por sí solos.** |
| Hotel 7 · múltiple | Deshabilitada en `hotel_acomodaciones` (control 15) | **(O)** confirmada | Es una decisión de configuración explícita. |
| Hotel 32 · Deluxe (balcón y vista al mar) PC · **doble y sencilla** sin precio en ninguna vigencia; hotel 37 Estándar PA · sencilla; hotel 47 Junior Suites · sencilla | Nunca cargada | **(?)** sospechoso | Falta una acomodación base. Puede ser (O) o un error de carga: confirmar con el proveedor. |
| Hotel 38 · PC · niño 2 «tiene fila pero sin precio»; hotel 78 · Estándar/Junior · niño 2 en ALTA y BAJA; hotel 79 · Superior PC · niño 2 en ALTA | Fila existe sin precio de niño 2 | **(O)** probable para 38 y 78; **(?)** para 79 | En el 79 el control 7 indica que otra vigencia sí tiene precio de niño 2: inconsistencia entre temporadas. Confirmar si ALTA debe tenerlo. |
| Hoteles 57 y 59 · «PROMO NOV 2026 (OFERTA ESPECIAL)» · **sencilla** (199 noches, 10-nov-2026 → 30-jun-2027) «tiene fila pero sin precio» | Control 7 (cae a la base) | **(P)** | La promoción no incluye sencilla y se vende al precio de la base: es el comportamiento previsto («lo que la promoción no cubre conserva la base»). **No es un defecto** si la oferta es solo para doble o más. |
| Hoteles 57 y 59 · sencilla · **22-mar-2027** (1 noche, control 8) | Sin precio alguno | **(H)** | Esa noche solo la cubre la promoción y la base no cubre ese día; la promoción no trae sencilla → no se puede vender sencilla ese día. Revisar el calendario de la base. |
| Hoteles 145, 146, 147 · Estándar PC · «ENERO - AGOSTO 2027» (208 noches, 5-ene → 31-jul-2027): doble, niño, sencilla, triple «no tiene fila» | Control 8 | **(A)** probable | Tres hoteles con la misma vigencia y el mismo vacío: parece una vigencia creada en bloque sin cargar las tarifas de esa categoría/régimen. |
| Hotel 166 · Estándar FULL · vigencias ENERO, FEBRERO, MARZO, ABRIL, MAYO y JUNIO 2027 «no tiene fila» (todas las acomodaciones) | Control 8 | **(A)** probable | Vigencias mensuales creadas sin tarifas para esa combinación. |
| Hotel 42 · Superior (PA, PAM, PC) · «ALTA 2027» (10 noches) y «BAJA 2027» (288 noches); hotel 67 · Superior (PA, PAM, PC) · «ALTA 2027» y «BAJA 2027» | Control 8 | **(A)** probable | La categoría tiene precio en otra vigencia pero no en las de 2027: 2027 sin cargar para esa categoría. |
| Hotel 74 · City View, Executive, Music/Tech/Woman Room · FULL · «BAJA 2026» (46 noches, **del 10-nov al 25-dic-2026**) | Control 8 | **(A)** y **urgente** | Son las noches **más cercanas**: esa temporada baja no tiene tarifa para esas categorías y nadie más las cubre → no se pueden vender hoy. |
| Hotel 38 · Estándar Vista Interna, Superior con Balcón, Superior Vista al Mar · **PAM** (todas las acomodaciones) · ALTA 2026-2027, BAJA, BAJA 2027, MEDIA 2027 «no tiene fila»; PC sí tiene fila | Control 8 | **(R)** o **(A)**: **no se puede decidir** | PAM tiene precio en alguna otra vigencia, pero en ninguna de las vigentes. Puede ser un régimen que ya no se vende o una carga pendiente; empieza el mismo día de hoy. Confirmar con el área comercial. |
| Hotel 54 · Ejecutiva, Ejecutiva View, Junior Suites Vista al Mar · PC · «ALTA» (23 noches, 13-nov-2026 → 11-ene-2027) «no tiene fila», **cae a otra vigencia** (control 7) | Control 7 | **(A)** y **riesgo de precio** | En fechas de temporada alta se estaría vendiendo con la tarifa de otra vigencia (más baja si es BAJA). Verificar con urgencia qué precio se cotiza. |
| Hotel 78 · Junior Suites PA · «MEDIA 2027» | Control 7 y 8 | ver K.3 | Posible régimen mal etiquetado en la fila duplicada. |
| 185 combinaciones del control 13 (p. ej. hotel 39 Estándar (Vista al mar) / PAM) | Configurada sin ningún precio | **(R)** probable | Configuración existente sin tarifas: no se vende. Informativo. |

**Lo que no se concluye:** que los 1.651 + 22.883 + 394 sean defectos; ni que las clasificaciones «probable» sean ciertas sin confirmar con el área comercial. **Cualquier endurecimiento (por ejemplo, que un grupo sin fila no se pueda vender) sigue siendo exclusivo de las vigencias con grupos.**

## K.7 Qué NO cambia con este resultado
- Ningún comportamiento de los hoteles existentes: ni se activa el «guard» de promoción (el control 6 ni siquiera encontró casos), ni se impiden noches sin precio, ni se rechazan empates, ni se tocan duplicados.
- Ninguna fila se corrige, se borra ni se regenera. Ninguna migración. Los cambios de precedencia nuevos (N1–N7) siguen limitados a las vigencias que tengan grupos.

## K.8 Consulta complementaria (para que la ejecute el dueño)
Archivo: `supabase/scripts/consulta_complementaria_hallazgos_43_60_lectura.sql`. Un solo `SELECT`, de solo lectura y liviana. Devuelve, como json: **A** las filas completas de la tarifa duplicada del hotel 78 · **B** las dos vigencias «ABRIL 2027» del hotel 172 · **C** las vigencias con fecha inválida (ids 46 y 140) y todas las vigencias del hotel 53 con su prioridad · **D** las vigencias BAJA del hotel 7 y su configuración de acomodaciones · **E** todos los pares de vigencias del mismo hotel con igual prioridad y fechas que se cruzan (los empates del control 5, por hotel) · **F** para los hoteles 38, 42, 54, 74, 145 y 166: qué vigencias tienen filas con precio por categoría y régimen · **G** configuración de acomodaciones de hoteles de ejemplo. Se probó solo su sintaxis y forma de salida en un Postgres local con datos sintéticos; no se ejecutó contra la base real.

## K.9 Decisiones de negocio pendientes (propuestas; ninguna aprobada)
Cada una con un ejemplo sencillo. «Recomendación» es mía y no decide nada. Se numeran D1–D12; las equivalencias con §H van entre paréntesis.

**D1 — Dos planes de tarifa en las mismas noches (hotel 7).**
Ejemplo: BAJA flexible a 200.000 y BAJA no reembolsable a 170.000, jueves a domingo.
(a) Hoy: el sistema vende solo una y cuál depende del orden de lectura. (b) Se declara una como principal y la otra como promoción de mayor prioridad: se vende siempre la no reembolsable y nunca la flexible. (c) Se crea el concepto «alternativas de la misma noche» (el cliente elige plan). (d) El hotel queda fuera de grupos.
Recomendación: (d) en la versión 1 y decidir (c) como proyecto aparte; no tocar la regla de empates de hoteles sin grupos.

**D2 — Qué hacer con las fechas que ya entraron mal (hoteles 9 y 53).**
Ejemplo: `0206-12-24` hoy cubre desde el año 206. (a) Corrección manual por el dueño, caso por caso. (b) Una pantalla de «datos a revisar» que las lista. (c) Corrección automática (no recomendada).
Recomendación: (a), y que #43 valide formato y año al guardar para que no se repita.

**D3 — Cuál fila queda cuando hay una tarifa duplicada (hotel 78).**
Ejemplo: dos filas Junior Suites / PAM / MEDIA 2027 con 100.000 y 110.000. (a) Se decide mirando las dos filas (puede ser que una sea PA). (b) Gana siempre la más reciente. (c) Gana la más cara.
Recomendación: (a). Ninguna regla automática.

**D4 — Una vigencia con el mismo nombre en dos filas (hotel 172).**
Ejemplo: «ABRIL 2027» con compra abierta desde el 24-jul y otra desde el 1-oct. (a) Consolidar en una sola fila. (b) Quedarse con la más reciente. (c) No usar grupos en esa vigencia.
Recomendación: (a) si las dos filas no difieren en bloqueos, mínimo de noches ni condición de pago; si difieren, hablar caso por caso.

**D5 — CERRADA (§M).** Sin tarifa = no se vende; no hay que declarar «no ofrecida» ni esperar a #44 para eso. #44 (restricciones por categoría) queda como mejora de claridad, no como requisito. La recomendación anterior (regla intermedia «vendida en otra vigencia ⇒ hueco») **queda retirada**.

**D6 — CERRADA (§M).** En una vigencia con grupos, si el grupo de la noche no tiene precio para la acomodación pedida, esa noche **no se vende para esa acomodación**, sin rescate por otro grupo ni por una vigencia inferior. Hoteles sin grupos: igual que hoy.

**D7 — CERRADA (§O): una promoción que no aplica deja vigente la base aplicable y nunca crea disponibilidad.** (Texto original:) Promoción que no incluye una acomodación (hoteles 57 y 59, sencilla).
Ejemplo: la oferta aplica a doble y triple; sencilla se vende al precio base. (a) Confirmar que es lo previsto (también para promociones por grupo). (b) Exigir marcar explícitamente qué acomodaciones incluye cada promoción.
Recomendación: (a); (b) como mejora opcional de la pantalla. *Nota (§M): D7 es la decisión sobre **promociones**; no se mezcla con la de acomodación no vendida (§M.3).*

**D8 — CERRADA (§P): elección explícita de la noche bonificada en promociones nuevas; promedio vigente en las existentes.** (Texto original:) Noche gratis cuando las noches cuestan distinto (H1).
Ejemplo: jueves 100.000, viernes 150.000, sábado 150.000. Promedio: 266.667 · la más barata gratis: 300.000 · la más cara gratis: 250.000.
Recomendación: promedio hasta que haya pacto con el proveedor.

**D9 — CERRADA (§Q) en lo comercial; queda D9-b (§Q.5) para el caso de coincidencia simultánea.** (Texto original:) Promoción por grupo frente a anticipada o larga estadía (H2).
Ejemplo: promo −10 % lunes–jueves y −5 % fin de semana, jueves a domingo = 375.000; con anticipada 12 %: acumulada 330.000 · gana la más baja 352.000 · la promoción prevalece 375.000.
Recomendación: no cambiar lo vigente (acumulada).

**D10 — CERRADA (§S.2): la unidad se elige explícitamente (persona/noche, habitación/noche, persona/estadía); descuento mayor que la tarifa ⇒ no aplica y sin selector de pasajeros, §T).** (Texto original:) Descuento en pesos (H3). Ejemplo: 20.000, 2 adultos, 3 noches: por persona y noche 680.000 · por habitación y noche 740.000 · por persona y estadía 760.000. Recomendación: por persona y noche.

**D11 — CERRADA (§U): mínima estadía completa realmente vendible, con noches, precio por persona y fecha de entrada; solo hoteles con grupos.** (Texto original:) «Desde» de la porción terrestre (H5). Ejemplo: ventana 4–10 ene, 5 noches: hoy 500.000 (no comprable) · real 550.000. Recomendación: la mínima estadía real vendible con su fecha de entrada, solo para hoteles con grupos.

**D12 — CERRADA (§V): tres operaciones separadas (activar grupos, actualizar o reemplazar tarifas, borrar grupos), cada una con confirmación que describe sus efectos.** (Texto original:) Cómo se pasa una vigencia a grupos, cómo se reemplaza y cómo se borra (H6–H8).
Ejemplo: ALTA tiene doble a 120.000 «todos los días»; se divide en Semana y Fin de semana. (a) ~~Copiar y vender de inmediato~~ (retirada por §M: copiar precios sin confirmarlos fila por fila contradice «sin tarifa no se vende»). (b) Eliminar y cargar por grupo (esas noches dejan de venderse hasta cargar). (c) Proponer los valores y que el usuario confirme cada uno (solo lo confirmado se vende). (d) Cancelar. Para reemplazar: «este grupo», «todo el hotel» o «agregar/actualizar»; para borrar un grupo con tarifas: bloquear o confirmar enumerando lo que se borra.
Recomendación: sin opción por defecto; mostrar siempre las filas exactas y exigir confirmación.

## K.10 Qué sigue
1. El dueño decide si ejecuta la consulta de K.8 (sin urgencia, salvo los hoteles 53, 54, 74 y 38, por las noches más cercanas).
2. Correcciones manuales de datos que el dueño decida (hoteles 9, 53, 78 y 172). Después, repetir el diagnóstico.
3. Cerrar D1–D12.
4. Solo entonces E4 (migración con su preflight, postcheck y rollback).

---

# L. Decisiones aprobadas por el dueño y validación de fechas (2026-11-10)

## L.1 Decisión 1 — Flexible y no reembolsable (D1 queda cerrada)
- **Aprobado:** «tarifa flexible» y «no reembolsable» son **alternativas comerciales para las mismas noches**, distintas de los grupos por días. **Quedan fuera de esta primera entrega.**
- Consecuencias de diseño: no se cambian prioridades ni se borra ninguna tarifa; **el hotel 7 no habilita grupos** hasta resolver esa combinación por separado; el empate de los demás hoteles queda como está (N4 sigue acotado a vigencias con grupos).
- Proyecto aparte pendiente (sin alcance ni fecha): un concepto de «plan de tarifa» que permita vender dos precios en la misma noche (condiciones de pago, reembolso, selección por el cliente, cotización y contrato). No se diseña aquí.

## L.2 Decisión 2 — Validación de fechas (implementada)
**Aprobado:** hotel 53, vigencia ALTA id 140, debía empezar el **2026-12-24**; `0206-12-24` es un error de captura. El hotel 9 (`62026-06-29`) **sigue pendiente de que el dueño confirme su fecha**.

**Reglas** (módulo único `lib/hoteles/validarFechasVigencia.ts`, usado por el formulario y por las acciones del servidor):
- Al **crear** una vigencia o al **cambiar** sus fechas se rechaza: formato distinto de AAAA-MM-DD de cuatro dígitos, día inexistente del calendario (`2027-02-30`; `2028-02-29` es válido), fin anterior al inicio y **año anterior al año vigente en Bogotá** (a las 23:59 del 31-dic todavía es el año que termina).
- **Viaje y blackouts:** reglas completas. **Compra:** fecha real y fin ≥ inicio; el **fin** no puede ser de un año anterior al vigente; el **inicio** sí puede ser de un año anterior (una compra abierta el año pasado es normal) pero no absurdo (< 2000). *Esta parte de «según corresponda» es mi interpretación y queda para confirmar con el dueño.*
- **No se corrige nada:** el mensaje nombra el valor y quien guarda decide.
- **Históricos:** consultar no cambia. Editar una vigencia **sin tocar sus fechas** se sigue permitiendo (un rango se considera sin cambios solo si inicio y fin son exactamente los guardados); cambiar solo el fin mientras el inicio sigue siendo `0206-12-24` **se rechaza** porque el rango cambió.
- **Dónde se aplica:** `crearTemporada`, `actualizarTemporada` (con las fechas guardadas como referencia), `cargarTemporadasMasivo` (también valida la compra: antes una compra mal escrita se descartaba en silencio, dejando la vigencia «siempre abierta»), `copiarTemporadasDesdeHotel` (copia solo las que cumplen e **informa las omitidas**; si ninguna cumple, falla sin escribir) y el formulario `TemporadasBox` (aviso inmediato y sin viaje al servidor; el servidor las vuelve a aplicar siempre).

**Archivos:** `lib/hoteles/validarFechasVigencia.ts` (nuevo, ~140 líneas) · `app/(dashboard)/dashboard/producto/hoteles/actions.ts` (+39 −… líneas) · `app/(dashboard)/dashboard/producto/hoteles/[id]/HotelDetalleClient.tsx` (+17) · `pruebas/hotelesActionsHotelIdAutoritativo.wiring.test.ts` (2 expresiones regulares ampliadas: la lectura previa de `actualizarTemporada` ahora trae también las fechas, y la prueba sigue protegiendo que empiece por `nombre, hotel_id`).

### Reproducción previa y demostración posterior (pruebas ejecutadas)
Se escribió **primero** un arnés que ejecuta las Server Actions reales con un cliente de Supabase simulado en memoria (`pruebas/vigenciasFechas43.servidor.test.ts`) y se corrió sobre el código **sin cambios**:

| | Antes del cambio | Después |
|---|---|---|
| `crearTemporada` con inicio `0206-12-24`, fin `2027-01-03` | **`{"ok":true}`**; se insertó `fecha_inicio 0206-12-24` y `rangos [{0206-12-24 → 2027-01-03}]`; se disparó **1 regeneración** del tarifario y **1 revalidación** | `ok:false` con el valor nombrado; **0 escrituras, 0 regeneraciones, 0 revalidaciones** |
| Arnés completo (23 pruebas) | 7 pasan, **16 fallan** (se aceptaban `0206`, `62026-06-29`, `2027-02-30`, años anteriores, y las cargas masivas) | **23 pasan** |

**Límite de cambio de año** (reloj simulado de Bogotá): a las 04:59:59 UTC del 1-ene-2027 (23:59:59 del 31-dic en Bogotá) un rango que empieza el 30-dic-2026 **se acepta**; a las 05:00:00 UTC (00:00 en Bogotá) **se rechaza**; y a las 23:30 del 31-dic (ya es 2027 en UTC) el año vigente sigue siendo 2026.
**Llamada directa al servidor:** todas las pruebas del arnés invocan la acción sin pasar por el formulario; también `actualizarTemporada` de la vigencia id 140 con su dato histórico: editar la prioridad con las fechas intactas **se permite** (conserva `0206-12-24`), cambiar solo el fin **se rechaza**, cambiar el inicio a otra fecha mala **se rechaza** y corregirlo a `2026-12-24` **se acepta** y escribe exactamente esa fecha en la columna y en `rangos`.

| Prueba | Archivo | Resultado |
|---|---|---|
| Validador puro (calendario, año vigente, viaje, blackouts, compra, exenciones, `fechasGuardadas`) | `pruebas/vigenciasFechas43.validador.test.ts` | 28 pasan |
| Acciones del servidor reales con cliente simulado (incluye reloj Bogotá, históricos, CSV, copia) | `pruebas/vigenciasFechas43.servidor.test.ts` | 23 pasan |
| Formulario real (`HotelDetalleClient`, acciones dobles): editar histórico, rechazo de `0206` sin llamar al servidor, corrección legítima, crear válido | `pruebas/vigenciasFechas43.react.ts` | 6 pasan |
| Regresión: wiring de `hotelesActionsHotelIdAutoritativo`, `hotelModeloTarifario`, `hotelProveedorEdicion`, `tarifasPromoMixtaPreservacion`, `publicacionLotesCableado`, `regenerarTarifariosDeHotel` y las 27 caracterizaciones de E3 | varios | 236 pasan, 0 fallan (tras ajustar las 2 expresiones citadas) |
| React existente `hotelPestanas22.react.ts` (mismo componente) | — | 11 pasan |
| `tsc --noEmit` del proyecto completo (con 7 GB de memoria; con la memoria por defecto se agota) | — | sin errores |
| ESLint sobre los 3 archivos tocados | — | sin avisos |

### Lo que NO está probado o NO queda cubierto (pendiente)
- **`npm run build` y Vercel/Preview:** no se ejecutaron (el worktree usa un enlace a `node_modules` y el build exige el ajuste de Turbopack documentado). Lo valida el dueño en Preview.
- **Escritura directa a la tabla.** Las acciones del servidor ya no dejan pasar esas fechas, pero un usuario interno autenticado con permiso de escritura sobre `hotel_temporadas` podría escribirlas llamando a la API de Supabase directamente. Cerrarlo del todo exige una restricción en la base de datos (que exima lo que no cambia y use el año de Bogotá): **requiere una migración y no se hizo.** Decisión pendiente del dueño.
- **Los blackouts del hotel** (`HotelBlackouts.tsx` / `blackouts-actions.ts`, una tabla aparte de las vigencias) tienen sus propias fechas y **no** se tocaron; si se quiere la misma regla ahí, es otra entrega.
- **Cota superior de año** (por ejemplo `9026`): no se pidió y no se aplica; un año futuro absurdo pasaría.
- El **mensaje de «omitidas»** al copiar vigencias está cubierto en el servidor, no por una prueba de interacción en pantalla.
- Los **datos remotos** (hotel 9, hotel 53 y cualquier otro) no se tocan ni se revisan aquí.

## L.3 Corrección puntual del hotel 53 (preparada, NO ejecutada)
Solo corrige lo aprobado: **vigencia id 140, hotel 53, inicio `0206-12-24` → `2026-12-24`**. No corrige el hotel 9 ni nada inferido.
Orden (lo ejecuta el dueño en el editor SQL; cada paso de lectura es **una sola consulta**):
1. `supabase/scripts/preflight_correccion_hotel53_alta140_fecha_inicio.sql` — compara el valor existente con lo esperado (existencia, hotel y nombre; columna `fecha_inicio` = `0206-12-24`; `fecha_fin` = `2027-01-03`; exactamente un elemento `{0206-12-24 → 2027-01-03}` en `rangos`; ningún otro elemento 0206; una sola fila «ALTA» en el hotel 53) y muestra la **fila completa como evidencia**. Veredicto: `LISTO PARA CORREGIR` o `NO APLICAR`.
2. `supabase/scripts/correccion_hotel53_alta140_fecha_inicio.sql` — con la fila bloqueada, **vuelve a comprobar lo mismo y aborta sin cambiar nada** si no coincide; si coincide cambia la columna `fecha_inicio` y solo ese elemento de `rangos` (conserva orden y claves). Una segunda ejecución aborta.
3. `supabase/scripts/postcheck_correccion_hotel53_alta140_fecha_inicio.sql` — verifica el resultado y que la versión anterior quedó en `hotel_temporadas_historial`. Veredicto: `CORRECCIÓN VERIFICADA` o `REVISAR`.
4. `supabase/scripts/rollback_correccion_hotel53_alta140_fecha_inicio.sql` — reversión exacta con la misma guardia (devolvería el valor erróneo `0206-12-24`; existe solo para volver al estado idéntico).
Probado en un Postgres local desechable con datos sintéticos (`test_correccion_hotel53_alta140.sh`, todo OK): veredictos, cambio de solo esas dos referencias, huella idéntica del resto de columnas y de las demás filas (incluida la del hotel 9), historial, aborto con filas que no coinciden (fin distinto, dos rangos, inicio distinto, otro hotel) y reversión exacta.
**Advertencias:** (a) el preflight dirá si en la base real la columna `fecha_inicio` también vale `0206-12-24`; si no, no se aplica y se revisa. (b) La corrección **no regenera ni publica** el tarifario del hotel 53: la cotización por fechas y la reserva usan la vigencia al instante, pero el tarifario publicado se actualiza la próxima vez que se regenere (acción aparte del dueño). (c) Hoy esa vigencia cubre desde el 10 de noviembre; al corregirla, las noches del 10-nov al 23-dic dejan de usar la tarifa ALTA y pasan a la vigencia que las cubra: conviene mirar el precio de esas noches antes y después.

## L.4 Revisión de solicitudes y consumo de Vercel sobre el diff
Diff de código de producción: `actions.ts` (+39), `HotelDetalleClient.tsx` (+17), módulo nuevo `validarFechasVigencia.ts`. Sin rutas, middleware, `cron`, dependencias, variables de entorno ni migraciones nuevas.

| Aspecto | Resultado |
|---|---|
| Invocaciones de Server Actions | El formulario valida antes de llamar: un guardado inválido ya no hace ninguna invocación. Los válidos hacen las mismas que antes. |
| Consultas a la base | `crearTemporada`: 0 nuevas. `actualizarTemporada`: **las mismas 2** (la lectura previa existente ahora trae también las fechas; el orden cambió, leer primero y validar después, así un guardado rechazado cuesta 1 lectura, antes 0). `cargarTemporadasMasivo` y `copiarTemporadasDesdeHotel`: 0 nuevas (validación en memoria). |
| Trabajo evitado | Un guardado rechazado ya no ejecuta `revalidatePath` ni `regenerarTarifariosDeHotel` (la regeneración del tarifario del hotel es el trabajo más caro de estas acciones): medido en las pruebas, **0 regeneraciones** al rechazar frente a 1 antes; la copia y la carga masiva regeneran menos hoteles si se omiten filas. |
| Revalidaciones y navegación | Sin nuevos `revalidatePath`, `router.refresh()` ni `fetch`. |
| Cliente | Un módulo puro pequeño (sin dependencias) y una llamada al pulsar guardar, no por tecla: sin re-renders adicionales. |
| CPU del servidor | `anioVigenteBogota()` reutiliza el formateador `Intl` ya existente; coste despreciable. |
| Lo que no se midió | Métricas reales de Vercel (no hay despliegue ni Preview); lo anterior se infiere del código y de los conteos de las pruebas. |

## L.5 (SUPERADA por §M) D5 — ocupación no admitida frente a tarifa que falta
> **El dueño decidió D5 y D6 (§M): sin tarifa no se vende.** La recomendación (c) de abajo —tratar como «hueco» una acomodación que se vende en otra vigencia— **queda retirada**. Se conserva el texto original solo como registro.

*(D6, «grupo sin tarifa», depende de esta: si no se distingue «no se ofrece» de «falta cargar», avisar de huecos generaría falsas alarmas.)*

**Ejemplo sencillo.** Junior Suites del hotel 1, régimen PAM, tiene precio de **sencilla y doble** pero no de **múltiple** (4 personas). Hoy el diagnóstico la cuenta como «múltiple sin precio». Pregunta: **¿esa ausencia significa «no se ofrece» o «falta cargarla»?**
- **(a)** Ausencia = no se ofrece. Cómodo, pero un olvido real se vuelve invisible.
- **(b)** Cada categoría declara qué ocupaciones admite (es #44) y solo una acomodación admitida sin precio es un hueco.
- **(c)** Regla intermedia, sin esperar a #44: *«si la combinación categoría + régimen ya vende esa acomodación en alguna otra vigencia, y esta vigencia no la trae, es un hueco; si nunca se ha vendido en esa combinación, se trata como no ofrecida»*.

**Recomendación (mía, no decide nada):** (c) para las vigencias que adopten grupos mientras no exista #44, y (b) cuando se construya. Con (c), el hotel 54 (PC sin tarifa en ALTA mientras otra vigencia sí la tiene) aparece como hueco, y «múltiple» de una Junior Suites que nunca se cargó no. El comportamiento de los hoteles sin grupos no cambia.

---

# M. Decisión del dueño: sin tarifa, no se vende (2026-11-10)

**Decisión confirmada:** si una acomodación no tiene tarifa, **no se vende**. Quitar el precio es hoy el mecanismo con el que el negocio impide que se compre una ocupación que el hotel no ofrece. Cierra D5 y D6 y retira la recomendación de L.5.

## M.1 Cómo se lee el diagnóstico a partir de ahora
- Los conteos de acomodaciones sin precio (controles 5, 6, 7, 8, 9, 13 y 15 y la clasificación de K.6) **no son defectos ni carga pendiente** y **no autorizan correcciones**.
- Prohibido derivar de ellos: copiar precios de otra vigencia, completar tarifas, habilitar una acomodación porque tuvo precio en otra vigencia, o mostrar avisos de «tarifa faltante» basados solo en datos históricos.
- Lo que sí se mantiene como asunto separado: el control 7 describe noches que **hoy** se venden con el precio de otra vigencia. Es comportamiento vigente de hoteles sin grupos; no se cambia en esta entrega ni se juzga como error.
- Las etiquetas (A) «falta cargar», «urgente» y «riesgo de precio» de K.6 quedan sin valor de conclusión. La consulta preflight no se modifica (describe, no corrige); basta esta nota de lectura.

## M.2 Regla para vigencias nuevas con grupos (propuesta de diseño; el motor no se implementa aún)
1. Para una noche, se determina el grupo aplicable de la vigencia ganadora. Si ese grupo **no tiene precio** para la acomodación pedida, esa noche **no se vende para esa acomodación**.
2. **Sin rescate:** no se usa otro grupo de la misma vigencia ni una vigencia de menor prioridad. (N2 de F.4 queda como regla decidida.)
3. Una sola noche no vendible hace no vendible la estadía para esa acomodación; las demás acomodaciones del hotel se evalúan por separado.
4. **Ausencia de tarifa ≠ precio cero válido.** La regla vigente se conserva sin cambios: en sencilla/doble/triple/múltiple un neto de 0 equivale a «no aplica» (no se vende); en niño 1 y niño 2 un 0 es **gratis y válido** y un valor ausente (nulo) es «no se vende»; infante sin tarifa sigue viajando gratis por la decisión vigente. No se cambia ninguna gratuidad ni se reinterpreta ningún 0.
5. Mensajes del editor, si se muestran, serán **informativos** («este grupo no vende doble»), nunca «falta».
6. No se copia, completa ni propone ningún precio de forma automática. (Esto reabre H6/D12: la copia al dividir una vigencia queda retirada; solo cabe una propuesta confirmada fila por fila.)

## M.3 Dos decisiones que no se mezclan
| Pregunta | Qué decide | Ejemplo |
|---|---|---|
| ¿Esta **acomodación** se vende esa noche? | Existencia de precio en el grupo aplicable de la base ganadora | Fin de semana sin precio de doble ⇒ la doble no se vende esas noches. |
| ¿La **promoción** aplica a esa noche/acomodación? | Reglas de la promoción (D7): si no aplica, el cliente paga la **base**; si no hay base con precio, **no se vende** | Promo solo para doble y triple: sencilla se vende al precio base de su grupo, si lo tiene. |
Una promoción que no aplica **nunca** convierte una acomodación en «no vendida», y una acomodación no vendida **nunca** se rescata con una promoción (ya decidido [D]: ni promoción ni cierre «arreglan» una noche sin precio).

## M.4 Qué no cambia
Hoteles sin grupos: comportamiento idéntico al actual (incluida la caída a la vigencia inferior). Ninguna tarifa, gratuidad, prioridad ni fila se modifica; sin migraciones, regeneración ni publicación. La validación de fechas de L.2 (28 + 23 + 6 pruebas) no se tocó ni se repitió.

## M.5 Ajustes hechos a este documento
F.4 (fila «grupo cubierto sin fila»), H6, D5, D6, D12 y L.5 reescritos o marcados; K.6 y la nota de interpretación del preflight (controles 7–9) señalan que ya no se leen como carga pendiente. N2 ahora es regla decidida, no propuesta.

## M.6 (CERRADA por §N) D13 — un día de la semana que ningún grupo cubre
> **Aprobada por el dueño en una forma distinta a la recomendada abajo.** La recomendación (c) («día heredado marcado a propósito») **no se adopta**: no hay opción «usar vigencia inferior». Vale lo escrito en §N. Se conserva el texto como registro.
Es lo único que la decisión de M.2 **no** resuelve: no es un grupo sin precio, es un día que la vigencia no reclama.

**Ejemplo sencillo.** El hotel tiene dos vigencias: BAJA (todo el año, 100.000 por noche) y ALTA con un solo grupo «Fin de semana» (vie–dom, 180.000). Un cliente reserva de jueves a domingo. El jueves no pertenece a ningún grupo de ALTA.
- **(a)** La vigencia ALTA no cubre el jueves y cae a BAJA: el jueves cuesta 100.000 y vie–sáb 180.000. Es lo que hoy hace un blackout y permite «ALTA solo en fines de semana».
- **(b)** El jueves queda sin precio dentro de ALTA y **no se vende**; no cae a BAJA. Coherente con «sin tarifa no se vende», pero para vender ese jueves ALTA tendría que tener también un grupo entre semana.
- **(c)** Como (b), con un día «a propósito heredado de la vigencia inferior» que el usuario marca explícitamente.

**Recomendación (mía):** (c). Mantiene la regla de M.2 (nada se rescata por accidente) y deja un camino explícito para el caso legítimo de «ALTA solo en fines de semana». Si el dueño prefiere lo más simple, (b); (a) es la que más se parece a un rescate silencioso y es la que más choca con la decisión de hoy. Solo para vigencias con grupos.

*Sigue pendiente después de D13: D7–D12 (con H6 reabierta) y las correcciones manuales de datos (hoteles 9, 78 y 172); la del 53 está preparada en L.3.*

---

# N. D13 aprobada: cobertura del día frente a disponibilidad de la acomodación (2026-11-10)

## N.1 Regla aprobada (solo vigencias con grupos; el motor no se implementa aún)
Para cada noche de la estadía se resuelven **dos preguntas distintas, en este orden**:
1. **Cobertura del día.** ¿La vigencia cubre esa noche? Depende de fechas, compra, régimen restringido, blackouts y de que el día de la semana **pertenezca a algún grupo**. Un día que ningún grupo cubre queda **fuera de la cobertura** de esa vigencia, igual que un blackout. Entonces se resuelve **otra vigencia aplicable** según fechas, compra y prioridad; si ninguna aplica, la noche **no se vende**.
2. **Disponibilidad de la acomodación.** Si el grupo **sí cubre** la noche pero **no tiene tarifa** para la acomodación pedida, esa acomodación **no se vende** esa noche (M.2): no se recurre a otro grupo ni a una vigencia inferior.
- **No existe** una opción «usar vigencia inferior» ni días «cerrados»: la diferencia entre las dos preguntas ya resuelve ambos casos.
- Sin grupos: comportamiento actual sin cambios (incluida la caída a la vigencia inferior cuando falta tarifa).

## N.2 Ejemplo aprobado
BAJA todo el año: 100.000 por persona y noche. ALTA con un solo grupo «Viernes–domingo»: 180.000. Entrada **jueves**, salida **domingo**:

| Noche | Cobertura de ALTA | Vigencia que resuelve | Precio |
|---|---|---|---|
| Jueves | No (ningún grupo de ALTA incluye el jueves) | BAJA | 100.000 |
| Viernes | Sí (grupo V–D) | ALTA | 180.000 |
| Sábado | Sí (grupo V–D) | ALTA | 180.000 |
| Domingo | — (fecha de salida, no cobra noche) | — | — |
| **Total** | | | **460.000** |

Contraste: si ALTA, grupo V–D, **no** trae precio de doble y se pide doble, el viernes y el sábado están cubiertos por el grupo pero sin tarifa ⇒ la doble **no se vende esas dos noches**; no se cobra el viernes con BAJA aunque BAJA sí tenga doble. **La disponibilidad se evalúa noche por noche**: el jueves sigue siendo vendible en doble con BAJA (100.000). Después se valida la estadía completa (O.1): como faltan dos noches, la opción jueves–domingo en doble no se muestra. *(Corrige una frase anterior que decía que la falta de doble viernes–domingo impedía «vender el jueves»: no impide la noche del jueves, impide la estadía completa.)*

## N.3 Qué se corrige o aclara en el diseño
- C.1 (lista de propuestas): el día sin grupo pasa de [P] a **[D]**; ahora distingue cobertura y disponibilidad.
- F.4: primera fila decidida; N3 (G.8) queda como regla decidida.
- H4 (G.9) y M.6 marcadas como cerradas; la recomendación (c) de M.6 no se adopta.
- Aviso del editor: pasa de «esas noches no tendrán precio» a informativo: «esos días quedan fuera de esta vigencia y los resuelve otra vigencia aplicable».
- Interacción con promociones (sin cambios de fondo): una promoción por grupo solo actúa sobre noches que su base cubre; una noche resuelta por otra vigencia usa las promociones de **esa** vigencia.

## N.4 Casos de prueba previstos (E3/E5; ninguno implementado)
Se suman a D.7. Cada uno compara con un importe exacto o golden:
1. **Ejemplo aprobado:** jueves BAJA 100.000 + viernes ALTA 180.000 + sábado ALTA 180.000 = **460.000**; la salida del domingo no cobra noche.
2. Día sin grupo con **otra vigencia aplicable** (BAJA) ⇒ usa su prioridad, fechas y compra; con BAJA fuera de compra o de fechas ⇒ **no se vende**.
3. Día sin grupo **y ninguna otra vigencia** ⇒ noche no vendible; la estadía no se vende.
4. Grupo cubre la noche **sin precio de doble**, BAJA sí lo tiene ⇒ doble **no se vende** (sin rescate por BAJA); sencilla (con precio en el grupo) sí.
5. Mismo caso con **otro grupo** de la misma vigencia que sí trae doble ⇒ no se usa; sigue sin venderse.
6. **Precio cero válido:** niño 1/2 con 0 en el grupo ⇒ gratis y vendible; niño nulo ⇒ no se vende; infante sin tarifa ⇒ gratis (regla vigente); habitación con 0 ⇒ no se vende.
7. **Promoción que no aplica** (sin regla para el grupo) ⇒ se cobra la base del grupo; **acomodación sin precio en la base** ⇒ no vendible aunque exista promoción (M.3, O.1). Casos detallados en O.3.
8. Estadía que cruza el límite entre días cubiertos y no cubiertos y entre dos vigencias (jue–lun), con un día en blackout.
9. **Sin grupos:** los golden files de caracterización de E3 (27 pruebas) siguen idénticos, incluida la caída a la vigencia inferior.
10. Vigencia con grupos que no cubre ningún día de la estadía ⇒ se ignora por completo y gana la inferior.
11. Paridad: mismo resultado en vista previa, generación de tarifario, «Desde», cotización por fechas, carrito y reserva (D.7).

## N.5 (CERRADA por §O) D7 — promoción que no incluye una acomodación
> **Aprobada: opción (a).** Ver §O. El texto de abajo se conserva como registro.
Es la siguiente que no depende de más datos (D8–D12 vienen después). Aquí se decide solo el comportamiento de la **promoción**, no la disponibilidad (M.3).

**Ejemplo sencillo.** Hotel X, ALTA doble 150.000 y sencilla 200.000. Promo «−10 %» cargada solo con fila de **doble** (135.000). Un cliente pide sencilla: ¿qué paga?
- **(a)** Paga la base, 200.000: la promoción no aplica a lo que no menciona (es lo que hoy ocurre con la sencilla en los hoteles 57 y 59). Con grupos, igual: la promo de un grupo solo toca lo que trae.
- **(b)** Exigir que cada promoción declare a qué acomodaciones aplica, para que no haya dudas en pantalla; el precio sigue siendo (a).
- **(c)** Si la promoción no cubre la acomodación, esa acomodación no se vende mientras la promoción sea la ganadora (mezcla promoción con disponibilidad).

**Recomendación:** (a) como comportamiento, porque coincide con lo vigente y con M.3, y (b) como mejora opcional de la pantalla. Rechazar (c).

---

# O. D7 aprobada: la promoción no crea disponibilidad; la estadía exige todas las noches (2026-11-10)

## O.1 Reglas aprobadas (vigencias con grupos; el motor no se implementa aún)
1. **Promoción que no aplica** a una noche o a una acomodación (sin regla para ese grupo, sin fila, fuera de régimen o de compra): queda vigente **la tarifa de la base aplicable** de esa noche.
2. **La promoción no crea disponibilidad.** Si la base aplicable no vende esa acomodación esa noche, la promoción no la habilita, aunque traiga fila con precio para ella.
3. **Disponibilidad por noche, luego estadía completa.** Primero se evalúa cada noche (cobertura del día, disponibilidad en la base, promoción si aplica). Después se valida la estadía: **se exige precio para todas las noches**. Si falta una, **esa opción no se muestra**; no se ofrece una estadía parcial. Cuando todas las noches tienen precio, la estadía se vende.
4. La **fecha de salida no cobra noche** (no se evalúa ni para precio ni para disponibilidad).

## O.2 Las tres distinciones, sin mezclar
| # | Situación | Qué ocurre |
|---|---|---|
| 1 | **Día fuera de cobertura** de una vigencia (ningún grupo lo cubre, blackout, fechas, compra) | Puede aplicar otra vigencia, según fechas, compra y prioridad (D13). Si ninguna, la noche no tiene precio. |
| 2 | **Grupo base que cubre el día pero no vende la acomodación** | La acomodación no se vende esa noche; **no** se rescata con otro grupo ni con una vigencia inferior (M.2). |
| 3 | **Promoción que no aplica** | Se usa la base que sí corresponde a esa noche (la del punto 1 o 2 ya resuelto). Si esa base no vende la acomodación, sigue siendo punto 2. |

## O.3 Ejemplo aprobado
Doble disponible jueves, viernes y sábado en la base. Promoción solo el viernes (la promoción trae regla para el grupo del viernes).

| Noche | Qué aplica | Resultado |
|---|---|---|
| Jueves | Base | precio base del jueves |
| Viernes | **Promoción** | precio promocional |
| Sábado | Base | precio base del sábado |
| Domingo | Salida | no cobra |

Total = jueves base + viernes promoción + sábado base.

**Variante:** si el viernes **no tiene tarifa de doble en la base aplicable**, esa noche no es vendible en doble (aunque la promoción del viernes traiga precio de doble, porque no crea disponibilidad). Como falta una noche, **la opción completa jueves–domingo no se muestra**; no se ofrece «jueves y sábado» como estadía parcial.

## O.4 Casos de prueba previstos (se suman a N.4; ninguno implementado)
1. Promoción solo el viernes ⇒ jueves base + viernes promoción + sábado base; el domingo no cobra.
2. Mismo caso, viernes **sin doble en la base**, con fila de promoción que sí trae doble ⇒ la opción jueves–domingo en doble **no se muestra** (la promoción no habilita).
3. Misma estadía en **sencilla** (con precio en la base) ⇒ sí se muestra.
4. Falta una sola noche (la del medio, y por separado la primera y la última) ⇒ no se muestra; **nunca** una estadía parcial ni un total que omita la noche.
5. Promoción sin regla para el grupo del día ⇒ se cobra la base del grupo, sin error.
6. Promoción vencida en compra o fuera de régimen ⇒ se cobra la base.
7. Promoción de la vigencia A sobre noches resueltas por la vigencia B (día fuera de cobertura de A) ⇒ no aplica; usa las promociones de B.
8. El caso 1 de N.4 (460.000) sigue vigente con una promoción en alguna de sus noches.
9. Sin grupos: sin cambios (caracterización E3).
10. Paridad entre todos los recorridos (vista previa, tarifario, «Desde», cotización por fechas, carrito, reserva): misma decisión de mostrar/no mostrar la opción.

## O.5 (CERRADA por §P) D8 — noche gratis cuando las noches cuestan distinto
> **Aprobada de forma distinta a la recomendada abajo:** no se adopta el promedio para promociones nuevas. Ver §P. Se conserva el texto como registro.
Aplica a la promoción «N noches, 1 gratis» (hoy se regala siempre exactamente 1 noche y se descuenta el **promedio**, §F.1).

**Ejemplo sencillo.** Compra 3 noches y paga 2. Jueves 100.000, viernes 150.000, sábado 150.000 (total sin promoción 400.000). ¿Cuánto se cobra?
- **(a) Promedio (hoy):** 266.667. Se descuenta 1/3 del total (133.333); no depende de qué noche «sale gratis».
- **(b) Se regala la noche más barata:** 300.000 (jueves gratis).
- **(c) Se regala la noche más cara:** 250.000.
- **(d) Se regala la de entrada:** 300.000 (jueves gratis); en una estadía domingo–miércoles (150/100/100) sería 200.000.

**Recomendación:** (a) en hoteles sin grupos (es lo vigente) y también en hoteles con grupos, mientras no exista un pacto escrito con el proveedor que diga qué noche se bonifica. Con (a) el cliente ve lo mismo sin importar el día de entrada y no hay sorpresas entre hoteles. Pasar a (b) solo si el proveedor lo pacta, y solo para vigencias con grupos.

---

# P. D8 aprobada: noche bonificada elegida explícitamente (2026-11-10)

## P.1 Reglas aprobadas (el motor no se implementa aún)
1. Las promociones **nuevas** de tipo «N noches, 1 gratis» deben **elegir explícitamente** cuál noche se bonifica:
   - **la noche más barata**,
   - **la noche más cara**,
   - **la última noche de la estadía**.
2. **No se añaden** «primera noche» ni «promedio» como opciones nuevas.
3. **Sin opción preseleccionada:** el formulario no guarda hasta que quien configura elija, según el acuerdo con el proveedor (una promoción nueva sin elección es inválida, en formulario y en servidor).
4. **Promociones existentes:** conservan el cálculo vigente de **promedio** (`(N−1)/N` del total). No se convierten, no se recalculan históricos y no se regeneran automáticamente. Distinción técnica prevista: la elección se guarda como un valor propio de la promoción; **ausente (nulo) = promedio heredado**. Una promoción heredada se ve en pantalla como «promedio (anterior)» y solo se cambia si alguien la edita y elige una de las tres opciones.
5. Se bonifica **exactamente una** noche por estadía (regla vigente); si varias noches empatan en precio, se bonifica solo una (el importe no depende de cuál; para el desglose se toma la primera en orden cronológico).
6. La fecha de salida no cobra noche y no participa en la elección.
7. `min_noches` sigue significando «noches mínimas de la estadía para la promoción» y la promoción sigue anclada a la noche de entrada (comportamiento vigente, §C).

## P.2 Ejemplo obligatorio
Entrada jueves, salida domingo. Jueves 100.000 + viernes 150.000 + sábado 150.000 = **400.000** sin promoción.

| Regla elegida | Noche bonificada | Total |
|---|---|---|
| Más barata | jueves | 150.000 + 150.000 = **300.000** |
| Más cara | viernes o sábado (empate: se bonifica una sola) | 100.000 + 150.000 = **250.000** |
| Última noche | sábado | 100.000 + 150.000 = **250.000** |
| Promedio (solo promociones existentes) | — | 266.667 |

El domingo es salida y no cobra noche. Con empate entre viernes y sábado en «más cara», se bonifica una sola de ellas.

## P.3 Cómo se calcula (diseño)
- El precio de cada noche sale primero del flujo ya decidido (cobertura del día, base aplicable, promoción por noche si aplica; §N y §O). Solo después se elige la noche a bonificar **entre las noches ya valoradas** y se resta su precio. Una noche sin precio nunca se bonifica: la estadía ya no se muestra (O.1).
- La elección se hace **por acomodación pedida** (cada línea del cálculo usa el precio por persona de su acomodación). Si una misma cotización mezcla acomodaciones con distinto orden de precios, la noche bonificada puede diferir por línea; es un detalle de implementación que se resuelve en E5 y se prueba (P.4), no una decisión comercial.
- Descuentos posteriores (EBB / Long Stay) siguen aplicándose sobre el total ya liquidado cuando la acumulación está permitida (§Q); si el proveedor decidió que no se acumulan, se aplica la precedencia configurada.

## P.4 Casos de prueba previstos (se suman a N.4 y O.4; ninguno implementado)
1. Ejemplo P.2: más barata = 300.000; más cara = 250.000; última noche = 250.000; domingo no cobra.
2. Empate entre noches en «más cara» (viernes = sábado) y en «más barata» ⇒ se bonifica solo una; importe igual al esperado; desglose con una sola noche en 0.
3. Estadía de 4 noches (mayor que `min_noches`) ⇒ sigue bonificándose exactamente una noche.
4. Estadía menor que `min_noches` ⇒ no aplica.
5. Estadía que cruza dos vigencias o dos grupos ⇒ la elección se hace sobre los precios ya resueltos de cada noche.
6. Noche sin precio ⇒ la opción no se muestra (nunca «regala» la noche faltante).
7. Promoción **existente** sin la nueva elección ⇒ promedio idéntico al actual (golden E3: 266.667 y 233.333 de las 27 pruebas de caracterización).
8. Promoción **nueva** sin elección ⇒ el formulario y la acción del servidor la rechazan; con valor inválido también.
9. Cambiar de promedio a una de las tres opciones solo por edición explícita; ningún tarifario ni cotización existente se recalcula.
10. Combinada con una promoción por noche en el grupo y con EBB/Long Stay: el orden es noche → bonificación → descuentos posteriores **si son acumulables**; si no, la precedencia configurada (§Q.4, casos de prueba Q.7).
11. Dos acomodaciones en la misma cotización con distinto orden de precios ⇒ resultado por línea.
12. Paridad entre todos los recorridos (vista previa, tarifario, «Desde», cotización por fechas, carrito, reserva).
13. Sin grupos: sin cambios para hoteles que no usan la regla nueva.

## P.5 (CERRADA por §Q) D9 — promoción por grupo con EBB / Long Stay
> **Aprobada de forma distinta a la recomendada abajo:** no se deja un único criterio global; el proveedor decide por promoción. Ver §Q.
**Ejemplo claro.** Estadía jueves → domingo (3 noches). Base: 100.000 por noche entre semana y 150.000 el fin de semana (jueves 100.000 + viernes 150.000 + sábado 150.000 = **400.000**). Promoción: −10 % lunes–jueves y −5 % fin de semana ⇒ 90.000 + 142.500 + 142.500 = **375.000**. La reserva se hace con 90 días de anticipación y el hotel tiene una tarifa «Reserva anticipada» (EBB) de **−12 %**.

| Alternativa | Qué hace | Total |
|---|---|---|
| **A. Se acumulan (hoy)** | El 12 % se descuenta del total ya con promoción | 375.000 × 0,88 = **330.000** |
| **B. Gana el menor importe** | Se compara promoción (375.000) con EBB sobre la base (400.000 × 0,88 = 352.000) y se cobra el menor | **352.000** |
| **C. Prevalece la promoción** | Si hay promoción ganadora, no se aplica EBB / Long Stay | **375.000** |
| D. Sumar porcentajes | Descartada (mezcla familias de descuento) | 327.000 |

**Recomendación:** **A (no cambiar)**: es lo que ocurre hoy y no altera el precio de ningún hotel existente; las promociones por grupo se comportan igual que las demás. Hay que saber que implica que un cliente puede recibir dos descuentos en la misma estadía; si el dueño no lo quiere, **C** es el único cambio proporcionado (se decide por promoción o por hotel, no de forma global) y B solo con una razón comercial clara, porque exige guardar también el neto de la base. Se aplicaría igual a vigencias con y sin grupos mientras no se decida lo contrario.

---

# Q. D9 aprobada: acumulación y precedencia según el proveedor (2026-11-10)

> **AMPLIADA Y PARCIALMENTE SUPERADA por §R (decisión final del dueño).** Siguen vigentes Q.1 (salvo el punto 4), Q.2, Q.3 y Q.6 (con los ajustes de R.7). **Quedan superados:** Q.1 punto 4 (la pregunta «¿cuál prevalece?» pasa a ser un **orden explícito**), Q.4, Q.5 casos 5 a 7 y la recomendación (A) del caso 6 (**retirada**), y los casos de prueba Q.7 4, 5, 8 y 9. Se conservan como registro.

Esta sección separa lo **aprobado por el dueño** (Q.1 a Q.3) de lo que es **propuesta operativa mía** (Q.6) y de lo que **sigue pendiente** (Q.5). El motor y la pantalla no se implementan en esta ronda.

## Q.1 Decisiones comerciales aprobadas
1. Al crear o editar una promoción porcentual, de monto fijo o de noche gratis, se pregunta por la acumulación **únicamente si existe una regla EBB o Long Stay habilitada que pueda coincidir con ella**. No basta con que exista una regla ajena a sus fechas o a su alcance.
2. Si no hay coincidencia posible: no se muestra la pregunta y **no se asigna ninguna respuesta implícita**.
3. Si el proveedor dice que **sí son acumulables**: se permite la combinación. Siguen vigentes la disponibilidad por noche, la estadía completa y el resto de reglas de §N, §O y §P.
4. *(SUPERADO por §R: ahora se exige un orden explícito entre las alternativas en conflicto, no solo «cuál prevalece».)* Si **no son acumulables**: es obligatorio responder «**¿Cuál debe prevalecer según el proveedor?**», ofreciendo solo las alternativas que puedan coincidir:
   - Esta promoción.
   - Compra anticipada (EBB).
   - Larga estadía (Long Stay).
   Sin opción preseleccionada. **No** se elige por menor precio, mayor descuento ni orden de creación.
5. Si la promoción existe primero y después se **crea, habilita o modifica** un EBB / Long Stay, o se **cambian las fechas o el alcance** de la promoción, se detectan las coincidencias nuevas y se avisa qué promociones requieren configurar acumulación y precedencia.
6. Las respuestas se **guardan** y se aplican **automáticamente** al cotizar. No se pregunta al cliente ni en cada reserva.
7. **No se cambian** las promociones existentes ni se regeneran tarifas automáticamente.

## Q.2 Qué significa «puede coincidir» (definición técnica, derivada del código vigente)
Las reglas EBB / Long Stay (`hotel_reglas_descuento`: hotel, tipo, umbral, %, activa) **no tienen fechas ni alcance propio**: aplican a toda la neta hotelera de la estadía cuando la reserva cumple su umbral. La coincidencia, entonces, depende del umbral frente a las condiciones de la promoción:
- **EBB (umbral = días de anticipación):** coincide si existe una fecha de reserva posible (desde hoy en Bogotá, dentro de la ventana de compra de la promoción, o sin límite si no tiene) y una noche de entrada cubierta por la promoción (fechas de viaje menos blackouts, régimen, `min_noches`) tales que `check-in − reserva ≥ umbral`. Se evalúa con la entrada **más lejana** cubierta y la reserva **más temprana** posible.
- **Long Stay (umbral = noches):** coincide si existe una estadía de al menos `umbral` noches (y al menos las noches mínimas de la promoción) que incluya alguna noche cubierta por la promoción. *Supuesto a verificar en el motor: el modelo vigente no limita el máximo de noches de una estadía; si existiera un máximo, la definición debe respetarlo.*
- Solo cuentan reglas **activas**. Una regla inactiva no genera pregunta; una regla eliminada o desactivada deja inerte (sin borrar) la respuesta guardada.
- **Ejemplo de no coincidencia:** promoción con compra hasta el 30-nov y viaje del 10 al 20-dic; hoy 10-nov. Una EBB de 60 días no puede coincidir (la entrada más lejana, 20-dic, queda a 40 días de la reserva más temprana); una EBB de 30 días sí. Con la EBB de 60 días **no se pregunta nada**.
- El paso del tiempo solo **elimina** coincidencias (la reserva más temprana posible avanza); nunca crea coincidencias nuevas por sí solo. Las coincidencias nuevas nacen de editar una promoción o una regla (Q.1 punto 5).

## Q.3 Qué se guarda (propuesta de datos; sin migración todavía)
Una respuesta **por par** (promoción, regla) con: acumulable sí/no; si no, cuál prevalece (`promocion` / `ebb` / `long_stay`); quién la decidió y cuándo; y una huella del alcance de la promoción cuando se decidió (para saber si un cambio de fechas creó una coincidencia que antes no existía). Estados de un par: **heredada** (existía antes de esta función y sigue acumulando como hoy), **configurada** y **pendiente**. Al cotizar se leen estas respuestas; no hay preguntas en el momento de la compra.

## Q.4 Cómo se aplica al cotizar (diseño) — SUPERADO por §R.4
Primero se valora cada noche (cobertura, base, promoción; §N y §O) y la noche gratis (§P). Luego, para cada regla EBB / Long Stay que **sí cumple** las condiciones concretas de esa reserva y que coincide con la promoción aplicada:
- **Acumulable:** se descuenta sobre el total ya liquidado (como hoy).
- **No acumulable:** se aplica la alternativa que prevalece. «Esta promoción» ⇒ no se aplica la regla; «EBB» o «Long Stay» ⇒ no se aplica la promoción y la regla actúa sobre la **base** de las noches.
- **Relación vigente entre EBB y Long Stay:** si ambas cumplen, gana el mayor %, nunca se suman. *(Cuando el proveedor configura explícitamente un orden, ese orden rige donde la configuración aplica; §R.4 y R.6.)*
- **Requisito técnico (E7):** para que «EBB / Long Stay prevalece» se pueda calcular, la composición publicada debe poder entregar también el neto **sin** la promoción (hoy guarda un solo neto por combinación, ver F.2). Es trabajo del motor, no una decisión comercial.

## Q.5 Casos que se pidió definir y qué decisión falta
| # | Caso | Resultado propuesto | ¿Falta decisión? |
|---|---|---|---|
| 1 | Promoción sin EBB / Long Stay | No pregunta; nada que guardar. | No |
| 2 | Coincide solo con EBB, o solo con Long Stay | Pregunta de acumulación; si no acumulan, «¿cuál prevalece?» con 2 alternativas (promoción y esa regla). | No |
| 3 | EBB / Long Stay agregado **después** de la promoción | Se detecta el par nuevo y se marca la promoción como «requiere configurar» (Q.6). Las respuestas ya guardadas de otros pares no cambian. | No |
| 4 | Cambio de fechas o alcance que crea una coincidencia nueva | Igual que el 3; los pares que ya coincidían conservan su respuesta. | No |
| 5 | No acumulable: prevalece cada alternativa | «Promoción»: ni EBB ni Long Stay actúan. «EBB» o «Long Stay»: la promoción no actúa y esa regla descuenta sobre la base. | No |
| 6 | **Promoción, EBB y Long Stay coinciden a la vez** | Ver abajo. | **Sí (D9-b)** |
| 7 | La alternativa preferida **no cumple** las condiciones de esta reserva | Ver abajo. | Confirmar una interpretación |

**Caso 6 — ejemplo y decisión pendiente (D9-b).** Estadía de 7 noches a 100.000 (base **700.000**). Promoción −10 % ⇒ **630.000**. EBB 12 % (reserva con 90 días) y Long Stay 15 % (7 noches), ambas cumplidas. Hoy: gana el mayor % entre las dos (Long Stay 15 %) y descuenta sobre el total con promoción: 630.000 × 0,85 = **535.500**.
El proveedor marca que no son acumulables y la pregunta, con tres alternativas, recibe «**EBB**». Hay tres lecturas y dan precios distintos:
- **(A) [RETIRADA por §R: elegir primero el mayor % entre EBB y Long Stay contradice una precedencia configurada explícitamente.] Respuestas por pares, relación EBB / Long Stay intacta.** Se evalúa primero la regla del mayor % entre EBB y Long Stay (gana Long Stay 15 %) y esa ganadora se compara con la promoción usando **la respuesta de su propio par**. «EBB prevalece» solo juega cuando la ganadora entre las dos reglas es EBB. Para cerrar el caso hay que haber respondido **también** el par promoción–Long Stay (p. ej. «Long Stay prevalece» ⇒ 700.000 × 0,85 = **595.000**; «promoción prevalece» ⇒ **630.000**).
- **(B) Una sola respuesta de tres vías, excluyente.** «EBB» ⇒ solo EBB actúa: 700.000 × 0,88 = **616.000**. Cambia en silencio la relación vigente: EBB pasa por encima de un Long Stay de mayor %.
- **(C) Una respuesta de tres vías más un orden entre EBB y Long Stay.** Inventa una prioridad entre ambas, que no se ha aprobado.
**D9-b resuelta por el dueño en §R (orden explícito).** *(Recomendación original, retirada:)* **(A)**. Respeta la relación vigente entre EBB y Long Stay y la regla de «solo alternativas que coinciden»; cuando las tres coinciden, la pantalla pide una respuesta por cada par que coincide (promoción–EBB y promoción–Long Stay) en lugar de una sola de tres vías. Con (A) el texto de la pregunta se conserva: «¿Cuál debe prevalecer según el proveedor?», una vez por regla que coincide.

**Caso 7 — ejemplo.** Promoción con 3 noches a 375.000 (base 400.000). EBB 12 % exige 60 días y el proveedor respondió «EBB prevalece». El cliente reserva con 20 días de anticipación: la EBB **no cumple** esta reserva. Interpretación propuesta: la precedencia **solo resuelve conflictos entre lo que sí aplica a esa reserva**; como la EBB no aplica, no hay conflicto y se cobra la promoción (**375.000**); no se pierde el descuento al que el cliente sí tiene derecho. Lo mismo al revés («la promoción prevalece», pero la estadía no cumple las condiciones de la promoción ⇒ aplica la EBB, si la cumple; si ninguna cumple, la base). Esta lectura se deriva de «prevalece»; no requiere una decisión nueva si el dueño la confirma en su respuesta. La alternativa (la preferida «bloquea» a la otra aunque no se cumpla) dejaría al cliente sin ningún descuento y no se propone.

## Q.6 Propuesta operativa para impedir publicar una combinación sin configurar (NO es una decisión comercial aprobada)
Objetivo: una combinación nueva no se asume resuelta, y lo que ya estaba autorizado sigue vendiéndose.
1. **Línea base:** toda coincidencia que existe al activarse la función se registra como **heredada** (acumulan como hoy). Nada cambia de precio ni se regenera.
2. **Detección al guardar:** al crear o editar una promoción, o al crear, habilitar o modificar una regla EBB / Long Stay, se recalcula la coincidencia de ese par (Q.2) y se compara con lo guardado. Todo par coincidente sin respuesta ni línea base es **pendiente**. No se recalcula nada en cada cotización: la detección ocurre solo al guardar.
3. **La novedad queda retenida, lo autorizado no:**
   - Promoción **nueva** con pares pendientes: se guarda como borrador y no entra al tarifario ni a la cotización.
   - Promoción **existente** editada que genera pares pendientes: el cambio queda como «cambio pendiente de configurar» y la versión ya autorizada sigue vendiéndose sin cambios hasta que se complete.
   - Regla EBB / Long Stay **nueva o modificada** que crea pares pendientes con promociones: la regla queda retenida hasta responder esos pares; las promociones y la versión previa de la regla (si existía) siguen igual.
4. **Aviso:** un listado de «promociones por configurar» por hotel, con el par exacto (qué promoción, qué regla, por qué coincide).
5. **Defensa en el servidor:** la regeneración o publicación del tarifario del hotel rechaza todo par pendiente; si en la ruta de cotización se encontrara un par sin estado, falla cerrado (no muestra esa opción) y deja registro. No se supone «acumulan» ni «prevalece».
6. **Costo:** la detección es un cálculo en memoria sobre las promociones y reglas de un hotel, hecho una vez al guardar; no añade llamadas por cotización ni revalidaciones.
7. **Pendiente de decidir (técnico):** dónde viven las versiones («cambio pendiente») requiere una migración con su preflight, postcheck y rollback; no se diseña aquí.

## Q.7 Casos de prueba previstos (se suman a N.4, O.4 y P.4; ninguno implementado)
1. Promoción sin ninguna regla EBB / Long Stay activa ⇒ sin pregunta, sin registro.
2. EBB de 60 días frente a promoción con compra hasta 30-nov y viaje 10–20 dic (hoy 10-nov) ⇒ sin coincidencia, sin pregunta; con EBB de 30 días ⇒ coincide.
3. Solo EBB coincide ⇒ pregunta con 2 alternativas; solo Long Stay ⇒ 2 alternativas; regla inactiva ⇒ no cuenta.
4. Acumulables ⇒ 375.000 × 0,88 = 330.000 (ejemplo del par); no acumulables con «promoción» ⇒ 375.000; con «EBB» ⇒ 352.000.
5. Sin respuesta no se guarda la promoción (formulario y servidor); no hay opción preseleccionada; no se decide por menor precio ni por orden de creación.
6. EBB / Long Stay habilitado o modificado **después** ⇒ el par queda pendiente, el aviso lista la promoción exacta y lo autorizado sigue cotizando igual.
7. Cambio de fechas o de alcance de la promoción que crea una coincidencia nueva ⇒ pendiente; que no la crea ⇒ conserva la respuesta; que la elimina ⇒ la respuesta queda inerte.
8. Caso 6 simultáneo: con la lectura (A), 7 noches: 535.500 (todo acumulable), 595.000, 630.000 y 616.000 según las respuestas; relación EBB / Long Stay intacta (mayor %, nunca se suman).
9. Caso 7: EBB no cumple (20 días de 60) y «EBB prevalece» ⇒ se cobra la promoción; promoción no cumple y «promoción prevalece» ⇒ aplica EBB si cumple, si no la base.
10. Interacción con la noche gratis (§P): noche gratis → elección de precedencia → descuento posterior si acumulan.
11. Promoción existente (heredada) ⇒ sigue acumulando; sin regeneración ni cambio de importes (golden E3: «EBB acumulado sobre una promoción» 264.000 frente a 330.000).
12. Par pendiente en regeneración o publicación ⇒ rechazada; en la ruta de cotización ⇒ falla cerrada con registro.
13. La respuesta se aplica sin preguntar al cliente ni en la reserva.
14. Paridad en todos los recorridos (vista previa, tarifario, «Desde», cotización por fechas, carrito, reserva).

## Q.8 Siguiente decisión comercial pendiente
Además de **D9-b** (Q.5, caso 6, la lectura A/B/C), D10 se presentó después y está cerrada en §S.2.

---

# R. D9 final: precedencia explícita y acumulación, según el proveedor (2026-11-10)

Separa lo **aprobado** (R.1, R.2) de lo que es **diseño derivado mío** (R.3 a R.8). El motor y la pantalla no se implementan.

## R.1 Decisión final aprobada
Cuando varias promociones o reglas puedan coincidir, se configura **su precedencia según el proveedor, además de indicar si son acumulables**.
- Se pregunta **solo** al detectar una coincidencia posible (definición en Q.2).
- Si **no son acumulables**: se exige un **orden explícito** entre las alternativas en conflicto — promoción especial, EBB y Long Stay, según cuáles coincidan. **Sin preselección** y sin elegir por mayor descuento, menor precio ni orden de creación.
- **Al cotizar:** se consideran solo las alternativas cuyas condiciones cumple **esa reserva**, respetando el orden configurado. Si la primera no cumple, se evalúa la siguiente que sí cumpla.
- Se **rechazan** las configuraciones contradictorias o sin resolver.
- Las respuestas se guardan; **no se pregunta al cliente al reservar**.
- Si después se añade o modifica una regla y aparece una coincidencia nueva: se **avisa y se exige completar** la configuración.
- **No se modifica automáticamente** el comportamiento de las promociones existentes.

## R.2 Ejemplo aprobado (todas no acumulables; orden del proveedor: EBB > Long Stay > promoción)
Base 700.000; promoción 10 %, EBB 12 %, Long Stay 15 %.

| Cumple la reserva | Se aplica | Total |
|---|---|---|
| Las tres | EBB (primera del orden) | 700.000 × 0,88 = **616.000** |
| EBB no, Long Stay sí (y la promoción) | Long Stay | 700.000 × 0,85 = **595.000** |
| Solo la promoción | Promoción | **630.000** |
| Ninguna | Base | **700.000** |

Se aplica el 616.000 aunque Long Stay (15 %) descuente más: el orden del proveedor manda sobre el mayor porcentaje.

## R.3 Precedencia y acumulación son dos cosas distintas
- **Acumulación** (por par de alternativas): ¿pueden aplicarse juntas? Es una respuesta explícita, sí o no, guardada para cada par que coincide.
- **Precedencia**: un **orden total** entre las alternativas que coinciden, guardado explícitamente. **El orden jamás autoriza sumar descuentos**: dos alternativas solo se combinan si su par está marcado «acumulable».
- **EBB y Long Stay no se acumulan entre sí, nunca** (relación vigente: «un solo descuento, nunca se suman ni se encadenan»). Ese par queda fijo como no acumulable y no se puede marcar lo contrario. Solo se puede combinar la **promoción** con una regla, si el proveedor lo declara.
- Las promociones de **noches distintas** no están en conflicto entre sí (cada noche usa una sola tarifa).

## R.4 Algoritmo de cotización (determinista; sin decisiones implícitas)
1. Valorar cada noche (cobertura, base, promoción por noche; §N–§O) y aplicar la noche gratis si corresponde (§P). Si falta precio en alguna noche, la opción no se muestra (§O): esto ocurre antes de cualquier regla.
2. Reunir las **alternativas que sí cumplen** esta reserva: las promociones aplicadas en la estadía y las reglas EBB / Long Stay cuyo umbral se cumple. Las que no cumplen se descartan sin efecto.
3. Recorrerlas en el **orden configurado**. Se incluye la primera. Cada alternativa siguiente se incluye **solo si su par con cada una de las ya incluidas está marcado «acumulable»**; si choca con alguna incluida (par no acumulable), se descarta. Una alternativa descartada **no** bloquea a las siguientes.
4. Aplicar las incluidas con el orden aritmético de hoy: la promoción ya está en el precio de las noches y las reglas EBB / Long Stay descuentan sobre el total (neta hotelera, antes del markup; `descuentoHotel.ts`). Ninguna decisión nueva sobre el orden de cálculo.
5. Si ninguna alternativa de reglas cumple, se cobra lo valorado en el paso 1.
Requisito técnico (E7): para descartar la promoción y aplicar solo una regla, la composición debe poder entregar el neto **sin** la promoción (hoy guarda un solo neto por combinación; F.2 y Q.4).

## R.5 Ejemplo con acumulación parcial (comprueba que no hay decisiones implícitas)
Base 700.000; promoción 10 % (630.000), EBB 12 %, Long Stay 15 %. Configuración: **promoción–EBB acumulable**; **promoción–Long Stay no acumulable**; **EBB–Long Stay no acumulable** (fijo, R.3). Orden: EBB > Long Stay > promoción.

| Cumple la reserva | Recorrido (R.4) | Total |
|---|---|---|
| Promoción, EBB y Long Stay | EBB incluida; Long Stay choca con EBB (descartada); promoción es acumulable con EBB ⇒ incluida | 630.000 × 0,88 = **554.400** |
| Promoción y EBB | EBB; promoción acumulable con EBB | **554.400** |
| Promoción y Long Stay | Long Stay; promoción choca con Long Stay (descartada) | 700.000 × 0,85 = **595.000** |
| Solo promoción | promoción | **630.000** |
| Solo EBB / solo Long Stay | la regla | **616.000** / **595.000** |
| Ninguna | base | **700.000** |
Cada fila se resuelve con tres datos guardados: el sí/no de cada par y el orden. Ninguna depende del porcentaje, del importe ni de la fecha de creación.

## R.6 (CERRADA por §S.1) D9-c — alcance del orden
> **Aprobada la opción (i)** con las aclaraciones de §S.1. El texto de abajo se conserva como registro; la opción (ii) queda descartada.
¿Qué pasa en una reserva que cumple **EBB y Long Stay pero no la promoción**? Con el orden EBB > Long Stay > promoción configurado **en la promoción**:
- **(i)** El orden de una promoción se consulta **solo si esa promoción cumple** la reserva. Sin ella, rige la relación vigente (gana el mayor %): Long Stay, **595.000**. Ventaja: nada cambia para las reservas que no incluyen la promoción. Inconveniente: el cliente paga 616.000 si la promoción cumple y 595.000 si no.
- **(ii)** El orden entre EBB y Long Stay, una vez configurado, rige **en todo el hotel**: **616.000** siempre. Ventaja: coherente. Inconveniente: cambia el cálculo de reservas sin promoción, y exige que todas las promociones del hotel coincidan en ese orden.
**Recomendación: (i)** (el cambio queda acotado a las reservas donde esa promoción interviene, en línea con «no modificar lo existente»). **Hace falta confirmarla.** Mientras no se confirme, el diseño asume (i).

## R.7 Configuraciones que se rechazan
1. Orden que **no incluye todas** las alternativas que coinciden, que repite una, que incluye una que **no coincide**, o con empates.
2. Un par que coincide **sin** respuesta de acumulación.
3. EBB–Long Stay marcado como acumulable.
4. Todo conflicto **no resuelto**: ninguna promoción con una coincidencia nueva queda activa sin completar (Q.6).
5. **Contradicción entre promociones del hotel** *(AJUSTADA por §S.1: ya no se rechaza todo orden distinto; solo cuando las promociones pueden coincidir)*. Se rechaza el guardado que cree un ciclo entre las configuraciones de dos promociones que **pueden coincidir** en una reserva (por ejemplo, A con EBB > Long Stay y B con Long Stay > EBB, con ventanas de compra que se cruzan). Si **no** pueden coincidir, ambas se aceptan.
6. Aviso y exigencia de completar si una regla se añade, habilita o modifica (o cambian fechas o alcance de la promoción) y aparece una coincidencia nueva. Una regla desactivada o eliminada deja inertes sus entradas sin borrarlas; al reactivarla se vuelve a validar la configuración completa.
Lo ya autorizado sigue vendiéndose mientras la novedad queda retenida (Q.6). Las promociones existentes mantienen su comportamiento actual («heredada»).

## R.8 Casos de prueba previstos (reemplazan Q.7 4, 5, 8 y 9; ninguno implementado)
1. **Ejemplo aprobado (R.2):** 616.000, 595.000, 630.000 y 700.000; y el caso «Las tres» sin importar que Long Stay descuente más.
2. **Acumulación parcial (R.5):** todas las filas de la tabla, con 554.400 / 554.400 / 595.000 / 630.000 / 616.000 / 595.000 / 700.000.
3. El orden **no autoriza sumar**: con todos los pares no acumulables nunca se combinan dos descuentos aunque el orden los liste; con el par promoción–EBB acumulable y EBB–Long Stay fijo no acumulable, nunca hay dos reglas a la vez.
4. Una alternativa descartada por choque **no** bloquea a las siguientes (EBB descarta a Long Stay, pero la promoción acumulable con EBB entra).
5. La primera del orden no cumple ⇒ se evalúa la siguiente que sí (EBB con 20 de 60 días ⇒ Long Stay o la promoción).
6. Rechazos de R.7: orden incompleto, repetido, con alternativa que no coincide, par sin respuesta, EBB–Long Stay acumulable, ciclo entre dos promociones.
7. Coincidencia nueva por regla añadida, habilitada o modificada, o por cambio de fechas o alcance ⇒ aviso, promoción pendiente, lo autorizado sigue cotizando; sin regenerar.
8. Promoción existente ⇒ sin cambios ni importes distintos (golden E3: 264.000 frente a 330.000).
9. Reserva con EBB y Long Stay y sin promoción ⇒ **595.000** (mayor %; D9-c cerrada con la opción (i), §S.1).
10. Estadía con noches de dos promociones distintas y reglas: se recorre el orden fusionado de las configuraciones (sin ciclos); una alternativa descartada no bloquea a las otras.
11. Noche gratis + regla: la bonificación se calcula antes; la regla descuenta sobre el total ya liquidado si no choca.
12. Sin preguntas al cliente ni en la reserva; las respuestas se leen guardadas; paridad entre todos los recorridos.

## R.9 Qué se corrige en lo anterior
Q.1 punto 4, Q.4, Q.5 (casos 5 a 7) y la recomendación (A) del caso 6 quedan superados (R.1 y R.4); (A) queda retirada porque elegía primero el mayor % entre EBB y Long Stay, lo que contradice un orden configurado explícitamente. Q.6 sigue vigente: la retención de lo nuevo, la línea base «heredada» y la detección al guardar se mantienen; el estado «configurada» ahora significa acumulación **y** orden completos.
Pendiente: el motor (D9-c quedó cerrada en §S.1).

## R.10 (CERRADA por §S.2) D10 — descuento de monto fijo
Aprobada la elección explícita de la unidad; ver §S.2. Las propuestas de piso de cero y de niños/infantes se retiraron: ver §T.

---

# S. D9-c cerrada y D10 aprobada (2026-11-10)

Se separa lo **aprobado** (S.1, S.2) de lo que es **diseño derivado mío** (S.2 desde «Cómo se reparte» y S.4) y de las **propuestas aún no aprobadas** (S.3). El motor no se implementa.

## S.1 D9-c cerrada: alcance del orden configurado
**Aprobado**
- Cuando **solo aplican EBB y Long Stay**, se conserva **exactamente** la regla vigente: gana el mayor porcentaje y no se acumulan.
- El orden configurado con una promoción especial rige **cuando esa promoción también aplica a la reserva**.
- Ese orden **no se convierte en una prioridad global del hotel**.
- Dos promociones con órdenes diferentes **no se rechazan si no pueden coincidir**. Si pueden coincidir y hay contradicción, se **exige resolverla**.

**Ejemplo (base 700.000, EBB 12 %, Long Stay 15 %):** sin promoción especial aplicable gana Long Stay ⇒ **595.000** (700.000 × 0,85). Con promoción aplicable se resuelve según la acumulación y la precedencia configuradas para ese caso (R.2, R.5).

**Cuándo dos promociones «pueden coincidir» (definición derivada para la validación; a confirmar al construir el motor)**
Existe una reserva posible que tenga a ambas entre las alternativas que cumple. Se evalúa con cuatro condiciones, todas necesarias:
1. Sus **ventanas de compra** comparten al menos una fecha de reserva futura (o alguna no tiene ventana).
2. Sus **restricciones de régimen** son compatibles (ambas libres o el mismo régimen; una reserva es de un solo régimen).
3. Existe una **estadía** con una noche cubierta por cada una. El modelo vigente no limita el máximo de noches, así que esta condición sola no separa promociones con ventanas de viaje lejanas; si se fija un máximo, debe usarse aquí.
4. Ambas coinciden con las **mismas reglas** en juego y sus órdenes relativos difieren (si no comparten ninguna alternativa, no hay nada que contradecir).
- **Pueden coincidir y se contradicen** (por ejemplo, A: EBB > Long Stay y B: Long Stay > EBB, con compras que se cruzan) ⇒ la configuración queda **sin resolver**, retenida (Q.6), y se exige ajustar una de las dos.
- **No pueden coincidir** (compras que no se cruzan, o regímenes distintos) ⇒ ambas se aceptan con órdenes distintos.
- Efecto en R.7 punto 5 y en R.8 caso 9/10: la validación de ciclos mira solo pares de promociones que pueden coincidir. En una estadía con dos promociones que sí pueden coincidir y que no se contradicen, se recorre el orden fusionado (R.4).

## S.2 D10 aprobada: unidad del descuento de monto fijo
**Aprobado:** las promociones de monto fijo **eligen explícitamente** la unidad:
1. **Por persona y noche.**
2. **Por habitación y noche.**
3. **Por persona por estadía.**
- **Sin preselección** para promociones nuevas: no se guarda hasta elegir (formulario y servidor).
- **Promociones existentes:** conservan su cálculo actual. No se reinterpretan la etiqueta vigente «$ por pax» ni sus importes; la unidad queda **vacía = «unidad anterior»**, se muestra así y solo cambia si alguien la edita y elige una de las tres. No se recalculan históricos ni se regenera.

**Ejemplo aprobado:** base de habitación 800.000, 2 adultos, 3 noches, descuento 20.000.

| Unidad | Cálculo | Total |
|---|---|---|
| Persona / noche | 20.000 × 2 × 3 = 120.000 | **680.000** |
| Habitación / noche | 20.000 × 3 = 60.000 | **740.000** |
| Persona / estadía | 20.000 × 2 = 40.000 | **760.000** |

**Cómo se reparte el descuento por habitación sin duplicarlo (diseño derivado)**
- Se descuenta **una vez por habitación y noche**, sin importar cuántos pasajeros haya: el total es `D × noches × habitaciones`. Nunca se multiplica por el número de pasajeros.
- El reparto por persona es **solo de presentación**: `D / pax_tarifa` para cada ocupante que la acomodación tarifa (sencilla 1, doble 2, triple 3, múltiple 4). Con la doble del ejemplo son 10.000 por persona y noche.
- El cálculo se hace **sobre el total de la habitación**. *(Ejemplo de reparto corregido por §T.3: 20.000 entre tres = 6.666,67 + 6.666,67 + 6.666,66; tres partes de 6.666,67 sumarían 20.000,01.)*
- Niños e infantes **no generan una habitación adicional**, por lo que no reciben el descuento por habitación una segunda vez.
- Por eso no se materializa como una tarifa por persona fija en la fila publicada (el reparto depende de la acomodación): se resuelve en la cotización sobre el total de la habitación, igual que la noche gratis se resuelve a nivel de estadía.
- **Por persona y estadía** se resuelve también a nivel de estadía: un descuento por cada persona tarifada, una sola vez, anclado como la noche gratis (noche de entrada cubierta y `min_noches` de la promoción).
- Dos habitaciones ⇒ el descuento por habitación se aplica a cada una.

## S.3 (RETIRADA por §T) Propuestas sobre piso de cero y niños/infantes
> **Retiradas.** El dueño decidió otra cosa: si el descuento supera la tarifa, **no aplica** (se conserva la tarifa; no hay piso de cero ni arrastre) y **no hay selector** de adultos/niños (aplica a todo pasajero con tarifa). Ver §T.1 y §T.2. El texto se conserva como registro.
**Piso de cero sin arrastre.** *Propuesta.* El descuento nunca deja una unidad por debajo de 0 y lo que excede no se traslada a otra noche.
- Persona/noche: piso por cada persona y noche. Habitación/noche: piso por habitación y noche. Persona/estadía: piso sobre el total de la estadía de la persona.
- **Ejemplo breve:** una noche a 15.000 por persona y un descuento de 20.000 por persona y noche. (a) *Propuesta:* esa noche cuesta 0 y los 5.000 restantes se pierden. (b) Con arrastre: los 5.000 restantes se descuentan en otra noche. (c) Permitir un valor negativo: descartado.

**Aplicación a niños e infantes.** *Propuesta* (solo para las unidades por persona): recibe el descuento toda persona **con tarifa mayor que 0**, adulto o niño; **no** lo recibe quien está en 0 (infante, o niño gratis, que es válido), porque no hay nada que descontar.
- **Ejemplo breve:** 1 doble, 2 adultos a 100.000 por noche y 1 niño a 60.000 por noche, 3 noches, descuento de 20.000 por persona y noche. Sin descuento: 600.000 + 180.000 = 780.000. (a) *Propuesta (niño con tarifa incluido):* 780.000 − 3 × 3 × 20.000 = **600.000**. (b) Solo adultos: 780.000 − 2 × 3 × 20.000 = **660.000**. El infante en 0 sigue en 0 en ambas. En la unidad por habitación los niños no cambian el cálculo.
- Si no se aprueban, mientras tanto el diseño no los fija: queda marcado como pendiente.

## S.4 Casos de prueba previstos (se suman a N.4, O.4, P.4, Q.7 y R.8; ninguno implementado)
**D9-c**
1. EBB y Long Stay sin promoción aplicable ⇒ **595.000** (mayor %), idéntico al comportamiento actual; no se acumulan.
2. La misma reserva con la promoción aplicable y orden EBB > Long Stay > promoción (no acumulables) ⇒ 616.000; con la promoción fuera de su ventana de compra ⇒ 595.000.
3. El orden de una promoción no cambia el resultado de reservas que no la incluyen (golden de hoteles con reglas EBB / Long Stay).
4. Dos promociones con órdenes distintos y **ventanas de compra que no se cruzan** ⇒ ambas se aceptan; con **regímenes distintos** ⇒ se aceptan; con ventanas que se cruzan, mismo régimen y órdenes opuestos ⇒ se rechaza hasta resolverlo, nombrando ambas.
5. Dos promociones que pueden coincidir y no se contradicen ⇒ se aceptan y la estadía con ambas recorre el orden fusionado.
**D10**
6. Ejemplo aprobado: 680.000, 740.000 y 760.000 en cada unidad.
7. Sin unidad elegida: una promoción nueva de monto fijo se rechaza (formulario y servidor), con valor inválido también.
8. Promoción de monto fijo existente ⇒ unidad vacía, cálculo y etiqueta idénticos a los actuales; sin recalcular ni regenerar.
9. Por habitación: una doble, una triple (20.000 / 3, total exacto al final), un par de habitaciones (se descuenta por cada una), una sencilla; el descuento no se multiplica por pasajeros ni se aplica de nuevo a niños e infantes.
10. Por persona por estadía: descuento una sola vez por persona tarifada, sin importar las noches; ancla en la noche de entrada y respeta `min_noches`.
11. Combinaciones: una promoción de monto fijo con EBB / Long Stay según la acumulación y la precedencia configuradas (R.5); con noche gratis no aplica (tipos distintos).
12. Moneda del hotel: descuento en USD con TRM; el redondeo se hace una sola vez.
13. Paridad entre vista previa, tarifario, «Desde» (en unidades de estadía y habitación el «Desde» debe ser consistente con la cotización real), cotización por fechas, carrito y reserva.
14. *(Reemplazado por §T.6.)* Antes dependía de las propuestas de S.3, ya retiradas.

## S.5 Qué queda pendiente
- ~~Aprobar o ajustar las dos propuestas de S.3~~ — resueltas en sentido distinto por el dueño (§T).
- Siguientes decisiones de la lista: D11 («Desde» de la porción terrestre) y D12 (cómo se pasa una vigencia a grupos, cómo se reemplaza y cómo se borra).
- Correcciones manuales de datos (hoteles 9, 78 y 172; la del 53 está preparada en L.3).

---

# T. D10 final: el descuento no se aplica si supera la tarifa; sin selector de pasajeros; reparto exacto (2026-11-10)

Lo **aprobado** está en T.1 a T.3 (con los ejemplos del dueño). Las precisiones de aplicación a cada unidad (T.4) son **diseño derivado mío**. El motor no se implementa; no se tocan datos ni promociones existentes.

## T.1 Descuento superior a la tarifa — aprobado
- Si el importe a descontar **supera** la tarifa correspondiente, **ese descuento no aplica**: se conserva la tarifa original.
- **No** se reduce a cero, **no** se generan negativos y **no** se traslada ningún sobrante a otra noche, habitación o pasajero.
- Si descuento y tarifa son **iguales**, el resultado es **cero**.
- **La comparación respeta la unidad elegida y no mezcla unidades:**

| Unidad | Importe de comparación | El descuento aplica si… |
|---|---|---|
| Persona y noche | La tarifa de **esa persona en esa noche** | descuento ≤ esa tarifa; se evalúa noche por noche y persona por persona |
| Habitación y noche | La tarifa de **esa habitación en esa noche** (tarifa por persona × ocupantes que tarifa la acomodación) | descuento ≤ tarifa de la habitación esa noche; se evalúa por habitación y noche |
| Persona por estadía | El **total de la estadía de esa persona** (suma de sus noches) | descuento ≤ ese total; se evalúa por persona |
- La base de la comparación es la misma en que se resta el descuento (la tarifa sobre la que actúa la promoción); esta decisión no cambia esa base.
- Un descuento que no aplica deja vigente la tarifa de la base, igual que cualquier promoción que no aplica (§O.1): no es un error ni una noche no vendible.

## T.2 Pasajeros — aprobado
- **Sin selector** de adultos o niños: el descuento aplica a **todo pasajero que tenga tarifa** y cumpla la condición de T.1.
- Los pasajeros **gratuitos siguen en cero** (una tarifa 0 es menor que cualquier descuento positivo, así que no aplica; sigue 0).
- No cambian las reglas existentes de disponibilidad (sin tarifa, no se vende) ni de gratuidad (niño en 0, infante sin tarifa gratis).

## T.3 Ejemplos aprobados
**Descuento de 20.000 por persona y noche**

| Pasajero y noche | Tarifa | Resultado |
|---|---|---|
| Adulto | 100.000 | **80.000** |
| Niño | 60.000 | **40.000** |
| Niño | 15.000 | **15.000** (conserva; no aplica) |
| Tarifa igual al descuento | 20.000 | **0** |
| Tarifa gratuita | 0 | **0** (sigue gratis) |

**Descuento por habitación — se descuenta una sola vez por habitación y noche, no una vez por pasajero.** El reparto de presentación conserva exactamente el importe: **20.000 entre tres = 6.666,67 + 6.666,67 + 6.666,66** (suma 20.000,00).

**Cómo se reparte el residuo (diseño del reparto, determinista)**
1. Se expresa el descuento en la **unidad mínima de la moneda** (centavos, en el ejemplo: 2.000.000) y se divide entre los ocupantes: cociente `q` y residuo `r` (666.666 y 2).
2. Cada ocupante recibe `q`; los primeros `r` ocupantes, **en el orden fijo de la habitación** (ocupante 1, 2, 3…), reciben una unidad mínima más. Ejemplo: 666.667 + 666.667 + 666.666.
3. No se redondea cada parte por separado ni se redondea el total: la suma de las partes es siempre igual al descuento, sin diferencia.
4. «Precisión de la moneda»: centavos en el ejemplo aprobado; si una moneda opera en unidades enteras, el mismo método reparte el residuo en esa unidad.
5. Con varias habitaciones, cada una se reparte por separado y el total es la suma exacta (`D × noches × habitaciones`).
6. El reparto es **solo de presentación**: el total de la estadía sale del cálculo sobre la habitación y no depende del orden de los ocupantes.

## T.4 Cómo se aplican las tres unidades (diseño derivado)
- **Persona y noche:** para cada pasajero con tarifa y cada noche, si `D ≤ tarifa de la noche`, la noche cuesta `tarifa − D`; si no, queda en su tarifa. Cada noche se evalúa por separado (un niño a 15.000 conserva 15.000 en esa noche aunque otra noche sí reciba el descuento).
- **Habitación y noche:** para cada habitación y noche, si `D ≤ tarifa de la habitación esa noche`, se resta `D` una vez a la habitación; si no, queda igual. Niños e infantes se cotizan por cantidad, no por habitación (§S.2), por lo que no hay una segunda aplicación: la tarifa de comparación es la de la habitación (tarifa por persona × ocupantes que la acomodación tarifa).
- **Persona por estadía:** para cada pasajero con tarifa, si `D ≤ total de su estadía`, se resta `D` una sola vez; si no, no aplica. Aplica a nivel de estadía, anclada como la noche gratis (noche de entrada cubierta y noches mínimas de la promoción).
- **Descuento que no aplica y las demás reglas:** si una promoción de monto fijo no aplica a ninguna noche ni pasajero de la reserva, **no cuenta como alternativa que cumple** (R.4, paso 2) y por lo tanto no entra en la precedencia ni en la acumulación con EBB / Long Stay. Si aplica solo a parte de la reserva, cuenta como alternativa.
- **Promociones existentes** (unidad vacía = «unidad anterior»): no se tocan; ninguna de estas reglas las reinterpreta ni modifica datos.

## T.5 Qué se retira
- La propuesta de **piso de cero sin arrastre** (S.3): sustituida por «no aplica».
- La propuesta de **aplicación a niños e infantes** como selector (S.3): sustituida por «todo pasajero con tarifa».
- El caso de prueba S.4 n.º 14 (reemplazado por T.6).

## T.6 Casos de prueba previstos (se suman a S.4; ninguno implementado)
**Ejemplo aprobado (persona y noche, 20.000)**
1. Adulto 100.000 ⇒ 80.000; niño 60.000 ⇒ 40.000; niño 15.000 ⇒ 15.000; tarifa 20.000 ⇒ 0; tarifa 0 ⇒ 0.
2. Estadía donde algunas noches de un mismo niño aplican y otras no (noches de 60.000 y de 15.000) ⇒ cada noche por separado, sin trasladar sobrantes.
3. Descuento igual a la tarifa ⇒ 0; descuento menor ⇒ resta; descuento mayor ⇒ conserva la tarifa, sin negativos ni ceros forzados.
**Habitación y noche**
4. Doble, triple y múltiple con descuento menor, igual y mayor que la tarifa de la habitación esa noche.
5. **Reparto exacto:** 20.000 entre tres = 6.666,67 + 6.666,67 + 6.666,66, suma exactamente 20.000,00; 10.000,01 entre tres y 20.000 entre cuatro (5.000 cada uno) como variantes; mismo resultado en cada ejecución y orden de ocupantes fijo.
6. **Varias habitaciones:** dos dobles y una sencilla ⇒ se descuenta por cada habitación una vez por noche; el total es `D × noches × habitaciones`; una habitación cuya tarifa es menor que el descuento no lo recibe y las otras sí, sin trasladar el sobrante.
7. El descuento nunca se multiplica por pasajeros ni se vuelve a aplicar a niños o infantes de esa reserva.
**Persona por estadía**
8. Tarifa total de la estadía menor, igual y mayor que el descuento; el descuento se aplica una sola vez por persona, independientemente de las noches; ancla en la noche de entrada y respeta las noches mínimas.
9. Una persona cuya estadía total es menor que el descuento (p. ej. un niño muy barato) no lo recibe, y los adultos de la misma reserva sí.
**Comunes**
10. Ejemplo base 800.000, 2 adultos, 3 noches, 20.000: 680.000 / 740.000 / 760.000 (S.2).
11. Pasajeros gratuitos siguen en 0 en las tres unidades; sin tarifa, sigue sin venderse (no se confunde ausencia de tarifa con cero).
12. Sin selector: no existe ningún parámetro de adultos o niños en el formulario ni en el servidor de promociones de monto fijo.
13. Una promoción de monto fijo que no aplica a nada en la reserva no entra a la precedencia ni a la acumulación (R.4) y la reserva se cotiza como si no existiera.
14. La comparación no mezcla unidades: se prueba que un descuento «por habitación» no se compara con la tarifa de una persona ni con el total de la estadía, y viceversa.
15. Promociones existentes con unidad vacía: cálculo y etiqueta idénticos a los actuales.
16. Moneda: USD con centavos y COP en pesos, mismo método de residuo; paridad entre vista previa, tarifario, «Desde», cotización por fechas, carrito y reserva.

## T.7 Siguiente decisión comercial pendiente — D11: «Desde» de la porción terrestre
Ver la respuesta; el análisis completo está en F.5.

---

# U. D11 aprobada: «Desde» de la porción terrestre con grupos (2026-11-10)

Lo **aprobado** está en U.1 y U.2. Lo demás (U.3 a U.8) es **diseño derivado mío**. El motor no se implementa; no se regenera ni se modifica ninguna publicación existente.

## U.1 Decisión aprobada (solo hoteles que adopten grupos de días)
El «Desde» de una porción terrestre debe:
- Corresponder a la **estadía completa más económica realmente vendible** dentro de la ventana configurada, con **salida dentro de ella**.
- Respetar noches, acomodación, régimen, disponibilidad tarifaria, restricciones y promociones aplicables.
- **Mostrar** la cantidad de noches, el precio por persona y la **fecha de entrada** que produce ese precio.
- **No** usar «noche más barata × noches» si esa estadía no existe.
- **No anunciar un precio** cuando ninguna estadía completa sea vendible.
- **Conservar las fechas y la combinación** que justifican el importe, para reproducirlo al seleccionarlo.
- **Desempatar** precios iguales por la **fecha de entrada más temprana**.
- Calcularse **al generar el tarifario, no en cada visita**.
- Los hoteles sin grupos conservan su comportamiento; no se regenera ni se modifica ninguna publicación existente.

## U.2 Ejemplo aprobado
Ventana 4–10 de enero de 2027, estadía de 5 noches. Lunes–jueves 100.000; viernes–domingo 150.000 (por persona y noche).

| Entrada | Noches cobradas | Salida | Total | ¿Cabe en la ventana? |
|---|---|---|---|---|
| Lunes 4 | lun, mar, mié, jue, vie | sábado 9 | 4 × 100.000 + 150.000 = **550.000** | Sí |
| Martes 5 | mar, mié, jue, vie, sáb | domingo 10 | 3 × 100.000 + 2 × 150.000 = 600.000 | Sí |
| Miércoles 6 | … | lunes 11 | — | No (la salida queda fuera) |

Se muestra: **«Desde 550.000 por persona · 5 noches · Entrada 04/01/2027»**. **No** se muestra 500.000 (5 × 100.000), porque esa estadía no existe: toda estadía de 5 noches dentro de la ventana incluye al menos un día de fin de semana.

## U.3 Qué es una estadía candidata (diseño)
- Cada **fecha de entrada** `e` de la ventana tal que `e + N noches ≤ fin de la ventana` (la salida dentro de la ventana). Con ventana de `D` días y `N` noches hay `D − N` fechas candidatas.
- Cada candidata se valora **con las mismas reglas de la cotización real**, no con una fórmula aparte: cobertura del día y disponibilidad por noche (§N, §M), todas las noches con precio (§O), blackouts, compra vigente, régimen restringido, noches mínimas, promociones aplicables (§O, §P, §S, §T) y las reglas de Adults Only / niños / infantes vigentes.
- Se evalúa **por acomodación** (cada acomodación tiene su propia estadía más económica y su propia fecha de entrada); el titular de la tarjeta es el mínimo entre las acomodaciones publicadas de la fila, y conserva la fecha y la combinación de ese mínimo.
- **Sin estadía completa vendible** (ninguna candidata con todas sus noches vendibles): no se calcula precio, **no se anuncia «desde»** y la fila no se publica (igual que hoy una acomodación sin precio no se publica). Cómo se presenta la tarjeta sin precio es un detalle de pantalla, no una decisión comercial.
- **Empate** entre candidatas: gana la fecha de entrada más temprana.
- **EBB y Long Stay y el «Desde» — PENDIENTE de comprobar y decidir (no asumida):** hipótesis: el tarifario publicado guarda la tarifa base y esas reglas dependen de la fecha de compra, por lo que se aplican al cotizar (comportamiento vigente de #90). Se comprueba en el código y decide el dueño; ver el pendiente 7 de la especificación.

## U.4 Qué se conserva para reproducirlo (diseño; sin migración todavía)
Con el importe se guarda su **justificación**: fecha de entrada, fecha de salida, noches, categoría, régimen, acomodación y vigencia/grupo que lo producen. Al seleccionar la tarjeta, el cotizador recibe esa entrada y esa combinación precargadas y **recalcula en vivo**; el total debe coincidir con el «Desde» (prueba de paridad). Esto vuelve **verificable** la fila de porción, que hoy queda con `neto_hotel` nulo por «no verificable» (E.4). Dónde se guarda esa justificación (columnas o JSON en la procedencia) se decide con la migración de E4/E8.

## U.5 Cómo se calcula sin reventar el costo (diseño; las cifras son estimaciones, no mediciones)
- **No se afirma que sea gratis en CPU por no añadir solicitudes:** el cálculo corre en el servidor al generar el tarifario (tiempo de función de Vercel) y debe medirse.
- **Una pasada de precios por noche y ventana deslizante.** Para cada combinación (categoría × régimen × acomodación) se calcula **una vez** el precio de cada noche de la ventana (`D` noches) y luego la suma de cada tramo de `N` noches con una ventana deslizante. Las promociones por estadía (noche gratis, monto por persona/estadía) se ajustan sobre cada candidata usando ese vector, sin volver a resolver noches.
- **Orden de magnitud (estimado, no medido):** 12 combinaciones de categoría y régimen × 6 acomodaciones = 72 combinaciones; ventana de 90 días y `N = 5`: 85 candidatas por combinación. Con vector previo ≈ 72 × 90 = **6.480** resoluciones de noche (frente a ≈ 72 × 85 × 5 = **30.600** si cada candidata resolviera sus noches). Hoy `masBarato` hace una pasada sobre los `D` días por combinación; el cambio añade el recorrido de las candidatas y los ajustes por estadía.
- **Límites propuestos** (a fijar con medición): largo máximo de ventana considerado, número máximo de candidatas por combinación y **presupuesto de tiempo por hotel**. Si se excede, **falla cerrado**: no se publica un «desde» (nunca uno aproximado) y queda un registro con el motivo.
- **Medición:** por hotel y generación, registrar combinaciones, candidatas, noches resueltas, milisegundos y resultado (precio o «sin estadía vendible» o «excede presupuesto»), para comparar contra el cálculo actual antes de activar. Se hace en la generación ya existente (la regeneración en paralelo de los paquetes afectados y la ruta de publicación por lotes); no se añade ninguna llamada por visita.
- Solo se calcula para hoteles que **adopten grupos**; el resto sigue por el camino actual sin coste adicional.

## U.6 Qué no cambia
- Hoteles sin grupos: «noche más barata × noches» como hoy (incluido el 500.000 del ejemplo).
- Publicaciones ya existentes: no se regeneran ni se modifican; un hotel adopta el nuevo «Desde» solo cuando se regenera su tarifario con grupos ya activos.
- Bloqueo, empaquetado y salida dinámica (fecha fija): sin cambio (E.4).

## U.7 Casos de prueba previstos (ninguno implementado)
1. **Ejemplo aprobado:** ventana 4–10 ene, 5 noches ⇒ 550.000, entrada 04/01/2027, salida 09/01; entrada 05/01 = 600.000; la 06/01 queda fuera; **no** aparece 500.000.
2. Texto mostrado: «Desde 550.000 por persona · 5 noches · Entrada 04/01/2027».
3. **Empate:** dos entradas con el mismo total ⇒ gana la más temprana.
4. **Sin estadía vendible** (una noche sin precio en cada candidata, o blackout en todas): no se muestra «desde» y la fila no se publica; nunca un precio parcial.
5. Una candidata con una noche sin tarifa de la acomodación ⇒ se descarta; la siguiente vendible gana aunque sea más cara.
6. Noches mínimas del hotel o de la promoción mayores que `N`; compra vigente vencida; régimen restringido distinto al de la fila; blackouts parciales.
7. Promociones aplicables: promoción de la vigencia sobre alguna noche; noche gratis con su regla elegida; descuento fijo por persona/noche, habitación/noche y persona/estadía (incluido el caso «descuento mayor que la tarifa ⇒ no aplica»); la candidata más económica puede cambiar por esas reglas.
8. Una acomodación con entrada distinta a otra ⇒ cada una conserva su fecha; el titular es el mínimo y conserva la fecha y combinación de ese mínimo.
9. **Reproducción:** seleccionar la tarjeta lleva a la cotización con entrada, salida y combinación precargadas y el total en vivo = el «desde» publicado (paridad con cotización por fechas, carrito y reserva).
10. *(Condicionado al pendiente 7 de la especificación: comprobar y decidir.)* EBB / Long Stay no cambian el «desde» publicado; sí aparecen al cotizar.
11. Ventana de un tamaño igual a `N` (una sola candidata) y ventana menor que `N` (ninguna ⇒ sin «desde»).
12. Hotel **sin grupos**: el cálculo y el resultado actuales (500.000) no cambian; golden de las 27 pruebas de caracterización.
13. **Límites y medición:** ventana mayor que el máximo, excedido el presupuesto ⇒ falla cerrado con registro; el registro trae combinaciones, candidatas, noches resueltas y tiempo; la versión con vector previo da el mismo resultado que una evaluación candidata por candidata (equivalencia).
14. No se regenera ni se modifica ninguna publicación al desplegar; un hotel con grupos cambia solo al regenerar.
15. Moneda: USD con centavos y COP en pesos; redondeo una sola vez.

## U.8 Qué queda pendiente
Valores de los límites (ventana máxima, candidatas, presupuesto de tiempo) tras medir; dónde se guarda la justificación; cómo presenta la tarjeta una fila sin estadía vendible (pantalla).

## U.9 Siguiente decisión comercial pendiente — D12, en tres operaciones separadas
Reformula H6–H8 e I.3 después de las decisiones M, N, O y T. Se decide **cada operación por separado**. El principio común: el sistema no copia ni borra tarifas por sí solo, y un precio sin confirmar no se vende.

> **Resuelta por el dueño en §V.** Se conserva el texto como registro.

### U.9.A Activar grupos en una vigencia que ya tiene tarifas «todos los días»
*Ejemplo:* ALTA tiene doble a 120.000 todos los días; se crean los grupos «Semana» (lun–jue) y «Fin de semana» (vie–dom). Una vigencia no puede tener a la vez filas «todos los días» y filas por grupo (I.2), así que el cambio es de una sola vez.
- **(a) Eliminar y cargar por grupo.** Se listan las filas que se borran; esas noches **dejan de venderse** hasta cargar cada grupo (el historial conserva lo borrado).
- **(b) Proponer y confirmar fila por fila.** El diálogo muestra cada precio actual (120.000) como **sugerencia** para cada grupo; se confirma o se edita cada uno. Solo lo confirmado queda en venta; lo no confirmado queda sin precio (no se vende). Todo el cambio se activa **en una sola transacción**: hasta confirmar, la vigencia sigue vendiéndose como hoy.
- **(c) Cancelar:** los grupos no se guardan.
- ~~Copiar y vender de inmediato~~: retirada (M, M.2 punto 6).
- **Recomendación:** ofrecer (a) y (b) sin valor por defecto, con (c) siempre disponible; (b) es la que evita apagar ventas sin que nadie lo decida. Quitar los grupos (volver a «todos los días») sigue la misma lógica: elegir el precio de un grupo como «todos los días» de forma explícita o eliminar todo.

### U.9.B Reemplazar tarifas generadas (calculadora o carga masiva)
*Ejemplo:* el hotel tiene Semana 100.000 y Fin de semana 150.000; se pulsa «Reemplazar» con un lote que solo trae Semana.
- **(a) Agregar/actualizar** (el actual): solo cambia las claves que trae el lote; Fin de semana queda intacto.
- **(b) Reemplazar este grupo** (nuevo): borra solo las filas de Semana y las sustituye; Fin de semana, las demás vigencias y el resto no se tocan.
- **(c) Reemplazar todo el hotel** (el actual «reemplazar todas»): borra todos los grupos y sus tarifas (salvo vigencias protegidas) y deja **Fin de semana sin tarifa**, es decir, esas noches **dejan de venderse**.
- **Recomendación:** ofrecer (a) y (b) en la versión 1, cada una con su botón y su texto, y mantener (c) con su significado actual («todo el hotel»), pero con una confirmación reforzada que **nombre cada grupo y vigencia** que quedará sin tarifa, mostrando el efecto («estas noches dejan de venderse») y comparando con la foto mostrada (si cambió, se rechaza). No se vende lo que no se cargó.

### U.9.C Borrar un grupo que tiene tarifas
*Ejemplo:* «Fin de semana» tiene 12 tarifas y una promoción cargada para ese grupo.
- **(a) Bloquear siempre** mientras tenga tarifas o promociones.
- **(b) Permitir con confirmación** que enumera las 12 tarifas y la promoción, y avisa del efecto: **al borrar el grupo, sus días dejan de estar cubiertos por esa vigencia** (D13): se resolverá otra vigencia aplicable o la noche no se venderá.
- **Recomendación:** (b), con dos condiciones: la promoción que depende del grupo se **resuelve primero** (se borra o se mueve; si no, el grupo no se puede borrar) y el historial guarda todo lo borrado.

---

# V. D12 aprobada: activar, actualizar o reemplazar y borrar grupos (2026-11-10)

**Con esta sección terminan las decisiones D1–D13 de la lista; quedan los pendientes del §6 de la especificación. La especificación consolidada y el plan de entregas están en [`vigencias-por-dia-43-60-especificacion.md`](./vigencias-por-dia-43-60-especificacion.md); este historial no se reordena.** Corrige I.3, H6–H8 y U.9 donde difieran.

## V.1 A. Activar grupos — aprobado
- Las **tarifas actuales** de la vigencia aparecen como **propuesta editable** para cada grupo.
- **No se copia ni se vende automáticamente.** Hasta confirmar se conserva la configuración vigente.
- El cambio completo se **activa en una transacción**; se puede **cancelar sin cambios**.
- Para **volver a «todos los días»** hay que elegir y confirmar explícitamente qué tarifas se conservan.

## V.2 B. Actualizar o reemplazar — aprobado
Tres acciones **claramente diferenciadas**:
1. **Actualizar lo cargado** (solo las claves que trae el lote).
2. **Reemplazar un grupo concreto**, conservando los demás.
3. **Reemplazar todo el hotel**, manteniendo las protecciones existentes (vigencias con compra cerrada, promociones escritas a mano que hoy bloquean la operación).
Antes de reemplazar se muestra el **alcance exacto**: tarifas que cambian o desaparecen, grupos, vigencias y promociones afectadas. Se exige confirmación. **Si los datos cambiaron desde que se mostró esa revisión, no se ejecuta con una confirmación desactualizada** (el servidor recalcula el alcance y lo compara con una huella de lo que se mostró).

## V.3 C. Borrar grupos — aprobado
- Se muestran las **tarifas y promociones vinculadas**.
- Las promociones dependientes se **resuelven primero**: no se dejan referencias huérfanas ni se mueven automáticamente.
- Se exige confirmación y se **conserva el historial**.
- Se advierte que **sus días salen de la cobertura de esa vigencia**: podría aplicar otra vigencia o quedar sin venta, según D13.
- **No se afirma** que borrar el grupo siempre cierra las ventas.

## V.4 La confirmación
Debe **describir la operación y sus efectos** concretos (qué filas cambian o desaparecen, qué grupos, qué vigencias y promociones, qué noches quedan sin venta o pasan a otra vigencia). Un «¿estás seguro?» genérico no basta. Ejemplo de texto para «reemplazar un grupo»: «Se reemplazarán 12 tarifas del grupo Fin de semana de ALTA (3 categorías × 2 regímenes) y se conservarán las 12 del grupo Semana y las de BAJA. La promoción “Puente” depende de este grupo y quedará afectada. Las noches de viernes a domingo de ALTA seguirán vendiéndose solo con las tarifas del lote.»

## V.5 Efectos sobre lo anterior
- I.3: la opción «copiar y vender desde ya» queda retirada (ya lo estaba por M y U.9); el flujo de activación es la propuesta editable de V.1.
- H6, H7 y H8: cerradas con V.1 a V.3.
- U.9 conserva las alternativas como registro; manda V.
- La frase de confirmación escrita («REEMPLAZAR TODO EL HOTEL» más el nombre del hotel) de I.3 sigue siendo un diseño razonable para la tercera acción; lo aprobado exige confirmación que describa los efectos, sin fijar esa frase.

## V.6 Casos de prueba previstos (ninguno implementado)
1. Activar: propuesta con las tarifas actuales editable por grupo; sin confirmar, la vigencia sigue vendiendo exactamente igual; confirmar crea todo en una sola transacción; un fallo a mitad no deja nada a medias; cancelar no cambia nada.
2. Activar sin confirmar un precio de un grupo ⇒ ese grupo queda sin tarifa (no se vende), sin copiar nada.
3. Volver a «todos los días»: exige elegir qué tarifas conservar; sin elegir, no se ejecuta.
4. Actualizar: solo cambia las claves del lote; los demás grupos, intactos.
5. Reemplazar un grupo: conserva los demás grupos y vigencias; el alcance mostrado coincide con lo ejecutado.
6. Reemplazar todo el hotel: respeta las protecciones vigentes; el alcance lista grupos, vigencias y promociones; los datos cambiaron tras la revisión ⇒ **rechazado** con la confirmación obsoleta.
7. Borrar un grupo: lista tarifas y promociones; con una promoción dependiente ⇒ no se puede borrar hasta resolverla; no se mueve ni se deja huérfana ninguna promoción; historial conserva lo borrado.
8. Borrar: la advertencia de cobertura aparece; con otra vigencia aplicable o sin ella el texto no afirma que se cierren ventas.
9. La confirmación incluye los datos concretos de la operación (no el texto genérico).
10. Ninguna operación se reintenta sola; una confirmación obsoleta pide recargar.
11. Hotel sin grupos y hotel de modelo por unidad: sin cambios ni controles de grupos.

---

# W. N4 aprobada: empates de prioridad (2026-11-10)

Lo **aprobado** está en W.1 y W.2. La definición de «pueden competir» (W.3) y las pruebas (W.4) son **diseño derivado mío**. Se resume en la especificación (§3.7). El motor no se implementa.

## W.1 Decisión aprobada
- Detectar vigencias con **igual prioridad** que **puedan competir** por la misma noche, categoría, régimen y acomodación.
- **Mostrar** cuáles se cruzan, sus prioridades y las fechas afectadas.
- **Exigir resolver** el empate **antes de activar** la configuración afectada.
- **No elegir** por precio, orden de lectura, fecha de creación ni última edición.
- **No considerar conflicto** dos vigencias que **no puedan competir realmente**.
- Si un conflicto sin resolver **llega al cotizador**: **no se muestra esa opción** para la estadía y se **registra el motivo interno**.
- **Solo vigencias con grupos.** No se modifican los hoteles existentes sin grupos.

**Ejemplo aprobado:** misma noche y combinación; A, prioridad 2, tarifa 100.000; B, prioridad 2, tarifa 150.000. Se avisa **«Empate de prioridad entre A y B»** y se exige corregir la configuración. No se selecciona ninguna automáticamente.

## W.2 Alcance (aprobado) y su lectura (derivada)
- **«Solo vigencias con grupos» se lee así:** el control aplica cuando **al menos una** de las vigencias empatadas tiene grupos. Dos vigencias **sin grupos** empatadas en un hotel (aunque el hotel tenga otras vigencias con grupos) quedan **como hoy** (decide el orden de lectura; control 3 del diagnóstico, informativo). Un hotel sin ningún grupo no se toca.
- **Resolver el empate** es una acción del usuario: cambiar la prioridad de una de las dos, acotar fechas, días de grupo, régimen restringido o la ventana de compra para que no compitan. El sistema nunca lo resuelve por sí solo.

## W.3 Cuándo dos vigencias «pueden competir realmente» (derivado; a confirmar al construir)
Hay conflicto solo si **todas** estas condiciones se cumplen:
1. **Misma prioridad** y al menos una con grupos (W.2).
2. Comparten **al menos una noche futura** (desde hoy en Bogotá): dentro de sus fechas de viaje, fuera de blackouts y en un **día de la semana cubierto por ambas** (los días de sus grupos; una vigencia sin grupos cubre los siete días).
3. Sus **ventanas de compra** comparten al menos una fecha de reserva posible (o alguna no tiene ventana).
4. Sus **restricciones de régimen** son compatibles (ambas libres o el mismo régimen).
5. Ambas aportan **precio para la misma categoría, régimen y acomodación** esa noche (si una no tiene fila de precio para la combinación, no compite: la otra gana sin empate).
6. Las dos son del tipo que **aporta precio a la noche** (tarifa de base o de reemplazo). Una promoción porcentual o de monto fijo con la misma prioridad que su propia base **sí** se considera un empate, porque el motor hoy lo decide por orden de lectura.
- **El resultado se reporta por conflicto**: las dos vigencias (nombre e id), sus prioridades, las combinaciones (categoría, régimen, acomodación) y los **rangos de fechas y días** afectados; se agrupa para que un mismo empate no se liste noche por noche.
- Si todas las condiciones se cumplen **solo en el pasado**, no es un conflicto.

## W.4 Cuándo se verifica y qué pasa (diseño)
1. **Al activar o guardar** una configuración que involucra vigencias con grupos (activar grupos, crear o editar vigencias, cambiar prioridad, fechas, días de un grupo, régimen o compra, agregar tarifas): se calcula el conflicto; si existe, **se rechaza el guardado o la activación** y se muestra el aviso «Empate de prioridad entre A y B» con el detalle. No se guarda hasta corregir. Así lo ya activo nunca queda en empate por una edición normal.
2. **Datos ya empatados** al intentar activar grupos (p. ej. dos vigencias con la misma prioridad que ya existen): la activación se rechaza hasta resolverlo.
3. **Cotizador (defensa en profundidad):** si aparece un conflicto sin resolver (datos escritos por otra vía, o fechas que cambian el cruce), **no se muestra esa opción para la estadía**, se registra el motivo interno (hotel, vigencias, combinación, fechas) y no se elige ninguna vigencia. El registro se **deduplica** para no inundarse. Las otras acomodaciones o noches sin conflicto no se ven afectadas, y una estadía con una noche en conflicto no se ofrece (estadía completa, O.1).
4. Un detector **puro** (sin lecturas) compartido por la validación y el motor.

## W.5 Casos de prueba previstos (ninguno implementado)
1. **Ejemplo aprobado:** A (prioridad 2, 100.000) y B (prioridad 2, 150.000), misma noche y combinación ⇒ «Empate de prioridad entre A y B»; no se elige ninguna; en el cotizador la opción no se muestra y queda registrado el motivo; con orden de lectura A,B y B,A el resultado es el mismo (sin precio).
2. **Prioridades distintas:** gana la mayor, sin conflicto (comportamiento vigente).
3. **No compiten:** fechas que no se cruzan; días de grupo disjuntos (Semana frente a Fin de semana); compras que no se cruzan; regímenes distintos; una sin precio para la combinación; el cruce solo en fechas pasadas ⇒ sin conflicto.
4. **Compiten solo en una combinación** (p. ej. doble sí, sencilla no) ⇒ el conflicto se reporta solo para esa combinación; la otra se vende normal.
5. **Reporte:** indica ambas vigencias, prioridades, combinaciones y rangos de fechas y días; un empate de 60 noches se agrupa en un rango.
6. **Resolver:** cambiar la prioridad, acotar fechas, días o régimen elimina el conflicto y permite activar.
7. **Rechazo al guardar y activar:** crear el empate al editar prioridad, fechas o días ⇒ no se guarda; activar grupos con vigencias ya empatadas ⇒ no se activa.
8. **Alcance:** dos vigencias sin grupos empatadas ⇒ sin cambios (decide el orden de lectura, como hoy); una con grupos y otra sin ⇒ conflicto; un hotel sin grupos ⇒ nada cambia (golden E3 sin cambios).
9. **Cotizador:** empate llegado por otra vía ⇒ opción no mostrada y motivo registrado; mil cotizaciones con el mismo conflicto ⇒ un solo registro deduplicado; sin solicitudes extra.
10. **No elegir por criterio automático:** el resultado no cambia al invertir el orden de lectura, el precio, la fecha de creación o de última edición de las vigencias.
11. Una estadía que cruza una noche en conflicto no se ofrece (no hay estadía parcial).
12. Una promoción y su base con la misma prioridad ⇒ empate reportado.

## W.6 (CERRADA por §X) Siguiente decisión comercial pendiente — N1
Una promoción vinculada a una base que no ganó esa noche. **Aprobada el 2026-11-11: ver §X.**

---

# X. N1 aprobada: primero la base de la noche, luego su promoción (2026-11-11)

Lo **aprobado** está en X.1 y X.2. X.3 es **derivado mío** (se confirma con ejemplos al construir). Se resume en la especificación (§4.1). Esta ronda es solo documentación: el motor no se implementa.

## X.1 Decisión aprobada
- Para cada noche se resuelve **primero la base aplicable**.
- Una promoción **vinculada a esa base** puede aplicar si cumple sus condiciones.
- Una promoción de **otra base no desplaza** a la ganadora, aunque tenga mayor prioridad numérica.
- Para descontar otra base debe existir **una promoción vinculada a ella**.
- Se conservan la **disponibilidad por acomodación** y la validación de **todas las noches** de la estadía.
- La regla nueva aplica **solo al alcance con grupos**; los hoteles existentes sin grupos no cambian.

## X.2 Ejemplo aprobado
ALTA: prioridad 1, tarifa 100.000. PUENTE: prioridad 3, noches 10–12 ene, 200.000. PROMO-ALTA: prioridad 4, vinculada a ALTA, 90.000. Entrada 9 ene, salida 13 (noches 9, 10, 11, 12):

| Noche | Base ganadora | ¿PROMO-ALTA aplica? | Importe |
|---|---|---|---|
| 9 | ALTA | Sí (vinculada a ALTA) | 90.000 |
| 10 | PUENTE | No (vinculada a otra base) | 200.000 |
| 11 | PUENTE | No | 200.000 |
| 12 | PUENTE | No | 200.000 |
| **Total** | | | **690.000** |

No se cobra 360.000 (PROMO-ALTA en las cuatro noches, que es lo que hace hoy el motor: E.2 caso 2). En un hotel **sin grupos**, los mismos datos siguen dando 360.000: lo fija la prueba de caracterización vigente (`pruebas/vigenciasPrecedencia43.caracterizacion.test.ts`) y no debe cambiar.

## X.3 Lectura derivada (a confirmar al construir; no son decisiones del dueño)
1. **Alcance con grupos:** la regla aplica a una noche cuando **al menos una** de estas tiene grupos: la promoción, su base vinculada o la base ganadora de la noche (mismo criterio que W.2). Si ninguna tiene grupos, comportamiento actual.
2. **Dos pasos separados:** las promociones no participan en la elección de la base; la base se elige con cobertura del día (§3.1 de la especificación), fechas, compra, régimen, prioridad y disponibilidad (§3.2). Si la base ganadora cubre la noche pero no tiene tarifa para la acomodación, la acomodación no se vende y ninguna promoción la rescata (ni la de esa base ni la de otra).
3. **Prioridad de la promoción frente a su propia base:** mayor ⇒ aplica (como hoy); igual ⇒ empate N4 (W.3.6, sin cambio); menor ⇒ no aplica y se avisa al guardar (hoy ya perdería por prioridad: no cambia el resultado, solo se hace visible).
4. **Varias promociones de la misma base la misma noche:** gana la de mayor prioridad; con igual prioridad, empate N4. La acumulación con EBB / Long Stay sigue §R/§S sin cambio.
5. **Promoción sin vínculo** (filas manuales antiguas sin `temporada_base`) dentro del alcance con grupos: no aplica sobre una base con grupos; la activación de grupos (V.1) la lista entre las promociones afectadas para que el usuario la vincule o la retire. Fuera de ese alcance, sin cambio.
6. **Grupo base:** con grupos, «vinculada a esa base» incluye el grupo: la regla de la promoción para el grupo Semana de ALTA solo actúa en noches donde gana ALTA **y** el día cae en Semana (C.1/D.7 sin cambio).
7. **Noche gratis:** se resuelve a nivel de estadía (§P); cómo se cruza su vínculo con la base de cada noche se verifica al construir, sin decidir nada nuevo aquí.
8. **Calculadoras:** las filas que generan Dubai y Mixta ya llevan `temporada_base`; el motor pasa a consultarlo (hoy es solo auditoría, §E.1) únicamente en el alcance con grupos.

## X.4 Casos de prueba previstos (se suman a W.5; ninguno implementado)
1. **Ejemplo aprobado** con grupos (ALTA o PUENTE con grupos) ⇒ 690.000; la noche 9 lleva PROMO-ALTA y las 10–12, PUENTE.
2. **Mismos datos sin grupos** ⇒ 360.000 (caracterización E3 intacta).
3. **Promoción vinculada a PUENTE** (−10 %) ⇒ noches 10–12 = 180.000; total 90.000 + 3 × 180.000 = 630.000.
4. **Invariancia de prioridad:** subir PROMO-ALTA a prioridad 9 no cambia el 690.000.
5. **Disponibilidad:** PUENTE cubre la noche sin tarifa doble ⇒ doble no se vende esa noche; PROMO-ALTA no la rescata; la estadía no se ofrece en doble; sencilla con tarifa sí.
6. **Promoción que no cumple condiciones** (fuera de compra, otro régimen, grupo sin regla) en noche de su base ⇒ se cobra la base.
7. **Prioridad frente a su base:** igual ⇒ empate N4 reportado; menor ⇒ no aplica y aviso al guardar.
8. **Dos promociones de la misma base:** prioridades distintas ⇒ la mayor; iguales ⇒ empate N4.
9. **Promoción sin vínculo** en el alcance con grupos ⇒ no aplica; la activación de grupos la lista.
10. **Grupo:** promoción de ALTA con regla solo para Semana; noche de fin de semana donde gana ALTA ⇒ base.
11. **Orden de lectura:** invertir el orden de vigencias y filas no cambia el resultado.
12. **Paridad de recorridos:** vista previa de calculadora, generación, «Desde», cotización por fechas, carrito y reserva dan el mismo importe; 0 solicitudes extra en el cotizador (§9 de la especificación).

## X.5 Dependencias que cambian
- Especificación §6, pendiente 2: queda solo **H10**.
- Entrega 4 (promociones) incluye la regla N1 sin condición; sigue dependiendo de las entregas 2 y 3b y de H10.
- La entrega 2 (motor por noche) debe dejar la elección de la base separada de las promociones, para que la entrega 4 añada la regla sin reescribir el resolver.

## X.6 (CERRADA por §Y) Siguiente decisión comercial pendiente — H10: promoción solo en algunos días de un grupo
> **Superada por §Y.** El dueño aprobó (a) y además extendió la restricción a la noche gratis y al descuento por persona/estadía. Dos puntos de la recomendación de abajo **ya no rigen**: «sin elegir días = todo el grupo» (no hay selección vacía con significado implícito: se elige «Todos los días» o «Elegir días») y «en la v1 solo promociones por noche».
**Pregunta:** ¿una promoción puede aplicarse solo a **algunos días** de un grupo base, y no a todo el grupo?

**Ejemplo** (por persona y noche, Estándar, PAM). Base: Semana (lun–jue) 100.000; Fin de semana (vie–dom) 150.000. PROMO-SEMANA −10 % sobre Semana, **solo lunes, martes y miércoles**. Entrada lunes, salida sábado (lun, mar, mié, jue, vie):

| Opción | Lun | Mar | Mié | Jue | Vie | Total |
|---|---|---|---|---|---|---|
| Sin promoción | 100.000 | 100.000 | 100.000 | 100.000 | 150.000 | 550.000 |
| **(a) Días sueltos dentro del grupo** | 90.000 | 90.000 | 90.000 | 100.000 | 150.000 | **520.000** |
| (b) Solo grupo completo: dividir la base en Lun–Mié y Jue | 90.000 | 90.000 | 90.000 | 100.000 | 150.000 | 520.000, pero duplicando las tarifas de Semana en dos grupos |
| (c) Solo grupo completo, sin dividir | 90.000 | 90.000 | 90.000 | 90.000 | 150.000 | 510.000 (descuenta el jueves, que el proveedor no promociona) |

**Recomendación: (a)**, con estas reglas:
1. Los días de la promoción son un **subconjunto** de los días de su grupo base; sin elegir días = todo el grupo.
2. Un día **fuera** del grupo base se rechaza al guardar (p. ej. viernes en la regla de Semana: va en la regla de Fin de semana, que puede tener sus propios días, como −5 % solo sábado).
3. Los días no elegidos se cobran a la base del grupo; la promoción no crea disponibilidad.
4. Con N1: solo actúa en noches donde su base es la ganadora.
5. En la v1, solo para promociones **por noche** (porcentaje, monto fijo por persona/noche o habitación/noche, tarifa promocional). Noche gratis y monto por persona/estadía se resuelven a nivel de estadía y quedan sin restricción por días en la v1.

Por qué: es lo que pide #60, evita duplicar tarifas y grupos de la base solo para una promoción (b) y no descuenta días que el proveedor no promociona (c).

**Casos de prueba previstos si se aprueba (ninguno implementado):** ejemplo 520.000; sin días elegidos = todo el grupo (510.000); viernes en la regla de Semana ⇒ rechazado al guardar; Fin de semana −5 % solo sábado; día no elegido sin tarifa en la base ⇒ no se vende; combinación con N1 (noche donde gana otra base ⇒ base); promoción existente sin días ⇒ idéntica; noche gratis con días ⇒ rechazada en la v1. *(Reemplazados por Y.4.)*

---

# Y. H10 aprobada: restricción por días en las promociones (2026-11-11)

Lo **aprobado** está en Y.1 y Y.2. Y.3 es **derivado mío**. Se resume en la especificación (§4.2). Solo documentación: el motor no se implementa.

## Y.1 Decisiones aprobadas
**1. Descuentos por noche** (porcentaje; monto fijo por persona/noche o habitación/noche)
- Se ofrece «Todos los días del grupo» o «Elegir días».
- Los días elegidos deben pertenecer al grupo base.
- Las noches no elegidas conservan su base.

**2. Noche gratis**
- Se ofrece «Todos los días» o seleccionar los días permitidos para bonificar.
- «Más barata» o «más cara»: se elige entre las noches de la estadía que estén permitidas.
- «Última»: se comprueba la última noche real de la estadía; si su día no está permitido, la promoción **no aplica**. No se sustituye por otra noche.
- Si ninguna noche es elegible, no aplica.
- Se conserva el mínimo de noches y se bonifica exactamente una.

**3. Descuento por persona y estadía**
- La restricción de días se refiere al **día de entrada**.
- Se ofrece «Todos los días» o «Elegir días de entrada».
- Si cumple, se descuenta **una sola vez por persona**, nunca por cada noche coincidente.

**Reglas comunes**
- No hay selección vacía con significado implícito.
- Se conservan disponibilidad por noche, estadía completa, base primero (§X) y las reglas de acumulación y precedencia aprobadas (§Q–§S).
- Se conserva la regla del monto fijo: si supera el importe de su unidad, no aplica; si es igual, queda en cero (§T).
- Las promociones existentes no cambian automáticamente.

## Y.2 Ejemplos aprobados
**Por noche.** Semana lun–jue 100.000; Fin de semana vie–dom 150.000; −10 % solo lun–mié. Entrada lunes, salida sábado:
90.000 + 90.000 + 90.000 + 100.000 + 150.000 = **520.000**.

**Noche gratis.** Jueves 100.000, viernes 150.000, sábado 150.000; salida domingo (sin promoción 400.000). Días permitidos lun–jue:

| Regla | Noche bonificada | Total |
|---|---|---|
| Más barata | Jueves (la única permitida) | **300.000** |
| Más cara | Jueves (la única permitida) | 300.000 *(consecuencia de la regla, no ejemplo del dueño)* |
| Última | Sábado no permitido ⇒ no aplica | **400.000** |

**Persona y estadía.** Una persona, entrada lunes, salida sábado, base 550.000; descuento 20.000 con entradas lun–mié ⇒ **530.000** (una vez, no 5 × 20.000). Entrada jueves ⇒ sin ese descuento.

## Y.3 Lectura derivada (a confirmar con ejemplos al construir)
1. **Por regla de grupo:** cada regla por grupo de una misma promoción tiene su propia elección (p. ej. Semana «Elegir días: lun–mié», Fin de semana «Todos los días del grupo»).
2. **Noche gratis:** el mínimo de noches cuenta **todas** las noches de la estadía, no solo las permitidas; «más barata/más cara» compara el importe ya resuelto de cada noche permitida (base o promoción por noche, según §X); con importes iguales el total no cambia y para presentar se toma la primera del calendario.
3. **Días de noche gratis y de entrada:** pueden ser cualquiera de los siete; no se atan a un grupo, porque actúan sobre la estadía.
4. **Existentes:** una promoción existente se lee como «Todos los días» (por noche) o sin restricción (noche gratis y persona/estadía), sin recalcular; sigue el promedio heredado de la noche gratis (§P) y la «unidad anterior» del monto fijo (§S.2).
5. **Guardado:** «Elegir días» sin ningún día ⇒ rechazo con el motivo; un día fuera del grupo base en un descuento por noche ⇒ rechazo indicando a qué grupo pertenece.

## Y.4 Casos de prueba previstos (reemplazan los de X.6; ninguno implementado)
1. Por noche: ejemplo aprobado ⇒ 520.000.
2. Por noche «Todos los días del grupo» ⇒ 90.000 × 4 + 150.000 = 510.000.
3. Por noche con viernes en la regla de Semana ⇒ rechazado al guardar.
4. «Elegir días» sin días (cualquiera de los tres tipos) ⇒ rechazado al guardar.
5. Por noche, monto fijo habitación/noche con días elegidos: solo las noches elegidas; si el monto supera la tarifa de la habitación esa noche, no aplica; si es igual, cero.
6. Día elegido cuya base no tiene tarifa para la acomodación ⇒ no se vende (la promoción no crea disponibilidad).
7. Día elegido en noche donde gana otra base ⇒ se cobra esa base (§X).
8. Noche gratis más barata ⇒ 300.000; más cara ⇒ 300.000; última ⇒ 400.000 (ejemplo aprobado).
9. Noche gratis con «Todos los días»: más barata ⇒ 300.000; más cara ⇒ 250.000; última ⇒ 250.000 (§P sin cambio).
10. Noche gratis sin ninguna noche permitida en la estadía ⇒ no aplica.
11. Noche gratis: estadía por debajo del mínimo de noches ⇒ no aplica aunque haya noche permitida; nunca se bonifican dos.
12. Persona/estadía: entrada lunes ⇒ 530.000; entrada jueves ⇒ 550.000; dos personas con entrada lunes ⇒ 20.000 cada una, una vez.
13. Persona/estadía con descuento mayor que el total de la estadía de la persona ⇒ no aplica; igual ⇒ cero.
14. Acumulación con EBB / Long Stay: la promoción con días solo entra entre las alternativas cuando cumple sus días (R.4); si no los cumple, rige la regla vigente (S.1).
15. Promociones existentes ⇒ resultados idénticos (golden E3 y P.4 sin cambio).
16. Paridad de recorridos (calculadora, generación, «Desde», cotización por fechas, carrito, reserva).

## Y.5 Pendientes comerciales que aún bloquean implementar
Con N1, N4 y H10 cerradas, las entregas 1 a 4 ya **no** tienen decisiones comerciales pendientes (la entrega 1 sí necesita coordinar el número de migración, §8). Quedan tres, que bloquean las entregas 5 y 6:

**P3 — Cómo se retiene lo nuevo sin tocar lo autorizado (bloquea la entrega 5).**
Ejemplo: PROMO-JULIO está configurada como acumulable con EBB y se vende. Alguien amplía sus fechas y ahora también coincide con Long Stay, par que nadie ha configurado. Opciones: (a) la versión ya autorizada sigue vendiéndose igual y el cambio queda «pendiente de configurar» hasta responder el par nuevo; (b) se bloquea toda la promoción hasta responder; (c) se guarda y se asume una respuesta.
**Recomendación: (a), el mecanismo de §Q.6:** promoción nueva con pares sin configurar = borrador, fuera del tarifario; promoción existente editada = cambio pendiente y sigue la versión autorizada; regla EBB / Long Stay nueva o modificada = retenida, y siguen las promociones y la versión previa de la regla; listado «por configurar» por hotel; la publicación rechaza pares pendientes y el cotizador falla cerrado. (c) contradice lo aprobado (no suponer respuestas) y (b) quita de la venta algo que ya estaba autorizado.

**P4 — Estadía máxima (bloquea las entregas 5 y 6).**
Ejemplo: PROMO-ENERO (viaje en enero) y PROMO-MARZO (viaje en marzo), con compras que se cruzan y órdenes contradictorios con EBB. Sin máximo, una estadía del 20 de enero al 5 de marzo las contiene a las dos, así que el sistema exigiría resolver esa contradicción. Con un máximo de, por ejemplo, 30 noches, no pueden coincidir y no se pregunta nada. El máximo también acota cuántas estadías candidatas calcula el «Desde» (U.5).
**Recomendación:** que el dueño fije **un número máximo de noches** para hoteles con grupos (el valor es suyo; 30 es solo ilustrativo). Las estadías más largas se siguen vendiendo, pero si en una de ellas coincide un par de promociones sin configurar, esa opción no se muestra y queda registrado el motivo (falla cerrado, como §Q.6.5). Alternativa: no vender estadías más largas que el máximo en hoteles con grupos (más simple, pero cierra ventas).

**P7 — EBB / Long Stay en el «Desde» (bloquea la entrega 6).**
Comprobado: hoy la generación del tarifario no aplica EBB ni Long Stay; solo lo hace la cotización por fechas, y la vitrina muestra su etiqueta junto a ese precio, nunca junto al «desde». Ejemplo: «Desde 550.000 por persona · 5 noches · Entrada 04/01/2027»; con EBB 12 % por compra anticipada daría 484.000. Opciones: (a) mantener el «Desde» sin EBB / Long Stay (como hoy); (b) mostrar aparte «con reserva anticipada desde 484.000»; (c) incluirlos en el «Desde».
**Recomendación: (a).** El EBB depende de la fecha de compra y el «Desde» se calcula al generar, no por visita (U.1): incluirlo o mostrarlo aparte daría un precio que cambia con el día y deja de ser reproducible. El precio con EBB ya se ve al cotizar por fechas.

**No bloquean la implementación** (no se vuelven a preguntar como decisión comercial): datos de los hoteles 9, 78 y 172 (solo impiden que *esos* hoteles adopten grupos; se corrigen a mano, sin inferir); hotel 53 (scripts preparados, ejecución del dueño); «festivo» como tipo de día (confirmar «no en la v1»); interpretación de la fecha de compra en la validación ya implementada (L.2).

> **Y.5 cerrada por §Z** (P3, P4 y P7 decididos). En P4 el dueño eligió **rechazar** las estadías de más de 30 noches en el alcance definido, no la variante «vender y fallar cerrado».

---

# Z. P3, P4 y P7 aprobadas + plan del primer incremento (2026-11-11)

Lo **aprobado** está en Z.1. Z.2 define el alcance de P4 tal como lo pidió el dueño (explícito, sin extender por inferencia). Z.3 es **derivado mío**. Se resume en la especificación (§3.8 y §5). Solo documentación: nada implementado.

## Z.1 Decisiones aprobadas
**P3 — Cambios pendientes de activar**
- La versión autorizada sigue vendiéndose mientras se configura un cambio.
- Si el cambio introduce una combinación de promociones sin resolver, se guarda como **pendiente de activar**.
- Se muestra qué acumulación o prioridad falta configurar.
- La nueva versión se activa solo después de completar y confirmar.
- Cancelar deja intacta la versión vigente.
- Una promoción nueva sin configuración completa no se publica.
- **Ejemplo:** promoción del 1 al 15 de julio, ya autorizada. Ampliarla al 31 introduce una combinación con Long Stay sin configurar. Mientras se resuelve, sigue vigente del 1 al 15; tras configurar y confirmar, entra la versión del 1 al 31.

**P4 — Estadía máxima**
- Máximo **30 noches**; la salida no cuenta como noche.
- Las solicitudes de más de 30 se **rechazan** con mensaje claro en el formulario y en el servidor; no se recortan.
- Los conflictos entre promociones que puedan coincidir en una estadía válida de hasta 30 noches se detectan y resuelven; no se ignoran por estar dentro del límite.
- No se modifican contratos ni cotizaciones históricas.
- El alcance se define explícitamente (Z.2); no se extiende a otros módulos por inferencia.

**P7 — «Desde»**
- Se conserva sin EBB ni Long Stay, como hoy.
- Esos descuentos se verifican y aplican al cotizar.
- La base publicada debe poder reproducirse; el precio final puede bajar por descuentos aplicables.
- No se eliminan descuentos válidos para forzar igualdad con el «Desde».

## Z.2 Alcance de la estadía máxima (P4)
- **Aplica a:** estadías elegidas por fechas en un hotel **con grupos de días**: cotización por fechas (vitrina, tarjeta y buscador), carrito y Reservar porción/dinámico por fechas — en el formulario y en la acción del servidor —; la detección de coincidencias entre promociones (§S.1) y de empates (§W) de esos hoteles, evaluada sobre estadías de hasta 30 noches; las estadías candidatas del «Desde» de porción de esos hoteles.
- **No aplica a:** hoteles sin grupos (siguen sin límite, como hoy); fechas fijas de bloqueos, empaquetados y salidas; programas, servicios, cotización manual y modelo por unidad; contratos y cotizaciones ya creados.
- **Ejemplos:** entrada 1 de marzo, salida 31 de marzo = 30 noches ⇒ válida; salida 1 de abril = 31 ⇒ rechazada con «La estadía máxima es de 30 noches; elegiste 31. Ajusta las fechas.» El mismo hotel sin grupos acepta las 31, como hoy.
- **Queda abierto (pendiente 8 de la especificación):** un bloqueo, empaquetado o salida cuyo record dé más de 30 noches, o una porción configurada con más de 30, en un hotel con grupos. No es una solicitud por fechas, así que §Z.1 no lo resuelve y no se infiere. Solo afecta a ese caso en las entregas 2 y 6.

## Z.3 Lectura derivada (a confirmar al construir)
1. El mecanismo de P3 vale igual para una regla EBB / Long Stay nueva o modificada que cree pares sin configurar: queda pendiente de activar y siguen vigentes su versión previa y las promociones (es el caso «regla» de §Q.6.3).
2. La publicación del tarifario solo usa versiones activas y rechaza publicar una versión pendiente; el cotizador solo lee versiones activas. Una versión pendiente no se cotiza.
3. Al activar, la nueva versión reemplaza a la anterior en una transacción, con historial; si los datos cambiaron desde la revisión, la activación se rechaza (mismo criterio de huella que §V.2).
4. El «Desde» de P7 se calcula con la base y las promociones aplicables (§U.1) y nunca con EBB / Long Stay; la tarjeta puede seguir mostrando, al cotizar por fechas, el precio con descuento y su etiqueta, como hoy.
5. El límite de 30 noches se valida antes de resolver noches (no cuesta lecturas).

## Z.4 Casos de prueba previstos (ninguno implementado)
**P3:** 1) ejemplo aprobado: mientras está pendiente, una estadía del 20 de julio no lleva la promoción y una del 10 sí; tras confirmar, ambas. 2) Cancelar ⇒ versión 1–15 intacta. 3) Promoción nueva incompleta ⇒ no aparece en tarifario ni cotización. 4) El aviso nombra el par exacto (promoción, Long Stay) y lo que falta. 5) Activar sin completar ⇒ rechazado. 6) Activación con datos cambiados desde la revisión ⇒ rechazada. 7) Regla EBB modificada con par nuevo ⇒ pendiente, la versión previa sigue. 8) Promociones existentes sin coincidencias nuevas ⇒ sin cambios.
**P4:** 9) 30 noches ⇒ válida; 31 ⇒ rechazada en formulario y en servidor, con el mensaje; nunca se recorta a 30. 10) Hotel sin grupos con 31 noches ⇒ igual que hoy. 11) Llamada directa a la acción del servidor con 31 noches en hotel con grupos ⇒ rechazada. 12) Dos promociones que solo coinciden en una estadía de 31 noches o más ⇒ no son conflicto; si coinciden en una de 30 o menos ⇒ conflicto que exige resolver. 13) Contratos y cotizaciones previos con más de 30 noches ⇒ intactos y consultables. 14) Bloqueo, empaquetado o salida de fecha fija ⇒ sin el límite (hasta decidir el pendiente 8). 15) «Desde»: no genera candidatas de más de 30 noches.
**P7:** 16) «Desde 550.000» se publica sin EBB; al cotizar con EBB 12 % la misma estadía da 484.000 y muestra la etiqueta. 17) Regenerar el «Desde» con los mismos datos da el mismo valor aunque cambie el día (EBB no interviene). 18) El precio cotizado más bajo que el «Desde» por EBB válido se respeta; no se quita el descuento.

## Z.5 Plan del primer incremento implementable (no implementado; requiere autorización)
**Incremento 1 = entrega 1: esquema de grupos, aditivo y sin uso.** Nada lo lee todavía, así que **ningún hotel cambia de precio** y no hay regeneración ni publicación. Todo lo que fija ya está decidido (§2 de la especificación).

**Contenido**
1. **Migración** (número sin asignar; ver «Prerequisitos»):
   - Tabla de grupos por vigencia: `id uuid` (identidad estable), `temporada_id bigint` → `hotel_temporadas(id)` `on delete restrict`, `nombre`, `dias smallint[]` (valores 1–7, sin repetir, entre 1 y 7 días), fechas de creación y edición.
   - `tarifa_hotel.grupo_id uuid null` → grupos `on delete restrict`. Nulo = «todos los días» (todo el dato actual queda así).
   - Triggers de integridad: sin solape de días entre grupos de una misma vigencia (con bloqueo de la vigencia para escrituras concurrentes); una vigencia no mezcla filas «todos los días» y filas por grupo; la fila con `grupo_id` pertenece al mismo hotel y su `temporada` coincide con el nombre de la vigencia del grupo; solo tiene grupos una vigencia cuyo nombre no se repite en el hotel (también al renombrar o crear vigencias); un hotel de modelo por unidad no puede tener grupos.
   - Índice único parcial `(hotel_id, categoria, regimen, temporada, grupo_id) where grupo_id is not null`; el legado no se toca.
   - RLS y permisos alineados a `ESCRITURA.producto` (los mismos roles que escriben tarifas); lectura igual que `tarifa_hotel`; `anon` igual que `tarifa_hotel`.
   - Trigger de auditoría (087) adjuntado a la tabla nueva. El historial de tarifas (203) guarda la fila completa en `jsonb`, así que `grupo_id` viaja sin cambios (verificado al leer la 203; se prueba igual).
2. **Preflight** de una sola consulta con columna de estado: la tabla y la columna no existen; conteo informativo de vigencias con nombre repetido y de hoteles de modelo por unidad (los que no podrán tener grupos). **Postcheck** de una sola consulta y **rollback** probado en Docker.
3. **`types/database.ts`**: tipos de la tabla y de `grupo_id`, sin uso en el código.
4. **Pruebas** (`supabase/scripts/test_grupos_43_60.sh`, Postgres en Docker): solape rechazado; mezcla rechazada; nombre de vigencia repetido rechazado; hotel por unidad rechazado; consistencia de nombre y hotel; FK `restrict` al borrar grupo o vigencia con tarifas; índice parcial; historial con `grupo_id`; RLS por rol (escritura y lectura) y `anon`. Además: golden E3 y caracterización sin cambios, `tsc`, ESLint y `npm run build`.
5. **Hoja técnica:** sección del esquema en `docs/tecnico/tarifas-hotel.md`.
6. **Orden en producción:** preflight → migración → postcheck → recién después el código (solo tipos).

**Fuera del incremento:** motor, límite de 30 noches, UI, calculadoras, RPC de operaciones, promociones, acumulación y «Desde».

**Prerequisitos (no son ambigüedades comerciales)**
- **Número de migración:** `origin/main` llega a la 283 (falta la 282; comprobado el 2026-11-11). Las ramas remotas de #75 llegan a la 287; el último registro dice que #75 usa hasta la 291 y #97 la 286 y la 290 en trabajo sin publicar. No se reserva nada: al escribir la migración se vuelve a comprobar en esta rama, en `origin/main` y en #75/#97, y se confirma con el dueño.
- **Autorización** para implementar y, después, para ejecutar preflight, migración y postcheck.
- La entrega 0 sigue pendiente de staging del dueño; cómo se empaquetan las dos en PR se decide con él.

**Ambigüedades que bloquean el incremento 1:** ninguna comercial. El pendiente 8 (más de 30 noches fijadas por el producto) no lo afecta.

> **Z.2 queda superada por §AA.2:** el dueño hizo global el límite de 30 noches (todos los tipos de paquete). El pendiente 8 queda cerrado.

---

# AA. Incremento 1 implementado en local + límite global de 30 noches (2026-11-11)

## AA.1 Incremento 1: qué se hizo (local, sin aplicar en ningún entorno)
Autorización del dueño: **solo** el esquema aditivo de grupos y los tipos, sin conectarlo al motor, con los grupos inactivos y su activación bloqueada.

**Archivos**
- `supabase/migrations/20260601000293_vigencia_grupos_dias_inactivos.sql` (número **provisional**; ver §8 de la especificación).
- `supabase/scripts/preflight_293_vigencia_grupos_dias.sql` y `postcheck_293_vigencia_grupos_dias.sql`: una sola consulta de lectura cada uno, con `control · observado · esperado · estado`. El preflight da la **huella** de todas las filas de `tarifa_hotel`; el postcheck la recalcula sin las columnas nuevas y debe ser **idéntica** (prueba de que no cambió ningún precio ni dato).
- `supabase/scripts/rollback_293_vigencia_grupos_dias.sql`: separado y **protegido**: aborta sin tocar nada si existe cualquier grupo o cualquier tarifa con grupo; no toca el historial.
- `supabase/scripts/fixture_293_*.sql`, `test_293_*.sql` y `test_293_*.sh`: pruebas en Postgres local desechable.
- `types/database.ts`: `tarifa_hotel.grupo_id`/`grupo_dias` y la tabla `hotel_temporada_grupos` (sin uso en el código).

**Qué garantiza la base**
- **Inactividad:** `hotel_temporada_grupos.activo` tiene un `CHECK (not activo)`; una tarifa solo puede apuntar a un grupo **activo**. Resultado: hoy ninguna tarifa puede tener grupo, así que el motor actual (que no conoce grupos) nunca leerá una tarifa por grupo como «todos los días». No basta con que la app no los lea: la base lo impide incluso por SQL o por la API. Activar exigirá una migración que quite ese `CHECK` cuando el motor (entrega 2) los soporte.
- **Consistencia:** días 1–7 sin repetir (se guardan ordenados) y entre 1 y 7; sin solape de días entre grupos de una vigencia; un grupo no cambia de vigencia; nombre de grupo único en su vigencia (sin distinguir mayúsculas); solo tiene grupos una vigencia de nombre único en su hotel (también al crear o renombrar vigencias); una vigencia con grupos no cambia de hotel; un hotel por unidad no admite grupos y un hotel con grupos no pasa a unidad; la tarifa con grupo pertenece al mismo hotel y vigencia del grupo; una vigencia no mezcla tarifas «todos los días» y por grupo; `grupo_dias` lo fija el trigger desde el grupo.
- **Concurrencia:** las decisiones «¿tiene grupos?» se serializan por hotel con un candado consultivo (compartido para las escrituras de tarifas sin grupo, exclusivo para lo que crea o cambia grupos) y se releen bajo el candado.
- **Borrado protegido:** FK `on delete restrict` de tarifa → grupo y de grupo → vigencia. Efecto conocido: una vigencia (o un hotel, por la cascada) con grupos no se puede borrar hasta quitarlos; sin grupos, nada cambia.
- **Índice único solo para filas con grupo** (`hotel, categoría, régimen, vigencia, grupo`); los duplicados históricos no se tocan ni se corrigen.
- **Historial:** la 203 guarda la fila completa (`to_jsonb(old)`), así que cada versión de una tarifa conserva su `grupo_id` y su copia de `grupo_dias`. Si cambian los días de un grupo, cada tarifa enlazada recibe la copia nueva y la versión anterior queda en el historial con los días que tenía. Los grupos además quedan en la auditoría general (087).
- **Permisos:** iguales a `tarifa_hotel`: lectura y escritura para superadmin, gerencia, administración y operaciones; escritura del catálogo global solo en sesión Mayorista (políticas restrictivas); `venta` no ve nada; `anon` sin privilegios; las funciones internas no son invocables por `authenticated` ni `anon`.

**Verificación ejecutada (2026-11-11)**
- Postgres local (imagen de Supabase 15.8, contenedor propio con una copia de la plantilla local completa): flujo preflight (9 controles en OK) → 293 → postcheck (11 en OK, huella idéntica, mismo número de filas) → reaplicar (idempotente) → **66 aserciones**: compatibilidad sin grupos (A1–A11), inactividad (B1–B8), controles de grupos (C1–C12), vigencias y hoteles (D1–D9), activación **simulada y deshecha** para probar los controles futuros (E1–E12), permisos por rol (F1–F11) y la RPC real de generación de tarifas, agregar y reemplazar todo (G1–G3) → rollback abortado con grupos (sin tocar nada) → rollback sin grupos → huella igual → reaplicar → postcheck en OK.
- `tsc --noEmit` sin errores; ESLint de `types/database.ts` sin avisos; `next build` correcto (con el `root` de Turbopack ampliado temporalmente por la unión de `node_modules`, ya revertido); 78 pruebas de #43 (caracterización y validación de fechas) en verde.

**Limitaciones**
- La plantilla local trae también las migraciones 284–292 de #75/#97 (ninguna toca tablas de hoteles; comprobado) y se construyó entera como `supabase_admin`: la 293 y las pruebas corrieron con ese mismo dueño. En Supabase corre como `postgres`, dueño allí de las tablas; el preflight comprueba los prerrequisitos, pero el primer entorno real es el que lo confirma.
- No se corrió la suite completa `test:unit` (en Windows tiene fallos previos conocidos); sí `tsc` y el build, que cubren los usos del tipo.
- Nada se midió en Vercel ni en producción.

## AA.2 Límite global de 30 noches — decisión del dueño
- Máximo **30 noches** para **todos** los tipos de paquete: bloqueo, empaquetado, dinámico, porción terrestre y programas. No se limita a hoteles con grupos ni a búsquedas por fechas.
- Un **único valor de dominio** con nombre claro; sin dispersar el número 30 ni crear un panel de configuración.
- Validación en el **servidor** y en los **formularios** correspondientes; sin recortar fechas.
- Entrada y salida con 30 noches de diferencia se permiten; 31 se rechaza.
- Contratos y cotizaciones históricos se siguen consultando; no se modifican ni se invalidan retroactivamente.
- No confundir duración del viaje con anticipación de compra, vigencia comercial ni umbrales de EBB.
- Se implementa en una **entrega separada (L)**; el incremento 1 no se amplía.

## AA.3 Puntos de validación y archivos afectados (entrega L, NO implementada)
**Lo que ya existe y hay que unificar (comprobado en el código):**
- `lib/reservar/edadesMenores.ts`: `MAX_NOCHES_CONSULTA = 60` y `validarRangoFechasConsulta`, la regla única de las consultas por fechas (`cotizarPorFechas`, `buscarHoteles`, `buscarReceptivos` en `lib/reservar/cotizar.ts`; `lib/tarifario/entradaTarjeta.ts`; `app/tarifario/busquedaUnidadActions.ts`). Hoy permite **60** noches.
- `lib/programas/estanciaHotel88.ts`: `MAX_NOCHES_ADICIONALES = 30` (noches **adicionales** de un programa, no su duración total), usado en `reservarPrograma`, `ProgramaReservaForm.tsx` y `VistaPreviaEstancia.tsx`.

**Constante única propuesta:** un módulo puro de dominio (p. ej. `lib/reglas/duracionViaje.ts`) con `MAX_NOCHES_VIAJE = 30`, una función `validarNochesViaje(noches)` y el mensaje («La estadía máxima es de 30 noches; elegiste 31. Ajusta las fechas.»). `MAX_NOCHES_CONSULTA` pasa a ser ese valor (o se elimina en su favor) y el programa valida su **total** (noches del programa + adicionales).

**Servidor** (la frontera autoritativa):
| Tipo | Punto | Archivo |
|---|---|---|
| Consultas por fechas (porción, dinámico, tarjeta, buscador, unidad) | `validarRangoFechasConsulta` (único) | `lib/reservar/edadesMenores.ts` |
| Reserva desde el tarifario (bloqueo, empaquetado, dinámico, porción) | `reservarDesdeTarifarioInterno`, `convertirCotizacionCarrito` | `app/(dashboard)/dashboard/reservar/actions.ts` |
| Carrito y solicitudes del portal | `crearSolicitudReserva`, `crearComparativaCarrito`, validador de ítems (`o.noches` ≤ `MAX_NOCHES_CONSULTA`) | `app/tarifario/checkout/actions.ts`, `lib/reservar/edadesMenores.ts` |
| Porción terrestre (noches del paquete) | `crearPaquete`, `actualizarPaquete` | `app/(dashboard)/dashboard/paquetes/actions.ts` |
| Salidas dinámicas | `crearSalidaDinamica`, `actualizarSalidaDinamica` | `app/(dashboard)/dashboard/paquetes/actions.ts` |
| Bloqueos (ida y regreso del record) | `crearBloqueo`, `actualizarBloqueo`, `cargarBloqueosMasivo` | `app/(dashboard)/dashboard/vuelos/actions.ts` |
| Empaquetados | `crearEmpaquetado`, `actualizarEmpaquetado` | `app/(dashboard)/dashboard/vuelos/empaquetados-actions.ts` |
| Programas (montaje y salidas) | guardar programa y `guardarSalidas` | `app/(dashboard)/dashboard/producto/programas/actions.ts` |
| Programas (reserva: total con noches adicionales) | `reservarPrograma` | `app/(dashboard)/dashboard/reservar/actions.ts`, `lib/programas/estanciaHotel88.ts` |

**Formularios** (mismo valor, solo para avisar antes de enviar): `ReservaForm.tsx`, `SelectorPorFechas`, `BuscadorBooking.tsx`, `TarjetaHotelFechas.tsx` y el checkout del carrito (`app/tarifario/*`); configuración del paquete (noches de porción) y de salidas dinámicas; `EditarBloqueoForm.tsx`, alta y carga masiva de bloqueos; formularios de empaquetados; editor del programa y `ProgramaReservaForm.tsx`.

**Fuera de la entrega L:** la vigencia de compra, la anticipación (EBB) y las noches mínimas de Long Stay y de las promociones conservan sus reglas; ninguna se reinterpreta como duración del viaje.

## AA.4 Puntos de alcance a confirmar antes de implementar la entrega L (no bloquean el incremento 1)
1. **Receptivos.** `buscarReceptivos` usa hoy el mismo validador que los hoteles (60 noches). No es un tipo de paquete. Ejemplo: un traslado consultado para un viaje del 1 de marzo al 5 de abril (35 noches). Recomendación: aplicar el mismo límite, porque esas fechas son las del viaje; la alternativa es separar el validador y dejar los receptivos en 60.
2. **Cotización y contrato manuales** (dinámico armado a mano). Se venden como `dinamico`, pero no son un producto del catálogo. Ejemplo: cotización manual de 40 noches en un crucero + hotel. Recomendación: aplicar el límite a lo **nuevo** (son paquetes dinámicos) y dejar intactos los existentes; confirmar.
3. **Productos ya configurados con más de 30 noches** (bloqueos, empaquetados, salidas, porciones o programas activos). No son contratos ni cotizaciones, así que AA.2 no dice qué pasa con ellos. Recomendación: antes de implementar, una consulta de solo lectura que los cuente; si hay 0, no hay nada que decidir. Si hay alguno, el dueño decide si se dejan de ofrecer o se corrigen a mano (nunca automáticamente).

## AA.5 Pruebas previstas de la entrega L (ninguna implementada)
1. 30 noches ⇒ aceptado; 31 ⇒ rechazado en el servidor con el mensaje, sin recortar, en cada punto de AA.3.
2. Llamada directa a cada acción del servidor con 31 noches ⇒ rechazada (no depende del formulario).
3. Formularios: con 31 noches muestran el aviso y no envían; con 30 envían.
4. Programa: noches del programa + adicionales = 31 ⇒ rechazado; = 30 ⇒ aceptado.
5. Bloqueo, empaquetado y salida dinámica con ida y regreso a 31 noches ⇒ no se guardan; carga masiva lista la fila rechazada.
6. Contratos y cotizaciones previos de más de 30 noches ⇒ se consultan, imprimen y editan como hoy; nada los invalida.
7. EBB, Long Stay, vigencia de compra y noches mínimas ⇒ resultados idénticos (no se confunden con la duración).
8. Una sola definición: prueba de cableado que falla si el número 30 (o 60) de duración vuelve a aparecer fuera de la constante.

## AA.6 Revisión focalizada del incremento 1: concurrencia (2026-11-11)
**Hallazgo (confirmado).** En `tg_hotel_temporada_grupos_validar`, el hotel y el nombre de la vigencia se leían **antes** de cualquier candado; el `FOR UPDATE` posterior no refrescaba esas variables. Si otra transacción renombraba la vigencia o la cambiaba de hotel mientras se creaba el grupo, el grupo se validaba con datos viejos.

**Reproducción con dos sesiones reales** (`supabase/scripts/test_293_concurrencia.sh`): la sesión A abre una transacción, hace su cambio y espera 3 s antes de confirmar; la sesión B arranca 1 s después; una tercera sesión comprueba en `pg_stat_activity` que B quedó **esperando un candado**. Con la versión anterior (md5 `a5888eab51fd`):
- **R1:** A renombra ALTA a «BAJA» (ya existente); B crea un grupo en esa vigencia ⇒ **pasó**: grupo en una vigencia de nombre repetido.
- **R2:** A cambia la vigencia a un hotel por unidad (permitido sin grupos); B crea un grupo ⇒ **pasó**: grupo en un hotel por unidad.
- Invariantes finales: 1 grupo en vigencia de nombre repetido y 1 en hotel por unidad.

**Corrección** (sin reintentos): un orden de candados único en todos los caminos — **fila del grupo → fila de la vigencia → candado consultivo del hotel → fila del hotel**. El trigger de grupos bloquea la vigencia (`FOR UPDATE`) **y en esa misma lectura** obtiene su hotel y su nombre: si hay un renombre o cambio de hotel en curso, espera y lee la versión confirmada; mientras viva su transacción, nadie puede cambiarlos. El trigger de tarifas con grupo sigue el mismo orden (grupo `FOR SHARE` → vigencia `FOR SHARE` → candado del hotel) y lee el nombre y el hotel de la vigencia bajo su candado. La inactividad obligatoria no cambia.

**Carreras con la versión corregida (las 9 pasan; invariantes en 0):**
| # | Sesión A (primero) | Sesión B (compite) | Resultado de B |
|---|---|---|---|
| R1 | renombra la vigencia a un nombre repetido | crea un grupo en ella | espera; rechazada: nombre repetido |
| R2 | mueve la vigencia a un hotel por unidad | crea un grupo en ella | espera; rechazada: modelo por unidad |
| R3 | cambia el hotel a modelo por unidad | crea un grupo | espera; rechazada: modelo por unidad |
| R4 | crea un grupo | cambia el hotel a unidad | espera; rechazada: el hotel tiene grupos |
| R5 | crea «Fin de semana» (vie–dom) | crea «Sábado y domingo» (sáb–dom) | espera; rechazada: comparte días |
| R6 | crea «Fin de semana» (vie–dom) | crea «Semana» (lun–jue) | espera y **pasa** (sin falso bloqueo) |
| R7 | crea un grupo en ALTA | renombra otra vigencia a «ALTA» | espera; rechazada: nombre con grupos |
| R8 | crea un grupo | mueve la vigencia a otro hotel | espera; rechazada: no se puede mover |
| R9 | renombra otra vigencia a «ALTA» | crea un grupo en ALTA | espera; rechazada: nombre repetido |

**Plantilla equivalente a Producción.** Se construyó desde cero (`preparar_esquema_local.sh`) con las migraciones de esta rama **hasta la 283** más **284, 285 y 287** tomadas de `origin/claude/75-reuso-dtm` (md5 idéntico a las aplicadas por el dueño), **sin la 286 ni la 288–292**: 194 tablas, sin `materializar_comision_b2b` ni las obligaciones de la 288. Ajustes de **entorno** (no del esquema): la imagen local no trae `storage.buckets.file_size_limit`/`allowed_mime_types` (los usa la 281) y se añadieron; se cerraron las sesiones de fondo `pg_net`/`pg_cron` para copiar la base; la imagen trae el `auth.uid()` antiguo (solo lee `request.jwt.claim.sub`), así que la prueba fija también esa clave además de `request.jwt.claims`.

**Resultados en esa plantilla, sobre bases nuevas:** preflight (9 en OK) → 293 → postcheck (11 en OK, huella idéntica) → reaplicar → 66 aserciones → rollback abortado con grupos → rollback sin grupos (huella igual) → reaplicar → postcheck en OK; y las 9 carreras con invariantes en 0. La versión anterior reproduce allí los mismos dos fallos (R1, R2). Se repitió todo también en la plantilla hasta 292: mismos resultados. No se repitió el build (solo cambiaron SQL y pruebas).

**Estado tras la auditoría (2026-11-11):** el dueño aprobó el incremento 1 como esquema inactivo. Se conserva esta versión (md5 `6cf9e0991f7c`). Coordinación del 293 en la especificación §8: libre en todas las ramas y worktrees, reconocida por #75 («la 293 es de #43/#60», toma la 294); falta solo la confirmación explícita del dueño.

---

# AB. Alcance del incremento 2: motor por noche (PRESENTADO, sin implementar — 2026-11-11)

## AB.1 Qué entra y qué no
**Entra** (especificación §3.1–§3.7, sin decisiones nuevas):
1. **Cobertura del día** (§3.1): un día de la semana que ningún grupo de la vigencia cubre deja esa vigencia fuera para esa noche; se resuelve la siguiente vigencia aplicable.
2. **Disponibilidad por acomodación** (§3.2): si un grupo cubre la noche pero no tiene tarifa para la acomodación, esa acomodación **no se vende** esa noche; no se baja a otra vigencia ni a otro grupo.
3. **Estadía completa** (§3.3): ya es así en `liquidarHotelNoches` (una noche sin precio ⇒ `null`); se conserva y se prueba con grupos.
4. **Ceros** (§3.4): sin cambios de semántica (habitación 0 = no aplica; niño 0 gratis, nulo no se vende; infante sin tarifa gratis).
5. **Empates (N4, §3.7)**: módulo **puro** que detecta, para una noche y combinación, dos vigencias con la misma prioridad que aportan precio, con al menos una con grupos ⇒ la noche no tiene precio y se devuelve el **motivo**; el registro interno se deduplica en memoria. El mismo módulo lo usará la entrega 3 al guardar y activar.
6. **Helper único del mapa de netos**: hoy cinco sitios arman `netoPorTemporada` a mano; pasan a una sola función, con claves `nombre` (todos los días) y `nombre + grupo` (por grupo). Conserva **exactamente** «la última fila gana» para los duplicados legados.
7. **Regla de edad tolerante** (`reglaEdadTarifa.ts`): varias filas de la misma vigencia (una por grupo) se aceptan si su regla de edad efectiva coincide; si difieren, sigue siendo error. `condicionesTarifa.ts` ya deduplica.
8. **Lectura de grupos sin solicitudes nuevas** (AB.4).

**No entra:**
- **Límite global de 30 noches** (entrega L, separada): el incremento 2 no toca `MAX_NOCHES_CONSULTA` ni ningún validador de duración; tampoco receptivos ni cotización/contrato manuales.
- **Promociones por grupo, N1 y H10** (entrega 4): en el incremento 2 los grupos solo se honran en vigencias de tipo `tarifa`; una promoción sigue resolviéndose como hoy. La entrega 3 debe rechazar activar grupos en vigencias de promoción hasta la entrega 4 [D].
- **«Desde» por estadía real** (entrega 6): mientras no exista, `liquidarHotelMasBarato` (porción publicada) **falla cerrado** para una combinación cuya noche más barata dependa de una vigencia con grupos activos: no publica un «desde» aproximado [D]. Hoteles sin grupos, igual que hoy.
- **Quitar el candado de inactividad de la 293:** no. Con grupos inactivos, el motor nuevo solo lo ejercitan las pruebas; en producción, para todos los hoteles, el resultado es idéntico al actual. Activar sigue requiriendo las entregas 3 y 3b y una migración propia.
- Modelo por unidad (`busquedaUnidadActions.ts`, `tarifasUnidadActions.ts`), programas y alojamiento Bernalo, calculadoras (3b), operaciones de grupos (3).

## AB.2 Diseño del cálculo por noche (derivado de la especificación)
- `TemporadaRango` gana `grupos?: { id: string; dias: number[] }[]`, con **solo los grupos activos** (`toTemporadaRango` filtra `activo`). Sin grupos activos, la vigencia se comporta exactamente como hoy.
- `resolverNetoNocheDetallado`, por orden de prioridad: si la vigencia tiene grupos, se busca el grupo que cubre el día de la semana de esa noche (lunes = 1 … domingo = 7, calculado sobre la **fecha de calendario** de la noche, no sobre la hora del servidor); sin grupo ⇒ se salta la vigencia (§3.1); con grupo ⇒ se usa la clave `nombre + grupo`; si no hay neto para la acomodación ⇒ **la noche no se vende** y se devuelve el motivo (§3.2), sin seguir bajando.
- Antes de devolver la ganadora se consulta el detector de empates (AB.1.5).
- El resultado agrega `grupoGanador` (trazabilidad); `temporadaGanadora` sigue siendo el **nombre de la vigencia**, para que edad y condiciones sigan buscando por nombre.
- La noche de una fecha es la de esa fecha (la salida no cobra). Ejemplo de referencia (§3.6): BAJA todo el año 100.000; ALTA solo vie–dom 180.000; jueves → domingo = 460.000.

## AB.3 Archivos afectados
| Archivo | Cambio |
|---|---|
| `lib/calc/paquetes.ts` | `TemporadaRango.grupos`, `toTemporadaRango`, `resolverNetoNocheDetallado`, `netoNoche`, `liquidarHotelNoches*`, `liquidarHotelMasBarato*` (falla cerrado con grupos); firmas públicas sin cambios |
| `lib/calc/gruposDias.ts` (nuevo, puro) | día de la semana de una fecha, grupo que cubre, clave `nombre + grupo` |
| `lib/calc/empatesPrioridad.ts` (nuevo, puro) | detector de empates por noche y combinación, con motivo; base del validador de la entrega 3 |
| `lib/calc/netosPorTemporada.ts` (nuevo, puro) | helper único del mapa de netos (incluye «la última fila gana» legado) |
| `lib/calc/reglaEdadTarifa.ts`, `lib/calc/condicionesTarifa.ts` | regla de edad tolerante a filas por grupo |
| `lib/reservar/liquidacionHotel.ts` (`evaluarHotelPorFechas`) | usa el helper y los grupos |
| `lib/reservar/cotizar.ts` | incrusta los grupos en la lectura de vigencias existente |
| `lib/reservar/computo.ts` | ídem; agrega `grupo_id` a su `select` explícito de `tarifa_hotel` |
| `lib/tarifario/vigencia.ts` | ídem (lecturas paginadas); agrega `grupo_id` a su `select` explícito |
| `app/(dashboard)/dashboard/paquetes/actions.ts` (generación del tarifario) | ídem; usa el helper |
| `lib/tarifario/registroConflictos.ts` (nuevo, pequeño) | registro deduplicado en memoria del motivo de empate (sin escrituras en base) |
| `types/database.ts` | tipo del arreglo incrustado |
| `docs/tecnico/tarifas-hotel.md` | sección del motor por noche |

## AB.4 Lectura de grupos y orden de despliegue
- Los grupos se piden **dentro** de la lectura de `hotel_temporadas` que cada cargador ya hace: `…, hotel_temporada_grupos(id, dias, activo)` (relación por la FK de la 293). **Cero solicitudes nuevas**; la respuesta crece con un `[]` por vigencia mientras no haya grupos.
- Todos esos cargadores usan el cliente de service-role o una sesión interna (roles con lectura por RLS). Un cliente `anon` fallaría por permisos: hay que comprobar que ninguno lo use (prueba de cableado).
- **Orden obligatorio:** la 293 aplicada y verificada (postcheck) **antes** de desplegar el código del incremento 2, porque PostgREST rechaza la incrustación si la relación no existe. Como la Base es única para Producción y Preview, la 293 debe estar aplicada también antes de probar en Preview. Un rollback de la 293 exige revertir antes ese código. Esto **no** depende de 288–292.

## AB.5 Pruebas de compatibilidad previstas (ninguna implementada)
1. **Golden E3 sin cambios:** las 27 pruebas de caracterización y las de `hotelPorFechas43`/`vigenciasPrecedencia43` dan los mismos números (incluido el 360.000 sin grupos y la caída silenciosa a la vigencia inferior del legado).
2. **Grupos inactivos ignorados:** con grupos definidos e inactivos, todos los recorridos dan lo mismo que sin grupos.
3. **Cobertura:** el ejemplo de §3.6 (460.000); día no cubierto por ningún grupo ⇒ vigencia inferior; ninguna aplicable ⇒ sin precio.
4. **Disponibilidad:** grupo que cubre sin tarifa doble ⇒ doble no se vende y no cae a la vigencia inferior; sencilla con tarifa sí; niño 0 válido, nulo no se vende; infante sin tarifa gratis.
5. **Estadía completa:** una noche no vendible ⇒ la estadía no se ofrece, nunca parcial; la salida no cobra.
6. **Empates (W.5 casos 1–5, 8–12):** misma prioridad con grupos ⇒ sin precio y motivo; invertir el orden de lectura no cambia nada; dos vigencias sin grupos empatadas ⇒ como hoy; mil cotizaciones con el mismo conflicto ⇒ un solo registro.
7. **Helper de netos:** duplicados legados ⇒ la última fila gana, igual que hoy, en los cinco sitios.
8. **Regla de edad:** filas por grupo con la misma regla ⇒ válido; reglas distintas ⇒ error, como hoy con duplicados.
9. **Promociones con grupos** ⇒ fuera de alcance: se resuelven como hoy (prueba que lo fija).
10. **«Desde» de porción** con grupos activos ⇒ no se publica (falla cerrado); sin grupos, igual que hoy.
11. **Paridad entre recorridos:** un mismo fixture con grupos (activados solo en memoria) da el mismo importe en `evaluarHotelPorFechas`, `computarReserva`, la generación del tarifario y el predicado de `vigencia.ts`.
12. **Día de la semana:** fechas a ambos lados de un cambio de mes y de año, y la noche del domingo, con el servidor en UTC y en otra zona horaria.
13. Cableado: ningún cargador del motor usa el cliente `anon` para la lectura incrustada; ningún validador de duración cambió (la entrega L sigue separada).

## AB.6 Conteos esperados de solicitudes (mismos que hoy)
| Operación | Lecturas hoy | Con el incremento 2 |
|---|---|---|
| Cotización por fechas de un hotel (`cargarDatosHotelPaquete` en `cotizar.ts`) | 6 en paralelo (armado, vigencias, tarifas, servicios, bloqueos, reglas EBB/Long Stay) | **6** (los grupos viajan dentro de «vigencias») |
| Reserva (`computarReserva`, por hotel) | 2 (vigencias memoizada + tarifas del combo) | **2** |
| Predicado de visibilidad (`vigencia.ts`) | 2 lecturas paginadas (páginas = filas / tamaño de página) | **las mismas páginas**; la paginación es por vigencia, la incrustación no la cambia |
| Generación del tarifario (`paquetes/actions.ts`) | 2 lecturas por lote de hoteles (`in`) | **2** |
| Cálculo por noche, empates y regla de edad | en memoria | en memoria, **0** solicitudes |
| Registro de un conflicto | — | en memoria y en el registro del servidor; **0** escrituras en base |
Se verifican con contadores de solicitudes en las pruebas (mismo número con 0, 1 y 10 grupos, y con grupos inactivos). **No se afirma** el consumo en Vercel: se compara tiempo de generación y número de solicitudes contra la versión anterior y el dueño lo comprueba en Preview.

## AB.7 Lo que no bloquea, pero conviene saber
- No hay decisión comercial pendiente para el incremento 2. Los tres puntos marcados [D] (grupos solo en vigencias `tarifa` hasta la entrega 4, «desde» de porción falla cerrado con grupos hasta la entrega 6, registro de conflictos solo en memoria) se derivan de la especificación y se confirman con sus pruebas.
- El incremento 2 **no requiere migración**, así que no necesita número.

---

# AC. Incremento 2 implementado en local (2026-11-11; sin commit, sin desplegar)

## AC.1 Qué se implementó
- **`lib/calc/paquetes.ts`**: `TemporadaRango` gana `id` y `grupos` (solo activos); `toTemporadaRango` los toma de la lectura incrustada. `resolverNetoNocheDetallado` recorre las vigencias **por nivel de prioridad** y delega la decisión en `decidirNivel`: sin grupos activos el resultado es **idéntico** al recorrido anterior (primera con precio; si ninguna, se baja). Con grupos: día no cubierto ⇒ la vigencia no aplica (§3.1); grupo que cubre sin tarifa ⇒ la acomodación no se vende esa noche, sin rescate (§3.2); dos con precio en el mismo nivel y alguna con grupos ⇒ empate, sin precio y motivo registrado (§3.7). El resultado agrega `grupoGanador`. `minNochesAplicable` ignora una vigencia con grupos que no cubre el día de entrada. `liquidarHotelMasBarato*` **falla cerrado** con grupos activos (sin «Desde» aproximado). Los grupos solo se honran en vigencias `tarifa` (las promociones por grupo son la entrega 4).
- **Módulos nuevos, puros:** `lib/calc/gruposDias.ts` (día ISO de la noche, robusto a zona horaria y cambio de hora; grupos activos; clave nombre + grupo con el separador 0x1F de `_tarifa_clave`); `lib/calc/empatesPrioridad.ts` (`decidirNivel`); `lib/calc/netosPorTemporada.ts` (armado único del mapa de netos y del conjunto de precio final, «la última fila gana» conservado); `lib/calc/registroConflictos.ts` (registro deduplicado, ver AC.4).
- **Regla de edad** (`reglaEdadTarifa.ts`): varias filas de una vigencia se aceptan solo si cada una es de un grupo distinto y sus reglas coinciden; duplicados «todos los días» o mezclas siguen siendo error.
- **Cargadores** (`cotizar.ts`, `computo.ts`, `vigencia.ts`, `paquetes/actions.ts`): incrustan `hotel_temporada_grupos(id, dias, activo)` en su lectura de vigencias existente, agregan `id` y, donde el `select` de tarifas era explícito, `grupo_id`; los cinco armados del mapa de netos usan el helper compartido. Mismo cliente que antes (service-role o sesión interna).
- **No se tocó:** la 293 (md5 `6cf9e0991f7c`, candado de inactividad intacto), `MAX_NOCHES_CONSULTA` (60, la entrega L sigue aparte), promociones, receptivos, cotización/contrato manuales, modelo por unidad, Bernalo, calculadoras.

## AC.2 Pruebas ejecutadas (locales)
| Prueba | Resultado |
|---|---|
| `pruebas/motorGrupos43.test.ts` — cobertura (460.000), disponibilidad sin rescate, estadía completa, grupos inactivos = sin grupos, empates en cualquier orden + mil cotizaciones = un registro, sin grupos empatadas = legado, W.3.5 y W.3.6, promoción con grupos ignorados, «desde» falla cerrado, mínimo de noches, armado de netos, **paridad** `evaluarHotelPorFechas` = armado compartido + motor (3 estadías), regla de edad por grupo, registro con TTL y máximo | 29 / 29 |
| `pruebas/gruposDiasZona43.test.ts` en **contenedor Linux** (`node:24.14.0-bookworm-slim`) con TZ `UTC`, `America/Bogota`, `Europe/Madrid`, `America/Santiago`, `Pacific/Kiritimati`, `America/New_York` (desfases verificados en cada corrida) — día ISO a ambos lados de cambios de mes, año y hora; estadía que cruza el cambio de hora | 2 / 2 en las 6 zonas. En Windows Node ignora `TZ` salvo `UTC`: esas corridas no cuentan |
| `pruebas/motorGrupos43.wiring.test.ts` — incrustación en los 4 cargadores con su cliente de siempre, helper compartido, `MAX_NOCHES_CONSULTA` sin cambios, candado de la 293 intacto | 4 / 4 |
| Caracterización E3 (`hotelPorFechas43`, `vigenciasPrecedencia43`) y validación de fechas | sin cambios, en verde |
| **PostgREST v16.4 real** (`test_293_lectura_postgrest.sh` + `pruebas/lecturaGrupos293.pg.mjs`) sobre una base nueva de la plantilla **equivalente a Producción (≤287)** con la 293, JWT firmados por rol, usando las **cadenas `select` reales** extraídas del código | 212 comprobaciones en verde (AC.3) |
| `test:unit` completo | 9.056 pruebas; 29 fallos, **los mismos 29 que en la base** `e39224313` (comprobado archivo por archivo). Los 4 que causaba el cambio eran pruebas de forma del código: se actualizaron (criterio de precio final en el helper; huella de `paquetes.ts` que congelaba #63, ahora con la nueva y su motivo) |
| `tsc --noEmit`, ESLint de los archivos tocados, `next build` | 0 errores; 3 avisos que ya existían en la base; build correcto |

## AC.3 Lectura combinada con PostgREST y roles reales (medido en local)
- Por cada cargador y rol: **una sola solicitud** con 0, 1 y 10 grupos.
- **RLS no oculta grupos de una vigencia visible:** service-role, superadmin, operaciones (Mayorista y Minorista) reciben las 6 vigencias y exactamente los grupos que hay en la base; `venta` no ve vigencias (igual que hoy); `anon` recibe un **rechazo explícito** (HTTP 401/403) porque no tiene SELECT sobre la tabla de grupos — ningún cargador del motor usa `anon`, y la prueba de cableado lo fija.
- La paginación por rangos de `vigencia.ts` da las mismas filas y grupos en dos páginas.
- **Volumen** (lectura de `cotizar.ts`, service-role, hotel con 6 vigencias): sin incrustar (antes) 2.110 bytes · 0 grupos 2.278 (+168: un `[]` por vigencia) · 1 grupo 2.360 · 10 grupos 3.064.
- **Conteo de llamadas en el código:** `.from(`/`.rpc(` por archivo idéntico antes y después en los siete archivos tocados; los módulos nuevos no hacen ninguna.
- **Pendiente en Preview (no medido):** tiempo de las funciones, consumo en Vercel y el volumen con datos reales; requiere la 293 aplicada.

## AC.4 Registro de conflictos
`lib/calc/registroConflictos.ts`: deduplicación en la **memoria de cada instancia/proceso** (en Vercel cada instancia tiene la suya y se pierde al reciclarse: no es global), clave = ids de las vigencias empatadas (únicos en todo el sistema, distinguen hoteles) + prioridad + régimen; **TTL 10 min** y **máximo 500 entradas** (se descartan primero las caducadas y luego las más antiguas). Emite por el registro del servidor (`console.warn`); **sin escrituras en base ni reintentos**.

## AC.5 Dependencia y orden de despliegue
1. Confirmación del dueño del número 293 (coordinado con #75/#97: #75 la reconoce como de #43/#60 y usa la 294).
2. Preflight 293 → **293** → postcheck 293 (huella de tarifas idéntica).
3. Recién después, desplegar el código del incremento 2 (Preview y luego Producción comparten la base: la 293 debe estar aplicada **antes** de cualquier despliegue con este código, porque PostgREST rechaza la incrustación si la relación no existe).
4. Revertir la 293 exige revertir antes este código.
5. No depende de 286 ni de 288–292. No requiere regenerar ni publicar el tarifario: con grupos inactivos, los precios son idénticos.

---

# AD. Alcance del incremento 3: preparar grupos y sus tarifas sin activarlos (PRESENTADO, sin implementar — 2026-11-11)

## AD.1 Punto de partida (comprobado)
- Rama `claude/43-60-vigencias-por-dia` en `dcab8ed82`; `origin/main` en `2ca311353` (squash del PR #446). **Contenido idéntico** (`git diff HEAD origin/main` vacío); árbol de trabajo limpio.
- La 293 está aplicada en Producción y su postcheck pasó (dueño: 1.952 tarifas, huella conservada, grupos inactivos). El motor por noche (#446) está en `main`.
- Numeración vista hoy en worktrees y ramas: 292 (#75), **293 (este frente, aplicada)**, 294 (#75, `mantenimiento_escrituras`, provisional). No se asume el número de la migración nueva.

## AD.2 El límite que impone el candado de la 293
Una fila de `tarifa_hotel` solo puede apuntar a un grupo **activo**, y ningún grupo puede estarlo. Por lo tanto, mientras el candado siga puesto, **ninguna tarifa por grupo puede existir en `tarifa_hotel`**. Este incremento prepara todo lo demás y deja las tarifas por grupo como **propuesta**, que el motor nunca lee. Es exactamente la «propuesta editable» de V.1: hasta confirmar, la vigencia sigue vendiendo igual.

**Depende de activación (NO entra; entrega aparte «3c Activación», con su propia migración que retire el candado y autorización expresa):**
- Confirmar y activar: pasar la propuesta confirmada a `tarifa_hotel` y marcar los grupos activos, en una transacción (último paso de V.1).
- Volver a «todos los días» (V.1).
- Actualizar o reemplazar **tarifas reales** por grupo (V.2): lote por grupo, «reemplazar este grupo», «reemplazar todo el hotel» con grupos, `_tarifa_clave` con grupo en la RPC de generación (203), carga CSV con columna de grupo.
- Calculadoras por grupo (Dubai, Mixta, Corporativa).
- Validación de empates por **rangos** de fechas al activar (W.3/W.4; hoy existe el detector por noche).
Fuera también: promociones por grupo (entrega 4) y el límite de 30 noches (entrega L).

## AD.3 Qué entra
1. **Grupos por vigencia**: crear, editar (nombre y días) y borrar. Días como chips L–D; los días ya usados por otro grupo de la vigencia aparecen deshabilitados; la base (293) rechaza igual el solape, nombres repetidos, hoteles por unidad y vigencias de nombre repetido.
2. **Propuesta de tarifas por grupo × categoría × régimen** (categorías y regímenes configurados en el hotel), con los mismos netos que una tarifa (sencilla, doble, triple, múltiple, niño 1, niño 2, infante) y notas/edades opcionales.
   - La tarifa «todos los días» vigente se muestra como **sugerencia** en cada celda, **sin guardarse**. Solo se guarda lo que el usuario escribe o acepta explícitamente («Usar sugerencia» por fila o por celda). No hay botón de «copiar todo».
   - **Celda vacía = esa acomodación no se venderá** con ese grupo. Se dice en pantalla; nunca se completa, copia ni rescata un precio.
3. **Operaciones con vista previa** (todas sobre la configuración preparada):
   - Guardar los grupos de una vigencia (alta, cambios, bajas en un solo paso).
   - Guardar la propuesta en tres modos claramente distintos: **actualizar** (solo las combinaciones que trae), **reemplazar un grupo** (sustituye solo ese grupo) y **reemplazar la vigencia** (todas sus propuestas).
   - Borrar un grupo preparado: tras vista previa y confirmación elimina **el grupo y únicamente sus propuestas**. **No borra ni modifica** promociones, tarifas vigentes ni ninguna otra configuración comercial activa; las promociones vinculadas a la vigencia se muestran solo como **dependencias informativas** para la futura activación. *(Frase corregida en la auditoría del 2026-11-11: la versión anterior podía leerse como si también borrara promociones.)*
   - La vista previa describe los efectos concretos (V.4): celdas que cambian o desaparecen, grupos y promociones vinculadas (por `temporada_base`, informativo: quedarán afectadas **al activar**), y **cobertura prevista al activar**: días que ningún grupo cubrirá (pasarán a otra vigencia o no se venderán, D13) y acomodaciones sin precio por grupo (no se venderán). No afirma que algo deje de venderse **hoy**: nada cambia hasta activar.
4. **Cambios concurrentes**: la lectura devuelve una **huella** de la configuración de la vigencia (vigencia, grupos, propuesta y tarifas «todos los días»). Cada escritura la recalcula **bajo candado**, con el mismo orden que la 293 (grupo → vigencia → candado del hotel → hotel), y si difiere **rechaza** con «La configuración cambió desde que la abriste; recarga». Sin reintentos automáticos.
5. **Historial**: grupos y propuestas quedan en la auditoría general (087) con antes y después; lo borrado se conserva ahí.
6. **Modelo por unidad**: sin controles de grupos en la ficha; las acciones lo rechazan antes de llamar a la base (y la 293 también).
7. **Mensajes claros** para los rechazos de la 293 en las acciones existentes: borrar o mover una vigencia con grupos, renombrarla a un nombre repetido, pasar el hotel a unidad, carga masiva de vigencias con nombres que chocan.
8. **Restricción derivada** (AB.1, se confirma con pruebas): grupos solo en vigencias de tipo `tarifa`, y una vigencia con grupos no cambia de tipo, hasta la entrega 4.
9. Al copiar vigencias de otro hotel no se copian sus grupos ni sus propuestas [D].

## AD.4 Migración nueva: SÍ (número sin asignar)
**Por qué:** (a) la propuesta necesita dónde guardarse y no puede ir en `tarifa_hotel` (el candado lo impide, y así debe seguir); (b) las operaciones de varias filas con huella deben ser **una transacción**, y desde la app eso exige RPC; (c) la restricción de tipo es una regla de base. **No edita la 293.**
**Contenido previsto:**
- Tabla de propuesta: FK al grupo (`on delete restrict`; el borrado pasa por la RPC), única por grupo + categoría + régimen, netos ≥ 0 o nulos, edades «todas o ninguna» como `tarifa_hotel`, quién y cuándo confirmó, huella de la fila «todos los días» de la que se aceptó la sugerencia (para detectarla obsoleta al activar). RLS, permisos y `anon` iguales a `tarifa_hotel`; trigger de auditoría.
- Función de huella de la configuración de una vigencia.
- RPC de lectura (una sola llamada: grupos, propuesta, tarifas «todos los días», promociones vinculadas y huella) y RPC de escritura para grupos, propuesta (tres modos) y borrado de grupo; con rol interno y sesión Mayorista verificados dentro, huella comparada bajo candado, mensajes claros.
- Trigger nuevo de tipo (AD.3.8).
- Preflight y postcheck de una consulta cada uno, rollback protegido (aborta si hay propuestas guardadas), pruebas en la plantilla equivalente a Producción con la 293.
**Número:** se fija al escribirla con el protocolo de §8, coordinado con #75/#97 y confirmado con el dueño.

## AD.5 Pantallas y archivos
| Archivo | Cambio |
|---|---|
| `HotelDetalleClient.tsx` (`TemporadasBox`) | Por vigencia `tarifa`: etiqueta de días/estado «Preparado — inactivo» y botón «Grupos de días»; deshabilitado con motivo si el nombre se repite; nada para hotel por unidad |
| `GruposDiasPanel.tsx` (nuevo) | Editor de grupos; pestaña por grupo con la cuadrícula de propuesta (sugerencias visibles, «Usar sugerencia», aviso de celda vacía); vista previa y confirmación con texto concreto; aviso de confirmación obsoleta |
| `grupos-actions.ts` (nuevo, junto a `hoteles/actions.ts`) | Acciones del servidor: leer configuración, guardar grupos, guardar propuesta (modo), borrar grupo. Cada una = 1 llamada RPC, rol y modelo verificados, un solo `revalidatePath`, **sin** regenerar el tarifario (no cambia precios) |
| `lib/hoteles/alcanceGrupos.ts` (nuevo, puro) | Diferencias para la vista previa, texto de confirmación y cobertura prevista al activar |
| `hoteles/[id]/page.tsx` | Incrusta los grupos en la lectura de vigencias que ya hace (0 solicitudes nuevas) para las etiquetas |
| `hoteles/actions.ts` | Mensajes claros para los rechazos de la 293 en acciones existentes |
| `types/database.ts`, `docs/tecnico/tarifas-hotel.md` | Tipos de la tabla y las RPC; hoja técnica |

## AD.6 Consumo previsto
| Acción | Solicitudes |
|---|---|
| Ver la ficha del hotel | **0 nuevas** (grupos incrustados en la lectura de vigencias existente) |
| Abrir «Grupos de días» de una vigencia | **1** (RPC de lectura) |
| Escribir en la cuadrícula, ver la vista previa | **0** (en memoria) |
| Guardar grupos / guardar propuesta / borrar grupo | **1** cada una + un `revalidatePath` |
| Regeneración o publicación del tarifario | **ninguna** (la propuesta no cambia precios) |
Sin consultas por celda ni por noche, sin sondeos, sin efectos que se retroalimenten. Se verifica con contadores en las pruebas React y con PostgREST real; el consumo en Vercel queda pendiente de Preview.

## AD.7 Pruebas previstas
- **SQL en Postgres local** (plantilla equivalente a Producción + 293 + la nueva): restricciones de la propuesta; tipo `tarifa`; huella obsoleta rechazada; carreras con dos sesiones (dos guardados de propuesta, borrar grupo frente a guardar propuesta, renombrar vigencia frente a guardar, cambiar días frente a guardar); RLS por rol (operaciones Mayorista y Minorista, superadmin, venta, anon); auditoría; rollback protegido; preflight/postcheck; **la 293 sigue intacta y la huella de tarifas no cambia**.
- **PostgREST real**: las RPC por rol, una solicitud cada una.
- **Puras**: diferencias, texto de confirmación (V.4) y cobertura prevista.
- **Acciones**: rol, modelo por unidad, mensajes, una sola RPC, sin regenerar.
- **React**: sin solicitudes por celda; la sugerencia no se guarda sin aceptarla; aviso de celda vacía; confirmación obsoleta pide recargar; hotel por unidad sin controles.
- **Compatibilidad**: los cargadores del motor nunca leen la propuesta (cableado); caracterización E3 y pruebas del motor sin cambios; `tsc`, ESLint, `next build`.

## AD.8 Puntos derivados (no son decisiones comerciales; se confirman con pruebas)
Grupos solo en vigencias `tarifa` hasta la entrega 4; la propuesta guarda solo valores confirmados; las promociones vinculadas se muestran por `temporada_base` y solo informan; copiar vigencias no copia grupos.

---

# AE. Incremento 3 implementado en local (2026-11-11; sin commit, sin aplicar)

## AE.1 Precisiones de la auditoría incorporadas
- Preparación **inactiva**: la 293 no se toca ni se retira su candado; ninguna tarifa por grupo en `tarifa_hotel`; el motor no lee la propuesta (cableado probado); nada se activa, regenera ni publica.
- **Borrado**: elimina el grupo y **únicamente sus propuestas**, tras vista previa y confirmación; promociones, tarifas vigentes y demás configuración no se tocan; las promociones vinculadas se muestran como dependencias informativas. La frase ambigua de AD.3 quedó corregida.
- **Disponibilidad**: nada se completa ni se copia; la sugerencia solo se guarda con «Usar sugerencia»; mensajes distintos para habitación sin precio (o en 0 = no aplica), niño nulo (no se vende con niños), niño en 0 (gratis) e infante sin tarifa (viaja gratis). Las reglas de gratuidad no cambian (la propuesta guarda el valor tal cual).
- **Concurrencia**: la huella cubre vigencia, grupos, propuestas, tarifas de origen y promociones vinculadas (sus filas y sus vigencias); se compara dentro de la transacción bajo candados compatibles con la 293; obsoleta ⇒ SQLSTATE PT409 (HTTP 409) y «Recarga», sin reintento.

## AE.2 Migración 295 (número PROVISIONAL, comprobado libre)
`supabase/migrations/20260601000295_grupos_dias_propuesta.sql`. Se comprobó en todos los worktrees y ramas: 292 y 294 de #75 (la 294 = mantenimiento, no se reutiliza), 293 de este frente; 295 libre. Contenido:
- Tabla `hotel_grupo_tarifa_propuesta` (FK al grupo `restrict`, única por grupo + categoría + régimen, netos ≥ 0, al menos un neto, edades «todas o ninguna» y rangos como `tarifa_hotel`, origen de la sugerencia con su huella, quién y cuándo confirmó). RLS: lectura para internos; **authenticated solo SELECT**: las escrituras van únicamente por las RPC. Auditoría (087).
- Triggers: grupos solo en vigencias `tarifa`; una vigencia con grupos no cambia de tipo.
- `_grupos_43_config` (configuración + huella, fuente única de lectura y comparación) y `_grupos_43_bloquear_y_comparar` con el orden **grupos → vigencia → tarifas de origen y de promociones (FOR SHARE) → vigencias de promociones (FOR SHARE) → candado del hotel (exclusivo) → hotel**. El bloqueo de las tarifas cubre también los cambios de solo precio, que no pasan por el trigger de la 293.
- RPC `grupos_dias_config`, `grupos_dias_guardar` (altas y cambios; tres pasadas para que un día pase de un grupo a otro en un guardado; intercambiar días entre dos grupos se hace en dos pasos), `grupos_dias_guardar_propuesta` (actualizar / reemplazar grupo / reemplazar vigencia; categoría y régimen deben estar configurados en el hotel; una sugerencia aceptada debe ser la tarifa de esa vigencia y combinación) y `grupos_dias_borrar`. Rol interno y sesión Mayorista verificados dentro; modelo por unidad rechazado.
- Preflight y postcheck (una consulta de lectura cada uno) y rollback protegido (aborta si hay propuestas).

## AE.3 Aplicación
- `GruposDiasPanel.tsx` (nuevo): editor de grupos con días L–D (los usados por otro grupo, deshabilitados), cuadrícula de propuesta por grupo × categoría × régimen con la sugerencia como marcador, tres modos con vista previa (cambios, cobertura prevista al activar, dependencias informativas), borrado con vista previa, aviso de confirmación obsoleta con «Recargar».
- `grupos-actions.ts` (nuevo): 4 acciones, **una RPC cada una**, **sin `revalidatePath`** y sin regenerar; la RPC devuelve la configuración nueva y el panel actualiza su estado (la etiqueta de la ficha se actualiza en memoria).
- `lib/hoteles/alcanceGrupos.ts` (nuevo, puro): vista previa, textos, mensajes por celda, cobertura prevista, lectura de netos, detección de PT409 y mensaje claro al borrar una vigencia con grupos.
- `HotelDetalleClient.tsx`: botón «Grupos de días» y etiqueta «… · inactivo» por vigencia de tarifa; deshabilitado si el nombre se repite; ningún control para hoteles por unidad ni para promociones. `page.tsx`: grupos incrustados en la lectura de vigencias existente. `hoteles/actions.ts`: mensaje claro al borrar una vigencia con grupos. `types/database.ts`: tabla, relación de la FK y RPC.
- Pruebas: stub del loader React para `grupos-actions` (las pruebas que montan la ficha no lo abren) y la nueva prueba en `test:react`.

## AE.4 Pruebas ejecutadas (local)
| Prueba | Resultado |
|---|---|
| `test_295_grupos_dias_propuesta.sh` sobre la plantilla **equivalente a Producción** (≤283 + 284/285/287) con 293: preflight (8 OK) → 295 → postcheck (11 OK, huella de tarifas idéntica) → reaplicar → **42 aserciones** (lectura, grupos, tipo, propuesta en 3 modos, validaciones, escrituras directas prohibidas, candado 293 intacto, borrado solo del grupo y sus propuestas, promoción intacta, auditoría, roles, unidad, **tarifas vigentes intactas**) → rollback abortado con propuestas → rollback → huella igual → reaplicar → postcheck | 0 fallos |
| `test_295_concurrencia.sh`, dos sesiones reales: cambio de tarifa de origen (C1), de fila de promoción (C2), de vigencia de promoción (C3), alta de tarifa de origen (C4), otra propuesta (C5), días de un grupo (C6), renombre de la vigencia (C7), borrado de grupo (C9) ⇒ B espera el candado y recibe CONFIG_DESACTUALIZADA; control C8 (otra vigencia) ⇒ espera y pasa; invariantes en 0 | 9 / 9 |
| `test_295_postgrest.sh` (PostgREST v16.4, JWT por rol): una solicitud por operación; operaciones Mayorista y superadmin leen y escriben; operaciones Minorista solo lee; venta 403; anon 401; huella obsoleta HTTP 409 PT409; escribir la tabla directo por la API 403; tarifas vigentes intactas | 18 / 18 |
| `pruebas/gruposDias295.test.ts` (puras, acciones con cliente simulado, cableado: el motor no lee la propuesta, sin `revalidatePath`, sin sondeos) | 24 / 24 |
| `pruebas/gruposDias295.react.ts` (abrir = 1 lectura; editar y revisar = 0; confirmar = 1; sugerencia solo aceptada; mensajes por celda; obsoleta sin reintento; borrado; días deshabilitados; ficha con botones correctos, sin controles en unidad) | 8 / 8 |
| Pruebas existentes de la ficha, vigencias y motor (`hotelPestanas22`, `vigenciasFechas43.*`, `motorGrupos43*`, caracterización E3, precio final, modelo tarifario, Mixta, etc.) | 492 en verde |
| `tsc`, ESLint de los archivos tocados, `next build` | 0 errores, 0 avisos, build correcto |
No se repitió la suite completa `test:unit` (el cambio no toca el motor ni otros módulos).

## AE.5 Solicitudes medidas (local)
| Acción | Solicitudes de datos | Recarga por `revalidatePath` |
|---|---|---|
| Ver la ficha del hotel | 0 nuevas (grupos incrustados en la lectura de vigencias) | — |
| Abrir «Grupos de días» | 1 (`grupos_dias_config`; 1.262 bytes en la prueba HTTP) | ninguna |
| Editar celdas y revisar la vista previa | 0 | ninguna |
| Guardar grupos / guardar propuesta / borrar grupo | 1 RPC cada una (devuelve la configuración nueva) | **ninguna**: las acciones no llaman a `revalidatePath` (comprobado en la prueba de acciones y en el cableado) |
| Confirmación obsoleta | 1 (la escritura rechazada); recargar es un clic explícito = 1 lectura | ninguna |
Sin sondeos, sin consultas por celda ni por noche, sin reintentos. **Pendiente en Preview**: tiempos, consumo en Vercel y volumen con datos reales.

## AE.6 Orden de despliegue
1. Confirmar el número 295 con el dueño y #75/#97.
2. Preflight 295 → **295** → postcheck 295 (huella idéntica).
3. Recién después, desplegar este código (la ficha incrusta grupos —ya posible con la 293— y el panel llama a las RPC de la 295).
4. Revertir la 295 exige revertir antes este código y que no haya propuestas (el rollback lo comprueba).
No depende de 286 ni de 288–292; no activa, regenera ni publica nada.

## AE.7 Correcciones de la auditoría (decimales, notas/edades y vista previa) — 2026-11-11
**Defectos confirmados en la versión anterior** (reproducidos): (1) el editor mostraba los importes con `String()` («123.45») y `leerNeto` borraba todos los puntos ⇒ 123.45 se leía como **12345** al reabrir, aceptar una sugerencia o reemplazar; (2) notas y edades no viajaban en el estado del editor ni en el payload, y el `ON CONFLICT … DO UPDATE` de la RPC sobrescribía con null todo campo no enviado ⇒ editar un precio **borraba** notas y el override de edades; (3) la vista previa solo daba conteos.

**Corrección**
- **Un solo formato** (`formatNeto`/`leerNeto` en `alcanceGrupos.ts`, inversas exactas): coma decimal y punto solo de miles (123,45 · 120.000 · 1.234,5). Un texto ambiguo como «123.45» se **rechaza** con mensaje, nunca se reinterpreta. El panel muestra guardado, sugerencias y marcadores con ese formato.
- **Notas y edades** (`nota_infante`, `notas`, las cuatro edades) en tipos, estado, payload y persistencia. Regla única: **omitido = se conserva; presente con null = borrado intencional**. En «actualizar», si no se tocaron se omiten; «Quitar notas y edades» es el borrado explícito; en un reemplazo la fila se envía completa con lo que hay en pantalla (que viene de lo guardado). «Usar sugerencia» solo pone los **netos**; las notas y edades de la tarifa actual requieren el botón aparte «Usar notas y edades de la tarifa actual» y aparecen en la revisión.
- **RPC (295, sin aplicar)**: `UPDATE` explícito que solo cambia los campos presentes (las restricciones se evalúan sobre la fila fusionada) o `INSERT` si no existe; quitar una combinación en «actualizar» exige los siete netos **presentes** en null; en un reemplazo, una fila sin ningún neto es error claro. El origen de la sugerencia sigue la misma regla (presente null = se desmarca).
- **Vista previa = payload**: `planPropuesta` produce a la vez `filas` (lo que se envía, vía `payloadFilas`, que usa también la acción) y `lineas`: una por celda o campo, con grupo, categoría, régimen y acomodación y **anterior → nuevo**; las celdas que pasan a vacío o a 0 llevan su efecto (habitación: no se vende / no aplica; niño vacío: no se vende con niños; niño 0: gratis; infante vacío: viaja gratis); los reemplazos detallan cada combinación eliminada con sus importes y si tenía notas/edades, y declaran las filas que se reescriben sin cambios. Editar después de revisar cierra la revisión (no se confirma una vista previa vieja).

**Pruebas ejecutadas tras la corrección (locales)**
| Prueba | Resultado |
|---|---|
| `test_295_grupos_dias_propuesta.sh` (plantilla equivalente a Producción): ciclo completo + **49 aserciones** (nuevas C18–C24: 123.45 y 150000.5 exactos, notas/edades conservadas al editar un neto, borrar una sola edad rechazado, borrado intencional, netos intactos) | 0 fallos |
| `test_295_concurrencia.sh` | 9 / 9 |
| `test_295_postgrest.sh`: permisos por rol + **persistencia real con el mismo cálculo del editor** (`planPropuesta` → `payloadFilas` → RPC → reabrir desde Postgres): 123,45 / 150.000 / 0 / vacío exactos; editar otro neto conserva 123.45 y notas/edades; sugerencia 200.000,5 y 0 exactos sin sus notas; reemplazar el grupo conserva todo (2 filas declaradas como reescritas); borrado intencional; reemplazar la vigencia detalla y elimina | 0 fallos; 25 solicitudes HTTP, una por operación |
| `pruebas/gruposDias295.test.ts` (formato, edades, mensajes, plan/payload, acciones, cableado) | 29 / 29 |
| `pruebas/gruposDias295.react.ts`: recorrido con decimales, entero, vacío y cero; «123.45» rechazado sin enviar; editar otra celda; aceptar sugerencia (y aparte sus notas/edades); borrado intencional; celdas a vacío/0 con efecto; reemplazo de grupo y de vigencia; obsoleta sin reintento; editar tras revisar cierra la revisión; borrado de grupo; ficha | 14 / 14 (+ 17 de las pruebas existentes de la ficha) |
| `tsc`, ESLint de los archivos tocados, `next build` | 0 errores, 0 avisos, build correcto |
**Contadores conservados**: abrir 1 lectura; editar y revisar 0; guardar o borrar 1 RPC; sin `revalidatePath`, sin sondeos ni reintentos.

**Límites**: solo se acepta coma decimal (un usuario que escriba «123.45» recibe el aviso y debe corregirlo); el editor no ofrece copiar notas/edades a varias combinaciones a la vez; la persistencia real se probó con PostgREST local y la plantilla equivalente a Producción, no en Preview.

## AE.8 Corrección de edades: validación previa y mensajes sin nombres técnicos — 2026-11-11
**Defecto observado en Preview**: con infante 2–3 y niño 4–10 el panel dejaba confirmar y la base rechazaba con el texto crudo de Postgres (`new row for relation "hotel_grupo_tarifa_propuesta" violates check constraint "…_edades_rangos"`). `validarEdades` solo comprobaba «todas o ninguna», no los rangos que exige la 295.

**Corrección (solo aplicación; la 293 y la 295 no se tocan ni se vuelven a aplicar)**
- `lib/hoteles/alcanceGrupos.ts`: `validarEdades` aplica **las mismas reglas que las restricciones de la 295** (`edades_todas_o_ninguna` y `edades_rangos`) antes de enviar, y devuelve todos los incumplimientos con mensajes concretos: infante empieza en 0; «hasta» ≥ «desde» en infante y en niño; niño empieza justo después del último año de infante; niño como máximo 17. Con edades inválidas no aparece «Confirmar propuesta» y no se hace ninguna llamada de guardado.
- Nuevo `mensajeErrorBase`: traduce un rechazo de la base a un mensaje para el usuario (edades, «al menos un neto», y un genérico para cualquier otra restricción, error de sintaxis o de columna, en inglés o en español). **Nunca** muestra nombres de tablas ni de restricciones; los mensajes propios de las RPC, ya en español, pasan tal cual.
- `grupos-actions.ts`: `fallo()` usa `mensajeErrorBase`; el caso PT409 (`desactualizada`) no cambia. Sigue siendo una sola RPC por acción, sin reintento ni `revalidatePath`.

**Archivos**: `lib/hoteles/alcanceGrupos.ts`, `app/(dashboard)/dashboard/producto/hoteles/[id]/grupos-actions.ts`, `pruebas/gruposDias295.test.ts`, `pruebas/gruposDias295.react.ts`.

**Pruebas (auditadas, ejecutadas por Codex)**
| Prueba | Resultado |
|---|---|
| `pruebas/gruposDias295.test.ts` (lógica y acciones): reglas de la 295 con mensajes concretos (0–1/2–11 y 0–0/1–17 válidos; 2–3/4–10, salto en el inicio del niño, «hasta» menor que «desde», niño 18, edades incompletas); rechazos de Postgres en inglés y en español sin nombres técnicos; mensajes propios de las RPC intactos; acción con rechazo por edades = mensaje traducido y una sola llamada | **32 / 32** |
| `pruebas/gruposDias295.react.ts` (pantalla): 4 rangos inválidos ⇒ mensaje concreto, sin «Confirmar propuesta», cero llamadas de guardado y sin nombres técnicos; 0–1/2–11 ⇒ revisar y un solo guardado con esas edades; rechazo de la base ⇒ mensaje traducido, sin reintento | **20 / 20** |

**Sin cambios**: migraciones (293 y 295), SQL remoto, grupos (siguen inactivos), motor, generación y publicación. Contadores de solicitudes de AE.5 conservados.

# AF. Entrega 3b implementada en local: calculadoras por grupo de días (2026-11-11; sin commit, sin aplicar)

## AF.1 Punto de partida y numeración
- Rama `claude/43-60-vigencias-por-dia` limpia e **idéntica en contenido** a `origin/main` (`8578c266e`, squash de #447). No se hizo reset ni force-push: la rama arrastra 5 commits ya fusionados; al publicar, decidir si se rehace desde `origin/main`.
- Numeración comprobada en todas las ramas remotas y worktrees: 290–295 en uso (293 y 295 de este frente, aplicadas); **296 de #75** (`identidad_borrado_en_cascada`, ya aplicada). Se usa **297 como número PROVISIONAL**: confirmar con el dueño y con #75/#97 antes de aplicar. La 293 y la 295 no se tocan.

## AF.2 Qué hace
En la calculadora del hotel, el selector **«Calcular para»** permite elegir «Todos los días» (como siempre) o una vigencia de tarifa · grupo (inactivo). En modo grupo:
- Se usa el **mismo formulario** de la calculadora guardada: los parámetros generales quedan de solo lectura (`fieldset` deshabilitado) y se editan las bases del grupo con **todas sus opciones** (Dubai: edades, suplementos y condición propios por base; Mixta: valores por régimen; Corporativa: tarifa de habitación). Promociones y «Generar» no aparecen (promociones por grupo = **entrega 4**).
- **Mismas fórmulas**: `lib/hoteles/calculadoraGrupos.ts › calcularGrupo` llama a los generadores existentes, sin promociones; paridad probada. Qué es general y qué es de cada base: tabla en `calculadoras-hotel.md` §7.
- **Revisión** (`revisarCalculo`): anterior → nuevo por celda (el mismo `planPropuesta` del panel de grupos) y tres cosas a resolver **explícitamente** antes de confirmar, sin nada preseleccionado:
  1. **Edades**: Dubai fija la regla de edad de cada fila. Si difiere de la que quedaría en la propuesta, hay que aplicar la del cálculo o ajustar la base. Si la del cálculo es la general del hotel, aplicarla borra el override y se ve «(se borra)». Nunca queda un precio calculado con una regla y otra vigente. Mixta y Corporativa no fijan edades: las guardadas se conservan (no se envían).
  2. **Condición** (`notas`): si el cálculo trae una (la condición propia de una base de Dubai, o «Tarifa no incluye impuestos.» de Corporativa sin impuesto) distinta de la guardada, se aplica explícitamente (anterior → nuevo; reemplaza la nota) o se ajusta la base. Si el cálculo no trae condición, la nota guardada se conserva. La nota de infante es opcional y se conserva si no se acepta.
  3. **Disponibilidad**: cada acomodación que **antes no se vendía** y el cálculo pondría a la venta exige «Mantener sin venta» o «Habilitar a X» (o «… todas», como acción explícita). Se compara contra la propuesta guardada del grupo; si no hay, contra la tarifa actual de la vigencia; si tampoco existe, toda la combinación cuenta. Lo que la fórmula deriva legítimamente (triple, múltiple o niño de Dubai, etc.) se muestra igual, pero si antes no se vendía requiere esa decisión. Infante vacío = viaja gratis: ponerle precio es un cambio de precio, no una habilitación. Una combinación sin ninguna habitación a la venta no se envía.
- Nunca se completa nada desde otros grupos ni desde la tarifa actual; una categoría sin base en el grupo no se calcula y su propuesta queda igual.
- **Confirmar** = una RPC atómica (propuesta + bases). Editar después de revisar cierra la revisión.

## AF.3 Migración 297 `calculadora_grupos_dias` (sin aplicar)
- `hotel_calculadora.version` + trigger `tg_version_fila_43`: inserción = 1 y cada actualización = anterior + 1, también dos en la misma transacción; el escritor no puede fijarla. Probado (V2/V3).
- `hotel_calculadora_grupo_bases` (grupo + tipo, `bases` jsonb, versión con el mismo trigger, FK al grupo `on delete restrict`, RLS de lectura interna, `authenticated` solo SELECT, auditoría 087). Cambiar el tipo de calculadora no las borra. El grupo con bases se borra solo con `grupos_dias_borrar_con_bases` (ver AF.9).
- RPC `grupos_dias_guardar_calculadora` (security definer). Valida: usuario interno y permiso de catálogo (`_grupos_43_autorizar`); grupo existente, inactivo y de esa vigencia; tipo válido; filas **exclusivamente** del grupo (campos conocidos, netos ≥ 0 y al menos uno, edades enteras, sin «sugerencia aceptada»). Llama **sin modificar** a `grupos_dias_guardar_propuesta` (295) en modo `actualizar` (candados, huella, catálogo, unidad, restricciones). Valida estructura y valores de las bases (`_calc_grupos_43_validar_*`: categorías y regímenes del hotel, sin repetidas, precios > 0, edades propias con las reglas de la 177/295, suplementos de regímenes configurados, sin campos desconocidos). Compara las versiones de la calculadora (`FOR SHARE`) y de las bases (`FOR UPDATE`). Cualquier error ⇒ nada se guarda.
- Preflight y postcheck (una consulta cada uno, con columna de estado) y rollback protegido (aborta si hay bases).

## AF.4 Escritores de `hotel_calculadora` y concurrencia
| Escritor | Antes | Ahora |
|---|---|---|
| `guardarCalculadora` (3 formularios; Mixta «Sustituir» guarda dos veces) | `upsert` ciego | update condicionado a `hotel_id + version` (o insert si no había); 0 filas o 23505 ⇒ «recarga», sin reintento; devuelve la versión nueva, que el editor encadena |
| Cascada de renombre de vigencia | lee y reescribe sin condición | update condicionado a la versión leída; si no pudo, el aviso lo dice |
| API directa (rol interno) | sin control | el trigger cambia la versión igual: los demás detectan el cambio |
| RPC nueva | — | compara versión de la calculadora y de las bases bajo candado |
| Borrado del hotel | cascada | sin cambios: los escritores condicionados encuentran 0 filas |

«Generar» (RPC 203) sigue leyendo los parámetros guardados en el servidor sin comparar la versión (sin cambios; queda para la 3c).

## AF.5 Archivos
`supabase/migrations/20260601000297_calculadora_grupos_dias.sql`; scripts `preflight_/postcheck_/rollback_/fixture_/test_297_calculadora_grupos_dias.*`, `test_297_concurrencia.sh`, `test_297_postgrest.sh`; `lib/hoteles/calculadoraGrupos.ts` (nuevo, puro); `app/(dashboard)/dashboard/producto/hoteles/[id]/CalculoGrupoPanel.tsx` (nuevo); `CalculadoraEditor.tsx`, `grupos-actions.ts` (`guardarCalculoGrupo`), `page.tsx`, `hoteles/actions.ts`, `lib/hoteles/alcanceGrupos.ts` (texto de borrado), `types/database.ts`; pruebas `calculadoraGrupos297.test.ts`, `calculadoraGrupos297.react.ts`, `calculadoraGrupos297.pg.mjs`, stub del cargador, `gruposDias295.test.ts` (texto de borrado), `package.json` (`test:react`); `docs/tecnico/calculadoras-hotel.md` §4 y §7.

## AF.6 Pruebas ejecutadas (local)
| Prueba | Resultado |
|---|---|
| `test_297_calculadora_grupos_dias.sh` sobre la plantilla equivalente a Producción (≤287) + 293 + 295. Recorrido: preflight (8 OK) → 297 → postcheck (11 OK; huellas de calculadoras, tarifas y propuestas idénticas) → reaplicar → **54 aserciones** (versión ×6, guardado y conservación de notas/edades ×7, **22 rechazos atómicos**, Mixta ×3, permisos ×8, cascada ×2, invariantes ×5) → rollback abortado con bases → rollback → preflight → reaplicar → postcheck. Cada rechazo atómico trae una fila válida que cambiaría la propuesta y verifica que NADA cambió. | 0 fallos |
| `test_297_concurrencia.sh`, dos sesiones reales. Rechazadas (B espera el candado y recibe CONFIG_DESACTUALIZADA): K1 escritura directa vs RPC, K2 guardar calculadora vs RPC, K3 dos guardados del mismo grupo (solo bases), K4 dos guardados de la calculadora, K5 borrar grupo vs RPC. Controles que esperan y pasan: K6 (RPC vs guardar calculadora) y K7 (otro grupo). Invariantes. | 8 / 8 |
| `test_297_postgrest.sh` (PostgREST v16.4, JWT por rol): recorrido del editor con el **mismo cálculo** (calcularGrupo → revisarCalculo → payloadFilas → RPC → reabrir); solo el grupo pedido; el otro grupo intacto; bases reabiertas idénticas; PATCH condicionado por versión (pasa / 0 filas / no se puede fijar); 409 por versión de la calculadora y de las bases; superadmin sí; Minorista y venta 403; anon 401; venta no lee; escritura directa 403; fila de otro grupo 400; tarifas intactas | 25 / 25; 17 solicitudes HTTP |
| `pruebas/calculadoraGrupos297.test.ts` (fórmulas y paridad de las 3 calculadoras, revisión, acción, escritores condicionados, cableado) | 28 / 28 |
| `pruebas/calculadoraGrupos297.react.ts` (componentes reales: hotel sin grupos igual que siempre, versión encadenada, modo grupo, 0/1/1 solicitudes, nada preseleccionado, confirmar solo el grupo, editar cierra la revisión, obsoleta sin reintento, StrictMode/reposo/desmontaje) | 10 / 10 |
| Suites existentes de calculadoras, grupos, ficha, vigencias y motor (20 archivos unitarios + 4 React) | 592 + 42 en verde |
| `tsc`, ESLint de los archivos tocados, `next build` | 0 errores, 0 avisos, build correcto |

## AF.7 Solicitudes y consumo (VALIDACION_CONSUMO_VERCEL.md)
| Acción | Solicitudes | Recarga |
|---|---|---|
| Ver la ficha | 0 nuevas (bases y versión dentro de las lecturas existentes) | — |
| Elegir grupo, editar bases, decidir | 0 | ninguna |
| Revisar | 1 (`grupos_dias_config`, ~2 KB) | ninguna |
| Confirmar | 1 RPC (~3 KB; devuelve la configuración) | ninguna (sin `revalidatePath`) |
| Confirmación obsoleta | solo la escritura rechazada; «Recargar» es un clic explícito (recarga completa) | — |
| Guardar la calculadora | 1 (igual que antes) | la de siempre |

Sin efectos, sondeos, temporizadores ni reintentos en el panel (cableado probado); en StrictMode, en reposo y tras desmontar, las solicitudes cesan. Pendiente en Preview: Network/Observability del recorrido y en reposo.

## AF.8 Orden de despliegue y dependencias
1. Confirmar el número 297 con el dueño y #75/#97.
2. Preflight 297 → **297** → postcheck 297 (huellas idénticas).
3. Recién después, el código (lee `hotel_calculadora.version` y llama a la RPC). La 297 es compatible con el código que hoy está arriba: el `upsert` viejo sigue funcionando y el trigger sube la versión.
4. Para revertir: primero el código, luego `rollback_297_…` (aborta si hay bases).

**La 3c (activación)** necesitará: pasar la propuesta a `tarifa_hotel` y activar los grupos (retirar el candado de la 293); que «Generar» y «Reemplazar» escriban por grupo usando estas bases (clave con grupo en la RPC 203) y comparen la versión; y volver a validar Adults Only y la coherencia de edades y notas al activar. **Entrega 4**: promociones por grupo.

**Límites**: los parámetros generales son compartidos por todos los grupos (un suplemento distinto por día sería una ampliación); la prueba usa la plantilla local equivalente a Producción, no Preview; la versión del editor se actualiza con la respuesta de cada guardado y, si otra persona guarda, se detecta al guardar (no en vivo).

## AF.9 Correcciones de la auditoría (borrado con bases, compra cerrada, compatibilidad) — 2026-11-11
**Numeración**: la 296 de #75 (`identidad_borrado_en_cascada`) **ya está aplicada**; la 297 sigue PROVISIONAL hasta confirmar su número (cabecera corregida). La 293 y la 295 no se tocaron.

**1. Borrado y confirmación.** Antes, las bases se borraban en cascada con el grupo, pero la vista previa y la huella de la 295 no las cubren: un borrado revisado antes de que alguien guardara bases nuevas se las habría llevado sin confirmarlas. Corrección, toda en la 297:
- FK de `hotel_calculadora_grupo_bases` al grupo **`on delete restrict`**: el borrado de la 295 (`grupos_dias_borrar`, sin cambios) ya no puede llevárselas (falla con 23503 y no borra nada).
- `grupos_dias_config_bases` (una lectura): la configuración de la 295 + las bases de cada grupo (tipo, versión, cuántas bases). El panel de grupos la usa en lugar de `grupos_dias_config`; la vista previa del borrado nombra las bases concretas («Dubai (2 bases, versión 3)») y avisa que, si cambian, el borrado se rechaza.
- `grupos_dias_borrar_con_bases(grupo, huella, bases revisadas)`: mismos candados que la 295 y la RPC de guardado (grupos → … → hotel, luego las bases `FOR UPDATE`), compara las bases actuales con las revisadas (tipo + versión, también «había cero» frente a «ahora hay») y solo entonces borra las bases y llama a la RPC de la 295 para el grupo y sus propuestas. Si no coinciden: PT409 con el motivo y nada se borra. Guardar grupos o propuestas no cambia las bases: el panel conserva las leídas al aplicar esas respuestas.

**2. Compra cerrada.** Regla vigente, sin otra interpretación de fechas: en el formulario, `nombreVigenciaVencida` (la de «Generar»): el grupo aparece «compra cerrada: no se calcula», deshabilitado, y si se fuerza, el panel no calcula, no revisa ni confirma. En el servidor, la RPC aplica la regla de `generar_tarifas_hotel_calculadora` (todas las filas con ese nombre con `compra_fin < fecha_negocio()`), con la vigencia ya bloqueada: 23514 y nada se guarda (ni propuesta ni bases).

**3. Compatibilidad de despliegue** (`test_297_compatibilidad.sh` + `pruebas/compatibilidad297.pg.mjs`, PostgREST v16.4). Calculadoras Dubai, Mixta y Corporativa sembradas ANTES de la 297 con todas sus opciones (edades/suplementos/condiciones propias, promociones, valores por régimen, impuesto y descuento):
- A) El código anterior lee las tres (línea base).
- B) Preflight (ve las 3) → 297 → postcheck: huella (id, hotel, tipo, params) idéntica; params byte a byte iguales; todas en versión 1.
- C) El código anterior DESPUÉS de la 297, con las mismas peticiones que enviaba supabase-js: lee igual; `upsert` de guardar (las tres) funciona y la versión sube aunque no la conozca; la cascada de renombre escribe; crear una calculadora nueva nace en versión 1; el panel de grupos anterior (`grupos_dias_config`) funciona.
- D) El código nuevo: lectura con versión; guardado condicionado pasa y con versión vieja da 0 filas sin cambiar los params (las tres); RPC del grupo con la versión de la calculadora; lectura con bases; el borrado anterior (295) rechazado sin borrar; el borrado nuevo con las bases revisadas borra; los params conservan todas sus opciones originales.

**Pruebas repetidas tras las correcciones (locales)**
| Prueba | Resultado |
|---|---|
| `test_297_calculadora_grupos_dias.sh` (plantilla equivalente a Producción ≤287 + 293 + 295): preflight 8 OK → 297 → postcheck 11 OK, huellas idénticas → reaplicar → **63 aserciones** (nuevas: L1 lectura con bases; C1–C7 borrado: la 295 rechazada por la FK, vista previa sin bases, versión distinta y huella vieja rechazadas sin borrar nada, borrado con las versiones revisadas, grupo sin bases; Q1–Q3 compra cerrada sin escrituras parciales) → rollback protegido → rollback → reaplicar | 0 fallos |
| `test_297_concurrencia.sh`: K1–K7 como antes + **K8** (B revisa el borrado de Semana → A guarda bases nuevas → B confirma el borrado antiguo: espera el candado, PT409, siguen el grupo, sus bases nuevas y sus propuestas) + K9 control (guardar bases de otro grupo no invalida el borrado: espera y pasa) | 10 / 10 + invariantes |
| `test_297_postgrest.sh` (+ compra cerrada 400 sin escrituras, lectura con bases, borrado con versión vieja 409 sin borrar, borrado con las revisadas) | 31 / 31; 22 solicitudes HTTP |
| `test_297_compatibilidad.sh` (A–D arriba) | 39 / 39 |
| `pruebas/calculadoraGrupos297.test.ts` (+ compra cerrada: mensaje del servidor sin reintento; misma regla en el formulario) | 30 / 30 |
| `pruebas/calculadoraGrupos297.react.ts` (+ compra cerrada: opción deshabilitada; forzada, sin cálculo, sin revisar ni confirmar, 0 solicitudes) | 11 / 11 |
| `pruebas/gruposDias295.test.ts` y `.react.ts` (lectura con bases, borrado con las bases revisadas, motivo de PT409, bases mal formadas sin llamada, vista previa con las bases concretas) | 34 / 34 y 21 / 21 |
| Suites relacionadas (20 unitarias + 5 React) | 596 + 54 en verde |
| `tsc`, ESLint de los archivos tocados, `next build` | 0 errores, 0 avisos, build correcto |

**Solicitudes**: sin cambios en número: abrir el panel de grupos sigue siendo 1 lectura (ahora `grupos_dias_config_bases`), borrar 1 RPC, revisar el cálculo 1, confirmar 1.

**Qué se probó y qué sigue pendiente**
- Probado: todo lo anterior en Postgres local (plantilla equivalente a Producción) y PostgREST local, con dos sesiones reales para las carreras y con las peticiones exactas del código anterior.
- Pendiente: el número 297 (confirmación del dueño y de #75/#97); Preview (Network/Observability del recorrido y en reposo) y datos reales: la plantilla no trae calculadoras de Producción, las de la prueba de compatibilidad son sembradas; la vista del código anterior desplegado de verdad en Vercel contra la base con la 297 (aquí se reprodujeron sus peticiones, no se ejecutó ese despliegue). Con el código anterior arriba, borrar un grupo que tenga bases fallaría por la FK, pero ese código no puede crear bases, así que no ocurre hasta desplegar el nuevo.

## AF.10 Migración 297 aplicada en Producción (2026-11-11) — cierre de la entrega 3b
- El dueño aplicó la **297** en Producción con el orden previsto (preflight → 297 → postcheck). **Postcheck correcto**: 189 calculadoras; huellas de calculadoras (id, hotel, tipo, params), de tarifas y de propuestas **idénticas** al preflight; grupos inactivos (candado de la 293 intacto). Desde ahora la 297 es **inmutable**: cualquier cambio va en una migración nueva.
- El número 297 queda confirmado para este frente (la 296 de #75 ya estaba aplicada). Siguiente libre para cualquier frente: 298 (comprobar de nuevo antes de usarlo).
- Con la 297 aplicada, el código que hoy está en Producción sigue funcionando (probado en `test_297_compatibilidad.sh`, fase C): su guardado de la calculadora (`upsert`) y la cascada de renombre escriben igual y la versión sube sola. Falta desplegar el código de esta entrega (paso 3 de AF.8).
- Git: #447 fusionado (squash `8578c266e`) y la rama remota `claude/43-60-vigencias-por-dia` borrada al fusionar; no hay PR abierto. La entrega 3b continúa en la rama nueva **`claude/43-60-3b-calculadoras`**, creada desde `origin/main` con los cambios locales (sin reset ni force-push).

**Validación pendiente en Preview** (tras desplegar este código):
1. Hotel por persona con calculadora Dubai guardada y una vigencia de tarifa con grupos: en «Tarifa por fórmula» aparece «Calcular para»; elegir un grupo no hace solicitudes; los generales quedan de solo lectura; no aparecen promociones ni «Generar».
2. Cargar bases del grupo (con edades o condición propias en Dubai) → «Revisar» (1 solicitud) → resolver edades, condición y cada acomodación «antes sin venta» (nada preseleccionado) → «Confirmar» (1 solicitud). Reabrir: las bases y la propuesta del grupo se ven iguales; el otro grupo no cambió.
3. Repetir con un hotel Mixta (dos regímenes) y uno Corporativa sin impuesto (condición «Tarifa no incluye impuestos.» exigida).
4. Una vigencia con la compra cerrada: su grupo aparece deshabilitado («compra cerrada»).
5. Dos pestañas: en una, abrir el borrado del grupo; en la otra, guardar bases nuevas; confirmar el borrado en la primera ⇒ rechazado con el motivo y nada borrado. En dos pestañas, guardar la calculadora en una y luego en la otra ⇒ la segunda pide recargar.
6. Hotel sin grupos y hotel por unidad: la calculadora se ve y funciona como antes (sin selector).
7. Network/Observability durante el recorrido y en reposo: solo las solicitudes de los clics; ninguna en reposo ni al cambiar de pestaña; sin regeneración ni publicación del tarifario.

## AF.11 Corrección tras Preview: parámetros de la fórmula por grupo (migración 298 PROVISIONAL) — 2026-11-11
**Validado por el dueño en Preview (#448):** cálculo, guardado y selección explícita de acomodaciones. **Defecto:** en modo grupo no se podían editar modificadores, descuentos ni suplementos (incluido FULL): estaban bloqueados con los generales del hotel.

**Corrección**
- Cada grupo elige explícitamente **«Usar los generales del hotel»** (bloqueados, como referencia) o **«Valores propios de este grupo»** (se habilitan partiendo de una copia de los del hotel). Los generales del hotel se ven siempre como referencia y nunca cambian; otros grupos tampoco.
- Son solo parámetros de la **fórmula**, por tipo: Dubai (régimen base, modificadores, suplementos —FULL incluido—, nota de infante); Mixta (IVA, modo/IVA por acomodación, IVA de niño, pax, nota); Corporativa (régimen base, persona/niño adicional, impuesto, **descuento de la tarifa** —parte de la fórmula, rotulado «no es promoción»—, suplementos por régimen, nota). Las **promociones** nunca entran: el cálculo del grupo las quita y la base rechaza `promos`, `bases` y `bases_por_regimen` dentro de los parámetros.
- Se guardan con las bases y se reabren: cambiar de opción vuelve a montar el formulario sin perder las bases escritas; la revisión muestra «Parámetros de la fórmula de este grupo» con el cambio de modo y anterior → nuevo de cada parámetro (sobre los efectivos), además de la propuesta.
- **Migración 298 `calculadora_grupos_generales`** (número provisional; 296 y 297 aplicadas; 298 comprobado libre en todas las ramas y worktrees): columna `hotel_calculadora_grupo_bases.generales` (null = generales del hotel; lo guardado con la 297 queda así, sin subir de versión); RPC `grupos_dias_guardar_calculadora_grupo` = la RPC de la 297 **sin cambios** + los generales en la misma transacción (versiones, huella, compra cerrada, candados y permisos de la 297); validación por tipo; un trigger hace que cualquier otra escritura de la fila (p. ej. la RPC de la 297 sola) deje los generales en null, así la fila nunca guarda parámetros distintos de los usados para calcular; la vista previa del borrado dice si el grupo tenía parámetros propios. Preflight y postcheck (una consulta cada uno) y rollback protegido (aborta si hay parámetros propios; restaura la función de la 297).
- **No** se edita ninguna migración aplicada (293, 295, 297).

**Pruebas (locales)**
| Prueba | Resultado |
|---|---|
| `test_298_calculadora_grupos_generales.sh` (Producción equivalente + 293 + 295 + 297 y **bases guardadas con la 297 antes de la 298**): preflight → 298 → postcheck (huellas de bases, calculadoras y propuestas idénticas) → reaplicar → **34 aserciones** (compatibilidad K1; **Semana y Finde con Sencilla y FULL distintos**, aislados, reabiertos, hotel intacto G1–G7; 14 rechazos/validaciones atómicos incluidas promociones como «parámetro»; la RPC de la 297 sola deja null C1–C5; permisos P1–P4; invariantes) → rollback protegido → rollback → reaplicar | 0 fallos |
| `pruebas/calculadoraGrupos297.test.ts` (+ generales: solo fórmula, Semana/Finde FULL 180.000 / 220.000 / hotel 200.000, paridad con el generador, revisión anterior → nuevo, clave de revisión) | 34 / 34 |
| `pruebas/calculadoraGrupos297.react.ts` (+ Semana usa los del hotel bloqueados con referencia; propios se habilitan, conservan la base escrita, recalculan y viajan explícitos sin promociones; Finde reabre con los suyos y no recibe los de Semana; volver a los del hotel = null) | 15 / 15 |
| Suites relacionadas (20 unitarias + 5 React) | 600 + 58 en verde |
| `tsc`, ESLint de los archivos tocados | 0 errores, 0 avisos |

## AF.12 Entorno local habitual (`local4360`)
Base + Auth + REST + Storage + gateway reales en local, datos sintéticos y usuarios por rol; comandos de iniciar, detener y restaurar; modo desarrollo y build de producción local. Guía y límites: [`entorno-local-4360.md`](./entorno-local-4360.md). Probado al montarlo: sesión real, RLS por rol, ficha con grupos y calculadora en dev y en build local (humo 5/5 en cada uno), escritura real por la RPC de la 298 y restaurar a la foto inicial.

# AG. Plan restante consolidado de #43/#60 (2026-11-11) — sin reabrir decisiones
**Método aprobado por el dueño:** completar todo el alcance en local, por partes internas auditadas y probadas; **un único Preview final y un merge por PR (#448 abierto)**; sin pushes ni redeploys por subpartes. Si el Preview final muestra un defecto, se detiene y se explica antes de otra publicación. La 297 está aplicada; las migraciones nuevas se prueban en local y el SQL remoto lo ejecuta el dueño. Flexible/no reembolsable, fuera de alcance (D1).

| Parte | Contenido (decisiones ya aprobadas) | Estado | Migración |
|---|---|---|---|
| 1 · 2 · 3 | Esquema inactivo (293), motor por noche (#446), propuesta y editor de grupos (295) | En Producción | aplicadas |
| 3b | Calculadoras por grupo (297) + parámetros por grupo (298) | 297 aplicada; **298 y su código en local** | 298 provisional |
| **3c Activación** | V.1 activar en una transacción desde la propuesta (sin copiar ni vender solo; cancelar sin cambios); volver a «todos los días» eligiendo qué se conserva; V.2 actualizar / reemplazar grupo / reemplazar hotel con alcance exacto y huella; V.3 borrar con promociones dependientes resueltas antes; W empates por rangos al activar (N4); calculadoras y CSV escriben tarifas reales por grupo (clave con grupo en la 203) comparando la versión; retirar el candado de la 293 solo dentro de esta migración | **Implementada en local (§AH), sin aplicar** | 299 provisional |
| **4 Promociones** | X/N1 base primero y su promoción; O no crea disponibilidad, todas las noches; Y/H10 restricción por días; P noche bonificada elegida (más barata, más cara, última; heredadas = promedio); S/T monto fijo con unidad (persona·noche, habitación·noche, persona·estadía; heredadas = unidad anterior; no aplica si supera la tarifa; reparto exacto) | **Implementada en local (§AI), sin aplicar** | 300 provisional |
| **5 Acumulación y precedencia** | Q/R pregunta solo si puede coincidir; acumulable o orden explícito sin preselección; recorrido determinista; rechazar contradicciones; Z/P3 versión autorizada sigue mientras el cambio queda pendiente de activar | Pendiente | nueva |
| **L Límite de 30 noches** | AA.2 global, constante única, servidor y formularios, sin recortar, históricos intactos | Pendiente; **requiere** los 3 puntos de AA.4 (receptivos, cotización/contrato manuales, productos ya configurados con más de 30 noches) | no prevista |
| **6 «Desde» real** | U estadía completa más económica vendible, con noches, precio y fecha de entrada; empate por entrada más temprana; al generar; sin EBB/Long Stay (P7); reproducible | Pendiente; depende de 4 y L | nueva |
| 7 Paridad y cierre | Recorridos completos en el entorno local, hoja técnica, un único Preview | Al final | — |

**Pendientes reales que no son decisiones nuevas**
1. **Confirmar números** de las migraciones nuevas (298 y las de 3c, 4, 5, 6) con #75/#97 al escribirlas.
2. **AA.4** (solo bloquea la entrega L): alcance de receptivos, cotización/contrato manuales y productos configurados con más de 30 noches (este último, con una consulta de solo lectura).
3. **Datos de hoteles 9, 78 y 172** (solo impiden que esos hoteles adopten grupos) y corrección del hotel 53 (scripts listos, la ejecuta el dueño).
4. Confirmar «festivo» = no en la v1 y la lectura de compra de L.2 (no bloquean).
5. Derivados [D] de §6 de la especificación (base del descuento fijo, presentación sin estadía vendible, límites del «Desde» tras medir): se confirman con ejemplos al construir.

**Orden de trabajo propuesto:** 3c → 4 → 5 → (L, en cuanto se respondan los 3 puntos de AA.4) → 6 → 7. Cada parte: implementación local + migración (preflight, postcheck, rollback protegido) + pruebas SQL, concurrencia con dos sesiones, PostgREST por rol, puras, React con contadores de solicitudes y StrictMode/reposo, compatibilidad con el código anterior y recorrido en `local4360`. Al final: un único Preview y merge de #448.

## AF.13 Aislamiento del entorno local cerrado (revisión de Codex) — 2026-11-11
Defectos señalados: variables asignadas en la terminal sin restaurar; Next podía cargar `.env` por su cuenta y no estaba demostrado el aislamiento de correo, pagos, webhooks y otras integraciones; `NODE_OPTIONS` con 8 GB en un equipo sin memoria.

Corrección (`supabase/scripts/local4360/`): la app corre en un **proceso hijo con entorno armado desde cero** (mínimo del sistema + lo local; la terminal no se toca y se verifica al salir); **no arranca si hay `.env*`** en la app (solo mira nombres); **guardia de red** precargada en todos los procesos Node de la app que rechaza toda conexión no loopback antes de DNS (excepción: fuentes públicas de `next/font`), con registro de intentos; telemetría y atajo de login apagados; **solo 127.0.0.1**; memoria **3 GB dev / 4 GB build / 2 GB start** con comprobación de memoria libre y **dev y producción excluyentes** (candado + puertos).

Comprobado sin llamadas reales al exterior (`local4360.ps1 aislamiento`): 17/17 (credenciales del usuario no pasan; claves y URL locales; 7 destinos externos —Supabase de producción, Resend, Brevo, Wompi, webhook, telemetría, IP pública— bloqueados antes de conectar; gateway local responde; base sin claves de correo; terminal igual) y las negativas (`.env` presente, memoria insuficiente, puerto de la otra app ocupado, candado vivo). Datos sintéticos conservados (no se restauró ni se borró nada).

**Diferencias de esquema documentadas** en `entorno-local-4360.md` §4: faltan 286, 288–292 (y la 296 aplicada en Producción no está en esta rama). El entorno **no** es una validación integral: contratos, confirmación de ventas, cartera, obligaciones, comisiones B2B y DTM no se validan aquí hasta incorporar esas dependencias. La 298 sigue pendiente de auditoría.

**Estado al cierre:** la app no se arrancó en esta ronda: el equipo tenía ~0,5 GB libres y el script se niega correctamente (necesita ~3,5 GB para dev). No se detuvo ningún servicio ajeno.

**AF.13 · corrección (2026-11-11):** la guardia aceptaba como loopback cualquier host que empezara por «127.» (también dominios). Ahora solo `localhost` o una IP literal válida de loopback (`net.isIPv4/isIPv6` + `net.BlockList`: 127.0.0.0/8, ::1, ::ffff:127.0.0.0/104); `127.ejemplo.com` y `127.0.0.1.nip.io` se bloquean antes de DNS. Batería de aislamiento repetida: **21/21**, sin conexiones externas reales. Documentado que la guardia protege solo los procesos Node de la app (no el navegador ni los contenedores). Humo con sesión real bajo el lanzador nuevo **pendiente**: había ~0,47 GB libres y el control de memoria (sin cambios) impide arrancar dev (~3,5 GB) y build (~4,5 GB); se hará primero en desarrollo y después en producción local, nunca a la vez.


# AH. Entrega 3c implementada en local: activación controlada y tarifas reales por grupo (2026-11-12; sin commit, sin aplicar)

## AH.1 Numeración y alcance
- **Migración 299 PROVISIONAL** `20260601000299_grupos_dias_activacion.sql`: revisados todos los worktrees y ramas (296 = #75, aplicada; 297 de este frente, aplicada; 298 de este frente, local y pendiente de auditoría); 299 libre. **No depende de la 298** (probada con y sin ella; si se aplican las dos, la 298 va primero). Siguiente libre: 300.
- **No edita la 293, la 295 ni la 297** (aplicadas): las funciones suyas que cambian se **redefinen** en la 299, y su rollback restaura literalmente las originales (comprobado byte a byte, ver AH.5).

## AH.2 Modelo
La **propuesta** (295) es el **borrador** de cada grupo; las tarifas por grupo de `tarifa_hotel` (`grupo_id` no nulo) son lo que **se vende**. Lo vigente se sigue vendiendo mientras se edita el borrador.
| Operación (V.1–V.3) | Cómo queda | RPC |
|---|---|---|
| Activar (primera vez) | «Aplicar a la venta»: en UNA transacción activa los grupos, quita las tarifas «todos los días» de la vigencia y pone a la venta exactamente la propuesta. Cancelar = no confirmar (nada cambia) | `grupos_dias_activar` |
| Actualizar / reemplazar un grupo / reemplazar la vigencia | Los tres modos de la 295 sobre el borrador (panel, calculadora por grupo o CSV); luego «Aplicar cambios a la venta» muestra el alcance exacto (antes → después por grupo, celda y campo) y aplica. Solo se reescriben las filas que cambian (historial con motivo `grupos_aplicar`) | `grupos_dias_guardar_propuesta` + `grupos_dias_activar` |
| Descartar el borrador | La propuesta de los grupos que se venden vuelve a ser exactamente lo vigente | `grupos_dias_descartar` |
| Volver a «todos los días» | Por cada combinación vendida por grupos se elige de qué grupo se conserva la tarifa o «No conservar»; nada viene elegido; sin elegir todas no se ejecuta. Los grupos quedan preparados con su propuesta | `grupos_dias_volver_todos` |
| Borrar un grupo que se vende | Sus tarifas salen de la venta (historial `grupos_borrar`), sus bases y su propuesta se borran; el texto dice que sus días salen de la cobertura (puede aplicar otra vigencia o quedar sin venta) sin afirmar que se cierran ventas | `grupos_dias_borrar_con_bases` (297) → `grupos_dias_borrar` (redefinida) |
| Reemplazar todo el hotel (calculadora general) | Conserva, como las de compra cerrada, las vigencias que se venden por grupos y las promociones calculadas desde ellas; las informa | `generar_tarifas_hotel_calculadora` (redefinida) |
**Lectura del alcance** (`grupos_dias_alcance`, una solicitud): configuración + todo lo que la base exige, calculado por ella: habilitaciones, empates (simulando la propuesta aplicada), reglas de edad, sugerencias obsoletas, días sin grupo y si hay cambios pendientes.

## AH.3 Garantías en la base (no dependen de la aplicación)
- **Candado de la 293 retirado**, pero activar o desactivar grupos y escribir tarifas por grupo **solo desde las RPC** (marca de transacción `app.grupos_43_rpc`, que PostgREST no deja poner). `authenticated` pierde la escritura directa de `hotel_temporada_grupos`. Fuera de las RPC solo se permite la cascada del renombre de la vigencia.
- **Huella** (PT409 = «recarga»): la de la 295 ahora cubre también las tarifas vigentes por grupo y la regla de edad del hotel. Candados en el orden de la 293; las RPC que escriben tarifas toman sus filas `FOR UPDATE` antes del candado del hotel (sin ascender un candado compartido).
- **Habilitaciones**: la RPC exige que las confirmadas sean **exactamente** las que calcula (ni de menos ni de más). Habitación: >0 se vende (0 = no aplica); niño: no nulo; infante: nunca es habilitación (sin tarifa viaja gratis).
- **Regla de edad** (G.4): no se aplica si la regla efectiva (fila ?? hotel ?? 0-2/3-10) difiere entre grupos de una combinación. **Sugerencias obsoletas** (la tarifa de origen cambió tras aceptarla): no se aplica. **Compra cerrada**: ni aplicar, ni volver, ni borrar un grupo que se vende.
- **Empates (N4, W.3)**: detector en SQL `_grupos_43_empates` con la misma regla que el motor (rangos y blackouts, compra posible ≤ la noche, régimen, día cubierto por el grupo, neto no nulo por acomodación), agrupado en rangos de noches; cada par sobre el cruce completo de sus fechas (más de 1.096 noches = «no verificable», bloquea) y 200 conflictos por respuesta con aviso de recorte (AH.10). Se comprueba **al aplicar** (simulando) y además con un **trigger de restricción diferido** en `tarifa_hotel`, `hotel_temporadas` y `hotel_temporada_grupos`: cualquier transacción que deje un empate en un hotel con grupos activos se rechaza al confirmar, venga de donde venga (edición de prioridad o fechas, tarifa nueva, CSV, calculadora). Serializada por hotel con un candado propio: dos cambios válidos por separado que juntos empatan no pasan los dos (probado con control negativo, AH.5). Hoteles sin grupos activos: sin cambios (dos vigencias sin grupos empatadas siguen como hoy).
- **Días de un grupo que se vende**: no se cambian (cambiarían la venta sin revisión). El nombre sí.

## AH.4 Aplicación
| Archivo | Cambio |
|---|---|
| `lib/hoteles/activacionGrupos.ts` (nuevo, puro) | `planActivacion` (antes → después por grupo frente a lo que se vende ESOS días; bloqueos; avisos; habilitaciones con su texto; confirmación concreta V.4), `puedeAplicar`, `payloadHabilitaciones`, `planVolver`/`payloadVolver`, `textoEmpate` |
| `grupos-actions.ts` | `leerAlcanceGrupos`, `aplicarGruposVenta`, `descartarBorradorGrupos`, `volverATodosLosDias`: una RPC cada una; las que cambian la venta (aplicar, volver, borrar un grupo que se vendía) revalidan la ficha y regeneran el tarifario **una vez**; descartar no. Prefijos técnicos fuera de los mensajes |
| `GruposDiasPanel.tsx` | Estado (preparado / se vende), sección **Venta** (revisar → bloqueos, cambios, habilitaciones una por una sin nada marcado y «Confirmar todas» explícito, efectos; aplicar), descartar, volver con elección por combinación; días de grupos activos bloqueados; columna «Se vende hoy» |
| `alcanceGrupos.ts` | `ConfigGrupos` con `estado`/`vigentes`; `textoBorrado` para grupos que se venden (y el último no se borra) |
| `HotelDetalleClient.tsx`, `[id]/page.tsx` | Etiqueta «preparado» / «se vende por grupos»; las tarifas por grupo muestran su grupo y «Se edita en Grupos de días» en vez de editar/eliminar |
| `CalculadoraEditor.tsx`, `CalculoGrupoPanel.tsx` | «Calcular para» marca los grupos que se venden; el cálculo queda en el borrador. La calculadora general avisa qué vigencias se venden por grupos, las saca de su vista previa y del resultado |
| `promoCalculadora.ts`, `contextoGeneracionTarifas.ts`, `hoteles/actions.ts` | `separarFilasConGrupos` (servidor y vista previa); el contexto lee los grupos en la misma lectura de vigencias (0 solicitudes nuevas); sustituir una promo calculada desde una vigencia con grupos, rechazado |
| `hoteles/actions.ts` › `cargarTarifasMasivo`, `producto/hoteles/page.tsx` | **CSV con columna `grupo`**: esas filas van al BORRADOR del grupo (1 lectura de vigencias + 1 lectura y 1 RPC «actualizar» por vigencia, atómico por vigencia); una fila sin netos o con un grupo inexistente rechaza la vigencia; una fila sin grupo para una vigencia que se vende por grupos recibe un mensaje claro |
| `historialTarifas.ts` | Motivos `grupos_aplicar`, `grupos_volver_todos`, `grupos_borrar` |
| `types/database.ts` | RPC nuevas |

## AH.5 Pruebas ejecutadas (local; Postgres `pg4360`, plantilla `local4360_base`)
| Prueba | Resultado |
|---|---|
| `test_299_grupos_dias_activacion.sh` (sin y con la 298): preflight (7 OK) → 299 → postcheck (10 OK, huellas de tarifas, propuestas y grupos idénticas) → reaplicar → **68 aserciones** (permisos por rol, guardas, alcance, rechazos atómicos de huella/edades/habilitaciones/empate/compra cerrada/sin propuesta/obsoleta, aplicar exacto con historial, borrador con venta activa, calculadora por grupo, descartar, protecciones de la calculadora general y «reemplazar todo», empates por edición directa, borrar, volver, hotel sin grupos) → rollback abortado con grupos activos → volver → rollback → **las 6 funciones restauradas idénticas a las originales** → reaplicar | 0 fallos (las dos variantes) |
| `test_299_concurrencia.sh`, dos sesiones reales: cambio de tarifa de origen, de propuesta, doble aplicación simultánea (se aplica una vez), calculadora frente a descartar, aplicar frente a borrar ⇒ B espera el candado y recibe PT409; **escritura sesgada de empates**: exactamente uno confirma; control (otra vigencia) pasa; invariantes (sin mezcla, sin tarifa con grupo inactivo, sin empates) | 7 carreras + 3 invariantes, 0 fallos |
| Control negativo de la serialización de empates (base desechable): con la comprobación ralentizada 1 s, **sin** el candado los dos cambios confirman y queda un empate guardado; **con** el candado uno se rechaza | demostrado |
| `test_299_postgrest.sh` (PostgREST v16.4, JWT por rol) con el mismo cálculo del panel: permisos (anon 401, venta 403, Minorista lee y no aplica), una solicitud por operación, aplicar exacto, repetir = 409, PATCH de tarifa por grupo 403, POST de grupo 403, **empate por PATCH directo = HTTP 400 al confirmar y nada cambia**, volver, historial | 28 OK, 16 solicitudes |
| `pruebas/gruposDias299.test.ts` (puras, acciones con cliente simulado, CSV) | 18 / 18 |
| `pruebas/gruposDias299.react.ts` (panel real; contadores; nada marcado; bloqueos; obsoleta sin reintento; activo; volver; último grupo; StrictMode y reposo) | 7 / 7 |
| Pruebas del frente (`gruposDias295`, `calculadoraGrupos297`, `motorGrupos43*`; React 295/297/ficha) | 101 + 47, 0 fallos (cableado actualizado: revalidar/regenerar solo al cambiar la venta) |
| Suite unitaria completa | 9.344 / 9.374: 30 fallos **no clasificados** hasta compararlos con una base equivalente (AH.11); ninguna de esas pruebas lee un archivo tocado aquí, pero eso no prueba que sean previos |
| `tsc`, ESLint de lo tocado | 0 errores, 0 avisos |
| **`next build` y humo con la app** | **NO ejecutados**: 1,5 GB libres con los servicios encendidos (dev exige 1,9 GB y build 1,8 GB; el umbral no se bajó). El build local existente quedó DESACTUALIZADO (15 archivos) y `start` se niega a servirlo. Se ejecutó en su lugar el recorrido por el gateway con sesiones reales de GoTrue sobre los datos sintéticos (5/5) |

## AH.6 Solicitudes (`VALIDACION_CONSUMO_VERCEL.md`)
| Acción | Solicitudes | Recarga |
|---|---|---|
| Ver la ficha | 0 nuevas (grupos incrustados, como antes) | — |
| Revisar la aplicación a la venta | **1** (`grupos_dias_alcance`, ~3 KB) | ninguna |
| Marcar habilitaciones, elegir en «volver» | 0 | — |
| Aplicar / volver / borrar un grupo que se vende | **1 RPC** + 1 `revalidatePath` + la regeneración del tarifario de siempre | 1 |
| Descartar el borrador | 1 RPC | ninguna |
| Calculadora general | 0 nuevas (grupos en la misma lectura de vigencias) | igual que antes |
| CSV con grupo | 1 lectura de vigencias + (1 lectura + 1 RPC) por vigencia con filas de grupo | igual que antes |
Sin sondeos, sin reintentos automáticos, sin efectos que se retroalimenten (probado con StrictMode y reposo). En la base: cada transacción que toca tarifas, vigencias o grupos suma una comprobación diferida por hotel (un candado y un `EXISTS`; el detector completo solo si el hotel tiene grupos activos).

## AH.7 Derivados que el dueño debe confirmar (no reabren decisiones aprobadas)
1. **Borrador + aplicar**: con la vigencia a la venta, los cambios por grupo se preparan en el borrador y «Aplicar cambios» aplica **todos** los pendientes de la vigencia a la vez, con su alcance detallado (V.2 se cumple en el borrador: actualizar / reemplazar grupo / reemplazar vigencia).
2. **«Desde» de porción**: al aplicar grupos por primera vez en un hotel, su «Desde» publicado de porción terrestre **deja de mostrarse** (el motor ya falla cerrado con precios por día hasta la entrega 6). La revisión lo avisa. Es un efecto comercial visible.
3. **Promociones calculadas desde una vigencia con grupos** (Dubai/Mixta, por `temporada_base`): conservan sus precios; la calculadora general deja de regenerarlas hasta las promociones por grupo (entrega 4).
4. **Días de un grupo que se vende**: no se cambian; se vuelve a «todos los días» o se borra el grupo y se crea otro.
5. **El último grupo que se vende** no se borra: se usa «Volver a todos los días».
6. **Habilitaciones** se confirman otra vez al aplicar, aunque ya se hubieran decidido en la calculadora (es la única compuerta que también cubre lo escrito a mano y el CSV).
7. **Notas** distintas entre grupos se permiten y se muestran; solo la **regla de edad** debe coincidir (G.4).
8. **Empates**: se analiza el cruce completo de cada par; un cruce de más de 1.096 noches es «no verificable» y bloquea (AH.10). El control diferido también rechaza ediciones de una vigencia **sin** grupos que empatarían con una que se vende por grupos (W.2).

## AH.8 Orden de despliegue y dependencias
preflight_299 → **299** → postcheck_299 → código. El código anterior (3b) funciona con la 299 aplicada (no la usa; ningún grupo se activa al migrar). El código nuevo **exige** la 299 (RPC nuevas, `estado`/`vigentes` en la configuración). Si se aplica la 298, va antes. Rollback: `rollback_299_grupos_dias_activacion.sql` (protegido: aborta con grupos activos o tarifas por grupo; para llegar a cero, «Volver a todos los días»).

## AH.9 Entorno local
`local4360.ps1 preparar` incluye la 299 y `semilla_local4360_3c.sql` (vigencia **PUENTE** de LOCAL 1, 15–17 mar 2027, prioridad 1, doble Estándar/PAM: compite con la Semana de ALTA). Aplicadas **en el lugar** a `dspacios_local4360` y a la foto `dspacios_local4360_semilla` (preflight y postcheck en OK; no se restauró nada: se conserva el estado de la validación de la 3b). Guía del dueño: `entorno-local-4360.md` §6. Humo ampliado con comprobaciones de solo lectura de la 3c.


## AH.10 Correcciones de la auditoría de la 3c (2026-11-12; la 299 sigue local, se corrigió su archivo)
**1 · Empates en una misma transacción.** Defecto: `tg_empates_43` marcaba hotel + transacción como «comprobado» y saltaba todo lo posterior; una escritura con empate DESPUÉS de una comprobación (`SET CONSTRAINTS … IMMEDIATE`, o dentro de una RPC) pasaba. **Reproducido** con la versión anterior (control negativo: PUENTE quedó en prioridad 1 con el empate guardado). Corrección: marca de **«hay cambios sin comprobar»**: un trigger normal y barato (`trg_43_empates_marca`, se ordena antes) la enciende en cada escritura de `tarifa_hotel`, `hotel_temporadas` y `hotel_temporada_grupos`; la comprobación diferida corre solo si está encendida y la apaga. Se conserva el candado por hotel entre sesiones (R4 y su control negativo siguen igual). Costo: varias filas de un commit = **una** comprobación (medido: 40 filas → el detector corrió 1 vez, `pg_stat_user_functions`); en modo inmediato, una sentencia de varias filas puede comprobar más de una vez (solo pasa al final de las RPC, sin escrituras después). Pruebas nuevas: J1 (dentro de una función) y la transacción del cliente con sentencias separadas (BEGIN → válida → SET CONSTRAINTS IMMEDIATE → empate → COMMIT): se rechaza todo, también la primera.

**3 · Horizonte.** Defecto: el detector miraba solo desde hoy hasta hoy + 1.095 días y no decía nada de lo que quedaba fuera. Corrección: por cada par se analiza el **cruce real completo** de sus fechas futuras (también compra), sin ventana fija; si el cruce supera **1.096 noches** el par se devuelve como **`no_verificable`** (con sus fechas y noches) y **bloquea** igual que un empate, con el mensaje «No se pueden verificar empates entre A y B … acota las fechas»; con más de 200 conflictos se agrega `truncado` (la lista no se recorta en silencio). Pruebas: J3 (empate en 2031, antes invisible, detectado con su rango exacto), J4 (cruce 2027–2030 = 1.461 noches → no verificable), J5 (aplicar con él → rechazado), y las del texto en la pantalla.

**2 · Consumo real del recorrido.** Medido con el **código real** (`aplicarGruposVenta` → RPC → `revalidatePath` → regeneración → `generarTarifario`) contra una base local desechable y su PostgREST, con un proxy que cuenta cada consulta (`supabase/scripts/medir_299_recorrido.sh`; solo se sustituyen la cookie de sesión, `next/cache` y `server-only`).
- **Navegador:** cada acción es **1 POST** (Server Action); su respuesta trae la ficha revalidada (un solo `revalidatePath` del recorrido). Revisar = 1 POST; marcar casillas y elegir = 0. Las `revalidatePath` que hace cada `generarTarifario` publicado (2 por paquete) invalidan otras rutas, no generan solicitudes del navegador.
- **Consultas internas y CPU** (Node; base local en Docker, sin red):

  | Escenario | Consultas a la base | Concurrencia máx. | Tiempo | CPU Node |
  |---|---|---|---|---|
  | Revisar (alcance) | 1 | 1 | 66–105 ms | 16–78 ms |
  | Aplicar · hotel **sin paquetes** | 2 (RPC + paquetes del hotel) | 1 | 137–150 ms | 31–78 ms |
  | Regenerar 4 paquetes que **publican** (antes de aplicar) | 37 | 8 | 506 ms | 453 ms |
  | Aplicar · hotel con **4** paquetes | 38 | 6–8 | 526–624 ms | 109–421 ms |
  | Aplicar · hotel con **8** paquetes | 74 | 8 | 989 ms | 655 ms |
  ~9 consultas por paquete; crece lineal con los paquetes del hotel.
- **Acotado:** el recorrido usa `regenerarTarifariosDeHotelAcotado` — **2 paquetes a la vez** (antes, todos en paralelo); la concurrencia de consultas queda en ≤ 8 (2 paquetes × sus lecturas en paralelo). Las demás regeneraciones de la app no cambian. Con publicación por lotes (`TARIFARIO_PUBLICACION_POR_LOTES=1`) un paquete que no termina queda «en publicación» y la base lo continúa sola (se informa como tal).
- **Resultado honesto:** la acción devuelve cuántos paquetes se regeneraron, cuántos siguen en publicación y **cuáles fallaron**; la pantalla lo dice tal cual y **nunca** afirma «todo actualizado» si alguno falló o si no se pudo consultar qué paquetes usan el hotel.
- **(Corregido en AI.10: la generación anterior queda OCULTA en la vista comercial; el paquete deja de mostrarse, no muestra precios viejos.)** **Hallazgo medido (efecto provisional entre incrementos):** con el hotel vendiéndose por grupos, sus paquetes de **porción terrestre NO se pueden regenerar** («No se generaron tarifas»: el motor no publica un «desde» aproximado hasta la entrega 6) y **conservan publicada su generación anterior**, con los precios de todos los días (medido: generación publicada 1 de 2). La revisión ahora lo anticipa con el número de paquetes de porción del hotel (`paquetes_porcion` en el alcance). **Por eso la 3c no se publica sin la entrega 6.**

**4 · Fallos de la suite unitaria.** Ver AH.11 (comparación por nombre con una base equivalente).

## AH.11 Suite unitaria comparada por nombre con una base equivalente (2026-11-12)
Base = worktree desechable en el `HEAD` de la rama (`5974d4136`, sin ningún cambio local: ni la 3b sin confirmar, ni la 298, ni la 3c), con el mismo `node_modules` (junction), los mismos parámetros (`--test-concurrency=2`, heap 1 GB) y comparación por **nombre** de cada prueba fallida en todos los niveles (subpruebas incluidas).
| Corrida | Pruebas | Fallos (todos los niveles) | Fallos solo aquí |
|---|---|---|---|
| Base (`HEAD`) | 9.352 | 49 | — |
| Actual, primera corrida | 9.378 | 51 | **2**: `regenerarTarifariosDeHotel captura explícitamente error…` y `…corta y loguea el error saneado…` |
| Actual, tras corregir | 9.378 (9.348 pasan) | 49 | **0** |
Los 2 nuevos los causó esta ronda: había movido la consulta de `regenerarTarifariosDeHotel` a un helper y dos pruebas de cableado leen ese texto. Se devolvió la función a su forma original (la variante acotada usa el helper aparte). Los **49 restantes fallan igual en la base**: son anteriores a todo el trabajo local de este frente (no se investigaron más; están en archivos de otros frentes). El worktree base se quitó después (junction primero; `node_modules` del worktree comprobado intacto).


# AI. Entrega 4 implementada en local: promociones por grupo (2026-11-12; sin commit, sin aplicar)

## AI.1 Numeración y alcance
- **Migración 300 PROVISIONAL** `20260601000300_promociones_grupo.sql`. Revisados todos los worktrees y ramas: el máximo era la 299 (este frente); 296 = #75 (aplicada). **Exige la 293 y la 299**; no depende de la 298 (la ficha del hotel sí la usa). Siguiente libre: 301.
- No edita ninguna migración aplicada ni la 298/299 (locales): todo lo nuevo vive en la 300.
- Alcance: X/N1, O, Y/H10, P y S/T de la especificación §4. **No** introduce acumulación ni precedencia nuevas (entrega 5): ver AI.5.

## AI.2 Modelo
| Pieza | Cómo queda |
|---|---|
| Promoción **por noche con reglas** (porcentaje, monto por persona/noche, monto por habitación/noche) | Vigencia de promoción con `promo_base_id` (FK a UNA vigencia `tarifa` del mismo hotel) + filas en `hotel_promocion_reglas`: una por grupo de la base (`grupo_id`, o una sola con grupo NULL si la base no tiene grupos), con su `valor` y sus `dias` (NULL = todos los días del grupo; si no, subconjunto no vacío del grupo). Grupo sin regla = conserva la base. |
| Noche gratis | `noche_gratis_regla` (`mas_barata`/`mas_cara`/`ultima`; NULL = promedio heredado) + `dias_promo` (días bonificables; NULL = todos). |
| Monto fijo | `descuento_unidad` (`persona_noche`/`habitacion_noche`/`persona_estadia`; NULL = «unidad anterior»). Persona/estadía usa `descuento_valor` y `dias_promo` = días de **entrada**. |
| Promociones existentes | Todas las columnas nuevas en NULL: mismo cálculo y misma etiqueta («$/pax», ahora con «(unidad anterior)»; «promedio (anterior)»). La 300 no cambia ninguna fila (postcheck: huellas idénticas). |

**Decisión APROBADA por el dueño el 2026-11-12 (AJ.0) — el precio con reglas se DERIVA al cotizar, no se materializa.** La promoción con reglas no tiene filas propias en `tarifa_hotel`: el motor aplica la regla sobre la tarifa de la base que GANA esa noche. Razones: (1) el monto por habitación/noche y el de persona/estadía solo se pueden resolver al cotizar (S.2); (2) con tarifas por grupo que se editan en el borrador y se aplican (3c), una fila materializada de promoción quedaría obsoleta en cada cambio de la base; derivarla la mantiene coherente con lo que se vende; (3) «base primero» (N1) es exactamente eso. El dato autoritativo es la regla (como una tarifa): cambiarla cambia la cotización al instante y el tarifario al regenerarse (igual que editar una tarifa). Las promociones existentes (Dubai/Mixta, filas manuales) siguen siendo filas materializadas.

## AI.3 Motor (`lib/calc/paquetes.ts` + `lib/calc/promocionesGrupo.ts`, puro)
Por noche:
1. **Recorrido de siempre** sobre bases y promociones con fila (sin las de estadía ni las de reglas). Sin grupos y sin reglas: resultado idéntico al anterior (golden E3: 360.000 sigue igual).
2. **Base de la noche** (solo vigencias `tarifa`, con cobertura del día, disponibilidad y N4). Si la base con grupos cubre la noche sin tarifa o empata: la noche no se vende y **ninguna** promoción la rescata (O.1.2; tampoco una existente sin vínculo, X.3.5).
3. **Alcance con grupos** (X.3.1): la base ganadora tiene grupos, o existe una promoción con reglas vinculada a ella. Ahí compiten solo las promociones de **esa** base: las existentes cuya fila tiene `temporada_base` = la base (por nombre) y las de reglas con regla para el grupo y el día de esa noche; gana la de mayor prioridad. Igual prioridad con su base o entre dos promociones ⇒ empate N4 (no se vende y se registra). Menor que su base ⇒ no aplica. Una existente vinculada a una base con grupos que **no** gana esa noche no aplica (X.2: 690.000).
4. **Regla** (`netoConRegla`): `%` ⇒ neto × (1 − v/100); persona/noche ⇒ neto − D si D ≤ neto; habitación/noche ⇒ (neto × ocupantes − D) / ocupantes si D ≤ tarifa de la habitación; niños e infantes no generan habitación. Si no aplica, no cuenta (§T.4) y sigue la siguiente o la base.
5. Con reglas, `temporadaTarifa` = la base (la edad y las condiciones se leen de su fila) y `temporadaGanadora` = la promoción (procedencia «promoción»).

Por estadía (`resolverPromoEstadia`, sobre las noches ya valoradas): la primera, por prioridad, que cubre la noche de entrada (compra y régimen) y **aplica**: noche gratis sin regla ⇒ `total × (N−1)/N` (mismo número que antes); con regla ⇒ resta una noche (más barata / más cara / última) entre las permitidas, «última» con su día no permitido ⇒ no aplica; persona/estadía ⇒ resta D una vez si el día de entrada está permitido y D ≤ total. El «desde» de porción **sin** grupos aplica la misma regla sobre N noches iguales a la más barata.

Contexto nuevo de los liquidadores (`basePromoPorClave`, `acomodacion`; firmas compatibles): lo pasan los cinco cargadores (cotización por fechas/carrito, reserva, vigencia/visibilidad, generación y publicación). Las variantes simples (`liquidarHotelNoches`, `liquidarHotelMasBarato`) delegan en las de identidad: un solo cálculo.

## AI.4 Garantías en la base (300)
- `check` de coherencia: unidad solo en monto; regla de noche gratis solo en noche gratis; días solo en noche gratis o persona/estadía, 1–7 sin repetir y no vacíos; vínculo solo en `%` o monto por noche (con `coalesce`: una comparación con NULL dejaría pasar la fila; lo detectó la prueba B9).
- Trigger de vigencias: la base es `tarifa` del mismo hotel; **la promoción tiene mayor prioridad que su base y distinta de otra promoción de la misma base** (también al editar la prioridad o el tipo de la base); no se desvincula por fuera del editor si tiene reglas.
- Trigger de reglas: grupo de SU base (sin grupo solo si la base no tiene grupos); días dentro del grupo («Los días elegidos en X deben pertenecer al grupo Y»); `%` < 100.
- Trigger de grupos: no se borra un grupo con reglas, no se achican sus días por debajo de una regla y una base con regla «todos los días» no se divide en grupos sin resolverla antes (V.3: las promociones dependientes se resuelven primero).
- `promocion_guardar_reglas` (SECURITY INVOKER: decide la RLS de quien llama): vínculo + reglas en UNA transacción, comparando la **foto** que vio quien edita (PT409 = recargar, sin reintento). RLS de `hotel_promocion_reglas` igual a la de los grupos (293): internos; escritura del catálogo global solo en sesión Mayorista; anon sin acceso. Auditoría (087) adjunta.
- «Elegir es obligatorio» en promociones nuevas lo exigen el formulario y la acción (`lib/hoteles/promocionesVigencia.ts`, la misma función en los dos lados); la base solo valida valores (no distingue una nueva de la copia de una existente).

## AI.5 Interfaz con la entrega 5 (sin acumulación ni precedencia nuevas)
- Hoy: por noche gana **una** promoción de la base (prioridad); por estadía aplica **una** (la primera que aplica); EBB / Long Stay se aplican después como hoy (`aplicarDescuentoNeta`). Es exactamente la combinación que ya existía (promoción con fila + noche gratis + EBB).
- Enganche para la 5, sin reescribir el motor: la lista de candidatas por noche (`cands` en `resolverNetoNocheDetallado`) y el recorrido de estadía (`resolverPromoEstadia`) ya separan «qué promociones cumple esta reserva» de «cuál se elige»; la 5 sustituye la elección por el orden y la acumulación configurados. La procedencia ya identifica la promoción ganadora de cada noche y la de estadía.

## AI.6 Aplicación
| Archivo | Cambio |
|---|---|
| `lib/calc/promocionesGrupo.ts` (nuevo, puro) | Tipos, `SELECT_PROMO_VIGENCIA`, `netoConRegla`, `nocheABonificar`, `repartirExacto` (T.3: 20.000 / 3 = 6.666,67 + 6.666,67 + 6.666,66, en la unidad mínima de la moneda) |
| `lib/calc/paquetes.ts` | AI.3; `toTemporadaRango` lee las columnas y reglas incrustadas |
| `lib/calc/netosPorTemporada.ts` | `basesPromoDeFilas` (vínculo `temporada_base` por clave) |
| `lib/reservar/{liquidacionHotel,cotizar,computo}.ts`, `lib/tarifario/vigencia.ts`, `paquetes/actions.ts` | `${SELECT_PROMO_VIGENCIA}` dentro de la misma lectura de vigencias; `temporada_base` en las tarifas; contexto a cada liquidador |
| `lib/hoteles/promocionesVigencia.ts` (nuevo, puro) | Validación sin valores por defecto; mensajes claros para los rechazos de la 300 |
| `producto/hoteles/actions.ts` | Crear/editar vigencia con las elecciones; por habitación solo con ocupación estándar (1 lectura de `hotel_acomodaciones`, solo en ese caso); `guardarReglasPromocion` (1 RPC); copiar vigencias conserva las elecciones y avisa que el vínculo y las reglas no viajan |
| `HotelDetalleClient.tsx`, `PromocionReglas.tsx` (nuevo), `[id]/page.tsx` | Selectores sin opción preelegida («Elige…» / «Promedio (anterior)» / «Unidad anterior»), «Todos los días» o «Elegir días» sin nada marcado, panel «Reglas por grupo» (base de menor prioridad, regla por grupo, solo los días del grupo) |
| `calculadoras.ts`, `CalculadoraEditor.tsx`, `contextoGeneracionTarifas.ts` | La Mixta no deriva filas de una promoción con reglas |
| `types/database.ts` | Columnas, tabla y RPC |
| Pruebas y soporte | `pruebas/promocionesGrupo43{.test,.acciones.test,.react}.ts`, `promocionesGrupo300.pg.mjs`, `support/stubs/promocionReglasActionsStub.mjs`; `supabase/scripts/{preflight,postcheck,rollback,test}_300_*`, `test_300_carrera.sql`, `test_300_postgrest.sh`, `cierre_43_precios_antiguos.{sh,mjs}` |

## AI.7 Pruebas ejecutadas (local)
| Prueba | Resultado |
|---|---|
| `pruebas/promocionesGrupo43.test.ts` (motor puro + validación): Y.2 520.000 / 510.000; §4 375.000; X.2 690.000 (existente y nueva), sin grupos 360.000, invariancia de prioridad, otra base 630.000; O.4 sin rescate y sin estadía parcial; S.2 680.000 / 740.000 / 760.000; T.3 (80.000, 40.000, 15.000, 0, 0), noches del mismo niño por separado, habitación una vez y nunca a niños; Y.2 persona/estadía 530.000 y entrada jueves sin descuento; P.2 300.000 / 250.000 / 250.000, promedio 266.667, días lun–jue 300.000 / 300.000 / 400.000; reparto exacto; paridad con `evaluarHotelPorFechas`; validación sin preselección | 43 / 43 |
| `pruebas/promocionesGrupo43.acciones.test.ts` (acciones con cliente simulado y cableado de los cinco cargadores) | 11 / 11 |
| `pruebas/promocionesGrupo43.react.ts` (panel: 0 solicitudes al editar, nada elegido, días del grupo, 1 acción al guardar, desvincular, foto obsoleta sin reintento, StrictMode y reposo) + caso nuevo en `hotelPestanas22.react.ts` (noche gratis nueva exige elegir; existente se guarda con su promedio) | 3 / 3 y 12 / 12 |
| Caracterización y motor previos (`motorGrupos43`, `vigenciasPrecedencia43`, `hotelPorFechas43`, `precioFinalAutoritativo`, `liquidacionHotel`, `vigenciaNuncaDerivaPrecio`, `liquidarHotelNochesConTemporadas`) | 161 / 161 sin cambios |
| Cableado actualizado (texto, no comportamiento): `motorGrupos43.wiring` (el `select` es plantilla con las promociones), `precioFinalAutoritativoWiring` (los liquidadores reciben además el vínculo; las variantes simples delegan; la estadía sale de `resolverPromoEstadia`) | 98 / 98 |
| React de la ficha y de grupos (`hotelPestanas22`, `gruposDias295`, `calculadoraGrupos297`, `gruposDias299`) | en verde (stub nuevo en el cargador React) |
| `test_300_promociones_grupo.sh` (pg4360, `local4360_base`): preflight 4 OK → 300 → postcheck 8 OK y huellas idénticas → reaplicar → **39 aserciones** → carrera con dos sesiones (B espera el candado y recibe PT409; queda solo lo de A) → rollback abortado con reglas → rollback → reaplicar | 0 fallos |
| Suite SQL de la 299 con la 300 aplicada | 76 OK, 0 fallos |
| `test_300_postgrest.sh` (PostgREST v16.4, JWT por rol): los SELECT exactos de los cargadores y de la ficha responden 200 con grupos y reglas (la tabla de reglas no vuelve ambigua la relación vigencias → grupos); venta 403, Minorista 403, foto obsoleta 409, venta no ve reglas, anon 401 | 10 OK, 10 solicitudes |
| `tsc`, ESLint de lo tocado | 0 errores (3 avisos previos, ajenos) |
| **`next build` y humo de la app** | **NO ejecutados** (pendientes del código final, como pidió el dueño) |

## AI.8 Solicitudes (`VALIDACION_CONSUMO_VERCEL.md`)
| Acción | Solicitudes |
|---|---|
| Cotizar, reservar, generar, visibilidad, ficha | **0 nuevas**: columnas y reglas en la misma lectura de vigencias; `temporada_base` ya venía con `*` o se suma a la misma lectura |
| Editar reglas / elegir días | 0 |
| Guardar reglas | 1 Server Action = 1 RPC + 1 `revalidatePath` + la regeneración del tarifario de siempre |
| Crear/editar vigencia | igual que antes; +1 lectura de `hotel_acomodaciones` solo si se elige «por habitación y noche» |
| CPU | por noche, un recorrido de solo bases además del de siempre, en memoria y solo cuando hay promociones o grupos alrededor |

## AI.9 Orden de despliegue y dependencias
preflight_300 → **300** → postcheck_300 → código. **El código nuevo exige la 300** (los `select` piden columnas y la relación nueva; sin ella fallan cerrado). El código anterior funciona con la 300 aplicada (no la usa). Orden total: (298) → 299 → 300 → código. Rollback: `rollback_300_promociones_grupo.sql` (protegido: aborta si alguna promoción usa la 300).

## AI.10 Prueba de cierre «sin precios antiguos» y corrección de AH.10
Pedida para el cierre integral: `supabase/scripts/cierre_43_precios_antiguos.sh` (código real de las acciones contra PostgREST local; 2 paquetes de porción con el hotel). Pasos: publicar con «todos los días» → **activar** → **actualizar** una tarifa por grupo y aplicar → **volver a todos los días**. Criterio: tras cada operación, ningún paquete puede tener VISIBLE (vista comercial única `tarifario_resultado_publicable`, 260) una generación anterior a la operación (FALLO); un paquete que deja de mostrarse es AVISO.

| Modo | Activar | Actualizar | Volver |
|---|---|---|---|
| Sin publicación por lotes | AVISO: los paquetes de porción **dejan de mostrarse** (regeneración fallida, ninguna fila visible) | sin filas visibles | generación nueva publicada |
| `TARIFARIO_PUBLICACION_POR_LOTES=1` | igual; las filas de la generación anterior quedan en la tabla **ocultas** (solo las ve la ficha interna del paquete, que lee la tabla a propósito para diagnosticar) | igual | igual |

**Corrección:** AH.10 decía que esos paquetes «conservan publicada su generación anterior, con los precios de todos los días». Medido con la vista comercial: el puntero de generación publicada no se mueve, pero la vista la oculta (`tarifario_snapshot_publicable` falso). **No se ven precios antiguos; el paquete de porción deja de mostrarse** (AH.7.2). La conclusión no cambia: la 3c (y la 4) no se publican sin la entrega 6. En el cierre integral esta prueba debe dar 0 FALLO **y 0 AVISO** (con la entrega 6 los paquetes de porción deben publicar su «Desde» por estadía). Hoy: 0 FALLO, 2 AVISO en «activar».

## AI.11 Derivados [D] que el dueño debe confirmar (no reabren decisiones aprobadas)
1. ~~Precio derivado al cotizar~~ — **aprobado** (AJ.0).
2. **Ámbito**: las reglas por noche también sirven para una base **sin** grupos (una regla «todos los días» con días elegidos); N1 rige para esas promociones nuevas. Las existentes de hoteles sin grupos no cambian.
3. **Prioridad**: ≤ su base se rechaza; igual a otra promoción de la misma base solo si pueden coincidir (**corregido en AJ.2**).
4. ~~Ocupación estándar~~ — **corregido en AJ.3**: ocupación del hotel en todos los recorridos.
5. **Mínimo de noches** de una promoción con reglas = mínimo de la estadía para que aplique (como en la noche gratis); no limita la venta.
6. **Una promoción de estadía por reserva** (la primera que aplica): persona/estadía y noche gratis no se acumulan entre sí hasta la entrega 5.
7. **Dubai «descuento solo sobre la base»** no se replica en las reglas por grupo (el `%` actúa sobre el neto del grupo).
8. Copiar vigencias de otro hotel: las elecciones viajan; el vínculo y las reglas (ids de ese hotel) no, con aviso.
9. ~~La revisión de «Aplicar a la venta» no lista las promociones~~ — **corregido en AJ.4**.

## AI.12 Integración al cierre de la entrega (suite unitaria, comparada por nombre)
- Suite completa actual (`--test-concurrency=2`, heap 1 GB): 9.432 pruebas, 9.401 pasan, 31 de primer nivel fallan, en 22 archivos.
- La misma suite en un worktree desechable en `HEAD` (5974d4136) **fue detenida por falta de memoria** del equipo (no se relanzó). En su lugar se corrieron **esos 22 archivos** en los dos árboles con los mismos parámetros y se compararon los nombres de todos los niveles: **una sola diferencia**, la huella congelada de `lib/calc/paquetes.ts` en `salidaVinculada63Wiring.test.ts` (y su prueba padre). Es un cambio deliberado del motor: la huella se actualizó con su motivo (`c43b0031eded8bbc`). Los demás fallos de esos archivos fallan igual en la base.
- Límite: un fallo nuevo en un archivo que en la base pasaba entero y aquí también saldría en los 22 (está cubierto); lo que no se comparó es una prueba que hoy pasa aquí y fallaba en la base (no afecta la conclusión).


# AJ. Correcciones de la auditoría de la entrega 4 (2026-11-12; local, la 300 sigue sin aplicar y se corrigió su archivo)

## AJ.0 Decisión del dueño: cálculo dinámico APROBADO
El dueño **aprobó** que las promociones **nuevas** por grupo calculen su precio **al cotizar**, sobre la tarifa de la **base vigente que gana la noche** (AI.2). Deja de ser un derivado pendiente: es **[A]** en la especificación (§4). Se conservan sin cambios las promociones existentes (filas materializadas de Dubai/Mixta y manuales, promedio heredado, «unidad anterior») y todo lo histórico (contratos, cotizaciones, composiciones y tarifarios ya guardados no se recalculan).

## AJ.1 Reparto monetario exacto en el recorrido real (punto 1)
**Defecto:** el descuento por habitación se convertía en una tarifa por persona (`(habitación − D) / ocupantes`), y el recorrido redondeaba ESA tarifa (EBB a centavos USD / pesos, `redondeoCentavos`) y la multiplicaba por los pasajeros: se perdían o ganaban centavos (USD, triple: 2 × 3 × 27,00 = 162,00 en vez de 161,98).
**Corrección:**
- El motor devuelve, cuando una noche lleva descuento por habitación, el **neto exacto de UNA habitación** en la estadía y el descuento aplicado (`habitacion: { ocupantes, total, descuento }`), calculado sobre la habitación completa, sin dividir (también la promoción de estadía: noche gratis y persona/estadía se aplican sobre ese total con la misma operación).
- **Cotización por fechas / carrito** (`evaluarHotelPorFechas`): `netosHabitacion` por acomodación, con el EBB y el redondeo a centavos aplicados **una sola vez** sobre el total de la habitación.
- **Reserva** (`computo.ts`): `netoHabitacionPorAcom` (EBB una vez por habitación). El **costo del hotel y la CxP** de la reserva y del carrito salen de la misma función (`costoHotelPersona`): habitaciones × neto exacto de la habitación; las acomodaciones sin ese descuento siguen con tarifa por persona × pax (idéntico a antes).
- **Snapshot / documento interno** (`cotizacion_composicion`, `ComposicionPrecio`): la línea de habitación guarda y muestra el neto exacto por habitación, el descuento, su **reparto por ocupante** con `repartirExacto` (residuo a los primeros, suma exacta) y el neto de hotel de la línea. `leerComposicion` lo valida al releer.
- **Precio de venta:** conserva la regla de venta vigente (PVP por persona redondeado hacia arriba al mil COP / dólar entero USD, × pax). Ese redondeo de venta ya existía para toda tarifa y no es pérdida del descuento: el descuento es sobre el neto (base aprobada), y el neto queda exacto. **Si el dueño quiere también el PVP por habitación** (redondear la habitación y no la persona), es un cambio de la regla de venta para todos los hoteles: no se hizo.
- Sin descuento por habitación nada cambia (mismas sumas, en el mismo orden; caracterización intacta).

## AJ.2 Prioridades: solo bloquea lo que puede coincidir (punto 2)
**Antes:** la base rechazaba cualquier par de promociones de la misma base con la misma prioridad. **Ahora:** se rechaza solo si **pueden coincidir** en una noche que se pueda vender (`_promo_300_conflictos`): régimen compatible; existe una fecha de reserva ≥ hoy en las dos ventanas de compra (y ≤ la noche); la noche la cubren las dos promociones y su base (rangos menos blackouts); y ese día tiene regla en las dos (mismo grupo de la base, días elegidos). Se consideran todos los grupos de la base (también los preparados: coincidirían al venderse). Cruce > 1.096 noches ⇒ «no verificable» y bloquea. La **acomodación** no las separa en v1 (toda promoción por noche aplica a las habitaciones; el monto por habitación no aplica a niños, donde el motor ya decide sin empate). Se comprueba con **trigger de restricción diferido** en `hotel_temporadas` y `hotel_promocion_reglas`, serializado por base con un candado (dos cambios válidos por separado que juntos empatan no confirman los dos). El mensaje nombra las dos promociones, la prioridad, la base y una noche concreta, y no se elige ninguna. Promoción con prioridad ≤ su base: sigue rechazada (siempre coinciden). Si un conflicto llegara al motor: empate N4, la noche no se vende.

## AJ.3 Ocupación autoritativa del hotel (punto 3)
Se retiró la restricción «solo ocupación estándar» y la tabla fija 1/2/3/4 del motor. Los ocupantes **tarifados** de cada habitación salen de `hotel_acomodaciones.pax_tarifa` (sin fila: `PAX_TARIFA_DEFAULT`, exactamente como la reserva), leídos **dentro** de lecturas que ya existían: reserva (`paxTarifa`), cotización por fechas (`armado_hoteles → hoteles → hotel_acomodaciones`), generación del tarifario (misma lectura de hoteles). Sin ocupantes el descuento por habitación **no aplica** (nunca se supone). Niños e infantes no son ocupantes tarifados: no reciben el descuento por habitación ni cuentan para repartirlo. La visibilidad del tarifario (`vigencia.ts`) no lo necesita: una promoción no cambia si una noche se vende.

## AJ.4 «Aplicar a la venta» revisa las promociones vinculadas (punto 4)
- La configuración de grupos (299) se **envuelve** en la 300 (la función original se conserva con otro nombre, `_grupos_43_config_299`, y el rollback la restaura idéntica — comprobado por md5): agrega `promociones_reglas` (cada promoción vinculada con prioridad, fechas, compra, régimen y reglas: grupo, días, valor) y `promociones_conflictos`, y su **huella** las cubre: cambiar una promoción o sus reglas entre «Revisar» y «Aplicar» rechaza la aplicación (PT409).
- La RPC de reglas toma, en el mismo orden que la aplicación (grupos → vigencia base), candados compartidos (`_promo_300_candado_base`): guardar reglas y aplicar a la venta sobre la misma base se serializan sin interbloqueo.
- La revisión (`planActivacion`) dice: al aplicar por primera vez **EMPIEZAN a aplicarse** las promociones por grupo (con cada grupo, días y valor, y qué grupos conservan la base); en una actualización **siguen**. Un conflicto entre promociones **bloquea** la aplicación. «Volver a todos los días» avisa que **dejan de aplicar** (quedan guardadas). El aviso de las promociones existentes y el de los paquetes de porción se corrigieron (estos **dejan de mostrarse**, AI.10).

## AJ.5 Pruebas (local)
| Prueba | Resultado |
|---|---|
| `pruebas/promocionesReparto43.test.ts`: triple 840.000 exacto; sin ocupantes no aplica; sin descuento = cálculo de siempre; doble tarifada con 3 personas (280.000, no 180.000); sin configuración = valor de la reserva; niños sin descuento; USD + EBB: habitación 80,99, 2 habitaciones 161,98 (la vía por persona daría 162,00); acomodaciones mixtas; composición guardada y releída con reparto 3,34 + 3,33 + 3,33 y 6.667 + 6.667 + 6.666; cableado de reserva, computo, cotización y generación | 15 / 15 |
| `promocionesGrupo43` (43) + `.acciones` (11) + `gruposDias299` (27, con 5 nuevas de la revisión) + resto del frente, caracterización y cableado | 494 / 494 |
| React (`promocionesGrupo43`, `hotelPestanas22`, `gruposDias295/297/299`) | 59 / 59 |
| `test_300_promociones_grupo.sh`: **56 aserciones** (nuevas: igual prioridad sin días comunes, con miércoles común, compras que no se cruzan, abrir la compra, régimen distinto, régimen libre, fechas que no se cruzan, ampliarlas hasta el 20 ene, acomodación, no verificable; revisión y huella de la aplicación), carrera de foto obsoleta, **carrera de escritura sesgada** (exactamente una confirma, ningún conflicto guardado), rollback protegido y restauración idéntica de la configuración de la 299 | 0 fallos |
| Suite SQL de la 299 con la 300 | 76 OK |
| `test_300_postgrest.sh` (+ revisión por HTTP con las promociones, conflicto real rechazado al confirmar y el no conflicto aceptado, lectura `armado_hoteles → hoteles → hotel_acomodaciones`) | 14 OK |
| `cierre_43_precios_antiguos.sh` | 0 FALLO (2 AVISO: porción deja de mostrarse, hasta la entrega 6) |
| `tsc`, ESLint de lo tocado | 0 errores (avisos previos ajenos) |
| **`next build` y humo** | **pendientes** |

## AJ.6 Lo que queda
- PVP por habitación (AJ.1, último punto): decisión del dueño si lo quiere.
- La acomodación no separa promociones en v1 (AJ.2).
- `build` y humo del árbol final.


# AK. Entrega 5 implementada en local: acumulación y precedencia con EBB / Long Stay (2026-11-12; sin commit, migración 301 provisional, sin aplicar)

## AK.0 Decisiones aplicadas (del dueño)
- **Solo EBB y Long Stay:** gana el mayor porcentaje y no se suman (regla vigente, sin cambios).
- **Con una promoción especial:** rige la acumulación y el orden **configurados según el proveedor**, solo para esa promoción y solo cuando esa promoción aplica a la reserva.
- **Se pregunta solo cuando pueden coincidir** (estadía máxima 30 noches, §3.8, para Long Stay).
- **Regla añadida o modificada después** que crea una combinación sin resolver: se **avisa y se retiene**; la versión autorizada sigue vendiéndose.
- No se inventan prioridades ni se cambia nada existente: lo que ya coincidía al aplicar la 301 queda **«heredada»** y acumula exactamente como hoy (golden 264.000 frente a 330.000).

## AK.1 Modelo (migración `20260601000301_promociones_acumulacion.sql`, provisional, exige la 300)
- `hotel_promocion_combinacion` (1 fila por promoción, solo si coincide con alguna regla): `estado` `heredada` | `configurada` | `pendiente`, `alternativas` (familias que coinciden), `acumulable_ebb`, `acumulable_long_stay` (sí/no, sin valor por defecto) y `orden` (explícito cuando algo no acumula o coinciden las dos reglas). RLS de lectura interna; escritura solo por RPC.
- `hotel_reglas_descuento.autorizada` / `propuesta`: una regla **nueva** que crea pares sin resolver nace `autorizada = false`; un **cambio** de una regla autorizada queda en `propuesta`. El motor solo lee las autorizadas (`soloAutorizadas` en `cargarReglasDescuentoHotel` y `cotizar.ts`).
- Coincidencias (`_e5_requeridas`): EBB de U días coincide si la última noche aplicable de la promoción queda a ≥ U días de la reserva más temprana posible (hoy o el inicio de su compra); Long Stay de U noches, si U ≤ 30 y la promoción tiene alguna noche vendible. Una compra cerrada o sin noches aplicables no coincide con nada.
- Revisión (`_e5_revisar`) en **disparadores de restricción diferidos** sobre vigencias, reglas, reglas por grupo y combinaciones, serializada por hotel: promoción **nueva** (alta, o sus primeras reglas por la RPC de la 300) que coincide ⇒ `pendiente`; cualquier otro cambio que deje pares sin resolver ⇒ **rechazado** (`COMBINACION_SIN_CONFIGURAR`, nada cambia); dos promociones **configuradas** que pueden coincidir y deciden distinto sobre las reglas que **ambas** contemplan ⇒ rechazado (`CONTRADICCION_PROMOCIONES`). Una regla que una de ellas aún no contempla no es contradicción: le falta configurarla.
- RPC: `promocion_guardar_combinacion(promoción, combinación, cambios?)` (con `cambios`, el cambio de la promoción y su combinación en **una** transacción), `regla_descuento_guardar` (aplica o retiene y devuelve qué falta), `regla_descuento_aplicar`, `regla_descuento_descartar`, `promociones_combinacion_estado` (lo que muestra la ficha).

## AK.2 Motor (`lib/calc/precedenciaPromociones.ts`, puro)
`resolverPrecedencia` (R.4): sin promoción aplicada ⇒ mayor % (vigente); con promoción **heredada o sin fila** ⇒ comportamiento vigente (la regla del mayor % sobre el total con la promoción); con promoción **configurada** ⇒ se recorre el orden del proveedor con las alternativas que **esta** reserva cumple, se incluye la primera y cada siguiente solo si acumula con todas las incluidas; si la promoción queda fuera, la regla actúa sobre el neto **sin** la promoción (`liquidarConPrecedencia` re-liquida solo con las bases: la promoción no crea disponibilidad). Configurada sin respuesta para una regla que la reserva cumple, o dos configuraciones contradictorias en la misma estadía ⇒ **falla cerrado**: esa acomodación no se vende y se informa (no se elige nada implícito). Las promociones `pendiente` las ignora el motor (`entradasNoche`): se sigue vendiendo la base.

Dónde se aplica (la misma decisión en precio y costo):
- **Cotización por fechas / carrito** (`evaluarHotelPorFechas`): por acomodación; si la precedencia decide otro descuento que el de la estadía, `combo.descuentoPorAcom` (la etiqueta mostrada sale del combo elegido).
- **Precio publicado** (`computo.ts`): el generador guarda en la composición publicada las promociones que aplicaron y el **neto sin ellas** (`BaseMotor.promociones`); al cotizar, con la fecha de compra real y la combinación **vigente**, se decide y se recompone el PVP desde el neto que corresponde (el precio publicado se sigue verificando contra su composición).
- **Costo y CxP de la reserva** (`computo.ts`, `costoConPrecedencia`): misma decisión con las vigencias vivas.

## AK.3 Ficha del hotel
- «Promociones» (`HotelPromociones.tsx`): reglas **retenidas** (y cambios retenidos) con «Aplicar» / «Descartar cambio»; aviso de qué promociones falta configurar; lista «Promociones especiales frente a EBB / Long Stay» con su estado (heredada / configurada / pendiente) y «Configurar» (`CombinacionPromo.tsx`: acumula sí/no **sin valor por defecto**; el orden se arma explícitamente y solo cuando hace falta).
- Vigencias (`HotelDetalleClient.tsx`): una promoción pendiente lo dice en su fila. Editar una promoción que se vende de forma que cree una coincidencia sin configurar: el cambio se **guarda como pendiente** (ver P3 abajo) y la ficha ofrece configurarlo y activarlo en ese momento; si se cierra, sigue en «Promociones».
- **P3 completo (2026-11-12, pedido del dueño): cambio PENDIENTE persistente de una promoción que se vende.** Solución mínima, sin versionar las vigencias: tabla `hotel_promocion_cambio_pendiente` (una fila por promoción: `cambios` = las columnas editables, `base` = la vigencia tal como estaba al proponer, `faltan`). RPC `promocion_cambio_proponer` (simula el cambio en un subbloque que se deshace para saber qué faltaría; si no falta nada lo aplica directo), `promocion_cambio_activar` (con la combinación si hace falta; en UNA transacción: candado de la fila y del hotel, rechaza `CAMBIO_NO_PENDIENTE` si otra sesión ya lo activó o descartó, `CAMBIO_CONCURRENTE` si la vigencia cambió desde que se propuso, y corre la revisión del hotel con `set constraints all immediate`: pares sin resolver o contradicción ⇒ nada queda) y `promocion_cambio_descartar`. El motor no lee la tabla: mientras tanto se vende la versión autorizada. `promociones_combinacion_estado` devuelve `cambio_pendiente` (con `desactualizado`), así que al cerrar y reabrir la ficha el cambio sigue para revisar, activar o descartar (`HotelPromociones.tsx`: «Configurar y activar» / «Descartar cambio»; desactualizado ⇒ solo descartar). Activar arrastra un renombre igual que un guardado normal. Acciones: `activarCambioPromocion`, `descartarCambioPromocion`; `actualizarTemporada` devuelve `cambioPendiente`.
- **Etiqueta por acomodación (2026-11-12):** si la precedencia decide un EBB / Long Stay distinto por acomodación, la etiqueta ya no muestra el de la principal como si fuera de todas: `descuentoMostrado` (`precedenciaPromociones.ts`) arma una por acomodación pedida («Doble: EBB · … · Triple: Long Stay · …», o «sin EBB / Long Stay») en `computo.ts` (reserva, cotización guardada, tarjeta), `cotizarPorFechas` (cada combo trae la suya; la UI muestra la del combo elegido) y la búsqueda general. La composición guardada acepta la forma mixta (`porAcomodacion`, sin tipo/umbral/pct). Importes y redondeo PVP sin cambios.

## AK.4 Pruebas (local)
| Prueba | Resultado |
|---|---|
| `pruebas/precedencia43.test.ts`: R.2 (616.000 / 595.000 / 630.000 / 700.000; el orden manda sobre el mayor %), solo reglas ⇒ 595.000, R.5 (554.400 / 554.400 / 595.000), heredada y sin fila = golden 264.000, pendiente ignorada, configurada incompleta falla cerrado, S.1 contradicción, formulario de combinación, mensajes, composición publicada con promociones; **etiqueta por acomodación** (doble EBB 616.000 / triple Long Stay 476.000 por persona; mixta, una sola acomodación, «sin EBB / Long Stay», composición mixta) | 30 / 30 |
| `pruebas/precedencia43.react.ts`: estado visible (retenida, pendiente), sin valores por defecto, orden obligatorio con dos reglas, 1 acción al guardar, sin orden con una sola regla acumulable, aplicar una retenida; **P3**: el cambio pendiente se ve al abrir la ficha, «Configurar y activar» = 1 acción con todas las reglas, descartar = 1 acción, desactualizado no ofrece activar | 7 / 7 |
| `test_301_promociones_acumulacion.sh` (pg4360, base desechable): preflight → 301 → postcheck (huellas de reglas y vigencias idénticas, línea base heredada) → reaplicar → **49 aserciones** (coincidencias EBB / Long Stay / compra cerrada; promoción nueva pendiente; regla nueva retenida, escritura directa rechazada al confirmar; configurar con orden, contradicción y su solución; régimen distinto no contradice; editar una promoción que se vende: rechazado, y el mismo cambio con su combinación aceptado; primeras reglas por la RPC ⇒ pendiente; permisos) → **K (P3, 17 aserciones)**: proponer ⇒ pendiente con lo que falta, la versión vendida no cambia, el motor no lo ve, la ficha lo ve; activar sin combinación o incompleta ⇒ rechazado sin cambiar nada; con combinación ⇒ aplicado en una transacción; segunda activación ⇒ `CAMBIO_NO_PENDIENTE`; un cambio que no crea nada se aplica directo; edición ajena ⇒ desactualizado y activar ⇒ `CAMBIO_CONCURRENTE`; descartar; no mueve de hotel; anon no propone ni activa → **sesiones reales**: el pendiente persiste y se lee desde otra conexión; dos activaciones simultáneas ⇒ una aplica y la otra `CAMBIO_NO_PENDIENTE`; edición directa concurrente ⇒ `CAMBIO_CONCURRENTE` y nada cambia → rollback protegido (aborta también con cambios pendientes) → rollback → reaplicar. Total 69 aserciones SQL | 0 fallos |
| `test_300_promociones_grupo.sh` con la 300 actual | 0 fallos |
| **Recorrido real** `recorrido_43_e5.sh` (código real de las acciones contra base + PostgREST desechables): promoción pendiente ⇒ se cotiza la base con EBB; con la combinación guardada por la acción de la ficha: cotizar por fechas → crear cotización (composición guardada con el reparto por ocupante) → convertir a contrato → **releer de la base** `ventas.costo_hotel` y la CxP del hotel. Descuento −20.000 por habitación y noche, 2 dobles + 1 triple, 3 noches, EBB 12 %: **acumula ⇒ 1.610.400** (2 × 475.200 + 660.000); **no acumula, EBB primero ⇒ 1.768.800** (2 × 528.000 + 712.800), exactos en costo y obligación. **Ampliado (2026-11-12):** hotel 9307 con decisión distinta por acomodación (doble: promoción + EBB; triple: Long Stay): cotizar doble 297.000 / triple 287.000 (redondeo de siempre), etiqueta «Doble: EBB … · Triple: Long Stay …», composición guardada mixta, contrato con costo y CxP **1.638.900** exactos; **P3** real con las acciones: abrir la compra de una promoción que se vende ⇒ pendiente persistente (se relee desde otra conexión), se sigue vendiendo la versión autorizada (319.000), dos activaciones simultáneas ⇒ una aplica, después se vende el cambio (264.000) | 0 fallos |
| Unitarias afectadas (128 archivos que tocan lo cambiado) | solo quedan los 7 archivos que ya fallan igual en HEAD (comparado por nombre en un worktree de HEAD) |
| React de la ficha (`hotelPestanas22`, `gruposDias295/297/299`, `promocionesGrupo43`, `reglasDescuentoCarga90`, `vigenciasFechas43`) | 70 / 70 |
| Unitarias que tocan lo cambiado (200 archivos, 4.926 pruebas, 2026-11-12) | solo fallan los 17 archivos que fallan igual en HEAD (comparado por nombre de prueba en un worktree de HEAD); los 4 que este cambio rompía (etiqueta ×2, `actualizarTemporada`, conteo de rechazos del contrato manual) se ajustaron con su motivo |
| React de la ficha y formularios tocados (13 archivos) | 133 / 133 |
| `tsc` | 0 errores |
| **`next build` y humo** | **pendientes** |

## AK.5 Orden de aplicación y lo que queda
- Orden: 300 → preflight_301 → **301** → postcheck_301 → código. Rollback: `rollback_301_promociones_acumulacion.sql` (protegido: aborta si hay combinaciones configuradas, promociones pendientes o reglas retenidas).
- Con la 301 el código lee `hotel_reglas_descuento.autorizada` y `hotel_promocion_combinacion`: no desplegar este código antes de aplicarla.
- Limitación conocida: las coincidencias dependen de «hoy» (una promoción puede dejar de coincidir con el tiempo; nunca empieza a coincidir sola). Un cambio pendiente queda «desactualizado» si alguien edita la versión vendida: se descarta y se rehace.
- Siguen: entrega L (límite global de 30 noches, también receptivos y documentos manuales; primero diagnóstico de productos antiguos) y entrega 6 («Desde» real). `build` y humo del árbol final.


# AL. Entrega L implementada en local: estadía máxima global de 30 noches (2026-11-12; sin commit, sin migración)

## AL.0 Decisión aplicada
Aprobado por el dueño: límite de **30 noches** para todo lo nuevo, todos los tipos (bloqueo, empaquetado, dinámico, porción, programas), **receptivos** y **documentos manuales** (AA.4.1 y AA.4.2 cerrados). «Configurable» = **un valor por capa, sincronizado y verificado**: `MAX_NOCHES_VIAJE` (`lib/reglas/duracionViaje.ts`, el único del código) y `public._e5_max_noches()` (la base: coincidencias de la 301 y CHECK de la 302). **Cambiar el TypeScript no cambia el SQL** (corrección de auditoría: la afirmación anterior de «único lugar» era inexacta). `pruebas/limiteNochesSincronia43L.test.ts` falla si difieren (lee la ÚLTIMA migración que define la función) y comprueba también los dos scripts que repiten el número a propósito (postcheck de la 301 y el diagnóstico, que se corre antes de aplicar la 301). **Para cambiar el límite con la 301 ya aplicada:** una migración nueva que redefina `_e5_max_noches()` con el valor, el mismo cambio en `MAX_NOCHES_VIAJE` y en esos dos scripts, en un único despliegue (migración primero, código después). Sin consultas por cotización y sin panel de configuración (AA.2). Nunca se recorta; mensaje único: «La estadía máxima es de 30 noches; elegiste 31. Ajusta las fechas.».

## AL.1 Dónde se valida (servidor = frontera)
| Punto | Regla |
|---|---|
| Consultas por fechas: `cotizarPorFechas`, `buscarHoteles`, **`buscarReceptivos`**, tarjeta, búsqueda por unidad (`validarRangoFechasConsulta`) | `MAX_NOCHES_CONSULTA = MAX_NOCHES_VIAJE` (antes 60) |
| Ítems del carrito / solicitudes del portal | también por las fechas del ítem |
| Reserva por fechas (`computarReserva`) | noches de la estadía |
| Programa (`reservarPrograma`) | noches incluidas + adicionales |
| Paquete (noches), salida dinámica, bloqueo (alta y **carga masiva**: la fila se lista rechazada), empaquetado, programa (noches y salidas) | al crear: rechazo; **al editar: solo si la duración cambia** (`validarNochesAlEditar` / `validarFechasAlEditar`): un producto antiguo de más de 30 noches se conserva tal cual hasta que el dueño decida con el diagnóstico |
| Cotización manual y contrato manual **nuevos** (el contrato, antes de reservar el consecutivo) | fechas de salida y regreso; los guardados se consultan, imprimen y editan como hoy |

Formularios: `max` y aviso con la misma constante en noches del paquete (`ConfigForm`), del programa (`CabeceraForm`) y de sus salidas (`ProgramaEditor`); `ProductoTab` dejó su `max={30}` suelto. Las búsquedas y formularios de fechas muestran el mensaje del servidor.
Fuera: anticipación de compra, EBB, Long Stay y noches mínimas conservan sus reglas.

## AL.2 Diagnóstico de productos antiguos (lo corre el dueño; no se ejecutó SQL remoto)
`supabase/scripts/diagnostico_L_productos_mas_30_noches.sql`: **un único SELECT de solo lectura** (`orden|control|observado|esperado|estado|detalle`): productos que se siguen ofreciendo con más de 30 noches (bloqueos e empaquetados con ida desde hoy, salidas dinámicas, porciones activas, programas y sus salidas vigentes) con hasta 30 identificadores por control, e informativo de cotizaciones y contratos históricos. Si todo da 0, no hay nada que decidir; si no, el dueño decide uno por uno (dejar de ofrecer o corregir a mano). Nada se modifica automáticamente. Probado en local (plantilla): 9 filas, 0 en todo.

## AL.3 Pruebas
| Prueba | Resultado |
|---|---|
| `pruebas/duracionViaje43L.test.ts`: regla pura (30 sí, 31 no, 1→31 válida), edición de productos antiguos, consultas (50 noches antes válidas, ahora no), **llamadas directas a las acciones** con 31 noches (bloqueo, empaquetado, salida, paquete, programa, cotización manual: rechazadas sin escribir; bloqueo de 30 llega a la RPC), cableado de edición, carga masiva, reserva, programa y contrato manual (antes de numerar), una sola definición | 18 / 18 |
| `motorGrupos43.wiring` (el «límite sigue igual» pasó a «es la estadía máxima única») y las de `edadesMenores` (genéricas en la constante) | OK |


# AM. Entrega 6 implementada en local: «Desde» de porción por estadía real (2026-11-12; sin commit, migración 302 provisional, sin aplicar)

## AM.1 Cálculo
`lib/calc/desdeEstadia.ts` → `desdeEstadiaReal`: para cada entrada de la ventana con la salida dentro (entrada + N ≤ fin, nunca antes de hoy) valora la estadía con el **mismo motor de una reserva** (`liquidarHotelNochesConTemporadas` + noches mínimas de `minNochesAplicable`); gana la más económica y, en empate, la entrada más temprana; devuelve total, procedencia, **justificación** (entrada, salida, noches) y **medición**. Sin EBB / Long Stay (P7). Sin candidata vendible o con un límite excedido: **sin «desde»** (nunca aproximado). Solo hoteles **con grupos** (`hotelConGrupos`); los demás siguen por `liquidarHotelMasBaratoConTemporada` sin cambios (la huella de `paquetes.ts` no cambia).

## AM.2 Límites y medición (por combinación y por generación)
- Por combinación: `LIMITES_DESDE` (400 candidatas, 250 ms).
- **Por generación** (todas las combinaciones de todos los hoteles del paquete): `crearPresupuestoDesde` / `LIMITES_DESDE_GENERACION` (4 s y 200.000 evaluaciones; manda el tiempo). Agotado ⇒ lo que falta queda sin «desde» y se cuenta.
- Medición: línea `generarTarifario: desde_estadia paquete_id=… combinaciones=… con_precio=… sin_estadia=… excedidas=… candidatas=… evaluadas=… ms=…` (aviso si hay excedidas). Medido en local: ≈ 19 µs por candidata; 72 combinaciones × 90 días ≈ 6.200 evaluaciones ≈ 120 ms; 150 × 180 días ≈ 26.400 candidatas ≈ 0,4 s; cierre real: 7 combinaciones, 392 evaluaciones, ≈ 9 ms por paquete.

## AM.3 Persistencia (migración 302)
`tarifario_resultado.desde_entrada` (date; CHECK: solo porción y 1 – `_e5_max_noches()` noches). Salida = entrada + noches; categoría, régimen y acomodación están en la fila y la vigencia/grupo en su procedencia. La vista publicable la expone y `tarifario_resumen` añade `desde_entrada_doble` (la de la doble de la combinación). Los dos insertores con lista explícita (`publicar_tarifario_resultado_interno`, `tarifario_lote_agregar_i`) se recrean con el cuerpo de la 256/260 + la columna, **generados** por `supabase/scripts/generar_302_desde_estadia.mjs` (cada sustitución, coincidencia única). Rollback protegido (aborta con justificaciones publicadas; recrea las vistas dependientes con sus permisos).

## AM.4 Lectura, presentación y cotización
- Verificación al leer (`lib/tarifario/vigencia.ts`): con grupos, la fila sigue vigente si **su** estadía sigue vendible (una liquidación por fila); sin justificación no se muestra. Sin grupos, como siempre.
- Tarjeta (`VistaBooking.tsx`, `estadiaDesdeDoble` / `textoEstadiaDesde`): «desde X» y debajo «por persona · N noches · Entrada dd/mm/aaaa», de la fila que origina el «desde» doble.
- Cotizador: sin fechas elegidas, «Ver opciones» abre la porción con esa entrada y salida **precargadas** y cotiza en vivo (`fechasIniciales`).

## AM.5 Pruebas
| Prueba | Resultado |
|---|---|
| `pruebas/desdeEstadia43.test.ts`: ejemplo aprobado (550.000 · entrada 04/01/2027; nunca 500.000), empate, noche no vendible, sin estadía, ventana = N y < N, hoy, noches mínimas, régimen, límites, equivalencia candidata por candidata, precio plano = «desde» de siempre, medición; **presupuesto de la generación** (candidatas y tiempo agotados ⇒ sin «desde», contados) | 19 / 19 |
| `pruebas/desdeEstadia43.react.ts`: tarjeta con noches y entrada; sin grupos, la de siempre; singular | 3 / 3 |
| `test_302_desde_estadia_real.sh` | 0 fallos |
| **Cierre** `cierre_43_precios_antiguos.sh` (con y sin lotes): activar / actualizar / volver; justificación presente solo con grupos y dentro de la ventana; **paridad**: tarjeta «Desde 300.000 · 3 noches · Entrada 01/02/2027» = cotización en vivo 300.000 | **0 FALLO · 0 AVISO** |
| Pruebas de cableado ajustadas con su motivo: `precioFinalAutoritativoWiring`, `publicacionLotesCableado` (5.º argumento de `publicarFila`); `vuelosOperacionesActions.react` (doble con `maybeSingle` para la lectura previa de la entrega L) | OK |

Auditoría final del conjunto: `docs/tecnico/auditoria-final-43-60.md`.
