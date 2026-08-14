# Membresías por agencia: un usuario, varios roles

> ## ⏸ EN PAUSA — el caso que lo motivó era otro
>
> Este diseño nació de entender que una persona era `operaciones` en mayorista y
> **`venta` interna** en minorista. **No es así.** Es `operaciones` interna en
> mayorista y **freelance/aliado B2B** relacionado con ventas de minorista, que
> gestiona otro usuario interno.
>
> Ese caso **no necesita rol interno por tenant**: necesita que los datos de
> pertenencia B2B estén bien. Ver **`caso-freelance-en-asesor.md`**.
>
> El documento se conserva porque el análisis sigue siendo válido —el inventario
> de impacto está medido y no caduca— si algún día aparece una persona con dos
> roles **internos** de verdad. Hasta entonces: no implementar.

**Diseño e inventario de impacto. Nada implementado, ninguna migración escrita.**

---

## 1. El caso real

La misma persona trabaja en las dos agencias con **roles distintos**:

| Agencia | Rol |
|---|---|
| mayorista | `operaciones` |
| minorista | `venta` |

`usuarios` tiene **un solo `tenant` y un solo `rol`** por persona, así que el
modelo no puede representar eso. El síntoma que apareció: sale relacionada con
contratos de minorista y no los ve, porque su fila dice mayorista/operaciones.

Las tres salidas fáciles están descartadas, y con razón:

- **cambiarle el tenant** — pierde el otro lado;
- **duplicar el usuario** — dos logins para una persona, `usuarios.email` es
  único, y `ventas.asesor` empareja por nombre: duplicar el nombre es
  exactamente lo que la auditoría de julio bloqueó por suplantación;
- **darle superadmin** — le abre las dos agencias enteras para resolver un
  problema de dos roles.

La forma correcta es **membresías**: la relación persona↔agencia deja de ser una
columna y pasa a ser una tabla.

```sql
usuario_tenants (user_id, tenant, rol, activo)   -- PK (user_id, tenant)
```

---

## 2. La decisión de fondo: qué significa «mi rol»

Hoy `mi_rol()` no recibe argumentos y devuelve un rol único. **153 policies vivas
lo llaman así.** Reescribirlas todas no es viable en un paso.

Con membresías, «mi rol» deja de tener respuesta única: depende de **en qué
agencia estoy actuando**. Y ahí está todo el diseño.

### Dos preguntas distintas que hoy se confunden

| Pregunta | Quién la hace | Cómo se resuelve |
|---|---|---|
| «¿qué rol tengo **aquí**?» | policies sin fila de referencia | rol de mi membresía en el tenant **activo** |
| «¿puedo ver **esta fila**?» | policies con `puede_ver_tenant(fila.tenant)` | ¿el tenant de la fila es mi tenant activo? |

**Decisión: se conserva el modelo de "una agencia activa a la vez".**

`puede_ver_tenant(t)` **no** puede pasar a ser «¿tengo membresía en t?». Si lo
fuera, alguien con las dos membresías, actuando en minorista (rol `venta`),
seguiría alcanzando filas de mayorista — y las alcanzaría **con permisos de
`venta`**, mezclando las dos agencias. No es escalada (venta ≤ operaciones) pero
sí es incorrecto, y rompe la separación que costó la migración 116.

Entonces:

```
mi_tenant()        → el tenant ACTIVO (validado contra mis membresías)
mi_rol()           → el rol de MI MEMBRESÍA en ese tenant activo
puede_ver_tenant(t)→ t = mi tenant activo   (+ escape de superadmin)
```

Las 153 policies **no cambian de forma**: cambia lo que devuelven las funciones
que ya llaman.

### Cómo se impide que `operaciones` de mayorista se herede a minorista

Es lo que hace que el diseño funcione, y es estructural, no una comprobación
añadida:

- `mi_rol()` **nunca** lee `usuarios.rol`. Lee `usuario_tenants` por la pareja
  `(auth.uid(), tenant_activo)`.
- Si no hay membresía en ese tenant, devuelve **NULL** — y sin rol, toda policy
  que dependa de `mi_rol()` falla. Es el mismo candado de la migración 140 con
  el usuario desactivado.
- La herencia no se «bloquea»: **no existe camino** por el que el rol de una
  agencia llegue a la otra. No hay un `or` que quitar ni una excepción que se
  pueda olvidar.

---

## 3. De dónde sale «el tenant activo»

