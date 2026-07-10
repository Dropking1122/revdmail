const API_BASE = '/api';

let currentEmail = null;
let pollingInterval = null;
let allMessages = [];
let availableDomains = [];
let selectedDomain = '';
let consecutiveEmptyPolls = 0;
const EMPTY_POLLS_BEFORE_CLEAR = 3; // require 3 consecutive empty polls before wiping the list

// DOM Elements
const activeEmailDisplay = document.getElementById('activeEmailDisplay');
const currentEmailText = document.getElementById('currentEmailText');
const emailListContainer = document.getElementById('emailList');
const emptyState = document.getElementById('emptyState');
const customDomainSelector = document.getElementById('customDomainSelector');
const domainTrigger = document.getElementById('domainTrigger');
const domainOptions = document.getElementById('domainOptions');
const selectedDomainText = document.getElementById('selectedDomainText');
const detailView = document.getElementById('emailDetailView');
const detailSubject = document.getElementById('detailSubject');
const detailSenderName = document.getElementById('detailSenderName');
const detailSenderEmail = document.getElementById('detailSenderEmail');
const senderAvatar = document.getElementById('senderAvatar');
const detailDate = document.getElementById('detailDate');
const detailBody = document.getElementById('detailBody');
const sidebar = document.getElementById('sidebar');
const toast = document.getElementById('toast');
const searchInput = document.getElementById('searchInput');

// ─── Domain Management ───────────────────────────────────────────────────────

async function loadDomainsFromAPI() {
    try {
        const res = await fetch(`${API_BASE}/domains`);
        if (res.ok) {
            const data = await res.json();
            if (data.domains && Array.isArray(data.domains) && data.domains.length > 0) {
                availableDomains = data.domains;
                return true;
            }
        }
    } catch (err) {
        console.warn('⚠️ Could not load domains from API:', err);
    }
    return false;
}

async function initializeDomainSelector() {
    await loadDomainsFromAPI();

    if (availableDomains.length === 0) {
        availableDomains = ['example.com'];
    }

    const savedDomain = localStorage.getItem('selectedDomain');
    selectedDomain = (savedDomain && availableDomains.includes(savedDomain))
        ? savedDomain
        : availableDomains[0];

    renderDomainOptions();

    if (domainTrigger) {
        domainTrigger.addEventListener('click', (e) => {
            e.stopPropagation();
            customDomainSelector.classList.toggle('active');
            domainTrigger.setAttribute('aria-expanded', customDomainSelector.classList.contains('active'));
        });
    }

    document.addEventListener('click', (e) => {
        if (customDomainSelector && !customDomainSelector.contains(e.target)) {
            customDomainSelector.classList.remove('active');
            if (domainTrigger) domainTrigger.setAttribute('aria-expanded', 'false');
        }
    });
}

function renderDomainOptions() {
    if (selectedDomainText) {
        selectedDomainText.textContent = `@${selectedDomain}`;
    }
    if (!domainOptions) return;

    const isDark = document.documentElement.classList.contains('dark');

    domainOptions.innerHTML = '';
    availableDomains.forEach(domain => {
        const option = document.createElement('button');
        const isSelected = domain === selectedDomain;
        option.className = [
            'w-full text-left px-4 py-3 text-sm font-medium rounded-xl transition-all',
            isSelected
                ? 'bg-primary-600 text-white font-semibold'
                : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'
        ].join(' ');
        option.textContent = `@${domain}`;
        option.setAttribute('type', 'button');
        option.addEventListener('click', (e) => {
            e.stopPropagation();
            selectDomain(domain);
        });
        domainOptions.appendChild(option);
    });
}

async function selectDomain(domain) {
    if (domain === selectedDomain) {
        customDomainSelector.classList.remove('active');
        if (domainTrigger) domainTrigger.setAttribute('aria-expanded', 'false');
        return;
    }

    selectedDomain = domain;
    localStorage.setItem('selectedDomain', selectedDomain);
    renderDomainOptions();

    customDomainSelector.classList.remove('active');
    if (domainTrigger) domainTrigger.setAttribute('aria-expanded', 'false');

    showToast(`Switching to @${selectedDomain}…`);
    await generateEmail();
}

// ─── Initialization ───────────────────────────────────────────────────────────

