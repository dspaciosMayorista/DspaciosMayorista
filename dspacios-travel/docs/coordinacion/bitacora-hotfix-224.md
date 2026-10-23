# Bitacora hotfix 224 - cerrar la lectura de netos de `empaquetados` para roles sin acceso financiero

GO LOCAL del Coordinador suplente, 2026-10-21. Ejecutor unico. Sin SQL remoto, staging, commit, push, PR ni Preview.

## Tabla de ciclos

| Ciclo | Base y estado Git | Trabajo y archivos | Pruebas ejecutadas | Hallazgos | Gate |
|---|---|---|---|---|---|
| 1 | `origin/main` 2d5dff0e (SHA verificado tras `git fetch`). Worktree `.claude/worktrees/neto-empaquetados-224`, rama `codex/224-neto-empaquetados`. Sin commits, sin staging; 1 archivo modificado + 9 nuevos (ver 3). | Diagnostico -> migracion 224 (vista `empaquetados_basica` + policy sin `venta`), preflight/postcheck/rollback, bateria SQL por rol, runners `test_224_fases.sh`/`test_224_api.sh`, workflow, prueba TS, tipo de la vista. **`computo.ts` NO editado: se detiene y se pide ampliacion (Q2).** | TS (33 pruebas focales: 32 en verde, **1 en rojo A PROPOSITO**), `tsc --noEmit` 0 errores, ESLint limpio en lo tocado, `pnpm run build` (Turbopack) rc 0, suite `test:unit` 6402 pruebas (12 fallos ajenos y preexistentes). **SQL y API: no ejecutados (sin Docker); pendientes de CI.** | **Una sola lectura con sesion de `venta` (`computo.ts:258`) depende de la tabla base**: aplicar la migracion sin ese cambio rompe la reserva de vuelos de Sistema para `venta`. `control_vuelo` conserva la tabla base (edita el neto). Mismo neto expuesto en `bloqueos_vuelo.tarifa_neta`. | Pendiente (decide el Coordinador: Q1-Q8) |
| 2 | Misma base 2d5dff0e, mismo worktree, **sin commit ni staging**. | Despliegue A: 224 reescrita como aditiva (solo la vista), 225 nueva (cierre), `computo.ts:258` (1 linea), preflight/postcheck/rollback/test de ambas, 4 runners, workflow `test-224-225-neto-empaquetados.yml` (dos fases, rollbacks por separado), prueba TS ampliada, 2 fixtures de pruebas existentes. | TS `netoEmpaquetados224` 48/48 en verde (0 rojo, 0 todo); `tsc` 0 errores; ESLint limpio en lo tocado (1 error preexistente ajeno); `pnpm run build` rc 0; `test:unit` 6405/6417 (12 fallos ajenos y preexistentes); `git diff --check` rc 0; YAML parseado. **SQL y API: no ejecutados, pendientes de CI.** | Al cambiar `computo.ts` fallaron 3 pruebas existentes por sus fixtures (corregidas, Q9). El parseo YAML cazo un error de sintaxis del workflow. | Pendiente (Q9-Q12) |
| 3 | PR head `ef4229c1` (commit del dueno sobre 2d5dff0e); worktree con 3 archivos de prueba modificados, **sin commit ni staging**. Migraciones 224/225 y `computo.ts` NO tocados. | Correccion de la prueba: el bloque R inserta la fila 96010 y Z exigia el literal `base = '2'`. Z, W, B, V, C y R comparan ahora con el conteo REAL (`test_224_neto_empaquetados.sql`, `test_225_neto_empaquetados.sql`) + una prueba TS que prohibe esos literales. | `netoEmpaquetados224` 49/49 en verde; `sh -n` de los 4 runners; `tsc` 0; ESLint limpio; `git diff --check` rc 0. **SQL: no ejecutado, a confirmar por el CI del PR.** | Era un error de la prueba, no de la migracion (vista=3 base=3 es lo correcto en fase 1). | Pendiente |

---

## Ciclo 1

### 1. Diagnostico (escrito antes de tocar codigo)

