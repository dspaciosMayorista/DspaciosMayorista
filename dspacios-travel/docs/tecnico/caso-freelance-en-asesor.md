# El nombre del freelance en `ventas.asesor`

**Diagnóstico y propuesta. Sin migraciones, sin cambios de datos, sin merge.**

---

## 1. El caso, corregido

La persona es:

- **`operaciones` interna en mayorista** — su única cuenta y su único rol;
- **freelance/aliado B2B** relacionado con ventas de **minorista**;
- los contratos los **crea y gestiona otro usuario interno de minorista**.

Esto **no necesita rol interno por tenant**. `usuario_tenants` queda **en
pausa**: el diseño de la sesión anterior resolvía un problema que, tal como está
planteado ahora, no existe. Lo que hay aquí es un problema de **datos y de
modelo de pertenencia B2B**, no de roles.

> El documento `membresias-por-tenant.md` queda archivado como diseño válido
> para *otro* caso —una persona con dos roles **internos**— si algún día
> aparece. No se descarta; se pausa.

---

## 2. Lo que sí pude determinar: el código

No tengo acceso a tu Supabase, así que **no puedo leer MIN-00-0460 ni
MIN-00-0461**. Lo que sí puedo hacer, y hice, es auditar el código que escribe
esos campos. Es concluyente.

### El importador de minorista pone el nombre del freelance en `asesor`

`app/(dashboard)/dashboard/contratos/importar/actions.ts`:

```ts
const tieneVendedor = !!p.asesor?.trim();
return {
  asesor: p.asesor,                                    // ← el VENDEDOR de la hoja
  tipo_asesor:      tieneVendedor ? "freelance" : null,
  canal:            tieneVendedor ? "B2B" : null,
  freelance_nombre: tieneVendedor ? p.asesor : null,   // ← el MISMO valor
};
```

**El mismo texto va a `asesor` y a `freelance_nombre`.** Y `aliado_id` **nunca
se escribe**: el importador no lo toca.

Así que un contrato importado con vendedor queda:

| Campo | Valor | ¿Correcto? |
|---|---|---|
| `asesor` | nombre del **freelance** | **No.** Debería ser el interno responsable |
| `freelance_nombre` | nombre del freelance | sí |
| `tipo_asesor` | `freelance` | sí |
| `canal` | `B2B` | sí |
| `aliado_id` | **NULL** | **No.** Es el vínculo fuerte que falta |
| `b2b_usuario_id` | NULL | correcto (no compró por el portal) |

### El formulario manual, en cambio, lo hace bien

`contratos/actions.ts` guarda `asesor: input.asesorNombre`, y el formulario lo
llena de un desplegable **"Asesor interno *"** alimentado con
`usuarios where rol='venta' and activo`. El aliado va aparte, con su
`aliado_id` del catálogo. Ahí los dos conceptos están separados.

**Consecuencia:** si MIN-00-0460/0461 fueron **importados**, casi seguro traen
el nombre del freelance en `asesor`. Si fueron creados **a mano**, `asesor`
debería traer a un interno. El script de diagnóstico distingue los dos casos
(bloque 4: un `INSERT` hecho por "Sistema / service-role" es la firma del
importador).

### Y esto explica el síntoma exactamente

- `soy_asesor_del_contrato` empareja **por nombre** contra `ventas.asesor` →
  para ella devuelve **true** en esos contratos.
- `puede_ver_contrato` exige además que **el tenant coincida** → ella es
  mayorista, los contratos son minorista → **false**.

"Figura como asesora de contratos que no puede ver". No es un fallo de RLS: la
RLS está haciendo justo lo que debe. Es que el dato dice algo que no es cierto.

---

## 3. Lo que hay que ejecutar para cerrar el diagnóstico

`supabase/scripts/diagnostico_contratos_b2b.sql` — **solo lectura**, ni un
`update`. Cinco bloques:

1. La cabecera de las dos ventas, campo por campo, con el aliado y el usuario
   B2B resueltos por sus IDs.
2. **¿`asesor` apunta a un interno o a un aliado?** Cruza el nombre contra
   `usuarios` (roles internos) y contra `aliados`, normalizando mayúsculas y
   espacios, y emite un veredicto por contrato.
