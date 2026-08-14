# Backup y reversión antes de la migración 148

Qué hacer antes de correr la 148, qué cubre la copia, qué **no** cubre, y cómo
devolverse si algo sale mal.

Archivos relacionados:

| Archivo | Para qué |
|---|---|
| `supabase/scripts/backup-antes-148.ps1` | Genera la copia. Se corre en Windows. |
| `supabase/scripts/pruebas/probar-backup.sh` | Banco de pruebas del script anterior (casos negativos). |
| `supabase/scripts/pruebas/fixtures/` | Volcados de ejemplo con los encabezados reales de pg_dump. |
| `supabase/scripts/rollback_148.sql` | Revierte la 148. **No ejecutar** salvo que haga falta. |
| `supabase/scripts/verificar_rollback_148.sql` | Comprueba que el rollback dejó la base como estaba. |

---

## 1. Generar la copia

**Requisitos, una sola vez:**

```powershell
# Docker Desktop instalado Y CORRIENDO. La Supabase CLI ejecuta pg_dump dentro
# de un contenedor: sin Docker, `db dump` falla a mitad y deja archivos
# truncados que parecen válidos. El script lo comprueba ANTES de tocar el disco.
scoop install supabase     # o: https://supabase.com/docs/guides/local-development/cli/getting-started
supabase login             # abre el navegador
```

**Cada vez:**

1. En Supabase → botón **Connect** → pestaña **Session pooler** → copiar la URI.
   Viene así, con el marcador adentro:

   ```
   postgresql://postgres.abcdefgh:[YOUR-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:5432/postgres
   ```

   Ese texto **no es un secreto**: no lleva la contraseña. Es el que se pega.

2. Correr, **desde donde sea** — Descargas sirve, no hace falta el repositorio:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\backup-antes-148.ps1
   ```

   Funciona con **Windows PowerShell 5.1** (el `powershell` de siempre) y con
   PowerShell 7 (`pwsh`). El script comprueba la versión al arrancar y, si es
   anterior a la 5.1, para con instrucciones en vez de reventar con un error de
   sintaxis.

El script pide la URI, después la contraseña **oculta** (`Read-Host -AsSecureString`),
y escribe en una carpeta **con fecha y hora**, dentro de
`C:\Users\Asus\Documents\Backups\Dspacios`:

```
antes-migracion-148-20260814-045750\
    roles.sql
    schema.sql
    data.sql
    auth_storage_changes.sql
    MANIFEST.txt
    LEEME.txt