Es el punto más delicado del diseño, y donde hay un obstáculo real.

Hoy el tenant activo vive en una **cookie** que solo lee el servidor Next
(`tenantContext()`). Postgres no la ve. Hay que hacérsela llegar.

| Canal | Llega a PostgREST | Llega a **Storage** | Cambiar de agencia |
|---|---|---|---|
| Cabecera HTTP (`x-tenant`) → `current_setting('request.headers')` | sí | **no** | inmediato |
| Claim en el JWT (Custom Access Token Hook) | sí | sí | exige refrescar el token |
| `usuarios.tenant` como hoy (respaldo) | sí | sí | recargar |

**Recomendación: cabecera, con respaldo a `usuarios.tenant`.** El cliente de
Supabase la manda en cada petición (`global.headers`), derivada de la MISMA
cookie ya validada — nunca dos fuentes.

> **Que la cabecera venga del navegador no es un problema de seguridad**, y
> conviene entender por qué: la cabecera solo **elige entre** mis membresías.
> `mi_rol()` verifica que la membresía exista y esté activa; si falsifico
> `x-tenant: minorista` sin membresía allí, me quedo **sin rol**, no con más.
> Una cabecera falsificada solo puede elegir un contexto que ya me corresponde.

### ⚠️ El obstáculo: Storage no ve la cabecera

Las policies del bucket `contratos` (migración 148) llaman `mi_rol()`, y
`storage-api` **no reenvía** cabeceras propias a `request.headers`: solo llega
el JWT. Ahí `mi_rol()` caería al respaldo.

**Restricción de diseño que sale de esto:** *las policies de Storage no pueden
depender del tenant activo.* Hoy **no dependen** — comprobemos:

```sql
mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
and (mi_rol() <> 'venta' or soy_asesor_del_contrato(split_part(name,'/',1)))
```

`operaciones` y `venta` están **los dos** en la lista permitida, así que la
persona de este caso pasa el filtro con cualquiera de sus dos roles. Y
`soy_asesor_del_contrato` no mira el tenant: el número de contrato ya es único
globalmente (minorista lleva prefijo `MIN-`).

Así que hoy funciona. Pero hay que **anotarlo como invariante**: si alguna vez
una policy de Storage necesita distinguir `operaciones` de `venta`, la cabecera
no alcanza y habría que pasar al Custom Access Token Hook.

---

## 4. Inventario de impacto — medido, no estimado

Contado sobre la base local con las 149 migraciones aplicadas.

### Base de datos

| Qué | Cuánto | Cambia |
|---|---|---|
| Policies vivas (public + storage) | 204 | — |
| …que llaman `mi_rol()` | **153** | no cambian de forma; cambia lo que devuelve |
| …que llaman `puede_ver_tenant()` | 19 | igual |
| …que llaman `puede_ver_contrato()` | 28 | igual |
| …que llaman `soy_asesor_del_contrato()` | 26 | igual |
| Tablas con columna `tenant` | 21 | ninguna se toca |
| Vistas SECURITY DEFINER | 3 | siguen a las funciones, hay que **re-verificarlas** |

Las 19 policies con `puede_ver_tenant` cubren: `ventas` (4), `abonos`,
`aliados_b2b`, `asientos_contables`, `asiento_lineas`, `comision_b2b_pagos`,
`conciliacion`, `conciliacion_extracto`, `contabilidad_movimientos`,
`cuentas_por_pagar`, `cxp_pagos`, `facturacion`, `liquidacion_comisiones`,
`pe_costos`, `pe_empleados`, `puc_cuentas`.

### Funciones

| Función | Impacto |
|---|---|
| `mi_rol()` | **Reescritura.** De `usuarios.rol` a `usuario_tenants` por tenant activo. Es el cambio de mayor alcance de todo el proyecto: lo llaman 153 policies. |
| `mi_tenant()` | **Reescritura.** De `usuarios.tenant` a cabecera validada contra membresías, con respaldo. |
| `puede_ver_tenant(t)` | Sin cambio de forma; hereda el nuevo `mi_tenant()`. |
| `puede_ver_contrato(num)` | **Sin cambios.** Ya toma el tenant de la fila. |
| `soy_asesor_del_contrato(num)` | **Sin cambios.** No mira tenant; el número ya es único global. |
| `soy_ese_asesor(a)` | **Sin cambios.** |

