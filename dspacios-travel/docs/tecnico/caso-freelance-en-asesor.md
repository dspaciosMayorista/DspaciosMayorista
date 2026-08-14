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
debería traer a un interno.

### ⚠️ La auditoría NO identifica al importador de forma inequívoca

Lo comprobé en el esquema, no lo supuse. `auditoria` (migración 087) guarda:
actor (`actor_id`/`actor_email`/`actor_nombre`/`actor_rol`), `accion`, `tabla`,
`registro_id`, `antes`, `despues`, `cambios` y `tenant`. Y `accion` es
literalmente `TG_OP`: solo `INSERT`, `UPDATE` o `DELETE`. **No hay columna de
origen, módulo, descripción ni nada que diga de dónde vino la escritura.**

Un actor vacío ("Sistema") solo significa que `auth.uid()` era null, y eso pasa
con cualquier escritura hecha con service-role **o desde el editor SQL de
Supabase**. En este código hay varias: los costos y las sillas de `reservar`,
los asientos contables automáticos, los backfills. Así que es un **INDICIO, no
una firma**.

Lo que sí lo acota: de los tres caminos que **crean** una venta, dos —el
formulario manual (`contratos/actions.ts`) y `reservar`— insertan con el cliente
de sesión y por tanto dejan actor. Solo el importador inserta con
`createAdminClient()`. Un `INSERT` sobre `ventas` con actor vacío apunta al
importador, pero se vería igual si alguien insertara a mano desde el editor SQL.
(Ojo: los **UPDATE** con actor vacío sobre `ventas` son comunes —`reservar`
actualiza costos así— y no dicen nada.)

**Por eso el script no se apoya solo en eso.** El bloque 4.b corrobora por la
FORMA de la fila, que no depende de la auditoría: el importador es el único
camino que deja `destino`, `tipo_paquete` y `fecha_regreso` en null, `pax` en 1,
estado `confirmado` de entrada, el mismo texto en `asesor` y `freelance_nombre`,
y `aliado_id` sin escribir. Ninguna señal por separado prueba nada; las seis
juntas sí distinguen.

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
`update`. **Ejecutado de principio a fin contra una base local con el esquema
completo**, no solo revisado: así aparecieron dos errores que un vistazo no
detecta —la lista de contratos estaba en un `with` declarado una sola vez (un
CTE solo vive durante SU statement, así que los bloques 2 en adelante fallaban)
y el bloque de auditoría pedía columnas que no existen (`fecha`,
`usuario_nombre`, `usuario_rol`; son `creado_en`, `actor_nombre`, `actor_rol`)—.
La lista va ahora inline en cada consulta: **si cambias los números, cámbialos
en los seis bloques.** Seis bloques:

1. La cabecera de las dos ventas, campo por campo, con el aliado y el usuario
   B2B resueltos por sus IDs.
2. **¿`asesor` apunta a un interno o a un aliado?** Cruza el nombre contra
   `usuarios` (roles internos) y contra `aliados`, normalizando mayúsculas y
   espacios, y emite un veredicto por contrato.
3. **¿Por dónde se resuelve la pertenencia B2B?** `b2b_usuario_id` → `aliado_id`
   → nombre en texto. Si llega al tercero, dice cuántas fichas del catálogo
   coinciden con ese nombre (y si hay homónimos, que harían ambiguo el cruce).
4. **Quién creó y quién gestiona**, desde `auditoria` — con su límite escrito
   dentro: actor vacío es un indicio, no una firma (ver arriba).
4.b **La forma de la fila**, que no depende de la auditoría: las seis marcas del
   importador, juntas.
5. La persona concreta: si su nombre está en `ventas.asesor` y si el tenant
   coincide — las dos mitades del síntoma, por separado. **Lleva
   `CAMBIAR@ejemplo.com`**: sin cambiar el correo devuelve 0 filas.
6. Un veredicto por contrato, en una línea.

Pásame la salida y cierro el diagnóstico con datos en vez de con inferencia del
código.

---

## 4. La pertenencia B2B sí se resuelve por `aliado_id`… cuando lo hay

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

## 5. ¿Qué debería llevar `ventas.asesor`?

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

## 6. ¿Necesita entrar al Portal B2B con su cuenta interna?

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

**Retiro la propuesta anterior.** Decía que bastaba con cambiar el gate de
`rol in ('agencia','freelance')` a `… OR usuarios.aliado_id is not null`. Es
falso: el portal no se reduce a ese gate, y auditándolo entero aparecen tres
cosas que ese cambio no cubre.

#### Lo que hay hoy, archivo por archivo

