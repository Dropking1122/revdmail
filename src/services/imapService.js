const imapSimple = require('imap-simple');
const { simpleParser } = require('mailparser');

let activeConnection = null;
let connectionPromise = null;

// Cache folder names so we don't call getBoxes() on every request (N+1 fix)
let cachedFolders = null;

async function getImapConnection() {
    const config = {
        imap: {
            user: process.env.IMAP_USER,
            password: process.env.IMAP_PASSWORD,
            host: process.env.IMAP_SERVER,
            port: parseInt(process.env.IMAP_PORT || '993'),
            tls: true,
            tlsOptions: { rejectUnauthorized: false },
            authTimeout: 10000,
            connTimeout: 10000,
            keepalive: true
        }
    };

    if (activeConnection && activeConnection.imap && activeConnection.imap.state === 'authenticated') {
        return activeConnection;
    }

    if (connectionPromise) {
        return connectionPromise;
    }

    if (!config.imap.user || !config.imap.password || !config.imap.host) {
        throw new Error("IMAP configuration missing. Please set IMAP_USER, IMAP_PASSWORD, and IMAP_SERVER.");
    }

    connectionPromise = (async () => {
        try {
            console.log('🔌 Connecting to IMAP...');
            const connection = await imapSimple.connect(config);

            connection.imap.once('close', () => {
                console.log('⚠️ IMAP Connection closed');
                activeConnection = null;
                connectionPromise = null;
                cachedFolders = null; // reset folder cache on disconnect
            });

            connection.imap.once('error', (err) => {
                console.error('❌ IMAP Connection Error:', err.message);
                activeConnection = null;
                connectionPromise = null;
                cachedFolders = null;
            });

            activeConnection = connection;
            return connection;
        } catch (err) {
            console.error('❌ Failed to connect to IMAP:', err.message);
            activeConnection = null;
            connectionPromise = null;
            cachedFolders = null;
            throw err;
        }
    })();

    return connectionPromise;
}

/**
 * Detect special folders (AllMail, Spam) once and cache the result.
 * This avoids repeated getBoxes() calls on every fetchImapMessages invocation.
 */
async function getSpecialFolders(connection) {
    if (cachedFolders) return cachedFolders;

    let allMail = 'INBOX';
    let spam = null;

    try {
        const boxes = await connection.getBoxes();

        const findBoxWithAttr = (boxList, attrName, parentPath = '') => {
            for (const key in boxList) {
                const box = boxList[key];
                const currentPath = parentPath + key;
                if (box.attribs && box.attribs.some(a => a.toLowerCase() === attrName.toLowerCase())) {
                    return currentPath;
                }
                if (box.children) {
                    const childPath = findBoxWithAttr(box.children, attrName, currentPath + box.delimiter);
                    if (childPath) return childPath;
                }
            }
            return null;
        };

        const foundAll = findBoxWithAttr(boxes, '\\All');
        if (foundAll) {
            allMail = foundAll;
        } else if (boxes['[Gmail]'] && boxes['[Gmail]'].children) {
            const gc = boxes['[Gmail]'].children;
            if (gc['Semua Pesan']) allMail = '[Gmail]/Semua Pesan';
            else if (gc['All Mail']) allMail = '[Gmail]/All Mail';
        }

        const foundSpam = findBoxWithAttr(boxes, '\\Junk');
        if (foundSpam) {
            spam = foundSpam;
        } else if (boxes['[Gmail]'] && boxes['[Gmail]'].children) {
            if (boxes['[Gmail]'].children['Spam']) spam = '[Gmail]/Spam';
        }
    } catch (err) {
        console.warn('⚠️ Error detecting boxes:', err.message);
    }

    cachedFolders = { allMail, spam };
    return cachedFolders;
}

