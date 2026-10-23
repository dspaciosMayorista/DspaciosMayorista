# TASKS.md - Dspacios Mayorista

Fuente unica de pendientes activos. Actualizado: 2026-10-14. Los numeros son IDs estables; no se renumeran al cerrar tareas. La copia versionada en el repo es canonica y el espejo de coordinacion se mantiene sincronizado temporalmente.

Los cierres y antecedentes retirados estan en TASKS_ARCHIVE.md. Reservas, worktrees, migraciones y dependencias vivas estan en WORKSTREAMS.md; este listado no autoriza codigo, PR ni SQL remoto por si solo.

## Cola priorizada

**Cierres inmediatos:** 207 (acceso CRM) -> #44 (reintento financiero) -> #30 B (206 y 208). #14 y #38 esperan validacion funcional; #209 quedo cerrado. Los demas pendientes conservan su ID y requieren gate propio.

### 4. (Diferida) Auditar un modulo comercial ligero ligado a salidas

- [ ] Registrar para auditoria futura un modulo comercial ligero ligado a fechas de salida, vuelos y opciones hoteleras, con concrecion de proveedores al momento de reservar.
- Diferida por decision del usuario (2026-09-30): sin diseno ni implementacion por ahora. No iniciar hasta que el usuario lo priorice.

### 5. Catalogos compartidos y selectores buscables: validar lo integrado