> `soy_asesor_del_contrato` empareja por **nombre**. Con una persona en dos
> agencias eso ya funciona (el mismo nombre en los dos lados es correcto aquí).
> La deuda de `ventas.asesor_id uuid` sigue abierta y este cambio **no la
> agrava**, pero tampoco la resuelve.

### Aplicación

| Qué | Cuánto | Cambia |
|---|---|---|
| Lecturas ad-hoc de `perfil.rol` | **71** | todas: el rol pasa a depender del tenant activo |
| Llamadas a `tenantContext()`/`getTenant()` | 51 | el contexto ahora trae también el rol |
| `lib/tenant.server.ts` | 1 | `puedeCambiar = rol === 'superadmin'` → `permitidos.length > 1` |
| `proxy.ts` | 1 | lee `select("rol, activo")`; pasa a leer la membresía del tenant de la cookie |
| `lib/roles.ts` / `LECTURA_MODULO` | 1 | sin cambios de contenido; recibe el rol del contexto |
| `TenantSwitcher` | 1 | deja de ser solo-superadmin |
| `dashboard/usuarios` | 1 | pantalla nueva: editar membresías, no un rol |
| Cliente Supabase (server y browser) | 2 | añadir la cabecera `x-tenant` |

**Las 71 lecturas de `perfil.rol` son el grueso del trabajo de app.** La forma
de no tocarlas de golpe: un helper `contextoUsuario()` que devuelva
`{ tenant, rol, permitidos }`, y migrarlas por tandas. Mientras una pantalla no
esté migrada, sigue leyendo `usuarios.rol` — que durante las fases 1 y 2 **sigue
siendo correcto** para todos los usuarios de una sola agencia, que son casi
todos.

### Lo que NO se toca

- Las 21 columnas `tenant` de las tablas de datos.
- La numeración con prefijo `MIN-`.
- `createAdminClient()` (service-role): se salta la RLS y estampa el tenant a
  mano. Hay que **auditarlo**, no cambiarlo.
- Los roles externos B2B (`agencia`, `freelance`, `cliente_final`): el portal
  resuelve por `aliado_id`, no por tenant. Quedan con una sola membresía.

---

## 5. Plan por fases

El mismo patrón que funcionó con la 148/149: **aditivo primero, cierre después**,
con el despliegue en medio y sin ventana de caída.

### Fase 1 — Migración aditiva (nada cambia de comportamiento)

1. `usuario_tenants(user_id, tenant, rol, activo)`, PK `(user_id, tenant)`, FK a
   `usuarios`, índice implícito por la PK (lo va a leer `mi_rol()` en cada
   policy).
2. **Backfill**: una fila por usuario existente, copiando `usuarios.tenant`,
   `usuarios.rol`, `usuarios.activo`. Ni una persona cambia de permisos.
3. `mi_rol()` y `mi_tenant()` reescritas **con respaldo**: si no hay membresía,
   caen a `usuarios`. Si no hay cabecera, el tenant activo es `usuarios.tenant`.
4. RLS de `usuario_tenants`: cada quien ve las suyas; solo `superadmin` escribe.

**Criterio de aceptación: `test_venta_tokens_y_escritura.sql` y
`test_rls_por_rol.sql` dan exactamente el mismo resultado que hoy.** Si algo
cambia, la fase 1 está mal.

Reversible: basta con restaurar las dos funciones.

### Fase 2 — Aplicación

5. `contextoUsuario()` como fuente única de `{tenant, rol, permitidos}`.
6. La cabecera `x-tenant` en los dos clientes de Supabase, derivada de la cookie
   ya validada.
7. `proxy.ts`: valida la cookie contra las membresías y la corrige si no
   corresponde. Sin esto, la interfaz y la RLS pueden discrepar — el peor fallo
   posible de este diseño.
8. Selector de agencia para cualquiera con más de una membresía.
9. Migrar las 71 lecturas de `perfil.rol` por tandas.
10. `dashboard/usuarios`: gestión de membresías.

**Desplegar. Validar.** A partir de aquí la persona del caso ya puede trabajar
en las dos agencias con el rol que le toca en cada una.

### Fase 3 — Cierre

11. Quitar el respaldo a `usuarios.rol`/`usuarios.tenant` en las funciones.
12. `usuarios.rol` y `usuarios.tenant` quedan como **agencia y rol por defecto**
    (los que se usan si no hay cookie), documentados como derivados. **No se
    borran** — convención del proyecto.
