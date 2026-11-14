# Auditoría final #43/#60 — árbol local (2026-11-12)

Worktree original `dspacios-travel/.worktrees/43-vigencias-dia`; integrado con el lote en `dspacios-travel/.worktrees/43-lote-combinado` (§1.3) (rama `claude/43-60-3b-calculadoras`, HEAD `5974d4136`, cambios sin confirmar). **Todo local: sin commit, push, staging, Preview, SQL remoto ni activación.** Detalle de diseño y decisiones en `vigencias-por-dia-43-60.md` (§AH–AM) y su especificación.

## 1. Inventario

### 1.1 Migraciones
| Nº | Archivo | Estado | Qué hace |
|---|---|---|---|
| 293 | `…293_vigencia_grupos_dias_inactivos.sql` | **Aplicada en Producción** | Esquema de grupos de días, inactivo |
| 295 | `…295_grupos_dias_propuesta.sql` | **Aplicada** | Propuesta de grupos (borrador) |
| 297 | `…297_calculadora_grupos_dias.sql` | **Aplicada** | Calculadora por grupo |
| 298 | `…298_calculadora_grupos_generales.sql` | **Aplicada en Producción 2026-11-13, postcheck OK — INMUTABLE** | Parámetros generales por grupo |
| 299 | `…299_grupos_dias_activacion.sql` | **Aplicada en Producción 2026-11-13, postcheck OK — INMUTABLE** | «Aplicar a la venta», empates, volver a todos los días (3c) |
| 300 | `…300_promociones_grupo.sql` | **Aplicada en Producción 2026-11-13, postcheck OK — INMUTABLE** | Promociones por grupo (entrega 4) |
| 301 | `…301_promociones_acumulacion.sql` | **Aplicada en Producción 2026-11-13, postcheck OK — INMUTABLE** (versión a confirmar con `verificar_version_301_produccion.sql`, ver `cierre-git-43-60-lote.md`) | Acumulación / precedencia con EBB y Long Stay, reglas retenidas, **cambio pendiente persistente (P3)**, `_e5_max_noches()` (entrega 5) |
| 302 | `…302_desde_estadia_real.sql` | **Aplicada en Producción 2026-11-13, postcheck OK — INMUTABLE** | `tarifario_resultado.desde_entrada` + vista publicable, `tarifario_resumen.desde_entrada_doble` y los dos insertores (entrega 6). **Generada** por `supabase/scripts/generar_302_desde_estadia.mjs` desde los cuerpos de la 226/256/260 |