**Base.** `git fetch origin main` y `git rev-parse origin/main` = `2d5dff0ecdb5ec7261b4f2056c834ef29c20d50d` (#50). Worktree creado desde ese SHA. `node_modules` por junction al del checkout principal (no se borra con `rm -rf`). Todo lo siguiente es lectura de ese arbol; nada se ejecuto contra una base.

**1.1 Policies y grants vigentes de `empaquetados` y tablas relacionadas** (migracion 156 salvo indicacion; ninguna migracion posterior las redefine: `grep` de `empaquetados` en 157..223 solo da comentarios, triggers de invalidacion 181/220 y la vista `ventas_vuelo_sistema`).

| Objeto | Policy / grant | Roles |
|---|---|---|
| `public.empaquetados` | `"empaquetados: lectura operativa"` FOR SELECT (156 `:645-647`) | superadmin, gerencia, administracion, operaciones, **venta**, **control_vuelo** |
| `public.empaquetados` | `"empaquetados: escritura control"` FOR ALL (156 `:650-653`) | superadmin, administracion, gerencia, operaciones, control_vuelo |
| `public.empaquetado_cambios` | `"...: lectura control"` SELECT (156 `:667`), `"...: escritura control"` INSERT (156 `:672`) | lectura: los 6 de arriba incl. **venta**; insercion: los 5 de escritura |
| `public.armado_empaquetados` | `"...: interno"` FOR ALL (156 `:656-659`) | superadmin, gerencia, administracion, operaciones |
| `public.ventas_vuelo_sistema` (vista) | `acceso_ventas_vuelo_sistema(tenant)`; excluye `venta` | sin columnas de costo (lista cerrada en 156) |
| `public.tarifario_resultado(_publicable)` | 182 (publicable) | solo `precio_pvp`, `base_comisionable`, `impuesto`; **no** guarda `tarifa_proveedor` |
| Grants | No hay `revoke select` ni `grant (columnas)` sobre `empaquetados`: rige el `grant` por defecto de Supabase al rol `authenticated` y la RLS decide. Los permisos por columna no sirven aqui (todos comparten `authenticated`), igual que en 144/146. | - |

**1.2 Que rol lee que columna de costo** (por la API, con su token; la app no se las muestra a `venta`):

| Columna de `empaquetados` | Naturaleza | superadmin / gerencia / administracion / operaciones | control_vuelo | **venta** | agencia / freelance / cliente_final / anon |
|---|---|---|---|---|---|
| `tarifa_proveedor` | **neto** (lo que se le paga al proveedor/sistema; base de la CxP) | lee | lee | **lee (fuga)** | 0 filas (la policy exige `mi_rol()`) |
| `fee_infante` | costo al proveedor (`reservar/actions.ts:246`) | lee | lee | **lee (fuga)** | 0 |
| `tarifa_para_empaquetar` | precio de reventa (con margen) | lee | lee | **lee** | 0 |
| `estado_pago`, `notas` | pago al proveedor / texto libre | lee | lee | **lee** | 0 |
| `empaquetado_cambios.detalle` | solo `record`/`estado_emision`/`estado_pago` (156 `:209-222`); `nota` es texto libre | lee | lee | lee | 0 |

Hallazgos adyacentes, **fuera de la reserva** de este hotfix (solo se reportan): `bloqueos_vuelo.tarifa_neta` ("lo que se le PAGA a la aerolinea por silla (costo)", migracion 071) tiene el mismo SELECT abierto a `venta` y `control_vuelo` (`005_rls_policies.sql:185-187`, sin cambios posteriores); y la auditoria 087 copia `antes/despues` de `empaquetados` (con `tarifa_proveedor`) en `auditoria`, que solo leen superadmin/gerencia (no es fuga).

**1.3 Quien necesita `tarifa_proveedor` legitimamente** (evidencia, para definir los roles financieros):
- `control_vuelo` **si**: `NuevoEmpaquetadoForm.tsx:116` y `[id]/EditarEmpaquetadoForm.tsx:126` muestran y editan "Tarifa proveedor/sistema (neto)"; `empaquetados/[id]/page.tsx:19` y `vuelos/page.tsx:102` leen `select("*")` con la sesion; su policy de escritura (156 `:650-653`) y `ESCRITURA.vuelos` (`lib/roles.ts`) lo incluyen; `LECTURA_MODULO.vuelos` lo incluye. Quitarle la lectura rompe el editor del inventario que opera. **El "si aplica" del encargo: no aplica a `control_vuelo`.** Queda como pregunta explicita (Q1).
- `venta` **no**: `LECTURA_MODULO.vuelos`/`paquetes`/`producto` excluyen `venta` (`lib/constants.ts`), `proxy.ts` lo bloquea por URL; ninguna pantalla de `venta` muestra netos de empaquetados.
- Roles con acceso financiero (evidencia: policies de 156 + `lib/roles.ts` `ESCRITURA.vuelos`/`ADMIN_ROLES`): superadmin, gerencia, administracion, operaciones, control_vuelo. Los externos (`agencia`, `freelance`, `cliente_final`) ya no leen la tabla.

**1.4 Codigo de la app que lee esas tablas** (`grep` de `from("empaquetados")`, `empaquetados(` y `empaquetado_cambios` en `app/`, `lib/`, `components/`, `proxy.ts`):

| Ancla | Cliente | Quien lo ejecuta | Columnas | Efecto del hotfix |
|---|---|---|---|---|
| `lib/reservar/computo.ts:258` | **sesion** (`computarReserva(sb,...)`, `sb = createClient()` en `reservar/actions.ts:193`, `:943`, `:1814` y `checkout/actions.ts:730`) | **venta** (y cualquier rol que reserve con origen Empaquetado) | `activo, compra_inicio, compra_fin` (sin costos) | **SE ROMPE para `venta`**: sin policy la fila no llega y `computarReserva` responde "El empaquetado seleccionado ya no existe" (`computo.ts:262`). Debe leer `empaquetados_basica`. **Archivo restringido por el encargo (computo.ts): SE DETIENE aqui, ver Q2.** |
| `app/(dashboard)/dashboard/paquetes/[id]/page.tsx:58`, `:99` | sesion | roles del modulo `paquetes` (sin `venta`) | sin costos (`tarifa_para_empaquetar` reventa) | Sin cambio (conservan acceso) |
| `app/(dashboard)/dashboard/paquetes/actions.ts:728` | sesion (embed por `armado_empaquetados`, solo internos) | internos | sin costos | Sin cambio |
| `app/(dashboard)/dashboard/vuelos/page.tsx:102`, `vuelos/historico/page.tsx:74`, `vuelos/empaquetados/[id]/page.tsx:19` | sesion, `select("*")` | modulo `vuelos` (sin `venta`) | todas, incl. `tarifa_proveedor` | Sin cambio: control_vuelo y los 4 internos conservan la lectura |
| `app/(dashboard)/dashboard/vuelos/empaquetados-actions.ts:71,130,211,271,297..334` | sesion | los 5 roles de escritura | escritura | Sin cambio |
| `lib/paquetes/destinosAereos67.ts:294`, `:436` | sesion en acciones del armado (internos) o **service-role** en `computo.ts`/cargadores | internos / servidor | `id, destino_id, ruta, record` | Sin cambio |
| `lib/reservar/empaquetadoOrigen.ts:121`, `computoReservaBernalo.ts:241`, `lib/tarifario/datos.ts:247`, `filtrosPostCarga.ts:91`, `datosBernalo.ts:222` | **service-role** (`admin`) | servidor | incl. `tarifa_proveedor` en Bernalo/empaquetadoOrigen | Sin cambio (la service-role salta la RLS) |
| `empaquetado_cambios` | sin lector en `app/`/`lib/` (solo la RPC `actualizar_control_empaquetado`, INVOKER) | control (5 roles) | `detalle`, `nota` | Sin cambio |

Conclusion del diagnostico: **una sola lectura con sesion de `venta` depende de la tabla base** (`computo.ts:258`); el resto lee con service-role o con roles que conservan el acceso. Se demostro que ese cambio toca `computo.ts`, uno de los archivos que el encargo manda NO editar sin ampliacion expresa.

Otros caminos revisados para el neto (sin lector abierto a `venta` salvo la tabla base): funciones `SECURITY DEFINER` que lean `tarifa_proveedor` (ninguna en `supabase/migrations`), vistas que la expongan (ninguna), RPC que la devuelvan (`actualizar_control_empaquetado` devuelve `void`), `tarifario_resumen`/`tarifario_resultado` (no la guardan), `ventas.costo_aereo` (cerrado por 144; `venta` no lee `ventas`).

### 2. Diseno

Patron 144/146: lo que RLS no puede (filtrar columnas) se resuelve quitando la tabla base al rol sin acceso financiero y dandole una vista sin las columnas de costo, que hace su propio control de rol.

- **Vista `public.empaquetados_basica`** (`security_barrier = true`, `security_invoker = false`, igual que `ventas_basica`/`tarifario_resultado_publicable`): 21 columnas explicitas (id, record, aerolinea, proveedor_id, destino_id, ruta, origen, vuelo_ida/regreso, fechas y horas, compra_inicio/fin, estado_emision, activo, created_at, updated_at). **Sin** `tarifa_proveedor` (neto), `fee_infante` (costo), `tarifa_para_empaquetar` (reventa con margen), `estado_pago` ni `notas` (texto libre). Lista explicita: una columna futura de `empaquetados` no aparece en la vista salvo que alguien la agregue. `where mi_rol() in` los mismos 6 roles de la policy de la 156: **nadie gana acceso nuevo**; `mi_rol()` devuelve NULL para usuario inactivo o ausente (140), asi que da 0 filas. No hay filtro de tenant porque `empaquetados` no tiene columna de tenant (catalogo global, como `bloqueos_vuelo`).
- **ACL de la vista:** `revoke all` a public, anon, authenticated y service_role; `grant select` solo a `authenticated`. El servidor con service-role lee la tabla base (salta la RLS) y no necesita la vista.
- **Tabla base:** se elimina `"empaquetados: lectura operativa"` (6 roles) y se crea `"empaquetados: lectura con costos"` (5 roles, sin `venta`). Quedan con tabla base superadmin, gerencia, administracion, operaciones y **control_vuelo**. Evidencia de roles: policy de escritura de la 156 (los mismos 5), `ESCRITURA.vuelos` en `lib/roles.ts` (ADMIN_ROLES + operaciones + control_vuelo), formularios Nuevo/Editar que muestran y editan el neto a `control_vuelo`. La prueba TS exige que esas tres fuentes coincidan.
- **Sin tocar:** `"empaquetados: escritura control"`, `empaquetado_cambios` (su `detalle` solo trae record/emision/pago; la prueba verifica que no contiene importes), `armado_empaquetados` (ya solo internos), `ventas_vuelo_sistema`, `tarifario_resultado(_publicable)` (no guardan el neto), la auditoria 087.
- **Rollback exacto:** vuelve a crear `"empaquetados: lectura operativa"` con los 6 roles y retira la vista y la policy nueva; `test_224_fases.sh` compara una huella md5 de las policies de las 3 tablas antes de la 224 y despues del rollback.
- **Lo que "debe seguir funcionando sin pantallas vacias":** (a) editor de vuelos, control de emision e historial de vuelos: sin cambio para los 5 roles; (b) reserva de Bloqueo/Sistema: solo `computo.ts:258` lee con sesion de `venta`, y debe pasar a la vista (Q2); (c) `venta` no abre `vuelos`/`paquetes`/`producto` (`LECTURA_MODULO` + `proxy.ts`), asi que ninguna pantalla suya se vacia.

### 3. Archivos (todo en el worktree; nada en staging)

| Archivo | Estado | Motivo |
|---|---|---|
| `dspacios-travel/supabase/migrations/20260601000224_neto_empaquetados_por_rol.sql` | nuevo | Vista + policy. Idempotente (`create or replace`, `drop policy if exists`). Valida prerrequisitos. |
| `dspacios-travel/supabase/scripts/preflight_224_neto_empaquetados.sql` | nuevo | Solo lectura; 10 conteos (policies actuales, quien nombra a `venta`, filas con costos, usuarios por rol, contratos con origen Empaquetado, funciones/vistas que mencionan el neto). Ningun nivel BLOQUEANTE. |
| `.../postcheck_224_neto_empaquetados.sql` | nuevo | Una fila consolidada: veredicto + 10 controles (vista sin costos y `security_barrier`, ACL, policy sin `venta`, escritura intacta, RLS activa, hermanas intactas, sin otro camino al neto). |
| `.../rollback_224_neto_empaquetados.sql` | nuevo | Restaura la policy anterior exacta; idempotente; sin condiciones de uso (no guarda estado). |
| `.../test_224_neto_empaquetados.sql` | nuevo | Bateria SQL con `set local role` y claims por rol: superadmin, gerencia, administracion, operaciones, control_vuelo, venta, venta inactivo, agencia, freelance, cliente_final y anon. Cinco bloques B/V/C/R/W + Z (conclusion). |
| `.../test_224_fases.sh` | nuevo | Runner focal: preflight, aplicar con datos, postcheck, bateria, idempotencia, rollback con huella exacta, reaplicar. |
| `.../test_224_api.sh` | nuevo | Runner focal por HTTP (PostgREST local, JWT con secreto aleatorio local): 26 comprobaciones (T, V, E, W) mas el arranque (A0, H1) sobre la tabla base y la vista. |
| `.github/workflows/test-224-neto-empaquetados.yml` | nuevo | Permisos `contents: read`, sin secretos, sin Supabase remoto, sin `pull_request_target`, acciones por SHA, `set +e` antes de cada pipeline con `tee`, esquema armado hasta la 223 real. |
| `dspacios-travel/pruebas/netoEmpaquetados224.test.ts` | nuevo | 33 pruebas TS: forma de la migracion, paridad de roles (156 / `lib/roles.ts`), tipo de la vista, **inventario de lectores de `empaquetados` en la app**, workflow y scripts. |
| `dspacios-travel/types/database.ts` | modificado (+13) | Solo la vista nueva `empaquetados_basica` (`Omit<>` de las 5 columnas) y el alias `EmpaquetadoBasico`. |
| `dspacios-travel/lib/reservar/computo.ts` | **NO editado** | Restringido por el encargo; ver Q2. |

No se toco `package.json`, ni migraciones existentes, ni `reservar/actions.ts`, `checkout`, `paquetes/actions.ts`. Archivos de la app que demuestran leer con sesion de `venta`: **1** (`computo.ts`), y es de la lista restringida: se detiene la edicion.

### 4. Pruebas reales (ejecutadas por el ejecutor, en esta maquina)

| Prueba | Resultado |
|---|---|
| `node --test ... pruebas/netoEmpaquetados224.test.ts` | 33 pruebas: **32 en verde, 1 en rojo A PROPOSITO** ("computo.ts lee la VISTA..."). Es una guarda de despliegue: sin cambio en `computo.ts`, la migracion dejaria a `venta` sin poder reservar Sistema. No esta marcada `todo` ni omitida: el CI queda en rojo hasta que Q2 se resuelva. |
| `tsc --noEmit -p tsconfig.json` | 0 errores (tras corregir un flag de regex ES2018 en la prueba). |
| ESLint sobre `pruebas/netoEmpaquetados224.test.ts` y `types/database.ts` | limpio. |
| `pnpm run build` (Next 16, Turbopack) | rc 0. Nota de entorno: con la junction a `node_modules` del checkout principal Turbopack falla ("Symlink node_modules points out of the filesystem root"), asi que se retiro la junction con `rmdir` (sin tocar el destino) y se hizo `pnpm install --frozen-lockfile` propio. El lockfile no cambio. |
| `pnpm run test:unit` (suite completa) | 6402 pruebas, 6389 en verde, 13 en rojo: 1 es la guarda de arriba y 12 son ajenas (`crmLeads.wiring`, `hotelModalOrdenSecciones`, `ocupacionBernaloUI3EWiring`, `personasConsulta.wiring`, `suitesPruebas`, `tarjetaCompletaBuscarAlojamiento`, `tarjetaHotelExpandible`). Comprobado: con `types/database.ts` restaurado al original esos mismos 7 archivos dan los mismos 12 fallos, asi que no los causa este hotfix. |
| `sh -n` de los dos runners, YAML del workflow parseado (js-yaml) | sintaxis valida; 2 jobs, `permissions: {contents: read}`. |

**No ejecutado:** ningun SQL (no hay Postgres ni Docker utilizable en esta maquina), ni la API por PostgREST, ni la prueba React. Los SQL de la migracion, preflight, postcheck, rollback y bateria se revisaron solo por lectura.

### 5. Pendiente de CI (GitHub Actions, workflow `test-224-neto-empaquetados`)

Todo lo siguiente es PLAN hasta que corra en Actions; no se declara verde:
1. Esquema 001-223 real y aplicacion de la 224 sobre datos existentes (F2).
2. Preflight (F1), postcheck consolidado `OK|10|0|10` (F3, F5.2, F7.2), idempotencia (F5), rollback con huella md5 identica (F6.2) y reaplicacion (F7).
3. Bateria SQL por rol (F4): condicion (1) ningun rol sin acceso financiero lee `tarifa_proveedor` por tabla, vista, join con `armado_empaquetados`, historial, RPC de control ni funciones; condicion (2) `venta` SI alcanza filas por la vista (seccion Z) y `control_vuelo` SI lee y edita la tabla base; regresion de editor (control_vuelo, operaciones, administracion), control de emision (RPC) y vigencia de reserva por la vista.
4. API: GET de la tabla base y de la vista con el JWT de cada rol (T1-T8, V1-V7, E1-E3, W1-W8).
5. Riesgos de los propios scripts que solo el CI puede mostrar: SQLSTATE exactos (`42703`, `42501`), el comportamiento de PostgREST con filas invisibles (`[]` vs error), el orden de las notas de psql en las marcas, y que el trigger diferido de la 220 acepte las fixtures (paquete y vuelo al mismo destino).
6. El job TS quedara rojo por la guarda de `computo.ts` hasta Q2.

### 6. Despliegue (como 148/149)

La 224 cierra un acceso; el codigo que la acompana abre otro camino. Si se aplica la migracion con el codigo actual, `computarReserva` (`computo.ts:258`) no encuentra la fila con la sesion de `venta` y responde "El empaquetado seleccionado ya no existe" para todo contrato con origen Empaquetado. Si se despliega el codigo nuevo sin la migracion, `empaquetados_basica` no existe y falla para todos los roles que reservan Sistema. Alcance del dano: la migracion primero afecta solo a `venta` (los internos conservan la tabla base y los B2B ya no la leian); el codigo primero afecta a todos. Dos formas, a decidir en Q2: (A) dos numeros, como 148/149: 224 solo agrega la vista (aditiva, sin cerrar nada), se despliega el codigo, y un 225 cierra la policy; (B) un numero: migracion e inmediatamente despliegue del cambio, con una ventana corta para `venta`. Rollback: desplegar antes el codigo anterior, porque retirar la vista rompe el codigo nuevo.

### 7. Preguntas explicitas (sin resolver por el ejecutor; decide el Coordinador)

- **Q1. control_vuelo.** El encargo dice "y control_vuelo, si aplica". La evidencia dice que no aplica: sus formularios muestran y editan el neto y su policy de escritura ya existe. Se dejo con la tabla base. Si se quiere quitarselo, hay que decidir tambien como edita el neto (otra pantalla o un RPC) y reservar `Nuevo/EditarEmpaquetadoForm.tsx`, `empaquetados/[id]/page.tsx` y `vuelos/page.tsx`.
- **Q2. Ampliacion de `computo.ts` (bloqueante).** Cambio propuesto, una linea en `lib/reservar/computo.ts:258`: `.from("empaquetados")` -> `.from("empaquetados_basica")` (el `select("activo, compra_inicio, compra_fin")` es compatible con la vista y con el tipo ya agregado). Con esa ampliacion la guarda roja pasa a verde. Preguntas conjuntas: (a) se autoriza el archivo; (b) despliegue A (224 aditiva + 225 de cierre) o B (un numero, ventana corta). Nota: si se elige A, se mueve la seccion B de la 224 a un 225 y se necesita ese segundo numero.
- **Q3. Mismo problema en `bloqueos_vuelo.tarifa_neta`.** El pago a la aerolinea por silla (migracion 071) es legible por `venta` y `control_vuelo` (policy de la 005, sin cambios). Se reporta; el encargo cubre solo `empaquetados`. Hotfix aparte con su propia vista, o se amplia este.
- **Q4. Columnas fuera de la vista.** Se dejaron fuera tambien `tarifa_para_empaquetar`, `estado_pago` y `notas` por prudencia (`venta` no usa ninguna). Confirmar; sumar columnas despues es aditivo. #63 agrega columnas a `empaquetados` (moneda): la vista tendria que incorporar las que `venta` necesite.
- **Q5. B2B (agencia/freelance).** Hoy ya no leen `empaquetados` (la policy exige uno de los 6 roles), asi que `computarReserva` con origen Empaquetado les responde "ya no existe". Es preexistente; la vista no les agrega acceso. Si deben reservar Sistema, es un cambio de alcance aparte.
- **Q6. `empaquetado_cambios`.** `venta` sigue leyendo su historial (policy intacta). Hoy solo trae record/emision/pago; la columna `nota` es texto libre y alguien podria escribir un importe. Se deja como esta; endurecerla seria otra decision.
- **Q7. CI rojo deliberado.** La guarda de `computo.ts` deja el job TS en rojo hasta Q2. Alternativa: marcarla `todo` (CI verde, advertencia visible). Se eligio el rojo porque es lo que impide fusionar la migracion sin su cambio de codigo.
- **Q8. Numero 224.** El Gate del suplente reservo la 224 para #63 y este encargo la reserva para el hotfix. Este archivo asume que el hotfix conserva el 224 y que #63 tomara el siguiente libre; si no, hay que renumerar (el nombre y el workflow dependen del numero).

Solo se trabajo en el worktree y en esta bitacora. Sin SQL remoto, staging, commit, push, PR ni Preview. No se leyo `.env*` ni `sitio-web/node_modules`. No se imprimio ningun secreto (los JWT de las pruebas se firman con un secreto aleatorio local del runner).

## Gate del Coordinador suplente, ciclo 1 (2026-10-21)

Diagnostico y diseno aceptados: vista `empaquetados_basica` sin netos, con los mismos 6 roles de la 156; ningun rol gana acceso. Resoluciones:
- **Q1:** se acepta. `control_vuelo` conserva la tabla base porque edita el neto como parte de su operacion.
- **Q2:** se **autoriza** `lib/reservar/computo.ts`, SOLO la linea 258 (`.from("empaquetados")` pasa a `.from("empaquetados_basica")`). Despliegue **A**, en dos numeros:
  - **224, aditiva:** crea la vista con sus grants; `venta` CONSERVA la policy de la tabla base.
  - **225, cierre:** quita a `venta` la lectura de la tabla base. Se aplica DESPUES de desplegar el codigo, con preflight, postcheck y rollback propios.
- **Renumeracion vigente:** 224 hotfix aditivo, **225 cierre del hotfix**, **226 tarifa de infante**, **227 #63**.
- **Q3:** NO se amplia este hotfix. `bloqueos_vuelo.tarifa_neta` sera un hotfix aparte, con su vista, despues de esta serie.
- **Q4:** se acepta dejar fuera tambien `tarifa_para_empaquetar`, `estado_pago` y `notas`. #63 agregara a la vista lo que `venta` necesite.
- **Q5:** es preexistente y no se toca aqui. Se registra como pregunta para el dueno (si el B2B debe reservar Sistema).
- **Q6:** se deja como esta.
- **Q7:** queda resuelto con Q2. La guarda debe pasar a verde con el cambio; nada de `todo`.
- **Q8:** la 224 es del hotfix, como se dijo arriba.

**GO LOCAL ciclo 2:** misma reserva, mas la linea de `computo.ts` y los archivos de la 225 (`20260601000225_neto_empaquetados_cierre.sql` y `{preflight,postcheck,rollback,test}_225_*`). Que el workflow pruebe las dos fases: la app nueva sobre la 224 sola, y la app nueva sobre 224 + 225. Al terminar, commit, push y PR Draft (los hace el dueno) para el CI.


---

## Ciclo 2 (GO LOCAL del gate del ciclo 1: despliegue A en dos numeros)

### 1. Diagnostico (cambios respecto del ciclo 1)

El diagnostico del ciclo 1 no cambia (roles, columnas de costo, lectores). Lo nuevo es la **secuencia**: como `venta` conserva la tabla base hasta que el codigo nuevo este desplegado, la unica sincronia obligatoria es "224 -> desplegar -> validar -> 225". Hallazgo del ciclo: al cambiar `computo.ts:258` fallaron 3 pruebas EXISTENTES (`salidaDinamicaFlujos62` x2 y `destinosAereosFlujos67` x1) porque su cliente falso de sesion solo traia la tabla `empaquetados`, no `empaquetados_basica`. No eran fallos de la app sino de fixtures; se corrigieron con la minima edicion (ver 3).

### 2. Diseno

- **224 (aditiva).** Solo `create or replace view public.empaquetados_basica` (misma definicion del ciclo 1: 21 columnas, `security_barrier`, 6 roles en el `where`) y sus grants (`revoke all` a public/anon/authenticated/service_role; `select` a `authenticated`). **No crea, borra ni cambia policies; no altera tablas.** `venta` conserva `"empaquetados: lectura operativa"`, asi que el codigo viejo y el nuevo funcionan con la 224 aplicada.
- **225 (cierre).** Se niega si la vista no existe (mensaje claro). Reemplaza `"empaquetados: lectura operativa"` (6 roles) por `"empaquetados: lectura con costos"` (superadmin, gerencia, administracion, operaciones, control_vuelo). No toca la vista, ni la policy de escritura, ni `empaquetado_cambios`/`armado_empaquetados`, ni datos.
- **Codigo.** `lib/reservar/computo.ts:258`, solo esa linea: `.from("empaquetados")` -> `.from("empaquetados_basica")` (el `select("activo, compra_inicio, compra_fin")` ya es compatible con la vista y el tipo). Es la unica lectura de `empaquetados` con sesion de `venta`.
- **Rollbacks por separado.** `rollback_225_neto_empaquetados_cierre.sql` restaura la policy de la 156 exacta y conserva la vista. `rollback_224_neto_empaquetados.sql` retira la vista y **se niega mientras la 225 siga aplicada** (para no dejar a `venta` sin lectura alguna). Desmontaje completo: 225 y luego 224.
- **Orden de despliegue (documentado en las cabeceras de ambas migraciones):** 1) correr la 224 · 2) desplegar el codigo · 3) validar con un usuario `venta` real reservando un vuelo de Sistema · 4) correr el preflight_225 y la 225 · 5) postcheck_225.

