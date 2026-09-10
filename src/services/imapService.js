const imapSimple = require('imap-simple');
const { simpleParser } = require('mailparser');

let activeConnection = null;
let connectionPromise = null;
let cachedFolders = null;
let keepAliveTimer = null;
let reconnectTimer = null;
let connectionIsNew = false;

// How often to ping IMAP to prevent Gmail idle-timeout (~30 min).
const KEEPALIVE_INTERVAL_MS = 8 * 60 * 1000;
const RECONNECT_DELAY_MS = 5000;

// In-memory body cache for parsed messages (UID -> ParsedObject)
// Prevents downloading and parsing full MIME bodies on every 15-second poll
const messageCache = new Map();
const CACHE_TTL_MS = 20 * 60 * 1000; // 20 minutes
const MAX_CACHE_SIZE = 500;

function pruneCache() {
    const now = Date.now();
    for (const [key, val] of messageCache.entries()) {
        if (val.expiresAt < now) {
            messageCache.delete(key);
        }
    }
    if (messageCache.size > MAX_CACHE_SIZE) {
        const oldestKey = messageCache.keys().next().value;
        messageCache.delete(oldestKey);
    }
}

// ─── Recipient Validation & Security Filter ───────────────────────────────────

function extractAddresses(headerValue) {
    if (!headerValue) return [];
    const results = [];
    const items = Array.isArray(headerValue) ? headerValue : [headerValue];

    for (const item of items) {
        if (!item) continue;
        if (typeof item === 'string') {
            const matches = item.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
            if (matches) {
                matches.forEach(m => results.push(m.toLowerCase().trim()));
            }
        } else if (typeof item === 'object') {
            if (item.address) results.push(String(item.address).toLowerCase().trim());
            if (Array.isArray(item.value)) {
                item.value.forEach(v => v.address && results.push(String(v.address).toLowerCase().trim()));
            }
            if (item.text) {
                const matches = item.text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
                if (matches) {
                    matches.forEach(m => results.push(m.toLowerCase().trim()));
                }
            }
        }
    }
    return results;
}

function matchesRecipient(headers, targetEmail) {
    if (!headers || !targetEmail) return false;
    const target = targetEmail.toLowerCase().trim();
    const [targetLocal, targetDomain] = target.split('@');
    if (!targetLocal || !targetDomain) return false;

    const isTargetGmail = (targetDomain === 'gmail.com' || targetDomain === 'googlemail.com');
    const normalizedTargetLocal = isTargetGmail ? targetLocal.replace(/\./g, '') : null;

    const candidateHeaders = [
        headers.to,
        headers['delivered-to'],
        headers['x-original-to'],
        headers['x-forwarded-to'],
        headers['envelope-to'],
        headers.cc,
        headers.bcc
    ];

    for (const headerField of candidateHeaders) {
        const addresses = extractAddresses(headerField);
        for (const addr of addresses) {
            if (addr === target) {
                return true;
            }
            if (isTargetGmail) {
                const [candLocal, candDomain] = addr.split('@');
                if ((candDomain === 'gmail.com' || candDomain === 'googlemail.com') &&
                    candLocal.replace(/\./g, '') === normalizedTargetLocal) {
                    return true;
                }
            }
        }
    }
    return false;
}

// ─── Keepalive ────────────────────────────────────────────────────────────────

function stopKeepAlive() {
    if (keepAliveTimer) {
        clearInterval(keepAliveTimer);
        keepAliveTimer = null;
    }
}

function startKeepAlive() {
    stopKeepAlive();
    keepAliveTimer = setInterval(async () => {
        if (!activeConnection || !activeConnection.imap || activeConnection.imap.state !== 'authenticated') {
            stopKeepAlive();
            return;
        }
        try {
            // Keepalive via NOOP inside queue: preserves active folder state without race conditions
            await runExclusive(async () => {
                if (activeConnection && activeConnection.imap && activeConnection.imap.state === 'authenticated') {
                    await new Promise((resolve, reject) => {
                        activeConnection.imap.noop((err) => {
                            if (err) reject(err);
                            else resolve();
                        });
                    });
                }
            });
            console.log('💓 IMAP keepalive OK (NOOP)');
        } catch (err) {
            console.warn('⚠️ IMAP keepalive failed:', err.message);
            stopKeepAlive();
            _resetConnection();
            scheduleReconnect();
        }
    }, KEEPALIVE_INTERVAL_MS);
}

// ─── Auto-reconnect ───────────────────────────────────────────────────────────

