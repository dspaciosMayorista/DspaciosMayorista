# Revisión consolidada local — guía del dueño

Generada automáticamente a partir de los pasos que se ensayaron. Todo es **sintético y local**: ninguna persona, proveedor, banco ni correo real participa y **nada sale de este equipo**. Build de la aplicación: `nlM_PWhr2xm4wxi_tCJHS`.

**Ensayo previo (copia desechable, no tu base):** Ensayo completo sobre una copia nueva con el build nlM_PWhr2xm4wxi_tCJHS: 117 pasos, 1617 de 1617 comprobaciones correctas (27/11/2026).

## 1. Antes de empezar

| Qué | Dónde |
|---|---|
| Aplicación | http://localhost:3090/login — usa siempre `localhost` (no `127.0.0.1`); solo este equipo puede abrirla |
| Correo de pruebas (lo que la aplicación «enviaría»; no sale nada) | http://127.0.0.1:55413 |
| Cuentas (todas con la misma contraseña) | `C:\Users\Usuario\AppData\Local\dspacios-local-revision-consolidada\credenciales.txt` — correos `<alias>@consolidada.test` |
| Navegador con las cuentas guardadas | `node supabase\scripts\revision_consolidada\revision.mjs navegador` (abre Edge con un perfil propio; en el campo de correo se elige la cuenta de la lista) |
| Iniciar / detener | `node supabase\scripts\revision_consolidada\revision.mjs iniciar` · `… detener` (desde la carpeta `dspacios-travel` de la composición). **Detener no borra nada**: base, archivos, cuentas y avance se conservan. Pídeselo al ejecutor si prefieres. |
| Volver al estado inicial | `… restaurar --confirmar` — acción **separada y explícita** que DESCARTA tu avance. Nunca ocurre al iniciar o detener. |

Cuentas: **superadmin**, **gerencia**, **administracion**, **operaciones**, **venta** (asesor de ciertos contratos), **venta2**, **controlvuelo**, **aliado** (agencia, ficha «Agencia Aliada Revision», portal `/portal/b2b`), **freelance**, **minorista** y **inactivo** (desactivada, para comprobar el acceso denegado).

## 2. Qué NO está implementado (no lo busques)

- **Pagos a referidos**: no existe el registro del pago, ni retención, ni documento, ni contabilidad/margen, ni política de pago en USD. La «elegibilidad» de una participación **no es un pago**.
- **Buzón real de Hostinger y entrega real de correo** (#103): aquí el correo solo se captura localmente y la respuesta del proveedor es simulada.
- **Costos y consumo en la nube (Vercel/Supabase)**: no se miden; solo hay evidencia local.
- **Hallazgo preexistente, ya medido (paso INT-04; no lo introduce esta revisión):** con gerencia, administración u operaciones el selector «Asesor interno» de «Nuevo contrato (manual)» y de «Nueva cotización» sale vacío (la regla de acceso a `usuarios` solo deja ver el propio perfil); con venta aparece solo ella, y venta no lee el catálogo de servicios ni las tarifas por categoría. Por eso los pasos de creación con catálogo (B95-13 al B95-16 y B95-20) se recorren con la cuenta **superadmin** (la tuya), y los recorridos reales de personal (B2-04b, B2-12, NETO-03…) usan **venta**. No hace falta que lo verifiques en producción; queda como decisión de producto.
- **Archivos de los soportes sembrados (#339): NO se abren.** Los soportes que ya vienen cargados en DTM-8302 al DTM-8306 (`s1.pdf`, `a.pdf`, `pago-1.pdf`, `p1.pdf`…) son solo FILAS de prueba para comprobar cupos, historial y avisos; no tienen archivo detrás y «Abrir» sobre ellos no entregaría nada. Pulsa «Abrir» únicamente en los soportes que subas tú en la revisión (por ejemplo `comprobante-8301.pdf`, paso S339-05), que sí son archivos reales.
- **Corrección histórica de datos reales** (clientes, aliados duplicados, costos de bloqueos anteriores): no se hace; los diagnósticos son de solo lectura y los corre el ejecutor si los pides.

## 3. Ya aceptado antes — no se repite

**Segunda ronda (correcciones de tus dos revisiones):** esta guía conserva los pasos que aceptaste (no se repiten salvo que se indique) y reemplaza los que pediste corregir o explicar. La matriz completa paso por paso (aceptado / aceptado con corrección / rechazado / explicación / verificación diferida a Producción) está en `docs/tecnico/rev2-matriz-aceptacion-2026-11-26.md`. Lo que NO se prueba aquí y sigue pendiente en Producción: el registro público con código por correo real (B2-05), los pasos H103-05 a H103-10 y el buzón real de Hostinger.

Las cuatro correcciones finales aceptadas (origen directo/asistido, pasajeros compactos, «Agregar pasajero» visible y tarifa de niño), la recuperación de contraseña de una cuenta existente, el cierre general en bloqueos y las comprobaciones locales previas registradas en la cola de pendientes. El registro con código por correo y la recuperación desde un registro interrumpido quedaron diferidos a Producción por decisión del dueño (el registro con código del bloque CRM sí se prueba aquí con el correo de pruebas).

## 4. Bloque 3 — Presencia reciente (#11), alertas de fin de compra en la zona «Alertas» (#13) y estado de publicación (#36)

### B3-01 — Presencia reciente: recuadro compacto y ventana con pestañas, búsqueda y páginas

- **Cuenta:** superadmin@consolidada.test
- **Enlace:** http://localhost:3090/dashboard
- **Qué hacer:** 1) Entra al tablero y baja hasta «Presencia reciente»: es una sola línea con conteos y el botón «Ver presencia». 2) Pulsa «Ver presencia». 3) En «Personal interno» mira «1–20 de N» y pulsa «Siguiente» (pasa a «21–40 de N»). 4) Pulsa la pestaña «Aliados B2B». 5) Escribe «Aliado Rev2 5» en la búsqueda (todavía no cambia nada) y pulsa «Buscar». 6) Vuelve a «Personal interno», borra el texto, busca «Rev Superadmin» y pulsa «Buscar». 7) Cierra con Escape.
- **Qué debe verse:** La tarjeta del tablero no lista personas (solo «En los últimos 10 min: N del personal · N aliados · N sin observación todavía» y el botón). La ventana muestra como mucho 20 personas por página con «Página 1 de …», «Personal interno (N)» con N ≥ 45 y «Aliados B2B (N)» con N ≥ 25. Teclear no consulta nada; «Buscar» sí: «Aliado Rev2 5» deja exactamente 10 aliados («Aliado Rev2 50» … «Aliado Rev2 59»). Con la búsqueda anterior aún escrita, «Personal interno» dice «Ninguna persona coincide con la búsqueda». «Rev Superadmin» (tú) figura con «Actividad observada en los últimos 10 min». Cada persona muestra su última observación con fecha y hora de Bogotá o «Sin actividad observada todavía»; el pie dice que es la última actividad observada y no una conexión continua; no aparece «en línea» ni «conectado» ni la cuenta desactivada. En el celular la ventana cabe en la pantalla. Quieto, sin teclear, no hay más consultas.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B3-02 — Alertas de fin de compra en el área de ALERTAS del tablero (ya no en la campana)

- **Cuenta:** gerencia@consolidada.test
- **Enlace:** http://localhost:3090/dashboard
- **Qué hacer:** Con la sesión de gerencia, abre el tablero y mira el área «Alertas». Después pulsa la campana de arriba a la derecha.
- **Qué debe verse:** Junto a «Cupos críticos» y «Pagos por vencer (15d)» hay un chip rojo «Vigencias de compra por terminar» con un número (el día de la siembra eran 9: 6 de paquetes y vuelos, 2 de hoteles, 1 de servicio; el número exacto depende de la fecha de hoy, porque una vigencia que ya venció deja de contarse — el ensayo lo calcula con las fechas de la semilla) y debajo la lista «Vigencias de compra por terminar (N)». Cada fila dice «Compra por vencer · <tipo>: <nombre> · Vence hoy / mañana / en N días (dd/mm/aaaa)» y trae el botón «Revisado». La campana NO tiene ningún aviso «Compra por vencer» (puede tener otros avisos). No se envió ningún correo.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B3-02b — «Revisado» saca la alerta de tu vista, solo de la tuya, y no vuelve

- **Cuenta:** gerencia@consolidada.test
- **Enlace:** http://localhost:3090/dashboard
- **Qué hacer:** Con gerencia, en la lista de alertas, pulsa «Revisado» en la alerta «paquete dinámico total: Paquete dinámico total — Punta Cana…». Recarga el tablero. Después entra con la cuenta de operaciones y mira la misma lista.
- **Qué debe verse:** Esa alerta desaparece al instante y el número baja en 1; tras recargar sigue sin aparecer (aunque corra la revisión diaria que crea avisos). Las demás alertas siguen. Con operaciones la alerta del paquete dinámico total SIGUE ahí: la revisión es de cada persona. En la campana no cambia nada (no era un aviso leído).
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B3-02c — Si cambia la fecha de fin de la vigencia, aparece una alerta NUEVA aunque la anterior estuviera revisada

- **Cuenta:** gerencia@consolidada.test
- **Enlace:** http://localhost:3090/dashboard
- **Qué hacer:** Con superadmin, en Paquetes totales, cambia la fecha límite de compra del «Paquete dinámico total — Punta Cana…» a un día después y guarda. Pide al coordinador que corra la revisión diaria de avisos (en esta revisión no corre sola). Con gerencia, recarga el tablero.
- **Qué debe verse:** La alerta anterior (la que revisaste) ya no existe y aparece una alerta nueva del mismo paquete dinámico total con «Vence en 2 días», SIN revisar, con su botón «Revisado». El número de alertas vuelve a ser el de antes de revisar.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B3-03 — Cada alerta abre el objeto que posee la vigencia: empaquetado y paquete

- **Cuenta:** gerencia@consolidada.test
- **Enlace:** http://localhost:3090/dashboard
- **Qué hacer:** Con gerencia, en la lista de alertas pulsa la de «empaquetado: MDE - CTG - MDE …»; vuelve y pulsa la de «paquete: Cartagena 4 noches…».
- **Qué debe verse:** La de empaquetado abre la pantalla de ese empaquetado (/dashboard/vuelos/empaquetados/…). La de paquete abre ESE paquete en su pestaña de Configuración (/dashboard/paquetes/…?tab=config), porque su fecha de compra es del paquete. Ninguna de hotel o servicio abre un paquete.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B3-03b — Alerta de vigencia de HOTEL: abre ese hotel y esa vigencia (aunque dos hoteles se llamen igual)

- **Cuenta:** gerencia@consolidada.test
- **Enlace:** http://localhost:3090/dashboard
- **Qué hacer:** Con gerencia, en la lista de alertas hay DOS con el texto «vigencia de hotel: Hotel Caribe Plaza · ALTA DICIEMBRE REV2». Pulsa la primera, mira la pantalla y vuelve; pulsa la segunda.
- **Qué debe verse:** Cada una abre un hotel distinto (dos hoteles llamados «Hotel Caribe Plaza», uno es el de la semilla de paquetes y otro el de esta revisión), en la pestaña «Temporadas», con la vigencia «ALTA DICIEMBRE REV2» resaltada en amarillo y a la vista. Ninguna abre un paquete.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B3-03c — Alerta de vigencia de SERVICIO: abre ese servicio y esa temporada

- **Cuenta:** gerencia@consolidada.test
- **Enlace:** http://localhost:3090/dashboard
- **Qué hacer:** Con gerencia, en la lista de alertas pulsa la de «vigencia de servicio: Tour Islas del Rosario REV2 · NAVIDAD REV2».
- **Qué debe verse:** Se abre Producto → Servicios con «Tour Islas del Rosario REV2» ya en edición y su temporada «NAVIDAD REV2» resaltada en amarillo y a la vista. No se abre un paquete.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B3-04 — Sin campana general en el CRM (el lugar queda para notificaciones del CRM)

- **Cuenta:** gerencia@consolidada.test
- **Enlace:** http://localhost:3090/crm
- **Qué hacer:** Abre el CRM y mira la barra superior; recorre el menú.
- **Qué debe verse:** No hay campana junto a «← PORTAL». El menú del CRM sigue completo (incluye «Referidos» y «Clientes de aliados») y «← PORTAL» funciona.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B3-05 — Quien no escribe paquetes no recibe estas alertas

- **Cuenta:** venta@consolidada.test
- **Enlace:** http://localhost:3090/dashboard
- **Qué hacer:** Con la cuenta de venta, abre el tablero y mira «Alertas»; luego abre la campana.
- **Qué debe verse:** Ni el chip ni la lista «Vigencias de compra por terminar» (la campana puede tener otros avisos, nunca de compra por vencer).
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B3-06 — Listado de Paquetes: estado real de publicación y vigencias por vencer

- **Cuenta:** operaciones@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/paquetes?tipo=porcion_terrestre
- **Qué hacer:** Abre el listado de Paquetes (pestaña Porción terrestre) y recórrelo.
- **Qué debe verse:** Cada paquete muestra su estado real junto a Activo/Inactivo: «Tarifas publicadas», «Pendiente de generar», «Error de generación», «Cotización por unidad», «Bajo solicitud», «Publicado, no visible» (inactivo). Arriba, un panel «N vigencias de compra terminan en los próximos 5 días» (N depende del día: el ensayo lo calcula con las fechas de la semilla) con enlaces a donde se corrige cada fecha.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

## 5. Bloque 1 — Vuelos y vouchers (#17, #18, #26, #29, #37, #40)

### B1-01 — Historial de movimientos de un record de vuelo

- **Cuenta:** controlvuelo@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/vuelos/9501
- **Qué hacer:** 1) Abre el record AAA111 (enlace de la ruta). 2) Pulsa la pestaña «Cambios» y baja hasta «Movimientos históricos»: verás 5 movimientos en filas cerradas y «Ver 3 movimientos anteriores». 3) Pulsa «Ver 3 movimientos anteriores», luego pulsa una fila para abrirla y abre uno o más «Detalle por silla». 4) Abre luego el record BBB222 (/dashboard/vuelos/9502), pestaña «Cambios». 5) Repite en el celular y a ancho intermedio.
- **Qué debe verse:** AAA111 muestra 8 movimientos (5 a la vista y 3 tras «Ver 3 movimientos anteriores»; cada fila cerrada dice qué pasó y cuándo, y se abre para ver el detalle), del más reciente al más antiguo, con fecha y hora de Bogotá «dd/mm/aaaa hh:mm (hora de Bogotá)»: el retiro del 23/11/2026 23:30 se rotula «Retiro de cupo» con record destino «No aplica» y su motivo (que nombra BBB222) aparece solo como «Motivo (texto libre)», sin lenguaje de traslado. El traslado del 05/10/2026 10:00 dice «Salieron 3 cupo(s) libre(s) hacia BBB222», cupos origen 12 → 9, sillas de origen #10, #11, #12. El pasajero movido del 02/11/2026 15:15 entra desde BBB222 con el contrato CM-0451. Los dos movimientos anteriores (01 y 02/01/2026) se rotulan «Movimiento anterior (tipo no guardado)» y «Cambio entre records (registro anterior)» y dicen «No guardado» en lo que falta, sin deducir nada del motivo. Los límites del día de Bogotá se ven bien (22/11 23:59, 23/11 00:00, 31/12/2025 23:59). «Detalle por silla» lista «Silla #10 → #7» y siguientes. Desde BBB222 el mismo traslado se lee «Entraron 3 cupo(s) libre(s) desde AAA111». En celular y ancho intermedio nada se sale de la tarjeta ni de la pantalla.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B1-02 — El asesor de ventas no entra al módulo de vuelos ni al editor

- **Cuenta:** venta@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/contratos/DTM-9705
- **Qué hacer:** Con la cuenta de venta (dueña de DTM-9705): 1) Abre el contrato DTM-9705 y busca un enlace para registrar o editar el vuelo. 2) Intenta abrir /dashboard/vuelos/contrato/DTM-9705. 3) Intenta abrir el record /dashboard/vuelos/9501.
- **Qué debe verse:** El contrato DTM-9705 se ve, pero NO ofrece el enlace «Registrar o editar vuelo y record →». El editor de vuelos responde «Tu rol no tiene acceso al editor operativo de vuelos del contrato.» (o te devuelve fuera del módulo) y el record 9501 no muestra «Movimientos históricos» ni ningún movimiento.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B1-03 — Listado de vuelos empaquetados y enlace al editor de vuelos del contrato

- **Cuenta:** administracion@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/vuelos?vista=empaquetados
- **Qué hacer:** 1) Abre Vuelos, pestaña «EMPAQUETADOS». 2) Busca los contratos DTM-9701, DTM-9702, DTM-9703 y DTM-9705 (origen «Contrato») y DTM-9704. 3) Abre el contrato DTM-9704 y busca el enlace del vuelo. 4) Abre el contrato DTM-9701, pulsa «Registrar o editar vuelo y record →».
- **Qué debe verse:** El listado incluye los contratos con vuelo (DTM-9701, DTM-9702, DTM-9703, DTM-9705) con su lápiz «Editar vuelo»; DTM-9704, que es solo porción terrestre, NO aparece. En la ficha de DTM-9704 no hay enlace al editor. En la ficha de DTM-9701 el enlace «Registrar o editar vuelo y record →» abre /dashboard/vuelos/contrato/DTM-9701 con el título «DTM-9701», «Vuelo del contrato» y las tarjetas de tramo.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B1-04 — Destinos: uno usado solo como alternativo se fusiona, uno sin uso se borra directo

