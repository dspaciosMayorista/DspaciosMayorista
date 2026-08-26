#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────
# PRUEBAS de la migración 159 (consecutivo_dtm_mayorista) + 160 (cierre de
# formato). Reutiliza pruebas/local-desde-cero.sh para el andamiaje.
#
#   supabase/scripts/test_consecutivo_dtm_mayorista.sh [base] [puerto]
#
# Cubre (ver enunciado del pendiente, punto 9):
#   1. Migración 159 ABORTA si ya existe un contrato tenant=mayorista.
#   2. Con 0 contratos mayorista, la 159 aplica limpio.
#   3. Primer mayorista → DTM-0001, segundo → DTM-0002 (authenticated).
#   4. Minorista sigue igual: MIN-00-XXXX (mismo mecanismo, mismo reciclaje).
#   5. Tenant NULL / vacío / inválido → rechazo (fail closed).
#   6. anon NO puede invocar la función nueva ni tocar la secuencia nueva.
#   7. eliminar_contrato(): un DTM- con p_reusar=true se RECHAZA (nunca entra
#      a numeros_contrato_liberados); con p_reusar=false sí se borra normal;
#      minorista conserva su reciclaje intacto.
#   8. Migración 160 ABORTA si hay una fila con formato incompatible, y
#      aplica limpio si todo está bien — y el CHECK resultante bloquea
#      cualquier intento posterior de cruzar formatos.
#   9. Apply → rollback → reapply de la 159 en base local.
#
# No requiere red — todo contra Postgres local. Requiere el mismo entorno
# que pruebas/local-desde-cero.sh.
# ─────────────────────────────────────────────────────────────────────────
set -euo pipefail

BASE="${1:-dspacios_dtm}"
PUERTO="${2:-5432}"
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRACIONES="$AQUI/../migrations"
FALLOS=0

ok()   { echo "   OK: $1"; }
fail() { echo "   FALLÓ: $1"; FALLOS=$((FALLOS + 1)); }

# ═══════════════════════════════════════════════════════════════════════
# PARTE 1 — el candado de la 159 (0 mayorista al aplicar)
# ═══════════════════════════════════════════════════════════════════════
echo "== Base hasta la migración 158 (SIN la 159 todavía)"
"$AQUI/pruebas/local-desde-cero.sh" "$BASE" "$PUERTO" 158 > /tmp/dtm_setup.log 2>&1 || {
  echo "   FALLÓ el andamiaje — ver /tmp/dtm_setup.log"; cat /tmp/dtm_setup.log; exit 1;
}
echo "   listo"

echo "== Prueba 1: la 159 debe ABORTAR si ya existe un contrato tenant=mayorista"
psql -p "$PUERTO" -d "$BASE" -v ON_ERROR_STOP=1 -q -c "
  insert into public.ventas (numero_contrato, tenant, cliente) values ('00-9001', 'mayorista', 'Cliente fantasma');
"
if psql -p "$PUERTO" -d "$BASE" -v ON_ERROR_STOP=1 -q -f "$MIGRACIONES/20260601000159_consecutivo_dtm_mayorista.sql" > /tmp/dtm_159_debe_fallar.log 2>&1; then
  fail "la migración 159 aplicó con un contrato mayorista ya existente (debía abortar)"
  cat /tmp/dtm_159_debe_fallar.log
else
  if grep -q "ABORTADO" /tmp/dtm_159_debe_fallar.log; then
    ok "la 159 abortó con el mensaje esperado al encontrar un contrato mayorista existente"
  else
    fail "la 159 abortó pero SIN el mensaje esperado ('ABORTADO')"
    cat /tmp/dtm_159_debe_fallar.log
  fi
fi