function scheduleReconnect() {
    if (reconnectTimer) return;
    console.log(`🔁 Scheduling IMAP reconnect in ${RECONNECT_DELAY_MS / 1000}s…`);
    reconnectTimer = setTimeout(async () => {
        reconnectTimer = null;
        if (activeConnection) return;
        try {
            await getImapConnection();
            console.log('✅ IMAP auto-reconnect successful');
        } catch (err) {
            console.error('❌ IMAP auto-reconnect failed:', err.message);
            scheduleReconnect();
        }
    }, RECONNECT_DELAY_MS);
}

function _resetConnection() {
    stopKeepAlive();
    if (activeConnection) {
        try { activeConnection.end(); } catch (_) {}
    }
    activeConnection = null;
    connectionPromise = null;
    cachedFolders = null;
}

// ─── Connection ───────────────────────────────────────────────────────────────

function buildImapConfig() {
    return {
        imap: {
            user: process.env.IMAP_USER,
            password: process.env.IMAP_PASSWORD,
            host: process.env.IMAP_SERVER,
            port: parseInt(process.env.IMAP_PORT || '993'),
            tls: true,
            tlsOptions: { rejectUnauthorized: process.env.IMAP_ALLOW_INSECURE_TLS !== 'true' },
            authTimeout: 15000,
            connTimeout: 15000,
            keepalive: {
                interval: 10000,
                idleInterval: 300000,
                forceNoop: true
            }
        }
    };
}

async function getImapConnection() {
    if (activeConnection && activeConnection.imap && activeConnection.imap.state === 'authenticated') {
        return activeConnection;
    }

    if (connectionPromise) {
        return connectionPromise;
    }

    const cfg = buildImapConfig();
    if (!cfg.imap.user || !cfg.imap.password || !cfg.imap.host) {
        throw new Error('IMAP configuration missing. Please set IMAP_USER, IMAP_PASSWORD, and IMAP_SERVER.');
    }

    connectionPromise = (async () => {
        try {
            console.log('🔌 Connecting to IMAP…');
            const connection = await imapSimple.connect(cfg);
            console.log('✅ IMAP connected');

            connection.imap.once('close', () => {
                console.log('⚠️ IMAP connection closed — will auto-reconnect');
                _resetConnection();
                scheduleReconnect();
            });

            connection.imap.once('error', (err) => {
                console.error('❌ IMAP connection error:', err.message);
                _resetConnection();
                scheduleReconnect();
            });

            activeConnection = connection;
            connectionIsNew = true;

            startKeepAlive();
            return connection;
        } catch (err) {
            console.error('❌ Failed to connect to IMAP:', err.message);
            activeConnection = null;
            connectionPromise = null;
            cachedFolders = null;
            throw err;
        } finally {
            connectionPromise = null;
        }
    })();

    return connectionPromise;
}

// ─── Folder detection ─────────────────────────────────────────────────────────

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
                    const child = findBoxWithAttr(box.children, attrName, currentPath + box.delimiter);
                    if (child) return child;
                }
            }
            return null;
        };

        const foundAll = findBoxWithAttr(boxes, '\\All');
        if (foundAll) {
            allMail = foundAll;
        } else if (boxes['[Gmail]'] && boxes['[Gmail]'].children) {
            const gc = boxes['[Gmail]'].children;
            if (gc['Semua Email'])   allMail = '[Gmail]/Semua Email';
            else if (gc['Semua Pesan']) allMail = '[Gmail]/Semua Pesan';
            else if (gc['All Mail'])    allMail = '[Gmail]/All Mail';
        }

        const foundSpam = findBoxWithAttr(boxes, '\\Junk');
        if (foundSpam) {
            spam = foundSpam;
        } else if (boxes['[Gmail]'] && boxes['[Gmail]'].children) {
            if (boxes['[Gmail]'].children['Spam']) spam = '[Gmail]/Spam';
        }
    } catch (err) {
        console.warn('⚠️ Error detecting mailboxes:', err.message);
    }

    cachedFolders = { allMail, spam };
    return cachedFolders;
}

// ─── Exclusive access queue with timeout protection ───────────────────────────

let imapQueue = Promise.resolve();

function runExclusive(task, timeoutMs = 25000) {
    const wrappedTask = async () => {
        let timer = null;
        const timeoutPromise = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('IMAP operation timed out')), timeoutMs);
        });
        try {
            return await Promise.race([task(), timeoutPromise]);
        } finally {
            if (timer) clearTimeout(timer);
        }
    };

    const result = imapQueue.then(wrappedTask, wrappedTask);
    imapQueue = result.then(() => {}, () => {});
    return result;
}

