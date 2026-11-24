require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'bob-api-gateway' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`BOB API Gateway démarrée sur http://localhost:${PORT}`);
});
