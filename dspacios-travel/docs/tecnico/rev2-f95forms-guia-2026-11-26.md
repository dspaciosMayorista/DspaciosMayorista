# Guía del dueño — Formularios manuales (#95): destino, hoteles, fechas, infantes, compra y acomodación

Pasos para B95-13, B95-14, B95-15 y B95-20 de la revisión consolidada. Cuentas de la revisión: `<alias>@consolidada.test` / `Consolidada2026!`. Por limitaciones del rol (los selectores de asesor están vacíos salvo superadmin), estos pasos se hacen con **superadmin@consolidada.test**.

**Datos sintéticos que usan estos pasos** (los carga la persona que coordina con `supabase/scripts/revision_consolidada/semillas/rev2/f95forms.sql`): destinos «SAN ANDRÉS F6» y «CARTAGENA F6»; «Hotel Marina F6» (San Andrés, con proveedor configurado «Hoteles Isla F6 SAS»), «Hotel Capilla del Mar F6» (Cartagena, **sin** proveedor configurado) y «Hotel Solo Adultos F6» (San Andrés, solo adultos). Antes de hacer estos pasos la migración 346 debe estar aplicada (si no, el contrato manual del paso B95-15-b no se guarda).

> **Antes / ahora.** *Antes:* el destino se escribía a mano, la lista de hoteles mostraba todos los hoteles del catálogo, la acomodación era un texto libre («1 doble») sin ninguna revisión, se podía poner un regreso anterior a la salida (si primero se escribía el regreso y luego se movía la salida) y no había una forma explícita de decir si el hotel se compró directo o por plataforma (el proveedor a pagar salía de lo que hubiera escrito en dos cajas distintas). *Ahora:* todo lo anterior está elegido o validado en pantalla **y** vuelto a validar en el servidor.

### B95-13-a — El destino se elige del catálogo y solo salen los hoteles de ese destino

- **Cuenta:** superadmin@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/cotizaciones/nueva
- **Qué hacer:** 1) Pulsa **Hotel** para agregar una fila de hotel. 2) En «Nombre del servicio» de ese hotel haz clic y mira la lista que se despliega: debe estar vacía y debajo dice «Elige primero el destino para ver los hoteles del catálogo; también puedes escribir un hotel manual». 3) En «Destino (del catálogo)» escribe «SAN» y elige **SAN ANDRÉS F6**. 4) Vuelve a mirar la lista de hoteles. 5) Elige «Hotel Marina F6».
- **Qué debe verse:** con San Andrés la lista ofrece «Hotel Marina F6» y «Hotel Solo Adultos F6», **nunca** «Hotel Capilla del Mar F6» (es de Cartagena). Al elegir «Hotel Marina F6» aparece la insignia verde «Del catálogo» y la caja «Proveedor del hotel (compra directa)» se llena con «Hoteles Isla F6 SAS» (es una copia que puedes editar; el catálogo no cambia). Si escribes un hotel que no está en la lista (ej. «Posada Nativa») aparece «Hotel manual (no está en el catálogo)» y el proveedor queda vacío.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B95-13-b — Cambiar el destino no deja un hotel incompatible

- **Cuenta:** superadmin@consolidada.test · **Enlace:** http://localhost:3090/dashboard/cotizaciones/nueva
- **Qué hacer:** Con «Hotel Marina F6» elegido (paso anterior), cambia el destino a **CARTAGENA F6**.
- **Qué debe verse:** el hotel se vacía (también su proveedor copiado) y aparece un aviso ámbar: «Se quitó el hotel «Hotel Marina F6»: no pertenece al destino elegido. Elige otro hotel del destino o escríbelo como hotel manual». La lista ahora ofrece «Hotel Capilla del Mar F6».
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B95-13-c — Lo mismo en el contrato manual (y la ciudad ya viene puesta)

- **Cuenta:** superadmin@consolidada.test · **Enlace:** http://localhost:3090/dashboard/contratos/nuevo
- **Qué hacer:** Deja el tipo «Dinámico (todo manual)». En «Datos del viaje» elige el destino **SAN ANDRÉS F6**. Baja a «Hoteles» → «+ Agregar hotel» y escribe «Hotel Marina F6» en «Hotel».
- **Qué debe verse:** la lista del hotel solo trae los de San Andrés; «Ciudad» ya dice «SAN ANDRÉS F6» (no hay que escribirla) y el proveedor trae «Hoteles Isla F6 SAS». Si antes de elegir destino abres la lista, está vacía con la misma ayuda.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B95-14 — El regreso no puede ser anterior a la salida