| Dónde | Cómo decide | Qué pasaría con doble capacidad |
|---|---|---|
| `app/portal/b2b/page.tsx` | `esB2B = rol === 'agencia' \|\| rol === 'freelance'` | Es el gate que se comentaba. Pero además **deriva todo del rol**, no solo la entrada (ver abajo) |
| `app/portal/b2b/agentes/page.tsx` y `agentes/actions.ts` | `rol === 'agencia' && !agencia_id && activo` | **No se abre solo**: ella seguiría siendo `operaciones`. Correcto por accidente, conviene que sea por decisión |
| `lib/finanzas/comisionResolver.ts` | `esInterno = ROLES_INTERNOS.includes(rol)`; si no, `esDueno` **por nombre** | `operaciones` ya está en `ROLES_INTERNOS`: **hoy ya puede abrir la cuenta de cobro de cualquier contrato**, incluida la otra agencia |
| `lib/cuenta/estado.ts` (`/estado-cuenta/[numero]`) | igual | Igual |
| `app/portal/registro/actions.ts` | crea con `rol: tipo` (`agencia`/`freelance`) | No aplica: ella ya tiene cuenta |
| `proxy.ts` | rebota solo a los roles **externos** del dashboard | No la toca: sigue siendo interna |

#### Los tres problemas

**1. El rol decide más cosas que la entrada.** En `portal/b2b/page.tsx` el rol
alimenta también `comisionDefault(sb, rol)` y `categoriaAliado(rol, …)`, y el
`esTitularAgencia` que abre la gestión de agentes. Con `rol = 'operaciones'`
esas llamadas reciben un valor que no esperan; el código actual lo tapa con
`rol ?? "agencia"`, que **la trataría como agencia aunque sea freelance** — con
otro porcentaje de comisión por defecto.

Por eso, si se habilita la doble capacidad, **el tipo B2B tiene que venir de
`aliados.tipo`** (la ficha del catálogo a la que apunte `usuarios.aliado_id`), y
el rol interno seguir siendo `operaciones` sin participar en esa decisión. En la
práctica: resolver `tipoB2B = aliados.tipo` una vez y pasar **eso** —no el rol— a
`comisionDefault`, `categoriaAliado` y a cualquier gate de titular de agencia.

**2. La pertenencia se resuelve por nombre en dos de los cuatro sitios.**
`portal/b2b/page.tsx` sí usa `aliado_id` (migración 143), pero
`comisionResolver` y `cargarEstadoCuenta` siguen con
`[agencia_nombre, freelance_nombre].includes(perfil.nombre)`. Habilitarla en el
portal sin tocar esas dos deja el vínculo débil justo en los documentos de
dinero.

**3. Y había un agujero previo, que no lo creaba esta decisión — YA CERRADO.**
Esas dos funciones leían con **service-role** y decidían solo por rol, **sin
comparar el tenant**, aunque lo tenían en la fila recién leída. `operaciones`
está en la lista de roles internos, así que ella podía abrir por URL la cuenta
de cobro y el estado de cuenta de cualquier contrato de la otra agencia — y con
ellos el plan de cobro y el recibo, que heredan el mismo control. Cerrado con
`lib/auth/accesoDocumentoContrato.ts`, compartido por las dos. Detalle en
`adjuntos-y-storage.md` §5.

#### Entonces

El camino sigue siendo aditivo y sigue sin necesitar `usuario_tenants`, pero no
es una condición en un `if`:

1. Enlazar su `usuarios.aliado_id` a su ficha del catálogo.
2. Que el portal derive el **tipo B2B de `aliados.tipo`**, no del rol.
3. ~~Que `comisionResolver` y `cargarEstadoCuenta` resuelvan la pertenencia por
   `aliado_id` y comparen el tenant.~~ **HECHO** — había que hacerlo igual, se
   habilitara o no la doble capacidad, porque era un agujero abierto. Con eso ya
   funciona el caso "entra como aliada de la otra agencia, no como interna":
   está probado en `pruebas/accesoDocumentoContrato.test.ts`.
4. Falta decidir 1 y 2, y solo entonces abrir el gate de `portal/b2b`.

**El portal B2B sigue cerrado para roles internos.** Esto no lo habilita: lo
único que cambió es que, si algún día se habilita, la pieza de autorización ya
está puesta y probada.

> Detalle a decidir si se toma este camino: qué ve al entrar al portal alguien
> que además es interno. Lo razonable es que vea **solo** su panel de aliado —
> comisiones y contratos donde figura como aliada— sin ningún acceso extra a
> minorista.

## 7. `contratos_donde_es_asesor`, corregido — ahora separado por agencia

Aplicado en `supabase/scripts/test_rls_por_rol.sql`. Una sola columna no servía:
sumaba las coincidencias de las dos agencias, y solo una de las dos puede ser
una expectativa operativa. Ahora son dos:

| Columna | Qué significa |
|---|---|
| `coincidencias_mismo_tenant` | Contratos de SU agencia. **Solo aquí** puede haber expectativa operativa, y solo para `venta`: es lo que la app usa para decidir qué gestiona |
| `coincidencias_otro_tenant` | Contratos de la OTRA agencia. **Nunca** es una expectativa, para ningún rol. `soy_asesor_del_contrato` empareja por nombre sin mirar el tenant, pero `puede_ver_contrato` sí |

Y queda escrita la regla que faltaba:

