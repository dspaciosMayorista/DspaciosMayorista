# Módulo contable independiente

> **Borrador de propuesta (solo documental).** Diseño previo a construcción: no representa funcionalidad implementada, no es un pendiente priorizado ni autoriza cambios de código, SQL, datos o `TASKS.md`. Pasa a la cola solo si el usuario lo decide expresamente.
>
> Revisado el 2026-09-30: rutas y líneas citadas en "Estado actual comprobado" verificadas contra el repositorio.

## Objetivo

Dar al contador y al revisor fiscal un espacio contable formal, separado de la navegación y operación administrativa, que consolide los hechos económicos producidos por cada tenant. Permitir reconstruir la contabilidad desde enero del año en curso y continuar con la operación mensual, manteniendo trazabilidad entre el documento fuente y su asiento.

La primera prioridad funcional es importar compras reportadas por la DIAN desde XML y desde el registro descargado en Excel, compararlas con la información existente y preparar su clasificación y contabilización.

## Alcance

- Módulo contable con navegación, permisos y flujo de trabajo propios para contador y revisor fiscal.
- Consumo controlado de datos que nacen en los procesos administrativos actuales, incluyendo ventas, pagos, cuentas por pagar, facturación y retenciones.
- Bandeja de compras DIAN para cargar XML y pegar/importar filas del Excel DIAN, revisar, comparar contra proveedores y documentos existentes, resolver coincidencias y duplicados, y dejar decisiones trazables.
- Preparación y revisión de comprobantes contables a partir de compras y de otros hechos administrativos, usando el PUC y reglas contables comunes.
- Reconstrucción histórica desde enero hasta la fecha de inicio de la iniciativa, con validación antes de contabilizar y controles de duplicidad/idempotencia.
- Operación posterior por periodos, con revisión, cierre, libros e informes acordes con los requerimientos que se definan para contador y revisor fiscal.
- Datos de cada tenant separados. El PUC y las reglas se administran como configuración global compartida, con excepciones que solo el usuario autorizado por el negocio pueda aprobar y mantener.

## Fuera de alcance

- Reemplazar la facturación electrónica actual o transmitir documentos a la DIAN.
- Cambiar los procesos administrativos que originan ventas, pagos, compras o cuentas por pagar.
- Compartir transacciones, documentos contables o saldos entre tenants.
- Automatizar declaraciones tributarias, nómina integral o presentación oficial de informes sin un alcance y validación normativa separados.
- Corregir de forma masiva la contabilidad existente sin conciliación y aprobación humana.
- Implementar código, SQL, migraciones o actualizar `TASKS.md` en esta etapa documental.

## Estado actual comprobado