- **Cuenta:** superadmin@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/producto/destinos
- **Qué hacer:** 1) Busca «B1 ALTERNATIVO» y pulsa la X de su tarjeta. 2) Lee el aviso del cuadro «Eliminar destino». 3) Sin elegir destino, pulsa «Mover y eliminar». 4) Pulsa «Cancelar». 5) Busca «B1 SIN USO», pulsa su X, lee el cuadro y pulsa «Cancelar» (no lo elimines).
- **Qué debe verse:** B1 ALTERNATIVO lista «1 destino aéreo alternativo de un paquete» y exige mover su contenido: ofrece un selector «Busca el destino de llegada…» y el botón «Mover y eliminar»; sin destino elegido responde «Tiene contenido asociado: elige a qué destino moverlo.» y no borra nada. B1 SIN USO dice «No tiene contenido asociado; se eliminará directamente.» y ofrece el botón «Eliminar». Al cancelar ambos destinos siguen existiendo.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B1-05 — Voucher aéreo por servicio contratado: PNR distintos juntos, servicios separados

- **Cuenta:** administracion@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/contratos/DTM-9803
- **Qué hacer:** 1) En el contrato DTM-9803 (3 pasajeros, dos servicios aéreos) pulsa «Voucher de vuelo». 2) Abre «Ver / imprimir →» de cada tarjeta. 3) Repite en DTM-9805 (dos servicios que comparten el mismo PNR SAME00) y en DTM-9703 (cuatro tramos, nombres muy largos).
- **Qué debe verse:** DTM-9803 muestra dos tarjetas «Vuelo», cada una con su propia ruta y enlace distinto (nunca uno por pasajero). El servicio 1 trae sus dos tramos (AV301 y AV302) con sus PNR distintos, AAA111 y ZZZ999, juntos en el mismo documento; el servicio 2 trae LA401, LA402 y su PNR BBB222, sin nada del servicio 1. Los tres pasajeros (Carla, Juan y Eva Mora) figuran una sola vez y cada voucher lo aclara dos veces: el aviso «Esta reserva tiene 2 servicios aéreos. El sistema no registra qué pasajero viaja en cada vuelo…» y la nota «no hay registrada una asignación de pasajero a tramo». DTM-9805 comparte el PNR pero sigue en DOS vouchers (AV701 en uno, AV702 en el otro). DTM-9703 genera un solo voucher con sus cuatro tramos.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B1-05b — Pasajeros distintos en vuelos distintos: lo que el voucher sabe y lo que no

- **Cuenta:** administracion@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/contratos/DTM-9871
- **Qué hacer:** 1) En DTM-9871 (4 pasajeros: Ana Pérez, Luis Gómez, Marta Ríos y Pedro Soto; dos servicios aéreos: Bogotá–Cartagena AV871/AV872 y Medellín–Cartagena LA881/LA882) pulsa «Voucher de vuelo». 2) Abre «Ver / imprimir →» de cada tarjeta y baja hasta «Pasajeros de la reserva». 3) Usa la vista de impresión del navegador.
- **Qué debe verse:** Se crean DOS vouchers (uno por servicio). El del servicio Bogotá–Cartagena trae AV871 y AV872 y su PNR RV2AAA, sin nada de LA881/LA882; el del servicio Medellín–Cartagena trae LA881 y LA882 y su PNR RV2BBB. AMBOS listan a los CUATRO pasajeros, porque el sistema no guarda quién viaja en qué vuelo, y lo dicen en un recuadro ámbar visible: «Esta reserva tiene 2 servicios aéreos. El sistema no registra qué pasajero viaja en cada vuelo: la lista de pasajeros corresponde a toda la reserva, no a este vuelo en particular. No se debe entender que todos los pasajeros viajan en todos los vuelos.» más la nota «Pasajeros y tramos se listan por separado…». Ambos textos salen también al imprimir. Nadie decide por el sistema cuál pasajero va en cuál vuelo.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B1-06 — Voucher sin PNR y vista previa interna según el pago

- **Cuenta:** administracion@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/contratos/DTM-9804
- **Qué hacer:** 1) En DTM-9804 (sin PNR guardado) pulsa «Voucher de vuelo» y abre «Ver / imprimir →». 2) En DTM-9801 (100 % pagado, PNR ABC123) pulsa «Voucher de vuelo», lee la nota sobre el aliado y abre el voucher. 3) En DTM-9802 (pago parcial, PNR SECRET9802) genera el voucher, lee la nota y abre el voucher; usa la vista de impresión del navegador.
- **Qué debe verse:** DTM-9804: el voucher se genera sin problema, muestra el vuelo AV501 y NO tiene celda de PNR. DTM-9801: la ficha dice «Contrato 100 % pagado: el aliado ya puede abrir estos vouchers desde su portal.» y el voucher muestra el PNR ABC123 al personal interno. DTM-9802: la ficha dice «Vista previa interna: el aliado solo podrá abrir estos vouchers cuando el contrato esté 100 % pagado…»; el voucher NO muestra SECRET9802 (ni en pantalla ni en el código de la página), explica «se mostrará en el voucher cuando el contrato esté 100 % pagado» y esa nota no se imprime.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B1-07 — Voucher aéreo en celular e impresión (datos largos)

- **Cuenta:** administracion@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/contratos/DTM-9703
- **Qué hacer:** 1) En DTM-9703 abre «Ver / imprimir →» del voucher aéreo (nombre de cliente y aerolínea muy largos, 4 tramos). 2) Míralo a ancho de escritorio, intermedio y celular. 3) Abre la vista de impresión del navegador.
- **Qué debe verse:** Nada se sale de la pantalla en ninguno de los tres anchos: cada tramo muestra aerolínea, vuelo, fecha, origen, destino y horas dentro de su recuadro, y el texto largo se parte en varias líneas. El documento impreso cabe en 4 páginas o menos y el PNR de un contrato sin pago completo no aparece.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B1-08 — El aliado abre el voucher solo con el contrato 100 % pagado

- **Cuenta:** aliado@consolidada.test
- **Enlace:** http://localhost:3090/portal/b2b/documentos
- **Qué hacer:** 1) En «Documentos» busca los contratos DTM-9801 y DTM-9802. 2) Abre el «Voucher vuelo» de DTM-9801. 3) Intenta abrir el voucher de DTM-9802 (enlace directo que te pasa el personal). 4) Revisa que DTM-9803 y DTM-9804 no figuren.
- **Qué debe verse:** DTM-9801 (pagado) lista «Voucher vuelo» y el voucher muestra el PNR ABC123 en cada tramo y, al final de «Pasajeros de la reserva», la misma nota «no hay registrada una asignación de pasajero a tramo» que ve el personal (la nota interna «se mostrará cuando el contrato esté 100 % pagado» NO aparece: es solo para el personal). DTM-9802 (pago parcial) dice «Disponible cuando el contrato esté 100 % pagado» y su enlace directo responde página no encontrada: sin vuelos, sin pasajeros, sin PNR. DTM-9803 y DTM-9804 no tienen aliado y no aparecen. El voucher cabe en celular e impreso en 2 páginas o menos.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B1-08b — El aliado ve la misma aclaración sobre pasajeros y vuelos

- **Cuenta:** aliado@consolidada.test
- **Enlace:** http://localhost:3090/portal/b2b/documentos
- **Qué hacer:** 1) En «Documentos» busca DTM-9871 (pagado; lo generó el personal en el paso B1-05b). 2) Abre sus dos «Voucher vuelo». 3) Baja hasta «Pasajeros de la reserva».
- **Qué debe verse:** Ves los dos vouchers de DTM-9871 con su PNR (RV2AAA y RV2BBB), los cuatro pasajeros y el mismo recuadro «Esta reserva tiene 2 servicios aéreos. El sistema no registra qué pasajero viaja en cada vuelo…» y la nota «Pasajeros y tramos se listan por separado…» que ve el personal. No aparece la nota interna sobre «se mostrará cuando el contrato esté 100 % pagado».
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B1-09 — El contrato del cliente no lleva el PNR; la cotización sí muestra vuelos y horas

- **Cuenta:** sin iniciar sesión (visitante)
- **Enlace:** http://localhost:3090/cot/11111111-1111-4111-8111-111111111111
- **Qué hacer:** Sin iniciar sesión: 1) Abre la cotización pública (enlace de la ruta). 2) Abre el documento del contrato de DTM-9701 y el de DTM-9801 (enlace /c/<token> que entrega el sistema: pídelo a quien te acompaña o cópialo desde la ficha del contrato).
- **Qué debe verse:** La cotización de «Cliente Cotización» muestra los vuelos AV123 y AV124 con hora de salida y llegada (08:15 y 09:45) y un solo aviso de que los itinerarios pueden cambiar. Los documentos del contrato (DTM-9701 y DTM-9801) NO muestran número de vuelo, horas ni PNR (PNR9701, ABC123).
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B1-10 — Editar un vuelo guardado deja el voucher anterior como no vigente

- **Cuenta:** administracion@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/contratos/DTM-9806
- **Qué hacer:** 1) En DTM-9806 pulsa «Voucher de vuelo» y abre «Ver / imprimir →». 2) Pulsa «Registrar o editar vuelo y record →». 3) En el primer tramo cambia «Hora salida» de 08:15 a 09:05 y pulsa «Guardar vuelo». 4) Vuelve a abrir el voucher y mira la ficha del contrato. 5) Mira la vista de impresión del voucher.
- **Qué debe verse:** Tras guardar, el editor dice «Vuelo guardado.». El voucher abierto por el personal interno se ve con el banner rojo «Desactualizado: los vuelos del servicio cambiaron después de generar este voucher. No lo entregues; vuelve a generarlo desde el contrato.» y ese banner SÍ se imprime. La tarjeta del voucher en la ficha dice «Desactualizado: volver a generar».
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B1-11 — El aliado con el enlace anterior ve «Voucher en actualización», sin itinerario

- **Cuenta:** aliado@consolidada.test
- **Enlace:** http://localhost:3090/portal/b2b/documentos
- **Qué hacer:** Con la cuenta del aliado abre el voucher aéreo de DTM-9806 (enlace del portal o el que ya tenías).
- **Qué debe verse:** Mientras el personal no regenere el voucher, la página dice «Voucher en actualización», explica que el documento vigente se publicará en el mismo enlace y pide «Comunícate con tu asesor.». No muestra vuelos, horas, pasajeros ni PNR.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B1-12 — Regenerar conserva el enlace y actualiza el itinerario

- **Cuenta:** administracion@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/contratos/DTM-9806
- **Qué hacer:** 1) En DTM-9806 pulsa «Voucher de vuelo». 2) Abre «Ver / imprimir →». 3) Pulsa «Voucher de vuelo» una segunda vez sin cambiar nada.
- **Qué debe verse:** El mensaje dice «✓ Voucher(s) de vuelo: 0 nuevo(s), 1 actualizado(s) en el mismo enlace». El enlace es el mismo de antes y ahora muestra la hora 09:05 sin banner de desactualizado. La tarjeta pasa a «Actualizado (n)» (señal interna, no prueba que el cliente lo haya visto). La segunda pulsación responde «Voucher(s) de vuelo sin cambios (mismo contenido y mismo enlace)».
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B1-13 — Itinerario heredado (una sola fila ida y regreso): guardar sin cambios, editar SOLO la ida y regenerar

- **Cuenta:** administracion@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/contratos/DTM-9807
- **Qué hacer:** 1) En DTM-9807 (itinerario antiguo: ida LG100 y regreso LG200 en una sola fila, PNR LEGPNR1) pulsa «Voucher de vuelo» y abre el voucher. 2) Abre «Registrar o editar vuelo y record →» y, SIN cambiar nada, pulsa «Guardar vuelo»; abre el voucher anterior y la ficha. 3) En el mismo editor elige «Tramo» = «Ida», «N.° de vuelo» = LG111, «Hora salida» = 08:00, «Hora llegada» = 09:30 y pulsa «Guardar vuelo». 4) Abre el voucher anterior y la ficha. 5) Pulsa «Voucher de vuelo» otra vez y abre el voucher.
- **Qué debe verse:** Antes de editar, el voucher muestra los dos vuelos heredados (LG100 de ida y LG200 de regreso) y el PNR LEGPNR1. Guardar SIN cambios no desactualiza nada: el voucher sigue igual, sin banner, y al pulsar «Voucher de vuelo» dice «sin cambios». Al editar solo la ida, el voucher anterior queda con el banner «Desactualizado: los vuelos del servicio cambiaron…» y la ficha dice «Desactualizado: volver a generar». Al regenerar el enlace es el mismo y muestra LG111 de ida y el regreso heredado LG200 (10 de junio de 2027, 18:00–19:30) SIN que haya que volver a escribirlo, ya sin LG100 ni banner. El itinerario guardado del regreso (vuelo, fecha y horas) no se modificó.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B1-14 — Señal interna «comunicación pendiente» separada de la entrega real

- **Cuenta:** superadmin@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/gestion-contratos?numero=DTM-9803
- **Qué hacer:** 1) En Gestión de contratos filtra por DTM-9803; en «Voucher» pulsa «Registrar entrega», elige un canal y «Guardar acuse». 2) Abre «Registrar o editar vuelo y record →» de DTM-9803, cambia «Hora salida» del primer tramo de 07:00 a 07:30 y pulsa «Guardar vuelo». 3) Vuelve a Gestión de contratos. 4) En la ficha del contrato pulsa «Voucher de vuelo». 5) Vuelve a Gestión de contratos.
- **Qué debe verse:** Tras el acuse la fila dice «Entrega registrada manualmente» (acuse del personal, no prueba que el cliente lo recibiera). Después del cambio de vuelo la fila dice «Generado (2): vuelo desactualizado» y «Voucher actualizado: comunicación pendiente». Tras regenerar, la ficha marca «Actualizado (n)» en UNA sola tarjeta, y Gestión mantiene «Voucher actualizado: comunicación pendiente»: ya no presenta la entrega anterior como vigente y aclara «no indica que el cliente haya recibido, leído ni aceptado el cambio». La señal es interna: el sistema no envía nada al cliente.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B1-15 — Unir, retirar y separar servicios aéreos (el PNR no define el servicio)

- **Cuenta:** administracion@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/vuelos/contrato/DTM-9805
- **Qué hacer:** 1) En DTM-9805 (dos servicios que comparten el PNR SAME00) abre el editor. 2) En el segundo tramo cambia «Servicio aéreo contratado» a «Servicio 1» y pulsa «Guardar vuelo». 3) Mira las tarjetas de voucher en la ficha del contrato y pulsa «Voucher de vuelo». 4) Vuelve al editor y pon el segundo tramo en «Servicio nuevo A», guarda, y pulsa «Voucher de vuelo» en la ficha.
- **Qué debe verse:** Al unir: la tarjeta del servicio que ya no existe dice «Retirado (servicio ya no existe)» y la del servicio 1 «Desactualizado: volver a generar»; al regenerar, el voucher del servicio 1 conserva su enlace y trae AV701 y AV702, (el voucher del servicio inexistente ya figura como retirado: su enlace no muestra itinerario y el historial se conserva). Al separar de nuevo con «Servicio nuevo A» se crea un voucher NUEVO con enlace propio para AV702 y el del servicio 1 vuelve a traer solo AV701: la identidad del servicio es la asociación guardada, no el PNR compartido.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B1-16 — Tramo histórico sin servicio asociado: se exige asociarlo, nunca se adivina

- **Cuenta:** administracion@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/contratos/DTM-5101
- **Qué hacer:** 1) En DTM-5101 (dos servicios aéreos guardados y un tercer tramo histórico AV512 sin servicio) pulsa «Voucher de vuelo». 2) Abre «Registrar o editar vuelo y record →»: el tercer tramo muestra «— elegir servicio —». 3) En ese tramo elige «Servicio 2» y pulsa «Guardar vuelo». 4) Vuelve a la ficha y pulsa «Voucher de vuelo».
- **Qué debe verse:** El primer intento NO genera nada y avisa «Hay 1 tramo(s) del contrato sin servicio aéreo asociado. Asócialos a su servicio en el editor de vuelos del contrato y vuelve a generar. No se cambió ningún voucher.». Tras asociar el tramo a «Servicio 2» el editor dice «Vuelo guardado.» y la generación crea 2 vouchers: el del servicio 1 con AV510 y el del servicio 2 con AV511 y AV512 juntos (aunque sus PNR sean distintos).
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

## 6. Bloque 2 — CRM: referidos (#76), aviso de cotización pública (#78) e inventarios (#27, #28)

### B2-01 — Referidos: catálogo, asignaciones y contratos con su participación

- **Cuenta:** gerencia@consolidada.test
- **Enlace:** http://localhost:3090/crm/referidos
- **Qué hacer:** Con la cuenta de gerencia (superadmin ve lo mismo) abre CRM → Referidos y recorre la pantalla de arriba abajo. Revisa «Referidores y códigos», «Asignaciones vigentes» y la tabla «Contratos con participación de referido» (en el celular son fichas).
- **Qué debe verse:** El referidor «Odair Referidor» con sus códigos «ODAIR-1 · 1 %» y «ODAIR-2 · 2 %»; asignaciones vigentes: «Agencia Humo Uno» al 1 % y «Freelance Humo Dos» al 2 %. En los contratos, cada participación = porcentaje × la base comisionable que el aliado ya tiene guardada: DTM-7001 8.000 (1 % de 800.000, «Pagable»); DTM-7002 60.000 (2 % de 3.000.000, «Pendiente de pago del contrato» porque está pagado a medias); DTM-7003 USD $25 (1 % de USD $2,500, «Pagable»); DTM-6101 ordinaria 52.000 y DTM-6102 NETO 52.000 (2 % de la MISMA base de 2.600.000, «Pagable»: en el NETO se usa la base original, no lo que pagó el cliente); DTM-7004 NETO 20.000 (2 % de 1.000.000 original); DTM-7005 «Contrato cancelado» en $ 0; DTM-7006 sin comisión del aliado guardada: «Sin evidencia» y «Falta la base de la comisión del aliado», NUNCA un cero inventado. Los totales salen separados por moneda (COP y USD). ELEGIBLE NO ES PAGADO: «Pagable» solo dice que el contrato está 100 % pagado; la pantalla aclara que no se paga automáticamente. NO IMPLEMENTADO: registrar el pago al referidor, retención o documento de pago, asiento contable/margen de referidos y la política de pago en USD; tampoco hay pantalla para los inventarios #27/#28 (son scripts SQL de solo lectura).
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B2-02 — Administración consulta los referidos pero no puede asignar ni cambiar

