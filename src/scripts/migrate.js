// Ejecuta las migraciones SQL contra Supabase
// node src/scripts/migrate.js

require('dotenv').config();
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

if (!process.env.SUPABASE_DB_HOST || !process.env.SUPABASE_DB_PASSWORD) {
  console.error('Faltan variables SUPABASE_DB_HOST y SUPABASE_DB_PASSWORD en .env');
  process.exit(1);
}

const client = new Client({
  host: process.env.SUPABASE_DB_HOST,
  port: parseInt(process.env.SUPABASE_DB_PORT || '5432'),
  database: 'postgres',
  user: process.env.SUPABASE_DB_USER || 'postgres',
  password: process.env.SUPABASE_DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
});

const SQL_DIR = path.join(__dirname, '../../sql');
const files = ['001_schema.sql', '002_slots_seed.sql'];

async function run() {
  await client.connect();
  console.log('✅ Conectado a Supabase PostgreSQL');

  for (const file of files) {
    const sqlPath = path.join(SQL_DIR, file);
    const sql = fs.readFileSync(sqlPath, 'utf8');
    console.log(`\n▶ Ejecutando ${file}...`);
    try {
      await client.query(sql);
      console.log(`✅ ${file} ejecutado correctamente`);
    } catch (err) {
      console.error(`❌ Error en ${file}:`, err.message);
      throw err;
    }
  }

  // Verificar slots creados
  const { rows } = await client.query(
    'SELECT fecha, franja, COUNT(*) as total FROM gpmd_slots GROUP BY fecha, franja ORDER BY fecha, franja'
  );
  console.log('\n📅 Slots creados:');
  rows.forEach(r => console.log(`   ${r.fecha} ${r.franja}: ${r.total} slots`));

  await client.end();
  console.log('\n✅ Migraciones completadas');
}

run().catch(err => { console.error(err); process.exit(1); });
