// Descarga TODOS los archivos de Supabase Storage (todos los buckets) a una
// carpeta local, conservando la estructura (bucket/carpeta/archivo). Sirve para
// respaldar a Drive/disco sin pagar plan Pro.
//
// Uso:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node supabase/scripts/respaldo-storage.mjs [carpeta_destino]
//
// (También lee NEXT_PUBLIC_SUPABASE_URL si SUPABASE_URL no está.)

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

const URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error("Falta SUPABASE_URL (o NEXT_PUBLIC_SUPABASE_URL) y/o SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const sb = createClient(URL, KEY, { auth: { persistSession: false } });
const OUT = process.argv[2] || `respaldo_storage_${new Date().toISOString().slice(0, 10)}`;

async function listarTodo(bucket, prefijo = "") {
  const archivos = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await sb.storage.from(bucket).list(prefijo, { limit: 100, offset });
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const item of data) {
      const full = prefijo ? `${prefijo}/${item.name}` : item.name;
      if (item.id === null) archivos.push(...(await listarTodo(bucket, full))); // carpeta
      else archivos.push(full);
    }
    if (data.length < 100) break;
    offset += 100;
  }
  return archivos;
}

async function main() {
  const { data: buckets, error } = await sb.storage.listBuckets();
  if (error) throw error;
  let total = 0;
  for (const b of buckets) {
    const archivos = await listarTodo(b.name);
    console.log(`Bucket "${b.name}": ${archivos.length} archivo(s)`);
    for (const f of archivos) {
      const { data, error: e } = await sb.storage.from(b.name).download(f);
      if (e || !data) { console.warn(`  ! ${f}: ${e?.message ?? "error"}`); continue; }
      const dest = path.join(OUT, b.name, f);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, Buffer.from(await data.arrayBuffer()));
      total++;
    }
  }
  console.log(`✅ ${total} archivo(s) descargado(s) en: ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
