const API_BASE = '/api';

let currentEmail = null;
let allMessages = [];
let availableDomains = [];
let selectedDomain = '';
let activeAbortController = null;
let consecutiveEmptyPolls = 0;
const EMPTY_POLLS_BEFORE_CLEAR = 3;

// Polling Engine Settings (Fast 5s Synchronized Loop)
const POLL_INTERVAL_SECONDS = 5;
let countdownRemaining = POLL_INTERVAL_SECONDS;
let countdownTimerId = null;
let isPollingActive = false;

let currentDetailText = '';

// DOM Elements Cache
const emailListContainer = document.getElementById('emailList');
const skeletonLoading = document.getElementById('skeletonLoading');
const emptyState = document.getElementById('emptyState');
const currentEmailText = document.getElementById('currentEmailText');
const mobileActiveEmail = document.getElementById('mobileActiveEmail');
const sidebarNavCount = document.getElementById('sidebarNavCount');
const mobileMsgCountBadge = document.getElementById('mobileMsgCountBadge');
const searchInput = document.getElementById('searchInput');
const domainTrigger = document.getElementById('domainTrigger');
const domainOptions = document.getElementById('domainOptions');
const selectedDomainText = document.getElementById('selectedDomainText');
const customDomainSelector = document.getElementById('customDomainSelector');
const mobileDomainOptions = document.getElementById('mobileDomainOptions');
const mobileSelectedDomainText = document.getElementById('mobileSelectedDomainText');
const refreshBtn = document.getElementById('refreshBtn');
const mobileRefreshBtn = document.getElementById('mobileRefreshBtn');
const detailView = document.getElementById('emailDetailView');
const detailSubject = document.getElementById('detailSubject');
const detailFrom = document.getElementById('detailFrom');
const detailDate = document.getElementById('detailDate');
const detailBody = document.getElementById('detailBody');
const detailOtpBanner = document.getElementById('detailOtpBanner');
const detailOtpCode = document.getElementById('detailOtpCode');
const liveSyncStatus = document.getElementById('liveSyncStatus');
const liveSyncText = document.getElementById('liveSyncText');
const mobileLiveSyncLabel = document.getElementById('mobileLiveSyncLabel');
const mobileSyncPing = document.getElementById('mobileSyncPing');
const mobileSyncDot = document.getElementById('mobileSyncDot');
const toast = document.getElementById('toast');
const toastMessage = document.getElementById('toastMessage');
const toastIcon = document.getElementById('toastIcon');

// ─── ROBUST CLIPBOARD HELPER ─────────────────────────────────────────────────

