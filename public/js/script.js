const API_BASE = '/api';

let currentEmail = null;
let pollingInterval = null;
let allMessages = [];
let availableDomains = [];
let selectedDomain = '';
let activeAbortController = null;
let consecutiveEmptyPolls = 0;
const EMPTY_POLLS_BEFORE_CLEAR = 3;
let currentDetectedOtp = null;
let currentDetailText = '';

// Countdown Timer State
let countdownSeconds = 15;
let countdownInterval = null;

// DOM Elements
const currentEmailText = document.getElementById('currentEmailText');
const mobileActiveEmail = document.getElementById('mobileActiveEmail');
const sidebarEmailDisplay = document.getElementById('sidebarEmailDisplay');
const sidebarMsgCount = document.getElementById('sidebarMsgCount');
const sidebarNavCount = document.getElementById('sidebarNavCount');
const sidebarStatusText = document.getElementById('sidebarStatusText');
const mobileMsgCountBadge = document.getElementById('mobileMsgCountBadge');
const emailListContainer = document.getElementById('emailList');
const emptyState = document.getElementById('emptyState');
const skeletonLoading = document.getElementById('skeletonLoading');
const customDomainSelector = document.getElementById('customDomainSelector');
const domainTrigger = document.getElementById('domainTrigger');
const domainOptions = document.getElementById('domainOptions');
const selectedDomainText = document.getElementById('selectedDomainText');
const mobileDomainOptions = document.getElementById('mobileDomainOptions');
const mobileSelectedDomainText = document.getElementById('mobileSelectedDomainText');
const detailView = document.getElementById('emailDetailView');
const detailSubject = document.getElementById('detailSubject');
const detailSenderName = document.getElementById('detailSenderName');
const detailSenderEmail = document.getElementById('detailSenderEmail');
const senderAvatar = document.getElementById('senderAvatar');
const detailDate = document.getElementById('detailDate');
const detailRecipient = document.getElementById('detailRecipient');
const detailBody = document.getElementById('detailBody');
const detailOtpBanner = document.getElementById('detailOtpBanner');
const detailOtpCode = document.getElementById('detailOtpCode');
const searchInput = document.getElementById('searchInput');
const liveSyncStatus = document.getElementById('liveSyncStatus');
const liveSyncText = document.getElementById('liveSyncText');
const mobileLiveSyncLabel = document.getElementById('mobileLiveSyncLabel');
const mobileSyncPing = document.getElementById('mobileSyncPing');
const mobileSyncDot = document.getElementById('mobileSyncDot');

// ─── OTP / VERIFICATION CODE PARSER ───────────────────────────────────────────

function extractOTP(subject, bodyText) {
    const text = `${subject || ''} ${bodyText || ''}`.trim();
    if (!text) return null;

    // Pattern 1: Explicit labels (code/kode/otp/pin/token/verifikasi/verification)
    const labelMatch = text.match(/(?:code|kode|otp|pin|token|verifikasi|verification)[\s:=#\-]*([0-9]{4,8}|[A-Z0-9]{5,8})\b/i);
    if (labelMatch && labelMatch[1]) {
        return labelMatch[1];
    }

    // Pattern 2: Standalone 4-8 digits in known transactional/security contexts
    if (/(?:canva|google|facebook|instagram|telegram|whatsapp|discord|github|twitter|x\.com|apple|microsoft|login|verify|masuk|daftar|konfirmasi)/i.test(text)) {
        const numMatch = text.match(/\b([0-9]{4,8})\b/);
        if (numMatch && numMatch[1]) {
            return numMatch[1];
        }
    }

    return null;
}

async function copyToClipboard(text) {
    if (!text) return false;
    if (navigator.clipboard && window.isSecureContext) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch {}
    }
    try {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.top = '-9999px';
        textArea.style.left = '-9999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        const success = document.execCommand('copy');
        document.body.removeChild(textArea);
        return success;
    } catch {
        return false;
    }
}

window.copyOTP = async function (code) {
    if (!code) return;
    await copyToClipboard(code);
    showToast(`Kode OTP ${code} berhasil disalin!`, 'success');
};

window.copyDetectedOtp = function () {
    if (currentDetectedOtp) {
        copyOTP(currentDetectedOtp);
    }
};

// ─── COUNTDOWN PROGRESS BAR ───────────────────────────────────────────────────

function resetCountdown() {
    countdownSeconds = 15;
    updateCountdownUI();
}

function updateCountdownUI() {
    const desktopTimer = document.getElementById('refreshTimerLabel');
    const mobileTimer = document.getElementById('mobileRefreshTimerLabel');
    const progressBar = document.getElementById('refreshProgressBar');

    if (desktopTimer) desktopTimer.textContent = `Perbarui: ${countdownSeconds}s`;
    if (mobileTimer) mobileTimer.textContent = `${countdownSeconds}s`;

    if (progressBar) {
        const pct = Math.max(0, Math.min(100, (countdownSeconds / 15) * 100));
        progressBar.style.width = `${pct}%`;
    }
}

function startCountdown() {
    stopCountdown();
    countdownSeconds = 15;
    updateCountdownUI();
    countdownInterval = setInterval(() => {
        countdownSeconds--;
        if (countdownSeconds <= 0) {
            countdownSeconds = 15;
        }
        updateCountdownUI();
    }, 1000);
}

function stopCountdown() {
    if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
    }
}

