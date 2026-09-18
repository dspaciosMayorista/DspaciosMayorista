# AGENTS.md — Router de coordinación (D'spacios Mayorista)

Router universal para cualquier agente. El detalle de cada rol vive en los archivos de la tabla de enrutamiento.

## Reglas universales
- Trabajar por defecto solo dentro de `dspacios-travel/`.
- `dspacios-travel/TASKS.md` es la única fuente de pendientes.
- `dspacios-travel/CURRENT_GOAL.md` contiene un solo objetivo activo.
- Un solo agente implementa cada problema; no delegar el mismo problema a varios.
- Codex audita; no modifica código salvo autorización explícita.
- El usuario ejecuta staging, commit, push, SQL remoto y validación en Vercel.
- No tocar cambios ajenos ni hacer refactors no pedidos.
- No afirmar validaciones no ejecutadas.
- No releer `CLAUDE.md` completo salvo petición explícita.
- Antes de ampliar una investigación a más de 3 archivos de código adicionales, presentar el alcance o pedir aprobación.
- En búsquedas amplias excluir `node_modules`, `.next`, `dist` y migraciones largas salvo necesidad.
- Mantener cambios pequeños y verificables.
- No leer `sitio-web/node_modules`; no leer ni imprimir `.env*` ni secretos.
- Nunca incluir secretos en logs, respuestas, diffs, commits ni comandos.
- Para configuración, confirmar nombres/existencia de variables sin revelar valores.
- Next 16: `proxy.ts` como middleware; nunca `middleware.ts`.
- Íconos con `lucide-react`; sin emojis en la UI.
- Migraciones Supabase: no editar existentes; crear una nueva numerada.

## Enrutamiento por rol
| Rol | Archivo |
| --- | --- |
| Codex | `dspacios-travel/docs/agents/CODEX.md` |
| Sonnet | `dspacios-travel/docs/agents/SONNET.md` |
| OpenCode | `dspacios-travel/docs/agents/OPENCODE.md` |
| DeepSeek | `dspacios-travel/docs/agents/DEEPSEEK.md` |
| Plantillas para el usuario | `dspacios-travel/docs/agents/PROMPTS.md` |

## Lectura mínima por situación
- **Tarea nueva:** este archivo, `dspacios-travel/CURRENT_GOAL.md`, el archivo del rol, `git status` y el diff de la rama. `dspacios-travel/TASKS.md` solo al elegir o cerrar un pendiente; `DECISIONS.md`/`PROJECT_MAP.md` solo si el objetivo necesita antecedentes arquitectónicos o localización adicional.
- **Corrección en la misma conversación:** no releer coordinación; solo archivos afectados, diff nuevo y pruebas relacionadas. Releer coordinación solo si cambió la rama, cambió el objetivo o apareció una contradicción.
- **Actualización posterior a merge:** este archivo, `dspacios-travel/docs/agents/OPENCODE.md`, `dspacios-travel/TASKS.md`, `dspacios-travel/CURRENT_GOAL.md`, `git status` e historial/diff mínimo para verificar el merge.
