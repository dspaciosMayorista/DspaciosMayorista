# CURRENT_GOAL.md

Estado al 2026-10-08. Este archivo describe solo el objetivo del **chat coordinador**. No es un objetivo global que impida trabajar en varios chats aislados.

Objetivo activo: mantener `TASKS.md` como backlog unico y `WORKSTREAMS.md` como tablero de propietarios, archivos reservados, dependencias y migraciones. Abrir auditorias en paralelo cuando sean de solo lectura; habilitar codigo en paralelo solo tras comprobar que no comparte superficies ni espera resultados de otro frente.

La coordinacion actual parte de `main` `97924fce` (PR #351, CRM leads, integrado). La migracion 202 ya se aplico en Produccion y paso su postcheck; el usuario valido el alta. La 203 tambien esta integrada y aplicada. #38, tarjetas y los frentes de cotizaciones/identidad se siguen por separado en `WORKSTREAMS.md`; sus estados deben confirmarse con cada dueno antes de reanudar.

El checkout principal `C:\Users\Asus\Documents\DspaciosMayorista` ya esta limpio en `main` `97924fce`, igual a `origin/main`. Sus 66 cambios rastreados y 122 archivos nuevos anteriores se restauraron, sin commit, en `.claude/worktrees/vuelos-editar-rescate-20261008`, sobre la rama original; ese conjunto mezcla varios frentes y no debe integrarse como una sola entrega. El stash `d5c76eba` se conserva como respaldo. El trabajo documental de coordinacion sigue sin commit en un worktree aislado hasta que el usuario decida integrarlo.

Cada chat recibe del coordinador un objetivo de `TASKS.md`, un gate (`AUDITORIA` o `CODIGO`), un worktree propio y los limites de `WORKSTREAMS.md`. Su prompt es su objetivo activo. Opus y OpenCode pueden colaborar dentro de ese chat, con un solo responsable de implementacion por problema. El usuario controla staging, commit, push, merge, SQL remoto y validacion en Vercel.
