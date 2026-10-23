# Tarea #50 - Bitacora del ejecutor

Origen de decisiones: `TASKS.md` seccion #50 y `WORKSTREAMS.md`. Antecedentes de auditoria: `chat-2-tarjetas.md`. El Coordinador titular decide cada gate. El ejecutor agrega una entrada por ciclo, sin reescribir entradas anteriores ni datos personales.

| Ciclo / fecha | Base, rama y estado Git | Trabajo y archivos | Pruebas ejecutadas | Hallazgos y decisiones pedidas | Gate |
| --- | --- | --- | --- | --- | --- |
| 0 / 2026-10-20 | Sin worktree ni reserva de codigo de #50 | Matriz de negocio en Chat #2; falta cierre tecnico y conciliacion con `main` `a4c999cf` | No hay pruebas nuevas verificadas por el Coordinador | Atribucion de margen por componente, paridad PVP/NETO de identidad B2B, contabilidad, hueco DTM y frontera #39 | Solo diseno, NO GO codigo/SQL |
| 1 / 2026-10-20 | `main` `a4c999cf`, checkout principal; solo documentos de coordinacion sin commit. Sin worktree, rama ni staging; este archivo es lo unico escrito | Cierre tecnico de diseno por lectura de codigo. Detalle completo en la seccion "Entrega ciclo 1" de abajo: hallazgos A1-A7, cierre B1-B5, mapa de archivos C, pruebas D, decisiones E | Ninguna ejecutada (sin Docker local; todo por lectura, sin SQL remoto) | 7 hallazgos que cambian el diseno; 6 decisiones del dueno (D-1 a D-6) y 5 elevaciones al Coordinador/Contabilidad (C-1 a C-5). El origen "directo" B2B NO es derivable hoy (A4) | Solo diseno, NO GO codigo/SQL (sin cambio) |
| 2 / 2026-10-20 | `origin/main` `b81820857a14` (#372); checkout principal en `a4c999cf`, un commit atras, leido con `git show/grep origin/main`. Sin worktree, rama ni staging; este archivo es lo unico escrito | Diseno rehecho segun D-1 (solo asistida), D-2 (margen sobre el total), D-4, D-5, D-6 y C-1 (222 A / 223 B). Detalle en "Entrega ciclo 2": B1 rehecho, uso real del reparto por fila, vectores, mapa, 222/223, pruebas, workflow, riesgos y preguntas | Ninguna ejecutada (sin Docker; todo por lectura) | El reparto por fila SI se conserva, pero solo para las condiciones de pago (no para el margen); A4 y `solicitarOpcionComparativa` salen. 4 preguntas explicitas (Q-1 a Q-4), la primera contradice un vector pedido: la tolerancia de medio peso deja pasar "un centavo por debajo" del 2 % | Solo diseno, NO GO codigo/SQL (sin cambio) |
| 3 / 2026-10-20 | `origin/main` `51ca079e` (#373). Worktree `.claude/worktrees/neto-hija-50`, rama `codex/50-neto-hija-manual`. TODO sin commit, sin staging, sin push: 8 archivos modificados y 19 nuevos (lista en "Entrega ciclo 3") | Implementacion local del diseno aprobado: migraciones 222 (A) y 223 (B) con scripts preflight/postcheck/rollback/test, `lib/cotizacion/netoHija.ts`, acciones de checkout y de resolver solicitud, snapshot de pagos, selector de modalidad en la UI, panel NETO, tipos y workflow exclusivo | Locales (TS/React): netoHija 17+23+10+14 verdes, grupo relacionado 261/261, `test:react` 654/654, `tsc` limpio, eslint limpio, `npm run build` ok; `test:unit` completo 12 fallos IDENTICOS a la base `51ca079e` (preexistentes). SQL: NINGUNA ejecutada (sin Docker); todo el SQL queda para el CI | margenContrato.ts no se modifico (el 2 % exacto va en `netoHija.ts` y en SQL por multiplicacion cruzada); accion de servidor `contextoModalidadNeto` en `pagos-actions.ts` con import perezoso. Preguntas Q-5 a Q-9 en la entrega | Pendiente del Coordinador: gate de revision y de CI (el SQL no se ha ejecutado en ningun motor) |
| 4 / 2026-10-21 | `origin/main` `51ca079e` (el suplente verifico que `main` avanzo a `0d360b39`; el rebase lo hace el dueno tras el gate). Misma rama y worktree; todo sin commit ni staging: 28 entradas (8 modificadas + 20 nuevas; la nueva es `preflight_223_neto_hija_manual_cierre.sql`) | Ajustes del gate del ciclo 3 dentro de la misma reserva: Q-5 (PVP sin aliado permitido y sin sello; solo NETO exige aliado) en 222 y en las pruebas 222/223, preflight 223 con conteo INFO, Q-8 verificado con anclas, Q-9a vectores de borde .5 COP/USD en TS y SQL, Q-9b cabecera de la 222, variable `id` renombrada en la bateria M | TS 63/63 (Puro 19 + Acciones 23 + Cableado 12 + margenContrato 9), React 654/654, `tsc` limpio, eslint limpio, `npm run build` ok, `git diff --check` limpio. SQL: NINGUNA ejecutada (sin Docker); todo al CI | Q-8: nadie de dinero/documento lee `detalle.recobro.aliado`; solo la ficha para mostrar. Nada que actualizar al sellar. Preguntas Q-10 y Q-11 en la entrega | Pendiente del Coordinador: gate y, tras el, commit/rebase/push/PR Draft por el dueno |
| 5 / 2026-10-21 | Rama `codex/50-neto-hija-manual` en `bb40019e` (commit del dueno sobre `0d360b39`); Draft PR #375. Sin commit ni staging mios: 2 archivos modificados, solo scripts SQL/shell de pruebas | G2 en rojo: el bloque 12 de `test_211_cotizaciones_comparativas.sql` hacia INSERT directo de una manual como `authenticated`, prohibido por la frontera 216/217. Bloque 12 reescrito en dos contextos (sin frontera: pruebas originales intactas; con frontera activa: creacion por `crear_cotizacion_manual` y rechazo exacto de escrituras economicas directas) y G2 del runner exige el contexto | Locales ligeras: `bash -n`, balance de comillas/`if`/parentesis del bloque, `git diff --check` y 31/31 de `netoHijaPuro`+`netoHijaCableado`. SQL: NO ejecutado (sin Docker); lo corre el CI del PR | Sin codigo de aplicacion ni migraciones. Detalle en "Entrega ciclo 5" | Pendiente: revision del diff por el Coordinador y push del dueno al mismo Draft |
| 6 / 2026-10-21 | Rama `codex/50-neto-hija-manual` en `7483efc8` (commit del dueno, "adaptar regresion 211 a la frontera 217"); Draft PR #375. Sin commit ni staging mios: 1 archivo modificado (`test_211_cotizaciones_comparativas.sql`) | Las 8 aserciones que el CI marco rojas con la 217 activa (4.11, 4.12, 4.13, 4.21, 4.22, 4.31, 6.29, 6.30) ahora tienen rama por contexto: sin frontera, la expectativa original de la 211; con frontera, el rechazo EXACTO de la 217 (permission denied / FRONTERA_39) mas una comprobacion que alcanza la guarda PROPIA de la 211 con roles de API (hija de carrito y servicios con DML concedido solo dentro de la transaccion de prueba) | Locales ligeras: balance de `if`/`end if`/parentesis/`$$` de los 13 bloques DO, sin `\\` duplicadas, un solo `\if`/`\endif`, `git diff --check` limpio. SQL: NO ejecutado (sin Docker); lo confirma el CI de Actions | Sin migraciones, app ni otros tests; el runner no se toco. Detalle y 3 riesgos residuales en "Entrega ciclo 6" | Pendiente: gate del Coordinador sobre el diff, y luego commit/push del dueno al mismo Draft |
| 7 / 2026-10-21 | Misma rama y worktree, HEAD `7483efc8`; diff del ciclo 6 preservado. Sin staging/commit/push: 3 archivos modificados (`test_211_cotizaciones_comparativas.sql`, `test_222_neto_hija.sh`, workflow focal) | Se retira `t211.servicios_directo` y todo GRANT/REVOKE (sin tocar permisos); las 8 expectativas por contexto se conservan y, con la 217 intacta, verifican rechazo especifico + huella de madre/servicios antes y despues. Nuevo modo `211sola` del runner y job `bateria-211-sola` del workflow: la bateria 211 COMPLETA en otra base hasta la 211 (sin 216/217), exigiendo INACTIVA. G2 conserva ACTIVA y sus marcas; diagnostico y PIPESTATUS completados | Locales: `bash -n`, `git diff --check`, 63/63 de las 4 suites focales, chequeo estatico de los 13 bloques DO, y comprobacion SINTETICA (sin Docker) de `verificar_211`/`diag_211` (12 casos) y del patron `runner \| tee; rc=${PIPESTATUS[0]}` (4 casos). SQL y el job nuevo: NO ejecutados; solo en Actions | Sin fixtures, `preparar_esquema_local.sh`, migraciones, app ni otros workflows. Cobertura de la guarda de la 211 sobre servicios ahora solo en H1. Preguntas Q-13 y Q-14 | Pendiente: gate del Coordinador sobre el diff y luego commit/push del dueno al Draft |
| 8 / 2026-10-21 | Misma rama y worktree, HEAD `7483efc8`; diff de los ciclos 6 y 7 preservado. Sin staging/commit/push. Este ciclo toca solo `test_222_neto_hija.sh` y el workflow focal; el SQL auditado (`test_211_...sql`) queda byte a byte como en el ciclo 7 | (1) `set +e` explicito antes de los TRES pipelines con `tee` (jobs 222/223, 211-sola y TS), con PIPESTATUS inmediato y las guardas con `exit 1`; (2) el runner publica SIEMPRE los contextos 4.0, 6.0 y 12.0 de H1 y de G2, tambien cuando pasan (`publicar_contextos_211`), y el job 222/223 exige los de G2 ACTIVA | Recorrido completo runner -> tee -> guardas con `bash -e -o pipefail` (pasos extraidos del YAML; el runner REAL de `211sola` con un `docker` falso, y el codigo REAL de G2 dentro de un runner falso del job 222/223; TS con `docker run` falso): 9 corridas verde/rc=3/fallo y 8 comprobaciones de mensajes y contextos publicados, 0 discrepancias. Contraste con el estado del ciclo 7: reproduce los dos defectos. `bash -n` y `git diff --check` limpios. No se repitieron suites de app | El estado anterior fallaba de dos formas (detalle en la entrega). Sin Docker ni SQL real; el job nuevo y el SQL solo se confirman en Actions. Pregunta Q-15 | Pendiente: nuevo gate del titular |
| 9 / 2026-10-21 | Misma rama y worktree, HEAD `b86ea92d` (commit del dueno); Draft #375; worktree limpio al empezar. Sin staging/commit/push: 3 archivos modificados (`lib/cotizacion/comparativaAcciones.tsx`, `lib/cotizacion/comparativaDocumento.tsx`, `pruebas/netoHijaModalidad.react.ts`) | Ajuste UI pedido por el dueno en validacion (reserva de WORKSTREAMS/COORDINATOR_HANDOFF): aviso «Vista previa. La modalidad se guarda al pulsar Elegir esta opcion», NETO destacado y PVP original identificado, importes/porcentajes sin cortes en escritorio y movil, Documento en otra pestana | React existente `netoHijaModalidad` + `cotizacionComparativa35Ui`: 29/29 (26 anteriores sin tocar + 3 nuevas de texto); `tsc` y eslint de lo tocado limpios; `git diff --check` limpio; `netoHijaCableado.wiring` verde. Capturas desktop (1280) y movil (390 real) con datos sinteticos, antes/despues. No se repitio SQL ni CI | Sin calculos, acciones, permisos, RPC, migraciones ni persistencia; 222 aplicada intocada, 223 sin tocar. Q-16 | Pendiente: auditoria del titular antes del push del dueno |

El ejecutor completa su siguiente linea con evidencia concreta. No editar la 198, 211, 216, 217 ni crear migracion por inferencia. El numero, superficies, workflow y ejecutor unico de codigo se reservan solo tras el gate del Coordinador.

## Entrega ciclo 1 - cierre tecnico de la matriz #50 contra `main` `a4c999cf` (2026-10-20)

Escrita para: el Coordinador titular (gate) y, a traves de el, el dueno (decisiones D-*). Solo diseno: no hay codigo, SQL, rama, worktree, reserva ni numero de migracion en esta entrega.

**Fuente y limites de evidencia.** Matriz: `chat-2-tarjetas.md` seccion #50 (decisiones 1-8 y revisiones hasta "diseno final Opus"). Codigo: `main` `a4c999cf`, leido a mano (migraciones 164/198/205/206/211/216/217, `lib/`, `app/`). **No se ejecuto ninguna prueba ni SQL**; lo que sigue es lectura de codigo y por eso cada afirmacion lleva ancla `archivo:linea`. Desde `ecae7678` solo entran #62 y #57 (19 archivos, ninguna migracion): no tocan 164/198/205/206/211/216/217/219 ni ningun archivo de #50. Lo unico de la matriz que queda superado es el hotfix C1/C2 de paridad de Programas (fusionado en #371).

### A. Hallazgos que cambian el diseno

**A1. Las hijas de comparativa NO son editables por #39.** `p39_priv.bloquear_para_editar` rechaza toda cotizacion con `cotizacion_origen_id` (`216:328`, `EDICION_39_NO_ELEGIBLE`). Una hija nace con servicios, recobro, ninos y precio fijos hasta que se convierte o se descarta. Consecuencia: el reparto NETO calculado al crear la hija no puede quedar obsoleto por una edicion; hace falta una prueba de regresion, no un mecanismo de recalculo. Cambiar precio = hija nueva (decision 7), como ya se dispuso.

**A2. En una hija manual no existe el componente "programa".** `tipo_servicio` solo admite aereo/hotel/traslado/asistencia/otro (`216:278-307` `validar_servicios`; mapeo `componentes_manual` `216:244-256` y `lib/cotizacion/componentesManual.ts`); ni `cotizacion_servicios` ni los formularios de `cotizaciones/` referencian programas (busqueda sin coincidencias). `reservarPrograma` crea la venta directo, sin cotizacion ni 198 (`reservar/actions.ts:2930`). Por tanto el piso del 3 % no tiene ninguna fila a la que aplicarse en #50 v1, y todo el aparato de procedencia de programa (`programa_procedencias`, espejo SQL de `pvpPrograma`, 600.000 vectores, C1/C2/C3) **sale del alcance de #50 v1**. Queda abierta la decision D-6 (NETO sobre Programas es otra tarea).

**A3. Hay una sola "forma NETO" que leen todos los consumidores, y obliga a diseno B.** Contrato NETO = `ventas.precio_venta` = total exigible, `ventas.comision_b2b` = descuento, `ventas.comision_estado = 'descontada'`, `modo_compra = 'neta'`, items a PVP y una fila `aliados_b2b` con `descontada_en_precio` (`lib/finanzas/netoB2B.ts:1-50`; documento `lib/contrato/presentacionValores.ts`; rentabilidad no resta la descontada `lib/finanzas/comisionB2B.ts:112-117`; cuenta de cobro `cobrable:false` `comisionB2B.ts:343-345`). La 198 construye la venta con `cotizaciones.precio_venta` (`198:600,651`) y los items desde ese mismo precio (`198:664-676`). **Diseno B (recomendado):** la hija conserva `cotizaciones.precio_venta` = PVP (cotizacion publica PVP, decision 4a, items PVP sin tocar); el NETO vive en tablas nuevas; el wrapper de pago fija el exigido y `precio_total_congelado` en NETO; tras la 198 un helper rebaja `ventas.precio_venta` a NETO y completa la forma NETO en la misma transaccion. Diseno A (poner NETO en `cotizaciones.precio_venta` desde el nacimiento) se descarta: la 198 saldria con items a NETO, la cotizacion publica y la ficha mostrarian NETO y habria que reescribir items despues.

**A4. El origen "directo" B2B NO se puede derivar hoy (corrige lo que parecia resuelto).** En una comparativa MANUAL el B2B no elige: `elegirOpcionComparativa` rechaza cualquier canal distinto de `interno` (`checkout/actions.ts:1405`) y su unica via es `solicitarOpcionComparativa` (`:1455`), que **no envia actor** (`registrar_solicitud_comparativa`, `211:990-1093`, no tiene parametro ni columna de solicitante). Una solicitud de un aliado con sesion y una anonima son indistinguibles en la base. Hoy TODA hija manual nace por canal `interno`: o el interno elige (`elegir_opcion_comparativa_sesion`, `211:904`) o confirma una solicitud (`resolver_solicitud_comparativa`, `211:1094`). Regla de la revision de Chat #2: si el origen no se puede probar, falla cerrado. Cierre minimo: la solicitud debe registrar `origen` (`anonimo`/`b2b_sesion`) y `solicitante_id`, derivados de `actorComparativa()` (`checkout/actions.ts:1197`, ya devuelve `canal b2b`, `userId`, `aliadoId`) y validados en la base con `f211_priv.b2b_propietario` (`211:341`); `origen` y `solicitante_id` inmutables; el reintento por contacto (`211:1044-1062`, hoy actualiza la opcion con solo telefono/correo) solo vale si coincide origen y solicitante, y si no, se rechaza la mezcla. Limite honesto: la base confia en el `solicitante_id` que le pasa `service_role`, igual que hoy confia en `p_actor_id` de `registrar_validacion_comparativa` (`checkout/actions.ts:1429`); lo cubre una prueba de cableado, no la base.

**A5. La fila de recobro de la 198 no se puede "convertir" en descontada: hay que no crearla.** Para B2B con recobro de aliado la 198 inserta `aliados_b2b` pendiente (`198:685-695`) y deja `ventas.comision_estado = 'pendiente'` y `comision_b2b = recobroAliado` (`198:659-660`). La 205 prohibe cambiar `descontada_en_precio` (`205:207-210`) y los lectores marcan toda fila no descontada de un contrato NETO como `revision_neto` (`comisionB2B.ts:62-77`). La 198 lee `recobroAliado` del payload de la hija (`198:610`). Solucion limpia: al sellar una hija NETO se guarda la participacion en la tabla NETO y se pone `payload.recobroAliado = 0`; la 198 no crea fila ni comision pendiente, y `ventas.recobro_empresa` queda igual al recobro total. Alternativa (B2, peor): dejar que la 198 la cree y que el helper la borre/reescriba. `crear_hija` no usa `recobroAliado` en su chequeo de total (`211:876`), asi que el cambio es compatible; falta la prueba de lectores de `recobro_*` (D, N15).

**A6. Hueco DTM: tres bordes, no uno.** (i) Todo rechazo de negocio nuevo corre en el wrapper antes de la 198 (cero hueco). (ii) 198 directa sobre hija sin congelar falla en `198:561-564`, antes del `nextval` de `198:592` (cero hueco). (iii) 198 directa sobre hija congelada y pagada pasa 561-589, consume numero e inserta venta/aliado/items/condiciones/abonos, y recien falla en el primer UPDATE protegido por la frontera (`198:739-741` pago `aplicado`, o `198:809` estado) por falta de la autorizacion `conversion` (`216:480-516`): rollback total, un numero consumido. Es el G1 aceptado por el dueno. (iv) Nuevo: un fallo imprevisto del helper post-198 tambien revierte y consume numero; se mitiga dejando todas las validaciones antes de la 198 y un helper sin ramas de rechazo de negocio.

**A7. Identidad: la 198 no escribe `aliado_id`, `tipo_asesor` ni nombres de aliado.** `tipoAsesor` se guarda en `tipo_cliente` (`198:654`); ni `ventas.aliado_id` ni `aliados_b2b.aliado_id` se escriben (`198:641-662,689-694`). El portal decide por `b2b_usuario_id`/`aliado_id` y el nombre solo con `acceso_legacy_nombre` (`lib/auth/contratosPortalB2B.ts:1-25`, `accesoDocumentoContrato.ts`, migracion 193); no sigue `ventas.cotizacion_id`. Por lectura, una hija B2B convertida en PVP hoy no aparece en el portal de su aliado salvo cuentas con acceso legacy. **Sigue siendo inferencia de codigo, sin comprobacion en Produccion.**

### B. Cierre por tema

**B1. Atribucion de margen por componente (decision 6).**

*Clasificacion (fuente verificable).* Solo por `cotizacion_servicios.tipo_servicio` ya validado y congelado por 216/217; nunca por etiqueta ni porcentaje del navegador: `hotel` = porcion terrestre, `traslado/asistencia/otro` = servicio (piso 6 %), `aereo` = tiquete ordinario. Las clases `bloqueo` y `programa` no tienen fuente en una hija manual (A2): no se emiten; ante clase ausente/ambigua o costo ausente con precio > 0, se detiene antes de crear la hija.

*Reglas de calculo.* Aritmetica entera en centavos (columnas `numeric(15,2)`), nunca `float8`:
1. T = suma de filas `aereo` (fuera de la base del descuento y sin descuento). R = `payload.recobro`. N = `ninos x tarifaNino`. Base de la comision ordinaria = PVP - T - R si la participacion se reconoce; = PVP - T si no (el recobro entra a la base). Formula literal de la decision 2.
2. Porcentaje ordinario: `aliados.pct_comision`, si no el parametro `COMISION_AGENCIA`/`COMISION_FREELANCE`, si no 12 %/11 % (`206:128-131`; espejo TS `lib/reservar/comisionReserva.ts`, `lib/contrato/netoManual.ts`).
3. Participacion en recobro = `min(max(payload.recobroAliado,0), R)` solo si se reconoce: la misma cantidad que la rama PVP pagaria como comision (`198:610`), asi PVP y NETO son comparables. Se descuenta una sola vez, dentro de D; sin pago aparte.
4. D = comision ordinaria + participacion. NETO = PVP - D. La comision ordinaria se reparte entre las unidades de la base (filas no-tiquete, mas `ninos` si N > 0, mas `recobro` si no se reconoce) en proporcion a su PVP, por mayor resto en centavos, empate al menor `(orden, id)`; la participacion se carga al recobro.
5. Ingreso NETO de cada fila de servicio no-tiquete = PVP_k - descuento_k + parte proporcional del ingreso no asignado (recobro neto + ninos neto) repartido sobre las filas no-tiquete en proporcion a su PVP (**M2**, ver D-2). Invariante: suma de ingresos atribuidos = NETO total, y suma de descuentos = D.
6. Piso, en enteros: `ingreso_k x (10000 - piso_bps) >= costo_k x 10000`, con piso 600 bps para hotel/traslado/asistencia/otro. Se evalua SIEMPRE en cada fila (tenga o no descuento asignado). Piso absoluto: `ingreso_k >= costo_k` sin excepcion posible.
7. Tiquete: en venta mixta, `precio_k >= costo_k` (sin piso porcentual); en venta solo-tiquetes, `precio_k x 98 >= costo_k x 100`. Solo `superadmin` autoriza bajar del 2 %; nunca bajo costo.
8. La evaluacion se hace al crear la hija (alli se fija el precio) y se vuelve a verificar contra lo sellado antes de la 198; la excepcion queda registrada con actor, rol, componente, piso y margen.

*Vectores (COP; cifras de la decision 2).* Filas: aereo 2.000.000 (costo 1.900.000), hotel 6.000.000 (5.100.000), traslado 1.000.000 (850.000), asistencia 500.000 (400.000); recobro 500.000 (aliado 250.000); ninos 0; comision 12 %.

| Caso | Base | D = ordinaria + participacion | NETO | Reparto y margen |
| --- | --- | --- | --- | --- |
| V1 directo (reconoce forzado) | 7.500.000 | 900.000 + 250.000 = 1.150.000 | 8.850.000 | Ordinaria: hotel 720.000, traslado 120.000, asistencia 60.000. Recobro neto 250.000 repartido (M2): 200.000 / 33.333,33 / 16.666,67. Ingresos: hotel 5.480.000, traslado 913.333,33, asistencia 456.666,67, aereo 2.000.000 (suma 8.850.000). Margenes 6,93 % / 6,93 % / 12,41 %; aereo >= costo. Pasa |
| V2 igual con costo hotel 5.200.000 | 7.500.000 | 1.150.000 | 8.850.000 | Hotel 5,11 % (M2) o 1,52 % (M1): bajo 6 %, exige autorizacion de superadmin/administracion; sin ella se rechaza al crear la hija |
| V3 asistido, no reconoce | 8.000.000 | 960.000 + 0 | 9.040.000 | Ordinaria: hotel 720.000, traslado 120.000, asistencia 60.000, recobro 60.000. Recobro neto 440.000 repartido: 352.000 / 58.666,67 / 29.333,33 |
| V4 solo tiquetes, recobro 0 | 0 | 0 | = PVP | Aereo 2.000.000, costo 1.960.000: 2,00 % exacto, cumple (`196.000.000 >= 196.000.000`); costo 1.960.001 exige superadmin. Costo 1.000.000 => precio minimo entero 1.020.409 |
| V5 resto | tres filas de 10,00 con D_ord 1,00 | | | 0,34 / 0,33 / 0,33 (el centavo sobrante a la fila de menor `(orden, id)`) |

Limite que debe quedar escrito: `costo_neto` es lo que digita el asesor; la coherencia interna se prueba, **no se verifica contra la factura del proveedor**.

**B2. Identidad B2B en PVP y NETO (decision 8).** Un unico helper de conversion `completar_conversion` (SECURITY DEFINER, privado) corre tras la 198 dentro del wrapper de conversion y, para TODA hija manual con `tipoAsesor` agencia/freelance: (a) resuelve el aliado por `cotizaciones.aliado_id` (sembrado por la 211 desde la madre, `211:658-668,842-859`), no por payload ni nombre; (b) antes de numerar, el wrapper verifica que exista, que `aliados.tipo` coincida con el tipo de venta y que el tenant de la hija sea el del actor (o superadmin); ausente o discordante => rechazo sin consumir DTM; (c) escribe `ventas.aliado_id`, `ventas.tipo_asesor` y los nombres de agencia/freelance desde el catalogo; (d) en PVP, ademas `aliado_id` en la fila de recobro de la 198 (UPDATE permitido: no esta descontada ni tiene abonos, `205:198-217`). Sin backfill. `b2b_usuario_id` queda fuera de v1 (el vinculo por `aliado_id` basta y cubre a todos los usuarios del aliado). La decision de aplicarlo tambien a hijas legadas aun abiertas es D-5. Brechas en otras rutas: C-4.

**B3. Conciliacion contable.**

| Elemento | Resultado esperado en una hija NETO convertida |
| --- | --- |
| Asientos | Ninguno nuevo por D (no hay egreso, retencion ni CxP). La 198 sigue generando los de siempre: pago previo (280510), aplicacion 280510 -> 280505 y CxP + costo/proveedores (`198:727-737,792-804`) |
| `ventas` | `precio_venta` = NETO; `comision_b2b` = D; `comision_estado = 'descontada'`; `modo_compra = 'neta'`; `aliado_id`, `tipo_asesor`, nombres; `recobro_aliado = 0`, `recobro_empresa` = recobro total |
| `aliados_b2b` | UNA fila: `estado 'pagada'`, `descontada_en_precio = true`, `comision_valor = D`, `recobro_total = 0` (si fuera > 0 con `pct_recobro_aliado` nulo, `comision_b2b_total` sumaria 50 % por defecto, `205:101-117`), `base_comision` = base, `base_explicita = true`, `aplica_retencion = false` y `pct_retencion = 0` (decision 3; **distinto de la 206**, que copia la retencion del aliado). Comprobar `round(comision_b2b_total(fila),2) = D` |
| Items / documento | Items a PVP (la 198); `ContratoDocumento` ya muestra total y saldo NETO y oculta valores por item porque lee `comision_estado` y `precio_venta`; no requiere cambio |
| Lectores | Rentabilidad no resta D; Comisiones muestra "descontada", saldo 0, sin abonos; cuenta de cobro no se genera; portal muestra descontada; facturacion (208) sobre NETO |
| Conciliacion | PVP = NETO + D; abonos <= NETO; saldo = NETO - abonos; costos y CxP identicos a la rama PVP |
| Desglose informativo | Solo en la tabla NETO (base, ordinaria, participacion, pct, D), visible a roles internos; no es comision pagadera |

Pendientes que no son tecnicos: C-2 (como documentar un consecutivo saltado, sin afirmar efecto legal) y C-3 (la 206/#358 copia la retencion del aliado y usa `comision_b2b` con otra semantica; no se afirma paridad contable ni se cambia dentro de #50).

**B4. Hueco DTM.** Politica: G1 (decidido 2026-10-19); G2 no se reabre. Medidas: todo rechazo nuevo antes de la 198; prueba de cableado de que ninguna ruta de la app llama `convertir_cotizacion_a_contrato` ni `registrar_pago_previo` directo (hoy solo hay comentarios: `manual-actions.ts:337-352`, `lib/contrato/congelarCondicionesContrato.ts:7`, `lib/cotizacion/manualMapeos.ts:6`; patron `pruebas/documentosContrato.wiring.test.ts`); pruebas de secuencia: rechazo nuevo +0, directa sin congelar +0, directa con hija congelada +1 documentado, y fallo inyectado post-198 con rollback total. Hueco residual aceptado: (iii) y (iv) de A6.

**B5. Convivencia con la frontera #39.** Invariantes que #50 no puede romper: firmas, `SECURITY INVOKER` y `service_role` unico de los tres wrappers (`216:833,887,921`; grants `216:971-973`); `p39_priv.emitir/cerrar` y bloqueo de la cotizacion antes de verificar; `composicion_coincide` intacta (`216:258-275`); `frontera_activa()` exige exactamente 7 disparadores por nombre y sin DML de `anon/authenticated/service_role` sobre las tres tablas (`216:218-240`): no renombrar ni deshabilitar ninguno ni cambiar esos grants; las columnas "libres" de la frontera durante un pago incluyen `precio_total_congelado` y `monto_exigido_total(_cop)` (`216:448-452`), por eso el wrapper puede fijar el congelado en NETO tras la 198 sin tocar la frontera. Reglas: (1) el wrapper de pago pasa a `CREATE OR REPLACE` con la misma firma, ramificado por modalidad leida de la tabla NETO bajo el lock, nunca de parametros; un hijo NETO con snapshot PVP, o PVP con snapshot NETO, se rechaza; (2) la rama NETO no relaja `composicion_coincide`: compara el snapshot con los `neto_k` sellados (helper nuevo) y exige que Σ `monto_exigido` <= NETO y cada uno <= su `valor_componente`; (3) el sobrepago del primer pago se valida contra NETO antes de llamar la 198 (la 198 compara contra `precio_total_congelado` = PVP en ese instante, `198:239-266`); (4) las escrituras post-198 sobre `ventas` van en el helper SECURITY DEFINER, porque `trg_ventas_modalidad_b2b_inmutable` bloquea esos campos a `service_role` (`206:174-204`); (5) mismo orden de locks (madre -> solicitud -> hija) que 211. **Despliegue en dos migraciones, como 216/217:** A aditiva (tablas, helpers, columnas nuevas en validaciones/solicitudes, firmas nuevas, wrappers con rama NETO inactiva mientras nadie sella NETO; las firmas viejas siguen creando PVP) -> app -> B cierre (sellado obligatorio en madre B2B; las firmas viejas de validacion/solicitud rechazan). Mismo cuidado para mantener la rama PVP identica: se re-ejecuta la suite completa 216/217.

### C. Mapa exacto de archivos (candidato; NADA reservado)

Numeracion: en el repo ocupan 215 (#43-1a) y 218 (#56); hoy no hay 220+ reservado en `WORKSTREAMS.md`. Numero, A/B, ejecutor, worktree y workflow los fija solo el Coordinador.

| Superficie | Archivo | Accion |
| --- | --- | --- |
| SQL | Migracion A `supabase/migrations/2026060100NNN_*.sql` | NUEVA: tablas del NETO (cabecera con reparto y desglose, filas por componente, autorizaciones), insert-only, RLS sin grants a `anon/authenticated`; esquema privado de helpers (calculo en centavos, sellado, comparacion de snapshot, `completar_conversion`, lectura acotada para el panel); columnas nuevas `modalidad/reconoce` en `cotizacion_comparativa_validaciones` y `origen/solicitante_id` en `cotizacion_comparativa_solicitudes`; `CREATE OR REPLACE`: `registrar_validacion_comparativa`, `elegir_opcion_comparativa_sesion` (misma firma; sella tras `crear_hija`), `registrar_solicitud_comparativa`, `resolver_solicitud_comparativa`, `registrar_pago_previo_rev`, `convertir_cotizacion_manual_controlada` |
| SQL | Migracion B | NUEVA: cierre (obligatoriedad y retiro de firmas viejas) |
| SQL | `supabase/scripts/preflight_*, postcheck_*, rollback_*` (A y B), `test_*.sql/.sh`, fixtures | NUEVOS, patron de 216/217 |
| App | `lib/cotizacion/netoHija.ts` | NUEVO, puro: reparto, pisos, vectores; espejo del SQL |
| App | `lib/cotizacion/comparativaAcciones.tsx` | MODIFICA: selector PVP/NETO y pregunta de recobro solo a los 4 roles y solo con madre B2B; vista previa base / ordinaria / participacion / D / NETO / margen por componente |
| App | `app/tarifario/checkout/actions.ts` | MODIFICA solo `elegirOpcionComparativa` (`:1382`, pasa modalidad a la validacion `:1429`) y `solicitarOpcionComparativa` (`:1455`, pasa `solicitante_id` de `actorComparativa()`); carrito/publico sin cambios |
| App | `app/(dashboard)/dashboard/cotizaciones/manual-actions.ts` | MODIFICA `resolverSolicitudComparativa` (parametros nuevos) y mensajes de `convertirCotizacionManualAContrato` (`:348-380`); NO crea otra puerta |
| App | `app/(dashboard)/dashboard/cotizaciones/pagos-actions.ts` | MODIFICA `registrarPagoPrevio` (`~:150-235`): en hija NETO arma el snapshot con valores NETO y `precioTotalMoneda` NETO; el wrapper recibe lo mismo de siempre |
| App | `app/(dashboard)/dashboard/cotizaciones/[id]/page.tsx`, `components/cotizacion/PagosPreviosPanel.tsx` | MODIFICAN: total/saldo/exigible NETO y marca de modalidad; `venta` no ve D |
| App | `types/database.ts` | Solo objetos nuevos; en serie con #43-1a y #56 |
| App | `package.json` | Solo registrar `*.react.ts` nuevas en `test:react` (`test:unit` toma `pruebas/**/*.test.ts` por glob) |
| CI | `.github/workflows/test-NNN-*.yml` | NUEVO, patron `test-216-217-cotizacion-edicion.yml` (PostgreSQL + PostgREST desechables, sin secretos, permisos de lectura) |
| Pruebas | `pruebas/netoHija*.test.ts`, `netoHijaCableado.wiring.test.ts`, `netoHija*.react.ts`, `supabase/scripts/test_NNN_*` | NUEVAS |
| Solo lectura | Migraciones 164/198/205/206/211/216/217/219; `lib/contrato/*`, `lib/finanzas/*`, `lib/auth/*`, `ContratoDocumento.tsx`, `CotizacionManualDocumento.tsx`, `app/cot/[token]`, `app/portal/b2b/page.tsx`, `reservar/actions.ts` | NO se editan; son consumidores a probar |

### D. Pruebas necesarias (ninguna ejecutada)

Gate: GitHub Actions (PostgreSQL + PostgREST desechables, JWT locales); en este PC solo TS puro, React, `tsc` y `npm run build`. No hay Docker local.

| Id | Que debe demostrar |
| --- | --- |
| N1 Aritmetica | V1-V5 y un lote determinista amplio: suma de ingresos atribuidos = NETO, suma de descuentos = D, resto estable, COP y USD, sin `float8` |
| N2 Paridad TS-SQL | El mismo archivo de vectores ejecutado importando el modulo TS real y la funcion SQL real, igual al centavo; no copias Node/Python |
| N3 Pisos | Bordes de 6 % y 2 % (+-1 centavo), mixta frente a solo-tiquetes, costo ausente, clase ambigua, piso absoluto aun con excepcion |
| N4 Excepcion | superadmin/administracion para 6 %; solo superadmin para 2 %; gerencia/operaciones/venta rechazadas; autorizacion registrada; tambien por REST |
| N5 Nacimiento | Ambas entradas (elegir por sesion, resolver solicitud) en PVP y NETO; firma vieja; reintento con la misma clave; misma clave con otra modalidad falla; una sola hija; carrito/publico intactos; orden #42 conservado (alta de personas tras la RPC) |
| N6 Origen | Solicitud autenticada B2B frente a anonima; mezcla por contacto rechazada; aliado inactivo o ajeno; firma vieja o sin solicitante => asistida; "directo" con reconoce = no => rechazo; cuenta que pierde autorizacion => no cae a asistida |
| N7 Pago | Primer pago congela NETO; primer pago > NETO rechazado antes de la 198; segundo pago y reintento; USD/TRM; snapshot PVP a hija NETO y viceversa rechazados; revision y composicion |
| N8 Conversion | Forma NETO completa de A3/B3, una sola fila descontada con total = D, sin CxP/pago/retencion por D, abonos y saldos, documento |
| N9 Identidad | PVP y NETO: `ventas.aliado_id`/`tipo_asesor`/nombres correctos; portal de otro aliado con el mismo nombre no lo ve; cuenta de cobro solo freelance; ausente o discordante bloquea antes de numerar; historicos sin cambios |
| N10 DTM | Secuencia +0 en rechazos nuevos y directa sin congelar; +1 documentado con hija congelada; fallo inyectado post-198 con rollback total |
| N11 Carreras | Pago x eleccion x conversion x anulacion; doble conversion; doble eleccion; orden de locks |
| N12 Frontera | `frontera_activa()` verdadera, 7 disparadores, grants intactos; DML directo negado; hija no editable; suite 216/217 completa |
| N13 ACL | Tablas nuevas sin grants a `anon/authenticated`; esquema privado fuera de Data API; helpers solo `service_role`; funciones no `IMMUTABLE` si leen catalogos o parametros; `search_path` con `pg_temp` al final; REST con y sin JWT, y con `venta` |
| N14 Despliegue | Preflight, A, app, B, postcheck y rollback de cada una; la app nueva sobre A sola y la vieja sobre A funcionan |
| N15 Regresion | 164/198/205/206/208/211/214/216/217/219; contrato PVP y simple; #358 sin cambio; lectores de `recobro_*` (`comisiones/actions.ts`, `ComisionesList.tsx`, `comisionB2B.ts`, `comisionPortal.ts`, `comisionResolver.ts`, `rentabilidad.ts`) con `recobro_aliado = 0` |
| T1 Cableado | Ninguna ruta llama la 198 ni `registrar_pago_previo` directo; las acciones derivan actor y rol de la sesion; la modalidad no se lee del navegador sin validar |
| R1-R4 React | Selector solo para los 4 roles; vista previa; panel de pagos NETO; cotizacion publica en PVP sin NETO ni D; contrato NETO (regresion de `contratoDocumentoNeto.react.ts`) |

Existentes a reutilizar: `cotizacionComparativa35Checkout/Paridad/Ui`, `cotizacionEdicion39Acciones`, `cableadoPersonasCotizacion42.wiring`, `contratoManualNeto206.pg`, `documentosContrato.wiring`, `margenContrato.test`, `contratoNetoB2B.test`, y los scripts `test_211_*`, `test_216_*`, `test_206_*`.

### E. Decisiones pendientes

**Del dueno** (cada una trae la recomendacion y lo que bloquea):

| Id | Decision | Recomendacion |
| --- | --- | --- |
| D-1 | **Definicion de "directo".** Hoy no hay forma de probarlo (A4). Propuesta: *directo* = el aliado B2B pidio la opcion con su sesion (solicitud autenticada), aunque despues un asesor la confirme; *asistido* = personal interno eligio por el, o confirmo una solicitud anonima. En directo la participacion de recobro se reconoce siempre; en asistido el rol interno responde si o no. El aliado no escoge NETO (decision 5): lo fija el rol interno al confirmar | Aprobar. Si quiere que el aliado escoja NETO el mismo, es alcance nuevo con otra auditoria. Bloquea N6 y el cierre de A4 |
| D-2 | **Ingreso no asignado en el piso:** el recobro neto y la tarifa de ninos, ¿cuentan como ingreso de los servicios al medir el 6 % (M2) o no (M1)? | M2: es coherente con #358 (mide sobre todo lo que entra) y es necesario para que la suma de ingresos cuadre con el NETO. M1 es mas estricto y bloquea mas ventas con markup bajo. Tambien confirmar que la tarifa de ninos entra a la base del descuento (formula literal PVP - tiquetes - recobro) |
| D-3 | **Quien autoriza bajar de un piso.** 6 % hotel/traslado/asistencia/otro: superadmin y administracion (como `margenContrato.ts:20`); 2 % de solo-tiquetes: solo superadmin (regla del 2026-10-20) | Confirmar tal cual; si se quiere cambiar, es una diferencia explicita, no un efecto colateral |
| D-4 | **NETO con descuento cero** (por ejemplo, solo tiquetes sin recobro, V4). Crearia una fila descontada de valor 0 | Rechazar: sin descuento la hija es PVP |
| D-5 | **Hijas legadas aun abiertas** (sin marca de modalidad): al convertirlas, ¿tambien se propaga `aliado_id`/`tipo_asesor`? | Si, solo hacia adelante y sin backfill; es el mismo vacio que la decision 8 quiere cerrar |
| D-6 | **Programas.** En una hija manual no existen (A2): el 3 % queda sin uso en v1. ¿Se confirma que #50 v1 no cubre Programas y que NETO en `reservarPrograma` es una tarea aparte? | Confirmar. Esa tarea nace despues de cerrar los residuales de #57 (CxP de asistencia con proveedor real, impuesto fiscal B2B) |

**Del Coordinador / Contabilidad** (no son decisiones comerciales):

| Id | Tema |
| --- | --- |
| C-1 | Ejecutor unico, worktree, numeros A y B, workflow y orden frente a #43-1a (`types/database.ts`), #56 (218) y #63 |
| C-2 | Contabilidad: como documentar un consecutivo DTM saltado (A6 iii-iv); no afirmar efecto legal |
| C-3 | #358/206: copia la retencion del aliado y usa `comision_b2b` con otra semantica; conciliacion y correccion separadas |
| C-4 | Brechas de identidad B2B fuera de #50, solo reportadas: `crear_cotizacion_manual` no estampa `aliado_id` (`216:605-676`); `reservarPrograma` sin `aliado_id` (`reservar/actions.ts:3231`); carrito con `aliadoId: null` (`reservar/actions.ts:1812`); la conversion de una manual directa B2B no tiene id |
| C-5 | Confirmar que todo `aereo` manual es tiquete ordinario y que los bloqueos manuales quedan fuera de v1 (D-AEREO-2); y que la definicion D-1 representa la "reserva directa" acordada cuando un asesor interviene despues |

### F. Referencias de la matriz y retiros

Verificadas exactas en `a4c999cf`: `198:561-564,592,641-662,685-696`; `211:796-902,904-947,1094-1152`; `216:258-275,833-885,921-949`; `205:101-117`; `pagos-actions.ts:222` (llamada al wrapper) y `manual-actions.ts:365,466`. **Desactualizada:** `app/portal/b2b/page.tsx:89-99`; la pertenencia ahora vive en `lib/auth/contratosPortalB2B.ts` y `accesoDocumentoContrato.ts` (migracion 193, `acceso_legacy_nombre`). **Se retiran del diseno anterior:** `programa_procedencias` y el espejo SQL de `pvpPrograma` (A2); la tolerancia de redondeo; F8 (ya cubierto por `trg_cotizaciones_no_descartar_con_pagos`, `164:352-371`); el calculo en `float8`. **Se conserva, simplificado:** origen y solicitante en la solicitud (A4).

Gate pedido al Coordinador: ninguno nuevo de codigo. Este ciclo queda a la espera de D-1 a D-6 y C-1 a C-5. Sin staging, commit, push, PR, SQL remoto ni Preview.

## Decisiones del dueno y del Coordinador suplente (2026-10-20)

Escrita por: Coordinador suplente, con autorizacion del dueno para cerrar C-1..C-5 ("el suplente puede decidirlas teniendo en cuenta los demas trabajos"). El ejecutor lo elige el dueno, no el Coordinador. Esta seccion no reescribe la entrega del ciclo 1.

**Respuestas del dueno:**
- **D-1, CAMBIA la propuesta.**
  - *Asistida:* el interno escoge.
  - *Directa:* el aliado escoge. Directa = el aliado, con su propia sesion, toma los servicios y genera la cotizacion.
  - Esto contradice la decision 5 de la matriz ("el aliado no escoge NETO"). Ademas, hoy no existe ninguna ruta en la que el aliado cree una cotizacion manual o elija en una comparativa manual (A4).
  - Queda abierta la pregunta D-1b, que bloquea el GO.
- **D-2:** pidio un ejemplo numerico; se le dio con los vectores V1/V2. Pendiente su eleccion entre M1 y M2.
- **D-3:** se confirma tal cual: 6 % lo autorizan superadmin y administracion; 2 % de solo tiquetes, solo superadmin.
- **D-4:** se confirma. Con descuento 0 no hay NETO; la hija se vende a PVP y se rechaza la hija NETO.
- **D-5:** si. Se propaga el aliado al convertir tambien en hijas legadas abiertas, solo hacia adelante y sin backfill.
- **D-6:** se le explico de nuevo. Pendiente su confirmacion.

**Decisiones del suplente (C-x):**
- **C-1, orden y reservas:**
  - Ejecutor: lo asigna el dueno.
  - Numeros reservados para #50: **222 (A) y 223 (B)**. Es reserva de numero, no GO de SQL. Ocupados: 215 #43-1a, 218 #56, 219 #42 (cerrada), 220 #67, 221 #68.
  - Worktree y rama nuevos desde el `origin/main` vigente al dar GO LOCAL.
  - Workflow exclusivo `test-222-223-neto-50.yml`, con permisos de solo lectura, sin secretos y sin Supabase remoto (patron 219/221).
  - **Orden de archivos compartidos:**
    - `app/tarifario/checkout/actions.ts` empieza despues del merge de #372 (#40 toca ese archivo).
    - `types/database.ts` va en serie despues de #68 (PR #373) y de #43-1a. Si alguno de los dos no ha fusionado al dar GO LOCAL, #50 se basa en `main` y concilia antes de su PR.
    - #56/218 y #63 no comparten archivos con #50 segun el mapa C. Sin espera.
  - **GO LOCAL no se da** hasta cerrar D-1b, D-2 y D-6.
- **C-2, DTM saltado:** sin mecanismo nuevo en v1.
  - El caso residual G1, puntos (iii) y (iv) de A6, se documenta en el PR y en el handoff como "numero consumido sin contrato por rollback", sin afirmar efecto legal.
  - El dueno lo valida con su contador. Si el contador pide un registro formal de consecutivos anulados, sera una tarea aparte.
- **C-3, #358/206:**
  - No se toca dentro de #50.
  - La fila NETO de #50 usa `aplica_retencion = false` y `pct_retencion = 0` (decision 3), distinto de la 206.
  - La conciliacion de la retencion copiada y de la semantica de `comision_b2b` en 206 queda como frente propio, a registrar en TASKS por el titular.
- **C-4, brechas de identidad B2B fuera de #50:** solo se reportan y no entran en #50.
  - `crear_cotizacion_manual` sin `aliado_id`.
  - Carrito con `aliadoId: null`.
  - `reservarPrograma` sin `aliado_id`, que va con D-6 y los residuales de #57.
  - Se registran como frentes aparte.
- **C-5:**
  - Todo `aereo` manual es un tiquete ordinario.
  - Los bloqueos manuales quedan fuera de v1.
  - La definicion de "directa" la fija D-1b; no se acepta la propuesta original de D-1.

**Pregunta abierta D-1b (para el dueno):** en la directa, ¿que escoge el aliado: PVP o NETO? Que el aliado genere su propia cotizacion manual es una capacidad nueva. Recomendacion del suplente:
- #50 v1 = solo asistida: el interno escoge PVP o NETO y si se reconoce la participacion de recobro.
- #50 v2 = directa: el aliado cotiza con su sesion y escoge. Incluye el origen `b2b_sesion` y el `solicitante_id` de A4, y una auditoria propia.

**Segunda ronda del dueno (2026-10-20, misma sesion):**
- **D-1 CERRADA.** La cotizacion manual solo la crea un interno, porque el aliado no tiene cotizacion manual. En #50 toda hija es **asistida**: el interno escoge PVP o NETO y decide si se reconoce la participacion de recobro. No hay caso "directo" en #50. **D-1b se retira** (no aplica). Lo de A4 (origen `b2b_sesion` y `solicitante_id`) sale de #50 v1.
- **D-2 CERRADA, CAMBIA B1.** El margen minimo **no se mide por servicio**: se mide sobre el **total del paquete**, como ya hace `lib/contrato/margenContrato.ts` (#30): `(total NETO - costo total) / total NETO >= 6 %`, con los costos de todas las filas, tiquete incluido. Excepcion: la venta de **solo tiquetes** usa 2 %, autorizable solo por superadmin. Consecuencias:
  - Las reglas B1.4-B1.6 (reparto por fila y piso por componente) **no se usan para el piso**. M1/M2 deja de aplicar, porque el recobro y los ninos ya estan dentro del total.
  - Se reutiliza `evaluarMargenContrato({modo:'neto'})`, con su espejo SQL antes de la 198, y se conservan la tolerancia de medio peso y `ROLES_EXCEPCION_MARGEN`.
  - Sigue la regla absoluta: el total NETO nunca por debajo del costo total.
  - El ejecutor debe revisar si el reparto del descuento por fila sigue haciendo falta para otro consumidor; si no, se retira.
  - Vectores recalculados por el suplente (COP): V1 NETO 8.850.000, costo 8.250.000, margen 6,78 %, pasa. V2 (hotel 5.200.000) costo 8.350.000, margen 5,65 %, requiere superadmin o administracion.
  - La base del descuento sigue con la formula literal PVP - tiquetes - recobro (los ninos entran a la base). No se volvio a preguntar.
- **D-6 CERRADA.** #50 no cubre Programas. NETO en `reservarPrograma` sera una tarea posterior, despues de los residuales de #57.
- **Pendiente para el GO LOCAL:** que el dueno elija el ejecutor. Antes de codigo, el ejecutor entrega un ciclo 2 de diseno, solo en esta bitacora, con B1 rehecho segun D-2, A4 retirado, alcance de archivos ajustado (sin la parte de `solicitarOpcionComparativa` si ya no hace falta) y vectores nuevos. Siguen vigentes C-1..C-5 de la seccion anterior (222/223 y el orden detras de #372, #68 y #43-1a).

## Entrega ciclo 2 - diseno rehecho segun D-1, D-2, D-4, D-5, D-6 y C-1 (2026-10-20)

Escrita para: el Coordinador titular (gate). Solo diseno; no hay codigo, SQL, rama, worktree ni numero tomado mas alla de la reserva 222/223.

**Base y anclas.** `origin/main` = `b81820857a14` (#372). Entre `a4c999cf` y ese SHA solo cambian 7 archivos de #40 (CRM y `checkout/actions.ts`, funcion `crearSolicitudReserva`): ninguna migracion, y las anclas SQL del ciclo 1 siguen exactas. `elegirOpcionComparativa` se corrio 3 lineas (ahora `checkout/actions.ts:1385`; llamada a la validacion `:1432`; `elegir_opcion_comparativa_sesion` `:1442`). Leido con `git show/grep origin/main`; sin ejecutar nada. Sigue sin estar en `main`: #67 (220) ni #68 (221, PR #373), asi que `types/database.ts` espera.

### 1. Lo que sale del ciclo 1 (D-1, D-2, D-6)

- **A4 completo:** `origen` y `solicitante_id` en la solicitud, el reemplazo de `registrar_solicitud_comparativa` y la regla de reintento por contacto. Toda hija es asistida; el origen ya queda probado por el canal `interno` de la validacion (`211:770` valida `interno_activo`) o por `resolver_solicitud_comparativa` (`211:1094`, exige `interno_activo` en `:1117`).
- **`solicitarOpcionComparativa` (`checkout/actions.ts:1458`) y `actorComparativa` (`:1200`):** no se tocan.
- **B1.4-B1.6 y M1/M2:** reparto de ingreso no asignado y piso por fila. Tampoco la tabla de autorizaciones por componente.
- **Programas:** ya estaban fuera (A2, D-6).
- **Pregunta "directo/asistido" (D-1b):** retirada. En asistida con aliado, el interno responde si se reconoce la participacion de recobro; sin aliado (B2C) no hay NETO.

### 2. B1 rehecho: margen sobre el total

**Regla (D-2 + D-3).** Se reutiliza la formula de `lib/contrato/margenContrato.ts`: `ingresoMinimo = costos / (1 - minimo)`, `cumple = costos <= 0 || ingreso + 0.5 >= ingresoMinimo` (`margenContrato.ts:38-48`, `cumple` en `:45`), con `minimo = 0,06` (`MARGEN_MINIMO_NETO`, `:19`) y `ingreso` = total NETO. `costos` = suma de `costo_neto` de TODAS las filas de servicio, tiquete incluido (igual que `198:627-634`). Roles de excepcion del 6 %: `ROLES_EXCEPCION_MARGEN` = superadmin y administracion (`:20`), con la bandera explicita de `puedeAprobarMargenBajo` (`:50-52`), como ya hace `contratos/actions.ts:526-527` para el NETO manual. Reglas adicionales de #50:
1. **Solo tiquetes** (todas las filas con valor > 0 son `aereo`): minimo 2 %; solo `superadmin` puede bajar de ahi.
2. **Piso absoluto:** `total NETO >= costos`, sin tolerancia y sin excepcion para ningun rol. La tolerancia de medio peso solo se aplica a la comparacion porcentual, como en #30.
3. **Descuento 0:** no hay NETO; se rechaza la hija NETO (D-4). Incluye porcentaje de comision 0 y redondeo a cero.
4. Costos ausentes: ver Q-2.

**Donde se evalua.**
- **(a) Al crear la hija**, dentro de `sellar_hija`, en la misma transaccion que `crear_hija`, para las dos entradas (elegir por sesion y resolver solicitud). Alli se fija el precio; un rechazo revierte la hija completa y no gasta consecutivo (el consecutivo se toma en la conversion, `198:592`). El rol sale de `usuarios` por el actor ya validado (`interno_activo`, `211:323-336`), nunca del navegador; la bandera `autorizar_margen` viaja como parametro y la base la ignora si el rol no esta autorizado.
- **(b) Antes de la 198**, en `convertir_cotizacion_manual_controlada` (`216:921-949`): se recalcula con los servicios guardados (inmutables, A1 del ciclo 1) y se compara con lo sellado; si cambia algo o falta la autorizacion registrada cuando el margen queda bajo el piso, rechazo sin consumir DTM. No pide otra vez el rol: la excepcion ya quedo registrada.
- **Registro de la excepcion:** en la cabecera sellada: `autorizado_por`, `autorizado_rol`, margen resultante, piso aplicado (6 o 2), ingreso, costos y fecha. Solo existe cuando hizo falta.

**Espejo SQL.** Funcion pura en `numeric` (no `float8`), con la comparacion en forma cruzada `(ingreso + 0.5) * 94 >= costos * 100` (y `* 98` para el 2 %) para no depender de la division. TS y SQL deben coincidir en todo vector; en el borde exacto la division en coma flotante de TS puede diferir en el ultimo digito, asi que la prueba de paridad incluye bordes y la decision la toma SQL; el TS del formulario es solo aviso previo (igual que `NuevoContratoForm.tsx:193`).

### 3. Uso real del reparto del descuento por fila

Revisados los consumidores posibles; solo uno lo necesita.

| Consumidor | Necesita descuento por fila | Ancla |
| --- | --- | --- |
| Rentabilidad / facturacion / IRT | No: total `ventas.precio_venta`, IRT desde CxP clasificadas | `lib/finanzas/rentabilidad.ts:55,86,103-107` |
| CxP y asientos de costo | No: salen de `costo_neto` por fila, que el NETO no cambia | `198:749-805` |
| Documento del contrato (items) | No: en NETO se ocultan los valores por item | `lib/contrato/presentacionValores.ts:25-39` |
| Comisiones, portal, cuenta de cobro | No: leen `comision_b2b` y `comision_estado` | `lib/finanzas/comisionB2B.ts:343-345` |
| Margen | No (D-2) | `margenContrato.ts:38-48` |
| **Condiciones de pago congeladas** (`cotizacion_condiciones` -> `contrato_condiciones`) | **Si** | ver abajo |

Las condiciones guardan por componente `valor_componente` y `monto_exigido` (`198:218-238,698-708`). El contrato externo imprime el "Pago minimo" de cada fila (`components/contrato/ContratoDocumento.tsx:711,729`) y el panel interno `valor` y `exigido` (`CondicionesContratoPanel.tsx:99-102`); el resumen divide el exigido total entre `ventas.precio_venta` (`lib/contrato/condicionesContrato.ts:279-287`). Con el exigido por defecto de 30 % para filas no aereas (`lib/cotizacion/condicionPago.ts:331`, configurable) y 100 % para el aereo, si el snapshot quedara a PVP el comprador B2B podria despejar el PVP de cada fila a partir del "Pago minimo" (hotel 1.800.000 / 0,30 = 6.000.000 en V1) y, con el total NETO, la comision: lo que la decision del 2026-10-10 evita ocultando los valores por item; y el porcentaje informativo saldria inflado (48,02 % en lugar de 44,97 % en V1). **Conclusion:** el reparto por fila se conserva SOLO para el snapshot de condiciones (Q-3 pregunta si se acepta o se prefiere el snapshot a PVP).

**Regla que queda (la B1.4 del ciclo 1, sin margen):** el tiquete (`aereo`) conserva su PVP y su 100 %; la comision ordinaria se reparte entre las unidades de la base (filas no-tiquete, mas los ninos si su monto es > 0, mas el recobro si no se reconoce la participacion) en proporcion a su PVP, por mayor resto en centavos y empate al menor `(orden, id)`; la participacion se carga al recobro. Solo las filas de servicio entran al snapshot (los ninos y el recobro quedan fuera, como hoy, `p39_priv.componentes_manual`, `216:244-256`). Se guardan `pvp`, `descuento` y `neto` por fila; no se guardan costos ni margenes por fila.

### 4. Vectores (COP)

Filas comunes: aereo 2.000.000 (costo 1.900.000), hotel 6.000.000 (5.100.000), traslado 1.000.000 (850.000), asistencia 500.000 (400.000); recobro 500.000 (aliado 250.000); ninos 0; comision 12 %; costos 8.250.000.

| Id | Caso | Resultado esperado |
| --- | --- | --- |
| V1 | Reconoce participacion. Base 7.500.000; ordinaria 900.000 + participacion 250.000 = D 1.150.000; NETO 8.850.000; costo 8.250.000 | Margen (8.850.000 - 8.250.000) / 8.850.000 = 6,78 %; minimo de ingreso 8.776.595,74; **pasa** sin autorizacion. Snapshot: hotel 5.280.000, traslado 880.000, asistencia 440.000, aereo 2.000.000; exigido 1.584.000 + 264.000 + 132.000 + 2.000.000 = 3.980.000 (a PVP seria 4.250.000) |
| V2 | Igual, hotel 5.200.000 => costo 8.350.000 | Margen 5,65 %; minimo de ingreso 8.882.978,72; **requiere autorizacion**: superadmin o administracion con la bandera => aceptada y registrada (actor, rol, 5,65 %, piso 6); gerencia, operaciones o venta, o sin bandera => rechazo antes de crear la hija |
| V3 | Igual a V1 con costo 8.850.000 (= NETO) | Solo con autorizacion; pasa (no baja del costo) |
| V3b | Costo 8.850.001 | **Rechazo sin excepcion**, tambien superadmin (NETO bajo el costo) |
| V4 | Solo tiquetes: aereo 2.000.000 + recobro 100.000 (aliado 50.000), reconoce; base 2.100.000 - 2.000.000 - 100.000 = 0; ordinaria 0; D = participacion 50.000; NETO 2.050.000. Costo 2.009.000 | Margen 2,00 % exacto: **pasa** (`2.050.000,5 >= 2.050.000`). Con el minimo en forma cruzada: `2.050.000 * 98 = 2.009.000 * 100` |
| V4b | Mismo, costo 2.009.000,01 (un centavo por encima del limite) | **Contradiccion con el pedido, ver Q-1:** con la tolerancia de medio peso PASA (`2.050.000,5 >= 2.050.000,0102`); si 2 % fuera exacto, se rechaza y exige superadmin |
| V4c | Mismo, costo 2.009.001 (un peso) | **Requiere superadmin**; administracion, gerencia, operaciones y venta rechazadas |
| V5 | Solo tiquetes 2.000.000 sin recobro (D = 0) | **Hija NETO rechazada** (D-4); se vende a PVP. Igual con porcentaje 0 o descuento que redondea a 0 |
| V6 | Asistida sin reconocer participacion. Base 8.000.000; D 960.000; NETO 9.040.000; costo 8.250.000 | Margen 8,74 %: pasa. Reparto: hotel 720.000, traslado 120.000, asistencia 60.000, recobro 60.000 |
| V7 | Resto: tres filas de 10,00 con ordinaria 1,00 | 0,34 / 0,33 / 0,33 (el centavo sobrante a la fila de menor `(orden, id)`) |

### 5. Mapa de archivos ajustado (nada reservado salvo 222/223)

**Sale respecto del ciclo 1:** `solicitarOpcionComparativa` y `actorComparativa`; columnas `origen/solicitante_id` y el reemplazo de `registrar_solicitud_comparativa`; tabla de autorizaciones aparte (queda embebida en la cabecera); columnas de costo/margen por fila; el modulo de reparto de ingreso no asignado; las pruebas N6 (origen) y las de piso por fila.

**Entra o cambia:** (i) la formula del margen ya existe y se reutiliza; (ii) la excepcion del 2 % solo-tiquetes obliga a una modificacion MINIMA de `lib/contrato/margenContrato.ts` (parametro opcional de minimo y de rol, sin cambiar el comportamiento por defecto) o a un helper nuevo que la importe; se propone lo primero para no duplicar la formula, con `pruebas/margenContrato.test.ts` como regresion. Lo decide el Coordinador porque el archivo es de #30.

| Migracion | Contenido |
| --- | --- |
| **222 (A, aditiva)** | Esquema privado de #50 y dos tablas insert-only con RLS y sin permisos a `anon/authenticated/service_role`: **cabecera sellada** (modalidad, reconoce, aliado, tipo, PVP, tiquetes, recobro, base, porcentaje, ordinaria, participacion, D, NETO, costos, margen, piso, solo-tiquetes, autorizacion si hubo) y **filas del snapshot** (`pvp/descuento/neto` por servicio). Columnas nuevas `modalidad/reconoce_recobro/autorizar_margen` en `cotizacion_comparativa_validaciones`. Funciones privadas: calculo en centavos, espejo de margen, `sellar_hija` (incluye `payload.recobroAliado = 0` para NETO), comparacion de snapshot NETO, `completar_conversion` (identidad B2B para sellada PVP/NETO y para legada abierta, D-5), lectura acotada para el panel. Funciones publicas **con nombre nuevo** (`registrar_validacion_comparativa_n50`, `resolver_solicitud_comparativa_n50`) para evitar la ambiguedad de sobrecarga en PostgREST; `CREATE OR REPLACE` con la misma firma de `elegir_opcion_comparativa_sesion` (sella si la validacion trae modalidad), `registrar_pago_previo_rev` (rama NETO) y `convertir_cotizacion_manual_controlada` (rama NETO + identidad). Firmas viejas intactas |
| **223 (B, cierre)** | Las firmas viejas `registrar_validacion_comparativa` y `resolver_solicitud_comparativa` rechazan la hija de una madre manual B2B sin modalidad (siguen sirviendo a carrito, publico y B2C); `elegir_opcion_comparativa_sesion` exige modalidad en ese mismo caso; scripts y postcheck del cierre. Solo despues de desplegar la app |

| Archivo | Accion |
| --- | --- |
| `lib/cotizacion/netoHija.ts` | NUEVO, puro: calculo en centavos, reparto del snapshot, llamada a la formula de margen |
| `lib/contrato/margenContrato.ts`, `pruebas/margenContrato.test.ts` | Ver (ii) |
| `lib/cotizacion/comparativaAcciones.tsx` | MODIFICA: selector PVP/NETO, pregunta de recobro y casilla de autorizar margen solo a los roles que corresponden, con vista previa (base, ordinaria, participacion, D, NETO, margen y minimo) |
| `app/tarifario/checkout/actions.ts` | MODIFICA solo `elegirOpcionComparativa` (`:1385`, llamada `:1432`); despues del merge de #372 (ya cumplido) |
| `app/(dashboard)/dashboard/cotizaciones/manual-actions.ts` | MODIFICA `resolverSolicitudComparativa` (parametros nuevos) y mensajes de la conversion; sin otra puerta |
| `.../cotizaciones/pagos-actions.ts` | MODIFICA el armado del snapshot del primer pago para una hija NETO (valores y total NETO) |
| `.../cotizaciones/[id]/page.tsx`, `components/cotizacion/PagosPreviosPanel.tsx` | MODIFICAN: total, saldo y exigible NETO con marca de modalidad |
| `types/database.ts` | Solo objetos nuevos, en serie tras #68 y #43-1a |
| `package.json` | Registrar las `*.react.ts` nuevas en `test:react` |
| `.github/workflows/test-222-223-neto-50.yml` | NUEVO (ver 6) |
| Solo lectura | Migraciones 164/198/205/206/211/216/217/219; `lib/finanzas/*`, `lib/auth/*`, `ContratoDocumento.tsx`, `CotizacionManualDocumento.tsx`, `app/cot/[token]`, `reservar/actions.ts`, `solicitarOpcionComparativa` |

Los puntos del ciclo 1 que no cambian: diseno B (la hija conserva PVP; la rama NETO fija exigido y congelado; un helper SECURITY DEFINER completa `ventas` tras la 198), la fila `aliados_b2b` descontada con `aplica_retencion = false`, el cierre G1 y la convivencia con la frontera de #39 (B3-B5 del ciclo 1, A1, A3, A5, A6).

### 6. Pruebas y workflow

Solo corre en GitHub Actions lo que necesita PostgreSQL; en el PC del dueno (sin Docker) solo TS, React, `tsc` y `npm run build`.

| Id | Que demuestra |
| --- | --- |
| M1 | Margen: V1-V6 y bordes de 6 % y 2 % (+-1 centavo, +-1 peso), piso absoluto V3/V3b, roles por REST y por la app, registro de la excepcion |
| M2 | Paridad TS-SQL: el mismo archivo de vectores, importando el modulo TS real y la funcion SQL real |
| M3 | Descuento 0 (D-4): con y sin recobro, porcentaje 0, redondeo a 0 |
| R1 | Reparto del snapshot: suma de descuentos = ordinaria + participacion, resto estable (V7), exigido V1, COP y USD |
| S1 | Nacimiento: las dos entradas en PVP y NETO, reintento con la misma clave, misma clave con otra modalidad falla, `venta` no fija NETO por REST, B2C sin NETO, carrito y publico intactos, orden de #42 conservado |
| P1 | Pago NETO: snapshot NETO exigido, primer pago > NETO rechazado antes de la 198, segundo pago y reintento, USD/TRM, snapshot PVP a hija NETO y al reves rechazados |
| C1 | Conversion: forma NETO completa, items a PVP, una sola fila descontada con total = D, ninguna CxP/pago/retencion por D, abonos y saldos |
| I1 | Identidad: `ventas.aliado_id/tipo_asesor/nombres` en PVP y NETO sellados y en legadas abiertas (D-5, sin backfill); portal de otro aliado con el mismo nombre; ausente o discordante en sellada bloquea antes de numerar |
| D1 | DTM: rechazos nuevos +0, 198 directa sin congelar +0, con hija congelada +1 documentado, fallo inyectado tras la 198 con rollback total |
| F1 | Regresion de #39: `frontera_activa()`, 7 disparadores, grants, hija no editable, y la suite completa de 216/217 |
| G1 | Regresion de la 198: `test_164_conversion_battery.sql` y `test_164_conversion_concurrency.sh`; de 211: `test_211_*`; de 206 y 205 |
| A1 | ACL: tablas nuevas sin grants, esquema privado fuera de Data API, funciones nuevas solo `service_role`, `search_path` con `pg_temp` al final, ninguna `IMMUTABLE` que lea catalogos |
| T1 | Cableado TS: ninguna ruta llama la 198 ni `registrar_pago_previo` directo; la modalidad nunca se lee sin validar |
| U1 | React: selector solo para los 4 roles y bandera de margen solo superadmin/administracion; panel de pagos NETO; cotizacion publica en PVP sin NETO ni D; contrato NETO (regresion `contratoDocumentoNeto.react.ts`) |
| X1 | Despliegue: preflight, 222, app, 223, postcheck y rollback de cada una; la app nueva sobre 222 sola y la vieja sobre 222 funcionan. Comprobar el orden con 220/221 si ya estan en `main` |

**Workflow exclusivo `.github/workflows/test-222-223-neto-50.yml`** (patron `test-216-217-cotizacion-edicion.yml`, leido en `origin/main`): `permissions: contents: read`; disparo solo por `pull_request` a `main` y `workflow_dispatch` (nunca `pull_request_target`); filtro de rutas a la 222/223, `*_222_*`/`*_223_*`, `pruebas/netoHija*`, `lib/cotizacion/**`, `lib/contrato/margenContrato.ts`, las acciones tocadas, `package.json` y el lock; PostgreSQL de Supabase y PostgREST desechables dentro del runner, JWT firmados con un secreto aleatorio local; sin secretos del repositorio ni Supabase remoto; acciones fijadas por SHA; un segundo job de TS/React con Node de version exacta. Corre las baterias nuevas mas F1 y G1. Produccion sigue con preflight, migracion y postcheck manuales del dueno.

### 7. Riesgos y preguntas explicitas

**Preguntas (no las resuelvo yo):**
- **Q-1. Tolerancia del 2 %.** Se pidio conservar la tolerancia de medio peso y a la vez un vector "un centavo por debajo" del 2 %. Con la tolerancia ese vector pasa (V4b). ¿La tolerancia aplica tambien al 2 % de solo tiquetes, o el 2 % es exacto? Recomendacion: 6 % con tolerancia (identico a #30); 2 % exacto, por ser regla nueva y de autorizacion exclusiva de superadmin.
- **Q-2. Costos ausentes.** `evaluarMargenContrato` da por bueno un total sin costos (`costos <= 0`, `margenContrato.ts`), y la prueba de #30 lo fija (`margenContrato.test.ts:61`). En el ciclo 1 se propuso fallar cerrado. ¿Se mantiene el comportamiento de #30 o #50 rechaza una hija NETO cuyo costo total sea 0, o con una fila de valor > 0 y costo 0? Recomendacion: rechazar el costo total 0; una fila suelta sin costo (TA puro) se permite.
- **Q-3. Snapshot de condiciones.** ¿NETO (recomendado, seccion 3) o PVP? PVP evita la rama de composicion y el reparto por fila, pero el "Pago minimo" por fila permite despejar el PVP y la comision, y el porcentaje informativo sale inflado.
- **Q-4. Hijas legadas abiertas de una madre B2B sin `aliado_id`.** La 211 lo permite (`211:661-668`). D-5 manda propagar el aliado al convertir; no dice si bloquear cuando falta. Recomendacion: propagar cuando exista y mantener el comportamiento actual cuando no exista (solo hacia adelante); la decision 8 (bloquear antes de numerar) rige solo para las hijas selladas por #50.

**Riesgos:**
1. La 222 cambia el resultado de las conversiones PVP de hijas legadas (identidad, D-5) en cuanto se aplica, antes de que la app nueva exista: es parte de la regresion G1/I1.
2. Los dos wrappers de 216 pasan a ramificarse por modalidad; cualquier error rompe la ruta de dinero de #39. Mitigacion: rama PVP identica, suite completa de 216/217 y firmas intactas.
3. Sellar una hija NETO modifica su `payload` (`recobroAliado = 0`) dentro de la propia operacion de creacion; hay que probar que la frontera de 217 (`216:415-478`, que ignora al dueno de la funcion) y `tg_cotizaciones_guarda` (`211:386`) lo admiten.
4. El `costo_neto` lo digita el asesor: se prueba su coherencia, no su verdad contra la factura del proveedor.
5. Un fallo imprevisto del helper tras la 198 revierte y consume un consecutivo (C-2: se documenta, no se resuelve).
6. La paridad TS-SQL en el borde del porcentaje depende de la forma cruzada; si el TS diverge por coma flotante, manda SQL.
7. `types/database.ts` y la numeracion: 220/221 no estan en `main`; el preflight de la 222 debe verificar la cadena real antes de aplicar.
8. El rollback de la 222 con hijas ya selladas tiene que conservar la tabla o negarse; no se debe perder el sello de una hija con pagos.

**Puntos que tocan lo decidido, sin resolver:** solo Q-1 contradice un pedido literal; Q-2 y Q-4 son huecos que D-2 y D-5 no cubren; Q-3 confirma que el reparto por fila sigue vigente para un consumidor.

Gate pedido al Coordinador: ninguno nuevo; este ciclo queda a la espera de Q-1 a Q-4 y del ejecutor que designe el dueno. Sin staging, commit, push, PR, SQL remoto ni Preview.

## Gate del Coordinador suplente sobre el ciclo 2 (2026-10-20)

Revisado contra las decisiones D-1..D-6 y C-1..C-5 de este archivo y contra `lib/contrato/margenContrato.ts`. El diseno es coherente con lo decidido: margen sobre el total, sin caso directo, sin Programas, reparto por fila solo para el snapshot de condiciones (justificado con anclas) y 222 aditiva / 223 de cierre despues del despliegue. **Diseno aprobado**, con estas resoluciones:

- **Q-1, la decide el suplente:** el 6 % conserva la tolerancia de medio peso, identico a #30. El 2 % de solo tiquetes es **exacto**, en forma cruzada y sin tolerancia (V4b se rechaza y exige superadmin).
- **Q-2, va al dueno:** si el costo total es 0. Recomendacion del suplente: rechazar una hija NETO con costo total 0 y permitir una fila suelta sin costo. Sin esta respuesta no hay GO LOCAL.
- **Q-3, la decide el suplente:** snapshot de condiciones en **NETO**, con el reparto por fila de la seccion 3. PVP filtraria la comision por el "Pago minimo".
- **Q-4, la decide el suplente:** se acepta la recomendacion. Si existe el aliado se propaga; si falta, en hijas legadas se mantiene el comportamiento actual (solo hacia adelante). El bloqueo antes de numerar rige solo para hijas selladas por #50.
- **`margenContrato.ts` (archivo de #30, cerrado):** se autoriza la modificacion MINIMA propuesta, con un parametro opcional de minimo y de roles, sin cambiar el comportamiento por defecto. `pruebas/margenContrato.test.ts` sigue verde sin tocar sus aserciones; solo se agregan casos.
- **Orden actualizado:**
  - `main` = `51ca079e`: #372 y #68 ya estan fusionados y la 221 esta aplicada en Produccion.
  - `types/database.ts` solo espera a #43-1a si fusiona antes; si no, #50 concilia antes de su PR.
  - La 220 (#67) sigue sin aplicar. El preflight de la 222 verifica la cadena real (219, 221 y, si existe, 220) y no asume huecos.
- **Riesgos 1-3 y 8:** se convierten en criterios de aceptacion obligatorios del GO LOCAL: G1/I1, la suite completa 216/217 con la rama PVP identica, una prueba de que la frontera 217 admite el `payload` sellado y un rollback de la 222 que se niega con hijas selladas.

**Estado:** queda pendiente el GO LOCAL hasta que se cumplan dos cosas: (1) el dueno responde Q-2 y (2) el dueno designa al ejecutor. Despues el Coordinador fija la reserva de archivos (la tabla de la seccion 5 mas el workflow) y da el GO LOCAL. Sin codigo hasta entonces.

## GO LOCAL #50 y reserva (Coordinador suplente, 2026-10-20)

**Q-2 (dueno):** "si tiene costo $0 se rechaza completamente". Si el costo total de una hija NETO es 0, se rechaza **sin excepcion para ningun rol**. Lectura del suplente: si el costo total es mayor que 0, una fila suelta con costo 0 se permite (la regla sigue siendo sobre el total). Si el dueno quiere tambien rechazar cada fila con costo 0, es un cambio explicito.

**Ejecutor:** el que reciba el prompt del dueno, como unico ejecutor de codigo de #50.

**Base:** `origin/main` `51ca079e` (verificarla al crear). Worktree `.claude/worktrees/neto-hija-50` y rama `codex/50-neto-hija-manual`, ambos nuevos.

**Reserva exclusiva** (rutas bajo `dspacios-travel/`, salvo el workflow):
- Migraciones `supabase/migrations/20260601000222_neto_hija_manual.sql` (A, aditiva) y `20260601000223_neto_hija_manual_cierre.sql` (B, cierre). Scripts `supabase/scripts/{preflight,postcheck,rollback,test}_222_*` y `_223_*`, y runners focales.
- Nuevos: `lib/cotizacion/netoHija.ts` y `pruebas/netoHija*`.
- `lib/contrato/margenContrato.ts`: cambio MINIMO, con parametro opcional de minimo y de roles y sin cambiar el comportamiento por defecto. `pruebas/margenContrato.test.ts`: solo agregar casos.
- `lib/cotizacion/comparativaAcciones.tsx`.
- `app/tarifario/checkout/actions.ts`: SOLO `elegirOpcionComparativa`.
- `app/(dashboard)/dashboard/cotizaciones/manual-actions.ts`: `resolverSolicitudComparativa` y los mensajes de conversion.
- `app/(dashboard)/dashboard/cotizaciones/pagos-actions.ts`.
- `app/(dashboard)/dashboard/cotizaciones/[id]/page.tsx` y `components/cotizacion/PagosPreviosPanel.tsx`.
- `types/database.ts`: solo objetos nuevos. Si #43-1a fusiona antes, conciliar.
- `package.json`: solo para registrar en `test:react` las `*.react.ts` nuevas de #50.
- `.github/workflows/test-222-223-neto-50.yml`.

**Solo lectura:** migraciones 164/198/205/206/211/216/217/219/221; `lib/finanzas/*`, `lib/auth/*`, `ContratoDocumento.tsx`, `CotizacionManualDocumento.tsx`, `app/cot/[token]`, `reservar/actions.ts` y `solicitarOpcionComparativa`. Prohibido editar migraciones existentes.

**Criterios de aceptacion:** las pruebas M1-X1 de la seccion 6 del ciclo 2, mas los riesgos 1-3 y 8 como pruebas obligatorias. Q-1: 2 % exacto. Q-3: snapshot NETO. Q-4: segun la recomendacion. Q-2: costo total 0 rechazado (vector nuevo).

**Fuera de este GO:** SQL remoto, staging, commit, push, PR y Preview. Nota para el titular: pasar esta reserva a `WORKSTREAMS.md`.


## Entrega ciclo 3 - implementacion local de #50 (2026-10-20)

Ejecutor unico de codigo. Nada se ejecuto en SQL; nada se subio.

### 1. Base y estado Git

- Base: `origin/main` `51ca079e474abb9573243109f1ca08ed4b165d5a` (#373). Rama `codex/50-neto-hija-manual`, worktree `.claude/worktrees/neto-hija-50`. HEAD = base.
- Sin commit, sin staging, sin push, sin PR, sin Preview, sin SQL remoto. `git diff --check` limpio; `pnpm-lock.yaml` sin cambios; no existe `middleware.ts`.
- `node_modules` propio del worktree (`pnpm install --frozen-lockfile`), ignorado por git. No se leyo ningun `.env*` ni `sitio-web/node_modules`.
- Modificados (8, +444 -17): `app/(dashboard)/dashboard/cotizaciones/[id]/page.tsx`, `.../manual-actions.ts`, `.../pagos-actions.ts`, `app/tarifario/checkout/actions.ts`, `components/cotizacion/PagosPreviosPanel.tsx`, `lib/cotizacion/comparativaAcciones.tsx`, `package.json`, `types/database.ts`.
- Nuevos (19): migraciones `222_neto_hija_manual.sql` (1133 lineas) y `223_neto_hija_manual_cierre.sql`; scripts `preflight_222`, `postcheck_222`, `postcheck_223`, `rollback_222`, `rollback_223`, `test_222_fixtures.sql`, `test_222_neto_hija.sql`, `test_222_neto_hija.sh`, `test_222_sellada_persistente.sql`, `test_223_neto_hija_cierre.sql`; `lib/cotizacion/netoHija.ts`; `pruebas/netoHija50.vectores.json`, `netoHijaPuro.test.ts`, `netoHijaAcciones.test.ts`, `netoHijaCableado.wiring.test.ts`, `netoHijaModalidad.react.ts`; `.github/workflows/test-222-223-neto-50.yml`.
- Todos dentro de la reserva. El JSON de vectores se movio de `pruebas/fixtures/` a `pruebas/netoHija50.vectores.json` justamente para quedar dentro de `pruebas/netoHija*`.

### 2. Que hace cada pieza

- **222 (A, aditiva).** Guardas (cadena 211/216/217/219/221, `frontera_activa()`, md5 de la 198 `edc9975010746e53e4af6a75ad9763dc`, sin objetos #50 previos). Esquema `p50_priv` (solo `service_role`) con `config.exigir_modalidad`. Tablas `cotizacion_neto` (cabecera sellada) y `cotizacion_neto_componentes` (reparto por fila, solo para el snapshot de condiciones de pago), RLS activa, sin policies, insert-only por trigger. Columnas `modalidad/reconoce_recobro/autorizar_margen` en `cotizacion_comparativa_validaciones`. Funciones en centavos enteros: reparto por mayor resto, comision ordinaria con redondeo half-up a la unidad de la moneda, margen 6 % con tolerancia de medio peso, solo-tiquetes 2 % exacto por multiplicacion cruzada, piso neto >= costos, costo total 0 rechazado sin excepcion. Reemplaza `elegir_opcion_comparativa_sesion`, `resolver_solicitud_comparativa`, `registrar_pago_previo_rev` y `convertir_cotizacion_manual_controlada` (los dos wrappers siguen INVOKER). Nombres nuevos `registrar_validacion_comparativa_n50` (service_role) y `resolver_solicitud_comparativa_n50` (authenticated, identidad `auth.uid()`) para evitar ambiguedad de sobrecarga en PostgREST. La 198 NO se toca: `p50_priv.completar_conversion` (SECURITY DEFINER) baja `ventas.precio_venta` a NETO y deja la forma NETO despues de la 198.
- **223 (B, cierre).** Solo `update p50_priv.config set exigir_modalidad = true`, con guardas. Se aplica DESPUES de desplegar la app.
- **App.** `elegirOpcionComparativa` valida la modalidad antes de tocar la base y usa la RPC n50 solo si hay modalidad; `resolverSolicitudComparativa` acepta modalidad al confirmar; el snapshot del primer pago de una hija NETO usa el reparto sellado; nueva accion `contextoModalidadNeto` entrega la vista previa (venta no recibe cifras); la UI agrega el panel PVP/NETO, reconoce recobro Si/No y autorizar margen; la pagina y el panel de pagos muestran el desglose NETO a los roles con pagos.

### 3. Pruebas: que cubre cada una y resultado REAL (todo local)

| Prueba | Cubre | Resultado |
| --- | --- | --- |
| `netoHijaPuro.test.ts` | Vectores V1-V11 desde el JSON compartido (V1 8.850.000, V2 5,65 %, solo-tiquetes 2 % y un centavo por debajo, descuento 0, NETO bajo costo, costo total 0), reparto por mayor resto, redondeo, constantes iguales a las de la migracion (T2) | 17/17 |
| `netoHijaAcciones.test.ts` | Server actions con Supabase simulado: orden de validacion, canal no interno, carrito, rutas con y sin modalidad, snapshot de pagos NETO, `contextoModalidadNeto` por rol y tenant | 23/23 |
| `netoHijaCableado.wiring.test.ts` | Ninguna ruta llama la 198 ni `registrar_pago_previo` directo; solo checkout llama el recibo n50 y solo manual-actions el resolver n50; wrappers INVOKER; 198 sin tocar; 222/223 numeros reservados; workflow sin secretos ni `pull_request_target` y acciones por SHA | 10/10 |
| `netoHijaModalidad.react.ts` | Selector de modalidad y panel (jsdom): bloqueos, mensajes, envio de campos, rol venta sin cifras | 14/14 |
| Grupo relacionado (netoHija*, margenContrato, contratoManualNeto, contratoNetoB2B, comparativa35 checkout/paridad/cableado, edicion39 acciones/cableado, documentosContrato.wiring, personas42) | Regresion de lo que toca | 261/261 |
| `pnpm test:react` completo | Incluye `cotizacionComparativa35Ui.react.ts` 12/12 sin cambios | 654/654 |
| `test:unit` completo | Comparado contra la base limpia `51ca079e` en un worktree aparte | Rama 6260 pruebas, 12 fallos; base 6210 pruebas, 12 fallos; los dos conjuntos de fallos son IDENTICOS (diff vacio). Son preexistentes (CRM leads, HotelModal/UbicacionHotel, archivos react sin registrar en suitesPruebas, pruebas de texto de 214/221) |
| `npx tsc --noEmit` | Tipos | limpio |
| eslint de los archivos tocados | Estilo y reglas de hooks | limpio |
| `npm run build` (Next 16.3.0 Turbopack, URL de Supabase ficticia) | Build real | exit 0 |

### 4. Pendiente de CI (NO ejecutado; sin Docker local)

- Aplicar 222 y 223 reales, preflight (P1-P12), postcheck 222 (16) y 223 (5), rollback EXACTO por huella y rollback que se niega con hijas selladas.
- Baterias SQL M, R, S, P, C, I, D, F, A, G y la del cierre 223, y las de #39 (216/217) y #35 (211) con la 222 presente.
- Permisos por rol con `set role` + JWT; carreras. NO se probo HTTP real contra PostgREST ni las carreras/API de 216/217 con la 222 (sus scripts arman su propia plantilla sobre la 214).
- El `import()` perezoso de un modulo "use server" desde el componente cliente solo esta verificado por compilacion (build ok), no en un navegador.
- El workflow `test-222-223-neto-50.yml` nunca corrio. Las marcas que exige (`OK    M1 preflight`, etc.) salen del runner `test_222_neto_hija.sh`, tampoco ejecutado; si una marca no coincide, el CI fallara por texto, no por logica: es el primer sitio a mirar.
- Revision independiente del SQL (subagente de solo lectura, sin ejecutar nada; es lectura, no sustituye al CI). Resultado: 1 defecto bloqueante, en una PRUEBA y no en la migracion. `test_222_neto_hija.sql` grupo M declaraba la variable PL/pgSQL `id` y la fixture tiene la columna `t222.vectores.id`: con `plpgsql.variable_conflict = error` daria 42702 y, con `ON_ERROR_STOP`, el CI saldria en rojo antes de los demas controles. CORREGIDO: variable renombrada a `vid` y `order by t222.vectores.id` calificado; revisado a mano que no queda otra variable `id` ni `id :=` en las pruebas 222/223. Sin ejecutar (el fallo y su arreglo son por lectura). El revisor tambien reimplemento en Python el calculo SQL contra los 14 vectores y coincidieron, y comparo carácter a carácter los 4 cuerpos restaurados por el rollback con 211/216 (identicos).
- Dudas del revisor, abiertas (no confirmables leyendo): (a) redondeo de la comision en el borde exacto de .5: SQL usa numeric exacto, TS usa `Math.round` sobre float; falta un vector con `base x pct` en .5 corrido por ambos lados; (b) en un despliegue mixto, un reintento de la app VIEJA con la clave ya usada y la hija ya sellada recibe `COMPARATIVA_CLAVE` en vez de la hija, lo que contradice el "comportamiento identico" de la cabecera de la 222 (solo ocurre durante el desfase de despliegue); (c) `create trigger` dentro de la transaccion del grupo D6 tras insertar en `aliados_b2b`, solo fallaria con eventos de disparador diferidos pendientes. Etiqueta cosmetica de R2.4 ("a PVP serian 4.250.000") sin efecto en la asercion.

### 5. Desviaciones del diseno

1. `lib/contrato/margenContrato.ts` NO se modifico (el cambio estaba autorizado, pero no hizo falta): `netoHija.ts` lo importa para el 6 % y el 2 % exacto se implementa en TS y SQL por multiplicacion cruzada sin tolerancia (Q-1).
2. La accion de servidor `contextoModalidadNeto` vive en `pagos-actions.ts` (archivo reservado) y la UI la carga con `import()` perezoso, porque `comparativaDocumento.tsx` (padre, no reservado) no puede pasar la capacidad por props. Se quito el import de `acceso.ts` de `pagos-actions.ts` (el tenant se compara en linea) para no romper la prueba React existente de #35.
3. Vectores en `pruebas/netoHija50.vectores.json` (no en `pruebas/fixtures/`).
4. Las hijas solo-tiquetes no se alcanzan por comparativas con filas de hotel; se prueban con fixtures directas.
5. `detalle.recobro.aliado` de la hija no se actualiza cuando el sellado deja `payload.recobroAliado = 0`; el original queda en `recobro_aliado_original` de la cabecera.
6. El desglose NETO se muestra solo a roles con pagos (no a venta).

### 6. Preguntas

- **Q-5.** Despues de la 223, una madre B2B sin aliado del catalogo no puede producir hija NETO ni, por Q-4, seguir como hasta hoy: queda sin salida hasta enlazar el aliado. ¿Aceptado, o la 223 debe esperar a que no haya madres asi en produccion (consulta de preflight)?
- **Q-6.** ¿Se permite pasar la capacidad por props desde `comparativaDocumento.tsx` (archivo no reservado) para quitar el `import()` perezoso?
- **Q-7.** ¿El CI debe repetir las carreras y la API HTTP de 216/217 con la 222 presente? Hoy no lo hace.
- **Q-8.** ¿Se actualiza `detalle.recobro.aliado` de la hija al sellar, o basta la cabecera `cotizacion_neto`?
- **Q-9.** Esperar la primera corrida del CI (nunca ha corrido el SQL) antes de abrir PR. Las dudas (a) y (b) de la revision: ¿agrego un vector de borde .5 en TS y SQL, y acepto o ajusto la cabecera de la 222 sobre el reintento con firma antigua?

Gate: lo decide el Coordinador.

## Gate del Coordinador suplente sobre el ciclo 3 (2026-10-21)

**Verificado por el suplente:**
- 27 archivos, todos dentro de la reserva; `margenContrato.ts` sin tocar.
- `package.json` solo agrega `pruebas/netoHijaModalidad.react.ts` a `test:react`.
- `git diff --check` limpio y sin staging.
- Repetidas: `netoHijaPuro` + `netoHijaAcciones` + `netoHijaCableado` + `margenContrato` = 59/59; React `netoHijaModalidad` = 14/14.
- `main` avanzo a `0d360b39` (#67, 220 aplicada en Produccion). El unico archivo comun es `types/database.ts` y sus hunks de #67 aplican sin conflicto. El CI de la 222 arma el esquema hasta la 221, asi que tras el rebase incluye la 220 real; la guarda de la 222 ya la admite presente o ausente.

**Respuestas:**
- **Q-5:** la 223 no puede dejar sin salida a una madre B2B sin aliado. Regla: la modalidad **PVP** se permite sin aliado (comportamiento de hoy, Q-4) y solo **NETO** exige aliado del catalogo. Si la 223 tal como esta bloquea tambien la PVP, se corrige en este ciclo (223 y su prueba). El preflight de la 223 cuenta ademas, solo como INFO, las madres B2B abiertas sin `aliado_id`.
- **Q-6:** no se amplia la reserva. Se mantiene el `import()` perezoso; se verifica en Preview antes de Ready.
- **Q-7:** no se exigen las carreras ni la API HTTP de 216/217. Son obligatorias en CI la bateria SQL completa de 216/217 con la 222 presente (F1) y la de la 198, incluida `test_164_conversion_concurrency.sh` (G1). Ademas, prueba humana en Preview de pago previo y conversion PVP y NETO.
- **Q-8:** basta la cabecera `cotizacion_neto`, siempre que ningun consumidor de dinero ni documento lea `detalle.recobro.aliado` de la hija. El ejecutor lo confirma con busqueda y ancla. Si alguno lo lee, se actualiza al sellar.
- **Q-9 (a):** agregar vectores de borde .5 (`base x pct` exactamente en .5, en COP y en USD) al JSON compartido, corridos por TS y SQL. El TS debe calcular en centavos enteros (sin `Math.round` sobre float del producto) para coincidir; manda SQL.
- **Q-9 (b):** se acepta el comportamiento durante el desfase de despliegue, pero se corrige el texto de la cabecera de la 222 para no afirmar "comportamiento identico", y se documenta en el PR.
- **Q-9 (c):** se acepta; lo valida el CI.

**Gate:** GO a los ajustes de Q-5 (si aplica), Q-8 (verificacion), Q-9a y Q-9b dentro de la misma reserva. Despues: commit, rebase sobre `origin/main` `0d360b39`, push y PR **Draft** (los hace el dueno) para que corra el workflow por primera vez. NO GO a Ready hasta tener CI verde, la prueba en Preview y el inventario agregado. 222 y 223 sin ejecutar en Produccion.


## Entrega ciclo 4 - ajustes del gate del ciclo 3 (2026-10-21)

Dentro de la MISMA reserva, sin commit, sin staging, sin push, sin PR y sin SQL remoto. Nada del SQL se ejecuto (sin Docker); todo el SQL queda para el CI.

### 1. Estado Git

- Rama `codex/50-neto-hija-manual`, worktree `.claude/worktrees/neto-hija-50`, HEAD `51ca079e`. 28 entradas: las 27 anteriores mas `dspacios-travel/supabase/scripts/preflight_223_neto_hija_manual_cierre.sql` (dentro de `*_223_*`). No existe `middleware.ts`; `pnpm-lock.yaml` sin cambios.
- Tocados en este ciclo: `20260601000222_neto_hija_manual.sql`; `test_222_neto_hija.sql`, `test_223_neto_hija_cierre.sql`, `test_222_neto_hija.sh`; `preflight_223_...` (nuevo); `lib/cotizacion/netoHija.ts` (solo comentario); `pruebas/netoHija50.vectores.json`, `netoHijaPuro.test.ts`, `netoHijaCableado.wiring.test.ts`; `.github/workflows/test-222-223-neto-50.yml`.

### 2. Q-5 - PVP sin aliado se permite; solo NETO exige aliado

Hallazgo: la 222 tal como estaba rechazaba tambien PVP cuando la madre B2B no traia aliado del catalogo (`sellar_hija` levantaba el error antes de mirar la modalidad), y con la 223 `requiere_modalidad` obligaba a esas madres a elegir, asi que quedaban sin salida. El problema estaba en la 222, no en la 223 (que solo enciende el interruptor).

Correccion (migracion 222, sin tocar la 198):
- `p50_priv.sellar_hija`: si la hija es B2B y `aliado_id` es nulo: PVP retorna SIN sellar (hija legada, comportamiento de hoy, Q-4); NETO falla con "el precio NETO necesita la agencia o freelance del catalogo...". (La tabla `cotizacion_neto` sigue exigiendo aliado en todo B2B sellado; el CHECK no cambia.)
- `p50_priv.requiere_modalidad`: ahora exige ademas `aliado_id is not null`; una madre B2B sin aliado no necesita modalidad ni con la 223.
- `p50_priv.modalidad_coincide`: un reintento con PVP sobre una hija B2B sin aliado y sin sello cuenta como la misma modalidad (idempotencia).
- Sin cambios en la UI: `contextoModalidadNeto` ya devolvia `permite: false` sin aliado, asi que ese caso nunca manda modalidad y sigue el camino legado.
- Pruebas SQL cambiadas: S4.9 (antes rechazaba; ahora PVP crea la hija sin fila en `cotizacion_neto`), S4.9b (reintento misma clave = misma hija), S4.9c (misma clave con NETO = `COMPARATIVA_CLAVE`); O2.1 y O2.2 de la bateria 223 (se crean sin sello) y O2.3 nueva (NETO sin aliado se rechaza). Prueba de cableado nueva que fija las tres funciones y el preflight.
- **Preflight 223** (nuevo): una fila con Q1 (222 aplicada), Q2 (modalidad aun no obligatoria; BLOQUEANTE si ya lo es) y **Q3 INFO = madres B2B abiertas sin `aliado_id`**. El runner lo exige en la fase B (B0, con la 222 sola: `INFO|0|0|3`) y comprueba que tras la 223 sale BLOQUEANTE (B2b).

### 3. Q-8 - quien lee `detalle.recobro.aliado` de la hija

Busqueda sobre todo `app/`, `lib/`, `components/` y las migraciones/scripts SQL:
- `app/(dashboard)/dashboard/cotizaciones/[id]/page.tsx:227` define `recobroAliado = detalleM.recobro?.aliado` y `:326` solo lo muestra ("empresa X · aliado Y") en el desglose interno: es informacion de la participacion DECLARADA; sigue siendo cierta y ya aparece el desglose NETO aparte.
- `.../[id]/page.tsx:381` lee `payload.recobroAliado ?? detalleM.recobro?.aliado`: el payload sellado trae `0` (no es null), asi que manda el 0; ademas ese editor solo aparece en cotizaciones editables y las hijas NO lo son (216:328).
- La 198 lee `v_payload->>'recobroAliado'` (`198:608-610`), no `detalle`; las migraciones 205/206/211/216/222 tampoco leen `detalle->recobro->aliado`. Las demas lecturas son pruebas SQL de #39 sobre ediciones (`test_216_edicion39.sql:177,214`), no del flujo de dinero.
- Conclusion: ningun consumidor de dinero ni documento lo lee. No se actualiza al sellar (se documenta). Fijado con una prueba de cableado (Q-8) que falla si aparece otro lector.

### 4. Q-9a - bordes de .5

- Vectores nuevos en el JSON compartido (TS y SQL): **B5a** COP 1.000.004 x 0,125 = 125.000,5 -> 125.001; **B5b** COP con pct de 4 decimales 1.000.200 x 0,1175 = 117.523,5 -> 117.524; **B5c** USD con centavos (aereo 400,50 fuera de la base; base 1.604 x 0,125 = 200,5 -> 201); **B5d** justo debajo, 1.000.003 x 0,125 = 125.000,375 -> 125.000. El vector admite `moneda` y el arnes SQL la pasa a `t222.cot_directa`.
- El TS ya calculaba en enteros: `comisionOrdinaria` hace `base_en_centavos x puntos_base` en `BigInt`; el UNICO flotante es `pct` (4 decimales) pasado a puntos base con `Math.round`, exacto para los 10 001 valores posibles. No habia `Math.round` sobre el producto en flotante; se documento en el comentario de la funcion y se agregaron dos pruebas: bordes B5 contra una referencia independiente en BigInt y barrido de los 10 001 valores de pct. Manda SQL: `round(base/100 x pct)` en `numeric` exacto.
- La unidad de redondeo es la misma en COP y USD (una unidad entera de la moneda): lo ejercita B5c.

### 5. Q-9b - cabecera de la 222

Ya no dice "comportamiento identico". Dice que con SOLO la 222 la app vieja sigue creando hijas en PVP con las firmas viejas, y que durante el desfase de despliegue el reintento de una instancia vieja con la clave ya usada y la hija ya sellada recibe `COMPARATIVA_CLAVE` en vez de la hija. Corregido tambien "cinco funciones" -> "cuatro". Pendiente documentarlo en el PR.

### 6. Defecto del revisor

Corregido el choque de nombre `id` (variable PL/pgSQL vs columna `t222.vectores.id`) en el grupo M (`vid`, y `order by t222.vectores.id`). Revise las demas pruebas y la migracion y no hay otro caso. Regla aplicada en todo lo nuevo de este ciclo.

### 7. Pruebas locales (reales)

| Prueba | Resultado |
| --- | --- |
| 4 suites focales: `netoHijaPuro` 19 + `netoHijaAcciones` 23 + `netoHijaCableado.wiring` 12 + `margenContrato` 9 | 63/63 |
| `pnpm test:react` completo (incluye `netoHijaModalidad` 14 y `cotizacionComparativa35Ui` 12) | 654/654 |
| `npx tsc --noEmit` | limpio |
| eslint de lo tocado (`netoHija.ts`, `netoHijaPuro.test.ts`, `netoHijaCableado.wiring.test.ts`) | limpio |
| `npm run build` (Next 16, URL de Supabase ficticia) | exit 0 |
| `git diff --check` | limpio |
| `bash -n test_222_neto_hija.sh` | sintaxis ok |

No se repitio el `test:unit` completo (este ciclo solo agrega pruebas propias y no toca codigo de aplicacion; la comparacion contra la base ya se hizo en el ciclo 3).

### 8. Pendiente de CI (no ejecutado)

Todo el SQL: 222/223 reales, preflight 222 y 223 (B0/B2b), postcheck, rollback exacto, baterias M, R, S, P, C, I, D, F, A, G, O, y 216/217 y 211 con la 222 presente; los marcadores nuevos del workflow (`S4.9`, `S4.9b`, `S4.9c`, `M2 B5a-B5d`, `M1 B5c`, `O2.1`, `O2.3`, `B0`, `B2b`, y `Q-9a` del TS) solo se comprueban en la primera corrida. Si una marca no coincide, el CI fallara por texto: primer sitio a mirar.

### 9. Preguntas

- **Q-10.** La 223 deja a las madres B2B sin aliado en PVP sin sello (por Q-5). ¿Se acepta que esas hijas nunca llevan constancia de modalidad en `cotizacion_neto` (el inventario las ve como legadas), o se quiere un sello PVP con aliado nulo? Eso exigiria cambiar el CHECK `cotizacion_neto_aliado` y no se hizo.
- **Q-11.** `test:unit` completo no se repitio en este ciclo. ¿Se exige repetirlo antes del commit o basta el CI?

Gate: lo decide el Coordinador.


## Entrega ciclo 5 - G2 del Draft PR #375: bloque 12 de la bateria #35 con la frontera activa (2026-10-21)

Reserva ampliada usada: SOLO el bloque 12 de `dspacios-travel/supabase/scripts/test_211_cotizaciones_comparativas.sql` y `dspacios-travel/supabase/scripts/test_222_neto_hija.sh` (la invocacion de G2). El workflow focal no hizo falta tocarlo (ya lista `G2` y vigila ambos scripts). Sin codigo de aplicacion, sin migraciones, sin commit/staging/push/SQL remoto.

### Causa

Con la 217 activa, `p39_priv.tg_frontera_cotizaciones` (216:415) rechaza el INSERT de una `tipo = 'manual'` hecho por `anon`, `authenticated` o `service_role` ("FRONTERA_39: una cotizacion dinamica solo se crea con la operacion de creacion", 216:430). El bloque 12 nacio para la 211 sola, donde ese INSERT directo es legitimo. No era solo el 12.1: cada prueba del bloque suponia escritura directa.

| Prueba original | Con la frontera activa | Que hace ahora |
| --- | --- | --- |
| 12.1 crear con INSERT directo (authenticated) | FRONTERA_39 (216:430) | Crea por `crear_cotizacion_manual(uuid,text,jsonb,jsonb)` como service_role (solo ese rol tiene EXECUTE, 216:968) y comprueba autor, tipo/modo/estado, precio y servicios (12.1b). Rechazo exacto del INSERT directo como authenticated (12.1c) y como service_role (12.1d) con el mensaje de creacion |
| 12.2 editar precio + vigencia (authenticated) | `precio_venta` es dato economico: FRONTERA_39 (216:456) | Vigencia directa aceptada (campo libre, `v_libres` 216:419) y precio directo rechazado con "solo se cambian con su operacion autorizada" (12.2b); el precio queda intacto (12.2c) |
| 12.3 insertar/editar servicios (authenticated) | Sin privilegio: la 217 revoca INSERT/UPDATE/DELETE a anon, authenticated y service_role (`frontera_activa`, 216:226-229) -> `permission denied` antes del disparador | Rechazo exacto "permission denied for table cotizacion_servicios" como authenticated (insert 12.3, update 12.3c) y service_role (12.3b); servicios intactos (12.3d) |
| 12.4 pago previo con `supabase_admin` | PASARIA, pero solo porque un superusuario no entra en el disparador (216:424): no prueba nada de la frontera | Authenticated: "permission denied for table cotizacion_pagos_previos" (12.4). Service_role sin autorizacion emitida: "FRONTERA_39: los pagos previos solo se registran con la operacion autorizada" (12.4b, 216:495); sin pagos creados (12.4c) |
| 12.5 md5 de la 198 | No cambia | Igual, ahora comun a ambos contextos |

El flujo completo con la puerta autorizada (editar servicios, pago con `registrar_pago_previo_rev`, anulacion, conversion) lo cubre G1 (`test_216_edicion39.sql`); aqui no se repite.

### Los dos contextos

- **Sin frontera** (211 sola, o 216 sin 217): se ejecutan las pruebas ORIGINALES 12.1-12.4 sin cambio de contenido.
- **Con frontera**: bloque nuevo de arriba. El contexto se decide con `p39_priv.frontera_activa()` (la misma condicion que usa la app para habilitar la edicion: 7 disparadores, privilegios de la 217 y replicacion normal), llamada con SQL dinamico para que el archivo compile aunque la 216 no exista.
- **No se salta en silencio**: la prueba nueva 12.0 siempre se registra e imprime el contexto. El runner de #50 corre G2 con `psql -v esperar_frontera=activa`; si la frontera estuviera apagada por error, 12.0 falla en vez de caer por el camino viejo (`inactiva` exige lo contrario; sin variable queda libre para otros usos de la bateria).
- No se desactiva ningun disparador, no se usa superusuario para eludir la frontera y ningun `FRONTERA_39` cualquiera cuenta como exito: cada rechazo exige el texto exacto de su puerta.

### Runner (G2)

`test_222_neto_hija.sh` ya no usa `correr` para G2: llama a psql con `-v esperar_frontera=activa` y, ademas de rc/FALLO, exige las marcas `12.0 ... ACTIVA`, `12.1 ... por la operacion autorizada`, `12.1c`, `12.2b`, `12.3`, `12.4`, `12.4b` y `12.5`. Lista las que falten en el mensaje de error.

### Verificaciones locales (ligeras; no hay Docker ni Postgres local)

- `bash -n` del runner: ok. `git diff --check`: limpio. Balance del bloque nuevo: `$$` 2, `$q$` 12, `if`/`end if` 2/2, parentesis 0. `netoHijaPuro` + `netoHijaCableado.wiring`: 31/31.
- NO ejecutado: el SQL del bloque 12 en ninguno de los dos contextos. Los textos de error y los privilegios salen de la lectura de 216/217 con ancla; la confirmacion real es el CI del Draft. Riesgo residual: que el orden de disparadores de la 211 cambie el mensaje de 12.1c/12.1d (la falla original ya mostraba FRONTERA_39 en el INSERT de authenticated, asi que se espera el mismo texto para service_role).

### Pregunta

- **Q-12.** El contexto «sin frontera» del bloque 12 queda cubierto solo si algun workflow corre la 211 sola; el de #50 siempre la corre con la 217. No hay otro workflow que lo haga hoy (fuera de mi reserva). No lo toque.


## Entrega ciclo 6 - las 8 aserciones de la bateria #35 que la 217 volvio rojas (2026-10-21)

Alcance: SOLO `dspacios-travel/supabase/scripts/test_211_cotizaciones_comparativas.sql`. El runner (`test_222_neto_hija.sh`) no se toco: G2 ya corre con `esperar_frontera=activa`, y la deteccion de `FALLO` cubre las pruebas nuevas. Sin migraciones, app ni otros tests; sin commit/staging/push; PostgreSQL solo en Actions.

### Causa

Con la 217 activa hay dos capas encima de la 211 que actuan ANTES que sus guardas: (1) los privilegios de `cotizacion_servicios` se revocan a anon/authenticated/service_role (`permission denied for table cotizacion_servicios`, antes de cualquier disparador) y (2) `trg_cot_frontera_39` (nombre alfabeticamente anterior a `trg_cotizaciones_comparativa_guarda`, asi que dispara primero) rechaza crear, editar lo economico y borrar una cotizacion `tipo = 'manual'`. La guarda de la 211 (`f211_priv.tg_cotizaciones_guarda`, `tg_servicios_guarda`) sigue instalada y sigue protegiendo, pero solo se evalua para roles de API (`current_user in (...)`): con la 217 esos roles ya no la alcanzan por los caminos originales, y el dueno de la base queda fuera de ella por diseno. Por eso las aserciones esperaban `INMUTABLE`/`SOLO_RPC` y recibian el error de la 217.

### Que hace cada aserción ahora

| Aserción | Sin frontera (211) | Con la 217 activa: rechazo de la API | Con la 217 activa: guarda propia de la 211 |
| --- | --- | --- | --- |
| 4.11 insertar servicio en la madre | original (`INMUTABLE`) | `permission denied for table cotizacion_servicios` (authenticated) | 4.11b: con INSERT/UPDATE/DELETE concedido SOLO en la transaccion de prueba, `COMPARATIVA_INMUTABLE: los servicios de una comparativa no se modifican` |
| 4.12 editar servicio de la madre | original | `permission denied ...` (authenticated) | 4.12b igual que 4.11b |
| 4.13 borrar servicio de la madre | original | `permission denied ...` (service_role) | 4.13b igual (service_role) |
| 4.21 marcar una simple como hija | original (`SOLO_RPC`) | `FRONTERA_39: una cotización dinámica solo se crea con la operación de creación` | 4.21b (siempre): misma insercion con `tipo = 'carrito'`, que la frontera no cubre -> `COMPARATIVA_SOLO_RPC: las comparativas y sus hijas solo se crean con la operación de comparativa` |
| 4.22 aliado/propietario en una simple | original | mismo FRONTERA_39 de creacion | 4.22b (siempre): `tipo = 'carrito'` con `aliado_id` -> `COMPARATIVA_SOLO_RPC` |
| 4.31 GUC falsificado + servicio en la madre | original | `permission denied ...` | 4.31b: con el DML concedido en la transaccion, el GUC falsificado sigue sin saltar la guarda (`COMPARATIVA_INMUTABLE`) |
| 6.29 la hija no cambia origen/opción | original (`SOLO_RPC`) | `FRONTERA_39: los datos económicos de una cotización dinámica solo se cambian con su operación autorizada` (la hija es manual) | 8.13/8.14: update de `opcion_ref` sobre la hija de CARRITO (authenticated y service_role) -> `COMPARATIVA_SOLO_RPC: esas columnas solo las escribe la operación de comparativa` |
| 6.30 la hija no se borra | original (`COMPARATIVA`) | `FRONTERA_39: una cotización dinámica no se borra` | 8.15/8.16: delete de la hija de carrito (authenticated y service_role) -> `COMPARATIVA_INMUTABLE: una comparativa o su hija no se borra` |

Las pruebas «de la guarda propia» no son relajaciones ni aceptan cualquier error: cada una fija el texto exacto de la guarda de la 211 y se ejecuta con un rol de API.

### Mecanismo

- `t211.frontera_activa()` (SQL dinamico, compila sin la 216) y `t211.contexto('4.0'|'6.0')`, que SIEMPRE registra el contexto y falla si no coincide con `psql -v esperar_frontera=activa|inactiva`; el `\if ... set_config` se movio antes del bloque 4 (antes estaba en el 12) para que los bloques 4, 6 y 12 compartan la variable. Sin la variable, el contexto es libre.
- Hija de carrito (8.12-8.17): la hija publica de 8.4 es `tipo = 'carrito'`; la frontera de #39 solo cubre `manual`, asi que authenticated y service_role llegan a `tg_cotizaciones_guarda`. 8.12 comprueba antes que el interno ve la fila (si RLS la ocultara, un UPDATE/DELETE no dispararia nada y el rechazo pasaria por casualidad).
- Servicios (4.11b-4.13b, 4.31b): `t211.servicios_directo(true)` concede `INSERT, UPDATE, DELETE` sobre `cotizacion_servicios` a authenticated/service_role SOLO dentro de la transaccion de la bateria (termina en ROLLBACK), `servicios_directo(false)` lo retira y 4.13c/4.31c exigen que `p39_priv.frontera_activa()` vuelva a ser true. No se desactiva ningun disparador, no se usa superusuario para eludir una guarda (el dueno esta fuera de ellas por diseno) y las pruebas de la 217 siguen exigiendo el rechazo exacto.

### Verificaciones locales (ligeras)

`git diff --check` limpio (1 archivo, +108/-7); sin `\\` al inicio de linea; un solo `\if`/`\endif`; `$$` par; `if`/`end if` y parentesis balanceados en los 13 bloques DO; los nombres repetidos (4.11, 4.12, 4.13, 4.21, 4.22, 4.31, 6.29, 6.30, 12.x) son ramas exclusivas por contexto.

### Riesgos residuales (se resuelven solo en Actions)

1. **Politicas RLS sobre la hija de carrito:** 8.15/8.16 y 8.13 asumen que authenticated puede actualizar/borrar la fila segun RLS; 8.12 cubre solo la lectura. Si el DELETE estuviera filtrado, 8.15 saldria rojo con `ok` (el service_role de 8.16 no depende de RLS).
2. **Orden de disparadores de insercion de carrito (4.21b/4.22b):** se asume que ningun otro BEFORE INSERT rechaza antes que la guarda de la 211.
3. **Concesion temporal de privilegios:** es la unica forma de alcanzar `tg_servicios_guarda` con un rol de API con la 217 activa. Si el Coordinador prefiere no tocar ACL ni en una transaccion de prueba, la alternativa es verificar solo que el disparador exista y este habilitado (menos fuerte: no ejecuta la guarda).

Gate: lo decide el Coordinador sobre el diff, antes de commit/push.


## Entrega ciclo 7 - sin concesion de privilegios; la 211 completa tambien sin frontera (2026-10-21)

Misma rama y worktree desde `7483efc8`, preservando el diff del ciclo 6. Alcance: `dspacios-travel/supabase/scripts/test_211_cotizaciones_comparativas.sql`, `dspacios-travel/supabase/scripts/test_222_neto_hija.sh` y `.github/workflows/test-222-223-neto-50.yml`. No se tocaron fixtures, `preparar_esquema_local.sh`, migraciones, app ni otros workflows. Sin Docker local, sin SQL remoto, sin staging/commit/push.

### 1. Se retira la concesion de privilegios

- Eliminados `t211.servicios_directo`, todo `GRANT`/`REVOKE` y las pruebas que dependian de ello (4.11b, 4.12b, 4.13b, 4.13c, 4.31b y 4.31c anteriores). Una comprobacion estatica confirma que el archivo no contiene `grant`/`revoke` fuera de comentarios.
- Las ocho expectativas por contexto (4.11, 4.12, 4.13, 4.21, 4.22, 4.31, 6.29, 6.30) siguen: sin frontera, la expectativa original; con la 217 activa, el rechazo ESPECIFICO de la 217 (`permission denied for table cotizacion_servicios`, `FRONTERA_39` de creacion, de dato economico y de borrado).
- Nueva ayuda `t211.estado_madre(id)`: huella (md5) de la fila de la madre, de TODOS sus servicios y del numero de hijas. Con la 217 intacta se comprueba antes y despues de cada grupo de rechazos: 4.10b (frontera activa antes), 4.13b (madre y servicios iguales y frontera activa), 4.22c (ninguna hija nueva ni cambio en la madre; vale en ambos contextos, y exige `frontera_activa() = contexto`), 4.31b (idem para el grupo del GUC falsificado) y la 6.30b ya existente (la hija sigue intacta).

### 2. Cobertura adicional de carrito

8.12-8.17, 4.21b y 4.22b se conservan tal cual. No se abre ningun permiso ni politica RLS: si el DELETE de authenticated sobre la hija de carrito estuviera filtrado por RLS, 8.15 saldria rojo y se corrige despues con un diagnostico, no abriendo acceso.

### 3. La bateria 211 completa en otra base, sin 216/217

- **Runner** (`test_222_neto_hija.sh`): tercer argumento `211sola`. Valida que la plantilla sea una base hasta la 211 (`f211_priv` presente; sin `p39_priv`, sin `p50_priv`, sin `trg_cot_frontera_39`), crea una base desechable con la marca de siempre, corre `test_211_cotizaciones_comparativas.sql` con `-v esperar_frontera=inactiva` y exige, con la misma funcion `verificar_211` que usa G2: rc 0; contexto «sin frontera de #39 (esperado: inactiva)» declarado por los bloques 4.0, 6.0 y 12.0; `=== RESUMEN ===` con ok > 0 y fallos = 0; ningun `FALLO` ni `ERROR` de psql; y las marcas de las sentencias ORIGINALES (4.11, 4.13, 4.21, 4.22c, 4.31, 6.29, 6.30, 8.13, 8.16, 12.1, 12.5). Cierra con `TEST 211 SOLA: TODO OK`. El modo `completo` (por defecto) no cambia.
- **Workflow**: nuevo job `bateria-211-sola` (contenedor y base propios, distintos de los del job 222/223): `preparar_esquema_local.sh "$CT" 211 plantilla211ci`, luego `runner | tee; rc=${PIPESTATUS[0]}` y verificacion de marcas (`OK H1 ... contexto INACTIVA`, `TEST 211 SOLA: TODO OK`, resumen del runner, los tres contextos INACTIVA) y ausencia de `FALLO`. Mismas reglas del workflow: solo lectura, sin secretos, acciones por SHA.
- **G2** conserva ACTIVA con 217+222 y todas sus marcas (12.0, 12.1, 12.1c, 12.2b, 12.3, 12.4, 12.4b, 12.5), mas ahora los contextos 4.0/6.0, el resumen sin fallos y las marcas 4.13b, 4.22c, 4.31b, 6.30b, 8.12 y 8.17.
- **Cobertura resultante**: la guarda de la 211 sobre servicios y cotizaciones con las sentencias originales queda en H1; con la 217 activa (G2) queda el rechazo de la 217, el estado protegido y la guarda de la 211 sobre carrito.

### 4. Diagnostico G2 y PIPESTATUS

- `diag_211` (runner): si G2 o H1 fallan imprime en el propio log el contexto declarado, los `FALLO`/`ERROR` con 2 lineas de contexto, el resumen y el motivo exacto (`V211_MOTIVO`: rc, FALLO/ERROR, marcas faltantes). Antes solo se veia `tail -25` y la salida completa se perdia al borrar `$TMP`.
- Workflow, job 222/223: en la rama de error imprime `grep -n 'FALLO '` y las ultimas 15 lineas del runner antes del `::error::`.
- PIPESTATUS: los pipelines con `tee` (job 222/223, job TS y el nuevo) capturan `rc="${PIPESTATUS[0]}"` en la linea inmediatamente posterior y con `set -uo pipefail`. No habia otro pipeline con `tee` pendiente en estos archivos. Si el encargo anterior se referia a otro archivo, dime cual.

### 5. Verificacion local (sin Docker)

- `bash -n` del runner (sin CR) ok; `git diff --check` limpio; 63/63 de las 4 suites focales; balance de los 13 bloques DO ($$ par, if/end if, parentesis, un solo `\if`/`\endif`, sin barras dobles); el workflow sin tabuladores y su prueba de cableado verde (SHA fijos, sin secretos).
- **Comprobacion sintetica** (`sintetico.sh` en el scratchpad, sin SQL): `verificar_211` con salidas de ejemplo da OK para ACTIVA e INACTIVA correctas y rechaza rc distinto de 0, contexto invertido, un bloque sin contexto, falta de resumen, resumen con fallos, una linea FALLO y una marca ausente (10 casos); `diag_211` no falla con FALLO ni con salida vacia (2 casos). El patron del workflow con runners falsos: correcto -> verde; rc=3 -> rojo rc=3 (tee no lo oculta); con FALLO -> rojo; y el contraejemplo sin PIPESTATUS pierde el rc (0). 16/16.
- NO verificado: ningun SQL real, el job nuevo, ni el formato exacto de la tabla de resumen de psql (la expresion exige `ok | 0 | total` con ok > 0).

### 6. Preguntas

- **Q-13.** Con la 217 activa la guarda de la 211 sobre `cotizacion_servicios` ya no se ejecuta por ningun camino de API ni la ejercemos; queda cubierta solo por H1. ¿Aceptado, o se quiere ademas una comprobacion de catalogo en G2 (disparador `trg_cot_servicios_comparativa_guarda` presente y habilitado)?
- **Q-14.** El job `bateria-211-sola` suma tiempo de CI (migraciones hasta la 211 en un contenedor nuevo, ~10-15 min en paralelo). ¿Se acepta en cada PR que toque estos archivos, o solo por `workflow_dispatch`?

Gate: lo decide el Coordinador sobre el diff, antes de commit/push.


## Entrega ciclo 8 - errexit y PIPESTATUS en los pipelines con tee; contextos de H1/G2 siempre en el log (2026-10-21)

Misma rama, worktree y reserva. Solo `dspacios-travel/supabase/scripts/test_222_neto_hija.sh` y `.github/workflows/test-222-223-neto-50.yml`. El SQL auditado no se toco en este ciclo. Sin Docker local, SQL remoto, staging, commit ni push; no se repitieron suites de app.

### 1. errexit explicito antes de los tres pipelines con tee

GitHub ejecuta el paso con `bash -e` (y con `shell: bash` tambien `-o pipefail`). Mi version anterior ponia `set -uo pipefail`, que NO desactiva `-e`: un runner con rc distinto de 0 hacia fallar la propia tubería `runner | tee` y mataba el paso ahi, antes de `rc="${PIPESTATUS[0]}"`, de las guardas y de su `::error::` con diagnostico. Ahora los tres pasos (job 222/223, job `bateria-211-sola`, job TS) hacen `set -u -o pipefail` y luego `set +e` con un comentario que explica el porque; la linea siguiente al `tee` sigue siendo la captura de PIPESTATUS, y las guardas conservan sus `exit 1` explicitos (rc distinto de 0, `FALLO`, o marcas ausentes).

### 2. Contextos 4.0, 6.0 y 12.0 siempre publicados

Los contextos se imprimen al principio de la salida de la bateria y el runner solo mostraba `tail -25`: en un log verde no aparecian, y el paso del job 211-sola (que los exige) habria quedado rojo con una corrida correcta. Nueva `publicar_contextos_211`, llamada tras cada bateria en H1 y en G2 (antes de verificar), imprime los `OK`/`FALLO` de 4.0, 6.0 y 12.0 (y una linea `FALLO` si no hay ninguno). Se conservan `verificar_211` (verificacion interna), `diag_211` y todas las marcas exigidas; el job 222/223 ademas exige ahora los tres contextos ACTIVA de G2.

### 3. Prueba del recorrido completo (no solo `verificar_211`)

Harness (fuera del repo): `C:\Users\Asus\AppData\Local\Temp\c8\e2e.sh` con `extraer.js`, `marcas.js`, `gen.js`, un `docker` falso en el PATH y un runner falso. Extrae del YAML el `run:` de cada paso y lo ejecuta con `bash -e -o pipefail` (como GitHub), con salidas LARGAS (≈330 lineas por bateria; los contextos 4.0, 6.0 y 12.0 repartidos al principio y a mitad de la salida, fuera de `tail -25`).
- **Job 211-sola:** el runner REAL (`211sola`) con `docker` falso: real = creacion de base, `verificar_211`, `publicar_contextos_211`, `diag_211` y los mensajes; falso = solo `psql`.
- **Job 222/223:** un runner falso que imprime todas las marcas del paso y ejecuta el codigo REAL de G2 (extraido del runner) con un `psql` falso; luego el cierre `TEST 222 SQL`/`TEST 223 SQL`.
- **Job TS:** `docker run` falso con las marcas del paso y `ℹ fail 0`.
- **Resultado (estado nuevo):** para cada job, verde -> exit 0 sin `::error::`; rc=3 -> exit 1 con `::error::` y `rc=3` en el mensaje (job 222/223); salida con FALLO -> exit 1 con `::error::`. El log verde del job 211-sola contiene `OK 4.0/6.0/12.0 ... sin frontera de #39 (esperado: inactiva)` y el del job 222/223 los tres ACTIVA. 17/17, 0 discrepancias.
- **Contraste, mismo harness sobre el estado del ciclo 7:** (a) job 222/223 con rc=3: el paso muere con exit 3 y SIN `::error::` (errexit), (b) job 211-sola con rc distinto de 0: sin `::error::` y (c) con una corrida VERDE el paso sale rojo porque los contextos no estan en el log. Ambos defectos quedan reproducidos y corregidos.

### 4. Verificacion

`bash -n` del runner (sin CR) y `git diff --check`: limpios. `git diff --stat`: 3 archivos (workflow, runner y el SQL del ciclo 6/7 sin cambios). No hay parser YAML local; la estructura se valido extrayendo los pasos con el script (por nombre) y ejecutandolos.

### 5. Limites y pregunta

- El `docker` falso no valida el contenido real de `psql`; el formato de la tabla de resumen y la sintaxis del SQL siguen sin ejecutarse hasta Actions. El job 222/223 completo y la clonacion de plantillas tampoco se probaron aqui.
- **Q-15.** El job TS no tenia `defaults.run.shell`, asi que Actions usa `bash -e` SIN `pipefail`; ahora el paso fija `pipefail` y `set +e` por si mismo. ¿Quieres que ese job declare `shell: bash` como los otros? Se haria en una reserva que ya incluye el workflow, pero cambia el modo de todos sus pasos.

Gate: lo decide el titular.


## Entrega ciclo 9 - ajuste de UI durante la validacion humana (2026-10-21)

Reserva leida en `WORKSTREAMS.md` ("Ajuste UI #50 pedido por el dueno") y en `COORDINATOR_HANDOFF.md` ("Ajuste UI #50 durante validacion humana"). Mismo ejecutor, worktree, rama y Draft #375, HEAD `b86ea92d`. Solo presentacion: sin cambios de calculo, acciones, RPC, permisos, reglas de margen/recobro ni migraciones; sin `localStorage`/`sessionStorage` ni guardado al marcar radios; 222 aplicada y NO tocada, 223 sin GO. Sin staging, commit, push ni SQL remoto.

### Archivos (3, dentro de la reserva)

- `lib/cotizacion/comparativaAcciones.tsx` (+101/-34): SOLO `PanelModalidad`, `ResumenNeto`, la fila de totales de `SelectorOpciones` y el argumento del aviso en `PanelSolicitudes`.
- `lib/cotizacion/comparativaDocumento.tsx` (1 linea): SOLO el enlace Documento de `FichaComparativa`.
- `pruebas/netoHijaModalidad.react.ts` (+37): 3 pruebas nuevas de texto; las 26 anteriores no se modificaron.

### Que cambia

1. **Aviso de vista previa** (`PanelModalidad`): «Vista previa. La modalidad se guarda al pulsar **Elegir esta opcion**». En el panel de solicitudes el boton que guarda es otro, asi que el aviso lo nombra («...al pulsar **Confirmar y crear la cotizacion**») mediante un argumento `accion`; decir «Elegir» alli seria falso.
2. **NETO destacado, PVP identificado** (`ResumenNeto` y totales por opcion): con la vista previa NETO activa, el total de la opcion pasa a «PVP original (cliente)» en tamano y color atenuados, el resumen abre con «PVP original (precio al cliente)» y el bloque «Total NETO que paga el aliado» va en un recuadro con borde de marca y el importe en texto grande (`text-2xl`). Sin vista previa NETO (o con PVP) el total de la opcion se ve exactamente como antes («Total de este hotel» en grande). Mismas formulas y mismos datos: solo cambian etiquetas y jerarquia.
3. **Alineacion y cortes**: filas etiqueta/importe con un componente comun `Fila` (la etiqueta se parte en lineas si hace falta; el importe y el porcentaje llevan `whitespace-nowrap shrink-0` y alineacion a la derecha); el margen y su minimo van en dos filas («Margen sobre el total NETO» y «Minimo exigido», con espacio duro antes del `%`) para que `(min. 6 %)` ya no se parta; tarifa por persona y totales con `gap-3`; radios en rejilla (`sm:grid-cols-2`) con la casilla fija arriba (`mt-0.5 shrink-0`) y texto `min-w-0`; tarjetas con `min-w-0`.
4. **Documento**: `target="_blank" rel="noopener noreferrer"` y una nota solo para lectores de pantalla («se abre en otra pestana; muestra la comparativa a PVP»). Se conserva la ficha abierta (y su seleccion en memoria, mientras no se recargue o cierre). No se transporta ninguna modalidad al documento de la madre, que sigue a PVP.

### Pruebas

- React existente: `netoHijaModalidad.react.ts` + `cotizacionComparativa35Ui.react.ts` = **29/29** (antes 26/26). Nuevas: (a) el aviso exacto, y que marcar los radios no llama a ninguna accion de elegir, no refresca y no usa storage; (b) con NETO el total del aliado es el texto grande, el PVP original esta etiquetado, «Total de este hotel» desaparece solo en esa vista y el porcentaje y el importe no se parten; (c) el aviso del panel de solicitudes nombra «Confirmar y crear la cotizacion».
- `npx tsc --noEmit` y eslint de los tres archivos: limpios. `git diff --check`: limpio. `netoHijaCableado.wiring` (12/12) sigue verde. No se repitieron SQL ni CI (cambio solo de interfaz).

### Capturas (datos sinteticos, no versionadas)

Carpeta `C:\Users\Asus\AppData\Local\Temp\claude\c--Users-Asus-Documents-DspaciosMayorista\0c4de298-b796-4adb-a024-b36c67e3ed12\scratchpad\capturas-ui50\`. Se genero el DOM real de los componentes con el arnes jsdom de la prueba (hoteles de nombre largo, importes de 8 cifras, una opcion con margen insuficiente), el CSS de Tailwind compilado de la app y Edge headless: escritorio a 1280 px y movil a 390 px reales (iframe).
- Antes: `antes_neto_si_escritorio.png`, `antes_neto_si_movil.png`.
- Despues: `despues_inicial_*`, `despues_pvp_*`, `despues_neto_si_*`, `despues_neto_no_*`, `despues_solicitudes_neto_*` (sufijos `_escritorio.png` y `_movil.png`).
- Los archivos temporales usados para generarlas (copia del componente anterior y un script de volcado) se borraron del repositorio antes de cerrar; el estado Git solo muestra los 3 archivos reservados.

### Limites y pregunta

- Las capturas no son el navegador real de la app autenticada: validan layout y cortes, no el flujo con sesion; falta la prueba humana ya planeada.
- **Q-16.** La nota para lectores de pantalla del enlace Documento se agrego por accesibilidad (avisa de la nueva pestana); si prefieres el enlace sin texto adicional, se quita sin otro efecto.

Gate: lo decide el titular antes del push del dueno.