async function init() {
    const savedEmail = localStorage.getItem('currentEmail');
    if (savedEmail) {
        currentEmail = savedEmail;
        updateCurrentEmailUI();
        startPolling();
        showToast(`Accessing ${currentEmail}`);
        return;
    }
    await generateEmail();
}

document.addEventListener('DOMContentLoaded', async () => {
    await initializeDomainSelector();
    await init();
});

// ─── API Calls ────────────────────────────────────────────────────────────────

let isGenerating = false;

async function generateEmail() {
    if (isGenerating) return;
    isGenerating = true;

    try {
        setLoading(true);
        const res = await fetch(`${API_BASE}/create?domain=${encodeURIComponent(selectedDomain)}`, { method: 'POST' });
        const data = await res.json();

        if (!res.ok) {
            showToast(data.error || 'Failed to generate email');
            return;
        }

        if (data.email) {
            currentEmail = data.email;
            localStorage.setItem('currentEmail', currentEmail);
            allMessages = [];
            consecutiveEmptyPolls = 0;
            filterAndRender();
            updateCurrentEmailUI();
            startPolling();
            showToast(`New address ready!`);
        }
    } catch (err) {
        console.error('❌ Error creating email:', err);
        showToast('Error creating email');
    } finally {
        isGenerating = false;
        setLoading(false);
    }
}

async function fetchMessages() {
    if (!currentEmail) return;

    try {
        const res = await fetch(`${API_BASE}/messages?email=${encodeURIComponent(currentEmail)}`);

        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
            showToast(err.error || 'Failed to fetch messages');
            return;
        }

        const data = await res.json();

        if (data.error) {
            // IMAP transient error — don't wipe existing messages
            console.warn('API error:', data.error);
            return;
        }

        if (Array.isArray(data.messages)) {
            if (data.messages.length > 0) {
                // Got real messages — update and reset the empty-poll counter
                consecutiveEmptyPolls = 0;
                allMessages = data.messages;
                filterAndRender();
            } else {
                // Empty result — could be IMAP reconnect race condition.
                // Only clear the list after EMPTY_POLLS_BEFORE_CLEAR consecutive
                // empty responses to avoid a transient reconnect wiping messages.
                consecutiveEmptyPolls++;
                if (consecutiveEmptyPolls >= EMPTY_POLLS_BEFORE_CLEAR) {
                    allMessages = [];
                    filterAndRender();
                }
                // else: keep showing the previous messages until confirmed empty
            }
        }
    } catch (err) {
        console.error('❌ Error fetching messages:', err);
    }
}

async function deleteCurrentEmail() {
    if (!currentEmail) return;

    if (!confirm(`Delete ${currentEmail}?\n\nYou will get a new random address.`)) return;

    try {
        const res = await fetch(`${API_BASE}/delete?email=${encodeURIComponent(currentEmail)}`, { method: 'DELETE' });

        if (res.ok) {
            showToast('Email deleted');
            currentEmail = null;
            allMessages = [];
            localStorage.removeItem('currentEmail');
            stopPolling();
            filterAndRender();
            updateCurrentEmailUI();
            await generateEmail();
        } else {
            showToast('Failed to delete');
        }
    } catch (err) {
        console.error('❌ Error deleting:', err);
        showToast('Error deleting email');
    }
}

// ─── UI Logic ─────────────────────────────────────────────────────────────────

function updateCurrentEmailUI() {
    const text = currentEmail || 'No Active Email';

    if (currentEmailText) currentEmailText.textContent = text;

    const mobileEl = document.getElementById('mobileEmailText');
    if (mobileEl) mobileEl.textContent = text;

    if (activeEmailDisplay) {
        activeEmailDisplay.style.display = currentEmail ? '' : 'none';
    }
}

function filterAndRender() {
    const query = searchInput ? searchInput.value.toLowerCase().trim() : '';

    const filtered = query
        ? allMessages.filter(msg =>
            (msg.subject || '').toLowerCase().includes(query) ||
            (msg.from || '').toLowerCase().includes(query) ||
            (msg.text || '').toLowerCase().includes(query)
          )
        : allMessages;

    renderEmailList(filtered);
}

