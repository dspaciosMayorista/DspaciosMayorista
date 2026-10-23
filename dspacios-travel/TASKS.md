# TASKS.md - Dspacios Mayorista

Fuente unica de pendientes activos. Actualizado: 2026-10-21 (reorganizado por tipo de trabajo y carril). Los numeros son IDs estables; no se renumeran al cerrar tareas. La copia versionada en el repo es canonica y el espejo de coordinacion se mantiene sincronizado temporalmente.

Los cierres y antecedentes retirados estan en TASKS_ARCHIVE.md. Reservas, worktrees, migraciones y dependencias vivas estan en WORKSTREAMS.md (`C:\Users\Asus\Documents\Codex\coord-workstreams\dspacios-travel\WORKSTREAMS.md`, fuera del repo); este listado no autoriza codigo, PR ni SQL remoto por si solo.

## Como leer este archivo

- **Dos tipos de trabajo.** **Parte A - Auditorias:** tareas que todavia se estudian, se deciden o se disenan; las trabaja el chat de Auditoria (o el chat de coordinacion que figure como responsable). **Parte B - Codigo:** tareas que ya se escriben o ya se escribieron, repartidas en carriles.
- **Flujo.** Auditoria lista y GO del dueno -> la tarea pasa al carril indicado en su campo "Destino previsto" de la Parte B, conservando su ID -> validacion humana -> TASKS_ARCHIVE.md. Durante un cierre tecnico focal puede figurar temporalmente en A.1 con GO local explicito y reserva en WORKSTREAMS.md.
- **Carril = zona orientativa de la app.** Agrupa tareas que, segun las fuentes consultadas, tocan zonas parecidas; los carriles pueden tener cruces (ver el mapa de carriles) y NO garantizan que sus archivos esten separados. Trabajar dos tareas en paralelo solo se autoriza despues de comprobar y reservar los archivos, funciones, migraciones y dependencias concretas de cada una (WORKSTREAMS.md); pertenecer a carriles distintos no es esa autorizacion. Dentro de un carril hay subgrupos: los que dicen "comparten archivo pero no se pisan" se pueden separar si la reserva lo confirma y se concilia el archivo comun al integrar; los que dicen "en serie" van uno despues de otro.
- **Puntos comunes a TODOS los carriles:** `types/database.ts`, `package.json`, los cargadores de pruebas, la numeracion de migraciones y los documentos de coordinacion (`TASKS.md`, `CURRENT_GOAL.md`, `WORKSTREAMS.md`, `AGENTS.md`). Un unico editor por checkout; los worktrees aislados pueden avanzar en paralelo si cada reserva esta registrada, pero su integracion a `main` va en serie y exige conciliacion y pruebas nuevas. Los documentos de coordinacion solo los edita el Coordinador.
- **SQL final para Supabase:** preflight y postcheck que ejecuta el dueno deben devolver una sola fila `resultado` con veredicto, controles y datos necesarios juntos; no separar el veredicto del inventario en resultados distintos.
- **Fiabilidad de las listas de archivos.** "Reservados" sale de WORKSTREAMS.md (es una reserva real). "Citados en la tarea" o "probables" salen del texto de la tarea o del mapa archivado de 2026-10-04 (no son reserva). Antes de abrir un carril, confirmar rama y `git status`.
- **Cada tarea** muestra: Como va, Responsable, Espera a, Destino o Archivos, y las casillas abiertas (Falta). Debajo, plegado, queda el texto original completo (decisiones y antecedentes) sin recortar.
- **Leyenda de casillas** (texto original): `[ ]` pendiente, `[~]` en curso, parcial o integrado a la espera de validacion, `[x]` hecho. Una casilla `[~]` no cuenta como cerrada.

## Panorama (2026-10-21)

