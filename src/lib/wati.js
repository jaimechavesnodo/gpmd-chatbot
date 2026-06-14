const fetch = require('node-fetch');

const BASE_URL = process.env.WATI_API_URL;
const TOKEN = process.env.WATI_API_TOKEN;

const headers = () => ({
  'Authorization': `Bearer ${TOKEN}`,
  'Content-Type': 'application/json',
});

async function sendTemplateMessage(phone, templateName, params = []) {
  const res = await fetch(`${BASE_URL}/api/v1/sendTemplateMessages`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      template_name: templateName,
      broadcast_name: `gpmd_${Date.now()}`,
      receivers: [{ whatsappNumber: phone, customParams: params }],
    }),
  });
  return res.json();
}

async function sendSessionMessage(phone, message) {
  const res = await fetch(`${BASE_URL}/api/v1/sendSessionMessage/${phone}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ messageText: message }),
  });
  return res.json();
}

async function updateContactAttribute(phone, name, value) {
  const res = await fetch(`${BASE_URL}/api/v1/contacts/attributes`, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify({
      phone,
      customParams: [{ name, value: String(value) }],
    }),
  });
  return res.json();
}

module.exports = { sendTemplateMessage, sendSessionMessage, updateContactAttribute };
