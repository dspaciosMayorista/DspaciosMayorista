# #97 — Comisión B2B asistida: estado y diseño

Actualizado 2026-11-08. Rama `claude/portal-b2b-bloque-97-98-84-32`. Nada de esto está en producción.

## 1. Implementado: contrato manual PVP con aliado (sin SQL nuevo)

- `crearContrato` (`app/(dashboard)/dashboard/contratos/actions.ts`): PVP + aliado del catálogo + paquete no negociado → valida aliado/tipo/% **antes de numerar**
  (`resolverAliadoReserva`), escribe en la venta `modo_compra='comisionable'`, `comision_b2b`, `comision_estado='pendiente'` con el plan puro
  `planComisionReserva` (base = PVP − BNC, % del aliado o parámetro; política de Reservar sin cambios) y registra la fila con la RPC 205
  `registrar_comision_b2b_reserva`. Si falla se revierte el contrato (`revertir_contrato_incompleto`).
- La RPC 205 **exige** `modo_compra` en la venta (sin él `descontada_en_precio` queda NULL y la inserción falla): por eso se escribe la modalidad.
- Beneficiario = el aliado (`aliados_b2b.aliado_id`); el asesor interno no recibe esta comisión. NETO no se toca.
- Pruebas: `supabase/scripts/test_97_comision_pvp.sql` (22), `test_97_carrera.sh` (8 sesiones, 1 fila), `test_97_app_rpc.sh` + `pruebas/contratoManualNeto206.pg.ts`
  (casos V97-1..4, F2, T2, T5), `pruebas/contratoManualNeto.react.ts`, `pruebas/comisionAsistidaPvp97.test.ts`.
- Garantías distintas: **una comisión por contrato** (RPC: `FOR UPDATE` + rechazo de duplicado) ≠ **no duplicar contratos por reintento** (no garantizado:
  dos `crearContrato` crean dos contratos).

## 2. Paquete negociado (bloqueo / porción terrestre): evaluación de la opción A

Hoy nace `financiero_estado='completo'` y la RPC 205 lo rechaza. Evaluado en Postgres local (`supabase/scripts/test_97_negociado_A.sql`, 13 comprobaciones):
- Nacer `pendiente`, registrar la comisión y cerrar con `registrar_financiero_contrato(..., '{}', '[]')` **funciona** y conserva los costos ya copiados (coalesce).
- **Cerrar antes de copiar los costos** deja el contrato `completo` con costos en 0 (N2a): por eso el cierre solo puede ir **después** de la copia de costos.
- Si el proceso cae antes del cierre: queda `pendiente` (detectable), no admite abonos; sin payload durable la reconciliación (umbral 5 min) lo **revierte** y libera sus sillas.
- Cambio de comportamiento para este subconjunto: hoy un fallo al copiar costos negociados es solo «parcial» (contrato vivo con costos sin copiar); con A pasaría a bloquear.

## 3. Cotización dinámica: diseño propuesto (no implementado)

Hoy: la cotización guarda el aliado solo como texto (`agenciaNombre`/`freelanceNombre`), sin `aliado_id`, sin % de comisión y sin BNC; la conversión (RPC 198) crea la venta
sin `aliado_id`/`tipo_asesor` y una fila de `aliados_b2b` solo si hay recobro del aliado.

Una fila de `aliados_b2b` calcula `base_comision × pct_comision + recobro_total × pct_recobro_aliado` (`calcComisionB2B`): ordinaria y recobro **conviven en la misma fila**.

