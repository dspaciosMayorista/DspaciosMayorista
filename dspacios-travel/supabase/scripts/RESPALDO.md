# 🛟 Respaldo de la base y los archivos (plan gratis)

Con el plan gratis de Supabase **no hay backups automáticos**, pero puedes hacer
tu propio respaldo a **Google Drive** (o disco) gratis. Son 2 piezas:

1. **La base de datos** (clientes, ventas, contratos, CRM…) → con `pg_dump`.
2. **Los archivos** (cédulas, soportes, flyers…) → con el script de Storage.

Recomendación: **una vez por semana**. (Si más adelante quieres que sea
automático + recuperación al minuto, ahí sí el plan **Pro** de Supabase.)

---

## 1. Respaldo de la base de datos (`pg_dump`)

Necesitas la **cadena de conexión**: Supabase → **Project Settings → Database →
Connection string** (modo `URI`). Reemplaza `[PASSWORD]` y `[REF]`.

```bash
pg_dump "postgresql://postgres:[PASSWORD]@db.[REF].supabase.co:5432/postgres" \
  --no-owner --no-privileges \
  -f respaldo_$(date +%F).sql
```

- Genera un archivo `respaldo_AAAA-MM-DD.sql` con **toda** la base.
- Para restaurar (en una base vacía): `psql "<conexión>" -f respaldo_AAAA-MM-DD.sql`.
- Requiere tener instalado `postgresql-client` (`pg_dump`). Usa una versión ≥ a la del servidor.

> Alternativa sin instalar nada: en Supabase puedes exportar tablas a **CSV** desde
> el **Table Editor**, pero `pg_dump` es el respaldo completo y fiel.

---

## 2. Respaldo de los archivos (Storage)

Descarga todos los buckets (incluye `contratos/`, `crm/`, `empresa/`…) conservando
las carpetas:

```bash
SUPABASE_URL="https://[REF].supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="<service_role_key>" \
node supabase/scripts/respaldo-storage.mjs respaldo_archivos_$(date +%F)
```

- La `service_role` está en Supabase → Settings → API (es **secreta**, no la subas al repo).
- Crea una carpeta `respaldo_archivos_AAAA-MM-DD/contratos/00-0451/…` con todo.

---

## 3. Subirlo a Google Drive

- Manual: arrastra la carpeta/archivos del respaldo a tu Drive.
- Automático: instala **rclone** (gratis) y configura tu Drive:
  ```bash
  rclone copy respaldo_AAAA-MM-DD.sql       gdrive:Respaldos/DspaciosTravel/
  rclone copy respaldo_archivos_AAAA-MM-DD  gdrive:Respaldos/DspaciosTravel/archivos_AAAA-MM-DD
  ```

---

## 4. (Opcional) Automatizar con GitHub Actions (gratis)

Un workflow semanal puede correr el `pg_dump` + el script de Storage y subir el
respaldo a Drive (con `rclone` y los secretos `SUPABASE_*` / token de Drive en
**Settings → Secrets**). Pídelo cuando quieras y te dejo el `.yml`.

---

> ⚠️ **Límite del plan gratis: 1 GB de archivos** (y 500 MB de base). Si los
> soportes crecen, mueve los más viejos a Drive o pasa a Pro. La app avisa el
> tamaño total por contrato en la sección **Adjuntos**.
