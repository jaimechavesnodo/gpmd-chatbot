require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

const publicDir = path.join(__dirname, '..', 'public');

// Toda la app vive en un router que se monta tanto en `/` como en
// `/gpmd-chatbot`. Así funciona haga o no "strip path" el proxy (Traefik):
// si lo hace, el contenedor recibe `/...`; si no, recibe `/gpmd-chatbot/...`.
function buildRouter() {
  const r = express.Router();
  r.use('/api/auth',      require('./routes/auth'));
  r.use('/api/agenda',    require('./routes/agenda'));
  r.use('/api/facturas',  require('./routes/facturas'));
  r.use('/api/dashboard', require('./routes/dashboard'));
  r.use('/api/log',       require('./routes/log'));
  r.use('/api/usuarios',  require('./routes/usuarios'));

  // Webhook entrante de WATI (chatbot WhatsApp)
  r.use('/webhook/wati',  require('./routes/wati'));

  // Frontend estático
  r.use(express.static(publicDir));

  // Fallback: cualquier ruta que no sea API sirve index.html
  r.get(/^(?!\/api).*/, (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });
  return r;
}

app.use('/gpmd-chatbot', buildRouter());
app.use('/', buildRouter());

app.listen(PORT, () => {
  console.log(`GPMD Backend corriendo en puerto ${PORT}`);
});
