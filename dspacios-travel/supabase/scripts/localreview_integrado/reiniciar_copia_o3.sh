#!/usr/bin/env bash
# Recrea la COPIA DESECHABLE rev_verif_int_o3b desde la base de revisión del dueño (solo LECTURA de esa base), le aplica la 325 y la deja servida por la pila + la app compilada.
# NUNCA toca rev_verif_int_revision ni su carpeta storage. Uso (desde dspacios-travel/): bash supabase/scripts/localreview_integrado/reiniciar_copia_o3.sh
set -u -o pipefail
export MSYS_NO_PATHCONV=1
CFG="$(cygpath -m "$LOCALAPPDATA")/dspacios-local-revision-int"; COPIA=rev_verif_int_o3b
PG=(docker exec -e PGPASSWORD=postgres pgb2b psql -h 127.0.0.1 -U supabase_admin -X -q -v ON_ERROR_STOP=1)
# 1) bajar la app y la pila que sirven la copia anterior
powershell.exe -NoProfile -Command "Get-NetTCPConnection -LocalPort 3070 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id \$_.OwningProcess -Force }" >/dev/null 2>&1
PILA_DB="$COPIA" bash supabase/scripts/real_62/pila.sh bajar "$CFG" pgb2b plantilla_int >/dev/null 2>&1
# 2) copia nueva (plantilla = base de revisión; exige que nadie esté conectado a ella)
"${PG[@]}" -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname in ('$COPIA', 'rev_verif_int_revision') and pid <> pg_backend_pid()" >/dev/null
"${PG[@]}" -d postgres -c "drop database if exists $COPIA with (force)" && "${PG[@]}" -d postgres -c "create database $COPIA template rev_verif_int_revision" || exit 2
rm -rf "$CFG/storage_o3b" && cp -r "$CFG/storage" "$CFG/storage_o3b" || exit 2
# La base del dueño ya trae la 325 (aplicada con su preflight/postcheck); la copia desechable agrega SOLO la 326 (tope de pasajeros por universo declarado). Si la plantilla aún no tuviera la 325, pasa "325 326".
bash supabase/scripts/localreview_integrado/aplicar_migraciones.sh pgb2b "$COPIA" ${O3_MIGRACIONES:-326} || exit 2
# 2b) SOLO en la copia: las claves de las cuentas de revisión vuelven a la clave común del guion (el dueño validó la recuperación de contraseña sobre su base y cambió alguna; la copia hereda esas claves).
"${PG[@]}" -d "$COPIA" -c "update auth.users set encrypted_password = extensions.crypt('Revision2026!', extensions.gen_salt('bf', 10)), updated_at = now() where email like '%@revision.test'" || exit 2
# 3) pila + app sobre la copia
PILA_DB="$COPIA" PILA_SIN_MIGRACIONES=1 PILA_STORAGE_DIR="$CFG/storage_o3b" PILA_OTP_EXP=600 nohup bash supabase/scripts/real_62/pila.sh subir "$CFG" pgb2b plantilla_int > "$CFG/pila_o3b.log" 2>&1 < /dev/null &
for i in $(seq 1 90); do grep -q "pila v1real lista" "$CFG/pila_o3b.log" 2>/dev/null && break; sleep 2; done
grep -q "pila v1real lista" "$CFG/pila_o3b.log" || { echo "FALLO: la pila no quedó lista"; tail -5 "$CFG/pila_o3b.log"; exit 2; }
nohup node supabase/scripts/localreview_integrado/app_integrada.mjs "$CFG" start "$CFG/app_o3b.log" > /tmp/app_o3b.out 2>&1 < /dev/null &
for i in $(seq 1 60); do [ "$(curl.exe -s -o NUL -w '%{http_code}' http://localhost:3070/login)" = 200 ] && { echo "copia $COPIA lista en http://localhost:3070"; exit 0; }; sleep 2; done
echo "FALLO: la app no respondió"; exit 2