- **Cuenta:** administracion@consolidada.test
- **Enlace:** http://localhost:3090/crm/referidos
- **Qué hacer:** Con la cuenta de administración abre CRM → Referidos. Busca formularios, botones de asignar o terminar asignación, y mira la sección «Códigos de registro por confirmar».
- **Qué debe verse:** Ve los mismos contratos, asignaciones y códigos (consulta), pero NO hay formularios ni botones «Asignar», «Terminar asignación», «Guardar» ni «Aplicar código». Aparece «Tu rol puede consultar los referidos. Solo superadmin y gerencia pueden asignarlos o cambiarlos.» En «Códigos de registro por confirmar» ve los candidatos con la nota «Administración puede ver esta información, pero no asignar ni cambiar referidores ni porcentajes», sin opciones de decisión ni «Aplicar decisión».
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B2-03 — Venta, operaciones y aliados no ven los referidos

- **Cuenta:** venta@consolidada.test
- **Enlace:** http://localhost:3090/crm/referidos
- **Qué hacer:** Con la cuenta de venta abre la dirección /crm/referidos. Repite con operaciones y con la agencia aliada.
- **Qué debe verse:** En los tres casos aparece «Módulo no disponible para tu usuario» (o el sistema te devuelve a tu portal) y no se ve ningún dato: ni «Odair Referidor» ni contratos DTM-70… ni formularios.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B2-04 — Asignar y cambiar el referido de un aliado: solo 1 % o 2 %, solo hacia adelante

- **Cuenta:** gerencia@consolidada.test
- **Enlace:** http://localhost:3090/crm/referidos
- **Qué hacer:** En «Asignar un aliado a un referidor» elige «Agencia Humo Tres · agencia», «Odair Referidor · mayorista», porcentaje «2 %» y pulsa «Asignar». Luego cambia a «Agencia Humo Uno» (hoy 1 %) al «2 %» y pulsa «Asignar» otra vez. En «Asignar por código de referido» escribe «odair-1» para «Aliado Codigo Manual» y pulsa «Aplicar código»; repite con el código inexistente «noexiste» para «Agencia Humo Tres». Por último pulsa «Terminar asignación» en la tarjeta de «Agencia Humo Tres».
- **Qué debe verse:** «Asignación creada: rige para compras futuras.»; al cambiar Humo Uno: «Asignación cambiada: rige para compras futuras; el historial se conserva.»; el código válido: «Asignación creada por el código.» (1 %, tomado de la regla del código); el inválido: «El código de referido no es válido.» sin cambiar nada; terminar: «Asignación terminada: las compras futuras ya no generan participación.» Los selectores de porcentaje solo ofrecen «1 %» y «2 %» (no hay campo libre). Los contratos anteriores NO cambian (DTM-7001 sigue al 1 % y 8.000). El historial queda en «Historial de asignaciones». (La compra posterior al cambio se prueba en el paso siguiente con un contrato REAL.)
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B2-04b — Una compra REAL posterior al cambio: el contrato nuevo nace al 2 % y los anteriores no cambian

- **Cuenta:** venta@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/contratos/nuevo
- **Qué hacer:** Con la cuenta de venta (la que puede elegir asesor: ella misma) abre «Nuevo contrato (manual)»: Tipo «Dinámico (todo manual)», Asesor «Rev Venta», Tipo de venta «Agencia (B2B)», Agencia «Agencia Humo Uno» (modo PVP), Nombres «Cliente», Apellidos «Referido Real». En el ítem escribe «Paquete referido», 1 adulto y tarifa adulto 1000000, deja el valor de los tiquetes en 0 y pulsa «Generar contrato». Cuando abra la ficha del contrato, anota su número. Luego, con la cuenta de gerencia, abre ese contrato en la pestaña Cartera, registra un abono de 400.000 por «Transferencia» («Registrar abono») y abre /crm/referidos para buscar ese número.
- **Qué debe verse:** El contrato se crea con el formulario normal (no con una instrucción de base). En /crm/referidos, ya como gerencia, aparece el contrato nuevo de Agencia Humo Uno con «Odair Referidor», «2 %» y participación «20.000» (2 % de la base comisionable de 1.000.000), mientras DTM-7001 sigue en «1 %» y «8.000». Antes del abono el contrato está pendiente y todavía NO tiene comisión del aliado (en /crm/referidos aparecería «Sin evidencia»); al registrar el abono se confirma, se crea la comisión (base 1.000.000) y el contrato queda «Pendiente de pago del contrato» (pagado solo en parte).
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B2-05 — Registro público de una agencia con código de referido (verificación real por correo)