### 3. Archivos (worktree; nada en staging ni commit)

| Archivo | Estado | Motivo |
|---|---|---|
| `dspacios-travel/supabase/migrations/20260601000224_neto_empaquetados_por_rol.sql` | reescrito | Solo la vista y sus grants (aditiva). |
| `dspacios-travel/supabase/migrations/20260601000225_neto_empaquetados_cierre.sql` | nuevo | Cierre: policy de 5 roles; se niega sin la vista. |
| `dspacios-travel/lib/reservar/computo.ts` | modificado (1 linea, :258) | Autorizado por el gate (Q2). |
| `.../scripts/{preflight,postcheck,rollback}_224_neto_empaquetados.sql` | reescritos | Preflight 224: P4 pasa a INFO (la 224 no toca policies). Postcheck 224: 9 controles, incluido "la 224 NO quito acceso" (la policy de 6 roles sigue con `venta`). Rollback 224: retira la vista; aborta si la 225 sigue aplicada. |
| `.../scripts/{preflight,postcheck,rollback}_225_neto_empaquetados_cierre.sql` | nuevos | Preflight 225 (vista presente, policy aun con `venta`, recordatorio manual de validar el codigo; no bloquea). Postcheck 225 (una fila, 9 controles: policy de 6 roles eliminada, ninguna policy de lectura nombra a `venta`, la nueva nombra exactamente los 5 roles, escritura intacta, RLS, vista intacta y con `venta` en su where, ACL, hermanas, sin otros caminos al neto). Rollback 225 (policy 156 exacta; vista intacta). |
| `.../scripts/test_224_neto_empaquetados.sql`, `test_224_fases.sh`, `test_224_api.sh` | reescritos | Fase 1: `venta` lee la vista Y TAMBIEN la tabla base (afirmado a proposito, `T2`-`T4` y `B`/`Z` del SQL); la vista nunca trae costos; huella md5 de policies identica tras aplicar (aditiva) y tras el rollback. |
| `.../scripts/test_225_neto_empaquetados.sql`, `test_225_fases.sh`, `test_225_api.sh` | nuevos | Fase 2: 224 + 225. `venta` = 0 filas en la tabla base y SI alcanza la vista (seccion `Z`); ningun rol sin acceso financiero lee `tarifa_proveedor` por tabla, vista, join, historial, RPC ni funciones. Fases: `F0` la 225 se niega sin la vista; `F6` rollback 224 rechazado con la 225 aplicada, rollback 225 deja las policies exactamente como las dejo la 224, `F8` desmontaje completo deja las policies como antes de la 224. |
| `.github/workflows/test-224-225-neto-empaquetados.yml` | nuevo (reemplaza `test-224-neto-empaquetados.yml`, que se elimino) | Un workflow, dos fases secuenciales sobre la misma plantilla 001-223: fases+API de la 224 sola, fases+API de 224+225. `set +e` antes de cada uno de los 5 pipelines con `tee`. Mismas reglas de seguridad (solo lectura, sin secretos, sin `pull_request_target`, acciones por SHA). |
| `dspacios-travel/pruebas/netoEmpaquetados224.test.ts` | ampliado | 48 pruebas, **todas en verde**. La guarda de `computo.ts` ya no es roja ni `todo`: exige la vista, exactamente las 3 columnas y una unica lectura de empaquetados en el archivo. |
| `dspacios-travel/types/database.ts` | sin cambios nuevos | Vista `empaquetados_basica` del ciclo 1. |
| `dspacios-travel/pruebas/destinosAereos67Soporte.ts` (+2), `pruebas/salidaDinamicaFlujos62.test.ts` (+2/-1) | modificados (fixtures) | Consecuencia directa del cambio autorizado en `computo.ts`: el cliente falso de sesion ahora tambien trae `empaquetados_basica` con las mismas filas. Sin cambiar ninguna asercion. **Fuera de la reserva original: se informa para que el Coordinador lo ratifique (Q9).** |