13. Opcional y recomendable: migrar las policies tenant-scoped de
    `mi_rol() in (...) and puede_ver_tenant(t)` a un `mi_rol_en(t) in (...)`.
    Elimina la dependencia del contexto ambiental: el rol se resuelve **con el
    tenant de la fila**, no con el activo. Es estrictamente más seguro y hace
    imposible el escenario de "actuar en una agencia mirando filas de la otra".
    Son 19 policies, no 153.

---

## 6. Pruebas

Se añaden a `test_venta_tokens_y_escritura.sql`, que ya fabrica sus propios
fixtures dentro de una transacción con ROLLBACK.

**Fixture nuevo:** un usuario con `operaciones` en mayorista y `venta` en
minorista, y un contrato en cada agencia.

| # | Contexto | Debe pasar |
|---|---|---|
| 1 | activo = mayorista | `mi_rol()` = `operaciones` |
| 2 | activo = minorista | `mi_rol()` = `venta` |
| 3 | activo = minorista | **no** ve el contrato de mayorista (`puede_ver_tenant('mayorista')` = false) |
| 4 | activo = minorista | ve el contrato de minorista, y **sin** columnas financieras (es `venta`) |
| 5 | activo = mayorista | ve costos del contrato de mayorista (es `operaciones`) |
| 6 | activo = mayorista | **no** ve el contrato de minorista |
| 7 | cabecera falsificada a un tenant **sin** membresía | `mi_rol()` = NULL y no ve nada |
| 8 | membresía con `activo = false` | `mi_rol()` = NULL en ese tenant, intacto en el otro |
| 9 | usuario de una sola agencia (todos los demás) | resultado **idéntico** al de hoy |

La **9 es la más importante de la fase 1**: es la que dice que no se rompió nada
para las 40-y-pico personas que no necesitan esto.

Y una que no es SQL: **el mismo usuario, dos pestañas abiertas en agencias
distintas.** La cookie es del navegador, no de la pestaña. Hay que decidir si se
acepta (la última pestaña que cambie manda) o si se bloquea. Recomiendo
aceptarlo y que la ficha muestre siempre la agencia activa de forma visible; lo
contrario exige mover el contexto a la URL, que es un rediseño mayor.

---

## 7. Riesgos, ordenados por lo que cuesta cada uno

| Riesgo | Por qué | Mitigación |
|---|---|---|
| **`mi_rol()` es el punto único de fallo de 153 policies** | Un error ahí no rompe una pantalla: cierra o abre la aplicación entera | Fase 1 con respaldo + el criterio de aceptación de "resultado idéntico" |
| **Interfaz y RLS discrepan** | Si la cookie dice una agencia y la cabecera otra, se ven datos de una con permisos de la otra | Una sola fuente: la cabecera se deriva de la cookie ya validada, en el factory del cliente |
| **Storage no ve la cabecera** | Sus policies caen al respaldo | Invariante documentado: las policies de Storage no dependen del tenant activo. Hoy se cumple |
| **Rendimiento** | `mi_rol()` pasa de leer una fila por PK a leer otra por PK compuesta | Es `stable`: Postgres la cachea por sentencia. Índice por la PK |
| **71 lecturas de `perfil.rol` sin migrar** | Una pantalla sin migrar muestra el rol equivocado a esta persona | Migrar por tandas; para todos los demás usuarios sigue siendo correcto |
| **Auditoría** | `auditoria` guarda un snapshot del rol | Pasa a guardar el rol de la membresía; hay que verificar que el trigger lo tome bien |

---

## 8. Lo que hay que decidir antes de escribir una línea

1. **¿`superadmin` es global o una membresía en cada agencia?** Recomiendo
   membresías, para tener un solo mecanismo — pero conservando el escape de
   `superadmin` en `puede_ver_tenant` durante las fases 1 y 2, para no quedarse
   fuera si el backfill falla.
2. **¿Cuántas personas más están en este caso?** Se responde con una consulta
   antes de diseñar la pantalla de gestión. Si es una sola, la fase 2 puede
   empezar con un selector mínimo.
3. **Dos pestañas, dos agencias** (sección 6).
4. **¿Se hace ahora o después de estabilizar la 149?** El frente de seguridad
   acaba de cerrarse y esto vuelve a tocar `mi_rol()`. Mi recomendación es
   **dejar reposar la 149 y las pruebas de Storage primero**: el caso de negocio
   es real pero no está bloqueando la operación diaria, y encadenar dos cambios
   grandes sobre las mismas funciones es cómo se pierde la trazabilidad de cuál
   rompió qué.