function setLiveSyncState(state) {
    if (state === 'active') {
        if (liveSyncText) liveSyncText.textContent = 'Live Sync';
        if (mobileLiveSyncLabel) mobileLiveSyncLabel.textContent = 'Live Sync';
        if (sidebarStatusText) sidebarStatusText.textContent = 'Live Sync';
        if (mobileSyncPing) mobileSyncPing.classList.remove('hidden');
        if (mobileSyncDot) {
            mobileSyncDot.className = 'relative inline-flex rounded-full h-2 w-2 bg-emerald-500';
        }
    } else if (state === 'paused') {
        if (liveSyncText) liveSyncText.textContent = 'Dijeda';
        if (mobileLiveSyncLabel) mobileLiveSyncLabel.textContent = 'Dijeda';
        if (sidebarStatusText) sidebarStatusText.textContent = 'Dijeda';
        if (mobileSyncPing) mobileSyncPing.classList.add('hidden');
        if (mobileSyncDot) {
            mobileSyncDot.className = 'relative inline-flex rounded-full h-2 w-2 bg-amber-500';
        }
    } else if (state === 'syncing') {
        if (liveSyncText) liveSyncText.textContent = 'Sinkron...';
        if (mobileLiveSyncLabel) mobileLiveSyncLabel.textContent = 'Sinkron...';
        if (sidebarStatusText) sidebarStatusText.textContent = 'Sinkron...';
    }
}

// ─── DOMAIN MANAGEMENT ────────────────────────────────────────────────────────

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
        console.warn('Gagal memuat daftar domain dari API:', err);
    }
    return false;
}