No se tocaron `package.json`, migraciones existentes, `reservar/actions.ts`, `checkout`, `paquetes/actions.ts` ni `bloqueos_vuelo`.

### 4. Pruebas reales (ejecutadas por el ejecutor)

| Prueba | Resultado |
|---|---|
| `node --test ... pruebas/netoEmpaquetados224.test.ts` | **48 pruebas, 48 en verde**, 0 `todo`, 0 omitidas. |
| `pruebas/salidaDinamicaFlujos62`, `destinosAereosFlujos67`, `destinosAereos67`, `destinosAereos67Sql.wiring` + la nueva | 207 pruebas, 207 en verde (tras corregir los fixtures). |
| `tsc --noEmit -p tsconfig.json` | 0 errores. |
| ESLint sobre `computo.ts`, `types/database.ts`, `netoEmpaquetados224.test.ts`, `salidaDinamicaFlujos62.test.ts` | limpio. Sobre `destinosAereos67Soporte.ts` da 1 error `prefer-const` en la linea 81 (`orden`), **preexistente y ajeno** a mis 2 lineas (:313-315); no se corrigio para no ampliar el diff. |
| `pnpm run build` (Turbopack, `node_modules` propio) | rc 0, tras el cambio de `computo.ts`. |
| `pnpm run test:unit` (suite completa) | 6417 pruebas: 6405 en verde, 12 en rojo. Los 12 son los mismos del ciclo 1, ajenos y preexistentes (`crmLeads.wiring`, `hotelModalOrdenSecciones`, `ocupacionBernaloUI3EWiring`, `personasConsulta.wiring`, `suitesPruebas`, `tarjetaCompletaBuscarAlojamiento`, `tarjetaHotelExpandible`). Ninguno es de este hotfix. |
| `git diff --check` (con los archivos nuevos en intent-to-add, luego revertido) | rc 0; solo avisos de fin de linea LF->CRLF de `autocrlf`, iguales a los de los demas archivos del repo (el indice los guarda en LF). |
| `sh -n` de los 4 runners; YAML del workflow parseado con js-yaml | sintaxis de los runners valida. **El parseo del workflow nuevo encontro un error real** (un nombre de paso con `: ` sin comillas) que se corrigio; despues parsea bien: 2 jobs, 10 pasos en el job SQL, `permissions: {contents: read}`. |

