# TASKS.md - Dspacios Mayorista

Fuente unica y priorizada de pendientes. Ultima actualizacion: 2026-10-04.

Convencion: `[x]` integrado en `main`; `[~]` implementado solo en una rama sin integrar (no cuenta como cerrado); `[ ]` pendiente.

## Mapa de ejecucion y paralelismo (2026-10-01)

Este mapa registra cruces de superficies. Las referencias a Vuelos #1-#3 de la primera ronda son historicas: su entrega quedo cerrada el 2026-10-04; los seguimientos son #36/#37. Antes de abrir cada frente, confirmar rama, `git status`, funciones compartidas, migraciones y archivos que otro agente esta editando. En un mismo checkout, cambiar de rama no aisla cambios sin commit.

### Codigo que puede avanzar ahora

| Frente | Pendientes | Limite para trabajarlo en paralelo |
| --- | --- | --- |
| Vuelos e inventario | #1-#3 cerradas; solo seguimientos #36/#37 | Cualquier cambio futuro en vuelos, reservas, contratos o RLS debe coordinarse con #17 y los otros frentes activos. |
| Tarjetas de servicios expandidos | #14 | Solo UI acotada tras localizar sus componentes; reservar la superficie de tarjetas/Booking para este dueno. No ejecutar junto con #6, #18 o la parte publica de #23 si tocan los mismos componentes. |
| Descuento de vigencias promocionales | #15 | Ahora requiere calculadora, generacion y presentacion de `tarifa_hotel`; coordinar con #26 y no ejecutar ambos frentes a la vez. No regenerar hoteles reales antes de probar preservacion de tarifas. |
| Rentabilidad responsive | Primera parte de #22: corregir el scroll conocido en Finanzas -> Rentabilidad | Trabajo focal en su vista. La busqueda de otros scrolls es auditoria aparte; no modificar otras pantallas en esta ronda. |

### Primera ronda sin codigo de producto

- **Decisiones o diseno:** #36 (fechas/horarios frente a cambio operacional), #37 (D5/D6), #4 (diferida por el usuario), #6 (acordar tarjetas), #8/#9/#16/#17 (contratos de hoteles unidad y cotizacion), #19 (entornos y despliegue), #20 (alcance), #21 (fuentes de presencia), #23 (destino principal de programas existentes), #25 (fuentes reales de eventos de seguridad) y #28 (contratos no concretados y consecutivos). No abrir implementacion de estos puntos por suposicion.
- **Validacion o diagnostico:** #5 (proveedor nuevo, catalogos y matriz), #7 (smoke financiero), #10 (smoke visual), #11 (smoke de excepcion), #12 (casos residuales de Destinos), #18 (hotel 217), resto de #22 (inventario de scrolls), #24 (inventario de fechas) y #26 (tarifas del hotel afectado). Ejecutar pruebas de lectura/Preview con autorizacion y sin corregir datos por adelantado.
- **Trabajo tecnico transversal:** #13 requiere codigo para limpiar lint, pero no debe correr en paralelo con implementaciones: puede tocar cualquier archivo. Primero inventariar y asignar lotes a duenos de superficies ya liberadas.

### Grupos de codigo que se pisan al implementarse

| Grupo | Pendientes relacionados | Regla de coordinacion |
| --- | --- | --- |
| Vuelos, sillas, reservas y contratos | #36/#37/#17; parte de #8 si usa salidas | Mismas acciones/RPC, `sillas`, `bloqueos_vuelo` y flujos de venta. Un dueno a la vez para el nucleo; #1-#3 ya no bloquean #17. |
| Booking, tarjetas y filtro publico | #6/#14/#18/#23 | Pueden coincidir en `TarifarioPublic`, `VistaBooking`, filtros y tarjetas; diagnosticar #18 antes de cambiar esa superficie. Un dueno de UI publica a la vez. |
| Hoteles unidad y paquetes | #8/#9/#16/#17 | Comparten calculo/cotizacion y definicion de disponibilidad; acordar el contrato comun antes de repartir por tipo de paquete. #17 cruza ademas el grupo Vuelos. |
| Identidad, auditoria y acceso | Parte B2B de #20, #21/#25 | Primero separar presencia, autenticacion, accesos denegados y auditoria de datos; no mezclar el panel con la migracion B2B 193 en curso. |
| Infraestructura y deuda global | #19/#13 | #19 afecta entornos/migraciones de todos; #13 puede editar cualquier archivo. No tratarlos como frentes independientes seguros durante otros despliegues. |