- **Cuenta:** superadmin@consolidada.test · **Enlace:** http://localhost:3090/dashboard/cotizaciones/nueva (y repite en /dashboard/contratos/nuevo)
- **Qué hacer:** Pon **Fecha ida 10/03/2030** y **Fecha regreso 13/03/2030** (válido). Ahora cambia la **Fecha ida a 20/03/2030** (queda después del regreso).
- **Qué debe verse:** debajo del regreso aparece en rojo «La fecha de regreso no puede ser anterior a la fecha de salida», aparece la lista roja de pendientes sobre el botón y **«Generar cotización» / «Generar contrato» está desactivado**. Al poner el regreso 23/03/2030 el aviso desaparece. (Aunque alguien lo intentara por fuera de la pantalla, el servidor también lo rechaza: «No se creó nada».)
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B95-15-a — Infantes explícitos

- **Cuenta:** superadmin@consolidada.test · **Enlace:** http://localhost:3090/dashboard/cotizaciones/nueva
- **Qué hacer:** En «Datos del viaje» mira el campo nuevo **Infantes** (junto a Niños). Escribe 1 con **Adultos = 0**; luego 1,5; luego vuelve a Adultos = 2 e Infantes = 1. Después elige «Hotel Solo Adultos F6» con Infantes = 1.
- **Qué debe verse:** con 0 adultos: «Un infante necesita al menos un adulto en el viaje»; con 1,5: «Adultos, niños e infantes deben ser números enteros (0 o más)». Con Adultos 2 / Infantes 1 se acepta (los infantes no suman tarifa ni ocupan plaza de adulto). Con el hotel solo adultos: «El hotel «Hotel Solo Adultos F6» es solo para adultos (Adults Only) y el viaje incluye niños o infantes». Al guardar, el dato de infantes queda en la cotización.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B95-15-b — Compra directa o por plataforma (quién es el proveedor a pagar)

- **Cuenta:** superadmin@consolidada.test · **Enlace:** http://localhost:3090/dashboard/cotizaciones/nueva
- **Qué hacer:** Destino CARTAGENA F6, elige «Hotel Capilla del Mar F6» (no tiene proveedor configurado). Mira el mensaje del hotel. Luego en «Cómo se compra» elige **Compra directa al hotel**; después **Compra por plataforma** y escribe «Despegar».
- **Qué debe verse:** sin elegir: «Indica cómo se compra «Hotel Capilla del Mar F6»: directa al hotel o por plataforma» (no hay valor por defecto). Con *directa* y sin proveedor: «Compra directa de «Hotel Capilla del Mar F6»: no hay proveedor (el hotel no tiene uno configurado en el catálogo). Escribe el proveedor de la compra o elige compra por plataforma» (nunca se usa la plataforma por su cuenta). Con *plataforma*: pide el nombre y la caja «Proveedor a pagar» muestra **Despegar** (la plataforma es el proveedor; el nombre del hotel no cambia). Para comprobar el efecto: llena precio, titular, guarda y conviértela; la obligación del hotel (Cuentas por pagar) queda a nombre de **Despegar**; con «Hotel Marina F6» en compra directa queda a nombre de **Hoteles Isla F6 SAS**.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B95-20 — Habitaciones por tipo en vez de texto libre

- **Cuenta:** superadmin@consolidada.test · **Enlace:** http://localhost:3090/dashboard/cotizaciones/nueva
- **Qué hacer:** Destino SAN ANDRÉS F6, hotel «Hotel Marina F6», compra directa, **Adultos = 3**. En «Habitaciones (cantidad por tipo)» escribe **1 en Doble**. Luego cambia Adultos a 2. Luego prueba Niños = 3.
- **Qué debe verse:** ya no existe una caja de texto «Acomodación»; hay contadores Sencilla/Doble (solo los tipos que ese hotel ofrece) y una nota opcional «Detalle». Con 3 adultos: «Las habitaciones elegidas (1 hab Doble) alojan 2 adulto(s); el viaje tiene 3. Agrega habitaciones o ajusta los adultos» y el botón queda desactivado; con 2 adultos desaparece; con 3 niños: «admiten máximo 2 niño(s)». El texto que se guarda («1 hab Doble») sale de los contadores, no de lo que se escriba. En el contrato manual la comparación se hace con los **pasajeros reales** (por fecha de nacimiento): 1 pasajero adulto con 1 Doble pide 2 adultos; con 1 Sencilla cuadra.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

**Qué NO cubre esta guía (decisiones abiertas, ver el informe):** destino obligatorio para todo documento manual nuevo; viajes de varias ciudades (un hotel de otro destino se escribe como «hotel manual»); selector de compra solo para hoteles; si una compra directa con proveedor distinto al del catálogo debe bloquearse; regreso el mismo día.
