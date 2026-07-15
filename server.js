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
const PORT = process.env.PORT || 5000;
const HOST = '0.0.0.0';

// Security headers. CSP is left off the default helmet policy because this
// page loads Tailwind, Ionicons, DOMPurify, and Google Fonts from external
// CDNs — an unconfigured CSP would just block them. A properly scoped CSP
// should be added when those third-party scripts are pinned/self-hosted.
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Rate limit the whole API — there is no auth in front of any endpoint, so
// this is the main defense against enumeration/abuse (e.g. brute-forcing
// email addresses or hammering the IMAP connection).
const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false
});
app.use('/api', apiLimiter);

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