**Paralelismo:** #1-#3 dejaron de ser un frente activo; #36/#37 no autorizan cambios hasta decidir su alcance. #15 y #26 comparten calculadora, tarifas y generacion: reservarlos a un mismo dueno o hacerlos en serie. Las auditorias de solo lectura pueden avanzar en paralelo. Esto no autoriza merges simultaneos ni SQL remoto. Antes de cada implementacion, reservar archivos y funciones concretas; `TASKS.md`, `package.json`, `types/database.ts`, cargadores de pruebas y numeracion de migraciones siguen siendo puntos compartidos. Confirmar el estado actual de B2B 193 y fechas de negocio 198 en vez de asumir el inventario del 2026-10-01.

### Frentes futuros 29-35: limites de paralelismo (2026-10-04)

Mapa de superficies **probables**, no reserva definitiva de archivos. Revisar el diff y las ramas activas antes de implementar: el mapa anterior es de 2026-10-01 y no refleja por si solo los PR posteriores ni el trabajo aislado de Vuelos 201, CRM 202, Tarifas 203 y Contabilidad 204.

| Frente | Superficies a auditar | Cruces y regla para implementacion |
| --- | --- | --- |
| #29 Recobro en carrito | `app/tarifario/checkout/`, `app/tarifario/TarifarioPublic.tsx`, `app/(dashboard)/dashboard/cotizaciones/`, `lib/calc/finanzas.ts` | Ya hay recobro en cotizacion manual; auditar su traslado al carrito. Comparte cotizacion/precio con #30 y #35. No repartir esos cambios de escritura entre agentes. |
| #30 PVP/comision o NETO | `app/(dashboard)/dashboard/contratos/`, `app/(dashboard)/dashboard/reservar/actions.ts`, `lib/finanzas/`, `app/portal/b2b/` | Comparte calculo y contrato con #29, #31 y el trabajo activo de comisiones; tambien toca superficies de Vuelos 201. Auditar ahora, implementar despues de delimitar dueno y reglas. |
| #31 Clientes, asesores y referidos | `app/(crm)/crm/`, `app/portal/b2b/`, `app/(dashboard)/dashboard/contratos/`, `lib/finanzas/comisionResolver.ts` | Comparte identidad y atribucion con #30, #32 y #33; no modificar la rama CRM MVP ni las reglas de comision desde otro frente sin coordinacion. |
| #32 Documento primero y autocompletar | `app/(crm)/crm/pasajeros/`, `app/(dashboard)/dashboard/contratos/NuevoContratoForm.tsx`, `app/(dashboard)/dashboard/reservar/`, busqueda existente de la 187 | Cruza #31/#33 y el flujo de pasajeros de Vuelos 201. Auditoria de identidad en paralelo; cambios de escritura y unificacion de fichas en serie con CRM. |
| #33 Mini CRM B2B | `app/portal/b2b/`, `app/(crm)/crm/`, permisos y RLS | Comparte modelo de clientes y aislamiento con #31/#32 y la rama CRM MVP (202). Un solo dueno para esquema, permisos y sincronizacion; no iniciar en paralelo con esa rama. |
| #34 Avisos de cotizaciones | `app/tarifario/checkout/`, `app/(dashboard)/dashboard/cotizaciones/`, `app/portal/b2b/`, `lib/notificaciones.ts`, dashboard | Inventario de eventos/destinatarios puede avanzar solo en lectura; implementar despues de fijar el paso B2B cotizacion -> solicitud de contrato y coordinar con #29/#30/#33/#35. |
| #35 Cotizaciones comparativas | `app/tarifario/TarifarioPublic.tsx`, `app/tarifario/VistaBooking.tsx`, carrito/checkout, modelo de cotizaciones | Comparte UI y flujo con #29 y #34; tambien se pisa con #6/#14/#18/#23 y puede depender de #15/#26 para precios vigentes. Un dueno de Booking/cotizacion a la vez. |

**Trabajo paralelo permitido por ahora:** auditorias de solo lectura de #29-35 con entregables separados; #34 puede disenar eventos sin tocar flujos. **Implementacion:** agrupar #29/#30/#35 bajo un dueno comercial y #31/#32/#33 bajo un dueno de identidad/CRM, en serie dentro de cada grupo. Los grupos tampoco son independientes mientras #30 y #31 compartan contratos, portal B2B y comisiones: no implementarlos a la vez. #34 se integra cuando ambos contratos de evento y permisos esten definidos. No tocar en paralelo `TASKS.md`, `types/database.ts`, `package.json` ni numeros de migracion; no ejecutar SQL remoto por este mapa.

## Cola priorizada

**Prioridad inmediata: #38 (comisiones B2B futuras).** El codigo guarda bases sobre PVP total en dos flujos y tiene dos fallbacks con `||`; el modo NETO requiere revisar su estado de pago. El usuario aclaro que las comisiones historicas se cuadraron contrato por contrato ajustando manualmente el porcentaje: NO inferir sobrepago desde la base guardada, ni recalcularlas o modificarlas. Atender la regla de nuevas comisiones antes de ampliar #30. **En paralelo:** preparar el aislamiento de #19; Tarifas #15/#26 queda despues de una ruta de pruebas separada.

