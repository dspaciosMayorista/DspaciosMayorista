# Traslado de trabajo al otro PC — 2026-10-22

El remoto es `https://github.com/dspaciosMayorista/DspaciosMayorista.git`. Estas ramas `codex/backup-*-20261022` son respaldos WIP; no se crearon PR, no se fusionaron y no se aplicó SQL. Las ramas remotas de PR existentes no se actualizaron con estos respaldos.

## Recuperación

En el otro PC, clonar el repositorio (o ejecutar `git fetch origin` si ya existe). `git pull` solo actualiza la rama actualmente abierta: los frentes de abajo se recuperan por separado desde `origin/codex/backup-...`. Ejemplo en PowerShell, desde la raíz del clon:

```powershell
git fetch origin
git worktree add -b codex/43-1a-recuperada ..\contable-43-1a origin/codex/backup-43-1a-20261022
```

`backup-main-docs` y `backup-coordination` contienen documentos de coordinación de checkouts distintos y pueden solaparse; revisar sus diferencias antes de integrarlos. El respaldo `backup-vuelos-rescate` conserva 188 archivos de trabajo antiguo, incluida una diferencia de formato en la migración 199 aplicada; es solo para recuperación, no para fusionar o aplicar sin auditoría. Los respaldos WIP no significan pruebas aprobadas.

## Worktrees que tenían archivos sin commit

| Frente | Rama remota de respaldo |
| --- | --- |
| Documentos del checkout principal | `codex/backup-main-docs-20261022` |
| Coordinación y bitácoras | `codex/backup-coordination-20261022` |
| #43 contable | `codex/backup-43-contable-20261022` |
| #43-1a calendario | `codex/backup-43-1a-20261022` |
| #43-1b libros | `codex/backup-43-1b-20261022` |
| Dinámicos en Vista Booking | `codex/backup-dinamicos-booking-20261022` |
| Hotfix DTM 0557 | `codex/backup-dtm-0557-20261022` |
| #49 menú móvil | `codex/backup-49-menu-20261022` |
| #56 SalesBot | `codex/backup-56-salesbot-20261022` |
| #22 tarifas hotel móvil | `codex/backup-22-movil-20261022` |
| Rescate vuelos | `codex/backup-vuelos-rescate-20261022` |
| CRM leads | `codex/backup-crm-leads-20261022` |
| Tarifas/promociones | `codex/backup-tarifas-promo-20261022` |

## Worktrees limpios con commits que solo estaban en este PC

| Frente | Rama remota de respaldo |
| --- | --- |
| Migración fecha de negocio 198 | `codex/backup-migracion-198-20261022` |
| Vuelos 201 | `codex/backup-vuelos-201-20261022` |
| Comisión #38 | `codex/backup-38-comision-20261022` |
| Contratos NETO #30 | `codex/backup-30-neto-20261022` |
| Contrato manual NETO #30 | `codex/backup-30-manual-20261022` |
| Acceso CRM contactos | `codex/backup-crm-contactos-20261022` |
| Scroll dashboard pasajeros | `codex/backup-dashboard-scroll-20261022` |
| Eliminar hotel | `codex/backup-eliminar-hotel-20261022` |
| Financiero #44 K15 | `codex/backup-44-k15-20261022` |
| CRM leads v2 | `codex/backup-crm-leads-v2-20261022` |
| Código fecha de negocio 198 | `codex/backup-codigo-fecha-198-20261022` |
| Tarifas 203 | `codex/backup-tarifas-203-20261022` |
| Tarjetas de servicios | `codex/backup-tarjetas-servicios-20261022` |

## Archivos ignorados para recrear manualmente

No se leyó ni se versionó el contenido de estos archivos:

- `C:\Users\Asus\Documents\DspaciosMayorista\dspacios-travel\.env.local`
- `C:\Users\Asus\Documents\DspaciosMayorista\dspacios-travel\.env.example`
- `C:\Users\Asus\Documents\DspaciosMayorista\.claude\settings.json`
- `C:\Users\Asus\Documents\DspaciosMayorista\.claude\settings.local.json`
- `C:\Users\Asus\Documents\DspaciosMayorista\.claude\worktrees\dashboard-scroll-pasajeros-minorista\dspacios-travel\.env.local`

Las carpetas ignoradas `.claude/worktrees`, `dspacios-travel/node_modules`, `.next`, `.pnpm-store` y `supabase/.temp`/`.branches` no se recrean archivo por archivo: los worktrees salen de las ramas de respaldo; dependencias y cachés se regeneran. `next-env.d.ts`, `tsconfig.tsbuildinfo` y `.claude/scheduled_tasks.lock` son generados. No copiar `supabase/.temp/start-secrets` ni subir secretos a Git.