function renderEmailList(messages) {
    if (!emailListContainer) return;

    emailListContainer.innerHTML = '';

    if (!messages || messages.length === 0) {
        emptyState && emptyState.classList.replace('opacity-0', 'opacity-100');
        emptyState && emptyState.classList.remove('pointer-events-none');
        return;
    }

    emptyState && emptyState.classList.replace('opacity-100', 'opacity-0');
    emptyState && emptyState.classList.add('pointer-events-none');

    const sorted = [...messages].sort((a, b) => new Date(b.date) - new Date(a.date));

    sorted.forEach(msg => {
        const row = document.createElement('div');
        row.className = 'email-row group';
        row.setAttribute('role', 'button');
        row.setAttribute('tabindex', '0');

        row.innerHTML = `
            <div class="flex items-center gap-3 min-w-0">
                <div class="sender-avatar-sm">${escapeHtml((msg.from || 'U').charAt(0).toUpperCase())}</div>
                <div class="flex flex-col min-w-0">
                    <span class="font-semibold text-slate-900 dark:text-white truncate text-sm group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors">${escapeHtml(msg.from || 'Unknown')}</span>
                    <span class="text-sm text-slate-600 dark:text-slate-300 truncate font-medium">${escapeHtml(msg.subject || '(No Subject)')}</span>
                    <span class="text-xs text-slate-400 dark:text-slate-500 truncate">${escapeHtml(msg.text ? msg.text.substring(0, 80) : '')}</span>
                </div>
            </div>
            <div class="text-right shrink-0 flex flex-col items-end gap-1">
                <span class="text-xs font-medium text-slate-400 dark:text-slate-500 whitespace-nowrap">${formatTime(msg.date)}</span>
                <span class="w-2 h-2 rounded-full bg-primary-500 opacity-0 group-hover:opacity-100 transition-opacity"></span>
            </div>
        `;

        row.onclick = () => openDetail(msg);
        row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') openDetail(msg); });

        emailListContainer.appendChild(row);
    });
}

function openDetail(msg) {
    detailView.classList.add('active');

    detailSubject.textContent = msg.subject || '(No Subject)';

    let senderName = msg.from || 'Unknown';
    if (senderName.includes('<')) {
        senderName = senderName.split('<')[0].trim().replace(/^["']|["']$/g, '');
    }

    detailSenderName.textContent = senderName;
    detailSenderEmail.textContent = msg.from_email ? `<${msg.from_email}>` : '';

    const date = new Date(msg.date);
    const opts = { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' };
    detailDate.textContent = isNaN(date) ? '' : date.toLocaleDateString('en-GB', opts);

    const recipientEl = document.getElementById('detailRecipient');
    if (recipientEl) recipientEl.textContent = currentEmail || '';

    senderAvatar.textContent = (msg.from || 'U').charAt(0).toUpperCase();

    if (msg.html) {
        detailBody.innerHTML = sanitizeHtml(msg.html);
    } else {
        detailBody.innerHTML = `<pre class="whitespace-pre-wrap font-sans text-sm">${escapeHtml(msg.text || '(No Content)')}</pre>`;
    }

    // Scroll to top of detail body
    detailBody.scrollTop = 0;
}

function closeDetail() {
    detailView.classList.remove('active');
}

function copyEmail() {
    if (!currentEmail) return;

    const text = currentEmail;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text)
            .then(() => showToast('📋 Address copied!'))
            .catch(() => fallbackCopy(text));
    } else {
        fallbackCopy(text);
    }
}

function fallbackCopy(text) {
    const el = document.createElement('textarea');
    el.value = text;
    el.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.appendChild(el);
    el.focus();
    el.select();
    try {
        document.execCommand('copy');
        showToast('📋 Address copied!');
    } catch {
        showToast('Could not copy — please copy manually');
    }
    document.body.removeChild(el);
}

async function refreshInbox() {
    const icon = document.querySelector('#refreshBtn ion-icon');
    if (icon) icon.classList.add('rotating');

    showToast('Checking for new messages…');
    await fetchMessages();

    if (icon) icon.classList.remove('rotating');
    showToast('Inbox updated');
}

function showToast(message) {
    if (!toast) return;
    const msg = document.getElementById('toastMessage');
    if (msg) msg.textContent = message;
    toast.classList.remove('opacity-0', 'translate-y-8');
    toast.classList.add('opacity-100', 'translate-y-0');
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-y-8');
        toast.classList.remove('opacity-100', 'translate-y-0');
    }, 3000);
}

