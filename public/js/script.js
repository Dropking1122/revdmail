const API_BASE = '/api';

let currentEmail = null;
let pollingInterval = null;
let allMessages = [];
let availableDomains = [];
let selectedDomain = '';
let activeAbortController = null;
let consecutiveEmptyPolls = 0;
const EMPTY_POLLS_BEFORE_CLEAR = 3;

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
        console.warn('⚠️ Gagal memuat daftar domain dari API:', err);
    }
    return false;
}

async function initializeDomainSelector() {
    await loadDomainsFromAPI();

    if (availableDomains.length === 0) {
        availableDomains = ['milmil.web.id'];
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

    showToast(`Beralih ke @${selectedDomain}…`);
    await generateEmail();
}

// ─── Initialization & Lifecycle ───────────────────────────────────────────────

async function init() {
    const params = new URLSearchParams(window.location.search);
    const queryEmail = params.get('email');
    if (queryEmail && queryEmail.includes('@')) {
        currentEmail = queryEmail.trim().toLowerCase();
        localStorage.setItem('currentEmail', currentEmail);
        updateCurrentEmailUI();
        startPolling();
        showToast(`Mengakses ${currentEmail}`);
        return;
    }

    const savedEmail = localStorage.getItem('currentEmail');
    if (savedEmail) {
        currentEmail = savedEmail.trim().toLowerCase();
        updateCurrentEmailUI();
        startPolling();
        showToast(`Mengakses ${currentEmail}`);
        return;
    }

    await generateEmail();
}

document.addEventListener('DOMContentLoaded', async () => {
    await initializeDomainSelector();
    await init();
});

// Pause polling when browser tab is inactive to save battery and network
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        stopPolling();
    } else {
        if (currentEmail) {
            fetchMessages();
            startPolling();
        }
    }
});

// ─── API Calls ────────────────────────────────────────────────────────────────

let isGenerating = false;

