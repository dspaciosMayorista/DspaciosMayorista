# CURRENT_GOAL.md

Objetivo actual: **Compactar el flujo Codex, Sonnet y OpenCode** — reducir el costo y la ambigüedad de cada entrega con documentación modular por rol y lectura mínima.

Estado: estructura modular implementada en esta rama. **No cerrado**: se cierra después de la auditoría de Codex y la validación del usuario.

Implementado:
- Router universal en `AGENTS.md` (raíz del repo).
- Archivos de rol en `docs/agents/`: `CODEX.md`, `SONNET.md`, `OPENCODE.md`, `DEEPSEEK.md` y `PROMPTS.md`.
- Lectura mínima por situación: tarea nueva, corrección en la misma conversación y actualización posterior a merge.

Criterios pendientes de validación (auditoría Codex + usuario):
- Rutas y enlaces entre documentos correctos.
- Sin reglas contradictorias ni duplicadas.
- Cada agente puede operar leyendo solo su archivo de rol.
- Un solo implementador por problema y una sola suite completa por entrega cuando corresponda.
- Plantillas de `PROMPTS.md` confirmadas por el usuario.

Fuera de alcance:
- No cerrar el objetivo hasta la auditoría y validación.
- No implementar código funcional.
- No tocar otros pendientes de `TASKS.md`.