function setLoading(on) {
    const btn = document.getElementById('generateBtn');
    if (!btn) return;
    const span = btn.querySelector('span');
    if (span) span.textContent = on ? 'Generating…' : 'New Address';
    btn.disabled = on;
    btn.classList.toggle('opacity-60', on);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Sanitize HTML email body.
 * Removes: <script>, <iframe>, <object>, <embed>, <form>, <meta>, <link>
 * Removes: on* event attributes, javascript: hrefs, data: URLs in src/href
 */
function sanitizeHtml(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Remove dangerous elements
    const dangerous = ['script', 'iframe', 'object', 'embed', 'form', 'meta', 'link', 'base'];
    dangerous.forEach(tag => {
        doc.querySelectorAll(tag).forEach(el => el.remove());
    });

    // Walk all elements and clean attributes
    doc.body.querySelectorAll('*').forEach(el => {
        // Remove on* event handlers
        Array.from(el.attributes).forEach(attr => {
            if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
        });

        // Sanitize href and src — block javascript: and data: URIs
        ['href', 'src', 'action'].forEach(attr => {
            const val = el.getAttribute(attr);
            if (val && /^\s*(javascript|data|vbscript):/i.test(val)) {
                el.removeAttribute(attr);
            }
        });

        // Open external links in new tab safely
        if (el.tagName === 'A') {
            el.setAttribute('target', '_blank');
            el.setAttribute('rel', 'noopener noreferrer');
        }
    });

    return doc.body.innerHTML;
}

function formatTime(dateStr) {
    const date = new Date(dateStr);
    if (isNaN(date)) return '';
    const now = new Date();
    if (date.toDateString() === now.toDateString()) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function startPolling() {
    stopPolling();
    fetchMessages();
    pollingInterval = setInterval(fetchMessages, 15000);
}

function stopPolling() {
    if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
    }
}

// ─── Search ───────────────────────────────────────────────────────────────────

if (searchInput) {
    searchInput.addEventListener('input', filterAndRender);
    searchInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') { filterAndRender(); searchInput.blur(); }
        if (e.key === 'Escape') { searchInput.value = ''; filterAndRender(); }
    });
}

// ─── Access Email Modal ───────────────────────────────────────────────────────

const accessModal = document.getElementById('accessModal');
const accessBtn = document.getElementById('accessBtn');
const accessEmailInput = document.getElementById('accessEmailInput');

function openAccessModal() {
    if (accessModal) accessModal.classList.add('active');
    if (window.setSidebar) window.setSidebar(false);
    setTimeout(() => accessEmailInput && accessEmailInput.focus(), 100);
}

function closeAccessModal() {
    if (accessModal) accessModal.classList.remove('active');
    if (accessEmailInput) accessEmailInput.value = '';
}

async function accessExistingEmail() {
    const email = accessEmailInput ? accessEmailInput.value.trim() : '';

    if (!email) { showToast('Please enter an email address'); return; }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) { showToast('Please enter a valid email address'); return; }

    const domain = email.split('@')[1];
    if (!availableDomains.includes(domain)) {
        showToast(`Domain @${domain} is not supported`);
        return;
    }

    currentEmail = email;
    localStorage.setItem('currentEmail', currentEmail);
    allMessages = [];
    consecutiveEmptyPolls = 0;
    filterAndRender();
    updateCurrentEmailUI();
    closeAccessModal();
    stopPolling();
    startPolling();
    showToast(`Accessing ${email}`);
}

if (accessModal) {
    accessModal.addEventListener('click', e => { if (e.target === accessModal) closeAccessModal(); });
}
if (accessEmailInput) {
    accessEmailInput.addEventListener('keydown', e => { if (e.key === 'Enter') accessExistingEmail(); });
}
if (accessBtn) {
    accessBtn.addEventListener('click', openAccessModal);
}

// ─── Custom Email Modal ───────────────────────────────────────────────────────

const customModal = document.getElementById('customModal');
const customUsernameInput = document.getElementById('customUsernameInput');
const customModalDomainDisplay = document.getElementById('customModalDomainDisplay');

