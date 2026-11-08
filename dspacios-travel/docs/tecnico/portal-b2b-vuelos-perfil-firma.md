# Portal B2B — vuelos (#85), actualización (#84), perfil (#25) y diseño de firma (#98)

Rama `codex/portal-b2b-vuelos`. Sin migraciones. Los tres bloques son separables: cada uno tiene su archivo de
prueba (`portalVuelos85`, `portalActualizacion84`, `portalPerfil25`).

## A. Vuelos de contratos propios (#85)

**Qué muestra:** en *Mis ventas*, «Ver vuelos» (`<details>` nativo, sin JS) bajo cada contrato PROPIO. Una tarjeta por
tramo con aerolínea, ruta, vuelo, fecha, salida y llegada **contratados** (copia de `contrato_vuelos`, no se modifica).

**Cotejo con el sistema.** Solo si el vínculo se acredita **por tramo** (`vincularTramo`, `lib/portal/vuelosContrato.ts`).
Se exige a la vez: sentido ida/regreso · `contrato_vuelos.record` = `record` de la fuente · la venta apunta a esa fuente
(`ventas.bloqueo_ref_id` o `empaquetado_ref_id`) · mismos extremos de ruta (invertidos en el regreso) · un único tramo con
ese record y sentido en el contrato. La referencia a nivel de venta NO basta: un vuelo manual o adicional queda «sin vínculo»
y muestra solo lo contratado con el motivo. Si coincide, se dice una vez; si difiere, se listan SOLO los campos distintos
como «último horario registrado en D'spacios» (nunca «vigente» ni estado de aerolínea).

**Estados de comparación (por tramo):** *completa* (el sistema tiene los 4 datos y coinciden) · *parcial* (coinciden los que tiene; se indica cuáles faltan) · *sin datos operativos* (el sistema no tiene ninguno; no se afirma coincidencia) · *diferente* · *sin vínculo* (ausencia confirmada, con motivo) · *no se pudo comprobar* (la lectura de la fuente falló o la fila referenciada no apareció; no se presenta como ausencia).

**Fecha de actualización:** siempre «Sin fecha de actualización acreditada». No se lee texto libre de `bloqueo_cambios`
y no hay migración para resolverlo (`bloqueos_vuelo.updated_at` cambia con cualquier edición, no solo con horarios).

**Sin vínculo posible:** salida dinámica (sin FK; tramos con `record` null), vuelos manuales, históricos sin
`contrato_vuelos`, y empaquetados cuyo tramo se creó sin record (el record del empaquetado se agrega después de emitir).

**Seguridad.** `cargarVuelosPortal` (`lib/portal/vuelosPortalServidor.ts`) recibe las ventas ya autorizadas por
`cargarConjuntoPortal` y descarta `relacion !== "propio"`; participar en la comisión no da el itinerario. Lecturas
service-role por lotes de 100, paginadas con conteo exacto (`leerTodoConConteo`); si una falla el contrato sale
«incompleto» (no se muestra a medias) y si solo falla la fuente se muestra lo contratado sin afirmar diferencias.
DTO con columnas explícitas: sin record/PNR, ids de fuente, notas, costos, cupos, sillas ni pasajeros. No se aceptan ids
del navegador (el panel se renderiza en servidor para las filas ya autorizadas).

**Archivos:** `lib/portal/vuelosContrato.ts` (puro), `lib/portal/vuelosPortalServidor.ts`,
`components/portal/VuelosContrato.tsx`, `app/portal/b2b/ventas/page.tsx` (fila adicional por contrato propio;
filtros, orden y «próximas salidas» intactos).

**Diseño:** en modo tarjetas el `tr` pasa a CSS grid y `colSpan` deja de aplicar; la celda lleva `grid-column: 1 / -1` (`FilaVuelosContrato`).

## B. Actualización de lo que ve el aliado (#84) — ABIERTO

`force-dynamic` solo garantiza que la página no se sirve de caché; **no** demuestra que cada campo refleje el cambio interno.
Matriz de campos (estado real de la auditoría):

