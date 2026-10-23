# Hotfix DTM-0057 → DTM-0557

Renumera el contrato mayorista DTM-0057 a DTM-0557 y deja el próximo
consecutivo en DTM-0558. La migración 159 y `siguiente_numero_contrato_para_tenant()`
(formato de 4 dígitos) no se tocan.

**Estado: FINAL, pendiente de revisión.** `ESPERADOS` (en `02`, `03` y `04`)
quedó completado el 2026-10-02 con el preflight de producción (esquema anterior
a la 194, sin DETENER) y la autorización del dueño para `aliados_b2b` (1),
`contrato_servicios` (2) y los asientos de las CxP (4 + 4). Cada valor lleva su
origen: `C` confirmado, `I` 0 inferido — verificar contra la captura. Si algo no
coincide, `02`/`04` abortan sin cambios mostrando `vivo=N esperado=M`.

## Orden

| Paso | Archivo | Escribe |
|---|---|---|
| 1 | `01_preflight_lectura.sql` → exportar el resultado completo (CSV) | No |
| 2 | Revisar `ESPERADOS` (hecho; verificar los marcados `I`) | — |
| 3 | `02_hotfix_renumerar_dtm_0057_a_0557.sql`, en ventana de poco tráfico | Sí, una transacción |
| 4 | `03_postcheck_lectura.sql`: toda fila con `ok = false` es un problema | No |
| 5 | Reenviar al cliente el contrato (ahora DTM-0557) | — |
| Reversión | `04_rollback_dtm_0557_a_0057.sql` (solo si aún no se emitió DTM-0558) | Sí, una transacción |

En `ESPERADOS` cada valor es un número de filas o `'ausente'`. `'ausente'`
significa que la **columna no existe** en el esquema de producción; no es lo
mismo que 0. Antes de la migración 194, `movimientos_silla` no tiene
`numero_contrato` ni `contrato_manual`, así que esas dos claves van como
`'ausente'`. El motor aborta si lo declarado y lo real no coinciden en
cualquiera de los dos sentidos. El barrido general de referencias sigue
recorriendo todas las columnas de texto de esa tabla, existan o no las nuevas.

`02` y `04` se pueden reintentar: un fallo revierte todo (datos, DDL temporal y
secuencia), y si ya se aplicó solo avisa `YA APLICADO`.

## Se detiene (no se finaliza el SQL) si el preflight muestra `DETENER`

Factura o `contrato_facturacion`, vouchers, sillas, adjuntos/objetos en Storage,
`restriccion_overrides`, `movimientos_silla`, registro financiero pendiente,
secuencia distinta de "próximo 58", DTM-0557/0558 en cualquier columna, o FKs
que ya sean DEFERRABLE.

## Prueba local

```bash
# bases con las migraciones 1→191, 1→193 y 1→200 (local-desde-cero.sh con `hasta`)
bash pruebas/test_hotfix_dtm_0557.sh <contenedor> <base>

# si cada `docker exec` es lento: finalizar en el host y correr dentro
bash pruebas/test_hotfix_dtm_0557.sh --solo-finalizar <dir>
# (copiar la carpeta al contenedor, quitar CRLF) y dentro, como postgres:
FINALIZADOS=<dir> bash pruebas/test_hotfix_dtm_0557.sh local <base>
```

Cubre: borrador bloqueado, caso real (con el preflight mostrando `ausente` o 0
según el esquema), fallo a mitad + segundo y tercer intento, conexión cortada,
escritores concurrentes (nextval e inserts), guardas (incluidas columna ausente
≠ 0 en los dos sentidos y una mención en `movimientos_silla.motivo` que solo
detecta el barrido), variante con condiciones/control de emisión/cotización, y
rollback idéntico.