| Frente | Situacion |
| --- | --- |
| Codigo activo | #50 esta en Draft PR #375 (`7483efc8`), segunda corrida focal ROJA en G2 (215 OK/8 fallos de expectativas heredadas en bloques 4/6); ciclo 6 reservado al mismo ejecutor; NO GO Ready ni SQL remoto. #56 tiene GO focal para llevar la correccion `sel:` al Draft #366, no para Ready. #43-1a, #43-1b, #49 y #22 permanecen en ramas independientes sin PR. |
| Codigo en espera | #63 espera contrato tecnico corregido de Chat #4; despues va el grupo #40 E2/E3, aun sin GO. #16, #29 y #47 requieren reservas y dependencias. |
| Auditorias en curso | Chat #4 corrige el alcance de #63: salidas sin record de Empaquetados, no tipos de promocion. El Coordinador titular revisa directamente las bitacoras por tarea; ningun ejecutor hace SQL remoto. |
| Validaciones humanas abiertas | #67: check de destinos aereos y venta de Bloqueo; #68: directorio de clientes con rol administrativo y venta. #14, #38 y #30 conservan sus validaciones funcionales. |
| Repositorio | `main` local esta en `51ca079e` con documentos sin guardar; `origin/main` local en `0d360b39` incluye #67 y #68. Preservar cambios ajenos; no inferir que el checkout local ya los contiene. |
| Migraciones | 220 (#67) y 221 (#68) aplicadas en Produccion segun postchecks del dueno; NO reaplicar. 222/223 reservadas a #50 sin aplicar. 215 (#43-1a) y 218 (#56) reservadas sin aplicar; 204 reservada a contabilidad (#43). No usar `db push` ni `migration repair` por inferencia. Manda WORKSTREAMS.md. |

Seguimiento inmediato (heredado de la cola anterior): #30 B esta desplegado; validar el primer caso real sin crear datos artificiales. #14 y #38 conservan validaciones funcionales pendientes. Los demas pendientes conservan su ID y requieren gate propio.

Prioridades declaradas en los titulos: #42 bug de prioridad alta; #49 prioridad alta; #50 inmediatamente despues de #35. #53 es una correccion de seguridad puntual. La prioridad de las demas no cambia por esta auditoria.

---

# PARTE A - AUDITORIAS

Tareas que se estudian, se deciden o se disenan antes de escribir codigo. Ninguna de ellas autoriza codigo, worktree ni migracion por estar aqui; la base #32/214 ya fue integrada y aplicada, mientras sus consumidores #40/#42 conservan gates propios.

## A.1 En curso ahora

Auditoria o coordinacion activa en este momento.

### 56. SalesBot comercial multiproducto (bloqueos y porcion terrestre primero)

- **Como va:** SalesBot es multiproducto. Programas, Bloqueos y Porcion tienen consulta local; la conversacion guiada sigue en Draft PR #366. El arreglo focal de `sel:` ya exige pertenecer a la ultima lista visible y conserva la revalidacion en servidor. El Coordinador reviso el flujo y repitio las cuatro suites de conversacion: 88/88. GO para que el dueno incorpore este diff al Draft; NO GO Ready/merge/MVP validado hasta Actions sobre el nuevo SHA, conciliacion con `origin/main` `0d360b39` y prueba en navegador con sesion real. D8-D12 siguen: totales orientativos del motor vigente, solo el porcentaje B2B propio sin monto, sin add-ons en esta pieza, pestanas por producto y Bernalo despues. La 218 sigue reservada solo para el registro futuro, sin archivo ni SQL autorizado.
- **Responsable:** mismo ejecutor unico del chat independiente de SalesBot; reporta cada ciclo nuevo en `docs/coordinacion/bitacora-tarea-56.md`. El Coordinador titular revisa directamente y conserva `TASKS.md` y `WORKSTREAMS.md`; `salesbot-programas.md` y la bitacora de Auditorias quedan como antecedentes.
- **Espera a:** cerrar el defecto de seleccion y verificar la conversacion guiada en CI y navegador; las pruebas focales de paridad de Bloqueos/Porcion ya pasaron, pero no sustituyen esa validacion. El total es orientativo y no se promete silla ni habitacion; excluir mascotas y montos de comision hasta resolver la posible lectura incompleta de `pct_mk`/`impuesto_fijo` (H-PQ1). La lectura amplia de datos personales en `sillas` (H-VU1) requiere hotfix de privacidad aparte y comprobacion remota, sin exponer filas de sillas desde el bot. #57 ya esta fusionado en #371; antes de habilitar totales/base/comision de Programas en el bot, conciliar el codigo integrado y confirmar la validacion funcional y el residual B2B. La 218 exige gate propio de privacidad; no hay GO para SQL ni persistencia. #58 se resuelve antes de canales externos. Proveedor/modelo y tope de gasto son gate para encender IA. `min_pax`/`max_pax` de Programas no se comunican hasta revisarlos.
- **Siguientes productos:** Servicios espera la decision de paridad/precio #61 antes de mostrar total; Dinamico espera el cierre de vigencia #62 antes de entrar al bot. #60 es el arreglo de fondo del motor compartido para el riesgo de markup por grupo; no se implementa dentro de #56.
- **Destino previsto:** mismo worktree `codex/56-salesbot-programas` y Draft #366, sin invadir #39/#42. Cualquier escritura de leads/personas se secuencia con #42 y requiere gate separado.

**Gate de codigo vigente:** GO local al unico ejecutor de #56 para `buscarBloqueos`, `cotizarBloqueo`, `buscarPorcion` y `cotizarPorcion`, con lista blanca recursiva, errores sin detalle interno, sello de vigencia y pruebas focales de precio/cupos/acceso. Reserva: archivos nuevos `lib/salesbot/paquetes/{contrato,bloqueo,porcion,lectura}.ts`, pantallas bajo `app/(dashboard)/dashboard/salesbot/*` y `pruebas/salesbot56{Bloqueo,Porcion}*`; modificaciones solo en `lib/salesbot/contrato.ts` y la pagina de SalesBot. Los motores de tarifario/Booking se consumen sin editar. No tocar `reservar/actions.ts`, vuelos/sillas, `proxy.ts`, RLS, migraciones, `package.json` ni `types/database.ts`. #366 permanece Draft; sin staging, commit, push ni SQL remoto por el ejecutor. Q1 de Programas NO se ha ejecutado en Produccion. Ver `docs/futuro/salesbot-ventas-multproducto.md`.

**Gate del ciclo 1 #56 (2026-10-21):** `WORKSTREAMS.md` conserva las 13 rutas de conversacion y el workflow focal. La nueva fila de `bitacora-tarea-56.md` y la revision directa del Coordinador cierran la correccion de `sel:` para opcion y numero; 88/88 focales repetidas. El dueno puede hacer staging, commit y push al mismo Draft #366. La prueba de numero fuera de rango no repinta botones, y `combo:` se valida contra la oferta en servidor: observaciones de UX/alcance, no bloqueantes para este push. No abrir IA, persistencia/218, motores ni productos nuevos por esta ampliacion.

### 32. Base de identidad cerrada; consulta/autocompletado pendiente en #40/#42

- **Como va:** Base de identidad #32/214 integrada en PR #363 y aplicada en Produccion segun confirmacion del dueno. CI focal 71/71. Crea el registro central y la consulta segura, pero no importa historicos, no escribe desde cotizaciones ni agrega autocompletado a la interfaz.
- **Responsable:** Auditorias cerro la base; Chat #1 coordina el autocompletado interno #40 y Auditorias el modulo CRM de personas #42, cada uno con gate propio.
- **Espera a:** La base 214 no espera mas despliegue. #40/#42 deben consumirla con sus propias reservas, pruebas y permisos; 43-1a concilia `types/database.ts` despues de #32.
- **Destino previsto:** Carril 4 (Identidad y CRM). Sus consumidores #40 y #42 entran por el Carril 2 cuando #35 este integrado.

**Cierre de la base #32/214 (2026-10-18):** GitHub Actions sobre `d47eec0b` ejecuto esquema, migracion 214, SQL, API/RLS, carreras y rollback: 71 OK / 0 fallos. PR #363 fusionado como `862edf42`. El dueno confirma haber ejecutado en otro chat preflight, migracion y postcheck remotos con resultado OK; este chat no inspecciono esas salidas. Los trabajos de interfaz/consumo siguen en #40/#42 y no se consideran entregados por la 214. El relevo del Coordinador se registra en `docs/agents/COORDINATOR_HANDOFF.md`.

**Falta (casillas abiertas):**

- [ ] Seguimiento no bloqueante del hotfix 207 ya desplegado: comprobar en la app el CRM interno y el portal B2B. La sonda HTTP real se omitio por decision del dueno; no presentar el SQL de roles simulados como prueba HTTP. El cierre SQL/merge/Vercel esta en `TASKS_ARCHIVE.md`. #32/#42 siguen separados.
- [ ] Segunda comprobacion focal: medir en solo lectura duplicados por tipo, formato, tenant y NIT; verificar permisos efectivos de `crm_contactos` con roles internos/B2B antes de usarlo como fuente. Definir clave y normalizacion equivalentes en app y SQL, tratamiento de documentos historicos y precedencia por campo. Mostrar variantes y pedir eleccion; nunca fusionar ni sobrescribir automaticamente, ni copiar datos bancarios entre entidades.
- [ ] Poner el numero de documento primero en las listas y formularios pertinentes para consultar y autocompletar datos existentes. Auditar antes el modelo de identidad: tipo de documento, pais, tenant, duplicados y permisos; no asumir que el numero por si solo es una clave unica ni sobrescribir fichas por coincidencias ambiguas.

<details>
<summary>Detalle y antecedentes (9 lineas, sin recortar)</summary>

- [x] Decision del dueno (2026-10-06): la identidad documental se compara por TIPO y NUMERO de documento; igual numero con tipo distinto NO es un tercero duplicado. El numero es el dato inicial para buscar, pero no una clave unica por si solo. Conservar aislamiento por tenant en lectura y escrituras; coincidencias historicas ambiguas no se fusionan automaticamente.
- [x] Decision del dueno (2026-10-08) para #351: catalogo inicial de tipos de documento `CC`, `CE`, `TI`, `RC`, `PAS`, `PPT`, `NIT` aprobado. No aceptar tipos fuera del catalogo por normalizacion permisiva (por ejemplo, `CC2` no debe convertirse en `CC`).
- [x] #351 y migracion 202 integradas: `crm_leads` guarda tipo y numero, usa unicidad por tenant + tipo + numero y trata telefono/correo como coincidencias, no identidad unica. La app y la RPC rechazan tipos mal formados y edicion parcial. La 202 se aplico y verifico en Produccion; el alta manual funciono. Esto NO resuelve todavia clientes/pasajeros de cotizaciones (#42).
- [~] Auditoria de solo lectura recibida el 2026-10-05: pasajeros conservan tipo y numero; `ventas` no guarda tipo del titular; el carrito fuerza `CC`; `crm_contactos` no tiene tenant y su lectura para `authenticated` puede exponer datos a B2B. La observacion sobre leads sin tipo ya quedo corregida en #351; las demas fuentes siguen pendientes de #32/#42.
- [~] Coordinacion de auditoria consolidada el 2026-10-08: `Auditorias` identifico fuentes y cruces de #32/#42 en lectura local; falta medir duplicados historicos y permisos efectivos (tambien en remoto) antes de fijar normalizacion, precedencia y acceso por rol. Sin ejecutor de codigo ni migracion reservados; ver `docs/coordinacion/auditorias-identidad-crm.md`.
- [~] Segunda comprobacion focal local del 2026-10-08: migraciones 042/047 dejan `crm_contactos` sin tenant, con indices globales por documento crudo, correo y telefono; su policy local podria permitir lectura B2B si el rol conserva SELECT. La exposicion remota NO esta verificada. Migracion 187 busca pasajeros de contrato por tipo y numero literales; 202 normaliza solo leads. Las consultas de medicion recibidas son borradores con errores de sintaxis y no se ejecutaron. Preparar SELECT de agregados/privilegios validados, sin PII en resultados, y entregarlos al usuario uno por uno; no usar `crm_contactos` para autocompletar antes de resolver su acceso.
- [~] Verificacion de Produccion del 2026-10-10: `crm_contactos` tiene SELECT para `authenticated` y policy SELECT para `public` que solo exige UID, sin tenant ni rol aplicativo. Riesgo de lectura cruzada confirmado estructuralmente; falta prueba directa de tabla/API con sesion B2B real. Conteos agregados de fuentes/formatos registrados en `docs/coordinacion/auditorias-identidad-crm.md`, sin PII ni fusiones. Priorizar el cierre del acceso como incidencia separable. El dueno ya decidio: sin tipo+numero completos, ficha provisional sin deduplicar; NIT base identifica y DV separado; `aliados` sigue catalogo comercial sin fusion automatica; divergencias se muestran para correccion explicita; B2B solo ve personas de sus cotizaciones, internos por tenant/asignacion y superadmin/gerencia en ambos tenants. Falta disenar autorizacion que permita esa visibilidad sin abrir cotizaciones completas ni heredar la policy insegura.
- [x] Decisiones adicionales del dueno (2026-10-16): `venta` conserva documentos/demografia de pasajeros solo de contratos donde es asesor asignado, aunque vea datos comerciales basicos de colegas; B2B ve inicialmente personas de cotizaciones creadas por su usuario estable, no por todos los usuarios del aliado ni por `creado_por=email`; una identidad documental compartida entre aliados no le revela datos ni procedencia de las cotizaciones del otro. El perfil consolidado y las divergencias quedan para personal interno autorizado.
- [~] Gate #32: GO solo LOCAL con 214 reservada. Opus cierra primero el vinculo fuente-persona-observacion y su proyeccion por rol, la gramatica comun app/SQL con vectores y las transiciones/colisiones de estados; Auditorias revisa ese cierre sin nueva ronda de aprobacion del dueno. Luego implementa RLS/ACL, consulta 0/1/varias sin fuga y pruebas de roles/carreras. No crear persona ni vinculo por mero match documental ni hacer backfill automatico. PR solo tras #35 integrado y conciliacion con `main`.

</details>

### 42. (Bug, prioridad alta) Registrar en CRM clientes y pasajeros de todas las cotizaciones

- **Como va:** Auditorias entrego el contrato de escritura #42 sobre la base #32/214, ya fusionada y aplicada. G0 cerrado por confirmacion del dueno: compartio el preflight remoto (10 chequeos, 0 bloqueantes, P5=0), postcheck remoto (20/20, 0 fallos, sin backfill) y confirmo que reviso `p214_priv` fuera de Exposed schemas; no hay captura independiente archivada. G1/D-3=N2, D-4, D-5 y D-6, G3 (#39) y G4 (sello manual de #39) cerrados; D-1/D-2 no bloquean V1. G2 reservado en `WORKSTREAMS.md`: un Opus, worktree/archivos/workflow propios y migracion 219. Sin backfill.
- **Responsable:** Opus, unico ejecutor de codigo en el worktree #42; Auditorias revisa el contrato y la entrega.
- **Espera a:** Implementacion LOCAL y gate de diff/pruebas. El contrato fija `participante_ref` como ID estable; #42 reutiliza el sello manual `creado_por_id` de #39 sin redefinir su funcion. No hay GO de staging, commit, push, PR ni SQL remoto.
- **Destino previsto:** Carril 4 (modulo CRM) y Carril 2 (escrituras en cotizaciones, despues de #35).

**Falta (casillas abiertas):**

- [ ] Regla confirmada por el dueno: TODO cliente y todo pasajero identificado al crear o actualizar una cotizacion debe quedar consultable en el CRM, sea cotizacion de tarifario, carrito publico, Reservar/interna o dinamica/manual. El origen, canal, asesor, aliado y tenant se registran como procedencia, no como motivo para omitir la persona. No esperar a que la cotizacion se convierta en contrato.
- [ ] Disenar registro central de personas por tenant y documento/tipo segun #32, con vinculo idempotente a cada cotizacion/rol (titular o pasajero) y procedencia verificable. Cuando el formulario solo tenga cantidad de viajeros, NO inventar personas; registrarlas cuando se capturen sus datos, incluso si la cotizacion sigue abierta. Una correccion de titular/pasajero debe actualizar el vinculo sin mezclar identidades ni duplicar. Coordinar el esquema con #351 antes de integrarlo; no asumir que `crm_leads` o `crm_contactos` ya resuelven este caso.
- [ ] Mantener la consulta operativa del CRM separada del consentimiento de campanas: registrar una persona no implica `acepta_publicidad`. Respetar tenant y permisos de B2B/internos; no copiar datos sensibles a una tabla legible por todos los autenticados. La escritura debe ser confiable: transaccion o mecanismo durable/reintentable, errores visibles y pruebas de reintento, concurrencia, edicion y conversion; no un `insert` opcional que silencie el fallo.
- [ ] Inventariar en solo lectura cotizaciones historicas con personas identificables ausentes del CRM. Preparar reconciliacion idempotente con preflight, conteos, duplicados ambiguos y rollback; NO ejecutar backfill ni SQL remoto sin autorizacion separada. Probar titular y pasajeros de todos los flujos, cotizacion sin pasajeros identificados, mismo documento con distinto tipo/tenant y ausencia de consentimiento.
- [x] D-3 APROBADA por el dueno: N2. `venta` ve el contacto comercial del titular en su tenant; pasajeros solo de cotizaciones propias. No dar acceso a pasajeros de colegas por compartir tenant.
- [ ] D-1 y D-2 NO bloquean V1 y siguen sin aprobar: para retirar un pasajero se recomienda desactivar solo su vinculo y conservar persona/historial; para titular que viaja, una persona con dos roles si el documento esta completo y dos fichas provisionales sin documento. V1 no incorpora editor/retiro de pasajeros ni deduplicacion por inferencia; pedir decision antes de ampliar esos flujos.

<details>
<summary>Detalle y antecedentes (5 lineas, sin recortar)</summary>

- [~] `Auditorias` coordina el modulo operativo de personas de cotizaciones en CRM como frente independiente de la interfaz de venta de #39/#40. La 207 cerro el acceso anterior, pero no implemento identidad central ni vinculos; definir ese contrato con #32 antes de pedir codigo. Sin ejecutor, worktree, migracion o backfill reservados.
- [~] Diagnostico local del 2026-10-05: `crearCotizacion` en Reservar guarda titular y `payload.pasajeros` sin alta en CRM; `crearCotizacionManual` guarda el titular sin alta en CRM y al crearla solo conoce cantidades (`detalle.pasajeros` vacio). `actualizarTitularCotizacionManual` tampoco sincroniza CRM. El checkout publico intenta insertar solo al titular en `crm_contactos` y silencia errores/duplicados, por lo que tampoco garantiza la regla. La vista CRM de pasajeros actual consulta solo `contrato_pasajeros`; no muestra los de cotizaciones aun no convertidas. Esto es lectura de codigo local, no conteo de Produccion.
- [~] Auditoria local consolidada el 2026-10-08: confirma los tres flujos anteriores y que la conversion lee pasajeros de entrada o del payload; no hay conteos de Produccion ni permisos remotos comprobados. Espera el contrato de identidad/aislamiento de #32 y la secuencia de escrituras con #39 antes de reservar implementacion; ver `docs/coordinacion/auditorias-identidad-crm.md`.
- [~] Auditorias ya entrego conteos agregados de Produccion y contrato preliminar de #42: ficha provisional consultable cuando falte tipo+numero completos, vinculo idempotente a cotizacion/rol, un titular activo y correcciones trazables; no inventar personas desde cantidades. La 207 ya cerro el acceso anterior, pero falta fijar identificador estable de pasajeros y autorizacion trans-tenant explicita para superadmin/gerencia. #42 aun no tiene ejecutor, worktree, migracion ni codigo reservados. Sin backfill automatico.
- [~] Nueva auditoria de solo lectura encargada a `Auditorias` (2026-10-12): identificar el soporte real para un ID estable de pasajero por flujo de cotizacion y por edicion/reordenamiento/eliminacion, y proponer vinculo idempotente cotizacion-pasajero-rol sin usar el indice del arreglo como identidad. Entregar matriz, casos de concurrencia/correccion/conversion, riesgos, decision minima del dueno y prompt; solo editar su bitacora. No reservar ejecutor, codigo, migracion ni backfill para #42 mientras el hotfix y #32 sigan pendientes.

</details>

### 39. (Despues de #35) Editar servicios de una cotizacion

- **Como va:** Fase 1 CERRADA en Produccion: PR #365 fusionado (`9e4d1322`), Actions verde (59/59 fases, 13/13 carreras, 68/68 API, 119/119 TS), migraciones 216/217 aplicadas, postchecks 22/22 y 12/12, Vercel Ready y flujo manual validado por el dueno. El flujo conserva el pago previo, congelado y traspaso a abono al convertir. #39-1, edicion con pagos, queda como entrega independiente pendiente; el resto de notas de #39 abajo son antecedentes del gate ya cerrado.
- **Decisiones del dueno (2026-10-18), de negocio y no de seguridad demostrada:**
  - Recobro y precio: tras cualquier pago previo, aunque luego se anule, no se edita el recobro ni el precio en la fase 1. Congeladas e hijas comparativas tambien quedan fuera del editor de recobro/ninos (hoy ese editor si las cambia: se acepta el cambio de comportamiento); sus casos se trabajan aparte. #39-1 conserva su gate contable posterior al merge de #39. Sin modificar datos historicos.
  - Despliegue A/B: A es forward-only tras su primer uso real. Si B causa un incidente comprobado, retirarla requiere decision humana, mantener apagada la nueva edicion y correr postcheck, reconociendo que se reabren temporalmente las vias de escritura anteriores.
- **Decisiones adicionales aprobadas por el dueno (2026-10-18):** `venta` edita solo cotizaciones propias; el motivo de cada edicion es obligatorio; una cotizacion vencida requiere renovar vigencia antes de editar servicios; habra un interruptor para suspender solo la nueva edicion sin apagar pagos ni conversiones. El diseno debe probar como acredita autor estable y como renueva vigencia sin abrir un bypass; estas decisiones no prueban seguridad ni autorizan codigo.
- **Responsable:** Chat #1 coordina/audita; un solo Opus implementa localmente desde `main` `89b6f19d` en `.claude/worktrees/editar-servicios-39`.
- **Espera a:** Chat #1 reaudito la ronda 4 y dio GO pre-Draft; el Coordinador confirmo rama/base `89b6f19d`, indice vacio, hash del parche y `git diff --check`. Solo el dueno queda habilitado para staging, commit, push y Draft PR que dispare GitHub Actions. SQL/API/GraphQL/carreras/rollback y job TS en Linux aun NO se han ejecutado: Chat #1 auditara logs reales y cobertura de Gate 2 antes de Ready/merge. Antes de SQL remoto: cerrar N1 (configuracion efectiva de exposicion/search_path que C21/C22 no cubren), comprobar panel Data API > Exposed schemas y H6 P10=36 en preflight autorizado. No usar Docker en el PC ni probar escrituras en Preview que comparta Produccion. #14 conserva validacion funcional de su primer caso real.

**Decision A de renovacion (2026-10-18):** #39 no edita `reservar/actions.ts`, no cambia la accion `actualizarVigenciaCotizacion`, ni guarda `vigencia_hasta` ni su presentacion. Se puede renovar como hoy, pero renovar no habilita editar si C1/C2 lo impiden; autoria y PATCH directo de vigencia pertenecen a #40-vencimiento. `reservar/actions.ts` queda como superficie de regresion, no de escritura #39. La unica puerta de conversion sobre 198 pertenece a #39; #50 la extiende despues de B, sin duplicarla.

**Cruce con #50 (auditoria Chat #2, 2026-10-18):** la policy 154 permite UPDATE directo a roles internos y, por lectura de codigo aun sin prueba de explotacion, no protege las columnas del primer congelado ni `precio_venta`; eso podria forjar exigido/TRM sin pago. La migracion B de #39 debe probar y cerrar esta via antes de implementar #50. Una sola guarda por columna: #39 posee el congelado y #50 la modalidad NETO. Exigir prueba conjunta de PATCH directo, primer pago legitimo y conversion con ambos juegos de triggers.
- **Destino previsto:** Carril 2, subgrupo 2.1 (Cotizaciones), despues de #35.

**Falta (casillas abiertas):**

- [ ] Antes de implementar: integrar #14/tarjetas y su `hotelRef`; comprobar con consulta de solo lectura como estan enlazadas las lineas de tours en cotizaciones antiguas antes de usar su posicion como identificador. Definir una referencia estable para las nuevas, precio autoritativo y recomposicion de `payload`, `detalle` y total. La conversion actual no trata igual precios de hotel persona, Bernalo y tours: no prometer conservar siempre el precio hotelero cotizado sin resolver esa regla.
- [ ] Proteger edicion y conversion contra dos pestañas o solicitudes simultaneas (version esperada y transicion atomica), y conservar version anterior auditable. Validar tenant, estado, permisos y enlace publico. La fase 1 excluye manuales congeladas o con cualquier pago previo (activo, aplicado o anulado); proteger la edicion frente al primer pago (revision economica esperada y composicion comprobada al congelar) y frente a la conversion 198, sin cambiar su contexto `service_role` ni el tratamiento contable de los abonos. Probar editar/quitar, casos legados, carreras y conversion completa. El `trg_auditoria` existente no sustituye una version de negocio.
- [ ] Fase 1: el editor de recobro/ninos y cualquier cambio de precio se rechazan, en UI, acciones y base, en cotizaciones congeladas, hijas comparativas o con cualquier fila de pago previo (incluso anulada). Probarlo por llamada directa.
- [ ] #39-1, despues del merge de #39: edicion de cotizaciones manuales con pago previo. Entrega separada con sus propios controles contables (snapshot congelado, monto exigido, sobrepago, abonos al convertir); no implementar ni descongelar datos por inferencia.
- [ ] Permitir modificar o quitar servicios ya cotizados y recalcular el total y el documento sin perder la trazabilidad de lo que cambio. Hoy los servicios cotizados no se pueden editar. Revisar estados y permisos antes de permitir cambios sobre cotizaciones ya convertidas en contrato.

<details>
<summary>Detalle y antecedentes (2 lineas, sin recortar)</summary>

- [~] `Chat #1` coordina la siguiente auditoria/entrega de #39 sobre `main` `4aa2349b`; no hay ejecutor, worktree, archivos ni migracion reservados. Secuenciar cualquier codigo que toque cotizaciones con #35 de `Chat #2` y #42 de `Auditorias`; ver `WORKSTREAMS.md`.
- [~] Auditoria de solo lectura recibida el 2026-10-05 sobre `origin/main` `e6aa9fec`: `tarifario` guarda servicios en `payload.servicios`, `carrito` en `payload.tours` y `detalle.items`, y `manual` en `cotizacion_servicios`. La vista publica lee `detalle`; editar solo `payload` dejaria precio/documento incoherentes. El alcance propuesto de v1 solo para tours opcionales del carrito NO reemplaza la peticion de editar servicios cotizados en los otros flujos; decidir si se entrega por fases.

</details>

### 40. (Despues de #39 y #32) Cliente por documento y vencimiento de cotizacion

- **Como va:** H0+E1 quedaron FUSIONADOS en PR #372 (`b8182085`); #369 se cerro SIN merge. Esta entrega no crea clientes de contratos en Contactos: esa lectura operativa vive en #68, separada de campanas. E2 (documento como primer dato y busqueda en manual/carrito/tarifario) y E3 siguen sin GO de codigo ni migracion. Orden decidido por el dueno: cerrar #50, luego #63 y despues el grupo #40. La revision anterior repitio 84/84 focales; no afirmar que Actions ejecuto esas pruebas.
- **Responsable:** H0+E1 ya integrados; el Coordinador titular revisa directamente las siguientes entregas en `docs/coordinacion/bitacora-tarea-40.md`. El dueno transmite los prompts; Chat #1 queda como antecedente, no gate intermedio.
- **Decisiones D1-D3 (dueno, 2026-10-20):** `venta` solo ve titulares provisionales de cotizaciones propias; pasajeros ajenos siguen ocultos. La reutilizacion B2B opera solo desde cotizaciones posteriores al sello de autor 219, sin atribucion historica por correo. Ese mismo usuario B2B puede reutilizar titular y pasajeros de cotizaciones que el mismo creo, solo al crear una nueva; no accede a datos de colegas ni edita despues el titular.
- **Decision de alcance (dueno, 2026-10-20):** el autocompletado interno posterior a generar debe cubrir manual, carrito y tarifario; no limitarlo al `TitularEditor` manual. El mapa E2b de Opus solo cubria manual y necesita otra puerta de edicion para los demas tipos, sin saltar version/congelado, identidad, precio ni conversion.
- **Entrega parcial cerrada:** H0 (filtro `.or` de ficha CRM) y E1 (captura de contacto del tarifario) son los siete archivos de #372. Su reserva ya no habilita escrituras nuevas; E2/E3 necesitan contrato y reserva propios.
- **Espera a:** redisenar E2 para todos los tipos internos, con migracion/CI propios y pruebas de identidad, version, congelado, precio y conversion; E2c B2B conserva tenant/usuario propios y respuestas uniformes. `crm_contactos` con CC historico no confirma tipo y no es identidad automatica. E3 historial y vencimiento siguen separados. No ampliar H0/E1 a E2 por inferencia.
- **Destino previsto:** Carril 2, subgrupo 2.1 (formularios de cotizacion), despues de #35, #39 y #32.

**Falta (casillas abiertas):**

- [ ] Precisar en que flujos se elige vigencia: interno y manual ya la permiten al crear, y la ficha abierta permite cambiarla; el carrito publico usa un dia automatico. Decidir si el cliente B2C puede elegirla o solo un asesor, y si vencer bloquea la conversion o solo muestra un aviso. `vigencia_hasta` nula en cotizaciones antiguas no debe recibir fecha inventada; contar abiertas que quedarian vencidas antes de imponer la regla. El dia exacto de vencimiento sigue valido en Bogota.
- [ ] En el flujo de cotizacion, consultar y completar al cliente a partir de su documento, reutilizando la auditoria de identidad y permisos de #32; no asumir que el numero solo es una clave unica.
- [ ] Permitir elegir la fecha de vencimiento de la cotizacion y reflejarla de forma coherente en la vista y el documento. Definir validaciones y efecto del vencimiento antes de implementarlo.

<details>
<summary>Detalle y antecedentes (3 lineas, sin recortar)</summary>

- [~] `Chat #1` coordina #40 (consulta interna por documento y vencimiento) a partir de ahora; `Chat #2` conserva exclusivamente #35. La busqueda espera la fuente/consulta segura de #32; el vencimiento se puede auditar por separado, sin editar cotizaciones mientras #35/#39/#42 compitan por las mismas superficies. Sin ejecutor ni migracion reservados.
- [~] Auditoria previa de Chat #2 (2026-10-11), transferida a Chat #1: V1 de autocompletado del CLIENTE solo para personal interno en cotizacion manual/dinamica e interna; B2B, publico y `ProgramaReservaForm` fuera. Numero inicia la busqueda, pero se exige tipo y tenant para mostrar datos; 0 coincidencias permite captura manual, 1 ofrece aplicar sin sobrescribir cambios sin confirmacion, varias exige seleccion explicita, sin fusion automatica. No aprobar fuente/RPC provisional, minimo de caracteres ni tope silencioso de resultados: #32 debe entregar consulta y permisos seguros; si hay truncamiento, avisar y fallar cerrado. Descartar respuestas tardias al cambiar numero/tipo/tenant. La 207 cerro la lectura abierta anterior, pero no entrega por si sola el autocompletado seguro. Secuenciar codigo con #39/#35/#42; vencimiento se audita como entrega separada.
- [~] Auditoria de solo lectura sobre `origin/main` `e6aa9fec`: `buscar_pasajero_por_documento` (187) ya sirve para pasajeros, no para el bloque cliente. `crm_contactos` no es fuente segura para autocompletar cliente por tenant y el carrito fuerza tipo `CC`; verificar esto en la rama de integracion antes de reutilizar datos. La busqueda nueva debe limitar rol/tenant y evitar enumeracion publica o B2B; no fusionar coincidencias automaticamente.

</details>

## A.2 Auditoria hecha; esperan decision o un requisito

La auditoria principal ya existe; falta una decision, un prerequisito o aislar el trabajo.

### 41. (Despues de cotizaciones) Sillas de bloqueo al convertir una cotizacion en contrato

- **Como va:** Auditoria ampliada por lectura sobre `main` `014b8edf`: el nucleo de Vuelos 201 crea sillas en plazo y las confirma al confirmar la venta, pero `convertirCotizacionCarrito` deja `plazo = null` en venta y sillas; el cron 196 solo libera sillas con plazo vencido. El boton de confirmacion manual aparece a superadmin, gerencia, administracion y operaciones; la funcion `confirmar_venta` de la 197 no comprueba rol por si misma y depende de RLS. Esto contradice la regla aprobada de solo superadmin; el alcance efectivo por rol requiere prueba SQL antes de afirmar un bypass explotable. Siguen pendientes plazo, abono valido y transiciones al reducir o borrar abonos.
- **Responsable:** Por asignar.
- **Espera a:** Definir plazo y abono valido; probar permisos reales de confirmacion manual y carreras antes de codigo. #38 y #14 ya estan integrados, aunque conservan validaciones funcionales.
- **Destino previsto:** Carril 6 (Vuelos y sillas); cruza el Carril 2 en la conversion cotizacion -> contrato.

**Falta (casillas abiertas):**

- [ ] Hacer cumplir la decision del dueno: la confirmacion MANUAL corresponde solo a superadmin en pantalla y servidor/base. Primero probar en SQL la ruta directa con los cuatro roles visibles y `venta`; no tomar el boton como control de seguridad. Decidir aparte que constituye un abono valido (umbral, monto, conciliacion y pagos previos), duracion del plazo y efecto de borrar/reducir abonos. No cambiar `contrato_manual` por implicacion: auditarlo por separado.
- [ ] Antes de codigo, contar en solo lectura contratos existentes de carrito con `plazo` nulo y sillas retenidas; no hacer backfill automatico. Tomar como candidata, no como decision nueva, la regla vigente de confirmacion por abono que compara la suma con `config_cobros.pct_abono` (30% por defecto); decidir si tambien rige estas sillas. Probar carreras reales entre doble conversion, abono y liberacion, y baja de abono frente a confirmacion; disenar transiciones atomicas sin sobreventa ni abonos sobre contratos cancelados. Revisar numero de migracion vigente y repetir las carreras de la 201.
- [ ] Al convertir una cotizacion de bloqueo en contrato, poner las sillas de ese contrato en plazo, no confirmadas. Confirmarlas solo al registrar un abono valido o mediante accion manual del superadmin; no confirmarlas por el simple hecho de crear el contrato.
- [ ] Definir plazo, vencimiento, liberacion, permisos y efecto de abonos antes de implementar. Probar transiciones y concurrencia con el flujo de Vuelos 201; coordinar con cualquier trabajo activo en contratos, reservas, sillas o comisiones. No mezclar este cambio con #14.

<details>
<summary>Detalle y antecedentes (1 lineas, sin recortar)</summary>

- [~] Auditoria de solo lectura sobre `origin/main` `e6aa9fec`: el nucleo de Vuelos 201 ya crea las sillas del contrato `en_plazo` y confirma al confirmar la venta. Quedan riesgos distintos: conversion del carrito con `plazo` nulo (retencion sin vencimiento), plazo heredado ya vencido, edicion de `ventas.plazo` sin sincronizar `sillas.plazo`, y confirmacion manual que la interfaz oculta a `venta` pero la base 197 podria permitir por llamada directa. Verificar permisos con prueba SQL de rol antes de afirmar el acceso real.

</details>

### 43. (Independiente, en espera) Modulo contable propio y staging DIAN

- **Como va:** El chat multitarea aislo #43 en `.claude/worktrees/contable-43` sobre `014b8edf`, con 20 archivos nuevos sin staging; el rescate se leyo sin modificarlo. Reporta migracion 204 aplicada/idempotente en PostgreSQL local, parser 88/88, duplicados 44/44, permisos 47/47 y rollback corregido para retirar todas sus funciones. La migracion 204 permanece intacta y no aplicada remotamente. NO GO de PR/SQL: los roles contables propuestos no pueden leer PUC/proveedores/NIT con los permisos actuales; ampliar acceso a proveedores tambien expondria datos bancarios. La 204 agrega roles no reversibles y su numero precede a migraciones ya aplicadas. Separadamente, el preflight 208 detecto discrepancias historicas que requieren responsable contable, sin backfill automatico.
- **Anexo #43-1:** El dueno amplio el modulo a nomina, borradores de declaraciones, conciliacion general, exogena, auditoria DIAN, reportes y planeacion tributaria. Mayorista y minorista son empresas separadas; configuracion desde UI, facturacion electronica directa con DIAN, nomina electronica via DATAICO, PILA manual en Aportes en Linea y declaraciones presentadas manualmente. El anexo completo vive solo en el worktree de 43-1a: `docs/futuro/anexo-43-1-modulo-contable.md`. Dos entregas independientes (43-1a/b) estan implementadas LOCALMENTE; no son PR ni despliegue. Ver seccion 43-1 abajo.
- **Responsable:** Por asignar.
- **Espera a:** Decision del dueno y responsable contable sobre acceso seguro a PUC/proveedores/NIT, roles irreversibles y politica contable; verificar muestras sinteticas y plan de migracion fuera de orden. El worktree ya esta aislado; no ampliar permisos por inferencia.
- **Destino previsto:** Carril 5 (Contabilidad y comisiones).

**Falta (casillas abiertas):**

- [ ] El aislamiento en worktree propio ya se hizo; auditar ahora el diff final, roles, RLS, permisos, datos sensibles, scripts, pruebas y documentacion antes de PR. La hoja `contabilidad-dian-staging.md` aun debe conciliarse con el borrador 204. Confirmar numeracion/historia local y remota: la 204 es anterior a migraciones ya aplicadas, por lo que no usar `db push` ni `migration repair` automaticamente. Decidir con el dueno y responsable contable un unico ejecutor para cualquier cambio posterior. SQL remoto, incluso preflight, requiere autorizacion separada.
- [ ] Primera entrega acotada: staging DIAN por tenant con parser XML/AttachedDocument/Excel, lotes, identidad y deduplicado en base, documentos/lineas/impuestos/retenciones/formas de pago y resoluciones append-only; roles propuestos `contador`, `revisor_fiscal`, `admin_contable` con acceso solo al area contable. No guardar XML completo por defecto, no hacer backfill, no crear asientos, no tocar `asientos_contables`, PUC ni UI sin revision y reserva propias. Antes de integrar, resolver politica de aprobacion del contador, quien puede importar, muestras reales de retenciones y notas credito/debito, y catalogo de documentos soporte.
- [ ] Modulo independiente posterior: navegacion y permisos contables propios, bandeja de revision y conciliacion con fuentes administrativas, clasificacion PUC, aprobacion/posteo trazable, reconstruccion historica por corte elegido y cierres/informes. No duplicar registros maestros ni mezclar tenants. El staging 204 puede auditarse por separado de #30 B/208; cualquier enlace futuro con CxP, facturacion o asientos espera inventario de integridad y decisiones contables, incluido el defecto K15. Validacion normativa y tributaria corresponde al contador/revisor responsable.
- [ ] Conciliacion historica detectada por el preflight 208 en Produccion (2026-10-15): dos configuraciones de factura sin asiento vigente, 310 abonos minorista de 106 contratos sin asiento identificado por la consulta ($818.043.622) y un asiento de abono sin abono. La 208 los preservo; investigar con el responsable contable antes de cualquier correccion, sin backfill automatico ni inferir que todo el dinero este sin contabilizar por otras vias.

<details>
<summary>Detalle y antecedentes (1 lineas, sin recortar)</summary>

- [~] Antecedente revisado el 2026-10-12: el estado de continuacion del 2026-10-04 describe parser DIAN, diseno de staging y propuesta de migracion 204. El archivo `supabase/migrations/20260601000204_staging_dian_contable.sql`, preflight, postcheck, rollback, pruebas y documentos existen **sin rastrear** en `.claude/worktrees/vuelos-editar-rescate-20261008`, un worktree mixto de varios frentes. No estan en `origin/main` local `41992f8d`; la aplicacion remota no se verifico en esta revision. Las pruebas PostgreSQL/parser/roles del informe antiguo son reportadas, no repetidas ahora. La 204 queda reservada para este frente, no reutilizable ni lista para aplicar por el solo hecho de existir.

</details>

### 43-1. Anexo operativo del modulo contable

- **43-1a, calendario tributario y alertas:** implementado solo en `.claude/worktrees/contable-43-1a`, rama `codex/43-1a-calendario-tributario`. Migracion 215 reservada exclusivamente para esta entrega, creada en el worktree y NO aplicada remotamente; no siembra obligaciones. Configuracion por agencia desde UI, fechas anuales por digitos del NIT, vencimientos/presentacion/pago y seccion en correo diario que se omite si falla la lectura. Opus reporta logica/cableado 23/23, interaccion 7/7, SQL local 24/0 sin 204 y 30/0 con 204, idempotencia/rollback, typecheck y lint limpios; el Coordinador no repitio esas pruebas. Build no ejecutado.
- **43-1b, libro diario y balance de prueba:** implementado solo en `.claude/worktrees/contable-43-1b`, rama `codex/43-1b-libros-contables`, sin migracion. Libro diario paginado con filtros, errores visibles, comprobantes y CSV; balance de prueba desde asientos con saldos y CSV. Opus reporta logica/cableado 17/17, interaccion 7/7, typecheck y lint limpios; no repetidos por el Coordinador. Build no ejecutado.
- **Gate de integracion:** sin staging, commit, push, PR ni SQL remoto. Revisar diffs y permisos antes del gate de PR, actualizar cada rama contra `main` vigente sin perder cambios, conciliar en serie `app/(dashboard)/layout.tsx` y `lib/supabase/fetchAllPaginado.ts` entre 43-1a/b, y `types/database.ts` de 43-1a con #32. Registrar `calendarioTributario.react.ts` y `librosContables.react.ts` en `package.json` al integrar, tras confirmar la reserva de ese archivo. Ejecutar build sobre el diff final antes de PR. Para 43-1a: preflight 215 -> aplicacion por el dueno -> postcheck de una sola fila -> merge/despliegue; 43-1b no tiene migracion. No usar `db push` ni `migration repair` por inferencia.
- **Accesos:** la UI de estas dos entregas queda limitada a superadmin, gerencia y administracion hasta integrar los roles contables de #43. No ampliar permisos de PUC/proveedores/NIT ni afirmar que el modulo contable completo esta listo.
- **Siguientes entregas propuestas, sin codigo ni numeros reservados:** 43-1c reglas contables y tipos de documento (necesita migracion nueva; 216 NO reservada); 43-1d estados financieros desde el libro (depende de 43-1b); 43-1e conciliacion bancaria general contra el libro (43-1b); 43-1f auditoria DIAN (#43/204 integrado); 43-1g nomina y seguridad social (43-1c); 43-1h borradores de declaraciones (43-1c/d); 43-1i exogena (#32 integrado); 43-1j reportes configurables (43-1d); 43-1k planeacion tributaria (43-1d/h). Cada entrega requiere gate y reserva propios; validacion normativa del contador/revisor.

## A.3 Diseno o decision del dueno antes de codigo

Son pendientes de implementacion o de politica que no pueden empezar sin acordar primero el diseno o la regla de negocio.

### 36. (Futura) Politica de cambios de fechas y horarios de vuelos

- **Como va:** Decision pendiente del dueno. Auditoria por lectura de `main` `014b8edf`: `actualizarBloqueo` y `registrarCambioOperacional` escriben los mismos ocho campos; solo el segundo registra historial y hoy el cambio y su historial no son atomicos. Los contratos ya creados conservan una copia en `contrato_vuelos`; falta decidir si se propaga o solo se avisa. #1 (formulario Editar bloqueo) esta cerrado y este seguimiento no lo reabre.
- **Responsable:** Sin responsable asignado en las fuentes.
- **Espera a:** Decision del dueno y auditoria del efecto en pasajeros, contratos y trazabilidad.
- **Destino previsto:** Carril 6 (Vuelos y sillas).

**Falta (casillas abiertas):**

- [ ] Decidir si fechas, horas y numero de vuelo salen de `EditarBloqueoForm` y pasan exclusivamente por Cambio operacional; decidir si el cambio se propaga a `contrato_vuelos` o si solo genera aviso. Si se implementa, hacer atomicos el cambio y su historial mediante RPC nueva, sin editar migraciones anteriores. Verificar si una cotizacion abierta se reliquida con datos nuevos al convertir y si comunica cualquier cambio de precio. Este seguimiento no reabre el cierre visual de #1.

### 37. (Futura) Decisiones D5/D6 del traslado de pasajeros

- **Como va:** D5/D6 ya tienen comportamiento provisional en `mover_pasajero` (migracion 194), pero no aprobacion final del dueno. Confirmarlo no requiere codigo; pedir selector de silla para D6 si requeriria migracion y cambios en la accion y pantalla. El cierre de #3 no aprobo estas reglas.
- **Responsable:** Sin responsable asignado en las fuentes.
- **Espera a:** Decision del dueno; revisar concurrencia e historial antes de cambiar algo.
- **Destino previsto:** Carril 6 (Vuelos y sillas).

**Falta (casillas abiertas):**

- [ ] D5: confirmar o cambiar la regla vigente que permite mover pasajeros con datos pero sin contrato; incluir el caso de carga masiva y retenciones en plazo. No asumir que el cierre de #3 aprobo la regla de negocio.
- [ ] D6: confirmar o cambiar la seleccion automatica de la primera silla libre real por numero en modo `solo_datos`, frente a ofrecer un selector de silla. No cambiar el comportamiento sin revisar concurrencia e historial.

### 6. Tarjetas de Vista Booking y otras vistas

- **Como va:** La fase 1 del rediseno (encabezado, pestanas, buscadores y filtros) esta cerrada en PR #327. Falta acordar con el dueno el detalle visual de las tarjetas; modal y carrito se revisan por separado.
- **Responsable:** Sin responsable asignado en las fuentes.
- **Espera a:** Acuerdo visual con el dueno.
- **Destino previsto:** Carril 2, subgrupo 2.2 (Vista Booking). Comparte VistaBooking.tsx con #35: va despues.

**Falta (casillas abiertas):**

- [ ] Rediseñar las tarjetas tras acordar el detalle visual con el usuario; el shell y los buscadores de la fase 1 ya están cerrados en PR #327.
- [ ] Conservar precios, disponibilidad, lógica de filtros, identidad `(hotelId, paqueteId)` y fuentes de datos. Modal y carrito se revisan por separado; no asumir que la fase 1 los rediseñó.
- [ ] Abordar las demás vistas después de cerrar el alcance de tarjetas.

### 18. Investigar hotel 217 ausente en Vista Booking

- **Como va:** Hipotesis nueva, no verificada con los datos del caso: sin busqueda ejecutada, Porcion terrestre muestra solo hoteles de prioridad 1 o 2 del paquete (`lib/tarifario/recomendados.ts`); filtrar por texto no amplia ese conjunto. Consultar en solo lectura la prioridad del hotel 217 en el paquete 50 y reproducir una busqueda con fechas validas antes de atribuir un defecto. El PR #322 aclaro que su zona 'Bocagrande' es un dato, no un defecto.
- **Responsable:** Sin responsable asignado en las fuentes.
- **Espera a:** Diagnostico en Vercel Preview antes de tocar generacion, vigencia o identidad categoria/regimen.
- **Destino previsto:** Diagnostico (Auditoria). Si resulta un defecto, Carril 2, subgrupo 2.2.

**Falta (casillas abiertas):**

- [ ] Diagnosticar por que el hotel 217 no aparece en Porcion terrestre sin destino o buscando `odair`.
- [ ] Trazar en Vercel Preview: `tarifario_resumen` -> filtros post-carga -> `TarifarioPublic` -> `VistaBooking` -> tarjetas.
- [ ] Comprobar `armado_hoteles.prioridad` para hotel 217/paquete 50 y luego ejecutar la busqueda con fechas dentro de la ventana de compra. Si sigue ausente, revisar vigencia post-carga y minimo de noches; no cambiar el comportamiento de recomendados solo por la busqueda de texto.
- [ ] No cambiar generacion, vigencia ni identidad categoria/regimen sin reproducir primero el descarte real.
- [ ] Fixture confirmado de produccion: hotel 217, paquete 50 activo, modelo persona, SAN ANDRES, 28 filas en `tarifario_resultado`, 4 filas en `tarifario_resumen`, 2 noches, Estandar/Superior, PAE/FULL y procedencia Promocion.

<details>
<summary>Detalle y antecedentes (1 lineas, sin recortar)</summary>

- Nota (PR #322, diagnostico de datos, no defecto): el mismo hotel 217 "Odair Dubai prueba" pertenece a SAN ANDRES pero `hoteles.zona` = "Bocagrande" (zona real de Cartagena); el filtro de Zona reflejo correctamente el dato almacenado y no se modifico la base. Ver `DECISIONS.md` ADL-024. No cierra ni sustituye este pendiente (la ausencia en Porcion terrestre sigue sin diagnosticar).

</details>

### 8. Soporte unidad para paquetes dinamicos

- **Como va:** Auditoria por lectura de `main` `014b8edf`: el motor Bernalo no resuelve una salida dinamica de tipo `salida` para hoteles unidad. Requiere contrato de calculo, cotizacion y disponibilidad antes de habilitarlos; mientras tanto siguen excluidos o no compatibles. No confundirlo con #16/#17, donde la cotizacion ya funciona y falta convertir.
- **Responsable:** Sin responsable asignado en las fuentes.
- **Espera a:** Disenar resolucion Bernalo de salidas dinamicas y coordinar los archivos de checkout/Vista Booking con #35. #9 no define este contrato.
- **Destino previsto:** Carril 2, subgrupo 2.4 (Hoteles unidad y paquetes).

**Falta (casillas abiertas):**

- [ ] Implementar soporte real de `salidas_dinamicas` y cotizacion antes de anunciar hoteles unidad de paquetes `dinamico`.
- [ ] Mantenerlos excluidos o marcados como no compatibles hasta completar la integracion.

### 9. Soporte unidad para paquetes de servicios

- **Como va:** La premisa del pendiente no coincide con el modelo actual: el armado de paquetes `servicios` no ofrece hoteles de ningun modelo. No iniciar soporte unidad antes de que el dueno decida si ese tipo de paquete debe admitir hoteles en general o si se cierra esta tarea.
- **Responsable:** Sin responsable asignado en las fuentes.
- **Espera a:** Decision del dueno sobre permitir hoteles en paquetes `servicios`; no es solo integrar el modelo unidad.
- **Destino previsto:** Carril 2, subgrupo 2.4 (Hoteles unidad y paquetes).

**Falta (casillas abiertas):**

- [ ] Confirmar si el producto `servicios` debe poder incluir hoteles de cualquier modelo. Si no, cerrar #9 sin codigo; si si, disenar primero el soporte general de hoteles para ese tipo y despues el de unidad. No activar cotizacion parcial por inferencia.

### 17. Integrar hoteles unidad con vuelos y bloqueos

- **Como va:** La cotizacion de hoteles unidad con salidas de bloqueo ya existe; la conversion a contrato se detiene en `validarBernaloParaConversion`. Integrarla requiere revisar la RPC de pasajeros y sillas de la 201; no levantar la guarda sin esa prueba. Cruza el nucleo de Vuelos.
- **Responsable:** Sin responsable asignado en las fuentes.
- **Espera a:** Diseno y prueba de conversion con la RPC de sillas 201, y reserva de `reservar/actions.ts` despues de #35; coordinar con el Carril 6. #8/#9 no bloquean esta conversion.
- **Destino previsto:** Carril 2, subgrupo 2.4, y Carril 6 (Vuelos y sillas).

**Falta (casillas abiertas):**

- [ ] Integrar y validar la conversion de hoteles `modelo_tarifario = "unidad"` con vuelos, salidas y bloqueos sin romper asignacion de pasajeros, sillas, CxP ni precio. Coordinar `reservar/actions.ts` con #35 y probar concurrencia de sillas antes de quitar la guarda.

## A.4 Solicitudes nuevas (empiezan por una auditoria corta)

Pedidos recientes del dueno; cada uno pide auditar antes de tocar codigo.

### 57. Programas: paridad de precio cobrado y base comisionable B2B

- **Como va:** codigo fusionado en PR #371 como `a4c999cf` (2026-10-20); `main` local actualizado por fast-forward. El dueno informa trabajo con auditor sustituto. Esta pendiente confirmar Vercel Production Ready/Current y prueba funcional real; no inferirlas del merge. El alcance es hacia adelante: precio mostrado y cobrado iguales con los mismos datos, o nuevo precio y confirmacion explicita si cambia el catalogo, sin recalcular historicos.
- **Responsable:** implementacion de Opus terminada; Coordinador conserva seguimiento de Produccion y del residual de base/comision B2B. El worktree de `codex/57-programas-precio-paridad` no se reutiliza por inferencia.
- **Q1 cerrado para implementar:** si la salida tiene `noches`, usarlas; si son NULL, usar `programa.dias`, igual que la ficha (no `dias-1`). El fee bancario integra el PVP segun `pvpPrograma`, pero no es impuesto. `impuesto` representa solo el importe fiscal configurado y verificable; `pct` reduce base comisionable pero no acredita un impuesto; `ninguno` no aporta impuesto. Nunca deducir `ventas.impuesto` de `montoNoComisionable`. Si falta fuente fiscal confiable, no inventar 0 ni prometer base/comision B2B corregida: documentar el residual y detener esa parte para decision.
- **Espera a:** validacion funcional en Produccion de precio mostrado, cambio de catalogo con reconfirmacion y contrato resultante; comprobar por separado si la base/comision B2B quedo resuelta o mantiene residual. #50 puede conciliar el codigo integrado, pero sigue sin GO de escritura ni numero de migracion propio.
- **Destino previsto:** carril de Programas y Reservar, independiente de #56.

### 58. Programas: auditar lectura anonima de costos y borradores

- **Como va:** #56 senala policies SELECT abiertas de 031/068 y posible acceso `anon` por Data API a netos, tarifas, reglas internas y programas no publicados; es un hallazgo por lectura local, NO verificado en Produccion.
- **Responsable:** por asignar; #56 no cambia permisos.
- **Espera a:** verificar grants y policies efectivos en Produccion con resultados agregados, sin exponer costos en la respuesta. Disenar cierre con RLS/ACL y una lectura publica de campos permitidos que conserve vitrina, ficha y cotizacion. Migracion y ejecutor propios solo tras auditoria; antes de abrir canales publicos del bot.
- **Destino previsto:** seguridad de Programas/Data API; no mezclar con #57 ni con migracion de conversaciones de #56.

### 59. Auditar borrado y reconversion de contrato manual con pagos previos

- **Como va:** Chat #1 reporta por lectura un riesgo previo a #39: `eliminar_contrato` reabriria la cotizacion manual convertida, borraria abonos y dejaria pagos previos en estado `aplicado`; una reconversion podria crear contrato sin esos pagos. No se ha probado en PostgreSQL ni en Produccion; #39 no habilita edicion de esa cotizacion.
- **Responsable:** por asignar, auditoria focal contable; no cargarlo al mismo Opus de #39 durante el cierre pre-Draft.
- **Espera a:** reproducir sobre esquema desechable en GitHub Actions, comprobar pagos/asientos/abonos antes y despues y decidir bloqueo o reparacion segura con el dueno. Hasta entonces, no usar borrado y reconversion de manuales con pagos como procedimiento de correccion.
- **Destino previsto:** integridad financiera de contratos, separado de #39/216/217.

### 60. H-PQ1: markup de servicios incluidos por grupo en Reservar

- **Prioridad:** preventiva, no hotfix urgente con el inventario actual. Subirla si aparece un paquete activo con servicio incluido por grupo y markup positivo, o si se demuestra un cobro afectado.
- **Como va:** #56 reprodujo en simulacion una diferencia de 125.000 frente a 100.000. `computarReserva` lee `armado_paquetes.pct_mk` con la sesion y convierte una fila invisible o un error en 0; los servicios incluidos por grupo se cobran despues con ese valor. No se verifico en Produccion.
- **Responsable:** por asignar; #56 solo documenta y mitiga parcialmente dentro del bot.
- **Sonda de Produccion (confirmada por el dueno, 2026-10-19):** 0 paquetes activos con servicio incluido por grupo, 0 con markup positivo, 0 comprables hoy con markup y 0 servicios incluidos por grupo. Esto mide el inventario actual; no audita ventas historicas ni elimina el fallo abierto del motor.
- **Espera a:** reproduccion focal por rol y correccion del motor que falle cerrado ante error o fila invisible, con paridad de precio, contrato y CxP. Revaluar exposicion si cambia el inventario. No reutilizar la migracion 218 ni editar el motor dentro de #56.
- **Destino previsto:** precio y venta de paquetes; comparte `lib/reservar/computo.ts` con #61/#62, por lo que el codigo se integra en serie.

### 61. H-SV1: paridad de servicios sueltos entre Reservar y checkout

- **Prioridad:** alta para auditoria; subir a hotfix si una prueba con temporada vigente muestra diferencia de cobro o proveedor/CxP incorrectos.
- **Como va:** por lectura, la rama `servicios` de `computarReserva` deja `meta.fecha_ida = null` y omite el calculo estacional; el checkout usa `liquidarServicioPuntual`. La lectura de categoria/proveedor con sesion puede devolver 0 filas para `venta`. No hay reproduccion funcional ni verificacion en Produccion.
- **Responsable:** por asignar, independiente de #56.
- **Espera a:** prueba de paridad con igual servicio, fechas, pasajeros y temporada GENERAL/especifica; prueba de rol `venta`, clasificacion, proveedor y CxP. No mostrar total de Servicios en el SalesBot hasta decidir esta divergencia; su mapeo sin precio puede avanzar separado.
- **Destino previsto:** precio y venta de servicios; codigo en serie con #60/#62 por `lib/reservar/computo.ts`.

### 62. H-DI1: vigencia y estado de salidas dinamicas

- **Prioridad:** alta para auditoria y gate de Dinamico en SalesBot; hotfix si una salida vencida o desactivada se ofrece o vende en prueba focal.
- **Como va:** por lectura, la generacion del tarifario filtra `salidas_dinamicas.activo` pero no su ventana de compra; el cargador descarta salidas pasadas pero solo revalida la vigencia de empaquetados; `computarReserva` tampoco revalida la salida. No verificado en ejecucion ni en Produccion.
- **Responsable:** por asignar, independiente de #56.
- **Espera a:** reproducir salida activa fuera de compra y salida desactivada despues de generar tarifario, comprobando vitrina y venta con rechazo en servidor. Dinamico no entra al SalesBot hasta cerrar este gate; no añadir un filtro propio al bot como sustituto del motor.
- **Destino previsto:** vigencia de paquetes dinamicos; comparte `lib/reservar/computo.ts` con #60/#61, integrar en serie.

### 63. Salidas sin record de Empaquetados en paquetes dinamicos y componentes en COP

- **Incidencia funcional reportada por el dueno (2026-10-22; pendiente de reproducir):** un paquete Dinamico con salidas de Empaquetados informa 433 filas al generar, pero la tarjeta exterior indica 63 publicadas; el paquete no aparece al filtrar por el destino de los vuelos ni en Recomendados, aunque tiene numeros configurados, y no se logra iniciar la reserva. El dueno repitio la prueba con el paquete nacional **ID 54** y tampoco aparece en ninguna vista: ya no se explica solo por combinar destinos de ciudades distintas. Auditar primero el commit realmente desplegado, luego el conteo por estado/generacion, publicabilidad, selector de destinos del hotel y de cada vuelo, filtros de vitrina/Recomendados y flujo completo hasta `computarReserva`. No asumir que 433/63 sea por si solo un bug ni hacer reservas de prueba en Produccion.
- **Evidencia parcial (SQL ejecutado por el dueno, 2026-10-22):** el ID 54 esta activo, `tarifario_snapshot_publicable=true`, modo `cop_trm_63`, TRM 3200; tiene 23 filas base y 23 en la vista publicable, resumidas en 4 combinaciones, todas `dinamico` para SANTA MARTA (destino_id 8), con una salida vinculada. El 23/4 concuerda con filas por acomodacion frente a combinaciones; la desaparicion ocurre despues de publicar. Lectura de codigo del titular: `/tarifario` incluye pestaña `Salidas dinamicas`, pero `lib/tarifario/resumen.ts` arma `paqIdsConHotel` solo con Bloqueo/Porcion y con ellos carga Recomendados; Dinamico queda fuera de esa seccion aun con prioridad. Pendiente auditar filtros posteriores y despliegue antes de atribuirles la ausencia en la pestaña.
- **Prioridad:** urgente para venta; contrato tecnico en curso con Chat #4, sin GO de codigo ni SQL remoto.
- **Decision del dueno (2026-10-20):** NO dividir en una F1 interna solo COP. Mantener #63 unido hasta cubrir el caso original de venta: multiples salidas sin record de `empaquetados`, revisadas/agregadas manualmente, conservando el alta manual; paquete mixto USD/COP con TRM obligatoria, netos USD convertidos a COP y tarifa publicada en COP; reventa aerea COP sin segundo markup; traslados y tours dinamicos comunes a todas las salidas. La propuesta F1 COP de Chat #4 es antecedente tecnico, no entrega aprobada ni GO de codigo.
- **Como va:** en los tiquetes NO existe un tipo ni estado de promocion. "Promocion" es solo la etiqueta visual de una salida sin record proveniente de `empaquetados`; no disenar un motor de descuentos ni filtrar por supuesto estado promocional. El dueno pide conservar el alta manual de salidas dinamicas y agregar esas salidas de sistema con datos precargados y vinculo real. Un paquete dinamico puede tener multiples salidas elegibles de destinos aereos autorizados por #67; cada una conserva vuelo, fechas y precio propios. Las nuevas aparecen para revision y solo se incorporan por accion expresa, seguida de regeneracion del tarifario; nunca se publican automaticamente. Auditar por que la etiqueta puede cambiarse y si debe fijarse. No incluir vuelos de contratos. Cada salida usa `tarifa_para_empaquetar` (reventa COP) sin segundo markup/TA. Si el paquete combina USD y COP, exigir TRM por paquete, convertir netos USD a COP y publicar en COP. Traslados y tours dinamicos se configuran una sola vez para todas las salidas.
- **Responsable:** Chat #4 coordina diseno y gate; ejecutor unico de codigo por reservar tras cerrar contrato tecnico y cruces.
- **Espera a:** Chat #4 entrega un unico contrato tecnico actualizado: fuente = salida sin record de `empaquetados`, no tipo de promocion; persistencia de origen, TRM/componentes, importacion multiple, deduplicacion y nuevas salidas; separar reventa aerea de netos sujetos a markup y demostrar proveedor/CxP, snapshot, tarifario, checkout, reserva, cambios y vencimiento. Cerrar H/T/R/F tambien para USD/COP y editor. El generador hoy prohibe mezclar monedas; precargar el formulario no basta. #62, #57 y #67 ya estan integrados (`origin/main` `0d360b39`); reutilizar la configuracion 220 de destinos aereos y conciliar el codigo vigente antes de reservar escrituras. No incorporar Dinamico al SalesBot #56 antes de validar toda esta ruta.
- **Destino previsto:** paquetes dinamicos; requiere auditoria focal y reserva propia de archivos, workflow y migracion antes de codigo.

### 64. Cotizacion dinamica a medida: hoteles de tarifario, vuelos de sistema y servicios no negociados

- **Como va:** Solicitud del dueno (2026-10-20), sin auditoria ni codigo. Debe existir un recorrido desde el tarifario hacia una cotizacion dinamica que permita combinar un hotel del tarifario con vuelos empaquetados de sistema y agregar libremente servicios adicionales que no esten negociados ni cargados en el catalogo. Hoy el dueno no encuentra ese recorrido. Esto NO es el armado/publicacion de promociones dentro de un paquete dinamico de #63.
- **Responsable:** por asignar tras auditoria del flujo real.
- **Espera a:** comprobar que datos del hotel y del vuelo se pueden seleccionar y conservar de forma verificable, que la cotizacion resultante puede continuar a compra/contrato y como se capturan precio, costo, proveedor, fechas y condiciones de un servicio no negociado. Coordinar con #35/#39/#50 y #63 antes de reservar superficies compartidas; no asumir que el vuelo promocional o un servicio libre heredan disponibilidad, moneda, impuestos o reglas financieras del catalogo.
- **Destino previsto:** Carril 2, cotizaciones y tarifario; reserva de codigo y migracion solo tras contrato tecnico.

**Falta (casillas abiertas):**

- [ ] Mapear el recorrido actual y precisar el punto donde se eligen hotel de tarifario y una o varias salidas/vuelos empaquetados de sistema para la misma cotizacion, sin confundirlos con vuelos de contrato ni limitarlo a un unico vuelo por inferencia.
- [ ] Permitir agregar a demanda servicios adicionales no negociados, con captura explicita de datos comerciales y operativos necesarios, sin inventar una negociacion o proveedor confirmado; distinguirlos de servicios de catalogo.
- [ ] Definir y probar precio, moneda/TRM cuando aplique, vigencia, disponibilidad, total, documento, conversion, costos/CxP y permisos del flujo mixto antes de publicarlo o venderlo; no reutilizar el calculo de #63 sin prueba de paridad.

### 65. Portal B2B: pestanas funcionales, cartera y documentos

- **Como va:** Solicitud del dueno (2026-10-20). Las pestanas del portal B2B no llevan al contenido esperado; faltan acceso funcional a cartera, descarga del PDF del contrato e informacion de contacto. La ficha editable de la agencia y su estado de acceso se coordinan con #66, no se duplican aqui.
- **Responsable:** por asignar; primero auditar rutas, datos y permisos existentes.
- **Espera a:** definir la fuente autoritativa y el significado de cartera para cada aliado, comprobar la generacion/descarga vigente del PDF y aislar contratos, saldos y contactos por aliado y tenant. Coordinar documentos con #35/#47 y permisos con #31/#33/#66; no presentar como saldo de cartera una suma no conciliada.
- **Destino previsto:** portal B2B y documentos; codigo solo con reserva propia.

**Falta (casillas abiertas):**

- [ ] Hacer que cada pestana visible navegue a su contenido real o retirarla hasta que exista; comprobar teclado, movil, enlace directo y permisos.
- [ ] Agregar la pestana Cartera con contratos, movimientos y saldos propios del aliado segun fuente contable validada, y permitir descargar el PDF correcto de cada contrato autorizado.
- [ ] Mostrar informacion de contacto util en el portal; distinguir datos de contacto de D'spacios de los datos editables de la agencia (#66), sin exponer datos de otros aliados.
- [ ] Coordinar con #74 la generacion de cotizaciones con marca/logo de la agencia cuando ella misma emita el documento desde el portal; no confundir con la descarga del contrato existente.

### 66. Datos de agencia y control de acceso B2B

- **Como va:** Solicitud del dueno (2026-10-20). La agencia debe poder editar ciertos datos propios desde el portal B2B; personal autorizado debe poder editar la ficha desde Aliados y cambiar su estado entre activa, desactivada e inhabilitada. En estado sin acceso debe quedar bloqueado su ingreso/enlace a la plataforma. Revisar tambien la validacion del correo usado para el registro; no asumir que formato valido equivale a correo verificado o a identidad del aliado.
- **Responsable:** por asignar tras auditoria de modelo de aliado, usuarios B2B e invitaciones/enlaces.
- **Espera a:** fijar por campo quien puede editar y que significa cada estado para usuarios ya vinculados, sesiones existentes, invitaciones y reactivacion. Confirmar el efecto sobre acceso con controles del servidor y de datos, no solo ocultando botones o enlaces. Preservar contratos y trazabilidad historica; coordinar con #31/#33 y la ficha que muestra #65.
- **Destino previsto:** Aliados, portal B2B y autenticacion; requiere gate de seguridad y reserva propia antes de codigo o SQL.

**Falta (casillas abiertas):**

- [ ] Definir y probar la lista de campos editables por la agencia, los reservados a personal interno y el historial/autorizacion de cada cambio en portal y Aliados.
- [ ] Permitir a personal autorizado activar, desactivar o inhabilitar la agencia; impedir ingreso y uso de enlaces mientras el estado lo exija, incluso con sesion previa o URL directa, sin borrar contratos ni vinculos historicos.
- [ ] Auditar registro y cambio de correo: normalizacion, formato, duplicados, verificacion de propiedad y relacion estable entre usuario y aliado; definir mensajes y recuperacion sin revelar cuentas ajenas.

### 67. Seguimiento: destinos aereos alternativos en Bloqueo/Sistema

- **Estado (2026-10-21):** Bloqueo/Sistema fusionado en PR #374 (`0d360b39`), migracion 220 aplicada en Produccion por el dueno y postcheck OK 12/0/12 tras corregir la copia UTF-8. NO reaplicar la 220. Falta prueba funcional del dueno: check apagado/encendido y venta real de Bloqueo. Dinamico sigue en #63.
- **Problema comprobado en codigo:** el editor de paquetes filtra `bloqueos_vuelo` y `empaquetados` por igualdad con `armado_paquetes.destino_id`; un paquete hotelero de Juan Dolio no ofrece vuelos catalogados para Santo Domingo o Punta Cana. Los hoteles deben seguir asociados al destino comercial del paquete.
- **Alcance solicitado:** para paquetes con vuelo, un check en la configuracion habilita seleccionar varios destinos de llegada aerea del mismo pais que el destino del paquete. Con el check apagado se conserva el filtro actual. No cambiar el destino comercial/publico del paquete ni mezclar vuelos de otro pais. La seleccion de vuelos de bloqueo y las promociones de Empaquetados deben usar los destinos aereos autorizados. Conservar el alta manual de salidas dinamicas.
- **Responsable:** Chat #4 reviso la entrega; el Coordinador suplente dio gate de PR y el dueno hizo merge y SQL remoto. El Coordinador titular espera la prueba funcional y coordina #63 sobre el `main` nuevo.
- **Cruces:** #63 aun no implementa la vinculacion de promociones a salidas dinamicas; este hotfix no puede afirmar que esa parte ya funciona. El mapa de destinos aereos debe servir a #63 sin duplicar configuracion. #57 ya esta fusionado y no comparte el editor de paquetes. No incluir traslados automaticamente por inferencia.
- **Gate actual:** codigo y SQL 220 cerrados, no el smoke funcional. El contrato de #63 debe consumir el mapa unico de #67 y sustituir el filtro de destino exacto. Los destinos Juan Dolio/Santo Domingo/Punta Cana no estan confirmados como fixture real de Produccion. Sin FK de la tabla nueva a `destinos`: frente de integridad aparte con `usoDestino`/`fn_fusionar_destino`, no editar la 220 aplicada.

**Falta (casillas abiertas):**

- [ ] Auditar pais/codigo IATA y disponibilidad real de destinos, vuelos y promociones; definir el comportamiento cuando el pais falta y no inferir cercania por el nombre.
- [ ] Persistir el check y la lista multiple por paquete, validar en servidor el mismo pais y la elegibilidad al vincular un vuelo; definir que ocurre con vuelos ya vinculados al apagar el check o retirar un destino.
- [ ] Filtrar y mostrar bloqueos y promociones de todos los destinos aereos seleccionados, identificando ciudad/aeropuerto de llegada sin cambiar el destino del hotel ni el tarifario comercial.
- [ ] Probar paquete Juan Dolio con Santo Domingo y Punta Cana, varios vuelos por destino, otro pais rechazado, estado apagado sin regresion, cambios de configuracion y salida sin vuelo elegible.
- [ ] Conciliar la seleccion de promociones de paquetes dinamicos con #63 y verificar generacion, publicacion, checkout y reserva antes de dar por cerrado el caso dinamico; no crear un segundo flujo de promociones.

### 68. Seguimiento: clientes de contratos en CRM, separados de campañas

- **Hallazgo (2026-10-20):** el dueno encontro en la vista de Contratos un titular que no aparece al buscarlo en Contactos, aunque si aparece como pasajero de contrato. Es evidencia de ese caso, no inventario de todos los historicos. `Contactos` lee solo `crm_contactos`; `Pasajeros de contratos` lee `contrato_pasajeros` por RPC 188 y esta deliberadamente separado de la base de campanas. La 219 no hace backfill de historicos. #40 H0+E1 y PR #372 no crean contactos a partir de contratos.
- **Objetivo:** personal autorizado debe poder encontrar a clientes/titulares de contratos y navegar a sus contratos desde CRM, sin convertirlos automaticamente en destinatarios de campanas ni confundir titular, comprador, pasajero, agencia B2B y referido.
- **Decision del dueno (2026-10-20):** crear la seccion operativa separada `Clientes de contratos`. `Contactos` conserva su finalidad de campanas; no copiar titulares o pasajeros a destinatarios publicitarios ni inferir consentimiento.
- **Estado y gate (2026-10-21):** PR #373 fusionado (`51ca079e`); migracion 221 aplicada en Produccion por el dueno con preflight sin bloqueantes y postcheck OK 15/0/15. NO reaplicar. La V1 lee contratos en vivo, una fila por contrato y sin copiar PII a Contactos/campanas. Falta prueba funcional del dueno con rol administrativo y `venta` para cerrar esta entrega. El inventario P9 detecto dos usuarios activos con nombre JAVIER VIEIRA (`venta` y `freelance`); reasignar ventas propias al perfil freelance es un arreglo de datos APARTE, con conteos previos, preflight y rollback, nunca una actualizacion masiva por nombre inferido. La 221 aplicada contiene dano cosmetico de codificacion en comentarios/mensaje; no alterar la migracion historica y no reaplicarla por este seguimiento.

**Falta (casillas abiertas):**

- [ ] Inventariar con consulta agregada de solo lectura cuantos titulares de `ventas` no estan representados en la superficie CRM operativa, por tenant y tipo de contrato, sin exponer datos personales en el reporte.
- [ ] Definir identidad estable y deduplicacion por documento/tipo/tenant; no unir por nombre, telefono o email por inferencia. Identificar contratos sin documento y clientes juridicos.
- [ ] Disenar consulta/paginacion/RLS o fachada con los mismos limites de contrato para cada rol y agencia; comprobar acceso cruzado y enlaces directos.
- [ ] Decidir si se lee `ventas` en vivo o se necesita captura hacia adelante y tratamiento historico; probar cambios/cancelaciones sin copiar PII a `trg_auditoria` ni campañas.
- [ ] Verificar busqueda, ficha y enlace con casos reales autorizados, sin crear datos artificiales en Preview/Produccion.

### 69. Conciliar ventas de un usuario duplicado entre perfiles venta y freelance

- **Origen:** inventario P9 de #68/221 en Produccion: dos usuarios activos del mismo tenant comparten nombre, uno `venta` y otro `freelance`. El dueno pide atribuir al perfil freelance las ventas que realmente le correspondan. El nombre por si solo NO demuestra autoria ni autoriza una reasignacion masiva.
- **Gate:** falta que el dueno entregue los conteos agregados por `tipo_asesor`, `canal`, `b2b_usuario_id` y `aliado_id`. Despues, auditar contrato por contrato con identificador estable y acordar alcance exacto, preflight, vista previa, rollback y postcheck. El dueno ejecuta cualquier SQL remoto; no tocar historicos ni comisiones por inferencia.

### 70. Integridad referencial de destinos aereos alternativos

- **Origen:** la 220 de #67 ya aplicada deja la configuracion de alternativas sin FK a `destinos`. La lectura ignora filas huerfanas, pero fusionar/eliminar destinos necesita integrar esta tabla con `usoDestino` y `fn_fusionar_destino`.
- **Gate:** diseno y migracion NUEVA, nunca editar ni reaplicar la 220. Probar eliminacion/fusion con paquetes vinculados, concurrencia, RLS, rollback y preservacion de ventas historicas. Separado del enlace de salidas dinamicas #63.

### 71. Conciliar retencion y comision B2B de la 206/#358

- **Origen:** #50 deliberadamente crea la fila NETO con `aplica_retencion=false` y `pct_retencion=0`; la retencion copiada y la semantica de `comision_b2b` en la 206 quedan fuera de #50.
- **Gate:** auditoria contable de casos reales y del contrato de datos antes de cualquier cambio. No recalcular historicos ni cambiar 206 aplicada por inferencia; coordinar con #30 B, #43 y el primer contrato B2B real.

### 72. Identidad B2B faltante en flujos fuera de #50

- **Origen:** el mapa de #50 detecto `crear_cotizacion_manual` sin `aliado_id`, carrito con `aliadoId: null` y `reservarPrograma` sin `aliado_id`. #50 solo corrige identidad de sus hijas manuales selladas/legadas bajo su contrato.
- **Gate:** separar cada flujo, identificar fuente verificable de aliado/usuario/tenant y probar conversion, comisiones y acceso de portal sin atribucion por nombre/correo. Programas espera residual de #57; no ampliar 222/223 ni escribir en #40 E2 por inferencia.

### 73. Registrar pruebas React fusionadas de #67 y #68

- **Origen:** `destinosAereosEditor67.react.ts` y `clientesContratos68UI.react.ts` estan en las entregas fusionadas, pero faltan en el enumerador `test:react` de `package.json`.
- **Gate:** cambio focal del script de pruebas sobre `origin/main` que incluya ambos archivos, sin cambiar dependencias, pruebas ni codigo de app. Reservar un unico ejecutor y conciliar `package.json` con #50 y #43-1a antes de escribir; comprobar que las dos suites corren en CI. Sin migracion ni SQL remoto.

### 74. Cotizaciones B2B emitidas por la agencia con su marca o logo

- **Solicitud:** cuando una agencia genere por si misma una cotizacion en el portal B2B, el documento debe poder llevar su marca blanca o logo, no solo la marca de D'spacios. No extender por inferencia esta regla a contratos, facturas ni cotizaciones emitidas por personal interno.
- **Gate:** auditar los flujos B2B de generacion y descarga, la fuente y administracion autorizada del logo (#66), y como se identifica legalmente al emisor sin ocultar informacion obligatoria. Verificar aislamiento por aliado/tenant, PDF y vista previa, ausencia de marca ajena y fallback si no hay logo. Coordinar con #35/#40/#47/#65; ejecutor, archivos y migracion solo tras contrato tecnico.

### 75. Incluye/No incluye y tarifa infantil en cotizaciones multiples

- **Solicitud:** al final de las opciones de una cotizacion multiple, mostrar los apartados Incluye y No incluye. Si hay un nino, mostrar tambien su tarifa diferenciada: hoy se ve la de adulto, pero no la del nino.
- **Gate:** identificar la fuente de condiciones por opcion y de la tarifa infantil real, en pantalla y documento. Conservar la distincion entre contenido comun y exclusivo de cada opcion; no inventar un precio infantil ni usar el de adulto como sustituto. Probar una opcion y varias, adulto+nino, moneda/total por opcion, hija elegida, enlace publico y PDF. Reservar superficies despues de conciliar #35/#50; sin GO de codigo.

### 76. Rotulos Incluye/No incluye en paquetes Bloqueo y Porcion terrestre

- **Solicitud:** en la seccion de Incluye/No incluye de las tarjetas de paquetes Bloqueo y Porcion terrestre, quitar la palabra "programa" de los titulos. Deben decir solo "Incluye" y "No incluye".
- **Gate:** ubicar el componente y sus variantes de motor interno/externo antes de editar, sin alterar contenido, plegado "Ver mas", precio, carrito ni otros productos. Verificar ambos tipos de paquete en escritorio y movil. Cambio visual focal, sin migracion; reservar un ejecutor y archivos antes de implementarlo.

### 77. Identidad de aliado y sello PVP en comparativas manuales B2B nuevas

- **Origen:** el formulario interno de comparativas exige escoger un aliado del catalogo para agencia/freelance, pero `crearComparativaManual` y la RPC 211 aceptan `aliado_id` nulo. #50 conserva por compatibilidad la hija PVP sin aliado y sin fila en `cotizacion_neto`; el dueno confirma que no conoce casos reales historicos de esta clase, sin inventario remoto comprobado.
- **Gate:** entrega posterior a #50. Auditar todas las entradas de comparativa manual y rechazar en servidor/base una B2B NUEVA sin identidad de aliado verificable, sin bloquear indebidamente B2C ni reescribir cotizaciones existentes. Decidir si la PVP B2B sin aliado necesita un sello explicito que la distinga del legado; disenar migracion nueva solo si se demuestra necesaria, con paridad de idempotencia, permisos, documento, conversion y rollback. No editar las migraciones 211/222/223 ya aplicadas cuando llegue ese momento ni ampliar el Draft #50 por esta tarea.

### 78. Estado de publicacion de paquetes: activos y visibles con mensaje "Sin publicar"

- **Solicitud:** distinguir correctamente activacion, disponibilidad y publicacion. El check "Activo (visible en el tarifario)" no debe dar a entender que ya existen tarifas utilizables, y el listado debe explicar por que un paquete no aparece o no puede cotizarse.
- **Como va:** auditoria rapida de solo lectura sobre `origin/main` `2d5dff0e`: el check guarda `armado_paquetes.activo`; el listado muestra "Sin publicar" cuando el conteo de filas de `tarifario_resumen` es cero, sin distinguir estado de generacion ni motor. En Bloqueo/Porcion terrestre, hoteles por unidad/Bernalo validos pueden cotizarse dinamicamente sin generar filas clasicas, de modo que ese rotulo puede ser engañoso. No se verificaron paquetes concretos ni datos de Produccion; faltan sus IDs/nombres. La paginacion del resumen y el aviso de error tecnico ya existen: no atribuir este caso al antiguo truncamiento sin evidencia nueva.
- **Responsable:** por asignar; sin reserva de implementacion ni migracion.
- **Espera a:** identificar los casos reales y conciliar con #63/#67 y la disponibilidad de hoteles por unidad. Revisar `paquetes/page.tsx`, `PaquetesListado.tsx`, `ConfigForm.tsx`, `actions.ts` y `lib/tarifario/resumen.ts`; son superficies de auditoria, no reservas de escritura.
- **Destino previsto:** paquetes y tarifario, cambio focal de estado/diagnostico sin alterar precios, permisos ni reglas de venta.

**Falta:**

- [ ] Separar en la UI el estado Activo de la publicacion/disponibilidad real; acordar etiquetas como "Pendiente de generar", "Error de generacion", "Tarifas publicadas" y "Cotizacion por unidad" segun evidencia autoritativa, sin inventar disponibilidad por el solo hecho de tener el check marcado.
- [ ] Para cada paquete afectado, distinguir ausencia real de tarifas (temporadas, configuracion, fechas o vuelos/salidas no elegibles), generacion pendiente/fallida y oferta valida por unidad. Mostrar la causa y la accion que corresponda, sin convertir errores tecnicos en ausencia de producto.
- [ ] Probar paquetes persona, unidad y mixtos; tipos compatibles/incompatibles; activo/inactivo; generacion exitosa/fallida y datos incompletos. Verificar paridad entre listado administrativo y tarifario, sin usar solo el numero de filas clasicas como prueba de disponibilidad Bernalo ni prometer venta fuera de vigencia.
- [ ] Reservar unico ejecutor y archivos despues del diagnostico. Sin codigo, regeneraciones masivas, SQL remoto ni migracion autorizados por este registro.

### 79. Vuelos empaquetados: contratos solo de Porcion terrestre aparecen en el listado

- **Solicitud / como va:** el dueno reporta que la lista de vuelos empaquetados guarda o muestra contratos que son solo Porcion terrestre. Incidencia reportada, aun sin reproduccion ni inventario de datos; distinguir si se crea un vuelo indebido o si solo falla el filtro del listado.
- **Responsable:** por asignar; sin ejecutor, reserva ni migracion.
- **Espera a:** identificar contratos concretos y su origen; cruzar conversion de paquetes con #16/#17/#63/#64 y el flujo de record #82 sin mezclar implementaciones.
- **Destino previsto:** Vuelos/Empaquetados y conversion a contrato.

**Falta:**

- [ ] Trazar creacion, consulta y clasificacion; Porcion terrestre sin componente aereo no debe fabricar ni aparecer como vuelo empaquetado. Verificar tambien contratos mixtos y con vuelo legitimo.
- [ ] Probar listado y conversion, aislamiento por tenant, proveedor/CxP y ausencia de registros duplicados. No borrar ni reclasificar historicos sin diagnostico, alcance y pre/postcheck propios. Sin GO de codigo ni SQL remoto.

### 80. Malla tarifaria para hoteles por unidad / Bernalo

- **Solicitud / como va:** el dueno solicita una malla tarifaria de Bernalo. No estaba registrada con este alcance; falta acordar su presentacion y alcance (consulta, y si se requiere edicion o exportacion).
- **Responsable:** por asignar; sin reserva de codigo ni migracion.
- **Espera a:** definir ejes y fuente de precio por hotel, habitacion, ocupacion, regimen, fechas y moneda; conciliar #8/#16/#17/#78/#81/#86 y el motor vigente, sin crear un segundo calculo.
- **Destino previsto:** Netas/Hoteles y tarifario Bernalo.

**Falta:**

- [ ] Disenar una malla legible que identifique las combinaciones disponibles, sus vigencias y precios; distinguir neto de proveedor y PVP segun rol, sin exponer costos al publico.
- [ ] Definir como se muestran ocupaciones/fechas sin tarifa o no permitidas, menores y reglas por unidad. Probar paridad con la cotizacion real, moneda y redondeo antes de implementar. Sin GO de codigo ni SQL remoto.

### 81. Bernalo: tarifa infantil fija o descuento porcentual sobre adulto

- **Solicitud / como va:** permitir configurar el precio de ninos en Bernalo mediante un valor o un porcentaje de descuento sobre tarifa de adulto. Nuevo alcance de calculo/configuracion; #75 solo pide mostrar la tarifa infantil de comparativas y no resuelve esta regla.
- **Responsable:** por asignar; sin reserva de codigo ni migracion.
- **Espera a:** fijar la tarifa adulta de referencia, moneda, unidad de cobro (persona/noche/estadia/habitacion segun modelo), edades y convivencia con ocupacion/capacidad y menores no permitidos (#86). Coordinar la malla #80 y visualizacion #75.
- **Destino previsto:** reglas y cotizacion de hoteles por unidad / Bernalo.

**Falta:**

- [ ] Disenar modos explicitos de valor fijo y descuento porcentual, precedencia y validaciones; no asumir que tarifa por habitacion equivale a tarifa individual de adulto ni que ausencia de precio significa gratis.
- [ ] Probar adulto+nino, varios menores, limites de edad/ocupacion, vigencias, COP/USD y redondeo, con paridad entre tarifa, cotizacion, documento y contrato. Preservar importes historicos. Sin GO de codigo ni SQL remoto.

### 82. Empaquetados: record al convertir o registrarlo despues desde el contrato

- **Decision solicitada por el dueno:** al confirmar una cotizacion basada en un vuelo de Empaquetados con etiqueta "Promocion", preguntar si el vuelo ya tiene record. Si SI, exigir el record y crear un vuelo NUEVO con los mismos datos y etiqueta "Empaquetado", vinculado al contrato; no usar el vuelo "Promocion" como referencia operativa del vuelo emitido ni modificarlo. Conservar la trazabilidad del origen sin confundirla con el vinculo operativo.
- **Sin record:** crear el contrato sin tocar el vuelo "Promocion". Dentro del contrato debe existir una accion/casilla para aplicar o registrar el record; al hacerlo se exige el record y se ejecuta la misma creacion/vinculacion del nuevo vuelo "Empaquetado".
- **Estados:** el dueno indica que un Empaquetado con record significa emitido y pagado; los estados deben colocarse automaticamente. Auditar que significa "pagado" en este flujo y su fuente verificable (cliente/proveedor/emision), sin inventar abonos, egresos ni asientos por la sola presencia de un texto. La regla de negocio queda registrada; falta su contrato tecnico.
- **Responsable / como va:** por asignar, solicitud nueva sin implementacion auditada ni reserva. #63 incorpora salidas de sistema a paquetes dinamicos y #64 arma cotizaciones mixtas; ninguno cubria este ciclo posterior de emision/record.
- **Espera a:** contrato de identidad y trazabilidad de vuelos, datos a copiar, proveedor/CxP, permisos para registrar/corregir record y efecto en documentos, contrato, pasajeros y cancelacion. Conciliar #36/#41/#47/#48/#63/#64/#67/#79/#83; no tratar "Promocion" como un tipo de descuento.
- **Destino previsto:** Vuelos/Empaquetados y conversion/gestion de contratos.

**Falta:**

- [ ] Disenar las dos rutas con/sin record y la accion posterior en contrato; mantener intacta la oferta Promocion reutilizable, crear una sola instancia emitida por operacion y no introducir un bloqueo de emision al usuario que elige contratar sin record.
- [ ] Hacer atomicos e idempotentes creacion del vuelo, vinculo al contrato y estados; probar doble clic, reintento, dos contratos sobre una misma oferta, record vacio/duplicado/corregido y fallo parcial sin vuelos huerfanos ni duplicacion financiera.
- [ ] Inventariar casos existentes en solo lectura y definir tratamiento hacia adelante; no copiar estados financieros ni hacer backfill automatico. Reservar unico ejecutor/archivos y migracion nueva solo tras auditoria. Sin GO de codigo ni SQL remoto.

### 83. Duplicar vuelos de Bloqueos y Empaquetados "Promocion" cambiando fechas

- **Solicitud / como va:** boton Duplicar para frecuencias con los mismos datos y fechas diferentes, tanto en bloqueos como en empaquetados "Promocion". No estaba registrado como funcionalidad.
- **Responsable:** por asignar; sin reserva de codigo ni migracion.
- **Espera a:** definir campos que se copian y los que requieren nueva captura; conciliar #36/#67/#82 y distinguir oferta de venta de vuelo ya emitido.
- **Destino previsto:** formularios/listados de Vuelos.

**Falta:**

- [ ] Precargar un formulario nuevo desde el vuelo seleccionado y permitir cambiar ida/regreso y ventanas aplicables; crear otra identidad al guardar, preservando el original.
- [ ] No heredar pasajeros, contratos, pagos ni estados de emision de la instancia original. Acordar tratamiento de record, cupos, tarifa, vigencias y asignaciones a paquetes; no reutilizar referencias operativas por copiar la frecuencia. Probar fechas/rutas/horarios, ambos tipos y permisos. Sin GO de codigo ni SQL remoto.

### 84. Plan de pagos calculado con los abonos ya aplicados del cliente

- **Solicitud / como va:** sustituir la base fija del plan de pagos por una que tenga en cuenta los abonos efectivamente aplicados al contrato del cliente. Nuevo pendiente; las tareas de sillas/abono #41 y congelado/pagos #39/#50 no cubren el armado de este plan.
- **Responsable:** por asignar; auditoria funcional/financiera antes de codigo.
- **Espera a:** identificar el generador vigente, el total exigible y la fuente de abonos aplicados, incluidos los trasladados desde pagos previos; definir que cuenta como aplicado y el tratamiento de anulados, reversados, saldos a favor y monedas.
- **Destino previsto:** contratos, cartera y plan de pagos; coordinar #30/#38/#39/#41/#50/#59 sin recalcular historicos por inferencia.

**Falta:**

- [ ] Generar las cuotas futuras sobre el saldo que corresponda, reconociendo los abonos ya aplicados y conservando las reglas acordadas de fechas/porcentajes/minimos; no cobrar de nuevo un abono ni confundir cuota programada con dinero recibido.
- [ ] Definir politica de regeneracion cuando entran o se anulan abonos y como se preservan cuotas ya vencidas/pagadas. Probar abono cero/parcial/total, multiples abonos, pagos previos trasladados, anulacion y PVP/NETO, moneda y redondeo, sin mover dinero ni reescribir planes historicos automaticamente. Sin GO de codigo ni SQL remoto.

### 85. Netas de hoteles: vigencias por dias de semana y seleccion de rangos en calendario

- **Solicitud / como va:** facilitar la captura de fechas de promociones/tarifas o vigencias hoteleras: algunas aplican entre semana y otras en fin de semana. El dueno propone checks de dias con una vigencia amplia y/o un calendario para seleccionar varios grupos de fecha, siempre con inicio y fin. Son opciones de UX por acordar, no dos implementaciones ya decididas.
- **Responsable:** por asignar; sin reserva de codigo ni migracion.
- **Espera a:** auditar modelo de tarifas/temporadas y distinguir fechas de compra de fechas de estancia y precio por noche. #24/#45 revisan fechas generales/formato, no esta recurrencia ni seleccion multiple.
- **Destino previsto:** Netas/Hoteles, tarifas y vigencias; coordinar #36 cuando aplique, #80/#81 y motor de temporadas sin refactor global.

**Falta:**

- [ ] Acordar selector de dias de semana y/o calendario de rangos multiples, con vista previa de fechas efectivas, edicion y validacion de inicio/fin; no asumir que todos los proveedores definen igual el fin de semana.
- [ ] Definir solapamientos, excepciones/festivos, prioridad de tarifas y noches que atraviesan diferentes reglas; comprobar paridad del motor y que el calendario no cambie importes ni vigencias existentes por inferencia. Sin GO de codigo, regeneraciones masivas ni SQL remoto.

### 86. Habitaciones: permitir/restringir ninos y acomodaciones sencillas o dobles

- **Solicitud / como va:** configurar habitaciones que no admiten ninos y otras que si, y habitaciones que solo permiten doble o solo sencilla. Falta auditar que reglas ya existen y donde se aplican; no se toma como defecto confirmado de todos los hoteles.
- **Responsable:** por asignar; sin reserva de codigo ni migracion.
- **Espera a:** definir reglas por tipo de habitacion/hotel, edades, capacidad total, adultos/menores y acomodaciones autorizadas; distinguir capacidad de existencia de una tarifa. Coordinar #8/#16/#17/#75/#80/#81/#87.
- **Destino previsto:** configuracion de habitaciones y elegibilidad en cotizacion/reserva.

**Falta:**

- [ ] Mapear configuracion actual y permitir expresar restricciones de menores y de acomodacion sin inventar precios ni permitir una ocupacion solo porque hay tarifa.
- [ ] Aplicar la misma elegibilidad en formularios, malla, tarifario, cotizacion y validacion de servidor al reservar/convertir. Probar solo adultos, ninos admitidos/rechazados, solo sencilla/doble, capacidades y hoteles persona/unidad; preservar contratos existentes. Sin GO de codigo ni SQL remoto.

### 87. Montaje de producto: editar tipos de habitacion y su descripcion

- **Solicitud / como va:** el dueno reporta que el listado de tipos de habitaciones no tiene boton Editar para agregar o cambiar una descripcion despues del alta. Auditar la pantalla y el modelo antes de implementar; no confundir este cambio de ficha con las restricciones de ocupacion de #86.
- **Responsable:** por asignar; sin reserva de codigo ni migracion.
- **Espera a:** ubicar catalogo y permisos, comprobar donde se consume la descripcion y si la edicion modifica un tipo compartido o una configuracion de hotel.
- **Destino previsto:** Montaje de producto / tipos de habitacion.

**Falta:**

- [ ] Incorporar edicion posterior desde el listado para los campos acordados, incluida la descripcion, preservando el ID y los vinculos de tarifas/hoteles; no resolver la edicion borrando y recreando el tipo.
- [ ] Probar permisos, validacion, cancelar/guardar y visualizacion posterior. Cambios de nombre o restricciones que afecten contratos/tarifas requieren alcance explicito. Sin GO de codigo ni SQL remoto.

### 88. Programas: noches adicionales por acomodacion o con valor fijo

- **Solicitud / como va:** auditar y completar el sistema de noches adicionales de Programas para permitir precio segun acomodacion o un valor fijo que no dependa de ella. El dueno refiere una funcionalidad existente; comprobarla antes de crear otra ruta o afirmar que falta por completo.
- **Responsable:** por asignar; sin reserva de codigo ni migracion.
- **Espera a:** definir si el valor se cobra por persona/habitacion y noche/estadia, moneda, proveedor/costo y reglas de menores; separar noches incluidas del programa de las adicionales. Coordinar #57/#89 y sus motores de precio/reserva; no modificar la regla ya aceptada de noches incluidas por inferencia.
- **Destino previsto:** configuracion, precio y reserva de Programas.

**Falta:**

- [ ] Revisar modos actuales y disenar seleccion explicita entre tarifa por acomodacion y tarifa fija independiente de la acomodacion, con cantidad y fechas de noches adicionales.
- [ ] Probar cero/una/varias noches, todas las acomodaciones, adultos/menores y paridad entre ficha, cotizacion, checkout/reserva, contrato y proveedor/CxP; evitar doble cobro o duplicar el costo. Sin GO de codigo ni SQL remoto.

### 89. Programas: tercera modalidad de calculo con precio por hotel y salida

- **Solicitud / como va:** el dueno pide una mezcla o tercera linea de calculo en Programas donde el precio depende de la combinacion hotel x salida. Requisito nuevo; no es la mezcla USD/COP de paquetes dinamicos #63 ni queda resuelto por la paridad de precios #57.
- **Responsable:** por asignar; sin reserva de codigo ni migracion.
- **Espera a:** inventariar los modos existentes y definir matriz hotel/salida, acomodacion, fechas, moneda y precedencia frente a precios generales y por salida; aclarar la combinacion exacta antes de modelar. Coordinar #57/#88 y Programas de #56, sin ampliar el bot por esta solicitud.
- **Destino previsto:** configuracion y motor de precios de Programas.

**Falta:**

- [ ] Disenar la tercera modalidad preservando las actuales, con captura y mantenimiento de precios por hotel/salida y comportamiento explicito cuando falta la combinacion; no sustituir silenciosamente por otro hotel o fecha.
- [ ] Definir costos/proveedor, impuestos/comision cuando corresponda, ocupacion y noches adicionales. Probar cambio de hotel/salida, multiples acomodaciones, vigencia y reconfirmacion ante cambio de precio, con paridad ficha/cotizacion/reserva/contrato/CxP y sin recalculo historico automatico. Sin GO de codigo ni SQL remoto.

### 90. Monedas COP/USD en todos los paquetes y recorrido comercial

- **Solicitud / como va:** el dueno amplía (2026-10-22) el requisito a **todos los tipos de paquete y todo el recorrido monetario**, con seleccion COP/USD donde corresponda: configuracion de fuentes y componentes, tarifario, cotizacion, contrato, cobro, obligaciones y pago a proveedores. Regla especifica ya decidida: el costo de los aereos de Empaquetados y Bloqueos es USD; al crear el contrato se decide si al cliente se le cobra en COP o USD; al pagar al proveedor se ajusta el equivalente en pesos de ese costo con la tasa efectiva, desconocida al contratar. La conversion de #63/227 es parcial: salidas manuales y netos de hoteles/servicios en USD se convierten a un tarifario COP, los aereos vinculados de `empaquetados` estan restringidos a COP y los contratos #63 quedan en COP. No presentar esa entrega como soporte general de dos monedas. La 227 ya fue aplicada en Produccion y no se edita. Esta ampliacion queda separada de #63 y requiere auditoria transversal, contrato tecnico y migraciones nuevas.
- **Responsable:** por asignar; sin reserva de codigo ni migracion.
- **Espera a:** inventariar los tipos de paquete y todos los importes/monedas existentes, distinguir moneda del costo, de la tarifa publicada y del cobro al cliente, y definir tasas y momentos de conversion. Auditar caminos de Empaquetados y Bloqueos por separado; coordinar con #63, #43 (contabilidad), #41 (sillas de bloqueo), #50 (venta B2B) y #83 antes de cambiar formularios, calculos o invalidacion.
- **Destino previsto:** transversal a paquetes, tarifario, cotizacion, reserva, contrato, cobros, CxP, pagos y contabilidad.

**Falta:**

- [ ] Auditar Bloqueo, Empaquetados, Dinamico, Porcion terrestre, Servicios y Programas: moneda de cada costo, precio, impuesto, fee, descuento, total, documento, abono y obligacion; especificar que campos admiten COP/USD y como se muestran sin mezclar unidades monetarias.
- [ ] Disenar captura y persistencia del costo original USD de los aereos, la reventa y su moneda, y la tasa usada para cotizar. Mantener la reventa aerea vinculada sin segundo markup ni TA de #63; definir totales y documentos cuando el contrato cobra COP o USD, sin cambiar silenciosamente la moneda elegida al contratar.
- [ ] Disenar el pago al proveedor en USD: conservar nominal, tasa y equivalente COP provisional, registrar tasa efectiva y ajustar el equivalente COP al pagar con trazabilidad contable, sin reescribir el importe original USD ni contratos ya aceptados por un cambio posterior de tasa.
- [ ] Probar por tipo de paquete y por separado Empaquetados/Bloqueos: adulto/infante, proveedor y CxP, cobro COP/USD, cambio de TRM/fuente, invalidacion de tarifario y cotizacion previa, cupos/sillas, pagos parciales, ajustes y datos historicos. Desglosar en entregas verificables y preparar migraciones nuevas con preflight, postcheck y pruebas; no modificar la 227 aplicada ni abrir codigo o SQL remoto por este registro.

### 91. Seleccion y desvinculacion masiva de aereos en paquetes dinamicos

- **Solicitud / como va:** el dueno pide (2026-10-22) un control de **Seleccionar todos / Deseleccionar todos** los vuelos elegibles al agregarlos como salidas vinculadas al paquete Dinamico, y un boton **Desvincular todos** los ya vinculados. Hoy la seleccion uno a uno dificulta el trabajo. Es una mejora del editor de #63, separada del proyecto transversal de monedas #90; el dueno esta probando ahora la cotizacion actual de #63.
- **Responsable:** por asignar; sin reserva de codigo ni migracion.
- **Espera a:** revisar el editor y sus acciones actuales, definir el alcance de "todos" sobre la lista elegible que ve el usuario, y comprobar el efecto de desvincular sobre un tarifario publicado y ofertas ya cotizadas. Coordinar con #63 sin cambiar los importes ni el contrato financiero.
- **Destino previsto:** editor de salidas dinamicas y acciones de vinculacion/desvinculacion.

**Falta:**

- [ ] Agregar seleccion/deseleccion masiva con estado visible de seleccion y conservar la accion expresa de vincular; no vincular automaticamente vuelos nuevos.
- [ ] Agregar desvinculacion masiva con confirmacion, operacion coherente si una salida ya no puede quitarse e invalidacion del tarifario. Probar lista vacia, una y varias salidas, y ofertas previas que deban reconfirmarse antes de convertir. Sin GO de codigo o despliegue por este registro.

### 92. Precio "Desde" de todas las tarifas basado en acomodacion DOBLE

- **Solicitud / como va:** el dueno pide (2026-10-22) que el importe mostrado como "Desde" tome siempre como referencia la tarifa de acomodacion **DOBLE**, en todos los tipos de paquete y superficies que presentan tarifas. No usar la minima entre sencilla, triple, cuadruple, nino o infante como referencia de ese rotulo.
- **Responsable:** por asignar; sin reserva de codigo ni migracion.
- **Espera a:** inventariar de donde sale el "Desde" en listado, vitrina, ficha y otros puntos visibles, y definir el estado cuando una tarifa no tiene DOBLE publicable. Coordinar con #90 para que el importe conserve la moneda de la tarifa y no mezcle COP con USD.
- **Destino previsto:** resumenes y presentacion de tarifarios de todos los paquetes; revisar cualquier calculo de precio que reutilice el "Desde".

**Falta:**

- [ ] Comparar el "Desde" actual con la fila DOBLE vigente para cada paquete, salida, hotel y temporada donde aplique; usar exclusivamente una DOBLE publicable y explicar el caso sin DOBLE sin inventar otro precio.
- [ ] Probar Bloqueo, Empaquetados, Dinamico, Porcion terrestre, Servicios y Programas, con varias acomodaciones y monedas; verificar que ficha/cotizacion/reserva mantienen el precio especifico elegido y que solo cambia la referencia "Desde". Sin GO de codigo o despliegue por este registro.

### 93. TRM condicional en paquetes Dinamicos de #63

- **Solicitud / como va:** el dueno observa (2026-10-22) que resulta innecesario ingresar TRM en un paquete nacional cuando todos los importes usados estan en COP. La migracion 227 aplicada exige `trm_oferta` positiva en todo paquete `cop_trm_63`, aun sin montos USD; la validacion de servidor y la UI repiten ese requisito. El destino nacional NO demuestra por si mismo que las fuentes, costos u obligaciones sean COP.
- **Responsable:** por asignar; sin reserva de codigo ni migracion.
- **Espera a:** definir la condicion exacta a partir de las monedas reales de las fuentes y obligaciones de cada oferta, compatible con el snapshot y la aceptacion atomica de #63; coordinar con #90, que ampliara las monedas de todos los paquetes. No editar la 227 ya aplicada.
- **Destino previsto:** configuracion y generacion de tarifario Dinamico, validacion de cotizacion/aceptacion y nueva migracion de la restriccion.

**Falta:**

- [ ] Permitir modo #63 sin TRM cuando todos los importes relevantes son COP, mostrandolo como "No requiere conversion"; exigir TRM positiva antes de publicar o cotizar si cualquier importe relevante es USD. No usar una TRM 1 oculta ni decidir por el pais del destino.
- [ ] Revalidar al agregar o cambiar una fuente de COP a USD, invalidar el tarifario cuando corresponda y proteger ofertas ya cotizadas. Probar paquete todo COP, mixto, cambio posterior de moneda y CxP; preparar migracion nueva con preflight/postcheck. Sin GO de codigo ni SQL remoto por este registro.

### 46. Heredar fechas de viaje en cotizacion y contrato manual

- **Como va:** Auditoria tecnica parcial: el contrato manual ya tiene fechas en vuelos y hoteles que pueden prellenarse desde ida/regreso, pero el servidor no comprueba aun el rango. La cotizacion manual no guarda fechas por servicio; extenderla exige decidir modelo y migracion. No mover la tarea completa a codigo hasta resolver esa mitad, aunque la parte de contrato pueda reservarse como entrega acotada independiente.
- **Responsable:** Sin responsable asignado en las fuentes.
- **Espera a:** #35 (la cotizacion manual y su formulario estan reservados por #35).
- **Destino previsto:** Carril 2, subgrupo 2.1 (cotizacion y contrato manual).

**Falta (casillas abiertas):**

- [ ] Al agregar vuelos, hoteles u otros servicios a una cotizacion manual o contrato manual, prellenar sus fechas desde la ida y el regreso del viaje ya capturados. Ejemplo: viaje 15/10/2026 a 18/10/2026; los servicios nuevos deben traer ese rango como punto de partida, sin obligar a escribirlo otra vez.
- [ ] Mantener la ida como fecha minima y el regreso como fecha maxima del viaje al relacionarlos con los servicios. Para contrato manual, prellenar tramos/hotel sin sobrescribir ajustes del usuario y validar en servidor las fechas fuera de rango. Para cotizacion manual, decidir si cada servicio tendra fecha propia y como persistirla; hoy solo hay cantidades/detalle sin esas columnas. Probar ambas rutas por separado.

### 48. Informacion del vuelo en voucher de servicios aereos

- **Como va:** Auditoria por lectura: hoy no existe voucher aereo; hay vouchers de hotel y servicios, y el flujo dinamico excluye `aereo`. La implementacion necesita un tipo de voucher nuevo y tomar datos de `contrato_vuelos`, no solo agregar texto a una plantilla. Falta decidir PNR y alcance por pasajero o por contrato.
- **Responsable:** Sin responsable asignado en las fuentes.
- **Espera a:** Coordinar con #47 para que mostrar el vuelo en el voucher no lo agregue al contrato; documentos reservados por #35.
- **Destino previsto:** Carril 2, subgrupo 2.3 (Documentos y vouchers).

**Falta (casillas abiertas):**

- [ ] Definir si el voucher aereo muestra PNR (hoy se oculta en el documento del contrato), si se emite por pasajero o por contrato y como vincular un tramo de `contrato_vuelos` a su pasajero cuando no hay relacion directa. Crear un tipo de voucher nuevo con campos de vuelo reales y tratamiento explicito de datos ausentes; no inventar detalles.
- [ ] Verificar que la informacion corresponda al servicio/pasajero correcto y se conserve en vista y descarga del voucher. Coordinar con #47 para que mostrarla en el voucher no la agregue al contrato.

### 45. Fechas manuales en formatos cortos y calendario

- **Como va:** Auditoria tecnica por lectura: `parseCalendarText` alimenta `DateInput` en numerosos campos y tiene pruebas propias; hay tres campos con `type="date"` nativo que requieren tratamiento aparte. No hacer una regla global `AA -> 20AA`: los campos de nacimiento tambien usan `DateInput` y `09/10/56` no puede convertirse silenciosamente en 2056. Falta decision de siglo por tipo de fecha; no hace falta esperar el inventario completo de #24 para resolverla.
- **Responsable:** Sin responsable asignado en las fuentes.
- **Espera a:** Decision de siglo para viaje, nacimiento e historicos; reservar superficies compartidas antes de codigo. #24 aporta casos, pero no bloquea esta decision.
- **Destino previsto:** Transversales (toca todos los campos de fecha; no corre en paralelo con otros carriles).

**Falta (casillas abiertas):**

- [ ] En todos los campos de fecha editables manualmente, aceptar `DDMMAA` (por ejemplo, `200526`, `091026`) y `DD/MM/AA` (`20/05/26`, `09/10/26`), ademas del selector de calendario. Los ejemplos corresponden a 20/05/2026 y 09/10/2026. Las tres entradas deben representar la misma fecha valida; rechazar dias/meses imposibles sin interpretarlos silenciosamente como otra fecha.
- [ ] Partir del inventario de formularios de #24, definir la regla general para anos de dos digitos y revisar cada control, validacion y valor enviado al servidor. No alterar en bloque fechas de negocio, zonas horarias ni campos que no admiten edicion manual. Probar escritura, edicion y calendario en los flujos afectados.

## A.5 Futuras

Ideas y auditorias sin ejecutor. Mantienen su ID y no tienen prioridad declarada salvo la que diga su titulo.

### 24. (Futura) Auditoria de formularios y filtros de fechas

- **Como va:** Primer inventario de solo lectura recibido el 2026-10-05 sobre una rama atrasada (123 campos). La auditoria nueva sobre `main` `014b8edf` corrige un dato de ese inventario: `fecha_obligacion` en Reservar y Contratos ya usa `fechaNegocio()`. Siguen existiendo calculos de "hoy" en UTC; entre los de mayor riesgo estan conciliaciones, importacion de contratos, notificaciones y buscadores tras las 19:00 de Bogota. Falta inventario focal por flujo y verificar sesiones SQL antes de proponer cambios.
- **Responsable:** Sin responsable asignado en las fuentes.
- **Espera a:** Segunda ronda focal; coordinar reservar/actions.ts con #35 y vuelos con #36.
- **Destino previsto:** Alimenta #45; las correcciones se reparten por grupos (tarifario publico, contabilidad/contratos, vuelos, filtros, documentos) segun el carril de cada superficie.

**Falta (casillas abiertas):**

- [ ] Segunda ronda focal antes de codigo: contrastar en la base de integracion actual los flujos de fecha contable, plazo vencido y rangos invertidos; comprobar zona horaria de las sesiones SQL y filas existentes antes de proponer CHECK o cambiar defaults. Separar correcciones de tarifario publico, contabilidad/contratos, vuelos (#36), filtros y documentos. Coordinar `reservar/actions.ts` con #38 y tarjetas de hotel; no editar migraciones existentes ni hacer una sustitucion global de fechas.
- [ ] Auditoria separada de la correccion de vuelos (no hacer un cambio global de fechas sin ella): recorrer formularios y filtros de fechas de toda la app buscando (a) fechas pasadas ofrecidas donde no tienen sentido (salidas, plazos, vigencias, records destino) y (b) rangos donde la fecha final puede quedar antes de la inicial (ida/regreso, vigencias de compra y de viaje, temporadas, filtros de reportes).
- [ ] Revisar que "hoy" use la fecha de negocio de Bogota (`lib/fechaNegocio.ts`) donde corresponda. No reabrir `fecha_obligacion` de Reservar/Contratos: ya usa ese helper en `main` `014b8edf`. Priorizar `conciliaciones/actions.ts`, `contratos/importar/actions.ts`, `lib/notificaciones.ts` y los buscadores; no hacer reemplazo global de `toISOString()`.
- [ ] Entregable: inventario por pantalla con la regla esperada y una propuesta de correccion por grupos; sin implementar hasta aprobarla.

<details>
<summary>Detalle y antecedentes (1 lineas, sin recortar)</summary>

- [~] Primer inventario de solo lectura recibido el 2026-10-05: 123 campos revisados en `vuelos-editar-bloqueo-secciones` (`bcda7f44`), rama atrasada respecto de `origin/main` y con cambios sin commit. Su hallazgo sobre `fecha_obligacion` de Reservar/Contratos quedo superado por la lectura posterior de `main` `014b8edf`, donde ya se usa `fechaNegocio()`. Persisten otros usos de UTC por revisar por flujo.

</details>

### 25. (Futura) Panel de eventos de seguridad para superadmin

- **Como va:** El panel sigue en auditoria: no se verificaron planes ni ajustes reales de Vercel/Supabase. El redirect inseguro del callback se cerro por separado en #53, sin arrastrar este panel. La policy `auditoria_select` de la 189 deja leer a gerencia sin filtro de agencia segun lectura. #32 ya reconoce visibilidad transversal de superadmin/gerencia para personas; verificar si esa decision cubre tambien snapshots de auditoria antes de cambiar RLS, sin tratar la lectura transversal como defecto demostrado.
- **Responsable:** Sin responsable asignado en las fuentes.
- **Espera a:** Segunda ronda focal para el panel y confirmacion del alcance de gerencia sobre snapshots de auditoria antes de cambiar RLS. #53 no bloquea ese diseno.
- **Destino previsto:** Auditoria del panel; la policy de `auditoria` requiere una decision transversal con #32.

**Falta (casillas abiertas):**

- [x] Separado y cerrado el redirect del callback en #53; no duplicarlo dentro de este panel.
- [ ] Revisar acceso a `public.auditoria`: la policy de la 189 deja SELECT a `gerencia` sin filtro de tenant, mientras la tabla guarda snapshots con datos personales. Confirmar el alcance de gerencia que autoriza el negocio y probar acceso directo con dos tenants antes de cambiar RLS; el filtro de la pantalla no reemplaza la policy.
- [ ] Auditar primero las fuentes existentes: `/dashboard/auditoria` (cambios de datos), Supabase Auth Audit Logs y Auth logs (ingresos) y Vercel Firewall/Logs (trafico y bloqueos). Definir que eventos se pueden correlacionar sin perder evidencia ni duplicar datos; revisar disponibilidad, retencion y costo del plan antes de disenar almacenamiento propio.
- [ ] Proponer una vista clara, filtrable y paginada solo para superadmin: intentos de ingreso fallidos o anomalos, accesos denegados, llamadas a operaciones sin permiso, abuso de codigos/tokens y bloqueos del firewall. Mostrar fecha y hora de Bogota, tipo, resultado, severidad, origen y evidencia; distinguir un error normal del usuario de un patron sospechoso y no etiquetar automaticamente a una persona como atacante.
- [ ] Mostrar identidad de la cuenta solo cuando este verificada; en intentos anonimos, el correo o usuario ingresado debe figurar como dato declarado, no como identidad confirmada. Mostrar IP y navegador/sistema (User-Agent) solo si la fuente los registra; son datos aproximados o manipulables. Una web no puede obtener de forma fiable el nombre del equipo ni una direccion fisica exacta; geolocalizacion por IP, si se usa, debe rotularse como aproximada.
- [ ] Disenar captura y proteccion en servidor, controles de acceso, alertas y limites de intentos; minimizar datos, definir retencion y acceso por tenant, evitar registrar contrasenas, codigos, tokens o cuerpos sensibles. Incluir pruebas de permisos, falsos positivos, datos ausentes y volumen antes de implementar. No convertir el propio panel en una via de exposicion de datos sensibles.

<details>
<summary>Detalle y antecedentes (1 lineas, sin recortar)</summary>

- [~] Primer mapa de fuentes recibido el 2026-10-05 desde una rama atrasada; no se verificaron los planes ni ajustes reales de Vercel/Supabase. Segunda ronda focal: comprobar disponibilidad, retencion, costo y permisos efectivos en esos proyectos antes de disenar la captura o el panel. No tratar las cifras del informe como configuracion confirmada.

</details>

### 27. (Futura) Alertar sobre vigencias de compra proximas a vencer

- **Como va:** Propuesta no aprobada: aviso D-2 a D para hoteles activos. La auditoria nueva identifica como base reutilizable el resumen diario de `lib/notificaciones.ts`, pero ese resumen calcula "hoy" en UTC, muestra como COP importes incluso en USD y no filtra por agencia. Decidir si esta alerta va en ese resumen, al iniciar sesion o en ambos antes de implementarla.
- **Responsable:** Sin responsable asignado en las fuentes.
- **Espera a:** Decisiones de destinatarios, dias calendario o habiles, productos y repeticion.
- **Destino previsto:** Notificaciones transversales, con permisos y fecha de negocio por agencia.

**Falta (casillas abiertas):**

- [ ] Antes de codigo, decidir canal (resumen diario, inicio de sesion o ambos), destinatarios (incluida `administracion`), aviso el dia exacto, dias calendario o habiles, productos distintos de hoteles, repeticion y listado completo. Propuesta no aprobada: D-2 a D inclusive, hoteles activos, solo lectura y sin extender/publicar tarifas. Si se reutiliza `lib/notificaciones.ts`, corregir fecha de Bogota, moneda y aislamiento por agencia; no depender de un `session_id` del JWT sin verificarlo.
- [ ] Dos dias antes de `compra_fin`, mostrar al iniciar sesion un aviso con las vigencias/tarifas que van a vencer, identificando hotel, promocion o temporada, regimen y fecha de cierre de compra. Usar el dia de negocio de Bogota; no confundir `compra_fin` con el fin de viaje.
- [ ] Definir destinatarios y permisos por rol/tenant, repeticion por inicio de sesion, zona horaria, casos sin `compra_fin`, volumen y estado ya vencido. La alerta es informativa: no extender, reactivar ni publicar tarifas automaticamente.

<details>
<summary>Detalle y antecedentes (1 lineas, sin recortar)</summary>

- [~] Auditoria de solo lectura recibida el 2026-10-05 en rama atrasada: `hotel_temporadas.compra_fin` aparece como limite inclusivo; el regimen puede depender de una union por nombre con `tarifa_hotel`. Revalidar en la rama de implementacion y probar roles/RLS localmente; no asumir que ocultar el menu limita acceso a los datos.

</details>

### 28. (Futura) Evaluar contratos no concretados y reutilizacion de consecutivos DTM

- **Como va:** Sigue pendiente la regla comercial de numeracion y la auditoria de eliminados (incluido DTM-0557). Hallazgo por lectura independiente: la migracion 196 escribe estado `cancelado` al vencer el plazo, mientras la lista de ventas busca `anulada`/`anulado`; no hay CHECK en `ventas.estado`. Verificar el efecto visible y tratarlo como correccion acotada si se confirma, sin inferir que habilita reciclar consecutivos.
- **Responsable:** Sin responsable asignado en las fuentes.
- **Espera a:** Reglas por caso aprobadas por el dueno.
- **Destino previsto:** Por definir (contratos / numeracion).

**Falta (casillas abiertas):**

- [ ] Evaluar un flujo de borrador/cotizacion sin numero DTM hasta emitir el contrato; para negocios que no se concretan despues de emitirlo, estudiar un estado visible y auditable (p. ej. "No concretado"), sin borrar ni convertir el registro en el contrato de otro cliente.
- [ ] Auditar los contratos mayoristas eliminados manualmente el 2026-10-02 (incluido `DTM-0557`, enviado al cliente) y sus referencias antes de decidir si corresponde recuperar historico, conservar una constancia de anulacion o permitir reutilizar algun numero de prueba nunca emitido. La eliminacion no reconstruye los datos del contrato; no resetear la secuencia ni reciclar numeros por lote.
- [ ] Comparar las opciones comerciales y tecnicas de numeracion, permisos, liberacion de cupos, efectos financieros, documentos externos, auditoria y pruebas. Distinguir el numero interno DTM de la numeracion fiscal de facturas. No implementar ni ejecutar SQL de recuperacion/reutilizacion hasta aprobar reglas por caso.
- [ ] Reproducir en la lista de ventas la discrepancia `cancelado` frente a `anulada`/`anulado`; corregir la visibilidad del estado mediante entrega aparte si se confirma. No normalizar estados historicos ni introducir un CHECK sin inventario de valores reales.

### 31. (Futura) Vincular clientes con agencias B2B, asesores y referidos

- **Como va:** Decision del dueno del 2026-10-14 ya tomada (asesores internos operativos en mayorista; todos usan sus contactos; separar agencia, asesor y beneficiario de comision). La auditoria no encontro `ventas.asesor_id` ni un dato estructurado de referido; en Leads aparece solo texto libre. Hay que definir que entidad es un referido antes de modelar su atribucion.
- **Responsable:** Chat #1, auditoria de relaciones despues del contrato de #40; Coordinador decide gate.
- **Espera a:** Definicion del dueno de "referido" y delta de identidad/atribucion de #42; comparte portal con #33. No inferir beneficiario de comision del creador o del usuario que consulta el CRM.
- **Destino previsto:** Carril 4 (Identidad y CRM).

**Falta (casillas abiertas):**

- [ ] Revisar las relaciones actuales entre clientes, agencias B2B, asesores internos y referidos. Los referidos nuevos comisionan pero no aparecen en una vista identificable; auditar su registro, atribucion, permisos y presentacion.

<details>
<summary>Detalle y antecedentes (1 lineas, sin recortar)</summary>

- [x] Decision del dueno (2026-10-14): los asesores internos operativos estan en mayorista; todos pueden consultar y usar sus contactos, aunque otro asesor haya creado la cotizacion o el contrato. Separar agencia del contacto, asesor que lo usa y beneficiario de la comision interna segun la vinculacion comercial; no inferir la comision del creador ni del acceso al CRM.

</details>

### 33. (Futura) Mini CRM de clientes en el portal B2B

- **Como va:** Idea futura sin codigo. La superficie probable es `portal/b2b/page.tsx` y su seccion de agentes; la primera esta reservada por #35. El modelo de personas y visibilidad B2B debe venir de #32, no de una lectura amplia de contactos.
- **Responsable:** Sin responsable asignado en las fuentes.
- **Espera a:** #31 y #32 (modelo de clientes y aislamiento).
- **Destino previsto:** Carril 4 (Identidad y CRM).

**Falta (casillas abiertas):**

- [ ] Permitir a cada agencia gestionar sus propios clientes desde el portal B2B e integrar esa informacion al CRM central. Definir alcance, propiedad, permisos por tenant y prevencion de exposicion entre agencias.

### 34. (Futura) Notificaciones de cotizaciones B2C y solicitudes B2B

- **Como va:** Auditoria de lectura actualizada: el checkout consulta `config_solicitudes` para enlaces voluntarios de WhatsApp/correo, pero no genera aviso desde el servidor. El portal B2B sigue sin accion de solicitar contrato. Existe un resumen diario reutilizable en `lib/notificaciones.ts`, no una cola transaccional para este evento. Faltan destinatarios, canal y diseno de reintentos; no pasar a codigo por la sola existencia del resumen.
- **Responsable:** Sin responsable asignado en las fuentes.
- **Espera a:** Fijar el paso B2B cotizacion -> solicitud de contrato; coordinar versiones con #39.
- **Destino previsto:** Carril 2, subgrupo 2.1 (cotizaciones y portal B2B), despues de #35.

**Falta (casillas abiertas):**

- [ ] Definir evento B2C al crear y evento B2B solo al pulsar `Solicitar contrato`, con identidad/aliado, tenant y permisos autoritativos; no notificar cada cotizacion B2B. Disenar cola interna, estado atendido, idempotencia y reintentos antes de conectar canales. Una tabla outbox transaccional es propuesta tecnica, no decision aprobada; coordinar versiones/reediciones con #39. Decidir destinatarios, canal, recordatorios y si B2C conserva su enlace voluntario de WhatsApp.
- [ ] Para cotizaciones B2C sin login, avisar al equipo en el dashboard con pendientes de revision, listado de notificaciones y evaluar un dialogo al iniciar sesion. Para B2B, no notificar cada cotizacion: avisar solo cuando la agencia solicite confirmarla y pasarla a contrato para seguimiento. Definir destinatarios, estados, deduplicacion y lectura.

<details>
<summary>Detalle y antecedentes (1 lineas, sin recortar)</summary>

- [~] Auditoria de solo lectura sobre `origin/main` `e6aa9fec`: `cotizaciones` solo usa abierta/convertida/descartada. El checkout no notifica desde servidor; ofrece enlaces opcionales de WhatsApp/correo tambien a B2B, contrario al disparador pedido. La cotizacion de carrito no guarda un origen/propietario B2B fiable (el email en `creado_por` no sustituye un id autorizado) y el portal no tiene accion de solicitar contrato. No inferir de la ausencia de alerta que no haya solicitudes enviadas manualmente.

</details>

### 21. Presencia y actividad reciente para superadmin

- **Como va:** Evaluacion sin implementar: la app no tiene senal de presencia. `auditoria` permite hablar de cambios y Supabase Auth de ultimo inicio de sesion, pero ninguno prueba que una persona siga en linea. Hace falta una senal nueva con vencimiento, permisos y retencion antes de prometer "activo ahora".
- **Responsable:** Sin responsable asignado en las fuentes.
- **Espera a:** Definir fuente de datos, alcance por tenant, permisos, frecuencia y retencion.
- **Destino previsto:** Por definir (superadmin / identidad y auditoria).

**Falta (casillas abiertas):**

- [ ] Evaluar un mini informe en el dashboard de superadmin que muestre quien esta activo ahora y hace cuantos minutos se registro su ultima actividad o cambio.
- [ ] Distinguir presencia en la app (senal con vencimiento) de cambios realmente auditados; no inferir "en linea" solo por el inicio de sesion ni llamar "cambio" a una simple visita.
- [ ] Definir fuente de datos, alcance por tenant, permisos, frecuencia de actualizacion y retencion antes de implementar. Probar sesiones cerradas o inactivas y multiples pestanas sin exponer datos sensibles.

## A.6 Aparcadas por decision del dueno

No iniciar sin que el dueno las priorice.

### 4. (Diferida) Auditar un modulo comercial ligero ligado a salidas

- **Como va:** Diferida por decision del usuario (2026-09-30): sin diseno ni implementacion por ahora.
- **Responsable:** Ninguno; no iniciar hasta que el usuario la priorice.
- **Espera a:** Priorizacion del usuario.
- **Destino previsto:** Ninguno por ahora.

**Falta (casillas abiertas):**

- [ ] Registrar para auditoria futura un modulo comercial ligero ligado a fechas de salida, vuelos y opciones hoteleras, con concrecion de proveedores al momento de reservar.

<details>
<summary>Detalle y antecedentes (1 lineas, sin recortar)</summary>

- Diferida por decision del usuario (2026-09-30): sin diseno ni implementacion por ahora. No iniciar hasta que el usuario lo priorice.

</details>

### 20. Desarrollo posterior del negocio

- **Como va:** Lineas de desarrollo del negocio (B2B/B2C, marketing y redes, automatizacion comercial) sin alcance definido; no es una tarea tecnica todavia.
- **Responsable:** Sin responsable asignado en las fuentes.
- **Espera a:** Definicion de alcance por el dueno.
- **Destino previsto:** Ninguno por ahora.

**Falta (casillas abiertas):**

- [ ] Desarrollo integral B2B/B2C.
- [ ] Marketing y redes sociales.
- [ ] Automatizacion comercial y ventas.

---

# PARTE B - CODIGO

## Mapa de carriles

| Carril | Que incluye | Estado hoy | Cruces conocidos con otros carriles |
| --- | --- | --- | --- |
| 2. Cotizaciones, Vista Booking y documentos | #35, #16, #29, #47, #50 y las que llegan de la Parte A | #35 puede conciliar `VistaBooking.tsx` con #52 ya integrado; los otros esperan sus gates | Tambien cruza correcciones de #14/#30/#38 y la pieza menor de #49. |
| 3. Panel y responsive | #49, #22 | Menu movil y tabla de hotel implementados en worktrees distintos; faltan gates de PR. Resto sin ejecutor | Solo la pieza del modal de #49 cruza el Carril 2. |
| 4. Identidad y CRM | #32 local; llegan #42, #31, #33 | #32 autorizado en worktree aislado tras cierre tecnico focal; sin PR aun | Sus consumidores (#40, #42) escriben en cotizaciones: entran por el Carril 2 despues de #35. |
| 5. Contabilidad y comisiones | (sin codigo activo; llega #43) | Sin codigo; solo validaciones en curso | Las validaciones de #30/#38 no tienen archivos propios; #43 comparte superficies con `lib/constants.ts` y `lib/roles.ts`. |
| 6. Vuelos y sillas | (sin codigo activo; llegan #36, #37, #41, #17) | Sin codigo; todo en decision | #41 cruza el Carril 2 en la conversion cotizacion -> contrato. |
| 7. Seguridad de acceso puntual | #53 callback OAuth | Implementado localmente, pendiente de build y PR | #25 sigue en auditoria para el panel y la policy de `auditoria`; no mezclar sus cambios. |
| Transversales | #13, #19 (llegan #45 y correcciones de #24) | #13 sin ejecutor; #19 diferida | Pueden tocar cualquier archivo: no corren en paralelo con nada. |

Los carriles son zonas orientativas, no particiones garantizadas: los cruces de la tabla son solo los que se conocen hoy y pueden aparecer otros al reservar archivos. La ejecucion en paralelo se autoriza unicamente tras comprobar y reservar archivos, funciones, migraciones y dependencias concretas. El Carril 2 es el mas cargado y por eso va en serie.

"Sin codigo activo" (en la columna "Que incluye" de los carriles 4, 5 y 6) significa que hoy no hay codigo corriendo en ese carril; NO es un GO para implementar. Las tareas que llegan a esos carriles conservan sus requisitos antes de codigo (auditoria, decisiones del dueno, reserva y ejecutor). En particular, #33, #43 y #37 pueden avanzar a la vez en auditoria o diseno, y cada una conserva esos requisitos antes de pasar a codigo.

## Carril 2 - Cotizaciones, Vista Booking y documentos

- **Estado del carril:** #52 esta integrado en `main`; #35 puede conciliar `VistaBooking.tsx` con `main` `014b8edf` y seguir en su worktree. #39/#42 pueden auditar pero no implementar sobre cotizaciones al mismo tiempo.
- **Subgrupos:**
  - **2.1 Cotizaciones (en serie).** #35 -> #50; #29 queda despues de #35 y se secuencia con #39/#40/#42. Llegan de la Parte A #46, #34 y #41 (la conversion).
  - **2.2 Vista Booking y tarjetas.** #35 debe incorporar el cambio integrado de #52 en `VistaBooking.tsx`. Llegan despues #6 y #18; la pieza del modal movil de #49 tambien cae aqui.
  - **2.3 Documentos y vouchers (comparten archivos pero no se pisan).** #47 ya tiene regla y alcance de codigo; #48 sigue en auditoria por decisiones de voucher aereo. Se coordinan para que mostrar el vuelo en el voucher no lo agregue al contrato. `ContratoDocumento.tsx` y `CotizacionManualDocumento.tsx` estan reservados por #35.
  - **2.4 Hoteles unidad y paquetes.** #16 ya tiene entrega de conversion delimitada; #8, #9 y #17 conservan diseno/decision. Podria ser un carril propio si se demuestra que no toca archivos de 2.1 a 2.3; hoy no hay reserva que lo demuestre.

### 35. Cotizaciones multiples y comparativas de hoteles

- **Como va:** PR #362 fusionado en `main` `8987932e` (2026-10-17). La 211 se aplico en Produccion mediante Editor SQL: preflight 14/14 y postcheck 19/19, ambos `resultado` consolidado, sin fallidos; el hash del RPC 198 sigue intacto y `f211_priv` no esta expuesto en Data API. El historial consultado no registra ninguna version desde 204, coherente con aplicaciones manuales; no deducir ausencia de objetos ni usar `db push`/`migration repair`. Opus reporto SQL 211 sobre 212+213 (212/212), paridad PVP 77/77, carreras 12/12, React 602/602, navegador local 28/28, tsc/build OK; 9 fallos unitarios y 1 lint atribuidos a `main` mediante reproduccion focal. Chat #2 reviso superficies compartidas y una muestra focal de SQL/acciones/documentos, no cada linea ni todas las suites por cuenta propia. El Coordinador verifico forma de scripts y runbook, no repitio suites ni valido la app en Produccion.
- **Responsable:** Chat #2 coordina y audita; Opus ejecuta.
- **Espera a:** Vercel Production Ready/Current y validacion del flujo comparativo con un caso autorizado, sin crear pagos o contratos artificiales. #52 conserva su validacion funcional de Produccion.
- **Archivos y cruces:** Reservados en WORKSTREAMS: VistaBooking.tsx, checkout (page y actions), CartDrawer.tsx, cot/[token], cotizacion/[id], dashboard/cotizaciones (listado, acciones, nueva cotizacion manual, detalle), reservar/actions.ts, portal/b2b/page.tsx, ContratoDocumento.tsx y CotizacionManualDocumento.tsx, CartContext.tsx, types/database.ts, package.json (solo registro de pruebas), lib/cotizacion/comparativa*, pruebas y scripts de la 211.

**Falta (casillas abiertas):**

- [x] Gate de PR del Coordinador (2026-10-17): preflight y postcheck 211 entregan una sola fila `resultado` con veredicto y controles (14/14 y 19/19 en PostgreSQL local, reportado por Opus). Runbook de despliegue documenta historial, eleccion explicita del mecanismo y secuencia preflight -> 211 -> postcheck -> codigo. `git diff --check` limpio reportado por Opus. La decision y ejecucion remotas son un gate posterior, no permiso implicito del PR.
- [x] Confirmar en Data API > Exposed schemas que `f211_priv` no esta expuesto: captura del dueno con solo `graphql_public` y `public` marcados.
- [x] Integrar PR #362 en `main` como `8987932e`; `main` local actualizado por fast-forward sin tocar los documentos de coordinacion.
- [ ] Confirmar Vercel Production Ready/Current y hacer validacion humana controlada del flujo comparativo.
- [ ] Implementar madre comparativa no cobrable/no convertible, `precio_venta=NULL`, opciones con identidad y snapshot propios, y una hija simple por la opcion elegida. La madre es economicamente inmutable en V1; cambiarla crea otra comparativa. Sin estado nuevo `elegida` ni reinterpretacion de cotizaciones antiguas. Usuarios activos del mismo `aliado_id` y tenant pueden actuar por el aliado; nunca por nombre o email libre. Hija publica vencida no se descarta automaticamente: personal interno puede descartarla si no tiene pagos ni contrato. Solicitudes manuales pueden coexistir con topes probados, sin prometer proteccion total ante abuso distribuido.
- [ ] Antes del PR, probar RLS/grants/roles/tenant, identidad confiable y recibos de checkout de un solo uso, token publico solo lectura, inmutabilidad/version/sello, carreras e idempotencia, bloqueo de pago/conversion de madre, documento y subtotal de cada opcion, y paridad financiera PVP de hija manual mediante RPC 198 intacta y #358. Conversion NETO de cotizaciones manuales queda fuera de 211 y se atiende en hotfix separado tras integrar #35; el contrato manual directo PVP/NETO permanece intacto.

<details>
<summary>Detalle y antecedentes (3 lineas, sin recortar)</summary>

- [~] GO de codigo y pruebas locales para Opus, unico ejecutor, en worktree aislado; migracion nueva 211 reservada, aun no creada ni aplicada. Chat #2 audita el diff y las pruebas antes del PR. Ver archivos y restricciones en `WORKSTREAMS.md`. Ningun permiso de staging, commit, push, PR o SQL remoto.
- [x] Decisiones del dueno (2026-10-11): comparativa significa elegir UNA opcion, no compra conjunta. Modo explicito en Vista Booking y manual/dinamica; cotizacion simple sigue predeterminada. V1: hasta 3 hoteles del mismo destino, fechas, pasajeros y moneda. Booking: hotel + servicios vinculados por opcion, acomodacion elegible, tarifa por persona y total solo de esa opcion; sin vuelos ni tours independientes. Manual: itinerario comun (puede tener varios tramos por escala) y servicios comunes, hotel variable; cada total suma la parte comun una vez. Todos pueden elegir y pasar al flujo normal de compra de la opcion elegida, sin que ello conceda permiso de conversion. Bernalo por unidad, bloqueos de vuelo, `ReservaForm` interno y excepciones de vuelo/servicio exclusivo por opcion fuera de V1. Reeleccion solo si la hija se descarta sin pagos/contrato y la comparativa sigue vigente; conservar historial y recotizar. No exigir modal ni pagina nueva.
- [x] Decision del dueno (2026-10-16): terminar #35 con el alcance comparativo ya aprobado, sin redisenar esta entrega. La opcion manual rapida con plantillas por destino y su posible paso a una cotizacion normal quedan como mejora posterior separada; definir su alcance cuando #35 este cerrado. Conservar el trabajo local #35/211 y el gate vigente.

</details>

### 50. (Inmediatamente despues de #35) NETO al convertir cotizaciones manuales

**Estado vigente tras merge (prevalece): PR #375 FUSIONADO como 2d5dff0e**, cabeza c411f06e con UI ciclo 9. Verificado por Git/metadata, sin revalidar CI. 222 aplicada y postcheck 16/16/p50_priv no expuesto confirmados por dueno: NO repetir. Falta confirmacion del dueno de Vercel Production Ready/Current y prueba funcional PVP/NETO; 223 conserva solo preflight anterior INFO 3/0/0, sin constancia de aplicacion ni postcheck. No cerrar #50 ni inferir despliegue/validacion/SQL del merge; no abrir implementacion #63/#40 E2/E3 ni #79-89 por este registro.


**Gate ciclo 9 UI (prevalece): APROBADO para commit/push del dueno al mismo Draft #375**, tres archivos reservados +106/-34, HEAD b86ea92d. Titular reviso diff y capturas desktop/movil; diff-check limpio, React focal repetido 29/29. Q-16: conservar nota accesible de Documento. Sin cambios de dinero/permisos/persistencia/migraciones. 222 aplicada NO repetir; 223 pendiente. Falta Preview actualizado y prueba humana autorizada PVP/NETO antes de Ready/merge/223.


**Ajuste UI solicitado durante validacion:** aclarar que PVP/NETO solo se guarda al elegir hotel/crear hija; destacar total NETO, alinear importes/porcentajes y conservar seleccion local al abrir Documento en nueva pestana. Mismo ejecutor, reserva focal en COORDINATOR_HANDOFF.md; sin persistencia nueva, calculos ni migraciones. NO GO Ready/merge/223; validacion funcional pendiente.


**Estado vigente tras 222 (prevalece):** 222 APLICADA por el dueno con rol postgres: preflight INFO 12/0 bloqueantes/0 REVISAR y postcheck OK 16/16; RPC 198/frontera #39 intactas, sellos 0/0 y modalidad obligatoria=false. El dueno confirma solo esquemas publicos seleccionados, p50_priv NO expuesto. NO repetir ni editar 222. CI aceptado por confirmacion del dueno e inventario agregado aprobado. Falta prueba funcional PVP/NETO en Preview con caso real autorizado; Preview comparte Produccion, sin pagos/contratos artificiales. NO GO Ready/merge ni 223 hasta gates posteriores; 223 aun NO aplicada. Evidencia en COORDINATOR_HANDOFF.md.

**Gate vigente tras inventario (prevalece): CI completo cerrado por confirmacion del dueno, sin revalidacion por instruccion expresa; Q-12 cerrada. Inventario de integracion APROBADO por el titular.** Draft #375 `b86ea92d` contiene main `0d360b39`, limpio; 29 archivos dentro de reserva. Unico cruce con seis frentes vivos: types/database.ts #43-1a, adiciones separadas y apply --check exit 0 sobre #50. package.json preserva todo y solo agrega la React propia; 222/223 sin colision en los frentes revisados. Falta prueba humana autorizada PVP/NETO y resolver sus prerrequisitos de entorno/datos (Preview puede compartir Produccion). NO GO Ready/merge/SQL remoto por este inventario. Detalle en COORDINATOR_HANDOFF.md.

**Gate posterior, ciclo 8 (prevalece): GO SOLO a staging/commit/push del dueno al mismo Draft #375, tres archivos de pruebas reservados (+287/-21), sin app/migraciones.** Titular verifico diff-check, bash -n, guardas de los tres pasos reales del workflow bajo -e y publicacion de los tres contextos en salida larga. Q-15 cerrada sin cambio adicional. Esperar nuevo SHA y auditar CI completo: 222/223, 211 sola, TS/React y regresiones independientes. Q-12 espera ambas bases verdes reales. NO GO Ready/merge/SQL remoto; siguen inventario agregado y prueba humana autorizada. Detalle en COORDINATOR_HANDOFF.md.

**Gate posterior, ciclo 7 (prevalece): CON CORRECCIONES, sin GO a commit/push.** Tres archivos reservados, +262/-18, sin staging; grants retirados y cobertura dual incorporada. Titular repitio diff-check, bash -n y reprodujo dos defectos del arnes: -e heredado persiste en tres pipelines y H1 exige contextos tempranos que tail -25 no publica. Ciclo 8: solo runner/workflow, publicar contextos siempre y alcanzar captura/guardas incluso con rc no cero. Q-13 aceptada; job 211 sola se conserva en PR focal (Q-14), Q-12 pendiente de Actions real. Detalle en COORDINATOR_HANDOFF.md. NO GO Ready/merge/SQL remoto.

**Gate posterior, ciclo 6:** CON CORRECCIONES, sin GO a commit/push: retirar grants temporales del test 211; completar diagnostico G2/manejo del pipeline y cobertura ejecutable de la bateria 211 en base hasta 211 sin frontera, ademas de G2 con 217+222. Mismo ejecutor; ciclo 7 y nueva auditoria antes de push. Se admiten solo 8.12-8.17 como cobertura complementaria de carrito. Reserva y limites en la actualizacion final del titular del relevo. NO GO Ready/merge/SQL remoto.

**Gate vigente del titular, segunda corrida (2026-10-21; prevalece sobre el estado anterior inferior):** Draft #375 en `7483efc8`; commit focal de dos scripts comprobado, worktree limpio. Actions `39636863896` ROJO: G2 = 215 OK/8 fallos, en 4.11/4.12/4.13/4.21/4.22/4.31/6.29/6.30; ninguna marca del bloque 12 falta. 222 SQL 214/214, 223 SQL 16/16, regresion conjunta #39 265/265, rollbacks y TS/React 178+30 verdes; workflows independientes #39/#42/#67/#68 verdes. Se amplia al MISMO ejecutor la reserva del test 211 SOLO a esas ocho aserciones y deteccion compartida del contexto, ademas del bloque 12 ya autorizado. Runner G2 y workflow focal pueden mejorar diagnostico sin relajar gates. Entregar ciclo 6, sin commit/push ni SQL por el ejecutor. NO GO Ready/merge/SQL remoto; CI, inventario agregado y prueba humana siguen pendientes. Detalle de evidencia y limites en la actualizacion final de `docs/agents/COORDINATOR_HANDOFF.md`.

- **Como va (2026-10-21):** ciclo 4 entregado; Q-5, Q-8, Q-9a y Q-9b atendidos. El titular repitio 63/63 TS focales y dio GO solo a Draft. El dueno abrio PR #375 en `bb40019e`, conciliado con `main` `0d360b39`. Primera corrida focal: 30 OK/1 FALLO en G2, seccion 12 de la bateria heredada 211, cuyo INSERT manual directo choca con la frontera #39 activa; las regresiones independientes #39/#42/#67/#68 quedaron verdes. El dueno cerro Q-10: una hija PVP B2B sin aliado queda sin sello en esta entrega; el cierre de identidad/sello es #77. NO GO Ready, merge ni SQL remoto.
- **Responsable:** un unico ejecutor de codigo en `.claude/worktrees/neto-hija-50`, rama `codex/50-neto-hija-manual`, base `51ca079e`; el Coordinador titular revisa directamente `docs/coordinacion/bitacora-tarea-50.md`. Chat #2 es antecedente, no gate intermedio.
- **Espera a:** mismo ejecutor de #50 adapta la prueba G2 para convivir con #39 sin desactivar frontera, modificar 211/216/217 aplicadas ni relajar cobertura; nueva fila de bitacora y gate focal antes de commit/push del dueno. Luego CI 222/223 verde y auditado, regresiones verdes, Preview de pagos/conversion PVP y NETO, e inventario agregado antes de Ready. Q-10 aceptada expresamente; no resolver #77 dentro de #50. Orden de despliegue previsto: 222 aditiva -> codigo -> 223 de cierre, cada SQL remoto solo por el dueno con pre/postcheck y gate separado. Preservar contrato manual directo PVP/NETO #358 y RPC 198 intacta.
- **Archivos y cruces:** migraciones exclusivas 222/223, worktree, workflow y lista de archivos en `WORKSTREAMS.md` y bitacora #50. No mezclar #63 ni #40 E2/E3.

**Decisiones vigentes:** D-1..D-6, Q-1..Q-4 y C-1..C-5 quedaron cerradas en la bitacora #50. NETO solo en hija manual asistida; margen sobre el total, 6 % con tolerancia de medio peso o 2 % exacto si son solo tiquetes; nunca bajo costo y costo total 0 rechazado; snapshot de condiciones NETO; descuento 0 no crea hija NETO. La RPC 198 no se modifica. El hueco residual de consecutivo consumido por rollback se documenta, no se resuelve aqui. La retencion copiada de 206/#358 y brechas de identidad B2B fuera de #50 van a frentes separados.

**Tiquete ordinario:** la aclaracion inicial del dueno se concreto despues en Q-1: en #50 una hija de solo tiquetes usa 2 % exacto, con excepcion exclusiva de superadmin, pero nunca baja del costo. No equiparar por inferencia al bloqueo aereo; probar ambos vectores en SQL y TS.

**Falta (casillas abiertas):**

- [ ] Tras integrar #35, Chat #2 coordina y audita un hotfix separado para que la hija manual de una comparativa pueda convertirse a contrato NETO cuando corresponda. #35 V1 convierte esa hija solo en PVP por el RPC 198 vigente; no modificar ese RPC para NETO en la migracion 211. Preservar el contrato manual directo PVP/NETO de #358. Definir y probar precio exigible, comisiones, CxP/asientos, factura, documentos y permisos antes de reservar ejecutor, archivos o migracion para este hotfix.

### 29. Recobro desde el carrito del tarifario

- **Como va:** La auditoria ubico la formula del recobro en `manual-actions.ts`; la entrega de codigo consiste en compartir la regla con el carrito para personal interno y B2B, nunca B2C. No hay ejecutor ni archivos reservados; #35 ya libero carrito y checkout, pero se requiere reserva y secuencia con #50/#39.
- **Responsable:** Por asignar tras #35.
- **Espera a:** Reserva y secuencia con #50 y los cambios de precio/comision de #30 B. No correr en paralelo con #39/#40/#42 sobre cotizaciones.
- **Archivos y cruces:** `manual-actions.ts` como fuente a extraer a `lib/cotizacion/`; consumidores probables `CartContext`, `CartDrawer`, `checkout/*` y `convertirCotizacionCarrito` (lista de auditoria, no reserva).

**Falta (casillas abiertas):**

- [ ] Permitir recobro desde el carrito solo a personal interno y B2B con validacion del servidor, precio autoritativo y paridad con cotizacion manual. Evitar duplicar la formula, exponer el control a B2C o alterar comisiones y contratos NETO existentes. Probar roles, totales, documentos y conversion antes del PR.

### 47. Itinerarios de vuelo segun tipo de documento

- **Como va:** La comprobacion por lectura ya respondio el primer paso: el contrato SI muestra hoy aerolinea, ruta, fecha, numero de vuelo, horas y equipaje en `ContratoDocumento.tsx`. La cotizacion de tarifario reutiliza ese componente; separar vistas por modo sin borrar el dato operativo. La cotizacion manual no tiene itinerario estructurado y no se le inventara uno en esta entrega.
- **Responsable:** Por asignar tras #35.
- **Espera a:** Reserva de documentos ya liberados por #35; coordinar con #48, que sigue en diseno.
- **Archivos y cruces:** `ContratoDocumento.tsx`, pagina de contrato y paginas de cotizacion (`/cot/[token]`, `/cotizacion/[id]`, `/c/[token]` segun el flujo), hoy reservadas por #35. Confirmar la lista exacta al abrir worktree.

**Falta (casillas abiertas):**

- [ ] Mostrar el itinerario detallado en cotizaciones y excluirlo del contrato, tanto en vista como en descarga, usando un modo explicito del documento compartido. No ocultar importes ni alterar datos del vuelo, permisos o estado de la reserva. Probar con y sin vuelo; el voucher aereo es #48 y no se implementa por implicacion.

### 16. Integrar hoteles unidad en empaquetados

- **Como va:** La cotizacion y presentacion de hoteles unidad con salida empaquetada ya existen; la conversion a contrato se bloquea en `validarBernaloParaConversion`. El alcance de codigo es esa conversion, no rehacer el motor ni dar soporte a paquetes `servicios` (#9). El levantamiento de la guarda requiere prueba de precio y CxP aerea existente.
- **Responsable:** Por asignar.
- **Espera a:** Reserva de archivos y gate de #35 si coincide en `reservar/actions.ts`; no hay numero de migracion asignado a #16.
- **Archivos y cruces:** `reservar/actions.ts`, calculo Bernalo y pruebas focales; lista de auditoria, no reserva.

**Falta (casillas abiertas):**

- [ ] Permitir convertir a contrato la cotizacion de hotel unidad con `salida.tipo = "empaquetado"` solo tras verificar que conserva total, pasajeros, proveedor, CxP aerea y condiciones. No tocar inventario de sillas de bloqueos ni quitar la guarda para #17. Probar conversion completa y un rechazo que siga vigente.

## Carril 3 - Panel y responsive

- **Estado del carril:** las piezas acotadas de menu movil (#49) y tabla de hotel (#22) tienen un ejecutor en worktrees separados; aun no hay PR. Las otras tablas y el modal no estan asignados. `package.json` sigue reservado por #35, por lo que las dos pruebas React nuevas no estan en `test:react`.
- **Subgrupos (archivos citados distintos; separables solo si la reserva lo confirma):** 3.1 menu movil y tablas del panel/CRM (#49); 3.2 tabla Tarifas por persona del detalle de hotel (#22). La pieza del modal de `VistaBooking.tsx` (#49) se entrega con el Carril 2.

### 49. (Prioridad alta) Navegacion y tablas utilizables en celular

- **Como va:** La pieza del menu movil esta implementada localmente en `codex/49-menu-movil` sobre `014b8edf`, sin staging/commit/PR. Reutiliza el menu filtrado del escritorio y cubre submenus, foco, Escape, scroll y ruta activa. El ejecutor reporta prueba nueva 30/30, 204 existentes del panel, typecheck y capturas Chromium a 320/375/430/1280 px; el Coordinador reviso el diff y una captura, no repitio las suites. Las tablas del CRM/panel y el modal de Vista Booking siguen pendientes por separado.
- **Responsable:** Chat multitarea ejecuta la pieza del menu; Coordinador decide el gate. Resto de #49 sin ejecutor.
- **Espera a:** Build focal y registro de la prueba React en `test:react` cuando #35 libere `package.json`, o reserva explicita para ese archivo. Luego revision y PR del dueno; no mezclar las tablas ni el modal.
- **Archivos y cruces:** Menu: `app/(dashboard)/layout.tsx`, `SidebarNav.tsx`, `DashboardShell.module.css`, `MobileNav.tsx` y prueba nueva. Resto aun no reservado: `LeadsClient.tsx`, FacturacionClient.tsx, RetencionesClient.tsx, LibroDiarioClient.tsx y VistaBooking.tsx (cruza #35).

**Falta (casillas abiertas):**

- [~] Corregir el acceso movil a TODOS los submenus autorizados por rol y tenant, con estado activo, navegacion por teclado/tacto y salida clara al cambiar de ruta. No exponer rutas sin permiso ni depender de conocer la URL. Probado localmente; falta integrar y validar tras PR.
- [ ] Inventariar las tablas operativas por pantalla y distinguir las que ya usan `ResponsiveTableShell` (apilado funcional) de las recortadas. Caso confirmado por codigo: `app/(crm)/crm/leads/LeadsClient.tsx` usa tabla `min-w-[780px]` dentro de `overflow-hidden`, sin scroll ni apilado; Responsable y Proxima accion pueden quedar inaccesibles. Revisar visualmente tambien Facturacion (`FacturacionClient.tsx`), Retenciones (`RetencionesClient.tsx`) y Libro diario (`LibroDiarioClient.tsx`): varias tablas estan en `overflow-hidden` sin patron responsive, pero falta confirmar cada fallo en movil antes de afirmarlo.
- [ ] En cada tabla afectada conservar todas las columnas, acciones y datos: apilar por fila o permitir un desplazamiento horizontal realmente accesible y visible. Probar con datos reales o representativos, nombres y cifras largos, 320/375/390 px y teclado/tacto; comprobar que la pagina completa no se desborde y que acciones del extremo derecho sigan alcanzables. El portal B2B (`app/portal/b2b/page.tsx`) ya permite scroll horizontal en sus tablas de 820/940 px; evaluar su legibilidad sin clasificarlo como recorte irreversible.
- [ ] Hallazgo separado de menor prioridad: el modal de hotel de `VistaBooking.tsx` deja el fondo desplazable en movil, a diferencia del carrito, que bloquea el scroll. Reproducido en vista movil de Produccion; comprobar que abrir/cerrar modales no salte la pagina ni deje dos areas de scroll activas.
- [ ] Cerrar gate de la pieza del menu: ejecutar build en su worktree y registrar `menuMovilDashboard.react.ts` en `test:react` sin pisar `package.json` de #35; repetir la prueba focal y typecheck si ese registro cambia. El dueno hace staging, commit, push y PR. La correccion de tablas y el modal de `VistaBooking.tsx` conservan alcance y reservas separados.

<details>
<summary>Detalle y antecedentes (1 lineas, sin recortar)</summary>

- [~] Auditoria inicial de Codex (2026-10-14), confirmada por el dueno al usar el celular: hay dos problemas distintos. El menu movil del Dashboard dibuja solo `nav.map` de primer nivel en `app/(dashboard)/layout.tsx`; omite `children` de Vuelos, Montaje, Netas, Finanzas y Contabilidad, aunque el sidebar de escritorio si los ofrece. Algunas tablas muestran solo las primeras columnas y no permiten llegar a las demas. No confundir esto con #47, que trata el contenido del itinerario de vuelos en documentos.

</details>

### 22. Corregir scroll horizontal restante tras el trabajo de tablas responsive

- **Como va:** La tabla de Tarifas por persona esta corregida localmente en `codex/22-tarifas-hotel-movil` sobre `014b8edf`, sin staging/commit/PR. El ejecutor midio 1132 px necesarios frente a 958 disponibles en escritorio, agrupo categoria/regimen/temporada y usa tarjetas bajo el ancho requerido; reporta 12/12 nuevas, 203 existentes, typecheck y capturas en siete anchos sin celdas fuera de vista. El Coordinador reviso el diff y una captura, no repitio las suites. Rentabilidad sigue cerrada (PR #338); el inventario de otras vistas no esta hecho.
- **Responsable:** Chat multitarea ejecuta la tabla del hotel; Coordinador decide gate. Resto de #22 sin ejecutor.
- **Espera a:** Build focal, registro de `tarifasHotelMovil.react.ts` en `test:react` tras liberar/reservar `package.json` y aprobacion visual del dueno para agrupar las tres columnas.
- **Archivos y cruces:** Solo `producto/hoteles/[id]/HotelDetalleClient.tsx` y prueba nueva en esta entrega; `ResponsiveTableShell` compartido no se toco.

**Falta (casillas abiertas):**

- [~] Netas -> Hoteles -> detalle de hotel -> "Tarifas por persona" (`/dashboard/producto/hoteles/[id]`) tenia scroll horizontal con acciones fuera de vista. Corregido y probado localmente en tarifas activas/historicas, escritorio y movil; falta aprobacion visual del dueno, PR e integracion.
- [ ] En la misma pantalla, verificar dos hallazgos de lectura antes de corregirlos: formato COP aplicado a tarifas USD y guion para tarifa cero aunque cero significa gratis. Si se confirman, tratarlos como alcance separado de moneda/valor, no esconderlos dentro del cambio responsive.
- [ ] Cerrar gate de PR de la tabla: build, registro de prueba React y revision visual de la agrupacion de columnas por el dueno. Mantener fuera los hallazgos de moneda/cero y la auditoria de otras vistas.
- [ ] Auditar las demas vistas del panel y CRM en anchos de escritorio y movil para detectar otros scrolls horizontales que hayan quedado fuera del trabajo anterior. Registrar rutas, causa y reproduccion antes de corregir cada caso; no dar por cerrada la adaptacion responsive solo por las pantallas ya migradas.

<details>
<summary>Detalle y antecedentes (1 lineas, sin recortar)</summary>

- [x] Finanzas -> Rentabilidad: scroll horizontal corregido en `RentabilidadList.tsx` y la pagina, sin ocultar columnas ni contenido; PR #338 mergeado (confirmado por el usuario, 2026-10-02).

</details>

## Carril 4 - Identidad y CRM

- **Estado del carril:** #32 autorizado solo en local (nucleo de identidad y consulta segura); #42, #31 y #33 aun sin GO de codigo.
- **Reglas:** un solo dueno para esquema, permisos y sincronizacion; estas tareas se hacen en serie entre si (mapa archivado 2026-10-04). Superficies probables, sin reserva: `app/(crm)/crm/pasajeros/`, `NuevoContratoForm.tsx`, `reservar/`, la busqueda existente de la 187, `app/portal/b2b/`.

## Carril 5 - Contabilidad y comisiones

- **Estado del carril:** sin codigo. Hoy solo hay validaciones (ver "Seguimiento de lo entregado"). Llega #43.
- **Reglas:** #43 no toca `asientos_contables`, PUC ni UI sin revision y reserva propias; la 204 queda reservada a este frente. No usar `db push` ni `migration repair` por inferencia.

## Carril 6 - Vuelos y sillas

- **Estado del carril:** sin codigo; todo esta en decision. Llegan #36, #37, #41 y #17.
- **Reglas:** un dueno del nucleo (acciones/RPC, `sillas`, `bloqueos_vuelo` y flujos de venta) a la vez, segun el mapa archivado de 2026-10-01.

## Carril 7 - Seguridad de acceso puntual

- **Estado del carril:** sin pendientes activos; #53 quedo cerrada y archivada tras PR #367 y validacion en Produccion. No requirio migracion.

## Transversales (no corren en paralelo con nada)

Pueden tocar cualquier archivo, asi que se hacen cuando ningun otro carril tenga archivos abiertos. Llega aqui #45 (todos los campos de fecha) y las correcciones por grupos que salgan de #24.

### 13. Deuda de lint global

- **Como va:** La auditoria reporta en `main` `014b8edf` los mismos 223 problemas (169 errores, 54 advertencias), pero atribuye 186 a `supabase/.temp/start-secrets/`, temporal ignorado por Git que ESLint recorre. Quedarian 37 problemas del codigo del proyecto (15 errores, 22 advertencias), segun ese informe; no se repitio lint en esta actualizacion. No mezclar su limpieza con tareas funcionales.
- **Responsable:** Sin responsable asignado en las fuentes.
- **Espera a:** Puede tocar cualquier archivo: se hace por lotes cuando ningun otro carril tenga archivos abiertos.
- **Archivos y cruces:** Cualquiera.

**Falta (casillas abiertas):**

- [ ] Lote 1 acotado: excluir `supabase/.temp/**` en `globalIgnores` de `eslint.config.mjs` y volver a medir; esto no corrige codigo de aplicacion. Lote 2 separado: resolver los 15 errores reales confirmando cada uno en la rama vigente. Priorizar hooks condicionales de `components/sitio/edicion/Editable.jsx`; los demas incluyen efectos con `setState`, `any` y una reasignacion tras render. `CotizacionManualForm.tsx` esta reservado por #35. No mezclar la limpieza con tareas funcionales ni editar reservas ajenas.

### 19. Separar Preview y Produccion

- **Como va:** Diferida por decision del dueno (2026-10-04): no invertir mas tiempo en la separacion Preview/Produccion. Hecho: proyecto Supabase independiente DspaciosPruebas con esquema 001-201, que no equivale a un Preview de la app conectado o validado. Los Previews de Vercel pueden seguir conectados a Produccion y NO se usan para pruebas de escritura.
- **Responsable:** Ninguno mientras este diferida.
- **Espera a:** Que el dueno la reactive.
- **Archivos y cruces:** Afecta entornos, crons y migraciones de todos los frentes.

**Falta (casillas abiertas):**

- [ ] Cuando el usuario reactive la tarea, hacer un piloto aislado de la app Next.js 16 en Cloudflare Workers, no Pages estatico. Comparar compatibilidad con `vinext` (beta) y, si hay brechas, OpenNext; verificar build, limites del plan gratuito y diferencias de runtime sin migrar el despliegue productivo de Vercel ni reescribir el stack por anticipado.
- [ ] Preparar Cloudflare Workers Builds y Previews por rama desde GitHub. Configurar tanto el Worker de prueba como sus Previews SOLO contra `DspaciosPruebas`, con variables de compilacion y runtime separadas, secretos fuera de Git, Auth/callbacks y Storage de prueba. Proteger las URLs con Cloudflare Access antes de usarlas; no conectar el repositorio ni desplegar antes de revisar la configuracion.
- [ ] Aislar efectos externos antes del piloto: crons de `vercel.json`, correo (`RESEND_API_KEY`), `CRON_SECRET`, webhooks y otras integraciones. No activar procesos automaticos de negocio en la base de prueba por defecto.
- [ ] Probar con datos ficticios lectura y escritura, login, permisos/RLS, contratos, clientes, finanzas y Storage; confirmar que nada aparece en Produccion. Documentar variables por ambiente, promocion y rollback. Cada rama se prueba primero localmente; el staging compartido integra una rama a la vez. No copiar datos reales sin autorizacion y anonimizacion separadas.

<details>
<summary>Detalle y antecedentes (2 lineas, sin recortar)</summary>

- Decision del usuario (2026-10-04): diferir esta infraestructura y concentrarse ahora en las mejoras. Dejar Vercel Production y sus Previews tal como estan; no invertir mas tiempo en cambiar sus variables. Los Previews de Vercel pueden seguir conectados a Produccion y NO se usan para pruebas de escritura.
- [x] Proyecto Supabase independiente `DspaciosPruebas` creado y esquema 001-201 inicializado; sin copiar contratos, clientes, finanzas ni credenciales de Produccion. Esto no equivale a tener un Preview de la app conectado o validado.

</details>

## Seguimiento de lo entregado (validaciones; no escriben codigo)

Trabajo ya integrado que espera confirmacion humana. No ocupan archivos. Si una validacion falla, la correccion es un cambio nuevo en el carril que corresponda; varias tocan archivos que #35 tiene reservados y entonces van en serie con #35.

### 52. Verificar en Produccion las tarjetas de hotel plegadas

- **Como va:** PR #361 fusionado como `014b8edf`; `main` local actualizado. Preview aprobado por el dueno. Detalle del codigo en `TASKS_ARCHIVE.md`.
- **Espera a:** Vercel Production Ready/Current y comprobacion funcional en ambos motores: `Incluye/No incluye` y `Ubicacion` cerrados de inicio, expansion completa y contenido de la oferta correcta.
- **Nota:** No ocupa archivos. Si falla, registrar incidencia nueva y coordinar con #35 antes de editar `VistaBooking.tsx`.

### 14. Servicios adicionales en tarjetas: validacion financiera pendiente

- **Como va:** PR #353 integrado (5afc89aa, 2026-10-11): seleccion de servicios desde la tarjeta, fechas visibles y cotizacion conjunta hotel-servicios. Validado en Preview (NIT/telefono B2B y asistencia del paquete 34). Falta Production Ready y el primer contrato real aplicable; no crear contrato solo para probar y detener las conversiones nuevas si hay discrepancias.
- **Responsable:** Chat #2 (seguimiento).
- **Espera a:** Primer contrato real aplicable. #39 y #41 esperan este cierre.
- **Nota:** Si la validacion falla, la correccion toca reservar/actions.ts: en serie con #35.

**Falta (casillas abiertas):**

- [ ] Confirmar Production Ready y, en el primer contrato real aplicable, total, proveedor/CxP unica, cargo grupal si aplica, comision y ausencia de duplicados. Detener conversiones nuevas ante discrepancias; no crear contrato solo para probar. Ver WORKSTREAMS.md y la bitacora de Chat #2.

<details>
<summary>Detalle y antecedentes (1 lineas, sin recortar)</summary>

- [~] PR #353 integrado; seleccion de servicios desde la tarjeta, fechas visibles y cotizacion conjunta hotel-servicios implementadas. Las cotizaciones legadas se dejan intactas.

</details>

### 30. Contratos B2B PVP con comision / NETO

- **Como va:** Desplegado: PR #358 (4aa2349b); migraciones 206 y 208 aplicadas, postchecks 4/4 y 17/17, Vercel Production Ready/Current confirmado (cierre completo en TASKS_ARCHIVE.md). Falta solo el seguimiento: primer contrato B2B manual real, sin crear uno artificial ni recalcular historicos, y comprobar que f208_priv no figure en Exposed schemas. La conciliacion historica detectada por el preflight esta en #43.
- **Responsable:** Chat #1 (seguimiento).
- **Espera a:** El primer contrato real.
- **Nota:** Cualquier discrepancia es una incidencia nueva; si toca portal/b2b/page.tsx o reservar/actions.ts, va en serie con #35.

**Falta (casillas abiertas):**

- [ ] En el primer contrato B2B manual real, verificar modalidad PVP/NETO, total exigible, comision del aliado y del asesor, meta, CxP/asientos, estado de cuenta, portal y factura. No crear un contrato artificial en Produccion ni recalcular historicos; registrar cualquier discrepancia como incidencia nueva. Implementacion y despliegue de #30 B cerrados en `TASKS_ARCHIVE.md`.
- [ ] Comprobar en Supabase Data API, despues de crear la 208, que `f208_priv` no figure en Exposed schemas. El postcheck C15/C16 fue OK; la captura del panel fue anterior a la creacion del esquema.

### 38. Comisiones B2B: validacion funcional pendiente

- **Como va:** PR #352 integrado (e06a00f6) y migracion 205 aplicada con postcheck 14/14; las 142 comisiones historicas conservan su importe. Falta confirmar Production Ready y validar a mano una comision nueva (base PVP menos impuesto, NETO sin doble pago, meta del asesor, portal/cuenta y correccion manual). #41 espera este cierre.
- **Responsable:** Chat #1 (seguimiento).
- **Espera a:** Validacion funcional humana.
- **Nota:** Si falla, la correccion toca archivos reservados por #35 (portal/b2b/page.tsx, reservar/actions.ts): en serie.

**Falta (casillas abiertas):**

- [ ] Confirmar Production Ready y validar funcionalmente una comision nueva con base PVP menos impuesto, NETO sin doble pago, meta del asesor, portal/cuenta y correccion manual permitida. No reabrir la implementacion ya integrada por pendientes de #30 B. Ver WORKSTREAMS.md y la bitacora de Chat #1.

<details>
<summary>Detalle y antecedentes (1 lineas, sin recortar)</summary>

- [~] PR #352 fusionado y migracion 205 aplicada con postcheck 14/14. Las 142 comisiones historicas conservan su importe; no recalcular ni hacer backfill.

</details>

### 5. Catalogos compartidos y selectores buscables: validar lo integrado

- **Como va:** Integrado en main: selectores buscables en 19 formularios y separacion de datos sensibles de proveedores (migraciones 189/190/191, PR #333; la 191 aplicada segun el usuario). Falta validar en Produccion con un proveedor nuevo y datos reales, y documentar la matriz de lectura/escritura (no existe documento en el repo).
- **Responsable:** Sin responsable asignado en las fuentes.
- **Espera a:** Pruebas en Produccion/Preview con autorizacion; sin SQL remoto ni ampliar acceso entre tenants por inferencia.
- **Nota:** Sin archivos propios mientras solo se valida.

**Falta (casillas abiertas):**

- [ ] Validar en produccion el flujo con un proveedor NUEVO: crear con datos sensibles, editar, usarlo en hotel/servicio/CxP/voucher y comprobar que Minorista ve el catalogo base pero no los datos sensibles.
- [ ] Validar con datos reales de ambas agencias el comportamiento del catalogo y de los selectores (coincidencias, duplicados, texto libre).
- [ ] Documentar la matriz de lectura/escritura resultante por catalogo (no existe todavia un documento en el repo). No ampliar acceso entre tenants por inferencia ni ejecutar SQL remoto sin autorizacion.

<details>
<summary>Detalle y antecedentes (3 lineas, sin recortar)</summary>

Hecho en `main` (no reabrir):
- [x] Selectores buscables `ComboDestino`, `ComboProveedor`, `ComboHotel` y `ComboNombre` (`components/`) integrados en 19 formularios del panel y del CRM: hoteles, servicios, programas, paquetes, contratos, vouchers, pagos, CRM difusion, vuelos/bloqueos y empaquetados (`27fa9402`, `eb274b5b`, con pruebas de interaccion `pruebas/combo*Interaccion.react.ts`). Los `<select>` nativos que quedan con "destino" son de records de vuelo o del tarifario publico, no del catalogo.
- [x] Proveedores: catalogo base (`proveedores`) legible por personal interno activo de ambas agencias; escritura solo Mayorista autorizada; agencia/freelance/cliente_final sin lectura. Ocho datos sensibles (`nit`, `razon_social`, `datos_pago`, `banco`, `tipo_cuenta`, `numero_cuenta`, `politica_reservas`, `voucher_contacto`) movidos a `proveedores_datos_sensibles` (solo Mayorista; superadmin/gerencia leen ambas). Escritura por la RPC transaccional `guardar_proveedor`. El voucher usa solo `voucher_contacto`. Migraciones 189/190/191 (PR #333); la 191 aplicada en produccion segun el usuario.

</details>

### 7. Smoke financiero posterior al PR #294

- **Como va:** Smoke financiero posterior al PR #294, aun sin validacion funcional. La auditoria ubico el cron `reconciliar-financiero` en `vercel.json` a las `0 10 * * *`; la presencia de la configuracion no demuestra que haya ejecutado correctamente en Produccion.
- **Responsable:** Sin responsable asignado en las fuentes.
- **Espera a:** Un caso real con servicio incluido por grupo; confirmar el cron en Vercel.
- **Nota:** Sin archivos propios mientras solo se valida.

**Falta (casillas abiertas):**

- [ ] Crear un caso real con servicio incluido por grupo y comparar vitrina, carrito, cotizacion y contrato.
- [ ] Confirmar una sola CxP por servicio, costos correctos y margen correcto.
- [ ] Confirmar en Vercel `/api/cron/reconciliar-financiero` y su ejecucion con `CRON_SECRET`.

### 10. Smoke visual de condiciones y restricciones

- **Como va:** Sin avance registrado en las fuentes. Validacion visual de badges y condiciones (PR #286/#287) en Booking y carrito.
- **Responsable:** Sin responsable asignado en las fuentes.
- **Espera a:** Prueba en Produccion en escritorio, movil e impresion.
- **Nota:** Sin archivos propios mientras solo se valida.

**Falta (casillas abiertas):**

- [ ] Validar en produccion badges y condiciones en Booking y carrito de los PR #286/#287.
- [ ] Confirmar que el contenido sea consistente en escritorio, movil e impresion cuando aplique.

### 11. Smoke de excepcion comercial

- **Como va:** Falta probar la excepcion comercial con superadmin y un contrato restringido. La auditoria ubico dos consultas candidatas de vigencia en `lib/reservar/computo.ts` y `lib/contrato/congelarCondicionesContrato.ts`; no confirmo que sean equivalentes o duplicadas, por lo que no hay refactor autorizado.
- **Responsable:** Sin responsable asignado en las fuentes.
- **Espera a:** Prueba con superadmin.
- **Nota:** Sin archivos propios mientras solo se valida.

**Falta (casillas abiertas):**

- [ ] Probar con superadmin y contrato restringido el formulario, la autorizacion y la trazabilidad.
- [ ] Mantener como deuda no bloqueante la reutilizacion de la consulta de vigencia para evitar una segunda consulta O(1) a `hotel_temporadas`.

### 12. Destinos: validaciones residuales tras PR #334/#335

- **Como va:** Integrado en main (PR #334 y #335): conteos por destino, modal explicativo y fusion sin hoteles. Quedan casos que el usuario no valido en Preview y confirmar si la otra queja del modal de eliminacion quedo resuelta por el PR #335.
- **Responsable:** Sin responsable asignado en las fuentes.
- **Espera a:** Confirmacion del usuario.
- **Nota:** Sin archivos propios mientras solo se valida.

**Falta (casillas abiertas):**

- [ ] Confirmar por separado los casos que el usuario no valido en Preview: rol sin acceso (`control_vuelo` sin insignia de receptivos), "Actualizar lista" con datos que cambiaron, destinos con mas de 50 receptivos y el texto del modal segun el rol.
- [ ] Confirmar con el usuario si la "otra queja" sobre el modal de eliminacion quedo resuelta por PR #335 (el modal ahora ofrece fusionar segun el contenido verificado, no segun la cantidad de hoteles) o sigue abierta.

<details>
<summary>Detalle y antecedentes (1 lineas, sin recortar)</summary>

Conteos por destino, modal explicativo y fusion sin hoteles ya estan en `main` (ver "Cerrado recientemente"). Queda:

</details>

---

## Indice de IDs

| ID | Tarea | Donde |
| --- | --- | --- |

| 4 | (Diferida) Auditar un modulo comercial ligero ligado a salidas | A.6 Aparcadas |
| 5 | Catalogos compartidos y selectores buscables: validar lo integrado | Seguimiento de lo entregado |
| 6 | Tarjetas de Vista Booking y otras vistas | A.3 Diseno o decision antes de codigo |
| 7 | Smoke financiero posterior al PR #294 | Seguimiento de lo entregado |
| 8 | Soporte unidad para paquetes dinamicos | A.3 Diseno o decision antes de codigo |
| 9 | Soporte unidad para paquetes de servicios | A.3 Diseno o decision antes de codigo |
| 10 | Smoke visual de condiciones y restricciones | Seguimiento de lo entregado |
| 11 | Smoke de excepcion comercial | Seguimiento de lo entregado |
| 12 | Destinos: validaciones residuales tras PR #334/#335 | Seguimiento de lo entregado |
| 13 | Deuda de lint global | Transversales |
| 14 | Servicios adicionales en tarjetas: validacion financiera pendiente | Seguimiento de lo entregado |
| 16 | Integrar hoteles unidad en empaquetados | Carril 2 Cotizaciones, Booking y documentos |
| 17 | Integrar hoteles unidad con vuelos y bloqueos | A.3 Diseno o decision antes de codigo |
| 18 | Investigar hotel 217 ausente en Vista Booking | A.3 Diseno o decision antes de codigo |
| 19 | Separar Preview y Produccion | Transversales |
| 20 | Desarrollo posterior del negocio | A.6 Aparcadas |
| 21 | Presencia y actividad reciente para superadmin | A.5 Futuras |
| 22 | Corregir scroll horizontal restante tras el trabajo de tablas responsive | Carril 3 Panel y responsive |
| 24 | (Futura) Auditoria de formularios y filtros de fechas | A.5 Futuras |
| 25 | (Futura) Panel de eventos de seguridad para superadmin | A.5 Futuras; callback separado en #53 |
| 27 | (Futura) Alertar sobre vigencias de compra proximas a vencer | A.5 Futuras |
| 28 | (Futura) Evaluar contratos no concretados y reutilizacion de consecutivos DTM | A.5 Futuras |
| 29 | Recobro desde el carrito del tarifario | Carril 2 Cotizaciones, Booking y documentos |
| 30 | Contratos B2B PVP con comision / NETO | Seguimiento de lo entregado |
| 31 | (Futura) Vincular clientes con agencias B2B, asesores y referidos | A.5 Futuras |
| 32 | (Futura) Consulta y autocompletado por documento en clientes, terceros y pasajeros | A.1 En curso |
| 33 | (Futura) Mini CRM de clientes en el portal B2B | A.5 Futuras |
| 34 | (Futura) Notificaciones de cotizaciones B2C y solicitudes B2B | A.5 Futuras |
| 35 | Cotizaciones multiples y comparativas de hoteles | Carril 2 Cotizaciones, Booking y documentos |
| 36 | (Futura) Politica de cambios de fechas y horarios de vuelos | A.3 Diseno o decision antes de codigo |
| 37 | (Futura) Decisiones D5/D6 del traslado de pasajeros | A.3 Diseno o decision antes de codigo |
| 38 | Comisiones B2B: validacion funcional pendiente | Seguimiento de lo entregado |
| 39 | (Despues de #35) Editar servicios de una cotizacion | A.1 En curso |
| 40 | (Despues de #39 y #32) Cliente por documento y vencimiento de cotizacion | A.1 En curso |
| 41 | (Despues de cotizaciones) Sillas de bloqueo al convertir una cotizacion en contrato | A.2 Auditoria hecha, esperan decision o requisito |
| 42 | (Bug, prioridad alta) Registrar en CRM clientes y pasajeros de todas las cotizaciones | A.1 En curso |
| 43 | (Independiente, en espera) Modulo contable propio y staging DIAN | A.2 Auditoria hecha, esperan decision o requisito |
| 45 | Fechas manuales en formatos cortos y calendario | A.4 Solicitudes nuevas |
| 46 | Heredar fechas de viaje en cotizacion y contrato manual | A.4 Solicitudes nuevas |
| 47 | Itinerarios de vuelo segun tipo de documento | Carril 2 Cotizaciones, Booking y documentos |
| 48 | Informacion del vuelo en voucher de servicios aereos | A.4 Solicitudes nuevas |
| 49 | (Prioridad alta) Navegacion y tablas utilizables en celular | Carril 3 Panel y responsive |
| 50 | (Inmediatamente despues de #35) NETO al convertir cotizaciones manuales | Carril 2 Cotizaciones, Booking y documentos |
| 52 | Verificar en Produccion las tarjetas de hotel plegadas | Seguimiento de lo entregado |
| 56 | SalesBot comercial multiproducto | A.1 En curso |
| 57 | Paridad de precio y comision en Programas | A.4 Solicitudes nuevas |
| 58 | Lectura anonima de costos de Programas | A.4 Solicitudes nuevas |
| 59 | Borrado y reconversion de manual con pagos | A.4 Solicitudes nuevas |
| 60 | H-PQ1: markup de servicios incluidos por grupo | A.4 Solicitudes nuevas |
| 61 | H-SV1: paridad de servicios sueltos | A.4 Solicitudes nuevas |
| 62 | H-DI1: vigencia de salidas dinamicas | A.4 Solicitudes nuevas |
| 63 | Salidas sin record de Empaquetados en paquetes dinamicos y componentes en COP | A.4 Solicitudes nuevas |
| 64 | Cotizacion dinamica a medida con hotel, vuelo de sistema y servicios libres | A.4 Solicitudes nuevas |
| 65 | Portal B2B: pestanas, cartera y documentos | A.4 Solicitudes nuevas |
| 66 | Datos de agencia y control de acceso B2B | A.4 Solicitudes nuevas |
| 68 | Clientes de contratos visibles en CRM sin asumir consentimiento de campanas | A.4 Solicitudes nuevas |
| 69 | Conciliar ventas de usuario duplicado entre venta y freelance | A.4 Solicitudes nuevas |
| 70 | Integridad referencial de destinos aereos alternativos | A.4 Solicitudes nuevas |
| 71 | Conciliar retencion y comision B2B de la 206/#358 | A.4 Solicitudes nuevas |
| 72 | Identidad B2B faltante en flujos fuera de #50 | A.4 Solicitudes nuevas |
| 73 | Registrar pruebas React fusionadas de #67 y #68 | A.4 Solicitudes nuevas |
| 74 | Cotizaciones B2B con marca o logo de la agencia | A.4 Solicitudes nuevas |
| 75 | Incluye/No incluye y tarifa infantil en cotizaciones multiples | A.4 Solicitudes nuevas |
| 76 | Rotulos Incluye/No incluye en paquetes Bloqueo y Porcion terrestre | A.4 Solicitudes nuevas |
| 77 | Identidad de aliado y sello PVP en comparativas manuales B2B nuevas | A.4 Solicitudes nuevas |
| 78 | Estado de publicacion de paquetes: activos y visibles con "Sin publicar" | A.4 Solicitudes nuevas |
| 79 | Vuelos empaquetados: contratos solo de Porcion terrestre en el listado | A.4 Solicitudes nuevas |
| 80 | Malla tarifaria de Bernalo | A.4 Solicitudes nuevas |
| 81 | Bernalo: tarifa infantil fija o descuento sobre adulto | A.4 Solicitudes nuevas |
| 82 | Empaquetados: record al convertir o registrarlo desde el contrato | A.4 Solicitudes nuevas |
| 83 | Duplicar bloqueos y empaquetados Promocion cambiando fechas | A.4 Solicitudes nuevas |
| 84 | Plan de pagos con abonos ya aplicados | A.4 Solicitudes nuevas |
| 85 | Netas: vigencias por dias y calendario de rangos multiples | A.4 Solicitudes nuevas |
| 86 | Restricciones de ninos y acomodaciones por habitacion | A.4 Solicitudes nuevas |
| 87 | Editar tipos de habitacion y descripcion | A.4 Solicitudes nuevas |
| 88 | Programas: noches adicionales por acomodacion o valor fijo | A.4 Solicitudes nuevas |
| 89 | Programas: precio por hotel y salida como tercera modalidad | A.4 Solicitudes nuevas |
| 90 | Monedas COP/USD en todos los paquetes y recorrido comercial | A.4 Solicitudes nuevas |
| 91 | Seleccion y desvinculacion masiva de aereos en paquetes dinamicos | A.4 Solicitudes nuevas |
| 92 | Precio "Desde" de todas las tarifas basado en acomodacion DOBLE | A.4 Solicitudes nuevas |
| 93 | TRM condicional en paquetes Dinamicos de #63 | A.4 Solicitudes nuevas |

Retiradas de este listado y conservadas en TASKS_ARCHIVE.md: #1, #2, #3, #15, #23, #26, #44, #51, #53, #54 y los cierres de #30 B, hotfix 207 y 209.