Propuesta (migración nueva, número a coordinar con #75):
1. Tabla `cotizacion_comision_acuerdo` (solo inserción, RLS como `cotizacion_neto` de la 222): `cotizacion_id` PK, `tenant`, `aliado_id` NOT NULL, `tipo_asesor`,
   `moneda` (la de la cotización), `pvp_total`, `bnc` NOT NULL ≥ 0 y ≤ pvp, `base_comision = pvp − bnc`, `pct_comision`, `pct_origen`, `comision_ordinaria`, auditoría.
2. Se sella al crear la cotización B2B: aliado por id del catálogo (no texto libre), % por la política vigente de Reservar (`resolverAliadoReserva`), BNC capturada explícitamente
   (campo obligatorio: vacío ≠ 0; el 0 se escribe). Sin edición del % en esta entrega.
3. Conversión: un paso posterior dentro del envoltorio controlado (216/242) lee el acuerdo y **actualiza la única fila** de `aliados_b2b` (o la inserta si no hay recobro), con
   `aliado_id`, `base_comision`, `pct_comision`, `base_explicita=true`; el recobro queda como está. Una sola fila ⇒ sin duplicado. Valida moneda venta = moneda acuerdo.
4. Históricas: cotizaciones sin acuerdo conservan el comportamiento actual (solo recobro) con aviso; **sin** asignar aliado por nombre ni completar acuerdos antiguos.
5. Pendiente de decidir: `ventas.comision_b2b` (hoy = recobro del aliado) y `ventas.impuesto` (escribir el BNC cambiaría la base de la comisión del asesor).

## 4. Actualización 2026-11-08 (decisiones del dueño)

**Negociado B2B PVP (implementado):** nace `financiero_estado='pendiente'`, registra la comisión (RPC 205) y se cierra con `registrar_financiero_contrato` SOLO después de copiar los
costos del paquete (`paquete_costos` → `ventas`). Sin la llave de servicio (cuando hay paquete) se rechaza antes de numerar; si falta la fila de costos, falla guardar o falla el cierre,
el contrato se deshace por completo (comisión, sillas, hijas) con mensaje claro. Pruebas: `pruebas/contratoManualNeto206.pg.ts` N97-1..5 (Postgres local) y `test_97_negociado_A.sql`.
Sin paquete (`paqueteId` nulo) no hay costos que copiar y cierra de inmediato.

**`ventas.comision_b2b` (inventario de lectores):** con una fila viva en `aliados_b2b` la fila manda (`comisionVisibleAliado`, `elegirFilaCobro`, `comisionResolver`, rentabilidad); `ventas.comision_b2b`
solo se lee (a) si NETO descontada (importe descontado), (b) como respaldo cuando no hay ninguna fila viva y `modo_compra='comisionable'` (`comisionVisibleAliado`, `comisionResolver`),
(c) la RPC 205 lo contrasta con el cálculo en flujos con `modo_compra`. Hoy tiene dos significados: total ordinario en Reservar/manual PVP y participación en el recobro en la dinámica.
Recomendación: **conservarlo sin cambios** en la conversión dinámica; el desglose verificable vive en `cotizacion_comision_acuerdo` y en la única fila de `aliados_b2b`.

**Versionado del acuerdo y SQL concreto de la dinámica:** `docs/tecnico/comision-asistida-97-propuesta.sql` (compilado y probado con rollback en Postgres local; NO es migración).

## 5. Cotización dinámica B2B — implementado (migración 286, SIN aplicar en remoto)

**Regla confirmada:** `base = total − BNC − (participaciónAliadoEnRecobro > 0 ? recobroTotal : 0)`; `totalAliado = round(base × %) + participación`. La condición se evalúa
sobre el IMPORTE monetario final al aliado (por valor o por porcentaje; un % que redondea a 0 pesos deja el recobro en la base). Fuente pura: `lib/cotizacion/acuerdoComision.ts`
(espejo de `p97_priv.importes`).

**Piezas:** `supabase/migrations/20260601000286_cotizacion_comision_acuerdo.sql` (número coordinado con #75, que usa 282/284/285), `preflight_286`/`postcheck_286`/`rollback_286`,
`crear_cotizacion_manual_con_acuerdo`, formulario (aliado por id, BNC obligatoria, participación valor/%), `types/database.ts`.
Alcance: dinámica independiente (tipo manual, modo simple, sin origen de comparativa, sin paquete 100 % dinámico). NETO y las hijas de comparativa no cambian.
Se ensancha `aliados_b2b.pct_recobro_aliado` a **numeric(25,20)** (§6; la propuesta intermedia numeric(12,10) quedó superada) para que la fila liquide exactamente la participación (con 4 decimales 33.333 de 100.000 daba 33.330).

**Contraste de recorridos:** Reservar/Tarifario no tiene recobro (sin referencias en `app/tarifario` ni `lib/reservar`): base = PVP − BNC, consistente con la regla con recobro 0.
La hija NETO decidía la exclusión con la casilla `reconoceRecobro`, no con el importe (divergencia hallada). **Resuelta en §6 / §7.3**: las hijas NETO nuevas ya deciden por la participación monetaria final.

**Pruebas:** `pruebas/acuerdoComision97.test.ts` (13), `supabase/scripts/test_97_acuerdo_dinamica.sql` (41, rollback), `pruebas/contratoManualNeto206.pg.ts` Q97-1..6
(acciones reales + conversión real), y las suites de cotización/NETO existentes.

## 6. Cierre de la entrega (2026-11-08, 3)

**Precisión:** `aliados_b2b.pct_recobro_aliado` → `numeric(25,20)` (conserva los valores existentes). Con importes de hasta `numeric(15,2)` (< 10^13) el error al representar participación/recobro
es < 5e-8 pesos. `p97_priv.importes` verifica que el % guardado reproduce el importe pactado al centavo y, si no, RECHAZA (`ACUERDO_97: … no se puede representar exactamente …`): no se ajusta en silencio.
El formulario avisa cuando un porcentaje se redondea a un importe entero.

**Rollback:** `rollback_286` estrecha la columna a `numeric(5,4)` SOLO si ningún valor cambia al redondearlo a 4 decimales; si alguno cambiaría (p. ej. una conversión 33.333/100.000) la deja ancha y emite WARNING con el
número de filas. También restaura `p50_priv.calcular` (222) y la envoltura de la 242.

**NETO nuevas:** `p50_priv.calcular` (SQL) y `calcularNetoHija` (TS) ya no usan la casilla para decidir: el recobro sale de la base y del reparto solo si la participación monetaria final es > 0
(casilla marcada Y importe > 0). Las hijas con id ≤ `p97_priv.corte` conservan el cálculo anterior (se recalcula igual al convertir, así que lo sellado no se rompe).

**Fuera de alcance (siguen como estaban):**
- *Comparativas* (madre y opciones): su aliado va en `cotizaciones.aliado_id` y su modalidad PVP/NETO en `cotizacion_neto`; no llevan este acuerdo ni BNC.
  Solo cambia, para las hijas NETO NUEVAS, la regla del recobro de arriba.
- *Paquete 100 % dinámico* (`paquete_din_id`, #82): no se les exige ni se les crea acuerdo; convierten como hasta hoy (fila de recobro del aliado si hay recobro).
- Cotizaciones dinámicas B2B anteriores al corte: sin acuerdo, comportamiento de siempre.
- Reservar/Tarifario no tiene recobro.

**Pruebas del cierre:** `test_97_acuerdo_dinamica.sql` (63), `pruebas/acuerdoComision97.test.ts` (24), `contratoManualNeto206.pg.ts` Q97-1..6 y UI97-1..2 (formulario real → acción → acuerdo → conversión),
corrida completa del arnés 65/72 (los mismos 7 del portal B2B que fallan en `origin/main`), `test:unit` completo sin fallos nuevos frente a `origin/main`.

## 7. Cierre verificable de la entrega A (2026-11-08, 4) — migración 286 PROPUESTA, sin aplicar en remoto

Regla comercial (aprobada por el dueño) y decisiones de migración se separan a propósito: lo de 7.3 es una **propuesta técnica pendiente de aprobación**, no parte de la regla.

### 7.1 Precisión numeric(25,20) — para auditoría (NO aprobada remotamente)
- **Conservación:** ampliar `numeric(5,4)` → `numeric(25,20)` solo añade decimales; ningún valor existente cambia. Verificable: `preflight_286` fila 23 y `postcheck_286` fila 21 calculan la misma huella md5 de `(id:valor sin ceros finales)`; deben ser idénticas.
- **Bloqueo previo:** `ALTER TYPE` falla si una vista o regla depende de la columna: `preflight_286` fila 22 lo cuenta (esperado 0). El `ALTER` toma bloqueo exclusivo breve y reescribe `aliados_b2b`.
- **Representabilidad:** con importes ≤ numeric(15,2) el error de `round(%,20)` es < 5e-8 y `p97_priv.importes` rechaza (no ajusta) todo caso que no reproduzca el importe pactado al centavo. Cubierto por el SQL D3/D-rechazo y `acuerdoComision97.test.ts`.
- **Rollback sin pérdida:** `rollback_286` estrecha a numeric(5,4) solo si `valor = round(valor,4)` para todas las filas; si no, deja la columna ancha y emite WARNING. El rollback **borra los acuerdos sellados** (úsalo solo sin cotizaciones B2B nuevas por convertir).
- **Límite:** nada de esto se ha ejecutado contra Postgres en esta ronda (Docker apagado). Las cifras del SQL (63/63) son las del ejecutor anterior.

### 7.2 Redondeo por moneda — USD 1.469,65 → 1.470 (diagnóstico; la decisión B está implementada: ver §8.1)
Hechos medidos (`pruebas/acuerdoComision97.test.ts`, 2 pruebas nuevas):
1. **Sí coincide con la política vigente de la comisión ordinaria**: `planComisionReserva` (`Math.round(base × %)`) y la RPC 205 (`round(v_base * v_pct)`, tolerancia 1) redondean **a la unidad entera sin distinguir moneda**; Reservar en USD ya da 1.470 para base 11.900 y 12,35 %. El acuerdo no introduce un redondeo nuevo.
2. **No es la política de precios**: `redondearVenta` (PVP) sube al dólar entero en USD (`ceil`); la comisión usa mitad hacia arriba. Son reglas distintas y no se unificaron.
3. **Es una política implícita, no una decisión documentada para USD**: nadie escribió «la comisión en USD va a dólares enteros»; sale de `Math.round`. Esta nota no la declara validada.
4. **Hallazgo preexistente, no resuelto:** el liquidador de la fila (`calcComisionB2B` / `comision_b2b_total`) **no redondea**. Para el mismo caso la fila liquida **1.502,65** (1.469,65 + 33) y el acuerdo sellado dice **1.503**. En COP la brecha es ≤ 0,5 pesos; en USD ≤ 0,5 dólar. Reservar convive con lo mismo (ventas.comision_b2b redondeado vs fila sin redondear; la 205 tolera 1). Los casos D2/D5 del SQL verificaban la fórmula redondeada, no el liquidador: se renombraron para no sugerir lo contrario.

Opciones (decisión del dueño; nada aplicado): **A** conservar tal cual (consistente con Reservar; diferencia ≤ 0,5 unidad). **B** que `aplicar` escriba `comision_valor = comision_ordinaria` para que la fila liquide exactamente el acuerdo (`pct_comision` queda informativo; la prueba TS muestra 1.503). **C** definir centavos para USD (cambia política, afecta Reservar y la 205).

### 7.3 Corte histórico NETO y acuerdos existentes (SUPERADO por §8.2: el corte ya no se fija al migrar)
- `p97_priv.corte.cotizacion_id_max` = `max(cotizaciones.id)` **en el instante de aplicar** la 286 (`on conflict do nothing`: re-aplicar no lo mueve).
- **Hijas NETO con id ≤ corte:** `p50_priv.calcular` conserva la regla anterior (la casilla decide). Se recalcula igual al convertir, así que lo sellado no cambia. Efecto a conocer: una hija vieja con casilla marcada y participación 0 sigue sacando el recobro de la base (justo lo que la regla nueva cambiaría); es lo que se conserva por decisión.
- **Hijas NETO con id > corte:** el recobro sale de la base y del reparto solo si la participación monetaria final es > 0.
- **Dinámica B2B independiente ≤ corte sin acuerdo:** convierte como hasta hoy (solo fila de recobro si hay recobro); no se asigna aliado por nombre ni se completan acuerdos.
- **Dinámica B2B independiente > corte sin acuerdo:** la conversión se rechaza antes de numerar («créala de nuevo»).
- **Acuerdos existentes:** no hay (tabla nueva). Las filas actuales de `aliados_b2b` no se reescriben; solo cambia el tipo de la columna.
- **RIESGO operativo:** entre aplicar la 286 y desplegar el código nuevo, el código viejo crea cotizaciones B2B (id > corte) sin acuerdo que luego no convierten. Mitigar desplegando de inmediato tras el postcheck, o aceptar recrearlas.

### 7.4 Pruebas ejecutadas en esta ronda (TS; sin Postgres)
- Focales: `acuerdoComision97` 26/26 (con 2 nuevas), `comisionAsistidaPvp97`, `medicionFlujoWiring`: 73/74 → el único fallo es `reservarProgramaInterno: 36 vs 37` sobre `reservar/actions.ts`, archivo que esta rama **no modifica** (preexistente en `e39224313`).
- **Suite unitaria completa ejecutada ahora** sobre el árbol actual: 8.975 pruebas, **8.946 pasan, 29 fallan**; ninguno de los fallos está en un archivo tocado por este diff. No se corrió la línea base de `main` en la misma ronda: la igualdad con «29 en main» es la cifra reportada antes, no una comparación de nombres hecha aquí.

### 7.5 Coordinación con #75 (diagnóstico por fusión de texto; la prueba integrada real está en §8.4)
- `git merge-file` de `contratos/actions.ts` y `reservar/actions.ts` (base `c9b25ffe1`, esta rama vs cambios SIN CONFIRMAR de `75-reuso-dtm`): **0 conflictos de texto**. Esta rama no modifica `reservar/actions.ts`.
- **Pero hay choque semántico que el texto no ve:** #75 cambia `revertirContratoManual(numero, tenant)` a `revertirContratoManual(idc, numero, tenant)` y reasigna `sb = await createClient(idc)` tras el INSERT. Dos llamadas añadidas por #97 (cierre del negociado y su rollback) siguen con la firma de 2 argumentos → tras fusionar **no compilan**. Quien integre segundo debe pasar `idc` en esas dos llamadas y comprobar que `registrarComisionReserva(sb, …)` usa el cliente con identidad.
- La 286 es independiente de #75: no requiere 282/284/285. Eso no sustituye una prueba integrada de comisión + identidad, **no ejecutada**.

### 7.6 Checklist de Preview (dueño)
1. Cotización dinámica B2B: aliado del catálogo + BNC vacía → rechaza; BNC 0 escrita → acepta.
2. Participación 0 → el recobro permanece en la base; participación > 0 (por valor y por %) → todo el recobro sale; % que redondea a 0 → permanece.
3. Convertir: una sola fila en `aliados_b2b`; total del portal = ordinaria + participación (observar la diferencia ≤ 0,5 de §7.2.4 en USD).
4. Manual PVP con aliado: comisión registrada, contrato revertido si falla. Negociado: sin contratos ni sillas huérfanas.
5. NETO nueva con casilla marcada y participación 0 → recobro en la base; hija previa al corte → comportamiento anterior.
6. Comparativas y paquete 100 % dinámico: sin acuerdo ni BNC nueva (fuera de alcance).
7. Orden remoto: preflight → revisar → 286 → postcheck (huellas iguales) → desplegar código → Preview.

## 8. Correcciones de cierre (2026-11-08, 5) — versión 286 REVISADA; los resultados de §6 y §7 NO se atribuyen a esta versión

Todo lo de esta sección se ejecutó contra Docker local (Postgres 15.8.1.085 + PostgREST v16.1) con la migración 286 revisada. Nada remoto.

### 8.1 Liquidación — opción B implementada (sin tocar la política monetaria global)
- `p97_priv.aplicar` guarda `aliados_b2b.comision_valor = comision_ordinaria` (sellada) y conserva `base_comision`, `pct_comision` y `pct_recobro_aliado` (la participación) como evidencia. El liquidador existente (`calcComisionB2B` / `comision_b2b_total`) ya da prioridad a `comision_valor`: no se modificó.
- La verificación interna de `aplicar` usa la fórmula REAL del liquidador y exige coincidencia **al centavo** (|Δ| ≤ 0,005) con el acuerdo.
- Medido con el liquidador real: caso USD (base 11.900, 12,35 %, recobro 100, participación 33) → total antes de retención **1.503,00** = acuerdo (antes 1.502,65). Máximo COP (1.741.000.000.000) exacto. SQL D2/D5/D5b.
- Efecto en pantalla (solo etiqueta): la cuenta de cobro (`/portal/comision/[numero]`) rotula «% comisión (efectivo)» cuando hay `comision_valor` (así se rotula hoy cualquier comisión por valor); el % mostrado sigue siendo el real. En `/dashboard/comisiones` la edición de esa fila abre en modo «valor». El estado de cuenta usa el mismo resolvedor.
- Límite: **cuenta de cobro y estado de cuenta no se renderizaron aquí**; se comprobaron por el resolvedor/liquidador (mismas funciones) y su suite TS. Verificar en Preview (§8.6).

### 8.2 Despliegue compatible en tres fases (sin ventana de bloqueo)
- **Fase 1 (esquema compatible):** preflight_286 → 286 → postcheck_286. Interruptor `p97_priv.corte`: `exigir=false`, corte sin fijar. El código viejo sigue creando y convirtiendo B2B dinámicas sin acuerdo; la regla NETO nueva NO rige (probado SQL F1–F3).
- **Fase 2:** desplegar el código nuevo; validar. La vista previa NETO consulta `public.p97_regla_neto_activa()` para coincidir con lo que sella la base.
- **Fase 3 (exigir):** `preflight_286_activacion.sql` (una consulta, veredicto) → `activar_286_exigir_acuerdo.sql`: bajo `LOCK` de `cotizaciones` fija el **corte definitivo = mayor id en ese instante** y `exigir=true`. Lo anterior (incluida cualquier cotización del código viejo) queda histórico y convertible; solo lo posterior exige acuerdo. El script repite las guardas del preflight y se NIEGA si hay B2B dinámicas sin acuerdo de los últimos 30 min (el código viejo aún sirve) o, en reactivación, abiertas posteriores al corte sin acuerdo. Probado en Docker: activa, se niega, reactiva.
- **Desactivar:** `desactivar_286_exigir_acuerdo.sql` apaga la exigencia y CONSERVA acuerdos y corte (la regla NETO nueva sigue rigiendo para lo ya sellado bajo ella: apagarla recalcularía distinto lo sellado).
- **Corte definitivo:** se fija en la fase 3 y no se mueve. Históricos (id ≤ corte): sin recálculo, sin acuerdos completados, sin asignar aliado por nombre.
- Límite: el guard de 30 minutos detecta código viejo solo si ese código crea B2B dinámicas en esa ventana; si no hay tráfico, no lo detecta. Confirmar el despliegue (Vercel) antes de activar.

### 8.3 Rollback sin borrar evidencia
`rollback_286` se NIEGA (excepción `ROLLBACK_286 NEGADO`) si existe cualquier acuerdo sellado, y enumera lo que conserva (tabla con todas sus versiones, filas de `aliados_b2b` ya completadas, `ventas.aliado_id`) y la alternativa (desactivar). Solo procede con la tabla vacía. Probado: con 1 acuerdo → negado y el estado queda intacto; sin acuerdos → restaura 222/242, estrecha la columna a (5,4) (0 filas con pérdida) y se puede re-aplicar.

### 8.4 Integración con #75 — prueba integrada ejecutada
- La rama de #75 ya renumeró su migración de reuso a **287** (284 y 285 de identidad siguen). Esquema local = copia (`pg_dump`, solo lectura) de la base de #75 con 284/285 + **286 revisada + 287**; postcheck 284/285/286/287 sin fallos.
- Código combinado en el scratchpad (fusión tres vías de ~200 archivos de #75 con #97): 1 conflicto de texto (`cotizaciones/manual-actions.ts`, resuelto conservando mi lado y el marcador `identidad:n/a`) y **tres llamadas** de #97 con la firma vieja: `revertirContratoManual` (×2) y `depsFinancieroManual` (×1, esta última no se veía por texto: la delató `tsc`). Parche: `docs/tecnico/integracion-97-con-75.diff` (solo aplica sobre el archivo ya fusionado; **no se puede aplicar en la rama de #97 sola**, donde `idc` no existe).
- `tsc` del combinado tras el parche: sin errores de #97; quedan 3 errores en `vuelos/**/page.tsx` de #75 (`sillas_identidades` no está en `types/database.ts` de #75): son de su rama, no de esta integración.
- **Arnés app→PostgREST del combinado, casos 97 (F2, V97-1..4, N97-1..5, Q97-1..6, UI97-1..2, T2): 19/19.** Incluye creación, comisión y reversión con las guardas de identidad activas.
- Controles negativos: sin el parche, **V97-2 y N97-3 fallan** (la reversión se rompe). Cabeceras medidas en el proxy: con el parche `registrar_comision_b2b_reserva` viaja con `x-contratos` (3/3), `revertir_contrato_incompleto` y `registrar_financiero_contrato` también; con `ctx.sb` en lugar de `sb` la cabecera de la comisión sale AUSENTE y **las pruebas igual pasan** (la RPC 205 no está guardada por identidad): por eso la prueba de que `registrarComisionReserva` usa el cliente con identidad es la medición de cabeceras, no un rechazo. **Corregido y completado en §9.3:** esa frase se refería a contratos «de siempre»; sobre un contrato nacido de reuso sí hay rechazo. La corrección de `depsFinancieroManual` (cierre del negociado) la prueba `tsc`; el arnés no la distingue.
- Para integrar: aplicar el parche tras fusionar y volver a correr este arnés sobre el árbol integrado.

### 8.5 Resultados de esta versión (SQL)
Base nueva desde plantilla sin 286: preflight OK → aplicar OK → postcheck CORRECTA → reaplicar OK; **71/71** en `test_97_acuerdo_dinamica.sql`; huella de conservación idéntica (2 filas, `0.5` y `0.3333` intactas). Sobre el esquema de #75 (284/285): preflight OK, 286 OK, postcheck CORRECTA.

### 8.6 Checklist de Preview adicional
Cuenta de cobro y estado de cuenta de un contrato dinámico B2B convertido: «DEBE LA SUMA DE» = total del acuerdo antes de retención al centavo (USD: 1.503,00 en el caso de §8.1); fase 1 con el código viejo todavía sirviendo; luego fase 3.

## 9. Verificaciones de cierre (2026-11-08, 6) — Docker local, sin SQL remoto

### 9.1 Documentos con el caso USD (páginas reales, BD real) — `DOC97-1`
- USD 12.345 (servicios 12.245 + recobro 100), BNC 345, participación 33, freelance con 12,35 % y retención 11 %: acuerdo = base 11.900 / ordinaria **1.470** (1.469,65 redondeada) / total **1.503,00**.
- Liquidador real: `comision_valor + recobro × %` = **1.503,00** al centavo. Cuenta de cobro y Estado de cuenta usan `resolverComisionB2B`: `comisionBase + recobroAliado` = 1.503,00; retención 165,33; a pagar 1.337,67.
- **Límite de impresión (preexistente, no se cambió):** `formatUSD` imprime dólares enteros, así que el papel muestra «USD $1,470», «USD $33» y el total a pagar redondeado; los centavos se comprueban en los valores que las páginas usan, no en el texto.
- **Rótulo:** ya no dice «(efectivo)» cuando el % es el pactado. `resolverComisionB2B` compara la fila con la ÚLTIMA versión del acuerdo (`cotizacion_comision_acuerdo`: mismo aliado, mismo %, `comision_valor` = ordinaria) y expone `esPctPactado`; la cuenta de cobro rotula «% comisión (pactado)». «(efectivo)» queda para lo recalculado (comisión por valor y la vía `ventas.comision_b2b`); sin cambio de importes. Se añadió el tipo de la tabla en `types/database.ts`.

### 9.2 Los siete fallos del portal — reproducidos en main y en esta versión
- Mismo esquema (plantilla local con 286), mismos datos y mismo arnés, árbol de `main` (HEAD limpio) y esta versión: **7/7 fallan en ambos** (D3, A1, A3, A6, PORT-1/2/3).
- **Diagnóstico PARCIAL (corregido en §10.3): solo dos de los siete están diagnosticados; los otros cinco quedan PENDIENTES.** Patrón verificado: el arnés busca la página vieja de `/portal/b2b`. `/portal/b2b` pasó a ser un panel («Panel del aliado», lista `<li>` de «Contratos recientes», sin columnas de total ni comisión); las filas con comisión están ahora en `/portal/b2b/ventas` (pestañas Directas/Asistidas, tabla con Compra y Comisión), que imprime `numeroVisible` (sin `MIN-`). Las pruebas siguen buscando un `<tr>` en la página vieja con el total exigible.
- Comprobación: adaptando SOLO una copia desechable del arnés (leer `/portal/b2b/ventas` y buscar el número visible), **A3 y PORT-2 pasan** (aislamiento entre aliados); los otros cinco siguen fallando por aserciones sobre elementos que la tabla nueva no trae (columna «total exigible», texto del enlace de cobro). En la fila nueva la comisión sale correcta (p. ej. `Neta $200.000 Descontada`, `$200.000 Pendiente`).
- Límite: **no se declara diagnosticado ningún otro caso**; ver §10.3. Es deuda del arnés del portal, no se atribuye a #97 sin revisarla caso por caso. Las pruebas react de comisión/portal (`comisionPortalB2B`, etc.) también fallan 12 en main y 12 aquí (mismos nombres).
- Corrección propia: `comisionB2BAlta.react.ts` aún afirmaba «manual B2B ya NO genera comisión; nace Por definir» (regla de #38 que #97 reemplazó); se actualizó con un espejo en memoria de la RPC 205 (34/34).

### 9.3 Reuso con identidad — `INT97-75` (entorno combinado, esquema con 284 + 285 + 287 y 286)
- Contrato A pendiente y vacío → `eliminar_contrato(…, p_reusar := true)` → su número vuelve al pool → `crearContrato` PVP con aliado toma ese número: B con `nacio_de_reuso = true` y OTRO `contrato_uid`.
- Se reabre la ventana «en creación» de la RPC 205 (financiero pendiente < 5 min) y se retira la comisión declarando la identidad correcta. Luego `registrar_comision_b2b_reserva`: **identidad antigua → F4601; ausente → F4602**; la huella del contrato (md5 de la fila de `ventas`) y el conteo de comisiones no cambian. **Correcta → registra.** Los `UPDATE` directos sobre `aliados_b2b` con un rol que sí puede escribir (admin) son rechazados por la guarda con F4601/F4602.
- Control negativo: con `registrarComisionReserva(ctx.sb, …)` (cliente sin identidad) `crearContrato` falla con `IDENTIDAD_REQUERIDA` y el caso se rompe: ahora la prueba distingue el cliente con identidad por rechazo, no solo por cabecera.
- **Qué significaba «la RPC 205 no está guardada»:** las TABLAS sí están protegidas. La 284 instala una guarda genérica en toda tabla con `numero_contrato`, incluida `aliados_b2b`: identidad declarada que no es la vigente → rechazo siempre; ausente sobre un contrato nacido de reuso → rechazo; ausente sobre un contrato «de siempre» → pasa como hoy (diseño de #75). Mis pruebas anteriores usaban contratos de siempre, por eso la cabecera ausente pasaba. Contraste incluido en el caso: contrato de siempre sin identidad → pasa; con identidad ajena → F4601.
- En #97 sola (sin 284/287) el caso se **salta** automáticamente.

### 9.4 Integración con #75
- Parche de las tres llamadas conservado en `docs/tecnico/integracion-97-con-75.diff` (solo sobre el archivo ya fusionado).
- Los 3 errores de tipos que vi antes eran de una instantánea anterior de #75 (faltaba `sillas_identidades` en su `types/database.ts`). En su árbol actual `tsc` está limpio y el combinado reconstruido con la instantánea actual también (`tsc` 0 con el parche). **Sigue siendo condición de aprobación del conjunto fusionado:** repetir `tsc` y este arnés sobre el árbol realmente fusionado.
- Arnés combinado (instantánea actual de #75): **21/21** (F2, V97-1..4, N97-1..5, Q97-1..6, UI97-1..2, T2, INT97-75, DOC97-1). Mi árbol solo: 15 pasan, 1 se salta (INT97-75), `tsc` 0.
- La 286 es independiente de #75: ninguna migración de reuso (287, 284, 285) es requisito para aplicarla; el caso INT97-75 y el entorno combinado solo ejercitan la convivencia.

## 10. Ajuste de cierre (2026-11-08, 7)

### 10.1 Alcance compartido de la transición financiera
La nueva regla de ciclo de vida (pendiente = solo cálculo informativo; comisión exigible al confirmar, una sola vez; NETO sin comisión por pagar; un único responsable con #75) se coordina en `docs/tecnico/ciclo-vida-comision-alcance-compartido.md`. **Se entrega el alcance antes de modificar la transición:** no se cambió la RPC 205, `p97_priv.aplicar` ni `confirmar_venta`. Hasta decidir, **la 286 no debe aplicarse** (su `aplicar` crea hoy la fila exigible al convertir).

### 10.2 Centavos USD en los documentos de cobro
- Cuenta de cobro y Estado de cuenta usan ahora `formatMonedaDocumento` (nuevo, en `lib/utils.ts`): USD con dos decimales (`USD $1,337.67`); COP idéntico al global. **`formatUSD`/`formatMoneda` (formato global de precios) no cambian** y ningún cálculo cambia.
- El importe en letras de la cuenta de cobro admite centavos solo cuando se pide (`pesosEnLetras(valor, "USD", true)` → «Mil trescientos treinta y siete dólares con 67/100»); sin la bandera el comportamiento es el de siempre.
- Probado: unitarias (31/31 en `acuerdoComision97.test.ts`) y `DOC97-1` contra BD real: la cuenta de cobro muestra `USD $1,470.00`, `$33.00`, retención `$165.33`, a cobrar `$1,337.67` (no «$1,338»), y el estado de cuenta el mismo total con centavos.

### 10.3 Arnés antiguo del portal — estado honesto de los siete
- Con la lectura adaptada a la UI nueva (copia desechable), **A3 y PORT-2 pasan**: únicos dos con comprobación de lo que verifican (aislamiento entre aliados).
- **PENDIENTES de revisar caso por caso (no diagnosticados): D3, A1, A6, PORT-1, PORT-3.** Solo se observó que la tabla nueva no trae las columnas/textos que esas pruebas afirman; no se verificó que cada aserción restante sea obsoleta y no un defecto real.
- `INT97-75` y `integracion-97-con-75.diff` se conservan sin cambios.

## 11. Ciclo de vida de la comisión — implementación de #97 (2026-11-08, 8) · coordinada con #75

Reparto definitivo del dueño: **#75** implementa la transición pendiente → confirmado (`confirmar_venta` y la confirmación por abono, su migración 288) y es el único que los modifica; **#97** implementa el **plan** de comisión y su **función interna de materialización**, y la entrega a #75. Un solo plan, una sola materialización.

### 11.1 Qué entrega #97 (migración 286 alineada, sin aplicar en remoto) — OJO: «frescura» y «detección del gancho» quedaron SUPERADAS por §12
- **Un único plan:** la tabla pasó a llamarse `comision_plan` (antes `cotizacion_comision_acuerdo`) y sirve a todos los recorridos: cotización dinámica, Reservar, contrato manual y negociado. Cadena versionada, solo inserción; al convertir una cotización el plan se **liga al contrato** con una versión más.
- **Una única materialización:** `public.materializar_comision_b2b(numero)` (la llama la confirmación de #75 en su misma transacción). Solo actúa con el contrato confirmado (o `activo`, histórico); copia el plan sellado (`comision_valor` = ordinaria; participación del recobro como %) **sin consultar el % vigente**; verifica el total **al centavo**; idempotente por `aliados_b2b.plan_id` único; **no duplica** si ya hay una fila del mismo aliado (histórica o manual) ni la toca.
- **Pendiente:** `registrar_comision_b2b_reserva` (única puerta de Reservar/manual/negociado/programas) registra el **plan**, no la fila exigible; `p97_priv.aplicar` (conversión dinámica) liga el plan y retira la fila de recobro que crea la 198 en esa conversión (sin abonos). **NETO:** su fila descontada/no exigible se conserva desde la creación; no genera plan ni segunda comisión.
- **Respaldo `ventas.comision_b2b`:** sin fila, solo es **cobrable con el contrato confirmado** (`estadoExigible`: confirmado o el histórico `activo`; sin estado conocido → no). Aplicado en `resolverComisionB2B` (cuenta de cobro y estado de cuenta) y `comisionVisibleAliado` (portal). Las filas históricas no se desactivan.
- **Reuso (#75):** un plan de un contrato anterior con el mismo número DTM no pertenece al contrato nuevo: se distingue por **frescura** (el plan válido nace con la venta o después). Con el reuso apagado no cambia nada.
- **Con o sin el gancho de #75:** `p97_priv.gancho_confirmacion()` detecta `p75_priv.materializar_obligaciones`. Con él, la comisión de un pendiente nace **al confirmar**. Sin él (286 aplicada sola) conserva el momento histórico (al crear/convertir) para no dejar comisiones sin materializar jamás. **Orden recomendado: 288 de #75 antes que la 286** (así lo declara #75). El contrato que **nace `activo`** (el manual de hoy) materializa al crearse con la misma función.
- **Manuales nacen pendientes:** regla de #75 (Mayorista siempre pendiente, Minorista `activo`); `crearContrato` NO lee el interruptor para elegir el estado. Con el ciclo encendido (antes de desplegar el código) la comisión nace al confirmar sin cambios en #97 (ver §12.3).
- **Reversión/anulación:** sin cambios; ni obligaciones materializadas ni pagos se borran. Un contrato revertido en su creación puede dejar un plan huérfano (inofensivo por la frescura; `diagnostico_286_comisiones_historicas.sql` lo lista).
- **Rollback:** se niega si hay planes o comisiones materializadas desde un plan; restaura la RPC de la 205 y las funciones previas si no hay evidencia.

### 11.2 Pruebas de la versión anterior (las de la versión vigente están en §12.4)
- SQL `test_97_acuerdo_dinamica.sql`: **92/92** — con el gancho simulado (A–G: pendiente sin fila, confirmar materializa, % pactado y no el de hoy, histórica sin duplicar, NETO sin segunda comisión, anon sin acceso, frescura ante reuso, nace-activo) y sin gancho (H); y el mismo script **92/92 sobre el esquema integrado con 284/285/287/288 reales de #75**.
- Concurrencia real `test_97_materializar_carrera.sh`: 8 sesiones simultáneas → 1 fila, mismo id, 0 errores.
- Preflight/postcheck/rollback/reaplicación: sin fallas, con y sin la 288. Postcheck sobre una base ya activada falla la fila 15 por diseño (es de la fase 1).
- Arnés app→PostgREST de #97 solo (sin gancho): 20 pasan, 1 se salta (`INT97-75`). **Árbol combinado #97 + #75 con su 288 real: 21/21** (incluye `INT97-75` con reuso e identidad y `DOC97-1`, y comprueba que `confirmar_venta` materializa **sola**: una fila justo tras confirmar, sin segunda llamada).
- Tipos: `tsc` limpio en #97. En el combinado solo quedan 2 errores, ambos en `pruebas/obligacionesAlConfirmar288.test.ts` de #75 (los mismos en su propio árbol): **condición para aprobar la fusión**.
- Parche de las tres llamadas (`revertirContratoManual` ×2, `depsFinancieroManual` ×1) conservado en `integracion-97-con-75.diff` y necesario también con la 288.
- Unitarias focales 171/172 (el único fallo, `reservarProgramaInterno` 36 vs 37, es de `main`); react de comisión/portal: los mismos 12 fallos de `main`, ninguno nuevo.

### 11.3 Límites
- La transición es de #75; la prueba combinada ejercita su 288 real, pero no revisé su código más allá de cómo llama a esta función.
- Reservar (tarifario) pendiente se cubre por la RPC en SQL; no se ejecutó el recorrido de pantalla de Reservar de extremo a extremo.
- Portal y `/dashboard/comisiones`: solo se gateó el cobro/respaldo; no se rediseñó cómo se muestra un pendiente (un pendiente con plan aparece sin fila: en Comisiones puede verse como «Por definir»). La liquidación del asesor no se revisó.
- Las filas históricas exigibles en pendientes **no se tocan**; el diagnóstico solo las lista.

## 12. Identidad del plan y ciclo explícito (2026-11-08, 9) — corrige dos puntos de la 286

### 12.1 El plan se liga al contrato por IDENTIDAD, nunca por fecha
- `comision_plan` gana `contrato_uid` (= `ventas.contrato_uid`, la identidad de #75). `numero_contrato` queda como etiqueta visible. Regla: toda versión pertenece a una cotización (`cotizacion_id`) o a un contrato (`contrato_uid`); un plan **de cotización sin contrato** (uid nulo) es evidencia y no se elige para ningún contrato.
- Se liga cuando se crea o convierte el contrato: la RPC de reserva escribe el plan con el uid de la venta; la conversión dinámica añade una versión de la misma cadena con el uid del contrato nuevo (una sola vez).
- `materializar_comision_b2b` elige el plan por `contrato_uid = ventas.contrato_uid` y **nada más**: se eliminó `creado_en >= created_at`. Los planes huérfanos (contrato borrado o con otro uid) se conservan como evidencia y no se materializan.
- **Requisito de la 286: la 284 de #75** (`ventas.contrato_uid`); la migración aborta con un mensaje claro si falta.
- Probado en SQL (`I1–I2`): dos contratos con el **mismo número, distinto UUID y fechas iguales**, y un plan escrito **tarde** para el contrato anterior → no se materializa nada para el nuevo; al registrar su plan se materializa **una vez** desde el suyo; los dos planes del anterior se conservan. **Renumeración** (`fn_renumerar_contrato`) conservando la identidad: el plan, con la etiqueta del número viejo, se halla por uid y se materializa una vez a nombre del número nuevo; el viejo no materializa nada. Concurrencia real (8 sesiones): 1 fila.

### 12.2 Interruptor EXPLÍCITO del ciclo; nada cambia según qué funciones existan
- Se eliminó la detección del gancho de #75. Ahora hay `p97_priv.ciclo` (apagado al aplicar): **SUPERADO por §12.6**: un PENDIENTE es siempre plan (interruptor en cualquier posición); el interruptor solo cambia lo que nace ya confirmado/`activo`.
- Se enciende solo con `activar_286_ciclo_comision.sql`, que verifica `p97_priv.dependencias_ciclo()`: identidad de #75 (284), guarda de identidad sobre `comision_plan`, y el **gancho único de #75 (288)**: `confirmar_venta` → `materializar_obligaciones` → `materializar_comision_b2b`. Si falta alguna, **no se enciende** y el error la nombra. `preflight_286_ciclo.sql` da el diagnóstico en una consulta; `desactivar_286_ciclo_comision.sql` apaga sin perder evidencia (lo pendiente con plan sigue materializándose al confirmar: la materialización no depende del interruptor).
- Encendido y con una dependencia ausente (p. ej. alguien revierte la 288), crear o convertir un contrato B2B se **rechaza** con el diagnóstico (`CICLO_97 …faltan dependencias…`) y no escribe nada; no se cambia la regla en silencio. El rollback se niega con el ciclo encendido o con planes/comisiones materializadas.
- Probado: sin la 288, el preflight dice «NO ENCENDER», la activación se niega con diagnóstico y el ciclo queda apagado; con la 288 real: preflight «LISTO», activar, reactivar (se niega), desactivar.

### 12.3 Estado de nacimiento (cierre; regla del dueño) — supera lo anterior de este apartado
- **Regla final:** el manual de **Mayorista nace PENDIENTE**; **Minorista conserva su comportamiento** (`activo`). Es la regla de #75 y #97 la usa con el MISMO texto (`estado: tenant === "minorista" ? "activo" : "pendiente"`): **el interruptor de comisión no decide si una venta está confirmada** y el parche de integración no toca esa línea (ya no hay conflicto de fusión).
- **Qué sí exige #97:** que un manual pendiente no genere comisión exigible. `crearContrato`, antes de numerar, rechaza un manual B2B de Mayorista con comisión si el ciclo no está encendido (o no existe la 286) con el mensaje «…nace pendiente y el ciclo de vida de la comisión no está activo…»; un error real al leer el interruptor también rechaza. **Nunca se resuelve marcándolo activo.** Mayorista sin comisión B2B y Minorista no cambian.
- **Despliegue coordinado:** 288 (con la corrección de §12.5) → 286 → desplegar el código (que ya hace nacer pendientes) → `preflight_286_ciclo.sql` → `activar_286_ciclo_comision.sql`. Entre el despliegue y la activación, crear un manual B2B de Mayorista se rechaza (cerrado, no incorrecto); los de Minorista, los sin comisión y Reservar siguen igual. Alternativa equivalente: encender el ciclo antes de desplegar el código nuevo.

### 12.4 Pruebas de esta versión (Docker local; sin SQL remoto; no se aplicó 286 ni 288 en ningún remoto)
- SQL `test_97_acuerdo_dinamica.sql`: **103/103** sobre #97 + 284 (dependencias simuladas en la transacción) y **103/103 sobre el esquema integrado con 284/285/287/288 reales de #75**; incluye pendiente sin fila, confirmar, % pactado, históricas sin duplicar, NETO sin segunda comisión, nace-activo, identidad (I1–I2), dependencias ausentes (I3) y el modo apagado (H).
- Preflight/postcheck/rollback/reaplicación y los tres scripts del ciclo: sin fallas. Carrera: 8 sesiones → 1 fila.
- Arnés app→PostgREST: **combinado #97 + #75 (288 real, ciclo encendido con el script de activación): 23 pasan + 1 se salta (V97-0, solo con ciclo apagado)** (F2, V97, N97, Q97, UI97, T2, DOC97, INT97-75 con reuso e identidad, **CIC97-1**: el manual nace pendiente sin fila ni cuenta de cobro; el abono que alcanza el mínimo confirma y materializa en la misma transacción; un segundo abono no duplica). **Ciclo apagado (286 sin 288): V97-0 (rechazo antes de numerar, nada creado) y Q97-1…7 pasan.** Con el ciclo apagado los casos que crean un manual B2B de Mayorista se rechazan por diseño (§12.3).
- Tipos: `tsc` = 0 en #97, en el combinado (con el parche) y en el árbol actual de #75 (**los dos errores de `obligacionesAlConfirmar288.test.ts` ya no aparecen en su árbol**).

### 12.5 Reintento de conversión (cierre)
- **Regla:** una conversión válida ya completada nunca es un error. Si la cotización ya tiene su contrato (reintento, **respuesta perdida** o llamada concurrente), se devuelve **ese mismo contrato** sin volver a trasladar CxP a previstas ni repetir la materialización.
- **#97** (`convertir_cotizacion_manual_controlada`, 286): tras el `FOR UPDATE` de la cotización, si ya hay venta devuelve su número y no ejecuta nada más (antes llamaba a la envoltura de #75 y esta fallaba en `mover_cxp_a_prevista`). La llamada concurrente espera el candado y devuelve el contrato de la primera.
- **#75** debe corregir su propia envoltura `convertir_cotizacion_a_contrato` (288) con la misma regla, para los demás llamadores: propuesta en `parche-75-reintento-conversion.diff` (**no ejecutada** ni aplicada: es SQL de la 288 de #75).
- **Pruebas estrictas restauradas** (`contratoManualNeto206.pg.ts`): **Q97-5** ambos intentos correctos y mismo número; **Q97-6** dos llamadas simultáneas correctas, mismo número; **Q97-7** respuesta perdida y reintento posterior (tras confirmar por pago) correctos. En las tres: una venta, un juego de obligaciones (CxP + previstas) y una comisión. **`mover_cxp_a_prevista` ya no se acepta** como resultado de una conversión válida.

### 12.5.bis Autorización antes de devolver un contrato existente (cierre)
- `convertir_cotizacion_manual_controlada` (286) comprueba, ANTES de leer o devolver nada: usuario existente, activo y de rol de conversión (`_autorizado_pago_previo`) y acceso a la agencia de la cotización **y del contrato** (superadmin = excepción global). Un actor inactivo, sin rol, externo o de otra agencia no recibe el contrato existente ni cambia nada. No se repite ninguna validación económica ni escritura de una conversión terminada.
- La misma regla para la envoltura de #75: `parche-75-reintento-conversion.diff`.
- Pruebas (`contratoManualNeto206.pg.ts`): **Q97-8** secuencial (acción real + base; autorizados admin/ops/gerencia/super; rechazados inactivo, venta, agencia, administración de OTRA agencia y sin sesión) · **Q97-9** concurrente (siete actores a la vez, antes y después de terminar; un contrato, una comisión, sin repetir) · **Q97-10** la envoltura de #75 llamada directo (solo corre con la 288; con la 288 original falla con `mover_cxp_a_prevista`; con el parche pasa). Huella comparada antes/después: venta, comisión, plan, abonos, ítems y juego de obligaciones.

### 12.6 Límites
- No se aplicó nada en remoto. La 286 exige la 284; el ciclo exige además la 288 (y su código desplegado antes de encender).
- Dinámica pendiente no existe en la práctica (ver 12.5); el pendiente real es el manual y Reservar. Reservar (tarifario) pendiente se cubre por la RPC en SQL, no de extremo a extremo por pantalla.
- Los contratos históricos con comisión exigible en pendiente se conservan; `diagnostico_286_comisiones_historicas.sql` los lista.

### 12.6 Invariante: pendiente = solo plan, con el ciclo encendido o apagado (2026-11-10)
- **Regla:** un contrato PENDIENTE conserva un plan informativo y **nunca** una comisión exigible; la fila nace únicamente al confirmar (gancho único de #75 → `materializar_comision_b2b`). Apagar el ciclo **no materializa planes ni cambia estados comerciales**. NETO conserva su fila descontada (`descontada_en_precio`, `pagada`) sin plan ni pago adicional. Lo que nace ya `confirmado`/`activo` mantiene su tratamiento histórico (plan + fila en el acto con el ciclo encendido; fila directa con el apagado).
- **Cambios en la 286:** `registrar_comision_b2b_reserva` solo toma la ruta de fila directa si es NETO o (ciclo apagado **y** contrato no pendiente); `p97_priv.aplicar` exige dependencias para todo pendiente, retira la fila de la 198 de un pendiente y completa la de uno ya confirmado; `p97_priv.materializar(numero, completar)` **perdió `p_forzar`** (no existe ruta forzada de pendientes) y devuelve null si el contrato no está confirmado/`activo`. Efecto colateral corregido: antes, con el ciclo encendido, una conversión de un contrato ya `activo` borraba la fila y no la materializaba.
- **Consecuencias de despliegue:** (a) ya no hay «ventana» donde un pendiente nazca con comisión exigible si el código se despliega con el ciclo apagado — el orden «ciclo antes que código» deja de ser un requisito de seguridad de la comisión (sigue siendo útil para que el rechazo de `crearContrato` no bloquee B2B); (b) las dependencias (284, guarda de `comision_plan`, 288) pasan a ser exigidas para todo pendiente, no solo con el ciclo encendido; (c) el rechazo de `crearContrato` por «ciclo no activo» (`contratos/actions.ts`) queda **más estricto de lo necesario** — decisión de #75/#97 si se relaja.
- **Pruebas:** `supabase/scripts/test_97_ciclo_apagado.sql` (-v ciclo=false|true; pendiente, nace confirmado, nace activo, NETO, alternar el interruptor, sin ruta forzada): 25/25 en ambas posiciones sobre 287+288 reales de #75 + esta 286; contra la 286 anterior falla 5 de 23. `test_97_acuerdo_dinamica.sql` (sección H reescrita): TODO OK (105). `test_97_comision_pvp.sql` y `test_97_negociado_A.sql` sin fallas con el interruptor en ambas posiciones.
