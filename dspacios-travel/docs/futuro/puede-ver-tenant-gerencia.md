# `gerencia` cross-agencia en `puede_ver_tenant()` — pendiente, alcance separado

**No construir junto con la migración 150.** Este documento existe para que la
inconsistencia que la 150 introduce a propósito no se arregle "de paso" en otra
migración sin medir su verdadero alcance.

---

## 1. La inconsistencia, en una frase

`puede_ver_tenant()` (migración 107) deja a `gerencia` ver las **filas** de las
dos agencias. La migración 150 (`acceso_archivo_contratos`, Storage del bucket
`contratos`) **no reproduce esa excepción a propósito**: ahí `gerencia` queda
acotada a su propia agencia. Consecuencia: un `gerencia` podrá abrir la ficha de
un contrato de la otra agencia y **no** sus adjuntos.

```sql
-- puede_ver_tenant() — migración 107, sigue vigente
select mi_rol() in ('superadmin','gerencia') or mi_tenant() = t;
--                   ~~~~~~~~~~~~~~~~~~~~~~~
--                   gerencia: TRUE sin importar el tenant

-- acceso_archivo_contratos() — migración 150
-- gerencia SOLO entra si perfil.tenant = contrato.tenant
```

## 2. Por qué no se resuelve dentro de la 150

Elegir un lado arregla el Storage, pero **`puede_ver_tenant()` la usan más
tablas que `ventas`**. Cambiarla ahí tiene un radio de explosión que la 150 no
audita:

```
$ grep -rl "puede_ver_tenant" supabase/migrations/ | wc -l
```

Hay que correr esa búsqueda y listar, migración por migración, **cada policy**
que llama `puede_ver_tenant()` — no solo `ventas`: abonos, cuentas_por_pagar,
facturación, comisiones, `pe_empleados`, movimientos contables, conciliación,
auditoría… Cambiar el comportamiento de `gerencia` ahí es un cambio de alcance
GLOBAL de ese rol, no uno acotado a Storage. Mezclarlo con la 150 habría hecho
exactamente lo que el dueño pidió no hacer: "no la mezcles ahora porque tiene un
alcance mayor".

## 3. Las dos salidas posibles (sin decidir aquí)

### A. Hacer que `gerencia` también sea cross-agencia en Storage

Quitar la comparación de tenant para `gerencia` dentro de
`acceso_archivo_contratos()` (una migración pequeña, solo toca esa función).
Consistente con `puede_ver_tenant()` tal como está hoy. Efecto: un `gerencia`
vuelve a alcanzar los adjuntos de la otra agencia — el mismo alcance que ya
tiene sobre las filas.

### B. Acotar `puede_ver_tenant()` a su propia agencia para `gerencia`

Alinea el resto del sistema con lo que la 150 ya decidió para Storage. Efecto
MUCHO más amplio: hay que auditar cada tabla que dependa de esa función y medir
qué deja de ver `gerencia` que hoy ve — con datos reales, no solo leyendo el
código, porque `gerencia` puede depender de ese alcance cross-agencia para
tareas ya en uso (consolidados, reportes). Necesita su propio inventario y su
propia migración, con las mismas pruebas antes/después que se le exigieron a la
150 (`test_storage_por_tenant.sql` como modelo: matriz de expectativa +
ejecución real + rollback verificado).

## 4. Checklist para cuando se retome (no ahora)

1. `grep -rn "puede_ver_tenant" supabase/migrations/` → tabla por tabla, qué
   policy la usa y qué gana/pierde `gerencia` en cada una.
2. Confirmar con el dueño cuál de las dos salidas (A o B) — es una decisión de
   negocio, no técnica: ¿`gerencia` debe ver todo lo de las dos agencias o solo
   la suya?
3. Si es B: nueva migración con inventario de impacto tabla por tabla, prueba
   antes/después con datos reales (no solo la matriz sintética), y aviso
   explícito de qué reportes/pantallas dejan de traer datos cross-agencia para
   ese rol.
4. Si es A: migración de una sola función, pero deja **la inconsistencia
   documentada en este archivo sin resolver en el resto del sistema** — porque
   ahí nunca hubo inconsistencia, ya era cross-agencia.

## 5. Estado

**Pendiente.** La migración 150 avisa esto en su propia cabecera (sección
"⚠️ Asimetría deliberada con `gerencia`") y en `docs/tecnico/adjuntos-y-storage.md`
§4. Este documento es el desarrollo de esa nota para que la decisión no se tome
de pasada.
