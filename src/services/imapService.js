const imapSimple = require('imap-simple');
const { simpleParser } = require('mailparser');

let activeConnection = null;
let connectionPromise = null;
let cachedFolders = null;
let keepAliveTimer = null;
let reconnectTimer = null;
let connectionIsNew = false;

// How often to ping IMAP to prevent Gmail idle-timeout (~30 min).
// Ping every 9 minutes to stay well inside the limit.
const KEEPALIVE_INTERVAL_MS = 9 * 60 * 1000;

// How long to wait before auto-reconnecting after a disconnect.
const RECONNECT_DELAY_MS = 5000;

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
            // Opening INBOX sends real IMAP commands, resetting the server's idle clock.
            await activeConnection.openBox('INBOX');
            console.log('💓 IMAP keepalive OK');
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
    if (reconnectTimer) return; // already scheduled
    console.log(`🔁 Scheduling IMAP reconnect in ${RECONNECT_DELAY_MS / 1000}s…`);
    reconnectTimer = setTimeout(async () => {
        reconnectTimer = null;
        if (activeConnection) return; // someone else already reconnected
        try {
            await getImapConnection();
            console.log('✅ IMAP auto-reconnect successful');
        } catch (err) {
            console.error('❌ IMAP auto-reconnect failed:', err.message);
            // Try again in a bit
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
            // Verify the IMAP server's TLS certificate by default (prevents MITM
            // on mailbox credentials and email contents). Only disable this for a
            // known self-signed provider by setting IMAP_ALLOW_INSECURE_TLS=true,
            // and never do so in production.
            tlsOptions: { rejectUnauthorized: process.env.IMAP_ALLOW_INSECURE_TLS !== 'true' },
            authTimeout: 15000,
            connTimeout: 15000,
            // Proper keepalive object — forceNoop ensures a command is sent
            // even when no mailbox is open (unlike IDLE which requires SELECTED).
            keepalive: {
                interval: 10000,       // check every 10 s
                idleInterval: 300000,  // send NOOP/IDLE after 5 min of true inactivity
                forceNoop: true        // use NOOP (works regardless of mailbox state)
            }
        }
    };
}

