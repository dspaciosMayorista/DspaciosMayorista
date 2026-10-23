# Relevo temporal del Coordinador

Este archivo es la bitacora del coordinador suplente cuando el dueno le encargue un turno. No sustituye `TASKS.md` (pendientes), `CURRENT_GOAL.md` (objetivo activo) ni `WORKSTREAMS.md` (reservas). El Coordinador titular lee aqui los hechos y decisiones pendientes al retomar.

## Punto de partida (2026-10-18)

- PR #363 de #32/214 fusionado en GitHub como `862edf42`. GitHub Actions sobre `d47eec0b` termino verde: 71 OK y 0 fallos en SQL, API/RLS, carreras y rollback.
- Actualizacion del dueno: confirma haber ejecutado preflight, migracion y postcheck 214 remotos en otro chat, todos OK. Esta bitacora registra su confirmacion; no tiene las salidas para una verificacion independiente. No pedir repetir la 214.
- El checkout local `main` estaba un commit detras de `origin/main` al abrir este relevo y tenia cambios sin guardar en `TASKS.md`, `CURRENT_GOAL.md` y `TASKS_ARCHIVE.md`. No hacer pull/reset sobre ellos por inferencia.
- El objetivo activo del tablero sigue siendo validar #35 en Produccion hasta que el dueno confirme otro estado. #40/#42 dependen de la base de identidad #32 segun `TASKS.md` y `WORKSTREAMS.md`.

## Limites del suplente

- Auditar y coordinar en lectura; no implementar codigo, SQL ni cambiar reservas por cuenta propia.
- Escribir solamente las entradas de relevo en este archivo. Proponer cambios para `TASKS.md`, `CURRENT_GOAL.md` y `WORKSTREAMS.md`; no editarlos mientras el Coordinador titular no los concilie.
- No hacer staging, commit, push, PR, merge, SQL remoto ni validar Produccion en nombre del dueno.
- No enviar mensajes a otros chats por inferencia. Entregar al dueno un prompt si necesita activar a otro chat.
- Si surge una decision de negocio, un conflicto de archivos/migraciones o un dato remoto sin verificar, marcarlo pendiente en vez de suponerlo.

## Registro de turnos

### Turno pendiente

- **Encargo del dueno:**
- **Fuentes y estado verificados (enlaces, SHA o rutas):**
- **Hechos nuevos y pruebas realmente ejecutadas:**
- **Hallazgos y riesgos, por prioridad:**
- **Decisiones propuestas; ninguna se considera aprobada sin el dueno:**
- **Bloqueos o autorizaciones necesarias:**
- **Siguiente paso concreto para el Coordinador titular:**

Agregar un encabezado `### Turno AAAA-MM-DD` por cada relevo. No borrar turnos previos; corregir errores con una nota fechada.

### Turno 2026-10-18 (suplente: auditoria posterior al merge de PR #363)

- **Encargo del dueno:** auditar el estado tras el merge de PR #363 y los gates siguientes de #32/214, #35, #40 y #42; separar hechos comprobados de reportes; identificar paralelismo, dependencias y decisiones priorizadas, sin rondas nuevas innecesarias. Solo lectura; unica escritura: esta entrada. Prompts para otros chats entregados al dueno (al final), no enviados.

