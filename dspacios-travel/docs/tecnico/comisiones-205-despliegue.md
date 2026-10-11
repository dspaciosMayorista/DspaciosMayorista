# Migración 205 — Comisiones B2B: despliegue, verificación y reversión

Runbook de la `20260601000205_comisiones_b2b_integridad.sql` (#38). Qué hace la
migración y por qué: su encabezado y `finanzas-comisiones.md` (§ "#38").

- **Número:** 201 Vuelos, 202 CRM, 203 Tarifas, 204 Contabilidad, **205 Comisiones**.
- **Dependencias reales:** 107/116 (tenant), 131 (`comision_b2b_pagos`), 140 (`mi_rol`),
  154 (`puede_ver_tenant_cotizacion`), 172 (`ventas.financiero_estado`). **No** depende de
  201–204 ni toca sus objetos (verificado: se aplica y pasa todas las pruebas sobre una
  base 1–200, y 203/204 no tocan `aliados_b2b`, `comision_b2b_pagos`, `ventas` ni
  `eliminar_contrato`). No hay que aplicar 202–204 antes.
- **No toca datos:** ningún UPDATE/DELETE/INSERT sobre filas existentes; todas quedan con
  `base_explicita` NULL (lectura de siempre). `base_explicita` **no tiene default**: lo que
  inserte el código viejo durante el intervalo también queda legado.

## Orden de despliegue

| Paso | Qué | Cómo se verifica |
|---|---|---|
| 1 | `supabase/scripts/preflight_205_comisiones_b2b.sql` (solo lectura) | Ninguna fila `FALLA`. Las `INFO` anticipan qué cambia de pantalla (NETO legado, contratos con abonos a comisión) y cuentan las ventas B2B atascadas en financiero pendiente sin comisión (INFO 25: la RPC de reserva no les añadirá una; revisarlas a mano, sin backfill). INFO 26/27 cuentan las comisiones sin ficha que el aliado dejará de cobrar por URL con el código nuevo (sin documento, o con uno distinto al de la ficha del contrato). INFO 28 cuenta las filas B2B de contratos NETO con estado distinto de `'pagada'` —sin la firma legado de descontada— (sin abonos / con abonos / contratos) e INFO 29 las identifica (`id_comision@contrato:abonos`): con la 205 no admiten abonos nuevos ni aumentos; las que tienen abonos se conservan para revisión manual. INFO 30/31 cubren lo que 28/29 no pueden ver: contratos NETO con **2+ filas B2B, incluidas las `'pagada'`**; con 2+ `'pagada'` el contrato sale **[AMBIGUO]**, porque la firma legado no dice cuál fue la comisión descontada (la 205 y la app tratan toda `'pagada'` de un NETO como descontada). Se revisan a mano; nada se reclasifica. Ni una ni otra traen nombres, NIT ni importes. |
| 2 | Aplicar la 205 | — |
| 3 | `supabase/scripts/postcheck_205_comisiones_b2b.sql` (solo lectura) | Ninguna `FALLA`. La fila 8 compara TODA comisión existente con la fórmula del código viejo. La `INFO` 21 debe dar `0 / 0 / 0`. |
| 4 | Desplegar el código (Vercel Production) | Verificación humana del despliegue. |
| 5 | Prueba funcional en Producción con datos reales de un caso controlado | Crear una comisión por la pestaña, una reserva B2B convertida por un asesor `venta`. |

**La 205 va ANTES del código.** El código nuevo lee columnas y llama a
`registrar_comision_b2b_reserva` y `registrar_comision_b2b_manual`, que solo existen con
la 205. El código viejo funciona
con la 205 aplicada (secuencia probada: `test_205_secuencia_despliegue.sh`). Lo que el
código viejo nota durante el intervalo: operaciones ya no puede editar/borrar comisiones
(la RLS devuelve 0 filas), borrar una comisión con abonos falla en vez de perder los
abonos, y una NETO no admite abonos. El código viejo todavía crea la comisión del contrato
manual y la pestaña no se muestra a `venta`; eso cambia solo al desplegar el código nuevo
(las filas que cree el código viejo quedan en lectura legado, ver arriba).

## Reversión

### Antes de que exista ningún dato con la semántica nueva (INFO 21 = `0 / 0 / 0`)

1. **Revertir el código** (volver a desplegar el anterior). Basta en casi todos los casos:
   la 205 es compatible con el código viejo y deja las protecciones puestas.
2. Solo si el defecto está en la propia base: `supabase/scripts/rollback_205_comisiones_b2b_integridad.sql`.
   Es una **reversión acotada**: quita la función de reservar, los triggers y las policies
   de la 205, pero **conserva la FK en RESTRICT** (no vuelve a `ON DELETE CASCADE`): borrar
   una comisión con abonos —o `eliminar_contrato`— sigue fallando y ningún abono se pierde.
   Las columnas quedan (sin datos). Se puede volver a aplicar la 205 después.

### Después de crear datos nuevos (base explícita, "por valor" o NETO marcada)

**No hay reversión segura.** Con el código viejo:
- una base 0 explícita volvería a leerse sobre el PVP (sube el importe);
- una comisión "por valor" volvería a base × % redondeado (cambia el importe);
- una NETO nueva aparecería como saldo por pagar y admitiría otro pago.

Por eso el script de rollback **se niega** (`ROLLBACK 205 NO SEGURO …`) y no cambia nada
si encuentra cualquiera de esas filas. Lo que corresponde:

- **Contención:** mantener la 205. Sus triggers siguen protegiendo los abonos (no se
  borran ni cambia el total de una comisión abonada) y las NETO (no admiten abonos),
  con cualquier código.
- Si lo que falla es el alta de comisiones de reservas, se puede **apagar solo esa vía**:
  `revoke execute on function public.registrar_comision_b2b_reserva(text, bigint) from authenticated;`
  — las reservas B2B fallan y se revierten completas (nunca quedan sin comisión). Se
  reactiva con el `grant` equivalente.
- **Corrección hacia adelante:** hotfix del código o una migración posterior (siguiente
  número libre), nunca reescribir filas a mano.
- **No volver al código viejo** sin antes corregir hacia adelante: cambiaría importes
  mostrados y reabriría el doble pago de NETO.

## Pruebas (solo Docker local, nunca remoto)

| Script | Qué demuestra |
|---|---|
| `test_205_comisiones_b2b.sql` | 135 casos: lectura legado/nueva, valor al peso, abonos, NETO, permisos por rol y tenant (venta lee su agencia, control_vuelo nada), `eliminar_contrato` bloqueado sin perder abonos, contrato NETO (NN1–NN19: ninguna fila B2B admite abonos nuevos —API, superadmin, service-role— ni aumentos por UPDATE de `valor` o moviéndolos de comisión, mientras que corregir a la baja o la fecha y deshacer siguen permitidos, los abonos históricos se conservan, no se crea ni se mueve una segunda comisión B2B, la firma legado del código viejo sí entra, y la venta que usa la liquidación del asesor no se toca), NETO que no se borra suelta (API, administración, service-role) pero sí con el contrato entero (`eliminar_contrato`, `revertir_contrato_incompleto`), `registrar_comision_b2b_reserva` (roles, tenant, aliado, NETO, duplicados, descuadre, reversión; un contrato atascado en pendiente hace más de 5 minutos no recibe comisión y `venta` no puede reabrir la ventana) y `registrar_comision_b2b_manual` (venta solo su contrato B2B y una vez, colega/otro tenant/NETO/control_vuelo rechazados; enlazada al catálogo, el tipo de aliado es el del catálogo), y la corrección del asesor (base/%/valor exacto en su contrato; no aliado ni retención; no la de un colega; no con abonos ni NETO; no borra ni abona; también una comisión ANTERIOR a la 205 de su contrato, sin recálculo de nada más). |
| `test_205_carrera_abonos.sh` | 6 carreras de dos sesiones: abonar vs borrar/editar, dos registros simultáneos de la misma reserva, y el asesor corrigiendo mientras se abona. |
| `test_205_secuencia_despliegue.sh` | Código viejo + 201 → 205 → código viejo aún desplegado → código nuevo: cada fila anterior da el mismo importe que `calcComisionB2B` de origin/main; las nuevas con base 0 dan 0. Con `M205=<variante>` sirve de control negativo. |
| `test_205_preflight.sh` | Preflight sobre una base SIN 205 con contratos NETO sembrados (dos `'pagada'` con y sin abonos, `'pagada'`+`'pendiente'`, una sola fila, y un comisionable): valores exactos de INFO 28–31, ninguna INFO con nombres/NIT/importes, y **solo lectura** (misma huella md5 de `ventas`/`aliados_b2b`/`comision_b2b_pagos`, y corre igual con `default_transaction_read_only=on`). |
| `test_205_rollback.sh` | Preflight y postcheck; rollback acotado sin datos nuevos (FK sigue RESTRICT, abonos intactos, se reaplica); rollback **negado** con cada tipo de dato nuevo. |