- **Cuenta:** sin iniciar sesión (visitante)
- **Enlace:** http://localhost:3090/portal/registro
- **Qué hacer:** Sin iniciar sesión abre /portal/registro. Llena: Nombre «Agencia Registro Revision», Número de documento «99100», Correo «registro.referido@consolidada.test», Contraseña y Repetir contraseña «Registro2026!». En «Código de referido (opcional)» escribe primero «a b» y pulsa «Continuar: enviar código al correo»; corrige a « odair-2 » (con espacios y minúsculas) y pulsa de nuevo. El código de 6 dígitos llega al correo de pruebas (http://127.0.0.1:55413); escríbelo en «Código de verificación» y pulsa «Verificar y enviar solicitud».
- **Qué debe verse:** Con «a b» aparece «El código de referido usa de 4 a 20 letras, números o guiones» ANTES de crear la cuenta. Con el código bueno se pide el código del correo; tras verificarlo aparece «¡Solicitud enviada!». El campo dice «Lo revisamos al aprobar tu registro; no cambia tu comisión»: el código queda solo como CANDIDATO (queda como «Por confirmar»), no se asigna ningún referidor al aliado todavía.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B2-06 — Administración aprueba un registro pero no confirma el referido

- **Cuenta:** administracion@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/usuarios/b2b
- **Qué hacer:** En Usuarios → Aprobaciones B2B busca la solicitud «Freelance Aprueba Admin» (código ODAIR-1). Mira qué controles hay en la parte del código de referido, elige «+ Crear ficha nueva en el catálogo con estos datos» y pulsa «Aprobar».
- **Qué debe verse:** La tarjeta muestra «Código de referido escrito en el registro: ODAIR-1» con «Por confirmar» y la nota «Solo superadmin o gerencia confirman el referido y el porcentaje», SIN opciones de decisión ni campo para editar el código. El registro queda aprobado, pero el código sigue como candidato y el aliado nuevo NO recibe referidor (lo decide después gerencia o superadmin en CRM → Referidos).
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B2-07 — Gerencia aprueba el registro y confirma el referido en un solo paso

- **Cuenta:** gerencia@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/usuarios/b2b
- **Qué hacer:** En Usuarios → Aprobaciones B2B abre la solicitud de «Agencia Registro Revision» (la del paso de registro público; si no está, usa «Solicitante Humo»). Lee la línea «Corresponde a Odair Referidor al 2 %», deja marcada la opción «Confirmar: Odair Referidor · 2 %», elige «+ Crear ficha nueva en el catálogo con estos datos» y pulsa «Aprobar».
- **Qué debe verse:** Con gerencia la tarjeta ofrece las opciones: «Confirmar: Odair Referidor · 2 %», «Asignar otro referidor o porcentaje», «No asignar (descartar el código)» y «Decidir después». Al aprobar aparece el aviso con «referido asignado para las compras futuras»; la ficha nueva queda con Odair Referidor al 2 % (origen: código ODAIR-2) y el candidato pasa a «confirmado». Solo rige para compras futuras de ese aliado.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B2-08 — Códigos por confirmar en el CRM: confirmar después de aprobar; los inválidos no inventan nada

- **Cuenta:** gerencia@consolidada.test
- **Enlace:** http://localhost:3090/crm/referidos
- **Qué hacer:** En CRM → Referidos baja a «Códigos de registro por confirmar». Revisa cada candidato. En «Freelance Ya Aprobado» deja marcada la opción «Confirmar: Odair Referidor · 1 %» y pulsa «Aplicar decisión». En «Freelance Aprueba Admin» (aprobado por administración) elige «No asignar (descartar el código)» y pulsa «Aplicar decisión».
- **Qué debe verse:** «Freelance Codigo Invalido» (NOEXISTE) dice «Ese código no corresponde hoy a un referidor activo de esta agencia. No se asignó nada.»; los registros aún pendientes dicen «Decide al aprobar el registro (Usuarios → Aprobaciones B2B) o después de aprobarlo». Solo los registros YA aprobados y enlazados a una ficha tienen «Aplicar decisión». Al confirmar «Freelance Ya Aprobado» aparece «Decisión aplicada. Rige solo para las compras futuras del aliado.» y su ficha queda con Odair Referidor al 1 %; el descartado no recibe referidor. Ningún candidato inválido o sin código genera asignación.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B2-09 — Pago parcial, pago total y anulación cambian la elegibilidad, no la atribución

- **Cuenta:** gerencia@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/contratos/DTM-7002?tab=cartera
- **Qué hacer:** Abre el contrato DTM-7002 (pestaña Cartera; está pagado 1.000.000 de 3.000.000). En «Registrar abono» pon 2.000.000, forma «Transferencia» y pulsa «Registrar abono». Abre CRM → Referidos y mira la fila de DTM-7002. Vuelve al contrato, pulsa «Anular» en el abono de 2.000.000, escribe un motivo y confirma con «Anular abono». Mira otra vez la fila en Referidos.
- **Qué debe verse:** Antes: DTM-7002 «Pendiente de pago del contrato». Con el contrato 100 % pagado pasa a «Pagable» (60.000 = 2 % de 3.000.000). Al anular el abono vuelve a «Pendiente de pago del contrato». En los tres momentos el referidor (Odair Referidor), el 2 % y los 60.000 son los mismos: la atribución se guardó al crear el contrato. «Pagable» es solo elegibilidad: NO existe todavía registrar el pago al referidor, ni retención, documento, asiento contable o política en USD (no implementado).
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B2-10 — Un visitante pide cotización de un hotel «bajo solicitud» en el tarifario público

- **Cuenta:** sin iniciar sesión (visitante)
- **Enlace:** http://localhost:3090/tarifario
- **Qué hacer:** Sin iniciar sesión abre /tarifario → «Vista Booking» → «Porción terrestre». En «HOTELES BAJO SOLICITUD» pulsa «Solicitar cotización» en «Hotel Solicitud Humo». Llena Ida 10/05/2030, Regreso 13/05/2030, 1 habitación Doble, «¿Viajan menores?» No, Nombres «Visitante», Apellidos «Revision», Número de documento «77100001», WhatsApp «3115550000» y pulsa «Enviar solicitud».
- **Qué debe verse:** El visitante recibe la confirmación de su solicitud (sin cuenta). Se crea UNA cotización «pendiente de tarifa» sin autor y NO se crea ningún contrato. El sistema avisa dentro de la plataforma (campana) a quienes pueden generar o asistir cotizaciones en la agencia: superadmin, gerencia, administración, operaciones y los asesores de venta. NO recibe aviso control de vuelo, el administrador de la otra agencia (minorista), ni agencia/freelance aliados, ni cuentas desactivadas. No hay correo ni WhatsApp de aviso.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B2-11 — El aviso de la cotización pública en la campana global

- **Cuenta:** gerencia@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/cotizaciones
- **Qué hacer:** Con gerencia abre Cotizaciones (cualquier pantalla del panel o del CRM tiene la campana) y pulsa la campana de arriba a la derecha. En el celular el panel debe caber en la pantalla. Después, SIN abrir «Ver / Imprimir cotización»: en Cotizaciones mira la columna «Cliente» de «Titular Ficha Uno», pulsa «Ver →» en esa fila y lee la tarjeta «Titular de la cotización»; abre «¿Cuándo se guarda este titular en el CRM?»; repite con «Titular Ficha Dos».
- **Qué debe verse:** Entre los demás avisos de la campana (compras por vencer, soportes de pago, solicitudes de aliados…) aparece «Nueva cotización de un visitante del tarifario: COT-…» con el código de la cotización del visitante, sin su nombre, documento ni teléfono, y SIN la marca «Atendida» (todavía no se convirtió en contrato). Pulsar el aviso lleva a la ficha de esa cotización. En la lista, bajo «Titular Ficha Uno» hay una línea gris «••••0001 · 3115550001 · ficha.uno@consolidada.test» (documento enmascarado: solo los últimos 4). La ficha, sin abrir el documento imprimible, muestra la tarjeta «Titular de la cotización»: Nombre «Titular Ficha Uno», Documento «CC 88100001», Nacimiento «1988-03-15», Teléfono «3115550001», Correo «ficha.uno@consolidada.test»; «Origen: Cotización dinámica · personal interno · asesor Rev Venta»; «Adultos: 2 · Niños: 1 · Infantes: 1»; «Viajeros con datos guardados (1)»: «Viajero Ficha Uno · CC 88100002 · Nac. 1990-07-20»; una nota sobre «Personas de cotización» (registrado o pendiente de «Reintentar»). El texto «¿Cuándo se guarda este titular en el CRM?» dice que se registra al crear o guardar la cotización, no al verla, aceptarla, descartarla ni convertirla. «Titular Ficha Dos» (carrito de un freelance): «Aliado: Freelance Humo (freelance) · El titular de abajo es el viajero, no el aliado.», Documento «88200001 (tipo no registrado)» (nunca se supone «CC») y Nacimiento, Teléfono y Correo dicen «No registrado».
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B2-12a — Valorar la solicitud del visitante: cargar la neta del hotel (REAL)

- **Cuenta:** operaciones@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/cotizaciones
- **Qué hacer:** Con la cuenta de operaciones abre el aviso «Nueva cotización de un visitante del tarifario: COT-…» de la campana (o la cotización del visitante en Cotizaciones). ANTES de escribir la neta, lee la tarjeta «Titular de la cotización» que está encima de «Pendiente de valoración» (quién pide, su documento y contacto, qué pide); no hace falta abrir «Ver / Imprimir». Después, en «Neta TOTAL del hotel (COP)» escribe 900000 y pulsa «Cargar neta y valorar». (Solo producto u operaciones pueden cargar la neta: venta ve «Esta solicitud espera la neta del hotel».)
- **Qué debe verse:** Antes de valorar, la tarjeta «Titular de la cotización» muestra: Nombre «Visitante Revision», Documento «77100001» (con «(tipo no registrado)» si el visitante no eligió tipo; nunca se supone «CC»), Teléfono «3115550000», Correo y Nacimiento «No registrado», «Origen: Solicitud de hotel bajo solicitud · visitante del tarifario público (sin sesión)» y las cantidades de la solicitud (Menores 0 · Niños 0 · Infantes 0); la cuenta de venta ve la misma tarjeta. La cotización deja de estar «pendiente de tarifa»: pasa a «abierta» con precio de venta (1.126.000) y aparecen los botones «Confirmar → generar contrato» y «Descartar». La cuenta de venta, antes de esto, solo ve «Pendiente de valoración» y no puede cargar la neta ni generar el contrato.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B2-12 — Leído es por persona; convertir la cotización en contrato (REAL) y solo entonces «Atendida · convertida a contrato»

- **Cuenta:** venta@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/cotizaciones
- **Qué hacer:** Con la cuenta de venta pulsa la campana, abre el aviso «Nueva cotización de un visitante del tarifario: COT-…» y revisa la ficha (ya valorada en el paso anterior): arriba está la tarjeta «Titular de la cotización» con el visitante, su documento y su teléfono, sin abrir «Ver / Imprimir». Pulsa «Confirmar → generar contrato»; en «Datos de los pasajeros (2)» pulsa «Editar» en el pasajero 1 y escribe su nacimiento 01/01/1985; en el pasajero 2 escribe Nombres «Acompañante», Apellidos «Revision», tipo CC, N° doc «77100002» y nacimiento 02/02/1986; deja «Rev Venta» como asesor y pulsa «Generar contrato». Cuando abra la ficha del contrato, vuelve a abrir la campana.
- **Qué debe verse:** El asesor de venta recibe el aviso y puede abrir la ficha (no ve «pendiente_tarifa» crudo sino «pendiente»), y antes de decidir lee quién es el titular en la tarjeta «Titular de la cotización» (Visitante Revision, 77100001, 3115550000). Una vez convertida, esa misma tarjeta sigue mostrando al titular con el estado «convertida» y el enlace «Ver contrato →». Al abrirlo, el aviso queda leído SOLO para él: los demás lo siguen viendo sin leer. Mientras la cotización no se convierte, la campana NO dice «Atendida». Al generar el contrato (acción real, no una instrucción de base) se crea UN contrato con el número DTM-…, la cotización queda «convertida» enlazada a él y entonces la campana muestra «Atendida · convertida a contrato» en ese aviso; leerlo o descartarlo nunca lo marca como atendido.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

## 7. Soportes de pago del aliado con cupo adicional (migración 339)

### S339-01 — Portal del aliado: cupo de soportes según los pagos registrados

- **Cuenta:** aliado@consolidada.test
- **Enlace:** http://localhost:3090/portal/b2b/cartera?vista=soportes
- **Qué hacer:** Con la cuenta de la agencia aliada abre Cartera → pestaña «Soportes de pago». Localiza las tarjetas DTM-8301 a DTM-8306 (en el celular van apiladas, sin tablas). Lee en cada una «Soportes vigentes: X de Y permitidos», la línea de pagos registrados y el estado del botón «Subir soporte».
- **Qué debe verse:** El texto superior dice que se permite un soporte por pago registrado MÁS uno adicional, y que «Subir un soporte no registra ni aprueba un pago, ni cambia el saldo». DTM-8301 «0 de 1 permitidos» (0 pagos registrados + 1 adicional): botón habilitado. DTM-8302 «1 de 1»: botón deshabilitado, «Ya usaste todos los soportes permitidos». DTM-8303 «1 de 2» (1 pago registrado + 1 adicional): habilitado, «este es el soporte adicional, para un pago aún sin registrar». DTM-8304 «2 de 2»: deshabilitado. DTM-8305 «4 de 3 permitidos»: aviso «Hay más soportes vigentes de los permitidos (por ejemplo, tras corregir un pago)…»; se puede reemplazar o retirar, no agregar (EXCESO sobre pagos + 1, distinto del soporte adicional normal). DTM-8306 «3 de 3»: deshabilitado. El contrato DTM-8399 de otro aliado NO aparece. Nada se desborda a 390 px. Observación: los contratos cancelados siguen apareciendo en esta lista (decisión pendiente del dueño).
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### S339-02 — Ficha interna: «adicional sin registrar» frente a «exceso» (gerencia, superadmin y administración)

- **Cuenta:** gerencia@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/contratos/DTM-8304
- **Qué hacer:** Con la cuenta de gerencia abre el contrato DTM-8304 y baja hasta «Soportes de pago del aliado». Después abre DTM-8305 y compara los avisos. (Superadmin y administración ven el mismo panel.)
- **Qué debe verse:** DTM-8304: «Vigentes 2 de 2 permitidos (1 abono registrado + 1 adicional)» y una nota azul «Hay más soportes vigentes que abonos registrados: el aliado puede haber adjuntado la evidencia de un pago aún sin registrar. Revisa los soportes y registra el abono que corresponda…» (informativa, no es un error). DTM-8305: «Vigentes 4 de 3 permitidos (2 abonos registrados + 1 adicional)» con un aviso ámbar «Hay más soportes vigentes de los permitidos (p. ej. tras anular un abono)…» y SIN la nota azul. En ambos: «Un soporte no registra ni aprueba un pago». A 390 px el panel cabe en la pantalla. (A 768 px la ficha de contrato tiene un desplazamiento horizontal ya conocido de la ficha, ajeno a esta entrega.)
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### S339-03 — Subir soportes: sin pagos permite uno; con un pago permite dos; al llenarse se rechaza otro

- **Cuenta:** aliado@consolidada.test
- **Enlace:** http://localhost:3090/portal/b2b/cartera?vista=soportes
- **Qué hacer:** En «Soportes de pago» pulsa «Subir soporte» en DTM-8301 (0 pagos) y elige un PDF pequeño (por ejemplo «comprobante-8301.pdf»). Repite en DTM-8303 (1 pago y 1 soporte): sube un segundo archivo. Mira el botón y los mensajes de cada tarjeta.
- **Qué debe verse:** DTM-8301 queda «1 de 1 permitidos» con «Soporte subido.» y el botón deshabilitado («Ya usaste todos los soportes permitidos…»). DTM-8303 pasa a «2 de 2 permitidos» y el botón también se deshabilita. Subir el soporte NO registra un pago ni cambia el saldo, ni el estado de la venta (DTM-8301 sigue «pendiente»), ni crea asientos contables. Si se fuerza otro archivo con el cupo lleno (el ensayo lo fuerza por el campo oculto), el sistema lo rechaza: «Este contrato ya tiene el máximo de soportes vigentes: uno por cada pago registrado y uno adicional».
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### S339-04 — Reemplazar y retirar conservan el historial

- **Cuenta:** aliado@consolidada.test
- **Enlace:** http://localhost:3090/portal/b2b/cartera?vista=soportes
- **Qué hacer:** En DTM-8303 pulsa «Reemplazar» en el soporte «comprobante-8303.pdf» (el que subiste) y elige una imagen PNG pequeña. En DTM-8305 (4 de 3) pulsa «Retirar» en «a.pdf» y acepta el aviso «¿Retirar este soporte?».
- **Qué debe verse:** Reemplazo: «Soporte reemplazado. El anterior queda en el historial del equipo.»; DTM-8303 sigue en «2 de 2». Retiro: «Soporte retirado.»; DTM-8305 pasa a «3 de 3 permitidos» y desaparece el aviso de exceso (el botón sigue deshabilitado hasta que se registre otro pago). Nada se borra: el equipo conserva el archivo anterior y quién/cuándo lo cambió.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### S339-05 — El equipo recibe el aviso, revisa la evidencia y ve el historial; subir no cambia nada financiero

- **Cuenta:** gerencia@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/cotizaciones
- **Qué hacer:** Con gerencia pulsa la campana y busca «Nuevo soporte de pago en el contrato DTM-8301» y «Se reemplazó un soporte de pago en el contrato DTM-8303». Abre el de DTM-8301, pulsa «Abrir» en «comprobante-8301.pdf» y revisa «Cartera». Luego abre DTM-8303 y despliega «Historial conservado».
- **Qué debe verse:** La campana muestra los avisos normales (sin importes ni nombres de archivo) y cada uno lleva a la ficha del contrato. El panel «Soportes de pago del aliado» lista el archivo vigente con «Abrir» (se abre el archivo real). En Cartera de DTM-8301 el pagado sigue en $ 0 y el contrato pendiente: el soporte es evidencia; el pago real lo registra el equipo aparte (siguiente paso). En DTM-8303, «Historial conservado (1)» muestra el archivo reemplazado con su fecha y la marca «reemplazado» y la referencia «sustituye al soporte #…». También reciben el aviso superadmin, administración, operaciones y el asesor del contrato (venta).
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### S339-06 — Registrar el pago real es un acto aparte: abre el siguiente cupo

- **Cuenta:** gerencia@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/contratos/DTM-8302?tab=cartera
- **Qué hacer:** Abre el contrato DTM-8302 (pestaña Cartera; tiene 0 pagos y 1 soporte). En «Registrar abono» pon 500.000, forma «Transferencia» y pulsa «Registrar abono». Mira el panel «Soportes de pago del aliado» de la misma ficha.
- **Qué debe verse:** El abono aparece en «Pagos registrados» y el pagado sube a $ 500.000. El panel de soportes pasa a «Vigentes 1 de 2 permitidos (1 abono registrado + 1 adicional)»: el soporte ya subido NO se convirtió en pago ni se asoció a ese abono (no se sabe cuál abono corresponde a qué archivo); registrar el pago fue lo que abrió un cupo nuevo. El estado del contrato depende de la regla normal de confirmación por abono, no del soporte.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### S339-07 — Tras registrarse el pago, el aliado puede subir el siguiente soporte

- **Cuenta:** aliado@consolidada.test
- **Enlace:** http://localhost:3090/portal/b2b/cartera?vista=soportes
- **Qué hacer:** En «Soportes de pago» mira DTM-8302 (el equipo registró un pago). Sube un segundo archivo PDF.
- **Qué debe verse:** DTM-8302 muestra «1 de 2 permitidos» y «1 pago registrado + 1 adicional», el botón «Subir soporte» está habilitado con «este es el soporte adicional, para un pago aún sin registrar». Tras subir queda «2 de 2 permitidos» y el botón se deshabilita de nuevo. La tarjeta cabe en el celular.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### S339-08 — Otro aliado (freelance) solo ve y usa sus propios contratos

- **Cuenta:** freelance@consolidada.test
- **Enlace:** http://localhost:3090/portal/b2b/cartera?vista=soportes
- **Qué hacer:** Con la cuenta de la freelance abre Cartera → «Soportes de pago».
- **Qué debe verse:** Solo aparece SU contrato DTM-8399 («0 de 1 permitidos», botón habilitado). No aparece ninguno de la agencia aliada (DTM-8301 a DTM-8306) ni sus archivos.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### S339-09 — El asesor del contrato ve y recibe lo suyo; otro asesor no ve los soportes

- **Cuenta:** venta@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/contratos/DTM-8304
- **Qué hacer:** Con la cuenta de venta (asesor «Rev Venta» de estos contratos) abre DTM-8304, baja a «Soportes de pago del aliado» y pulsa la campana. Después entra con «venta2» (otro asesor) y abre el mismo contrato.
- **Qué debe verse:** El asesor del contrato ve el panel con «Vigentes 2 de 2 permitidos (1 abono registrado + 1 adicional)» y los archivos, y en la campana tiene «Nuevo soporte de pago en el contrato DTM-8301» (el que subió el aliado en el paso 3). El otro asesor puede consultar la ficha comercial del contrato pero NO ve el panel de soportes del aliado.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### S339-10 — Rechazo (preparación): el aliado sube dos soportes reales a DTM-8310, uno equivocado

- **Cuenta:** aliado@consolidada.test
- **Enlace:** http://localhost:3090/portal/b2b/cartera?vista=soportes
- **Qué hacer:** En «Soportes de pago» busca la tarjeta DTM-8310 («0 de 2 permitidos»: 1 pago registrado + 1 adicional). Pulsa «Subir soporte» y elige un PDF pequeño que llamarás «equivocado-8310.pdf». Pulsa «Subir soporte» otra vez y elige otro PDF, «correcto-8310.pdf».
- **Qué debe verse:** La tarjeta pasa a «2 de 2 permitidos» y el botón se deshabilita. Subir no registra ningún pago, no cambia el saldo ni el estado del contrato (sigue «confirmado»).
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### S339-11 — El equipo rechaza un soporte con motivo obligatorio; el archivo y el historial se conservan

- **Cuenta:** gerencia@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/contratos/DTM-8310
- **Qué hacer:** Con gerencia (también pueden superadmin, administración y operaciones) abre el contrato DTM-8310 y baja a «Soportes de pago del aliado». En la fila de «equivocado-8310.pdf» pulsa «Rechazar». Mira el botón de confirmar sin escribir nada; luego escribe «Este comprobante es de otro contrato.» y pulsa «Confirmar rechazo». Después despliega «Rechazados» y pulsa «Abrir» en el soporte rechazado. Finalmente entra con «venta» (asesor del contrato) y abre el mismo contrato.
- **Qué debe verse:** Sin motivo el botón «Confirmar rechazo» está deshabilitado, y el formulario aclara que rechazar «no registra ni cambia ningún pago». Al confirmar aparece «Soporte rechazado. Aviso enviado a 1 cuenta(s) del aliado.» El panel pasa a «Vigentes 1 de 2 permitidos» y «equivocado-8310.pdf» ya NO está entre los vigentes: figura en «Rechazados (1) · 1 pendiente(s) de corrección» con la fecha y quién lo rechazó, el motivo entre comillas, «Pendiente de corrección por el aliado» y «Aviso al aliado: enviado por correo»; «Abrir» abre el archivo real (se conserva). En Cartera el pagado, el saldo y el estado («confirmado») no cambian. El asesor «venta» ve el panel pero NO tiene botón «Rechazar».
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### S339-12 — El aliado recibe el correo (en la captura local) y ve el rechazo con su motivo en el portal

- **Cuenta:** aliado@consolidada.test
- **Enlace:** http://localhost:3090/portal/b2b/cartera?vista=soportes
- **Qué hacer:** Abre el correo de pruebas (Mailpit, la dirección está en la sección «Antes de empezar» de esta guía): debe haber un mensaje para aliado@consolidada.test. Léelo. Luego, con la cuenta del aliado, abre «Soportes de pago» y mira la tarjeta DTM-8310.
- **Qué debe verse:** Correo: asunto «Soporte de pago rechazado · Contrato DTM-8310», con el nombre «equivocado-8310.pdf», «Motivo: Este comprobante es de otro contrato.», el enlace a «Soportes de pago» (http://localhost:3090/portal/b2b/cartera?vista=soportes) y la frase «Este mensaje no confirma ni cambia ningún pago». NO lleva montos ni el nombre del cliente. Es UN solo mensaje y solo para esa cuenta de aliado. Portal: sobre los vigentes hay un recuadro rojo «Soporte rechazado por el equipo» con el archivo, la fecha, «Motivo: Este comprobante es de otro contrato.» y el botón «Corregir soporte»; «correcto-8310.pdf» sigue vigente («1 de 2 permitidos»). A 390 px el recuadro cabe en la pantalla.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### S339-13 — El aliado corrige el soporte rechazado (no vale subir el mismo archivo)

- **Cuenta:** aliado@consolidada.test
- **Enlace:** http://localhost:3090/portal/b2b/cartera?vista=soportes
- **Qué hacer:** En el recuadro rojo de DTM-8310 pulsa «Corregir soporte» y elige OTRA VEZ el mismo archivo «equivocado-8310.pdf». Mira el mensaje. Luego pulsa «Corregir soporte» y elige un PDF distinto, «corregido-8310.pdf».
- **Qué debe verse:** Con el mismo archivo: «Es el mismo archivo que se rechazó. Sube el archivo corregido.» y no cambia nada. Con el archivo nuevo: «Soporte corregido enviado. El equipo lo revisará.»; el recuadro rojo desaparece y la tarjeta queda «2 de 2 permitidos»: rechazado + corregido ocupan UN solo cupo. Corregir no registra ni aprueba ningún pago ni cambia el saldo.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### S339-14 — El equipo ve la corrección vigente y el rechazado con su historia

- **Cuenta:** gerencia@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/contratos/DTM-8310
- **Qué hacer:** Con gerencia pulsa la campana y busca «Se reemplazó un soporte de pago en el contrato DTM-8310». Abre DTM-8310 y mira «Soportes de pago del aliado»; despliega «Rechazados».
- **Qué debe verse:** La campana avisa de la corrección (sin importes ni nombres de archivo). Entre los vigentes están «correcto-8310.pdf» y «corregido-8310.pdf» (este dice «corrige el soporte rechazado #…»). «Rechazados (1) · todos corregidos» muestra «equivocado-8310.pdf» con su motivo, quién y cuándo, y «Corregido con el soporte #… (fecha)». Cartera, pagado y estado siguen igual que antes de rechazar.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### S339-15 — Cupo: rechazar libera el cupo, la corrección no se salta el tope y siempre hay salida

- **Cuenta:** aliado@consolidada.test
- **Enlace:** http://localhost:3090/portal/b2b/cartera?vista=soportes
- **Qué hacer:** En DTM-8311 (0 pagos, cabe 1) sube «unico-8311.pdf». Pide a gerencia que lo rechace con el motivo «Ilegible» (el ensayo lo hace por la pantalla de gerencia). Antes de corregir, sube «otro-8311.pdf» con «Subir soporte» (el cupo liberado se usa). Mira el botón «Corregir soporte». Después pulsa «Reemplazar» en «otro-8311.pdf» y elige el archivo correcto. Nota informativa: la prueba automática de la base lanza 3 correcciones simultáneas del mismo rechazo y exactamente una gana (no es una acción tuya).
- **Qué debe verse:** Tras el rechazo DTM-8311 queda sin vigentes («0 de 1») y el recuadro rojo dice «Ilegible». Subir «otro-8311.pdf» se permite (el cupo estaba libre): «1 de 1 permitidos». Entonces «Corregir soporte» aparece DESHABILITADO con «Ya tienes todos los soportes permitidos: reemplaza uno de ellos con el archivo correcto…»: la corrección no salta el tope. «Reemplazar» sí funciona y el contrato nunca supera «1 de 1». Ningún paso cambió pagos, saldo ni el estado del contrato.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

## 8. Hotel: calendario, actualización de tarifas, solicitudes al proveedor y avisos de pago (#103)

### H103-01 — Una actualización de tarifarios que quedó a medias se termina sola

- **Cuenta:** administracion@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/producto/hoteles/20301?tab=temporadas
- **Qué hacer:** 1. Abre la pestaña «Temporadas, promociones y calculadora» del hotel «Hotel Prueba 103» (enlace del paso).
2. NO hagas clic en nada y observa la parte de arriba de la página hasta un minuto.
3. Recarga la página.
- **Qué debe verse:** Arriba aparece un aviso ámbar sobre paquetes sin actualizar («Quedaron 2 paquetes sin actualizar…» o «Completando la actualización de tarifarios automáticamente…»). Desaparece solo en cerca de un minuto, sin que pulses nada. Al recargar ya no hay aviso. Esa deuda de ejemplo se consume la primera vez: si ya abriste esta página antes de este paso, el aviso puede no aparecer (no es un error). Los 2 paquetes de ejemplo quedan al día.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### H103-02 — Códigos de promoción del hotel (exigidos y faltantes)

- **Cuenta:** administracion@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/producto/hoteles/20301?tab=temporadas
- **Qué hacer:** En la misma pestaña «Temporadas, promociones y calculadora» baja hasta la sección de códigos de promoción.
- **Qué debe verse:** «Promo Semana Santa» muestra el código SS-2027-X con la nota «Pedir en el asunto». «Promo sin digitar» exige código y muestra el aviso ámbar «Exige código pero no se ha digitado». Un código vive en la promoción de ese hotel, no en el contrato del cliente.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### H103-03 — Noches excluidas de una vigencia: lista compacta de siempre + calendario en una ventana (no es un cierre del hotel)

- **Cuenta:** administracion@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/producto/hoteles/20301?tab=temporadas
- **Qué hacer:** 1. En la lista de vigencias pulsa «Editar» en «ALTA».
2. Mira el bloque «Black-outs (fechas a excluir)»: es la lista compacta de rangos (Desde / Hasta / Quitar) de siempre; ahí mismo hay un botón «Elegir fechas en el calendario».
3. Pulsa ese botón: se abre una ventana «Noches excluidas». En el selector de mes elige «diciembre» de 2026. Haz clic en el 26 y luego, con la tecla Mayús (Shift) pulsada, clic en el 28: se marcan 3 noches seguidas (un rango). Pulsa «Quitar todas (3)».
4. Haz clic en el 30 y en el 31 de diciembre de 2026 y pulsa «Aplicar a la lista». La ventana se cierra y la lista compacta muestra un rango 30/12/2026 → 31/12/2026.
5. (Prueba de cancelar) Vuelve a abrir el calendario, haz clic en el 29 de diciembre y pulsa «Cancelar»: la lista no cambia.
6. Pulsa «Guardar cambios». Mide a ojo cuánto tarda: la pantalla debe quedar libre de inmediato aunque abajo se actualicen los tarifarios.
7. Pulsa «Editar» en «ALTA» otra vez, abre el calendario y mira diciembre de 2026.
- **Qué debe verse:** Antes: el calendario ocupaba la vigencia entera y la lista de rangos estaba escondida. Ahora la lista compacta es lo primero que ves y el calendario es una ayuda en una ventana (Escape o «Cancelar» la cierra sin cambiar nada; «Aplicar a la lista» pasa lo elegido a la lista, aún sin guardar). El texto aclara que estas noches «Solo afectan a esta vigencia: no cierran el hotel» y que para cerrar el hotel entero se usa «Black out general». Dentro de la ventana: clic = una noche; Mayús + clic = un rango. Tras guardar (en pocos segundos), al reabrir siguen excluidas exactamente el 30 y el 31 de diciembre de 2026. Las exclusiones de la vigencia y el cierre general «Mantenimiento Walk» son cosas distintas: guardar aquí no cambia la lista de cierres generales. Un aviso breve de actualización de tarifarios puede aparecer y se limpia solo.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### H103-04 — Conjunto de fechas reutilizable: COPIA noches a la vigencia que editas; no crea ni enlaza vigencias

- **Cuenta:** administracion@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/producto/hoteles/20301?tab=temporadas
- **Qué hacer:** 1. Pulsa «Editar» en «Promo Semana Santa», abre «Elegir fechas en el calendario» y baja hasta «Conjuntos de fechas guardados».
2. Lee «Vigencia en edición: Promo Semana Santa» y el párrafo que explica qué hace un conjunto.
3. Elige «Semana Santa Walk · 2027 · 4 noches» y pulsa «Copiar fechas a esta vigencia». Pulsa «Aplicar a la lista» y luego «Guardar cambios».
4. (Lo comprueba el ensayo automático, tú ves la frase en pantalla) editar el conjunto después no cambia la vigencia donde ya lo copiaste.
5. Pulsa «Cancelar» en la edición y, SIN editar ninguna vigencia, abre el formulario de vigencia nueva: la opción «Empezar una vigencia nueva con este conjunto» aparece en esa ventana y solo rellena el nombre y las noches del formulario; no guarda nada.
- **Qué debe verse:** Antes: el botón decía «Aplicar (copiar fechas)» y no quedaba claro a qué vigencia iban las fechas ni si se creaba una vigencia con el nombre del conjunto. Ahora la ventana nombra la vigencia que estás editando («nueva (sin guardar)» si todavía no existe) y dice que un conjunto es solo una lista de noches: NO es una vigencia; copiarlo agrega esas noches a las exclusiones de la vigencia en edición, no crea una vigencia nueva ni cambia otra ya guardada. El selector ofrece el conjunto con su año. Al copiar se marcan 4 noches (25 a 28 de marzo de 2027) dentro de «Promo Semana Santa», aún sin guardar. Guardado, esa vigencia lleva el 25 de marzo de 2027 entre sus exclusiones. Estas noches excluidas son de la vigencia; no son un cierre general del hotel. «Empezar una vigencia nueva con este conjunto» (solo con vigencia nueva) no crea nada: pone el nombre «Semana Santa Walk 2027» y las 4 noches en el formulario, que sigue sin guardar hasta que completes fechas y tarifas y pulses «Agregar temporada».
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### H103-05 — Black out general: guardar y borrar al instante; un fallo no se esconde

- **Cuenta:** administracion@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/producto/hoteles/20301
- **Qué hacer:** 1. Abre la página del hotel (pestaña «Configuración») y despliega «Black out general (1)». Aparece «Mantenimiento Walk» (2027-02-10 → 2027-02-12).
2. Agrega un cierre: Desde 01/06/2027, Hasta 02/06/2027, Motivo «Cierre de prueba revision», cierre total, «Agregar cierre». Debe aparecer en la lista enseguida.
3. (Opcional, prueba de fallo) Abre las herramientas del navegador (F12) > pestaña «Red» > «Sin conexión» y pulsa «Eliminar» en el cierre nuevo. Vuelve a poner «Sin conexión» en «Sin limitación».
4. Con red normal, pulsa «Eliminar» en el cierre nuevo y luego en «Mantenimiento Walk». No recargues.
- **Qué debe verse:** El cierre nuevo aparece en la lista al instante y puede mostrar «Cierre guardado. Los tarifarios se están actualizando en segundo plano.». Sin conexión, «Eliminar» NO borra la fila: queda visible con un mensaje de error rojo («No se pudo eliminar el cierre. Intenta de nuevo.»). Con red, cada fila desaparece de inmediato tras confirmarse el borrado, sin recargar la página, y al recargar sigue sin existir. El hotel queda sin cierres generales. (Los cierres generales cierran la venta de todo el hotel; son distintos de las exclusiones de una vigencia del paso anterior.)
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### H103-06 — Solicitud al proveedor con código de promoción (correo en captura local)

- **Cuenta:** administracion@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/contratos/DTM-2001
- **Qué hacer:** 1. Abre el contrato DTM-2001, baja a «Solicitudes a proveedores por correo». Debe decir «Modo de captura local: el correo NO sale de esta máquina.»
2. Proveedor «Hotel Prueba 103»; Correo(s) del proveedor «reservas@walk.test»; pulsa «Vista previa».
3. La vista pide «Código de promoción exigido por el hotel»: «Enviar solicitud» sigue deshabilitado. Elige «Promo Semana Santa» (SS-2027-X).
4. Pulsa «Enviar solicitud» y púlsalo otra vez.
5. Abre la bandeja de correos de prueba http://127.0.0.1:55413 (nada sale del computador).
6. (Opcional) Proveedor «Receptivo 103», correo «tours@walk.test», «Vista previa».
No se prueba aquí el buzón real de Hostinger: el correo solo llega a la bandeja local de pruebas.
- **Qué debe verse:** Se envía UNA sola solicitud (la segunda pulsación no envía otra). El historial muestra «Enviada» con «Código SS-2027-X». La bandeja local tiene exactamente un mensaje a reservas@walk.test, con una tabla HTML y una versión en texto plano que traen el código SS-2027-X, el titular, la estancia elegida y los tres viajeros (Ana Walk, Luis Walk, Sofía Walk) con su edad; sin precios, sin costos y sin vouchers del cliente adjuntos ni sustituidos. La dirección de respuesta tiene la forma respuestas+<token largo>@consolidada.test. Con «Receptivo 103» se lista el «Traslado aeropuerto - hotel» y no hay sección de código.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### H103-07 — Dos estancias del mismo proveedor: una solicitud por hotel, cada una con su código

- **Cuenta:** administracion@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/contratos/DTM-2004
- **Qué hacer:** 1. Abre DTM-2004. En «Solicitudes a proveedores por correo»: Proveedor «Hotel Prueba 103», Correo(s) «reservas@hotel.test». El bloque «Estancias de esta solicitud» lista «Hotel Prueba 103» y «Otro Hotel 103».
2. Con ambas marcadas pulsa «Vista previa».
3. Desmarca «Otro Hotel 103», «Vista previa», elige «Promo Semana Santa» (SS-2027-X) y «Enviar solicitud».
4. Marca «Otro Hotel 103», desmarca «Hotel Prueba 103», «Vista previa», elige «Promo Otro Hotel» (OTRO-CODE) y «Enviar solicitud».
5. Mira la bandeja local de pruebas.
- **Qué debe verse:** Con las dos estancias marcadas la vista previa se bloquea con un mensaje claro: una solicitud lleva un solo código, envía un hotel por solicitud. Después hay DOS mensajes a reservas@hotel.test: uno con SS-2027-X y solo la primera estancia, otro con OTRO-CODE y solo la segunda; ningún mensaje trae los dos códigos. El historial muestra dos solicitudes.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### H103-08 — La respuesta del proveedor avisa, pero NO confirma nada (respuesta simulada)

- **Cuenta:** administracion@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/contratos/DTM-2001
- **Qué hacer:** 1. En una terminal, desde la carpeta dspacios-travel de la revisión, juega la respuesta simulada del proveedor:
   node supabase/scripts/revision_consolidada/responder_proveedor.mjs DTM-2001 "Confirmamos disponibilidad con el código."
   (deja un mensaje en un buzón SIMULADO y llama a la ruta de entrada real de la app; no usa el correo real de Hostinger).
2. Recarga el contrato DTM-2001 y mira «Solicitudes a proveedores por correo».
3. Pulsa «marcar leídas».
4. Mira la bandeja local de pruebas.
- **Qué debe verse:** La solicitud pasa a «Respondió» y muestra el texto de la respuesta; sale el botón «1 respuesta(s) nueva(s) · marcar leídas». NO aparece «Confirmada por el proveedor»: una respuesta nunca confirma ni rechaza por sí sola, aunque el texto diga «Confirmamos». «Decisión registrada» sigue en «—» y el contrato sigue «pendiente». Al pulsar «marcar leídas» el contador desaparece (solo para este contrato). En la bandeja local llega un aviso interno «Respuesta del proveedor · …» para interno@consolidada.test. La lectura automática del buzón real de Hostinger NO está verificada aquí.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### H103-09 — La confirmación del proveedor la registra una persona, de forma explícita

- **Cuenta:** administracion@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/contratos/DTM-2001
- **Qué hacer:** 1. En la solicitud de DTM-2001 (ya con la respuesta del paso anterior) pulsa «Registrar: el proveedor confirmó».
2. Mira la tarjeta, el estado del contrato y la bandeja local.
- **Qué debe verse:** Solo ahora la solicitud pasa a «Confirmada por el proveedor» y aparece una fecha en «Decisión registrada». Mensaje «Registrado: el proveedor confirmó el servicio.» El estado del contrato NO cambia por esto (sigue pendiente) y no se envía ningún correo nuevo al proveedor. Existe también «Registrar: el proveedor rechazó»; no se usa aquí. Respuesta y decisión son dos pasos separados.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### H103-10 — Aviso de pago a proveedores: pagos ya registrados, soporte y envío manual

- **Cuenta:** operaciones@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/pagos/avisos
- **Qué hacer:** 1. Abre «Aviso de pago a proveedores». Elige «Proveedor Pago 103».
2. Verifica la lista de pagos (reserva, servicio, fecha, valor).
3. Marca los cuatro pagos. En «Subir soporte de los pagos marcados» elige un archivo PDF, JPG o PNG de hasta 5 MB (el ensayo usa un PDF sintético: crea uno con «node supabase/scripts/revision_consolidada/responder_proveedor.mjs --crear-soporte», queda en la carpeta de datos de la revisión) y pulsa «Guardar soporte». Nada se envía todavía.
4. Marca el archivo adjunto junto a los pagos. «Referencia del pago (opcional)»: TRF-WALK-889. «Correo(s) del proveedor»: pagos@proveedor-walk.test. «Vista previa».
5. Pulsa «Enviar aviso» y pulsa otra vez. Mira «Avisos enviados» y la bandeja local.
- **Qué debe verse:** Cuatro pagos: DTM-2001 COP 1.500.000 (parcial de una obligación de 4.000.000), DTM-2002 COP 2.500.000, DTM-2003 USD 100,00 (TRM 4000) y USD 50,00 (TRM 4100). Tras guardar el soporte: «Soporte guardado. Aún no se ha enviado nada»; tener pagos registrados y soportes nunca envía ni aprueba un correo por sí solo. La vista previa relaciona 3 reservas con su servicio, el parcial en columnas («Valor de este pago» COP 1.500.000, «Obligación total» COP 4.000.000, «Pagado acumulado» COP 1.500.000), las líneas USD con su TRM, totales SEPARADOS por moneda (COP 4.000.000; USD 150,00) y el nombre del archivo. Un solo envío con el PDF adjunto y el texto «AVISO DE PAGO»; la segunda pulsación no envía otro; el historial dice «Enviada», no confirmada ni conciliada, y pagos, asientos contables y conciliación bancaria no cambian.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### H103-11 — Un asesor de ventas NO alcanza estas pantallas (acceso denegado)

- **Cuenta:** venta@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/pagos/avisos
- **Qué hacer:** Con la cuenta de venta intenta abrir: «Aviso de pago a proveedores» (/dashboard/pagos/avisos), la página del hotel (/dashboard/producto/hoteles/20301?tab=temporadas) y el contrato DTM-2001.
- **Qué debe verse:** El aviso de pago y la página del hotel se rechazan o redirigen (sin mostrar su contenido). En el contrato DTM-2001 NO existe la sección «Solicitudes a proveedores por correo» (un asesor no envía solicitudes a proveedores ni ve pagos a proveedores).
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### H103-12 — Ancho de teléfono (390 px): la página del hotel y el aviso de pago

- **Cuenta:** operaciones@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/producto/hoteles/20301?tab=temporadas
- **Qué hacer:** Reduce la ventana del navegador a unos 390 px de ancho (o abre desde el celular) y recorre: la pestaña de temporadas del hotel y, después, «Aviso de pago a proveedores» con «Proveedor Pago 103» elegido.
- **Qué debe verse:** Ninguna de las dos páginas se desplaza de lado como un todo. En el aviso de pago, la tabla de pagos puede desplazarse de lado DENTRO de su tarjeta (hay que deslizar para ver valor y soportes): es aceptable, no está pulido.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### H103-13b — Mensaje de la solicitud al proveedor: qué se puede editar y qué no

- **Cuenta:** administracion@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/contratos/DTM-2001
- **Qué hacer:** Antes: el texto del correo a un proveedor («Les enviamos la solicitud de servicio de la reserva…», el asunto, las tablas) estaba escrito en el código; no había forma de cambiarlo desde la pantalla. Ahora hay un campo OPCIONAL por envío; las tablas, el código de promoción y el asunto siguen siendo automáticos.
1. Abre el contrato DTM-2001, baja a «Solicitudes a proveedores por correo». Proveedor «Hotel Prueba 103»; Correo(s) «nota@walk.test».
2. Pulsa «Vista previa» y elige el código «Promo Semana Santa» (igual que en el paso H103-06).
3. En «Mensaje adicional para el proveedor (opcional)» escribe «Llegamos tarde: late check-in 22:00.» (puedes añadir una segunda línea). Mira que debajo aparece «El mensaje adicional cambió: genera de nuevo la vista previa» y «Enviar solicitud» se apaga.
4. Pulsa «Vista previa» otra vez: tu nota aparece arriba de las tablas. Pulsa «Enviar solicitud».
5. Revisa el correo en la bandeja local (nota@walk.test).
- **Qué debe verse:** El correo trae tu nota en un recuadro justo después de la frase inicial y ANTES de las tablas; el recuadro del código SS-2027-X, el proveedor, las tablas de alojamiento y pasajeros y la dirección de respuesta con token siguen igual que sin nota. Si no escribes nota, el correo es exactamente el de siempre. El campo acepta hasta 600 caracteres, solo texto (lo que escribas con símbolos < > no se interpreta como formato). Una respuesta del proveedor a este correo sigue siendo solo una respuesta: confirmar el servicio lo registra una persona, como antes. El aviso de pago a proveedores (Pagos → Avisos) tiene el mismo campo opcional.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### H103-13 — Informativo: decisiones de correo que siguen ABIERTAS (no son pruebas)

- **Cuenta:** superadmin@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/contratos/DTM-2001
- **Qué hacer:** Lee esta lista. Nada se prueba aquí y ninguna se ha decidido. En esta revisión todo el correo sale a una bandeja local de pruebas y la respuesta del proveedor es simulada; el comportamiento del buzón real de Hostinger NO está verificado (si acepta direcciones respuestas+TOKEN@, qué contiene su notificación, límites de volumen).
Decisiones pendientes tuyas: (1) remitente y dirección de respuesta (una dirección dedicada, nunca la bandeja de una persona); (2) cómo entran las respuestas (buzón Hostinger con notificación, Resend entrante, o marcar a mano); (3) quién recibe los avisos internos (hoy: quien envió la solicitud y operaciones de la agencia, más una lista interna opcional); (4) diseño y contenido de la solicitud al proveedor y el pago (campos, plantilla por proveedor, relación con el catálogo de hoteles y promociones: el hotel se empareja por nombre y lo confirma quien envía); (5) latencia del barrido diario (una respuesta perdida puede esperar hasta un día); (6) elegibilidad en la primera lectura del buzón (ignora respuestas de más de 72 horas); (7) ruta final de correo en producción y plan/costo de Resend; (8) si el aviso de pago seguirá siempre manual; (9) si quieres una plantilla de mensaje guardada por agencia con campos (hoy NO existe: el texto fijo vive en el código y lo único editable por envío es la nota opcional del paso H103-13b).
- **Qué debe verse:** En el contrato DTM-2001 la sección de solicitudes dice «Modo de captura local: el correo NO sale de esta máquina.» Ningún correo salió de este computador durante la revisión. Anota tus decisiones; hasta entonces el correo queda desactivado o en captura local, la entrada de Hostinger apagada y nada se envía en vivo.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

## 9. Bloque de seis tareas (#95, #61, #41, #42, #51, #33)

### B95-01 — Generar el tarifario del paquete «B95 Porción terrestre — Hotel Mar»

- **Cuenta:** operaciones@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/paquetes/80101
- **Qué hacer:** 1) Abre el paquete «B95 Porción terrestre — Hotel Mar» (3 noches, hotel «Hotel Mar B95», tour de ciudad INCLUIDO y asistencia médica OPCIONAL). 2) Entra a la pestaña «Tarifario resultado». 3) Pulsa «Generar tarifario» y espera a que termine.
- **Qué debe verse:** El estado del tarifario pasa a «Publicado» con un número de tarifas mayor que cero (habitación doble, sencilla, triple, niño e infante del hotel, y el servicio opcional de asistencia). Este paso crea el tarifario con la propia pantalla: no se sembró ningún dato derivado.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B95-02 — Reservar el paquete con la asistencia opcional