**No ejecutado:** ningun SQL ni API (no hay Postgres/Docker utilizable en esta maquina). Migraciones, preflight, postcheck, rollbacks, baterias y runners solo revisados por lectura.

### 5. Pendiente de CI (workflow `test-224-225-neto-empaquetados`)

PLAN hasta que corra en Actions; no se declara verde:
1. **Fase 1:** esquema 001-223 real + 224; preflight; postcheck `OK|9|0|9`; bateria SQL (venta lee la vista y la tabla); idempotencia; rollback 224 con huella md5 identica; reaplicacion; API (venta conserva la tabla; los demas casos del ciclo 1).
2. **Fase 2:** la 225 se niega sin la vista; 224 aplicada de preparacion; preflight 225; aplicacion; postcheck `OK|9|0|9`; bateria SQL (venta = 0 filas en la tabla base, SI alcanza la vista; todos los caminos al neto cerrados); idempotencia; rollback 224 rechazado con la 225 aplicada; rollback 225 con huella igual a la de la 224; reaplicacion; desmontaje completo; API final.
3. Riesgos propios que solo el CI puede mostrar: SQLSTATE exactos, `[]` vs error de PostgREST con filas invisibles, la sincronia entre `UID_*`/ids de fixtures y los triggers diferidos de la 220, el nombre de las marcas `OK    ...` que cada step exige, y que `YAML` y los 5 pipelines con `tee` se comporten como se espera.
4. Nota: el job TS ya no queda en rojo por diseno; debe quedar verde.

