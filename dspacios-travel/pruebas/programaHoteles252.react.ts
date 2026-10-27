// Se ejecuta con npm run test:react (loader del arnés + jsdom). NO entra en test:unit.
//
// Programas · migración 252 — la INTERFAZ del editor de hoteles con la Server Action REAL (`guardarHoteles`) y una base simulada que aplica la misma regla de unicidad
// que el índice uq_programa_hoteles_nombre (lower(btrim(nombre)) por programa, con la minúscula de la base: «ΑΣ» y «ασ» son el mismo nombre):
//   · el duplicado que llega a la base se muestra DENTRO del diálogo con el mensaje claro, sin texto de SQL ni nombre de restricción, y el borrador se conserva;
//   · un guardado válido cierra el diálogo y el hotel recién creado toma su id real: el siguiente guardado ya no lo reenvía como NUEVO (lista desactualizada).
// La atomicidad y el orden de las operaciones se prueban contra Postgres real en programaHoteles252.pg.ts.
import { montar, clic, escribir, esperar, usarBD, dom } from "./support/fechaNegocioArnes.ts";
import { test, describe, afterEach, after } from "node:test";
import assert from "node:assert/strict";

const React = await import("react");
const { HotelesVigenciaEditor } = await import("../app/(dashboard)/dashboard/producto/programas/[id]/HotelesVigenciaEditor.tsx");
const h = React.createElement;

const txt = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const PROGRAMA = { moneda: "USD", pct_mk: 0.15, pct_fee_tarjeta: 0.03, asistencia_medica_dia: 4, dias: 4 };
const netosC = (o: Record<string, number | null> = {}) => ({ sencilla: null, doble: null, triple: null, multiple: null, nino: null, ...o });
const dialogo = () => document.querySelector<HTMLElement>('[role="dialog"]');
const boton = (raiz: ParentNode, t: RegExp) => [...raiz.querySelectorAll("button")].find((b) => t.test(txt(b)) || t.test(b.getAttribute("aria-label") ?? "")) as HTMLButtonElement | undefined;
async function elegir(sel: HTMLSelectElement, valor: string) {
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, "value")!.set!.call(sel, valor);
    sel.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
}
const catalogo = {
  hoteles: [{ id: 1, nombre: "Hotel Playa", zona: "Playa", tipoHabitacion: "", maxPaxHabitacion: 4, maxMenoresHabitacion: null, proveedorId: null }],
  base: [{ id: 1, hotelId: 1, desde: "2027-03-01", hasta: "2027-03-31", modalidad: "privado", bajoSolicitud: false, neto: netosC({ doble: 600 }) }],
  noches: [{ id: 1, hotelId: 1, desde: "2027-03-01", hasta: "2027-03-31", unidad: "persona", neto: netosC({ doble: 100 }) }],
};
/** Minúscula de la base: Σ siempre es σ (la de JavaScript pone ς al final de palabra), por eso «ΑΣ» y «ασ» chocan en la base y no en la pantalla. */
const claveBase = (n: string) => n.trim().toLowerCase().replace(/ς/g, "σ").replace(/Σ/g, "σ");

/** Base simulada: aplica la lista como la RPC (ids conservados, nuevos con id nuevo) y rechaza nombres repetidos como el índice único, sin dejar cambios parciales. */
function conBase() {
  const llamadas: { id: number | null; nombre: string }[][] = [];
  let siguiente = 100;
  let guardados = [{ id: 1, orden: 0, nombre: "Hotel Playa" }];
  const bd = usarBD({ usuarios: [{ id: "u-arnes", rol: "administracion" }] }, {
    guardar_programa_hoteles: (args) => {
      const lista = args.p_hoteles as { id: number | null; nombre: string }[];
      llamadas.push(lista.map((x) => ({ id: x.id, nombre: x.nombre })));
      const nuevo = lista.map((x, i) => ({ id: x.id ?? siguiente + i, orden: i, nombre: x.nombre }));
      if (new Set(nuevo.map((x) => claveBase(x.nombre))).size !== nuevo.length) {
        return { __error: { code: "23505", message: 'duplicate key value violates unique constraint "uq_programa_hoteles_nombre"' } };
      }
      siguiente += lista.length + 1;
      guardados = nuevo;
      bd.tablas.set("programa_hoteles", nuevo.map((x) => ({ ...x, programa_id: 3 })));
      const completa = args.p_hoteles as { base: Record<string, unknown>[]; noches: Record<string, unknown>[] }[];
      bd.tablas.set("programa_hotel_precios", completa.flatMap((x, i) => x.base.map((b, j) => ({ id: 1000 + i * 10 + j, hotel_id: nuevo[i].id, ...b }))));
      bd.tablas.set("programa_hotel_noches", completa.flatMap((x, i) => x.noches.map((t, j) => ({ id: 2000 + i * 10 + j, hotel_id: nuevo[i].id, ...t }))));
      return null;
    },
  });
  bd.tablas.set("programa_hoteles", guardados.map((x) => ({ ...x, programa_id: 3 })));
  return { bd, llamadas, guardados: () => guardados };
}