- Ya existe contabilidad de partida doble: PUC, asientos, líneas, libros diario y auxiliar y posteos desde procesos del sistema. La hoja técnica lo describe en [`docs/tecnico/contabilidad.md`](../tecnico/contabilidad.md#L5) y detalla tablas y origen/referencia de asientos en [líneas 48–58](../tecnico/contabilidad.md#L48).
- El PUC actual está modelado por tenant y tiene unicidad por tenant/código, no como catálogo global común. Ver [`supabase/migrations/20260601000126_plan_cuentas_puc.sql`](../../supabase/migrations/20260601000126_plan_cuentas_puc.sql#L20) y su RLS en [líneas 37–42](../../supabase/migrations/20260601000126_plan_cuentas_puc.sql#L37).
- El posteo automático está implementado en [`lib/contabilidad/asientos.ts`](../../lib/contabilidad/asientos.ts#L107), con llamadas desde facturación, abonos, CxP, pagos a proveedores, retenciones y conciliaciones documentadas en [`docs/tecnico/contabilidad.md`](../tecnico/contabilidad.md#L99).
- Los asientos automáticos operan hacia adelante; el backfill histórico no está construido. La propia hoja técnica identifica esta limitación en [`docs/tecnico/contabilidad.md`](../tecnico/contabilidad.md#L141).
- Ya existen conciliaciones y retenciones, pero eso no equivale a una bandeja de compras DIAN con importación XML/Excel y comparación asistida. Los modelos actuales están resumidos en [`docs/tecnico/contabilidad.md`](../tecnico/contabilidad.md#L159).
- La navegación de contabilidad vive dentro del dashboard y actualmente permite acceso a superadmin, gerencia y administración; el menú agrupa facturación, movimientos, retenciones, conciliaciones, PUC, libros y estados financieros. Ver [`app/(dashboard)/layout.tsx`](../../app/(dashboard)/layout.tsx#L110).
- El sistema distingue tenants mediante contexto y RLS; el patrón de aislamiento está documentado en [`docs/tecnico/multitenant-auth-auditoria.md`](../tecnico/multitenant-auth-auditoria.md#L180). El modelo de autorización usa roles existentes y no cuenta todavía con roles específicos de contador/revisor fiscal, según [`lib/constants.ts`](../../lib/constants.ts#L16).

## Diseño propuesto

### Separación funcional

Crear un área contable independiente en navegación y experiencia de usuario, con flujos de trabajo para contador y revisor fiscal. Mantener los formularios administrativos como origen de las operaciones y conectar sus hechos económicos con el módulo contable mediante referencias estables, tenant, fecha, tercero, moneda y estado de contabilización. La separación es de responsabilidad y acceso; no debe producir dos registros maestros divergentes de una misma operación.

### Compras DIAN como primer flujo

1. El usuario selecciona el tenant y el periodo de trabajo e importa los XML de compras o pega/carga las filas descargadas en Excel.
2. El sistema normaliza datos de proveedor, identificación, número, fecha, moneda, bases, impuestos y total; conserva el archivo/fuente y los valores originales para auditoría.
3. La bandeja compara cada documento con proveedores y operaciones existentes, detecta coincidencias probables y duplicados, y permite clasificarlo como existente, nuevo, discrepante o pendiente de revisión.
4. El usuario resuelve coincidencias, asigna o confirma proveedor, cuenta PUC y demás dimensiones contables definidas; puede dejar documentos en revisión sin contabilizarlos.
5. Un revisor autorizado valida la selección y genera el comprobante con vínculo a la importación y documento fuente. La repetición de una carga no debe duplicar documentos ni asientos.

La importación debe aceptar que el Excel DIAN cambie columnas o formato: el diseño incluirá validación de encabezados, vista previa y reporte de filas no procesables, sin asumir que pegar datos equivale a contabilizarlos.

### Tenants, PUC y reglas

Los movimientos, terceros operativos, documentos, periodos y asientos permanecen aislados por tenant. PUC y reglas parten de una configuración común gestionada centralmente, con excepciones explícitas aprobadas por el usuario autorizado. Cada excepción tendrá ámbito, vigencia, motivo, autor y registro de cambios. La resolución de cuenta debe dejar visible si se usó la regla global o una excepción del tenant.

### Reconstrucción y operación corriente

La reconstrucción histórica se ejecutará por tenant y por periodos delimitados, primero en modo de comparación/previsualización. Se conciliarán documentos importados con los asientos existentes, se definirán políticas para operaciones ya contabilizadas y se generará evidencia de pendientes y diferencias antes de aprobar el lote. Los cierres mensuales impedirán cambios silenciosos; cualquier ajuste posterior deberá quedar como reversión o comprobante trazable según la política contable acordada.

## Fases

1. **Diseño y control de acceso:** confirmar perfiles de contador/revisor, segregación de funciones, periodos, monedas, documentos fuente y criterios contables; definir cómo se aprueban cambios al PUC/reglas globales y excepciones.
2. **Área independiente y lectura de fuentes:** crear la experiencia contable propia y consolidar vistas por tenant de operaciones existentes sin duplicar su captura administrativa.
3. **Bandeja DIAN:** importar XML y Excel, validar formato, normalizar, identificar duplicados/coincidencias y permitir resolución manual con historial.
4. **Clasificación y contabilización revisada:** aplicar PUC/reglas compartidas y excepciones; preparar comprobantes, aprobación, posteo idempotente y trazabilidad bidireccional.
5. **Reconstrucción histórica:** procesar lotes desde enero hasta la fecha acordada, con conciliación, simulación, aprobación por periodo y evidencia de excepciones.
6. **Cierre e informes:** formalizar revisión/cierre y validar libros e informes requeridos por contador y revisor fiscal antes de ampliar automatizaciones.

## Dependencias

- Definición del año y fecha de corte de la reconstrucción, formatos reales de XML/Excel DIAN y datos disponibles por tenant.
- Aprobación de políticas para duplicados, diferencias, proveedores nuevos, impuestos, moneda, documentos sin soporte y periodos cerrados.
- Modelo de permisos que identifique quién importa, clasifica, contabiliza, revisa, cierra y administra catálogo/reglas.
- Inventario de integridad de los datos históricos y reconciliación entre documentos administrativos y asientos ya posteados.
- Decisión técnica posterior sobre uso del PUC actual por tenant y camino de convergencia al catálogo global con excepciones, preservando códigos y referencias existentes.
- Validación contable y tributaria de los informes por profesionales responsables; la documentación de un flujo no constituye certificación normativa.

## Riesgos

- Duplicar gastos o asientos al reconstruir operaciones que ya generaron posteos automáticos.
- Mezclar tenants o aplicar al tenant equivocado una cuenta o regla compartida.
- Clasificar incorrectamente XML/filas DIAN por formatos cambiantes, NIT ambiguo, notas crédito o diferencias de totales.
- Cambiar el esquema conceptual del PUC existente puede afectar posteos y reportes; se requiere transición compatible y mapeo verificable.
- Los posteos automáticos actuales se describen como best-effort; una experiencia formal exige identificar y hacer visibles fallos que hoy podrían no bloquear el proceso fuente.
- Dar facultades de edición y aprobación a la misma persona reduce la revisión independiente que busca el usuario.
- La calidad y cobertura histórica pueden variar; no se debe presentar como reconstruido un periodo con documentos o saldos sin conciliar.

## Permisos

- **Administrador contable autorizado:** gestiona el PUC común y reglas globales, y aprueba excepciones por tenant; toda modificación queda auditada.
- **Contador:** importa documentos, resuelve coincidencias, clasifica, prepara comprobantes y consulta libros del tenant asignado.
- **Revisor fiscal:** consulta documentos, diferencias, asientos y evidencia; aprueba o devuelve lotes/cierres según la política que se defina. Separar revisión de preparación cuando la operación lo permita.
- **Administración/operación:** continúa creando los datos administrativos que alimentan contabilidad; no obtiene por defecto permisos de cierre ni de modificación del catálogo común.
- **Aislamiento:** toda lectura y escritura de información financiera se restringe al tenant asignado. PUC/reglas comunes se exponen como configuración compartida; las excepciones no dan acceso a transacciones de otro tenant.

## Criterios de aceptación

- Contador y revisor fiscal pueden entrar al área contable con permisos diferenciados y ver únicamente los tenants autorizados.
- Se puede importar XML y pegar/cargar el Excel DIAN con vista previa, validación, errores por fila y conservación de la fuente.
- Cada documento importado muestra coincidencias candidatas, diferencias y estado de resolución; el usuario puede seleccionar o vincular el registro existente sin crear un duplicado.
- Repetir la importación de un mismo documento no duplica el documento normalizado ni el asiento.
- Toda contabilización tiene tenant, periodo, usuario, fecha, fuente y vínculos al documento original; cada reversión o corrección preserva el rastro.
- Las reglas globales aplican a ambos tenants y una excepción aprobada modifica solo el ámbito definido, con motivo e historial.
- La reconstrucción desde enero se ejecuta en lotes revisables y entrega conciliación de conteos, montos, duplicados y pendientes antes de cada aprobación.
- El cierre de periodo respeta el control de permisos y hace visibles los cambios posteriores mediante ajustes trazables.
- Los libros e informes acordados con contador y revisor fiscal cuadran con los comprobantes aprobados y se pueden filtrar por tenant y periodo.
