# Soportes de pago del aliado B2B y avisos internos (#86, migración 281)

Estado: **código y migración escritos y probados en local; NADA aplicado en remoto. #86 NO está completo**: falta la auditoría y la validación en Preview (la migración 281, el despliegue y Preview/Producción los ejecuta el dueño).

**Siguen pendientes, de forma explícita:** (1) los participantes **exclusivamente por comisión** (ni avisos ni acceso: pendiente de aclaración del dueño); (2) **no hay avisos con el navegador cerrado** (haría falta service worker + Push API + suscripciones + envío desde servidor; no se construyó ni se promete).

## Qué hace

- El aliado adjunta comprobantes (PDF, JPG o PNG) a **sus** contratos desde `Portal → Cartera → Soportes de pago`.
- Un soporte **no es un pago**: no toca abonos, saldos, asientos ni conciliación.
- **Límite por contrato:** soportes vigentes ≤ número de abonos registrados. Pueden ser menos (un PDF puede reunir varios abonos). No hay vínculo soporte–abono.
- **Reemplazar** (mantiene la cantidad vigente) y **retirar** (saca del conjunto vigente) conservan fila, actor, fecha **y el archivo anterior**. Nada se borra físicamente en esta entrega.
- **Excedido** (más vigentes que abonos, p. ej. tras anular un abono) **se calcula, no se guarda**. Estando excedido: reemplazar ✔, retirar ✔, subir uno nuevo ✘. La anulación de abonos (`anular_abono`, 248) no se modifica ni se bloquea.
- El personal interno consulta los soportes y su historial en la ficha del contrato (`contratos/[numero]`).
- Avisos **solo dentro del sistema** (campana, contador, título de pestaña, notificación del navegador y sonido con activación de la persona). Sin correo.

## Mapa de código

| Pieza | Archivo |
|---|---|
| Migración (tablas, triggers, funciones, bucket) | `supabase/migrations/20260601000281_soportes_pago.sql` |
| Preflight / postcheck / rollback (una consulta cada uno) | `supabase/scripts/{preflight,postcheck,rollback}_281_soportes.sql` |
| Reglas puras del archivo (tipo por bytes, hash, límite configurable) | `lib/soportes/archivo.ts` |
| Orquestación Storage + base con compensación | `lib/soportes/operaciones.ts` |
| Autorización del aliado y lecturas (service-role) | `lib/soportes/servidor.ts` |
| Acciones del aliado (subir, reemplazar, retirar, abrir) | `app/portal/b2b/cartera/soportes-actions.ts` |
| UI del aliado (tarjetas, sin scroll horizontal) | `components/portal/SoportesPago.tsx` + pestaña `vista=soportes` en `app/portal/b2b/cartera/page.tsx` |
| Apertura y vista interna | `app/(dashboard)/dashboard/contratos/[numero]/{soportes-actions.ts,SoportesPagoInterno.tsx}` |
| Avisos: acciones / textos / campana | `lib/avisos/actions.ts`, `lib/avisos/presentacion.ts`, `components/avisos/CampanaAvisos.tsx` (montada en `PortalShell` y en `Topbar`/layout del dashboard) |
| Tipos de las tablas y funciones nuevas | `types/database.ts` |

## Reglas que impone la BASE (no la interfaz)

- Cada función (`soporte_registrar`, `soporte_reemplazar`, `soporte_retirar`) toma primero `FOR UPDATE` sobre `ventas` — el mismo primer bloqueo de `anular_abono` y `registrar_abono` (venta → abono) — y después solo filas de soportes/avisos, que esas RPC no tocan. No hay ciclo con ellas. `lock_timeout` de 5 s.
- Trigger de inserción: el contrato existe, el `tenant` coincide con el de la venta, el cupo (`vigentes + 1 ≤ abonos`). **Sustitución sin bandera:** la fila nueva declara `reemplaza_id` y el trigger verifica que la anterior es del mismo contrato, quedó retirada con motivo `reemplazo` **en esa misma transacción** y nadie la sustituyó antes (índice único parcial). Un trigger **diferido** comprueba al confirmar que todo reemplazo tiene sucesor.
- Inmutabilidad de contrato, tenant, ruta, hash y autor; sin `DELETE` ni `TRUNCATE`; sin vuelta atrás de un retiro.
- `anon`/`authenticated`/`service_role` no escriben la tabla directamente; solo las funciones `SECURITY DEFINER` (ejecutables únicamente por `service_role`).
- **Autorización del aliado = código** (service-role): `contratosDelPortalB2B` (ids; respaldo por nombre solo si ya está concedido). **Participar por comisión no concede nada.** Se vuelve a resolver en CADA operación, leyendo el contrato de la base (nunca del navegador).
- **Lectura interna = RLS** (`contrato_soportes_pago`): superadmin; gerencia/administración/operaciones de la **misma** agencia; `venta` solo en contratos donde es el asesor (`soy_asesor_del_contrato` + `puede_ver_contrato`). Mismo alcance que la 150 da a los archivos de `contratos`. La URL firmada interna se emite solo si la fila es visible bajo RLS.

