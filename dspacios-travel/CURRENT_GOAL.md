# CURRENT_GOAL.md

Cerrado (PR #324, squash `b673f9cb`, 2026-09-22): **Rediseño del login** (`/login`) — etapa preparatoria del rediseño integral de UI. Selector visual Portal B2B/Portal Admin sin autoridad sobre permisos, panel informativo con capacidades reales, logo oficial, acceso rápido server-gated, y único acceso público al portal desde el tarifario (`/login`, sin el botón antiguo `/portal/b2b`). Ver `TASKS.md` (sección "Cerrado recientemente") y `DECISIONS.md` (ADL-025) para el detalle completo.

Cerrado (PR #326, squash `412de253`, 2026-09-22): **Rediseño del Dashboard administrativo**. Shell visual sobre tokens propios `--dash-*`, TenantSwitcher accesible, KPI reales con barra de progreso solo cuando hay numerador/denominador reales (Contratos, Cupos, Cartera por moneda, Pagos por vencer, Conciliaciones, DIAN y Retenciones — estas tres últimas gateadas a roles contables), meta general mensual persistida (`meta_ventas_mensual`, migración 185) comparada solo contra ventas efectivas (`confirmado`/`activo`, nunca `pendiente`/`cancelado`), agregación en base vía 6 funciones `SECURITY INVOKER` (migración 186) en vez de descargar filas completas, y eliminación completa del sistema de cambio de temas (UI única en Dashboard, Tarifario/Vista Booking y Login). Ver `TASKS.md` (sección "Cerrado recientemente") y `DECISIONS.md` (ADL-026, ADL-027) para el detalle completo.

---

Objetivo actual: **Rediseño de Vista Booking**.

Etapa inicial (auditoría, aún no iniciada):
- Auditar Vista Booking real (`app/tarifario/VistaBooking.tsx` y componentes asociados — `BuscadorBooking.tsx`, `tarjetaHotelCompartida.tsx`, `HotelModal`, tarjetas persona/unidad-Bernalo) antes de modificar código.
- Identificar qué pantallas/componentes existen hoy, qué permisos gobiernan el acceso público/autenticado y qué consultas/operaciones reales alimentan cada vista (precio, disponibilidad, Incluye/add-ons por paquete).

Alcance:
- Conservar el logo, el nombre D'Spacios Travel y el tratamiento de marca vigente (mismo criterio que Login y Dashboard: `components/Logo.tsx`, sin reconstruir el isotipo).
- Mantener intacta la lógica funcional, precios, disponibilidad, fuentes autoritativas y motores de cálculo existentes de Vista Booking — el rediseño es visual, no funcional.
- Redefinir estructura y sistema visual a partir de una referencia acordada, sin inventar módulos, métricas ni estados en vivo que no existan realmente.
- Único sistema visual de la app: no introducir variantes ni mecanismos de cambio de tema (ver `DECISIONS.md` ADL-027).

Fuera de alcance:
- No tocar precios, reservas, disponibilidad, fuentes autoritativas ni motores de cálculo.
- No modificar SQL, migraciones ni configuración de roles/permisos.
- No reabrir el login (PR #324) ni el Dashboard administrativo ya cerrados (PR #326).
- No abordar otros pendientes de `TASKS.md` bajo este objetivo.
- Implementación NO iniciada: este documento registra el objetivo siguiente, la auditoría y el plan de fases van antes de tocar código.

Criterio de cierre de la etapa de auditoría:
- Inventario real de Vista Booking (pantallas, componentes, permisos, consultas) documentado.
- Alcance visual acordado: qué se redefine y qué se conserva.
- Plan de implementación por fases que aísle el frente visual del funcional, listo para pasar a una etapa de construcción.
