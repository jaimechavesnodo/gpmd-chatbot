// Reconciliación puntual: compara los contactos de WATI marcados como
// "registrado=true" contra las filas actuales de gpmd_participants en
// Supabase, para detectar registros que se perdieron (borrados por error,
// webhook no procesado, etc). No modifica nada, solo reporta.
// Uso: node src/scripts/reconciliar-wati.js
require('dotenv').config();
const supabase = require('../lib/supabase');

const BASE = (process.env.WATI_API_URL || '').replace(/\/$/, '');
const TOKEN = process.env.WATI_API_TOKEN;

async function getContactosRegistrados() {
  let page = 1;
  const registrados = [];
  while (page <= 50) {
    const url = `${BASE}/api/v1/getContacts?pageSize=100&pageNumber=${page}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    const j = await res.json().catch(() => ({}));
    const list = j.contact_list || [];
    if (!list.length) break;
    for (const c of list) {
      const cp = (c.customParams || []).find((p) => p.name === 'registrado');
      if (cp && cp.value === 'true') {
        registrados.push({ phone: c.phone, nombre: c.firstName, lastUpdated: c.lastUpdated });
      }
    }
    if (list.length < 100) break;
    page++;
  }
  return registrados;
}

async function main() {
  const registrados = await getContactosRegistrados();
  const { data: parts } = await supabase.from('gpmd_participants').select('phone');
  const enDB = new Set((parts || []).map((p) => p.phone));

  const huerfanos = registrados
    .filter((r) => !enDB.has(r.phone))
    .sort((a, b) => (a.lastUpdated < b.lastUpdated ? -1 : 1));

  console.log(`WATI contactos con registrado=true: ${registrados.length}`);
  console.log(`Huérfanos (en WATI pero sin fila en Supabase): ${huerfanos.length}\n`);
  for (const h of huerfanos) console.log(`${h.phone}\t${h.nombre}\t${h.lastUpdated}`);
}

main();
