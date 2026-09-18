# PROMPTS.md — plantillas para el usuario

Archivo de copia/pega. Los agentes NO lo leen automaticamente.
Completa los placeholders: `<RAMA>`, `<OBJETIVO>`, `<ARCHIVOS>`, `<PR>`, `<AGENTE>`, `<ARCHIVO_ROL>`.

## A. Implementacion nueva
Objetivo: <OBJETIVO>

Proyecto: `C:\Users\Asus\Documents\DspaciosMayorista\dspacios-travel`
Rama esperada: <RAMA>
Rol: <AGENTE>

Lee antes de empezar:
- `C:\Users\Asus\Documents\DspaciosMayorista\AGENTS.md` (router)
- `dspacios-travel/CURRENT_GOAL.md`
- `dspacios-travel/docs/agents/<ARCHIVO_ROL>`
- `git status` y el diff de la rama

Alcance:
- <ARCHIVOS>

Pruebas:
- Ejecuta pruebas focalizadas durante el trabajo.
- Una sola suite completa al final si el alcance lo requiere.
- Reporta solo lo que ejecutaste.

Prohibido: staging, commit, push, SQL remoto y validacion en Vercel.
No afirmes validaciones que no ejecutaste.

## B. Correccion en la misma conversacion
Conserva el contexto anterior; no releas archivos de coordinacion.
Corrige unicamente este hallazgo: <OBJETIVO>
Revisa solo los archivos afectados (<ARCHIVOS>) y el diff nuevo.
Repite unicamente las validaciones afectadas.
Entrega solo el delta de esta ronda (no repitas cambios ya aceptados).
Prohibido: staging, commit, push.

## C. Coordinacion posterior a merge
Verifica que estamos en `main`, actualizado con `origin/main` y con working tree limpio.
Crea la rama documental: <RAMA>
Verifica el PR/commit indicado: <PR>. Si no esta mergeado, detente y reportalo.

Lee:
- `C:\Users\Asus\Documents\DspaciosMayorista\AGENTS.md` (router)
- `dspacios-travel/docs/agents/OPENCODE.md`
- `dspacios-travel/TASKS.md`
- `dspacios-travel/CURRENT_GOAL.md`
- `git status` e historial/diff minimo para verificar el merge

Actualiza `TASKS.md`, `CURRENT_GOAL.md`, `DECISIONS.md` y `PROJECT_MAP.md`.
No toques codigo, pruebas, SQL ni configuracion.
No hagas staging, commit ni push.