Hecho en `main` (no reabrir):
- [x] Selectores buscables `ComboDestino`, `ComboProveedor`, `ComboHotel` y `ComboNombre` (`components/`) integrados en 19 formularios del panel y del CRM: hoteles, servicios, programas, paquetes, contratos, vouchers, pagos, CRM difusion, vuelos/bloqueos y empaquetados (`27fa9402`, `eb274b5b`, con pruebas de interaccion `pruebas/combo*Interaccion.react.ts`). Los `<select>` nativos que quedan con "destino" son de records de vuelo o del tarifario publico, no del catalogo.
- [x] Proveedores: catalogo base (`proveedores`) legible por personal interno activo de ambas agencias; escritura solo Mayorista autorizada; agencia/freelance/cliente_final sin lectura. Ocho datos sensibles (`nit`, `razon_social`, `datos_pago`, `banco`, `tipo_cuenta`, `numero_cuenta`, `politica_reservas`, `voucher_contacto`) movidos a `proveedores_datos_sensibles` (solo Mayorista; superadmin/gerencia leen ambas). Escritura por la RPC transaccional `guardar_proveedor`. El voucher usa solo `voucher_contacto`. Migraciones 189/190/191 (PR #333); la 191 aplicada en produccion segun el usuario.

Pendiente:
- [ ] Validar en produccion el flujo con un proveedor NUEVO: crear con datos sensibles, editar, usarlo en hotel/servicio/CxP/voucher y comprobar que Minorista ve el catalogo base pero no los datos sensibles.
- [ ] Validar con datos reales de ambas agencias el comportamiento del catalogo y de los selectores (coincidencias, duplicados, texto libre).
- [ ] Documentar la matriz de lectura/escritura resultante por catalogo (no existe todavia un documento en el repo). No ampliar acceso entre tenants por inferencia ni ejecutar SQL remoto sin autorizacion.

### 6. Tarjetas de Vista Booking y otras vistas

- [ ] Rediseñar las tarjetas tras acordar el detalle visual con el usuario; el shell y los buscadores de la fase 1 ya están cerrados en PR #327.
- [ ] Conservar precios, disponibilidad, lógica de filtros, identidad `(hotelId, paqueteId)` y fuentes de datos. Modal y carrito se revisan por separado; no asumir que la fase 1 los rediseñó.
- [ ] Abordar las demás vistas después de cerrar el alcance de tarjetas.

### 7. Smoke financiero posterior al PR #294

- [ ] Crear un caso real con servicio incluido por grupo y comparar vitrina, carrito, cotizacion y contrato.
- [ ] Confirmar una sola CxP por servicio, costos correctos y margen correcto.
- [ ] Confirmar en Vercel `/api/cron/reconciliar-financiero` y su ejecucion con `CRON_SECRET`.

### 8. Soporte unidad para paquetes dinamicos

- [ ] Implementar soporte real de `salidas_dinamicas` y cotizacion antes de anunciar hoteles unidad de paquetes `dinamico`.
- [ ] Mantenerlos excluidos o marcados como no compatibles hasta completar la integracion.

### 9. Soporte unidad para paquetes de servicios

- [ ] Implementar soporte real de hoteles unidad en paquetes `servicios` antes de anunciarlos como cotizables.
- [ ] Mantenerlos excluidos o marcados como no compatibles hasta completar la integracion.

### 10. Smoke visual de condiciones y restricciones

- [ ] Validar en produccion badges y condiciones en Booking y carrito de los PR #286/#287.
- [ ] Confirmar que el contenido sea consistente en escritorio, movil e impresion cuando aplique.

### 11. Smoke de excepcion comercial

- [ ] Probar con superadmin y contrato restringido el formulario, la autorizacion y la trazabilidad.
- [ ] Mantener como deuda no bloqueante la reutilizacion de la consulta de vigencia para evitar una segunda consulta O(1) a `hotel_temporadas`.

### 12. Destinos: validaciones residuales tras PR #334/#335

Conteos por destino, modal explicativo y fusion sin hoteles ya estan en `main` (ver "Cerrado recientemente"). Queda:
- [ ] Confirmar por separado los casos que el usuario no valido en Preview: rol sin acceso (`control_vuelo` sin insignia de receptivos), "Actualizar lista" con datos que cambiaron, destinos con mas de 50 receptivos y el texto del modal segun el rol.
- [ ] Confirmar con el usuario si la "otra queja" sobre el modal de eliminacion quedo resuelta por PR #335 (el modal ahora ofrece fusionar segun el contenido verificado, no segun la cantidad de hoteles) o sigue abierta.

### 13. Deuda de lint global

- [ ] Deuda conocida, no bloqueante: `npm run lint` global con 223 problemas preexistentes (169 errores, 54 advertencias; re-medido en `main` `8539732c` el 2026-09-30, misma cifra que registro la rama `ronda1-destinos-y-pruebas`). No mezclar su limpieza con tareas funcionales.

### 14. Servicios adicionales en tarjetas: validacion financiera pendiente

- [~] PR #353 integrado; seleccion de servicios desde la tarjeta, fechas visibles y cotizacion conjunta hotel-servicios implementadas. Las cotizaciones legadas se dejan intactas.
- [ ] Confirmar Production Ready y, en el primer contrato real aplicable, total, proveedor/CxP unica, cargo grupal si aplica, comision y ausencia de duplicados. Detener conversiones nuevas ante discrepancias; no crear contrato solo para probar. Ver WORKSTREAMS.md y la bitacora de Chat #2.

### 16. Integrar hoteles unidad en empaquetados

- [ ] Integrar y validar hoteles `modelo_tarifario = "unidad"` dentro de productos empaquetados.

### 17. Integrar hoteles unidad con vuelos y bloqueos

- [ ] Integrar y validar hoteles `modelo_tarifario = "unidad"` con vuelos, salidas y bloqueos.

### 18. Investigar hotel 217 ausente en Vista Booking

- [ ] Diagnosticar por que el hotel 217 no aparece en Porcion terrestre sin destino o buscando `odair`.
- [ ] Trazar en Vercel Preview: `tarifario_resumen` -> filtros post-carga -> `TarifarioPublic` -> `VistaBooking` -> tarjetas.
- [ ] No cambiar generacion, vigencia ni identidad categoria/regimen sin reproducir primero el descarte real.
- [ ] Fixture confirmado de produccion: hotel 217, paquete 50 activo, modelo persona, SAN ANDRES, 28 filas en `tarifario_resultado`, 4 filas en `tarifario_resumen`, 2 noches, Estandar/Superior, PAE/FULL y procedencia Promocion.
- Nota (PR #322, diagnostico de datos, no defecto): el mismo hotel 217 "Odair Dubai prueba" pertenece a SAN ANDRES pero `hoteles.zona` = "Bocagrande" (zona real de Cartagena); el filtro de Zona reflejo correctamente el dato almacenado y no se modifico la base. Ver `DECISIONS.md` ADL-024. No cierra ni sustituye este pendiente (la ausencia en Porcion terrestre sigue sin diagnosticar).

### 19. Separar Preview y Produccion

- Decision del usuario (2026-10-04): diferir esta infraestructura y concentrarse ahora en las mejoras. Dejar Vercel Production y sus Previews tal como estan; no invertir mas tiempo en cambiar sus variables. Los Previews de Vercel pueden seguir conectados a Produccion y NO se usan para pruebas de escritura.
- [x] Proyecto Supabase independiente `DspaciosPruebas` creado y esquema 001-201 inicializado; sin copiar contratos, clientes, finanzas ni credenciales de Produccion. Esto no equivale a tener un Preview de la app conectado o validado.
- [ ] Cuando el usuario reactive la tarea, hacer un piloto aislado de la app Next.js 16 en Cloudflare Workers, no Pages estatico. Comparar compatibilidad con `vinext` (beta) y, si hay brechas, OpenNext; verificar build, limites del plan gratuito y diferencias de runtime sin migrar el despliegue productivo de Vercel ni reescribir el stack por anticipado.
- [ ] Preparar Cloudflare Workers Builds y Previews por rama desde GitHub. Configurar tanto el Worker de prueba como sus Previews SOLO contra `DspaciosPruebas`, con variables de compilacion y runtime separadas, secretos fuera de Git, Auth/callbacks y Storage de prueba. Proteger las URLs con Cloudflare Access antes de usarlas; no conectar el repositorio ni desplegar antes de revisar la configuracion.
- [ ] Aislar efectos externos antes del piloto: crons de `vercel.json`, correo (`RESEND_API_KEY`), `CRON_SECRET`, webhooks y otras integraciones. No activar procesos automaticos de negocio en la base de prueba por defecto.
- [ ] Probar con datos ficticios lectura y escritura, login, permisos/RLS, contratos, clientes, finanzas y Storage; confirmar que nada aparece en Produccion. Documentar variables por ambiente, promocion y rollback. Cada rama se prueba primero localmente; el staging compartido integra una rama a la vez. No copiar datos reales sin autorizacion y anonimizacion separadas.

### 20. Desarrollo posterior del negocio

- [ ] Desarrollo integral B2B/B2C.
- [ ] Marketing y redes sociales.
- [ ] Automatizacion comercial y ventas.

### 21. Presencia y actividad reciente para superadmin

- [ ] Evaluar un mini informe en el dashboard de superadmin que muestre quien esta activo ahora y hace cuantos minutos se registro su ultima actividad o cambio.
- [ ] Distinguir presencia en la app (senal con vencimiento) de cambios realmente auditados; no inferir "en linea" solo por el inicio de sesion ni llamar "cambio" a una simple visita.
- [ ] Definir fuente de datos, alcance por tenant, permisos, frecuencia de actualizacion y retencion antes de implementar. Probar sesiones cerradas o inactivas y multiples pestanas sin exponer datos sensibles.

### 22. Corregir scroll horizontal restante tras el trabajo de tablas responsive

- [x] Finanzas -> Rentabilidad: scroll horizontal corregido en `RentabilidadList.tsx` y la pagina, sin ocultar columnas ni contenido; PR #338 mergeado (confirmado por el usuario, 2026-10-02).
- [ ] Netas -> Hoteles -> detalle de hotel -> "Tarifas por persona" (`/dashboard/producto/hoteles/[id]`) tiene scroll horizontal dentro de la tabla; las acciones de la derecha quedan fuera de la vista inicial (captura del usuario, 2026-10-01). Revisar `app/(dashboard)/dashboard/producto/hoteles/[id]/HotelDetalleClient.tsx`, funcion `tablaTarifas` (`ResponsiveTableShell`, usada tanto en tarifas activas como historicas), y resolver la lectura/edicion sin ocultar importes, regimenes ni acciones. Verificar escritorio y movil.
- [ ] Auditar las demas vistas del panel y CRM en anchos de escritorio y movil para detectar otros scrolls horizontales que hayan quedado fuera del trabajo anterior. Registrar rutas, causa y reproduccion antes de corregir cada caso; no dar por cerrada la adaptacion responsive solo por las pantallas ya migradas.

### 23. Destino principal de cada programa para el filtro del tarifario

- [ ] Agregar "Destino principal" a la configuracion inicial/cabecera del programa. Hoy `app/tarifario/TarifarioPublic.tsx` arma el filtro con todas las ciudades de `programa_ciudades`, por lo que un programa de 10 tramos aparece como opcion en los 10 destinos.
- [ ] Alimentar las opciones y la coincidencia del filtro de Destinos en la vista Programas solo desde el destino principal configurado de cada programa; conservar intacta la ruta completa, el itinerario y los hoteles por ciudad.
- [ ] Antes de implementar, definir fuente de datos y tratamiento de programas existentes sin destino principal (asignacion o estado pendiente), ademas de pruebas para programas con varias ciudades. No inferir el principal de la primera ciudad sin decision del usuario.

### 24. (Futura) Auditoria de formularios y filtros de fechas

- [~] Primer inventario de solo lectura recibido el 2026-10-05: 123 campos revisados en `vuelos-editar-bloqueo-secciones` (`bcda7f44`), rama atrasada respecto de `origin/main` y con cambios sin commit. No tomar sus lineas ni sus conclusiones globales como estado de Produccion. En el arbol local se reconfirmaron `toISOString().slice(0, 10)` en `BuscadorBooking.tsx` y en las acciones de Reservar/Contratos que escriben `fecha_obligacion`; el desfase UTC/Bogota despues de las 19:00 merece prioridad contable.
- [ ] Segunda ronda focal antes de codigo: contrastar en la base de integracion actual los flujos de fecha contable, plazo vencido y rangos invertidos; comprobar zona horaria de las sesiones SQL y filas existentes antes de proponer CHECK o cambiar defaults. Separar correcciones de tarifario publico, contabilidad/contratos, vuelos (#36), filtros y documentos. Coordinar `reservar/actions.ts` con #38 y tarjetas de hotel; no editar migraciones existentes ni hacer una sustitucion global de fechas.
- [ ] Auditoria separada de la correccion de vuelos (no hacer un cambio global de fechas sin ella): recorrer formularios y filtros de fechas de toda la app buscando (a) fechas pasadas ofrecidas donde no tienen sentido (salidas, plazos, vigencias, records destino) y (b) rangos donde la fecha final puede quedar antes de la inicial (ida/regreso, vigencias de compra y de viaje, temporadas, filtros de reportes).
- [ ] Revisar tambien que "hoy" se calcule siempre con la fecha de negocio de Bogota (`lib/fechaNegocio.ts`) y nunca con `toISOString()` (ya corregido en liberarVencidas y en el filtro de Mover).
- [ ] Entregable: inventario por pantalla con la regla esperada y una propuesta de correccion por grupos; sin implementar hasta aprobarla.

### 25. (Futura) Panel de eventos de seguridad para superadmin

- [~] Primer mapa de fuentes recibido el 2026-10-05 desde una rama atrasada; no se verificaron los planes ni ajustes reales de Vercel/Supabase. Segunda ronda focal: comprobar disponibilidad, retencion, costo y permisos efectivos en esos proyectos antes de disenar la captura o el panel. No tratar las cifras del informe como configuracion confirmada.
- [ ] Hallazgo independiente prioritario: `app/auth/callback/route.ts` concatena `origin` y `next` sin validar; un `next` que empieza por `@` se interpreta como otro host. Confirmado por lectura y parseo de URL en el arbol local, no probado en Produccion. Corregir con destino relativo del mismo origen y pruebas de entradas hostiles, en un cambio pequeno separado del panel.
- [ ] Revisar acceso a `public.auditoria`: la policy de la 189 deja SELECT a `gerencia` sin filtro de tenant, mientras la tabla guarda snapshots con datos personales. Confirmar el alcance de gerencia que autoriza el negocio y probar acceso directo con dos tenants antes de cambiar RLS; el filtro de la pantalla no reemplaza la policy.
- [ ] Auditar primero las fuentes existentes: `/dashboard/auditoria` (cambios de datos), Supabase Auth Audit Logs y Auth logs (ingresos) y Vercel Firewall/Logs (trafico y bloqueos). Definir que eventos se pueden correlacionar sin perder evidencia ni duplicar datos; revisar disponibilidad, retencion y costo del plan antes de disenar almacenamiento propio.
- [ ] Proponer una vista clara, filtrable y paginada solo para superadmin: intentos de ingreso fallidos o anomalos, accesos denegados, llamadas a operaciones sin permiso, abuso de codigos/tokens y bloqueos del firewall. Mostrar fecha y hora de Bogota, tipo, resultado, severidad, origen y evidencia; distinguir un error normal del usuario de un patron sospechoso y no etiquetar automaticamente a una persona como atacante.
- [ ] Mostrar identidad de la cuenta solo cuando este verificada; en intentos anonimos, el correo o usuario ingresado debe figurar como dato declarado, no como identidad confirmada. Mostrar IP y navegador/sistema (User-Agent) solo si la fuente los registra; son datos aproximados o manipulables. Una web no puede obtener de forma fiable el nombre del equipo ni una direccion fisica exacta; geolocalizacion por IP, si se usa, debe rotularse como aproximada.
- [ ] Disenar captura y proteccion en servidor, controles de acceso, alertas y limites de intentos; minimizar datos, definir retencion y acceso por tenant, evitar registrar contrasenas, codigos, tokens o cuerpos sensibles. Incluir pruebas de permisos, falsos positivos, datos ausentes y volumen antes de implementar. No convertir el propio panel en una via de exposicion de datos sensibles.

### 27. (Futura) Alertar sobre vigencias de compra proximas a vencer

- [~] Auditoria de solo lectura recibida el 2026-10-05 en rama atrasada: `hotel_temporadas.compra_fin` aparece como limite inclusivo; el regimen puede depender de una union por nombre con `tarifa_hotel`. Revalidar en la rama de implementacion y probar roles/RLS localmente; no asumir que ocultar el menu limita acceso a los datos.
- [ ] Antes de codigo, decidir destinatarios (incluida `administracion`), aviso el dia exacto, dias calendario o habiles, productos distintos de hoteles, repeticion y listado completo. Propuesta no aprobada: D-2 a D inclusive, hoteles activos, solo lectura y sin extender/publicar tarifas. No depender de un `session_id` del JWT sin verificar su disponibilidad real.
- [ ] Dos dias antes de `compra_fin`, mostrar al iniciar sesion un aviso con las vigencias/tarifas que van a vencer, identificando hotel, promocion o temporada, regimen y fecha de cierre de compra. Usar el dia de negocio de Bogota; no confundir `compra_fin` con el fin de viaje.
- [ ] Definir destinatarios y permisos por rol/tenant, repeticion por inicio de sesion, zona horaria, casos sin `compra_fin`, volumen y estado ya vencido. La alerta es informativa: no extender, reactivar ni publicar tarifas automaticamente.

### 28. (Futura) Evaluar contratos no concretados y reutilizacion de consecutivos DTM

- [ ] Evaluar un flujo de borrador/cotizacion sin numero DTM hasta emitir el contrato; para negocios que no se concretan despues de emitirlo, estudiar un estado visible y auditable (p. ej. "No concretado"), sin borrar ni convertir el registro en el contrato de otro cliente.
- [ ] Auditar los contratos mayoristas eliminados manualmente el 2026-10-02 (incluido `DTM-0557`, enviado al cliente) y sus referencias antes de decidir si corresponde recuperar historico, conservar una constancia de anulacion o permitir reutilizar algun numero de prueba nunca emitido. La eliminacion no reconstruye los datos del contrato; no resetear la secuencia ni reciclar numeros por lote.
- [ ] Comparar las opciones comerciales y tecnicas de numeracion, permisos, liberacion de cupos, efectos financieros, documentos externos, auditoria y pruebas. Distinguir el numero interno DTM de la numeracion fiscal de facturas. No implementar ni ejecutar SQL de recuperacion/reutilizacion hasta aprobar reglas por caso.

### 29. (Futura) Recobro desde el carrito del tarifario

- [ ] Auditar y definir el flujo de recobro desde el carrito para personal interno y B2B; no ofrecerlo a B2C. Ya existe recobro en cotizacion manual: verificar como llevarlo al carrito sin duplicar calculos, exponerlo a B2C ni alterar comisiones existentes. Coordinar con #30/#35.

### 30. Contratos B2B PVP con comision / NETO

- [x] Alcance decidido: contratos nuevos B2B manuales y reservas B2B asistidas, tambien en minorista. PVP con comision aparte o NETO con comision descontada; meta general suma total exigible NETO y meta del asesor interno conserva PVP. Margen minimo PVP 20% y NETO 6%. Sin recalculo historico ni cambio automatico de modalidad tras emitir; carrito, programas y descuento de venta directa fuera.
- [~] Fase A fusionada en PR #354. Fase B sigue local en el worktree contratos-neto-30-manual, sin PR ni SQL remoto; migraciones 206 y 208 reservadas, no aplicadas. Chat #1 cerro focalmente F4415 en Gestion/Cartera y la asercion U+0008 de la prueba 206 (runner local 3/3); la suite global de TypeScript sigue fallando por errores ajenos.
- [ ] Antes del PR B: integrar 207 y #44, actualizar y conciliar el worktree B, cerrar defectos financieros restantes y repetir pruebas de la cadena 207 -> #44 -> 206 -> 208, permisos, carreras, rollback, build y tipado afectado. Antes de SQL remoto: historia de migraciones y preflight N8/N9 actualizado con autorizacion. Ver WORKSTREAMS.md y bitacora de Chat #1.

### 31. (Futura) Vincular clientes con agencias B2B, asesores y referidos

- [ ] Revisar las relaciones actuales entre clientes, agencias B2B, asesores internos y referidos. Los referidos nuevos comisionan pero no aparecen en una vista identificable; auditar su registro, atribucion, permisos y presentacion.
- [x] Decision del dueno (2026-10-14): los asesores internos operativos estan en mayorista; todos pueden consultar y usar sus contactos, aunque otro asesor haya creado la cotizacion o el contrato. Separar agencia del contacto, asesor que lo usa y beneficiario de la comision interna segun la vinculacion comercial; no inferir la comision del creador ni del acceso al CRM.

### 32. (Futura) Consulta y autocompletado por documento en clientes, terceros y pasajeros

- [x] Decision del dueno (2026-10-06): la identidad documental se compara por TIPO y NUMERO de documento; igual numero con tipo distinto NO es un tercero duplicado. El numero es el dato inicial para buscar, pero no una clave unica por si solo. Conservar aislamiento por tenant en lectura y escrituras; coincidencias historicas ambiguas no se fusionan automaticamente.
- [x] Decision del dueno (2026-10-08) para #351: catalogo inicial de tipos de documento `CC`, `CE`, `TI`, `RC`, `PAS`, `PPT`, `NIT` aprobado. No aceptar tipos fuera del catalogo por normalizacion permisiva (por ejemplo, `CC2` no debe convertirse en `CC`).
- [x] #351 y migracion 202 integradas: `crm_leads` guarda tipo y numero, usa unicidad por tenant + tipo + numero y trata telefono/correo como coincidencias, no identidad unica. La app y la RPC rechazan tipos mal formados y edicion parcial. La 202 se aplico y verifico en Produccion; el alta manual funciono. Esto NO resuelve todavia clientes/pasajeros de cotizaciones (#42).
- [~] Auditoria de solo lectura recibida el 2026-10-05: pasajeros conservan tipo y numero; `ventas` no guarda tipo del titular; el carrito fuerza `CC`; `crm_contactos` no tiene tenant y su lectura para `authenticated` puede exponer datos a B2B. La observacion sobre leads sin tipo ya quedo corregida en #351; las demas fuentes siguen pendientes de #32/#42.
- [~] Coordinacion de auditoria consolidada el 2026-10-08: `Auditorias` identifico fuentes y cruces de #32/#42 en lectura local; falta medir duplicados historicos y permisos efectivos (tambien en remoto) antes de fijar normalizacion, precedencia y acceso por rol. Sin ejecutor de codigo ni migracion reservados; ver `docs/coordinacion/auditorias-identidad-crm.md`.
- [~] Segunda comprobacion focal local del 2026-10-08: migraciones 042/047 dejan `crm_contactos` sin tenant, con indices globales por documento crudo, correo y telefono; su policy local podria permitir lectura B2B si el rol conserva SELECT. La exposicion remota NO esta verificada. Migracion 187 busca pasajeros de contrato por tipo y numero literales; 202 normaliza solo leads. Las consultas de medicion recibidas son borradores con errores de sintaxis y no se ejecutaron. Preparar SELECT de agregados/privilegios validados, sin PII en resultados, y entregarlos al usuario uno por uno; no usar `crm_contactos` para autocompletar antes de resolver su acceso.
- [~] Verificacion de Produccion del 2026-10-10: `crm_contactos` tiene SELECT para `authenticated` y policy SELECT para `public` que solo exige UID, sin tenant ni rol aplicativo. Riesgo de lectura cruzada confirmado estructuralmente; falta prueba directa de tabla/API con sesion B2B real. Conteos agregados de fuentes/formatos registrados en `docs/coordinacion/auditorias-identidad-crm.md`, sin PII ni fusiones. Priorizar el cierre del acceso como incidencia separable. El dueno ya decidio: sin tipo+numero completos, ficha provisional sin deduplicar; NIT base identifica y DV separado; `aliados` sigue catalogo comercial sin fusion automatica; divergencias se muestran para correccion explicita; B2B solo ve personas de sus cotizaciones, internos por tenant/asignacion y superadmin/gerencia en ambos tenants. Falta disenar autorizacion que permita esa visibilidad sin abrir cotizaciones completas ni heredar la policy insegura.
- [~] Hotfix 207 de acceso a `crm_contactos`: PR #356 draft actualizado a `f18d7292`; preflight remoto encontro 31 contactos B2C sin tenant (E2=24, E4=7). El dueno aprobo atribuirlos a mayorista, incluidos los 7 E4 con evidencia historica incompleta, y confirma ventana sin altas nuevas. Falta corregir la descripcion del PR y revisar el cierre; luego sonda previa, preflight fresco, 207, atribucion, postcheck, merge/despliegue y sonda posterior. Detenerse ante conteos distintos. No `db push`, `migration repair` ni matriz mutante en Produccion. #30 B espera 207; #32/#42 siguen separados.
- [ ] Segunda comprobacion focal: medir en solo lectura duplicados por tipo, formato, tenant y NIT; verificar permisos efectivos de `crm_contactos` con roles internos/B2B antes de usarlo como fuente. Definir clave y normalizacion equivalentes en app y SQL, tratamiento de documentos historicos y precedencia por campo. Mostrar variantes y pedir eleccion; nunca fusionar ni sobrescribir automaticamente, ni copiar datos bancarios entre entidades.
- [ ] Poner el numero de documento primero en las listas y formularios pertinentes para consultar y autocompletar datos existentes. Auditar antes el modelo de identidad: tipo de documento, pais, tenant, duplicados y permisos; no asumir que el numero por si solo es una clave unica ni sobrescribir fichas por coincidencias ambiguas.

### 33. (Futura) Mini CRM de clientes en el portal B2B

- [ ] Permitir a cada agencia gestionar sus propios clientes desde el portal B2B e integrar esa informacion al CRM central. Definir alcance, propiedad, permisos por tenant y prevencion de exposicion entre agencias.

### 34. (Futura) Notificaciones de cotizaciones B2C y solicitudes B2B

- [~] Auditoria de solo lectura sobre `origin/main` `e6aa9fec`: `cotizaciones` solo usa abierta/convertida/descartada. El checkout no notifica desde servidor; ofrece enlaces opcionales de WhatsApp/correo tambien a B2B, contrario al disparador pedido. La cotizacion de carrito no guarda un origen/propietario B2B fiable (el email en `creado_por` no sustituye un id autorizado) y el portal no tiene accion de solicitar contrato. No inferir de la ausencia de alerta que no haya solicitudes enviadas manualmente.
- [ ] Definir evento B2C al crear y evento B2B solo al pulsar `Solicitar contrato`, con identidad/aliado, tenant y permisos autoritativos; no notificar cada cotizacion B2B. Disenar cola interna, estado atendido, idempotencia y reintentos antes de conectar canales. Una tabla outbox transaccional es propuesta tecnica, no decision aprobada; coordinar versiones/reediciones con #39. Decidir destinatarios, canal, recordatorios y si B2C conserva su enlace voluntario de WhatsApp.
- [ ] Para cotizaciones B2C sin login, avisar al equipo en el dashboard con pendientes de revision, listado de notificaciones y evaluar un dialogo al iniciar sesion. Para B2B, no notificar cada cotizacion: avisar solo cuando la agencia solicite confirmarla y pasarla a contrato para seguimiento. Definir destinatarios, estados, deduplicacion y lectura.

### 35. (Futura) Cotizaciones multiples y comparativas de hoteles

- [x] Decisiones del dueno (2026-10-11): comparativa significa elegir UNA opcion, no compra conjunta. Modo explicito en Vista Booking y manual/dinamica; cotizacion simple sigue predeterminada. V1: hasta 3 hoteles del mismo destino, fechas, pasajeros y moneda. Booking: hotel + servicios vinculados por opcion, acomodacion elegible, tarifa por persona y total solo de esa opcion; sin vuelos ni tours independientes. Manual: itinerario comun (puede tener varios tramos por escala) y servicios comunes, hotel variable; cada total suma la parte comun una vez. Todos pueden elegir y pasar al flujo normal de compra de la opcion elegida, sin que ello conceda permiso de conversion. Bernalo por unidad, bloqueos de vuelo, `ReservaForm` interno y excepciones de vuelo/servicio exclusivo por opcion fuera de V1. Reeleccion solo si la hija se descarta sin pagos/contrato y la comparativa sigue vigente; conservar historial y recotizar. No exigir modal ni pagina nueva.
- [~] Contrato tecnico de Chat #2 recibido y revalidado sobre `origin/main` `41992f8d` (incluye PR #354). Direccion aceptada, NO GO aun para codigo: madre comparativa no cobrable/no convertible con `precio_venta=NULL` explicito (nullable en esquema 054), opciones con identidad `(opcion_ref, acomodacion_ref)` y snapshot publico sin netos/proveedor; hija simple con solo comunes + hotel elegido, precio numerico y vigencia no posterior a la madre. Una sola hija activa, reintentos idempotentes y reeleccion trazable solo tras descarte sin pago/contrato. Todos los consumidores de listado, B2B, documento, pago, conversion y RPC deben distinguir la madre, sin $0 ni suma de alternativas. Una tabla nueva no hereda RLS/grants. Falta aprobar el mecanismo server-side para que el receptor de enlace publico elija sin convertir el token de lectura en permiso general de escritura; tambien secuenciar con #30 B antes de reservar worktree/archivos/migracion. No crear estado `elegida` por inercia ni transformar cotizaciones antiguas.
- [~] Nueva coordinacion para Chat #2 (2026-10-11): #14 ya esta integrado; actualizar la auditoria de #35 sobre el `main` que contiene #353, sin codigo en esta primera ronda. Entregar mapa de archivos/contratos y choques concretos con #30/#39/#40/#42, decisiones de producto acotadas para el dueno y prompt para UN ejecutor que el usuario elija. No reservar migracion ni reutilizar el worktree de #14 antes de aprobar alcance.
- [~] Auditoria de solo lectura sobre `origin/main` `e6aa9fec` y la rama de tarjetas sin commit: el carrito actual suma todos los hoteles/servicios y la conversion puede agrupar hoteles del mismo destino en un contrato. La rama de tarjetas conserva el conjunto hotel-servicios mediante `hotelRef`, pero no modela alternativas ni cambia el documento. No usar el total agregado actual como precio de una comparativa ni reinterpretar cotizaciones antiguas.
- [ ] Despues de integrar tarjetas, definir si cada alternativa incluye solo hotel o tambien vuelo y servicios, monedas permitidas, limite de opciones y flujos cubiertos (carrito, interno, manual). Cada opcion necesita identidad estable y subtotal/snapshot propios, documento sin total global ambiguo y conversion que elija solo una opcion. Decidir semantica de `precio_venta` para comparativas segun esquema y consumidores reales; `null` o precio minimo son propuestas, no decisiones.
- [ ] Permitir seleccionar varios hoteles para una cotizacion y compararlos en una vista clara, preservando precios, condiciones, vigencias y disponibilidad propios de cada opcion. Auditar primero el modelo de cotizacion y sus documentos.

### 36. (Futura) Politica de cambios de fechas y horarios de vuelos

- [ ] Decidir si fechas y horarios del record siguen editables en `EditarBloqueoForm` mediante `actualizarBloqueo` o si todo cambio debe pasar por `registrarCambioOperacional` con historial. Auditar el efecto en pasajeros, contratos y trazabilidad antes de cambiar el flujo. Este seguimiento no reabre el cierre visual de #1.

### 37. (Futura) Decisiones D5/D6 del traslado de pasajeros

- [ ] D5: confirmar o cambiar la regla vigente que permite mover pasajeros con datos pero sin contrato; incluir el caso de carga masiva y retenciones en plazo. No asumir que el cierre de #3 aprobo la regla de negocio.
- [ ] D6: confirmar o cambiar la seleccion automatica de la primera silla libre real por numero en modo `solo_datos`, frente a ofrecer un selector de silla. No cambiar el comportamiento sin revisar concurrencia e historial.

### 38. Comisiones B2B: validacion funcional pendiente

- [~] PR #352 fusionado y migracion 205 aplicada con postcheck 14/14. Las 142 comisiones historicas conservan su importe; no recalcular ni hacer backfill.
- [ ] Confirmar Production Ready y validar funcionalmente una comision nueva con base PVP menos impuesto, NETO sin doble pago, meta del asesor, portal/cuenta y correccion manual permitida. No reabrir la implementacion ya integrada por pendientes de #30 B. Ver WORKSTREAMS.md y la bitacora de Chat #1.

### 39. (Despues de #14) Editar servicios de una cotizacion

- [~] Auditoria de solo lectura recibida el 2026-10-05 sobre `origin/main` `e6aa9fec`: `tarifario` guarda servicios en `payload.servicios`, `carrito` en `payload.tours` y `detalle.items`, y `manual` en `cotizacion_servicios`. La vista publica lee `detalle`; editar solo `payload` dejaria precio/documento incoherentes. El alcance propuesto de v1 solo para tours opcionales del carrito NO reemplaza la peticion de editar servicios cotizados en los otros flujos; decidir si se entrega por fases.
- [ ] Antes de implementar: integrar #14/tarjetas y su `hotelRef`; comprobar con consulta de solo lectura como estan enlazadas las lineas de tours en cotizaciones antiguas antes de usar su posicion como identificador. Definir una referencia estable para las nuevas, precio autoritativo y recomposicion de `payload`, `detalle` y total. La conversion actual no trata igual precios de hotel persona, Bernalo y tours: no prometer conservar siempre el precio hotelero cotizado sin resolver esa regla.
- [ ] Proteger edicion y conversion contra dos pestañas o solicitudes simultaneas (version esperada y transicion atomica), y conservar version anterior auditable. Validar tenant, estado, permisos, pagos/congelado y enlace publico; probar editar/quitar, casos legados, carreras y conversion completa. El `trg_auditoria` existente no sustituye una version de negocio.
- [ ] Permitir modificar o quitar servicios ya cotizados y recalcular el total y el documento sin perder la trazabilidad de lo que cambio. Hoy los servicios cotizados no se pueden editar. Revisar estados y permisos antes de permitir cambios sobre cotizaciones ya convertidas en contrato.

### 40. (Despues de #39 y #32) Cliente por documento y vencimiento de cotizacion

- [~] Auditoria focal de Chat #2 (2026-10-11): V1 de busqueda/autocompletado del CLIENTE solo para personal interno en cotizacion manual/dinamica e interna; B2B, publico y `ProgramaReservaForm` fuera. Numero inicia la busqueda, pero se exige tipo y tenant para mostrar datos; 0 coincidencias permite captura manual, 1 ofrece aplicar sin sobrescribir cambios sin confirmacion, varias exige seleccion explicita, sin fusion automatica. No aprobar fuente/RPC provisional, minimo de caracteres ni tope silencioso de resultados: #32 debe entregar consulta y permisos seguros; si hay truncamiento, avisar y fallar cerrado. Descartar respuestas tardias al cambiar numero/tipo/tenant. Bloqueado para codigo hasta hotfix de `crm_contactos`, #32 y secuencia con #39; vencimiento no forma parte de esta ronda.
- [~] Chat #2 coordina en paralelo solo la AUDITORIA de busqueda por ID/documento del cliente en cotizaciones. El numero es dato de entrada, no identidad unica: resolver coincidencias por tenant + tipo + numero normalizado; igual numero con tipo distinto NO es duplicado. No implementar autocompletado ni consultar `crm_contactos` como fuente hasta que `Auditorias` cierre su hotfix de acceso y #32 entregue una consulta segura. Identificar superficies, estados, mensajes ante ambiguedad, permisos B2B/internos y cruce con #35/#39; entregar prompt separado, sin ejecutor/migracion reservados. El vencimiento queda fuera de esta ronda.
- [~] Auditoria de solo lectura sobre `origin/main` `e6aa9fec`: `buscar_pasajero_por_documento` (187) ya sirve para pasajeros, no para el bloque cliente. `crm_contactos` no es fuente segura para autocompletar cliente por tenant y el carrito fuerza tipo `CC`; verificar esto en la rama de integracion antes de reutilizar datos. La busqueda nueva debe limitar rol/tenant y evitar enumeracion publica o B2B; no fusionar coincidencias automaticamente.
- [ ] Precisar en que flujos se elige vigencia: interno y manual ya la permiten al crear, y la ficha abierta permite cambiarla; el carrito publico usa un dia automatico. Decidir si el cliente B2C puede elegirla o solo un asesor, y si vencer bloquea la conversion o solo muestra un aviso. `vigencia_hasta` nula en cotizaciones antiguas no debe recibir fecha inventada; contar abiertas que quedarian vencidas antes de imponer la regla. El dia exacto de vencimiento sigue valido en Bogota.
- [ ] En el flujo de cotizacion, consultar y completar al cliente a partir de su documento, reutilizando la auditoria de identidad y permisos de #32; no asumir que el numero solo es una clave unica.
- [ ] Permitir elegir la fecha de vencimiento de la cotizacion y reflejarla de forma coherente en la vista y el documento. Definir validaciones y efecto del vencimiento antes de implementarlo.

### 41. (Despues de cotizaciones) Sillas de bloqueo al convertir una cotizacion en contrato

- [~] Auditoria de solo lectura sobre `origin/main` `e6aa9fec`: el nucleo de Vuelos 201 ya crea las sillas del contrato `en_plazo` y confirma al confirmar la venta. Quedan riesgos distintos: conversion del carrito con `plazo` nulo (retencion sin vencimiento), plazo heredado ya vencido, edicion de `ventas.plazo` sin sincronizar `sillas.plazo`, y confirmacion manual que la interfaz oculta a `venta` pero la base 197 podria permitir por llamada directa. Verificar permisos con prueba SQL de rol antes de afirmar el acceso real.
- [ ] Mantener la decision del dueno: la confirmacion MANUAL corresponde solo a superadmin, exigida tambien en servidor/base; no tomar el rol permitido por el boton como seguridad. Decidir aparte que constituye un abono valido (umbral, monto, conciliacion y pagos previos), duracion del plazo y efecto de borrar/reducir abonos. No cambiar `contrato_manual` por implicacion: auditarlo por separado.
- [ ] Antes de codigo, contar en solo lectura contratos existentes de carrito con `plazo` nulo y sillas retenidas; no hacer backfill automatico. Probar carreras reales entre doble conversion, abono y liberacion, y baja de abono frente a confirmacion; disenar transiciones atomicas sin sobreventa ni abonos sobre contratos cancelados. Implementar despues de #38 y #14, revisar numero de migracion vigente y repetir las carreras de la 201.
- [ ] Al convertir una cotizacion de bloqueo en contrato, poner las sillas de ese contrato en plazo, no confirmadas. Confirmarlas solo al registrar un abono valido o mediante accion manual del superadmin; no confirmarlas por el simple hecho de crear el contrato.
- [ ] Definir plazo, vencimiento, liberacion, permisos y efecto de abonos antes de implementar. Probar transiciones y concurrencia con el flujo de Vuelos 201; coordinar con cualquier trabajo activo en contratos, reservas, sillas o comisiones. No mezclar este cambio con #14.

### 42. (Bug, prioridad alta) Registrar en CRM clientes y pasajeros de todas las cotizaciones

- [ ] Regla confirmada por el dueno: TODO cliente y todo pasajero identificado al crear o actualizar una cotizacion debe quedar consultable en el CRM, sea cotizacion de tarifario, carrito publico, Reservar/interna o dinamica/manual. El origen, canal, asesor, aliado y tenant se registran como procedencia, no como motivo para omitir la persona. No esperar a que la cotizacion se convierta en contrato.
- [~] Diagnostico local del 2026-10-05: `crearCotizacion` en Reservar guarda titular y `payload.pasajeros` sin alta en CRM; `crearCotizacionManual` guarda el titular sin alta en CRM y al crearla solo conoce cantidades (`detalle.pasajeros` vacio). `actualizarTitularCotizacionManual` tampoco sincroniza CRM. El checkout publico intenta insertar solo al titular en `crm_contactos` y silencia errores/duplicados, por lo que tampoco garantiza la regla. La vista CRM de pasajeros actual consulta solo `contrato_pasajeros`; no muestra los de cotizaciones aun no convertidas. Esto es lectura de codigo local, no conteo de Produccion.
- [~] Auditoria local consolidada el 2026-10-08: confirma los tres flujos anteriores y que la conversion lee pasajeros de entrada o del payload; no hay conteos de Produccion ni permisos remotos comprobados. Espera el contrato de identidad/aislamiento de #32 y la secuencia de escrituras con #39 antes de reservar implementacion; ver `docs/coordinacion/auditorias-identidad-crm.md`.
- [~] Auditorias ya entrego conteos agregados de Produccion y contrato preliminar de #42: ficha provisional consultable cuando falte tipo+numero completos, vinculo idempotente a cotizacion/rol, un titular activo y correcciones trazables; no inventar personas desde cantidades. Falta fijar identificador/posicion estable de pasajeros y autorizacion trans-tenant explicita para superadmin/gerencia. El hotfix de `crm_contactos` debe cerrarse primero; #42 aun no tiene ejecutor, worktree, migracion ni codigo reservados. Sin backfill automatico.
- [~] Nueva auditoria de solo lectura encargada a `Auditorias` (2026-10-12): identificar el soporte real para un ID estable de pasajero por flujo de cotizacion y por edicion/reordenamiento/eliminacion, y proponer vinculo idempotente cotizacion-pasajero-rol sin usar el indice del arreglo como identidad. Entregar matriz, casos de concurrencia/correccion/conversion, riesgos, decision minima del dueno y prompt; solo editar su bitacora. No reservar ejecutor, codigo, migracion ni backfill para #42 mientras el hotfix y #32 sigan pendientes.
- [ ] Disenar registro central de personas por tenant y documento/tipo segun #32, con vinculo idempotente a cada cotizacion/rol (titular o pasajero) y procedencia verificable. Cuando el formulario solo tenga cantidad de viajeros, NO inventar personas; registrarlas cuando se capturen sus datos, incluso si la cotizacion sigue abierta. Una correccion de titular/pasajero debe actualizar el vinculo sin mezclar identidades ni duplicar. Coordinar el esquema con #351 antes de integrarlo; no asumir que `crm_leads` o `crm_contactos` ya resuelven este caso.
- [ ] Mantener la consulta operativa del CRM separada del consentimiento de campanas: registrar una persona no implica `acepta_publicidad`. Respetar tenant y permisos de B2B/internos; no copiar datos sensibles a una tabla legible por todos los autenticados. La escritura debe ser confiable: transaccion o mecanismo durable/reintentable, errores visibles y pruebas de reintento, concurrencia, edicion y conversion; no un `insert` opcional que silencie el fallo.
- [ ] Inventariar en solo lectura cotizaciones historicas con personas identificables ausentes del CRM. Preparar reconciliacion idempotente con preflight, conteos, duplicados ambiguos y rollback; NO ejecutar backfill ni SQL remoto sin autorizacion separada. Probar titular y pasajeros de todos los flujos, cotizacion sin pasajeros identificados, mismo documento con distinto tipo/tenant y ausencia de consentimiento.

### 43. (Independiente, en espera) Modulo contable propio y staging DIAN

- [~] Antecedente revisado el 2026-10-12: el estado de continuacion del 2026-10-04 describe parser DIAN, diseno de staging y propuesta de migracion 204. El archivo `supabase/migrations/20260601000204_staging_dian_contable.sql`, preflight, postcheck, rollback, pruebas y documentos existen **sin rastrear** en `.claude/worktrees/vuelos-editar-rescate-20261008`, un worktree mixto de varios frentes. No estan en `origin/main` local `41992f8d`; la aplicacion remota no se verifico en esta revision. Las pruebas PostgreSQL/parser/roles del informe antiguo son reportadas, no repetidas ahora. La 204 queda reservada para este frente, no reutilizable ni lista para aplicar por el solo hecho de existir.
- [ ] Separar y auditar ese trabajo en una rama/worktree exclusivamente contable sobre `main` vigente, preservando los cambios ajenos del rescate. Inventariar diff, roles, RLS, permisos, datos sensibles, scripts, pruebas y documentacion; decidir con el dueno un unico ejecutor antes de cualquier codigo/PR. La hoja `contabilidad-dian-staging.md` aun dice "sin migracion" aunque el borrador 204 ya existe: conciliarla con el estado real antes de publicar. Confirmar numeracion/historia local y remota antes de PR o SQL: la 204 es anterior a migraciones ya aplicadas, por lo que no usar `db push` ni `migration repair` automaticamente. SQL remoto, incluso preflight, requiere autorizacion separada.
- [ ] Primera entrega acotada: staging DIAN por tenant con parser XML/AttachedDocument/Excel, lotes, identidad y deduplicado en base, documentos/lineas/impuestos/retenciones/formas de pago y resoluciones append-only; roles propuestos `contador`, `revisor_fiscal`, `admin_contable` con acceso solo al area contable. No guardar XML completo por defecto, no hacer backfill, no crear asientos, no tocar `asientos_contables`, PUC ni UI sin revision y reserva propias. Antes de integrar, resolver politica de aprobacion del contador, quien puede importar, muestras reales de retenciones y notas credito/debito, y catalogo de documentos soporte.
- [ ] Modulo independiente posterior: navegacion y permisos contables propios, bandeja de revision y conciliacion con fuentes administrativas, clasificacion PUC, aprobacion/posteo trazable, reconstruccion historica por corte elegido y cierres/informes. No duplicar registros maestros ni mezclar tenants. El staging 204 puede auditarse por separado de #30 B/208; cualquier enlace futuro con CxP, facturacion o asientos espera inventario de integridad y decisiones contables, incluido el defecto K15. Validacion normativa y tributaria corresponde al contador/revisor responsable.

### 44. (Hotfix contable, prioridad alta) Reintentos de CxP y compensacion sin asientos huerfanos

- [~] Auditoria focal de Chat #1, ronda 21 (2026-10-12): K15 reproduce reentrada de `registrar_financiero_contrato` (171) sobre un contrato ya completado que reemplaza CxP mientras el asiento se maneja fuera de la misma transaccion. El riesgo existe en flujos de `main` y #30 B lo amplifica. `lib/reservar/financieroContrato.ts` llama a `revertirContratoIncompleto` tras errores de guardado pendiente, RPC o control de conteo; la respuesta `ya_completo` protege solo el exito, no la compensacion concurrente. No afirmar solucion ni integridad por las maquetas de 208.
- [ ] Disenar hotfix minimo y atomico antes de integrar #30 B: reintento idempotente de CxP/asiento, guarda de compensacion que nunca borre un contrato completado por otro proceso, cierre del bypass directo de 171 y permisos efectivos por rol/tenant. Un wrapper `SECURITY INVOKER` no basta si `service_role` debe seguir ejecutando la 171; exigir diseno de frontera y pruebas de llamada directa. Chat #1 coordina y el dueno eligio a Opus como unico ejecutor de #44; worktree aislado propio aun por definir, sin asumir el de #30 B. Las rutas/SQL requieren reserva expresa antes de escritura.
- [ ] Probar dos sesiones, reentrada despues de completar, fallos entre CxP/asiento y compensacion, roles/tenants, no duplicados, cero huerfanos, rollback y regresion de reservar/reconciliar PVP y NETO. Auditar primero; no staging, PR, SQL remoto ni reparacion automatica de historicos por esta nota. Coordinar con hotfix CRM 207 y con 206/208; resolver secuencia de migraciones antes de ejecutar nada.
- [~] Chat #1 localizo tres adaptadores (`contratos/actions.ts`, `reservar/actions.ts`, `reservar/reconciliacion-actions.ts`) y `lib/reservar/financieroContrato.ts`, pero NO estan reservados para escritura de #44. El diseno propone redefinir dos firmas de la 172 en una migracion nueva; S7u acepta como direccion proteger origen contable anterior o nuevo. Queda por demostrar que no persista `contrato_financiero_pendiente` si una llamada completada pierde respuesta o dos procesos reintentan. U1-U15 son pruebas propuestas, no corridas; G3/G4/G7 deben fallar cerrado ante datos preexistentes anormales sin reparacion automatica. El dueno eligio Chat #1 + Opus; antes de codigo falta definir worktree propio y decidir expresamente si acepta despliegue solo hacia adelante sin rollback seguro, con plan de contencion/recuperacion y efecto visible de bloquear `eliminar_contrato` con historia. Numero/rutas se reservan solo despues de esas decisiones y de verificar orden 207 -> #44 -> B/206 -> 208. NO GO codigo/PR/Produccion.
