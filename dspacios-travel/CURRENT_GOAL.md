# CURRENT_GOAL.md

Objetivo actual: **Evitar snapshots desactualizados durante la recalculacion** — que no se publiquen ni sirvan snapshots antiguos mientras se recalculan paquetes.

Alcance:
- Identificar donde y cuando se recalcula un paquete y donde se sirve su snapshot.
- No publicar ni servir snapshots antiguos mientras el recalculo esta en curso.
- Cubrir fallos parciales, concurrencia e invalidacion segura del snapshot.

Fuera de alcance:
- No iniciar implementacion todavia: primero trazar el flujo de calculo/invalidacion.
- No tocar los demas pendientes de la cola.

Proximos pasos / criterio de cierre:
- [ ] Trazar el flujo: cuando se recalcula un paquete y donde se sirve el snapshot.
- [ ] Definir la estrategia de invalidacion segura (fallos parciales y concurrencia).
- [ ] Documentar los escenarios de fallo/concurrencia y proponer una estrategia de invalidacion segura, con archivos y pruebas que requeriria la futura implementacion.