async function initializeDomainSelector() {
    await loadDomainsFromAPI();

    if (availableDomains.length === 0) {
        availableDomains = ['revd.me'];
    }

    const savedDomain = localStorage.getItem('selectedDomain');
    selectedDomain = (savedDomain && availableDomains.includes(savedDomain))
        ? savedDomain
        : availableDomains[0];

    renderDomainOptions();

    if (domainTrigger) {
        domainTrigger.addEventListener('click', (e) => {
            e.stopPropagation();
            if (customDomainSelector) {
                customDomainSelector.classList.toggle('active');
                domainTrigger.setAttribute('aria-expanded', customDomainSelector.classList.contains('active'));
            }
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
    const domainLabel = `@${selectedDomain}`;
    if (selectedDomainText) selectedDomainText.textContent = domainLabel;
    if (mobileSelectedDomainText) mobileSelectedDomainText.textContent = domainLabel;

    const customModalDomain = document.getElementById('customModalDomainDisplay');
    if (customModalDomain) customModalDomain.textContent = domainLabel;

    // Desktop Options
    if (domainOptions) {
        domainOptions.innerHTML = '';
        availableDomains.forEach(domain => {
            const option = document.createElement('button');
            const isSelected = domain === selectedDomain;
            option.className = [
                'w-full text-left px-4 py-2.5 text-xs font-semibold rounded-xl transition-all flex items-center justify-between',
                isSelected
                    ? 'bg-primary-600 text-white shadow-sm'
                    : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/60'
            ].join(' ');
            option.innerHTML = `
                <span>@${escapeHtml(domain)}</span>
                ${isSelected ? '<ion-icon name="checkmark-outline" class="text-sm"></ion-icon>' : ''}
            `;
            option.setAttribute('type', 'button');
            option.addEventListener('click', (e) => {
                e.stopPropagation();
                selectDomain(domain);
            });
            domainOptions.appendChild(option);
        });
    }

    // Mobile Options
    if (mobileDomainOptions) {
        mobileDomainOptions.innerHTML = '';
        availableDomains.forEach(domain => {
            const option = document.createElement('button');
            const isSelected = domain === selectedDomain;
            option.className = [
                'w-full text-left px-3.5 py-2 text-xs font-semibold transition-all flex items-center justify-between border-b border-slate-100 dark:border-slate-700/60 last:border-0',
                isSelected
                    ? 'bg-primary-50 dark:bg-primary-950/60 text-primary-600 dark:text-primary-400 font-bold'
                    : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/40'
            ].join(' ');
            option.innerHTML = `
                <span>@${escapeHtml(domain)}</span>
                ${isSelected ? '<ion-icon name="checkmark-outline" class="text-sm"></ion-icon>' : ''}
            `;
            option.setAttribute('type', 'button');
            option.addEventListener('click', (e) => {
                e.stopPropagation();
                if (mobileDomainOptions) mobileDomainOptions.classList.add('hidden');
                selectDomain(domain);
            });
            mobileDomainOptions.appendChild(option);
        });
    }
}

async function selectDomain(domain) {
    if (domain === selectedDomain) {
        if (customDomainSelector) customDomainSelector.classList.remove('active');
        if (domainTrigger) domainTrigger.setAttribute('aria-expanded', 'false');
        return;
    }

    selectedDomain = domain;
    localStorage.setItem('selectedDomain', selectedDomain);
    renderDomainOptions();

    if (customDomainSelector) customDomainSelector.classList.remove('active');
    if (domainTrigger) domainTrigger.setAttribute('aria-expanded', 'false');

    showToast(`Beralih ke domain @${selectedDomain}`, 'info');
    await generateEmail(true);
}

// ─── EMAIL DISPLAY & PERSISTENCE ──────────────────────────────────────────────

function updateActiveEmailDisplays(email) {
    const text = email || 'Memuat alamat...';
    if (currentEmailText) currentEmailText.textContent = text;
    if (mobileActiveEmail) mobileActiveEmail.textContent = text;
    if (sidebarEmailDisplay) sidebarEmailDisplay.textContent = text;
}

function saveCurrentEmail(email) {
    currentEmail = email;
    if (email) {
        localStorage.setItem('tempEmail', email);
        const parts = email.split('@');
        if (parts.length === 2 && availableDomains.includes(parts[1])) {
            selectedDomain = parts[1];
            localStorage.setItem('selectedDomain', selectedDomain);
            renderDomainOptions();
        }
    } else {
        localStorage.removeItem('tempEmail');
    }
    updateActiveEmailDisplays(email);
}

// ─── CREATE & SWITCH EMAIL ───────────────────────────────────────────────────

async function generateEmail(forceNew = false) {
    if (activeAbortController) {
        activeAbortController.abort();
        activeAbortController = null;
    }

    if (!forceNew) {
        const saved = localStorage.getItem('tempEmail');
        if (saved && /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(saved)) {
            saveCurrentEmail(saved);
            consecutiveEmptyPolls = 0;
            allMessages = [];
            renderEmailList();
            showSkeleton(true);
            await fetchMessages();
            startPolling();
            return;
        }
    }

    showSkeleton(true);
    try {
        const res = await fetch(`${API_BASE}/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ domain: selectedDomain })
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        if (data.email) {
            saveCurrentEmail(data.email);
            consecutiveEmptyPolls = 0;
            allMessages = [];
            renderEmailList();
            showToast(`Alamat baru siap: ${data.email}`, 'success');
            await fetchMessages();
            startPolling();
        }
    } catch (err) {
        showSkeleton(false);
        showToast('Gagal membuat alamat baru. Coba lagi.', 'error');
    }
}

async function generateCustomEmail() {
    const input = document.getElementById('customUsernameInput');
    const username = (input ? input.value : '').trim();

    if (!username) {
        showToast('Masukkan username pilihanmu.', 'error');
        return;
    }

    if (!/^[a-zA-Z0-9._-]+$/.test(username)) {
        showToast('Username hanya boleh huruf, angka, titik, minus, dan underscore.', 'error');
        return;
    }

    showSkeleton(true);
    closeCustomModal();

    try {
        const res = await fetch(`${API_BASE}/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ domain: selectedDomain, username })
        });

        const data = await res.json();
        if (!res.ok) {
            showSkeleton(false);
            showToast(data.error || 'Gagal membuat alamat kustom.', 'error');
            return;
        }

        if (data.email) {
            saveCurrentEmail(data.email);
            consecutiveEmptyPolls = 0;
            allMessages = [];
            renderEmailList();
            showToast(`Alamat kustom dibuat: ${data.email}`, 'success');
            await fetchMessages();
            startPolling();
        }
    } catch (err) {
        showSkeleton(false);
        showToast('Terjadi kesalahan jaringan.', 'error');
    }
}