function openCustomModal() {
    if (customModal) customModal.classList.add('active');
    if (customModalDomainDisplay) customModalDomainDisplay.textContent = `@${selectedDomain}`;
    if (window.setSidebar) window.setSidebar(false);
    setTimeout(() => customUsernameInput && customUsernameInput.focus(), 100);
}

function closeCustomModal() {
    if (customModal) customModal.classList.remove('active');
    if (customUsernameInput) customUsernameInput.value = '';
}

async function generateCustomEmail() {
    const username = customUsernameInput ? customUsernameInput.value.trim() : '';

    if (!username) { showToast('Please enter a username'); return; }
    if (!/^[a-zA-Z0-9._-]+$/.test(username)) {
        showToast('Use letters, numbers, dot, dash, or underscore only');
        return;
    }

    closeCustomModal();

    try {
        setLoading(true);
        const res = await fetch(
            `${API_BASE}/create?domain=${encodeURIComponent(selectedDomain)}&username=${encodeURIComponent(username)}`,
            { method: 'POST' }
        );
        const data = await res.json();

        if (!res.ok) { showToast(data.error || 'Failed to create custom email'); return; }

        if (data.email) {
            currentEmail = data.email;
            localStorage.setItem('currentEmail', currentEmail);
            allMessages = [];
            filterAndRender();
            updateCurrentEmailUI();
            startPolling();
            showToast(`Created ${currentEmail}`);
        }
    } catch (err) {
        console.error('Error creating custom email:', err);
        showToast('Error creating email');
    } finally {
        setLoading(false);
    }
}