- **Cuenta:** superadmin@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/reservar/nuevo?paquete=80101&hotel=80201&modulo=porcion_terrestre
- **Qué hacer:** 1) Fecha de ida: 90 días después de hoy; fecha de regreso: 3 noches después; pulsa «Ver tarifas para estas fechas». 2) Habitaciones: 1 Doble. 3) En «Servicios adicionales» marca «Asistencia médica B95». 4) Cliente: nombres «Cliente», apellidos «B95 Reserva», documento 1012340100 (CC). 5) Asesor interno: el primero de la lista. 6) Pasajeros: dos adultos con nombre, documento y fecha de nacimiento. 7) Pulsa «Generar cotización» y, en la cotización, «Confirmar → generar contrato».
- **Qué debe verse:** Se crea un contrato PENDIENTE del paquete con 2 pasajeros. En su documento («Contrato» del cliente), «Asistencia médica B95» aparece descrita en «Servicios incluidos» SIN precio propio: su importe va dentro de la tarifa por adulto y las filas suman el total. El tour INCLUIDO queda como obligación con su proveedor (40.000 × 2 pax = 80.000 en costo de receptivos) y la asistencia elegida como obligación aparte (30.000 × 2 = 60.000 en costo de asistencia); el contrato marca asistencia médica «Sí».
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B95-03 — Quitar la asistencia opcional: el documento y las finanzas la siguen

