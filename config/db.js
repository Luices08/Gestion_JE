const { Pool, types } = require('pg');
require('dotenv').config();

// Parsear BIGINT (oid 20) y NUMERIC (oid 1700) a números de JavaScript
types.setTypeParser(20, val => (val === null ? null : parseInt(val, 10)));
types.setTypeParser(1700, val => (val === null ? null : parseFloat(val)));

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432', 10),
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME     || 'juicios_evaluativos',
  max:      10,
  idleTimeoutMillis: 30000,
});

// Verificar conexión al iniciar
pool.connect()
  .then(client => {
    console.log('✅ Conexión a PostgreSQL establecida');
    client.release();
  })
  .catch(err => {
    console.error('❌ Error al conectar con PostgreSQL:', err.message || err.code || err);
    console.error('   Verifica las variables DB_* en tu archivo .env y que la base de datos exista');
  });

module.exports = pool;