## Confirmación incierta del registro (nunca se arriesga evidencia registrada)

Storage y Postgres no comparten transacción. Tras subir el objeto, `soporte_registrar`/`soporte_reemplazar` puede responder de tres maneras (`lib/soportes/operaciones.ts`):

| Respuesta | Qué se sabe | Qué se hace |
|---|---|---|
| Éxito | vínculo confirmado | listo |
| **Rechazo definitivo**: la función SQL levantó una excepción propia (`SOPORTE_*`: límite, no vigente…) | la transacción se revirtió entera: **no hay vínculo** | se borra **solo** el objeto recién subido (si ese borrado falla, se reporta el huérfano con su ruta) |
| **Incierto**: excepción de transporte, corte, respuesta ilegible, error desconocido | la fila **pudo** haberse confirmado y perderse solo la respuesta | **no se borra nada**. Se pregunta a la base por la ruta única: *vinculado* → éxito sin duplicar; *ausente* o *no se pudo preguntar* → el archivo **se conserva** y queda un `console.error` `[soportes] CONCILIAR: …` con la ruta |

«Ausente» tampoco autoriza a borrar: la petición original podría seguir en vuelo y confirmarse después, y un borrado dejaría evidencia registrada sin archivo. Costo asumido: algún objeto huérfano conservado (se concilia a mano; sin limpieza automática).

**Reintento sin duplicados.** Antes de subir, la acción comprueba si el contrato ya tiene **vigente** un soporte con el mismo SHA-256 (`soporteVigenteConHash`); si es así, responde «ok» sin subir, sin fila nueva y sin aviso. Límite honesto: dos subidas **idénticas simultáneas** podrían pasar ambas la comprobación (no hay índice único por contenido); reemplazar un soporte por un archivo idéntico a otro ya vigente del mismo contrato tampoco hace nada.

## Consecutivo reutilizado: la evidencia sigue al CONTRATO, no al número

El mecanismo existente (`eliminar_contrato(p_reusar => true)`, solo minorista: un DTM- nunca se recicla) libera el `numero_contrato` en `numeros_contrato_liberados` y el siguiente contrato nace con **el mismo número**, quizá de **otro aliado**. Como la evidencia se relaciona por número, sin más el contrato B heredaría los soportes y avisos de A. **Reproducido** contra el esquema real con `eliminar_contrato` y `siguiente_numero_contrato_para_tenant` (antes de la corrección fallaron 5 de las 8 comprobaciones: B listaba, abría y contaba los soportes de A, su gerencia y su asesor los veían por RLS y los avisos viejos seguían en la campana).

**Corrección mínima (dentro de la 281, que no se ha aplicado):** un trigger `AFTER DELETE` sobre `ventas` (`trg_f281_archivar_evidencia`, solo hace `UPDATE` de las tablas de esta migración; no toca ni lee nada financiero ni cambia `eliminar_contrato`) pone `archivado_en` a los soportes y avisos de ese número en el instante en que el contrato deja de existir.
- **Se conserva todo:** filas y archivos; nada se borra. Lo archivado queda **congelado** (`F4520`) y no se puede borrar (`F4518`).
- **Sale de circulación:** no cuenta para el límite, no se lista, no lo abren ni el aliado ni el personal (RLS: solo **superadmin** conserva el acceso), no se reemplaza ni se retira, y los avisos archivados no se reclaman, cuentan ni listan.
- Un contrato nuevo con el mismo número **empieza limpio**: sus soportes (`archivado_en is null`) son lo único que cuenta.
- Cubre cualquier forma de desaparecer la fila de `ventas` (`eliminar_contrato`, `revertir_contrato_incompleto`, un `DELETE` manual).
- **Renumerar un contrato:** la evidencia **sigue al contrato** (sección siguiente).

## Renumerar un contrato: sigue siendo el mismo contrato (alternativa A, dentro de la 281)

`fn_renumerar_contrato` (115) copia la fila de `ventas` con el número nuevo, mueve las hijas **por clave foránea** y borra la vieja. Estas tablas no tienen esa clave a propósito, así que sin más el borrado las archivaba y el aliado perdía sus soportes de la ficha. `ventas` **no tiene** una identidad estable aprovechable (la clave es el número; `share_token` se regenera; `created_at` se copia pero no es único), así que **no se creó `contrato_uid`**: se traslada la relación dentro de la renumeración.