### 1. Formulario "Editar bloqueo" con la estructura visual de "Nuevo bloqueo" (cerrada 2026-10-04)

- [x] PR #336 integrado en main y validado en Preview: mismas secciones de Nuevo bloqueo, sin borrar origen/ruta guardados cuando no coinciden con el catalogo.
- [x] Cupos y modalidad/estados permanecen fuera del formulario general. La politica sobre edicion de fechas y horarios queda separada en #36; no se da por decidida aqui.

### 2. Corregir el traslado de CUPOS LIBRES entre records (cerrada 2026-10-04)

- [x] Traslado atomico de las mismas sillas libres, sin clonarlas ni aumentar cupos manualmente; retiro de cupo libre, idempotencia, autorizacion, compatibilidad e historial de movimientos. La interfaz distingue cupos activos de movimientos historicos y conserva trazabilidad.
- [x] Fases B, C y E integradas en main (PR #346, #347 y #348; migraciones 192-200). Postchecks de 199 y 200 y barreras de escritura/historial verificados en Produccion.
- [x] PR #349 y migracion 201 integrados; postcheck 201 en Produccion: 30 verificaciones, resumen true, 0 falsas. Usuario valido el flujo en Preview y Produccion.
- Seguimiento operativo, no bloqueo de esta entrega: firmas antiguas sin version programadas para cerrarse automaticamente el 2026-10-11 a las 02:56:12, hora de Bogota. Vigilar el postcheck; no reactivar firmas ni ejecutar rollback sin una decision nueva.
- Limites aceptados: algunas pruebas operativas previas a 199 se omitieron a peticion del usuario; los 2 records de prueba P1/P1- no se consideran datos a sanear; las 152 sillas legadas con contrato manual sin plazo quedan sin backfill segun decision registrada. No inferir de este cierre que los datos legados fueron corregidos.

### 3. Mover un pasajero entre records con su numero de contrato: con cupo o solo sus datos (cerrada 2026-10-04)

- [x] Dos modos con eleccion explicita: solo datos ocupa una silla libre real del destino, o con cupo traslada la misma silla y ajusta ambos totales. Sin cupo libre, solo datos falla sin cambiar automaticamente de modo. Operacion atomica e idempotente con historial.
- [x] Conserva contrato y datos de pasajero; en el contrato del flujo de venta actualiza los tramos afectados cuando corresponde. Contrato manual editable desde Vuelos; el contrato del flujo de venta no es editable alli. La 201 corrige la retencion en plazo, el estado del destino y la numeracion visible consecutiva sin perder identidad historica.
- [x] Flujo probado en Preview y validado por el usuario en Produccion tras PR #349.
- D5/D6 siguen como decisiones de negocio, no como aprobaciones implicitas: mover pasajeros sin contrato y seleccionar automaticamente la primera silla libre real en modo solo datos. Se trasladan a #37; la entrega existente se cierra con el comportamiento actual.

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

### 14. Mejorar la presentacion de servicios adicionales expandidos en las tarjetas

- [ ] Evitar que una tarjeta expandida aumente la altura de toda la fila y deje grandes espacios vacios.
- [ ] Evaluar modal/panel lateral o una superficie compacta equivalente, conservando identidad de paquete y detalle de cada servicio.
- [ ] Mostrar completas las fechas de ida y regreso en la tarjeta; hoy los controles pueden encogerse hasta dejar visible solo el icono del calendario.
- [ ] Permitir agregar un servicio adicional desde la tarjeta o su detalle al viaje/carrito, con fechas y pasajeros y precio real calculado para ese paquete y servicio. El precio "desde" es informativo, no el importe final ni una modificacion de la tarifa base del hotel. Coordinar esta superficie con el trabajo de Opus antes de abrir otro frente de Booking.

### 15. Aplicar el descuento de las vigencias promocionales en la calculadora y las tarifas guardadas

- [~] Avance reportado el 2026-10-04 en `DspaciosMayorista-tarifas` (`tarifas-promo-preservacion`), sin staging, commit, PR, SQL remoto ni regeneracion real: SUNSALE manual se preserva por categoria/regimen/temporada; sustituir una celda por el -6% exige vista antes/despues y confirmacion, y el servidor valida el mismo resultado. Caso de la captura: 483.160 / 426.760 / 213.380, sin cambiar Superior ni PC. Pruebas focales 231/231, build OK; suite total 5009/5010 con un fallo reportado como preexistente fuera de esta superficie. No cuenta como integrado.
- [ ] Antes de integrar, decidir promociones que cruzan varias bases (hoy bloqueadas) y el tratamiento de Nino 2/infante (el borrador aplica el mismo porcentaje, sin aprobacion). `descuento_monto` y N noches/1 gratis siguen sin regla automatica: no incluirlos por inferencia.
- [ ] Cambio de regla pedido por el usuario (2026-10-01): en calculadora Mixta, si existe una base para la misma categoria/regimen y una vigencia de mayor prioridad con descuento, la vista previa debe mostrar el precio promocional ya descontado; al generar, `tarifa_hotel` debe guardar ese precio final. Ejemplo real: BAJA 2026, FULL, promocion SUNSALE1 de -6% solo FULL: sencilla 514.000 -> 483.160, doble/triple/multiple 454.000 -> 426.760, ninos 227.000 -> 213.380; BAJA 2026 queda intacta. No aplicar el porcentaje de nuevo al cotizar o reservar.
- [ ] Definir y validar el enlace entre promo y base cuando se solapen varias vigencias, el alcance por regimen, fechas de compra/viaje, prioridad, redondeo y comportamiento de campos editados manualmente. La promo no debe tomar una base arbitraria ni sustituir el precio final de otra promocion.
- [ ] Marcar la fila materializada como promocion con `precio_final_autoritativo` y `temporada_base` correctos; la etiqueta de la tabla no debe decir BASE para una promocion ya calculada. Mantener coherentes vista previa, tabla interna, tarifario, cotizacion y reserva con pruebas de no doble descuento y de preservacion de otras vigencias/regimenes.
- [ ] Coordinar con #26: la generacion actual reemplaza todas las filas del regimen, incluidas otras temporadas. No usar "Generar tarifas" sobre datos reales hasta corregir/preservar ese alcance y probar rollback; no ejecutar SQL remoto ni regenerar el hotel de la captura por esta anotacion.

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

### 26. Preservar y consultar tarifas historicas de todos los hoteles; conservar la calculadora por regimen

- [~] Avance reportado el 2026-10-04 en la misma rama aislada: busqueda/paginacion del historial en servidor, orden estable y permisos internos; snapshot de vigencia en cada version y `hotel_temporadas_historial`; reconstruccion de solo lectura desde `auditoria` para registros recuperables. Pruebas locales con 1.200 versiones y SQL Docker, sin tocar datos remotos. El plan de incorporacion historica excluye el hotel 59 y no se ejecuto. No cuenta como integrado.
- [ ] Antes del PR, renumerar la migracion provisional 201 de esta rama: 201 ya se uso en Vuelos y 203 fue reservado por el usuario para Tarifas (202 CRM, 204 Contabilidad). Verificar ocupacion y orden real en main y ramas activas; actualizar migracion, scripts, pruebas y documentacion en conjunto. No aplicar SQL remoto por esta nota.
- [ ] Decidir si incorporar versiones recuperables de `auditoria` y con que alcance. El PC/PAM de BLU BY TAMACA (hotel 59, vigencia 674) sigue solo como respaldo; restaurar o publicar requiere autorizacion separada.
- [ ] Diagnostico de Produccion (solo lectura): hotel `59`, vigencia `674`, "TARIFA PROMOCIONAL BAJA (NO APLICA FESTIVOS)". `compra_fin` fue 2026-09-30, pero `fecha_fin` de viaje es 2026-11-30. Hoy hay 0 filas de `tarifa_hotel` con ese nombre. La auditoria reportada por el usuario registra DELETE de una fila PAM a las 20:05:29 UTC y de una PC a las 20:18:51 UTC del 2026-10-01; ambas tenian ese nombre. No hay evidencia aportada de una fila PA promocional. Extraer y preservar los snapshots `antes` y revisar configuraciones antiguas de `hotel_calculadora` antes de cualquier escritura.
- [ ] No extender ni reactivar la vigencia sin decision comercial. Recuperar la posibilidad de conservar/consultar sus precios aun con `compra_fin` vencido, sin publicar precios vencidos por anticipado. No regenerar, reemplazar ni editar el hotel hasta preservar la evidencia.
- [ ] Decision actual del usuario para BLU BY TAMACA: solo respaldo recuperable de PC y PAM, sin restaurar en `tarifa_hotel` ni publicar. Las dos filas `auditoria.antes` estan guardadas fuera del repositorio en un JSON local; sigue pendiente revisar si hay configuracion historica de `hotel_calculadora`. Cualquier restauracion futura requiere nueva autorizacion, comparacion antes/despues, control de duplicados y rollback. No reconstruir precios por suposicion.
- [ ] Corregir la calculadora para conservar y volver a mostrar los valores de cada regimen al alternarlos, incluso tras guardar y recargar la pagina. Hoy `MixtaForm.cambiarRegimen` vacia `vals`, mientras `hotel_calculadora` guarda una sola fila `params` por hotel y un nuevo guardado reemplaza esa configuracion. Ademas, "Generar (agregar/actualizar)" borra TODAS las filas del regimen generado en `reemplazar_tarifas_hotel_calculadora`, incluidas otras vigencias del mismo regimen: el patron DELETE promocional + INSERT de BAJA 2027 en la auditoria coincide con esa ruta. Disenar guardado y generacion acotados por vigencia/regimen, con borrado explicito y pruebas de preservacion; revisar tambien "Reemplazar TODAS". No mezclar esta correccion general con la restauracion puntual.
- [ ] Para TODOS los hoteles, mantener consultables las tarifas guardadas cuando venza su vigencia o se retiren o eliminen de la oferta: vista interna de historico con hotel, habitacion, regimen, vigencia, valores, estado, fechas y origen del cambio; permitir buscar y comparar con tarifas vigentes. Una tarifa inactiva o historica no debe participar en cotizaciones, reservas ni publicaciones por el solo hecho de aparecer en esa vista. Cambiar de regimen, guardar o generar otro periodo no debe borrar el historico de los demas.
- [ ] Auditar que evidencia existe para tarifas ya eliminadas y sus versiones previas en `auditoria`/respaldos; no prometer recuperar registros sin snapshot verificable. Para cambios futuros, disenar historial durable antes de borrar o reemplazar (versiones o snapshots completos), con permisos solo internos, trazabilidad de autor/fecha/motivo y pruebas de consulta, comparacion y no publicacion. El respaldo local de BLU BY TAMACA (PC y PAM de la vigencia 674) no restaura ni publica datos.

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

### 30. (Futura) Contratos PVP con comision y contratos NETO

- [ ] Auditar si los flujos internos y B2B ya permiten escoger entre PVP con comision y NETO para la agencia o el cliente propio (PVP menos comision directa). Si no, disenar reglas de precio, comision, visibilidad, documentos y contabilidad antes de implementarlo.
- La correccion de importes/estado ya existente es #38 y tiene prioridad sobre esta ampliacion funcional. No mezclar ambos alcances en una entrega sin revision.

### 31. (Futura) Vincular clientes con agencias B2B, asesores y referidos

- [ ] Revisar las relaciones actuales entre clientes, agencias B2B, asesores internos y referidos. Los referidos nuevos comisionan pero no aparecen en una vista identificable; auditar su registro, atribucion, permisos y presentacion.

### 32. (Futura) Consulta y autocompletado por documento en clientes, terceros y pasajeros

- [x] Decision del dueno (2026-10-06): la identidad documental se compara por TIPO y NUMERO de documento; igual numero con tipo distinto NO es un tercero duplicado. El numero es el dato inicial para buscar, pero no una clave unica por si solo. Conservar aislamiento por tenant en lectura y escrituras; coincidencias historicas ambiguas no se fusionan automaticamente.
- [x] Decision del dueno (2026-10-08) para #351: catalogo inicial de tipos de documento `CC`, `CE`, `TI`, `RC`, `PAS`, `PPT`, `NIT` aprobado. No aceptar tipos fuera del catalogo por normalizacion permisiva (por ejemplo, `CC2` no debe convertirse en `CC`).
- [ ] Antes de publicar la 202 de #351, alinear `crm_leads` con esa regla: si hay documento, guardar tambien su tipo y usar ambos en la unicidad documental. Revisar los indices unicos de email y telefono, porque dos personas distintas pueden compartirlos; tratarlos como posibles coincidencias, no como identidad documental concluyente. Ajustar formulario, RPC, tipos y pruebas en la misma rama no aplicada; no extender este cambio a CRM de cotizaciones (#42) por implicacion.
- [~] Auditoria de solo lectura recibida el 2026-10-05 sobre `origin/main` `e6aa9fec`: pasajeros conservan tipo y numero; `ventas` no guarda tipo del titular; el carrito fuerza `CC`; `crm_contactos` no tiene tenant y su lectura para `authenticated` puede exponer datos a B2B. La rama aun no integrada de #351 guarda leads con documento normalizado pero sin tipo, unico por tenant: tipos distintos con el mismo numero colisionarian. Revisar con el dueno de #351 antes de cerrar su esquema; el PR remoto no incluye los cambios sin commit del worktree.
- [ ] Segunda comprobacion focal: medir en solo lectura duplicados por tipo, formato, tenant y NIT; verificar permisos efectivos de `crm_contactos` con roles internos/B2B antes de usarlo como fuente. Definir clave y normalizacion equivalentes en app y SQL, tratamiento de documentos historicos y precedencia por campo. Mostrar variantes y pedir eleccion; nunca fusionar ni sobrescribir automaticamente, ni copiar datos bancarios entre entidades.
- [ ] Poner el numero de documento primero en las listas y formularios pertinentes para consultar y autocompletar datos existentes. Auditar antes el modelo de identidad: tipo de documento, pais, tenant, duplicados y permisos; no asumir que el numero por si solo es una clave unica ni sobrescribir fichas por coincidencias ambiguas.

### 33. (Futura) Mini CRM de clientes en el portal B2B

- [ ] Permitir a cada agencia gestionar sus propios clientes desde el portal B2B e integrar esa informacion al CRM central. Definir alcance, propiedad, permisos por tenant y prevencion de exposicion entre agencias.

### 34. (Futura) Notificaciones de cotizaciones B2C y solicitudes B2B

- [~] Auditoria de solo lectura sobre `origin/main` `e6aa9fec`: `cotizaciones` solo usa abierta/convertida/descartada. El checkout no notifica desde servidor; ofrece enlaces opcionales de WhatsApp/correo tambien a B2B, contrario al disparador pedido. La cotizacion de carrito no guarda un origen/propietario B2B fiable (el email en `creado_por` no sustituye un id autorizado) y el portal no tiene accion de solicitar contrato. No inferir de la ausencia de alerta que no haya solicitudes enviadas manualmente.
- [ ] Definir evento B2C al crear y evento B2B solo al pulsar `Solicitar contrato`, con identidad/aliado, tenant y permisos autoritativos; no notificar cada cotizacion B2B. Disenar cola interna, estado atendido, idempotencia y reintentos antes de conectar canales. Una tabla outbox transaccional es propuesta tecnica, no decision aprobada; coordinar versiones/reediciones con #39. Decidir destinatarios, canal, recordatorios y si B2C conserva su enlace voluntario de WhatsApp.
- [ ] Para cotizaciones B2C sin login, avisar al equipo en el dashboard con pendientes de revision, listado de notificaciones y evaluar un dialogo al iniciar sesion. Para B2B, no notificar cada cotizacion: avisar solo cuando la agencia solicite confirmarla y pasarla a contrato para seguimiento. Definir destinatarios, estados, deduplicacion y lectura.

### 35. (Futura) Cotizaciones multiples y comparativas de hoteles

- [~] Auditoria de solo lectura sobre `origin/main` `e6aa9fec` y la rama de tarjetas sin commit: el carrito actual suma todos los hoteles/servicios y la conversion puede agrupar hoteles del mismo destino en un contrato. La rama de tarjetas conserva el conjunto hotel-servicios mediante `hotelRef`, pero no modela alternativas ni cambia el documento. No usar el total agregado actual como precio de una comparativa ni reinterpretar cotizaciones antiguas.
- [ ] Despues de integrar tarjetas, definir si cada alternativa incluye solo hotel o tambien vuelo y servicios, monedas permitidas, limite de opciones y flujos cubiertos (carrito, interno, manual). Cada opcion necesita identidad estable y subtotal/snapshot propios, documento sin total global ambiguo y conversion que elija solo una opcion. Decidir semantica de `precio_venta` para comparativas segun esquema y consumidores reales; `null` o precio minimo son propuestas, no decisiones.
- [ ] Permitir seleccionar varios hoteles para una cotizacion y compararlos en una vista clara, preservando precios, condiciones, vigencias y disponibilidad propios de cada opcion. Auditar primero el modelo de cotizacion y sus documentos.

### 36. (Futura) Politica de cambios de fechas y horarios de vuelos

- [ ] Decidir si fechas y horarios del record siguen editables en `EditarBloqueoForm` mediante `actualizarBloqueo` o si todo cambio debe pasar por `registrarCambioOperacional` con historial. Auditar el efecto en pasajeros, contratos y trazabilidad antes de cambiar el flujo. Este seguimiento no reabre el cierre visual de #1.

### 37. (Futura) Decisiones D5/D6 del traslado de pasajeros

- [ ] D5: confirmar o cambiar la regla vigente que permite mover pasajeros con datos pero sin contrato; incluir el caso de carga masiva y retenciones en plazo. No asumir que el cierre de #3 aprobo la regla de negocio.
- [ ] D6: confirmar o cambiar la seleccion automatica de la primera silla libre real por numero en modo `solo_datos`, frente a ofrecer un selector de silla. No cambiar el comportamiento sin revisar concurrencia e historial.

### 38. (Prioridad inmediata) Corregir bases y pagos de comisiones B2B

- [x] Aclaracion del dueno (2026-10-04): las comisiones anteriores ya quedaron cuadradas contrato por contrato mediante un porcentaje equivalente calculado manualmente. Su base PVP no demuestra error de importe. Preservar porcentaje, base, comision y pagos historicos tal como estan; NO backfill ni recalculo masivo.
- [ ] Corregir hacia adelante la creacion de comisiones B2B: base `max(0, PVP - impuesto)` en contrato manual y alta desde la pestaña, leyendo PVP e impuesto autoritativos en servidor. Probar base positiva y cero, sin alterar valores historicos. El informe de alcance propuesto no debe etiquetar comisiones antiguas como pagadas de mas aplicando retrospectivamente el porcentaje guardado.
- [ ] Evitar que cambiar `baseComisionable || pvp` o `baseComisB2B || precioVenta` modifique el calculo de filas antiguas donde 0 pudo significar 'sin dato'. Distinguir semantica nueva de historica de manera verificable antes de cambiar el fallback global.
- [ ] Auditar y corregir el flujo NETO para nuevas operaciones: estado derivado de pagos, cuenta de cobro y Rentabilidad no deben proponer pagar dos veces una comision ya descontada. No presumir que ocurrieron pagos duplicados historicos sin evidencia. Revisar tambien discrepancia entre `ventas.comision_b2b` y `aliados_b2b`, impuesto omitido en otros flujos, permisos de edicion y tipo de aliado.
- [ ] Definir la fuente unica de comision y la regla ante edicion posterior de PVP/impuesto o base manual. Separar comision B2B de la del asesor interno y de la del proveedor. Sin SQL remoto, cambios de datos, staging, commit ni merge implicitos por esta anotacion.

### 39. (Despues de #14) Editar servicios de una cotizacion

- [~] Auditoria de solo lectura recibida el 2026-10-05 sobre `origin/main` `e6aa9fec`: `tarifario` guarda servicios en `payload.servicios`, `carrito` en `payload.tours` y `detalle.items`, y `manual` en `cotizacion_servicios`. La vista publica lee `detalle`; editar solo `payload` dejaria precio/documento incoherentes. El alcance propuesto de v1 solo para tours opcionales del carrito NO reemplaza la peticion de editar servicios cotizados en los otros flujos; decidir si se entrega por fases.
- [ ] Antes de implementar: integrar #14/tarjetas y su `hotelRef`; comprobar con consulta de solo lectura como estan enlazadas las lineas de tours en cotizaciones antiguas antes de usar su posicion como identificador. Definir una referencia estable para las nuevas, precio autoritativo y recomposicion de `payload`, `detalle` y total. La conversion actual no trata igual precios de hotel persona, Bernalo y tours: no prometer conservar siempre el precio hotelero cotizado sin resolver esa regla.
- [ ] Proteger edicion y conversion contra dos pestañas o solicitudes simultaneas (version esperada y transicion atomica), y conservar version anterior auditable. Validar tenant, estado, permisos, pagos/congelado y enlace publico; probar editar/quitar, casos legados, carreras y conversion completa. El `trg_auditoria` existente no sustituye una version de negocio.
- [ ] Permitir modificar o quitar servicios ya cotizados y recalcular el total y el documento sin perder la trazabilidad de lo que cambio. Hoy los servicios cotizados no se pueden editar. Revisar estados y permisos antes de permitir cambios sobre cotizaciones ya convertidas en contrato.

### 40. (Despues de #39 y #32) Cliente por documento y vencimiento de cotizacion

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
- [ ] Disenar registro central de personas por tenant y documento/tipo segun #32, con vinculo idempotente a cada cotizacion/rol (titular o pasajero) y procedencia verificable. Cuando el formulario solo tenga cantidad de viajeros, NO inventar personas; registrarlas cuando se capturen sus datos, incluso si la cotizacion sigue abierta. Una correccion de titular/pasajero debe actualizar el vinculo sin mezclar identidades ni duplicar. Coordinar el esquema con #351 antes de integrarlo; no asumir que `crm_leads` o `crm_contactos` ya resuelven este caso.
- [ ] Mantener la consulta operativa del CRM separada del consentimiento de campanas: registrar una persona no implica `acepta_publicidad`. Respetar tenant y permisos de B2B/internos; no copiar datos sensibles a una tabla legible por todos los autenticados. La escritura debe ser confiable: transaccion o mecanismo durable/reintentable, errores visibles y pruebas de reintento, concurrencia, edicion y conversion; no un `insert` opcional que silencie el fallo.
- [ ] Inventariar en solo lectura cotizaciones historicas con personas identificables ausentes del CRM. Preparar reconciliacion idempotente con preflight, conteos, duplicados ambiguos y rollback; NO ejecutar backfill ni SQL remoto sin autorizacion separada. Probar titular y pasajeros de todos los flujos, cotizacion sin pasajeros identificados, mismo documento con distinto tipo/tenant y ausencia de consentimiento.

## Cerrado recientemente

- [x] PR #335 (squash `8539732c`, 2026-09-30): Destinos, fusion sin hoteles y `eliminarDestino` sin exitos falsos. El modal (`EliminarDestinoBtn`) ofrece acciones segun el contenido VERIFICADO (`modoEliminacion`): con contenido, fusionar (`fn_fusionar_destino`); verificado sin contenido, borrado directo; no verificado, solo fusion y "Reintentar verificacion"; rol sin permiso, sin acciones. `eliminarDestino` comprueba el permiso antes de actuar, rechaza un origen inexistente, exige exactamente una fila borrada y confirma tras la fusion que el origen ya no existe; cierra el hallazgo de un rol sin permiso que recibia exito al eliminar. Migracion 112 sin cambios. Validaciones residuales en el pendiente #12.
- [x] PR #334 (squash `81e19cbe`, 2026-09-30): integra la rama `ronda1-destinos-y-pruebas` (arbol identico a su punta `66a3eca5`). Conteo de receptivos por destino (carga paginada que falla cerrado, solo roles que leen `servicios_adicionales`), tarjetas compactas con dialogos de hoteles/receptivos, precarga limitada de receptivos, modal de eliminacion explicativo (10 tablas con FK a `destinos`) y linea base de pruebas en verde (28 fallos corregidos sin defectos de producto). Verificado en `main` (`8539732c`) el 2026-09-30: `test:unit` 4.964/4.964 y `test:react` 197/197.
- [x] PR #333 (squash `92b3c51e`, 2026-09-29): cierre de la separacion de datos sensibles de proveedores (migracion 191: `guardar_proveedor` escribe en `proveedores` y `proveedores_datos_sensibles`, paridad verificada, retira triggers y las 8 columnas legacy sin CASCADE, lectura del catalogo base solo para personal interno activo, revoca TRUNCATE). Voucher solo con `voucher_contacto`. `completarProveedores` autoriza antes de usar service-role; `asegurarCuentasPorPagar` y `liberarVencidas` pasan a `lib/` (server-only). El commit indica la 191 preparada y no aplicada al momento del merge; el usuario reporta despues que ya esta aplicada. La validacion con un proveedor nuevo sigue pendiente (#5).
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
- [x] PR #322 (squash `73339a1f`, 2026-09-21): ordena y filtra el resto del inventario hotelero. Dentro de cada bloque por paquete, el resto no recomendado se ordena de forma determinista: precio valido ascendente (nulo/no finito/<=0 siempre al final, en cualquier sentido de orden) -> estrellas descendente (sin clasificar al final) -> zona normalizada -> nombre (locale es) -> `hotelId` de desempate; los recomendados nunca se reordenan por este motor, solo el resto, y conservan su prioridad/bloque y aparecen primero. Identidad autoritativa siempre `(hotelId, paqueteId)`, nunca `hotelId` a secas. Selector "Ordenar por" (precio/estrellas/nombre, asc/desc) y panel de filtros: precio (via orden), estrellas (incluye "Sin clasificar"), zona, Pet Friendly, Adults Only, condiciones de pago (Con/Sin) y politica comercial (Flexible/No reembolsable); todos los filtros aplican tanto a recomendados como a resto sin promover una prioridad inferior al excluir una superior (una prioridad 1 que no cumple un filtro no asciende la 3 a su lugar). Zonas/estrellas disponibles en el selector se derivan exclusivamente del universo de ofertas candidatas ya acotado al destino/busqueda activa (recomendados + resto); el estado global sin destino puede mostrar la union completa; nunca una lista global inventada cuando hay destino activo. Condicion de pago/politica comercial se resuelven con combinacion ternaria (positivo/neutro-conocido/desconocido): una evidencia positiva en cualquier lado gana, y un lado neutro nunca convierte un lado desconocido en "flexible"/"sin condicion". En busqueda por destino, condicion/politica usan las fechas EXACTAS buscadas (`BusquedaResultado.condicion`) combinadas con la restriccion propia del paquete; exploracion conserva el calculo de rango generico. La lectura de `hotel_temporadas` para esa condicion se pagina por completo con `ejecutarConsultaPaginada` (mismo patron que el PR #320). Correccion de regresion en Preview: `armado_hoteles` tiene RLS de solo lectura interna, asi que la consulta de prioridades para el tarifario publico debe usar `admin` (service-role) en vez de `sb` (cliente de la request) — con `sb`, un visitante anonimo recibia siempre 0 filas sin error y ningun recomendado aparecia, ni en global ni en busqueda por destino, porque ambos modos parten del mismo mapa combinado; ver `DECISIONS.md` ADL-023. Diagnostico de datos, no defecto (ver `DECISIONS.md` ADL-024 y la nota en el pendiente #18 de este archivo): hotel 217 "Odair Dubai prueba" pertenece a SAN ANDRES pero `hoteles.zona` = "Bocagrande"; el filtro reflejo correctamente el dato almacenado y no se modifico la base. Preview validado por el usuario en estado global y en busqueda por destino. Sin migraciones ni regeneracion de tarifarios. El pendiente "Ordenar el resto del inventario hotelero" queda cerrado; el objetivo activo pasa a ser el rediseno integral de la interfaz (ver `CURRENT_GOAL.md`).
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
