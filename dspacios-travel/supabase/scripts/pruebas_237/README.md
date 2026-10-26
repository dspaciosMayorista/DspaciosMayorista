# Pruebas de la migración 237 (frontera D8/D9) — Docker local

Sesiones **reales** (GoTrue + PostgREST) contra un Supabase LOCAL desechable. Nunca contra un proyecto alojado
(el arnés se niega si la URL no es loopback o el contenedor no es `supabase_db_*`).

## Levantar un entorno aislado (no toca contenedores de otros trabajos)

```sh
# Carpeta temporal fuera del repo, con otro project_id para no chocar con volúmenes existentes
mkdir -p /ruta/tmp/sb5/supabase && cd /ruta/tmp/sb5
cp <repo>/dspacios-travel/supabase/config.toml supabase/ && cp -r <repo>/dspacios-travel/supabase/migrations supabase/
sed -i 's/^project_id = .*/project_id = "d5d8local"/' supabase/config.toml
npx supabase start -x studio,imgproxy,vector,logflare,edge-runtime,inbucket,realtime,mailpit,postgres-meta,supavisor
# Aplica las migraciones del repo (incluida la 237 si está en la carpeta copiada).
```

## Ejecutar

```sh
cd <repo>/dspacios-travel
eval "$(cd /ruta/tmp/sb5 && npx supabase status -o env | sed 's/^/export /')"   # ANON_KEY, SERVICE_ROLE_KEY
export API_URL=http://127.0.0.1:54321 PSQL_CONTAINER=supabase_db_d5d8local

node supabase/scripts/pruebas_237/harness.mjs                   # 118 comprobaciones (espera 0 FALLA)
CONTROL_SIN_237=1 node supabase/scripts/pruebas_237/harness.mjs # con la 237 revertida: muestra el hueco previo
SNAPSHOT=/tmp/post.json node supabase/scripts/pruebas_237/harness.mjs   # filas visibles por actor x catálogo
```

Para el antes/después de lectura: revertir con `supabase/scripts/rollback_237_catalogos_globales_frontera.sql`,
correr `SNAPSHOT=/tmp/pre.json`, volver a aplicar la migración, correr `SNAPSHOT=/tmp/post.json` y `diff`.

Preflight/postcheck del dueño (una consulta cada uno; también corren sobre el entorno local con
`docker exec -i supabase_db_d5d8local psql -U postgres < archivo.sql`):
`../preflight_237_catalogos_globales.sql` y `../postcheck_237_catalogos_globales.sql`.

El arnés crea usuarios `t237+...@example.test` y filas `T237...`; todo desaparece al destruir el entorno
(`npx supabase stop --no-backup`).
