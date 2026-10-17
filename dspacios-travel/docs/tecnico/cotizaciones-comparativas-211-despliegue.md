# Migración 211 — Cotizaciones comparativas (#35): aplicación remota

Runbook breve de `supabase/migrations/20260601000211_cotizaciones_comparativas.sql`. El
diseño (madre, opciones, hija, recibos, solicitudes) está en el encabezado de la migración.
Este documento solo cubre **cómo aplicarla en remoto sin sorpresas**.

- **Dependencias reales:** 210 (`ventas.financiero_registrado_en`), RPC 198
  `convertir_cotizacion_a_contrato`, `registrar_pago_previo`, 154
  (`puede_ver_tenant_cotizacion`), 208 (`f208_priv.importes_factura`). **No** depende de la
  212 ni de la 213 y no toca sus objetos. Se probó sobre un esquema 001–210 + 212 + 213.
- **Numeración fuera de orden:** la 211 es *anterior* a la 212 y 213, que ya están
  aplicadas. Una herramienta que aplique "pendientes" por orden de versión puede tratarla
  como una migración vieja sin aplicar. Por eso el mecanismo se elige DESPUÉS de mirar el
  historial (paso 1), no antes.
- **Una sola transacción:** el archivo abre `begin;` y cierra `commit;`. Si algo falla, no
  queda nada a medias. No modifica ni reemplaza el RPC 198, la 206 ni la 208.

## Orden obligatorio

| Paso | Qué | Resultado esperado |
|---|---|---|
| 1 | **Historial de migraciones** (solo lectura, abajo) | Se sabe cómo se aplicaron las anteriores y si la 211 figura. |
| 2 | `supabase/scripts/preflight_211_cotizaciones_comparativas.sql` | `resultado->>'veredicto'` = `APTO_PARA_APLICAR` (14 controles, 0 fallidos). |
| 3 | Aplicar la 211 con el mecanismo elegido en el paso 1 | Sin error. |
| 4 | `supabase/scripts/postcheck_211_cotizaciones_comparativas.sql` | `veredicto` = `CORRECTO` (19 controles, 0 fallidos). |
| 5 | Desplegar el código (Vercel Production) | Solo si el paso 4 fue `CORRECTO`. |
| 6 | Verificación humana con un caso controlado que autorice el Coordinador | Comparativa creada, enlace abierto, una opción elegida o solicitada. |

La 211 va **antes** del código: el código nuevo llama RPC y lee tablas que solo existen con
ella. Que el código anterior siga funcionando con la 211 aplicada está afirmado en el
encabezado de la migración (columnas nuevas con default, el código viejo nunca ve una
madre), pero **no se probó con el código viejo en ejecución**; no dependas de ello para
dejar la 211 aplicada mucho tiempo sin desplegar.

## Cómo leer los scripts

Ambos devuelven **una fila con una columna `resultado`** (jsonb): `veredicto`,
`controles_total`, `controles_fallidos`, `fallidos` (números de control), `controles`
(cada uno con `n`, `comprobacion`, `ok`, `informativo`, `dato`) y `nota`. Un control NULL
cuenta como fallido. En el preflight, los controles 11, 13 y 14 son informativos (aportan
datos; el 11 es el hash del RPC 198 que el postcheck vuelve a exigir). Si el script lanza
un **error** en vez de devolver la fila, tómalo como `DETENER`.

## Paso 1 — Qué comprobar del historial (solo lectura, antes de elegir mecanismo)

1. ¿Existe la tabla de historial (`supabase_migrations.schema_migrations`) y qué versiones
   tiene? Compárala con los archivos de `supabase/migrations/` (hasta la 213 en `main`).
   Anota las que faltan en la tabla aunque su efecto ya esté en la base: indica que se
   aplicaron por el editor SQL sin registrarse.
2. ¿Figura la versión `20260601000211`? Si **sí**, no apliques nada: detente y avisa.
3. ¿212 y 213 figuran, y con qué `name`? Eso confirma que la 211 quedaría fuera de orden.
4. ¿Hay otras versiones reservadas o inesperadas (204, 214)? No las toques ni las asumas.
5. Decide el mecanismo con el usuario y el Coordinador:
   - **Editor SQL** pegando el archivo completo (como se haya hecho con las anteriores,
     según lo que muestre el punto 1). Después se decide aparte si se registra en el
     historial.
   - **CLI de Supabase**: solo si el historial está completo y coherente. Antes, revisar
     `migration list` y qué haría con una versión anterior a la última aplicada; no usar
     `db push` ni `migration repair` por inferencia.

## Cuándo detenerse y qué hacer

- **Preflight `DETENER`** (o error): no aplicar. Guardar el jsonb completo, revisar los
  controles con `ok=false` (7, 8 o 9 fallidos indican que la 211 ya está total o
  parcialmente aplicada; 1–6 y 12, que falta una dependencia o el RPC 198 cambió) y
  avisar al Coordinador.
- **Error al aplicar:** no reintentar a ciegas. La transacción deja la base como estaba:
  confirmarlo corriendo de nuevo el preflight (debe seguir dando `APTO_PARA_APLICAR`).
- **Postcheck `DETENER`** (o error): **no desplegar el código.** No hacer rollback
  automático. Guardar el jsonb y avisar. El control 17 fallido significa que el RPC 198
  cambió: es lo más grave.
- **Rollback** (`rollback_211_cotizaciones_comparativas.sql`): solo si todavía no existe
  ninguna comparativa ni cotización elegida; si existe alguna, el script aborta sin cambiar
  nada porque el historial es inmutable. En ese caso es una decisión del dueño, no del script.
- **Nunca** editar a mano filas de comparativas, eventos, recibos o solicitudes.

## Evidencia local (PostgreSQL desechable, 001–210 + 212 + 213 + 211)

Preflight antes de la 211: `APTO_PARA_APLICAR`, 14/14. Postcheck después: `CORRECTO`,
19/19. Casos negativos: el preflight tras aplicar la 211 da `DETENER` con los controles
7, 8 y 9 fallidos; el postcheck antes de aplicarla termina en error (la columna `modo`
no existe). Ninguna de estas pruebas es evidencia de Producción.