3. **¿Por dónde se resuelve la pertenencia B2B?** `b2b_usuario_id` → `aliado_id`
   → nombre en texto. Si llega al tercero, dice cuántas fichas del catálogo
   coinciden con ese nombre (y si hay homónimos, que harían ambiguo el cruce).
4. **Quién creó y quién gestiona**, desde `auditoria`. "Sistema / service-role"
   en el INSERT = contrato importado.
5. La persona concreta: si su nombre está en `ventas.asesor` y si el tenant
   coincide — las dos mitades del síntoma, por separado.

Pásame la salida y cierro el diagnóstico con datos en vez de con inferencia del
código.

---

## 4. Punto 4: la pertenencia B2B sí se resuelve por `aliado_id`… cuando lo hay

El **resolvedor** está bien. `app/portal/b2b/page.tsx`, por orden de confianza:

```ts
1. b2b_usuario_id  → lo compró él mismo desde el portal
2. aliado_id       → ficha del catálogo enlazada al usuario (migración 143)
3. nombre en texto → SOLO si no hay aliado_id
```

El respaldo por nombre ya está acotado: solo entra `!aliadoId`, y usa `.eq()`,
no el `.or()` interpolado que se corrigió en la auditoría de julio.

**El problema no es el resolvedor: son los datos.** Los contratos importados
tienen `aliado_id = NULL`, así que caen al paso 3 y la pertenencia depende de que
dos cadenas coincidan — que es precisamente lo que la 143 vino a reemplazar.

**Propuesta (no ejecutada):**

1. Correr el diagnóstico y confirmar que existe **una sola** ficha en `aliados`
   con ese nombre. Si hay varias o ninguna, primero se arregla el catálogo.
2. Rellenar `ventas.aliado_id` en los contratos afectados, con revisión humana
   contrato por contrato — **no un `update` masivo por coincidencia de nombre**,
   que sería repetir el mismo error de origen.
3. Enseñar al importador a resolver `aliado_id` cuando el nombre del vendedor
   cruce **exactamente y sin ambigüedad** con una ficha del catálogo, y a dejarlo
   en NULL si hay duda. Así deja de generar deuda nueva.

---

## 5. Punto 3: ¿qué debería llevar `ventas.asesor`?

Hay una decisión de fondo que no puedo tomar por ti, porque es de negocio:

**`ventas.asesor` significa "el responsable interno del contrato".** Lo usan:

- `soy_asesor_del_contrato` → decide qué puede **gestionar** un rol `venta`;
- la liquidación de comisiones internas;
- el documento del contrato (quién firma).

El freelance ya tiene su propio campo (`freelance_nombre` + `aliado_id`). Meter
su nombre en `asesor` mezcla dos conceptos distintos y produce justo el efecto
que estás viendo.

**Recomendación:** en los contratos afectados, `asesor` debe pasar a ser **el
usuario interno de minorista que los gestiona**. Pero:

> ⚠️ **Eso cambia quién puede gestionar esos contratos.** Hoy, con el nombre del
> freelance ahí, ningún `venta` de minorista los tiene como "propios" —
> `soy_asesor_del_contrato` les da false. Al poner al interno correcto, esa
> persona pasará a poder editarlos, subir adjuntos y ver a los pasajeros. Es lo
> deseado, pero es un cambio de permisos efectivos y hay que hacerlo a
> conciencia, no en un `update` masivo.

Por eso no propongo el `update` todavía: primero el diagnóstico dice **cuántos**
contratos están así y **quién** es el interno responsable de cada uno.

---

## 6. Punto 6: ¿necesita entrar al Portal B2B con su cuenta interna?

**Hoy no puede, y lo comprobé en el código.** `portal/b2b/page.tsx`:

```ts
const esB2B = rol === "agencia" || rol === "freelance";
if (!esB2B) { /* "Tu cuenta es interna. Ve al Portal Admin" */ }
```

Con rol `operaciones` ve esa pantalla y nada más.

**Esta pregunta la tienes que responder tú**, porque depende de si ella necesita
ver sus comisiones y su cuenta de cobro por sí misma:

### Si NO lo necesita

**No hay ningún cambio de autenticación.** Su cuenta interna sigue igual, y sus
comisiones las gestiona el equipo desde `/dashboard/comisiones` como con
cualquier otro aliado. Basta con arreglar los datos (secciones 4 y 5).