async function accessExistingEmail() {
    const input = document.getElementById('accessEmailInput');
    const email = (input ? input.value : '').trim().toLowerCase();

    if (!email || !/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email)) {
        showToast('Format email tidak valid.', 'error');
        return;
    }

    closeAccessModal();
    showSkeleton(true);
    saveCurrentEmail(email);
    consecutiveEmptyPolls = 0;
    allMessages = [];
    renderEmailList();

    showToast(`Memeriksa kotak masuk ${email}…`, 'info');
    await fetchMessages();
    startPolling();
}

// ─── FETCH & RENDER MESSAGES ──────────────────────────────────────────────────

function showSkeleton(show) {
    if (skeletonLoading) {
        skeletonLoading.classList.toggle('hidden', !show);
    }
    if (show && emptyState) {
        emptyState.classList.add('opacity-0', 'pointer-events-none');
    }
}

async function fetchMessages(isManual = false) {
    if (!currentEmail) return;

    if (activeAbortController) {
        activeAbortController.abort();
    }
    activeAbortController = new AbortController();

    const refreshBtn = document.getElementById('refreshBtn');
    const mobileRefreshBtn = document.getElementById('mobileRefreshBtn');
    if (refreshBtn) refreshBtn.classList.add('rotating');
    if (mobileRefreshBtn) mobileRefreshBtn.classList.add('rotating');

    setLiveSyncState('syncing');

    try {
        const res = await fetch(`${API_BASE}/messages?email=${encodeURIComponent(currentEmail)}`, {
            signal: activeAbortController.signal
        });

        if (res.status === 403) {
            showToast('Alamat email ditolak oleh server.', 'error');
            stopPolling();
            showSkeleton(false);
            setLiveSyncState('paused');
            return;
        }

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();
        const incoming = (data && Array.isArray(data.messages)) ? data.messages : [];

        if (incoming.length === 0) {
            consecutiveEmptyPolls++;
            if (consecutiveEmptyPolls >= EMPTY_POLLS_BEFORE_CLEAR) {
                allMessages = [];
            }
        } else {
            consecutiveEmptyPolls = 0;
            allMessages = incoming;
        }

        renderEmailList();
        resetCountdown();
        setLiveSyncState('active');

        if (isManual) {
            showToast(incoming.length > 0 ? `${incoming.length} pesan ditemukan` : 'Belum ada email baru', 'info');
        }
    } catch (err) {
        if (err.name === 'AbortError') return;
        console.warn('Gagal memuat pesan:', err);
        setLiveSyncState('paused');
    } finally {
        showSkeleton(false);
        if (refreshBtn) refreshBtn.classList.remove('rotating');
        if (mobileRefreshBtn) mobileRefreshBtn.classList.remove('rotating');
    }
}

