#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────
# PRUEBAS de la migración 159 (consecutivo_dtm_mayorista) + 160 (cierre de
# formato). Reutiliza pruebas/local-desde-cero.sh para el andamiaje.
#
#   supabase/scripts/test_consecutivo_dtm_mayorista.sh [base] [puerto]
#
# Cubre (enunciado original, punto 9, MÁS los defectos de la revisión
# posterior al PR #274):
#   1. Migración 159 ABORTA si ya existe un contrato tenant=mayorista.
#   2. Con 0 contratos mayorista, la 159 aplica limpio.
#   3. Primer mayorista → DTM-0001, segundo → DTM-0002 (vía service_role).
#   4. Minorista sigue igual: MIN-00-XXXX (mismo mecanismo, mismo reciclaje).
#   5. Tenant NULL / vacío / inválido → rechazo (fail closed).
#   6. MATRIZ DE PERMISOS REAL: anon → permission denied; authenticated
#      (mayorista pidiendo mayorista) → permission denied; authenticated
#      (minorista pidiendo mayorista) → permission denied; service_role → SÍ
#      puede ejecutar. El RPC ya NO tiene EXECUTE para `authenticated` (fix
#      de la revisión: antes cualquier sesión autenticada podía gastar
#      consecutivos directo, sin pasar por la aplicación).
#   7. eliminar_contrato(): un DTM- con p_reusar=true se RECHAZA (nunca entra
#      a numeros_contrato_liberados); con p_reusar=false sí se borra normal;
#      minorista conserva su reciclaje intacto.
#   8. RECICLAJE DE MINORISTA SIN DOBLE PREFIJO (fix de la revisión):
#      A) reciclar un MIN-00-XXXX ya prefijado → el generador nuevo devuelve
#         EXACTAMENTE ese valor, nunca 'MIN-MIN-00-XXXX'.
#      B) un valor CRUDO sembrado a mano en el pool (00-XXXX, formato
#         histórico previo a la convención MIN-) → sí se le antepone 'MIN-'.
#      C) sin nada en el pool → sigue usando contrato_seq normal.
#   9. Migración 160 ABORTA si hay una fila con formato incompatible, y
#      aplica limpio si todo está bien — y el CHECK resultante bloquea
#      cualquier intento posterior de cruzar formatos.
#  10. HUELLA REAL de eliminar_contrato() (pg_get_functiondef) antes/después
#      de la 159: prueba, con SQL real (no una lectura de archivo asumida),
#      que el ÚNICO cambio funcional es el candado DTM nuevo — quitándolo de
#      la huella "después" se reconstruye EXACTAMENTE la huella "antes".
#  11. Apply → rollback → reapply de la 159 en base local.
#  12. ROLLBACK NEGATIVO: si ya existe un contrato DTM real, el rollback de
#      la 159 debe ABORTAR (nada cambia — ni la función, ni la secuencia).
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
# Extrae SOLO la línea con el número devuelto (DTM-.../MIN-...), sin importar
# cuántas líneas de tags de comando (BEGIN/SET/COMMIT) o el propio valor de
# set_config las rodeen — más robusto que contar líneas con tail.
extraer_numero() { grep -E '^(DTM-|MIN-)' | tail -1; }

# ═══════════════════════════════════════════════════════════════════════
# PARTE 1 — el candado de la 159 (0 mayorista al aplicar)
# ═══════════════════════════════════════════════════════════════════════
echo "== Base hasta la migración 158 (SIN la 159 todavía)"
"$AQUI/pruebas/local-desde-cero.sh" "$BASE" "$PUERTO" 158 > /tmp/dtm_setup.log 2>&1 || {
  echo "   FALLÓ el andamiaje — ver /tmp/dtm_setup.log"; cat /tmp/dtm_setup.log; exit 1;
}
echo "   listo"

echo "== Prueba 10 (parte 1/3): huella REAL de eliminar_contrato() ANTES de la 159"
FP_ANTES=$(psql -p "$PUERTO" -d "$BASE" -tAc "select pg_get_functiondef('public.eliminar_contrato(text, boolean)'::regprocedure);")
[ -n "$FP_ANTES" ] && ok "huella capturada (${#FP_ANTES} caracteres)" || fail "no se pudo capturar la huella de eliminar_contrato() antes de la 159"

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

