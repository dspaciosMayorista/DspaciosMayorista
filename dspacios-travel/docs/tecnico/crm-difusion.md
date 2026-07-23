# CRM Difusión — hoja técnica

> Índice: [`README.md`](./README.md)

Sistema de rotación/programación de material promocional (flyers, videos, ofertas) para
difundir a clientes/aliados sin repetir el mismo contenido demasiado seguido. Vive en
`app/(crm)/crm/difusion/` (dentro del área CRM más amplia — Contactos/Campañas/Cargar B2B/
Config email son módulos hermanos, no parte de Difusión).

---

## 1. Modelo de datos

Migraciones: `20260601000114_crm_difusion.sql` (base) + `20260601000120_crm_plan_vigencia.sql`
(agrega `vigencia_hasta`).

- **`crm_material`** (inventario de piezas): `destino, hotel_producto, hotel_id` (FK opcional a
  `hoteles`, `on delete set null` — puede ser un producto fuera de catálogo, texto libre),
  `tipo_material` (flyer/video/reel/carrusel/estado/oferta…), `fuente` (material del
  hotel/propio), `estado` (informativo, default `'disponible'`), `prioridad` (alta/media/baja),
  `link_archivo, fecha_material, observaciones, activo`.
- **`crm_envio`** (histórico real de envíos — esto alimenta el motor de rotación):
  `material_id` (FK opcional), `destino, hotel_producto, tipo_material, fecha_envio, lista_
  enviada, canal, objetivo, enfoque, resultado` (default `'sin_medir'`), `responsable,
  observaciones`.
- **`crm_difusion_plan`** (calendario programado): `material_id, fecha_programada, destino,
  hotel_producto, tipo_material, canal, lista_objetivo, enfoque, estado` (`pendiente/
  programado/enviado/reprogramar/cancelado`), `observaciones, vigencia_hasta` (nullable — null
  = contenido "evergreen" sin vencimiento).
- **⚠️ No se guarda ningún estado de rotación** ("última vez enviado", "días desde", etc. —
  todo eso se calcula EN VIVO desde `crm_envio` cada vez, nunca se persiste un puntero de
  "siguiente en la rotación").
- RLS idéntico en las 3 tablas: `mi_rol() in ('superadmin','gerencia','administracion',
  'operaciones','venta')` para leer y escribir.
- **`crm_contactos.subcategoria`** (migración `082_crm_subcategoria.sql`) es una tabla y campo
  DISTINTOS — segmenta la categoría de un contacto (ej. "cliente_final" → VIP/Luna de miel/
  Corporativo) para targeting de campañas. No tiene relación con la rotación de Difusión.

## 2. Motor de rotación — `lib/crm/difusion.ts`

Módulo puro (sin efectos secundarios). Tipo de salida:

```ts
export type RotacionEstado = "prioridad" | "puede" | "no_repetir" | "en_pausa";
export type Rotacion = { estado: RotacionEstado; ultimaFecha, diasDesde, veces30,
  vecesMaterial30, proximaFecha };
export function rotacionDe(material, envios: EnvioMin[], hoy: string): Rotacion
export const puedeEnviar = (r: Rotacion) => r.estado === "prioridad" || r.estado === "puede";
```

**No es round-robin ni aleatorio con pesos** — es un clasificador determinista por reglas,
calculado bajo demanda contra TODO el histórico de `crm_envio`:

1. "Mismo producto" = mismo `hotel_producto` (normalizado) **o** mismo `material_id`. "Mismo
   material exacto" = mismo `material_id` solamente.
2. Si nunca se envió nada de ese producto → **`"prioridad"`** (nunca enviado, va primero).
3. Si no:
   - `veces30` = envíos del PRODUCTO en los últimos 30 días.
   - `diasDesde` = días desde el último envío del producto.
   - `materialReciente` = si ESE material exacto se envió hace menos de 30 días.
   - `proximaFecha` = último envío + 21 días (informativo).
4. Estado final:
   - `veces30 ≥ 2` → **`"en_pausa"`** (2+ envíos del mismo producto en 30 días, sin importar
     los 21 días — gana sobre la regla siguiente).
   - si no, `diasDesde < 21 OR materialReciente` → **`"no_repetir"`** (producto enviado hace
     menos de 21 días, O esta pieza exacta enviada hace menos de 30).
   - si no → **`"puede"`** (elegible para enviar).