function renderEmailList() {
    if (!emailListContainer) return;

    const query = (searchInput ? searchInput.value : '').toLowerCase().trim();
    const filtered = query
        ? allMessages.filter(m =>
            (m.subject && m.subject.toLowerCase().includes(query)) ||
            (m.from && m.from.toLowerCase().includes(query)) ||
            (m.intro && m.intro.toLowerCase().includes(query))
        )
        : allMessages;

    // Update message count indicators across all touchpoints
    if (sidebarNavCount) {
        sidebarNavCount.textContent = filtered.length;
        sidebarNavCount.classList.toggle('hidden', filtered.length === 0);
    }
    if (sidebarMsgCount) {
        sidebarMsgCount.textContent = filtered.length;
    }
    if (mobileMsgCountBadge) {
        mobileMsgCountBadge.textContent = `${filtered.length} Pesan`;
    }

    if (filtered.length === 0) {
        emailListContainer.innerHTML = '';
        if (emptyState) {
            emptyState.classList.remove('opacity-0', 'pointer-events-none');
            emptyState.classList.add('opacity-100');
        }
        return;
    }

    if (emptyState) {
        emptyState.classList.add('opacity-0', 'pointer-events-none');
        emptyState.classList.remove('opacity-100');
    }

    emailListContainer.innerHTML = '';

    filtered.forEach(msg => {
        const row = document.createElement('div');
        row.className = 'flex items-start gap-3.5 p-4 hover:bg-slate-50 dark:hover:bg-slate-850 cursor-pointer transition-colors active:bg-slate-100 dark:active:bg-slate-800';

        const senderName = parseSenderName(msg.from);
        const senderEmail = parseSenderEmail(msg.from);
        const initial = (senderName || 'A').charAt(0).toUpperCase();
        const dateStr = formatDate(msg.date);
        const otp = extractOTP(msg.subject, msg.text || msg.intro || '');

        row.innerHTML = `
            <div class="w-10 h-10 rounded-2xl bg-gradient-to-tr from-primary-600 to-primary-400 text-white flex items-center justify-center text-sm font-bold shrink-0 shadow-sm">
                ${escapeHtml(initial)}
            </div>
            <div class="flex-1 min-w-0">
                <div class="flex items-center justify-between gap-2 mb-0.5">
                    <span class="font-semibold text-xs sm:text-sm text-slate-900 dark:text-white truncate">
                        ${escapeHtml(senderName)}
                    </span>
                    <time class="text-[11px] text-slate-400 dark:text-slate-500 shrink-0 font-medium">
                        ${escapeHtml(dateStr)}
                    </time>
                </div>
                <div class="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate mb-1">
                    ${escapeHtml(msg.subject || '(Tanpa Subjek)')}
                </div>
                <div class="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-1">
                    ${escapeHtml(msg.intro || msg.text || '(Tidak ada teks pratinjau)')}
                </div>
                ${otp ? `
                    <div class="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 bg-amber-50 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-800/80 rounded-xl text-xs font-bold text-amber-900 dark:text-amber-200">
                        <span class="text-[10px] text-amber-700 dark:text-amber-400 font-extrabold uppercase tracking-wider">KODE:</span>
                        <span class="font-mono text-sm tracking-widest bg-white dark:bg-slate-900 px-2 py-0.5 rounded-lg border border-amber-200 dark:border-amber-700 text-slate-900 dark:text-white font-black">${escapeHtml(otp)}</span>
                        <button onclick="event.stopPropagation(); copyOTP('${escapeHtml(otp)}')"
                            class="px-2 py-0.5 bg-amber-500 hover:bg-amber-600 text-white text-[10px] font-extrabold rounded-lg uppercase tracking-wider transition-colors active:scale-95 ml-1">
                            SALIN
                        </button>
                    </div>
                ` : ''}
            </div>
        `;

        row.addEventListener('click', () => openDetail(msg));
        emailListContainer.appendChild(row);
    });
}

// ─── DETAIL VIEW & SANDBOXED EMAIL RENDERING ─────────────────────────────────