- **Qué hace la 281:** reemplaza `fn_renumerar_contrato` (`create or replace`) añadiendo **dos líneas** a la definición de la 115: (1) bloquea la fila *vieja* de `ventas` antes de copiarla y (2) llama a `f281_trasladar_evidencia(viejo, nuevo)` **antes** del `delete`, en la misma transacción. El resto del comportamiento, el propietario, `SECURITY DEFINER`, `search_path` y los **permisos** no cambian (la migración y los pre/postchecks lo comprueban; no se amplían ejecutores).
- **El traslado:** mueve a un número nuevo soportes (vigentes e historial) y avisos no archivados. La **ruta física** de cada archivo no cambia; la autorización usa el `numero_contrato` **actual** de la fila, nunca la ruta. Los reemplazos y su historial conservan su relación (`reemplaza_id`). Los abonos ya los mueve la propia renumeración, así que los conteos (límite) siguen.
- **Restringido al mecanismo privilegiado:** `f281_trasladar_evidencia` **no tiene ejecutores** (ni public, anon, authenticated ni service_role): solo la invoca `fn_renumerar_contrato` (`SECURITY DEFINER`, mismo propietario). Ningún cliente puede escribir el número: sin `UPDATE` directo; el trigger de inmutabilidad solo acepta el cambio de número si, a la vez, (a) la marca local de transacción que fija únicamente el traslado coincide con el par viejo→nuevo y (b) las dos ventas existen con la misma agencia y el mismo `created_at`. La coincidencia de agencia y `created_at` es una **comprobación de coherencia, no una autorización** (por sí sola no basta, ni la marca sola tampoco: probado).
- **Concurrencia (orden de bloqueos único: venta → soportes):** la renumeración bloquea la venta vieja primero. Una alta de soporte en curso bajo el número viejo termina **antes** del traslado y su soporte viaja al número nuevo; una que llegue **después** no encuentra el contrato (`F4510`): **nada se registra bajo el número viejo**. `reemplazar`/`retirar` re-resuelven el número si el soporte se movió mientras esperaban el bloqueo (`f281_bloquear_contrato_del_soporte`). Probado con sesiones reales: renumeración vs alta, alta vs renumeración, vs reemplazar, vs retirar y vs `anular_abono` en ambos órdenes (sin interbloqueo).
- **Número viejo reutilizado por otro aliado:** como lo movido ya no está bajo ese número, B no ve, abre, reemplaza, retira ni cuenta nada de R, no recibe sus avisos y su personal/asesor solo ve lo de B. Lo conserva R bajo el número nuevo. (La eliminación sigue archivando, como antes.)
- **Pre/postchecks y rollback:** el preflight **bloquea** si la definición remota de `fn_renumerar_contrato` no es exactamente la de la 115 (md5 del cuerpo sin CR) y la propia migración **aborta** en ese caso sin crear nada. La 281 guarda en `f281_respaldo_funciones` la definición y los permisos originales; el postcheck verifica que los permisos/propietario son idénticos y que la función llama al traslado y bloquea primero. El **rollback restaura la original** (cuerpo, permisos, propietario) y comprueba que quedó idéntica, pero **se niega** —sin tocar nada— si la función o sus permisos cambiaron después de la 281, o si ya hay soportes/archivos.

## Archivo y Storage

- Bucket **privado** `soportes-pago` (5 MB, PDF/JPEG/PNG) **sin ninguna policy**: ningún usuario lo toca con su sesión. El bucket `contratos` y sus policies no se tocan.
- Subida **mediante Server Action**: el servidor lee los bytes, valida **tamaño real y tipo real (firma de bytes)**, calcula el SHA-256 **de esos mismos bytes** y **sube esos mismos bytes** a una ruta que él genera (`contrato/uuid.ext`, sin `upsert`). Nunca se copia desde un temporal ni confía en el nombre o `Content-Type` del navegador.
- **Límite:** `SOPORTES_MAX_BYTES` (opcional). Por defecto **4 MB**; nunca más de 4,4 MB mientras pase por una función. La interfaz muestra el máximo antes de subir. **No hay modo de subida directa firmada** en esta entrega.
- Si la base rechaza (límite, carrera), se borra **solo el objeto recién subido**; si ese borrado falla, el huérfano se **reporta** (`console.error` con la ruta). El archivo anterior jamás se toca.
- Los objetos huérfanos (subidos sin fila) no se limpian automáticamente; no hay tarea periódica en esta entrega.