Reglas de negocio codificadas: no repetir el mismo hotel antes de 21 días; no repetir la misma
pieza exacta antes de 30 días; 2+ envíos del producto en 30 días → pausa; nunca enviado →
máxima prioridad. El "hoy" se calcula en zona horaria `America/Bogota` (el servidor corre en
UTC) antes de mapear `rotacionDe()` sobre hasta 3000 `crm_envio` recientes (`page.tsx`).

## 3. `app/(crm)/crm/difusion/actions.ts` — funciones exportadas

Todas devuelven `{ ok: true; id? } | { ok: false; error }` y revalidan `/crm/difusion`.

| Función | Qué hace |
|---|---|
| `crearMaterial` / `actualizarMaterial` / `eliminarMaterial` | CRUD de `crm_material`. |
| `registrarEnvio` | Inserta en `crm_envio`; si trae `materialId`, además pone `crm_material.estado = "enviado"` (solo informativo — la rotación siempre se recalcula desde el histórico, no desde este flag). |
| `actualizarResultadoEnvio` / `eliminarEnvio` | Editar/borrar un registro de envío. |
| `crearPlan` / `actualizarPlan` | CRUD del calendario, incluyendo `vigencia_hasta`. `actualizarPlan` existe sobre todo para **renovar la vigencia** de una entrada por vencer sin borrar/recrear. |
| `cambiarEstadoPlan` / `eliminarPlan` | Cambiar solo el estado, o borrar la entrada programada. |
| `marcarPlanEnviado(id)` | Puente calendario→histórico: exige que la entrada tenga `hotel_producto`; inserta una fila espejo en `crm_envio` (con `fecha_envio = fecha_programada`) y pone `estado = "enviado"` en el plan. Así lo programado empieza a contar para la rotación. |

## 4. Las 5 pestañas (`DifusionClient.tsx`)

Una sola página (`app/(crm)/crm/difusion/page.tsx`) renderiza todo el dato una vez; un cliente
único implementa 5 tabs:

1. **"Qué enviar esta semana"** — materiales con `puedeEnviar()` true, ordenados prioridad
   primero y luego por `prioridad` del material (alta/media/baja). Botón "Registrar envío"
   precarga el formulario de Histórico.
2. **"Inventario"** — CRUD de `crm_material` (puede enlazar a un hotel del catálogo o ser
   100% texto libre), con badge de rotación en vivo por fila.
3. **"Histórico"** — listar/registrar/borrar `crm_envio`.
4. **"Calendario"** — CRUD de `crm_difusion_plan`, agrupado por semana ISO. Cada ítem: badge
   de vigencia (§5), dropdown de estado, botón "Enviado" (llama `marcarPlanEnviado`), "Editar"
   (mismo formulario que crear, precargado), eliminar.
5. **"Panel"** — KPIs: conteos por estado de rotación, envíos del mes, programados próximos 7
   días, desgloses por destino/tipo/resultado.

## 5. Vigencia / vencimiento

`vigenciaInfo(vigenciaHasta, hoy)` en `DifusionClient.tsx` — puramente visual, **no hay cron
ni trigger** que cambie el `estado` del plan al vencer (el estado de workflow es independiente,
solo cambia por acción explícita del usuario):

| Días hasta vencer | Badge |
|---|---|
| `< 0` | "Vencida hace Nd" (rojo) |
| `= 0` | "Vence hoy" (rojo) |
| `1–7` | "Vence en Nd — renovar" (ámbar) |
| `> 7` | "Vigente hasta {fecha}" (gris) |
| `null` | sin badge (evergreen) |

## 6. Acceso

Gate **hardcodeado por página** (no pasa por la matriz genérica de `lib/permisos.ts`):
`ROLES = ["superadmin","gerencia","administracion","operaciones","venta"]` en
`crm/difusion/page.tsx` (y en Contactos) — si el rol no está en la lista, muestra un mensaje
en vez de la UI. Campañas/B2B/Email usan un set más angosto (sin `operaciones`/`venta`). El
ítem de nav del dashboard (`modulo: "crm"` en `lib/permisos.ts`) es un gate MÁS GRUESO aparte
(si el área CRM se ve en el sidebar) — no distingue Difusión de los demás submódulos.