- **Cuenta:** operaciones@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/contratos
- **Qué hacer:** 1) En Contratos abre el contrato del cliente «Cliente B95 Reserva» (estado pendiente). 2) En «Servicios adicionales (contrato pendiente)» desmarca «Asistencia médica B95» y pulsa «Guardar servicios». 3) Abre el documento del contrato («/contrato/…») y mira «Asistencia Médica».
- **Qué debe verse:** Mensaje «Servicios actualizados». El precio baja exactamente el valor de la asistencia; el costo de asistencia queda en 0 y la asistencia médica en «No» en el contrato y en su documento. El tour INCLUIDO sigue intacto: mismo costo de receptivos (80.000) y su obligación con el proveedor sin cambios; la obligación de la asistencia desaparece.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B95-04 — Volver a agregar la asistencia y quitarla otra vez

- **Cuenta:** operaciones@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/contratos
- **Qué hacer:** 1) En el mismo contrato, marca de nuevo «Asistencia médica B95» y «Guardar servicios»; abre el documento. 2) Desmárcala otra vez y vuelve a guardar.
- **Qué debe verse:** Al agregarla: precio, costo de asistencia 60.000, asistencia «Sí» en el documento y su obligación de vuelta (sin duplicarse). Al quitarla: todo regresa al estado de B95-03. En ambos casos el costo y la obligación del tour incluido siguen exactamente iguales.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B95-05 — Regenerar el plan de cobro con un pago parcial

- **Cuenta:** administracion@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/contratos/DTM-8101?tab=cartera
- **Qué hacer:** Contrato DTM-8101 (precio 1.000.000, pagado 400.000, con un plan VIEJO de 2 filas calculado antes del pago). 1) En Cartera pulsa «Regenerar plan». 2) Pulsa «Regenerar plan» dos veces más. 3) Registra un abono de 100.000 (Transferencia) y vuelve a regenerar.
- **Qué debe verse:** Tras regenerar: «Abono inicial 400.000» (lo ya pagado, estado «Cubierta») y tres cuotas mensuales de 200.000 «Pendiente»; solo queda por cobrar el saldo (600.000). Regenerar de nuevo no acumula planes: siempre 4 filas, que suman 1.000.000. Tras el abono de 100.000 el plan pasa a 500.000 + 3 cuotas (166.666, 166.666, 166.668) = 1.000.000.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B95-06 — Contrato pagado por completo: no queda nada por cobrar

- **Cuenta:** administracion@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/contratos/DTM-8102?tab=cartera
- **Qué hacer:** Contrato DTM-8102 (precio 1.000.000, pagado 1.000.000, sin plan). En Cartera pulsa «Generar plan de cobro».
- **Qué debe verse:** Mensaje «Contrato pagado por completo: no hay saldo por cobrar.»; el plan tiene una sola fila de 1.000.000 en estado «Cubierta» (no se vuelve a pedir lo que ya se pagó) y el saldo del contrato es 0.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B95-07 — Plan de cobro en dólares con centavos

- **Cuenta:** administracion@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/contratos/DTM-8103?tab=cartera
- **Qué hacer:** Contrato DTM-8103 (precio USD 100,50; pagado USD 40,00). En Cartera pulsa «Generar plan de cobro».
- **Qué debe verse:** Plan en dólares con sus centavos: abono inicial USD 40,00 (lo ya pagado, «Cubierta») y tres cuotas de USD 20,16, USD 20,16 y USD 20,18 (suman 100,50). El saldo por cobrar mostrado es USD 60,50 (sin redondear a dólares enteros).
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B95-08 — Plan de cobro impreso (pesos y dólares), también en el celular

- **Cuenta:** administracion@consolidada.test
- **Enlace:** http://localhost:3090/plan-cobro/DTM-8101
- **Qué hacer:** Abre «/plan-cobro/DTM-8101» (pesos) y «/plan-cobro/DTM-8103» (dólares). Repite en pantalla de teléfono.
- **Qué debe verse:** Cada documento muestra el plan con sus estados («Cubierta», «Pendiente»). En dólares los importes llevan centavos (USD $20.16). Nada se corta ni obliga a desplazar la página de lado en 390 px; la columna «Estado» se ve completa.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B95-09 — Duplicar paquetes armados de cada tipo como borrador

- **Cuenta:** operaciones@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/paquetes
- **Qué hacer:** Para cada uno de los cuatro paquetes B95 (Porción terrestre, Bloqueo, Servicios sueltos, Dinámico con salida): ábrelo y pulsa «Duplicar». Revisa el aviso de la copia y confirma que el original no cambió.
- **Qué debe verse:** Cada copia se abre con el aviso de duplicado, con el nombre «… (copia)» editable, INACTIVA y sin tarifario ni publicación; trae su configuración y sus hijos (hoteles, servicios, vuelo, empaquetado, salida) apuntando a los MISMOS registros del catálogo. El paquete original queda idéntico (misma huella) y ninguna copia aparece en el tarifario público.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B95-10 — Duplicar el paquete dinámico total

- **Cuenta:** operaciones@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/paquetes
- **Qué hacer:** En «Paquetes dinámicos totales» pulsa «Duplicar» en «B95 Paquete dinámico total — Cartagena 3 noches». Revisa el formulario precargado y pulsa «Guardar paquete».
- **Qué debe verse:** El formulario abre con el aviso «Duplicando …», el nombre termina en «(copia)» y trae sus hoteles (uno con ficha, uno manual) y su servicio. Al guardar se crea un paquete NUEVO sin publicar; el original sigue publicado e idéntico.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B95-11 — Duplicar un bloqueo con nuevas fechas

- **Cuenta:** operaciones@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/vuelos/80101
- **Qué hacer:** Abre el bloqueo B95AA1 y pulsa «Duplicar con nuevas fechas». 1) Escribe record B95AA2, fecha de ida 130 días y de regreso 127 días desde hoy y pulsa «Crear bloqueo». 2) Corrige: regreso a 133 días, devolución a 80 y emisión a 65. 3) Prueba también con el record B95AA1 (repetido). 4) Con B95AA2 crea el bloqueo.
- **Qué debe verse:** El formulario viene con la configuración (aerolínea, ruta, cupos, tarifas, moneda) y el record VACÍO. Un regreso anterior a la ida se rechaza («La fecha de regreso no puede ser anterior a la fecha de ida.») y un record repetido también. La copia nace con sus 6 sillas disponibles; el bloqueo original conserva sus sillas (1 confirmada, 2 en plazo, 3 disponibles) y sus fechas.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B95-12 — Duplicar un empaquetado con nuevas fechas

- **Cuenta:** operaciones@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/vuelos/empaquetados/80101
- **Qué hacer:** Abre el empaquetado «Sin record» (JetSMART B95) y pulsa «Duplicar con nuevas fechas». Pon fecha de ida 140 días y de regreso 143 días desde hoy, vigencia de compra hasta 100 días, y pulsa «Crear empaquetado».
- **Qué debe verse:** El formulario trae la configuración con el aviso de duplicado. La copia se crea con las fechas nuevas, SIN vínculos con paquetes; el original sigue vinculado a «B95 Bloqueo — vuelo y hotel» y con sus fechas.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B95-13 — Contrato manual: destino del catálogo, hoteles de ESE destino, compra, habitaciones y fechas; editar la copia y reabrir

- **Cuenta:** superadmin@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/contratos/nuevo
- **Qué hacer:** 1) Tipo «Dinámico (todo manual)», asesor interno, cliente «Cliente» «Catálogo B95». 2) Fechas: salida a 60 días y regreso a 63. 3) «+ Agregar hotel» y, SIN elegir destino, abre la lista del hotel. 4) En «Destino» elige «BOGOTÁ B95» de la lista y mira los hoteles; escribe «Hotel Duplicado B95» (el de Bogotá, solo adultos). 5) Cambia el destino a «CARTAGENA B95» y vuelve a escribir «Hotel Duplicado B95» (ahora es el de Cartagena). 6) Sin elegir «Cómo se compra» mira el aviso; elige «Compra directa al hotel». 7) Mueve la SALIDA a 66 días (después del regreso) y devuélvela a 60. 8) Categoría «Superior B95», alimentación «PAM», proveedor «Proveedor editado B95», habitaciones: Doble = 1, costo 500.000. Con UN solo pasajero adulto mira el aviso de habitaciones y agrega un segundo pasajero adulto. 9) «+ Agregar servicio» tipo Traslado: «Traslado aeropuerto B95» (hay dos) y elige «… (#80304)»; costo 40.000. 10) Ítem «Paquete B95», 2 adultos, tarifa 1.200.000; «Generar contrato» y reabre el contrato.
- **Qué debe verse:** Sin destino: la lista de hoteles está vacía y dice «Elige primero el destino para ver los hoteles del catálogo». Con BOGOTÁ B95 solo sale «Hotel Duplicado B95» (el de Bogotá, con «Solo adultos (Adults Only)»); al cambiar a CARTAGENA B95 ese hotel se QUITA con el aviso «Se quitó el hotel «Hotel Duplicado B95»: no pertenece al destino elegido…», y la lista ofrece UN solo «Hotel Duplicado B95» (sin etiqueta #id: el gemelo de Bogotá ya no se ofrece). Al elegirlo: «Hotel del catálogo», proveedor «Proveedor Hotel Mar B95» y Ciudad «CARTAGENA B95» ya puestos (copias editables). Sin origen: «Indica cómo se compra…». Con la salida después del regreso: «La fecha de regreso no puede ser anterior a la fecha de salida» y «Generar contrato» desactivado. Con 1 adulto y 1 Doble: «necesitan 2 adulto(s); el viaje tiene 1»; con 2 adultos desaparece. El servicio elegido (#80304) trae su proveedor «Receptivo Alterno B95» y no su precio. El contrato guarda la COPIA editada («Superior B95», «PAM», proveedor escrito) con la acomodación derivada «1 hab Doble» y origen «directa»; el catálogo queda intacto.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B95-14 — Hotel solo para adultos: avisa y NO deja enviar con menores

- **Cuenta:** superadmin@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/contratos/nuevo
- **Qué hacer:** En «Nuevo contrato (manual)»: tipo Dinámico, asesor, cliente «Cliente» «Adultos B95», destino «BOGOTÁ B95» (de la lista), fechas (salida 60 días, regreso 63). Hotel: escribe «Hotel Duplicado B95» (con Bogotá solo sale el de Bogotá), Compra directa, Doble = 1. Ítem «Paquete», 2 adultos, tarifa 1.000.000. Pasajero MENOR (nacido hace 5 años, tipo RC). Intenta pulsar «Generar contrato».
- **Qué debe verse:** Al elegir el hotel aparecen las marcas «Solo adultos (Adults Only)»; con el menor, el aviso rojo «Este hotel es solo para adultos y hay pasajeros menores de 18 años.» y, bajo el hotel, «El hotel «Hotel Duplicado B95» es solo para adultos (Adults Only) y el viaje incluye niños o infantes.». El botón «Generar contrato» queda DESACTIVADO (no se puede enviar) y no se crea ningún contrato. (El servidor repite la regla aunque alguien salte la pantalla: prueba real aparte.) «Acepta mascotas» solo informa: no bloquea.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B95-15 — Cotización manual: destino, hotel del catálogo, infantes, compra y habitaciones; y su paso a contrato

- **Cuenta:** superadmin@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/cotizaciones/nueva
- **Qué hacer:** 0) (Esta cotización se paga antes de convertir: en «Pagos previos» registra un pago de 300.000 y, si el mínimo exigido es mayor, completa hasta él.) 1) Nueva cotización: cliente «Cliente» «B95 Cotizacion» (CC 1012340300, nacimiento 1985-05-05), destino «CARTAGENA B95» (de la lista), fechas (ida 70, regreso 73 días), 2 adultos, 1 INFANTE, asesor. Prueba antes: regreso anterior a la ida (movimiento de la ida a 80 días) y devuélvela. 2) Agrega un servicio Hotel: nombre «Hotel Duplicado B95» (al abrir la lista solo hay hoteles de Cartagena), «Cómo se compra» = Compra directa al hotel (mira antes el aviso sin elegir), categoría «Superior B95», régimen «PAM», habitaciones Doble = 1 (mira antes «3 adultos»), costo neto 800.000. 3) «Generar cotización» y luego «Generar contrato →».
- **Qué debe verse:** Sin elegir el origen: «Indica cómo se compra «Hotel Duplicado B95»…». Con el regreso antes de la ida: «La fecha de regreso no puede ser anterior…» y «Generar cotización» desactivado. La lista del hotel NO trae hoteles de otro destino ni etiquetas #id. La fila muestra «Del catálogo», proveedor «Proveedor del catálogo» y, con 3 adultos y 1 Doble, «alojan 2 adulto(s); el viaje tiene 3». La cotización guarda destino «CARTAGENA B95», 1 infante, compra «directa», habitaciones {Doble: 1}, acomodación «1 hab Doble» y los textos EDITADOS. El contrato convertido muestra en «Servicio / Plan» «Hotel Duplicado B95 · Superior B95 · PAM · 1 hab Doble», su hotel en «Hoteles y Servicios» del documento y queda pendiente.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B95-16 — Crear una comparativa: niño gratis en A, niño con tarifa en B

- **Cuenta:** superadmin@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/cotizaciones/nueva
- **Qué hacer:** Cotización nueva en modo «Cotización comparativa» (markup general 0): cliente «Cliente» «B95 Comparativa» (CC 1012340001, nacimiento 1985-05-05), destino «CARTAGENA B95» elegido de la lista, ida 70 y regreso 73 días, 2 adultos, 1 niño, asesor. Servicios: Hotel A «Hotel Niño Gratis B95» (costo 830.455) y Hotel B «Hotel Mar B95» (930.455), cada uno con «Cómo se compra» = Compra directa al hotel y Habitaciones Doble = 1, y un Traslado común «Traslado aeropuerto B95 — … (#80303)» (500.000). Tarifa por niño: Opción A 0, Opción B 150.000. Escribe un Incluye y un No incluye DISTINTOS en cada opción y pulsa «Generar comparativa».
- **Qué debe verse:** El total por opción es A $1.330.455 y B $1.580.455. La comparativa guardada muestra cada opción con SU incluye / no incluye (nada prestado de la otra), el niño de la A como «Niño gratis · Sin costo» y el de la B con su tarifa $150.000, sin costos ni proveedores visibles para el cliente.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B95-17 — La comparativa en el celular

- **Cuenta:** administracion@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/cotizaciones
- **Qué hacer:** Abre la comparativa «Cliente B95 Comparativa» (lista de Cotizaciones) y revísala en pantalla de teléfono.
- **Qué debe verse:** Las dos opciones se apilan, con su total, su niño (gratis / $150.000) y sus incluye / no incluye; nada se corta ni obliga a desplazar la página de lado en 390 px.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B95-18 — Elegir la opción B y convertirla en contrato

- **Cuenta:** administracion@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/cotizaciones
- **Qué hacer:** En la comparativa «Cliente B95 Comparativa» pulsa «Elegir esta opción» en la Opción B. Abre la cotización creada, registra en «Pagos previos» un primer pago de 300.000 y completa hasta el «Pago mínimo exigido», y pulsa «Generar contrato →» (sin pago mínimo el sistema se niega a convertir).
- **Qué debe verse:** Se crea la cotización de la opción B por $1.580.455 y de ella el contrato por el mismo total. El contrato (documento «Contrato» del cliente) muestra «Hoteles y Servicios» con el hotel de la Opción B (Hotel Mar B95 · Estándar, Alimentación PAM —la del catálogo—, acomodación «1 hab Doble» y proveedor/compra solo internos), el «Incluye / No incluye» de ESA opción y UNA fila agrupada del paquete: 2 adultos, 1 niño, tarifa por adulto $715.227,50, tarifa REAL del niño $150.000 y Valor total $1.580.455. NO hay fila «Ajuste por redondeo» (el −$1 queda dentro de la tarifa del adulto: 2 × 715.227,50 + 150.000 = 1.580.455). Nada del Hotel A ni de su incluye.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B95-19 — Pagar el contrato por completo: saldo cero y sin fila de ajuste

- **Cuenta:** administracion@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/contratos
- **Qué hacer:** En el contrato de «Cliente B95 Comparativa», pestaña Cartera: el contrato ya trae el pago previo aplicado como abono; registra un abono por el SALDO (precio 1.580.455 menos lo ya pagado) con Transferencia. Abre el documento del contrato.
- **Qué debe verse:** Pagado $1.580.455 y saldo $0. El documento imprime «Total del contrato $1.580.455» y «Saldo pendiente $0»; NO imprime ninguna fila «Ajuste por redondeo» (ni el texto interno «reparto del hotel»): la tarifa del adulto ($715.227,50) ya lleva el residuo y las filas suman exactamente el total.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B95-20 — Comparativa en dólares: centavos y ajuste de un centavo

- **Cuenta:** superadmin@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/cotizaciones/nueva
- **Qué hacer:** Repite la comparativa en USD con 3 adultos y 1 niño (cliente «Cliente» «B95 Dolares», CC 1012340002, destino «CARTAGENA B95» de la lista): Hotel A 831, Hotel B 932 (compra directa y Habitaciones Triple = 1 en cada uno, porque 3 adultos no caben en una Doble), Traslado común 500; niño A 0 y niño B 150,55. Elige la Opción B, registra el pago previo mínimo (primer pago de 300.000 y luego el mínimo exigido), genera el contrato y abre su documento (también en el teléfono).
- **Qué debe verse:** Opción A USD $1,331.00 y B USD $1,582.55. El contrato conserva los centavos: total USD $1,582.55, niño USD $150.55 y SIN fila «Ajuste por redondeo»: el centavo queda dentro del total de los 3 adultos (1.432,00; tarifa por adulto USD $477.33 a su precisión de cálculo — decisión O-1 por confirmar); las líneas guardadas suman exactamente 1.582,55. En 390 px el documento no se corta.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B95-16a — Generar el tarifario del paquete «Porción 95T» (dos hoteles) para la ruta del Tarifario

- **Cuenta:** operaciones@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/paquetes/9560
- **Qué hacer:** 1) Abre el paquete «Porción 95T» (3 noches, «Hotel Alfa 95T» Estandar/Desayuno y «Hotel Beta 95T» Superior/Todo incluido, asistencia médica opcional). 2) Pestaña «Tarifario resultado». 3) Pulsa «Generar tarifario» y espera a «Publicado».
- **Qué debe verse:** El tarifario queda «Publicado». La tarifa doble por persona es $375.000 en Hotel Alfa y $480.000 en Hotel Beta (neto por noche 100.000 y 128.000, 3 noches, markup 20 %); el niño es $150.000 en Alfa y gratis ($0) en Beta. Este paso es el mismo botón de B95-01: prepara datos para los dos pasos siguientes.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B95-16b — Visitante del Tarifario: crear la comparativa de dos hoteles con el carrito y elegir la opción B