echo "== Prueba 10 (parte 2/3): huella REAL de eliminar_contrato() DESPUÉS de la 159"
FP_DESPUES=$(psql -p "$PUERTO" -d "$BASE" -tAc "select pg_get_functiondef('public.eliminar_contrato(text, boolean)'::regprocedure);")
if [[ "$FP_DESPUES" == *"No se puede reutilizar el consecutivo de un contrato DTM-"* ]]; then
  ok "la huella DESPUÉS de la 159 sí trae el candado DTM nuevo"
else
  fail "la huella DESPUÉS de la 159 NO trae el candado DTM esperado"
fi

# Comparación NORMALIZADA (sin líneas en blanco, sin espacios finales): se
# extrae el bloque del candado DTM directamente del propio archivo de la
# migración (nunca tecleado a mano — evita cualquier diferencia de acentos/
# comillas al reconstruirlo en bash) y se quita, como bloque CONTIGUO (no
# línea por línea suelta — la función repite el texto "end if;" en más de un
# bloque, así que una resta por líneas sueltas quitaría de más), de la huella
# DESPUÉS. Si lo que queda es idéntico a la huella ANTES, queda probado con
# SQL real que el candado DTM es el ÚNICO cambio funcional de este
# create-or-replace. Ignorar líneas en blanco es seguro: no cambian el
# comportamiento de la función, solo el formato.
normalizar() { grep -v '^[[:space:]]*$' | sed 's/[[:space:]]*$//'; }
GUARDA_DTM_LINEAS=$(awk '
  /if p_reusar and p_numero ~/ { flag=1 }
  flag { print }
  flag && /^  end if;$/ { exit }
' "$MIGRACIONES/20260601000159_consecutivo_dtm_mayorista.sql" | normalizar)

FP_ANTES_NORM=$(echo "$FP_ANTES" | normalizar)
FP_DESPUES_NORM=$(echo "$FP_DESPUES" | normalizar)

# Quita la PRIMERA ocurrencia CONTIGUA del bloque (no un set-diff por línea).
FP_DESPUES_SIN_CANDADO_NORM=$(awk '
  FNR==NR { g[++n] = $0; next }
  { d[++m] = $0 }
  END {
    found = 0
    for (i = 1; i <= m - n + 1 && !found; i++) {
      ok = 1
      for (j = 1; j <= n; j++) { if (d[i+j-1] != g[j]) { ok = 0; break } }
      if (ok) { start = i; found = 1 }
    }
    for (i = 1; i <= m; i++) {
      if (found && i >= start && i < start + n) continue
      print d[i]
    }
  }
' <(echo "$GUARDA_DTM_LINEAS") <(echo "$FP_DESPUES_NORM"))

if [ "$FP_DESPUES_SIN_CANDADO_NORM" = "$FP_ANTES_NORM" ]; then
  ok "quitando las líneas del candado DTM de la huella DESPUÉS (normalizada) se reconstruye EXACTAMENTE la huella ANTES — es el único cambio funcional"
else
  fail "la huella DESPUÉS (sin el candado DTM) NO coincide con la huella ANTES — hay más diferencias de las esperadas"
  diff <(echo "$FP_ANTES_NORM") <(echo "$FP_DESPUES_SIN_CANDADO_NORM") | head -30 || true
fi

# ═══════════════════════════════════════════════════════════════════════
# Fixtures: usuarios autenticados (superadmin mayorista y uno minorista) —
# para la matriz de permisos y eliminar_contrato().
# ═══════════════════════════════════════════════════════════════════════
psql -p "$PUERTO" -d "$BASE" -v ON_ERROR_STOP=1 -q <<'SQL'
insert into auth.users (id, email) values ('d0000001-0000-0000-0000-000000000001', 'sa-dtm@test.com')
  on conflict (id) do nothing;
insert into public.usuarios (id, email, nombre, rol, activo, tenant) values
  ('d0000001-0000-0000-0000-000000000001', 'sa-dtm@test.com', 'Superadmin DTM', 'superadmin', true, 'mayorista')
  on conflict (id) do update set nombre=excluded.nombre, rol=excluded.rol, activo=excluded.activo, tenant=excluded.tenant;

insert into auth.users (id, email) values ('d0000002-0000-0000-0000-000000000002', 'venta-min-dtm@test.com')
  on conflict (id) do nothing;
insert into public.usuarios (id, email, nombre, rol, activo, tenant) values
  ('d0000002-0000-0000-0000-000000000002', 'venta-min-dtm@test.com', 'Asesor Minorista DTM', 'venta', true, 'minorista')
  on conflict (id) do update set nombre=excluded.nombre, rol=excluded.rol, activo=excluded.activo, tenant=excluded.tenant;
SQL

AUTH_SUPERADMIN="set role authenticated; select set_config('request.jwt.claims', json_build_object('sub', 'd0000001-0000-0000-0000-000000000001', 'role', 'authenticated')::text, false);"
AUTH_VENTA_MINORISTA="set role authenticated; select set_config('request.jwt.claims', json_build_object('sub', 'd0000002-0000-0000-0000-000000000002', 'role', 'authenticated')::text, false);"
SERVICE_SETUP="set role service_role;"

# ═══════════════════════════════════════════════════════════════════════
# PARTE 2 — generación por tenant (SIEMPRE vía service_role, como llama la
# aplicación real: lib/contrato/numeracion.ts usa createAdminClient()).
# ═══════════════════════════════════════════════════════════════════════
echo "== Prueba 3: primer mayorista -> DTM-0001, segundo -> DTM-0002 (service_role)"
N1=$(psql -p "$PUERTO" -d "$BASE" -tAc "begin; $SERVICE_SETUP select public.siguiente_numero_contrato_para_tenant('mayorista'); commit;" | extraer_numero)
N2=$(psql -p "$PUERTO" -d "$BASE" -tAc "begin; $SERVICE_SETUP select public.siguiente_numero_contrato_para_tenant('mayorista'); commit;" | extraer_numero)
[ "$N1" = "DTM-0001" ] && ok "primer mayorista = DTM-0001" || fail "primer mayorista fue '$N1', se esperaba DTM-0001"
[ "$N2" = "DTM-0002" ] && ok "segundo mayorista = DTM-0002 (consecutivo, nunca repite)" || fail "segundo mayorista fue '$N2', se esperaba DTM-0002"

echo "== Prueba 4: minorista sigue con su mecanismo actual (MIN-00-XXXX)"
NMIN=$(psql -p "$PUERTO" -d "$BASE" -tAc "begin; $SERVICE_SETUP select public.siguiente_numero_contrato_para_tenant('minorista'); commit;" | extraer_numero)
if [[ "$NMIN" =~ ^MIN-00-[0-9]{4}$ ]]; then
  ok "minorista devolvió '$NMIN' (formato MIN-00-NNNN, como siempre)"
else
  fail "minorista devolvió '$NMIN', formato inesperado"
fi

echo "== Prueba 5: tenant NULL / vacío / inválido -> rechazo (vía service_role)"
for CASO in "null" "''" "'francia'"; do
  if psql -p "$PUERTO" -d "$BASE" -v ON_ERROR_STOP=1 -tAc "begin; $SERVICE_SETUP select public.siguiente_numero_contrato_para_tenant($CASO); commit;" > /tmp/dtm_tenant_malo.log 2>&1; then
    fail "tenant $CASO NO fue rechazado"
  else
    ok "tenant $CASO fue rechazado correctamente"
  fi
done

# ═══════════════════════════════════════════════════════════════════════
# PARTE 3 — MATRIZ DE PERMISOS REAL (fix de la revisión posterior al PR
# #274): el RPC solo debe poder invocarlo service_role.
# ═══════════════════════════════════════════════════════════════════════
echo "== Prueba 6a: anon NO puede invocar la función nueva"
if psql -p "$PUERTO" -d "$BASE" -tAc "set role anon; select public.siguiente_numero_contrato_para_tenant('mayorista');" > /tmp/dtm_anon.log 2>&1; then
  fail "anon SÍ pudo invocar la función (debía estar revocada)"
  cat /tmp/dtm_anon.log
else
  grep -qi "permission denied" /tmp/dtm_anon.log && ok "anon fue rechazado por falta de permiso (EXECUTE revocado)" \
    || { fail "anon fue rechazado pero no por permisos"; cat /tmp/dtm_anon.log; }
fi

echo "== Prueba 6b: authenticated (superadmin, tenant=mayorista) pidiendo 'mayorista' DIRECTO -> permission denied"
if psql -p "$PUERTO" -d "$BASE" -tAc "begin; $AUTH_SUPERADMIN select public.siguiente_numero_contrato_para_tenant('mayorista'); commit;" > /tmp/dtm_auth_may.log 2>&1; then
  fail "un usuario authenticated SÍ pudo invocar el RPC directo (debía estar revocado incluso para superadmin/mayorista)"
  cat /tmp/dtm_auth_may.log
else
  grep -qi "permission denied" /tmp/dtm_auth_may.log && ok "authenticated (mayorista) fue rechazado por falta de permiso — ni siquiera un rol/tenant legítimo puede invocar el RPC directo, solo la app vía service_role" \
    || { fail "authenticated (mayorista) fue rechazado pero no por permisos"; cat /tmp/dtm_auth_may.log; }
fi

echo "== Prueba 6c: authenticated (asesor MINORISTA) pidiendo 'mayorista' DIRECTO -> permission denied"
if psql -p "$PUERTO" -d "$BASE" -tAc "begin; $AUTH_VENTA_MINORISTA select public.siguiente_numero_contrato_para_tenant('mayorista'); commit;" > /tmp/dtm_auth_min.log 2>&1; then
  fail "un usuario authenticated de OTRO tenant (minorista) SÍ pudo pedir un número mayorista (debía estar revocado)"
  cat /tmp/dtm_auth_min.log
else
  grep -qi "permission denied" /tmp/dtm_auth_min.log && ok "authenticated (minorista pidiendo mayorista) fue rechazado por falta de permiso — el candado es a nivel de GRANT, no depende de qué tenant pida" \
    || { fail "authenticated (minorista) fue rechazado pero no por permisos"; cat /tmp/dtm_auth_min.log; }
fi

echo "== Prueba 6d: service_role SÍ puede ejecutar el RPC (control positivo, confirma que el candado es selectivo, no total)"
if psql -p "$PUERTO" -d "$BASE" -v ON_ERROR_STOP=1 -tAc "begin; $SERVICE_SETUP select public.siguiente_numero_contrato_para_tenant('mayorista'); commit;" > /tmp/dtm_service_ok.log 2>&1; then
  ok "service_role ejecutó el RPC sin error (único rol con EXECUTE)"
else
  fail "service_role NO pudo ejecutar el RPC (debía poder)"; cat /tmp/dtm_service_ok.log
fi

echo "== Prueba 6e: anon/authenticated tampoco tienen USAGE sobre la secuencia mayorista"
for ROL in anon authenticated; do
  if psql -p "$PUERTO" -d "$BASE" -tAc "set role $ROL; select nextval('public.contrato_seq_mayorista');" > /tmp/dtm_seq_$ROL.log 2>&1; then
    fail "$ROL SÍ pudo hacer nextval() directo sobre contrato_seq_mayorista (debía estar revocado)"
  else
    grep -qi "permission denied" /tmp/dtm_seq_$ROL.log && ok "$ROL sin USAGE sobre contrato_seq_mayorista" \
      || { fail "$ROL fue rechazado pero no por permisos"; cat /tmp/dtm_seq_$ROL.log; }
  fi
done

# ═══════════════════════════════════════════════════════════════════════
# PARTE 4 — eliminar_contrato(): DTM- nunca al pool de reciclaje
# ═══════════════════════════════════════════════════════════════════════
echo "== Prueba 7a: eliminar un DTM- con p_reusar=true debe RECHAZARSE (nada se borra)"
psql -p "$PUERTO" -d "$BASE" -v ON_ERROR_STOP=1 -q -c "
  insert into public.ventas (numero_contrato, tenant, cliente) values ('DTM-0001', 'mayorista', 'Cliente DTM prueba')
    on conflict (numero_contrato) do nothing;
"
if psql -p "$PUERTO" -d "$BASE" -tAc "begin; $AUTH_SUPERADMIN select public.eliminar_contrato('DTM-0001', true); commit;" > /tmp/dtm_elim_reusar.log 2>&1; then
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
psql -p "$PUERTO" -d "$BASE" -v ON_ERROR_STOP=1 -q -c "begin; $AUTH_SUPERADMIN select public.eliminar_contrato('DTM-0001', false); commit;" > /tmp/dtm_elim_normal.log 2>&1 && \
  ok "eliminar_contrato('DTM-0001', false) funcionó normal" || { fail "eliminar_contrato('DTM-0001', false) falló y no debía"; cat /tmp/dtm_elim_normal.log; }
EXISTE_TRAS_BORRADO=$(psql -p "$PUERTO" -d "$BASE" -tAc "select count(*) from public.ventas where numero_contrato = 'DTM-0001';")
[ "$EXISTE_TRAS_BORRADO" = "0" ] && ok "el contrato DTM-0001 sí se borró con p_reusar=false" \
  || fail "el contrato DTM-0001 sigue existiendo tras pedir borrarlo sin reusar"

echo "== Prueba 7c: minorista conserva su reciclaje intacto (control positivo)"
psql -p "$PUERTO" -d "$BASE" -v ON_ERROR_STOP=1 -q -c "
  insert into public.ventas (numero_contrato, tenant, cliente) values ('MIN-00-8001', 'minorista', 'Cliente MIN prueba')
    on conflict (numero_contrato) do nothing;
"
psql -p "$PUERTO" -d "$BASE" -v ON_ERROR_STOP=1 -q -c "begin; $AUTH_SUPERADMIN select public.eliminar_contrato('MIN-00-8001', true); commit;" > /tmp/dtm_elim_min.log 2>&1 && \
  ok "eliminar_contrato('MIN-00-8001', true) funcionó (minorista sin cambios)" || { fail "eliminar_contrato de minorista con reusar falló"; cat /tmp/dtm_elim_min.log; }
POOL_CON_MIN=$(psql -p "$PUERTO" -d "$BASE" -tAc "select count(*) from public.numeros_contrato_liberados where numero = 'MIN-00-8001';")
[ "$POOL_CON_MIN" = "1" ] && ok "MIN-00-8001 SÍ entró al pool (comportamiento de minorista sin cambios)" \
  || fail "MIN-00-8001 no quedó en el pool de reciclaje (minorista debía conservar su comportamiento)"

# ═══════════════════════════════════════════════════════════════════════
# PARTE 5 — RECICLAJE DE MINORISTA SIN DOBLE PREFIJO (fix de la revisión)
# ═══════════════════════════════════════════════════════════════════════
echo "== Prueba 8a: reciclar MIN-00-8001 (ya prefijado, sembrado en la Prueba 7c) -> EXACTAMENTE MIN-00-8001, nunca MIN-MIN-..."
RECICLADO_A=$(psql -p "$PUERTO" -d "$BASE" -tAc "begin; $SERVICE_SETUP select public.siguiente_numero_contrato_para_tenant('minorista'); commit;" | extraer_numero)
if [ "$RECICLADO_A" = "MIN-00-8001" ]; then
  ok "reciclado correctamente como 'MIN-00-8001' (sin doble prefijo)"
elif [[ "$RECICLADO_A" == "MIN-MIN-"* ]]; then
  fail "DOBLE PREFIJO detectado: '$RECICLADO_A' — el fix no está aplicado"
else
  fail "valor inesperado al reciclar: '$RECICLADO_A' (se esperaba MIN-00-8001)"
fi

echo "== Prueba 8b: sembrar un valor CRUDO en el pool (00-8002, formato histórico previo a MIN-) -> SÍ se le antepone MIN-"
psql -p "$PUERTO" -d "$BASE" -v ON_ERROR_STOP=1 -q -c "
  insert into public.numeros_contrato_liberados(numero) values ('00-8002') on conflict do nothing;
"
RECICLADO_B=$(psql -p "$PUERTO" -d "$BASE" -tAc "begin; $SERVICE_SETUP select public.siguiente_numero_contrato_para_tenant('minorista'); commit;" | extraer_numero)
[ "$RECICLADO_B" = "MIN-00-8002" ] && ok "un valor crudo del pool ('00-8002') se prefijó correctamente a 'MIN-00-8002'" \
  || fail "se esperaba 'MIN-00-8002', se obtuvo '$RECICLADO_B'"

echo "== Prueba 8c: sin nada en el pool -> sigue generando desde contrato_seq normal (formato MIN-00-NNNN)"
psql -p "$PUERTO" -d "$BASE" -v ON_ERROR_STOP=1 -q -c "delete from public.numeros_contrato_liberados;"
RECICLADO_C=$(psql -p "$PUERTO" -d "$BASE" -tAc "begin; $SERVICE_SETUP select public.siguiente_numero_contrato_para_tenant('minorista'); commit;" | extraer_numero)
if [[ "$RECICLADO_C" =~ ^MIN-00-[0-9]{4}$ ]] && [ "$RECICLADO_C" != "MIN-00-8001" ] && [ "$RECICLADO_C" != "MIN-00-8002" ]; then
  ok "sin pool, generó un número fresco de contrato_seq: '$RECICLADO_C'"
else
  fail "valor inesperado sin pool: '$RECICLADO_C'"
fi

# ═══════════════════════════════════════════════════════════════════════
# PARTE 6 — ROLLBACK NEGATIVO (si ya hay un DTM real, el rollback ABORTA)
# ═══════════════════════════════════════════════════════════════════════
echo "== Prueba 12: rollback de la 159 debe ABORTAR si ya existe un contrato DTM"
psql -p "$PUERTO" -d "$BASE" -v ON_ERROR_STOP=1 -q -c "
  insert into public.ventas (numero_contrato, tenant, cliente) values ('DTM-9999', 'mayorista', 'Contrato DTM real, no debe permitir el rollback')
    on conflict (numero_contrato) do nothing;
"
if psql -p "$PUERTO" -d "$BASE" -v ON_ERROR_STOP=1 -q -f "$AQUI/rollback_159_consecutivo_dtm_mayorista.sql" > /tmp/dtm_rollback_debe_fallar.log 2>&1; then
  fail "el rollback de la 159 aplicó CON un contrato DTM existente (debía abortar)"
  cat /tmp/dtm_rollback_debe_fallar.log
else
  grep -q "ABORTADO" /tmp/dtm_rollback_debe_fallar.log && ok "el rollback abortó con el mensaje esperado" \
    || { fail "el rollback abortó pero sin el mensaje esperado"; cat /tmp/dtm_rollback_debe_fallar.log; }
fi
echo "== Confirmando que el rollback abortado no tocó nada (función/secuencia siguen intactas)"
FUNCION_SIGUE=$(psql -p "$PUERTO" -d "$BASE" -tAc "select count(*) from pg_proc where proname = 'siguiente_numero_contrato_para_tenant';")
SECUENCIA_SIGUE=$(psql -p "$PUERTO" -d "$BASE" -tAc "select count(*) from pg_class where relname = 'contrato_seq_mayorista' and relkind = 'S';")
[ "$FUNCION_SIGUE" = "1" ] && ok "la función sigue existiendo (el rollback abortado no la tocó)" || fail "la función desapareció pese a que el rollback debía abortar"
[ "$SECUENCIA_SIGUE" = "1" ] && ok "la secuencia sigue existiendo (el rollback abortado no la tocó)" || fail "la secuencia desapareció pese a que el rollback debía abortar"
echo "== Limpiando el contrato DTM real de prueba"
psql -p "$PUERTO" -d "$BASE" -v ON_ERROR_STOP=1 -q -c "delete from public.ventas where numero_contrato = 'DTM-9999';"

# ═══════════════════════════════════════════════════════════════════════
# PARTE 7 — apply -> rollback -> reapply de la 159 (ahora SÍ sin DTM reales)
# ═══════════════════════════════════════════════════════════════════════
echo "== Prueba 11: apply -> rollback -> reapply de la 159 (sobre una base sin contratos DTM- reales)"
psql -p "$PUERTO" -d "$BASE" -v ON_ERROR_STOP=1 -q -f "$AQUI/rollback_159_consecutivo_dtm_mayorista.sql" > /tmp/dtm_rollback.log 2>&1 && \
  ok "rollback de la 159 aplicó sin error" || { fail "el rollback de la 159 falló"; cat /tmp/dtm_rollback.log; }
YA_NO_EXISTE=$(psql -p "$PUERTO" -d "$BASE" -tAc "select count(*) from pg_proc where proname = 'siguiente_numero_contrato_para_tenant';")
[ "$YA_NO_EXISTE" = "0" ] && ok "la función quedó eliminada tras el rollback" || fail "la función sigue existiendo tras el rollback"

echo "== Prueba 10 (parte 3/3): huella de eliminar_contrato() TRAS el rollback == huella de ANTES de la 159"
FP_ROLLBACK=$(psql -p "$PUERTO" -d "$BASE" -tAc "select pg_get_functiondef('public.eliminar_contrato(text, boolean)'::regprocedure);")
if [ "$FP_ROLLBACK" = "$FP_ANTES" ]; then
  ok "tras el rollback, eliminar_contrato() volvió a su huella EXACTA de antes de la 159"
else
  fail "tras el rollback, la huella de eliminar_contrato() NO coincide con la de antes de la 159"
  diff <(echo "$FP_ANTES") <(echo "$FP_ROLLBACK") | head -20 || true
fi

psql -p "$PUERTO" -d "$BASE" -v ON_ERROR_STOP=1 -q -f "$MIGRACIONES/20260601000159_consecutivo_dtm_mayorista.sql" > /tmp/dtm_reapply.log 2>&1 && \
  ok "reapply de la 159 aplicó sin error" || { fail "el reapply de la 159 falló"; cat /tmp/dtm_reapply.log; }
REAPARECIO=$(psql -p "$PUERTO" -d "$BASE" -tAc "select count(*) from pg_proc where proname = 'siguiente_numero_contrato_para_tenant';")
[ "$REAPARECIO" = "1" ] && ok "la función reapareció tras el reapply" || fail "la función no reapareció tras el reapply"

echo "== Confirmando que la secuencia mayorista quedó en 1 tras el reapply (rollback+reapply no deja arrastre)"
NUEVO_PRIMER=$(psql -p "$PUERTO" -d "$BASE" -tAc "begin; $SERVICE_SETUP select public.siguiente_numero_contrato_para_tenant('mayorista'); commit;" | extraer_numero)
[ "$NUEVO_PRIMER" = "DTM-0001" ] && ok "tras rollback+reapply, el primer mayorista vuelve a ser DTM-0001" \
  || fail "tras rollback+reapply el primer mayorista fue '$NUEVO_PRIMER', se esperaba DTM-0001"
# Limpiar: los contratos/pool de prueba no deben quedar bloqueando la parte 8.
psql -p "$PUERTO" -d "$BASE" -v ON_ERROR_STOP=1 -q -c "delete from public.ventas where numero_contrato = 'MIN-00-8001';" 2>/dev/null || true
psql -p "$PUERTO" -d "$BASE" -v ON_ERROR_STOP=1 -q -c "delete from public.numeros_contrato_liberados;" 2>/dev/null || true

# ═══════════════════════════════════════════════════════════════════════
# PARTE 8 — migración 160 (cierre): aborta con formato incompatible, aplica
# limpio si todo está bien, y el CHECK bloquea cruces de formato después.
# ═══════════════════════════════════════════════════════════════════════
echo "== Prueba 9a: la 160 debe ABORTAR si hay un mayorista con formato incompatible"
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

echo "== Prueba 9b: con todo en formato correcto, la 160 aplica limpio"
psql -p "$PUERTO" -d "$BASE" -v ON_ERROR_STOP=1 -q -f "$MIGRACIONES/20260601000160_ventas_formato_numero_por_tenant.sql" > /tmp/dtm_160_ok.log 2>&1 && \
  ok "la 160 aplicó sin error" || { fail "la 160 debía aplicar limpio y no lo hizo"; cat /tmp/dtm_160_ok.log; }

echo "== Prueba 9c: el CHECK resultante bloquea cruces de formato"
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
if psql -p "$PUERTO" -d "$BASE" -v ON_ERROR_STOP=1 -q -c "begin; $SERVICE_SETUP select public.siguiente_numero_contrato_para_tenant('mayorista'); commit;" > /tmp/dtm_check3.log 2>&1; then
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
