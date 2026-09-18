# CURRENT_GOAL.md

Objetivo actual: **Compactar el flujo Codex, Sonnet y OpenCode** — reducir el costo y la ambigüedad de cada entrega con prompts breves y roles claros.

Alcance:
- Preparar prompts breves que lean solo `PROJECT_MAP.md`, `CURRENT_GOAL.md`, `DECISIONS.md`, `TASKS.md`, `git status` y el diff relevante.
- Codex coordina, revisa riesgos y valida antes del commit.
- Sonnet se usa para UI compleja o revision independiente de alto riesgo.
- OpenCode/Antigravity/modelos gratuitos se prueban con tareas pequenas, mecanicas y bien delimitadas.
- DeepSeek queda para implementaciones puntuales cuando haga falta.
- El usuario ejecuta Git, SQL remoto y validacion visual en Vercel Preview.
- Ejecutar una sola suite completa por entrega; durante la implementacion, usar pruebas focalizadas.

Fuera de alcance:
- No delegar simultaneamente el mismo problema a varios agentes.
- No implementar todavia codigo funcional en esta rama documental.
- No tocar otros pendientes de `TASKS.md`.

Criterio de cierre:
- Prompts breves definidos y reutilizables por agente.
- Roles y limites de cada agente documentados y aplicados.
- Una sola revision por entrega y una sola suite completa por entrega.
