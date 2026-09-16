# AGENTS.md — Reglas de trabajo para agentes (D'spacios Mayorista)

Reglas permanentes para cualquier agente que trabaje en este repo.

1. Trabajar por defecto solo dentro de `dspacios-travel/`.
2. No leer `sitio-web/node_modules`.
3. No releer `CLAUDE.md` completo salvo petición explícita.
4. Al inicio pueden leerse sin aprobación: `AGENTS.md`, `TASKS.md`, `CURRENT_GOAL.md`, `DECISIONS.md`, `PROJECT_MAP.md`, `git status` y el diff relevante. Antes de ampliar la lectura a más de 3 archivos de código adicionales, pedir aprobación.
5. Antes de editar, presentar plan y lista exacta de archivos a tocar.
6. No hacer refactors no pedidos.
7. Next 16 usa `proxy.ts` como middleware; nunca crear `middleware.ts`.
8. Usar `lucide-react` para íconos; no usar emojis en la UI.
9. Migraciones Supabase: no editar migraciones existentes; crear una nueva con el
   siguiente número libre en la rama correcta.
10. En búsquedas amplias excluir `node_modules`, `.next`, `dist` y migraciones largas
    salvo que sean necesarias.
11. Respuestas de máximo 40 líneas salvo que el usuario pida detalle.
12. Mantener cambios pequeños y verificables.
13. Nunca leer ni imprimir archivos `.env*`, claves API, tokens, service_role keys
    ni secretos.
14. Si una tarea requiere configuración, pedir al usuario los nombres de variables o
    confirmar su existencia sin revelar valores.
15. No incluir secretos en logs, respuestas, diffs, commits ni comandos.