## Avisos

- Destinatarios (`f281_destinatarios`): superadmin; gerencia/administración/operaciones de la agencia del contrato; y el asesor **solo** si `ventas.asesor` identifica a **un único** usuario `venta` activo de esa agencia (nombre o correo normalizados). Ambiguo o sin coincidencia → no se avisa por esa vía. Nunca el actor. **Participantes solo por comisión: pendiente de aclaración del dueño; no se incluyen.**
- El aviso guarda tipo + número de contrato, nada más. **Recibir un aviso no concede acceso**: abrirlo vuelve a autorizar.
- **Reclamado ≠ leído.** `notificado_en` lo fija `avisos_reclamar` (atómico, `FOR UPDATE SKIP LOCKED`): solo la pestaña que lo obtiene muestra notificación/sonido. `leido_en` solo lo fija la persona (`avisos_marcar_leidos`). Reclamar nunca marca leído.
- **Sonido tras recargar.** La preferencia («activado») sobrevive a una recarga (localStorage) y el permiso lo recuerda el navegador, pero un `AudioContext` **no** y el navegador solo deja crearlo/reanudarlo **dentro de un gesto** de la persona. Tras recargar el sonido queda **«en espera»**: se arma con el **primer clic o tecla** en la página (listener de una sola vez) o con el botón «Activar el sonido ahora». Mientras tanto el aviso llega igual (notificación, contador, título) pero **no se intenta ni se promete sonido**; el panel lo dice. Probado con el componente real (`pruebas/campanaAvisos86.react.ts`).
- Abrir un aviso lo marca leído (solo ese); «Marcar todo como leído» marca el resto; reclamar para notificar nunca marca leído.
- Sondeo cada 30 s, **sin pausar** en pestañas ocultas (más sondeo inmediato al volver). El navegador puede ralentizar temporizadores en segundo plano: latencia posible de ~1 minuto o más, sin plazo garantizado. **Con el navegador cerrado no hay avisos** (haría falta service worker + Push API + suscripciones + envío desde servidor; no se construyó).
- Solo se reclama con permiso `granted` y activación de la persona (clic). Denegado/no soportado: contador y título siguen funcionando.

## Inventario de escritores de `abonos` y su efecto real sobre el límite

El límite lee el conteo de abonos con la venta bloqueada (`FOR UPDATE`). Solo importa quién cambia la **cantidad**; los que cambian importes o fechas no afectan al límite.

| Escritor | Qué cambia | ¿Toma el bloqueo de `ventas`? | Efecto sobre el límite |
|---|---|---|---|
| `actualizarAbono` (`contratos/actions.ts`, `update` por id) | solo importes, TRM, fecha, forma de pago, referencia (no el contrato ni la cantidad) | no | **ninguno** |
| Migración 095 (`update` de trm/monto_cop, una sola vez) y triggers de 208 (marca/rev) | solo columnas | n/a | **ninguno** |
| `registrar_abono` (248) | **+1** | sí (venta → abono) | afloja el límite; serializado con las funciones nuevas |
| `anular_abono` (248) | **−1** | sí (venta → abono) | puede dejar el contrato *excedido* (permitido; no se bloquea) — orden de bloqueos verificado, sin ciclo |
| Funciones SQL de 164/198 (convertir cotización en contrato y aplicar pagos previos a abonos) | **+N** al crear el contrato o al aplicar un pago previo | dentro de su propia transacción de creación | afloja el límite; no hay soportes previos a la creación |
| Importador de histórico minorista (`contratos/importar/actions.ts`: `delete` por lote + `insert`) | **−N y +M** en pasos separados | **no** | puede dejar el conteo en 0 un instante (las altas se rechazan por límite: seguro) o dejarlo por debajo de los soportes (*excedido*: permitido). **Nunca** deja un soporte con una fila inválida ni borra evidencia. Solo superadmin/administración y solo minorista |
| `eliminar_contrato` (60/117/159/166/196) | borra **todos** los abonos y el contrato | propio | los soportes y archivos **se conservan** (la tabla no tiene FK a `ventas` a propósito); una alta concurrente se serializa por la fila de la venta y falla con «contrato inexistente» |

**Conclusión verificada (no refactorizada):** el único escritor de cantidad que no toma el bloqueo es el importador; lo peor que puede producir es *excedido*, un estado que el diseño admite de primera clase (reemplazar y retirar siguen funcionando). Ningún escritor puede producir una fila inválida ni perder evidencia. Cubierto por la carrera C8 de `test_281_soportes.sh` (borrado de un abono sin bloqueo mientras una alta está en curso: sin errores, queda excedido, nada se pierde). No se auditó código fuera de `app` y `lib` ni migraciones posteriores a la 280.

