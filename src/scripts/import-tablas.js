// Importa PDV y productos participantes desde los Excel a Supabase.
// Re-ejecutable (upsert). Uso:
//   node src/scripts/import-tablas.js [carpeta-tablas]
// Por defecto busca en ../tablas-iniciales relativo a la raíz del proyecto.
require('dotenv').config();
const path = require('path');
const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const DIR = process.argv[2] || path.join(__dirname, '..', '..', '..', 'tablas-iniciales');

function rows(file) {
  const wb = XLSX.readFile(path.join(DIR, file));
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { defval: '' });
}

const clean = (v) => String(v == null ? '' : v).trim();
const nitOrNull = (v) => { const s = clean(v); return s && s.toUpperCase() !== 'N/D' ? s : null; };

async function importProductos() {
  const data = rows('productos-participantes.xlsx');
  const out = [];
  for (const r of data) {
    const producto = clean(r['Producto']);
    let pres = clean(r['Presentación'] || r['Presentacion']);
    if (!producto) continue;
    const participa = !/excluido/i.test(pres);
    pres = pres.replace(/\s*\([^)]*excluido[^)]*\)\s*/i, '').trim();
    out.push({ producto, presentacion: pres, participa });
  }
  const { error } = await supabase.from('gpmd_productos').upsert(out, { onConflict: 'producto,presentacion' });
  if (error) throw new Error('productos: ' + error.message);
  console.log(`✓ productos: ${out.length} (${out.filter((p) => p.participa).length} participantes)`);
}

async function importPdv() {
  const data = rows('pdv-participantes.xlsx');
  const out = [];
  for (const r of data) {
    // El "Cliente" es el nombre comercial; el listado final lo llama "Nombre comercial".
    const cliente = clean(r['Cliente'] || r['Nombre comercial']);
    if (!cliente) continue;
    out.push({
      cliente,
      nit: nitOrNull(r['NIT'] || r['Nit']),
      agente: clean(r['Agente'] || r['Agente comercial']) || null,
      departamento: clean(r['Departamento']) || null,
      ciudad: clean(r['Ciudad']) || null,
      canal: clean(r['Canal']) || null,
      razon_social: clean(r['Razon Social'] || r['Razón Social']) || null,
      direccion: clean(r['Dirección'] || r['Direccion']) || null,
    });
  }
  // Deduplicar por (nit, cliente) — el archivo puede traer filas repetidas
  const vistos = new Set();
  const dedup = out.filter((p) => {
    const k = `${p.nit || ''}|${p.cliente}`;
    if (vistos.has(k)) return false;
    vistos.add(k); return true;
  });
  const dups = out.length - dedup.length;

  // Reemplazo total: estos son los PDV finales del proyecto.
  await supabase.from('gpmd_pdv').delete().neq('id', 0);
  let { error } = await supabase.from('gpmd_pdv').insert(dedup);
  if (error && /direccion/i.test(error.message)) {
    // La columna aún no existe (falta correr sql/007_pdv_direccion.sql) — reintenta sin ella.
    console.warn('  ⚠ columna "direccion" no existe todavía; se importa sin direcciones (correr sql/007 y reimportar)');
    ({ error } = await supabase.from('gpmd_pdv').insert(dedup.map(({ direccion, ...rest }) => rest)));
  }
  if (error) throw new Error('pdv: ' + error.message);
  const nits = new Set(dedup.map((p) => p.nit).filter(Boolean));
  console.log(`✓ pdv: ${dedup.length} clientes en ${nits.size} NITs (reemplazo total${dups ? `, ${dups} duplicado(s) omitido(s)` : ''})`);
}

(async () => {
  console.log('Importando desde', DIR);
  await importProductos();
  await importPdv();
  console.log('Listo.');
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