> Si `coincidencias_mismo_tenant > 0` pero esos contratos no están entre los
> visibles, **lo que hay que revisar es el dato** —quién debería estar en
> `ventas.asesor`— **no la RLS**. Y si lo que hay es
> `coincidencias_otro_tenant > 0`, no hay nada que revisar: la RLS está haciendo
> justo lo que debe.

Ejecutando el script aparecieron además dos cosas que el vistazo no daba:

- El bucle no seleccionaba `tenant`, así que la separación ni compilaba.
- La expectativa escrita («`venta` → todos los de su agencia») quedó **obsoleta
  con la migración 144**: desde entonces `venta` no lee la tabla `ventas`, entra
  por la vista `ventas_basica`. El script medía la tabla, así que mostraba `0`
  para todo `venta` — un cero alarmante que en realidad era lo correcto. Ahora
  mide **las dos** y dice cuál manda para cada rol.

---

## 8. Storage entre agencias: confirmado y CERRADO (migración 150)

En la versión anterior de este documento esto estaba escrito como "la primera
cosa que probaría". Estaba mal medido: **no hace falta probarlo para saberlo, se
lee en el texto de la policy** — y además ya está comprobado.

Las cuatro policies del bucket `contratos` (migración 148) dicen:

```sql
and mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
and (mi_rol() <> 'venta' or soy_asesor_del_contrato(split_part(name,'/',1)))
```

Para esta persona, que es **`operaciones`**, `mi_rol() <> 'venta'` ya es `true`:
la disyunción se resuelve ahí y **`soy_asesor_del_contrato` nunca se evalúa**.
No depende de que su nombre esté en `ventas.asesor` — eso era lo que yo daba por
determinante y no lo es. Y **ninguna policy compara el tenant**.

Conclusión: **alcanza todos los archivos del bucket, de las dos agencias**, y lo
haría igual aunque su nombre no apareciera en ningún contrato.

Comprobado, no deducido a medias: `supabase/scripts/test_storage_cruce_tenant.sql`
evalúa el predicado haciéndose pasar por cada usuario contra cada contrato. En
una base local con el esquema completo, un `operaciones` de mayorista da
`permite = true` sobre contratos `MIN-`, con la columna «¿se evaluó
soy_asesor_del_contrato?» en `f`.

Hay un **segundo camino**, independiente, que sí depende del nombre: un `venta`
cuyo nombre coincida con `ventas.asesor` de un contrato de la otra agencia
también alcanza sus archivos, porque `soy_asesor_del_contrato` es
`SECURITY DEFINER` y empareja solo por nombre. Comprobado igual (el script lo
etiqueta aparte). Ese es exactamente el escenario que crea el importador.

**Lo que NO se filtra:** el contrato en sí. `puede_ver_contrato` sí compara el
tenant, así que la ficha, la cartera y los pasajeros siguen protegidos. Lo que
queda al alcance son los **archivos** — donde están las cédulas.

### Cerrado

**Migración 150** (`storage_contratos_por_tenant`, escrita y probada en local,
**sin correr todavía**): las cuatro policies pasan por un helper
`acceso_archivo_contratos(ruta)` que exige sesión, usuario activo, rol, agencia
y —para `venta`— propiedad. Para esta persona el efecto es directo: con
`operaciones` de mayorista deja de alcanzar cualquier archivo de minorista, y el
segundo camino (coincidencia de nombre) queda cerrado por la comparación de
tenant.

El **mismo patrón fuera de Storage** también se cerró: `resolverComisionB2B` y
`cargarEstadoCuenta` —y con ellas el plan de cobro y el recibo— ahora deciden
con una función compartida que sí compara el tenant y resuelve la pertenencia
por id. Detalle completo, matriz de expectativa y resultados en
`adjuntos-y-storage.md` §4 y §5.

## 9. Resumen de lo que está hecho y lo que falta

| | Estado |
|---|---|
| Pausar `usuario_tenants` | hecho (este documento) |
| Auditar MIN-00-0460/0461 | **script listo, falta ejecutarlo** — no tengo acceso |
| Determinar si `asesor` trae el freelance | **confirmado en el código** para contratos importados; falta confirmar estos dos |
| Pertenencia B2B por `aliado_id` | el resolvedor sí; **los datos importados no** (aliado_id NULL) |
| `contratos_donde_es_asesor` | corregido y **separado por agencia**; script ejecutado |
| Portal B2B con cuenta interna | **necesita tu decisión**; el diseño anterior era insuficiente, ver §6 |
| Storage entre agencias | **cerrado** por la migración 150 (escrita y probada en local, **sin correr**). Falta medir el alcance real en producción con `test_storage_cruce_tenant.sql` antes de aplicarla |
| Mismo patrón en cuenta de cobro, estado de cuenta, plan de cobro y recibo | **cerrado** con `lib/auth/accesoDocumentoContrato.ts` |
| Asimetría de `gerencia` (ve la ficha de la otra agencia pero no sus adjuntos) | **necesita tu decisión**, avisada en la cabecera de la 150 |