### 6. Preguntas

- **Q9.** Ratificar la edicion minima de dos fixtures de pruebas existentes (`destinosAereos67Soporte.ts`, `salidaDinamicaFlujos62.test.ts`): eran consecuencia inevitable del cambio autorizado en `computo.ts` y no cambian ninguna asercion. Si se prefiere, se revierten y se dejan las 3 pruebas rojas hasta otro encargo.
- **Q10.** El error `prefer-const` de la linea 81 de `destinosAereos67Soporte.ts` es preexistente; se dejo sin tocar. ¿Se corrige en otro frente?
- **Q11.** Validacion manual previa a la 225 (la hace el dueno, no el CI): con la 224 y el codigo desplegados, reservar un vuelo de Sistema con un usuario `venta` real y comprobar que no dice "El empaquetado seleccionado ya no existe" (hoy funciona tambien por la tabla base, asi que esa prueba solo es concluyente tras la 225 en un entorno de Preview; hace falta decidir si se valida en Preview con la 225 aplicada antes de produccion).
- **Q12.** Diferido: `bloqueos_vuelo.tarifa_neta` (hotfix aparte); B2B y Sistema (pregunta al dueno); `empaquetado_cambios.nota`; las columnas que #63 (ahora 227) necesite en la vista.
- **Hecho de coordinacion:** la renumeracion vigente es 224 hotfix aditivo, 225 cierre, 226 tarifa de infante, 227 #63.