- **Fuentes y estado verificados (enlaces, SHA o rutas):**
  - Leidos: `AGENTS.md` (raiz), `docs/agents/CODEX.md`, `CURRENT_GOAL.md` y `TASKS.md` locales sin commit (A.1 #32/#42/#39/#40; Carril 2 #35/#54/#50; Carril 4) y este archivo. `WORKSTREAMS.md` del worktree de coordinacion (modificado 2026-10-18 12:51) solo para reservas y registro de migraciones. Estado vigente de las bitacoras de Auditorias, Chat #1, Chat #2 y Chat #4, sin editarlas.
  - Git, solo lectura y sin fetch/pull: `git ls-remote origin` da `refs/heads/main` = `862edf42ad95` y `refs/pull/363/head` = `d47eec0b719e`. `862edf42` tiene un solo padre, `8987932e` (squash). Los arboles de `862edf42` y `d47eec0b` son identicos (`5f857238`): lo que probo CI es exactamente lo que quedo en `main`.
  - #363 trae 15 archivos, +4831/-0: workflow de raiz, `lib/personas/*`, migracion y scripts 214, pruebas/vectores, `docs/tecnico/personas-identidad.md` y `types/database.ts` +17/0. Ningun archivo de `app/`, `components/`, `proxy.ts` ni de otras `lib/` importa `lib/personas` ni llama `buscar_personas_documento`.
  - SHA256 de `20260601000214_personas_identidad.sql`: `7c38037898928eb5...`, igual en `main` y en `d47eec0b`.
  - API publica de GitHub, sin credenciales: run `39151910521` (`test-214-personas`, run 2, evento `pull_request`, head `d47eec0b`) `completed/success` de 17:57 a 17:59 UTC. Job "214 · SQL, API/RLS, carreras y rollback" en success, incluidos los pasos "Esquema 001-213" y "Migracion 214 real". El log exige autenticacion (HTTP 403): **no pude leer el conteo 71 OK / 0 fallos; queda como reportado**.
  - API de Deployments de GitHub: despliegue Vercel `Production` de `862edf42` creado 18:14:06 UTC (13:14 Bogota), estado `success` ("Deployment has completed"). El de `8987932e` (17-oct 23:49 UTC) tambien fue success. `862edf42` es el ultimo despliegue Production que GitHub registra. "Current" en el panel de Vercel no es verificable desde aqui: una promocion o un rollback manual no se reflejan en GitHub.
  - Checkout principal: `main` 1 commit detras de `origin/main`; cambios locales en `TASKS.md` y `CURRENT_GOAL.md`; sin rastrear `TASKS_ARCHIVE.md` y este archivo. #363 no toca ninguno de los cuatro, asi que un `git merge --ff-only origin/main` no los pisaria (comprobado por diff de nombres; NO ejecutado).

- **Hechos nuevos y pruebas realmente ejecutadas:** ninguna prueba, build, SQL ni llamada a Supabase. Solo lecturas de git, `sha256sum` y GET publicos a la API de GitHub.
  - Comprobado por lectura:
    1. La 214 es aditiva: crea `p214_priv`, `personas`, `persona_capturas`, `persona_observaciones` y la RPC `buscar_personas_documento` (EXECUTE a `authenticated`). Sus triggers viven solo en las tablas nuevas, no hay GRANT de tablas a `anon`/`authenticated` y no altera tablas existentes.
    2. Ningun flujo escribe en el registro: `upsert_persona`/`promover_persona` son solo de `service_role` y nadie las llama (doc tecnico 3.5: "hasta #42 la consulta devuelve 0"). Por eso el codigo desplegado no depende de que la 214 este aplicada, y `rollback_214` sigue siendo valido mientras no entre un escritor (#42).
    3. El workflow solo corre en `pull_request` a `main` con filtro de rutas de la 214, o a mano (`workflow_dispatch`). Un PR posterior que no toque esas rutas no lo vuelve a correr.
    4. #54 (worktree `editar-addons-carrito-54`, sin commit sobre `8987932e`): 8 archivos modificados y 3 pruebas nuevas, ninguno entre los 15 de #363. No toca `package.json` ni `types/database.ts`.
    5. El worktree `contable-43-1a` tiene cambios en `types/database.ts` y en migraciones: debe conciliar con las +17 lineas de #32 que ya estan en `main`.
  - Reportado, no verificado:
    - **214 en Produccion.** La memoria de la sesion ejecutora #32 (anotada a las 13:11 Bogota, un minuto antes del merge) dice que el dueno aplico la 214 desde `d47eec0b` por SQL Editor con rol `postgres`: preflight en una fila `INFO`, 0 bloqueantes y 0 revisar; postcheck en una fila OK 20/20. Ningun documento de coordinacion lo registra y no pude comprobarlo. **Sigue sin confirmar hasta que el dueno lo ratifique.** El mismo reporte deja pendiente confirmar que `p214_priv` no esta en Data API > Exposed schemas.
    - El conteo 71 OK / 0 fallos de CI (ver arriba).
    - #54: veredicto de Chat #4 "aprobado localmente para el gate de PR" sobre `8987932e` (su bitacora). No repeti sus pruebas.

- **Hallazgos y riesgos, por prioridad:**
  1. **ALTO: el repositorio de GitHub es PUBLICO** (`private: false`, `visibility: public`, comprobado sin credenciales). No encontre ninguna decision al respecto en TASKS, WORKSTREAMS, CURRENT_GOAL ni en las bitacoras. Quedan expuestos el codigo, las migraciones con la logica de RLS, los documentos de seguridad y todo el historial, incluidos los periodos en que hubo credenciales en el repo segun `CLAUDE.md` (seccion 12 y endurecimiento de agosto: llaves de Supabase del `.env` compartido y la contrasena quemada del login por codigo). No revise el historial buscando secretos. Esta fuera de los gates pedidos, pero es la decision mas urgente.
  2. **MEDIO: estado remoto de la 214 sin conciliar.** El tablero dice "no confirmado" o "sin aplicar": `CURRENT_GOAL.md`, `TASKS.md` (Panorama y #32), `WORKSTREAMS.md` (fila #32 y registro `:182`, "RESERVADA ... sin aplicar ni PR"). Un reporte de sesion dice "aplicada 20/20". No hay riesgo operativo inmediato (hecho 2). Pero #42 no debe montar codigo ni migracion encima de la 214 sin saber si existe en Produccion, y no se debe reaplicar ni correr rollback por inferencia.
  3. **MEDIO: la busqueda por documento de #40 no tiene datos que consultar.** Con #32 integrada, la dependencia tecnica esta cumplida, pero el registro esta vacio hasta que #42 escriba, o hasta que exista un adaptador historico (fuera del alcance de #32). Entregar #40 antes que #42 daria una busqueda que siempre responde 0. Hace falta decidir la secuencia (ver decisiones).
  4. **MEDIO: base de #54 desactualizada.** Esta aprobado sobre `8987932e` y `main` ya es `862edf42`. No hay cruce de archivos, pero la regla 3 de WORKSTREAMS y `CLAUDE.md` 12.bis exigen actualizar contra el `main` vigente y correr `npm run build` antes del PR. Basta con actualizar y repetir una vez las pruebas focales y el build; no hace falta otra auditoria completa.
  5. **BAJO: cobertura del CI focal.** El workflow no protege la 214 de regresiones que introduzcan migraciones futuras (#42, #39, 215). El gate de #42 deberia ampliar este workflow o crear uno focal propio; el piloto aprobado solo cubre la 214.
  6. **BAJO: documentos atrasados (para el titular).**
     - `WORKSTREAMS.md:35` sigue llamando "abiertas" las decisiones (a)-(c) y el interruptor de #39, que las decisiones 3-6 del mismo tablero y `TASKS.md` ya cierran. Chat #1 tambien lo marco.
     - `WORKSTREAMS.md`: la fila #32 y la fila 214 del registro (`:182`).
     - `TASKS.md:26` dice `main` local = `origin/main` = `8987932e`.
     - `CURRENT_GOAL.md` sigue pidiendo Vercel Production Ready para #35.
     - En `main`, `docs/tecnico/personas-identidad.md:3-8` dice "probada SOLO en local ... Nada ... aplicado en Produccion". Lo corrige un ejecutor en el proximo PR que toque #32/#42; no el suplente.

- **Que puede avanzar en paralelo (sin cruce de archivos comprobado, o sin codigo):**
  - El dueno, sin chats:
    - (a) ratificar la 214 en Produccion y que `p214_priv` esta fuera de Data API;
    - (b) confirmar en Vercel que `862edf42` es Production Current y hacer la validacion controlada de #35 (`862edf42` contiene #35 y #363 no toca sus superficies, asi que se valida el mismo codigo);
    - (c) decidir la visibilidad del repo;
    - (d) hacer el fast-forward del checkout principal cuando el titular lo autorice.
  - #54 (Chat #4 y su Opus): actualizar la base y pasar al gate de PR. No cruza con #363 ni con los archivos de servidor de #39/#40/#42.
  - #42 (Auditorias): cerrar en solo lectura el contrato de escritura sobre la 214 que ya esta en `main`, en cuanto el dueno decida sus dos puntos pendientes. El codigo y la migracion siguen esperando: 214 ratificada, reserva y secuencia con #39 en `reservar/actions.ts` y `manual-actions.ts`.
  - #39: Chat #1 ya elevo el Gate 1; la reserva local la decide el titular. No depende de la 214.
  - #50 (Chat #2): sigue en auditoria/diseno, sin cambios.
  - 43-1a: ya puede conciliar `types/database.ts` con #32 (su espera declarada se cumplio).
  - En serie obligatoria: `reservar/actions.ts` lo comparten #39 (vigencia en `2736-2761` y otras funciones), #40 (la misma accion de vigencia) y #42 (otras funciones). El codigo de los tres va en serie o con division explicita de funciones en la reserva.

- **Decisiones propuestas; ninguna se considera aprobada sin el dueno** (en orden de prioridad):
  1. **Visibilidad del repo.** Confirmar si es intencional. Si no lo es: volverlo privado y tratar como expuesto todo lo que haya estado alguna vez en el historial (la rotacion ya esta pedida en `CLAUDE.md` 12). Con repo privado, Actions descuenta minutos del plan; la corrida 214 duro unos 2 minutos. Si es intencional, que el titular lo registre como decision.
  2. **Ratificar la 214.** El dueno aporta las dos filas `resultado` (preflight y postcheck) y la captura de Exposed schemas; con eso el titular marca la 214 como aplicada en el registro. Si no se aplico: seguir preflight -> 214 -> postcheck sin urgencia, porque no hay consumidor.
  3. **Cerrar #32.** Tras el punto 2, cerrar el nucleo (214 + consulta). Mover la casilla "documento primero en listas y formularios" a #40/#42, y la medicion de duplicados historicos al plan de reconciliacion de #42. Asi #32 no queda abierto sin trabajo propio.
  4. **Dos decisiones de #42, pendientes desde el 12-oct.** Que quitar un pasajero desactive solo su vinculo y conserve la persona y su historial, y que un titular que viaja sea una sola persona con dos roles. Hoy son recomendaciones de Auditorias, no reglas.
  5. **Secuencia de #40.**
     - Busqueda: se recomienda que espere a que #42 escriba en el registro. La alternativa, un adaptador historico propio para #40, seria un frente nuevo con migracion, preflight y su propio riesgo de fuentes viejas.
     - Vencimiento: decidir quien elige la fecha (solo el asesor o tambien B2C) y si vencer bloquea la conversion o solo avisa. Su codigo va despues de #39 o dentro de su reserva, porque comparten `actualizarVigenciaCotizacion`.
  6. **Numeros SQL.** La 215 sigue con 43-1a. Si el titular aprueba primero la reserva de #39, asignarle 216 y 217; #42 toma el siguiente libre cuando abra su gate. No asignar por inferencia.

- **Bloqueos o autorizaciones necesarias:**
  - Del dueno: ratificar la 214 y Exposed schemas; decidir la visibilidad del repo; las decisiones de #42 y #40.
  - Del titular: gate de PR de #54 y reserva de #39.
  - El suplente no hizo fetch, pull, staging, commit, push, SQL ni llamadas a Supabase, y no contacto a ningun chat.

- **Siguiente paso concreto para el Coordinador titular:**
  1. Leer este turno y pedir al dueno las decisiones 1 y 2.
  2. Conciliar `TASKS.md`, `CURRENT_GOAL.md` y `WORKSTREAMS.md` con #363 fusionado y el despliegue de `862edf42`. Registrar el estado de la 214 solo cuando este ratificado y limpiar las entradas atrasadas del hallazgo 6.
  3. Autorizar el fast-forward del checkout principal (sin cruce comprobado).
  4. Dar el gate de PR a #54 con P1.
  5. Resolver la reserva de #39 (Gate 1 elevado por Chat #1).
  6. Activar a Auditorias con P2 cuando el dueno decida los dos puntos de #42, y a Chat #1 con P3 cuando decida la secuencia de #40.

- **Prompts preparados para el dueno (no enviados; completar los corchetes antes de usarlos):**
  - **P1, Chat #4 (#54):** "`main` avanzo a `862edf42` (PR #363, #32/214). El suplente comprobo que #363 no toca ninguno de los 11 archivos de #54, ni `package.json` ni `types/database.ts`. Pide a tu unico Opus de #54, en `.claude/worktrees/editar-addons-carrito-54`: confirmar `git status` y que `origin/main` = `862edf42`; actualizar la base por fast-forward (`git merge --ff-only origin/main`, como se hizo con #32) sin descartar ni mover sus cambios, y si no es fast-forward o hay conflicto, detenerse y reportar; repetir una vez solo las pruebas focales de #54, `tsc` y `npm run build`; reportar base, `git status`, comandos y resultados. Tu verificas que el diff de #54 no cambio y actualizas solo tu bitacora con el veredicto. Sin staging, commit, push, PR ni SQL; el gate de PR lo da el Coordinador titular."
  - **P2, Auditorias (#42):** "PR #363 esta fusionado en `main` `862edf42`. 214 en Produccion: [ratificada por el dueno: preflight ___ / postcheck ___ | aun sin ratificar]. Decisiones del dueno para #42: quitar pasajero = [___]; titular que viaja = [___]. En solo lectura sobre `862edf42`, cierra el contrato de escritura de #42 encima de la 214: fuente `cotizacion` y su clave de origen; ID estable de pasajero por flujo (Reservar, carrito/checkout, manual/dinamica); vinculo idempotente cotizacion-persona-rol; correccion, concurrencia, reintento y conversion; quien llama a `upsert_persona`/`promover_persona` y con que contexto; visibilidad por rol y tenant sin abrir cotizaciones completas. Entrega: lista exacta de rutas y funciones con su cruce con #39 en `reservar/actions.ts` y `manual-actions.ts`; si hace falta migracion (sin elegir numero); plan de pruebas en PostgreSQL local y como ampliar el CI focal de la 214; y el prompt para un unico ejecutor. Sin backfill, codigo ni SQL remoto. Edita solo tu bitacora."
  - **P3, Chat #1 (#40):** "Con #32 en `main` `862edf42`, `buscar_personas_documento` ya existe, pero el registro de personas esta vacio hasta que #42 escriba (doc tecnico 3.5). Decision del dueno sobre la busqueda: [esperar a #42 | adaptador historico propio]. Vencimiento: quien elige la fecha = [___]; efecto al vencer = [___]. En solo lectura, actualiza el plan de #40 en dos entregas: (1) busqueda, con su dependencia real; (2) vencimiento, dentro de la reserva de #39 o justo despues, porque comparten `actualizarVigenciaCotizacion` (`reservar/actions.ts:2736-2761`). Entrega rutas, pruebas y riesgos; no abras otra ronda si no cambia nada. Sin codigo, reservas ni SQL. Edita solo tu bitacora."

#### Nota 2026-10-18 (mismo suplente): resultados de Chat #1, Chat #2 y Chat #4

- **Encargo:** el dueno pego los resultados vigentes de Chat #1 (#39), Chat #2 (#50) y Chat #4 (#54), e informo que el chat de Auditorias (el de la 214) esta cerrado. Pidio decidir como avanzar y con que. Los prompts P1-P3 de arriba NO se enviaron: PA y PB de esta nota sustituyen a P1 y P2, y P3 (#40) queda en espera.

- **Verificado por el suplente** (lectura de `origin/main` `862edf42`; #363 no toca estos archivos):
  - **#39 (Chat #1):**
    - `actualizarVigenciaCotizacion` (`reservar/actions.ts:2736`) solo filtra `estado='abierta'` y tenant. `contextoCotizacion` (`lib/cotizacion/acceso.ts:20`) solo exige perfil activo. Ninguna de las dos mira el rol ni `creado_por_id`.
    - La policy "cotizaciones: actualizar" de la 154 (`:106-114`) deja a los cinco roles internos, `venta` incluido, actualizar cualquier cotizacion de su tenant.
    - La creacion manual solo guarda `creado_por` con el correo (`manual-actions.ts:219`), y la 211 prohibe a los roles de API escribir `creado_por_id` (`:400-404`, `:432-438`).
    - Consecuencia que el informe no destaca: **hoy TODAS las manuales simples tienen `creado_por_id` nulo, no solo las antiguas**, y seguiran asi hasta que #39 lo estampe con una funcion definer.
  - **#50 (Chat #2):**
    - 198: `:226` usa `nullif(...,'')`. En `:239-246` congela y escribe `monto_exigido_total_cop` en el MISMO UPDATE que `condicion_pago_congelada_en`, asi que el trigger `BEFORE UPDATE OF condicion_pago_congelada_en` de G2 puede anularla en esa misma sentencia. `:561-564` rechaza la conversion sin congelado antes del `nextval` de `:592`.
    - 164: CHECK original en `:215-216`, ampliado en `:1431-1433`; `trm_autoritativa numeric(15,4)` en `:272`.
    - `convertir_cotizacion_a_contrato` solo la ejecuta `service_role` (164 `:1365-1366`).
    - La app envia `p_exigido_total_moneda`, no el COP (`pagos-actions.ts:207-218`). Solo la ficha lee `monto_exigido_total_cop` (`cotizaciones/[id]/page.tsx:100, 299`).
  - **Hallazgo lateral de Chat #2, confirmado:** `siguiente_numero_contrato_para_tenant` (159 `:167`, unica definicion) arma `'DTM-' || lpad(nextval(...)::text, 4, '0')`. `lpad` recorta por la derecha: al llegar a 10000 devolveria `DTM-1000`, que ya existe, y desde ahi fallaria la creacion de contratos de mayorista. La serie va hoy por DTM-05xx: urgencia baja, impacto alto cuando ocurra.
  - **#54 (Chat #4):**
    - El worktree coincide con lo reportado: 6 archivos de producto y 2 pruebas modificados, mas 3 pruebas nuevas.
    - La bitacora de Chat #4 registra build de Next/Turbopack con salida 0 en la ronda 2, y por hashes el producto no cambio desde entonces. Falta repetir el build sobre `862edf42`.
    - Los 7 fallos atribuidos a la base (`hotelModalOrdenSecciones`, `ocupacionBernaloUI3EWiring`, `tarjetaCompletaBuscarAlojamiento`, `tarjetaHotelExpandible`) son reportados; no los corri. No figuran en `TASKS.md`.
  - **No verificado:** ninguna prueba de los tres informes (15/15, 103/103, 34/34, 25/25 y similares), ni nada que solo esta propuesto como prueba local futura.

- **Hallazgos y riesgos nuevos, por prioridad:**
  1. **MEDIO (#39): la guarda de autoria en la renovacion cambia un comportamiento vigente sin decision expresa.** La decision 3 del dueno se refiere a EDITAR servicios. Si se aplica tambien a renovar vigencia, como todas las manuales actuales tienen `creado_por_id` nulo, `venta` dejaria de poder renovar cualquier manual abierta hoy, incluidas las suyas. No hace falta por seguridad: renovar no habilita la edicion, porque el RPC de edicion vuelve a exigir C1 y C2 con la fila bloqueada. Ademas mete a #39 en la misma funcion que #40.
  2. **MEDIO (#39 <-> #50): hueco compartido y triggers sobre la misma tabla.** Forjar el primer congelado con un PATCH directo, sin pago, es el bloqueo (2) de #39, y #50 depende de que se cierre (en USD la TRM se puede forjar). Los dos agregan triggers sobre `cotizaciones`, que ya tiene los de la 154 y la 211. Hay que fijar quien cierra el hueco (propuesta: la migracion B de #39), integrar #50 despues de #39 y probar los triggers juntos en PostgreSQL local.
  3. **MEDIO (#39): en la reserva, verificar que #39 estampa `creado_por_id` al crear manuales** (con una funcion definer). Sin eso, `venta` no podria editar ninguna manual nueva.
  4. **BAJO, latente: truncamiento DTM de la 159.** Proponer un ID nuevo de hotfix, independiente de #50.
  5. **BAJO: 7 pruebas de la base desactualizadas tras #52.** Proponer un ID nuevo de limpieza, independiente de #54.
  6. **#50 sigue lejos del codigo.** Ademas de G1/G2 siguen abiertas D2/BNC, retencion, documento NETO, rol `venta`, margen 6%, modalidad obligatoria y paridad PVP de aliado/asesor. Decidir solo G1/G2 no desbloquea nada.

- **Decisiones propuestas; ninguna se considera aprobada sin el dueno:**
  1. **#39, renovacion.** Recomendado: dejar `actualizarVigenciaCotizacion` como esta en #39, sin guarda de autoria ni regla en el trigger, y decidir "quien renueva" dentro de #40-vencimiento, donde ya esta abierta la pregunta "quien elige la fecha". Reduce el alcance de #39, quita el cruce con #40 y no le retira capacidad a `venta`. Alternativa: aplicar la guarda de Chat #1, despues de que el dueno corra esta consulta de conteo, de solo lectura: `select tenant, count(*) from cotizaciones where tipo='manual' and estado='abierta' and creado_por_id is null group by 1;`.
  2. **#39, reserva LOCAL.** Chat #1 considera suficiente el Gate 1 y el suplente no ve bloqueos nuevos. El titular reserva un unico ejecutor, worktree, archivos y dos numeros SQL (propuesta: 216 y 217, si #39 se reserva antes que #42 y #50), con las condiciones de los hallazgos 2 y 3.
  3. **#42.** El dueno decide las dos recomendaciones: al quitar un pasajero se desactiva solo su vinculo, y un titular que viaja es una sola persona con dos roles. Despues, un chat Auditorias nuevo cierra el contrato con PB.
  4. **#50.** Chat #2 consolida TODAS las decisiones abiertas, G1/G2 incluida, en una sola hoja con opciones y recomendacion, para que el dueno decida de una vez (PC). Inclinacion del suplente en G1/G2: G1, mas una prueba de cableado que demuestre que ninguna ruta de la app llama a la 198 para una hija NETO. El hueco de G1 solo se alcanza con `service_role`, que la frontera ya excluye, y G2 cambia el congelado y el panel de pagos en la ruta del dinero. Lo decide el dueno.
  5. **IDs nuevos (titular).** Truncamiento DTM (candidato: Chat #4 cuando cierre #54) y limpieza de las 7 pruebas desactualizadas.

- **Siguiente paso para el titular:** registrar estas decisiones cuando el dueno las tome, hacer la reserva de #39, abrir los dos IDs nuevos y conciliar el tablero. #40 espera a #42 para la busqueda y a #39 para el vencimiento.

- **Prompts de esta nota (para el dueno; no enviados):**
  - **PA, Chat #4 (#54):** "`main` avanzo a `862edf42` (PR #363, #32/214). El Coordinador suplente comprobo que #363 no toca ninguno de los 11 archivos de #54, ni `package.json`, loaders o `types/database.ts`; tu auditoria de la ronda 3 sigue vigente. Pide a tu unico Opus de #54, en `.claude/worktrees/editar-addons-carrito-54`: confirmar `git status` y que `origin/main` = `862edf42`; actualizar por fast-forward (`git merge --ff-only origin/main`) sin descartar ni mover sus cambios, y detenerse si no es fast-forward; correr una vez el build de Next (`pnpm run build`; el ultimo es de la ronda 2, sobre `8987932e`) y las dos suites React de #54; reportar base, `git status`, comandos y resultados. Tu compruebas por hashes que el diff no cambio y dejas en tu bitacora el veredicto para el gate de PR. Los 7 fallos de la base no se tocan en #54. Sin staging, commit, push, PR ni SQL."
  - **PB, Auditorias (chat nuevo, #42):** "Eres el chat `Auditorias` de D'spacios Mayorista (#32/#42). El chat anterior se cerro y retomas su frente. Rol: auditar y coordinar en solo lectura. Tu unica superficie de escritura es `C:\Users\Asus\Documents\Codex\coord-workstreams\dspacios-travel\docs\coordinacion\auditorias-identidad-crm.md`. No edites codigo, migraciones, `TASKS.md`, `CURRENT_GOAL.md`, `WORKSTREAMS.md` ni worktrees; sin staging, commit, push, PR ni SQL remoto; no contactes otros chats. Lee `AGENTS.md` (raiz), `dspacios-travel/docs/agents/CODEX.md`, `CURRENT_GOAL.md`, `TASKS.md` (#32 y #42), tu bitacora, el turno 2026-10-18 de `dspacios-travel/docs/agents/COORDINATOR_HANDOFF.md`, y `WORKSTREAMS.md` solo para reservas. Estado: PR #363 fusionado en `main` `862edf42`. El checkout principal esta un commit atras: lee los archivos de #363 con `git show origin/main:<ruta>` o en `.claude/worktrees/identidad-personas-32` (mismo arbol). 214 en Produccion: [ratificada por el dueno: preflight ___ / postcheck ___ / Exposed schemas sin `p214_priv` | aun sin ratificar]. Decisiones del dueno para #42: quitar pasajero = [___]; titular que viaja = [___]. Tarea: cerrar el contrato de escritura de #42 sobre la 214, partiendo de las secciones 3.5-3.6 de `docs/tecnico/personas-identidad.md` y de tu auditoria del ID de pasajero del 2026-10-12. Cubre: fuente `cotizacion` y su clave de origen; ID estable de pasajero por flujo (Reservar, carrito/checkout, manual/dinamica); vinculo idempotente cotizacion-persona-rol; correccion, concurrencia, reintento y conversion; quien llama a `upsert_persona`/`promover_persona` y en que contexto; visibilidad por rol y tenant sin abrir cotizaciones completas; errores visibles. Entrega: rutas y funciones exactas, con su cruce con #39 en `reservar/actions.ts` y `manual-actions.ts`; si hace falta migracion (sin elegir numero); plan de pruebas en PostgreSQL local y como extender el CI focal de la 214; decisiones que aun falten; lo que hay que corregir en el estado de `docs/tecnico/personas-identidad.md` (sin editarlo); y el prompt para un unico ejecutor. Sin backfill ni codigo. Si la 214 no esta ratificada, entrega el contrato pero marca el codigo como bloqueado por ese gate."
  - **PC, Chat #2 (#50):** "El Coordinador suplente reviso tu ajuste focal de #50: tus citas de la 164 y la 198 coinciden con `main`, y la conversion 198 solo la ejecuta `service_role` (164 `:1365-1366`). En solo lectura, prepara en tu bitacora UNA hoja de decisiones de #50 para el dueno. Para cada decision abierta (G1/G2, D2/BNC, retencion, documento NETO, rol `venta`, margen 6%, modalidad obligatoria, paridad PVP de aliado/asesor), indica opciones, efecto en dinero, contratos y DTM, tu recomendacion y que prueba la demostraria. Declara la dependencia con #39: quien cierra el PATCH directo del primer congelado y como conviven los triggers de #39 y #50 sobre `cotizaciones`. No abras otra ronda con Opus mientras el dueno no decida. Sin codigo, reservas, numero ni SQL. El truncamiento DTM de la 159 lo registra el Coordinador como frente aparte; no lo amplies en #50."

#### Nota 2026-10-18 (mismo suplente): decision del dueno sobre la renovacion en #39

- **Decision del dueno, expresa en este chat: opcion A.** #39 no modifica `actualizarVigenciaCotizacion` (`reservar/actions.ts:2736-2761`) ni agrega en el trigger de frontera una regla sobre `vigencia_hasta`. La renovacion sigue como hoy. Quien puede renovar una cotizacion (propia o ajena, manuales legadas sin `creado_por_id`) se decide dentro de #40-vencimiento, junto con "quien elige la fecha" y "que pasa al vencer".
- **Efectos en el mapa de Chat #1:**
  - Se retira el delta de vigencia y C4 vuelve a reutilizar la accion existente sin cambios. Segun la bitacora de Chat #1, el mapa original de Opus no tocaba `reservar/actions.ts`. Si se confirma, #39 queda fuera de ese archivo, lo que elimina el cruce con #40 y con las funciones de #42 en el. `manual-actions.ts` sigue siendo superficie compartida con #42.
  - Los casos V2, V4, V5 y V12 (autoria de la renovacion) y la condicion de Gate 2 sobre el PATCH de vigencia con `service_role` pasan como antecedente a #40.
  - Se quedan en el Gate 2 de #39, porque los exige la decision 5 del dueno: V1, V6, V7, V8, V9 y V11, es decir, que renovar no salta las guardas de pago, congelado, hija ni autoria de la edicion. El resultado esperado de V2 y V4 cambia: la renovacion se permite como hoy y la edicion sigue rechazada por C2.
- **Propuesta de reserva LOCAL para el titular** (no registrada; el suplente no cambia reservas):
  - Un unico ejecutor. Recomendado: el mismo Opus que hizo el analisis de Gate 1, si el dueno lo confirma.
  - Worktree nuevo desde `main` `862edf42`, con rama propia.
  - Lista exacta de archivos y funciones: la entrega Chat #1 a partir del informe de Gate 1 de Opus, que no esta en disco. El suplente no la reconstruye.
  - Migraciones **216 (A) y 217 (B)**. Comprobado: no hay archivos 216+ en ningun worktree local ni en las ramas remotas conocidas sin fetch; solo existe la 215, en `contable-43-1a`.
  - Condiciones de la reserva:
    1. Estampar `creado_por_id` al crear manuales, con una funcion definer.
    2. Que la migracion B cierre el DML directo, incluido el PATCH del primer congelado sin pago, del que depende #50.
    3. Probar los triggers de `cotizaciones` junto con los de la 154 y la 211.
    4. No tocar el contexto `service_role` de la 198.
    5. Hasta el merge de #39, #42 y #50 no codifican en `manual-actions.ts` ni en triggers de `cotizaciones`.
- **Prompt PD a Chat #1 entregado al dueno** (no enviado): registrar la decision A, ajustar el mapa y redactar la solicitud de reserva final y el prompt de GO local del ejecutor.
- **Pendiente del titular:** registrar la decision A en `TASKS.md` (#39 y #40) y en `WORKSTREAMS.md`, revisar la solicitud de Chat #1 y registrar la reserva.
- **Texto de PD (Chat #1, #39):** "Decision del dueno (2026-10-18), registrada por el Coordinador suplente en `docs/agents/COORDINATOR_HANDOFF.md`: opcion A para la renovacion. #39 NO modifica `actualizarVigenciaCotizacion` (`reservar/actions.ts:2736-2761`) ni agrega reglas sobre `vigencia_hasta` en el trigger de frontera; la renovacion sigue como hoy y 'quien renueva' se decide en #40-vencimiento. En solo lectura y editando solo tu bitacora: (1) Registra la decision y retira del mapa el delta de vigencia; C4 vuelve a reutilizar la accion sin cambios. Confirma si con eso #39 queda fuera de `reservar/actions.ts`. (2) Pasa como antecedente de #40 los casos V2, V4, V5 y V12 y la condicion sobre el PATCH de vigencia con `service_role`. Deja en el Gate 2 de #39 V1, V6, V7, V8, V9 y V11, y reinterpreta V2 y V4: la renovacion se permite y la edicion la rechaza C2. (3) Redacta la solicitud de reserva final para el titular: worktree nuevo desde `main` `862edf42`, rama, lista exacta de archivos y funciones del informe de Gate 1 de Opus, migraciones 216 (A) y 217 (B) sujetas a confirmacion del titular, y cruces con #42 (`manual-actions.ts`) y con #50 (triggers de `cotizaciones`, PATCH del primer congelado). (4) Redacta el prompt de GO local para el unico ejecutor, con estas condiciones: estampar `creado_por_id` al crear manuales mediante una funcion definer; la migracion B cierra el DML directo, incluido el PATCH del primer congelado sin pago; probar los triggers de `cotizaciones` junto con los de la 154 y la 211; no cambiar el contexto `service_role` de la 198; sin SQL remoto, staging, commit, push ni PR; el Gate 2 completo se cumple antes del PR. No abras otra ronda con Opus para esto: es un ajuste de papel. El GO de codigo lo da el titular al registrar la reserva."

#### Nota 2026-10-18 (mismo suplente): correccion de PA y veredicto de #54

- **Correccion de un error propio.** El texto de PA (nota de resultados, mas arriba) dice que #363 no toca "`package.json`, loaders o `types/database.ts`". Es falso para `types/database.ts`: #363 le agrega 17 lineas (el tipo de `buscar_personas_documento`), como ya constaba en el primer turno de hoy. Lo correcto: **#54** no toca `types/database.ts`, y #363 no toca ninguno de los 11 archivos de #54. Chat #4 detecto el error; no tuvo efecto en #54 y el build lo confirma.
- **Reporte de Chat #4 (2026-10-18):** el worktree #54 avanzo por fast-forward a `862edf42` y el diff no cambio (Chat #4 comparo hashes de los 11 archivos). Un Opus nuevo ejecuto una vez `pnpm run build` (salida 0, Next 16.3.0, 16/16 paginas) y las dos suites React de #54 (34/34). Chat #4 leyo esos logs; no ejecuto el build en persona. Veredicto de Chat #4: aprobado localmente para el gate de PR.
- **Verificado por el suplente:**
  - HEAD del worktree = `862edf42ad95`, rama `codex/54-editar-addons-carrito` sin upstream y area de staging vacia.
  - 8 archivos modificados (+909/-86) y 3 pruebas nuevas (1275 lineas), todos dentro del GO local de #54.
  - En las lineas de producto agregadas no hay emojis, `console.log`/`debugger`, colores hex sueltos ni llamadas a `service_role`/RPC.
  - Ningun worktree activo tiene cambios sin commit en los archivos de #54. Solo aparece `package.json` en `vuelos-editar-rescate-20261008`, que es un rescate congelado. Las coincidencias de ramas ya fusionadas (#14, #35, #52 y otras) no son trabajo vivo. #49 y #22 no tocan esos archivos.
- **Observaciones (ninguna bloquea):**
  1. **BAJO:** `editarAddonsCarrito54.react.ts` y `editarAddonsCheckout54.react.ts` no estan en la lista explicita de `test:react` de `package.json` (58 archivos), asi que la suite React estandar no las corre. `editarAddonsCarrito54.test.ts` si entra por el glob de `test:unit`. Registrarlas exige tocar `package.json`, superficie comun que requiere autorizacion; no hay otro worktree activo que lo este editando. Decision del dueno o del titular: agregarlas en este PR (recomendado) o abrir un seguimiento.
  2. Los 7 fallos de la base siguen fuera de #54, con el ID de limpieza propuesto en la nota anterior.
  3. Preview comparte la base de Produccion: validar la edicion del carrito sin enviar el checkout, porque enviarlo crea una cotizacion real.
- **Veredicto del suplente como auditor: aprobado con observaciones** para staging, commit, push y PR (empezar como borrador) por parte del dueno. El gate formal de PR sigue siendo del titular; el dueno decide si esperarlo. Sin SQL. Comandos entregados al dueno en el chat.
- **Decision del dueno (2026-10-18), expresa en este chat:** registrar las dos pruebas React de #54 en `package.json` (`test:react`) dentro del mismo PR. Autoriza tocar `package.json` solo para agregar esas dos rutas. El dueno envia el prompt a Chat #4, y el commit incluye `dspacios-travel/package.json` (12 archivos). Antes del commit, el suplente o Chat #4 verifica que el diff de `package.json` son exactamente esas dos rutas.
- **Verificado por el suplente tras el reporte de Chat #4:**
  - HEAD sigue en `862edf42`, nada en staging; 9 archivos modificados y 3 pruebas nuevas.
  - `package.json` cambia 1 linea (+1/-1) y `git diff --check` esta limpio.
  - Comparado contra `HEAD` una vez parseado: ninguna clave de primer nivel cambia y el unico script distinto es `test:react`. Conserva su valor anterior completo y solo agrega al final las rutas `pruebas/editarAddonsCarrito54.react.ts` y `pruebas/editarAddonsCheckout54.react.ts`, que existen en el worktree. Pasa de 59 a 61 rutas.
  - Las 34/34 de las dos suites quedan reportadas por Chat #4; no las corri.
  - Sin objeciones para el commit de 12 archivos.
- **PR de #54 = #364** (el dueno lo cito como 365; ese numero no existe). Verificado por el suplente con la API publica de GitHub y `git ls-remote`:
  - Draft, abierto, `mergeable_state: clean`.
  - Base `main` `862edf42`, que sigue siendo el `main` remoto. Head `codex/54-editar-addons-carrito` `6405f38b`, 1 commit.
  - 12 archivos, +2185/-87, exactamente los auditados, con la descripcion entregada.
  - Vercel Preview `success` (deployment `7161321147`, 21:55 UTC) y check "Vercel Preview Comments" en success. El CI de la 214 no aplica.
  - Sin SQL ni migracion.
- **Pendiente de #364:**
  1. El dueno valida en Preview sin enviar el checkout.
  2. Marcar listo para merge y fusionar. El gate formal es del titular y el dueno decide si lo espera. El suplente, como auditor, no tiene objeciones.
  3. Tras el merge: Production Ready/Current en Vercel, validacion en Produccion y fast-forward del checkout principal.
  4. El titular mueve #54 a seguimiento en `TASKS.md` y libera su fila en `WORKSTREAMS.md`.
- **Validacion en Preview (reporte del dueno, 2026-10-18):** "validados los movimientos en el carrito" en el Preview de #364. El suplente no lo verifico. No consta si cubrio el hotel por unidad y la comparativa; quedan como punto de la prueba en Produccion si no se probaron. Con esto, el paso 1 de arriba queda cumplido segun el dueno.

## Relevo del Coordinador titular (2026-10-20, suplente: chat ejecutor de #56)

**Leido:** `AGENTS.md`, `CURRENT_GOAL.md`, `WORKSTREAMS.md` (reservas #40, #68 y GO LOCAL #68), `docs/coordinacion/BITACORA_TAREAS.md` y las bitacoras de #40, #56, #68 y #50 (seccion E). `TASKS.md` no se releyo completo: no hacia falta para estos gates.

**Conflicto de interes:** el suplente es el ejecutor de #56. Sobre #56 solo verifica hechos; NO decide su gate.

**Evidencia comprobada por el suplente (solo lectura, sin SQL ni escrituras):**
- **PRs en GitHub:**
  - #372 sigue Draft en `68e2b626`.
  - #369 esta CERRADO sin merge, como pedia el gate.
  - #371 (#57) esta FUSIONADO.
  - #366 sigue Draft.
- **#40:** sin entrega nueva despues del gate "GO tecnico Ready de #372". Worktree `crm-captura-filtro-40` limpio en `68e2b626` = head remoto.
- **#68:** worktree `clientes-contratos-68` creado en `a4c999cf`, rama `codex/68-clientes-contratos`. Solo 2 archivos sin seguimiento (migracion 221 y su preflight) y SIN fila nueva en la bitacora: trabajo en curso, no es entrega. Archivos dentro de la reserva.
- **#56, ciclo 1 (correccion `sel:`):** HEAD `c12ecba6`, sin staging. Existen `elegir()` y `pedirDeLasActuales()` en `lib/salesbot/conversacion/flujo.ts`. Repetidas por el suplente las 4 suites de conversacion: **88/88**; flujo **43/43**. `git diff --check` limpio. TypeScript, ESLint y la contraprueba son reporte del ejecutor, no repetidos.
- **#50:** sin cambios. Siguen abiertas D-1..D-6 (del dueno, con recomendacion en la bitacora) y C-1..C-5 (del Coordinador/Contabilidad).

**Decisiones del suplente:**
- **#40:** se mantiene el gate vigente. El dueno puede marcar #372 Ready y hacer merge cuando quiera; #369 ya cumplio su cierre. E2 y E3 siguen sin GO.
- **#68:** sin gate; esperar la fila de entrega del ejecutor.
- **#56:** ningun gate. Pasa al titular con la evidencia de arriba.
- **#50:** ninguna decision C-x sin el titular. Las D-x quedan presentadas al dueno.

**Archivos modificados por el suplente:** solo este documento (esta seccion). No se tocaron `TASKS.md`, `CURRENT_GOAL.md`, `WORKSTREAMS.md`, bitacoras ajenas ni codigo.

**Gates abiertos:**
1. #372: Ready y merge (dueno). Despues, seguimiento de Produccion.
2. #68: revisar el diff, las pruebas SQL/API por rol y la guarda de asesor ambiguo cuando entregue. Inventario agregado antes de Ready. La 220 de #67 debe ir antes de la 221.
3. #56: gate del ciclo 1 por el titular, y despues conciliacion con `main` `a4c999cf`, Actions y navegador.
4. #50: D-1..D-6 del dueno y C-1..C-5 del titular antes de cualquier GO local.

**Proximo paso:** el titular retoma #56 y #50 C-x. El dueno decide sobre #372 y responde D-1..D-6 de #50 cuando pueda.

**Actualizacion 2026-10-20 (suplente) - gate de #68, entrega del ciclo 4:**
- **Alcance:** 15 archivos, iguales a la reserva GO LOCAL (`WORKSTREAMS.md:155`). Sin staging. HEAD `a4c999cf`.
- **SQL 221 (lectura):**
  - Las 2 funciones son SECURITY DEFINER con `search_path = pg_catalog, pg_temp`.
  - El actor sale de `auth.uid()` y de su fila activa en `usuarios`. Hay 5 roles. El tenant lo fija la base; solo el superadmin elige agencia.
  - Para `venta`: `soy_asesor_del_contrato` y la guarda de homonimos (exactamente 1 usuario activo del tenant).
  - ILIKE escapado y limites de cursor y tamano.
  - Grants: solo a `authenticated` (con revoke a public, anon y service_role).
  - No devuelve precio, direccion, firma ni `share_token`.
  - Lee `ventas_basica` (definida en la 156), que repite su propio `where` por `mi_rol()` y `puede_ver_tenant()`, asi que funciona llamada desde una funcion DEFINER.
  - Desviacion respecto al diseno: el diseno decia INVOKER y se implemento DEFINER. Se acepta porque el control queda dentro de la funcion.
- **Workflow:**
  - Disparo: `pull_request` a main con `paths` acotados, mas `workflow_dispatch`.
  - `permissions: contents: read`, sin secretos, sin Supabase remoto y sin `pull_request_target`.
  - Checkout fijado por SHA.
- **App:** la busqueda va en una cookie httpOnly (`sameSite=lax`, `path` acotado) y no en la URL. Los errores se devuelven como mensaje generico y no se registran en logs.
- **Repetido por el suplente:**
  - TS Acceso y Cableado: 21/21.
  - React UI: 11/11.
  - `tsc --noEmit`: exit 0.
  - `git diff --check`: limpio, incluidos los archivos sin seguimiento.
- **No ejecutado:** SQL ni API. Solo pueden correr en Actions.

**Gate #68:** GO a commit, push y PR **Draft** (lo hace el dueno) para que corra el workflow. **NO GO** a Ready ni a Preview hasta tener el workflow verde, el inventario agregado y la 220 (#67) ordenada antes que la 221. La 221 no se ejecuta en Produccion sin preflight y aprobacion del dueno.

**Respuestas al ejecutor:**
1. Orden: primero la 220, luego la 221. Ninguna se aplica antes de su PR.
2. La prueba React no entra en `package.json`, que no estaba reservado. La corre el workflow. El titular registra luego en serie las pruebas React de #67 y #68, y `suitesPruebas` queda como deuda conocida.
3. Gerencia acotada a su agencia, como fija el GO LOCAL. El dueno puede cambiarlo.
4. Confirmado: sin workflow verde no hay Preview.

**Actualizacion 2026-10-20 (suplente) - #68, PR #373 (head `10c4e3fc`) en rojo:**
- Paso 6 del job 221 con 3 fallos. El log lo pego el dueno.
- **S1, el fixture choca con el CHECK de la 160:** los contratos sinteticos de mayorista usan `68-0001` y `68-1000+g`, pero `ventas_numero_contrato_formato_por_tenant` exige `^DTM-[0-9]{4,}$`. Es un error de la prueba, no de la 221.
- **M4 y RB7, postcheck 14/15, falla C15:** C15 exige una ACL exhaustiva (solo el dueno y authenticated). Los revokes son los mismos de la 219, pero el postcheck de la 219 valida rol por rol con `has_function_privilege`. Hipotesis, sin confirmar porque el log no trae el detalle: con dueno `supabase_admin` en CI queda otro beneficiario (probablemente `postgres`) por los default privileges de Supabase.
- **Workflow:** el `bash -e` por defecto corta el paso antes del resumen `::error::`. Falta `set +e` antes del pipeline.
- **Gate:** sigue en Draft. NO GO a Ready. Se devuelve al ejecutor de #68 con los 3 puntos, dentro de los archivos reservados.

**Actualizacion 2026-10-20 (suplente) - #50:** el dueno respondio D-1..D-6 y autorizo al suplente a cerrar las C-x. Detalle en `bitacora-tarea-50.md`, seccion "Decisiones del dueno y del Coordinador suplente".
- Se reservaron los numeros 222 y 223 para #50 (sin GO de SQL).
- `checkout/actions.ts` espera el merge de #372; `types/database.ts` va en serie despues de #68 y #43-1a.
- El ejecutor lo elige el dueno.
- D-1 cambia: en la directa, el aliado escoge.
- Abiertas D-1b, D-2 (M1/M2) y D-6. Sin GO LOCAL.
- **#50, segunda ronda:** D-1 cerrada (todo asistido, sin caso directo), D-2 cerrada (margen sobre el total del paquete, como `margenContrato.ts`; 2 % solo tiquetes) y D-6 cerrada (sin Programas). Falta el ejecutor (lo elige el dueno) y un ciclo 2 de diseno antes del GO LOCAL.
- **#68, correccion del rojo (sin commit, sobre `10c4e3fc`):** 4 archivos reservados (workflow, postcheck, test `.sql` y `.sh`); la 221 sin cambios. Lo verificado por el suplente:
  - Los fixtures pasan a `DTM-68xx/69xx/70xx`, sin restos de `68-000N` ni `H221-` en mayorista.
  - El detalle de C15 lista los beneficiarios sobrantes.
  - M4/RB7 imprimen el detalle de los controles que fallan.
  - `set +e` en los dos pasos.
  - `bash -n` y `git diff --check` limpios.
  - **GO a commit y push al mismo PR #373 (Draft).** C15 seguira en rojo hasta ver el sobrante. Si es un rol administrativo (`postgres`/`supabase_admin`), se acepta validar como la 219; si es un rol de la API, se corrige la 221.
- **#68, segundo CI:** 52/54. Solo falla C15 (M4/RB7). Sobrante: `postgres:EXECUTE` en las dos funciones, con dueno `supabase_admin` en CI; viene de los default privileges de Supabase. Es un rol administrativo, no de la API, asi que se decide **corregir el postcheck, no la 221**. C15 acepta el dueno, `authenticated` y los roles administrativos `postgres`/`supabase_admin`; cualquier otro beneficiario (`PUBLIC`, `anon`, `service_role` u otro) sigue fallando. E1 y H19-H22 ya prueban que anon y service_role no ejecutan.
- **#68, correccion de C15 (sin commit, sobre `fc5fc2d7`):** se toca solo `postcheck_221`.
  - La lista blanca acepta: dueno, `authenticated`, `postgres` y `supabase_admin`.
  - Se exige EXECUTE de `authenticated` en las dos funciones.
  - Siguen siendo 15 controles; `git diff --check` limpio.
  - Revisado por el suplente: GO a commit y push al mismo PR.
  - Si Actions sale en verde, falta el inventario agregado de archivos compartidos (sobre todo `types/database.ts`, que tambien tocan #43-1a y #50) antes de Ready.
- **#68, PR #373 VERDE (head `2054bc38`, 6/6 checks segun el dueno).** Inventario agregado hecho por el suplente:
  - `main` avanzo a `b8182085` (merge de #372). Sin archivos en comun con #373, y `merge-tree` sin conflictos.
  - Sin cruces con #366.
  - `types/database.ts` lo tocan tambien #67 (worktree, hunks ~2405/3813) y #43-1a (worktree, hunk ~914). Los tres son aditivos y en zonas distintas; quien fusione despues concilia.
  - El cruce aparente de #43-1a con `app/(crm)/layout.tsx` es falso: su base vieja `8987932e` no tiene la entrada de #42.
  - **Decision:** la 221 no depende de la 220 (el preflight P10 solo marca REVISAR y la bateria corre sin la 220). Se permite aplicar la 221 en Produccion sin esperar a #67; el CI de #67 debe correr luego sobre un `main` que ya tenga la 221.
  - **GO a Ready.** Orden en Produccion: preflight 221 (el suplente revisa la fila) -> 221 -> postcheck 221 (esperado OK 15/0/15) -> merge -> Vercel Ready -> prueba funcional con un usuario administrativo y uno `venta`.
- **#68, 221 APLICADA en Produccion (2026-10-20, por el dueno):**
  - Preflight INFO: 0 bloqueantes. REVISAR P9=1 y P10=0; la 220 no esta aplicada, aceptado.
  - Postcheck OK 15/0/15. C15 sin sobrantes, dueno `postgres`. **No reaplicar.**
  - **P9:** el homonimo es la misma persona con dos usuarios activos, uno `venta` y otro `freelance`, con el mismo nombre. El dueno pide relacionar con el perfil freelance sus ventas a nombre propio. Se trata como un arreglo de datos aparte, fuera de #68, con su propio preflight/rollback; primero hay que diagnosticar la consulta de conteos por `tipo_asesor`/`canal`/`b2b_usuario_id`/`aliado_id`. Pendiente que el dueno entregue esos conteos.
  - **Siguiente:** merge de #373 -> Vercel Ready -> prueba funcional con un usuario administrativo y uno `venta`.
- **main local avanzado por fast-forward a `51ca079e`** (#372 y #373 fusionados); se conservan los documentos sin commit.
- **#50, ciclo 2 de diseno APROBADO por el suplente.** Q-1 = 2 % exacto y 6 % con tolerancia; Q-3 = snapshot NETO; Q-4 segun la recomendacion; modificacion minima de `margenContrato.ts` autorizada. Pendientes del dueno: Q-2 (costo total 0) y el ejecutor. Despues: reserva de archivos y GO LOCAL. Detalle en `bitacora-tarea-50.md`, seccion "Gate del Coordinador suplente sobre el ciclo 2".
- **#50 GO LOCAL (suplente, 2026-10-20):** el dueno respondio Q-2 (costo total 0 se rechaza sin excepcion).
  - Reserva: 222/223, worktree `neto-hija-50`, rama `codex/50-neto-hija-manual`, base `51ca079e`; la lista de archivos esta en `bitacora-tarea-50.md`, seccion "GO LOCAL #50 y reserva".
  - El ejecutor es quien reciba el prompt del dueno.
  - **Pendiente para el titular:** copiar la reserva a `WORKSTREAMS.md`; el suplente no edito ese tablero.
- **Orden del dueno (2026-10-20):** primero cerrar #50 (GO LOCAL dado, a la espera de la entrega del ciclo 3), despues #63 y despues el grupo #40 (E2 busqueda por documento en manual/carrito/tarifario + documento como primer dato, y E3).
- **#63, correccion de entendimiento (dueno, 2026-10-20):**
  - En los tiquetes NO hay promociones ni tipos de promocion. "Promocion" es solo la etiqueta (badge) que se muestra en las salidas sin record, de origen `empaquetados` (`EmpaquetadosTabla.tsx:32,189`).
  - #63 es incorporar esas salidas de `empaquetados` a paquetes dinamicos (varias por paquete, revisadas y agregadas a mano, mas USD/COP y TRM). No es un motor de descuentos ni de tipos de promocion.
  - El dueno no sabe por que se puede poner otra etiqueta distinta. Queda para la auditoria de #63: ubicar ese campo y decidir si se fija.
  - El titular debe ajustar la redaccion de `TASKS.md` #63 y avisar al Chat #4.
- **#67, gate de la entrega (suplente, 2026-10-20):** base `a4c999cf`; 27 archivos, sin staging. Todos dentro de la reserva salvo `pruebas/salidaDinamicaFlujos62.test.ts` (una linea de fixture, declarada).
  - **Repetido por el suplente:** 159/159 (reglas, flujos, cableado y #62) y React 16/16. `git diff --check` limpio. Los types de #68 aplican sobre #67 sin conflicto.
  - **Workflow:** solo lectura, checkout fijado por SHA y `paths` acotados. Falta `set +e` en los pasos con `tee`; es la misma leccion que #68.
  - **Decisiones:**
    1. Sin FK a `destinos`: se acepta. Las alternativas huerfanas se ignoran al leer (falla cerrado); queda como frente aparte integrarlas con `usoDestino`/`fn_fusionar_destino`.
    2. La prueba React fuera de `test:react`: la registra luego el titular, junto con la de #68 (#50 solo registra las suyas).
    3. Se aprueba retroactivamente la linea de fixture de #62.
  - **Gate:** GO a commit, rebase sobre `origin/main` `51ca079e`, push y PR Draft, despues de agregar `set +e`. NO GO a Ready hasta que el workflow este en verde.
  - **Produccion:** preflight 220; el dueno revisa P4-P6, que son los vinculos que dejaran de ofrecerse, antes de aplicar.
- **#67, primer CI del PR (head `2a596563`):** las fases salen en rojo. Son dos errores de la prueba; no de la 220:
  - **V8:** el lote reutiliza `(92301, 92105)`, que ya vinculo V1, y la PK de `armado_vuelos` falla antes que la guarda de destino. Hay que usar en el lote un vuelo valido todavia no vinculado.
  - **F6:** la preparacion inserta una alternativa en el paquete 95301, que tiene a proposito un vinculo antiguo incompatible (CTG). El trigger lo rechaza, que es el comportamiento correcto de R9, y la preparacion falla en silencio (`>/dev/null`). Eso arrastra F6, F7 y F8. Hay que usar otro paquete para la "configuracion en uso", conservar el 95301 para F7.3 y hacer que la preparacion falle de forma visible.
  - El resto en verde: 82/83 SQL y F5 idempotente con postcheck OK. Se devuelve al ejecutor y sigue en Draft.
- **#67, correccion de las pruebas (sin commit, sobre `2a596563`):** solo cambian los 4 `test_220_*`; la 220, el pre/postcheck y el rollback siguen intactos.
  - V8 usa el fixture nuevo 92109; ningun conteo depende de el.
  - F6/F7 pasan al paquete 95302 (RD a RD, comparable) y el 95301 conserva el vinculo para F7.3.
  - Las preparaciones ahora fallan de forma visible; se acepta tambien el cambio extra en `reponer()`.
  - `bash -n` en los 3 `.sh` y `git diff --check` limpios.
  - GO a commit y push al mismo PR.
- **#67, segundo CI (head `83c06dbe`):** las fases ya estan en VERDE. Las carreras fallan y se cuelgan:
  - **C1.1:** la RPC de B (apagar el check) falla al confirmar porque ve el vinculo #93101 que A tiene SIN confirmar, detenido en la compuerta. A termina con rc=0 y el check no queda apagado. El invariante "ningun vuelo incompatible" (C1.3) si se cumple.
  - **C2:** se cuelga 15 minutos. Hipotesis, no confirmada: B queda bloqueado esperando a A, y A espera la compuerta, que solo se abre despues de que B termine. Es un interbloqueo de la orquestacion, sin `lock_timeout`.
  - Se devuelve al ejecutor para que determine con evidencia (`pg_locks`/`pg_stat_activity`) si la 220 serializa a proposito (entonces se ajustan las expectativas, sin debilitar el invariante) o si hay un defecto real. Ademas: timeouts en las sesiones de la carrera y esquema de CI con la 221.
- **#67, carreras rehechas (sin commit, sobre `83c06dbe`):** 3 archivos (`test_220_carrera.sh`, un comentario en fases y el workflow); la 220 sin tocar.
  - **Diagnostico verificado por el suplente:** el trigger `tarifario_trg_armado_vuelos` (181:343) invalida el tarifario y hace UPDATE de la fila de `armado_paquetes`, asi que A retiene esa fila hasta confirmar.
  - **Correccion al reporte del ejecutor:** la 220 TAMBIEN toma `FOR NO KEY UPDATE` del paquete en cada validacion (220:36,194,268). Es una serializacion intencional. No es un defecto y es coherente con las nuevas expectativas: el ultimo en llegar valida contra lo confirmado y el invariante no se debilita.
  - **Orquestacion:** timeouts en A, B y G, un vigia de 110 s y el paso limitado a 4 minutos.
  - **Esquema de CI:** 001-221 sin la 220, usando una copia de `supabase/`; no se toca el script compartido.
  - `bash -n` y `git diff --check` limpios. GO a commit y push al mismo PR.
- **#67 VERDE (head `4e31d9ca`):** todos los checks en verde, verificados por el suplente via API (220 fases/SQL/carreras/API/rollback y TS #67, ademas de 219/221/#42/#68 y Vercel).
  - Esta al dia con `main` `51ca079e`; 27 archivos.
  - Cruces: `types/database.ts` con #43-1a (worktree) y #50 (aun sin codigo), y los dos concilian.
  - **GO a Ready.** Orden en Produccion: preflight 220 (el suplente revisa P4-P6) -> 220 -> postcheck -> merge -> Vercel -> prueba funcional (check apagado/encendido en un paquete y venta de Bloqueo).
- **#67 preflight 220 en Produccion (dueno):** sin BLOQUEANTE.
  - P4, P5 y P6 = 0: ningun vinculo deja de ofrecerse.
  - P8: hay variantes de mayusculas en `pais` (Colombia/COLOMBIA); `pais_comparable_67` ignora mayusculas y tildes, asi que comparan igual.
  - P9 = 3: paquetes que regeneran el tarifario solo si se enciende el check.
  - VISTO BUENO para aplicar la 220.
- **INCIDENTE de codificacion (error del suplente), 2026-10-20:** los comandos `Get-Content -Raw ... | Set-Clipboard` que di NO llevaban `-Encoding UTF8`. Windows PowerShell 5.1 leyo los `.sql` (UTF-8 sin BOM) como ANSI y las tildes llegaron danadas al SQL Editor; eso explica los "Ã" de todos los resultados.
  - **220 (#67), con efecto funcional:** la cadena `translate` de `pais_comparable_67` quedo desalineada y el postcheck dio 11/12 con C10 en FALLA. Las comparaciones con tildes pueden fallar.
  - **221 (#68), solo cosmetico:** se danaron comentarios y un mensaje de error; la logica no usa caracteres fuera de ASCII. El postcheck 15/15 sigue valido.
  - **Correccion:** reaplicar la 220 (idempotente, F5 en CI) copiandola con `-Encoding UTF8`, y despues el postcheck tambien en UTF-8 (esperado 12/0/12). Reaplicar la 221 es opcional, solo para limpiar los comentarios.
  - No fusionar #67 hasta tener el postcheck OK.
- **#67, 220 APLICADA en Produccion y corregida (2026-10-20):** se reaplico en UTF-8. Postcheck OK 12/0/12, C10 en verde y textos con tildes correctas. **No reaplicar.** Siguiente: merge -> Vercel Ready -> prueba funcional (check apagado/encendido y venta de Bloqueo).
- **2026-10-21:** #67 fusionado como `0d360b39` (#374).
- **#50, gate del ciclo 3:** 27 archivos dentro de la reserva; el suplente repitio 59/59 TS y 14/14 React. Ajustes pedidos: Q-5 (PVP sin aliado sigue permitido), Q-8 (verificar), Q-9a (vectores de borde .5) y Q-9b (texto de cabecera). Despues: commit, rebase sobre `0d360b39` y PR Draft. Detalle en `bitacora-tarea-50.md`, seccion "Gate del Coordinador suplente sobre el ciclo 3".

## Continuacion del titular: segunda corrida de #50 (2026-10-21)

### Conciliacion posterior al merge #375 (titular, 2026-10-21)

Al pedido "continua", verificados git status/historial y metadata GitHub (no CI): #375 esta closed/merged, no Draft; fusionado 2026-10-21 13:54:57 Bogota como 2d5dff0e, cabeza c411f06e. Incluye UI ciclo 9. Worktree neto-hija-50 limpio, c411f06e; origin/main local 2d5dff0e; checkout principal main 51ca079e dos commits atras con documentos sucios preservados. No se hizo pull/merge/reset, staging/commit/push ni codigo. Leido rol OPENCODE para conciliacion documental. Las notas anteriores de "Draft / no merge" describen gates historicos, no el estado Git actual.

La 222 ya esta aplicada segun resultados del dueno (16/16) y p50_priv no expuesto; no repetir ni editar. Preflight 223 recibido INFO 3/0/0 no demuestra que se haya aplicado. No consta confirmacion de despliegue Vercel Production Ready/Current ni prueba humana completa PVP/NETO. No afirmar ni inferir ninguna de ellas del merge o de las capturas previas. Sigue pendiente el cierre operativo y la decision de gate 223 con condiciones vigentes; sin nuevo GO SQL remoto ni cierre de #50. CI anterior aceptado por confirmacion del dueno, no revalidado.

#79-89 fueron registrados a pedido del dueno, sin reservas ni GO de implementacion. Se pidio aclaracion breve de "continua" (retomar orden #50->#63->#40 o auditar un ID nuevo); mientras tanto solo se concilian hechos independientes. El contrato #63 puede revisarse en solo lectura dentro de su encargo existente, sin abrir codigo por inferencia. No se modifica la bitacora del ejecutor desde este chat.


### Gate ciclo 9 UI #50 (titular, 2026-10-21)

APROBADO SOLO para staging/commit/push del DUENO al mismo Draft #375. Leidos fila/seccion 9 directamente en bitacora y diff real desde b86ea92d: comparativaAcciones.tsx, comparativaDocumento.tsx, netoHijaModalidad.react.ts; tres archivos +106/-34, sin staging. Alcance respetado: aviso vista previa con accion correcta en solicitudes; NETO destacado/PVP identificado; importes/porcentajes alineados y sin cortes; Documento target=_blank/rel seguro y nota sr-only. No cambia manejadores de guardado, calculos, permisos, RPC, idempotencia, persistencia ni migraciones. Q-16 aceptada: conservar la nota accesible.

Verificado por el titular: diff-check limpio; capturas sinteticas despues_neto_si_escritorio, despues_neto_si_movil y despues_solicitudes_neto_movil, sin recortes observados; ejecucion real de netoHijaModalidad.react.ts y cotizacionComparativa35Ui.react.ts, 29/29, exit 0. No se repitio tsc/eslint/cableado (limpios reportados por ejecutor), SQL, build ni CI. Capturas no equivalen a app autenticada ni validacion financiera real. Test React confirma que radios no guardan y se conserva el envio de modalidades y bloqueos. Coordinador no edito codigo ni hizo Git remoto.

Dueno puede incorporar exactamente los tres archivos auditados; no mezclar documentos de coordinacion. Tras push validar Preview actualizado: nuevo aviso/jerarquia, Documento abre otra pestana y conserva la ficha abierta; completar selector/pago previo/conversion PVP/NETO en caso real autorizado. Preview comparte Produccion. CI previamente aceptado por confirmacion del dueno no se revalido en este turno; este diff nuevo queda para los checks automaticos que correspondan. Mantener NO GO Ready/merge/223 hasta prueba funcional. 222 aplicada con postcheck 16/16 y p50_priv no expuesto, no reaplicar ni editar.


### Ajuste UI #50 durante validacion humana (2026-10-21)

El dueno muestra selector NETO y pregunta por perdida de valores tras Documento/volver. Revisado: SelectorOpciones usa estado React local SIN_ELECCION; solo actuar -> elegirOpcionComparativa envia modalidad al crear hija. Documento de FichaComparativa navega a /cotizacion/id sin target; muestra madre en solo lectura y conserva PVP por contrato. No se guarda una modalidad de la madre al marcar radios. No es evidencia de perdida de un sello persistido: todavia no se pulso Elegir. La captura muestra cortes de porcentaje y competencia visual entre PVP grande y NETO pequeno. La prueba de pago/conversion sigue sin cerrar; 222 ya aplicada, 223 pendiente.

Reserva LOCAL del MISMO ejecutor de #50, mismo worktree/rama y Draft #375: lib/cotizacion/comparativaAcciones.tsx SOLO PanelModalidad/ResumenNeto y presentacion de totales en SelectorOpciones; lib/cotizacion/comparativaDocumento.tsx SOLO enlace Documento en FichaComparativa (ampliacion expresa para target nueva pestana y rel seguro); pruebas/netoHijaModalidad.react.ts solo si requiere adaptar expectativas de texto a los cambios. Requisitos: aviso claro de vista previa que se guarda al Elegir esta opcion; mantener visible PVP original y destacar NETO como importe del aliado sin cambiar formulas; alinear importes, impedir cortes del porcentaje y etiqueta minima en desktop/movil; Documento en otra pestana manteniendo madre PVP sin transportar modalidad temporal al documento. No localStorage/sessionStorage ni persistencia en servidor; no guardar al marcar radios; no modificar auth, handlers/RPC, estado/idempotencia, permisos ni reglas de margen/recobro. 222 APLICADA e intocable; 223 sin GO. No migraciones ni archivos fuera de reserva.

Entrega: diff acotado, prueba React existente, diff-check, capturas desktop/movil con datos sinteticos; no repetir SQL ni CI completo por cambio solo UI. Registrar ciclo nuevo en SU bitacora; sin staging/commit/push/Ready/merge/SQL remoto por el ejecutor. Titular audita antes de push del dueno. No se implemento codigo desde el chat coordinador. La publicacion de Documento en nueva pestana conserva la ficha que sigue abierta; no promete conservar seleccion al recargar/cerrar navegador ni convierte la vista previa en guardado.


### Aplicacion remota de 222 por el dueno y cierre de exposicion (2026-10-21)

El dueno compartio preflight 222: INFO, 12 controles, 0 bloqueantes y 0 REVISAR, rol postgres; cadena 211/216/217/219/221 presente y 220 tambien, RPC 198 intacta, objetos 222 ausentes, P9/P10=0, P11=11 manuales directas abiertas fuera de #50. El titular aprobo SOLO aplicar 222 con el mismo rol y postcheck. El texto P10 sobre bloqueo de PVP sin aliado es anterior a Q-10; se advirtio su desfase, conteo 0, sin reabrir la decision ni editar migraciones.

El dueno aplico 222 y entrego postcheck OK 16/16, 0 fallos: ACL/RLS, funciones/wrappers, RPC 198 y frontera #39 correctas; sellos PVP=0/NETO=0 y modalidad obligatoria=false. Despues confirmo que solo los esquemas publicos estan seleccionados en Exposed schemas; p50_priv NO expuesto. Evidencia: resultados y testimonio del dueno en este chat; el titular no ejecuto SQL remoto ni inspecciono panel independientemente. **222 aplicada: NO repetir ni editar.** No se ha aplicado ni autorizado la 223.

Gates cerrados: CI completo por confirmacion del dueno sin revalidarlo; inventario agregado por revision del titular; pre/postcheck 222 y exposicion por resultados/confirmacion del dueno. Siguiente: prueba humana PVP/NETO de Preview #375 (selector/importes/pago previo/conversion) sobre un caso real autorizado. Preview comparte Produccion: no crear pagos ni contratos artificiales ni inferir permiso de escritura por abrir el enlace. No consta todavia esa prueba ni un caso autorizado identificado. Se mantiene NO GO Ready/merge hasta su cierre; 223 solo despues del codigo desplegado y de su propio preflight/gate/postcheck. La 222 aditiva permite mantener el codigo anterior mientras tanto.

### Gate vigente tras CI confirmado e inventario de integracion #50 (2026-10-21)

**Inventario de integracion APROBADO, sin bloqueantes.** El dueno confirmo que TODO el CI paso y pidio expresamente no volver a validarlo. Se acepta su confirmacion y se cierra ese gate, incluido Q-12 (ambas bases del workflow), sin consultar checks/logs ni repetir suites. La revision de este turno es exclusivamente de integracion. PR #375 sigue abierto/Draft, cabeza `b86ea92db1017daff8f8ae7b7b98cbd6fd92e042`, base remota `0d360b39a1ceb1486175b96c44e0967d614416c8` (metadata GitHub, no checks).

Comprobado por el titular:
- Worktree #50 limpio y alineado con su upstream. Merge-base con origin/main = base remota `0d360b39`; `rev-list --left-right --count origin/main...HEAD` = 0/3. No falta ningun commit del main actual; no hace falta rebase para esta base. El checkout principal sigue en `51ca079e` con documentos ajenos preservados; NO usarlo para integrar a ciegas.
- Diff agregado de #50: 29 archivos, todos en la reserva original y ampliaciones de pruebas ya aprobadas; `git diff --check origin/main...HEAD` limpio. No se modifico codigo ni se aplico parche; `git apply --check` es solo comprobacion.
- Inventariados estados y cambios propios (desde merge-base, mas pendientes/untracked) de seis frentes vivos: #43, #43-1a, #43-1b, #56, #49 y #22. Unico cruce real con #50: `types/database.ts` de #43-1a. Ningun cruce de archivo con los otros cinco. Se compararon nombres y diffs propios, no arboles completos de bases viejas que producirian falsos cruces.

| Superficie | Evidencia / decision |
| --- | --- |
| `types/database.ts` | #50 agrega dos tablas NETO y dos RPC (hunks base ~3151/~3973). #43-1a agrega tres tablas tributarias (hunk ~911). Parche pendiente de #43-1a comprobado sobre el arbol #50 con git apply --check: exit 0. #50 puede ir primero; #43-1a concilia despues con el main que ya lo incluya. Los aportes #67/#68 ya forman parte de la base de #50. |
| `package.json` | Comparacion JSON: solo cambia scripts.test:react; conserva integro el valor anterior, agrega exclusivamente pruebas/netoHijaModalidad.react.ts, archivo presente; ninguna ruta retirada ni dependencia cambiada. Ninguno de los seis worktrees vivos lo modifica actualmente. Registro futuro de React #43-1a/#43-1b/#49/#22 y deuda #73 exige conciliacion serial; no se incorpora a este PR. |
| Checkout/cotizaciones | #40 H0+E1, #42, #57, #67 y #68 estan en el main incluido. #40 E2/E3 y #63 siguen sin reserva de implementacion; deben partir del main posterior a #50 y conservar sus cambios. No liberar su escritura por este inventario. |
| Migraciones 222/223 | Solo los dos archivos reservados a #50 en su rama; no hay 222/223 en archivos tracked/untracked de los seis frentes vivos comprobados. 204/215/218 mantienen sus reservas; ninguna aplicacion remota se deduce de este inventario. |
| PR abiertos | Consulta de inventario GitHub: #375, #366 (#56) y #283 (solo documentacion; lista de tres Markdown). #366 no comparte archivo con #50 segun diff propio local; #283 tampoco por su alcance documental declarado, sin reauditar su contenido. No se consultaron checks. |

**Decision:** CI cerrado por confirmacion del dueno + inventario agregado cerrado por revision del titular. NO GO Ready/merge/SQL remoto todavia: falta prueba humana autorizada PVP/NETO (selector, pago previo y conversion), con entorno y datos apropiados. No inventar una validacion ni crear pagos/contratos de prueba en un Preview que comparta Produccion. No se verifico configuracion de ambientes ni aplicacion remota 222/223 en este turno; debe resolverse ese prerequisito antes de escrituras funcionales. Secuencia de despliegue preservada: 222 aditiva -> codigo -> 223 cierre, con pre/postcheck y autorizacion separada; no se autoriza ahora por el inventario. Orden #50 -> #63 -> #40 E2/E3.

**Gate posterior, ciclo 8 (titular, 2026-10-21): APROBADO SOLO PARA COMMIT/PUSH DEL DUENO AL MISMO DRAFT #375.** Leidos fila/seccion 8 directamente en la bitacora. Diff real: los mismos tres archivos reservados (workflow focal, test 211 y runner 222), +287/-21, sin staging, HEAD `7483efc8`. No app, migraciones, fixtures ni otros workflows. Los tres pasos con tee ahora hacen set +e antes del pipeline y capturan PIPESTATUS inmediatamente; publicar_contextos_211 se invoca siempre en H1/G2 y el workflow conserva/exige los tres contextos. No se encontro otro bloqueo para este push.

Verificado por el titular: diff-check limpio; bash -n sin CR exit 0; bloques run reales de los tres pasos extraidos del YAML, ejecutados con Bash -e -o pipefail y funciones simuladas (sin Docker/SQL): salida valida exit 0; runner rc=3 exit 1 con ::error::; FALLO SQL exit 1 con diagnostico y marcador nativo de fallo TS (cruz) exit 1 con diagnostico. Funcion REAL publicar_contextos_211 extraida del runner: publica 4.0/6.0/12.0 en una salida con 100 avisos posteriores (fuera del tail). El primer caso sintetico TS inyecto FALLO de SQL, que no es su marcador nativo; se corrigio el caso a la cruz de Node y paso. No se introduce un requisito ajeno al formato TS. Los 17/17 del harness completo del ejecutor son reportados, no repetidos integramente por el titular; no se ejecuto SQL real ni se valido clonacion/plantillas, parser YAML completo ni formato psql. Esos limites quedan para Actions.

Q-15: NO hace falta defaults.run.shell nuevo; el propio paso TS ya fija pipefail y set +e. No ampliar el diff por esa pregunta. Q-13/Q-14 siguen cerradas segun gate ciclo 7; Q-12 espera CI real dual. El dueno puede staging/commit/push de EXACTAMENTE esos tres archivos al mismo Draft; ningun Ready/merge/SQL remoto autorizado. Revisar el siguiente SHA y logs completos de los tres jobs focales (222/223, 211 sola y TS/React), mas regresiones independientes #39/#42/#67/#68. Solo despues resolver inventario agregado y validacion humana autorizada; Preview puede compartir Produccion. El ejecutor no hace Git remoto. Coordinacion actualizada sin modificar codigo del worktree.

**Gate posterior, ciclo 7 (titular, 2026-10-21): CON CORRECCIONES, sin GO a commit/push.** Leidos fila/seccion 7 de la bitacora; diff real contra `7483efc8`: SOLO workflow focal, test 211 y runner 222, +262/-18, sin staging. Grants retirados; nueva huella madre/servicios/hijas y job 211 sola dentro de la reserva. Diff-check limpio y bash -n del runner normalizado sin CR repetido por el titular (exit 0). Las 63/63 TS y 16/16 sinteticas son reporte del ejecutor; no repetidas. No se ejecuto SQL ni Docker.

Dos hallazgos pendientes en el arnes: (1) workflow :88/:165/:213 mantiene `set -uo pipefail`, que NO quita el `-e` de `bash --noprofile --norc -e -o pipefail`. Reproduccion sintetica del titular con ese shell: pipeline rc=3 sale con 3 antes de alcanzar captura/guarda; al agregar `set +e`, se alcanza guarda con rc=3. Debe corregirse explicitamente en LOS TRES pasos con tee; no basta leer PIPESTATUS inmediatamente despues. (2) workflow :174 exige contextos 4.0/6.0 en salida publica, pero runner :214 solo publica tail -25 en H1 verde y diag_211 solo al fallar. Esos contextos tempranos se pierden; H1 SQL verde terminaria rojo por marcas ausentes. Reproduccion sintetica del titular con contextos tempranos + 35 avisos posteriores: ambos AUSENTES en salida tail/H1. Publicar siempre contextos relevantes tanto en H1 como en G2; conservar verificaciones del log SQL interno y del workflow. Probar el contrato completo runner->tee->guardas, no solo verificar_211 sobre un archivo aislado.

Q-13: aceptado, guarda original de servicios ejecutada en H1 con 211 sola y frontera intacta en G2; no exigir chequeo adicional de catalogo para este push. Q-14: conservar job 211 sola en pull_request con paths focales actuales, no relegarlo a workflow_dispatch; Q-12 solo se cierra cuando ambas bases pasen realmente en Actions. No asumir los 10-15 min estimados como duracion medida.

Encargo ciclo 8 al MISMO ejecutor: corregir solo workflow/runner en estos dos puntos, preservar SQL ya auditado y todas las guardas; probar tres pipelines con shell heredando -e, casos rc distinto de cero y salida exitosa larga de H1 con contextos publicados y exigidos. Registrar ciclo 8, diff-check y bash -n, sin repetir suites de app no afectadas. Misma reserva, sin ampliacion a app/fixtures/migraciones/otros workflows, sin Docker local, SQL remoto, staging/commit/push ni Ready/merge. Nuevo gate del titular antes del push del dueno. El primer intento de Bash del titular fallo al inicializarse dentro del sandbox; las reproducciones y bash -n citadas si se ejecutaron al repetir fuera del sandbox.

**Gate posterior, ciclo 6 (titular, 2026-10-21): CON CORRECCIONES, sin GO a commit/push.** Leida la nueva entrega directamente en la bitacora y auditado el diff real: un solo archivo `test_211_cotizaciones_comparativas.sql`, +108/-7, sin staging, HEAD `7483efc8`; diff-check limpio. No se ejecuto SQL. Se conservan las ocho expectativas antiguas sin frontera y las nuevas ramas con los errores especificos observados en Actions. Sin embargo, `t211.servicios_directo` (lineas 176-184) agrega GRANT/REVOKE a authenticated/service_role y se invoca en 214/218 y 262/266: contradice la prohibicion de dar grants de la reserva y cambia una condicion de `frontera_activa`. No se autoriza esta excepcion aunque termine en rollback. Retirar helper, grants y pruebas que dependen de ellos; conservar el rechazo por ACL con la 217 intacta y verificar estado de madre/servicios antes/despues. La guarda propia de servicios 211 debe ejecutarse en una base desechable hasta la 211, sin 216/217; no sustituirla por un chequeo estructural de existencia de trigger. Q-12 pasa a cobertura ejecutable requerida en el workflow focal: ampliar SOLO runner/workflow focales para preparar esa segunda base en Actions, exigir contexto INACTIVA, ejecutar la bateria 211 completa y validar rc/resumen/sin FALLO. G2 vigente conserva ACTIVA con 217+222 y todas sus marcas. Ningun Docker local ni SQL remoto.

Las nuevas pruebas 8.12-8.17 salian de la reserva anterior: se admite ahora expresamente SOLO ese bloque adicional como cobertura complementaria de carrito, sin reemplazar manuales ni servicios. El riesgo de DELETE filtrado por RLS es pendiente real de Actions; SELECT visible no demuestra permiso DELETE. Corregir segun resultado sin abrir permisos. `t211.rechaza` (fixture :55-58, solo lectura) usa LIKE con comodines, no igualdad exacta; documentar como coincidencia del mensaje especifico, o usar comprobacion literal local si se exige exactitud, sin modificar fixture compartida.

Runner y workflow siguen sin cambios: pendientes el diagnostico G2 y manejo de -e/PIPESTATUS ya pedidos en ciclo 6. Entregar correccion como ciclo 7 con diff de los tres archivos reservados, diff-check, bash -n y comprobacion sintetica del pipeline; aclarar que SQL solo lo valida el siguiente Actions. El dueno no hace otro commit/push hasta nueva auditoria. Se mantienen NO GO Ready/merge/SQL remoto y los gates posteriores de inventario/prueba humana.

- Leidos router, rol, objetivo, tablero canonico, relevo y bitacora #50 (ciclos 3-5). WORKSTREAMS operativo esta fuera del repo, en `C:\Users\Asus\Documents\Codex\coord-workstreams\dspacios-travel\WORKSTREAMS.md`; no existe una copia en el checkout principal.
- Git principal: `main` en `51ca079e`, `origin/main` local en `0d360b39`; documentos previos sin commit preservados. Worktree #50 limpio en `7483efc81f70054d1387133e0f10651f0adbe470`, igual a la cabeza remota del Draft #375. El ultimo commit solo adapta `test_211_cotizaciones_comparativas.sql` y `test_222_neto_hija.sh`; diff revisado y `git diff --check HEAD^ HEAD` limpio. No se modifico codigo ni se ejecuto Docker/SQL local/remoto.
- Verificacion directa via GitHub: PR abierto y Draft. Actions `39636863896`, job SQL `119349620995`, ROJO; job TS/React `119349621553`, VERDE (178/178 TS y 30/30 React). Logs completos de ambos descargados y revisados, no solo el check. SQL 222 214/214; SQL 223 16/16; regresion conjunta 216/217 265/265. Postchecks 222=16/16 y 223=5/5; rollback por huella exacta y negativas con cierre/hija sellada verdes. Runner total 30 OK/1 fallo. Son ejecuciones CI desechables, no aplicaciones en Produccion.
- G2: 215 OK/8 fallos de 223. El runner informa `faltan: ninguna`: las marcas exigidas del bloque 12 estan presentes. Fallan las expectativas de error antiguas: 4.11/4.12/4.13/4.31 reciben `permission denied for table cotizacion_servicios`; 4.21/4.22 reciben la frontera de creacion; 6.29 recibe la frontera de cambio economico; 6.30 recibe la frontera de borrado. Anclas del test: 159-161, 171-184, 307-308. El rechazo existe; falta conciliar las expectativas sin perder la comprobacion del invariante. No hay evidencia en este run de un defecto de la migracion que justifique tocarla.
- Workflows independientes sobre el mismo SHA: #39 `39636864047`, #42 `39636863876`, #67 `39636863977`, #68 `39636863936`, todos success. Se verifico su estado final; no se reauditaron sus logs completos en esta ronda.
- Diagnostico CI: `.github/workflows/test-222-223-neto-50.yml:85,144` usa `set -uo pipefail`, que conserva el `-e` del shell de Actions. En el job SQL rojo el pipeline sale antes de capturar `PIPESTATUS` y de emitir el resumen `::error::` previsto. No produce falso verde, pero debe corregirse focalmente para conservar el diagnostico del fallo. G2 solo imprime `tail -25` (`test_222_neto_hija.sh:188`), ocultando las marcas anteriores del bloque 12 en el log publicado.

**Ampliacion de reserva / encargo ciclo 6:** MISMO ejecutor, worktree `neto-hija-50`, rama `codex/50-neto-hija-manual`, desde `7483efc8`. Solo `test_211_cotizaciones_comparativas.sql`: las ocho aserciones citadas de bloques 4/6, deteccion comun del contexto necesaria para ellas, y bloque 12 ya autorizado. Mantener expectativas originales sin frontera; con frontera activa exigir error especifico de cada puerta y estado sin escritura (madre/servicios/origen/opcion/hija), sin aceptar un rechazo cualquiera. No desactivar triggers, conceder permisos ni elevar roles para eludir la frontera. No editar fixture compartida, app ni migraciones. `test_222_neto_hija.sh` solo G2: conservar rc, ausencia de fallos, contexto ACTIVA y marcas obligatorias; publicar marcas relevantes y todos los fallos al diagnosticar. Workflow focal solo manejo de `-e`/pipeline para ejecutar guardas y devolver rojo correctamente (ambos pasos con `tee`); sin tocar otros workflows. Si necesita otra superficie, volver al titular antes de escribir.

Entrega: diff acotado, `git diff --check`, `bash -n` del runner y comprobacion ligera de la captura del pipeline; registrar ciclo 6 en SU bitacora con pruebas ejecutadas/no ejecutadas y riesgos. Q-12 sigue abierto: no se ha ejecutado el contexto 211 sola; proponer cobertura minima en CI sin afirmar validado ese camino. Sin Docker local, staging, commit, push, Ready, merge, SQL remoto ni escrituras en Preview por el ejecutor. El titular revisa la fila nueva antes de autorizar otro commit/push del dueno. Se mantiene NO GO Ready/merge/SQL remoto; quedan CI completo verde auditado, inventario agregado y validacion humana autorizada de pagos/conversion PVP y NETO. Preview puede compartir Produccion: no usarlo para escrituras de prueba por inferencia.

### Suplente retoma #50 (2026-10-21)
- El titular se quedo sin tokens despues de su ultimo mensaje: "Ciclo 9 aprobado para commit (ya se hizo y push); prueba funcional en Preview; NO GO a Ready, merge ni 223; la 222 no se repite".
- **Verificado por el suplente via API de GitHub:**
  - El PR #375 tiene head `c411f06e`.
  - Los 12 check-runs estan en verde: 222/223, 211 sola, 216/217, 219, 220, 221 y TS de #35/#39/#42/#50/#67/#68.
  - Vercel Preview completado (habia otro despliegue en curso).
- **Siguiente:** prueba humana en Preview segun la lista que se entrego al dueno, con un caso REAL autorizado, porque Preview comparte Produccion. Despues: Ready -> merge -> Vercel -> preflight 223 -> 223 -> postcheck.
- **#50, prueba humana en Preview: OK** segun el dueno ("todo sale bien... se cumple el cometido de la 50").
  - **GO a Ready y merge del #375** (los hace el dueno). Despues: Vercel Ready -> preflight 223 (copiado con `-Encoding UTF8`; el suplente lo revisa) -> 223 -> postcheck 223.
  - **Tareas nuevas que pidio el dueno (fuera de #50; el titular las registra en TASKS):**
    1. Editar cotizaciones hijas de comparativa, sea por cambios del proveedor, por errores o para anadir un servicio. Hoy la hija no es editable (`p39_priv.bloquear_para_editar` rechaza `cotizacion_origen_id`, A1 / decision 7: cambiar precio = hija nueva). Hay que disenar la edicion respetando el sellado NETO, el pago previo y el congelado.
    2. Reestructurar la tarifa de nino en las cotizaciones manuales: hoy esta en la cabecera y se suma al final. El dueno no la considera razonable; habria que modelarla por servicio o componente. Disenar aparte.
- **Correccion del suplente:** la madre comparativa TAMPOCO es editable. `p39_priv.bloquear_para_editar` (216:328-330) solo admite `tipo='manual'` y `modo='simple'` sin `cotizacion_origen_id`; la fase 1 de #39 dejo fuera las comparativas. La tarea nueva 1 queda asi: **edicion de cotizaciones comparativas, madre e hijas**, ampliando #39 a `modo comparativa`. Debe respetar el sellado NETO de #50, los pagos previos y el congelado. Hoy la unica salida es crear una comparativa nueva.
- **#50: PR #375 FUSIONADO como `2d5dff0e`.** Vercel muestra "Deployment has completed" en ese commit (verificado por API).
  - Preflight 223 en Produccion (dueno): INFO, 0 bloqueantes. Q1 = 222 presente; Q2 = 0, la 223 no esta aplicada; Q3 = 0 madres B2B sin aliado.
  - **VISTO BUENO para aplicar la 223** y correr su postcheck.
- **#50 CERRADO (2026-10-21):** 223 aplicada en Produccion; postcheck OK 5/0/5 (interruptor encendido, 222 presente, frontera #39 integra, md5 de la 198 intacto, 0 hijas legadas sin sello). **No reaplicar 222 ni 223.** Siguiente frente: #63.
- **#63 (suplente, 2026-10-21):** las decisiones de negocio estaban cerradas (`chat-4-hotfixes.md`: moneda COP, BNC segun la configuracion del paquete, fee de infante = costo y precio, servicios NETO con MK). El suplente acepto la revision tecnica pendiente (BNC = `tarifa_para_empaquetar` en modo tiquete; invalidacion por cambio de fuente o TRM; snapshot/CxP atomicos; elegibilidad segun los destinos aereos de #67) y reservo la **migracion 224**. Pedido un ciclo de re-base del contrato sobre `2d5dff0e` antes del GO LOCAL, porque #67 y #50 cambiaron casi todos los archivos del mapa. Detalle en `chat-4-hotfixes.md`, seccion "Gate del Coordinador suplente sobre #63". El titular debe pasar la reserva 224 a `WORKSTREAMS.md`.
- **#63, gate del re-base (suplente):** se resolvieron Q1-Q3 y Q6-Q17 (detalle en `chat-4-hotfixes.md`, seccion "Gate del Coordinador suplente sobre el re-base #63").
  - **Renumeracion:** la **224** pasa a un hotfix previo que cierra el neto de `empaquetados` legible por `venta` (exposicion desde la 156); **#63 usa la 225**.
  - Pendientes del dueno: Q4 (tour incluido para el infante) y Q5 (aporte de vuelo de adulto en la fila del infante).
- **Defecto de infante (dueno, 2026-10-21):** de 0 a 1,99 anos, el vuelo cobra `fee_infante` y cada servicio un precio de infante propio (puede ser 0); de 2 en adelante, tarifa de adulto. Hoy el generador cobra al infante el vuelo de adulto y los servicios completos.
  - **Nueva tarea urgente previa a #63.**
  - **Numeracion:** 224 hotfix del neto de empaquetados -> 225 tarifa de infante -> 226 #63. El titular debe registrarlo en TASKS/WORKSTREAMS.
- **Hotfix 224 (neto de empaquetados), gate del ciclo 1 (suplente):** autorizada una linea de `computo.ts:258`. Despliegue en dos numeros: **224 aditiva -> codigo -> 225 cierre**.
  - **Numeracion vigente:** 224/225 hotfix, **226 tarifa de infante**, **227 #63**.
  - Pendientes registrados: `bloqueos_vuelo.tarifa_neta` (misma fuga, hotfix aparte) y si el B2B debe reservar vuelos de Sistema (hoy no puede; es preexistente).
- **Hotfix 224/225 VERDE (head `039b149b`):** 12/12 checks, verificado por el suplente via API; al dia con `main` `2d5dff0e`.
  - **GO a Ready.**
  - **Orden en Produccion:** preflight 224 -> 224 -> postcheck 224 -> merge -> Vercel Ready -> preflight 225 -> 225 -> postcheck 225 -> prueba inmediata con `venta` (si falla, `rollback_225`).
  - La 224 va ANTES del merge porque el codigo nuevo lee la vista.
- **Preflight 224 en Produccion (dueno):** todo INFO. La 224 no esta aplicada y la policy de lectura incluye a `venta`. Hay 20 empaquetados con neto expuesto, 3 usuarios `venta` y 1 `control_vuelo`; no hay contratos con origen Empaquetado ni otros caminos al neto (funciones o vistas). **VISTO BUENO para aplicar la 224.**
- **224 APLICADA en Produccion:** postcheck OK 9/0/9, con la policy de 6 roles intacta. **No reaplicar.** Siguiente: merge del PR -> Vercel Ready -> preflight 225.
- **Hotfix: PR #376 FUSIONADO como `328f6f06`.** `main` ya lee `empaquetados_basica` en `computo.ts:258`, y Vercel muestra "Deployment has completed" en ese commit.
  - Preflight 225: P4 = 1 y P7 (recordatorio manual) en REVISAR, como se esperaba.
  - **VISTO BUENO para aplicar la 225**, con prueba inmediata de `venta` y `rollback_225` listo.
- **225 APLICADA en Produccion:** postcheck OK 9/0/9; `venta` ya no tiene ninguna policy de lectura sobre la tabla `empaquetados`. **No reaplicar.** Pendiente: la prueba inmediata del dueno con un usuario `venta` en una reserva de Sistema. Si falla, `rollback_225`.
- **Hotfix 224/225 CERRADO (2026-10-21):** prueba simulada de solo lectura en Produccion con un usuario `venta` real: `venta_ve_por_vista = 20` y `venta_ve_por_tabla = 0`. El conteo de `armado_empaquetados` no se vio (el editor solo muestra el ultimo resultado). La prueba con una reserva real de Sistema queda para el primer paquete que use esos vuelos.
  - Siguiente: **tarifa de infante (226)**, ciclo de diseno.
- **Tarifa de infante 226, gate del ciclo 1 (suplente):** el suplente resolvio 13 de las 15 preguntas (detalle en `bitacora-tarifa-infante-226.md`). Pendientes del dueno: Q3 (servicio sin precio de infante) y Q4 (infante en servicios por grupo).
- **Tarifa de infante 226: GO LOCAL** (suplente, 2026-10-21).
  - Respuestas del dueno: Q3 = servicio sin precio de infante cobra como adulto, con aviso; Q4 = el infante no cuenta en el rango de grupo y no paga extra.
  - Worktree `tarifa-infante-226`, rama `codex/226-tarifa-infante`; reserva en la seccion 9 de la bitacora (sin Bernalo).
  - #63 (227) espera a que la 226 este fusionada y aplicada.
- **Tarifa de infante 226, gate del ciclo 2 (2026-10-22):** el suplente repitio 399/399 TS y 3/3 React. Se ratifican P1-P3 y P5; P4 queda condicionada a la bateria SQL. GO a commit y PR Draft.
  - Tareas aparte: editar servicios de un contrato pendiente con infantes (`contratos/actions.ts`) y tours sueltos del carrito con infantes.
- **Tarifa de infante 226 CERRADA en codigo (2026-10-22):** PR #377 fusionado como `3cfe731c`. La 226 se aplico en Produccion despues del merge; hubo una ventana corta en la que el codigo leia columnas que aun no existian, y el aviso del suplente llego tarde. Postcheck OK 10/0/10. **No reaplicar.**
  - **Pendiente operativo del dueno:** cargar `precio_infante` en los servicios y `fee_infante` en los bloqueos, y regenerar los paquetes del aviso.
  - **Siguiente:** #63 (227), re-base sobre `3cfe731c`.