echo "== Confirmando que el aborto fue transaccional: NADA de la 159 quedó a medias"
NADA=$(psql -p "$PUERTO" -d "$BASE" -tAc "
  select count(*) from pg_proc where proname = 'siguiente_numero_contrato_para_tenant';
")
if [ "$NADA" != "0" ]; then
  fail "la función nueva quedó creada pese al aborto (la transacción no fue atómica)"
else
  ok "ningún objeto de la 159 quedó creado tras el aborto"
fi

echo "== Limpiando el contrato fantasma"
psql -p "$PUERTO" -d "$BASE" -v ON_ERROR_STOP=1 -q -c "delete from public.ventas where numero_contrato = '00-9001';"

echo "== Prueba 2: con 0 contratos mayorista, la 159 aplica limpio"
psql -p "$PUERTO" -d "$BASE" -v ON_ERROR_STOP=1 -q -f "$MIGRACIONES/20260601000159_consecutivo_dtm_mayorista.sql" > /tmp/dtm_159_ok.log 2>&1 && \
  ok "la 159 aplicó sin error" || { fail "la 159 debía aplicar limpio y no lo hizo"; cat /tmp/dtm_159_ok.log; }

# ═══════════════════════════════════════════════════════════════════════
# Fixture: usuario superadmin autenticado (para RPC + eliminar_contrato)
# ═══════════════════════════════════════════════════════════════════════
psql -p "$PUERTO" -d "$BASE" -v ON_ERROR_STOP=1 -q <<'SQL'
insert into auth.users (id, email) values ('d0000001-0000-0000-0000-000000000001', 'sa-dtm@test.com')
  on conflict (id) do nothing;
insert into public.usuarios (id, email, nombre, rol, activo, tenant) values
  ('d0000001-0000-0000-0000-000000000001', 'sa-dtm@test.com', 'Superadmin DTM', 'superadmin', true, 'mayorista')
  on conflict (id) do update set nombre=excluded.nombre, rol=excluded.rol, activo=excluded.activo, tenant=excluded.tenant;
SQL

AUTH_SETUP="set role authenticated; select set_config('request.jwt.claims', json_build_object('sub', 'd0000001-0000-0000-0000-000000000001', 'role', 'authenticated')::text, false);"
# Extrae SOLO la línea con el número devuelto (DTM-.../MIN-...), sin
# importar cuántas líneas de tags de comando (BEGIN/SET/COMMIT) o el propio
# valor de set_config las rodeen — más robusto que contar líneas con tail.
extraer_numero() { grep -E '^(DTM-|MIN-)' | tail -1; }

# ═══════════════════════════════════════════════════════════════════════
# PARTE 2 — generación por tenant
# ═══════════════════════════════════════════════════════════════════════
echo "== Prueba 3: primer mayorista -> DTM-0001, segundo -> DTM-0002 (authenticated)"
N1=$(psql -p "$PUERTO" -d "$BASE" -tAc "begin; $AUTH_SETUP select public.siguiente_numero_contrato_para_tenant('mayorista'); commit;" | extraer_numero)
N2=$(psql -p "$PUERTO" -d "$BASE" -tAc "begin; $AUTH_SETUP select public.siguiente_numero_contrato_para_tenant('mayorista'); commit;" | extraer_numero)
[ "$N1" = "DTM-0001" ] && ok "primer mayorista = DTM-0001" || fail "primer mayorista fue '$N1', se esperaba DTM-0001"
[ "$N2" = "DTM-0002" ] && ok "segundo mayorista = DTM-0002 (consecutivo, nunca repite)" || fail "segundo mayorista fue '$N2', se esperaba DTM-0002"

echo "== Prueba 4: minorista sigue con su mecanismo actual (MIN-00-XXXX)"
NMIN=$(psql -p "$PUERTO" -d "$BASE" -tAc "begin; $AUTH_SETUP select public.siguiente_numero_contrato_para_tenant('minorista'); commit;" | extraer_numero)
if [[ "$NMIN" =~ ^MIN-00-[0-9]{4}$ ]]; then
  ok "minorista devolvió '$NMIN' (formato MIN-00-NNNN, como siempre)"
else
  fail "minorista devolvió '$NMIN', formato inesperado"
fi

echo "== Prueba 5: tenant NULL / vacío / inválido -> rechazo"
for CASO in "null" "''" "'francia'"; do
  if psql -p "$PUERTO" -d "$BASE" -v ON_ERROR_STOP=1 -tAc "select public.siguiente_numero_contrato_para_tenant($CASO);" > /tmp/dtm_tenant_malo.log 2>&1; then
    fail "tenant $CASO NO fue rechazado"
  else
    ok "tenant $CASO fue rechazado correctamente"
  fi
done

echo "== Prueba 6: anon NO puede invocar la función nueva ni usar la secuencia"
if psql -p "$PUERTO" -d "$BASE" -tAc "set role anon; select public.siguiente_numero_contrato_para_tenant('mayorista');" > /tmp/dtm_anon.log 2>&1; then
  fail "anon SÍ pudo invocar la función (debía estar revocada)"
  cat /tmp/dtm_anon.log
else
  if grep -qi "permission denied" /tmp/dtm_anon.log; then
    ok "anon fue rechazado por falta de permiso (EXECUTE revocado correctamente)"
  else
    fail "anon fue rechazado pero no por permisos — revisar mensaje:"
    cat /tmp/dtm_anon.log
  fi
fi

# ═══════════════════════════════════════════════════════════════════════
# PARTE 3 — eliminar_contrato(): DTM- nunca al pool de reciclaje
# ═══════════════════════════════════════════════════════════════════════
echo "== Prueba 7a: eliminar un DTM- con p_reusar=true debe RECHAZARSE (nada se borra)"
psql -p "$PUERTO" -d "$BASE" -v ON_ERROR_STOP=1 -q -c "
  insert into public.ventas (numero_contrato, tenant, cliente) values ('DTM-0001', 'mayorista', 'Cliente DTM prueba')
    on conflict (numero_contrato) do nothing;
"
if psql -p "$PUERTO" -d "$BASE" -tAc "begin; $AUTH_SETUP select public.eliminar_contrato('DTM-0001', true); commit;" > /tmp/dtm_elim_reusar.log 2>&1; then
  fail "eliminar_contrato('DTM-0001', true) NO se rechazó (debía)"
  cat /tmp/dtm_elim_reusar.log
else
  ok "eliminar_contrato('DTM-0001', true) fue rechazado"
fi
EXISTE_TRAS_RECHAZO=$(psql -p "$PUERTO" -d "$BASE" -tAc "select count(*) from public.ventas where numero_contrato = 'DTM-0001';")
[ "$EXISTE_TRAS_RECHAZO" = "1" ] && ok "el contrato DTM-0001 sigue existiendo (el rechazo fue ATÓMICO, no borró nada)" \
  || fail "el contrato DTM-0001 desapareció pese a que la operación se rechazó"
POOL_CON_DTM=$(psql -p "$PUERTO" -d "$BASE" -tAc "select count(*) from public.numeros_contrato_liberados where numero = 'DTM-0001';")
[ "$POOL_CON_DTM" = "0" ] && ok "DTM-0001 NUNCA entró al pool de reciclaje" \
  || fail "DTM-0001 quedó en numeros_contrato_liberados (no debía)"

echo "== Prueba 7b: eliminar el mismo DTM- con p_reusar=false SÍ debe funcionar"
psql -p "$PUERTO" -d "$BASE" -v ON_ERROR_STOP=1 -q -c "begin; $AUTH_SETUP select public.eliminar_contrato('DTM-0001', false); commit;" > /tmp/dtm_elim_normal.log 2>&1 && \
  ok "eliminar_contrato('DTM-0001', false) funcionó normal" || { fail "eliminar_contrato('DTM-0001', false) falló y no debía"; cat /tmp/dtm_elim_normal.log; }
EXISTE_TRAS_BORRADO=$(psql -p "$PUERTO" -d "$BASE" -tAc "select count(*) from public.ventas where numero_contrato = 'DTM-0001';")
[ "$EXISTE_TRAS_BORRADO" = "0" ] && ok "el contrato DTM-0001 sí se borró con p_reusar=false" \
  || fail "el contrato DTM-0001 sigue existiendo tras pedir borrarlo sin reusar"

echo "== Prueba 7c: minorista conserva su reciclaje intacto (control positivo)"
psql -p "$PUERTO" -d "$BASE" -v ON_ERROR_STOP=1 -q -c "
  insert into public.ventas (numero_contrato, tenant, cliente) values ('MIN-00-8001', 'minorista', 'Cliente MIN prueba')
    on conflict (numero_contrato) do nothing;
"
psql -p "$PUERTO" -d "$BASE" -v ON_ERROR_STOP=1 -q -c "begin; $AUTH_SETUP select public.eliminar_contrato('MIN-00-8001', true); commit;" > /tmp/dtm_elim_min.log 2>&1 && \
  ok "eliminar_contrato('MIN-00-8001', true) funcionó (minorista sin cambios)" || { fail "eliminar_contrato de minorista con reusar falló"; cat /tmp/dtm_elim_min.log; }
POOL_CON_MIN=$(psql -p "$PUERTO" -d "$BASE" -tAc "select count(*) from public.numeros_contrato_liberados where numero = 'MIN-00-8001';")
[ "$POOL_CON_MIN" = "1" ] && ok "MIN-00-8001 SÍ entró al pool (comportamiento de minorista sin cambios)" \
  || fail "MIN-00-8001 no quedó en el pool de reciclaje (minorista debía conservar su comportamiento)"

# ═══════════════════════════════════════════════════════════════════════
# PARTE 4 — apply -> rollback -> reapply de la 159
# ═══════════════════════════════════════════════════════════════════════
echo "== Prueba 9: apply -> rollback -> reapply de la 159 (sobre una base sin contratos DTM- reales)"
psql -p "$PUERTO" -d "$BASE" -v ON_ERROR_STOP=1 -q -f "$AQUI/rollback_159_consecutivo_dtm_mayorista.sql" > /tmp/dtm_rollback.log 2>&1 && \
  ok "rollback de la 159 aplicó sin error" || { fail "el rollback de la 159 falló"; cat /tmp/dtm_rollback.log; }
YA_NO_EXISTE=$(psql -p "$PUERTO" -d "$BASE" -tAc "select count(*) from pg_proc where proname = 'siguiente_numero_contrato_para_tenant';")
[ "$YA_NO_EXISTE" = "0" ] && ok "la función quedó eliminada tras el rollback" || fail "la función sigue existiendo tras el rollback"
psql -p "$PUERTO" -d "$BASE" -v ON_ERROR_STOP=1 -q -f "$MIGRACIONES/20260601000159_consecutivo_dtm_mayorista.sql" > /tmp/dtm_reapply.log 2>&1 && \
  ok "reapply de la 159 aplicó sin error" || { fail "el reapply de la 159 falló"; cat /tmp/dtm_reapply.log; }
REAPARECIO=$(psql -p "$PUERTO" -d "$BASE" -tAc "select count(*) from pg_proc where proname = 'siguiente_numero_contrato_para_tenant';")
[ "$REAPARECIO" = "1" ] && ok "la función reapareció tras el reapply" || fail "la función no reapareció tras el reapply"

echo "== Confirmando que la secuencia mayorista quedó en 1 tras el reapply (rollback+reapply no deja arrastre)"
NUEVO_PRIMER=$(psql -p "$PUERTO" -d "$BASE" -tAc "begin; $AUTH_SETUP select public.siguiente_numero_contrato_para_tenant('mayorista'); commit;" | extraer_numero)
[ "$NUEVO_PRIMER" = "DTM-0001" ] && ok "tras rollback+reapply, el primer mayorista vuelve a ser DTM-0001" \
  || fail "tras rollback+reapply el primer mayorista fue '$NUEVO_PRIMER', se esperaba DTM-0001"
# Limpiar: ese contrato de prueba no debe quedar bloqueando la parte 5.
psql -p "$PUERTO" -d "$BASE" -v ON_ERROR_STOP=1 -q -c "delete from public.ventas where numero_contrato = 'MIN-00-8001';" 2>/dev/null || true

# ═══════════════════════════════════════════════════════════════════════
# PARTE 5 — migración 160 (cierre): aborta con formato incompatible, aplica
# limpio si todo está bien, y el CHECK bloquea cruces de formato después.
# ═══════════════════════════════════════════════════════════════════════
echo "== Prueba 8a: la 160 debe ABORTAR si hay un mayorista con formato incompatible"
psql -p "$PUERTO" -d "$BASE" -v ON_ERROR_STOP=1 -q -c "
  insert into public.ventas (numero_contrato, tenant, cliente) values ('00-9999', 'mayorista', 'Formato viejo colado');
"
if psql -p "$PUERTO" -d "$BASE" -v ON_ERROR_STOP=1 -q -f "$MIGRACIONES/20260601000160_ventas_formato_numero_por_tenant.sql" > /tmp/dtm_160_debe_fallar.log 2>&1; then
  fail "la 160 aplicó con un mayorista de formato incompatible (debía abortar)"
else
  grep -q "ABORTADO" /tmp/dtm_160_debe_fallar.log && ok "la 160 abortó con el mensaje esperado" \
    || { fail "la 160 abortó pero sin el mensaje esperado"; cat /tmp/dtm_160_debe_fallar.log; }
fi
psql -p "$PUERTO" -d "$BASE" -v ON_ERROR_STOP=1 -q -c "delete from public.ventas where numero_contrato = '00-9999';"

echo "== Prueba 8b: con todo en formato correcto, la 160 aplica limpio"
psql -p "$PUERTO" -d "$BASE" -v ON_ERROR_STOP=1 -q -f "$MIGRACIONES/20260601000160_ventas_formato_numero_por_tenant.sql" > /tmp/dtm_160_ok.log 2>&1 && \
  ok "la 160 aplicó sin error" || { fail "la 160 debía aplicar limpio y no lo hizo"; cat /tmp/dtm_160_ok.log; }

echo "== Prueba 8c: el CHECK resultante bloquea cruces de formato"
if psql -p "$PUERTO" -d "$BASE" -q -c "insert into public.ventas (numero_contrato, tenant, cliente) values ('00-7777', 'mayorista', 'Cruce');" > /tmp/dtm_check1.log 2>&1; then
  fail "se pudo insertar un mayorista SIN formato DTM- tras la 160"
else
  ok "el CHECK bloqueó un mayorista sin formato DTM-"
fi
if psql -p "$PUERTO" -d "$BASE" -q -c "insert into public.ventas (numero_contrato, tenant, cliente) values ('DTM-9001', 'minorista', 'Cruce inverso');" > /tmp/dtm_check2.log 2>&1; then
  fail "se pudo insertar un minorista con formato DTM- tras la 160"
else
  ok "el CHECK bloqueó un minorista con formato DTM- (cruce inverso)"
fi
if psql -p "$PUERTO" -d "$BASE" -v ON_ERROR_STOP=1 -q -c "begin; $AUTH_SETUP select public.siguiente_numero_contrato_para_tenant('mayorista'); commit;" > /tmp/dtm_check3.log 2>&1; then
  ok "generar y guardar un DTM- real sigue funcionando después de la 160 (candado no rompe el flujo normal)"
else
  fail "algo del flujo normal de generación se rompió con el CHECK activo"
  cat /tmp/dtm_check3.log
fi

# ═══════════════════════════════════════════════════════════════════════
echo "═══════════════════════════════════════════════════════════════"
if [ "$FALLOS" -eq 0 ]; then
  echo "TODAS LAS PRUEBAS PASARON."
else
  echo "$FALLOS PRUEBA(S) FALLARON — ver detalle arriba."
  exit 1
fi