| Pantalla | Campo | Origen | Comportamiento | Verificado |
| --- | --- | --- | --- | --- |
| Ventas | contrato, cliente, destino, salida, estado, compra | `ventas` vía `cargarConjuntoPortal` | En vivo en cada lectura | Solo por lectura de código |
| Ventas | comisión e importe | `comisionesDelPortal` (`aliados_b2b` / `ventas.comision_b2b`) | **No auditado** si es en vivo o congelado | No |
| Ventas | vuelos (#85) | `contrato_vuelos` + fuente por tramo | Contratado en vivo; cotejo en vivo | Pruebas puras y del cargador con doble de Supabase |
| Cartera | valor y moneda | `cobroDeVenta`: `total_cobro/moneda_cobro/trm_cobro` si hay conversión; si no, `precio_venta` | **Congelado** con conversión; en vivo sin ella | Prueba pura (`carteraDe`) |
| Cartera | pagado, saldo | `abonos.valor_abono` sumado | En vivo; igual criterio que la Cartera interna | Prueba pura; comparación por lectura de código |
| Cartera | soportes de pago | #443 | Fuera de este lote | No |
| Documentos | enlaces, vouchers | `documentosDe` | **No auditado** | No |

Pruebas ejecutadas (`pruebas/portalActualizacion84.test.ts`): cálculo de cartera con cambio de precio y abono nuevo, acuerdo
congelado que no se mueve, contrato saldado, participación sin cartera, y que las pantallas no usen caché. **No se ejecutó** un
recorrido de recarga contra la aplicación y una base real (ni local), así que #84 sigue abierto. No se cambió ningún cálculo
financiero ni acuerdo congelado, y no se añadió sondeo.

## C. Mi perfil (#25) — solo consulta

Ruta `/portal/b2b/perfil` (se llega desde el nombre del encabezado, sin sumar una pestaña al menú móvil).
Agencia y freelance son el tipo de aliado (`usuarios.rol`); no tienen relación con mayorista/minorista (`tenant`).

> «Con aprobación» y «editable propuesto» son una **clasificación propuesta**. No existe ningún circuito de aprobación implementado,
> y el portal no lo menciona: al aliado solo se le dice que contacte a su asesor.

| Campo | Aliado | Agencia / Freelance |
| --- | --- | --- |
| Nombre/razón social, documento | Consulta hoy; cambio **con aprobación** | ambos |
| Correo de acceso | Consulta; cambio con verificación/aprobación | ambos |
| Persona de contacto | Consulta; **editable propuesto** | solo agencia |
| Teléfono, correo de contacto, dirección | Consulta; **editables propuestos** | ambos |
| Cuenta bancaria | Consulta enmascarada (últimos 4); cambio **con autorización explícita** | ambos |
| Categoría y % de comisión, retención | Consulta; **interno** | ambos |
| Rol, activo, tenant, acceso legacy, vínculo de ficha (`aliado_id`) | No se muestran editables; **solo personal interno** | ambos |
| Agentes | Pestaña existente | solo agencia |

Estado de escrituras: **ninguna habilitada.** La tabla vive en `CAMPOS_PERFIL` (`lib/portal/perfilPortal.ts`) y una prueba
impide que los campos internos figuren como editables. Antes de escribir se necesita aprobar la lista exacta de campos y
sus validaciones; un circuito de aprobación, si se decide, sería trabajo nuevo (podría apoyarse en `b2b_solicitudes`/avisos de #443); hoy no existe.

## D. Diseño de firma y aceptación (#98) — NO implementado

Sobre la cuenta de cobro actual (`/portal/comision/[numero]`, solo freelance; hoy trae una línea «Firma» vacía).

1. **Tres niveles distintos, ninguno es firma criptográfica certificada:**
   - *Imagen de firma* del aliado: PNG/JPEG subido una vez al perfil, se estampa sobre la línea de firma.
   - *Aceptación expresa*: casilla + botón «Acepto esta cuenta de cobro» sobre una versión concreta.
   - *Firma sobre el nombre*: el nombre del documento queda como firmante, con fecha/hora y usuario autenticado.
   Juntos son evidencia de consentimiento electrónico simple; no sustituyen certificado ni firma digital (Ley 527).
2. **Permisos:** solo el aliado dueño del contrato (misma resolución que `resolverComisionB2B`/`accesoDocumentoContrato`);
   personal interno solo consulta y descarga. Participar en la comisión sin ser dueño no firma.
3. **Almacenamiento:** reutilizar el patrón de #443 (bucket privado + tabla con sha256, vigente/archivado, sin policies,
   todo por service-role tras autorizar). Imagen de firma en bucket propio privado; aceptación en tabla nueva
   `comision_aceptaciones` (contrato, aliado_id, usuario, versión, huella del contenido, importe, moneda, ip/ua opcional,
   `created_at`). Requeriría migración y preflight/postcheck de una consulta cada uno.
4. **Versión aceptada:** huella (sha256) de los datos que el documento imprime: importe, base, %, retención, datos de pago
   y número de contrato. Se guarda con la aceptación.
5. **Si cambia el importe después:** la aceptación queda ligada a su huella. Al recalcular, la huella cambia → el documento
   pasa a «Cambió después de tu aceptación», se archiva la aceptación previa (no se borra) y se pide aceptar la nueva
   versión. El PDF aceptado anterior sigue consultable con su fecha.
6. **Decisiones comerciales pendientes:** ¿la aceptación es obligatoria para liquidar la comisión o solo informativa?
   ¿se exige firma al aliado de tipo agencia (hoy factura electrónica)? ¿quién puede invalidar una aceptación?
