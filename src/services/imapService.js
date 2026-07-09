const imapSimple = require('imap-simple');
const { simpleParser } = require('mailparser');

let activeConnection = null;
let connectionPromise = null;
// cachedBoxName removed as we switch boxes

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
        throw new Error("IMAP configuration missing in .env");
    }

    connectionPromise = (async () => {
        try {
            console.log('🔌 Connecting to IMAP...');
            const connection = await imapSimple.connect(config);

            connection.imap.once('close', () => {
                console.log('⚠️ IMAP Connection closed');
                activeConnection = null;
                connectionPromise = null;
            });

            connection.imap.once('error', (err) => {
                console.error('❌ IMAP Connection Error:', err);
                activeConnection = null;
                connectionPromise = null;
            });

            activeConnection = connection;
            return connection;
        } catch (err) {
            console.error('❌ Failed to connect to IMAP:', err);
            activeConnection = null;
            connectionPromise = null;
            throw err;
        }
    })();

    return connectionPromise;
}

async function detectSpecialFolders(connection) {
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
        } else {
            if (boxes['[Gmail]'] && boxes['[Gmail]'].children) {
                const gmailChildren = boxes['[Gmail]'].children;
                if (gmailChildren['Semua Pesan']) allMail = '[Gmail]/Semua Pesan';
                else if (gmailChildren['All Mail']) allMail = '[Gmail]/All Mail';
            }
        }

        const foundSpam = findBoxWithAttr(boxes, '\\Junk');
        if (foundSpam) {
            spam = foundSpam;
        } else {
            if (boxes['[Gmail]'] && boxes['[Gmail]'].children) {
                if (boxes['[Gmail]'].children['Spam']) spam = '[Gmail]/Spam';
            }
        }
    } catch (err) {
        console.warn('⚠️ Error detecting boxes:', err.message);
    }
    return { allMail, spam };
}

async function fetchImapMessages(tempEmail, limit = 10) {
    let connection;
    try {
        connection = await getImapConnection();
        const { allMail, spam } = await detectSpecialFolders(connection);

        const searchCriteria = [['HEADER', 'TO', tempEmail]];
        const fetchOptions = {
            bodies: ['HEADER', 'TEXT', ''],
            markSeen: false
        };

        let allMessages = [];

        // 1. Fetch from All Mail
        try {
            await connection.openBox(allMail);
            const msgs = await connection.search(searchCriteria, fetchOptions);
            allMessages = allMessages.concat(msgs);
        } catch (err) {
            console.warn(`⚠️ Failed to fetch from ${allMail}, trying INBOX`, err.message);
            try {
                await connection.openBox('INBOX');
                const msgs = await connection.search(searchCriteria, fetchOptions);
                allMessages = allMessages.concat(msgs);
            } catch (e) { }
        }

        // 2. Fetch from Spam
        if (spam) {
            try {
                await connection.openBox(spam);
                const msgs = await connection.search(searchCriteria, fetchOptions);
                allMessages = allMessages.concat(msgs);
            } catch (err) {
                console.warn(`⚠️ Failed to fetch from Spam (${spam})`, err.message);
            }
        }

        allMessages.sort((a, b) => new Date(b.attributes.date) - new Date(a.attributes.date));
        const recentMessages = allMessages.slice(0, limit);

        const results = await Promise.all(recentMessages.map(async (item) => {
            const allParts = item.parts.find(p => p.which === '');
            const id = item.attributes.uid;

            try {
                const parsed = await simpleParser(allParts.body);

                let senderName = 'Unknown';
                if (parsed.from && parsed.from.value && parsed.from.value[0] && parsed.from.value[0].name) {
                    senderName = parsed.from.value[0].name;
                } else if (parsed.from && parsed.from.text) {
                    senderName = parsed.from.text.replace(/<.*>/, '').trim();
                }
                senderName = senderName.replace(/^["']|["']$/g, '');

                return {
                    id: id,
                    subject: parsed.subject,
                    from: senderName || 'Unknown',
                    from_email: parsed.from && parsed.from.value && parsed.from.value[0] ? parsed.from.value[0].address : '',
                    date: parsed.date,
                    text: parsed.text || '',
                    html: parsed.html || parsed.textAsHtml || ''
                };
            } catch (pErr) {
                return { id: id, subject: 'Error parsing', from: 'Unknown', date: new Date(), text: '', html: '' };
            }
        }));

        return { messages: results, error: null };

    } catch (error) {
        console.error("❌ IMAP Fetch Error:", error.message);
        if (activeConnection) {
            try { activeConnection.end(); } catch (e) { }
            activeConnection = null;
            connectionPromise = null;
        }
        return { messages: [], error: error.message };
    }
}

module.exports = { fetchImapMessages };