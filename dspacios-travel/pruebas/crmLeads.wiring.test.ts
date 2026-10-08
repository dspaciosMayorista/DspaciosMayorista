import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const leer = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

const migracion = leer("supabase/migrations/20260601000202_crm_leads.sql");
const acciones = leer("app/(crm)/crm/leads/actions.ts");
const layoutCrm = leer("app/(crm)/layout.tsx");
const catalogos = leer("lib/crm/leads.ts");
const tipos = leer("types/database.ts");
const paginaLista = leer("app/(crm)/crm/leads/page.tsx");
const paginaDetalle = leer("app/(crm)/crm/leads/[id]/page.tsx");
const detalleCliente = leer("app/(crm)/crm/leads/[id]/LeadDetalleClient.tsx");
const bandejaCliente = leer("app/(crm)/crm/leads/LeadsClient.tsx");
const postcheck = leer("supabase/scripts/postcheck_202_crm_leads.sql");
const rollback = leer("supabase/scripts/rollback_202_crm_leads.sql");

describe("CRM leads MVP: wiring de seguridad", () => {
  test("las acciones usan cliente de sesion, nunca service-role", () => {
    assert.match(acciones, /import \{ createClient \} from "@\/lib\/supabase\/server";/);
    assert.doesNotMatch(acciones, /createAdminClient|service_role|SUPABASE_SERVICE_ROLE/);
  });

  test("roles del MVP excluyen operaciones, control_vuelo y roles externos", () => {
    assert.match(catalogos, /CRM_LEAD_ROLES = \["superadmin", "gerencia", "administracion", "venta"\]/);
    assert.doesNotMatch(catalogos, /CRM_LEAD_ROLES = \[[^\]]*operaciones/);
    assert.doesNotMatch(catalogos, /CRM_LEAD_ROLES = \[[^\]]*control_vuelo/);
    assert.doesNotMatch(catalogos, /CRM_LEAD_ROLES = \[[^\]]*agencia/);
  });

  test("la migracion no repite la policy amplia de crm_contactos", () => {
    assert.doesNotMatch(migracion, /auth\.uid\(\)\s+is\s+not\s+null/);
    assert.doesNotMatch(migracion, /using\s*\(\s*true\s*\)/);
    assert.match(migracion, /crm_lead_puede_ver\(tenant, responsable_id\)/);
  });

  test("sin borrado fisico: leads bloquean delete y actividades son append-only", () => {
    assert.match(migracion, /Los leads no se eliminan fisicamente/);
    assert.match(migracion, /crm_lead_actividades_append_only/);
    assert.doesNotMatch(migracion, /create policy "crm_leads: eliminar"/);
  });

  test("catalogos de TypeScript coinciden con los CHECK de SQL", () => {
    assert.match(catalogos, /CRM_LEAD_ETAPAS = \["nuevo", "en_contacto", "calificado", "descartado", "archivado"\]/);
    assert.match(migracion, /check \(etapa in \('nuevo', 'en_contacto', 'calificado', 'descartado', 'archivado'\)\)/);
    assert.match(catalogos, /CRM_LEAD_CANALES = \["whatsapp", "instagram", "otro"\]/);
    assert.match(migracion, /check \(canal in \('whatsapp', 'instagram', 'otro'\)\)/);
  });

  test("la NAV del CRM expone la bandeja de leads", () => {
    assert.match(layoutCrm, /href: "\/crm\/leads", label: "Leads"/);
  });

  test("types/database.ts declara las dos tablas nuevas", () => {
    assert.match(tipos, /crm_leads: \{/);
    assert.match(tipos, /crm_lead_actividades: \{/);
  });
});

// ---------------------------------------------------------------------------
// Autorización propia. El layout `/crm` solo exige sesión: si estas pruebas
// fallan, la pantalla queda abierta para cualquier usuario autenticado.
// ---------------------------------------------------------------------------

describe("CRM leads MVP: cada ruta y cada action autorizan por si mismas", () => {
  test("las DOS rutas validan rol, no solo la sesion del layout", () => {
    for (const [nombre, src] of [["bandeja", paginaLista], ["detalle", paginaDetalle]] as const) {
      assert.match(src, /auth\.getUser\(\)/, `${nombre} no valida sesion`);
      assert.match(src, /from\("usuarios"\)/, `${nombre} no lee el rol`);
      assert.match(src, /CRM_LEAD_ROLES\.includes/, `${nombre} no comprueba el rol`);
      // El perfil se lee del cliente de SESION, no de un cliente privilegiado.
      assert.match(src, /createClient\(\)/, `${nombre} no usa el cliente de servidor`);
      assert.doesNotMatch(src, /createAdminClient|service_role/, `${nombre} usa cliente privilegiado`);
    }
  });

  test("el layout /crm NO es la autorizacion: no filtra por rol", () => {
    // Si el layout llegara a filtrar por rol, el test passaria mientras una
    // ruta nueva colada se saltaria el control. Se afirma lo contrario a
    // proposito: el layout solo pide sesion.
    assert.doesNotMatch(layoutCrm, /CRM_LEAD_ROLES/, "el layout no debe autorizar leads");
    assert.doesNotMatch(layoutCrm, /redirect\("\/dashboard"\)/, "el layout no debe expulsar por rol");
  });

  test("toda action que toca datos comprueba el rol antes de actuar", () => {
    const exports = [...acciones.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
    assert.ok(exports.length >= 6, `solo hay ${exports.length} actions`);

    // Las que SI escriben o leen de la base deben filtrar por rol.
    const cuerpos = acciones.split(/export async function /).slice(1);
    for (const c of cuerpos) {
      const nombre = c.slice(0, c.indexOf("("));
      const tocaBase =
        /\.from\("crm_leads"\)|\.from\("usuarios"\)|\.from\("crm_lead_actividades"\)|\.rpc\(/.test(c);
      if (!tocaBase) {
        // Un getter de constante no filtra datos de la BD: no necesita auth.
        // Se admite solo si no escribe nada.
        assert.doesNotMatch(c, /\.insert\(|\.update\(|\.delete\(|\.upsert\(/, `${nombre} escribe sin ser de lectura`);
        continue;
      }
      assert.match(
        c,
        /autorizado\(perfil\)|CRM_LEAD_ROLES/,
        `${nombre} lee o escribe sin comprobar el rol`,
      );
    }
  });

  test("los getters publicos de catalogos no exponen datos", () => {
    // `proximasEtapas` devuelve una constante de `lib/crm/leads`, que es
    // importable por cualquiera: no filtra nada y por eso no necesita auth.
    const cuerpo = acciones.slice(acciones.indexOf("export async function proximasEtapas"));
    // Desde 1: en 0 está la propia función que delimita el bloque.
    const fin = cuerpo.indexOf("export async function", 1);
    const fn = fin > 0 ? cuerpo.slice(0, fin) : cuerpo;
    assert.match(fn, /CRM_LEAD_ETAPAS/);
    assert.doesNotMatch(fn, /\.from\(|\.rpc\(/, "un getter de constante no debe tocar la base");
  });

  test("las escrituras pasan por RPC: no hay INSERT/UPDATE sueltos desde la app", () => {
    // El cambio de negocio y su bitácora tienen que escribirse en la misma
    // transacción. Con dos llamadas `.insert()`/`.update()` eso no es posible:
    // la bitácora se guarda aunque el lead no se actualice, o al reves.
    assert.doesNotMatch(
      acciones,
      /\.from\("crm_leads"\)[\s\S]{0,120}?\.(insert|update|delete|upsert)\(/,
      "las escrituras de leads deben ir por RPC, no por DML directo",
    );
    assert.doesNotMatch(
      acciones,
      /\.from\("crm_lead_actividades"\)[\s\S]{0,120}?\.(insert|update|delete|upsert)\(/,
      "la bitacora se escribe dentro de la RPC, no desde la app",
    );
    for (const rpc of [
      "crm_lead_crear",
      "crm_lead_actualizar",
      "crm_lead_tomar",
      "crm_lead_cambiar_etapa",
      "crm_lead_registrar_actividad",
    ]) {
      assert.ok(acciones.includes(`sb.rpc("${rpc}"`), `falta la llamada a ${rpc}`);
    }
  });

  test("cada RPC devuelve error cuando falla, sin inventarse un exito", () => {
    // `data` sin `error` es la unica senal de exito; si una action lo ignorara,
    // un rechazo de SQL le llegaria al usuario como "guardado".
    const rpcs = (acciones.match(/sb\.rpc\("[a-z_]+"/g) ?? []).length;
    const chequeos = (acciones.match(/if \(error\) return mensajeRpc\(error\)/g) ?? []).length;
    assert.equal(chequeos, rpcs, "cada llamada a RPC comprueba su error");
    assert.ok((acciones.match(/mensajeRpc\(error\)/g) ?? []).length >= rpcs);
  });

  test("tomar un lead sin responsable es una accion explicita y separada", () => {
    assert.match(acciones, /export async function tomarLead/);
    assert.match(acciones, /sb\.rpc\("crm_lead_tomar"/);
    // La ficha ofrece el boton solo cuando el lead no tiene responsable, y
    // guardar los cambios NO intenta tomar: manda el responsable actual.
    assert.match(detalleCliente, /tomarLead/);
    assert.match(detalleCliente, /!lead\.responsable_id && !puedeReasignar/);
    assert.match(
      detalleCliente,
      /: lead\.responsable_id \?\? "";/,
      "guardar no debe autoasignarse el lead",
    );
  });
});

// ---------------------------------------------------------------------------
// Matriz de roles en RLS. Esto es lo que impide que `venta` vea la cartera
// completa o se robe leads de otro.
// ---------------------------------------------------------------------------

describe("CRM leads MVP: RLS codifica la matriz de roles", () => {
  test("venta solo ve su tenant y leads sin responsable o suyos", () => {
    // La rama 'venta' aparece en `permite_ver` y en `permite_cambiar_responsable`.
    // `permite_crear` no la repite: delega en `permite_ver`.
    const ramas = (migracion.match(/when p_rol = 'venta' then/g) ?? []).length;
    assert.equal(ramas, 2, "se esperan las ramas 'venta' de ver y de cambiar responsable");
    assert.match(migracion, /select public\.crm_lead_responsable_valido\(p_responsable, p_tenant\)\s*\n\s*and public\.crm_lead_permite_ver\(/,
      "el alta debe apoyarse en la matriz de lectura, no duplicarla");
    assert.match(
      migracion,
      /when p_rol = 'venta' then p_actor_tenant = p_tenant and \(p_responsable is null or p_responsable = p_actor_id\)/,
      "venta debe limitarse a su tenant y a leads sin responsable o propios",
    );
  });

  test("venta puede tomar un lead sin responsable, una sola vez", () => {
    // La regla: `p_anterior is null and p_nuevo = p_actor_id`. Como `p_anterior`
    // deja de ser nulo en cuanto el lead tiene dueño, tomar es de una vez y no
    // se puede repetir ni pasar el lead a otro asesor.
    assert.match(
      migracion,
      /when p_rol = 'venta' then\s*\n\s*p_actor_tenant = p_tenant\s*\n\s*and p_anterior is null\s*\n\s*and p_nuevo = p_actor_id/,
      "venta solo puede tomar leads SIN responsable y dejándose a sí mismo",
    );
  });

  test("superadmin, gerencia y administracion tienen alcances distintos", () => {
    // La matriz ya no lee `mi_rol()` dentro de un SECURITY DEFINER: recibe la
    // identidad del actor como parametros, para no depender de una segunda
    // lectura de sesion al autorizar una escritura.
    assert.match(migracion, /when p_rol = 'superadmin' then true/);
    assert.match(migracion, /when p_rol = 'gerencia' then public\.puede_ver_tenant\(p_tenant\)/);
    assert.match(migracion, /when p_rol = 'administracion' then p_actor_tenant = p_tenant/);
  });

  test("operaciones, control_vuelo y externos caen en el else (false)", () => {
    // La rama `else false` es la negacion por defecto de la matriz. Hay tres
    // funciones con `case` por rol: ver, crear y cambiar responsable.
    const falsos = (migracion.match(/else\s+false\s+end/g) ?? []).length;
    assert.ok(falsos >= 2, `solo ${falsos} cierres 'else false'; se esperan ver y cambiar responsable`);
    // Y el rol que no pertenece al modulo se corta en `crm_lead_actor()`, que es
    // la primera puerta de toda escritura ahora que la RLS no autoriza.
    assert.match(migracion, /if actor_rol not in \('superadmin', 'gerencia', 'administracion', 'venta'\) then/);
  });

  test("el responsable debe existir, estar activo, ser comercial y del mismo tenant", () => {
    assert.match(migracion, /u\.rol in \('gerencia', 'administracion', 'venta'\)/);
    assert.match(migracion, /u\.activo is true/);
    // El aislamiento entre agencias: sin esto, gerencia de una agencia podría
    // dejar un lead en manos de un asesor de la otra.
    assert.match(migracion, /u\.tenant = p_tenant/);
    assert.match(
      migracion,
      /function public\.crm_lead_responsable_valido\(p_usuario uuid, p_tenant text\)/,
      "el validador recibe el tenant del lead",
    );
    // Y se exige en los DOS caminos: al crear y al actualizar.
    assert.match(migracion, /public\.crm_lead_responsable_valido\(p_responsable, p_tenant\)\s*\n\s*and public\.crm_lead_permite_ver/);
    assert.match(migracion, /if not public\.crm_lead_responsable_valido\(v_responsable, v_actual\.tenant\) then/);
  });

test("la carrera al tomar un lead la resuelve el WHERE, no un chequeo previo", () => {
  // Un `select` seguido de un `update` dejaría pasar a dos asesores a la vez:
  // ambos verían `responsable_id is null`. La condición va en el propio UPDATE,
  // que se serializa con el bloqueo de fila.
  assert.match(migracion, /and responsable_id is null\s*\n\s*and public\.crm_lead_permite_cambiar_responsable\(/);
  assert.match(migracion, /get diagnostics v_filas = row_count;\s*\n\s*\n\s*if v_filas = 0 then\s*\n\s*raise exception 'Ese lead ya tiene responsable o no te corresponde\.'/);
});

// ---------------------------------------------------------------------------
// Escrituras cerradas. `authenticated` solo lee: si tuviera DML podría editar un
// lead sin dejar actividad y escribir en la bitacora con un `actor_email` falso.
// Las RPC pasan a ser la única vía, lo que las obliga a ser SECURITY DEFINER y a
// validar al actor por su cuenta en vez de apoyarse en la RLS.
// ---------------------------------------------------------------------------

describe("CRM leads MVP: las escrituras solo entran por las RPC", () => {
  const RPC = [
    "crm_lead_crear",
    "crm_lead_actualizar",
    "crm_lead_tomar",
    "crm_lead_cambiar_etapa",
    "crm_lead_registrar_actividad",
  ];

  function cuerpo(nombre: string): string {
    const desde = migracion.indexOf(`function public.${nombre}(`);
    assert.ok(desde > 0, `no se encuentra ${nombre}`);
    const fin = migracion.indexOf("\n$$;", desde);
    return migracion.slice(desde, fin);
  }

  test("authenticated solo tiene SELECT sobre las dos tablas", () => {
    assert.match(
      migracion,
      /grant select on table public\.crm_leads to authenticated;/,
    );
    assert.match(
      migracion,
      /grant select on table public\.crm_lead_actividades to authenticated;/,
    );
    // Un `grant ... insert, update, delete` volvería a abrir la puerta.
    assert.doesNotMatch(
      migracion,
      /grant (select, )?insert[^\n]*on table public\.crm_lead/,
      "no se debe conceder INSERT directo en las tablas del CRM",
    );
    assert.match(
      migracion,
      /revoke insert, update, delete on table public\.crm_leads from authenticated;/,
    );
    assert.match(
      migracion,
      /revoke insert, update, delete on table public\.crm_lead_actividades from authenticated;/,
    );
    // Las secuencias solo las necesitan las RPC.
    assert.match(migracion, /revoke all on sequence public\.crm_leads_id_seq from anon, authenticated;/);
  });

  test("las únicas policies son de lectura (fail-closed si alguien restituye algo)", () => {
    assert.doesNotMatch(migracion, /create policy "crm_leads: insertar"/);
    assert.doesNotMatch(migracion, /create policy "crm_leads: actualizar"/);
    assert.doesNotMatch(migracion, /create policy "crm_lead_actividades: insertar"/);
    // El flag `s` no está disponible en el target de tsconfig: se comprueba por
    // partes, que además da un mensaje de fallo más claro.
    assert.match(migracion, /create policy "crm_leads: lectura"[\s\S]{0,120}?for select to authenticated/);
    assert.match(migracion, /create policy "crm_lead_actividades: lectura"[\s\S]{0,120}?for select to authenticated/);
  });

  test("las cinco RPC son SECURITY DEFINER con search_path fijo", () => {
    for (const fn of RPC) {
      const c = cuerpo(fn);
      assert.match(c, /security definer/, `${fn} no es SECURITY DEFINER`);
      assert.match(c, /set search_path = public, pg_temp/, `${fn} no fija el search_path`);
    }
  });

  test("cada RPC valida al actor antes de escribir: usuario activo y rol permitido", () => {
    for (const fn of RPC) {
      assert.match(cuerpo(fn), /crm_lead_actor\(\)/, `${fn} no valida al actor`);
    }
    assert.match(
      cuerpo("crm_lead_actor"),
      /u\.activo is true/,
      "crm_lead_actor debe exigir usuario activo",
    );
    assert.match(
      cuerpo("crm_lead_actor"),
      /'superadmin', 'gerencia', 'administracion', 'venta'/,
      "crm_lead_actor debe listar los roles del modulo",
    );
    // Sin esto, un JWT vigente de un rol fuera del modulo entraria por la RPC.
    assert.match(cuerpo("crm_lead_actor"), /raise exception 'Tu rol no tiene acceso a los leads del CRM\.'/);
    assert.match(cuerpo("crm_lead_actor"), /raise exception 'Sesion no valida/);
  });

  test("cada RPC comprueba visibilidad y transicion por su cuenta", () => {
    // SECURITY DEFINER ignora la RLS: si la RPC no lo comprueba, la RLS tampoco
    // está protegiendo nada en las escrituras.
    for (const fn of ["crm_lead_actualizar", "crm_lead_cambiar_etapa", "crm_lead_registrar_actividad"]) {
      assert.match(cuerpo(fn), /crm_lead_permite_ver\(/, `${fn} no comprueba visibilidad`);
    }
    // `crear` valida el alta con `crm_lead_permite_crear`, que es la matriz de
    // lectura mas la validez del responsable: no hay lead que leer todavia.
    assert.match(
      cuerpo("crm_lead_crear"),
      /public\.crm_lead_permite_crear\(v_tenant, v_responsable, v_actor\.actor_id, v_actor\.actor_rol, v_actor\.actor_tenant\)/,
      "crm_lead_crear no comprueba tenant ni responsable",
    );
    assert.match(
      migracion,
      /select public\.crm_lead_responsable_valido\(p_responsable, p_tenant\)\s*\n\s*and public\.crm_lead_permite_ver\(/,
      "crm_lead_permite_crear debe combinar responsable valido y visibilidad",
    );
    // `tomar` no tiene lectura previa: valida dentro del propio WHERE.
    const tomar = cuerpo("crm_lead_tomar");
    assert.match(tomar, /crm_lead_permite_ver\(/, "crm_lead_tomar no comprueba el tenant");
    assert.match(tomar, /crm_lead_permite_cambiar_responsable\(/, "crm_lead_tomar no comprueba la transición");
    // Y tomar no es una excepción a la regla del responsable: superadmin y
    // gerencia tienen alcada transversal y las dos comprobaciones de arriba les
    // dan verde, así que sin esta tercera se quedarían como responsables de un
    // lead de la otra agencia.
    assert.match(
      tomar,
      /and public\.crm_lead_responsable_valido\(v_actor\.actor_id, tenant\);/,
      "crm_lead_tomar debe exigir que el actor sea responsable valido del tenant del lead",
    );
  });

  test("actualizar y cambiar etapa bloquean la fila antes de leer el estado actual", () => {
    // Sin el candado, dos ediciones concurrentes leerían un "antes" obsoleto y
    // un asesor podría tocar un lead que otro acaba de tomar.
    for (const fn of ["crm_lead_actualizar", "crm_lead_cambiar_etapa", "crm_lead_registrar_actividad"]) {
      const c = cuerpo(fn);
      assert.match(c, /for update/, `${fn} no bloquea la fila`);
      // Y el candado va ANTES de la comprobación de permisos, no después.
      const bloqueo = c.indexOf("for update");
      const permisos = c.indexOf("crm_lead_permite_ver");
      assert.ok(bloqueo > 0 && permisos > bloqueo, `${fn} comprueba permisos antes de bloquear`);
    }
  });

  test("la cabecera describe lo que la migracion hace, no lo que hacia antes", () => {
    // La cabecera es lo primero que lee quien revisa. Si sigue diciendo
    // SECURITY INVOKER,_busca la RLS autorizando escrituras y no la encuentra.
    assert.doesNotMatch(migracion, /Las funciones son SECURITY INVOKER/);
    assert.match(migracion, /Las funciones son SECURITY DEFINER/);
    assert.match(
      migracion,
      /`authenticated` SOLO LEE las dos tablas/,
      "la cabecera debe decir que el DML directo esta cerrado",
    );
    // Y que el permiso ya no es lo que autoriza las escrituras.
    assert.match(migracion, /la RLS sigue protegiendo la LECTURA/);
  });

  test("los helpers con datos personales no son ejecutables por authenticated", () => {
    // `crm_lead_email_de` devolvía el correo de cualquier usuario: con EXECUTE
    // abierto era un directorio de correos de todas las agencias.
    for (const helper of [
      "crm_lead_actor()",
      "crm_lead_email_de(uuid)",
      "crm_lead_responsable_valido(uuid, text)",
      "crm_lead_permite_ver(text, uuid, uuid, text, text)",
      "crm_lead_permite_crear(text, uuid, uuid, text, text)",
      "crm_lead_permite_cambiar_responsable(text, uuid, uuid, uuid, text, text)",
      "crm_lead_duplicado_id(text, text, text, bigint, uuid, text, text)",
      "crm_lead_coincidencias(text, text, text, text, text, bigint, uuid, text, text)",
      "crm_lead_tipo_doc_validado(text, text)",
    ]) {
      assert.match(
        migracion,
        new RegExp(`revoke all on function public\\.${helper.replace(/[()]/g, "\\$&")} from public, anon, authenticated;`),
        `${helper} sigue ejecutable por authenticated`,
      );
    }
    // El único helper abierto es el de lectura, que necesitan las policies.
    assert.match(
      migracion,
      /revoke all on function public\.crm_lead_puede_ver\(text, uuid\) from public, anon;/,
    );
    assert.match(
      migracion,
      /grant execute on function public\.crm_lead_puede_ver\(text, uuid\) to authenticated;/,
    );
    // Y la función que exponía el correo de cualquiera desaparece por completo.
    assert.doesNotMatch(migracion, /function public\.crm_lead_responsable_email\(/);
    assert.match(postcheck, /crm_lead_responsable_email\(uuid\) ya no existe/);
  });
});

test("ninguna operacion devuelve exito si su UPDATE afecta cero filas", () => {
  for (const fn of [
    "crm_lead_actualizar",
    "crm_lead_tomar",
    "crm_lead_cambiar_etapa",
    "crm_lead_registrar_actividad",
  ]) {
    assert.ok(migracion.includes(`function public.${fn}(`), `falta ${fn}`);
  }
  const conteos = (migracion.match(/get diagnostics v_filas = row_count;/g) ?? []).length;
  assert.equal(conteos, 4, "las cuatro funciones que actualizan miran row_count");
  const ceros = (migracion.match(/if v_filas = 0 then/g) ?? []).length;
  assert.equal(ceros, 4, "las cuatro convierten cero filas en error");
});

test("la bitacora se escribe dentro de la misma funcion que el cambio", () => {
  // Es la garantia de coherencia del PR: si la bitacora falla, el cambio tampoco
  // queda, porque comparten transaccion.
  const inserts = (migracion.match(/insert into public\.crm_lead_actividades/g) ?? []).length;
  assert.equal(inserts, 5, "los cinco caminos de escritura (crear, editar, tomar, etapa, actividad) escriben bitacora dentro de su RPC");
  // Y ningun evento se inserta dos veces: los de reasignacion y cambio de etapa
  // estan condicionados a que el dato haya cambiado de verdad.
  assert.match(migracion, /if v_responsable is distinct from v_actual\.responsable_id then/);
  assert.match(migracion, /if v_actual\.etapa = v_etapa then/);
});

test("el rollback se niega con datos y solo retira objetos propios", () => {
  // Con leads cargados se niega ANTES de tocar nada: la bitacora comercial es
  // el unico registro de esos contactos y un `cascade` la destruiria en silencio.
  assert.match(rollback, /Rollback 202 cancelado: crm_leads tiene % lead\(s\)/);
  assert.match(rollback, /v_leads > 0 then/);
  assert.match(rollback, /v_actividades > 0 then/);
  // La guarda va antes de cualquier `drop`.
  const guarda = rollback.indexOf("Rollback 202 cancelado");
  const primerDrop = rollback.indexOf("drop trigger if exists trg_auditoria");
  assert.ok(guarda > 0 && primerDrop > guarda, "la guarda de datos va antes del primer drop");

  // Y no se lleva por delante objetos ajenos: sin CASCADE, y con `if exists`
  // solo sobre las dos tablas del CRM y sus funciones `crm_lead_*`.
  assert.doesNotMatch(rollback, /drop table if exists public\.crm_leads cascade/);
  assert.doesNotMatch(rollback, /drop table if exists public\.crm_lead_actividades cascade/);
  const dropsDeTabla = [...rollback.matchAll(/drop table if exists (public\.[a-z_]+)/g)].map((m) => m[1]);
  assert.deepEqual(dropsDeTabla, ["public.crm_lead_actividades", "public.crm_leads"]);
  const dropsDeFuncion = [...rollback.matchAll(/drop function if exists (public\.[a-z_]+)/g)].map((m) => m[1]);
  for (const fn of dropsDeFuncion) {
    assert.match(fn, /^public\.crm_lead/, `${fn} no es del CRM`);
  }
  assert.ok(dropsDeFuncion.length >= 20, `solo ${dropsDeFuncion.length} funciones retiradas`);
});

test("la auditoria generica solo se instala en las dos tablas del CRM", () => {
  // El bucle sobre `pg_tables` de la 087 colgaba trg_auditoria de TODO public,
  // incluidos los historiales inmutables de la 203.
  assert.doesNotMatch(migracion, /from pg_tables/, "no se recorren todas las tablas de public");
  assert.doesNotMatch(migracion, /for r in[\s\S]{0,200}pg_tables/);
  const drops = (migracion.match(/drop trigger if exists trg_auditoria on public\.crm_leads;/g) ?? []).length;
  const ACTIVIDADES = (migracion.match(/drop trigger if exists trg_auditoria on public\.crm_lead_actividades;/g) ?? []).length;
  assert.equal(drops, 1);
  assert.equal(ACTIVIDADES, 1);
  // Y el postcheck deja constancia de que los historiales de la 203 siguen limpios.
  assert.match(postcheck, /los historiales de la 203 siguen SIN triggers propios/);
});

test("RLS habilitado y sin policy de delete", () => {
    assert.match(migracion, /alter table public\.crm_leads enable row level security/);
    assert.match(migracion, /alter table public\.crm_lead_actividades enable row level security/);
    assert.doesNotMatch(migracion, /for delete to authenticated/);
  });

  test("tenant obligatorio e inmutable", () => {
    assert.match(migracion, /tenant text not null default 'mayorista' check \(tenant in \('mayorista', 'minorista'\)\)/);
    assert.match(migracion, /No se puede cambiar el tenant de un lead existente/);
  });
});

// ---------------------------------------------------------------------------
// El MVP no hace una cosa mas de lo pactado.
// ---------------------------------------------------------------------------

describe("CRM leads MVP: alcance cerrado", () => {
  test("no reutiliza crm_contactos ni convierte leads en contactos", () => {
    for (const [nombre, src] of [
      ["acciones", acciones],
      ["lib/crm/leads.ts", catalogos],
      ["migracion", migracion],
      ["bandeja", paginaLista],
      ["detalle", paginaDetalle],
    ] as const) {
      assert.doesNotMatch(src, /from\("crm_contactos"\)/, `${nombre} escribe en crm_contactos`);
      assert.doesNotMatch(src, /insertar_contacto|convertirLead|convertir lead/i, `${nombre} convierte a contacto`);
    }
  });

  test("no toca cotizaciones, contratos ni ventas", () => {
    for (const [nombre, src] of [
      ["acciones", acciones],
      ["migracion", migracion],
      ["bandeja", paginaLista],
      ["detalle", paginaDetalle],
    ] as const) {
      assert.doesNotMatch(src, /from\("cotizaciones"\)|from\("contratos"\)|from\("ventas"\)/, `${nombre} toca ventas`);
    }
  });

  test("sin Meta, API externa, envio de mensajes ni bot", () => {
    const codigo = [acciones, paginaLista, paginaDetalle, catalogos, migracion]
      .join("\n")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ");
    for (const token of [
      "graph.facebook",
      "api.whatsapp",
      "instagram.com",
      "webhook",
      "sendMessage",
      "wamid",
      "openai",
      "anthropic",
    ]) {
      assert.ok(!codigo.toLowerCase().includes(token.toLowerCase()), `aparece ${token}`);
    }
    // `instagram` sí aparece, pero SOLO como origen manual del lead.
    assert.match(catalogos, /CRM_LEAD_CANALES = \["whatsapp", "instagram", "otro"\]/);
  });
});

// ---------------------------------------------------------------------------
// Identidad documental (#351). La identidad es la pareja TIPO + NUMERO: dos
// personas con el mismo numero y distinto tipo NO son duplicadas. Telefono y
// correo pueden compartirse: sugieren, nunca bloquean.
// ---------------------------------------------------------------------------

describe("CRM leads: identidad documental = tipo + numero", () => {
  function cuerpo(nombre: string): string {
    const desde = migracion.indexOf(`function public.${nombre}(`);
    assert.ok(desde > 0, `no se encuentra ${nombre}`);
    return migracion.slice(desde, migracion.indexOf("\n$$;", desde));
  }
  const listaSql = (src: string) => [...src.matchAll(/'([A-Z]+)'/g)].map((m) => m[1]);

  test("la unica unicidad documental es (tenant, numero normalizado, tipo)", () => {
    assert.match(
      migracion,
      /create unique index if not exists uq_crm_leads_tenant_tipo_documento\s*\n\s*on public\.crm_leads \(tenant, documento_norm, tipo_doc\)\s*\n\s*where documento_norm is not null;/,
    );
    // Ningun indice unico con el numero solo, el telefono o el correo.
    const unicos = [...migracion.matchAll(/create unique index[^;]+;/g)].map((m) => m[0]);
    assert.equal(unicos.length, 1, `se esperaba un solo indice unico y hay ${unicos.length}`);
    assert.doesNotMatch(unicos[0], /telefono_norm|email_norm/);
  });

  test("telefono y correo quedan como indices de busqueda, no unicos", () => {
    assert.match(migracion, /create index if not exists idx_crm_leads_tenant_telefono\s*\n\s*on public\.crm_leads \(tenant, telefono_norm\)/);
    assert.match(migracion, /create index if not exists idx_crm_leads_tenant_email\s*\n\s*on public\.crm_leads \(tenant, email_norm\)/);
    assert.doesNotMatch(migracion, /uq_crm_leads_tenant_telefono|uq_crm_leads_tenant_email|uq_crm_leads_tenant_documento\b/);
  });

  test("tipo_doc existe y las reglas documentales viven tambien en el dato (CHECK)", () => {
    assert.match(migracion, /\n {2}tipo_doc text null,\r?\n/);
    assert.match(migracion, /constraint crm_leads_documento_con_tipo\s*\n\s*check \(\(documento is null\) = \(tipo_doc is null\)\)/);
    assert.match(migracion, /constraint crm_leads_documento_normalizable/);
    assert.match(migracion, /constraint crm_leads_tipo_doc_catalogo/);
  });

  test("el catalogo de tipos es el mismo en TS, en el CHECK y en el validador SQL", () => {
    const ts = /CRM_LEAD_TIPOS_DOC = \[([^\]]+)\]/.exec(catalogos)?.[1] ?? "";
    const tiposTs = [...ts.matchAll(/"([A-Z]+)"/g)].map((m) => m[1]);
    assert.ok(tiposTs.length >= 5, "catalogo TS vacio");
    assert.ok(!tiposTs.includes("OTRO"), "un comodin 'OTRO' haria colisionar documentos extranjeros distintos");
    const check = /check \(tipo_doc is null or tipo_doc in \(([^)]+)\)\)/.exec(migracion)?.[1] ?? "";
    assert.deepEqual(listaSql(check), tiposTs, "CHECK y TS difieren");
    const validador = /if v_tipo not in \(([^)]+)\) then/.exec(cuerpo("crm_lead_tipo_doc_validado"))?.[1] ?? "";
    assert.deepEqual(listaSql(validador), tiposTs, "validador SQL y TS difieren");
  });

  test("un numero exige tipo explicito: ni SQL ni TS asumen CC", () => {
    const v = cuerpo("crm_lead_tipo_doc_validado");
    assert.match(v, /raise exception 'Indica el tipo de documento: el numero solo no identifica a la persona\.'/);
    assert.match(v, /raise exception 'Escribe el numero de documento o quita el tipo\.'/);
    assert.doesNotMatch(v, /coalesce\([^)]*'CC'/, "el validador no debe rellenar CC por defecto");
    assert.doesNotMatch(acciones, /tipo_doc: input\.tipoDoc \?\? "CC"|tipoDoc \|\| "CC"/);
    assert.match(catalogos, /error: "Indica el tipo de documento: el numero solo no identifica a la persona\."/);
  });

  test("crear y actualizar validan la pareja y el duplicado compara tipo + numero, nunca telefono/correo", () => {
    for (const fn of ["crm_lead_crear", "crm_lead_actualizar"]) {
      const c = cuerpo(fn);
      assert.match(c, /crm_lead_tipo_doc_validado\(p_datos->>'tipo_doc', v_documento\)/, `${fn} no valida el tipo`);
      assert.match(c, /'coincidencias', public\.crm_lead_coincidencias\(/, `${fn} no devuelve coincidencias`);
      // La validacion documental va DESPUES de autorizar al actor.
      assert.ok(c.indexOf("crm_lead_actor()") < c.indexOf("crm_lead_tipo_doc_validado("), `${fn} valida antes de autorizar`);
    }
    assert.match(cuerpo("crm_lead_crear"), /tenant, canal, nombre, telefono, email, tipo_doc, documento,/);
    assert.match(cuerpo("crm_lead_actualizar"), /tipo_doc {10}= v_tipo_doc,/);
    const dup = cuerpo("crm_lead_duplicado_id");
    assert.match(dup, /l\.documento_norm = p_documento_norm/);
    assert.match(dup, /l\.tipo_doc = p_tipo_doc/);
    assert.match(dup, /l\.id is distinct from p_excluir/, "editar no debe chocar consigo mismo");
    assert.doesNotMatch(dup, /telefono|email/, "telefono y correo ya no son duplicado");
    assert.match(dup, /crm_lead_permite_ver\(/, "el id del duplicado solo se revela si el actor lo ve");
  });

  test("las coincidencias solo listan leads visibles del mismo tenant y excluyen el propio", () => {
    const c = cuerpo("crm_lead_coincidencias");
    assert.match(c, /l\.tenant = p_tenant/);
    assert.match(c, /l\.id is distinct from p_excluir/);
    assert.match(c, /crm_lead_permite_ver\(/);
    assert.match(c, /l\.tipo_doc is distinct from p_tipo_doc/, "el mismo tipo+numero es duplicado, no coincidencia");
  });

  test("la app manda el tipo, valida la entrada antes del viaje y explica el duplicado por documento", () => {
    assert.match(acciones, /tipo_doc: input\.tipoDoc,/);
    // Cada action con SU modo: el alta completa opcionales; la edicion exige las
    // once claves y nunca rellena una ausente con "" (eso borraria datos).
    for (const [fn, modo, tipo] of [
      ["crearLead", "crear", "LeadCrearInput"],
      ["actualizarLead", "editar", "LeadFormularioCompleto"],
    ] as const) {
      const desde = acciones.indexOf(`export async function ${fn}`);
      const c = acciones.slice(desde, acciones.indexOf("export async function", desde + 10));
      assert.ok(c.includes(`input: ${tipo})`), `${fn} no tipa su entrada como ${tipo}`);
      const valida = c.indexOf(`validarEntradaLead(input, "${modo}")`);
      assert.ok(valida > 0 && valida < c.indexOf("sb.rpc("), `${fn} no valida la entrada antes de la RPC`);
      assert.ok(c.indexOf("autorizado(perfil)") < valida, `${fn} valida la entrada antes de autorizar`);
      assert.match(c, /datosLead\(entrada\.datos/, `${fn} manda la entrada sin validar`);
      assert.match(c, /aviso: avisoDe\(data\)/, `${fn} descarta las coincidencias`);
    }
    // La validacion de entrada incluye la documental.
    assert.match(catalogos, /const doc = validarDocumentoLead\(datos\.tipoDoc, datos\.documento\);/);
    assert.match(acciones, /Ya existe otro lead con ese tipo y numero de documento/);
    assert.doesNotMatch(acciones, /otro lead con ese telefono, correo/, "telefono/correo ya no bloquean");
  });

  test("toda action que recibe un id lo valida antes de la RPC", () => {
    for (const fn of ["actualizarLead", "tomarLead", "cambiarEtapaLead", "agregarActividadLead"]) {
      const desde = acciones.indexOf(`export async function ${fn}`);
      const c = acciones.slice(desde, acciones.indexOf("export async function", desde + 10));
      const valida = c.indexOf("if (!idValido(id))");
      assert.ok(valida > 0 && valida < c.indexOf("sb.rpc("), `${fn} no valida el id`);
    }
  });

  test("el normalizador de tipo es el mismo en TS y en SQL y no limpia tipos mal formados", () => {
    // Misma expresion: siglas con UN punto entre letras y punto final opcional.
    assert.match(catalogos, /const TIPO_DOC_CON_PUNTOS = \/\^\[A-Za-z\]\+\(\\\.\[A-Za-z\]\+\)\*\\\.\?\$\/;/);
    const fn = migracion.slice(migracion.indexOf("function public.crm_lead_normalizar_tipo_doc("));
    const cuerpoFn = fn.slice(0, fn.indexOf("\n$$;"));
    assert.ok(cuerpoFn.includes("when v ~ '^[A-Za-z]+(\\.[A-Za-z]+)*\\.?$' then upper(replace(v, '.', ''))"),
      "el SQL no usa la misma expresion");
    assert.ok(cuerpoFn.includes("else upper(v)"), "un tipo mal formado debe salir sin limpiar");
    // Lo que convertia "CC2" en "CC": borrar todo lo que no fuera letra.
    assert.doesNotMatch(cuerpoFn, /regexp_replace\(/);
    assert.doesNotMatch(catalogos, /replace\(\/\[\^A-Za-z\]\/g/);
  });

  test("crm_lead_actualizar exige el formulario completo antes de bloquear y la app manda esas claves", () => {
    const desde = migracion.indexOf("function public.crm_lead_actualizar(");
    const c = migracion.slice(desde, migracion.indexOf("\n$$;", desde));
    const lista = /v_claves {5}text\[\] := array\[([^\]]+)\]/.exec(c)?.[1] ?? "";
    const claves = [...lista.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    assert.equal(claves.length, 11, "se esperan las once claves editables");
    // Las mismas que arma `datosLead` en la app (salvo `tenant`, que solo usa el alta).
    const datos = acciones.slice(acciones.indexOf("function datosLead("));
    const cuerpoDatos = datos.slice(0, datos.indexOf("\n}\n"));
    const enviadas = [...cuerpoDatos.matchAll(/^ {4}([a-z_]+)[:,]/gm)].map((m) => m[1]).filter((k) => k !== "tenant").sort();
    assert.deepEqual(enviadas, claves, "la app y la RPC no coinciden en las claves del formulario");
    // Y el rechazo ocurre antes de tocar la fila.
    const incompleto = c.indexOf("crm_lead_payload_incompleto: faltan");
    const invalido = c.indexOf("crm_lead_payload_invalido:");
    const bloqueo = c.indexOf("for update");
    assert.ok(incompleto > 0 && invalido > incompleto && bloqueo > invalido, "el payload se valida despues de bloquear");
    assert.ok(c.indexOf("crm_lead_actor()") < incompleto, "el actor se autoriza antes del payload");
    // El cast a uuid llega despues de comprobar que es texto.
    assert.ok(c.indexOf("v_responsable := ") > invalido, "el cast del responsable va antes de validar el payload");
    assert.match(acciones, /crm_lead_payload_\(\?:incompleto\|invalido\)/, "la app no traduce el rechazo de payload");
  });

  test("bandeja y ficha piden el tipo sin preseleccionar CC y leen tipo_doc", () => {
    for (const [nombre, src, defecto] of [
      ["bandeja", bandejaCliente, 'defaultValue=""'],
      ["ficha", detalleCliente, 'defaultValue={lead.tipo_doc ?? ""}'],
    ] as const) {
      assert.ok(src.includes(`<select name="tipoDoc" aria-label="Tipo de documento" ${defecto}`), `${nombre} preselecciona un tipo`);
      assert.match(src, /<option value="">Tipo doc\.<\/option>/, `${nombre} sin opcion vacia`);
      assert.match(src, /CRM_LEAD_TIPOS_DOC\.map/, `${nombre} no usa el catalogo`);
      assert.match(src, /tipoDoc: String\(formData\.get\("tipoDoc"\)/, `${nombre} no envia el tipo`);
      assert.match(src, /tipo_doc: string \| null;/, `${nombre} no tipa tipo_doc`);
      assert.match(src, /data-testid="aviso-coincidencias"/, `${nombre} no muestra el aviso`);
    }
    for (const [nombre, src] of [["bandeja", paginaLista], ["detalle", paginaDetalle]] as const) {
      assert.match(src, /email, tipo_doc, documento/, `${nombre} no lee tipo_doc`);
    }
    assert.match(tipos, /tipo_doc: string \| null; documento: string \| null;/);
  });
});

test("validarEntradaLead en modo editar rechaza claves ausentes ANTES de completar con vacios", () => {
  const fn = catalogos.slice(catalogos.indexOf("export function validarEntradaLead("));
  const rechazo = fn.indexOf('if (modo === "editar")');
  const relleno = fn.indexOf('datos[campo] = ""');
  assert.ok(rechazo > 0 && relleno > rechazo, "la edicion debe rechazar ausentes antes del relleno con vacios");
  assert.match(fn, /!Object\.prototype\.hasOwnProperty\.call\(crudo, campo\) \|\| crudo\[campo\] === undefined/);
});
