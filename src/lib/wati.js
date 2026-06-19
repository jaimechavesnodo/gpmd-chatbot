// Helper de WATI (WhatsApp Business) — usa fetch nativo de Node 22+
const BASE_URL = (process.env.WATI_API_URL || '').replace(/\/$/, '');
const TOKEN = process.env.WATI_API_TOKEN;

function authHeaders(extra = {}) {
  return { Authorization: `Bearer ${TOKEN}`, ...extra };
}

// Enviar mensaje de sesión (ventana de 24h). messageText va como QUERY PARAM.
async function sendSessionMessage(phone, message) {
  const url = `${BASE_URL}/api/v1/sendSessionMessage/${phone}?messageText=${encodeURIComponent(message)}`;
  const res = await fetch(url, { method: 'POST', headers: authHeaders() });
  const data = await res.json().catch(() => ({}));
  if (!data.result && data.result !== true && data.ok !== true) {
    console.warn(`[WATI] envío a ${phone} →`, JSON.stringify(data).slice(0, 200));
  }
  return data;
}

// Enviar template (fuera de ventana de 24h)
async function sendTemplateMessage(phone, templateName, params = []) {
  const url = `${BASE_URL}/api/v1/sendTemplateMessage?whatsappNumber=${phone}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      template_name: templateName,
      broadcast_name: `gpmd_${Date.now()}`,
      parameters: params.map((value, i) => ({ name: `${i + 1}`, value: String(value) })),
    }),
  });
  return res.json().catch(() => ({}));
}

// Descargar media de WATI (requiere auth). Devuelve { buffer, contentType }.
async function downloadMedia(fileName) {
  const url = `${BASE_URL}/api/v1/getMedia?fileName=${encodeURIComponent(fileName)}`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) throw new Error(`getMedia ${res.status}`);
  const contentType = res.headers.get('content-type') || 'image/jpeg';
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, contentType };
}

module.exports = { sendSessionMessage, sendTemplateMessage, downloadMedia };