// ─── Parse Helpers ────────────────────────────────────────────────────────────

function parseSender(fromHeader) {
    if (!fromHeader) return { name: 'Unknown', email: '' };
    const raw = Array.isArray(fromHeader) ? fromHeader[0] : fromHeader;
    if (!raw) return { name: 'Unknown', email: '' };

    const emailMatch = raw.match(/<([^>]+)>/);
    const email = emailMatch ? emailMatch[1].trim() : (raw.includes('@') ? raw.trim() : '');
    let name = raw.replace(/<[^>]+>/, '').replace(/^["']|["']$/g, '').trim();
    if (!name) name = email || 'Unknown';

    return { name, email };
}

// ─── Message Fetching ─────────────────────────────────────────────────────────

async function fetchImapMessages(tempEmail, limit = 20) {
    try {
        const connection = await getImapConnection();
        const isNew = connectionIsNew;
        connectionIsNew = false;

        const { allMail, spam } = await getSpecialFolders(connection);

        // Substring search in IMAP finds candidate messages quickly
        const searchCriteria = [
            ['OR',
                ['HEADER', 'TO', tempEmail],
                ['OR',
                    ['HEADER', 'DELIVERED-TO', tempEmail],
                    ['OR',
                        ['HEADER', 'X-Original-To', tempEmail],
                        ['HEADER', 'CC', tempEmail]
                    ]
                ]
            ]
        ];

        console.log(`🔍 Searching for: ${tempEmail}`);
        // Fetch only headers first — fast and lightweight
        const fetchHeaderOptions = { bodies: ['HEADER'], markSeen: false };
        const matchingMessages = new Map();

        async function scanFolderForHeaders(folderName) {
            const msgs = await runExclusive(async () => {
                await connection.openBox(folderName);
                return connection.search(searchCriteria, fetchHeaderOptions);
            });

            console.log(`   📂 ${folderName}: ${msgs.length} candidate(s)`);

            for (const m of msgs) {
                const headerPart = m.parts.find(p => p.which === 'HEADER');
                const headers = headerPart?.body || {};

                // Strict post-filtering: verify recipient exact match
                if (!matchesRecipient(headers, tempEmail)) {
                    continue;
                }

                let msgId = null;
                if (headers['message-id']) {
                    const raw = headers['message-id'];
                    msgId = (Array.isArray(raw) ? raw[0] : raw)?.trim();
                }
                const key = msgId || `${folderName}::${m.attributes.uid}`;

                if (!matchingMessages.has(key)) {
                    matchingMessages.set(key, {
                        message: m,
                        folder: folderName,
                        uid: m.attributes.uid,
                        date: m.attributes.date,
                        headers
                    });
                }
            }
        }

        // 1. Scan primary mailbox
        try {
            await scanFolderForHeaders(allMail);
        } catch (err) {
            console.warn(`⚠️ Failed to fetch from ${allMail}, trying INBOX:`, err.message);
            try { await scanFolderForHeaders('INBOX'); } catch (e) {
                console.warn('⚠️ INBOX fallback also failed:', e.message);
            }
        }

        // 2. Scan Spam folder
        if (spam) {
            try { await scanFolderForHeaders(spam); } catch (err) {
                console.warn(`⚠️ Failed to fetch from Spam (${spam}):`, err.message);
            }
        }

        // Retry once on fresh connection if empty (Gmail index delay)
        if (matchingMessages.size === 0 && isNew) {
            console.log('🔄 Fresh connection returned 0 messages — retrying in 2s…');
            await new Promise(r => setTimeout(r, 2000));
            try { await scanFolderForHeaders(allMail); } catch (_) {}
            if (spam) { try { await scanFolderForHeaders(spam); } catch (_) {} }
        }

        // Sort newest first and cap at limit
        const sorted = Array.from(matchingMessages.values())
            .sort((a, b) => new Date(b.date) - new Date(a.date))
            .slice(0, limit);

        pruneCache();

        // Populate details: check cache first, fetch full body only for un-cached items
        const results = await Promise.all(sorted.map(async (item) => {
            const cacheKey = `${item.folder}::${item.uid}`;
            const cached = messageCache.get(cacheKey);
            if (cached && cached.expiresAt > Date.now()) {
                return cached.data;
            }

            const sender = parseSender(item.headers.from);
            const subject = (item.headers.subject && item.headers.subject[0]) || '(No Subject)';
            const id = item.uid;

            // Fetch full body for this specific message
            try {
                const fullMsgs = await runExclusive(async () => {
                    await connection.openBox(item.folder);
                    return connection.search([['UID', String(item.uid)]], { bodies: [''], markSeen: false });
                });

                if (fullMsgs && fullMsgs.length > 0) {
                    const bodyPart = fullMsgs[0].parts.find(p => p.which === '');
                    if (bodyPart) {
                        const parsed = await simpleParser(bodyPart.body);
                        const result = {
                            id,
                            subject: parsed.subject || subject,
                            from: parsed.from?.value?.[0]?.name || sender.name,
                            from_email: parsed.from?.value?.[0]?.address || sender.email,
                            date: parsed.date || item.date,
                            text: parsed.text || '',
                            html: parsed.html || parsed.textAsHtml || ''
                        };

                        messageCache.set(cacheKey, {
                            data: result,
                            headers: item.headers,
                            expiresAt: Date.now() + CACHE_TTL_MS
                        });

                        return result;
                    }
                }
            } catch (bodyErr) {
                console.warn(`⚠️ Failed to fetch full body for UID ${id}:`, bodyErr.message);
            }

            // Fallback to header info if body fetch fails
            return {
                id,
                subject,
                from: sender.name,
                from_email: sender.email,
                date: item.date,
                text: '',
                html: ''
            };
        }));

        return { messages: results, error: null };

    } catch (error) {
        console.error('❌ IMAP Fetch Error:', error.message);
        _resetConnection();
        if (process.env.IMAP_USER && process.env.IMAP_PASSWORD && process.env.IMAP_SERVER) {
            scheduleReconnect();
        }
        return { messages: [], error: error.message };
    }
}

async function fetchMessageDetail(uid, tempEmail) {
    try {
        const connection = await getImapConnection();
        const { allMail, spam } = await getSpecialFolders(connection);

        const folders = [allMail, spam].filter(Boolean);

        for (const folder of folders) {
            const cacheKey = `${folder}::${uid}`;
            const cached = messageCache.get(cacheKey);
            if (cached && cached.expiresAt > Date.now()) {
                if (matchesRecipient(cached.headers, tempEmail)) {
                    return { message: cached.data, error: null };
                } else {
                    return { message: null, error: 'Unauthorized message access.' };
                }
            }

            try {
                const msgs = await runExclusive(async () => {
                    await connection.openBox(folder);
                    return connection.search([['UID', String(uid)]], { bodies: ['HEADER', ''], markSeen: false });
                });

                if (msgs && msgs.length > 0) {
                    const m = msgs[0];
                    const headerPart = m.parts.find(p => p.which === 'HEADER');
                    const headers = headerPart?.body || {};

                    if (!matchesRecipient(headers, tempEmail)) {
                        return { message: null, error: 'Unauthorized message access.' };
                    }

                    const bodyPart = m.parts.find(p => p.which === '');
                    const parsed = bodyPart ? await simpleParser(bodyPart.body) : null;
                    const sender = parseSender(headers.from);

                    const result = {
                        id: uid,
                        subject: parsed?.subject || (headers.subject && headers.subject[0]) || '(No Subject)',
                        from: parsed?.from?.value?.[0]?.name || sender.name,
                        from_email: parsed?.from?.value?.[0]?.address || sender.email,
                        date: parsed?.date || m.attributes.date,
                        text: parsed?.text || '',
                        html: parsed?.html || parsed?.textAsHtml || ''
                    };

                    messageCache.set(cacheKey, {
                        data: result,
                        headers,
                        expiresAt: Date.now() + CACHE_TTL_MS
                    });

                    return { message: result, error: null };
                }
            } catch (err) {
                console.warn(`Folder ${folder} search error:`, err.message);
            }
        }

        return { message: null, error: 'Message not found.' };
    } catch (err) {
        console.error('fetchMessageDetail error:', err);
        return { message: null, error: err.message };
    }
}

// Eager warm-up on startup
if (process.env.IMAP_USER && process.env.IMAP_PASSWORD && process.env.IMAP_SERVER) {
    setTimeout(() => {
        getImapConnection().catch(err =>
            console.warn('⚠️ Initial IMAP connect failed (will retry on first request):', err.message)
        );
    }, 1000);
}

module.exports = {
    fetchImapMessages,
    fetchMessageDetail
};
