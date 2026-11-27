# Guía del dueño — Titular de la cotización antes de decidir (B2-11 / B2-12a) — texto para incorporar a la guía

Antes / ahora: ANTES el titular solo se veía abriendo «Ver / Imprimir cotización» (y, en las dinámicas abiertas, dentro del editor «Datos del titular»). AHORA la propia pantalla de la cotización muestra una tarjeta «Titular de la cotización» (solo lectura) y el listado trae el documento enmascarado y el contacto. Lo que ya existía no cambia: ver, aceptar, descartar y convertir siguen siendo acciones distintas; «Atendida» sigue significando solo «convertida a contrato».

Datos de la prueba (cargar `semillas/rev2/b2holder.sql` en una copia): «Titular Ficha Uno» (dinámica abierta) y «Titular Ficha Dos» (carrito de un freelance). Para el visitante de B2-12a se usa la cotización que crea el propio paso B2-04.

### B2-11 (ampliado) — El titular está a la vista antes de decidir

- **Cuenta:** gerencia@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/cotizaciones
- **Qué hacer:** 1) Abre Cotizaciones y mira la columna «Cliente» de «Titular Ficha Uno». 2) Pulsa «Ver →» en esa fila (NO pulses «Ver / Imprimir cotización»). 3) Baja a la tarjeta «Titular de la cotización». 4) Abre «¿Cuándo se guarda este titular en el CRM?». 5) Repite con «Titular Ficha Dos». 6) Repite en el celular y a ancho intermedio.
- **Qué debe verse:** 1) Bajo el nombre aparece una línea gris «••••0001 · 3115550001 · ficha.uno@consolidada.test» (documento enmascarado: solo los últimos 4). 2–3) La tarjeta, SIN abrir el documento imprimible, dice: Nombre «Titular Ficha Uno», Documento «CC 88100001», Nacimiento «1988-03-15», Teléfono «3115550001», Correo «ficha.uno@consolidada.test»; «Origen: Cotización dinámica · personal interno · asesor Rev Venta»; «Adultos: 2 · Niños: 1 · Infantes: 1»; «Viajeros con datos guardados (1)»: «Viajero Ficha Uno · CC 88100002 · Nac. 1990-07-20». Si la persona está registrada, la nota dice «Titular registrado en Personas de cotización.» (en la semilla sin registro puede decir «Pendiente de registrar… usa «Reintentar»»: es el aviso de siempre, no un error nuevo). 4) El texto explica que se registra al crear o guardar la cotización, no al verla, aceptarla, descartarla ni convertirla. 5) «Titular Ficha Dos»: «Aliado: Freelance Humo (freelance) · El titular de abajo es el viajero, no el aliado.»; Documento «88200001 (tipo no registrado)» (no inventa «CC»); Nacimiento, Teléfono y Correo dicen «No registrado». 6) Nada se sale de la tarjeta; en el celular los campos van en una columna.
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### B2-12a (ampliado) — Ver quién es el titular de la solicitud antes de cargar la neta

- **Cuenta:** operaciones@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/cotizaciones
- **Qué hacer:** Con la cuenta de operaciones abre la cotización «pendiente de tarifa» del visitante (la creada en B2-04) y, ANTES de escribir la neta, mira la tarjeta «Titular de la cotización». Después sigue con «Cargar neta y valorar» como en el paso original.
- **Qué debe verse:** La tarjeta (encima de «Pendiente de valoración») muestra Nombre «Visitante Revision», Documento «77100001 (tipo no registrado)» (el tipo solo aparece si el visitante lo eligió; nunca se supone «CC»), Teléfono «3115550000», «Origen: Solicitud de hotel bajo solicitud · visitante del tarifario público (sin sesión)» y las cantidades de la solicitud (Adultos / Menores / edades). La cuenta de venta ve la misma tarjeta pero no puede cargar la neta. Tras valorar, la misma tarjeta sigue arriba de «Confirmar → generar contrato» / «Descartar», y después de convertir sigue visible con el estado «convertida».
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

### Respuesta a la pregunta del dueño: ¿cuándo se guarda el titular en el CRM?

- Se registra en «Personas de cotización» (CRM) **al crear la cotización** (o al guardar el titular de una dinámica abierta, o con «Reintentar»), no al aceptar, descartar ni convertir. Solo si hay un dato identificable (documento, nombres o apellidos).
- Además se intenta agregar como «contacto de campañas» (cliente final) cuando la cotización nace del carrito del tarifario, de una solicitud de hotel o de un paquete dinámico público; si ya existe un contacto con el mismo documento, correo o teléfono no se sobrescribe. Las cotizaciones armadas por el personal (dinámicas, Reservar, comparativas) no crean contacto de campañas.
- Convertir en contrato no crea personas ni contactos nuevos; descartar no borra nada.
