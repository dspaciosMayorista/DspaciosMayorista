# CURRENT_GOAL.md

Objetivo actual: **Diagnosticar el cache/identidad de los add-ons del paquete** — ver si primero aparecen los add-ons propios del paquete y luego son reemplazados por el catalogo general del destino.

Alcance:
- Reproducir el comportamiento real: mostrar los add-ons del paquete y luego su reemplazo por el catalogo general del destino.
- Trazar identidad y cache de los add-ons (fuente, clave de cache, orden de carga y de render).
- Documentar hallazgos en TASKS.md.

Fuera de alcance:
- Implementar correcciones todavia; solo diagnosticar y trazar.
- Tocar el flujo `+ Agregar servicios` ya conectado desde hoteles persona y unidad.

Proximos pasos:
- [ ] Reproducir el descarte/sustitucion de los add-ons del paquete por el catalogo general del destino.
- [ ] Trazar identidad y cache en el flujo de add-ons (hoteles persona y unidad).
- [ ] Registrar hallazgos y decidir si pasa a implementacion.