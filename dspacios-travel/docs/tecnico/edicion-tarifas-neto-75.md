# Edición de tarifas en un contrato NETO (#75, 2026-11-10)

**Estado:** regla aprobada por el dueño (opción C con BNC conservada) e implementada en la **migración 291** (`20260601000291_reemision_neto_pendiente.sql`, SIN correr) y en `guardarItemsContrato`. El caso de un contrato PVP queda **reproducido, no corregido**: la autorización cubre solo NETO (ver al final).

## Causa (antes de la 291)
`guardarItemsContrato` (`contratos/[numero]/contenido-actions.ts`, solo superadmin) reemplazaba `contrato_items` y no tocaba `ventas` ni `aliados_b2b`. En NETO, el documento y el saldo toman el total exigible de `ventas.precio_venta`. Por eso los ítems pasaban a 2.200.000 mientras el total exigible y el documento seguían en 1.800.000, y la acción respondía `{"ok":true}`.

## Regla aprobada (implementada)
Solo con el contrato **pendiente y sin pagos**:
- Se conserva el **% pactado**, el de la fila descontada (`aliados_b2b.pct_comision`). El % vigente del catálogo no se consulta: la prueba NETO-ED1 lo sube a 25 % y el resultado no cambia.
- Se conserva la **BNC** (`ventas.impuesto`) en importe y moneda.
- Base = PVP nuevo − BNC − recobro. El recobro solo se resta si el acuerdo lo excluyó (regla de #97), y eso se deduce del propio acuerdo guardado.
- Comisión ordinaria = round(base × %), a la unidad de la moneda. El recobro conserva su importe y su reparto, y su participación sigue sumando al descuento sin entrar dos veces en la base.
- NETO = PVP − (ordinaria + participación).
- Costos y obligaciones (CxP y previstas) no se tocan.

Ítems, fila descontada (`precio_venta`, `base_comision`, `comision_valor`) y `ventas.precio_venta`/`comision_b2b` se escriben en **una sola transacción**: la RPC `reemitir_neto_pendiente`. El mínimo NETO de confirmación (288) sale de esos campos, así que pasa a ser el nuevo total.

### Conciliación monetaria de la fila (corrección del 2026-11-10)
- **La fila persiste el importe** (criterio #97/286). `comision_valor` = ordinaria ya redondeada + la parte de la participación que la fila lleva dentro. Así `comision_b2b_total` (SQL) y `calcularComisionFila` (TS) liquidan **exactamente** el descuento de la venta. La RPC lo verifica al centavo con la fórmula sin retención (la misma de `p97_priv.materializar`) antes de escribir la venta; si no cuadra, revierte. El % pactado, `recobro_total` y `pct_recobro_aliado` no se tocan, y la política global de redondeo no cambia.
- **Las tres formas reales de fila** se reconocen sin adivinar:
  - **206:** `comision_valor` NULL, sin recobro.
  - **222 (hija NETO):** el descuento completo en `comision_valor`, recobro 0.
  - **Participación como `recobro_total × %`.**

  La ordinaria pactada es round(base × %). La participación es descuento − ordinaria, y el recobro excluido es PVP − BNC − base.
- **Regla #97:** hay participación **si y solo si** el recobro se excluyó de la base. Un acuerdo que contradice eso se rechaza. La versión anterior de la 291 sumaba la participación aunque el recobro estuviera dentro de la base, y leía el recobro de la fila, que en las filas reales (206 y 222) es 0. Ambas cosas quedaron corregidas.
- **Hallazgo previo, de la 206 y no de la 291:** las filas NETO de la 206 tienen `comision_valor` NULL, así que liquidan `base × %` sin redondear. En USD 2.345 al 10 % la fila liquida 234,5, mientras el descuento es 235. La 291 lo corrige en cada contrato que reemite; los NETO de la 206 que no se reemiten siguen así. Corregirlos en bloque sería un backfill aparte, a decidir.

| Caso obligatorio | PVP | BNC | Base | Comisión 10 % | NETO |
|---|---|---|---|---|---|
| Original | 2.000.000 | 400.000 | 1.600.000 | 160.000 | 1.840.000 |
| Tras editar | 2.200.000 | 400.000 | 1.800.000 | 180.000 | **2.020.000** |

### Margen (cierre del 2026-11-10)
Antes de esta corrección, la reemisión no medía el margen. Reproducido: PVP 2.000.000 → 1.700.000 con hotel a 1.500.000 dejaba el NETO en 1.530.000 (1,96 % de margen) sin pedir aprobación. Ahora se aplica **la misma regla con la que se creó ese contrato**, sobre el NETO nuevo y los costos ya registrados (`ventas.costo_*`, en la moneda del contrato):
- **Contrato manual (206)**, espejo de `evaluarMargenContrato`/`puedeAprobarMargenBajo`: NETO + 0,5 ≥ costos ÷ 0,94. No aplica sin costos ni en paquetes negociados (bloqueo/porción), igual que al crear. Por debajo, solo con **aprobación explícita** de superadmin o administración.
- **Hija NETO (222)**, detectada por `ventas.cotizacion_id` → `cotizacion_neto`: usa `p50_priv.evaluar_margen` (6 % con medio peso; 2 % exacto si es solo tiquetes). Costo 0 o NETO por debajo del costo se rechazan **para cualquier rol**. Por debajo del mínimo, solo con aprobación explícita del rol de `p50_priv.rol_autoriza_margen` (2 %: solo superadmin).
- **La aprobación no es automática por ser superadmin.** Es el indicador `p_forzar_margen`, que el editor solo envía cuando el usuario pulsa «Aprobar margen bajo y guardar» tras el aviso, igual que el formulario de creación. La base vuelve a exigir el rol.
- El rechazo ocurre dentro de la misma transacción: ítems, comisión y venta quedan como estaban.

### Se rechaza sin cambios (mensaje `NETO_291: …`)
- No superadmin, sin sesión u otra agencia.
- El contrato no es NETO.
- No está pendiente (confirmado o anulado).
- Tiene abonos, soportes de pago vigentes, plan de cuotas o facturación.
- Nació de una oferta #63.
- **Se cobra en otra moneda**: la 235 congela precio y total convertido, y reabrir eso es decisión de #63.
- Tiene una línea de precio total (Bernalo).
- BNC > PVP nuevo.
- El acuerdo pactado no se puede recuperar sin ambigüedad: no hay exactamente una fila descontada, falta el %, o la base, comisión, PVP e ítems guardados no cuadran entre sí.

### Concurrencia
La RPC toma `FOR UPDATE` sobre la venta, y no hace falta trigger propio:
- **Abono:** insertarlo verifica la FK `abonos → ventas`, que toma `FOR KEY SHARE`. Si el abono llega antes, la reemisión espera, ve el pago y rechaza; si llega después, espera y entra sobre el total nuevo. Pasa igual con un abono insertado sin la RPC (importador o service-role).
- **Confirmación:** también serializa. Si la reemisión va primero, `confirmar_venta` decide con el total nuevo; si la confirmación va primero, la reemisión ya no encuentra el contrato pendiente.
- El postcheck vigila que el candado no se baje a `FOR NO KEY UPDATE`.

### Excepción a la 205
`tg_aliados_b2b_proteger_abonos` se reemplaza con una sola excepción. El total de la fila descontada puede cambiar solo si la RPC marcó, en su transacción, ESE contrato (`app.p291_reemision` = `número|contrato_uid`) y la base confirma que sigue pendiente y sin abonos. Una marca puesta a mano, de otro contrato o sobre un contrato con abono no sirve (pruebas 6a–6c). El rollback restaura la función de la 205 exacta (md5 normalizado `0efb4b1c…`).

### Despliegue
**291 antes del código.** Sin la 291, el código nuevo bloquea la edición de tarifas NETO (`PGRST202`, «requiere la migración 291») en vez de dejar la divergencia: cerrado, no incorrecto. El código viejo funciona con la 291 aplicada, solo que conserva la divergencia NETO.

### Evidencia (Docker local, base nueva desde la plantilla 284–290)
- `preflight_291` LISTO → 291 → `postcheck_291` CORRECTA → `test_291_reemision_neto.sql` **42/42**. Incluye la conciliación exacta (`pg_temp.conc`, igualdad numérica sin casts) en COP y USD, con y sin recobro, en las tres formas de fila, más repetir el guardado.
- Siguen `test_291_carrera.sh` **11/11** → rollback (función de la 205 restaurada, RPC eliminada) → reaplicación CORRECTA.
- **NETO-ED4** (USD por la app): 2.345 → 2.355 deja la fila en exactamente 236 (antes 234,5 frente a 235), con el NETO en 2.119. Repetir el guardado no cambia nada; el resolvedor TS y `comision_b2b_total` dan lo mismo que el descuento.
- Arnés app→PostgREST (`contratoManualNeto206.pg.ts`):
  - **NETO-ED1:** caso obligatorio por `crearContrato` + `guardarItemsContrato`. Al reabrir: BD, documento imprimible («Total del contrato $ 2.020.000», sin PVP ni comisión), estado de cuenta/cartera (2.020.000/2.020.000), mínimo 2.020.000 y previstas intactas.
  - **NETO-ED2:** con un pago o confirmado, se rechaza sin cambios.
  - **NETO-ED3:** BNC > PVP, se rechaza sin cambios.
- **Consumo:** un guardado NETO hace 5 solicitudes HTTP (sesión, perfil, chequeo de líneas de precio total, venta, RPC), las mismas que el camino anterior (sesión, perfil, chequeo, insert, delete). Sin solicitudes nuevas por render.
- **Redondeo por moneda:** USD 2.345 → 2.355 al 10 % da comisión 235 → 236 (unidad dólar).

## Contrato PVP — reproducido, sin corregir (fuera de la autorización)
**PVP-ED0** fija el comportamiento actual: en un PVP pendiente, editar la tarifa a 2.200.000 deja los ítems y el documento en **$ 2.200.000**, mientras `ventas.precio_venta`, que usan cartera, estado de cuenta y rentabilidad, sigue en **2.000.000**. La comisión sigue «Por definir». Es diseño declarado del editor: igualar es la acción aparte «Sincronizar precio de venta», y la UI avisa del descuadre.

**Propuesta, a decidir por el dueño:** en un PVP **pendiente sin pagos**, guardar ítems y `precio_venta` en la misma transacción. Mantener el comportamiento actual en contratos confirmados o con pagos, donde mover el precio cambia saldo y comisiones ya registradas. No se implementó.