### Si SÍ lo necesita

Se añade una **capacidad de aliado**, sin tocar su rol:

- La columna ya existe: **`usuarios.aliado_id`** (migración 143). Se le enlaza su
  ficha del catálogo.
- `portal/b2b` cambia el gate: de `rol in ('agencia','freelance')` a
  **`rol in ('agencia','freelance') OR usuarios.aliado_id is not null`**.
- El resolvedor de pertenencia **no cambia**: ya usa `aliado_id` como paso 2, y
  para ella sería el único (no tiene `b2b_usuario_id` ni hace falta el respaldo
  por nombre).
- `proxy.ts` no la rebota: solo bloquea a los roles **externos** en el
  dashboard, y ella sigue siendo interna.
- Su rol `operaciones` **no se toca**: no pierde nada en mayorista, y no gana
  nada en minorista más allá de ver sus propias comisiones por `aliado_id`.

Es aditivo y pequeño: una condición en el gate del portal y un enlace de
catálogo. **No requiere `usuario_tenants`.**

> Detalle a decidir si se toma este camino: qué ve al entrar al portal alguien
> que además es interno. Lo razonable es que vea **solo** su panel de aliado —
> comisiones y contratos donde figura como aliada— sin ningún acceso extra a
> minorista.

---

## 7. Punto 5: `contratos_donde_es_asesor`, corregido

Ya aplicado en `supabase/scripts/test_rls_por_rol.sql`. La columna pasa a
llamarse **`coincidencias_por_nombre`** y el resultado trae una columna que dice
cómo leerla:

| Rol | Cómo se interpreta |
|---|---|
| `venta`, dentro de su agencia | **expectativa operativa** — es lo que la app usa para decidir qué gestiona |
| cualquier otro rol, o contratos de otra agencia | **informativo** — coincidencia textual, no es un permiso |

Y queda escrita la regla que faltaba:

> Si `coincidencias_por_nombre > 0` pero esos contratos no están en
> `contratos_visibles`, **lo que hay que revisar es el dato** —quién debería
> estar en `ventas.asesor`— **no la RLS**.

Es exactamente el diagnóstico equivocado al que llevó la lectura anterior.

---

## 8. Punto 7: la auditoría de Storage entre agencias sigue pendiente

Es **independiente de este caso** y no queda absorbida por él.

Lo que falta, tal cual quedó en `adjuntos-y-storage.md`:

- Correr `supabase/scripts/pruebas/storage-adjuntos.mjs --confirmar` contra
  producción. Es lo único de todo el frente de adjuntos que no se ha ejecutado.
- Las policies del bucket `contratos` **no filtran por tenant**: se apoyan en
  `soy_asesor_del_contrato(prefijo)` y en que el número de contrato sea único
  globalmente (minorista lleva `MIN-`). Eso hay que **verificarlo**, no
  suponerlo: un asesor de mayorista intentando leer un archivo de un contrato
  `MIN-` debe fallar.
- Y el caso de esta persona lo hace más pertinente, no menos: si su nombre está
  en `ventas.asesor` de contratos de minorista, `soy_asesor_del_contrato` le da
  **true** para esos números — y las policies de Storage **no comprueban el
  tenant**. Habría que confirmar si eso le abre los archivos de esos contratos.
  **No lo he verificado y no lo doy por hecho**, pero es la primera cosa que
  probaría.

---

## 9. Resumen de lo que está hecho y lo que falta

| | Estado |
|---|---|
| Pausar `usuario_tenants` | hecho (este documento) |
| Auditar MIN-00-0460/0461 | **script listo, falta ejecutarlo** — no tengo acceso |
| Determinar si `asesor` trae el freelance | **confirmado en el código** para contratos importados; falta confirmar estos dos |
| Pertenencia B2B por `aliado_id` | el resolvedor sí; **los datos importados no** (aliado_id NULL) |
| `contratos_donde_es_asesor` | corregido |
| Portal B2B con cuenta interna | **necesita tu decisión**; diseño aditivo listo si la respuesta es sí |
| Auditoría de Storage entre agencias | pendiente, con una hipótesis concreta que probar |