async function fetchImapMessages(tempEmail, limit = 20) {
    let connection;
    try {
        connection = await getImapConnection();
        const { allMail, spam } = await getSpecialFolders(connection);

        const searchCriteria = [['HEADER', 'TO', tempEmail]];
        const fetchOptions = {
            bodies: ['HEADER', 'TEXT', ''],
            markSeen: false
        };

        // Deduplicate using Message-ID header (safe across folders).
        // Key: "<Message-ID>|<folder>" as fallback when Message-ID is absent.
        const messageMap = new Map();

        async function fetchFromFolder(folderName) {
            await connection.openBox(folderName);
            const msgs = await connection.search(searchCriteria, fetchOptions);
            msgs.forEach(m => {
                // Try to extract Message-ID from HEADER part for a stable dedup key
                const headerPart = m.parts.find(p => p.which === 'HEADER');
                let msgId = null;
                if (headerPart && headerPart.body && headerPart.body['message-id']) {
                    const raw = headerPart.body['message-id'];
                    msgId = Array.isArray(raw) ? raw[0] : raw;
                    msgId = msgId && msgId.trim();
                }
                const key = msgId || `${folderName}::${m.attributes.uid}`;
                if (!messageMap.has(key)) {
                    messageMap.set(key, m);
                }
            });
        }

        // 1. Fetch from AllMail (or INBOX fallback)
        try {
            await fetchFromFolder(allMail);
        } catch (err) {
            console.warn(`⚠️ Failed to fetch from ${allMail}, trying INBOX:`, err.message);
            try {
                await fetchFromFolder('INBOX');
            } catch (e) {
                console.warn('⚠️ INBOX fallback also failed:', e.message);
            }
        }

        // 2. Fetch from Spam (deduplicated via Map)
        if (spam) {
            try {
                await fetchFromFolder(spam);
            } catch (err) {
                console.warn(`⚠️ Failed to fetch from Spam (${spam}):`, err.message);
            }
        }

        // Sort by date descending and take the most recent
        const allMessages = Array.from(messageMap.values())
            .sort((a, b) => new Date(b.attributes.date) - new Date(a.attributes.date))
            .slice(0, limit);

        const results = await Promise.all(allMessages.map(async (item) => {
            const allParts = item.parts.find(p => p.which === '');
            const id = item.attributes.uid;

            if (!allParts) {
                return { id, subject: '(No Content)', from: 'Unknown', from_email: '', date: item.attributes.date, text: '', html: '' };
            }

            try {
                const parsed = await simpleParser(allParts.body);

                let senderName = 'Unknown';
                if (parsed.from && parsed.from.value && parsed.from.value[0]) {
                    senderName = parsed.from.value[0].name || parsed.from.value[0].address || 'Unknown';
                } else if (parsed.from && parsed.from.text) {
                    senderName = parsed.from.text.replace(/<.*>/, '').trim();
                }
                senderName = senderName.replace(/^["']|["']$/g, '').trim() || 'Unknown';

                return {
                    id,
                    subject: parsed.subject || '(No Subject)',
                    from: senderName,
                    from_email: (parsed.from && parsed.from.value && parsed.from.value[0])
                        ? parsed.from.value[0].address || ''
                        : '',
                    date: parsed.date || item.attributes.date,
                    text: parsed.text || '',
                    html: parsed.html || parsed.textAsHtml || ''
                };
            } catch (pErr) {
                console.warn(`⚠️ Failed to parse message UID ${id}:`, pErr.message);
                return { id, subject: '(Parse Error)', from: 'Unknown', from_email: '', date: item.attributes.date, text: '', html: '' };
            }
        }));

        return { messages: results, error: null };

    } catch (error) {
        console.error("❌ IMAP Fetch Error:", error.message);
        // Reset connection so next request gets a fresh one
        if (activeConnection) {
            try { activeConnection.end(); } catch (e) { /* ignore */ }
            activeConnection = null;
            connectionPromise = null;
            cachedFolders = null;
        }
        return { messages: [], error: error.message };
    }
}

module.exports = { fetchImapMessages };
