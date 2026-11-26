require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const db = require('./services/db');
const statusRoute = require('./routes/status');
const tenantAuth = require('./middleware/tenantAuth');
const queryRoute = require('./routes/query');
const documentsRoute = require('./routes/documents');
const acknowledgmentsRoute = require('./routes/acknowledgments');
const adminRoute = require('./routes/admin');
const referentRoute = require('./routes/referent');

const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'bob-api-gateway' });
});

app.get('/health/db', async (req, res) => {
  try {
    const result = await db.query('SELECT 1 AS ok, current_database() AS database');
    res.json({
      status: 'ok',
      db: result.rows[0],
    });
  } catch (err) {
    console.error('Erreur connexion PostgreSQL:', err.message);
    res.status(500).json({
      status: 'error',
      message: 'Database connection failed',
    });
  }
});

app.use('/api', statusRoute);
app.use('/api', referentRoute);
app.use('/api', tenantAuth, queryRoute);
app.use('/api', tenantAuth, documentsRoute);
app.use('/api', tenantAuth, acknowledgmentsRoute);
app.use('/api', tenantAuth, tenantAuth.requireAdminRole, adminRoute);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`BOB API Gateway démarrée sur http://localhost:${PORT}`);
});
