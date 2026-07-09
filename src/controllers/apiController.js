const { generateRandomPrefix } = require('../utils/nameGenerator');
const imapService = require('../services/imapService');

function getAvailableDomains() {
    const domainsEnv = process.env.AVAILABLE_DOMAINS;
    if (domainsEnv) {
        return domainsEnv.split(',').map(d => d.trim()).filter(d => d.length > 0);
    }
    // Fallback to default if not configured
    return ['milmil.web.id'];
}

async function createEmail(req, res) {
    const availableDomains = getAvailableDomains();
    const domainName = req.query.domain || availableDomains[0];
    const customUser = req.query.username;

    if (!domainName) {
        return res.status(500).json({ error: "No domain configured." });
    }

    // Validate domain is in allowed list
    if (!availableDomains.includes(domainName)) {
        return res.status(400).json({
            error: `Domain ${domainName} is not available. Available domains: ${availableDomains.join(', ')}`
        });
    }

    let prefix;
    if (customUser) {
        // Validation: letters, numbers, dots, hyphens, underscores
        if (!/^[a-zA-Z0-9._-]+$/.test(customUser)) {
            return res.status(400).json({ error: "Invalid username format. Use letters, numbers, dot, underscore or hyphen." });
        }
        prefix = customUser;
    } else {
        prefix = generateRandomPrefix();
    }

    const tempEmail = `${prefix}@${domainName}`;

    return res.json({ email: tempEmail, expires_at: null });
}

async function listEmails(req, res) {
    res.json({ generated_emails: [] });
}

async function deleteEmail(req, res) {
    const emailToRemove = req.query.email;
    return res.json({ message: `Successfully removed ${emailToRemove}` });
}

async function getMessages(req, res) {
    const tempEmail = req.query.email;

    if (!tempEmail) {
        return res.status(400).json({ error: "Missing email parameter" });
    }

    const { messages, error } = await imapService.fetchImapMessages(tempEmail);

    if (error) {
        return res.status(500).json({ error: error });
    }

    res.json({ messages: messages });
}

async function getDomains(req, res) {
    const domains = getAvailableDomains();
    res.json({ domains: domains });
}

module.exports = { createEmail, listEmails, deleteEmail, getMessages, getDomains };
