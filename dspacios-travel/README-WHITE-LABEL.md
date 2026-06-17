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

## Estado por fases
- ✅ **Fase 0 — Fundación** (migración `..._100_saas_organizaciones.sql`):
  tabla `organizaciones`, `usuarios.org_id`, helper `mi_org()`, RLS de la org.
  No cambia el comportamiento del sistema todavía.
- ⏳ **Fase 1 — `org_id` + RLS en todas las tablas de negocio** (+ setear org_id en
  cada insert y filtrar las consultas públicas por el org del host). *El grueso.*
- ⏳ **Fase 2 — Marca por organización + onboarding self-service** (des-hardcodear
  "D'spacios", wizard de alta + semilla de defaults, subdominios por agencia).
- ⏳ **Fase 3 — Planes, límites y cobro** + panel de administración de la plataforma.

## Importante
- Esta es una rama de desarrollo en progreso: hasta completar la Fase 1, NO está
  lista para producción multi-tenant (aún no aísla todas las tablas).
- Las migraciones de esta rama numeradas `..._100+` son EXCLUSIVAS del SaaS; no
  existen en la base de D'spacios.