async function openDetail(msg) {
    if (!detailView) return;

    detailSubject.textContent = msg.subject || '(Tanpa Subjek)';
    detailSenderName.textContent = parseSenderName(msg.from);
    detailSenderEmail.textContent = `<${parseSenderEmail(msg.from)}>`;
    detailRecipient.textContent = currentEmail;
    detailDate.textContent = formatFullDate(msg.date);
    senderAvatar.textContent = (parseSenderName(msg.from) || 'A').charAt(0).toUpperCase();

    // Check & display detected OTP
    const otp = extractOTP(msg.subject, msg.text || msg.intro || '');
    currentDetectedOtp = otp;
    if (detailOtpBanner && detailOtpCode) {
        if (otp) {
            detailOtpBanner.classList.remove('hidden');
            detailOtpCode.textContent = otp;
        } else {
            detailOtpBanner.classList.add('hidden');
        }
    }

    detailBody.innerHTML = `
        <div class="space-y-4 p-4 animate-pulse">
            <div class="h-4 bg-slate-200 dark:bg-slate-800 rounded w-1/4"></div>
            <div class="h-3 bg-slate-100 dark:bg-slate-850 rounded w-full"></div>
            <div class="h-3 bg-slate-100 dark:bg-slate-850 rounded w-5/6"></div>
            <div class="h-3 bg-slate-100 dark:bg-slate-850 rounded w-2/3"></div>
        </div>
    `;

    detailView.classList.add('active');

    let fullHtml = msg.html || null;
    let fullText = msg.text || msg.intro || null;

    if (!fullHtml && (!fullText || fullText.length < 50)) {
        try {
            const res = await fetch(`${API_BASE}/message/${msg.id}?email=${encodeURIComponent(currentEmail)}`);
            if (res.ok) {
                const data = await res.json();
                if (data.message) {
                    fullHtml = data.message.html || fullHtml;
                    fullText = data.message.text || fullText;
                }
            }
        } catch (err) {
            console.warn('Gagal memuat body pesan lengkap:', err);
        }
    }

    currentDetailText = fullText || '';
    renderEmailBody(fullHtml, fullText);
}

