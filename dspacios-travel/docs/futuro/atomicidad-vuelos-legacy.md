# Operaciones de vuelos sin transacción — pendiente, alcance separado

**No se corrigen en el PR #264** (control general por record: modalidad/
emisión/pago). Ese PR sí volvió atómico `actualizarControlBloqueo` (nueva
función `actualizar_control_bloqueo()`, migración 151) porque era exactamente
el caso que motivó la auditoría — pero al revisarlo aparecieron dos patrones
**preexistentes** con el mismo riesgo de fondo, en dos funciones que el PR no
toca. Se documentan aquí para no arreglarlos "de paso" sin medir su alcance
real, y para que quede constancia de que se encontraron.

---

## 1. `registrarCambioOperacional` — el mismo patrón que tenía `actualizarControlBloqueo`

`app/(dashboard)/dashboard/vuelos/actions.ts`, cambios de horario/vuelo
(migración 070, sin cambios en el PR #264):

```ts
// SELECT del estado anterior
const { data: actual } = await sb.from("bloqueos_vuelo").select(...).eq("id", bloqueoId).single();
...
// UPDATE (llamada suelta #1)
if (cambios.length) {
  const { error } = await sb.from("bloqueos_vuelo").update({...}).eq("id", bloqueoId);
  if (error) return { ok: false, error: error.message };
}
...
// INSERT del historial (llamada suelta #2)
const { error: le } = await sb.from("bloqueo_cambios").insert({...});
if (le) return { ok: false, error: le.message };

revalidatePath(`/dashboard/vuelos/${bloqueoId}`);
await regenerarTarifariosDeBloqueo(bloqueoId); // recalcula paquetes armados
```

Si el `INSERT` en `bloqueo_cambios` falla después de que el `UPDATE` de
horario/vuelo ya corrió, el bloqueo queda con el vuelo/hora nuevos **sin
ningún rastro en el historial** de que el cambio ocurrió — igual síntoma que
tenía `actualizarControlBloqueo` antes de esta ronda.

Además, a diferencia de modalidad/emisión/pago, este cambio SÍ dispara
`regenerarTarifariosDeBloqueo` — un efecto con más superficie (recalcula los
paquetes armados que usan ese bloqueo) que quedaría corriendo sobre un
`UPDATE` que después se decida revertir. Portar esta función al mismo patrón
de RPC transaccional (`SELECT ... FOR UPDATE` + `UPDATE` + `INSERT` en una
sola función `plpgsql`, sin `security definer`) es sencillo — el molde ya
existe en `actualizar_control_bloqueo()` — pero **hay que decidir aparte** si
`regenerarTarifariosDeBloqueo` entra o no a esa misma transacción (es una
función de TypeScript que hace sus propios `select`/`insert`/`delete` sobre
`tarifario_resultado`; meterla dentro de una función SQL implicaría
reescribirla en `plpgsql` o aceptar que corra DESPUÉS del commit, ya sin
poder revertir el `UPDATE` si algo en el recálculo falla).

## 2. `crearBloqueo` / `cargarBloqueosMasivo` — bloqueo insertado, sillas en una llamada aparte

Mismo archivo, creación de un record:

```ts
// crearBloqueo
const { data: bloqueo, error } = await sb.from("bloqueos_vuelo").insert({...}).select("id").single();
if (error) return { ok: false, error: error.message };

if (input.cuposTotal > 0) {
  const sillas = Array.from({ length: input.cuposTotal }, (_, i) => ({ bloqueo_id: bloqueo.id, numero_silla: i + 1, estado: "disponible" }));
  const { error: se } = await sb.from("sillas").insert(sillas);
  if (se) return { ok: false, error: se.message };   // el bloqueo YA quedó insertado
}
```

`cargarBloqueosMasivo` (carga CSV) tiene el mismo patrón dentro del `for` de
cada fila, con un agravante: ahí ni siquiera se comprueba el error del
`insert` de sillas —

```ts
if (cupos > 0) {
  const sillas = Array.from({ length: cupos }, (_, k) => ({ bloqueo_id: bq.id, numero_silla: k + 1, estado: "disponible" as const }));
  await sb.from("sillas").insert(sillas);   // sin chequear `error`
}
insertados++;   // se cuenta como insertado igual, aunque las sillas hayan fallado
```

Si el `INSERT` de sillas falla (constraint, red, lo que sea), el bloqueo
queda **insertado sin sus sillas** — un record con `cupos_total = N` pero 0
filas reales en `sillas`. En `crearBloqueo` al menos se reporta el error (el
bloqueo huérfano queda, pero el usuario se entera); en `cargarBloqueosMasivo`
ni eso: la fila se cuenta como "insertada" en el resumen de la carga masiva
aunque las sillas nunca se hayan creado.

Portar esto a un RPC atómico es más simple que el caso anterior (no hay
"efecto colateral" tipo `regenerarTarifariosDeBloqueo` que decidir): un solo
`INSERT ... RETURNING id` seguido de un `INSERT ... SELECT generate_series(...)`
para las sillas, en la misma función. El molde de
`guardar_programa_salidas()` (rama de Programas, PR #263) — que hace un
`INSERT` masivo a partir de `jsonb_to_recordset` — es un buen punto de
partida si se decide encarar `cargarBloqueosMasivo` (recibe un array de
filas); `crearBloqueo` es más simple (una sola fila, cupos generados por
`generate_series`).

---

## Por qué no se resuelven ahora

Los dos casos son reales y del mismo tipo que motivó el PR #264, pero:

- No son parte del pedido de auditoría de esa ronda (control por record).
- El primero (`registrarCambioOperacional`) tiene una decisión de diseño
  pendiente (qué hacer con `regenerarTarifariosDeBloqueo`) que no debería
  tomarse de pasada dentro de un PR con otro objetivo.
- El segundo (`crearBloqueo`/`cargarBloqueosMasivo`) es más mecánico pero
  toca DOS funciones (una interactiva, una de carga masiva) y ampliaría el
  diff de una migración que ya se está revisando por otra razón.

Alcance sugerido para cuando se retome: una migración/PR dedicado
exclusivamente a esto, con su propia batería de pruebas (mismo patrón que
`supabase/scripts/test_control_bloqueo_atomico.sql`: cambio correcto, fallo
forzado del segundo paso, verificación de que no queda a medias).