describe("HotelesVigenciaEditor (migración 252)", () => {
  let desmontar: (() => Promise<void>) | undefined;
  afterEach(async () => { await desmontar?.(); desmontar = undefined; });
  after(() => dom.window.close());

  async function agregar(raiz: HTMLElement, nombre: string) {
    await clic(boton(raiz, /Agregar hotel/), "Agregar hotel");
    const d = dialogo()!;
    await escribir(d.querySelector("#hotel-nombre") as HTMLInputElement, nombre);
    await clic(boton(d, /Agregar vigencia de precio base/), "vigencia base");
    const base = d.querySelector(`[aria-label="Vigencia base 1 de ${nombre}"]`) as HTMLElement;
    await escribir(base.querySelector('input[aria-label="Entrada desde"]') as HTMLInputElement, "2027-03-01");
    await escribir(base.querySelector('input[aria-label="Entrada hasta"]') as HTMLInputElement, "2027-03-31");
    await elegir(base.querySelector("select") as HTMLSelectElement, "privado");
    await escribir([...base.querySelectorAll('input[inputmode="decimal"]')][1] as HTMLInputElement, "600");
    await clic(boton(d, /^Guardar$/), "Guardar");
  }

  test("duplicado que llega a la base: el diálogo muestra «Ya existe un hotel con ese nombre en este programa. Usa otro nombre», sin SQL ni restricción, y conserva el borrador", async () => {
    const { llamadas, guardados } = conBase();
    const errores: string[] = [];
    const original = console.error;
    console.error = (...a: unknown[]) => { errores.push(a.join(" ")); };
    try {
      const m = await montar(h(HotelesVigenciaEditor as never, { programaId: 3, programa: PROGRAMA, proveedores: [], catalogo }));
      desmontar = m.desmontar;
      const raiz = m.contenedor as HTMLElement;
      await agregar(raiz, "Hotel ΑΣ");
      await esperar(() => !dialogo());
      assert.equal(dialogo(), null, "el primero se guardó y cerró el diálogo");
      assert.equal(llamadas.length, 1);

      // «ασ» NO es repetido para la pantalla (la minúscula de JavaScript da «ας»), pero sí para la base.
      await agregar(raiz, "Hotel ασ");
      await esperar(() => !!dialogo()?.querySelector('[role="alert"]'));
      const d = dialogo()!;
      assert.equal(txt(d.querySelector('[role="alert"]')), "Ya existe un hotel con ese nombre en este programa. Usa otro nombre");
      assert.doesNotMatch(txt(d), /uq_programa|constraint|duplicate key|violat|23505/i);
      assert.equal((d.querySelector("#hotel-nombre") as HTMLInputElement).value, "Hotel ασ", "el borrador se conserva");
      assert.deepEqual(guardados().map((x) => x.nombre), ["Hotel Playa", "Hotel ΑΣ"], "el fallo no dejó cambios");
      assert.match(errores.join(" | "), /guardarHoteles.*23505|23505.*guardarHoteles/);
      assert.doesNotMatch(errores.join(" | "), /Hotel ΑΣ|Hotel ασ/, "el registro interno no lleva datos del usuario");
    } finally { console.error = original; }
  });

  test("lista desactualizada: el hotel recién guardado toma su id real y el siguiente guardado ya no lo reenvía como NUEVO", async () => {
    const { llamadas } = conBase();
    const m = await montar(h(HotelesVigenciaEditor as never, { programaId: 3, programa: PROGRAMA, proveedores: [], catalogo }));
    desmontar = m.desmontar;
    const raiz = m.contenedor as HTMLElement;
    await agregar(raiz, "Hotel Nuevo");
    await esperar(() => !dialogo());
    assert.deepEqual(llamadas[0].map((x) => [x.nombre, x.id]), [["Hotel Playa", 1], ["Hotel Nuevo", null]]);

    // Segundo guardado en la misma pantalla (sin recargar): editar «Hotel Playa».
    await clic(boton(raiz, /Editar Hotel Playa/), "Editar Hotel Playa");
    const d = dialogo()!;
    await escribir(d.querySelector("#hotel-zona") as HTMLInputElement, "Otra zona");
    await clic(boton(d, /^Guardar$/), "Guardar");
    await esperar(() => llamadas.length > 1 && !dialogo());
    assert.equal(llamadas.length, 2);
    const nuevo = llamadas[1].find((x) => x.nombre === "Hotel Nuevo")!;
    assert.ok(nuevo.id != null && nuevo.id >= 100, "«Hotel Nuevo» viaja con el id que le dio la base, no como alta");
  });
  /** Intercepta las lecturas de `programa_hoteles`: la 1.ª tras el guardado es la de los ids; la 2.ª, la recarga del catálogo. */
  function interceptar(bd: ReturnType<typeof conBase>["bd"], plan: { ids?: "error" | "cuenta"; recarga?: "error" }) {
    const original = bd.sb.from.bind(bd.sb);
    let lecturas = 0;
    (bd.sb as { from: unknown }).from = (tabla: string) => {
      const b = original(tabla) as Record<string, unknown>;
      if (tabla !== "programa_hoteles") return b;
      const proxy: unknown = new Proxy(b, {
        get(o, k) {
          if (k === "then") {
            return (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => new Promise<{ data: unknown[] | null; error: unknown }>((r) => (o.then as (f: (v: never) => void) => void)(r as never))
              .then((r) => {
                const n = lecturas++;
                const modo = n === 0 ? plan.ids : n === 1 ? plan.recarga : undefined;
                if (modo === "error") return { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } };
                if (modo === "cuenta") return { data: (r.data ?? []).slice(0, -1), error: null };
                return r;
              }).then(res, rej);
          }
          const v = Reflect.get(o, k);
          return typeof v === "function" ? (...a: unknown[]) => { const x = (v as (...p: unknown[]) => unknown).apply(o, a); return x === o ? proxy : x; } : v;
        },
      });
      return proxy;
    };
  }
  const filasBD = (bd: ReturnType<typeof conBase>["bd"]) => (bd.tablas.get("programa_hoteles") ?? []) as { id: number; nombre: string }[];
  async function editarPlaya(raiz: HTMLElement) {
    await clic(boton(raiz, /Editar Hotel Playa/), "Editar Hotel Playa");
    const d = dialogo()!;
    await escribir(d.querySelector("#hotel-zona") as HTMLInputElement, "Otra zona");
    await clic(boton(d, /^Guardar$/), "Guardar");
  }

  for (const [caso, plan] of [["falla la lectura de los ids", { ids: "error" }], ["la lectura devuelve una cantidad distinta", { ids: "cuenta" }]] as const) {
    test(`ids no confirmados (${caso}): se guardó, NO se muestra error, el catálogo se recarga y el siguiente guardado envía los ids reales sin duplicar hoteles`, async () => {
      const { llamadas, bd } = conBase();
      interceptar(bd, plan);
      const errores = console.error;
      console.error = () => {};
      try {
        const m = await montar(h(HotelesVigenciaEditor as never, { programaId: 3, programa: PROGRAMA, proveedores: [], catalogo }));
        desmontar = m.desmontar;
        const raiz = m.contenedor as HTMLElement;
        await agregar(raiz, "Hotel Nuevo");
        await esperar(() => !dialogo() && !raiz.querySelector('[data-testid="recargando-hoteles"]'));
        assert.equal(llamadas.length, 1);
        assert.equal(txt(raiz.querySelector('[role="alert"]')), "", "no hay mensaje de error: el guardado ocurrió");
        assert.equal(raiz.querySelectorAll('[data-testid="recarga-fallida-hoteles"]').length, 0);
        const idNuevo = filasBD(bd).find((x) => x.nombre === "Hotel Nuevo")!.id;
        assert.ok(raiz.querySelector('[aria-label="Hotel Hotel Nuevo"]'), "el hotel nuevo está en la lista recargada");

        await editarPlaya(raiz);
        await esperar(() => llamadas.length > 1 && !dialogo());
        assert.equal(llamadas.length, 2);
        const nuevo = llamadas[1].find((x) => x.nombre === "Hotel Nuevo")!;
        assert.equal(nuevo.id, idNuevo, "se envía el id real, no un alta");
        assert.deepEqual(filasBD(bd).filter((x) => x.nombre === "Hotel Nuevo").map((x) => x.id), [idNuevo], "un solo «Hotel Nuevo», con el mismo id (no se reinsertó)");
        assert.equal(filasBD(bd).length, 2);
      } finally { console.error = errores; }
    });
  }

  test("ids no confirmados Y la recarga también falla: aviso claro (sin pedir repetir el guardado), editor bloqueado y ningún guardado posible", async () => {
    const { llamadas, bd } = conBase();
    interceptar(bd, { ids: "error", recarga: "error" });
    const errores = console.error;
    console.error = () => {};
    try {
      const m = await montar(h(HotelesVigenciaEditor as never, { programaId: 3, programa: PROGRAMA, proveedores: [], catalogo }));
      desmontar = m.desmontar;
      const raiz = m.contenedor as HTMLElement;
      await agregar(raiz, "Hotel Nuevo");
      await esperar(() => !!raiz.querySelector('[data-testid="recarga-fallida-hoteles"]'));
      const aviso = txt(raiz.querySelector('[data-testid="recarga-fallida-hoteles"]'));
      assert.match(aviso, /Los cambios se guardaron/);
      assert.match(aviso, /Recarga la página/);
      assert.doesNotMatch(aviso, /intent|vuelve a guardar|repite|error al guardar/i, "no sugiere repetir una escritura que ya ocurrió");
      assert.equal(boton(raiz, /Agregar hotel/)!.disabled, true);
      assert.equal(boton(raiz, /Editar Hotel Playa/)!.disabled, true);
      await clic(boton(raiz, /Editar Hotel Playa/), "Editar bloqueado");
      assert.equal(!!dialogo(), false, "no se puede abrir el editor");
      assert.equal(llamadas.length, 1, "ningún guardado adicional");
      assert.equal(filasBD(bd).filter((x) => x.nombre === "Hotel Nuevo").length, 1);
    } finally { console.error = errores; }
  });
});