- **Cuenta:** sin iniciar sesión (visitante)
- **Enlace:** http://localhost:3090/tarifario/checkout?modo=comparativa
- **Qué hacer:** Sin iniciar sesión: 1) En el tarifario deja en el carrito «Hotel Alfa 95T» y «Hotel Beta 95T» (2 adultos, 1 habitación doble, 1 al 4 de marzo de 2030) cada uno con «Asistencia médica 95T»; activa «Cotización comparativa». (El paso carga ese mismo carrito por usted.) 2) En «Crear cotización comparativa» escribe nombres «Visitante», apellidos «Tarifario16», documento 900956016, teléfono 3009560016 y pulsa «Generar cotización comparativa». 3) Abre el enlace de la cotización, en la opción B pulsa «Continuar con esta opción», confirma tus datos y pulsa «Continuar con esta opción».
- **Qué debe verse:** La comparativa muestra dos opciones con el valor EXACTO por opción: A $830.000 y B $1.040.000 (2 × 375.000 + 2 × 40.000 de asistencia · 2 × 480.000 + 2 × 40.000). Al continuar con B se crea UNA cotización hija (la comparativa madre no se convierte) con «Hotel Beta 95T · Superior · Todo incluido» y el total $1.040.000, sin costos netos ni proveedores en pantalla. Con un niño en el carrito, un visitante SIN sesión hoy no puede cotizar (hallazgo pendiente de decisión: ver informe); por eso este paso es de solo adultos.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B95-16c — Visitante del Tarifario CON UN NIÑO: crear la comparativa y ver el valor exacto de cada opción (antes fallaba con «admite máximo 0 niño(s)»)

- **Cuenta:** sin iniciar sesión (visitante)
- **Enlace:** http://localhost:3090/tarifario/checkout?modo=comparativa
- **Qué hacer:** Sin iniciar sesión: 1) Deja en el carrito «Hotel Alfa 95T» y «Hotel Beta 95T» (2 adultos y 1 niño de 8 años, 1 habitación doble, 1 al 4 de marzo de 2030) con «Asistencia médica 95T» para 3 personas; activa «Cotización comparativa». (El paso carga ese carrito por usted.) 2) Escribe nombres «Visitante», apellidos «Tarifario17», documento 900956017, teléfono 3009560017 y pulsa «Generar cotización comparativa». 3) Abre el enlace de la cotización compartida.
- **Qué debe verse:** No aparece «La habitación seleccionada admite máximo 0 niño(s)». La comparativa muestra dos opciones con el valor EXACTO: A $1.020.000 (2 × 375.000 + niño 150.000 + 3 × 40.000 de asistencia) y B $1.080.000 (2 × 480.000 + niño gratis + 3 × 40.000). La cotización compartida no muestra costos netos ni proveedores. (Con 3 niños en una habitación doble la solicitud se rechaza por capacidad, también sin iniciar sesión: máximo 2 niños.)
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B95-18b — Convertir la opción B del Tarifario en contrato: hotel, plan, tarifas y documento

- **Cuenta:** venta@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/cotizaciones
- **Qué hacer:** 1) En Cotizaciones abre la cotización de «Visitante Tarifario16». 2) Revisa la tarjeta «Titular de la cotización». 3) Pulsa «Confirmar → generar contrato», completa pasajeros (2 adultos), asesor y «Generar contrato». 4) En el contrato abre «Documento del contrato».
- **Qué debe verse:** Se crea UN contrato por $1.040.000 con «Hotel Beta 95T · Superior», alimentación «Todo incluido» y «1 hab Doble (2 pax)». El documento del cliente muestra UNA fila «Paquete Turístico» con la tarifa por adulto $520.000 (480.000 del hotel + 40.000 de la asistencia) y el valor total $1.040.000; «Asistencia médica 95T» aparece descrita en «Servicios incluidos» SIN precio propio, y no hay fila ni texto «Ajuste por redondeo». Nota: en este contrato «Acomodación» repite la categoría («Superior»); la habitación («1 hab Doble») va debajo: así guarda el Tarifario desde siempre.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

## 10. Información de hotel en paquetes dinámicos (#88)

### H88-01 — Hotel vinculado al catálogo: fotos, estrellas, descripción y ubicación

- **Cuenta:** sin iniciar sesión (visitante)
- **Enlace:** http://localhost:3090/tarifario?vista=dinamicos
- **Qué hacer:** Sin iniciar sesión, abre el tarifario público en la pestaña «Dinámicos» y busca el paquete «Dinamico 88 - Hoteles del catalogo». Mira la tarjeta «Hotel Catalogo Uno» (hay 8 tarjetas en total). En una pantalla angosta (390 px) el contenido debe quedar dentro de la pantalla.
- **Qué debe verse:** La tarjeta muestra la galería del hotel del catálogo con contador «1 / 3» y la foto de portada primero (la imagen dice «UNO-2 PORTADA»), 4 estrellas, la descripción «Descripcion de CATALOGO UNO…», el bloque «Ubicación» con el enlace a Google Maps de «Bocagrande, Cartagena», y aparte la línea «Habitación Superior · PAM» (la categoría de la habitación no se mezcla con las estrellas). «Desde por persona en doble» = $500.000.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### H88-02 — EXPLICACIÓN (pendiente de tu aceptación) — Dos hoteles con el mismo nombre: la aplicación los distingue por su identificador, no por el nombre

- **Cuenta:** sin iniciar sesión (visitante)
- **Enlace:** http://localhost:3090/tarifario?vista=dinamicos
- **Qué hacer:** Qué es esto: NO es una función de la aplicación. «Hotel Duplicado» es un caso de PRUEBA que preparamos a propósito: dos hoteles distintos del catálogo (dos fichas, cada una con su identificador interno) que por casualidad se llaman igual, como podría pasar con dos hoteles reales del mismo nombre (por ejemplo «Hotel Caribe» en dos barrios). La aplicación no tiene ningún botón para «duplicar un hotel». Qué hacer: abre «Dinámicos», busca el paquete «Dinamico 88 - Hoteles del catalogo» y compara las dos tarjetas «Hotel Duplicado», una al lado de la otra. Cada tarjeta guarda en el paquete el identificador de SU ficha (no el nombre) y con ese identificador lee en vivo las estrellas, descripción, ubicación y fotos del catálogo; por eso un nombre repetido nunca mezcla los datos. (Es distinto de «duplicar un PAQUETE»: el botón «Duplicar» de la lista de Paquetes copia la configuración del paquete y sigue apuntando a las MISMAS fichas de hotel; no crea hoteles nuevos ni copia sus datos.)
- **Qué debe verse:** La primera: 4 estrellas, «Descripcion del catalogo del Duplicado A…», portada «DUP-A-1 PORTADA», contador «1 / 2», «Habitación Estandar · PC», Desde $600.000. La segunda: 5 estrellas, «Descripcion del catalogo del Duplicado B…», portada «DUP-B-1 PORTADA» (una sola foto, sin contador), «Habitación Superior · PAM», Desde $700.000. Ninguna mezcla datos de la otra. Si cambias la descripción de una de las dos fichas en Producto → Hoteles y recargas esta página, solo cambia su tarjeta (la otra queda igual). Esto es una EXPLICACIÓN de cómo funciona: no la cuentes como aceptada hasta que tú lo decidas.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### H88-03 — EXPLICACIÓN (pendiente de tu aceptación) — Cuándo se ve el dato nuevo del catálogo: la ficha gana a la copia vieja guardada en el paquete

- **Cuenta:** sin iniciar sesión (visitante)
- **Enlace:** http://localhost:3090/tarifario?vista=dinamicos
- **Qué hacer:** Mira las tarjetas «Hotel Sin Estrellas» y «Hotel Copia Antigua». Cómo funciona: cuando armas un paquete dinámico y eliges un hotel del catálogo, el sistema guarda en el paquete una COPIA de sus estrellas, descripción y ubicación (para poder editar el paquete y para los hoteles escritos a mano). Pero la página pública NO muestra esa copia cuando el hotel está vinculado a una ficha: lee la ficha del catálogo en el momento de abrir la página, usando el identificador guardado. Por eso «Hotel Copia Antigua» (copia de 2 estrellas y «Descripcion VIEJA») muestra lo ACTUAL de la ficha (3 estrellas, «Descripcion ACTUAL»). Lo que cambies en Producto → Hoteles aparece en la siguiente carga de la página: no hay espera programada ni nada que actualizar a mano en el paquete (la copia guardada solo se renueva cuando alguien guarda el paquete y no afecta lo que se ve). Un hotel escrito a mano en el paquete (sin ficha) sí muestra exactamente lo que se escribió. Si la ficha no tiene un dato (por ejemplo, sin fotos), se usa lo guardado en el paquete, y si tampoco hay, no se muestra nada (nunca se inventa).
- **Qué debe verse:** «Hotel Sin Estrellas» no muestra estrellas: en su lugar aparece la etiqueta de clasificación «Posada»; tiene 2 fotos («1 / 2», portada «POSADA-1 PORTADA»), su descripción y «Habitación Estandar · PA». «Hotel Copia Antigua» muestra 3 estrellas y «Descripcion ACTUAL del catalogo» (el paquete tenía guardada una copia vieja de 2 estrellas y «Descripcion VIEJA», que NO deben verse), con la ubicación «Manga ACTUAL, Cartagena». Como su ficha del catálogo no tiene fotos, muestra la foto propia del paquete («COPIA-GUARDADA») sin contador. Es una EXPLICACIÓN de cómo funciona: no la cuentes como aceptada hasta que tú lo decidas.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### H88-04 — Hoteles manuales y con datos faltantes: tarjetas limpias

- **Cuenta:** sin iniciar sesión (visitante)
- **Enlace:** http://localhost:3090/tarifario?vista=dinamicos
- **Qué hacer:** Mira las tarjetas «Hotel Vacio» (vinculado a una ficha sin datos), «Hotel Manual Pleno» y «Hotel Manual Pelado» (hoteles escritos a mano, sin ficha).
- **Qué debe verse:** «Hotel Vacio» y «Hotel Manual Pelado»: sin estrellas, sin etiqueta de clasificación, sin descripción, sin el bloque «Ubicación» ni enlace de mapa, y con la imagen genérica de hotel; solo nombre, «Desde» ($450.000 y $350.000) y «Cotizar». «Hotel Manual Pleno» muestra exactamente lo que se escribió en el paquete: 3 estrellas, «Descripcion MANUAL escrita a mano en el paquete.», su foto («MANUAL-FOTO»), ubicación «Baru, Cartagena» y Desde $550.000. No hay espacios vacíos ni títulos huérfanos.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### H88-05 — Los precios no cambian: «Desde» y total de la cotización

- **Cuenta:** sin iniciar sesión (visitante)
- **Enlace:** http://localhost:3090/tarifario?vista=dinamicos
- **Qué hacer:** Revisa el «Desde por persona en doble» de las 8 tarjetas y cotiza en 3 de ellas (pulsa «Cotizar», escribe fecha de ida 30 días después de hoy y de regreso 3 noches después; se deja 1 habitación doble, sin menores). No pulses «Continuar al checkout».
- **Qué debe verse:** Los «Desde» son: Catalogo Uno 500.000 · Duplicado A 600.000 · Duplicado B 700.000 · Sin Estrellas 400.000 · Copia Antigua 520.000 · Vacio 450.000 · Manual Pleno 550.000 · Manual Pelado 350.000. «Total estimado» (2 personas en doble) = 1.000.000 en «Hotel Catalogo Uno», 1.040.000 en «Hotel Copia Antigua» y 1.100.000 en «Hotel Manual Pleno». La información del catálogo no altera ningún precio. En el celular (390 px) los controles y los totales caben en la pantalla.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### H88-06 — Cotizar se abre en una ventana: la tarjeta ya no se estira

- **Cuenta:** sin iniciar sesión (visitante)
- **Enlace:** http://localhost:3090/tarifario?vista=dinamicos
- **Qué hacer:** Antes: al pulsar «Cotizar» el formulario se desplegaba DENTRO de la tarjeta y la estiraba (y empujaba a las demás). Ahora: en «Dinamico 88 - Hoteles del catalogo» pulsa «Cotizar» en «Hotel Catalogo Uno». Revísalo en pantalla de escritorio, a ancho intermedio (unos 768 px) y en celular (390 px). Ciérrala con la tecla Escape y con el botón «Cerrar» (ábrela otra vez para probar los dos). No pulses «Continuar al checkout».
- **Qué debe verse:** Se abre una ventana centrada con el título «Cotizar · Hotel Catalogo Uno» y debajo el nombre del paquete, destino y noches; el resto de la página se ve atenuado y no se desplaza. Dentro están las mismas secciones de siempre (Hotel, Alimentación, Habitaciones, Viajeros, Fechas) y «Total estimado». La tarjeta y la grilla de atrás NO cambian de tamaño. En celular la ventana ocupa casi todo el ancho sin cortarse; si el contenido es largo, se desplaza dentro de la ventana. Escape y «Cerrar» la cierran; si la vuelves a abrir en el mismo hotel, conserva lo que habías puesto (habitaciones, fechas) mientras no cierres la pestaña.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### H88-07 — Hotel del catálogo en un paquete común (no dinámico): mismos datos, por identificador

- **Cuenta:** sin iniciar sesión (visitante)
- **Enlace:** http://localhost:3090/tarifario
- **Qué hacer:** Requiere la semilla de correcciones «rev2/h88.sql» (la carga quien prepara la revisión; avisa si no ves estos datos). Sin iniciar sesión, abre /tarifario y busca la tarjeta «Hotel Caribe Plaza» de los paquetes de Cartagena (porción terrestre). En la base existe además OTRO hotel con el mismo nombre (el «gemelo») que NO está en ningún paquete y tiene otros datos.
- **Qué debe verse:** La tarjeta de «Hotel Caribe Plaza» muestra los datos de SU ficha: 4 estrellas, «Descripcion de CATALOGO CARIBE PLAZA (paquete comun)…», ubicación «Bocagrande, Cartagena» y la galería de 2 fotos con «CARIBE-2 PORTADA» primero. No aparece nada del gemelo («2 estrellas», «Descripcion del GEMELO», «Barrio Gemelo», «GEMELO-1»). Los precios no cambian respecto a antes de cargar la semilla.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

## 11. Costo neto del bloqueo

### NETA-01 — El bloqueo guarda DOS tarifas distintas: neta (pago a la aerolínea) y para empaquetar (reventa)

- **Cuenta:** operaciones@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/vuelos/91201
- **Qué hacer:** Abre el bloqueo NTA301 (/dashboard/vuelos/91201). Lee el encabezado y despliega «Editar bloqueo (no cambia cupos)» (no guardes nada).
- **Qué debe verse:** El encabezado dice «Tarifa empaquetar $349.000 · Fee infante $80.500 · Moneda COP». En el editor, «Tarifa neta (pago aerolínea)» = 300000 y «Tarifa empaquetar (reventa)» = 349000. La neta de 300.000 es lo que se le paga a la aerolínea por silla; 349.000 es solo la base del precio de venta.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### NETA-02 — El precio comercial público sigue saliendo de la tarifa para empaquetar

- **Cuenta:** sin iniciar sesión (visitante)
- **Enlace:** http://localhost:3090/tarifario
- **Qué hacer:** Sin iniciar sesión, abre el tarifario público (en el celular, pulsa primero «Buscar»). En «Buscar vuelo + hotel (paquete)» elige Origen «BOGOTÁ», Destino «CARTAGENA NETA» y, en «Salida (vuelo)», la PRIMERA salida de la lista (la del bloqueo NTA301, sale en unos 60 días). Mira la tarjeta «Hotel Neta Peso» (paquete «Paquete bloqueo Neta COP»).
- **Qué debe verse:** Aparece 1 hotel disponible, «Hotel Neta Peso», con «DESDE $ 699.000 por persona»: el precio comercial configurado (calculado sobre la reventa 349.000 + hotel + margen). No aparece la neta (300.000) ni la reventa cruda (349.000) como precio al público.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### NETA-03 — Reservar con la neta: cotización y contrato (2 adultos, bloqueo con neta)