Solo se trabajo en el worktree y en esta bitacora. Sin SQL remoto, staging, commit, push, PR ni Preview. Pendiente de entrega: el Coordinador revisa y el dueno hace commit, push y abre el PR Draft.

## Gate del Coordinador suplente, ciclo 2 (2026-10-21)

**Verificado por el suplente:**
- 20 archivos, sin staging. En `computo.ts` cambia exactamente una linea (`empaquetados` -> `empaquetados_basica`).
- Repetidas `netoEmpaquetados224`, `salidaDinamicaFlujos62` y `destinosAereosFlujos67`: 152/152.
- `bash -n` de los runners 224/225 y `git diff --check` limpios.

**Resoluciones:**
- **Q9:** se ratifican las dos ediciones de fixtures, consecuencia directa del cambio autorizado y sin cambiar ninguna asercion.
- **Q10:** el `prefer-const` preexistente queda fuera y se corrige en otro frente.
- **Q11:** Preview comparte Produccion, asi que no hay un entorno aparte donde probar la 225 sola. Secuencia en Produccion:
  1. 224, despues merge y despliegue.
  2. preflight_225, 225 y postcheck_225.
  3. **De inmediato**, el dueno comprueba con un usuario `venta` real que el tarifario y una reserva de Sistema llegan a la confirmacion sin "El empaquetado seleccionado ya no existe". Para no crear datos artificiales, se detiene antes de confirmar si no hay un caso real.
  4. Si falla, se corre `rollback_225` en ese momento; restaura la policy de la 156 exacta.