async function getImapConnection() {
    // Return existing healthy connection immediately
    if (activeConnection && activeConnection.imap && activeConnection.imap.state === 'authenticated') {
        return activeConnection;
    }

    // Return in-flight connection promise (prevents parallel connect races)
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

            // Start application-level keepalive pings
            startKeepAlive();

            return connection;
        } catch (err) {
            console.error('❌ Failed to connect to IMAP:', err.message);
            activeConnection = null;
            connectionPromise = null;
            cachedFolders = null;
            throw err;
        } finally {
            // Always clear the promise lock so future calls can retry
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
            if (gc['Semua Pesan']) allMail = '[Gmail]/Semua Pesan';
            else if (gc['All Mail'])  allMail = '[Gmail]/All Mail';
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

// ─── Exclusive access queue ────────────────────────────────────────────────────
// The IMAP connection is a single shared object across all requests, and which
// folder is "open" is state that lives on that connection. If two requests run
// openBox()/search() concurrently (easy in Node's non-blocking I/O), one
// request's folder switch can interleave with another's search, corrupting
// results. Serialize every operation that touches the active folder through
// this queue so only one openBox+search sequence runs at a time.
let imapQueue = Promise.resolve();

function runExclusive(task) {
    const result = imapQueue.then(task, task);
    imapQueue = result.then(() => {}, () => {});
    return result;
}

// ─── Message fetching ─────────────────────────────────────────────────────────

async function fetchImapMessages(tempEmail, limit = 20) {
    try {
        const connection = await getImapConnection();
        const isNew = connectionIsNew;
        connectionIsNew = false;

        const { allMail, spam } = await getSpecialFolders(connection);

        // Search across multiple headers — Cloudflare Email Routing may preserve
        // the original recipient in TO, DELIVERED-TO, or X-Original-To depending
        // on the forwarding method used.
        const domain = tempEmail.split('@')[1] || '';
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
        const fetchOptions = { bodies: ['HEADER', 'TEXT', ''], markSeen: false };

        // Deduplicate by Message-ID across folders
        const messageMap = new Map();

        async function fetchFromFolder(folderName) {
            const msgs = await runExclusive(async () => {
                await connection.openBox(folderName);
                return connection.search(searchCriteria, fetchOptions);
            });
            console.log(`   📂 ${folderName}: ${msgs.length} result(s)`);
            msgs.forEach(m => {
                const headerPart = m.parts.find(p => p.which === 'HEADER');
                let msgId = null;
                if (headerPart?.body?.['message-id']) {
                    const raw = headerPart.body['message-id'];
                    msgId = (Array.isArray(raw) ? raw[0] : raw)?.trim();
                }
                const key = msgId || `${folderName}::${m.attributes.uid}`;
                if (!messageMap.has(key)) messageMap.set(key, m);
            });
        }

        // 1. AllMail (or INBOX fallback)
        try {
            await fetchFromFolder(allMail);
        } catch (err) {
            console.warn(`⚠️ Failed to fetch from ${allMail}, trying INBOX:`, err.message);
            try { await fetchFromFolder('INBOX'); } catch (e) {
                console.warn('⚠️ INBOX fallback also failed:', e.message);
            }
        }

        // 2. Spam folder
        if (spam) {
            try { await fetchFromFolder(spam); } catch (err) {
                console.warn(`⚠️ Failed to fetch from Spam (${spam}):`, err.message);
            }
        }

        // On a fresh reconnect, retry once after 2 s if we got nothing.
        // Gmail sometimes needs a moment to index after reconnect.
        if (messageMap.size === 0 && isNew) {
            console.log('🔄 Fresh connection returned 0 messages — retrying in 2s…');
            await new Promise(r => setTimeout(r, 2000));
            try { await fetchFromFolder(allMail); } catch (_) {}
            if (spam) { try { await fetchFromFolder(spam); } catch (_) {} }
        }

        // Sort newest first, cap at limit
        const sorted = Array.from(messageMap.values())
            .sort((a, b) => new Date(b.attributes.date) - new Date(a.attributes.date))
            .slice(0, limit);

        const results = await Promise.all(sorted.map(async (item) => {
            const allParts = item.parts.find(p => p.which === '');
            const id = item.attributes.uid;

            if (!allParts) {
                return { id, subject: '(No Content)', from: 'Unknown', from_email: '', date: item.attributes.date, text: '', html: '' };
            }

            try {
                const parsed = await simpleParser(allParts.body);

                let senderName = 'Unknown';
                if (parsed.from?.value?.[0]) {
                    senderName = parsed.from.value[0].name || parsed.from.value[0].address || 'Unknown';
                } else if (parsed.from?.text) {
                    senderName = parsed.from.text.replace(/<.*>/, '').trim();
                }
                senderName = senderName.replace(/^["']|["']$/g, '').trim() || 'Unknown';

                return {
                    id,
                    subject:    parsed.subject || '(No Subject)',
                    from:       senderName,
                    from_email: parsed.from?.value?.[0]?.address || '',
                    date:       parsed.date || item.attributes.date,
                    text:       parsed.text || '',
                    html:       parsed.html || parsed.textAsHtml || ''
                };
            } catch (pErr) {
                console.warn(`⚠️ Failed to parse message UID ${id}:`, pErr.message);
                return { id, subject: '(Parse Error)', from: 'Unknown', from_email: '', date: item.attributes.date, text: '', html: '' };
            }
        }));

        return { messages: results, error: null };

    } catch (error) {
        console.error('❌ IMAP Fetch Error:', error.message);
        _resetConnection();
        // Only schedule reconnect for network/auth failures, not missing config
        if (process.env.IMAP_USER && process.env.IMAP_PASSWORD && process.env.IMAP_SERVER) {
            scheduleReconnect();
        }
        return { messages: [], error: error.message };
    }
}

// ─── Debug: fetch recent emails without any filter ────────────────────────────
// Returns last N emails with their raw TO/DELIVERED-TO/X-Original-To headers
// so the caller can see exactly how forwarded mail looks in Gmail.
async function fetchRecentRaw(limit = 5) {
    try {
        const connection = await getImapConnection();
        const { allMail } = await getSpecialFolders(connection);

        const msgs = await runExclusive(async () => {
            await connection.openBox(allMail);
            return connection.search(['ALL'], {
                bodies: ['HEADER'],
                markSeen: false
            });
        });

        const recent = msgs
            .sort((a, b) => new Date(b.attributes.date) - new Date(a.attributes.date))
            .slice(0, limit);

        return recent.map(m => {
            const h = m.parts.find(p => p.which === 'HEADER')?.body || {};
            return {
                uid:            m.attributes.uid,
                date:           m.attributes.date,
                subject:        (h.subject || [''])[0],
                to:             (h.to || []).join(', '),
                'delivered-to': (h['delivered-to'] || []).join(', '),
                'x-original-to':(h['x-original-to'] || []).join(', '),
                'x-forwarded-to':(h['x-forwarded-to'] || []).join(', '),
                cc:             (h.cc || []).join(', '),
                from:           (h.from || [''])[0],
            };
        });
    } catch (err) {
        return [{ error: err.message }];
    }
}

// ─── Warm up connection on startup ───────────────────────────────────────────
// Connect eagerly so the first user request is instant.
if (process.env.IMAP_USER && process.env.IMAP_PASSWORD && process.env.IMAP_SERVER) {
    setTimeout(() => {
        getImapConnection().catch(err =>
            console.warn('⚠️ Initial IMAP connect failed (will retry on first request):', err.message)
        );
    }, 1000);
}

module.exports = { fetchImapMessages, fetchRecentRaw };
