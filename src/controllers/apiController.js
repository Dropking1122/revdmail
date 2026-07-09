const { generateRandomPrefix } = require('../utils/nameGenerator');
const imapService = require('../services/imapService');

function getAvailableDomains() {
    const domainsEnv = process.env.AVAILABLE_DOMAINS;
    if (domainsEnv) {
        return domainsEnv.split(',').map(d => d.trim()).filter(d => d.length > 0);
    }
    return ['milmil.web.id'];
}

async function createEmail(req, res) {
    const availableDomains = getAvailableDomains();
    const domainName = req.query.domain || availableDomains[0];
    const customUser = req.query.username;

    if (!domainName) {
        return res.status(500).json({ error: "No domain configured." });
    }

    if (!availableDomains.includes(domainName)) {
        return res.status(400).json({
            error: `Domain ${domainName} is not available. Available: ${availableDomains.join(', ')}`
        });
    }

    let prefix;
    if (customUser) {
        if (!/^[a-zA-Z0-9._-]+$/.test(customUser)) {
            return res.status(400).json({ error: "Invalid username. Use letters, numbers, dot, underscore or hyphen." });
        }
        prefix = customUser;
    } else {
        prefix = generateRandomPrefix();
    }

    return res.json({ email: `${prefix}@${domainName}`, expires_at: null });
}

async function listEmails(req, res) {
    res.json({ generated_emails: [] });
}

async function deleteEmail(req, res) {
    const emailToRemove = req.query.email;
    if (!emailToRemove) {
        return res.status(400).json({ error: "Missing email parameter" });
    }

    // Enforce allowed domains
    const allowedDomains = getAvailableDomains();
    const emailDomain = emailToRemove.split('@')[1] || '';
    if (!allowedDomains.includes(emailDomain)) {
        return res.status(403).json({ error: `Domain @${emailDomain} is not allowed.` });
    }

    return res.json({ message: `Successfully removed ${emailToRemove}` });
}

async function getMessages(req, res) {
    const tempEmail = req.query.email;

    if (!tempEmail) {
        return res.status(400).json({ error: "Missing email parameter" });
    }

    // Server-side domain enforcement — only serve mail for our own domains
    const allowedDomains = getAvailableDomains();
    const emailDomain = tempEmail.split('@')[1] || '';
    if (!allowedDomains.includes(emailDomain)) {
        return res.status(403).json({ error: `Domain @${emailDomain} is not allowed.` });
    }

    const { messages, error } = await imapService.fetchImapMessages(tempEmail);

    if (error) {
        return res.status(500).json({ error });
    }

    res.json({ messages });
}

async function getDomains(req, res) {
    const domains = getAvailableDomains();
    res.json({ domains });
}

module.exports = { createEmail, listEmails, deleteEmail, getMessages, getDomains };