function renderEmailBody(htmlContent, textContent) {
    if (!detailBody) return;

    if (htmlContent) {
        const cleanHtml = (typeof DOMPurify !== 'undefined')
            ? DOMPurify.sanitize(htmlContent, {
                FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form'],
                ADD_ATTR: ['target']
            })
            : htmlContent;

        const iframe = document.createElement('iframe');
        iframe.className = 'w-full h-full border-0 min-h-[480px] bg-white dark:bg-slate-900 rounded-xl';
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
                    body {
                        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                        font-size: 14px;
                        line-height: 1.6;
                        color: #1e293b;
                        margin: 16px;
                        word-break: break-word;
                    }
                    img { max-width: 100% !important; height: auto !important; }
                    table { max-width: 100% !important; }
                    a { color: #2563eb; }
                </style>
            </head>
            <body>
                ${cleanHtml}
            </body>
            </html>
        `;
    } else {
        detailBody.innerHTML = `
            <pre class="whitespace-pre-wrap font-sans text-xs sm:text-sm p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200">
                ${escapeHtml(textContent || '(Tidak ada konten teks)')}
            </pre>
        `;
    }
}

function closeDetail() {
    if (detailView) detailView.classList.remove('active');
    currentDetectedOtp = null;
    currentDetailText = '';
}

window.copyDetailBody = function () {
    if (!currentDetailText) {
        showToast('Tidak ada teks untuk disalin.', 'info');
        return;
    }
    navigator.clipboard.writeText(currentDetailText)
        .then(() => showToast('Teks email disalin ke clipboard.', 'success'))
        .catch(() => showToast('Gagal menyalin teks.', 'error'));
};

window.printEmail = function () {
    window.print();
};

// ─── POLLING LIFECYCLE ────────────────────────────────────────────────────────

function startPolling() {
    stopPolling();
    startCountdown();
    setLiveSyncState('active');
    pollingInterval = setInterval(() => {
        fetchMessages();
    }, 15000);
}

function stopPolling() {
    if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
    }
    stopCountdown();
}

// Automatic Pause/Resume on Visibility Change (Anti-Zombie Polling)
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        stopPolling();
        setLiveSyncState('paused');
    } else {
        if (currentEmail) {
            setLiveSyncState('active');
            fetchMessages();
            startPolling();
        }
    }
});

// ─── GMAIL VARIANT GENERATOR ──────────────────────────────────────────────────

function openGmailGeneratorPage() {
    const page = document.getElementById('gmailGeneratorPage');
    if (page) page.classList.add('active');
}

function closeGmailGeneratorPage() {
    const page = document.getElementById('gmailGeneratorPage');
    if (page) page.classList.remove('active');
}

async function generateGmailDotVariants() {
    const input = document.getElementById('gmailGenInput');
    const email = (input ? input.value : '').trim().toLowerCase();

    if (!email || !email.includes('@gmail.com')) {
        showToast('Masukkan alamat @gmail.com yang valid.', 'error');
        return;
    }

    const list = document.getElementById('gmailGenList');
    const stats = document.getElementById('gmailGenStats');
    const count = document.getElementById('gmailGenCount');

    if (list) {
        list.innerHTML = `
            <div class="p-4 space-y-2 animate-pulse">
                <div class="h-4 bg-slate-200 dark:bg-slate-800 rounded w-1/3"></div>
                <div class="h-4 bg-slate-100 dark:bg-slate-850 rounded w-1/2"></div>
            </div>
        `;
    }

    try {
        const res = await fetch(`${API_BASE}/variants/gmail?email=${encodeURIComponent(email)}`);
        const data = await res.json();

        if (!res.ok) {
            showToast(data.error || 'Gagal menghasilkan varian.', 'error');
            if (list) list.innerHTML = '';
            return;
        }

        const variants = data.variants || [];
        window.currentGmailVariants = variants;

        if (count) count.textContent = `${variants.length} varian ditemukan`;
        if (stats) stats.classList.remove('hidden');

        if (list) {
            list.innerHTML = '';
            variants.forEach(variant => {
                const item = document.createElement('div');
                item.className = 'flex items-center justify-between p-3 hover:bg-slate-50 dark:hover:bg-slate-850 rounded-xl transition-colors';
                item.innerHTML = `
                    <span class="font-mono text-xs text-slate-800 dark:text-slate-200 truncate mr-2">${escapeHtml(variant)}</span>
                    <button onclick="copySingleVariant('${escapeHtml(variant)}', this)"
                        class="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-primary-50 dark:hover:bg-primary-950/40 text-slate-600 dark:text-slate-300 hover:text-primary-600 dark:hover:text-primary-400 rounded-lg text-xs font-semibold transition-colors active:scale-95 shrink-0">
                        Salin
                    </button>
                `;
                list.appendChild(item);
            });
        }
    } catch (err) {
        showToast('Gagal menghubungi server.', 'error');
        if (list) list.innerHTML = '';
    }
}

window.copySingleVariant = async function (text, btn) {
    const ok = await copyToClipboard(text);
    if (ok) {
        showToast(`Alamat ${text} disalin!`, 'success');
        if (btn) {
            const originalText = btn.textContent;
            btn.textContent = 'Tersalin!';
            btn.classList.add('text-emerald-600');
            setTimeout(() => {
                btn.textContent = originalText;
                btn.classList.remove('text-emerald-600');
            }, 1500);
        }
    } else {
        showToast(text, 'info');
    }
};

window.copyAllGmailVariants = async function () {
    if (!window.currentGmailVariants || window.currentGmailVariants.length === 0) return;
    const text = window.currentGmailVariants.join('\n');
    await copyToClipboard(text);
    showToast(`${window.currentGmailVariants.length} alamat berhasil disalin!`, 'success');
};

// ─── DONASI & ABOUT PAGES ─────────────────────────────────────────────────────

function openDonasiPage() {
    const page = document.getElementById('donasiPage');
    if (page) page.classList.add('active');
}

function closeDonasiPage() {
    const page = document.getElementById('donasiPage');
    if (page) page.classList.remove('active');
}

function openAboutPage() {
    const page = document.getElementById('aboutPage');
    if (page) page.classList.add('active');
}

function closeAboutPage() {
    const page = document.getElementById('aboutPage');
    if (page) page.classList.remove('active');
}

window.copyRek = async function (elementId, btn) {
    const el = document.getElementById(elementId);
    if (!el) return;
    const num = el.textContent.trim();
    await copyToClipboard(num);
    showToast(`Nomor ${num} disalin ke clipboard!`, 'success');
    if (btn) {
        const original = btn.innerHTML;
        btn.innerHTML = '<span>Tersalin!</span>';
        setTimeout(() => { btn.innerHTML = original; }, 1500);
    }
};

// ─── MODAL CONTROLS ───────────────────────────────────────────────────────────

function openAccessModal() {
    const m = document.getElementById('accessModal');
    if (m) m.classList.add('active');
    const input = document.getElementById('accessEmailInput');
    if (input) setTimeout(() => input.focus(), 50);
}

function closeAccessModal() {
    const m = document.getElementById('accessModal');
    if (m) m.classList.remove('active');
}

function openCustomModal() {
    const m = document.getElementById('customModal');
    if (m) m.classList.add('active');
    const input = document.getElementById('customUsernameInput');
    if (input) setTimeout(() => input.focus(), 50);
}

function closeCustomModal() {
    const m = document.getElementById('customModal');
    if (m) m.classList.remove('active');
}

// ─── TOAST NOTIFICATIONS ──────────────────────────────────────────────────────

let toastTimeout = null;
function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toastMessage');
    const toastIcon = document.getElementById('toastIcon');
    if (!toast || !toastMessage) return;

    toastMessage.textContent = message;

    if (toastIcon) {
        if (type === 'success') {
            toastIcon.setAttribute('name', 'checkmark-circle');
            toastIcon.className = 'text-base text-emerald-400 shrink-0';
        } else if (type === 'error') {
            toastIcon.setAttribute('name', 'alert-circle');
            toastIcon.className = 'text-base text-red-400 shrink-0';
        } else {
            toastIcon.setAttribute('name', 'information-circle');
            toastIcon.className = 'text-base text-primary-400 dark:text-primary-600 shrink-0';
        }
    }

    toast.classList.remove('opacity-0', 'translate-y-4', 'pointer-events-none');
    toast.classList.add('opacity-100', 'translate-y-0');

    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
        toast.classList.remove('opacity-100', 'translate-y-0');
        toast.classList.add('opacity-0', 'translate-y-4', 'pointer-events-none');
    }, 2800);
}

// ─── UTILITIES & HELPERS ──────────────────────────────────────────────────────

async function copyEmail() {
    if (!currentEmail) return;
    const ok = await copyToClipboard(currentEmail);

    const mobileText = document.getElementById('mobileCopyBtnText');
    const desktopText = document.getElementById('desktopCopyText');

    if (mobileText) {
        mobileText.textContent = 'TERSALIN ✓';
        setTimeout(() => { mobileText.textContent = 'SALIN'; }, 1500);
    }
    if (desktopText) {
        desktopText.textContent = 'TERSALIN ✓';
        setTimeout(() => { desktopText.textContent = 'SALIN'; }, 1500);
    }

    if (ok) {
        showToast(`Alamat ${currentEmail} berhasil disalin!`, 'success');
    } else {
        showToast(currentEmail, 'info');
    }
}

function refreshInbox() {
    fetchMessages(true);
}

async function deleteCurrentEmail() {
    if (!currentEmail) return;

    if (!confirm(`Hapus alamat ${currentEmail} dari sesi ini?`)) {
        return;
    }

    try {
        await fetch(`${API_BASE}/delete?email=${encodeURIComponent(currentEmail)}`, { method: 'DELETE' });
    } catch {}

    saveCurrentEmail(null);
    allMessages = [];
    renderEmailList();
    showToast('Sesi email telah dihapus.', 'info');
    generateEmail(true);
}

function parseSenderName(fromStr) {
    if (!fromStr) return 'Pengirim';
    const match = fromStr.match(/^"?(.*?)"?\s*<.*>$/);
    return (match && match[1]) ? match[1].trim() : fromStr.split('@')[0];
}

function parseSenderEmail(fromStr) {
    if (!fromStr) return '';
    const match = fromStr.match(/<([^>]+)>/);
    return match ? match[1].trim() : fromStr.trim();
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();

    return isToday
        ? d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
        : d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
}

function formatFullDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString('id-ID', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// ─── INITIALIZATION ───────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    if (searchInput) {
        searchInput.addEventListener('input', () => renderEmailList());
    }

    await initializeDomainSelector();
    await generateEmail(false);
});
