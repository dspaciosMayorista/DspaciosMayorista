# CURRENT_GOAL.md

Objetivo actual: **Ordenar el resto del inventario hotelero** — definir y aplicar el orden del inventario no recomendado manteniendo los recomendados y la identidad por oferta.

Alcance:
- Definir y aplicar el orden del inventario no recomendado.
- Considerar precio, estrellas/localizacion y etiquetas.
- Respetar la oferta `(hotelId, paqueteId)`.
- No alterar las prioridades 1-6 ya cerradas.

Fuera de alcance:
- No rediseñar tarjetas.
- No cambiar precios, disponibilidad, Incluye/add-ons ni fuentes autoritativas.
- No tocar las migraciones 183/184.
- No abordar otros pendientes de `TASKS.md`.

Criterio de cierre:
- Orden determinista acordado.
- Los recomendados permanecen primero segun sus reglas.
- Resto ordenado sin mezclar identidad, precio ni contenido entre ofertas.
- Pruebas y validacion visual.