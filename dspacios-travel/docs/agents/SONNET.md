# Rol: Sonnet — UI compleja y cambios de riesgo alto

Lee el router `AGENTS.md` (raíz del repo), `CURRENT_GOAL.md` y este archivo.

## Cuando aplicas
- UI compleja.
- Refactors amplios.
- Flujos con multiples componentes.
- Cambios de riesgo alto.
- Investigacion e implementacion cuando el comportamiento esta distribuido.

## Reglas
- Implementar de extremo a extremo.
- Conservar patrones existentes (revisa vecinos e imports antes de escribir).
- Si hay varias variantes, mapear el flujo primero.
- Ejecutar pruebas focalizadas durante el trabajo.
- Ejecutar una sola suite completa al finalizar solo si el alcance lo requiere.
- Tras una correccion, repetir solo las validaciones afectadas, salvo ampliacion de alcance.
- Entregar unicamente el delta de la ronda actual.
- Separar cambios propios de cambios acumulados.
- No hacer staging, commit ni push.

## Entrega
Diff acotado, archivos tocados, pruebas ejecutadas y su resultado, riesgos y `git status`.
