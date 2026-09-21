# CURRENT_GOAL.md

Cerrado (PR #322, squash `73339a1f`, 2026-09-21): **Ordenar el resto del inventario hotelero**. Ver `TASKS.md` (seccion "Cerrado recientemente") y `DECISIONS.md` (ADL-022, ADL-023, ADL-024) para el detalle completo.

---

Objetivo actual: **Rediseño integral de la interfaz de usuario** — etapa preparatoria. Todavía no se implementa UI, no se modifica código, SQL ni configuración.

Alcance de esta etapa (preparatoria):
- Recibir y auditar el código/diseños de referencia que aporte el usuario.
- Conservar el logo, el nombre D'Spacios Travel y el tratamiento de marca vigente.
- Redefinir estructura, sistema visual y componentes a partir de esa referencia.
- Mantener intacta la lógica funcional recién validada (orden/filtros de inventario, recomendados, condición/política ternaria, paginación, identidad de oferta).
- Separar explícitamente el rediseño visual de cualquier cambio de precios, reservas, datos o motores de cálculo — un cambio visual nunca debe tocar esas rutas.

Fuera de alcance (por ahora):
- No implementar UI todavía.
- No modificar código, SQL ni configuración.
- No tocar precios, reservas, disponibilidad, fuentes autoritativas ni motores de cálculo.
- No reabrir ni tocar el motor de orden/filtros de inventario ya cerrado (PR #322).
- No abordar otros pendientes de `TASKS.md` bajo este objetivo.

Criterio de cierre de esta etapa preparatoria:
- Material de referencia (código/diseños) recibido y auditado.
- Alcance visual acordado: qué se redefine (estructura, sistema visual, componentes) y qué se conserva (marca, lógica funcional).
- Plan de implementación por fases que aísle el frente visual del funcional, listo para pasar a una etapa de construcción.