- **Q12:** diferidos, como se registro.

**GO a commit, push y PR Draft** (los hace el dueno). NO GO a Ready hasta tener el workflow `test-224-225-neto-empaquetados` en verde.

## CI del PR (head `ef4229c1`), diagnostico del suplente (2026-10-21)

Todo verde salvo la Fase 1 SQL. El unico FALLO es "Z venta ...: vista=3 base=3". Es un **error de la prueba**:
- Z (`test_224_neto_empaquetados.sql:251-252`) exige `base = '2'` porque el fixture tiene 2 filas (96001, 96002).
- Pero el bloque R (`:193`) inserta antes la fila 96010 como `control_vuelo`, y esa fila sigue visible para `venta` cuando corre Z.
- El resultado (`venta` lee 3 por la vista y 3 por la tabla) es exactamente el comportamiento correcto de la fase 1.

Correccion pedida, solo en las pruebas:
- Z compara con el conteo real de filas activas segun un rol con acceso financiero, o que la vista y la base de `venta` coincidan, y no con un literal.
- O bien R corre aislado (savepoint/rollback), y se revisa el literal '2' de B (`:114`) con el mismo criterio.
- Revisar en `test_225_neto_empaquetados.sql` si hay conteos literales afectados por filas creadas en bloques anteriores.
- No tocar las migraciones.

---

## Ciclo 3 (correccion de la prueba tras el CI del PR, head ef4229c1)

**Hallazgo.** El unico FALLO de la Fase 1 SQL fue "Z venta alcanza filas por la vista (>0) y TAMBIEN por la tabla base ... vista=3 base=3". Causa: la bateria crea 2 filas (96001, 96002), pero el bloque R inserta antes la 96010 como control_vuelo, y Z comparaba la tabla base de venta con el literal `'2'`. Ver 3 y 3 es el comportamiento correcto de la fase 1 (venta conserva la tabla). **No era un defecto de la 224 ni de la 225.**

**Correccion (solo pruebas; migraciones y `computo.ts` intactos).** En `test_224_neto_empaquetados.sql` y `test_225_neto_empaquetados.sql` se revisaron TODOS los conteos literales que dependen de filas creadas por bloques previos:
- **Z:** `v_total` = conteo real de `empaquetados` medido como duenio (sin RLS); exige `vista de venta = v_total` (y, en 224, `base de venta = v_total`; en 225, `base de venta = '0'`). Con `v_total > 0` implicito por `v_a::int > 0`, la prueba sigue siendo concluyente.
- **B y V** (esperado de los roles con acceso) y **B "select *" de venta** (224): el esperado es `(select count(*)::text from public.empaquetados)`, ya no `'2'`. Los esperados `'0'` se conservan (son ausencia de acceso, no un conteo de fixtures).
- **C historial:** venta lee tantas filas de `empaquetado_cambios` como existen, no `'1'`.
- **R:** el historial de 96001 tras la RPC se compara con `v_n0 + 1` (conteo tomado justo antes), no con `= 2`; el listado de control_vuelo (`select *`) = total real, no `>= 3`.
- **W:** la vista de venta tras sus intentos de escritura = total real, no `'3'`.
- Se dejaron los conteos por id (96001, 96002, `= '1'` de insert/update/delete y de la vista por id) y `armado_empaquetados = 1`: no dependen de otros bloques.
- Prueba TS nueva en `netoEmpaquetados224.test.ts`: prohibe los literales `'2'`/`'3'`/`>= 3` en B/V/W/R y exige que Z mida el total real y que la vista de venta lo traiga completo. Tambien se actualizo la asercion de la fase 1 (`('vent', <conteo real>)`).

**Pruebas ejecutadas:** `netoEmpaquetados224` 49/49 en verde; `sh -n` de `test_224_fases.sh`, `test_224_api.sh`, `test_225_fases.sh`, `test_225_api.sh`; `tsc --noEmit` 0 errores; ESLint de la prueba limpio; `git diff --check` rc 0. **Pendiente de CI:** la bateria SQL corregida (Fase 1 y Fase 2) no se pudo ejecutar localmente; el resto de pasos ya estaban en verde en el PR.

**Diff:** 3 archivos, +39/-21: `pruebas/netoEmpaquetados224.test.ts`, `supabase/scripts/test_224_neto_empaquetados.sql`, `supabase/scripts/test_225_neto_empaquetados.sql`. Sin commit.

## Gate del Coordinador suplente, ciclo 3 (2026-10-21)

Revisado el diff real, 3 archivos de prueba; la 224, la 225 y `computo.ts` no se tocaron. Los conteos literales se sustituyen por el conteo real como dueno (Z, B, la matriz por rol, el historial con `v_n0 + 1`, R y W), en `test_224` y en `test_225`. Z ahora exige vista = base = total en la fase 1, y vista = total con base = 0 en la fase 2: sigue siendo concluyente. `bash -n` y `git diff --check` limpios; prueba TS repetida por el suplente. **GO a commit y push al mismo PR.**