async function generateEmail() {
    if (isGenerating) return;
    isGenerating = true;

    if (activeAbortController) {
        activeAbortController.abort();
    }

    try {
        setLoading(true);
        const res = await fetch(`${API_BASE}/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ domain: selectedDomain })
        });
        const data = await res.json();

        if (!res.ok) {
            showToast(data.error || 'Gagal membuat alamat email.');
            return;
        }

        if (data.email) {
            currentEmail = data.email.toLowerCase();
            localStorage.setItem('currentEmail', currentEmail);
            allMessages = [];
            consecutiveEmptyPolls = 0;
            filterAndRender();
            updateCurrentEmailUI();
            startPolling();
            showToast('Alamat baru siap digunakan!');
        }
    } catch (err) {
        if (err.name !== 'AbortError') {
            console.error('❌ Error creating email:', err);
            showToast('Gagal membuat alamat email.');
        }
    } finally {
        isGenerating = false;
        setLoading(false);
    }
}

async function fetchMessages() {
    if (!currentEmail) return;

    if (activeAbortController) {
        activeAbortController.abort();
    }
    activeAbortController = new AbortController();
    const queryEmail = currentEmail;

    try {
        const res = await fetch(`${API_BASE}/messages?email=${encodeURIComponent(queryEmail)}`, {
            signal: activeAbortController.signal
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
            showToast(err.error || 'Gagal memeriksa pesan.');
            return;
        }

        const data = await res.json();

        // Check if user changed email while request was awaiting
        if (currentEmail !== queryEmail) return;

        if (Array.isArray(data.messages)) {
            if (data.messages.length > 0) {
                consecutiveEmptyPolls = 0;
                allMessages = data.messages;
                filterAndRender();
            } else {
                consecutiveEmptyPolls++;
                if (consecutiveEmptyPolls >= EMPTY_POLLS_BEFORE_CLEAR) {
                    allMessages = [];
                    filterAndRender();
                }
            }
        }
    } catch (err) {
        if (err.name !== 'AbortError') {
            console.warn('Gagal memuat pesan:', err.message);
        }
    }
}

async function deleteCurrentEmail() {
    if (!currentEmail) return;

    if (!confirm(`Hapus alamat ${currentEmail}?\n\nAlamat baru akan dibuat secara otomatis.`)) {
        return;
    }

    if (activeAbortController) {
        activeAbortController.abort();
    }

    try {
        const res = await fetch(`${API_BASE}/delete?email=${encodeURIComponent(currentEmail)}`, {
            method: 'DELETE'
        });

        if (res.ok) {
            showToast('Alamat berhasil dibersihkan.');
            currentEmail = null;
            allMessages = [];
            localStorage.removeItem('currentEmail');
            stopPolling();
            filterAndRender();
            updateCurrentEmailUI();
            await generateEmail();
        } else {
            showToast('Gagal menghapus alamat.');
        }
    } catch (err) {
        console.error('Error deleting:', err);
        showToast('Terjadi kesalahan saat menghapus.');
    }
}

// ─── UI Logic ─────────────────────────────────────────────────────────────────

function updateCurrentEmailUI() {
    const text = currentEmail || 'Tidak Ada Email Aktif';

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
            (msg.from_email || '').toLowerCase().includes(query) ||
            (msg.text || '').toLowerCase().includes(query)
          )
        : allMessages;

    renderEmailList(filtered);
}

function renderEmailList(messages) {
    if (!emailListContainer) return;

    emailListContainer.innerHTML = '';

    const countBadge = document.getElementById('msgCount');
    if (countBadge) {
        if (messages && messages.length > 0) {
            countBadge.textContent = messages.length;
            countBadge.classList.remove('hidden');
        } else {
            countBadge.classList.add('hidden');
        }
    }

    if (!messages || messages.length === 0) {
        if (emptyState) {
            emptyState.classList.replace('opacity-0', 'opacity-100');
            emptyState.classList.remove('pointer-events-none');
        }
        return;
    }

    if (emptyState) {
        emptyState.classList.replace('opacity-100', 'opacity-0');
        emptyState.classList.add('pointer-events-none');
    }

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
                    <span class="text-sm text-slate-600 dark:text-slate-300 truncate font-medium">${escapeHtml(msg.subject || '(Tidak Ada Subjek)')}</span>
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

    detailSubject.textContent = msg.subject || '(Tidak Ada Subjek)';

    let senderName = msg.from || 'Unknown';
    if (senderName.includes('<')) {
        senderName = senderName.split('<')[0].trim().replace(/^["']|["']$/g, '');
    }

    detailSenderName.textContent = senderName;
    detailSenderEmail.textContent = msg.from_email ? `<${msg.from_email}>` : '';

    const date = new Date(msg.date);
    const opts = { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' };
    detailDate.textContent = isNaN(date) ? '' : date.toLocaleDateString('id-ID', opts);

    const recipientEl = document.getElementById('detailRecipient');
    if (recipientEl) recipientEl.textContent = currentEmail || '';

    senderAvatar.textContent = (msg.from || 'U').charAt(0).toUpperCase();

    // Secure HTML isolation using a sandboxed iframe
    if (msg.html) {
        const clean = (typeof DOMPurify !== 'undefined')
            ? DOMPurify.sanitize(msg.html, {
                FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form'],
                ADD_ATTR: ['target']
            })
            : msg.html;

        const iframe = document.createElement('iframe');
        iframe.className = 'w-full h-full border-0 min-h-[480px] bg-white rounded-2xl';
        iframe.setAttribute('sandbox', 'allow-popups allow-popups-to-escape-sandbox');

        detailBody.innerHTML = '';
        detailBody.appendChild(iframe);

        iframe.srcdoc = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <base target="_blank">
                <style>
                    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #1e293b; margin: 16px; word-break: break-word; }
                    img { max-width: 100% !important; height: auto !important; }
                    table { max-width: 100% !important; }
                    a { color: #2563eb; }
                </style>
            </head>
            <body>
                ${clean}
            </body>
            </html>
        `;
    } else {
        detailBody.innerHTML = `<pre class="whitespace-pre-wrap font-sans text-sm p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl text-slate-800 dark:text-slate-200">${escapeHtml(msg.text || '(Tidak Ada Konten)')}</pre>`;
    }

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
            .then(() => showToast('📋 Alamat berhasil disalin!'))
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
        showToast('📋 Berhasil disalin!');
    } catch {
        showToast('Gagal menyalin otomatis, silakan salin manual.');
    }
    document.body.removeChild(el);
}

