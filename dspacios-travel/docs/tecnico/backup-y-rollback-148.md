# Backup y reversión antes de la migración 148

Qué hacer antes de correr la 148, qué cubre la copia, qué **no** cubre, y cómo
devolverse si algo sale mal.

Archivos relacionados:

| Archivo | Para qué |
|---|---|
| `supabase/scripts/backup-antes-148.ps1` | Genera la copia. Se corre en Windows. |
| `supabase/scripts/pruebas/probar-backup.sh` | Banco de pruebas del script anterior (casos negativos). |
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

2. Correr:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\backup-antes-148.ps1
   ```

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

`supabase db dump` vuelca **la base de datos**, y por defecto **excluye los
esquemas administrados `auth` y `storage`**. Los archivos subidos viven además
en el almacenamiento de objetos, que no es Postgres.

Es decir que de Storage **no queda nada** en esta copia: ni los archivos ni la
tabla `storage.objects` con la lista de nombres y rutas.

> Una versión anterior de este documento decía que la lista **sí** venía en el
> volcado. Era falso. El script ahora lo **comprueba** en cada ejecución —busca
> `COPY storage.objects` dentro de `data.sql`— y escribe el resultado en
> `MANIFEST.txt` y en `LEEME.txt`, en vez de que haya que fiarse de lo que diga
> una documentación. De eso depende cuánto trabajo manual costaría una
> restauración.

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

- **Usuarios de Auth** (`auth.users`) — por la misma razón: `auth` es un esquema
  administrado y queda fuera. El script también lo comprueba y lo anota. Las
  contraseñas no son recuperables desde este volcado.
- **Secretos y variables de entorno** de Vercel y de Supabase.
- **Cron jobs**, webhooks y configuración del proyecto.
- **Extensiones** y ajustes de la instancia.

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
| Docker apagado | código ≠ 0, sin crear archivos | OK |
| `supabase link` falla | código ≠ 0, sin "VERIFICADO" | OK |
| `supabase db diff` falla | código ≠ 0, sin "VERIFICADO" | OK |
| Volcado de datos vacío (0 contratos) | código ≠ 0, sin "VERIFICADO" | OK |
| Destino dentro de un repo **renombrado** | código ≠ 0, sin "VERIFICADO" | OK |
| Ya existe un backup en esa carpeta | código ≠ 0, no lo sobrescribe | OK |

El caso del repositorio renombrado es el que justifica no comprobar por nombre
de carpeta: el fixture es un repo llamado `RepoConOtroNombre`, y el script lo
detecta igual porque busca el `.git`, no la palabra.

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