if (customModal) {
    customModal.addEventListener('click', e => { if (e.target === customModal) closeCustomModal(); });
}
if (customUsernameInput) {
    customUsernameInput.addEventListener('keydown', e => { if (e.key === 'Enter') generateCustomEmail(); });
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function toggleSidebar() {
    if (sidebar) sidebar.classList.toggle('active');
}

document.addEventListener('click', e => {
    if (sidebar && sidebar.classList.contains('active')) {
        if (!sidebar.contains(e.target) && !e.target.closest('.mobile-menu-btn')) {
            sidebar.classList.remove('active');
        }
    }
});

// ─── Generate button ──────────────────────────────────────────────────────────

const generateBtn = document.getElementById('generateBtn');
if (generateBtn) generateBtn.addEventListener('click', generateEmail);

// ─── Expose to window for onclick handlers ────────────────────────────────────

window.generateEmail = generateEmail;
window.openCustomModal = openCustomModal;
window.closeCustomModal = closeCustomModal;
window.generateCustomEmail = generateCustomEmail;
window.openAccessModal = openAccessModal;
window.closeAccessModal = closeAccessModal;
window.accessExistingEmail = accessExistingEmail;
window.refreshInbox = refreshInbox;
window.deleteCurrentEmail = deleteCurrentEmail;
window.closeDetail = closeDetail;
window.copyEmail = copyEmail;
window.toggleSidebar = toggleSidebar;

// ─── Gmail Dot Trick Generator ────────────────────────────────────────────────

let gmailVariantsCache = [];

const gmailGeneratorModal = document.getElementById('gmailGeneratorModal');
const gmailGenInput       = document.getElementById('gmailGenInput');
const gmailGenList        = document.getElementById('gmailGenList');
const gmailGenStats       = document.getElementById('gmailGenStats');
const gmailGenCount       = document.getElementById('gmailGenCount');

function openGmailGeneratorModal() {
    if (gmailGeneratorModal) gmailGeneratorModal.classList.add('active');
    setTimeout(() => gmailGenInput && gmailGenInput.focus(), 100);
}

function closeGmailGeneratorModal() {
    if (gmailGeneratorModal) gmailGeneratorModal.classList.remove('active');
}

async function generateGmailDotVariants() {
    const email = gmailGenInput ? gmailGenInput.value.trim() : '';
    if (!email) { showToast('Masukkan alamat Gmail terlebih dahulu'); return; }

    const btn = document.getElementById('gmailGenBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }

    try {
        const res = await fetch(`${API_BASE}/gmail-generator?email=${encodeURIComponent(email)}`);
        const data = await res.json();

        if (!res.ok) { showToast(data.error || 'Gagal generate variasi'); return; }

        gmailVariantsCache = data.variants || [];
        renderGmailVariants(data.variants, data.truncated, data.total);
    } catch (err) {
        console.error('Gmail generator error:', err);
        showToast('Terjadi kesalahan');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Generate'; }
    }
}

function renderGmailVariants(variants, truncated, total) {
    if (!gmailGenList) return;
    gmailGenList.innerHTML = '';

    if (!variants || variants.length === 0) {
        gmailGenList.innerHTML = `<p class="text-center text-slate-400 text-sm py-10">Tidak ada variasi ditemukan.</p>`;
        if (gmailGenStats) gmailGenStats.classList.add('hidden');
        return;
    }

    // Stats bar
    if (gmailGenStats) gmailGenStats.classList.remove('hidden');
    if (gmailGenCount) {
        gmailGenCount.textContent = truncated
            ? `Menampilkan 200 dari ${total} variasi`
            : `${total} variasi ditemukan`;
    }

    variants.forEach((v, idx) => {
        const row = document.createElement('div');
        row.className = 'flex items-center gap-3 px-5 py-3 hover:bg-primary-50/60 dark:hover:bg-slate-800/60 transition-all group cursor-pointer';

        row.innerHTML = `
            <span class="text-xs font-bold text-slate-300 dark:text-slate-600 w-7 text-right shrink-0">${idx + 1}</span>
            <span class="flex-1 text-sm font-medium text-slate-700 dark:text-slate-200 truncate font-mono">${escapeHtml(v)}</span>
            <div class="flex items-center gap-1 shrink-0">
                <button data-email="${escapeHtml(v)}" title="Salin"
                    class="copy-variant-btn w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-slate-700 transition-all opacity-0 group-hover:opacity-100">
                    <ion-icon name="copy-outline" class="text-base pointer-events-none"></ion-icon>
                </button>
                <button data-email="${escapeHtml(v)}" title="Gunakan alamat ini"
                    class="use-variant-btn w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-green-600 hover:bg-green-50 dark:hover:bg-slate-700 transition-all opacity-0 group-hover:opacity-100">
                    <ion-icon name="checkmark-circle-outline" class="text-base pointer-events-none"></ion-icon>
                </button>
            </div>
        `;

        gmailGenList.appendChild(row);
    });

    // Event delegation — one listener for the whole list
    gmailGenList.onclick = (e) => {
        const copyBtn = e.target.closest('.copy-variant-btn');
        const useBtn  = e.target.closest('.use-variant-btn');

        if (copyBtn) {
            const addr = copyBtn.dataset.email;
            navigator.clipboard?.writeText(addr).catch(() => fallbackCopy(addr));
            showToast(`📋 ${addr} disalin!`);
        } else if (useBtn) {
            useGmailVariant(useBtn.dataset.email);
        }
    };
}

function useGmailVariant(email) {
    currentEmail = email;
    localStorage.setItem('currentEmail', email);
    allMessages = [];
    consecutiveEmptyPolls = 0;
    filterAndRender();
    updateCurrentEmailUI();
    stopPolling();
    startPolling();
    closeGmailGeneratorModal();
    showToast(`✅ Menggunakan ${email}`);
}

function copyAllGmailVariants() {
    if (!gmailVariantsCache.length) return;
    const text = gmailVariantsCache.join('\n');
    navigator.clipboard?.writeText(text)
        .then(() => showToast(`📋 ${gmailVariantsCache.length} alamat disalin!`))
        .catch(() => fallbackCopy(text));
}

if (gmailGeneratorModal) {
    gmailGeneratorModal.addEventListener('click', e => {
        if (e.target === gmailGeneratorModal) closeGmailGeneratorModal();
    });
}
if (gmailGenInput) {
    gmailGenInput.addEventListener('keydown', e => { if (e.key === 'Enter') generateGmailDotVariants(); });
}

window.openGmailGeneratorModal  = openGmailGeneratorModal;
window.closeGmailGeneratorModal = closeGmailGeneratorModal;
window.generateGmailDotVariants = generateGmailDotVariants;
window.copyAllGmailVariants     = copyAllGmailVariants;
