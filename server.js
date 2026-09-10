const express = require('express');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
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
const PORT = process.env.PORT || 5005;
const HOST = '127.0.0.1';

// Trust first proxy (Nginx) so req.ip and rate-limiting use client IP from X-Forwarded-For
app.set('trust proxy', 1);

// Security headers
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Rate limit the whole API per real client IP
const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false }
});
app.use('/api', apiLimiter);

// Routes
app.use('/api', apiRoutes);

// Explicit 404 for unhandled API endpoints (do not return index.html for API calls)
app.all('/api/{*path}', (req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
});

// Catch-all for frontend (Express 5 requires explicit wildcard param)
app.get('/{*path}', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('Received SIGTERM, shutting down...');
    process.exit(0);
});

// Start Server
app.listen(PORT, HOST, () => {
    console.log(`✅ Server running at http://${HOST}:${PORT}`);
});
