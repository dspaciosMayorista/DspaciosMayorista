# CURRENT_GOAL.md

Estado al 2026-09-30.

**En `main`** (además de lo registrado al 2026-09-24): selectores buscables de catálogo en el panel (`27fa9402`, `eb274b5b`), resumen de política de reservas con "Ver más" (PR #332) y separación de los datos sensibles de proveedores cerrada con la migración 191 (PR #333, `92b3c51e`). Las migraciones 189 y 190 son prerrequisito de la 191; el usuario reporta la 191 aplicada en producción (no verificado desde el repositorio).

**Solo en la rama `ronda1-destinos-y-pruebas`** (commits `a5162cff`, `99599518`, `9bd81e35`; aún NO integrada a `main`): conteo de receptivos y modal de eliminación explicativo en Producto → Destinos, tarjetas compactas con listas de hoteles/receptivos en diálogo, apertura inmediata de listas pequeñas de receptivos (precarga limitada) y línea base de `test:unit` en verde (4.954/4.954, más `test:react` 167/167, TypeScript y build, ejecutados en la rama). Nada de esto está cerrado en `main` hasta su revisión y merge.

Objetivo activo: **validar e integrar la rama `ronda1-destinos-y-pruebas`**.

- Validar en Vercel Preview con datos reales: conteos y listas de receptivos (p. ej. Montería 0 hoteles / 5 receptivos), apertura inmediata y "Actualizar lista", roles sin acceso (`control_vuelo` sin insignia de receptivos) y modal de eliminación.
- Revisar el PR y decidir el merge; tras integrarlo, mover los pendientes #9, #10 y #6 de `TASKS.md` a "Cerrado recientemente" con su hash real.
- No incluir en este objetivo la otra queja del usuario sobre el modal de eliminación (se verá por separado) ni el flujo de eliminación en sí.

Después: validar el flujo de proveedor nuevo y el comportamiento con datos reales de ambas agencias (pendiente #1 de `TASKS.md`), y luego las tarjetas de Vista Booking (pendiente #2). Ver `TASKS.md` y `PROJECT_MAP.md`.

Trabajar en el repositorio normal `C:\Users\Asus\Documents\DspaciosMayorista` (app en `dspacios-travel`), comprobando raíz, rama, estado y remoto antes de editar. No usar un clon/worktree alterno salvo petición expresa. Las propuestas de `docs/futuro/` son borradores documentales: no autorizan implementarlas ni incorporarlas a la cola. No hacer commit, push ni merge sin instrucción del usuario.