Siguiente número libre: **304** (la 303 la reservó la sesión del lote para #45). Cada provisional tiene `preflight_`, `postcheck_` (una sola consulta, columna de estado), `rollback_` protegido, `fixture_` cuando hace falta y `test_…sh`.

**Estado (2026-11-13): 298 → 302 aplicadas por el dueño en Producción en ese orden, cada una con su preflight y postcheck correctos; NO editarlas, reaplicarlas ni renumerarlas.** Orden con el que se aplicaron: 298 → 299 → 300 → 301 → 302, cada una entre su preflight y su postcheck; **después** el código. El código nuevo lee columnas de la 301 (`autorizada`, `hotel_promocion_combinacion`, `hotel_promocion_cambio_pendiente`) y de la 302 (`desde_entrada`, `desde_entrada_doble`): **no desplegarlo antes**. Rollback en orden inverso (302 → 301 → …), cada uno aborta si hay datos que perderían su sentido.

### 1.2 Código (144 rutas en `git status`: 71 modificadas, 73 nuevas)
Lista completa: `git status --porcelain -- dspacios-travel` en el worktree. Lo principal por entrega:
- **3c / 4 (grupos y promociones por grupo):** `lib/hoteles/activacionGrupos.ts`, `lib/calc/promocionesGrupo.ts`, `lib/hoteles/promocionesVigencia.ts`, `lib/tarifario/regeneracionHotel.ts`, `hoteles/[id]/PromocionReglas.tsx`, `grupos-actions.ts`, `GruposDiasPanel`.
- **5 (precedencia, P3, etiqueta):** `lib/calc/precedenciaPromociones.ts`, `lib/reservar/{liquidacionHotel,cotizar,computo,reglasDescuentoHotel}.ts`, `lib/cotizacion/composicionPrecio.ts`, `hoteles/actions.ts`, `hoteles/[id]/{HotelPromociones,CombinacionPromo,HotelDetalleClient}.tsx`, `reglas-descuento-actions.ts`, `ReservaForm.tsx`, `VistaBooking.tsx`, `cotizarTarjetaActions.ts`.
- **L (30 noches):** `lib/reglas/duracionViaje.ts` y los puntos de AL.1 (paquetes, vuelos, empaquetados, programas, reservar, contratos, cotización manual, `edadesMenores.ts`, formularios).
- **6 («desde» real):** `lib/calc/desdeEstadia.ts`, `paquetes/actions.ts` (generación), `lib/tarifario/{vigencia,desdeDoble,resumen,datos}.ts`, `app/tarifario/{VistaBooking,TarifarioPublic,detalle-actions}.ts(x)`, `types/database.ts`.

### 1.3 Integración con el lote operativo (worktree combinado)
- **Dónde:** `dspacios-travel/.worktrees/43-lote-combinado` (HEAD separado en `5974d4136`, sin rama propia). Los dos originales quedan **intactos**: `43-vigencias-dia` (rama `claude/43-60-3b-calculadoras`) y `lote-mejoras-operativas` (rama `codex/lote-mejoras-operativas`, `8578c266e`, ancestro de `5974d4136`).
- **Cómo se armó:** diff sin confirmar + archivos nuevos de #43/#60 → `git apply -3` del diff del lote + sus archivos nuevos → `pnpm install --frozen-lockfile`. Solapes: `paquetes/ConfigForm.tsx` y `lib/tarifario/resumen.ts`, fusionados sin conflicto (verificado que ambos cambios están).
- **`test:react`:** las 3 pruebas del lote (`seleccionMasiva50`, `receptivosPortada89`, `dashboardCupos59`) registradas al final, después de `precedencia43` y `desdeEstadia43`.
- **Ajuste por la integración:** `pruebas/tarifarioCargaWiring.test.ts` cuenta 4 `prefetch={false}` (antes 3): el 4º es el enlace al inventario de vuelos de la tarjeta de cupos del dashboard (#59 del lote); motivo anotado en la prueba.
- **Migraciones:** el lote no trae ninguna. La **303** la reservó la sesión del lote para #45 (`claude/bloque1-16-45`): el siguiente número libre de #43/#60 sería la **304**.

## 2. Pruebas (todas en el worktree combinado, 2026-11-12, local)
| Prueba | Resultado |
|---|---|
| `tsc --noEmit` | 0 errores |
| `next build` (dependencias reales, caché limpia) | ✓ Compiled successfully (§2.3) |
| SQL 298, 299 (con y sin 298, y concurrencia), 300 promociones, **300 PostgREST con el esquema final (298–302)**, 301 (69 aserciones + P3 con sesiones reales), 302, 293 lectura PostgREST (con 295–302), 295, 297 (todas las variantes), 299 PostgREST | 0 fallos cada una |
| **Recorrido e6** (`recorrido_43_e6.sh`, nuevo): Semana 100.000 / Fin de semana 150.000 → generación → publicación → tarjeta → cotización precargada | 0 fallos: publica **550.000** con entrada 04/01/2027 y 5 noches; la tarjeta anuncia «550.000 · 5 noches · Entrada 04/01/2027»; la cotización precargada da 550.000; la entrada del 05/01 vale 600.000; **nada a 500.000** |
| Recorrido entrega 5 y cierre de precios antiguos | 0 fallos · 0 AVISO (sin cambios respecto al árbol original) |
| Unitarias completas | combinado 9.536 pruebas / 31 fallos · HEAD 9.352 / 30: **los mismos fallos por nombre**; el único exclusivo del combinado (conteo de `prefetch`, §1.3) quedó corregido |
| React completo (1.758 pruebas) | 26 fallos en `comisionPortalB2B` (12), `dinamicoEnPaquetes` (13), `participacionEconomica65` (1): **iguales a HEAD**. Las 3 del lote pasan |
| **Humo** (`humo_43_combinado.sh`, `next start` real + PostgREST + sesión de operaciones) | 0 fallos: 10 rutas con y sin sesión, registro del servidor sin errores |
| **Revisión visual** (Edge sin interfaz por CDP, `captura_cdp.mjs`) | 11 capturas a 375 y 1280 px, **sin desborde horizontal ni errores JS** (§4) |

Fallos ambientales conocidos (no del frente): `test_293_vigencia` y `test_294_mantenimiento` fallan igual en HEAD porque la plantilla local ya tiene la 293/294 aplicadas.

### 2.1 Conteo de solicitudes (aclaración del §3 anterior)
Medido con el proxy del recorrido e6 (solicitudes a PostgREST por operación, antes = HEAD, después = combinado):

| Operación | Sin promociones | Con promociones |
|---|---|---|
| Cotización por fechas (`cotizarPorFechas`) | 7 → 7 | 7 → 7 |
| Reserva de un dinámico publicado (`computarReserva`) | 15 → 15 | 15 → **16** |

La lectura extra (`hotel_temporadas`, combinación de promociones) aparece **solo** cuando la composición publicada trae promociones (`lib/reservar/computo.ts`, `admin:combinacion_promociones`). En la cotización por fechas no hay lectura extra porque la combinación ya viene en el mismo `select` de las vigencias.

### 2.2 Concurrencia de la regeneración (corregido)
Antes, `regenerarTarifariosDe{Hotel,Bloqueo,Servicio}` lanzaba **todos** los paquetes afectados a la vez (`Promise.allSettled`), así que el presupuesto de 4 s por generación no acotaba el total: N paquetes = N generaciones simultáneas. Ahora las tres usan `ejecutarAcotado` con `CONCURRENCIA_REGENERACION = 2` (`lib/tarifario/regeneracionHotel.ts`). Prueba: con 10 trabajos la concurrencia máxima observada es 2 y un fallo no detiene el resto; otra prueba fija que las tres funciones usan el ejecutor acotado. Peor caso: ≤ 2 generaciones en paralelo, cada una ≤ 4 s / 200.000 evaluaciones del «desde».

### 2.3 Build: causa y solución
El fallo de `Plus_Jakarta_Sans` («next/font/google queries have exactly one entry») **no es del código**: HEAD limpio y el combinado compilan bien con dependencias reales y caché nueva. Copiar la carpeta `.next/cache` del worktree original al combinado reproduce el fallo, así que la causa es la **caché persistente de Turbopack contaminada** (Google ahora sirve las fuentes por URLs `fonts.gstatic.com/l/font?kit=…&skey=…`). Solución: borrar `.next/cache`. No se desactivó ninguna validación ni se usó Vercel. La caché del worktree original **no se tocó** (para conservarlo intacto); el dueño puede borrar su `.next/cache` si vuelve a compilar allí.

### 2.4 Pendientes
- Diagnóstico de productos antiguos de la entrega L (`diagnostico_L_productos_mas_30_noches.sql`): lo corre el dueño en Producción (solo lectura).
- Decisión del dueño sobre los fallos previos de HEAD (no son de este frente).
- Aprobación del dueño para el despliegue (orden en §1.1); nada se ha confirmado, subido ni aplicado.

## 3. Consumo
- **Por cotización / reserva:** sin consultas nuevas por P3, la etiqueta por acomodación, L ni el «desde». Única lectura añadida: +1 en la reserva de un dinámico publicado **con** promociones (§2.1).
- **Lectura de la vitrina:** una liquidación de la estadía justificada por fila de porción de un hotel con grupos (antes recorría la ventana noche por noche); las columnas nuevas viajan en las mismas consultas.
- **Generación:** ≈ 19 µs por candidata; acotada por combinación (400 candidatas, 250 ms) y por generación (4 s, 200.000 evaluaciones); agotada ⇒ sin «desde» para lo que falta (falla cerrado) y línea `generarTarifario: desde_estadia … excedidas=N`. Regeneración por cambio de hotel/bloqueo/servicio: **máximo 2 paquetes a la vez** (§2.2).
- **Base:** una columna date en `tarifario_resultado`; la tabla de cambios pendientes tiene una fila por promoción retenida.

## 4. Guía de revisión para el dueño
### 4.1 Evidencia ya capturada (local, sin red externa)
Capturas en la carpeta de la sesión (`…/scratchpad/humo/`): `tarifario-375`, `tarifario-porcion-375`/`-1280` (tarjeta recomendada «$ 550.000 · por persona · 5 noches · Entrada 04/01/2027»), `hotel-9307-promociones-375`/`-1280` (sección Promociones con «PROMO DOBLE» pendiente), `paquete-9601-375`, `dashboard-375`/`-1280` (con la tarjeta «Cupos disponibles» del lote), `paquetes-375`, `reservar-375`. Observación menor, previa a este frente: en `/dashboard/paquetes` a 375 px la tercera pestaña («RECEPTIVOS») queda cortada dentro de su barra desplazable (no desborda la página).

### 4.1 bis Entorno de revisión con login real (`revision_43_combinado.sh`)
`sh supabase/scripts/revision_43_combinado.sh preparar` → `servir` (→ `detener` / `limpiar`). Usa el **build ya validado** (se niega si algún archivo de la app es posterior a `.next/BUILD_ID` o si el build no apunta al gateway local `127.0.0.1:54390`), base sintética `revision43` en pg4360 (plantilla `local4360_base` + 293→302 + fixtures; no toca `dspacios_local4360` ni `lote_revision`), GoTrue y PostgREST propios (`rev43-*`), gateway con CORS en 54390 y `next start` en **http://127.0.0.1:3046** con la guardia de red de local4360. Los datos de revisión se cargan con las **acciones reales** (`recorrido_43_e6.mjs`, modo `revision`): 550.000 / 600.000 del paquete 9601, combinación de «PROMO DOBLE» y tarifario del 9307 (etiqueta por acomodación) y cambio pendiente de «P3 TARDIA». Usuarios sintéticos `dueno@revision43.test` (superadmin) y `operaciones@revision43.test` (operaciones), contraseña `Revision43!`. Verificado en Edge con el login real: 0 fallos.

### 4.2 Cómo reproducirlo
1. Base local: `sh supabase/scripts/humo_43_combinado.sh pg4360 local4360_base <carpeta>` desde `.worktrees/43-lote-combinado/dspacios-travel` (compila, crea una base desechable con 298–302 + datos de prueba, corre el recorrido e6, levanta la app en `http://127.0.0.1:3047` con sesión de operaciones y captura). `H_SIN_BUILD=1` reutiliza el build.
2. Solo el recorrido financiero: `sh supabase/scripts/recorrido_43_e6.sh …` (y `recorrido_43_e5.sh` para contratos/CxP).

### 4.3 Qué mirar en pantalla
1. **Ficha del hotel → Promociones:** reglas retenidas («Aplicar» / «Descartar cambio»); «Promociones especiales frente a EBB / Long Stay» con estado (heredada / configurada / pendiente) y «Configurar».
2. **Cambio pendiente (P3):** editar una promoción que se vende ⇒ «El cambio quedó PENDIENTE…»; cerrar y reabrir ⇒ caja ámbar «Cambio pendiente de activar» con «Configurar y activar» y «Descartar cambio»; si otro la editó, aviso «desactualizado».
3. **Etiqueta por acomodación:** en Reservar y en el modal de la vitrina: «Doble: EBB … · Triple: Long Stay …».
4. **30 noches:** formularios y búsquedas avisan con 31 («La estadía máxima es de 30 noches; elegiste 31. Ajusta las fechas.»).
5. **«Desde» real:** porción de un hotel con grupos ⇒ «desde X · por persona · N noches · Entrada dd/mm/aaaa»; «Ver opciones» abre el cotizador con esas fechas y el mismo total. Un hotel **sin grupos** se ve como antes.
6. **Lote operativo** (mismo árbol): selección masiva (#50), portada de receptivos (#89) y tarjeta de cupos del dashboard (#59).
7. **Móvil 375 px:** nada desborda la página.

## 5. Ajustes tras la revisión del dueño (2026-11-13)
El dueño validó los puntos 1, 2, 4, 6 y 7 de §4.3. Ajustes pedidos, todos locales (sin staging, commit, push, Preview, SQL remoto ni activación):

1. **Aviso de contradicción entre promociones** (la regla comercial NO cambia: sigue siendo `_e5_misma_config` / `mismaConfig`). El aviso ahora nombra las dos promociones, dice **qué decisión difiere** (si una acumula con EBB o Long Stay y la otra no, o el **orden** de cada una) y da **una estadía de ejemplo** que incluye noches de las dos.
   - Al guardar (301, aplicada en Producción 2026-11-13): `_e5_texto_alt`, `_e5_texto_diferencia`, `_e5_ejemplo_estadia` (interna, sin permiso para `authenticated`). El ejemplo sale de las mismas fechas posibles que usa `_e5_coinciden_promos`: una noche en la intersección o, si no se tocan, de la última noche de la primera a la primera de la segunda. Rollback actualizado.
   - Al cotizar (`lib/calc/precedenciaPromociones.ts`): `textoDiferenciaPromociones`; el ejemplo es la propia estadía cotizada.
   - Pruebas: `test_301` E4 (acumulación distinta, texto completo), E4b (solo orden), E4c (fechas separadas), I6 (permiso); `precedencia43.test.ts` (texto completo y caso de acumulación).
2. **Recorrido de promoción nueva por grupo**: hotel sintético **9309 «R43 PROMO NUEVA»** (`fixture_revision_43.sql`, solo para la revisión): base ALTA de febrero 2027 con grupos Semana (L–J, doble 100.000) y Fin de semana (V–D, 150.000) aplicados a la venta con la acción real, **sin ninguna promoción ni fila promocional**; paquete de porción **9605** de 1 noche sin markup (el «desde» es la doble de la Semana). El modo `revision` de `recorrido_43_e6.mjs` ensaya el recorrido con las acciones reales y lo deshace: promoción −10 % con regla en el grupo Semana ⇒ **90.000** automático; base a **120.000** ⇒ **108.000**; en ningún momento existe fila de tarifa para la promoción.
3. **Esc cierra las ventanas**: los diálogos compartidos (`components/ui/dialog.tsx`, base-ui) ya cerraban con Escape (solo el superior; los que protegen «guardando» lo hacen en su `onOpenChange`). Para las ventanas propias se agregó el mecanismo compartido **`components/ui/useEscapeCerrar.ts`**: Escape llama al MISMO manejador que la X / «Cancelar» (conserva sus protecciones), cierra solo la capa superior (pila de capas propias; cede si encima se abrió un popup de base-ui) y no hace nada mientras se guarda. Aplicado a: reglas por grupo, grupos de días, hotel del armado de paquetes, eliminar destino, acciones de pasajero, infante de vuelo, panel de campos del CMS, brief del flyer, carrito, modal dinámico, los dos modales de hotel de la vitrina, el modal de receptivo, la solicitud de hotel bajo solicitud (reemplaza su escucha propia, ahora respeta «enviando») y la descripción de régimen. Excepciones con motivo: el menú móvil (Escape y trampa de foco propios) y el aviso no modal de programas pendientes (ya cierra con Escape). Guarda: `pruebas/escapeCerrar.wiring.test.ts`; comportamiento: `pruebas/escapeCerrar.react.ts` (registrada en `test:react`).

**Pruebas de estos ajustes (2026-11-13, combinado, local):** `next build` ✓ (incluye TypeScript) · `tsc --noEmit` 0 errores · SQL 301 0 fallos (E4, E4b, E4c, I6 y la carrera de P3) · unitarias 9.538 / 30 fallos: los mismos archivos que antes (el de `tarifarioCargaWiring` ya estaba corregido) · React 1.762 / 28 fallos: los 26 previos + 2 de `modalSeleccionTarjeta90` («tarjeta → modal → carrito con/sin promoción») que **fallan igual en el worktree original sin estos cambios** desde hoy (dependen de la fecha: su primera salida es el 13/12/26, a 30 días de hoy); `escapeCerrar.react.ts` 4/4 y `escapeCerrar.wiring.test.ts` pasan · preparación de la revisión 0 fallos (incluye el ensayo 100.000 → 90.000 → 120.000 → 108.000 por «Grupos de días» → «Aplicar cambios a la venta», sin fila promocional) · recorrido en Edge con login real 0 fallos (Escape cierra «Reglas por grupo», «Grupos de días» y el modal del hotel de la vitrina; la oferta 9605 aparece) · el aviso al activar en 9307 una combinación distinta de «PROMO DOBLE» dice: «… «PROMO DOBLE» acumula con compra anticipada (EBB) y «P3 TARDIA» no. Ejemplo: una estadía del 19/06/2027 al 21/06/2027 (2 noches) incluye noches de las dos …».

## 6. «Tarifas generadas»: promociones dinámicas por grupo explicadas (2026-11-13)
Pedido del dueño tras validar los tres ajustes de §5. Vista **de solo lectura** al final de la pestaña «Tarifas generadas» del hotel:
por cada promoción con reglas por grupo, una línea por fila de su base y acomodación con tarifa — **vigencia base · grupo (días de la
regla) · categoría · régimen · acomodación: tarifa base − descuento = neto resultante** (p. ej. «ALTA · Semana · Estándar · PAM ·
Doble: $ 100.000 − 10 % = $ 90.000»; con la base en 120.000, «… = $ 108.000»).
- **Cálculo dinámico conservado:** `lib/hoteles/promocionesDinamicas.ts` (pura) hace la MISMA cuenta del motor (`netoConRegla`,
  ocupantes de `hotel_acomodaciones` para montos por habitación) sobre las filas que la ficha ya leyó. No escribe ni materializa nada
  y no toca históricos (comprobado: `tarifa_hotel` igual antes y después de ver la página). Marca lo que el motor NO vende: prioridad
  menor que su base, empate con la base, combinación con EBB / Long Stay pendiente, monto mayor que su unidad, niño con monto por habitación.
- **Consumo:** ninguna tabla nueva. Se **suma UNA solicitud** por carga de la ficha: `mi_rol()` (una RPC a PostgREST, con su costo en la
  base y en la red). Va en el mismo `Promise.all` que las demás lecturas, así que corre en paralelo y no alarga la espera en serie, pero
  es una solicitud más. El cálculo cuesta ≈ 4,5 ms en un caso extremo (20 promociones × 6 grupos × 40 filas = 19.200 líneas). El motor de
  cálculo no viaja al navegador (el cliente importa solo el tipo; `textoDescuento` vive en `lib/hoteles/tarifasVista.ts`).
- **Permisos:** son NETOS (costo del proveedor). El servidor solo los calcula y envía a `superadmin`, `gerencia`, `administracion` y
  `operaciones` (`ROLES_VEN_NETOS`, mismo criterio que `verFinanzas`); otro rol recibe un aviso sin importes. `venta` ni siquiera llega a
  la ficha (proxy: módulo Producto) y la RLS de `tarifa_hotel` sigue siendo el candado real. El **PVP** no se muestra aquí a propósito:
  depende del markup de cada paquete (y de servicios, impuestos y redondeo por estadía), y se ve en el tarifario; la vista lo dice.
- **Pruebas:** `promocionesDinamicas43.test.ts` (8: 100.000 → 90.000, base 120.000 → 108.000, solo su base, régimen restringido, monto
  por habitación, niño, prioridad/empate/pendiente, sin reglas) · `promocionesDinamicas43.wiring.test.ts` (consumo y permisos) ·
  `test_promos_dinamicas_43.sh` (base desechable, acciones reales: la vista pasa de «100000 − 10 = 90000» a «120000 − 10 = 108000» al
  cambiar la base por «Grupos de días», sin fila promocional) · pruebas existentes de la ficha (339 unitarias + 44 React) · `next build`
  ✓ (incluye TypeScript) · recorrido en Edge con login real sobre la base de revisión del dueño (sin borrarla): 9309 muestra «ALTA ·
  Semana · Estándar · PAM · Doble: $ 120.000 − 10 % = $ 108.000», 9306 muestra el monto por habitación, sin desborde a 375 px; un usuario
  `venta` (sintético, agregado para esta prueba) inicia sesión y no llega a la ficha ni ve netos. **Pendiente:** `tsc --noEmit` completo
  (no se corrió por memoria con el entorno de revisión arriba; el build ya verificó los tipos de la aplicación).

**Corrección de la presentación de descuentos por habitación (2026-11-13).** La línea de un descuento por habitación y noche mezclaba
unidades (restaba un monto por habitación a una tarifa por persona). Ahora sigue la cuenta del motor en unidades coherentes: **base por
persona × ocupantes tarifados = base por habitación; − descuento por habitación = resultado por habitación; y su equivalente por persona
con el reparto exacto** (`repartirExacto`, igual que la composición de la cotización: COP en pesos enteros, USD con centavos). Ejemplos:
«Doble: $ 100.000 × 2 − $ 20.000 = $ 180.000 por habitación, $ 90.000 por persona»; «Triple: $ 90.000 × 3 − $ 20.000 = $ 250.000 por
habitación, $ 83.334 + $ 83.333 + $ 83.333 por persona». El cálculo vigente no cambia (`netoConRegla` sigue dando 83.333,33 por persona
al motor; el reparto es solo presentación del total exacto). Los ocupantes salen de `hotel_acomodaciones.pax_tarifa` (o el valor por
defecto de la reserva). Porcentajes y montos por persona siguen como «$ 100.000 − 10 % = $ 90.000». Prueba de presentación:
`pruebas/promocionesDinamicasPresentacion43.react.ts` (registrada en `test:react`); cálculo: triple COP/USD y `pax_tarifa` en
`promocionesDinamicas43.test.ts`. **Consumo corregido:** `mi_rol()` suma una solicitud por carga de la ficha (en paralelo; ver arriba).

**Presentación agrupada por categoría (2026-11-13).** La lista plana se reemplazó por el patrón del tarifario: por promoción (nombre,
prioridad, tipo de descuento y estado a la vista) y por **vigencia base y grupo**, una **tarjeta por categoría** con sus alimentaciones,
cuántas tarifas tiene y el «desde» por persona de adulto (solo acomodaciones de habitación, como el tarifario; con descuento por
habitación, la menor parte del reparto exacto). Cada tarjeta trae **«Ver tarifas»**, que abre el **modal compartido**
(`components/ui/dialog.tsx`, base-ui: X, Escape, foco atrapado y devuelto al botón; `max-h-[90dvh]` con scroll, usable a 375 px) con
todas las tarifas de esa categoría **por alimentación y acomodación**, con la misma explicación de base, descuento y resultado (unidades
coherentes y reparto exacto). Solo presentación: `agruparPromoPorCategoria` (`lib/hoteles/tarifasVista.ts`) reorganiza las líneas ya
calculadas; abrir el detalle no hace solicitudes (medido en Edge) ni cambia cálculos, permisos o datos. Prueba de presentación con varias
categorías y alimentaciones: `pruebas/promocionesDinamicasPresentacion43.react.ts` (resumen, modal, Escape con foco devuelto, X,
habitación con reparto exacto, sin permiso).

**Hotel sintético 9310 para la revisión del modal (2026-11-13).** `supabase/scripts/fixture_revision_43_hotel9310.sql` (idempotente; se aplicó
en la base de revisión sin recrearla): «R43 VARIAS CATEGORIAS», base ALTA de julio 2027 con Estándar × FULL, PA, PAE, PAM, PC y Superior ×
FULL, PAE, PAM, PC (7 acomodaciones cada una) y dos promociones dinámicas: «PROMO JULIO» −15 % y «HAB 30K» −30.000 por habitación y noche.
Usa solo las categorías y alimentaciones del catálogo (no lo amplía); las tarifas y vigencias de los demás hoteles quedaron idénticas
(huella md5 antes y después). Orden de la vista: categorías y alimentaciones **alfabéticas** (antes seguían el orden de carga de las filas).
Verificado en la app real con login, a 375 y 1280 px: tarjetas separadas por categoría, detalle exacto línea por línea (63 líneas por
promoción, comparadas con la fórmula del fixture), el modal se desplaza hasta la última tarifa (343×810 y 672×810 px), Escape y X cierran y
devuelven el foco a su «Ver tarifas», 0 solicitudes al abrir/cerrar, sin desborde ni errores JS. **Corrección de la verificación:** la
comprobación «el modal se cerró» usaba `offsetParent`, que es siempre `null` en elementos `position: fixed` (la daba por cerrada aunque no
lo estuviera); ahora usa `[role=dialog][data-open]` de base-ui, validado (verdadero abierto, falso cerrado), y se repitió también el
recorrido de 9309/9306.

**Validación del dueño (2026-11-13).** El dueño validó la presentación final de «Promociones dinámicas por grupo» en «Tarifas generadas»
(resumen por categoría, «Ver tarifas» con el detalle por alimentación y acomodación, unidades coherentes y reparto exacto), revisada con
varias categorías y alimentaciones (hotel sintético 9310). Queda validada junto con los ajustes de §5 y la vista de §6. Tras la validación
se apagaron la app y los servicios de la revisión (`next start`, gateway, `rev43-auth`, `rev43-rest`); la base `revision43` y sus datos se
conservan (no se ejecutó `limpiar`).
`tsc --noEmit` completo (pendiente desde §6), corrido con el entorno de revisión apagado: **0 errores**.
