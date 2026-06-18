// Sincroniza los workflows desplegados en n8n con los archivos JSON locales.
// Para cada wf-gpmd-*.json local: encuentra el workflow desplegado por nombre,
// reemplaza nodes/connections/settings con la versión local, inyecta el CRED_ID
// real en los nodos Postgres, hace PUT y lo activa.
//
// Uso:
//   N8N_URL="https://..." N8N_API_KEY="eyJ..." CRED_ID="..." \
//   node n8n/sync-from-local.js

const fs = require('fs');
const path = require('path');

const N8N_URL = (process.env.N8N_URL || '').replace(/\/$/, '');
const API_KEY = process.env.N8N_API_KEY;
const CRED_ID = process.env.CRED_ID;
const CRED_NAME = 'Supabase GPMD';

if (!N8N_URL || !API_KEY || !CRED_ID) {
  console.error('Faltan variables: N8N_URL, N8N_API_KEY, CRED_ID');
  process.exit(1);
}

const headers = { 'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json' };

async function api(method, p, body) {
  const res = await fetch(`${N8N_URL}/api/v1${p}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${p} → ${res.status}: ${text}`);
  try { return JSON.parse(text); } catch { return text; }
}

async function main() {
  const dir = path.join(__dirname);
  const localFiles = fs.readdirSync(dir).filter(f => /^wf-gpmd-.*\.json$/.test(f));

  const list = await api('GET', '/workflows?limit=250');
  const deployed = (list.data || list).filter(w => !w.isArchived);

  for (const file of localFiles) {
    const local = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    const match = deployed.find(w => w.name === local.name);
    if (!match) { console.log(`  ⚠ ${local.name}: no encontrado en n8n, omito`); continue; }

    // Inyectar credencial real en nodos Postgres
    let creds = 0;
    for (const node of local.nodes) {
      if (node.type === 'n8n-nodes-base.postgres') {
        node.credentials = { postgres: { id: CRED_ID, name: CRED_NAME } };
        creds++;
      }
    }

    try {
      await api('PUT', `/workflows/${match.id}`, {
        name: local.name,
        nodes: local.nodes,
        connections: local.connections,
        settings: local.settings || { executionOrder: 'v1' },
      });
      await api('POST', `/workflows/${match.id}/activate`);
      console.log(`  ✓ ${local.name}: sincronizado (${creds} cred Postgres) y activado`);
    } catch (e) {
      console.log(`  ⚠ ${local.name}: ${e.message}`);
    }
  }
  console.log('\nListo.');
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