- **Cuenta:** venta@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/reservar/nuevo?paquete=91201&hotel=91201&bloqueo=91201&modulo=bloqueo
- **Qué hacer:** Con la cuenta de venta abre la reserva del bloqueo NTA301 (Reservar → Vista tabla → Paquetes → «Hotel Neta Peso» → Reservar, o el enlace de arriba). 1) En «Doble · 2 pax» escribe 1. 2) Cliente: Nombres «Ana», Apellidos «Revision». 3) Asesor interno: «Rev Venta». 4) Pasajeros 1 y 2: Ana Revision (documento 91000001, nacimiento 15/03/1985) y Luis Revision (documento 91000002, nacimiento 20/08/1983). 5) Pulsa «Generar cotización». 6) En la cotización pulsa «Confirmar → generar contrato».
- **Qué debe verse:** Antes de guardar, el encabezado muestra «6 cupo(s) disponible(s)» y el total del formulario es $1.398.000 (2 × 699.000). Se crea el contrato en estado Pendiente con precio de venta 1.398.000. Como asesor de ventas NO ves costos del contrato (ninguna cifra «Costo aéreo» ni 600.000 en pantalla). Quedan 2 sillas tomadas del bloqueo.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### NETA-04 — Costo aéreo y obligación pendiente = 600.000; al confirmar nace UNA cuenta por pagar

- **Cuenta:** administracion@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/contratos
- **Qué hacer:** Con administración abre el contrato recién creado (el más reciente de «Rev Venta»; el ensayo lo abre directo). 1) Pestaña «Costos»: lee «Costo aéreo» y «Costo hotel». 2) Arriba, en «Obligaciones previstas — aún no exigibles», lee las filas. 3) Pestaña «Proveedores»: aún no hay cuentas por pagar. 4) Pulsa «Confirmar venta». 5) Vuelve a «Proveedores» y recarga la página.
- **Qué debe verse:** Costos: «Costo aéreo» 600000 y «Costo hotel» 420000. Obligaciones previstas: aéreo $600.000 (proveedor «Aerolinea Neta SAS») y hotel $420.000, «Total previsto» $1.020.000, mientras el contrato está Pendiente. Tras confirmar, el contrato queda Confirmado y las previstas nacen como cuentas por pagar: exactamente una de aéreo por 600.000 y una de hotel por 420.000 (2 en total); al recargar no se duplican.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### NETA-05 — Bloqueo en dólares: neta USD 100, reventa USD 120, TRM de costos 3.900 (provisional)

- **Cuenta:** venta@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/reservar/nuevo?paquete=91202&hotel=91202&bloqueo=91203&modulo=bloqueo
- **Qué hacer:** Con la cuenta de venta abre la reserva del bloqueo NTU303 (en dólares, paquete «Paquete bloqueo Neta USD»). 1) «Doble · 2 pax» = 1. 2) Cliente Ana Revision; asesor «Rev Venta»; pasajeros Ana Revision (documento 91000031, nacimiento 15/03/1985) y Luis Revision (91000032, 20/08/1983). 3) «Generar cotización». 4) En la cotización, lee el recuadro «TRM de costos (COP por USD)» (su ayuda dice que es PROVISIONAL: se corrige en la ficha del contrato mientras esté pendiente y se congela al confirmar). Escribe 3900 en «TRM de costos»; si se piden, TRM provisional 4000 y moneda de cobro USD. 5) «Confirmar → generar contrato».
- **Qué debe verse:** El recuadro «TRM de costos» explica que es provisional y que se puede corregir mientras el contrato esté pendiente (ya no dice «no cambia después»). El contrato queda Pendiente, en USD, con precio de venta USD 450 (2 × 225). Costo aéreo = USD 200 (2 × neta 100; con la reventa 120 habría sido 240). La obligación prevista de aéreo es de USD 200 con su equivalente en pesos provisional a la TRM de costos 3.900 = COP 780.000 (200 × 3.900). Todavía no hay cuentas por pagar. Como asesor de ventas no ves costos.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### NETA-06 — Contrato en dólares: los costos se ven EN USD, con su equivalente en pesos provisional

- **Cuenta:** administracion@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/contratos
- **Qué hacer:** Con administración abre el contrato en USD recién creado (bloqueo NTU303; el ensayo lo abre directo; NO lo confirmes todavía). 1) Pestaña «Costos»: lee el recuadro azul y «Costo aéreo». 2) Arriba, lee «Obligaciones previstas — aún no exigibles»: la fila del aéreo, el equivalente en pesos y los totales. 3) En otra ventana (por ejemplo de incógnito) inicia sesión con la cuenta de venta y abre el mismo contrato.
- **Qué debe verse:** Costos: un recuadro azul dice «Los costos de este contrato están en USD (la moneda de la oferta), no en pesos» y «TRM de costos $3.900 (provisional)»; «Costo aéreo» = USD $200.00 (no «$ 200»). Obligaciones previstas: el aéreo dice «USD $200.00» y debajo «≈ $ 780.000 a TRM de costos $3.900 (provisional)» (200 × 3.900); los totales dicen «Total previsto en USD» con «≈ … (provisional)» y los dólares NO se suman con pesos. La nota aclara que es distinta de la TRM del pago real al proveedor y de la TRM de cobro. Todavía no hay cuentas por pagar. Con la cuenta de venta no aparece ninguno de estos paneles.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### NETA-06b — Corregir la TRM de costos PROVISIONAL después de guardar (3.900 → 4.100) y confirmar

- **Cuenta:** administracion@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/contratos
- **Qué hacer:** Con administración, en el mismo contrato en USD pendiente (NETA-05/06). 1) Abre el contrato en DOS pestañas del navegador (A y B). 2) En la pestaña A pulsa «Corregir la TRM de costos de este contrato», escribe 4100, motivo «TRM acordada con la aerolínea» y «Guardar TRM». 3) En la pestaña B (que todavía muestra 3.900, NO la recargues) pulsa «Corregir…», escribe 4300 y «Guardar TRM». 4) En la pestaña A, pulsa «Confirmar venta» y luego abre la pestaña «Proveedores» y la pestaña «Costos».
- **Qué debe verse:** Pestaña A: aparece «TRM de costos actualizada a $4.100» y el aéreo queda «USD $200.00 · ≈ $ 820.000 a TRM de costos $4.100 (provisional)» (200 × 4.100); el precio USD 450, el costo en dólares y las cuentas por pagar (ninguna) no cambian. Pestaña B: dice «La TRM de costos cambió mientras la editabas. Recarga la página y revisa el valor actual…» y NO cambia nada (sigue 4.100). Al confirmar nace UNA cuenta por pagar aérea de USD $200.00 con «≈ $ 820.000 a TRM de costos $4.100 (congelada)», el devengo contable es 820.000 pesos, el panel de previstas y el botón de corregir desaparecen y «Costos» dice que la TRM «quedó congelada al confirmar». Un cambio de TRM no toca otros contratos ni cuentas por pagar existentes.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### NETA-06c — Agregar un servicio en dólares DESPUÉS de crear el contrato: nace en USD con su TRM de costos provisional

- **Cuenta:** administracion@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/reservar/nuevo?paquete=91202&hotel=91202&bloqueo=91203&modulo=bloqueo
- **Qué hacer:** Con administración crea OTRO contrato en USD como en NETA-05 (bloqueo NTU303, «Doble · 2 pax» = 1, TRM de costos 3.900). En la copia de ensayo el coordinador deja ese contrato enlazado a su paquete y con un servicio opcional en dólares «Tour USD Rev349» (neta USD 50 por persona) para que aparezca el cuadro «Servicios adicionales (contrato pendiente)». 1) En ese cuadro, los importes dicen «USD $…» (no «$ …» como si fueran pesos). 2) Marca «Tour USD Rev349» y pulsa «Guardar servicios». 3) Arriba, en «Obligaciones previstas», lee la fila del tour. 4) Pulsa «Corregir la TRM de costos de este contrato», escribe 4100 y «Guardar TRM». 5) Pulsa «Confirmar venta» y abre la pestaña «Proveedores».
- **Qué debe verse:** Paso 1: los precios del cuadro llevan «USD $». Paso 2: «✓ Servicios actualizados». Paso 3: el tour dice «USD $100.00» (50 × 2 pax) y debajo «≈ $ 390.000 a TRM de costos $3.900 (provisional)»: hereda la TRM de costos del contrato, igual que el aéreo y el hotel; no queda como «pesos» ni sin TRM. Paso 4: «TRM de costos actualizada a $4.100 (3 obligación(es))» y el tour queda «≈ $ 410.000 … (provisional)»; el valor en dólares no cambia. Paso 5: nacen las cuentas por pagar con el tour «USD $100.00 · ≈ $ 410.000 a TRM de costos $4.100 (congelada)»; nada de otros contratos cambia. Si el contrato no tuviera una TRM única que heredar, el tour diría «TRM de costos pendiente» y aparecería «Fijar TRM de costos» (solo para ese servicio agregado).
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### NETA-07 — Bloqueo SIN neta: se rechaza con un mensaje claro y no deja nada a medias

- **Cuenta:** venta@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/reservar/nuevo?paquete=91201&hotel=91201&bloqueo=91202&modulo=bloqueo
- **Qué hacer:** Con la cuenta de venta abre la reserva del bloqueo NTB302 (no tiene tarifa neta cargada; el precio público sí existe). 1) «Doble · 2 pax» = 1 e «Infantes (menores de 2 años, sin silla)» = 1. 2) Cliente Ana Revision; asesor «Rev Venta». 3) Pasajeros: Ana Revision (documento 91000021, nac. 15/03/1985), Luis Revision (91000022, nac. 20/08/1983) y el bebé Bebe Revision (RC 91000023, nacido unos 8 meses antes de la salida), con «Adulto responsable» = el primer adulto. 4) Pulsa «Generar cotización».
- **Qué debe verse:** En rojo aparece «El bloqueo NTB302 no tiene tarifa neta cargada; cárgala en Vuelos antes de reservar.» y el formulario se queda donde está. NO se crea cotización, ni contrato, ni se toma ninguna silla del bloqueo, ni nace obligación o cuenta por pagar: el sistema no cae a la tarifa de reventa 349.000 ni a 0. (El precio público de ese hotel sigue visible: solo se frena la reserva.)
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### NETA-08 — Cargar la neta en el bloqueo (formulario real de edición)

- **Cuenta:** operaciones@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/vuelos/91202
- **Qué hacer:** Con operaciones abre el bloqueo NTB302 (/dashboard/vuelos/91202), despliega «Editar bloqueo (no cambia cupos)», escribe 300000 en «Tarifa neta (pago aerolínea)» y pulsa «Guardar cambios». (Antes de publicar, el dueño revisa además cuáles bloqueos REALES activos siguen sin neta: es un diagnóstico de solo lectura, supabase/scripts/diagnostico_bloqueo_costo_neta.sql, que el ejecutor corre cuando el dueño lo pida; no hay pantalla para eso.)
- **Qué debe verse:** Aparece «Guardado.». El bloqueo conserva «Tarifa empaquetar (reventa)» 349000 y el fee de infante 80.500; la neta queda en 300.000. El tarifario del paquete se regenera solo y el precio comercial no cambia ($699.000 en doble).
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### NETA-09 — Reintento con la neta cargada: la reserva avanza, con el costo de la neta y el infante sin silla

- **Cuenta:** venta@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/reservar/nuevo?paquete=91201&hotel=91201&bloqueo=91202&modulo=bloqueo
- **Qué hacer:** Con la cuenta de venta repite exactamente la reserva del paso de rechazo (bloqueo NTB302: 1 doble + 1 infante; cliente Ana Revision; asesor «Rev Venta»; pasajeros Ana y Luis Revision con documentos 91000021/22 y nacimientos 15/03/1985 y 20/08/1983; bebé Bebe Revision, RC 91000023, nacido unos 8 meses antes de la salida, con «Adulto responsable» el primer adulto). Pulsa «Generar cotización» y luego «Confirmar → generar contrato».
- **Qué debe verse:** Ahora la cotización se genera y se crea el contrato: 2 adultos con silla + 1 infante sin silla. Costo aéreo = 2 × 300.000 + fee de infante 80.500 = 680.500 (el infante no paga tarifa ni ocupa silla). Solo 2 sillas tomadas, una sola obligación aérea prevista de 680.500 y exactamente 1 cotización y 1 contrato nuevos: no queda nada del intento fallido.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

## 12. Integración — lo que solo ocurre al combinar las entregas

### INT-01 — La campana reúne los avisos de varias entregas

- **Cuenta:** gerencia@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/cotizaciones
- **Qué hacer:** (Sonda de PANTALLA: este paso siembra avisos de prueba —COT-REV-1/2 y un soporte— solo para ver cómo conviven en la campana; los avisos reales de cada entrega ya se recorrieron en sus propios pasos.) Después de recorrer los pasos de CRM (cotización pública de un visitante), de #339 (un soporte de pago subido por el aliado) y abre la campana con la cuenta de gerencia. (Las alertas de fin de compra del bloque 3 ya NO van a la campana: viven en el área «Alertas» del tablero.)
- **Qué debe verse:** Conviven en la misma lista: «Nueva cotización de un visitante del tarifario: …» (con «Atendida · convertida a contrato» solo en la que ya se convirtió) y «Nuevo soporte de pago en el contrato …»; cada uno abre su pantalla (cotización, contrato). NO aparece ningún «Compra por vencer · …» (esas alertas están en el tablero). En el ensayo estos avisos se crean directamente en la base porque dependen de los pasos de otras entregas.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### INT-02 — La ficha de contrato reúne los paneles de varias entregas

- **Cuenta:** superadmin@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/contratos/DTM-9801
- **Qué hacer:** Abre el contrato DTM-9801 (aliado, vuelos con voucher), luego DTM-2001 (hotel con proveedor) y baja por cada ficha; por último abre DTM-8304 (soportes de pago del aliado).
- **Qué debe verse:** En DTM-9801 aparece «Vouchers» (bloque 1); en DTM-2001, «Solicitudes a proveedores por correo» (#103). En DTM-8304 aparece «Soportes de pago del aliado» con «Vigentes 2 de 2 permitidos» (#339). Ningún panel desplaza ni oculta a otro.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### INT-03 — El CRM conserva su menú nuevo (sin campana general)

- **Cuenta:** gerencia@consolidada.test
- **Enlace:** http://localhost:3090/crm
- **Qué hacer:** Abre el CRM con gerencia y mira la barra superior.
- **Qué debe verse:** El menú incluye «Referidos» y «Clientes de aliados» (CRM) y, a la derecha, «← PORTAL». No hay campana general de avisos (ese lugar queda para notificaciones del CRM). En el celular nada se sale de la pantalla.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### INT-04 — Informativo (medido en el ensayo): qué ve cada cuenta del personal en los selectores de asesor y en el catálogo de costos

- **Cuenta:** superadmin@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/contratos/nuevo
- **Qué hacer:** No hay nada que hacer: es una medición. El ensayo abrió, con cada cuenta del personal, «Nuevo contrato (manual)» y «Nueva cotización» y contó las opciones del selector de asesor, y leyó con el propio acceso de cada cuenta el catálogo de servicios y de tarifas. Léela antes de decidir con qué cuenta recorrer los pasos de creación.
- **Qué debe verse:** HALLAZGO PREEXISTENTE (no lo introduce esta revisión: la regla de acceso a «usuarios» es la de la migración 005 y los formularios ya leían así; solo la conversión de cotizaciones tiene una lista de asesores propia, la de O-3). Selector de asesor en «Nuevo contrato (manual)» y «Nueva cotización»: superadmin ve a Rev Venta y Rev Venta Dos; venta ve solo a sí misma; gerencia, administración y operaciones lo ven VACÍO (y el campo es obligatorio: con esas cuentas no se puede crear un contrato manual ni una cotización manual). En la conversión de una cotización («Confirmar → generar contrato») gerencia, administración y operaciones SÍ reciben la lista de asesores. Catálogo: venta no lee el catálogo de servicios ni las tarifas por categoría (protegidos desde la 144/146), así que con venta los pasos que eligen servicios del catálogo o precargan categoría/régimen no funcionan; los demás roles del personal sí lo leen. Consecuencia práctica hoy: los pasos B95-13 al B95-16 y B95-20 solo se pueden completar con superadmin (la cuenta del dueño), y la creación de contratos por una cuenta de personal que no sea superadmin solo es posible con venta (B2-04b, B2-12, NETO-03…).
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

## Decisiones de política que siguen abiertas (no son pruebas)

- **Alertas de fin de compra (zona «Alertas», migración 344):** «Revisado» es por persona (¿debe un solo «Revisado» limpiar la alerta para todos?), alcance de las alertas de hotel y servicio (hoy todas las vigencias de un hotel o servicio activo, incluidas promociones), quién las recibe (hoy: superadmin, gerencia, administración y operaciones de la agencia; ¿también venta?), umbral (reutiliza «días de anticipación», 5 por defecto), ventana de «presencia reciente» (10 minutos) y la campana añadida al CRM.
- **#103:** remitente y dirección de respuesta, destinatarios internos, formato y catálogo por proveedor, latencia del barrido diario, elegibilidad del primer barrido y ruta final del correo.
- **Soportes (#339):** si los contratos cancelados deben seguir en el listado.
- **Antes de publicar:** orden de migraciones 327→348 con su preflight/postcheck (una consulta integral cada una), revisión de bloqueos activos sin neto real y verificación en la nube.

