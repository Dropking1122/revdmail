const express = require('express');
const path = require('path');
require('dotenv').config();

// Check Environment Variables
const requiredEnv = ['AVAILABLE_DOMAINS', 'IMAP_USER', 'IMAP_PASSWORD', 'IMAP_SERVER'];
const missingEnv = requiredEnv.filter(key => !process.env[key]);

if (missingEnv.length > 0) {
    console.warn("⚠️  MISSING ENV VARS:", missingEnv.join(", "));
    console.warn("Please set these variables in your environment or .env file.");
}

// Import Routes
const apiRoutes = require('./src/routes/apiRoutes');

const app = express();
const PORT = process.env.PORT || 5000;
const HOST = '0.0.0.0';

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Routes
app.use('/api', apiRoutes);

// Catch-all for frontend (Express 5 requires explicit wildcard param)
app.get('/{*path}', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
app.listen(PORT, HOST, () => {
    console.log(`✅ Server running at http://${HOST}:${PORT}`);
});