async function copyToClipboard(text) {
    if (!text) return false;
    if (navigator.clipboard && window.isSecureContext) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch {}
    }
    // Fallback for non-secure contexts, webviews, or restricted permissions
    try {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.top = '-9999px';
        textArea.style.left = '-9999px';
        textArea.setAttribute('readonly', '');
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

// ─── TOAST NOTIFICATION ──────────────────────────────────────────────────────

let toastTimeout = null;

function showToast(message, type = 'info') {
    if (!toast || !toastMessage) return;

    if (toastTimeout) {
        clearTimeout(toastTimeout);
        toastTimeout = null;
    }

    toastMessage.textContent = message;

    if (toastIcon) {
        if (type === 'success') {
            toastIcon.setAttribute('name', 'checkmark-circle');
            toastIcon.className = 'text-emerald-400 dark:text-emerald-500 text-lg shrink-0';
        } else if (type === 'error') {
            toastIcon.setAttribute('name', 'alert-circle');
            toastIcon.className = 'text-rose-400 dark:text-rose-500 text-lg shrink-0';
        } else {
            toastIcon.setAttribute('name', 'information-circle');
            toastIcon.className = 'text-sky-400 dark:text-sky-500 text-lg shrink-0';
        }
    }

    toast.classList.remove('opacity-0', 'pointer-events-none', 'translate-y-2');
    toast.classList.add('opacity-100', 'translate-y-0');

    toastTimeout = setTimeout(() => {
        toast.classList.remove('opacity-100', 'translate-y-0');
        toast.classList.add('opacity-0', 'pointer-events-none', 'translate-y-2');
    }, 3000);
}

// ─── FAST 5S COUNTDOWN & LIVE SYNC ENGINE ─────────────────────────────────────

function updateCountdownUI() {
    const desktopTimer = document.getElementById('refreshTimerLabel');
    const mobileTimer = document.getElementById('mobileRefreshTimerLabel');
    const progressBars = document.querySelectorAll('#refreshProgressBar, #desktopRefreshProgressBar');

    if (desktopTimer) desktopTimer.textContent = `${countdownRemaining}s`;
    if (mobileTimer) mobileTimer.textContent = `${countdownRemaining}s`;

    if (progressBars.length) {
        const pct = Math.max(0, Math.min(100, (countdownRemaining / POLL_INTERVAL_SECONDS) * 100));
        progressBars.forEach(pb => {
            pb.style.width = `${pct}%`;
        });
    }
}

function startPolling() {
    stopPolling();
    isPollingActive = true;
    countdownRemaining = POLL_INTERVAL_SECONDS;
    updateCountdownUI();
    setLiveSyncState('active');

    countdownTimerId = setInterval(() => {
        if (!isPollingActive) return;

        countdownRemaining--;
        if (countdownRemaining <= 0) {
            countdownRemaining = POLL_INTERVAL_SECONDS;
            updateCountdownUI();
            fetchMessages();
        } else {
            updateCountdownUI();
        }
    }, 1000);
}

function stopPolling() {
    isPollingActive = false;
    if (countdownTimerId) {
        clearInterval(countdownTimerId);
        countdownTimerId = null;
    }
}

function setLiveSyncState(state) {
    const desktopPing = document.getElementById('liveSyncPing');
    const desktopDot = document.getElementById('liveSyncDot');
    const desktopBadge = document.getElementById('liveSyncBadge');

    if (state === 'active') {
        if (liveSyncText) liveSyncText.textContent = 'Live Sync';
        if (mobileLiveSyncLabel) mobileLiveSyncLabel.textContent = 'Live Sync';
        if (mobileSyncPing) mobileSyncPing.classList.remove('hidden');
        if (desktopPing) desktopPing.classList.remove('hidden');
        if (mobileSyncDot) mobileSyncDot.className = 'relative inline-flex rounded-full h-2 w-2 bg-emerald-500';
        if (desktopDot) desktopDot.className = 'relative inline-flex rounded-full h-2 w-2 bg-emerald-500';
        if (desktopBadge) {
            desktopBadge.textContent = 'Aktif';
            desktopBadge.className = 'text-[10px] font-mono text-emerald-600 dark:text-emerald-400 font-bold';
        }
    } else if (state === 'paused') {
        if (liveSyncText) liveSyncText.textContent = 'Dijeda';
        if (mobileLiveSyncLabel) mobileLiveSyncLabel.textContent = 'Dijeda';
        if (mobileSyncPing) mobileSyncPing.classList.add('hidden');
        if (desktopPing) desktopPing.classList.add('hidden');
        if (mobileSyncDot) mobileSyncDot.className = 'relative inline-flex rounded-full h-2 w-2 bg-amber-500';
        if (desktopDot) desktopDot.className = 'relative inline-flex rounded-full h-2 w-2 bg-amber-500';
        if (desktopBadge) {
            desktopBadge.textContent = 'Dijeda';
            desktopBadge.className = 'text-[10px] font-mono text-amber-600 dark:text-amber-400 font-bold';
        }
    } else if (state === 'syncing') {
        if (liveSyncText) liveSyncText.textContent = 'Sync...';
        if (mobileLiveSyncLabel) mobileLiveSyncLabel.textContent = 'Sync...';
        if (desktopBadge) {
            desktopBadge.textContent = 'Sync...';
            desktopBadge.className = 'text-[10px] font-mono text-primary-600 dark:text-primary-400 font-bold';
        }
    }
}

// ─── DOMAIN MANAGEMENT ────────────────────────────────────────────────────────

async function loadDomainsFromAPI() {
    try {
        const res = await fetch(`${API_BASE}/domains`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data && Array.isArray(data.domains) && data.domains.length > 0) {
            availableDomains = data.domains;
            return;
        }
    } catch (err) {
        console.warn('Gagal memuat domain dari server:', err);
    }
    availableDomains = ['revd.me'];
}

function renderDomainOptions() {
    // Desktop Options
    if (domainOptions) {
        domainOptions.innerHTML = '';
        availableDomains.forEach(domain => {
            const option = document.createElement('button');
            const isSelected = domain === selectedDomain;
            option.className = [
                'w-full text-left px-4 py-2.5 text-xs font-semibold rounded-xl transition-all flex items-center justify-between',
                isSelected
                    ? 'bg-primary-600 text-white shadow-xs'
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
    if (domainOptions) domainOptions.classList.add('hidden');
    if (mobileDomainOptions) mobileDomainOptions.classList.add('hidden');
    if (domainTrigger) domainTrigger.setAttribute('aria-expanded', 'false');

    if (domain === selectedDomain) return;

    selectedDomain = domain;
    localStorage.setItem('selectedDomain', selectedDomain);
    renderDomainOptions();

    showToast(`Domain beralih ke @${selectedDomain}`, 'info');
    await generateEmail(true);
}

// ─── EMAIL DISPLAY & PERSISTENCE ──────────────────────────────────────────────

function updateActiveEmailDisplays(email) {
    const text = email || 'Memuat alamat...';
    if (currentEmailText) currentEmailText.textContent = text;
    if (mobileActiveEmail) mobileActiveEmail.textContent = text;

    const domainLabel = selectedDomain ? `@${selectedDomain}` : 'Domain';
    if (selectedDomainText) selectedDomainText.textContent = domainLabel;
    if (mobileSelectedDomainText) mobileSelectedDomainText.textContent = domainLabel;

    const customModalBadge = document.getElementById('customModalDomainBadge');
    if (customModalBadge) customModalBadge.textContent = domainLabel;
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
            showSkeleton(true);
            showToast(`Email baru siap: ${data.email}`, 'success');
            await fetchMessages();
            startPolling();
        }
    } catch (err) {
        showSkeleton(false);
        showToast('Gagal membuat email baru. Coba lagi.', 'error');
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
            showToast(data.error || 'Gagal membuat email custom.', 'error');
            return;
        }

        if (data.email) {
            saveCurrentEmail(data.email);
            consecutiveEmptyPolls = 0;
            allMessages = [];
            showSkeleton(true);
            showToast(`Custom email dibuat: ${data.email}`, 'success');
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
    saveCurrentEmail(email);
    consecutiveEmptyPolls = 0;
    allMessages = [];
    showSkeleton(true);
    showToast(`Beralih ke: ${email}`, 'info');
    await fetchMessages();
    startPolling();
}

// ─── FETCH & RENDER MESSAGES ─────────────────────────────────────────────────

async function refreshInbox() {
    if (refreshBtn) refreshBtn.classList.add('rotating');
    if (mobileRefreshBtn) mobileRefreshBtn.classList.add('rotating');
    setLiveSyncState('syncing');

    countdownRemaining = POLL_INTERVAL_SECONDS;
    updateCountdownUI();

    showSkeleton(true);
    await fetchMessages(true);
}

async function fetchMessages(isManual = false) {
    if (!currentEmail) {
        showSkeleton(false);
        return;
    }

    if (activeAbortController) {
        activeAbortController.abort();
    }
    activeAbortController = new AbortController();

    try {
        const res = await fetch(`${API_BASE}/messages?email=${encodeURIComponent(currentEmail)}`, {
            signal: activeAbortController.signal
        });

        if (res.status === 403) {
            showToast('Alamat email ditolak server.', 'error');
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

        // Hide skeleton first, so empty state only displays AFTER skeleton finishes
        showSkeleton(false);
        renderEmailList();
        setLiveSyncState('active');

        if (isManual) {
            showToast(incoming.length > 0 ? `${incoming.length} pesan ditemukan` : 'Inbox masih kosong', 'info');
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

    const isSkeletonActive = skeletonLoading && !skeletonLoading.classList.contains('hidden');

    const query = (searchInput ? searchInput.value : '').toLowerCase().trim();
    const filtered = query
        ? allMessages.filter(m =>
            (m.subject && m.subject.toLowerCase().includes(query)) ||
            (m.from && m.from.toLowerCase().includes(query)) ||
            (m.intro && m.intro.toLowerCase().includes(query))
        )
        : allMessages;

    // Update message count badges
    if (sidebarNavCount) {
        sidebarNavCount.textContent = filtered.length;
        sidebarNavCount.classList.toggle('hidden', filtered.length === 0);
    }
    if (mobileMsgCountBadge) {
        mobileMsgCountBadge.textContent = `${filtered.length} Pesan`;
    }

    if (filtered.length === 0) {
        emailListContainer.innerHTML = '';
        if (emptyState) {
            // Only show empty state if skeleton is NOT active
            if (!isSkeletonActive) {
                emptyState.classList.remove('opacity-0', 'pointer-events-none');
                emptyState.classList.add('opacity-100');
            } else {
                emptyState.classList.add('opacity-0', 'pointer-events-none');
                emptyState.classList.remove('opacity-100');
            }
        }
        return;
    }

    if (emptyState) {
        emptyState.classList.add('opacity-0', 'pointer-events-none');
        emptyState.classList.remove('opacity-100');
    }

    emailListContainer.innerHTML = '';

    filtered.forEach(msg => {
        const card = document.createElement('div');
        // Independent, padded card design with balanced margins on both left and right
        card.className = 'group relative flex items-start gap-3 sm:gap-4 p-3.5 sm:p-4 rounded-xl sm:rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-850/60 hover:bg-slate-50/80 dark:hover:bg-slate-800 hover:border-primary-400 dark:hover:border-primary-500 hover:shadow-xs cursor-pointer transition-all active:scale-[0.99]';

        const senderName = parseSenderName(msg.from);
        const senderEmail = parseSenderEmail(msg.from);
        const initial = (senderName || 'A').charAt(0).toUpperCase();
        const dateStr = formatDate(msg.date);
        const otp = extractOTP(msg.subject, msg.text || msg.intro || '');

        card.innerHTML = `
            <div class="w-10 h-10 rounded-xl sm:rounded-2xl bg-gradient-to-tr from-primary-600 to-primary-400 text-white flex items-center justify-center text-sm font-bold shrink-0 shadow-xs">
                ${escapeHtml(initial)}
            </div>
            <div class="flex-1 min-w-0">
                <div class="flex items-center justify-between gap-2 mb-0.5">
                    <span class="font-bold text-xs sm:text-sm text-slate-900 dark:text-white truncate">
                        ${escapeHtml(senderName)}
                    </span>
                    <time class="text-[11px] text-slate-400 dark:text-slate-500 shrink-0 font-medium whitespace-nowrap">
                        ${escapeHtml(dateStr)}
                    </time>
                </div>
                <div class="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate mb-1">
                    ${escapeHtml(msg.subject || '(Tanpa Subjek)')}
                </div>
                <div class="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-1 leading-relaxed">
                    ${escapeHtml(msg.intro || msg.text || '(Tidak ada pratinjau teks)')}
                </div>
                ${otp ? `
                    <div class="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 bg-amber-50 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-800/80 rounded-xl text-xs font-bold text-amber-900 dark:text-amber-200">
                        <span class="text-[10px] text-amber-700 dark:text-amber-400 font-extrabold uppercase tracking-wider">KODE:</span>
                        <span class="font-mono text-sm tracking-widest bg-white dark:bg-slate-900 px-2 py-0.5 rounded-lg border border-amber-200 dark:border-amber-700 text-slate-900 dark:text-white font-black">${escapeHtml(otp)}</span>
                        <button onclick="event.stopPropagation(); copyOTP('${escapeHtml(otp)}')" class="px-2 py-0.5 bg-amber-500 hover:bg-amber-600 text-white text-[10px] font-extrabold rounded-lg uppercase tracking-wider transition-colors active:scale-95 ml-1">
                            COPY
                        </button>
                    </div>
                ` : ''}
            </div>
        `;

        card.addEventListener('click', () => openDetail(msg));
        emailListContainer.appendChild(card);
    });
}

function showSkeleton(show) {
    if (skeletonLoading) skeletonLoading.classList.toggle('hidden', !show);
    if (show) {
        // While skeleton is active: HIDE empty state and hide list container completely
        if (emptyState) {
            emptyState.classList.add('opacity-0', 'pointer-events-none');
            emptyState.classList.remove('opacity-100');
        }
        if (emailListContainer) {
            emailListContainer.classList.add('hidden');
        }
    } else {
        if (emailListContainer) {
            emailListContainer.classList.remove('hidden');
        }
    }
}

// ─── OTP EXTRACTION HELPER ───────────────────────────────────────────────────

function extractOTP(subject, bodyText) {
    const combined = `${subject || ''} ${bodyText || ''}`;
    const patterns = [
        /(?:otp|verification|verification\s*code|kode\s*verifikasi|security\s*code|login\s*code|pin|auth\s*code)\s*(?:is|adalah|:|-)?\s*[:#]?\s*([0-9]{4,8})\b/i,
        /\b(?:code|kode)\s*[:#]\s*([0-9]{4,8})\b/i,
        /\b([0-9]{6})\b/
    ];

    for (const pat of patterns) {
        const match = combined.match(pat);
        if (match && match[1]) {
            return match[1];
        }
    }
    return null;
}

window.copyOTP = async function (code) {
    if (!code) return;
    await copyToClipboard(code);
    showToast(`Kode OTP ${code} disalin!`, 'success');
};

// ─── DETAIL VIEW ─────────────────────────────────────────────────────────────

async function openDetail(msg) {
    if (!detailView || !detailSubject || !detailFrom || !detailDate || !detailBody) return;

    detailSubject.textContent = msg.subject || '(Tanpa Subjek)';
    detailFrom.textContent = msg.from || 'Pengirim Tidak Diketahui';
    detailDate.textContent = formatFullDate(msg.date);

    const otp = extractOTP(msg.subject, msg.text || msg.intro || '');
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
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                    body {
                        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                        font-size: 14px;
                        line-height: 1.6;
                        color: #1e293b;
                        padding: 16px;
                        margin: 0;
                        word-break: break-word;
                    }
                    img { max-width: 100% !important; height: auto !important; }
                    a { color: #2563eb; text-decoration: underline; }
                </style>
            </head>
            <body>${cleanHtml}</body>
            </html>
        `;
    } else {
        detailBody.innerHTML = `
            <div class="p-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">
                <pre class="font-sans text-xs text-slate-800 dark:text-slate-200 whitespace-pre-wrap break-words leading-relaxed">${escapeHtml(textContent || 'Tidak ada konten.')}</pre>
            </div>
        `;
    }
}

function closeDetail() {
    if (detailView) detailView.classList.remove('active');
    currentDetailText = '';
}

window.copyDetailOtp = async function () {
    if (detailOtpCode) {
        const code = detailOtpCode.textContent.trim();
        await copyToClipboard(code);
        showToast(`Kode OTP ${code} disalin!`, 'success');
    }
};

window.copyDetailBody = async function () {
    if (!currentDetailText) {
        showToast('Tidak ada teks untuk disalin.', 'info');
        return;
    }
    await copyToClipboard(currentDetailText);
    showToast('Teks email disalin ke clipboard.', 'success');
};

window.printEmail = function () {
    window.print();
};

// ─── POLLING LIFECYCLE ────────────────────────────────────────────────────────

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
        const res = await fetch(`${API_BASE}/gmail-generator?email=${encodeURIComponent(email)}`);
        const data = await res.json();

        if (!res.ok) {
            showToast(data.error || 'Gagal menghasilkan variasi.', 'error');
            if (list) list.innerHTML = '';
            return;
        }

        const variants = data.variants || [];
        window.currentGmailVariants = variants;

        if (stats) stats.classList.remove('hidden');
        if (count) count.textContent = variants.length;

        if (list) {
            list.innerHTML = '';
            variants.forEach(v => {
                const item = document.createElement('div');
                item.className = 'flex items-center justify-between p-2.5 bg-slate-50 dark:bg-slate-850 rounded-xl border border-slate-100 dark:border-slate-800 hover:border-slate-300 transition-colors';
                item.innerHTML = `
                    <span class="truncate pr-2 select-all">${escapeHtml(v)}</span>
                    <button onclick="copySingleVariant('${escapeHtml(v)}', this)" class="btn-secondary py-1 px-2 text-[11px] shrink-0">
                        <span>Salin</span>
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

async function copySingleVariant(text, btn) {
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
}

const copyGmailVariant = copySingleVariant;
window.copySingleVariant = copySingleVariant;
window.copyGmailVariant = copyGmailVariant;

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
    if (m) {
        m.classList.add('active');
        m.classList.remove('opacity-0', 'pointer-events-none');
        m.classList.add('opacity-100', 'pointer-events-auto');
    }
    const input = document.getElementById('accessEmailInput');
    if (input) setTimeout(() => { input.value = ''; input.focus(); }, 50);
}

function closeAccessModal() {
    const m = document.getElementById('accessModal');
    if (m) {
        m.classList.remove('active');
        m.classList.remove('opacity-100', 'pointer-events-auto');
        m.classList.add('opacity-0', 'pointer-events-none');
    }
}

function openCustomModal() {
    const m = document.getElementById('customModal');
    const domainBadge = document.getElementById('customModalDomainBadge');
    if (domainBadge) domainBadge.textContent = `@${selectedDomain || 'revd.me'}`;
    if (m) {
        m.classList.add('active');
        m.classList.remove('opacity-0', 'pointer-events-none');
        m.classList.add('opacity-100', 'pointer-events-auto');
    }
    const input = document.getElementById('customUsernameInput');
    if (input) setTimeout(() => { input.value = ''; input.focus(); }, 50);
}

function closeCustomModal() {
    const m = document.getElementById('customModal');
    if (m) {
        m.classList.remove('active');
        m.classList.remove('opacity-100', 'pointer-events-auto');
        m.classList.add('opacity-0', 'pointer-events-none');
    }
}

function closeAllPanels() {
    closeDetail();
    closeGmailGeneratorPage();
    closeDonasiPage();
    closeAboutPage();
}

// ─── SIDEBAR & THEME HELPERS ─────────────────────────────────────────────────

window.setSidebar = function (open) {
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('sidebarBackdrop');
    if (!sidebar || !backdrop) return;

    if (open) {
        sidebar.classList.add('active');
        backdrop.classList.remove('opacity-0', 'pointer-events-none');
        backdrop.classList.add('opacity-100');
    } else {
        sidebar.classList.remove('active');
        backdrop.classList.remove('opacity-100');
        backdrop.classList.add('opacity-0', 'pointer-events-none');
    }
};

function toggleSidebar(forceState) {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    const isCurrentlyActive = sidebar.classList.contains('active');
    const nextState = (typeof forceState === 'boolean') ? forceState : !isCurrentlyActive;
    window.setSidebar(nextState);
}

function initTheme() {
    const saved = localStorage.getItem('theme');
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    let isDark;
    if (saved === 'dark') {
        isDark = true;
    } else if (saved === 'light') {
        isDark = false;
    } else {
        isDark = !!prefersDark;
    }
    applyTheme(isDark);
}

function applyTheme(isDark) {
    const html = document.documentElement;
    const themeIcon = document.getElementById('themeIcon');
    const mobileThemeIcon = document.getElementById('mobileThemeIcon');
    const desktopThemeIcon = document.getElementById('desktopThemeIcon');
    const themeModeLabel = document.getElementById('themeModeLabel');

    if (isDark) {
        html.classList.add('dark');
        localStorage.setItem('theme', 'dark');
        if (themeIcon) themeIcon.setAttribute('name', 'sunny-outline');
        if (mobileThemeIcon) mobileThemeIcon.setAttribute('name', 'sunny-outline');
        if (desktopThemeIcon) desktopThemeIcon.setAttribute('name', 'sunny-outline');
        if (themeModeLabel) themeModeLabel.textContent = 'Dark Mode';
    } else {
        html.classList.remove('dark');
        localStorage.setItem('theme', 'light');
        if (themeIcon) themeIcon.setAttribute('name', 'moon-outline');
        if (mobileThemeIcon) mobileThemeIcon.setAttribute('name', 'moon-outline');
        if (desktopThemeIcon) desktopThemeIcon.setAttribute('name', 'moon-outline');
        if (themeModeLabel) themeModeLabel.textContent = 'Light Mode';
    }
}

window.toggleTheme = function () {
    const isDark = document.documentElement.classList.contains('dark');
    applyTheme(!isDark);
};

initTheme();

// ─── DROPDOWNS & ACTIONS ─────────────────────────────────────────────────────

window.toggleMobileDomainDropdown = function (e) {
    if (e) e.stopPropagation();
    if (domainOptions) domainOptions.classList.add('hidden');
    if (mobileDomainOptions) {
        mobileDomainOptions.classList.toggle('hidden');
    }
};

window.toggleDesktopDomainDropdown = function (e) {
    if (e) e.stopPropagation();
    if (mobileDomainOptions) mobileDomainOptions.classList.add('hidden');
    if (domainOptions) {
        domainOptions.classList.toggle('hidden');
        const isOpen = !domainOptions.classList.contains('hidden');
        if (domainTrigger) domainTrigger.setAttribute('aria-expanded', String(isOpen));
    }
};

document.addEventListener('click', (e) => {
    if (domainOptions && !e.target.closest('#customDomainSelector')) {
        domainOptions.classList.add('hidden');
        if (domainTrigger) domainTrigger.setAttribute('aria-expanded', 'false');
    }
    if (mobileDomainOptions && !e.target.closest('#mobileDomainTrigger')) {
        mobileDomainOptions.classList.add('hidden');
    }
});

async function copyEmail() {
    if (!currentEmail) return;
    const ok = await copyToClipboard(currentEmail);

    const mobileText = document.getElementById('mobileCopyBtnText');
    const desktopText = document.getElementById('desktopCopyText');

    if (mobileText) {
        mobileText.textContent = 'TERSALIN ✓';
        setTimeout(() => { mobileText.textContent = 'COPY'; }, 1500);
    }
    if (desktopText) {
        desktopText.textContent = 'TERSALIN ✓';
        setTimeout(() => { desktopText.textContent = 'COPY'; }, 1500);
    }

    if (ok) {
        showToast(`Email ${currentEmail} disalin!`, 'success');
    } else {
        showToast(currentEmail, 'info');
    }
}

async function deleteCurrentEmail() {
    if (!currentEmail) return;

    if (!confirm(`Hapus sesi inbox ${currentEmail}? Seluruh pesan akan dibersihkan.`)) {
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

// ─── INITIALIZATION & GLOBAL BINDINGS ───────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    if (searchInput) {
        searchInput.addEventListener('input', () => renderEmailList());
    }

    // Modal keyboard shortcuts (Enter to submit, Escape to close)
    const accessInput = document.getElementById('accessEmailInput');
    if (accessInput) {
        accessInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                accessExistingEmail();
            }
        });
    }

    const customInput = document.getElementById('customUsernameInput');
    if (customInput) {
        customInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                generateCustomEmail();
            }
        });
    }

    // Close modals on clicking their backdrops
    const accessModalEl = document.getElementById('accessModal');
    if (accessModalEl) {
        accessModalEl.addEventListener('click', (e) => {
            if (e.target === accessModalEl) closeAccessModal();
        });
    }

    const customModalEl = document.getElementById('customModal');
    if (customModalEl) {
        customModalEl.addEventListener('click', (e) => {
            if (e.target === customModalEl) closeCustomModal();
        });
    }

    // Close search popup when clicking outside
    document.addEventListener('click', (e) => {
        const searchPopup = document.getElementById('searchPopup');
        const mobileSearchBtn = document.getElementById('mobileSearchBtn');
        const desktopSearchBtn = document.getElementById('desktopSearchBtn');

        if (searchPopup && !searchPopup.classList.contains('hidden')) {
            if (!searchPopup.contains(e.target) &&
                (!mobileSearchBtn || !mobileSearchBtn.contains(e.target)) &&
                (!desktopSearchBtn || !desktopSearchBtn.contains(e.target))) {
                toggleSearchPopup(false);
            }
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeAccessModal();
            closeCustomModal();
            closeDetail();
            toggleSearchPopup(false);
            if (window.setSidebar) setSidebar(false);
        }
    });

    await initializeDomainSelector();
    await generateEmail(false);
});

// Search Popup Controller
function toggleSearchPopup(forceState) {
    const popup = document.getElementById('searchPopup');
    if (!popup) return;
    const isHidden = popup.classList.contains('hidden');
    const newState = (typeof forceState === 'boolean') ? forceState : isHidden;

    if (newState) {
        popup.classList.remove('hidden');
        const input = document.getElementById('searchInput');
        if (input) {
            setTimeout(() => input.focus(), 60);
        }
    } else {
        popup.classList.add('hidden');
    }
}

function clearSearchAndClose() {
    const input = document.getElementById('searchInput');
    if (input) {
        input.value = '';
        renderEmailList();
    }
    toggleSearchPopup(false);
}

async function initializeDomainSelector() {
    await loadDomainsFromAPI();

    if (availableDomains.length === 0) {
        availableDomains = ['revd.me'];
    }

    let savedDomain = null;
    try {
        savedDomain = localStorage.getItem('selectedDomain');
    } catch (e) {}

    selectedDomain = (savedDomain && availableDomains.includes(savedDomain))
        ? savedDomain
        : availableDomains[0];

    renderDomainOptions();
    updateActiveEmailDisplays(currentEmail);
}

// Explicit global exports for all inline onclick handlers
window.toggleTheme = toggleTheme;
window.applyTheme = applyTheme;
window.openAccessModal = openAccessModal;
window.closeAccessModal = closeAccessModal;
window.openCustomModal = openCustomModal;
window.closeCustomModal = closeCustomModal;
window.accessExistingEmail = accessExistingEmail;
window.generateCustomEmail = generateCustomEmail;
window.generateEmail = generateEmail;
window.copyEmail = copyEmail;
window.refreshInbox = refreshInbox;
window.deleteCurrentEmail = deleteCurrentEmail;
window.toggleSidebar = toggleSidebar;
window.setSidebar = setSidebar;
window.toggleMobileDomainDropdown = toggleMobileDomainDropdown;
window.toggleDesktopDomainDropdown = toggleDesktopDomainDropdown;
window.toggleSearchPopup = toggleSearchPopup;
window.clearSearchAndClose = clearSearchAndClose;
window.openGmailGeneratorPage = openGmailGeneratorPage;
window.closeGmailGeneratorPage = closeGmailGeneratorPage;
window.generateGmailDotVariants = generateGmailDotVariants;
window.copyGmailVariant = copyGmailVariant;
window.copyAllGmailVariants = copyAllGmailVariants;
window.openDonasiPage = openDonasiPage;
window.closeDonasiPage = closeDonasiPage;
window.openAboutPage = openAboutPage;
window.closeAboutPage = closeAboutPage;
window.copyNumber = copyNumber;
window.openDetail = openDetail;
window.closeDetail = closeDetail;
window.copyOtpFromList = copyOtpFromList;
window.copyDetailOtp = copyDetailOtp;
window.copyDetailBody = copyDetailBody;
window.printEmail = printEmail;
window.closeAllPanels = closeAllPanels;