async function refreshInbox() {
    const icon = document.querySelector('#refreshBtn ion-icon');
    if (icon) icon.classList.add('rotating');

    showToast('Memeriksa pesan masuk…');
    await fetchMessages();

    if (icon) icon.classList.remove('rotating');
    showToast('Inbox diperbarui.');
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
    if (span) span.textContent = on ? 'Membuat…' : 'New Address';
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
    const email = accessEmailInput ? accessEmailInput.value.trim().toLowerCase() : '';

    if (!email) { showToast('Masukkan alamat email.'); return; }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) { showToast('Format email tidak valid.'); return; }

    const domain = email.split('@')[1];
    const isGmail = (domain === 'gmail.com' || domain === 'googlemail.com');

    if (!isGmail && !availableDomains.includes(domain)) {
        showToast(`Domain @${domain} tidak didukung.`);
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
    showToast(`Mengakses ${email}`);
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

    if (!username) { showToast('Masukkan username pilihan.'); return; }
    if (!/^[a-zA-Z0-9._-]+$/.test(username)) {
        showToast('Gunakan huruf, angka, titik, strip, atau underscore saja.');
        return;
    }

    closeCustomModal();

    if (activeAbortController) {
        activeAbortController.abort();
    }

    try {
        setLoading(true);
        const res = await fetch(`${API_BASE}/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ domain: selectedDomain, username })
        });
        const data = await res.json();

        if (!res.ok) { showToast(data.error || 'Gagal membuat alamat kustom.'); return; }

        if (data.email) {
            currentEmail = data.email.toLowerCase();
            localStorage.setItem('currentEmail', currentEmail);
            allMessages = [];
            consecutiveEmptyPolls = 0;
            filterAndRender();
            updateCurrentEmailUI();
            startPolling();
            showToast(`Dibuat: ${currentEmail}`);
        }
    } catch (err) {
        if (err.name !== 'AbortError') {
            console.error('Error creating custom email:', err);
            showToast('Gagal membuat alamat kustom.');
        }
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

// Expose handlers to window
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

const gmailGeneratorPage = document.getElementById('gmailGeneratorPage');
const gmailGenInput      = document.getElementById('gmailGenInput');
const gmailGenList       = document.getElementById('gmailGenList');
const gmailGenStats      = document.getElementById('gmailGenStats');
const gmailGenCount      = document.getElementById('gmailGenCount');

function openGmailGeneratorPage() {
    if (gmailGeneratorPage) gmailGeneratorPage.classList.add('active');
    document.getElementById('mainCard')?.classList.add('gmail-gen-active');
    setTimeout(() => gmailGenInput && gmailGenInput.focus(), 300);
}

function closeGmailGeneratorPage() {
    if (gmailGeneratorPage) gmailGeneratorPage.classList.remove('active');
    document.getElementById('mainCard')?.classList.remove('gmail-gen-active');
}

async function generateGmailDotVariants() {
    const email = gmailGenInput ? gmailGenInput.value.trim() : '';
    if (!email) { showToast('Masukkan alamat Gmail terlebih dahulu.'); return; }

    const btn = document.getElementById('gmailGenBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Memproses…'; }

    try {
        const res = await fetch(`${API_BASE}/gmail-generator?email=${encodeURIComponent(email)}`);
        const data = await res.json();

        if (!res.ok) { showToast(data.error || 'Gagal menghasilkan variasi.'); return; }

        gmailVariantsCache = data.variants || [];
        renderGmailVariants(data.variants, data.truncated, data.total);
    } catch (err) {
        console.error('Gmail generator error:', err);
        showToast('Terjadi kesalahan saat membuat variasi.');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Generate'; }
    }
}

function renderGmailVariants(variants, truncated, total) {
    if (!gmailGenList) return;
    gmailGenList.innerHTML = '';

    if (!variants || variants.length === 0) {
        gmailGenList.innerHTML = `<p class="text-center text-slate-400 text-sm py-10">Tidak ada variasi yang ditemukan.</p>`;
        if (gmailGenStats) gmailGenStats.classList.add('hidden');
        return;
    }

    if (gmailGenStats) gmailGenStats.classList.remove('hidden');
    if (gmailGenCount) {
        gmailGenCount.textContent = truncated
            ? `Menampilkan ${variants.length} dari ${total} variasi`
            : `${total} variasi berhasil dibuat`;
    }

    variants.forEach((v, idx) => {
        const row = document.createElement('div');
        row.className = 'flex items-center gap-3 px-5 py-3 hover:bg-primary-50/60 dark:hover:bg-slate-800/60 transition-all group cursor-pointer';

        row.innerHTML = `
            <span class="text-xs font-bold text-slate-300 dark:text-slate-600 w-7 text-right shrink-0">${idx + 1}</span>
            <span class="flex-1 text-sm font-medium text-slate-700 dark:text-slate-200 truncate font-mono">${escapeHtml(v)}</span>
            <div class="flex items-center gap-1 shrink-0">
                <button data-email="${escapeHtml(v)}" title="Salin Alamat"
                    class="copy-variant-btn px-2.5 py-1.5 flex items-center gap-1 text-xs font-semibold rounded-lg text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 hover:bg-primary-50 dark:hover:bg-primary-900/30 hover:text-primary-600 transition-all">
                    <ion-icon name="copy-outline" class="text-sm pointer-events-none"></ion-icon>
                    <span>Salin</span>
                </button>
            </div>
        `;

        gmailGenList.appendChild(row);
    });

    gmailGenList.onclick = (e) => {
        const copyBtn = e.target.closest('.copy-variant-btn');
        if (copyBtn) {
            const addr = copyBtn.dataset.email;
            navigator.clipboard?.writeText(addr).catch(() => fallbackCopy(addr));
            showToast(`📋 ${addr} berhasil disalin!`);
        }
    };
}

function copyAllGmailVariants() {
    if (!gmailVariantsCache.length) return;
    const text = gmailVariantsCache.join('\n');
    navigator.clipboard?.writeText(text)
        .then(() => showToast(`📋 ${gmailVariantsCache.length} alamat berhasil disalin!`))
        .catch(() => fallbackCopy(text));
}

if (gmailGenInput) {
    gmailGenInput.addEventListener('keydown', e => { if (e.key === 'Enter') generateGmailDotVariants(); });
}

window.openGmailGeneratorPage = openGmailGeneratorPage;
window.closeGmailGeneratorPage = closeGmailGeneratorPage;
window.generateGmailDotVariants = generateGmailDotVariants;
window.copyAllGmailVariants = copyAllGmailVariants;

// ─── About & Donasi Pages ─────────────────────────────────────────────────────

function closeAllOverlayPages() {
    document.getElementById('aboutPage')?.classList.remove('active');
    document.getElementById('donasiPage')?.classList.remove('active');
    document.getElementById('mainCard')?.classList.remove('about-active', 'donasi-active');
}

function openAboutPage() {
    closeAllOverlayPages();
    document.getElementById('aboutPage')?.classList.add('active');
    document.getElementById('mainCard')?.classList.add('about-active');
}

function closeAboutPage() {
    document.getElementById('aboutPage')?.classList.remove('active');
    document.getElementById('mainCard')?.classList.remove('about-active');
}

function openDonasiPage() {
    closeAllOverlayPages();
    document.getElementById('donasiPage')?.classList.add('active');
    document.getElementById('mainCard')?.classList.add('donasi-active');
}

function closeDonasiPage() {
    document.getElementById('donasiPage')?.classList.remove('active');
    document.getElementById('mainCard')?.classList.remove('donasi-active');
}

function copyRek(elId, btn) {
    const text = document.getElementById(elId)?.textContent?.trim();
    if (!text) return;
    navigator.clipboard?.writeText(text).catch(() => fallbackCopy(text));
    const orig = btn.innerHTML;
    btn.innerHTML = '<ion-icon name="checkmark-outline" class="text-sm"></ion-icon> Tersalin!';
    btn.classList.add('text-green-600', '!bg-green-50');
    setTimeout(() => { btn.innerHTML = orig; btn.classList.remove('text-green-600', '!bg-green-50'); }, 2000);
}

window.openAboutPage  = openAboutPage;
window.closeAboutPage = closeAboutPage;
window.openDonasiPage  = openDonasiPage;
window.closeDonasiPage = closeDonasiPage;
window.copyRek         = copyRek;
