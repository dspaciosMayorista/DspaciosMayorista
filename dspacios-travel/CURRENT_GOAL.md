# CURRENT_GOAL.md

Objetivo actual: **Conservar tarjetas completas en el motor externo** — mantener la tarjeta completa y cambiar solamente la fuente de precio y disponibilidad.

Primera etapa (diagnóstico, sin implementar):
- Localizar las tarjetas y modales del motor externo/Bernalo.
- Comparar su anatomía con la tarjeta completa del motor interno (`HotelModal` de `app/tarifario/VistaBooking.tsx`).
- Identificar exactamente qué contenido se pierde o reemplaza actualmente.
- Trazar dónde se sustituyen precio y disponibilidad.
- Determinar si existe componente compartido o composición reutilizable.

Reglas del objetivo:
- Mantener contenido, secciones, acciones y navegación de la tarjeta.
- Cambiar únicamente la fuente de precio y disponibilidad cuando sea motor externo.
- No mezclar datos internos con disponibilidad/precio Bernalo.
- Preservar responsive móvil/escritorio.
- No implementar todavía en esta rama documental.
- No abordar soporte unidad para dinámicos, servicios, empaquetados, vuelos o bloqueos.
- No tocar otros pendientes de `TASKS.md`.

Criterio de cierre futuro:
- Tarjeta externa visualmente completa.
- Precio y disponibilidad provenientes únicamente de la fuente externa.
- Sin pérdida de Incluye, acciones o información comercial aplicable.
- Sin regresión en tarjeta interna.
- Pruebas y validación visual móvil/escritorio.
