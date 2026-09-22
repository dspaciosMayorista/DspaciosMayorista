# CURRENT_GOAL.md

Cerrado (PR #322, squash `73339a1f`, 2026-09-21): **Ordenar el resto del inventario hotelero**. Ver `TASKS.md` (seccion "Cerrado recientemente") y `DECISIONS.md` (ADL-022, ADL-023, ADL-024) para el detalle completo.

Cerrado (PR #324, squash `b673f9cb`, 2026-09-22): **Rediseño del login** (`/login`) — etapa preparatoria del rediseño integral de UI. Selector visual Portal B2B/Portal Admin sin autoridad sobre permisos, panel informativo con capacidades reales, logo oficial, acceso rápido server-gated, y único acceso público al portal desde el tarifario (`/login`, sin el botón antiguo `/portal/b2b`). Ver `TASKS.md` (sección "Cerrado recientemente") y `DECISIONS.md` (ADL-025) para el detalle completo.

---

Objetivo actual: **Rediseño del Dashboard administrativo**.

Etapa inicial:
- Auditar el Dashboard real (rutas `/dashboard/**`) contra la referencia visual de Stitch, antes de modificar código.
- Identificar qué pantallas/componentes existen hoy, qué permisos gobiernan cada módulo (`lib/roles.ts`, `LECTURA_MODULO`, `MODULO_POR_RUTA`) y qué consultas/operaciones reales alimentan cada vista.

Alcance:
- Conservar el logo, el nombre D'Spacios Travel y el tratamiento de marca vigente (mismo criterio que en el login: `components/Logo.tsx`, sin reconstruir el isotipo).
- Mantener intacta la lógica funcional, los permisos por rol, las consultas y las operaciones existentes del Dashboard — el rediseño es visual, no funcional.
- Redefinir estructura y sistema visual a partir de la referencia, sin inventar módulos, métricas ni estados en vivo que no existan realmente.

Fuera de alcance:
- Vista Booking queda fuera de alcance hasta cerrar el Dashboard.
- No tocar precios, reservas, disponibilidad, fuentes autoritativas ni motores de cálculo.
- No modificar SQL, migraciones ni configuración de roles/permisos.
- No reabrir el login ya cerrado (PR #324) ni el motor de orden/filtros de inventario (PR #322).
- No abordar otros pendientes de `TASKS.md` bajo este objetivo.

Criterio de cierre de la etapa de auditoría:
- Inventario real del Dashboard (pantallas, componentes, permisos, consultas) documentado.
- Alcance visual acordado: qué se redefine y qué se conserva.
- Plan de implementación por fases que aísle el frente visual del funcional, listo para pasar a una etapa de construcción.