## Pruebas (todas locales; ver "Límites" abajo)

| Qué | Cómo se corre (desde `dspacios-travel/`) |
|---|---|
| Unitarias puras (archivo, límite, orquestación con fallos y confirmación incierta, textos) | `node --test --experimental-strip-types --experimental-test-module-mocks --experimental-loader ./pruebas/support/aliasLoader.mjs pruebas/soportes86.test.ts` |
| Base: límite, reemplazo, **excedido con `anular_abono` real**, sustitución forjada, inmutabilidad, privilegios, RLS por rol/agencia, destinatarios, reclamar≠leído, bucket + **carreras de dos sesiones** (alta/alta, reemplazo/reemplazo, reemplazo/retiro, alta/anulación, anulación/alta, excedido/anulación, reclamo/reclamo) | `sh supabase/scripts/test_281_soportes.sh t281_x` |
| **Componente real de la campana** (jsdom: activar, recargar, aviso, sonido en espera y gesto, dos pestañas, reclamar≠leído, abrir=leído, instancia oculta) | `node --experimental-test-module-mocks --import ./pruebas/support/registrarProgramasRuta.mjs --experimental-loader ./pruebas/support/reactLoader.mjs --test pruebas/campanaAvisos86.react.ts` |
| **Acciones reales** con sesiones de distintas agencias (Server Actions + RLS + PostgREST; Storage simulado en memoria para observar bytes y fallos) | `sh supabase/scripts/test_281_acciones.sh t281a_x pg86soportes plantilla86` |
| **Storage real** (storage-api local): tamaño, tipos, acceso, sobrescritura, URL firmada de subida y de lectura, mismos bytes, memoria/concurrencia | `sh supabase/scripts/test_281_storage.sh t281s_x` |
| Ensayo de las etapas remotas (preflight → migración → postcheck → rollback → preflight) | `sh supabase/scripts/verificar_281_etapas.sh t281e_x` |

Preparar el esquema local: `docker run -d --name pg86soportes -e POSTGRES_PASSWORD=postgres public.ecr.aws/supabase/postgres:15.8.1.085` y `sh supabase/scripts/preparar_esquema_local.sh pg86soportes 280 plantilla86` (≈ 10 min).

## Límites reales (no los pases por alto)

- **Nada se probó contra Supabase ni Vercel remotos.** El límite de 4,5 MB por solicitud de Vercel Functions viene de su documentación oficial, no de una prueba. El límite global de archivo del proyecto Supabase no se conoce desde el repo.
- El arnés de Storage mide **storage-api v1.84.19 local**. En él, la URL firmada de subida respetó el límite y los tipos del bucket y no pudo reutilizarse ni apuntar a otra ruta; aun así el diseño **no la usa** (decisión: modo función con límite conservador). Adoptarla exigiría repetir el arnés contra un proyecto desechable.
- La prueba de acciones simula Storage; la de Storage real no ejecuta las acciones. Juntas cubren el recorrido, pero no hay una prueba única que una ambas.
- El orden de bloqueos se verificó para `anular_abono`, `registrar_abono` y las funciones nuevas. **No se auditaron** otros escritores de `abonos` (p. ej. `actualizarAbono`, `eliminarAbono`, importadores): si alguno cambiara el conteo sin tomar el bloqueo de `ventas`, el límite podría desfasarse en una carrera. No se refactorizó nada financiero.
- No se validó con lector de pantalla ni en dispositivos reales; la interfaz se revisó solo por construcción (tarjetas que envuelven, sin tablas).

## Orden de aplicación (lo ejecuta el dueño)

1. `preflight_281_soportes.sql` → debe decir `APLICABLE`.
2. Migración `20260601000281_soportes_pago.sql`.
3. `postcheck_281_soportes.sql` → debe decir `CORRECTA`.
4. Desplegar el código. (El código nuevo no se usa hasta que la 281 esté aplicada: las pantallas consultan las tablas nuevas.)
5. Rollback (si hiciera falta): `rollback_281_soportes.sql` se niega si ya hay soportes o archivos.

## Pendientes

- Participantes exclusivamente por comisión: ¿reciben aviso? (sin acceso al contrato en ningún caso).
- Limpieza automática de objetos huérfanos y borrado físico: fuera de alcance, aprobado así.
- Compresión de imágenes: fuera de alcance (decisión del dueño).
- Realtime y avisos con el navegador cerrado: fuera de alcance.