```

**Nunca sobrescribe un backup anterior**: cada ejecución crea su propia carpeta,
y si por lo que sea alguno de los archivos ya existiera, se detiene.

El destino no puede caer dentro de un repositorio git. No se comprueba por el
**nombre** de la carpeta —renombrar el repo burlaría eso— sino preguntándole a
git por la raíz (`git rev-parse --show-toplevel` desde la ubicación del script)
y además subiendo por los directorios padres del destino a buscar un `.git`,
que cubre el caso de que el destino pertenezca a **otro** repositorio.

### Por qué el diff de auth/storage se hace desde un proyecto temporal vacío

Es el detalle menos evidente de todo el script, y el que más caro sale si se
hace mal.

`supabase db diff --linked` no compara contra la nada: levanta una **shadow
database** aplicando **las migraciones locales de la carpeta desde la que se
invoca**, y reporta la diferencia entre eso y la base remota.

Eso deja dos formas de equivocarse, las dos silenciosas:

| Desde dónde se corre | Qué pasa |
|---|---|
| **Descargas** (sin `supabase/config.toml`) | `link` y `diff` fallan: no hay proyecto. |
| **El repositorio** | La shadow se levanta con las **149 migraciones**, incluidas la 148 y la 149 **que todavía no están en producción**. Las policies de Storage que crea la 148 estarían en los dos lados de la comparación, así que el diff diría "no hay diferencias" y el archivo saldría **vacío**. |

El segundo es el peligroso: el backup perdería exactamente el estado que se
quiere guardar —el **anterior** a la 148— y el archivo vacío parecería correcto.

Por eso el script crea un **proyecto Supabase temporal en `%TEMP%`**, corre
`supabase init` ahí, **verifica que no haya ninguna migración local**, y hace
`link` y `diff` desde esa carpeta. Sin migraciones, la shadow queda como una
base Supabase recién creada y el diff devuelve justo lo que se busca: los
cambios **propios** respecto de lo que trae Supabase de fábrica.

El repositorio real no se toca ni se vincula. La carpeta temporal se borra en el
`finally` —termine bien o mal—, porque `link` deja ahí el project-ref y
credenciales de sesión de la CLI.

### La contraseña

No se escribe en el chat, no se guarda en ningún archivo, no se pasa como
argumento del script y no queda en el historial de PowerShell. Vive en memoria
mientras corre y se limpia en el bloque `finally`, incluso si el script muere a
mitad.

**La única exposición que sí queda:** `supabase db dump` recibe la cadena de
conexión como argumento, así que durante el minuto que dura el volcado la
contraseña es visible en la **tabla de procesos de esa máquina**, para quien
tenga permisos de administrador local. No sale a la red ni a disco. Se anota
porque es real, no porque sea grave.

Para `supabase link` sí se evita: ahí la contraseña va por variable de entorno
del proceso (`SUPABASE_DB_PASSWORD`), que no aparece en la tabla de procesos, y
se borra enseguida.

### El script no da por bueno un backup sin verificarlo

No basta con que los archivos existan. Comprueba:

- **Tamaño mínimo** por archivo — un volcado cortado a la mitad pesa poco y
  parece válido.
- **Contenido esperado**: `schema.sql` tiene que traer `CREATE TABLE`,
  `public.ventas`, `public.abonos` y `ventas_basica`; `data.sql`, `COPY public.ventas`.
- **Número real de contratos** volcados en la tabla `ventas`. Es el dato que se
  compara contra lo que muestra la app. Un backup con 0 contratos existiría
  igual y no serviría de nada.
- Cuántas filas trae de `auth.users` y de `storage.objects` — **medido, no
  supuesto** (ver más abajo).

### El detalle que rompió la primera ejecución real: las comillas

pg_dump **entrecomilla los identificadores**. La Supabase CLI 2.114.0 escribe:

```sql
COPY "public"."ventas" ("numero_contrato", "cliente", ...) FROM stdin;
```

El verificador buscaba el texto plano `COPY public.ventas`, que no aparece ni una
vez. Contra un `data.sql` **correcto** de 21,5 MB con 140 bloques COPY y 121
contratos dentro, el resultado fue:

```
Contratos volcados (public.ventas): -1
COPY storage.objects presente:      NO
COPY auth.users presente:           NO
Estado:   INCOMPLETO - NO USAR
```

Todo falso. El backup estaba bien; lo que estaba mal era el que lo revisaba —
que es la peor forma de fallar, porque manda a repetir un trabajo que ya estaba
hecho y siembra dudas sobre datos que sí están.

Ahora el reconocimiento de encabezados quita las comillas **solo de la parte del
nombre** (hasta el `(` de las columnas o el ` FROM `) y compara el nombre
completo por igualdad exacta, así que acepta los dos formatos y no confunde
`public.ventas` con `public.ventas_historico` ni con `otro.ventas`. Lo mismo en
`schema.sql`, donde `CREATE TABLE "public"."ventas"` tampoco casaba.

Si algo falla, termina con código 1 y el mensaje **"no corras la migración 148"**.

**Si `supabase link` o `supabase db diff` fallan, el backup queda marcado como
INCOMPLETO** y el script sale con código 1. No se degrada a aviso: un backup al
que le falta una pieza y aun así dice "VERIFICADO" es peor que uno que falla
ruidosamente, porque se corre la migración confiando en él. Se comprueba el
`$LASTEXITCODE` de las dos órdenes, no solo el de `link`.

Cosa distinta: `auth_storage_changes.sql` puede salir **vacío legítimamente** si
`db diff` corrió bien y no hay cambios propios sobre `auth`/`storage`. Eso sí es
aviso: hay que abrirlo y confirmarlo, no darlo por bueno porque el script
terminó bien.

---

## 2. Qué NO incluye esta copia

Es la parte que más cuesta cara si se pasa por alto.

### Los archivos físicos de Storage — lo más importante

Los archivos subidos viven en el almacenamiento de objetos, que **no es
Postgres**. Un volcado de base de datos **nunca** los trae. Eso no depende de la
versión ni de las banderas: es lo único que se puede afirmar sin medir.

Lo que sí varía es si viene el **catálogo** (`storage.objects`, la lista de
rutas y nombres) y los **usuarios de Auth** (`auth.users`).

> **Este documento ya se equivocó dos veces con eso**, en las dos direcciones:
> primero afirmó que el catálogo sí venía, después que Supabase "siempre excluye
> los esquemas administrados auth y storage". La ejecución real con la CLI
> 2.114.0 trajo **9 usuarios de Auth y 1761 filas de `storage.objects`**.
>
> Por eso ya no se afirma nada: el script lo **mide** en cada ejecución y lo
> escribe en `MANIFEST.txt` y en `LEEME.txt`. De ese dato depende cuánto trabajo
> manual costaría una restauración, así que es mejor medirlo que heredarlo de
> una documentación.

Si el catálogo viene y los archivos no, restaurar en un proyecto nuevo dejaría un
índice apuntando a cédulas y soportes de pago que no están: la app los listaría
y al descargarlos daría error.

Buckets afectados:

| Bucket | Qué guarda |
|---|---|
| `contratos` | **Cédulas y soportes de pago** de los clientes, y los contratos laborales de empleados en `pe-empleados/` |
| `programas` | Flyers, historias y portadas |
| `crm` | Material de difusión |
| `web-cms` | Imágenes del sitio público |
| `hotel-fotos`, `servicio-fotos` | Fotos del tarifario |

Para copiarlos hay que descargarlos aparte, desde el panel de Storage o con la
API. **Para el alcance de la 148 esto no bloquea nada**: la 148 solo cambia
policies y crea vistas — no toca, mueve ni borra un solo archivo. Se documenta
porque un backup del que se cree que "lo tiene todo" es peor que no tenerlo.

### Lo demás que queda fuera

- **Secretos y variables de entorno** de Vercel y de Supabase.
- **Cron jobs**, webhooks y configuración del proyecto.
- **Extensiones** y ajustes de la instancia.

### ⚠️ `data.sql` es información personal: no se comparte

No es un archivo técnico inofensivo. Según lo medido en la ejecución real,
dentro van:

| Tabla | Qué lleva |
|---|---|
| `public.ventas` (121) | Nombre, **documento**, teléfono, correo y dirección del cliente de cada contrato, y el precio |
| `auth.users` (9) | Usuarios del sistema con su correo y el **hash de su contraseña** |
| `storage.objects` (1761) | Rutas y nombres de **cédulas y soportes de pago** |
| `contrato_pasajeros` | **Documento y fecha de nacimiento** de cada pasajero |
| `abonos`, `cuentas_por_pagar`, `aliados_b2b` | Movimientos de dinero y comisiones |

Si esa carpeta se filtra, se filtra la base de clientes completa. Reglas:

- **Nunca** subirla a GitHub — la carpeta va fuera del repositorio y el
  `.gitignore` de la raíz ignora los nombres que genera el script, pero la
  primera barrera es no ponerla ahí.
- **Nunca** enviarla por correo ni WhatsApp, ni pegar su contenido en un chat.
- Guardarla en el disco de la máquina, **no** en OneDrive, Drive ni Dropbox.
- Borrarla cuando ya no haga falta.

El script escribe ese aviso dentro de `MANIFEST.txt` y de `LEEME.txt`, para que
viaje con los archivos y no solo en esta página.

---

## 3. Restaurar en un proyecto nuevo

Solo si hay que reconstruir desde cero. El orden importa: los datos no entran si
el esquema no está, y el esquema no entra si los roles no existen.

Método oficial de Supabase. Los tres archivos van en **una sola invocación**,
en **una sola transacción** y **parando al primer error**:

```powershell
$URL = "postgresql://postgres.NUEVOREF:LA-PASSWORD@...pooler.supabase.com:5432/postgres"

psql --single-transaction --variable ON_ERROR_STOP=1 `
  --file roles.sql --file schema.sql `
  --command "SET session_replication_role = replica;" `
  --file data.sql --dbname $URL

# Aparte, solo si `auth_storage_changes.sql` no está vacío:
psql --single-transaction --variable ON_ERROR_STOP=1 -f auth_storage_changes.sql -d $URL
```

Por qué así y no cuatro `psql` sueltos, que es como estaba documentado antes:

- `--single-transaction` + `ON_ERROR_STOP=1` hacen que **o entra todo o no entra
  nada**. Con órdenes separadas, si el esquema entra y los datos fallan a mitad,
  queda una base a medio restaurar que a simple vista parece haber terminado
  bien — y ese es justo el momento en que uno cree que ya está a salvo.
- `session_replication_role = replica` desactiva triggers y validación de llaves
  foráneas mientras entran los datos. Sin eso, el orden en que salen las tablas
  del volcado hace fallar la carga por FK.

Después, y esto no lo hace el volcado:

1. **Volver a subir los archivos de Storage** a sus buckets, respetando la ruta
   exacta — `contratos` usa `{numero_contrato}/{tipo}-{timestamp}.{ext}`, y las
   policies de la 148 dependen de que el primer segmento sea el número de
   contrato.
2. **Recrear los usuarios de Auth.** Los `usuarios.id` del volcado apuntan a
   `auth.users(id)`: si los UUID no coinciden, nadie entra.
3. **Apuntar las variables de entorno** de Vercel al proyecto nuevo
   (`NEXT_PUBLIC_SUPABASE_URL`, la anon key y `SUPABASE_SERVICE_ROLE_KEY`).
4. Comprobar con `supabase/scripts/test_rls_por_rol.sql` que la RLS quedó igual.

---

## 4. Revertir solo la 148

Si la 148 ya se corrió y hay que devolverse — sin restaurar nada, sin tocar
datos.

```
psql <URL> -f supabase/scripts/rollback_148.sql
psql <URL> -f supabase/scripts/verificar_rollback_148.sql
```

**Orden correcto**, y el detalle que arruina un rollback hecho a las carreras:

1. **Primero revertir el despliegue** en Vercel (volver al deploy anterior).
2. **Después** correr `rollback_148.sql`.

Al revés, la app queda unos minutos pidiendo `contrato_vuelos_basica` y
`abonos_resumen`, que el rollback elimina: la ficha del contrato y la página
imprimible se rompen mientras dure el desfase.

### Qué revierte

Deja la base exactamente en el estado **posterior a la 147 y anterior a la 148**:
las policies de Storage vuelven a la única de la migración 046, las de
`vouchers` a como las dejó la 147, se quita la lectura de `abonos` para `venta`,
se eliminan `abonos_resumen` y `contrato_vuelos_basica`, y `ventas_basica`
vuelve a su definición de la 147. Si la 149 también se corrió, el primer bloque
la deshace (tiene que ir antes, porque la 147 devuelve el acceso que la 149
quita).

**No revierte datos, y no hace falta:** la 148 no inserta, no actualiza y no
borra una sola fila. Es puro DDL. Si lo que se perdió son datos, este archivo no
sirve — eso es restaurar del backup.

### El script de backup, probado con casos negativos

Lo que importa de un script de backup no es que funcione cuando todo va bien:
es que **falle cuando algo va mal**. Un backup que dice "VERIFICADO" con una
pieza faltante es peor que uno que revienta, porque se corre la migración
confiando en él.

`supabase/scripts/pruebas/probar-backup.sh` pone en el PATH un `docker` y un
`supabase` falsos que se comportan según el escenario, y sustituye `Read-Host`
desde un envoltorio — el script real no se modifica ni se parametriza para la
prueba. Resultado, **7 de 7**:

| Escenario | Esperado | Resultado |
|---|---|---|
| Camino feliz | código 0 y "BACKUP VERIFICADO" | OK |
| **Volcado con comillas** `COPY "public"."ventas"` (formato real de la CLI 2.114.0) | cuenta 121 / 9 / 17 exactos | OK |
| **El mismo volcado sin comillas** | los mismos números | OK |
| MANIFEST y LEEME reflejan lo medido, con el aviso de datos personales (6 comprobaciones) | | OK |
| **Ejecutado desde "Descargas"** (sin repo ni `config.toml`) | funciona igual | OK |
| · el diff se hizo con 0 migraciones locales | | OK |
| · el diff **no** se hizo desde la carpeta de ejecución | | OK |
| · el diff se hizo desde un proyecto temporal | | OK |
| · el proyecto temporal se eliminó al terminar | | OK |
| **Ejecutado desde el repositorio** | el diff **no** usa sus migraciones | OK |
| Docker apagado | código ≠ 0, sin crear archivos | OK |
| `supabase init` falla | código ≠ 0, sin "VERIFICADO" | OK |
| `supabase link` falla | código ≠ 0, sin "VERIFICADO" | OK |
| `supabase db diff` falla | código ≠ 0, sin "VERIFICADO" | OK |
| Volcado de datos vacío (0 contratos) | código ≠ 0, sin "VERIFICADO" | OK |
| Destino dentro de un repo **renombrado** | código ≠ 0, sin "VERIFICADO" | OK |
| Ya existe un backup en esa carpeta | código ≠ 0, no lo sobrescribe | OK |
| Sintaxis compatible con PowerShell 5.1 (4 comprobaciones) | | OK |

El caso del repositorio renombrado es el que justifica no comprobar por nombre
de carpeta: el fixture es un repo llamado `RepoConOtroNombre`, y el script lo
detecta igual porque busca el `.git`, no la palabra.

**El `supabase` simulado es exigente a propósito.** `link` y `db diff` fallan si
no encuentran `supabase/config.toml` en el directorio actual, y `db diff` falla
si `supabase/migrations` tiene archivos — igual que la CLI real. Un mock
permisivo daba OK a un script que en la máquina del dueño no habría funcionado.

**Los fixtures llevan los encabezados reales de pg_dump**, con y sin comillas
(`supabase/scripts/pruebas/fixtures/`). El mock anterior emitía `COPY
public.ventas` sin comillas, y por eso el banco de pruebas daba 21/21 mientras
la ejecución real fallaba. Los fixtures incluyen dos señuelos —
`public.ventas_historico` y `otro.ventas`— para que un contador que confundiera
nombres parecidos no pudiera dar los números correctos. No contienen ningún dato
personal: los clientes son "CLIENTE DE PRUEBA n" y los correos, `@ejemplo.invalid`.

**Control negativo:** el banco de pruebas nuevo se corrió contra la versión
**anterior** del script (`f9c5406e`) y da **18 fallos**, reproduciendo
exactamente los síntomas de la ejecución real —`-1` contratos, `auth.users: NO`,
`storage.objects: NO`, estado INCOMPLETO— sobre un volcado que está bien. Eso
confirma que estas comprobaciones detectan el defecto en vez de pasar por vacío.

### Compatibilidad con Windows PowerShell 5.1

El comando documentado es `powershell`, que en Windows es la **5.1**, no `pwsh`.
El script está escrito para 5.1 a propósito: `::new()`, `Get-FileHash`,
`Select-String -Quiet`, `[StringComparison]` y `$PSScriptRoot` existen todos ahí.

Dos cosas que sí hubo que cuidar:

- **No se usa ningún operador exclusivo de PowerShell 7** (`??`, `&&`/`||` de
  pipeline, ternario `? :`, `-Parallel`, `$PSStyle`). El banco de pruebas lo
  comprueba mecánicamente.
- **No se usa `Set-Content -Encoding UTF8`**: en 5.1 escribe **con BOM** (en 7 no),
  y un BOM al principio de un `.sql` hace que psql se atragante con la primera
  línea al restaurar. Los archivos se escriben con un helper que fuerza UTF-8
  sin BOM.
- **El `.ps1` sí lleva BOM**, y es lo contrario de lo anterior a propósito.
  Windows PowerShell 5.1 lee un `.ps1` sin BOM como ANSI, así que los acentos
  salían corruptos en pantalla: *"VerificaciÃ³n"*, *"FallÃ³"*, *"tamaÃ±o"*. Con
  BOM lo decodifica como UTF-8. Las dos cosas conviven: BOM en el script, sin BOM
  en lo que el script genera. El banco de pruebas comprueba las dos.

No pude correr **PSScriptAnalyzer** con las reglas `PSUseCompatibleSyntax` para
5.1: PowerShell Gallery está bloqueada desde este entorno. Lo que hay es el lint
mecánico de arriba más la ejecución completa bajo PowerShell 7.4.6, así que la
compatibilidad con 5.1 está razonada y comprobada por construcción, **no
ejecutada en un 5.1 real**. Conviene correrlo una primera vez con calma.

### El rollback, verificado, no supuesto

El rollback se probó sobre un PostgreSQL 16 local: se aplicaron las migraciones
hasta la 147 y se tomó una **huella** del estado (53 objetos: cada policy con su
`qual` y `with_check` completos, y cada columna de las tres vistas). Después se
aplicaron la 148 y la 149, se corrió el rollback, y se volvió a tomar la huella.

Las dos huellas salieron **idénticas byte a byte**. El rollback también se corrió
dos veces seguidas sin error.

### Lo que el rollback vuelve a abrir

Conviene tenerlo presente antes de correrlo: devuelve la policy única de Storage
de la 046, que **reabre el bucket `contratos` a todo el rol `venta`** — cédulas y
soportes de pago de cualquier contrato, incluidos los de otros asesores. Es el
estado que había antes de la 148. Se anota para que sea una decisión, no una
sorpresa.
