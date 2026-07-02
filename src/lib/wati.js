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

// Enviar botones interactivos nativos de WhatsApp (quick-reply). `whatsappNumber`
// va como query param (no en el path, a diferencia de sendSessionMessage). Cada
// texto de botón debe ser corto (WhatsApp limita a 20 caracteres). Al tocar un
// botón, WhatsApp reenvía su texto como un mensaje normal (tipo texto) al webhook,
// así que se procesa igual que cualquier respuesta con las opciones existentes.
async function sendInteractiveButtons(phone, body, buttonTexts) {
  const url = `${BASE_URL}/api/v1/sendInteractiveButtonsMessage?whatsappNumber=${phone}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ body, buttons: buttonTexts.map((text) => ({ text })) }),
  });
  const data = await res.json().catch(() => ({}));
  if (data.ok === false || data.result === false) console.warn(`[WATI] botones ${phone} →`, JSON.stringify(data).slice(0, 200));
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

// Actualizar atributos (custom fields) del contacto en WATI.
// params: [{ name, value }]. Los atributos deben existir en WATI (Custom Fields).
async function updateContactAttributes(phone, params) {
  const url = `${BASE_URL}/api/v1/updateContactAttributes/${phone}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ customParams: params.map((p) => ({ name: p.name, value: String(p.value) })) }),
  });
  const data = await res.json().catch(() => ({}));
  if (data.result === false) console.warn(`[WATI] atributos ${phone} →`, JSON.stringify(data).slice(0, 200));
  return data;
}

// Descargar media de WATI (requiere auth). Acepta tanto una ruta
// (data/images/xxx.jpg) como una URL completa. Devuelve { buffer, contentType }.
async function downloadMedia(fileName) {
  const fn = String(fileName || '').trim();
  let url;
  if (/^https?:\/\//i.test(fn)) {
    url = fn; // el webhook ya entregó una URL descargable
  } else {
    url = `${BASE_URL}/api/v1/getMedia?fileName=${encodeURIComponent(fn.replace(/^\/+/, ''))}`;
  }
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`getMedia ${res.status} url=${url.slice(0, 120)} body=${body.slice(0, 120)}`);
  }
  const contentType = res.headers.get('content-type') || 'image/jpeg';
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, contentType };
}

module.exports = { sendSessionMessage, sendTemplateMessage, downloadMedia, updateContactAttributes, sendInteractiveButtons };
