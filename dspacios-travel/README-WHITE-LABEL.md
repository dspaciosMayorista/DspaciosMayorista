# Edición SaaS White-Label (multi-tenant)

> **Esta rama (`saas-whitelabel`) es un PRODUCTO INDEPENDIENTE.**
> - Derivada del código de D'spacios Travel, pero **genérica y multi-tenant**.
> - **NO se mergea a `main`** ni tiene relación con la operación de D'spacios.
> - Se descarga y se despliega en **otra cuenta** (su propio Supabase + Vercel).
> - Objetivo: no reescribir el sistema desde cero para revenderlo como SaaS.

## Qué es
Una sola aplicación que sirve a **muchas agencias** (tenants = "organizaciones"),
con aislamiento de datos por `org_id` + RLS, marca propia por agencia, onboarding
y planes/cobro. El plano completo está en `docs/saas/arquitectura-multitenant.md`.

## Decisiones tomadas (Fase 1)
- **Identificación del tenant:** **path `/o/<slug>/...`** para lo público; el tenant
  interno sale del usuario logueado (`usuarios.org_id`). El subdominio se puede añadir
  después sin rehacer.
- **Catálogos base** (tributarios, edades, regímenes, formas de pago, categorías):
  **copiados por organización** (defaults colombianos sembrados al crear cada org).

## Estado por fases
- ✅ **Fase 0 — Fundación** (migración `..._100_saas_organizaciones.sql`):
  tabla `organizaciones`, `usuarios.org_id`, helper `mi_org()`, RLS de la org.
- ⏳ **Fase 1 — `org_id` en todas las tablas + RLS por org.** *El grueso, por pasos:*
  - ✅ **Paso 1** (migración `..._101_saas_org_id_backfill.sql`): crea la **org #1
    (D'spacios)**, asigna los usuarios actuales, agrega `org_id` (default temporal =
    org #1) + índice + backfill a TODAS las tablas de negocio. **No cambia el
    comportamiento** (sigue como una sola agencia). *Sincronizada con `main` (88
    commits) antes de empezar.*
  - ⏳ **Paso 2:** código setea `org_id` en cada insert (por módulo) + quitar el
    default temporal y poner `NOT NULL`.
  - ⏳ **Paso 3:** RLS por org en cada tabla (`org_id = mi_org()`); las de lectura
    pública resuelven el org desde el path `/o/<slug>`.
  - ⏳ **Paso 4:** rutas `/o/<slug>` (tarifario/sitio público por org) + resolución
    del org en el server desde el slug.
- ⏳ **Fase 2 — Marca por organización + onboarding self-service** (des-hardcodear
  "D'spacios", wizard de alta + semilla de defaults, subdominios por agencia).
- ⏳ **Fase 3 — Planes, límites y cobro** + panel de administración de la plataforma.

## Importante
- Esta es una rama de desarrollo en progreso: hasta completar la Fase 1, NO está
  lista para producción multi-tenant (aún no aísla todas las tablas).
- Las migraciones de esta rama numeradas `..._100+` son EXCLUSIVAS del SaaS; no
  existen en la base de D'spacios.
