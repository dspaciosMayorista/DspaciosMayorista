# TASKS.md - Dspacios Mayorista

Fuente unica y priorizada de pendientes. Ultima actualizacion: 2026-09-30.

Convencion: `[x]` integrado en `main`; `[~]` implementado solo en una rama sin integrar (no cuenta como cerrado); `[ ]` pendiente.

## Cola priorizada

### 0. CRM leads manuales WhatsApp/Instagram

- [~] En la rama `crm-leads-mvp-port` (worktree aislado, base `origin/main` `e6aa9fec`): MVP manual de leads como entidad propia (`crm_leads` + `crm_lead_actividades`), tenant obligatorio, RLS por tenant/responsable, sin `operaciones`/`control_vuelo`/externos, sin borrado fisico, sin tocar `crm_contactos`, cotizaciones ni ventas. Migracion `20260601000202_crm_leads.sql`, aplicada sobre `origin/main` donde `201` y `203` ya existen y `202` esta libre.
- [ ] Validar SQL/RLS localmente (preflight, migracion, postcheck, test, rollback), TypeScript, ESLint, pruebas de interfaz y build. No ejecutar SQL remoto desde la rama.

### 1. Catalogos compartidos y selectores buscables: validar lo integrado

Hecho en `main` (no reabrir):
- [x] Selectores buscables `ComboDestino`, `ComboProveedor`, `ComboHotel` y `ComboNombre` (`components/`) integrados en 19 formularios del panel y del CRM: hoteles, servicios, programas, paquetes, contratos, vouchers, pagos, CRM difusion, vuelos/bloqueos y empaquetados (`27fa9402`, `eb274b5b`, con pruebas de interaccion `pruebas/combo*Interaccion.react.ts`). Los `<select>` nativos que quedan con "destino" son de records de vuelo o del tarifario publico, no del catalogo.
- [x] Proveedores: catalogo base (`proveedores`) legible por personal interno activo de ambas agencias; escritura solo Mayorista autorizada; agencia/freelance/cliente_final sin lectura. Ocho datos sensibles (`nit`, `razon_social`, `datos_pago`, `banco`, `tipo_cuenta`, `numero_cuenta`, `politica_reservas`, `voucher_contacto`) movidos a `proveedores_datos_sensibles` (solo Mayorista; superadmin/gerencia leen ambas). Escritura por la RPC transaccional `guardar_proveedor`. El voucher usa solo `voucher_contacto`. Migraciones 189/190/191 (PR #333); la 191 aplicada en produccion segun el usuario.

Pendiente:
- [ ] Validar en produccion el flujo con un proveedor NUEVO: crear con datos sensibles, editar, usarlo en hotel/servicio/CxP/voucher y comprobar que Minorista ve el catalogo base pero no los datos sensibles.
- [ ] Validar con datos reales de ambas agencias el comportamiento del catalogo y de los selectores (coincidencias, duplicados, texto libre).
- [ ] Documentar la matriz de lectura/escritura resultante por catalogo (no existe todavia un documento en el repo). No ampliar acceso entre tenants por inferencia ni ejecutar SQL remoto sin autorizacion.

### 2. Tarjetas de Vista Booking y otras vistas

- [ ] Rediseñar las tarjetas tras acordar el detalle visual con el usuario; el shell y los buscadores de la fase 1 ya están cerrados en PR #327.
- [ ] Conservar precios, disponibilidad, lógica de filtros, identidad `(hotelId, paqueteId)` y fuentes de datos. Modal y carrito se revisan por separado; no asumir que la fase 1 los rediseñó.
- [ ] Abordar las demás vistas después de cerrar el alcance de tarjetas.

### 3. Smoke financiero posterior al PR #294

- [ ] Crear un caso real con servicio incluido por grupo y comparar vitrina, carrito, cotizacion y contrato.
- [ ] Confirmar una sola CxP por servicio, costos correctos y margen correcto.
- [ ] Confirmar en Vercel `/api/cron/reconciliar-financiero` y su ejecucion con `CRON_SECRET`.

### 4. Soporte unidad para paquetes dinamicos

- [ ] Implementar soporte real de `salidas_dinamicas` y cotizacion antes de anunciar hoteles unidad de paquetes `dinamico`.
- [ ] Mantenerlos excluidos o marcados como no compatibles hasta completar la integracion.

### 5. Soporte unidad para paquetes de servicios

- [ ] Implementar soporte real de hoteles unidad en paquetes `servicios` antes de anunciarlos como cotizables.
- [ ] Mantenerlos excluidos o marcados como no compatibles hasta completar la integracion.

### 6. Linea base de pruebas en verde

- [~] En la rama `ronda1-destinos-y-pruebas` (no integrada): `test:unit` pasa de 28 fallos a 0 (4.954/4.954 al 2026-09-30), sin defectos de producto encontrados. Grupos: imports relativos sin extension (3 archivos que nunca cargaban), dependencia de CRLF/LF (8 pruebas, ahora independientes del SO), 17 pruebas de cableado actualizadas a la implementacion vigente con trazabilidad, y 2 pruebas de interaccion renombradas a `*.react.ts` (siguen en `test:react`) con guarda `pruebas/suitesPruebas.test.ts`.
- [ ] En `main` sigue roja hasta integrar la rama. Tras el merge, confirmar `test:unit` y `test:react` en `main`.
- [ ] Deuda conocida, no bloqueante: `npm run lint` global tiene 223 problemas preexistentes en 35 archivos (ninguno en los cambios de esta rama).

### 7. Smoke visual de condiciones y restricciones

- [ ] Validar en produccion badges y condiciones en Booking y carrito de los PR #286/#287.
- [ ] Confirmar que el contenido sea consistente en escritorio, movil e impresion cuando aplique.

### 8. Smoke de excepcion comercial

- [ ] Probar con superadmin y contrato restringido el formulario, la autorizacion y la trazabilidad.
- [ ] Mantener como deuda no bloqueante la reutilizacion de la consulta de vigencia para evitar una segunda consulta O(1) a `hotel_temporadas`.

### 9. Mostrar conteos por destino

- [~] En la rama `ronda1-destinos-y-pruebas` (no integrada): receptivo = `servicios_adicionales` con categoria `tour_traslado` y `destino_id` del destino (sin servicios generales sin destino). Conteo sin agregados de PostgREST, por carga paginada que falla cerrado; solo los roles que leen `servicios_adicionales` ven la insignia (conteo desconocido nunca se muestra como 0). Tarjetas compactas: "N hoteles"/"N receptivos" abren un dialogo con busqueda; hoteles enlazan a `/dashboard/producto/hoteles/[id]`; receptivos sin enlace (no hay ruta de detalle). Listas de hasta 50 receptivos se precargan con la misma consulta del conteo (tope 1.000 nombres) y abren sin peticion; reabrir reutiliza la lista y "Actualizar lista" trae datos frescos.
- Validacion (2026-09-30): el usuario probo en Vercel Preview los cambios de Destinos, incluida la apertura de receptivos, y aprobo el resultado. No confirmados por separado: roles sin acceso (`control_vuelo`), "Actualizar lista" con datos que cambiaron y destinos con mas de 50 receptivos.
- [ ] Revisar e integrar a `main`.

### 10. Explicar bloqueos al eliminar destinos

- [~] En la rama `ronda1-destinos-y-pruebas` (no integrada): el modal lista el contenido real de las 10 tablas con FK a `destinos` (guarda contra FKs nuevas) y solo afirma "sin contenido" para los roles que pueden borrar destinos (verificado contra las policies de las migraciones). Semantica de eliminar/fusionar, permisos y errores sin cambios.
- Validacion (2026-09-30): incluido en los cambios de Destinos que el usuario probo y aprobo en Vercel Preview; el texto del modal segun el rol no se confirmo por separado.
- [ ] Revisar e integrar a `main`.
- [ ] Otra queja del usuario sobre el modal de eliminacion queda pendiente de revisar por separado (no incluida en la rama).
- [ ] Hallazgo sin corregir: un rol sin permiso de escritura sobre `destinos` recibe exito al eliminar (la RLS borra 0 filas sin error) y el destino sigue existiendo.

### 11. Mejorar la presentacion de servicios adicionales expandidos en las tarjetas

- [ ] Evitar que una tarjeta expandida aumente la altura de toda la fila y deje grandes espacios vacios.
- [ ] Evaluar modal/panel lateral o una superficie compacta equivalente, conservando identidad de paquete y detalle de cada servicio.

### 12. Aclarar, renombrar u ocultar el metadata de las vigencias promocionales

- [ ] El porcentaje/monto guardado en una vigencia promocional quedo como metadata y resulta enganoso en la UI.
- [ ] La vigencia no genera ni modifica precios: la fuente autoritativa del precio es `tarifa_hotel`.
- [ ] Aclarar, renombrar u ocultar ese valor en el editor y listado de vigencias promocionales.

### 13. Integrar hoteles unidad en empaquetados

- [ ] Integrar y validar hoteles `modelo_tarifario = "unidad"` dentro de productos empaquetados.

### 14. Integrar hoteles unidad con vuelos y bloqueos

- [ ] Integrar y validar hoteles `modelo_tarifario = "unidad"` con vuelos, salidas y bloqueos.

### 15. Investigar hotel 217 ausente en Vista Booking

- [ ] Diagnosticar por que el hotel 217 no aparece en Porcion terrestre sin destino o buscando `odair`.
- [ ] Trazar en Vercel Preview: `tarifario_resumen` -> filtros post-carga -> `TarifarioPublic` -> `VistaBooking` -> tarjetas.
- [ ] No cambiar generacion, vigencia ni identidad categoria/regimen sin reproducir primero el descarte real.
- [ ] Fixture confirmado de produccion: hotel 217, paquete 50 activo, modelo persona, SAN ANDRES, 28 filas en `tarifario_resultado`, 4 filas en `tarifario_resumen`, 2 noches, Estandar/Superior, PAE/FULL y procedencia Promocion.
- Nota (PR #322, diagnostico de datos, no defecto): el mismo hotel 217 "Odair Dubai prueba" pertenece a SAN ANDRES pero `hoteles.zona` = "Bocagrande" (zona real de Cartagena); el filtro de Zona reflejo correctamente el dato almacenado y no se modifico la base. Ver `DECISIONS.md` ADL-024. No cierra ni sustituye este pendiente (la ausencia en Porcion terrestre sigue sin diagnosticar).

### 16. Separar Preview y Produccion

- [ ] Usar entornos y bases de datos independientes.
- [ ] Documentar el orden de migraciones y las variables por ambiente.

### 17. Desarrollo posterior del negocio

- [ ] Desarrollo integral B2B/B2C.
- [ ] Marketing y redes sociales.
- [ ] Automatizacion comercial y ventas.

### 18. Presencia y actividad reciente para superadmin

- [ ] Evaluar un mini informe en el dashboard de superadmin que muestre quien esta activo ahora y hace cuantos minutos se registro su ultima actividad o cambio.
- [ ] Distinguir presencia en la app (senal con vencimiento) de cambios realmente auditados; no inferir "en linea" solo por el inicio de sesion ni llamar "cambio" a una simple visita.
- [ ] Definir fuente de datos, alcance por tenant, permisos, frecuencia de actualizacion y retencion antes de implementar. Probar sesiones cerradas o inactivas y multiples pestanas sin exponer datos sensibles.

## Cerrado recientemente

- [x] PR #333 (squash `92b3c51e`, 2026-09-29): cierre de la separacion de datos sensibles de proveedores (migracion 191: `guardar_proveedor` escribe en `proveedores` y `proveedores_datos_sensibles`, paridad verificada, retira triggers y las 8 columnas legacy sin CASCADE, lectura del catalogo base solo para personal interno activo, revoca TRUNCATE). Voucher solo con `voucher_contacto`. `completarProveedores` autoriza antes de usar service-role; `asegurarCuentasPorPagar` y `liberarVencidas` pasan a `lib/` (server-only). El commit indica la 191 preparada y no aplicada al momento del merge; el usuario reporta despues que ya esta aplicada. La validacion con un proveedor nuevo sigue pendiente (#1).
- [x] PR #332 (squash `08f717a3`, 2026-09-29): politica de reservas de proveedores resumida a dos lineas con dialogo "Ver mas"; sin cambios de SQL ni datos.
- [x] `eb274b5b` (2026-09-29): selectores buscables integrados en formularios del panel y preparacion de la separacion de datos sensibles de proveedores (migraciones 189/190).
- [x] `27fa9402` (2026-09-24): selector buscable de proveedores en hoteles (`ComboProveedor`).
- [x] PR #331 (squash `970d9c67`, 2026-09-24): calendarios propios en los formularios existentes. `components/ui/DateInput.tsx` y `lib/calendarValue.ts` reemplazan controles de fecha nativos sin cambiar el contrato de valores ni la lógica de negocio; referencia técnica en `docs/calendarios-personalizados.md`. Validado visualmente por el usuario antes del merge.
- [x] PR #330 (squash `fadb9a2e`, 2026-09-23): tablas del Dashboard y CRM se adaptan al ancho real del contenedor, sin recorte horizontal silencioso. CRM agrega la vista de pasajeros de contratos de ambas agencias bajo permisos por rol/contrato mediante la migración 188; fuente separada de `crm_contactos`, sin añadir pasajeros a campañas. Preflight, postcheck y 12 casos de seguridad de la 188 reportados `OK`; el usuario confirmó que ya aparecen los pasajeros.
- [x] PR #329 (squash `67154391`, 2026-09-23): búsqueda interna por documento para reutilizar pasajeros de contratos existentes en flujos de creación, migración 187. Conserva datos históricos sin partir nombres combinados ni modificar el núcleo atómico de la 167. Preflight, postcheck y pruebas SQL de seguridad/búsqueda reportados `OK`. La consulta/lista de pasajeros en CRM se añadió después, en PR #330; la edición de pasajeros en contratos ya creados no fue parte de este cierre.
- [x] PR #328 (squash `53f1ed91`, 2026-09-23): isotipo oficial como indicador de carga para páginas, búsquedas y navegación según el alcance implementado; validado por el usuario.
- [x] PR #327 (squash `5f21a147`, 2026-09-22): fase 1 del rediseño de Vista Booking (header, canvas, pestañas, buscadores y filtros). Ajustes de filtro en búsqueda por destino y selector de destino incluidos; tarjetas, modal y carrito visual pendientes de fase posterior.
- [x] PR #326 (squash `412de253`, 2026-09-22): rediseño del Dashboard administrativo. Shell visual (`app/(dashboard)/**`) sobre tokens propios `--dash-*` derivados de los tokens semánticos base, sin clases legacy (`bg-white`, `text-gray-*`, `.app-bg`) dentro del shell; TenantSwitcher pasa a un selector accesible (`@base-ui/react/select`) sin librería nueva. KPI reales con barra de progreso solo cuando existe un numerador y un denominador reales y relacionados (`pctOrNull`/`pctRawOrNull`, `lib/dashboard/metricas.ts`): Contratos (confirmado/activo de vigentes), Cupos (ocupados de capacidad), Cartera al día/vencida por moneda, Pagos por vencer, Conciliaciones del mes, Facturación DIAN y Retención en la fuente — estas tres últimas visibles solo para roles contables (`superadmin`/`gerencia`/`administracion`). Meta general mensual persistida por tenant+periodo+moneda (`meta_ventas_mensual`, migración 185, configurable en `/dashboard/configuracion`) — nunca la suma de cuotas individuales de asesores ni el cálculo dinámico de Punto de equilibrio; solo `confirmado`/`activo` cuentan como venta efectiva contra la meta y en cartera, nunca `pendiente` ni `cancelado`. Los agregados pesados se resuelven en 6 funciones SQL `SECURITY INVOKER` (migración 186, `fn_dashboard_*`) en vez de descargar filas completas — cantidad de consultas fija por carga, `EXECUTE` revocado de `anon`, otorgado a `authenticated`/`service_role`; la vista `cupos_por_bloqueo` se corrige a `security_invoker = true`. `fetchAllPaginado` (protección genérica contra "Max Rows") se conserva como utilidad reutilizable. Eliminado por completo el sistema de cambio de temas (`ThemeSwitcher`, 4 variantes CSS `indigo`/`verde`/`web`/`blueprint`, `data-theme`, `localStorage` `dsp-theme`): la app queda con una sola UI oficial en Dashboard, Tarifario/Vista Booking y Login. Migraciones 185/186 aplicadas en Supabase remoto con preflight/postcheck `ok:true` (dos rondas de corrección de `GRANT`/`EXECUTE` documentadas). Ver `DECISIONS.md` ADL-026 y ADL-027. El objetivo activo pasa a ser el rediseño de Vista Booking (ver `CURRENT_GOAL.md`).
- [x] PR #324 (squash `b673f9cb`, 2026-09-22): rediseño de `/login` con dos estados visuales, Portal B2B y Portal Admin. El selector (`role="tablist"`, dos `role="tab"`) cambia únicamente presentación — etiqueta, título, descripción, placeholder de correo y texto del CTA — y nunca tiene autoridad sobre permisos: el destino tras autenticar sigue dependiendo exclusivamente de `usuarios.rol` (agencia/freelance/cliente_final → `/portal/b2b`, personal interno → `/dashboard`), sin excepción aunque el selector visual no coincida con el rol real. Panel informativo (derecha, oculto en móvil) con eyebrow, titular, descripción y tres capacidades reales de la plataforma (Tarifario y oferta publicada, Reservas y seguimiento, Contratos y documentos), sin tarjetas de portal ni afirmaciones sin demostrar. Logo oficial (`components/Logo.tsx`, `variant="full"`) con mayor presencia, nunca reconstruido. `QUICK_LOGIN_ENABLED` se resuelve en el servidor (`page.tsx`, Server Component) y solo entonces se renderiza el disclosure de acceso rápido en el cliente — antes aparecía siempre aunque el servidor lo tuviera apagado. Cuenta inactiva (`?inactivo=1`, cierre de sesión si `perfil.activo === false`) e inicio con Google conservados sin cambios. Responsive validado en escritorio (1440×900), laptop (1024×768) y móvil (390×844) para ambos estados del selector, con esquinas redondeadas y borde delgado en el marco exterior, sin solapar `ThemeSwitcher`. En el tarifario público (`app/tarifario/page.tsx`) se elimina el botón antiguo "Portal B2B" (`/portal/b2b`) del encabezado para visitantes sin sesión; queda un único acceso público "Ingreso al Portal" → `/login` (el botón "Ir al panel →" de sesión activa no se tocó). Tokens visuales aislados en `LoginClient.module.css` (nunca en `styles/globals.css`). Pruebas: `pruebas/loginWiring.test.ts` (47/47) más validación visual manual en las tres resoluciones y ambos estados del selector. Ver `DECISIONS.md` ADL-025. El objetivo activo pasa a ser el rediseño del Dashboard administrativo (ver `CURRENT_GOAL.md`).
- [x] PR #322 (squash `73339a1f`, 2026-09-21): ordena y filtra el resto del inventario hotelero. Dentro de cada bloque por paquete, el resto no recomendado se ordena de forma determinista: precio valido ascendente (nulo/no finito/<=0 siempre al final, en cualquier sentido de orden) -> estrellas descendente (sin clasificar al final) -> zona normalizada -> nombre (locale es) -> `hotelId` de desempate; los recomendados nunca se reordenan por este motor, solo el resto, y conservan su prioridad/bloque y aparecen primero. Identidad autoritativa siempre `(hotelId, paqueteId)`, nunca `hotelId` a secas. Selector "Ordenar por" (precio/estrellas/nombre, asc/desc) y panel de filtros: precio (via orden), estrellas (incluye "Sin clasificar"), zona, Pet Friendly, Adults Only, condiciones de pago (Con/Sin) y politica comercial (Flexible/No reembolsable); todos los filtros aplican tanto a recomendados como a resto sin promover una prioridad inferior al excluir una superior (una prioridad 1 que no cumple un filtro no asciende la 3 a su lugar). Zonas/estrellas disponibles en el selector se derivan exclusivamente del universo de ofertas candidatas ya acotado al destino/busqueda activa (recomendados + resto); el estado global sin destino puede mostrar la union completa; nunca una lista global inventada cuando hay destino activo. Condicion de pago/politica comercial se resuelven con combinacion ternaria (positivo/neutro-conocido/desconocido): una evidencia positiva en cualquier lado gana, y un lado neutro nunca convierte un lado desconocido en "flexible"/"sin condicion". En busqueda por destino, condicion/politica usan las fechas EXACTAS buscadas (`BusquedaResultado.condicion`) combinadas con la restriccion propia del paquete; exploracion conserva el calculo de rango generico. La lectura de `hotel_temporadas` para esa condicion se pagina por completo con `ejecutarConsultaPaginada` (mismo patron que el PR #320). Correccion de regresion en Preview: `armado_hoteles` tiene RLS de solo lectura interna, asi que la consulta de prioridades para el tarifario publico debe usar `admin` (service-role) en vez de `sb` (cliente de la request) — con `sb`, un visitante anonimo recibia siempre 0 filas sin error y ningun recomendado aparecia, ni en global ni en busqueda por destino, porque ambos modos parten del mismo mapa combinado; ver `DECISIONS.md` ADL-023. Diagnostico de datos, no defecto (ver `DECISIONS.md` ADL-024 y la nota en el pendiente #14 de este archivo): hotel 217 "Odair Dubai prueba" pertenece a SAN ANDRES pero `hoteles.zona` = "Bocagrande"; el filtro reflejo correctamente el dato almacenado y no se modifico la base. Preview validado por el usuario en estado global y en busqueda por destino. Sin migraciones ni regeneracion de tarifarios. El pendiente "Ordenar el resto del inventario hotelero" queda cerrado; el objetivo activo pasa a ser el rediseno integral de la interfaz (ver `CURRENT_GOAL.md`).
- [x] PR #320 (squash `7d8cf7ec`, 2026-09-19): defecto de vigencia "TAMACÁ pierde PA/PC en Ver opciones". Caso real paquete 53 / hotel 57 TAMACÁ BEACH RESORT: el snapshot y `tarifario_resumen` contenían PA, PAM y PC, pero el modal solo mostraba PAM. Causa demostrada: `filtrarTarifarioVencidas` leía `hotel_temporadas` y `tarifa_hotel` con consultas únicas sin paginación; PostgREST truncaba en silencio por el Max Rows del proyecto y las filas faltantes se interpretaban como tarifas no materializadas y se filtraban. Corrección: ambas lecturas usan `ejecutarConsultaPaginada`, orden estable por `id`, avance por filas realmente recibidas, término solo con página vacía y propagación de errores por página; fail-closed ante error técnico; no se relaja la vigencia ni se inventan precios desde temporadas. Regresión real: 1.002 tarifas y 1.001 temporadas; PA/PAM/PC sobreviven; el usuario validó en Preview que Tamacá muestra PAM, PC y PA. Guardar o quitar `armado_hoteles.prioridad` revalida el editor y `/tarifario` (la primera vista conservó prioridades guardadas antes del despliegue; al quitar y reasignar aparecieron sin regenerar el tarifario; validado por el usuario). Verificaciones: regresión de vigencia 16/16, ruta focal de vigencia 184/184, prioridad y recomendaciones focalizadas verdes, TypeScript/ESLint focal y `git diff --check` limpios; suite completa 3.858 pass y 13 fallos preexistentes, sin fallos nuevos. Sin migraciones ni cambios de base de datos. El objetivo #1 sigue abierto.
- [x] PR #318 (squash `a2bcbf2a`, 2026-09-18): hoteles recomendados por paquete. Prioridad manual 1-6 por oferta `(paquete_id, hotel_id)` con namespace propio por paquete; el mismo hotel puede aparecer en paquetes distintos con prioridad y etiqueta diferentes. Sin búsqueda se muestran solo las posiciones literales 1 y 2 de cada paquete (bloques A1/A2/B1/B2), sin sustituir ausentes con prioridades 3-6; con búsqueda por destino cada paquete coincidente aporta sus prioridades 1-6, conservando bloques por paquete y mostrando solo resultados reales del motor. Las tarjetas se identifican por oferta `(hotelId, paqueteId)`; solo las ofertas seleccionadas muestran "Recomendado" y todas conservan el nombre del paquete. Precio, disponibilidad, Incluye/No incluye y add-ons siguen ligados al paquete. Selector administrativo con autosave optimista: respuesta inmediata, sin refresh en exito, rollback y refresh autoritativo en error. Migración 183: `armado_hoteles.prioridad` rango 1-6 con unicidad parcial por paquete. Migración 184: un cambio exclusivo de prioridad no invalida el snapshot; cambios reales de armado sí; aplicada en Supabase remoto con preflight/postcheck `ok: true`, bloque mutante sobre datos reales y rollback sin residuos. Paquetes 33 y 36 regenerados/publicados nuevamente. Preview validado por el usuario con San Andres, Cartagena y Santa Marta; pruebas focalizadas 126/126; merge con tres commits internos y `Co-authored-by: Odair`. Pendiente del orden del resto del inventario conservado como #1.
- [x] PR #316 (squash `ff9507da`, 2026-09-18): recalculo automatico por hotel endurecido. Crear, editar o eliminar tarifas/temporadas regenera los paquetes asociados usando el `hotel_id` autoritativo de la fila; los errores al buscar paquetes asociados no quedan silenciosos; la regeneracion conserva independencia entre paquetes. La calculadora descuenta promociones sobre la tarifa completa, incluido el suplemento efectivo; prioridad de suplemento: promocion > base > general. Una vigencia por si sola no genera ni modifica precios. Una promocion solo gana para un combo si existe su fila materializada en `tarifa_hotel`; sin fila promocional gana la siguiente tarifa materializada valida. Preview validado: PAE promocional 600.000 y FULL sin fila promocional BASE · Prueba d, ~1.334.000; cambiar la vigencia despues del despliegue disparo y publico el nuevo snapshot; se retiraron los valores secundarios enganosos entre parentesis en la tabla de tarifas. Nota: los snapshots ya desplegados no se regeneran solos al desplegar; requieren un evento posterior de edicion/regeneracion.
- [x] PR #314 (squash `11589a0f`, 2026-09-17): flujo de agentes modularizado. Router universal (`AGENTS.md`) con enrutamiento por rol; archivos por rol en `docs/agents/` (`CODEX.md`, `SONNET.md`, `OPENCODE.md`, `DEEPSEEK.md`); plantillas compactas en `PROMPTS.md`; lectura minima por situacion (tarea nueva, correccion en la misma conversacion, post-merge); validacion incremental. Auditado por Codex y aprobado por el usuario.
- [x] PR #312 (squash `ba78c77d`, 2026-09-17): tarjetas completas de "Buscar alojamiento" para hoteles persona y unidad/Bernalo. Muestran foto/video, informacion del hotel, ubicacion/mapa, Incluye/No incluye y add-ons; Incluye/add-ons respetan el paquete de la oferta; precio y disponibilidad conservan sus motores originales; descripcion con Ver mas/Ver menos; servicios adicionales colapsados con contador. Flujo validado en Vercel Preview.
- [x] Orden de secciones en `HotelModal` del motor interno (2026-09-17, commit `70263e3d`): Salidas -> Motor interno -> Incluye -> Servicios add-on. Traslado de JSX sin cambios de logica, props, precios, disponibilidad, acciones ni fuentes; prueba de regresion agregada (`pruebas/hotelModalOrdenSecciones.test.ts`) y flujo visual validado por el usuario. Las variantes externas/Bernalo no fueron modificadas.
- [x] Integracion principal Bernalo/unidad para Porcion terrestre: editor, busqueda, carrito, menores y add-ons.
- [x] PR #298: persistencia versionada, adaptador y migracion 173 de Bernalo.
- [x] Dubai: edades y suplementos propios por base/promocion; migracion 177 aplicada y validada.
- [x] Condiciones Dubai en contratos; migracion 178 aplicada y validada.
- [x] Procedencia Base/Promocion y precio final; migraciones 179/180 y hotfix 180 aplicados y verificados.
- [x] Docker Desktop/WSL recuperado; migraciones 179/180 validadas en Postgres 16 desechable.
- [x] PR #288: fuente unica CHD/INF, responsable adulto e inventario de sillas.
- [x] PR #289: infantes de contratos manuales visibles en vuelos, incluido cross-tenant autorizado.
- [x] PR #290: infante subordinado visualmente al adulto responsable.
- [x] PR #291: enlace Editar en contrato con cambio a la agencia real.
- [x] PR #292: crear/editar infantes desde vuelos con datos completos y responsable.
- [x] PR #293: descripcion manual del paquete.
- [x] PR #294: servicios incluidos, CxP por servicio y reconciliacion financiera durable.
- [x] PR #308 `8a2b5985` (2026-09-17): snapshots atomicos y bloqueo de versiones invalidas. Migraciones 181/182 aplicadas en Supabase remoto (preflight/postcheck esperados). Invalidacion segura por cambios de fuentes, publicacion atomica del snapshot y bloqueo server-side de snapshots no publicables o de paquetes inactivos. Preview validado en Vercel.
- [x] PR #306 `fca2e834` (2026-09-16): add-ons acotados al paquete de origen. Comportamiento confirmado: `+ Agregar servicios / tours` conserva `paqueteId`; muestra unicamente los servicios opcionales del paquete de origen; no mezcla servicios de otros paquetes del mismo destino; `Limpiar resultados` abandona el alcance y restaura el catalogo general; validado en Vercel Preview con el caso Cartagena: 14 propios frente a los 112 del catalogo general.
- [x] PR #302 (squash): condiciones de tarifa, procedencia y cotizacion B2C publica (`/cot/[token]` sin login); migraciones 178-180 integradas.
- [x] Merge correctivo 2026-09-16 (`e0efc7ed` sobre `f40716a7`): retira alcance accidental del PR #302 (TarifarioPublic, VistaBooking, vigencia y pruebas).
- [x] Organizacion de los archivos de coordinacion: TASKS, CURRENT_GOAL, DECISIONS, PROJECT_MAP y revision de AGENTS; los cinco se versionan.
- [x] Barra de estilos oculta al imprimir contratos/PDF.
