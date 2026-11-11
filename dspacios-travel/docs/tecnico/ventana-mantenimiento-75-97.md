# Entrega #75 + #97 y ventana de mantenimiento — procedimiento para auditar (rev. 6, 2026-11-11)

Estado: **listo para auditar; nada confirmado en ramas, nada desplegado, nada activado.**
- En producción: 284, 285, 287, **293** y **294** aplicadas (294 con postcheck CORRECTA).
- Pendientes: 288+292 (atómica), 286, 289, 290, 291.
- Mantenimiento y reuso apagados.

Cambios de la rev. 6:
- cierre de `MANTENIMIENTO_CLAVE` con build nuevo (§5 F);
- punto de parada de despliegues antiguos antes de reabrir (§5 E, paso 17);
- contadores como evidencia auxiliar (§4);
- comparaciones de las pruebas precisadas y «base local equivalente a producción» (§3);
- la 295 no está libre (§1.2);
- instrucciones exactas para preparar las ramas (§2).

## 1. Versiones exactas
### 1.1 Base de código
`origin/main` = **`2ca311353`** (#446). Base común de las ramas #75 y #97: **`e39224313`**.

### 1.2 Migraciones (huella SHA-256 del contenido con LF)
| N.º | Archivo | Frente | Estado en producción | SHA-256 |
|---|---|---|---|---|
| 284 | `identidad_contrato` | #75 | aplicada | `1de3bb79…a48fc2` |
| 285 | `identidad_funciones_storage` | #75 | aplicada | `53926441…a827e` |
| 287 | `reuso_consecutivos_dtm` | #75 | aplicada | `ddae920b…abf2a8` |
| 293 | `vigencia_grupos_dias_inactivos` | #43/#60 (#446, en main) | aplicada | — (no es de este frente) |
| 294 | `mantenimiento_escrituras` | #75 | **aplicada**, no se vuelve a ejecutar | `3f8fe5af…cbe887` |
| 288 + 292 | vía `scripts/aplicar_288_292_atomico.sql` | #75 | pendiente (UNA transacción) | atómica `2a61ac70…c03f86` · 288 `228496ac…802ca0` · 292 `d5372be8…3c162e` |
| 286 | `cotizacion_comision_acuerdo` | #97 | pendiente | `d45aef77…a6e4a` (= la que declaró #97) |
| 289 | `elegibilidad_dtm_ampliada` | #75 | pendiente | `870fa98b…fbcaf2` |
| 290 | `comision_manual_pendiente_y_duplicado` | #97 | pendiente | `7405b9b3…556bbd` |
| 291 | `reemision_neto_pendiente` | #75 | pendiente | `ead1667e…4955ff` |

Notas:
- La 294 de la tabla es la versión verificada en local; el postcheck remoto CORRECTA confirma sus objetos, firmas, permisos y la comprobación de operador activo.
- **La 295 NO está libre:** corresponde al incremento 3 de #43/#60. Este frente no necesita números nuevos. Cualquier migración futura toma su número revisando `supabase/migrations/` en `main` y coordinándolo con el dueño.

### 1.3 Código
Manifiesto: `entrega-75-97-manifiesto.md`. Excluye `docs/`. Tiene **280 archivos**:
- 230 solo de #75;
- 41 solo de #97;
- 9 tocados por los dos.

En **11** archivos el resultado integrado difiere de la versión de su rama (fusión a 3 vías y parches). Por eso el manifiesto trae **tres huellas por archivo** (§2.1).

Corrección hecha en esta entrega: `lib/supabase/mantenimiento.ts` carga `next/headers` de forma dinámica (antes rompía las pruebas de React que cargan `admin.ts` fuera de Next). Afecta solo al código, no a la 294 aplicada.

## 2. Ramas, PR y cómo se integran
| Frente | Rama | Árbol | Estado |
|---|---|---|---|
| **#75** | `claude/75-reuso-dtm` (PR #445) | `.worktrees/75-reuso-dtm` | En remoto solo `6a29bbe` (284, 285, 287). El resto, sin confirmar |
| **#97** | `claude/portal-b2b-bloque-97-98-84-32` | `.worktrees/portal-b2b-bloque` | Solo local, sin commits, sobre `e39224313`. **No se modificó** |
| Integración | — | `.worktrees/integ-final-7597` | **Temporal de pruebas**, sin rama. **No se publica ni se copia** |

### 2.1 Archivos originales de cada rama vs. resultado integrado
Hay tres columnas de huellas en el manifiesto. Cada una se comprueba con `supabase/scripts/verificar_manifiesto_75_97.mjs`, que solo lee.

| Columna | Qué es | Archivos | Comprobado en local |
|---|---|---|---|
| `rama #75 tras main` | #75 confirmada **y** con `origin/main` incorporado | 239 | Antes de incorporar main: 237 coinciden. Los 2 que faltan (`types/database.ts`, `pruebas/salidaVinculada63Wiring.test.ts`) son los que trae #446 |
| `rama #97 original` | Los archivos de #97 **tal como están en su árbol**, sin integrar | 50 | 50/50 |
| `integrado` | Rama #97 tras incorporar #75, resolver los 3 conflictos y aplicar los 2 parches = lo que llega a `main` | 280 | 280/280 en `integ-final-7597`, 0 archivos cambiados fuera del manifiesto |

Los archivos que confirma cada rama salen de dos listas:
- `entrega-75-archivos.txt` (253 rutas, con su documentación, incluido este documento);
- `entrega-97-archivos.txt` (55 rutas, con su documentación).

Las dos listas se generaron con `git diff --name-only e39224313` + los archivos sin seguimiento de cada árbol. Algunas rutas de la lista #75 ya están en `6a29bbe`: `git add` no hace nada con ellas.

**El árbol temporal no se copia.** Las ramas se construyen con sus propios archivos, `git merge` y los dos parches; el árbol temporal solo sirve para comparar un archivo puntual si una huella no coincide (`git diff --no-index`).

### 2.2 Instrucciones (las ejecuta el dueño, desde la carpeta raíz de cada árbol: la que contiene `dspacios-travel/`)
**Paso A — #75** (en `.worktrees/75-reuso-dtm`):
```bash
git status --short                      # revisar: nada ajeno a la entrega
git add --pathspec-from-file=dspacios-travel/docs/tecnico/entrega-75-archivos.txt
git status --short                      # ⛔ no debe quedar ninguna ruta de la lista sin preparar
git commit -m "#75: previstas hasta confirmar, 288+292 atómica, 289, 291, ventana de mantenimiento (294)"
git fetch origin
git merge origin/main                   # esperado: sin conflictos (verificado a 3 vías)
node dspacios-travel/supabase/scripts/verificar_manifiesto_75_97.mjs rama75
                                        # ⛔ «239 coinciden · 0 no coinciden»
git push origin claude/75-reuso-dtm     # actualiza el PR #445
```

**Paso B — #97** (en `.worktrees/portal-b2b-bloque`; `M` es la carpeta `docs/tecnico` de #75):
```bash
M=../75-reuso-dtm/dspacios-travel/docs/tecnico
node ../75-reuso-dtm/dspacios-travel/supabase/scripts/verificar_manifiesto_75_97.mjs rama97 $M/entrega-75-97-manifiesto.md
                                        # ⛔ «50 coinciden · 0 no coinciden» (sus archivos, sin tocar)
git status --short
git add --pathspec-from-file=$M/entrega-97-archivos.txt
git status --short                      # ⛔ no debe quedar ninguna ruta de la lista sin preparar
git commit -m "#97: planes de comisión B2B (286, 290)"
git merge claude/75-reuso-dtm           # trae #75 + main. Se esperan 3 conflictos
```

Resolver los 3 conflictos conservando **ambos** lados (coordinación §6):
1. `app/(dashboard)/dashboard/contratos/actions.ts`: la línea del estado inicial es idéntica en los dos lados; se deja una sola y se conserva el comentario «288 (#75)…».
2. `app/(dashboard)/dashboard/cotizaciones/manual-actions.ts`: la línea `const admin = createAdminClient(); // identidad:n/a — …` de #75 **y** la llamada nueva de #97 (`argsBase` / `crear_cotizacion_manual_con_acuerdo`).
3. `pruebas/support/fechaNegocioArnes.ts`: los manejadores por defecto de los dos, `p97_dependencias_comision_faltantes` (#97) **y** `prevista_cxp_aplicar` / `pendiente_aplicar_servicios` (#75).

```bash
git add -u && git commit --no-edit      # commit de la fusión, solo con las resoluciones
patch -l -u "dspacios-travel/app/(dashboard)/dashboard/contratos/actions.ts" < dspacios-travel/docs/tecnico/integracion-97-con-75.diff
                                        # parche de #97. `-l` es obligatorio: el checkout es CRLF y sin él fallan los 3 bloques. Esperado: «offset 1 line»
git apply $M/integracion-75-97-ajustes-pruebas.diff
                                        # ajustes de integración: regex de comisionAsistidaPvp97, 17→18 en medicionFlujoWiring y la anotación identidad:n/a
node dspacios-travel/supabase/scripts/verificar_manifiesto_75_97.mjs integrado
                                        # ⛔ «280 coinciden · 0 no coinciden · 0 cambiados fuera del manifiesto»
git add -u && git commit -m "Integración #97 con #75: llamadas con idc y ajustes de pruebas"
git push -u origin claude/portal-b2b-bloque-97-98-84-32   # abrir PR #97 hacia main
```
- Si una huella no coincide, se compara **ese archivo** con el árbol temporal (`git diff --no-index`), se corrige a mano y se repite el verificador. Nunca se copia el árbol entero.
- Con el verificador en 0, no hace falta repetir `tsc`/build/suites: el contenido es idéntico byte a byte (en LF) al verificado en el §3. Solo `next build` en Vercel (paso 4).

**Paso C — fusión a `main`:** solo dentro de la secuencia del §5 (paso 4): #75 primero, luego #97, con la asignación automática de dominios desactivada. Ninguna de las dos fusiones llega así a servir producción por sí sola.

## 3. Verificaciones del árbol integrado
Se repitieron solo las invalidadas por cambios posteriores (base #446, correcciones finales de #75, base de datos con 293+294):

| Verificación | Resultado | Contra qué se comparó |
|---|---|---|
| `tsc` | 0 errores | — |
| `next build` | correcto | — |
| `test:unit` | 9288 pruebas, **30 fallos** | **Mismo conjunto de 30, por nombre**, que la corrida de `test:unit` en el árbol de trabajo `75-reuso-dtm` (#75 sin integrar, sobre `e39224313`). **No se comparó contra `origin/main`**: no consta que sean de `main` |
| `test:react` | 1664 pruebas, **26 fallos**: `comisionPortalB2B` 12, `dinamicoEnPaquetes` 13, `participacionEconomica65` 1 | Se corrieron **solo esos 3 archivos** en un árbol limpio de `origin/main` (`2ca311353`), con el mismo número de fallos por archivo. `test:react` completo sobre `main` no se corrió |
| Suite 262 (código integrado + esquema final real) | **86/86** | — |
| Arnés app→PostgREST #97 (`contratoManualNeto206`) | **87/87** con el ciclo apagado y **87/87** encendido | La corrida anterior daba 78/80 |
| SQL #75 sobre el esquema final real | 288: 41/41 · 288b: 48/48 · 288c: 32/32 · 289: 95/95 · 291: 58/58 + carrera 11/11 · 292: 34/34 | — |
| SQL #97 sobre el esquema final real | acuerdo 105 OK · ciclo apagado 25/25 · comisión PVP 22 OK · negociado 13 OK · 290: 56/56 apagado y encendido + carreras 23/23 y 23/23 · carrera: una sola comisión entre 8 sesiones · materialización concurrente OK | — |
| Atómica 288+292 sobre la **base local equivalente a producción** (287+293+294) | **16/16** | — |
| Ida y vuelta completa sobre la **base local equivalente a producción** | **15/15** | Única diferencia: las 2 columnas que `rollback_288` conserva |
| Deduplicación en Next (código integrado) | Ver tabla de abajo | — |

«Esquema final real» y «base local equivalente a producción» son copias locales (Docker, PostgreSQL 15.8):
- `plantilla_prod_actual` = volcado de producción hasta la 287 + 293 + 294;
- `plantilla_final_actual` = la anterior + la secuencia completa, con los usuarios de prueba que esos scripts suponen sembrados.

**Ninguna prueba se ejecutó contra la base de producción.**

Deduplicación medida con `next dev` (webpack), en un Route Handler y un Server Component:

| Escenario | Con `MANTENIMIENTO_CLAVE` | Sin la variable |
|---|---|---|
| Una petición con 4 clientes y 6 consultas | 1 llamada a Auth; 6/6 solicitudes con cabeceras | 0 |
| Otra petición independiente | 1 más | 0 |
| Sin sesión | 0 | 0 |
| Auth con error | 1, sin reintento | 0 |
| Server Component | 1 | 0 |
| Dos peticiones simultáneas | 2 | 0 |

En ningún caso llegaron solicitudes en los 2 s siguientes.

**Límites (no son pruebas hechas):**
- **Server Actions:** no se midieron. El código pasa por los mismos clientes (`server.ts`/`admin.ts`), pero no se ha observado cuántas llamadas a Auth hace una Server Action ni si la memoización por petición se mantiene ahí.
- **Producción:** no se ejecutó el build de producción (Turbopack, `next start` ni Vercel). La medición es de `next dev`.
- **Versiones del proyecto:** las de PostgREST y Storage del proyecto no se conocen; las pruebas usaron PostgREST v16.4 y storage-api v1.84.19. Se comprueba en vivo en los pasos 8 y 14.

## 4. Inventario real (resultado remoto del dueño)
- **Inventario: 0 puntos por revisar.**
- **Sin filtro previo de PostgREST:** la activación registra el de mantenimiento a nivel de rol y la desactivación hace `reset` (ningún filtro queda después).
- **Jobs activos:** `tarifario_cola_correr` y `tarifario_cola_purga`. La activación pausa los dos y la desactivación reactiva exactamente esos dos.
- **Mantenimiento y reuso apagados.**

**La ausencia de filas en la auditoría NO prueba que no hubo escrituras:** hay tablas sin trigger de auditoría (inventario, punto 46) y servicios que no pasan por él. La garantía de la ventana es el **bloqueo verificado en vivo** (sonda 503, Storage rechazado, 0 transacciones anteriores abiertas).

**Contadores de escritura (`foto_contadores_ventana.sql` al activar, `comparar_contadores_ventana.sql` antes de reabrir): evidencia AUXILIAR, no un veredicto.**
- `pg_stat_user_tables` cuenta filas insertadas, actualizadas y borradas por tabla, también en tablas sin auditoría. Probado en local: señala `public.proveedores` y `public.auditoria` tras una escritura.
- **No distingue escrituras legítimas de indebidas** dentro de una misma tabla: la migración, la validación y una escritura indebida suman en el mismo contador.
- La lista de tablas modificadas **requiere revisión humana**, una por una: qué contrato o proceso la tocó, cruzando con la auditoría donde exista. No es una aprobación automática.
- Los contadores se publican con unos segundos de retraso.
- `stats_reset` (de `pg_stat_database`) cambia con un reinicio de toda la base. En la versión probada (15.8) también cambió al reiniciar una sola tabla, pero **no se garantiza que delate todo reinicio**. Por eso la comparación también marca cualquier contador que haya bajado.

**Integraciones externas: siguen sin confirmar.** El inventario solo ve lo que deja rastro en la base.

## 5. Secuencia operativa única (⛔ = punto de parada: no seguir si no se cumple)
**A. Preparación (sin ventana)**
1. Ramas y PR según el §2.2. ⛔ Verificador en 0 para `rama75`, `rama97` e `integrado`.
2. Generar el secreto y su hash **sin mostrar el secreto**. En PowerShell, en la máquina del dueño (probado: produce 43 caracteres y el hash coincide con sha256 de referencia):
   ```powershell
   $b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
   $clave = [Convert]::ToBase64String($b).TrimEnd('=').Replace('+','-').Replace('/','_')
   $sha = -join ([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($clave)) | ForEach-Object { $_.ToString('x2') })
   $sha            # SOLO el hash: guardarlo para el paso 13
   ```
   - Cargar `$clave` como `MANTENIMIENTO_CLAVE` en Vercel: servidor, sensible, **solo Production**. Por ejemplo, `$clave | vercel env add MANTENIMIENTO_CLAVE production` (y marcarla como sensible en el panel), o pegándola en el panel desde el portapapeles (`Set-Clipboard $clave`, y luego `Set-Clipboard $null`).
   - Después: `Remove-Variable clave, b`.
   - No escribir el secreto en archivos, chats, SQL ni capturas.
   - Si el valor cargado no coincide con el hash (por ejemplo, un salto de línea añadido), la validación del paso 14 falla con 503: es un punto de parada, no un daño. Se repite este paso con un secreto nuevo.
3. En Vercel:
   - desactivar *Auto-assign Custom Production Domains*;
   - activar Deployment Protection para las URL de despliegue.
4. **Build staged:** fusionar a `main` (#75 y luego #97). Vercel crea builds de Producción **staged**, que no sirven el dominio ni ejecutan los crons.
   - ⛔ Solo se usa el **último** build (el que tiene #75+#97), con la variable del paso 2.
   - ⛔ Su URL exige autenticación de Vercel.
   - ⛔ Nadie la usa hasta el paso 14: con el mantenimiento apagado escribiría contra el esquema viejo.

**B. Mantenimiento**
5. Foto previa: huella del esquema y conteos.
6. `activar_mantenimiento.sql` con la lista de operadores.
7. En otra ejecución: `select mant_priv.cortar_en_curso();` → `verificar_mantenimiento.sql`.
   - ⛔ Filtro registrado a nivel de rol;
   - ⛔ los 2 jobs pausados;
   - ⛔ 0 transacciones anteriores abiertas.
8. **Comprobación desde fuera** con la clave anon:
   - ⛔ `POST rpc/mantenimiento_sonda` → 503;
   - ⛔ con el SHA del commit → 503;
   - ⛔ subida a Storage → rechazada;
   - ⛔ una edición desde la app vieja → falla.
   - Si cualquiera falla: `desactivar_mantenimiento.sql` y detener (nada más se tocó).
9. `foto_contadores_ventana.sql` → guardar el JSON.

**C. Migraciones**
10. Preflights 288, 286, 289, 290 y 291. ⛔ Todo OK.
11. `aplicar_288_292_atomico.sql` → postchecks 288 y 292. ⛔ Correctos.
12. 286 → 289 → 290 → 291, cada una con su postcheck. ⛔ Correctos (289 sin FALLA).

**D. Validación**
13. `habilitar_excepcion_mantenimiento.sql` con el **hash** (`$sha`), nunca el secreto.
14. **Validación reversible** de los operadores sobre la URL staged:
    - contrato pendiente sin aliado B2B (previstas y 0 CxP);
    - edición de sus servicios;
    - intento de borrar su servicio (rechazado);
    - eliminar esos contratos con la acción real.
    - ⛔ 0 previstas, 0 planes de comisión, 0 filas de validación.
15. **⛔ PUNTO DE NO RETORNO — decisión del dueño.**
16. **Validación con datos:** B2B con plan (una sola comisión al confirmar y al reintentar), confirmación con CxP enlazadas **y asientos**, NETO, abono.
    - Las subidas desde el navegador y los crons no tienen excepción: se validan tras reabrir.

**E. Antes de reabrir: despliegues antiguos (⛔ punto de parada, decisión del dueño)**
17. Al reabrir, **cualquier código anterior a la integración que siga alcanzable escribe contra el esquema final** (CxP duplicadas y asientos faltantes: anexo). La ventana solo lo contiene mientras está activa. Antes de reabrir:
    1. **Inventario**, de solo lectura (panel de Vercel o `vercel ls` / `vercel inspect <url>`):
       - despliegues de **Production** antiguos (cada uno conserva su URL propia);
       - despliegues de **Preview** de cualquier rama: usan la misma base, según CLAUDE.md;
       - alias de rama y dominios o alias personalizados apuntando a cada uno;
       - commit de cada despliegue: ¿contiene el commit integrado? Comprobarlo con `git merge-base --is-ancestor <integrado> <sha>`.
    2. **Accesos autorizados**, también solo inventario:
       - miembros del equipo de Vercel;
       - enlaces compartibles (*Shareable Links*);
       - *Protection Bypass for Automation*;
       - contraseña de despliegue, si existe;
       - el valor de *Deployment Protection* para Preview y Production.

       **Deployment Protection no bloquea a los miembros autorizados**: un miembro con sesión puede abrir y usar la URL de un despliegue viejo.
    3. **Pantallas viejas abiertas:**
       - Una pestaña abierta antes de la promoción ejecuta el JavaScript viejo en el navegador. Puede escribir directo a Supabase/Storage con la sesión del usuario (`lib/supabase/client.ts`).
       - Sus Server Actions apuntan al build viejo. Si *Skew Protection* está activa, Vercel las enruta **al despliegue viejo**, que ejecuta código viejo. Si no está activa, deberían fallar al no encontrar la acción en el build nuevo, pero no está verificado.
       - Comprobar en Vercel si Skew Protection está activa y con qué antigüedad máxima.
    4. **Opciones para impedir el código incompatible.** Las decide el dueño; aquí no se cambia nada.
       - avisar a los usuarios internos que recarguen y cerrar sesiones antiguas;
       - eliminar o restringir los despliegues antiguos (Production y Preview);
       - quitar a Preview las variables de la base compartida o apuntarlas a otra base;
       - un *Ignored Build Step* que no construya Preview de ramas sin el commit integrado;
       - desactivar o ajustar Skew Protection durante la reapertura.

       **Cómo verificar:** el inventario repetido no muestra ningún despliegue alcanzable sin el commit integrado, o la lista que quede la acepta el dueño por escrito, con quién puede usarla. Después de reabrir ya no hay ventana: lo que siga alcanzable escribe sin control adicional.
    - ⛔ No seguir sin una decisión explícita del dueño sobre cada despliegue alcanzable y sobre las pestañas viejas.
18. **Promover** el build staged (instantáneo, sin reconstruir) y reactivar la auto-asignación. ⛔ Producción sirve el commit integrado.
19. `comparar_contadores_ventana.sql` con la foto del paso 9 (evidencia auxiliar, §4).
    - ⛔ Filas 0 y 1 sin indicios.
    - ⛔ Cada tabla de la fila 2 revisada a mano y explicada: migración, validación, `mant_priv`, `cron`, `auth`. Una tabla sin explicación detiene la reapertura hasta aclararla.
20. Comprobaciones finales:
    - ⛔ `preflight_292` punto 4 = 0;
    - ⛔ postchecks correctos;
    - ⛔ ningún servicio con CxP y prevista a la vez;
    - ⛔ objetos de Storage de la ventana revisados;
    - ⛔ reuso apagado.
21. `desactivar_mantenimiento.sql` → `verificar_mantenimiento.sql`. ⛔ «apagado», sin filtro registrado, los 2 jobs activos. La sonda vuelve a responder 200. El hash queda borrado: **el secreto ya no sirve para nada en la base**; se trata como quemado y no se reutiliza.

**F. Cierre de `MANTENIMIENTO_CLAVE` (costo extra a cero)**
- Quitar la variable del proyecto **no cambia ningún despliegue existente**: cada despliegue conserva las variables con que se construyó.
- El despliegue recién promovido sigue enviando las cabeceras. Cuesta **una llamada a Auth por petición con sesión** (§3), aunque sin efecto en la base: el hash ya se borró.
22. Quitar `MANTENIMIENTO_CLAVE` de Production en Vercel. Comprobar que no está en Preview ni Development (`vercel env ls`, que no muestra valores).
23. **Build nuevo del mismo commit sin la variable:** *Redeploy* del despliegue promovido **sin caché de build**. La caché de Turbopack puede conservar valores de entorno de un build anterior.
    - Con la auto-asignación desactivada de nuevo, el build queda staged.
    - ⛔ Su fecha de creación es posterior a la eliminación de la variable.
    - ⛔ Es del mismo commit integrado.
24. **Validar** sobre su URL antes de promover: login, abrir un contrato y una escritura normal de un operador (sin mantenimiento, ya no hay bloqueo).
    - La señal de que la variable no está es la ausencia de la llamada extra a Auth por petición. Se puede observar como caída de las solicitudes a `auth/v1/user` en los registros de Supabase.
    - Es una **observación** sugerida: no se ha medido en Vercel.
25. **Promover** ese build y reactivar la auto-asignación. Validar después las subidas desde el navegador y un cron.
    - El costo extra vuelve a **cero cuando el tráfico deja el despliegue anterior**: inmediatamente para las peticiones nuevas al dominio.
    - Las pestañas abiertas que Skew Protection mantenga en el despliegue anterior siguen pagándolo hasta recargar o hasta la antigüedad máxima configurada.
    - Ese despliegue anterior debe entrar en el inventario del paso 17 si se quiere dejar inalcanzable.

**Duración:** entre activar y reabrir (pasos 6 a 21), unos 100–120 min.
- El paso 17 depende de cuántos despliegues haya.
- Medido en local: el SQL de la ventana tarda ~5 s de ejecución; el resto son comprobaciones manuales.
- Los builds se hacen fuera de la ventana (pasos 4 y 23) y su tiempo no está medido.

## 6. Recuperación
- **Antes de datos nuevos (pasos 6 a 14):** sin hash nadie escribe; la validación reversible se retira con acciones autorizadas.
  - Fallo al activar o desactivar: es atómico; se corrige y se repite.
  - Fallo del SQL: la atómica no deja nada; para 286–291, rollbacks en orden inverso y huella igual a la foto. Probado sobre la base local equivalente a producción: 15/15.
  - Fallo del build o de la validación: se corrige con un nuevo build staged (mismo secreto) o se vuelve por rollbacks. El dominio nunca dejó de servir el código viejo bloqueado, así que no hay rollback de Vercel que hacer.
  - Los rollbacks de la 288 y la 286 **se niegan** si existen previstas o planes: no se fuerzan.
- **Después del punto de no retorno (paso 15):** solo hacia adelante.
  - No se desactivan guardas ni se borran asientos, planes, abonos o pagos; los contratos de prueba se anulan contablemente.
  - Fallo tras promover: *instant rollback* **solo** a un despliegue que ya funcione con el esquema final, o seguir bloqueado y corregir.
  - Último recurso: PITR (si existe).
- **Nunca** se reabre con el código viejo sobre un esquema con la 288, ni se deja alcanzable sin decisión del dueño (paso 17).
- Fallo en el cierre (pasos 22–25): el despliegue con la variable sigue siendo válido (solo cuesta la llamada extra). Se corrige y se repite el build; no hay urgencia.

## 7. Decisiones operativas pendientes del dueño
1. **Operadores** de la ventana: los uuid de usuarios activos superadmin o administración.
2. **Horario** de la ventana, fuera de los crons de Vercel (06:00, 10:00 y 13:00 UTC).
3. **Integraciones externas por confirmar:** no las ve el inventario (claves de API usadas por n8n/Zapier/Make, scripts, otros proyectos). Las que escriban directo a Postgres deben pausarse a mano.
4. **Despliegues antiguos y pestañas viejas** (paso 17): qué se elimina, restringe o acepta, y si se ajusta Skew Protection o las variables de Preview.

## Anexo — compatibilidad de `e39224313` con el esquema final
86 casos = 77 pasan + 9 fallan + 0 omitidos; corrida dirigida aparte: X0 pasa, COMPAT-1 falla (CxP duplicadas).

| Caso | Causa | Clase |
|---|---|---|
| E1 | La base bloquea, pero esa versión no traduce el mensaje nuevo | Presentación |
| R1, T-A, T-B, T-C | Al confirmar no se escriben los asientos de las CxP materializadas | Contable |
| CC1, CC3 | Asistencia médica guardada como receptivo; error previo que corrige #75 | Previo |
| CC4, CC5 | Importan `lib/contrato/identidad.ts`, que esa versión no tiene | No aplica |
| COMPAT-1 | CxP duplicadas al editar servicios de un pendiente y confirmar | Bloqueante |

Detalle nominal: `ventana-mantenimiento-75-97-inventario.md`.

## Anexo — mecanismo de la 294 (resumen)
- **Bloqueo:** un filtro `db_pre_request` de PostgREST y un trigger en `storage.objects`. Durante la ventana rechazan toda escritura, incluida la de `service_role`. GET y HEAD siguen funcionando, en solo lectura.
- **Excepción:** se comprueba en CADA petición y exige:
  - el secreto de servidor (la base solo guarda su hash; mínimo 32 caracteres);
  - un operador de la lista que siga activo con rol superadmin o administración;
  - un rol `service_role` o `authenticated` (si es `authenticated`, con el `sub` del JWT de ese mismo operador).

  No toca permisos ni RLS.
- **Filtro previo:** se ejecuta primero y en su mismo contexto, porque el filtro público es INVOKER y sin SET. Activar y desactivar son atómicos y restauran exactamente la configuración previa (niveles de rol y base) y los jobs.
- **Pruebas:** `test_294_mantenimiento.sh` (78 casos, con PostgREST v16.4 y storage-api v1.84.19 reales) y `pruebas/mantenimientoServidor.test.ts` (9). Instalación: `preflight_294` / `postcheck_294`.
