const express = require('express');
const path = require('path');
require('dotenv').config();

// Check Environment Variables
const requiredEnv = ['AVAILABLE_DOMAINS', 'IMAP_USER', 'IMAP_PASSWORD', 'IMAP_SERVER'];
const missingEnv = requiredEnv.filter(key => !process.env[key]);

if (missingEnv.length > 0) {
    console.error("⚠️  MISSING ENV VARS:", missingEnv.join(", "));
    console.error("Please create a .env file with these variables.");
}

// Import Routes
const apiRoutes = require('./src/routes/apiRoutes');

const app = express();
const PORT = process.env.PORT || 6020;

// Middleware
app.use(express.static('public'));

// Routes
app.use('/api', apiRoutes);

// Catch-all for frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
app.listen(PORT, () => {
});
