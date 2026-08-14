# Backup y reversión antes de la migración 148

Qué hacer antes de correr la 148, qué cubre la copia, qué **no** cubre, y cómo
devolverse si algo sale mal.

Archivos relacionados:

| Archivo | Para qué |
|---|---|
| `supabase/scripts/backup-antes-148.ps1` | Genera la copia. Se corre en Windows. |
| `supabase/scripts/rollback_148.sql` | Revierte la 148. **No ejecutar** salvo que haga falta. |
| `supabase/scripts/verificar_rollback_148.sql` | Comprueba que el rollback dejó la base como estaba. |

---

## 1. Generar la copia

**Requisitos, una sola vez:**

```powershell
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
y escribe en `C:\Users\Asus\Documents\Backups\Dspacios\antes-migracion-148`:

```
roles.sql
schema.sql
data.sql
auth_storage_changes.sql
MANIFEST.txt
```

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

`auth_storage_changes.sql` puede salir **vacío legítimamente**, si no hay
cambios propios sobre los esquemas `auth`/`storage`. Por eso no se marca como
falla sino como aviso: hay que abrirlo y confirmarlo, no darlo por bueno solo
porque el script terminó bien.

---

## 2. Qué NO incluye esta copia

Es la parte que más cuesta cara si se pasa por alto.

### Los archivos físicos de Storage — lo más importante

`supabase db dump` vuelca **la base de datos**. Los archivos subidos viven en el
almacenamiento de objetos, **no** en Postgres. Lo que sí queda en el volcado es
la tabla `storage.objects` — es decir, la **lista** de archivos: nombres, rutas,
tamaños. Restaurando el volcado en un proyecto nuevo quedaría un catálogo que
apunta a archivos que no están: la app mostraría los adjuntos en la lista y al
descargarlos daría error.

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

- **Usuarios de Auth** (`auth.users`) — `supabase db dump` no los incluye por
  defecto. Las contraseñas no son recuperables desde este volcado.
- **Secretos y variables de entorno** de Vercel y de Supabase.
- **Cron jobs**, webhooks y configuración del proyecto.
- **Extensiones** y ajustes de la instancia.

---

## 3. Restaurar en un proyecto nuevo

Solo si hay que reconstruir desde cero. El orden importa: los datos no entran si
el esquema no está, y el esquema no entra si los roles no existen.

```powershell
# 1. Crear el proyecto nuevo en Supabase y tomar su cadena de conexión.
$URL = "postgresql://postgres.NUEVOREF:LA-PASSWORD@...pooler.supabase.com:5432/postgres"

# 2. Roles primero
psql $URL -f roles.sql

# 3. Esquema: tablas, vistas, policies, funciones, triggers
psql $URL -f schema.sql

# 4. Datos
psql $URL -f data.sql

# 5. Cambios propios de auth/storage, si el archivo no está vacío
psql $URL -f auth_storage_changes.sql
```

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

### Verificado, no supuesto

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
