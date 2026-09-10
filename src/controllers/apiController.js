const { generateRandomPrefix } = require('../utils/nameGenerator');
const imapService = require('../services/imapService');
const { generateGmailVariants } = require('../utils/gmailVariants');

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const USERNAME_REGEX = /^[a-zA-Z0-9._-]+$/;

function getAvailableDomains() {
    const domainsEnv = process.env.AVAILABLE_DOMAINS;
    if (domainsEnv) {
        return domainsEnv.split(',').map(d => d.trim().toLowerCase()).filter(d => d.length > 0);
    }
    return ['milmil.web.id'];
}

function isEmailAllowed(email) {
    if (typeof email !== 'string' || !EMAIL_REGEX.test(email.trim())) {
        return { valid: false, reason: 'Format email tidak valid.' };
    }

    const lower = email.trim().toLowerCase();
    const parts = lower.split('@');
    if (parts.length !== 2) {
        return { valid: false, reason: 'Format email tidak valid.' };
    }

    const [localPart, domain] = parts;
    const isGmail = (domain === 'gmail.com' || domain === 'googlemail.com');

    if (isGmail) {
        const imapUser = (process.env.IMAP_USER || '').toLowerCase().trim();
        const [imapLocal, imapDomain] = imapUser.split('@');

        if (imapDomain !== 'gmail.com' && imapDomain !== 'googlemail.com') {
            return { valid: false, reason: 'Varian Gmail hanya didukung jika IMAP server dikonfigurasi menggunakan Gmail.' };
        }

        // Only allow Gmail variants of the configured IMAP user (strip dots)
        const targetClean = localPart.replace(/\./g, '');
        const serverClean = (imapLocal || '').replace(/\./g, '');
        if (targetClean !== serverClean) {
            return { valid: false, reason: 'Hanya varian Gmail dari alamat sistem yang diizinkan untuk diakses di web ini.' };
        }
        return { valid: true, email: lower };
    }

    const allowedDomains = getAvailableDomains();
    if (!allowedDomains.includes(domain)) {
        return { valid: false, reason: `Domain @${domain} tidak didukung. Domain tersedia: ${allowedDomains.join(', ')}` };
    }

    return { valid: true, email: lower };
}

async function createEmail(req, res) {
    try {
        const availableDomains = getAvailableDomains();
        const rawDomain = req.body?.domain || req.query?.domain || availableDomains[0];
        const rawUser = req.body?.username || req.query?.username;

        const domainName = String(rawDomain || '').trim().toLowerCase();

        if (!domainName) {
            return res.status(500).json({ error: 'Tidak ada domain yang terkonfigurasi.' });
        }

        if (!availableDomains.includes(domainName)) {
            return res.status(400).json({
                error: `Domain @${domainName} tidak tersedia. Domain yang didukung: ${availableDomains.join(', ')}`
            });
        }

        let prefix;
        if (rawUser) {
            const customUser = String(rawUser).trim();
            if (!USERNAME_REGEX.test(customUser)) {
                return res.status(400).json({ error: 'Username hanya boleh berisi huruf, angka, titik, underscore, atau tanda hubung.' });
            }
            if (customUser.length > 64) {
                return res.status(400).json({ error: 'Username terlalu panjang (maksimal 64 karakter).' });
            }
            prefix = customUser;
        } else {
            prefix = generateRandomPrefix();
        }

        const email = `${prefix}@${domainName}`.toLowerCase();
        return res.json({ email, expires_at: null });
    } catch (err) {
        console.error('createEmail error:', err);
        return res.status(500).json({ error: 'Gagal membuat alamat email baru.' });
    }
}

async function deleteEmail(req, res) {
    try {
        const rawEmail = req.body?.email || req.query?.email;
        if (!rawEmail || typeof rawEmail !== 'string') {
            return res.status(400).json({ error: 'Parameter email wajib disertakan.' });
        }

        const check = isEmailAllowed(rawEmail);
        if (!check.valid) {
            return res.status(403).json({ error: check.reason });
        }

        return res.json({
            message: `Alamat ${check.email} telah dibersihkan dari sesi ini.`
        });
    } catch (err) {
        console.error('deleteEmail error:', err);
        return res.status(500).json({ error: 'Gagal menghapus alamat email.' });
    }
}

async function getMessages(req, res) {
    try {
        const rawEmail = req.query?.email;
        if (!rawEmail || typeof rawEmail !== 'string') {
            return res.status(400).json({ error: 'Parameter email wajib disertakan.' });
        }

        const check = isEmailAllowed(rawEmail);
        if (!check.valid) {
            return res.status(403).json({ error: check.reason });
        }

        const { messages, error } = await imapService.fetchImapMessages(check.email);

        if (error) {
            console.error(`IMAP fetch error for ${check.email}:`, error);
            return res.status(503).json({ error: 'Mailbox sementara tidak dapat dihubungi. Silakan coba kembali.' });
        }

        return res.json({ messages });
    } catch (err) {
        console.error('getMessages error:', err);
        return res.status(500).json({ error: 'Terjadi kesalahan internal saat mengambil pesan.' });
    }
}

async function getMessageDetail(req, res) {
    try {
        const uid = parseInt(req.params.id, 10);
        if (isNaN(uid) || uid <= 0) {
            return res.status(400).json({ error: 'ID pesan tidak valid.' });
        }

        const rawEmail = req.query?.email;
        if (!rawEmail || typeof rawEmail !== 'string') {
            return res.status(400).json({ error: 'Parameter email wajib disertakan.' });
        }

        const check = isEmailAllowed(rawEmail);
        if (!check.valid) {
            return res.status(403).json({ error: check.reason });
        }

        const { message, error } = await imapService.fetchMessageDetail(uid, check.email);

        if (error) {
            return res.status(404).json({ error: 'Pesan tidak ditemukan atau tidak dapat dimuat.' });
        }

        return res.json({ message });
    } catch (err) {
        console.error('getMessageDetail error:', err);
        return res.status(500).json({ error: 'Terjadi kesalahan saat memuat detail pesan.' });
    }
}

async function gmailGenerator(req, res) {
    try {
        const rawEmail = req.query?.email;
        if (!rawEmail || typeof rawEmail !== 'string') {
            return res.status(400).json({ error: 'Parameter email wajib disertakan.' });
        }

        const { variants, truncated, total } = generateGmailVariants(rawEmail);
        if (variants.length === 0) {
            return res.status(400).json({ error: 'Alamat Gmail tidak valid. Hanya domain gmail.com / googlemail.com yang didukung.' });
        }

        return res.json({ variants, truncated, total });
    } catch (err) {
        console.error('gmailGenerator error:', err);
        return res.status(500).json({ error: 'Gagal menghasilkan variasi Gmail.' });
    }
}

async function getDomains(req, res) {
    const domains = getAvailableDomains();
    return res.json({ domains });
}

module.exports = {
    createEmail,
    deleteEmail,
    getMessages,
    getMessageDetail,
    getDomains,
    gmailGenerator
};
