require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rutas API
app.use('/api/auth',      require('./routes/auth'));
app.use('/api/agenda',    require('./routes/agenda'));
app.use('/api/facturas',  require('./routes/facturas'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/log',       require('./routes/log'));
app.use('/api/usuarios',  require('./routes/usuarios'));

// Servir frontend estático
const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));

// SPA fallback — cualquier ruta que no sea API sirve index.html
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`GPMD Backend corriendo en puerto ${PORT}`);
});
