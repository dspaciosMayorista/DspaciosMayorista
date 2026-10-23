# Anexo #43-1 — Módulo contable: requerimientos directos del dueño

> Anexo de la tarea #43 (módulo contable independiente). **#43-1 es trabajo directo
> del dueño**, separado del staging DIAN de #43 (migración 204). Escrito el
> 2026-10-17 sobre `main` `8987932e`. El dueño autorizó ejecutar lo que no afecte
> trabajo en curso y reservar números de migración, dejándolo anotado aquí para el
> Coordinador (ver "Nota para el Coordinador").

## 1. Qué pidió el dueño

Pestañas y capacidades del módulo contable, sin orden de prioridad ("en el orden que
mejor convenga según el código"):

1. **Nómina:** empleados y su registro, liquidación de seguridad social, PILA, registro
   contable; después, nómina electrónica.
2. **Asientos** más simples de leer y de buscar.
3. **PUC.**
4. **Reglas contables:** documentos configurables (facturas manuales, documentos soporte,
   arriendo, compras…) con su regla: cuentas y naturaleza.
5. **Imports y conciliación bancaria general:** no solo pagos y abonos de contratos;
   también asientos y registros que no son de la operación.
6. **Reportes** con filtros, armables a gusto.
7. **Formatos de declaraciones** como borradores (no un reporte): retención en la fuente,
   IVA, renta, etc., con llenado automático según configuración.
8. **Planeación tributaria:** qué se puede hacer para mejorar impuestos, anticipar la renta
   y optimizar.
9. **Información exógena** más fácil, con las validaciones de la DIAN.
10. **Auditoría:** qué documentos/facturas están en la DIAN y cuáles no, qué falta, con
    checklist.
11. **Alertas** de vencimientos y presentaciones de impuestos y pagos.

### Respuestas del dueño (operación real, 2026-10-17)

- Mayorista y minorista son **empresas distintas**; los datos de cada una se cargan
  **desde la UI** (no se siembran en código ni en migraciones).
- Facturación electrónica: directa con la DIAN. Nómina electrónica: **DATAICO**.
  PILA: manual en **Aportes en Línea**. Declaraciones: se presentan **manualmente**.
- Periodicidades y fechas de vencimiento (por último dígito del NIT) **configurables
  desde la UI**, por año.

**Cambio de alcance:** `docs/futuro/modulo-contable-independiente.md` dejaba fuera
"declaraciones tributarias, nómina integral o presentación oficial". El dueño los
incluye ahora. El sistema prepara borradores y control; la presentación y el pago siguen
por los canales oficiales (MUISCA, Aportes en Línea, DATAICO), y la validación normativa
corresponde al contador/revisor responsable.

## 2. Estado de cada requerimiento

| # | Requerimiento | Estado en `main` | Entrega |
|---|---|---|---|
| 1 | Nómina | Solo costo mensual por empleado para punto de equilibrio (`lib/calc/nomina.ts`, `pe_empleados`) | 43-1g |
| 2 | Asientos legibles | Libro diario sin filtros que cargaba todo | **43-1b (hecha, local)** |
| 3 | PUC | Existe, por agencia, editable | Marcas para declaraciones/exógena en 43-1h/43-1i |
| 4 | Reglas contables | Cuentas fijas en código (`lib/contabilidad/asientos.ts`) | 43-1c |
| 5 | Conciliación general | Cruza extracto con abonos, pagos y movimientos; no con el libro | 43-1e |
| 6 | Reportes | Estados financieros calculados desde ventas/CxP/abonos, no desde el libro | **Balance de prueba en 43-1b**; 43-1d y 43-1j |
| 7 | Declaraciones (borrador) | Solo insumo del 350 en Retenciones | 43-1h |
| 8 | Planeación tributaria | No existe | 43-1k |
| 9 | Exógena | No existe; falta maestro de terceros (NIT, DV, dirección, municipio) | 43-1i (depende de #32) |
| 10 | Auditoría DIAN | Base en construcción: staging DIAN de #43 (204) | 43-1f (depende de #43) |
| 11 | Alertas | Correo diario de CxP/cobros/bloqueos; sin calendario tributario | **43-1a (hecha, local)** |

## 3. Entregas hechas (solo locales: sin staging, commit, PR ni SQL remoto)

### 43-1a — Calendario tributario y alertas · migración 215

- Rama `codex/43-1a-calendario-tributario`, worktree `.claude/worktrees/contable-43-1a`.
- **Migración 215** `calendario_tributario`: `obligacion_tributaria` (por agencia:
  nombre, periodicidad mensual/bimestral/cuatrimestral/semestral/anual, regla de dígitos
  0/1/2, días de aviso, si exige pago), `obligacion_vencimiento` (fecha por año, periodo y
  dígitos del NIT, `*` = todos) y `obligacion_cumplimiento` (presentada/pagada). FK
  compuestas por agencia, validación en base (periodo y dígitos según la obligación; no se
  cambia periodicidad ni regla si deja fechas inválidas; la agencia no cambia), RLS
  propia (ver = área contable y administración; configurar = superadmin o
  gerencia/administración/admin contable de su agencia; registrar = además el contador),
  `trg_auditoria`. Sin datos sembrados. No depende de la 204 (roles como texto).
- Pantalla **Contabilidad → Calendario tributario**: vencimientos (vencidas, falta pago,
  próximas, constancia de presentación/pago), obligaciones y cuadrícula de fechas por
  año y dígito, con el dígito del NIT de la agencia resaltado.
- **Correo diario:** sección "Obligaciones tributarias" con los días de aviso de cada
  obligación y el día de negocio de Bogotá; si la tabla no existe o una lectura falla, la
  sección no se envía (nunca una lista parcial).
- Pruebas: lógica 16, cableado 7, interacción 7, SQL local 24/0 sin la 204 y 30/0 con
  la 204; idempotencia y rollback verificados (el rollback falla cerrado si ya hay
  calendario cargado). Typecheck y lint focal limpios. Comprobación visual 375/1280 px.

### 43-1b — Libro diario legible y balance de prueba · sin migración

- Rama `codex/43-1b-libros-contables`, worktree `.claude/worktrees/contable-43-1b`.
- **Libro diario:** periodo por URL (mes en curso por defecto; atajos mes anterior y año
  a la fecha), búsqueda por número/descripción/referencia/detalle, cuenta, tercero (sin
  tildes), origen en lenguaje claro y "solo descuadrados"; resumen y exportación CSV para
  Excel; cada asiento como comprobante con su número, origen, enlace al contrato y aviso
  de descuadre. "Eliminar" solo en asientos manuales. Lectura paginada con error visible
  (antes: cabeceras sin paginar y errores de líneas descartados en silencio).
- **Balance de prueba** (nuevo): desde el libro, saldo inicial, débitos, créditos y saldo
  final por cuenta, acumulando subcuentas; nivel, búsqueda, cuadre y CSV.
- Pruebas: lógica 12, cableado 6, interacción 7. Typecheck y lint focal; comprobación
  visual.

## 4. Siguientes entregas propuestas (orden por código y dependencias)

| ID | Entrega | Depende de | Migración |
|---|---|---|---|
| 43-1c | **Reglas contables y tipos de documento:** factura manual, documento soporte, arriendo, compras…, cada uno con plantilla de asiento (cuentas, naturaleza, IVA, retenciones), y un comprobante guiado que la aplique | — | Sí (a reservar al iniciar) |
| 43-1d | Estados financieros desde el libro (balance general y resultados), comparables con los actuales | 43-1b | Probablemente no |
| 43-1e | Conciliación bancaria contra el libro: por cuenta bancaria, asientos manuales como candidatos, importación de archivo e informe de partidas conciliatorias | 43-1b | Posible |
| 43-1f | Auditoría DIAN con checklist por periodo (DIAN vs. sistema) | #43 (204) integrado | Posible |
| 43-1g | Nómina: ficha del empleado (reutiliza `pe_empleados`), periodos, novedades, liquidación, seguridad social, resumen/archivo para Aportes en Línea, causación contable; DATAICO después | 43-1c | Sí |
| 43-1h | Borradores de declaraciones (350, 300, ICA, 110) con renglones ligados a cuentas, configurables desde la UI | 43-1c, 43-1d | Sí |
| 43-1i | Exógena: formatos y validaciones tipo prevalidador | #32 integrado (terceros) | Sí |
| 43-1j | Reportes configurables (filtros, columnas, vistas guardadas, exportación) | 43-1d | Posible |
| 43-1k | Planeación tributaria (proyección de renta, escenarios) | 43-1d, 43-1h | Posible |

## 5. Nota para el Coordinador

- **Migración 215 reservada y usada por 43-1a** con autorización del dueño (2026-10-17).
  Registrarla en `WORKSTREAMS.md`. Se comprobó libre: `main` llega a la 213, la 214 es de
  #32 y ningún worktree local tiene 215+. **216 en adelante no quedan reservadas.**
- **Orden de despliegue 43-1a:** preflight 215 → aplicar 215 → postcheck 215 →
  merge/despliegue. El código desplegado sin la 215 muestra un aviso en la pantalla y el
  correo omite la sección. No usar `db push` ni `migration repair`.
- **43-1b** no tiene migración ni dependencias de despliegue.
- **Superficies compartidas tocadas** (integración en serie, sin conflictos de contenido
  esperados):
  - `types/database.ts` (43-1a): tres tablas insertadas después de `asiento_lineas`. #32
    también edita este archivo.
  - `app/(dashboard)/layout.tsx`: 43-1a y 43-1b agregan una entrada cada una al menú de
    Contabilidad, en posiciones distintas; #49 cambia solo el header móvil.
  - `lib/notificaciones.ts` (43-1a): función nueva; el bloque de bloqueos no cambia.
  - `lib/supabase/fetchAllPaginado.ts`: función nueva `fetchAllPaginadoConError`,
    idéntica en 43-1a y 43-1b; la original no cambia.
- **Pruebas React fuera de `package.json`:** `pruebas/calendarioTributario.react.ts` y
  `pruebas/librosContables.react.ts` (comando directo en su cabecera). Registrarlas en
  `test:react` al integrar.
- **Relación con #43:** la 215 compara roles contables como texto, así que funciona antes o
  después de la 204. Las pantallas siguen limitadas a superadmin/gerencia/administración
  hasta aplicar el parche de roles en la app (`docs/tecnico/propuesta-roles-contables.md`,
  que requiere reserva de `lib/constants.ts` y `lib/roles.ts`).
