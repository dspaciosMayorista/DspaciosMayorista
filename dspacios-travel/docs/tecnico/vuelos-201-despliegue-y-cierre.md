# Vuelos 201 — despliegue, cierre de firmas antiguas y salidas ante fallos

> Runbook operativo de la migración 201 (Vuelos). Para quien aplica la migración y
> despliega en Vercel, y para el dueño. Lo probado lo fue **solo en Docker local**
> (§10); nada de esto se ha ejecutado en Supabase ni en Producción, y no se han
> consultado los logs de Supabase ni de Vercel.

## 1. Qué hay que saber antes de empezar

- **Requisito:** la 201 va **después de la 199 y la 200** (ya integradas en `main` con
  los PR #347 y #348). Antes de aplicarla hay que confirmar que las dos están
  **aplicadas en Producción** (paso 0 del §2); este runbook no lo da por hecho.
- La 201 se aplica **antes** que el código nuevo y es compatible con el código
  anterior. Para eso conserva cuatro **firmas viejas** (llamadas sin la versión de la
  silla): `liberar_silla(bigint)`, `asignar_contrato_manual(bigint,text)`,
  `quitar_contrato_manual(bigint)` y la edición de pasajero sin `esperado.updated_at`.
  Esas firmas pueden pisar una silla que el operador ya no estaba viendo.
- El **cierre** de esas firmas vive dentro de la 201 (tabla `vuelos_cierre_firmas_201`)
  y no usa ninguna migración nueva. Números reservados: **202 (CRM), 203 (Tarifas) y
  204 (Contabilidad)**. Ninguno de ellos es de Vuelos.
- El cierre **nace abierto y sin fecha**: si el despliegue del código nuevo se retrasa,
  el código anterior sigue funcionando. Solo se cierra si alguien lo **activa** después
  del despliegue, y entonces deja una ventana. Al cumplirse, las firmas viejas se
  rechazan solas.
- **Una vez cerrado, no se reabre.** Un trigger impide volver atrás, reprogramar o
  borrar el estado; reaplicar la 201 no lo toca; el rollback total de la 201 se niega.

## 2. Decisiones del dueño (tomadas)

- **Activar el cierre después de verificar Producción**, con **ventana de 7 días**.
- **Hotfix fuera de banda:** **no está preautorizado**. Cada incidente requiere una
  **autorización separada del dueño** antes de aplicarlo (§7, paso 2). Sin esa
  autorización, la salida es solo la contención.
- **Sillas G** (152 en producción, con contrato manual y pasajero sin plazo): **sin
  backfill**. El plazo se pide al quitar el contrato manual.

## 3. Orden exacto

| # | Paso | Dónde / script | Comprobación para seguir | Se puede deshacer |
|---|---|---|---|---|
| 0 | Confirmar que la 199 y la 200 están aplicadas en Producción | Editor SQL: `postcheck_199_cierre_escritura_directa.sql`, `postcheck_200_historial_vuelos_inmutable.sql` | `RESUMEN` = `t` en ambos | Solo lectura |
| 1 | Preflight | `preflight_201_retenciones.sql` | Anotar conteos A–G (G = 152 esperado; no se corrige) | Solo lectura |
| 2 | Abrir el PR con la 201 y el código nuevo; revisión y build del PR en verde. **No fusionar todavía** | GitHub / Vercel (Preview del PR) | Build verde. El Preview del PR fallará en Vuelos hasta el paso 3: es esperado | — |
| 3 | Aplicar la 201 | Editor SQL: `20260601000201_pasajero_antes_contrato_vuelos.sql` | Sin error; la guarda la acepta | Sí: rollback total (§8) mientras el cierre esté abierto |
| 4 | Postchecks | `postcheck_201_flujo_vuelos.sql`, `postcheck_199_…`, `postcheck_200_…`, `postcheck_192_197_vuelos_fase_b.sql`, `postcheck_198_fecha_negocio.sql`, `postcheck_cierre_firmas_201.sql` | Todos en verde; el cierre aparece **ABIERTAS sin fecha** | — |
| 5 | Fusionar el PR y desplegar en Producción | GitHub / Vercel | Deployment de Production **Ready** y **Current** | Sí: volver a desplegar el código anterior (el cierre sigue abierto) |
| 6 | Verificación humana (§4) y prueba rápida en el dominio de Production | Vercel + la app | Commit, Ready/Current, dominio, pantalla nueva vista, Previews antiguos resueltos (§5) | — |
| 7 | Activar el cierre con ventana de **7 días** | `activar_cierre_firmas_201.sql` (llenando la verificación) | El script responde con `cierra_en` | Sí, **solo durante la ventana**: `cancelar_cierre_firmas_201.sql` |
| 8 | Vigilar la ventana | `postcheck_cierre_firmas_201.sql` (uso de firmas viejas en 24 h) | Uso 0, o identificado y resuelto | — |
| 9 | Se cumple la ventana: firmas viejas cerradas | automático | Postcheck muestra **CERRADAS** | **No**: irreversible |

## 4. Guarda operativa 1 — la base no prueba que Producción tenga el código nuevo

Producción y los **Previews** de Vercel usan la **misma base**. La base registra la primera
llamada con versión (`primer_uso_firma_nueva`), pero esa llamada **puede venir de un
Preview**. Por eso:

- Esa marca es solo una condición **necesaria**: sin ella la base no deja programar el
  cierre, pero **no se presenta como prueba de despliegue en Producción**.
- `activar_cierre_firmas_201.sql` **se niega** hasta que alguien llene, con lo visto en
  Vercel:
  1. **Commit** del deployment *Current* de *Production* (7 a 40 caracteres
     hexadecimales). Debe ser el del merge del PR de la 201 en `main` o uno posterior.
  2. **Estado Ready** de ese deployment.
  3. **Dominio de Production** (*Settings → Domains*). Se rechazan dominios con forma de
     Preview (`-git-`).
  4. **Pantalla nueva vista en ese dominio**: en Vuelos, la celda de contrato manual
     muestra "editar" y "quitar", que solo existen en el código nuevo.
  5. **Previews antiguos resueltos** (§5).
  6. **Quién** verificó.
- Lo llenado queda como constancia en `vuelos_cierre_firmas_201.nota`.

## 5. Guarda operativa 2 — Previews antiguos

Un Preview de una rama con código **anterior** a la 201 sigue llamando a las firmas viejas
contra la base de Producción.

- **Durante la ventana**, esas llamadas se admiten y quedan registradas; aparecen en
  `postcheck_cierre_firmas_201.sql` ("últimas 24 h").
- **Después del cierre**, esos Previews fallan al Borrar, asignar, quitar o editar. No se
  pierden datos, pero confunden a quien los use.

Antes de activar, cada Preview antiguo debe quedar **borrado**, **protegido**
(*Deployment Protection*) o **apuntando a otra base**. Si el postcheck sigue mostrando
uso de firmas viejas en las últimas 24 h, se busca quién usa código anterior **antes** de
activar, o se cancela si ya está programado.

## 6. Después del cierre: qué ya NO existe y qué sí

**Ya no existen** (no son opciones de rollback):

- Volver a desplegar el código **anterior** a la 201: sus llamadas se rechazan.
- El rollback total de la 201 (`rollback_201_pasajero_antes_contrato_vuelos.sql`): se
  niega para no reabrir las firmas cerradas.

**Sí existen:**

- **Rollback de código** a cualquier build **posterior** a la 201. Usan solo firmas con
  versión. Sirve para defectos del código de la aplicación.
- La **salida ante un defecto SQL** (§7).

## 7. Salida ante un defecto SQL después del cierre

No se usa ningún número reservado (202–204), no se crea una migración que salte números
reservados todavía sin aplicar, y no se reabre ninguna firma vieja.

1. **Contener (minutos, sin autorización extra).** `contener_funcion_201.sql`
   - Quita el permiso de ejecución de **una** función con versión, de una lista cerrada.
   - La acción falla cerrada en la app y deja de poder causar daño. No toca datos, ni
     las firmas viejas, ni el estado del cierre.
   - Se revierte con `levantar_contencion_201.sql`.
   - Si el defecto es del código de la app y no del SQL, basta con desplegar un build
     corregido (posterior a la 201).
2. **Corregir con hotfix fuera de banda: requiere AUTORIZACIÓN SEPARADA del dueño para
   ese incidente.** `plantilla_hotfix_201.sql`
   - DDL desde el editor SQL, sin número de migración.
   - Se copia la plantilla a `hotfix_201_<función>_<fecha>.sql`, se prueba en Docker sobre
     un clon con el cierre cumplido (midiendo el hash) y se versiona en el repo.
   - Guarda:
     - solo aplica si la función está **exactamente** como la dejó la 201, o ya
       corregida;
     - prohíbe tocar firmas viejas y piezas del cierre;
     - verifica en la misma transacción el cuerpo probado y el estado del cierre;
     - todo o nada.
   - **Revertir el hotfix sí es un rollback real**: el mismo esquema con el cuerpo
     literal de la 201.
   - Sin autorización, la función queda **contenida** hasta que pueda corregirse con una
     migración normal.
3. **Consolidar en una migración normal de Vuelos.**
   - Usa el **siguiente número libre en el orden del repositorio**, solo cuando los
     números anteriores, reservados para otros módulos (204 Contabilidad, y la 202/203
     si siguen pendientes), ya estén aplicados.
   - Nunca usa un número reservado ni crea una 205 antes de que exista la 204.
   - Repite el mismo cuerpo, con una guarda que acepta el hash de la 201 o el corregido:
     no-op en Producción, corrección en un entorno nuevo.
   - Hasta entonces, el hotfix permanece versionado en `supabase/scripts/`.

**Riesgo residual:**

- **Desfase entre el repo y Producción** hasta la consolidación. El hotfix vive
  versionado y el postcheck de la 201 delata la diferencia.
- **Funcionalidad apagada** mientras dure la contención, sobre todo si no hay
  autorización para el hotfix.
- **Defectos que no se contienen quitando un permiso** (trigger de retención, vista de
  cupos, funciones internas): se contiene el punto de entrada que las usa, o hace falta
  el hotfix, que a su vez requiere autorización.
- **Error humano en la verificación de Vercel**: lo amortigua la ventana de 7 días, en la
  que se puede cancelar.

## 8. Rollback total de la 201 y retenciones (solo antes del cierre)

- Solo aplica mientras el cierre está **abierto**. Si está programado, se cancela antes.
- Se niega mientras quede una retención (`en_plazo` sin contrato). No hay modo
  "conservar". El listado `preparar_rollback_201_retenciones.sql` solo propone vías
  reales:
  - contrato manual **solo con una venta real y su número**;
  - liberar cuando la persona desiste o el plazo venció.
- Una retención vigente sin decisión **bloquea** el rollback total.
- Deja la base exactamente como la 1–200 de `main` (199 y 200 incluidas).
- Si además hubiera que revertir la 199 o la 200, el orden es **201 → 200 → 199**
  (`rollback_200_…`, `rollback_199_…`), siempre **antes** de volver a un código anterior
  a la fase B.

| Opción | Cuándo | Riesgo |
|---|---|---|
| **A. Rollback solo de código** (recomendada) | Problema del código nuevo, con el cierre abierto | Vuelven las firmas sin versión mientras dure. El código anterior **sí** gestiona las retenciones. |
| **B. Rollback total con drenaje real** | La lógica de base de la 201 falla y no se puede corregir hacia adelante | Puede demorar días si hay retenciones sin decidir. Exportar antes el registro de uso. |
| **C. Corrección hacia adelante** | Falla localizada | Migración normal con el siguiente número libre (§7.3). |
| **D. Abandonar retenciones** (exportar y Borrar) | Solo con decisión explícita del dueño | Pérdida operativa. No hay script. |

## 9. Archivos

| Archivo | Para qué |
|---|---|
| `supabase/scripts/preflight_201_retenciones.sql` | Conteos A–G antes de aplicar (solo lectura) |
| `supabase/scripts/postcheck_201_flujo_vuelos.sql` | Postcheck de la 201 |
| `supabase/scripts/activar_cierre_firmas_201.sql` | Activar el cierre (exige verificación de Vercel) |
| `supabase/scripts/cancelar_cierre_firmas_201.sql` | Cancelar un cierre programado (solo en la ventana) |
| `supabase/scripts/postcheck_cierre_firmas_201.sql` | Estado efectivo y uso de firmas viejas |
| `supabase/scripts/contener_funcion_201.sql` / `levantar_contencion_201.sql` | Contener una función / levantar la contención |
| `supabase/scripts/plantilla_hotfix_201.sql` | Hotfix fuera de banda (copiar, no editar; requiere autorización) |
| `supabase/scripts/preparar_rollback_201_retenciones.sql` | Retenciones antes de un rollback total |
| `supabase/scripts/rollback_201_pasajero_antes_contrato_vuelos.sql` | Rollback total (cierre abierto y sin retenciones) |

## 10. Qué está probado y dónde

**Probado solo en Docker local** (Postgres de la imagen de Supabase, base 1–200 con la 199 y
la 200 idénticas a las de `main`; nunca en Supabase cloud):

- La 201 sobre 1–200: guarda, re-ejecución idempotente y catálogo idéntico tras reaplicar.
- Baterías SQL con la 201: flujo 16, reserva 56, retención 69, contrato manual 40, 194 144,
  liberaciones 21, bloqueos 54, confirmar venta 39, control de bloqueo 6 casos, **199: 287**
  (con dos ajustes de la batería para la regla de retención) y **200: 203**. La 199 y la 200
  también pasan sin la 201.
- Postchecks 192–197, 198, 199, 200, 201 y del cierre: verdes.
- Concurrencia real con dos sesiones (reserva, edición, retención y contrato manual).
- Cierre de firmas, cancelación, irreversibilidad y rollback total con drenaje (84).
- Cadena de rollback 201 → 200 → 199: la base vuelve a 1–198 y la batería de la 194 pasa.
- Activación verificada, contención y hotfix (43 en la última corrida completa).

**Probado fuera de Docker:** `npm run build` en un checkout limpio de `main` + la entrega,
con dependencias instaladas desde el lockfile; las pruebas unitarias, React y de cableado.

**No probado / no verificado:**

- Nada en Supabase cloud: llamadas reales por la API (PostgREST con JWT reales), RLS con
  usuarios reales ni el editor SQL de Supabase.
- Nada en Vercel: Previews, Production, rollback de despliegue.
- Los logs de Supabase y de Vercel **no se consultaron**.
- El rollback total y la salida post-cierre en una base con datos reales de Producción.
