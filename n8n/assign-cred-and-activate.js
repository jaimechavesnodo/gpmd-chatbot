// Asigna la credencial Postgres "Supabase GPMD" a todos los nodos Postgres
// de los 7 workflows GPMD y los activa, vía la API pública de n8n.
//
// Uso:
//   N8N_URL="https://n8n-content-creation-nodo-n8n.5szgix.easypanel.host" \
//   N8N_API_KEY="eyJ..." \
//   CRED_ID="<id-de-la-credencial-Supabase-GPMD>" \
//   node n8n/assign-cred-and-activate.js

const N8N_URL = (process.env.N8N_URL || '').replace(/\/$/, '');
const API_KEY = process.env.N8N_API_KEY;
const CRED_ID = process.env.CRED_ID;
const CRED_NAME = 'Supabase GPMD';

if (!N8N_URL || !API_KEY || !CRED_ID) {
  console.error('Faltan variables: N8N_URL, N8N_API_KEY, CRED_ID');
  process.exit(1);
}

const headers = { 'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json' };

async function api(method, path, body) {
  const res = await fetch(`${N8N_URL}/api/v1${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  return json;
}

async function main() {
  // 1. Listar workflows y filtrar los GPMD (no archivados)
  const list = await api('GET', '/workflows?limit=250');
  const all = (list.data || list).filter(w => /^wf-gpmd-/.test(w.name));
  const wfs = all.filter(w => !w.isArchived);
  console.log(`Encontrados ${all.length} workflows GPMD (${all.length - wfs.length} archivados se omiten)`);

  for (const wfMeta of wfs) {
    const wf = await api('GET', `/workflows/${wfMeta.id}`);
    let touched = 0;

    for (const node of wf.nodes) {
      if (node.type === 'n8n-nodes-base.postgres') {
        node.credentials = { postgres: { id: CRED_ID, name: CRED_NAME } };
        touched++;
      }
    }

    try {
      // PUT requiere solo name, nodes, connections, settings
      const payload = {
        name: wf.name,
        nodes: wf.nodes,
        connections: wf.connections,
        settings: wf.settings || { executionOrder: 'v1' },
      };
      await api('PUT', `/workflows/${wf.id}`, payload);
      console.log(`  ✓ ${wf.name}: ${touched} nodo(s) Postgres asignados`);

      await api('POST', `/workflows/${wf.id}/activate`);
      console.log(`    → activado`);
    } catch (e) {
      console.log(`  ⚠ ${wf.name}: ${e.message}`);
    }
  }

  console.log('\nListo.');
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
