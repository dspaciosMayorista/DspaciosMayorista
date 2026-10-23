# Tarea #68 - Bitacora del ejecutor

Fuente de pendientes: `TASKS.md` seccion #68. Decision del dueno: `Clientes de contratos` como seccion operativa SEPARADA de `Contactos` para campanas. Antecedentes: #40 H0+E1, #42/219, RPC 188 de pasajeros y #31 (relaciones B2B). El Coordinador titular decide gates. No hay GO de codigo, SQL, worktree, archivos, workflow ni migracion.

| Ciclo / fecha | Base y alcance leido | Hallazgos y evidencia | Pruebas o consultas | Riesgos y decisiones pedidas | Gate |
| --- | --- | --- | --- | --- | --- |
| 0 / 2026-10-20 | `main` local `a4c999cf`; lectura de `crm_contactos`, `contrato_pasajeros` y la vista de Contratos | En el caso mostrado por el dueno, un titular de contrato no aparece en Contactos y si como pasajero. El codigo confirma que las vistas leen fuentes distintas; no se ha medido la brecha historica completa | Lectura de codigo y capturas aportadas por el dueno. Sin SQL remoto ni escrituras | No inferir consentimiento, identidad por nombre ni acceso a contratos ajenos. #372 no hace backfill | Diseno/auditoria para el mismo Opus CRM; sin GO de codigo |
| 1 / 2026-10-20 | `origin/main` `a4c999cf`; worktree `codex/40-crm-captura-filtro` sin tocar. Leido: TASKS #68, WORKSTREAMS (decision #68), esta bitacora, `types/database.ts` (ventas, contrato_pasajeros), migraciones 116, 142, 144, 148, 156 (`ventas_basica`) y 188 (`crm_pasajeros_contrato_buscar`), `contratos/page.tsx` y `[numero]/page.tsx`, `crm/pasajeros`, `crm/[id]/page.tsx`, `crm/layout.tsx`. Solo lectura y diseno | (1) El cliente del contrato vive como TEXTO en `ventas`: `cliente`, `cliente_documento` (sin tipo), `cliente_email`, `cliente_telefono`, `cliente_direccion`. No existe tipo de documento del cliente en `ventas` ni marca de titular en `contrato_pasajeros`; el tipo solo aparece en una fila de pasajero (la conversion 198 inserta al titular como pasajero orden 0; en Reservar/manual es convencion de formulario). `ventas.tipo_cliente` guarda interno/agencia/freelance (tipo de VENDEDOR): no distingue persona juridica. (2) `ventas_basica` (156) ya es la superficie correcta: filtra por rol y tenant, devuelve 0 filas a agencia/freelance/cliente_final/control_vuelo, a `venta` le enmascara `cliente_documento` (****+4 ultimos) y anula direccion y `share_token` en contratos ajenos; telefono y email NO se enmascaran. Contratos ya lista desde esa vista con `.eq(tenant activo)`. (3) La RPC 188 limita `venta` a contratos propios y NO filtra por agencia activa (superadmin/gerencia ven ambos tenants). (4) `Contactos` (`crm_contactos`) y sus banderas de publicidad no intervienen: no se lee ni se escribe | Solo lectura de codigo y migraciones; nada ejecutado (sin SQL, sin Docker, sin Preview). Consulta de inventario agregada y sin PII entregada al dueno en la respuesta de este ciclo para que la ejecute el; no ejecutada | CONTRATO TECNICO (resumen). Fuente: lectura VIVA de `ventas_basica`; NO hace falta persistencia ni backfill (una tabla copiada duplicaria PII, exigiria excluirla de `trg_auditoria` y quedaria desactualizada ante cambios o cancelaciones). Una migracion de solo lectura con dos funciones SECURITY INVOKER sobre la vista (listado agrupado paginado y ficha), numero a pedir al Coordinador; sin tablas ni datos nuevos. Identidad = (tenant, documento normalizado) SIN tipo; si el pasajero del mismo contrato con ese numero trae tipos distintos, se separa por tipo con aviso y nunca se fusiona. Documento enmascarado (venta, contrato ajeno) nunca agrupa: una fila por contrato. Sin documento: una fila por contrato, jamas agrupada por nombre, telefono o email. Ficha por `/crm/clientes-contratos/[numero_contrato]` (sin PII en la URL) con enlaces a `/dashboard/contratos/[numero]`. Se distingue cliente/titular del contrato, pasajero (enlace a `Pasajeros de contratos`) y canal vendedor/aliado (informativo); sin totales ni columnas financieras; nada de `crm_contactos`. Siempre agencia activa explicita. RIESGOS: R1 mismo numero con tipos distintos (ventas no guarda tipo); R2 agrupar documentos enmascarados mezclaria clientes; R3 busqueda/ordenamiento sobre columna que el rol no ve seria oraculo (consultar siempre la salida de la vista); R4 documentos historicos en texto libre (importador minorista) sin normalizar, brecha desconocida hasta el inventario; R5 cliente juridico no identificable (NIT con o sin DV queda como texto); R6 superadmin/gerencia ven ambos tenants en la vista, filtrar por agencia activa; R7 telefono y email visibles a `venta` en contratos ajenos (hoy ya lo estan en Contratos), un directorio buscable aumenta la superficie; R8 truncamiento por limite de filas de PostgREST, paginar por cursor; R9 homonimos de asesor heredan la deuda de `soy_asesor_del_contrato`; R10 ficha por numero de contrato falla si se renumera o elimina, responder 404 sin datos. DECISIONES PEDIDAS AL DUENO: D1 `venta` ve los clientes de todo el tenant (alineado con Contratos, recomendado) o solo los propios (como la RPC 188); D2 enmascarar tambien telefono y email de contratos ajenos para `venta`; D3 confirmar solo agencia activa; D4 ejecutar el inventario agregado antes de fijar el alcance historico | Diseno entregado; sin GO de codigo, worktree, archivos, workflow, migracion, backfill ni SQL remoto. Pendiente revision del Coordinador y decisiones D1-D4 |
| Gate del Coordinador / 2026-10-20 | `codex/40-crm-captura-filtro` limpio en `68e2b626`; revisados los bloques de 156/188 y la consulta de Contratos. No se toco codigo | Confirmado: `ventas_basica` devuelve nombre, correo y telefono; enmascara documento para `venta` en contrato ajeno. Contratos filtra `tenant` en app. RPC 188 solo muestra pasajeros propios a `venta`. El diseno de lectura viva, separado de campanas, es base valida | Revision estatica focal; sin SQL remoto, PostgreSQL, Preview ni inventario agregado. El SQL de inventario citado por el ejecutor no esta en esta bitacora y NO fue revisado aqui | P1: no agrupar por `(tenant, documento)` sin tipo documental confiable; V1 debe ser por contrato o justificar una fuente de identidad estable con casos de colision. P1: busqueda/ficha no deben convertir correo y telefono de contratos ajenos en un directorio mas amplio; D1/D2 consultadas al dueno. Probar filtros sobre SALIDA visible de la vista y accesos directos, no solo UI. D3 se fija a agencia activa; D4 inventario agregado antes de cerrar alcance historico. Pedir al ejecutor incorporar el SQL agregado a esta bitacora para revision previa a que el dueno lo ejecute | GO solo para iteracion de DISENO. NO GO de codigo, migracion, SQL remoto, backfill o PR |
| 2 / 2026-10-20 | Cierre del diseno V1 sobre `origin/main` `a4c999cf` (worktree CRM sin tocar). Reemplaza la propuesta agrupada del ciclo 1, que queda como antecedente. Lectura nueva: migracion 142 (`soy_ese_asesor` y `soy_asesor_del_contrato` comparan `ventas.asesor` con el nombre o el correo del usuario, en minusculas y sin espacios sobrantes). Lee tambien la fila `Gate del Coordinador` y el parrafo `Decisiones del dueno posteriores al gate`. Decisiones aplicadas: D1 `venta` ve SOLO contratos propios (como la RPC 188); D2 telefono y correo de contratos fuera del alcance del rol no aparecen y el acceso ajeno falla cerrado DENTRO de la funcion SQL, aun si una ruta errada la llama directamente; D3 solo la agencia (tenant) activa; D4 el SQL de inventario se anexa aqui para revision antes de que el dueno lo ejecute. Atiende el P1 del gate: V1 por contrato, sin agrupar por `(tenant, documento)` mientras no exista un tipo documental confiable | DISENO V1, UNA FILA POR CONTRATO. (1) Unidad = CONTRATO, nunca persona: numero visible (sin prefijo MIN-), fecha de venta, cliente tal como esta escrito en el contrato, documento escrito, email, telefono, destino, fechas de viaje, estado y canal (tipo_asesor, agencia, freelance). Sin precio, direccion, firma, `share_token` ni totales. (2) Acceso: dos funciones SECURITY INVOKER de solo lectura sobre `ventas_basica`; el filtro va en el mismo WHERE: `tenant = p_tenant` (agencia activa, obligatoria, solo mayorista o minorista) y `(mi_rol() <> 'venta' or soy_asesor_del_contrato(numero_contrato))`. Como `venta` solo recibe contratos propios, el enmascarado de la vista no aparece; agencia, freelance, cliente final, `control_vuelo` e inactivos reciben 0 filas por la vista; administracion y operaciones ven su tenant; superadmin y gerencia ven ambos tenants en la vista y se fija `p_tenant`. (3) Acceso ajeno sin datos: busqueda y ficha responden igual para un contrato de otro asesor (`venta`), de otro tenant o inexistente (lista vacia o 404 de la pagina), sin mensaje distinto, sin conteo ni total que revele existencia; la barrera es la funcion SQL y no la interfaz, asi que una llamada directa por REST recibe exactamente lo mismo. (4) Busqueda sobre la SALIDA de la vista: nombre, documento escrito, email, telefono y numero de contrato; 3 a 100 caracteres; comodines de ILIKE escapados; subcadena sin normalizar; cursor por numero de contrato descendente, pagina maxima de 50, sin total exacto. (5) Ficha `/crm/clientes-contratos/[numero_contrato]` (sin documento en la URL): pertenece a UN contrato, muestra sus datos y enlaza a `/dashboard/contratos/[numero]` y, para sus viajeros, a `Pasajeros de contratos` (regla 188, solo propios para `venta`). VARIOS CONTRATOS EN UNA FICHA, sin unir personas: seccion opcional `Otros contratos con el mismo documento escrito` = coincidencia TEXTUAL exacta de `cliente_documento` (sin normalizar, minimo 3 caracteres), mismo tenant y dentro del alcance del rol; cada contrato es una fila independiente con SU nombre, email y telefono lado a lado; no se suman, no se crea id de persona, no se muestra un `cliente` fusionado y nombre, email y telefono NUNCA se usan para encontrar ni unir; rotulo fijo `Coincidencia por texto de documento: no confirma que sea la misma persona (el contrato no guarda el tipo documental)`. El tipo que traiga el pasajero del mismo contrato con ese numero se muestra como dato de ese contrato, jamas para unir. La seccion puede omitirse sin tocar el resto. (6) Sin documento: la fila existe igual, marcada `sin documento`, sin seccion de coincidencias. (7) Historicos: lectura viva de todos los contratos; sin copia, backfill ni persistencia; cambios y cancelaciones se reflejan al instante; nada se copia a `trg_auditoria` ni a campanas; los importados del minorista se muestran con el documento tal cual. (8) Agrupar clientes (V2) solo con identidad estable CON tipo documental: exigiria registrar el tipo del titular hacia adelante (columna o marca de titular), el resultado del inventario y decision del dueno, sin backfill automatico. (9) Fuera de alcance: `crm_contactos` y consentimiento, cotizaciones y 219 (#40), B2B y #31 | PRUEBAS PREVISTAS (ninguna ejecutada; SQL y API en CI con PostgreSQL y PostgREST con JWT por rol, interfaz con React local). ROLES: anon y JWT con secreto equivocado; usuario inactivo; cliente final; agencia; freelance; `control_vuelo`; administracion y operaciones de cada tenant; gerencia y superadmin con `p_tenant` de cada agencia; `venta` con contrato propio, de un colega, de un asesor con el mismo nombre escrito distinto y sin asesor; llamadas directas a las funciones por REST con cada token, con paridad frente a la pagina. TENANT: `p_tenant` nulo, desconocido o de la otra agencia; contrato MIN- visto desde mayorista; mismo numero escrito en otro tenant. BUSQUEDA: comodines `%`, `_`, `\` y `*`; 2 y 101 caracteres; terminos de nombre, documento exacto, email y telefono de un contrato AJENO que no deben devolver nada a `venta`; igualdad byte a byte entre `no existe` y `ajeno`; cursor sin repetir ni saltar filas con mas de 50 resultados; contrato cancelado; contrato sin documento. URL DIRECTA: ficha de contrato ajeno, de otro tenant, inexistente, renumerado o eliminado devuelve la misma pagina 404 sin datos; ficha con y sin coincidencias textuales; el documento y los datos personales nunca aparecen en la URL ni en el log; el enlace a `/dashboard/contratos/[numero]` solo se genera para filas devueltas. ESTATICAS: la seccion no lee `crm_contactos`, no selecciona direccion, firma ni `share_token`, no suma importes y no usa nombre, email ni telefono para unir. REGRESION: Contratos, Pasajeros de contratos y Contactos no cambian. Consulta de inventario: anexo de esta bitacora, para revision del Coordinador; no ejecutada ni validada contra PostgreSQL | R1 `propios` depende de comparar texto del asesor: tildes, homonimos y nombres importados distintos producen falsos negativos (el asesor no ve un contrato suyo) y falsos positivos (ve el de un homonimo); la seccion 6 del inventario lo cuantifica y la deuda ya existe en la 141 y la 142 (`ventas.asesor_id`). R2 La coincidencia textual puede leerse como `misma persona`: rotulo fijo, filas independientes y seccion omitible. R3 Documentos historicos en texto libre (importador minorista), brecha desconocida hasta el inventario. R4 Buscar o filtrar por una columna que el rol no ve seria un oraculo: se filtra solo sobre la salida de la vista y, para `venta`, despues de limitar a propios. R5 Enumerar contratos por URL: respuesta uniforme para ajeno, otro tenant e inexistente. R6 Limite de filas de PostgREST: paginar por cursor. R7 Ficha por numero de contrato se rompe si se renumera o elimina: 404 sin datos. R8 Superadmin y gerencia ven ambos tenants en la vista: `p_tenant` obligatorio. R9 Telefono, email y datos de contratos ajenos siguen visibles para `venta` en Contratos; eso queda fuera de #68 y esta seccion no lo amplia. R10 Agrupar clientes (V2) exige registrar el tipo del titular hacia adelante. PREGUNTAS PARA EL COORDINADOR: Q1 mantener u omitir en V1 la seccion de coincidencia textual; Q2 numero de migracion y workflow (a asignar por el Coordinador, no reservados aqui); Q3 revisar el SQL del anexo antes de entregarlo al dueno (opcional: suprimir celdas menores a 5 al compartir resultados). Sin decisiones nuevas para el dueno | Diseno V1 cerrado para revision del Coordinador; sin GO de codigo, worktree, archivos, migracion, workflow, backfill ni SQL remoto |
| 3 / 2026-10-20 | Correccion final de diseno sobre `origin/main` `a4c999cf` (worktree CRM sin tocar). Lecturas nuevas: migracion 107 (`mi_tenant()` devuelve 'mayorista' si el usuario no tiene tenant; `puede_ver_tenant(t)` deja pasar a superadmin y gerencia en AMBOS tenants), politica `usuarios: ver propio perfil` (005) y la ausencia de CHECK en `ventas.estado` y `ventas.tipo_paquete` (son texto libre). Sustituye al ciclo 2 en tres puntos: la autoridad del tenant, la seccion opcional de coincidencias (se OMITE) y el SQL de inventario (anexo nuevo). El resto del ciclo 2 sigue vigente | (A) AUTORIDAD DEL TENANT: `p_tenant` NO decide nada para los roles de agencia. Las dos funciones leen su propio contexto en la base: `auth.uid()` y la fila de `usuarios` con `activo is true` (rol y tenant propios). Sin fila, usuario inactivo, rol fuera de superadmin, gerencia, administracion, operaciones y venta, o tenant nulo o distinto de mayorista y minorista: resultado VACIO (no se usa el valor por defecto de `mi_tenant()`). Tenant efectivo: superadmin = `p_tenant` (obligatorio, solo mayorista o minorista; nulo da vacio); gerencia, administracion, operaciones y venta = el tenant de SU fila de `usuarios`, y si `p_tenant` llega y es distinto el resultado es vacio (falla cerrado, igual que un contrato inexistente). El filtro va en el mismo WHERE sobre `ventas_basica`: `tenant = tenant efectivo` y `(rol <> 'venta' o soy_asesor_del_contrato(numero_contrato))`. La vista queda debajo como defensa en profundidad (rol y enmascarado) pero NO es la barrera por tenant, porque `puede_ver_tenant` deja ver ambos tenants a gerencia y superadmin: la funcion estrecha a gerencia a su tenant. La funcion de ficha NO recibe `p_tenant` ni usuario: busca el contrato en la vista y aplica el mismo predicado (no superadmin: el tenant del contrato debe ser el de su fila; `venta`: ademas propio); superadmin puede abrir cualquiera. (B) TENANT ACTIVO DE LA INTERFAZ: es lo que `getTenant()` resuelve en el servidor a partir de la cookie `tenant` (para quien no es superadmin siempre es su tenant; para superadmin, la cookie validada). Solo decide que agencia muestra la pagina y que valor de `p_tenant` envia el superadmin; NO es seguridad, porque una llamada REST no pasa por la pagina ni por la cookie. La base decide unicamente con el JWT y la fila de `usuarios`. Una cookie falsificada por un rol de agencia no cambia nada (el resolvedor la ignora y, aunque no lo hiciera, la base devuelve vacio). Para superadmin el tenant es un filtro, no una restriccion; si abre la ficha de una agencia distinta de la activa, la pagina responde 404 por coherencia de interfaz aunque la base se lo permitiria. (C) V1 = UNA FILA POR CONTRATO: se OMITE la seccion opcional `Otros contratos con el mismo documento escrito`. La ficha muestra solo el contrato abierto y ninguna consulta relaciona contratos por documento, nombre, correo ni telefono; no hay agrupacion ni conteo por persona. Agrupar clientes (V2) sigue condicionado a un tipo documental confiable. (D) Vigente del ciclo 2: columnas, busqueda sobre la salida de la vista, cursor de 50, ficha por numero de contrato sin datos personales en la URL, sin precio, direccion, firma ni `share_token`, sin `crm_contactos` | PRUEBAS PREVISTAS (CI con PostgreSQL y PostgREST con JWT por rol, mas pruebas locales de interfaz; ninguna ejecutada). A. TENANT POR REST, en las dos funciones y con cada token: venta, administracion, operaciones y gerencia de MAYORISTA piden `p_tenant` = minorista y reciben una respuesta vacia identica a la de un contrato inexistente; los de MINORISTA piden mayorista y reciben lo mismo; con su propio tenant o con `p_tenant` nulo reciben solo filas de su tenant; `p_tenant` invalido (x, vacio, mayusculas, texto con comillas) da vacio; superadmin con cada tenant recibe solo ese tenant y con nulo recibe vacio. B. GERENCIA ESTRECHADA: con contratos sembrados en ambos tenants, `select count(*) from ventas_basica` como gerencia ve ambos (la vista) pero la funcion devuelve solo su tenant; la prueba falla si el conjunto crece. C. CONTEXTO DE USUARIO: inactivo, tenant nulo (no cae a mayorista), sin fila en `usuarios`, agencia, freelance, cliente final y `control_vuelo` dan vacio; anon sin EXECUTE (401 o 403); JWT con secreto equivocado da 401. D. CONTRATO DE OTRO ASESOR: venta pide la ficha de un colega del mismo tenant y la de un asesor con el nombre escrito distinto, y busca por el nombre, el documento exacto, el correo y el telefono de esos contratos: vacio, igual byte a byte (cuerpo, estado y cabeceras) a un numero inexistente; sobre su propio contrato recibe una fila. E. FICHA DE OTRO TENANT: numero MIN- desde mayorista y el inverso, por cada rol, da vacio; superadmin ve ambos. F. FIRMAS: la ficha no tiene parametro de tenant ni de usuario. G. ESTATICAS: ninguna funcion usa `mi_tenant()` ni `puede_ver_tenant()` como autoridad; ninguna consulta por `cliente_documento` igual a otro contrato, nombre, correo o telefono para relacionar contratos; la ficha no consulta documento; no se lee `crm_contactos`. H. INTERFAZ: una cookie `tenant` falsificada por un rol no superadmin se ignora; la accion nunca toma el tenant de los argumentos del navegador; superadmin con cookie valida lista su agencia; ficha de otra agencia para superadmin da 404 de interfaz. I. URL DIRECTA: ficha ajena, de otro tenant, inexistente, renumerada o eliminada devuelve la misma pagina 404 sin datos; sin documento ni datos personales en la URL ni en el log. J. BUSQUEDA: comodines escapados, 2 y 101 caracteres, cursor con mas de 50 filas, contrato cancelado y contrato sin documento. K. REGRESION: Contratos, Pasajeros de contratos y Contactos sin cambios. Inventario: anexo del ciclo 3, no ejecutado ni validado contra PostgreSQL | R1 `Propios` depende de comparar texto del asesor (tildes, homonimos, nombres importados distintos): el inventario corregido mide usuarios ACTIVOS del MISMO tenant y los casos con mas de un usuario equivalente. R2 La barrera de tenant es propia de la funcion y no depende de `mi_tenant()` (que cae a mayorista) ni de `puede_ver_tenant()` (que abre ambos tenants a gerencia): un cambio futuro de esos helpers o de la vista no puede ampliar el resultado, y la prueba B lo vigila. R3 Las funciones INVOKER leen la fila propia de `usuarios` gracias a la politica `ver propio perfil` (005); si esa politica cambiara, la funcion devolveria vacio (falla cerrado) y la prueba C lo detectaria. R4 Superadmin con `p_tenant` nulo recibe vacio (no 'ambos'). R5 Discrepancia cookie/base solo existe para superadmin y no afecta la autorizacion. R6 El inventario sigue sin ejecutarse; el cruce con Contactos es COINCIDENCIA TEXTUAL de documento, no identidad confirmada (Contactos conserva tipos historicos no verificados). R7 Telefono, correo y datos de contratos ajenos siguen visibles para `venta` en Contratos; fuera de #68, y esta seccion no lo amplia. R8 Agrupar clientes (V2) exige registrar el tipo del titular hacia adelante. PREGUNTAS PARA EL COORDINADOR: Q2 numero de migracion y workflow (a asignar por el Coordinador, no reservados aqui); Q3 revisar el SQL del anexo del ciclo 3 antes de entregarlo al dueno (opcional: suprimir celdas menores a 5 al compartir resultados). Sin decisiones nuevas para el dueno | Diseno corregido para revision del Coordinador. El SQL del ciclo 2 queda reemplazado y NO debe ejecutarse. Sin GO de codigo, worktree, archivos, migracion, workflow, backfill ni SQL remoto |
| 4 / 2026-10-20 | Implementacion local (GO LOCAL #68) en worktree `.claude/worktrees/clientes-contratos-68`, rama `codex/68-clientes-contratos`, base `a4c999cf` (ancestro de `origin/main`, que sigue en `a4c999cf`). Verificado antes de escribir: la 221 estaba libre (ultima migracion del repo 219; 218 y 220 no estan en esta base). Solo archivos reservados; sin staging, commit, push, PR, SQL remoto ni escrituras en Preview. #372 y Contactos intactos. | DIFF (todo sin versionar): NUEVOS `supabase/migrations/20260601000221_clientes_contratos_crm.sql` (301 lineas: `crm_contratos_clientes_buscar` y `crm_contrato_cliente_ficha`, SECURITY DEFINER, STABLE, EXECUTE solo authenticated; actor y tenant salen de `auth.uid()` y la fila activa de `usuarios`; `p_tenant` solo filtra al superadmin y un `p_tenant` distinto del propio devuelve vacio; gerencia/administracion/operaciones acotadas a su tenant; lee `ventas_basica`; sin DDL de vistas/RLS, sin `crm_contactos`); scripts `preflight_221`, `postcheck_221`, `rollback_221`, `test_221_*.sql` y `.sh`; workflow `test-221-clientes-contratos-68.yml`; `lib/crm/clientesContratos68.ts`; paginas `app/(crm)/crm/clientes-contratos/page.tsx` y `[numero_contrato]/page.tsx`; pruebas `clientesContratos68Acceso.test.ts`, `Cableado.test.ts` y `UI.react.ts`. EDITADOS: `app/(crm)/layout.tsx` (+1 entrada de menu y su icono) y `types/database.ts` (+51 lineas, solo las dos firmas 221). GUARDA VENTA en SQL: el rol venta ve un contrato solo si `soy_asesor_del_contrato` es verdadero Y el texto de `ventas.asesor` (lower/btrim) equivale a exactamente 1 usuario activo del mismo tenant (por nombre o correo); con 2 o mas homonimos activos no ve ese contrato ni en lista ni en ficha. Una fila por contrato, sin agrupar por documento/nombre/correo/telefono, sin cruce con Contactos ni inferencia de consentimiento. Ficha: mismo vacio para ajeno, otro tenant, inexistente y sin permiso. Texto buscado en cookie httpOnly (no en URL); en URL solo el cursor (numero de contrato). | EJECUTADO LOCAL (datos sinteticos): pruebas TS `Acceso` + `Cableado` 21/21 OK; `UI.react.ts` 11/11 OK; `tsc --noEmit` sin errores; eslint sin errores en lo tocado; `npm run build` OK con las dos rutas nuevas; `git diff --check` OK; `sh -n` del runner OK; 4 mutaciones del helper (tenant a todos los roles, error crudo, sin proyeccion de columnas, parametro `p_asesor`) hacen fallar las pruebas y el helper restaurado vuelve a 0 fallos. `npm run test:unit`: 6126 pruebas, 12 fallos, el mismo conteo que la base registrada en la bitacora de #40 (la base no se re-ejecuto en este ciclo; los fallos estan en pruebas de HotelModal/tarjetas, de la 214 y de leads, que no tocan archivos de #68, y en `suitesPruebas`, que ya listaba `eliminarHotelDialog` y `tarjetasIncluyeCompacto` y ahora suma `clientesContratos68UI.react.ts`, ver pendiente 2). NO EJECUTADO: ninguna sentencia SQL ni PostgREST (Docker apagado, sin base local): la 221, preflight, postcheck, rollback, `test_221_*.sql` y los casos REST (otro tenant, otro asesor, usuarios inactivos, roles sin acceso, anon, service_role, homonimos activos/inactivos/de otro tenant) estan escritos y se corren solo en el workflow, que NO ha corrido; hasta que pase en verde no se declaran probados. Preflight y postcheck: cada uno devuelve UNA fila consolidada (diseno; sin ejecutar). | RIESGO HISTORICO DE ATRIBUCION POR NOMBRE (heredado, no resuelto): `ventas.asesor` es texto libre; la guarda cubre homonimos EXACTOS entre usuarios activos del tenant, no variantes (tildes, apodos, abreviaturas, nombre de un usuario ya inactivo, texto del importador de minorista). Un contrato historico puede aparecer a un unico usuario actual que solo comparte el texto; por eso la superficie no proclama identidad cierta y venta solo ve datos de contacto del cliente ya visibles en Contratos. Medir con el inventario agregado de la seccion 6 de esta bitacora (no ejecutado) ANTES de pasar a Ready; deuda de fondo: `ventas.asesor_id` con FK a `usuarios`. PENDIENTES: (1) 220 de #67 debe aplicarse antes que la 221 en Produccion; la 221 no usa objetos de la 220. (2) `package.json` no esta reservado: falta registrar `clientesContratos68UI.react.ts` en `test:react` (o dejarlo solo en el workflow) y por eso `suitesPruebas` lo marca; pedir decision al Coordinador. (3) Orden: preflight, 221, postcheck, rollback listo. (4) Los 12 fallos de `test:unit` no son de #68. (5) Gerencia queda acotada a su agencia aunque Contratos la deja ver ambas: decision a confirmar. | Pendiente Gate del Coordinador: revisar diff y correr el workflow en CI antes de cualquier staging; sin evidencia SQL/REST no hay GO a Preview. |

**Decisiones del dueno posteriores al gate:** D1: `venta` ve SOLO contratos propios, como en la RPC 188. D2: telefono y correo de contratos ajenos no aparecen en el nuevo directorio, aun si una ruta errada intenta consultarlos; acceso ajeno debe fallar cerrado. D3: usar solo agencia/tenant activo, decidido por el Coordinador segun el flujo existente de Contratos. D4: falta revisar el texto de la consulta agregada antes de que el dueno la ejecute. Estas decisiones no cambian `ventas_basica` ni conceden GO de codigo.

## Anexo del ciclo 2 - SQL de inventario agregado y sin PII (para revision del Coordinador)

> SUPERADO por el anexo del ciclo 3 (inventario corregido): NO ejecutar el SQL de este anexo.

Estado: NO ejecutado y NO validado contra PostgreSQL (sin Docker en el equipo del ejecutor). Revisar antes de entregarlo al dueno. Solo lectura: una transaccion `read only` que termina en `rollback`, un unico SELECT con CTE y salida en formato (seccion, tenant, metrica, valor). No devuelve ningun documento, nombre, correo ni telefono: solo conteos; las etiquetas salen de `estado` y de columnas controladas. Debe correrlo el dueno con un rol que lea `ventas`, `contrato_pasajeros`, `crm_contactos` y `usuarios` sin RLS (editor SQL de Supabase). Cada seccion responde una pregunta del diseno: 1 volumen; 2 calidad del documento; 3 repeticion de documentos; 4 evidencia de tipo documental en el pasajero del mismo contrato; 5 cobertura frente a Contactos; 6 contratos cuyo asesor no equivale a un usuario (alcance de `venta` solo propios); 7 documentos sin contacto por tipo de contrato.

```sql
begin read only;
set local statement_timeout = '120s';

with v as (
  select x.tenant,
         x.numero_contrato,
         x.estado,
         x.tipo_paquete,
         nullif(btrim(x.cliente_documento), '') as doc,
         lower(regexp_replace(coalesce(x.cliente_documento, ''), '[ .]', '', 'g')) as doc_norm,
         lower(btrim(x.cliente)) as nom,
         nullif(btrim(x.asesor), '') as asesor
    from public.ventas x
),
pax as (
  select cp.numero_contrato,
         lower(regexp_replace(coalesce(cp.identificacion, ''), '[ .]', '', 'g')) as id_norm,
         nullif(btrim(cp.tipo_id), '') as tipo_id
    from public.contrato_pasajeros cp
),
tipo_titular as (
  select v.numero_contrato,
         v.tenant,
         count(distinct p.tipo_id) as tipos_distintos,
         bool_or(p.tipo_id is null) as hay_sin_tipo
    from v
    join pax p on p.numero_contrato = v.numero_contrato and p.id_norm = v.doc_norm
   where v.doc_norm <> ''
   group by v.numero_contrato, v.tenant
),
por_doc as (
  select tenant,
         doc_norm,
         count(*) as contratos,
         count(distinct nom) as nombres
    from v
   where doc_norm <> ''
   group by tenant, doc_norm
),
en_contactos as (
  select v.tenant,
         v.numero_contrato,
         exists (
           select 1
             from public.crm_contactos c
            where c.tenant = v.tenant
              and lower(regexp_replace(coalesce(c.documento, ''), '[ .]', '', 'g')) = v.doc_norm
         ) as hay
    from v
   where v.doc_norm <> ''
),
con_asesor as (
  select v.tenant,
         v.numero_contrato,
         exists (
           select 1
             from public.usuarios u
            where lower(btrim(v.asesor)) in (lower(btrim(u.nombre)), lower(btrim(u.email)))
         ) as hay_usuario
    from v
   where v.asesor is not null
)
select seccion, tenant, metrica, valor
  from (
    select '1_volumen' as seccion, tenant, 'contratos' as metrica, count(*)::bigint as valor
      from v group by tenant
    union all
    select '1_volumen', tenant, concat('estado_', coalesce(estado, '(nulo)')), count(*)
      from v group by tenant, estado
    union all
    select '2_documento', tenant, 'sin_documento', count(*)
      from v where doc is null group by tenant
    union all
    select '2_documento', tenant, 'vacio_tras_normalizar', count(*)
      from v where doc is not null and doc_norm = '' group by tenant
    union all
    select '2_documento', tenant, 'solo_digitos_3_a_20', count(*)
      from v where doc_norm ~ '^[0-9]{3,20}$' group by tenant
    union all
    select '2_documento', tenant, 'solo_digitos_fuera_de_3_a_20', count(*)
      from v where doc_norm ~ '^[0-9]+$' and doc_norm !~ '^[0-9]{3,20}$' group by tenant
    union all
    select '2_documento', tenant, 'con_letras_o_simbolos', count(*)
      from v where doc_norm <> '' and doc_norm !~ '^[0-9]+$' group by tenant
    union all
    select '2_documento', tenant, 'posible_nit_9_o_10_digitos', count(*)
      from v where doc_norm ~ '^[0-9]{9,10}$' group by tenant
    union all
    select '2_documento', tenant, 'con_guion', count(*)
      from v where doc like '%-%' group by tenant
    union all
    select '3_repeticion', tenant, 'documentos_distintos', count(*)
      from por_doc group by tenant
    union all
    select '3_repeticion', tenant, 'documentos_en_mas_de_un_contrato', count(*)
      from por_doc where contratos > 1 group by tenant
    union all
    select '3_repeticion', tenant, 'max_contratos_por_documento', max(contratos)
      from por_doc group by tenant
    union all
    select '3_repeticion', tenant, 'documentos_con_varios_nombres', count(*)
      from por_doc where nombres > 1 group by tenant
    union all
    select '4_tipo_en_pasajero', tenant, 'contratos_con_pasajero_igual_al_documento', count(*)
      from tipo_titular group by tenant
    union all
    select '4_tipo_en_pasajero', tenant, 'de_ellos_con_un_solo_tipo', count(*)
      from tipo_titular where tipos_distintos = 1 and not hay_sin_tipo group by tenant
    union all
    select '4_tipo_en_pasajero', tenant, 'de_ellos_con_tipos_distintos', count(*)
      from tipo_titular where tipos_distintos > 1 group by tenant
    union all
    select '4_tipo_en_pasajero', tenant, 'de_ellos_sin_tipo', count(*)
      from tipo_titular where tipos_distintos = 0 group by tenant
    union all
    select '4_tipo_en_pasajero', v.tenant, 'contratos_con_documento_sin_pasajero_igual', count(*)
      from v
     where v.doc_norm <> ''
       and not exists (select 1 from tipo_titular t where t.numero_contrato = v.numero_contrato)
     group by v.tenant
    union all
    select '5_contactos', tenant, 'contratos_con_documento_ya_en_contactos', count(*)
      from en_contactos where hay group by tenant
    union all
    select '5_contactos', tenant, 'contratos_con_documento_sin_contacto', count(*)
      from en_contactos where not hay group by tenant
    union all
    select '6_asesor', tenant, 'contratos_sin_asesor', count(*)
      from v where asesor is null group by tenant
    union all
    select '6_asesor', tenant, 'contratos_con_asesor_sin_usuario_equivalente', count(*)
      from con_asesor where not hay_usuario group by tenant
    union all
    select '7_tipo_contrato', e.tenant, concat('sin_contacto_', coalesce(v.tipo_paquete, '(nulo)')), count(*)
      from en_contactos e
      join v on v.numero_contrato = e.numero_contrato
     where not e.hay
     group by e.tenant, v.tipo_paquete
  ) r
 order by seccion, tenant, metrica;

rollback;
```

Lectura de resultados prevista: la seccion 3 dice cuantos documentos se repiten y cuantos aparecen con nombres distintos (riesgo de unir personas); la 4, en cuantos contratos existe evidencia de tipo documental en el pasajero del mismo contrato y cuantos tienen tipos en conflicto; la 5 y la 7, la brecha frente a Contactos por tenant y tipo de contrato; la 6, cuantos contratos historicos quedarian fuera del alcance de `venta` por no coincidir el texto del asesor con un usuario.

## Anexo del ciclo 3 - SQL de inventario agregado y sin PII, CORREGIDO (sustituye al anexo del ciclo 2)

Estado: NO ejecutado y NO validado contra PostgreSQL (sin Docker en el equipo del ejecutor). El Coordinador lo revisa antes de entregarlo al dueno. Correcciones respecto al ciclo 2:

1. Equivalencia de asesor (seccion 6): solo cuenta un usuario ACTIVO y del MISMO tenant que el contrato, y se distingue cuando el texto del asesor equivale a mas de un usuario. No considera el rol porque `soy_ese_asesor` tampoco lo considera.
2. Cruce con Contactos (seccion 5): se llama COINCIDENCIA TEXTUAL de documento (mismo tenant, documento escrito igual tras quitar espacios y puntos). No confirma identidad: `crm_contactos` no guarda un tipo verificado y `ventas` tampoco.
3. Etiquetas: ninguna sale de texto libre. `ventas.estado` y `ventas.tipo_paquete` NO tienen CHECK, por eso se clasifican con listas cerradas (`otro_o_nulo` para el resto) y el tenant con 'otro' si no es mayorista o minorista. Todas las etiquetas de `metrica` son constantes del propio script.
4. Sigue acotada: una transaccion `read only` con `statement_timeout`, un unico SELECT con CTE que termina en `rollback`; solo conteos (seccion, tenant, metrica, valor), sin ningun documento, nombre, correo ni telefono. Debe correrlo el dueno con un rol que lea `ventas`, `contrato_pasajeros`, `crm_contactos` y `usuarios` sin RLS (editor SQL de Supabase).

Secciones: 1 volumen; 2 calidad del documento; 3 repeticion de documentos; 4 evidencia de tipo documental en el pasajero del mismo contrato; 5 coincidencia textual con Contactos; 6 contratos cuyo asesor equivale a usuarios activos del mismo tenant (alcance de `venta` solo propios); 7 contratos sin coincidencia textual en Contactos por tipo de paquete.

```sql
begin read only;
set local statement_timeout = '120s';

with v as (
  select x.numero_contrato,
         x.tenant as t_real,
         case x.tenant when 'mayorista' then 'mayorista' when 'minorista' then 'minorista' else 'otro' end as tenant,
         case lower(btrim(x.estado))
           when 'pendiente' then 'pendiente'
           when 'confirmado' then 'confirmado'
           when 'activo' then 'activo'
           when 'cancelado' then 'cancelado'
           when 'cancelada' then 'cancelado'
           when 'anulado' then 'cancelado'
           when 'anulada' then 'cancelado'
           else 'otro_o_nulo'
         end as estado_cat,
         case lower(btrim(x.tipo_paquete))
           when 'bloqueo' then 'bloqueo'
           when 'empaquetado' then 'empaquetado'
           when 'dinamico' then 'dinamico'
           when 'porcion_terrestre' then 'porcion_terrestre'
           when 'programa' then 'programa'
           when 'carrito' then 'carrito'
           when 'servicios' then 'servicios'
           else 'otro_o_nulo'
         end as tipo_cat,
         nullif(btrim(x.cliente_documento), '') as doc,
         lower(regexp_replace(coalesce(x.cliente_documento, ''), '[ .]', '', 'g')) as doc_norm,
         lower(btrim(x.cliente)) as nom,
         nullif(btrim(x.asesor), '') as asesor
    from public.ventas x
),
pax as (
  select cp.numero_contrato,
         lower(regexp_replace(coalesce(cp.identificacion, ''), '[ .]', '', 'g')) as id_norm,
         nullif(btrim(cp.tipo_id), '') as tipo_id
    from public.contrato_pasajeros cp
),
tipo_titular as (
  select v.numero_contrato,
         v.tenant,
         count(distinct p.tipo_id) as tipos_distintos,
         bool_or(p.tipo_id is null) as hay_sin_tipo
    from v
    join pax p on p.numero_contrato = v.numero_contrato and p.id_norm = v.doc_norm
   where v.doc_norm <> ''
   group by v.numero_contrato, v.tenant
),
por_doc as (
  select tenant,
         doc_norm,
         count(*) as contratos,
         count(distinct nom) as nombres
    from v
   where doc_norm <> ''
   group by tenant, doc_norm
),
coincidencia_textual as (
  select v.tenant,
         v.numero_contrato,
         v.tipo_cat,
         exists (
           select 1
             from public.crm_contactos c
            where c.tenant = v.t_real
              and lower(regexp_replace(coalesce(c.documento, ''), '[ .]', '', 'g')) = v.doc_norm
         ) as hay
    from v
   where v.doc_norm <> ''
),
con_asesor as (
  select v.tenant,
         v.numero_contrato,
         (select count(*)
            from public.usuarios u
           where u.activo is true
             and u.tenant = v.t_real
             and lower(btrim(v.asesor)) in (lower(btrim(u.nombre)), lower(btrim(u.email)))) as n_usuarios
    from v
   where v.asesor is not null
)
select seccion, tenant, metrica, valor
  from (
    select '1_volumen' as seccion, tenant, 'contratos' as metrica, count(*)::bigint as valor
      from v group by tenant
    union all
    select '1_volumen', tenant, concat('estado_', estado_cat), count(*)
      from v group by tenant, estado_cat
    union all
    select '2_documento', tenant, 'sin_documento', count(*)
      from v where doc is null group by tenant
    union all
    select '2_documento', tenant, 'vacio_tras_normalizar', count(*)
      from v where doc is not null and doc_norm = '' group by tenant
    union all
    select '2_documento', tenant, 'solo_digitos_3_a_20', count(*)
      from v where doc_norm ~ '^[0-9]{3,20}$' group by tenant
    union all
    select '2_documento', tenant, 'solo_digitos_fuera_de_3_a_20', count(*)
      from v where doc_norm ~ '^[0-9]+$' and doc_norm !~ '^[0-9]{3,20}$' group by tenant
    union all
    select '2_documento', tenant, 'con_letras_o_simbolos', count(*)
      from v where doc_norm <> '' and doc_norm !~ '^[0-9]+$' group by tenant
    union all
    select '2_documento', tenant, 'posible_nit_9_o_10_digitos', count(*)
      from v where doc_norm ~ '^[0-9]{9,10}$' group by tenant
    union all
    select '2_documento', tenant, 'con_guion', count(*)
      from v where doc like '%-%' group by tenant
    union all
    select '3_repeticion', tenant, 'documentos_distintos', count(*)
      from por_doc group by tenant
    union all
    select '3_repeticion', tenant, 'documentos_en_mas_de_un_contrato', count(*)
      from por_doc where contratos > 1 group by tenant
    union all
    select '3_repeticion', tenant, 'max_contratos_por_documento', max(contratos)
      from por_doc group by tenant
    union all
    select '3_repeticion', tenant, 'documentos_con_varios_nombres', count(*)
      from por_doc where nombres > 1 group by tenant
    union all
    select '4_tipo_en_pasajero', tenant, 'contratos_con_pasajero_igual_al_documento', count(*)
      from tipo_titular group by tenant
    union all
    select '4_tipo_en_pasajero', tenant, 'de_ellos_con_un_solo_tipo', count(*)
      from tipo_titular where tipos_distintos = 1 and not hay_sin_tipo group by tenant
    union all
    select '4_tipo_en_pasajero', tenant, 'de_ellos_con_tipos_distintos', count(*)
      from tipo_titular where tipos_distintos > 1 group by tenant
    union all
    select '4_tipo_en_pasajero', tenant, 'de_ellos_sin_tipo', count(*)
      from tipo_titular where tipos_distintos = 0 group by tenant
    union all
    select '4_tipo_en_pasajero', v.tenant, 'contratos_con_documento_sin_pasajero_igual', count(*)
      from v
     where v.doc_norm <> ''
       and not exists (select 1 from tipo_titular t where t.numero_contrato = v.numero_contrato)
     group by v.tenant
    union all
    select '5_coincidencia_textual_contactos', tenant, 'contratos_con_coincidencia_textual_de_documento', count(*)
      from coincidencia_textual where hay group by tenant
    union all
    select '5_coincidencia_textual_contactos', tenant, 'contratos_sin_coincidencia_textual_de_documento', count(*)
      from coincidencia_textual where not hay group by tenant
    union all
    select '6_asesor', tenant, 'contratos_sin_asesor', count(*)
      from v where asesor is null group by tenant
    union all
    select '6_asesor', tenant, 'asesor_sin_usuario_activo_del_tenant', count(*)
      from con_asesor where n_usuarios = 0 group by tenant
    union all
    select '6_asesor', tenant, 'asesor_con_un_usuario_activo_del_tenant', count(*)
      from con_asesor where n_usuarios = 1 group by tenant
    union all
    select '6_asesor', tenant, 'asesor_con_varios_usuarios_activos_del_tenant', count(*)
      from con_asesor where n_usuarios > 1 group by tenant
    union all
    select '7_tipo_de_paquete', tenant, concat('sin_coincidencia_textual_', tipo_cat), count(*)
      from coincidencia_textual where not hay group by tenant, tipo_cat
  ) r
 order by seccion, tenant, metrica;

rollback;
```

Lectura prevista: la seccion 3 dice cuantos documentos se repiten y cuantos con nombres distintos (riesgo de unir personas si algun dia se agrupa); la 4, en cuantos contratos hay evidencia de tipo documental en el pasajero del mismo contrato y cuantos tienen tipos en conflicto; la 5 y la 7, la brecha de COINCIDENCIA TEXTUAL frente a Contactos por tenant y tipo de paquete (no prueba que sea la misma persona); la 6, cuantos contratos historicos quedarian fuera del alcance de `venta` (sin usuario activo equivalente en su tenant) y cuantos podrian atribuirse a mas de un usuario.

El ejecutor agrega una fila nueva al terminar: base/HEAD, archivos leidos, fuentes exactas y reglas de acceso, hallazgos verificables, pruebas/consultas ejecutadas, resultados agregados sin PII, propuesta de fases y decisiones pendientes. No leer ni publicar secretos o documentos de clientes. Si una consulta remota de solo lectura ayudaria, entregar el SQL al dueno para que el lo ejecute; no hacerlo desde el chat. La bitacora por si sola no autoriza staging, commit, push, PR ni SQL remoto.
