# CURRENT_GOAL.md

Objetivo actual: **Recalcular paquetes al editar tarifas o promociones** — mantener coherentes los paquetes que usan un hotel cuando cambian sus tarifas o promociones.

Alcance:
- Recalcular automaticamente todos los paquetes que usan un hotel cuando se guarda, edita o elimina una tarifa o promocion.
- Respetar promociones restringidas por alimentacion sin borrar tarifas base validas de otros planes.
- Cubrir edicion, eliminacion y relaciones entre hotel, tarifa, promocion y paquete.

Fuera de alcance:
- No implementar ni diagnosticar codigo todavia en esta rama documental.
- No tocar el flujo de tarjetas/motor externo ya cerrado ni migraciones no relacionadas.
- No abordar otros pendientes de `TASKS.md`.

Criterio de cierre:
- Guardar, editar o eliminar una tarifa/promocion recalcula los paquetes afectados.
- Las promociones restringidas por alimentacion no borran tarifas base validas de otros planes.
- Cobertura de edicion, eliminacion y relaciones hotel-tarifa-promocion-paquete.
- Pruebas y validacion del usuario segun el flujo acordado.
