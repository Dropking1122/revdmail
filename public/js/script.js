const API_BASE = '/api';

let currentEmail = null;
let pollingInterval = null;
let allMessages = []; // Store all fetched messages locally
let availableDomains = ['revdserver.web.id']; // Default, populated from env
let selectedDomain = 'revdserver.web.id';

// DOM Elements
const activeEmailDisplay = document.getElementById('activeEmailDisplay');
const currentEmailText = document.getElementById('currentEmailText');
const emailListContainer = document.getElementById('emailList');
const emptyState = document.getElementById('emptyState');
// Custom Domain Selector Elements
const customDomainSelector = document.getElementById('customDomainSelector');
const domainTrigger = document.getElementById('domainTrigger');
const domainOptions = document.getElementById('domainOptions');
const selectedDomainText = document.getElementById('selectedDomainText');

// Detail View elements
const detailView = document.getElementById('emailDetailView');
const detailContent = document.getElementById('detailContent');

const detailSubject = document.getElementById('detailSubject');
const detailSenderName = document.getElementById('detailSenderName');
const detailSenderEmail = document.getElementById('detailSenderEmail');
const senderAvatar = document.getElementById('senderAvatar');
const detailDate = document.getElementById('detailDate');
const detailBody = document.getElementById('detailBody');
const sidebar = document.getElementById('sidebar');

const toast = document.getElementById('toast');
const searchInput = document.getElementById('searchInput');

// --- Domain Management ---

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
    if (!customDomainSelector || !domainOptions) {
        return;
    }

    // Load domains from API first
    await loadDomainsFromAPI();

    // Restore previously selected domain from localStorage
    const savedDomain = localStorage.getItem('selectedDomain');
    if (savedDomain && availableDomains.includes(savedDomain)) {
        selectedDomain = savedDomain;
    } else {
        selectedDomain = availableDomains[0];
    }

    // Update UI
    renderDomainOptions();

    // Toggle Event
    if (domainTrigger) {
        domainTrigger.addEventListener('click', (e) => {
            e.stopPropagation();
            customDomainSelector.classList.toggle('active');
            const isExpanded = customDomainSelector.classList.contains('active');
            domainTrigger.setAttribute('aria-expanded', isExpanded);
        });
    }

    // Close on click outside
    document.addEventListener('click', (e) => {
        if (!customDomainSelector.contains(e.target)) {
            customDomainSelector.classList.remove('active');
            domainTrigger.setAttribute('aria-expanded', 'false');
        }
    });
}

function renderDomainOptions() {
    // Update Trigger Text
    if (selectedDomainText) {
        selectedDomainText.textContent = `@${selectedDomain}`;
    }

    // Populate Options
    domainOptions.innerHTML = '';
    availableDomains.forEach(domain => {
        const option = document.createElement('div');
        option.className = `selector-option ${domain === selectedDomain ? 'selected' : ''}`;
        option.textContent = `@${domain}`;
        option.addEventListener('click', (e) => {
            e.stopPropagation();
            selectDomain(domain);
        });
        domainOptions.appendChild(option);
    });
}

async function selectDomain(domain) {
    // If selecting the same domain, do nothing
    if (domain === selectedDomain) {
        customDomainSelector.classList.remove('active');
        if (domainTrigger) domainTrigger.setAttribute('aria-expanded', 'false');
        return;
    }

    selectedDomain = domain;
    localStorage.setItem('selectedDomain', selectedDomain);

    showToast(`Switching to @${selectedDomain}...`);

    // Re-render to update selected state and text
    renderDomainOptions();

    // Close dropdown
    customDomainSelector.classList.remove('active');
    if (domainTrigger) domainTrigger.setAttribute('aria-expanded', 'false');

    // Generate new email with the new domain immediately
    await generateEmail();
}

// --- Initialization ---

async function init() {
    // Try to load from localStorage first
    const savedEmail = localStorage.getItem('currentEmail');
    if (savedEmail) {
        currentEmail = savedEmail;
        updateCurrentEmailUI();
        startPolling();
        showToast(`Accsess ${currentEmail}`);
        return;
    }

    // Auto-generate if validation fails or empty
    if (!currentEmail) {
        await generateEmail();
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    await initializeDomainSelector();
    init();
});

// --- API Calls ---

async function fetchActiveEmails() {
    try {
        const res = await fetch(`${API_BASE}/emails`);
        const data = await res.json();

        if (data.generated_emails && data.generated_emails.length > 0) {
            currentEmail = data.generated_emails[data.generated_emails.length - 1];
            updateCurrentEmailUI();
            startPolling();
        } else {
            currentEmail = null;
            updateCurrentEmailUI();
        }
    } catch (err) {
        console.error('❌ Error fetching emails:', err);
    }
}

let isGenerating = false;

async function generateEmail() {
    if (isGenerating) return;
    isGenerating = true;

    try {
        setLoading(true);
        const res = await fetch(`${API_BASE}/create?domain=${encodeURIComponent(selectedDomain)}`, { method: 'POST' });
        const data = await res.json();

        if (data.email) {
            currentEmail = data.email;
            localStorage.setItem('currentEmail', currentEmail);
            updateCurrentEmailUI();
            startPolling();
        }
    } catch (err) {
        console.error('❌ Error creating email:', err);
        showToast("Error creating email");
    } finally {
        isGenerating = false;
        setLoading(false);
    }
}

async function fetchMessages() {
    if (!currentEmail) {
        return;
    }

    try {
        const url = `${API_BASE}/messages?email=${encodeURIComponent(currentEmail)}`;

        const res = await fetch(url);

        if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`HTTP ${res.status}: ${errorText}`);
        }

        const data = await res.json();

        if (data.error) {
            showToast(`Error: ${data.error}`);
            allMessages = [];
            filterAndRender();
            return;
        }

        if (data.messages && Array.isArray(data.messages)) {
            allMessages = data.messages;
            filterAndRender();
        } else {
            allMessages = [];
            filterAndRender();
        }
    } catch (err) {
        console.error('❌ Error fetching messages:', err);
        showToast('Failed to fetch messages');
        allMessages = [];
        filterAndRender();
    }
}

async function deleteCurrentEmail() {
    if (!currentEmail) return;

    if (!confirm(`Are you sure you want to delete ${currentEmail}?`)) {
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/delete?email=${encodeURIComponent(currentEmail)}`, { method: 'DELETE' });

        if (res.ok) {
            showToast("Email deleted");
            currentEmail = null;
            localStorage.removeItem('currentEmail');
            stopPolling();
            init();
        } else {
            showToast("Failed to delete");
        }
    } catch (err) {
        console.error('❌ Error deleting:', err);
    }
}

// --- UI Logic ---

function updateCurrentEmailUI() {
    if (currentEmail) {
        currentEmailText.textContent = currentEmail;
    } else {
        currentEmailText.textContent = "No Active Email";
        allMessages = [];
        filterAndRender();
    }
}

function filterAndRender() {
    const query = searchInput ? searchInput.value.toLowerCase() : '';

    let filtered = allMessages;
    if (query) {
        filtered = allMessages.filter(msg => {
            const subject = (msg.subject || '').toLowerCase();
            const from = (msg.from || '').toLowerCase();
            const body = (msg.text || '').toLowerCase();
            const matches = subject.includes(query) || from.includes(query) || body.includes(query);
            return matches;
        });
    }

    renderEmailList(filtered);
}

function renderEmailList(messages) {
    if (!emailListContainer) {
        return;
    }

    emailListContainer.innerHTML = '';

    if (!messages || messages.length === 0) {
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

    // Sort by date desc
    messages.sort((a, b) => new Date(b.date) - new Date(a.date));

    messages.forEach((msg, index) => {
        const row = document.createElement('div');
        row.className = 'email-row group';
        row.innerHTML = `
            <div class="flex flex-col min-w-0">
                <div class="font-bold text-slate-900 dark:text-white truncate group-hover:text-primary-600 transition-colors">${escapeHtml(msg.from || 'Unknown')}</div>
                <div class="text-sm font-semibold text-slate-700 dark:text-slate-300 truncate">${escapeHtml(msg.subject || '(No Subject)')}</div>
                <div class="text-xs text-slate-500 dark:text-slate-400 truncate md:hidden">${escapeHtml(msg.text ? msg.text.substring(0, 60) : '')}</div>
            </div>
            <div class="hidden md:flex flex-col min-w-0">
                <div class="text-sm text-slate-600 dark:text-slate-400 truncate">${escapeHtml(msg.text ? msg.text.substring(0, 120) : '')}</div>
            </div>
            <div class="text-right flex flex-col items-end gap-1">
                <div class="text-[10px] md:text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">${formatTime(msg.date)}</div>
                <div class="w-2 h-2 rounded-full bg-primary-500 opacity-0 group-hover:opacity-100 transition-opacity"></div>
            </div>
        `;

        row.onclick = () => {
            openDetail(msg);
        };

        emailListContainer.appendChild(row);
    });
}

function openDetail(msg) {
    // Show overlay
    detailView.classList.add('active');

    // Handled by active class in CSS

    detailSubject.textContent = msg.subject || '(No Subject)';

    // Clean sender name (remove <email> if present)
    let senderName = msg.from || 'Unknown';
    if (senderName.includes('<')) {
        senderName = senderName.split('<')[0].trim();
        // Remove quotes if present
        senderName = senderName.replace(/^["']|["']$/g, '');
    }

    detailSenderName.textContent = senderName;
    detailSenderEmail.textContent = `<${msg.from_email || 'unknown@example.com'}>`;

    // Format date like Gmail (e.g., "16 Jan 2026, 15:05")
    const date = new Date(msg.date);
    const options = { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' };
    detailDate.textContent = date.toLocaleDateString('en-GB', options).replace(',', '');

    // Set recipient (current email)
    const recipientEl = document.getElementById('detailRecipient');
    if (recipientEl && currentEmail) {
        recipientEl.textContent = currentEmail;
    }

    // Avatar
    const initial = (msg.from || 'U').charAt(0).toUpperCase();
    senderAvatar.textContent = initial;

    // Parse body
    if (msg.html) {
        const sanitized = msg.html.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gm, "")
            .replace(/on\w+="[^"]*"/g, "");
        detailBody.innerHTML = sanitized;
    } else {
        detailBody.textContent = msg.text || '(No Content)';
    }
}

function closeDetail() {
    detailView.classList.remove('active');
}

function copyEmail() {
    if (!currentEmail) return;

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(currentEmail).then(() => {
            showToast("Address copied to clipboard");
        }).catch(err => {
            fallbackCopy(currentEmail);
        });
    } else {
        fallbackCopy(currentEmail);
    }
}

function fallbackCopy(text) {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.top = "0";
    textArea.style.left = "0";
    textArea.style.opacity = "0";

    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    try {
        const successful = document.execCommand('copy');
        if (successful) {
            showToast("Address copied to clipboard");
        } else {
            showToast("Failed to copy");
        }
    } catch (err) {
        showToast("Failed to copy");
    }

    document.body.removeChild(textArea);
}

async function refreshInbox() {
    const refreshBtnIcon = document.querySelector('button[onclick="refreshInbox()"] ion-icon');
    if (refreshBtnIcon) refreshBtnIcon.classList.add('rotating');

    showToast("Checking for new messages...");

    await fetchMessages();

    if (refreshBtnIcon) refreshBtnIcon.classList.remove('rotating');
    showToast("Inbox updated");
}

function showToast(message) {
    if (!toast) return;
    const toastMessage = document.getElementById('toastMessage');
    if (toastMessage) toastMessage.textContent = message;
    toast.classList.remove('opacity-0', 'translate-y-8');
    toast.classList.add('opacity-100', 'translate-y-0');
    setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-y-8');
        toast.classList.remove('opacity-100', 'translate-y-0');
    }, 3000);
}

function setLoading(isLoading) {
    const btn = document.getElementById('generateBtn');
    if (!btn) return;
    if (isLoading) {
        const span = btn.querySelector('span');
        if (span) span.textContent = "Generating...";
        btn.disabled = true;
    } else {
        const span = btn.querySelector('span');
        if (span) span.textContent = "New Address";
        btn.disabled = false;
    }
}

// --- Helpers ---

function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatTime(dateStr) {
    const date = new Date(dateStr);
    const now = new Date();
    if (date.toDateString() === now.toDateString()) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function startPolling() {
    if (pollingInterval) clearInterval(pollingInterval);
    fetchMessages();
    pollingInterval = setInterval(fetchMessages, 15000);
}

function stopPolling() {
    if (pollingInterval) clearInterval(pollingInterval);
}

// --- Search Logic ---

if (searchInput) {
    searchInput.addEventListener('input', (e) => {
        filterAndRender();
    });

    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            filterAndRender();
            searchInput.blur();
        }
    });
}

// Bind click on search icon
const searchContainer = document.querySelector('.search-bar');
if (searchContainer) {
    const icon = searchContainer.querySelector('ion-icon');
    if (icon) {
        icon.style.cursor = 'pointer';
        icon.onclick = () => {
            filterAndRender();
        };
    }
}

// --- Modal Functions ---
const accessModal = document.getElementById('accessModal');
const accessBtn = document.getElementById('accessBtn');
const accessEmailInput = document.getElementById('accessEmailInput');

function openAccessModal() {
    if (accessModal) {
        accessModal.classList.add('active');
        if (accessEmailInput) {
            setTimeout(() => accessEmailInput.focus(), 100);
        }
    }
    // Auto-close sidebar on mobile
    if (sidebar && sidebar.classList.contains('active')) {
        sidebar.classList.remove('active');
    }
}

function closeAccessModal() {
    if (accessModal) {
        accessModal.classList.remove('active');
        if (accessEmailInput) {
            accessEmailInput.value = '';
        }
    }
}

async function accessExistingEmail() {
    const email = accessEmailInput ? accessEmailInput.value.trim() : '';

    if (!email) {
        showToast('Please enter an email address');
        return;
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        showToast('Please enter a valid email address');
        return;
    }

    // Check if domain is in available domains
    const domain = email.split('@')[1];
    const isSupported = availableDomains.includes(domain);

    if (!isSupported) {
        showToast(`Domain @${domain} is not supported`);
        return;
    }

    currentEmail = email;
    localStorage.setItem('currentEmail', currentEmail);
    updateCurrentEmailUI();
    closeAccessModal();

    // Start fetching messages
    stopPolling();
    startPolling();

    showToast(`Accessing inbox for ${email}`);
}

// Close modal when clicking outside
if (accessModal) {
    accessModal.addEventListener('click', (e) => {
        if (e.target === accessModal) {
            closeAccessModal();
        }
    });
}

// Handle Enter key in access email input
if (accessEmailInput) {
    accessEmailInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            accessExistingEmail();
        }
    });
}

// Bind events
const generateBtn = document.getElementById('generateBtn');
if (generateBtn) {
    generateBtn.addEventListener('click', generateEmail);
}

if (accessBtn) {
    accessBtn.addEventListener('click', openAccessModal);
}

// --- Custom Email Modal ---
const customModal = document.getElementById('customModal');
const customUsernameInput = document.getElementById('customUsernameInput');
const customModalDomainDisplay = document.getElementById('customModalDomainDisplay');

function openCustomModal() {
    if (customModal) {
        customModal.classList.add('active');
        if (customModalDomainDisplay) {
            customModalDomainDisplay.textContent = `@${selectedDomain}`;
        }
        if (customUsernameInput) {
            setTimeout(() => customUsernameInput.focus(), 100);
        }
    }
}

function closeCustomModal() {
    if (customModal) {
        customModal.classList.remove('active');
        if (customUsernameInput) customUsernameInput.value = '';
    }
}

async function generateCustomEmail() {
    const username = customUsernameInput ? customUsernameInput.value.trim() : '';
    if (!username) {
        showToast("Please enter a username");
        return;
    }

    // basic validation
    if (!/^[a-zA-Z0-9._-]+$/.test(username)) {
        showToast("Invalid characters. Use letters, numbers, dot, -, _");
        return;
    }

    closeCustomModal();

    // Call API with username
    try {
        setLoading(true);
        const res = await fetch(`${API_BASE}/create?domain=${encodeURIComponent(selectedDomain)}&username=${encodeURIComponent(username)}`, { method: 'POST' });

        const data = await res.json();

        if (!res.ok) {
            showToast(data.error || "Failed to create custom email");
            return;
        }

        if (data.email) {
            currentEmail = data.email;
            localStorage.setItem('currentEmail', currentEmail);
            updateCurrentEmailUI();
            startPolling();
            showToast(`Created ${currentEmail}`);
        }
    } catch (err) {
        console.error("Error creating custom email", err);
        showToast("Error creating email");
    } finally {
        setLoading(false);
    }
}

// Close on outside click for custom modal
if (customModal) {
    customModal.addEventListener('click', (e) => {
        if (e.target === customModal) closeCustomModal();
    });
}
// Enter key for custom input
if (customUsernameInput) {
    customUsernameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') generateCustomEmail();
    });
}

// Expose to window for onclick handlers
window.openCustomModal = openCustomModal;
window.closeCustomModal = closeCustomModal;
window.generateCustomEmail = generateCustomEmail;

// --- Sidebar Logic ---
function toggleSidebar() {
    if (sidebar) {
        sidebar.classList.toggle('active');
    }
}

// Close sidebar when clicking outside
document.addEventListener('click', (e) => {
    if (sidebar && sidebar.classList.contains('active')) {
        const isClickInsideSidebar = sidebar.contains(e.target);
        const isClickOnToggleButton = e.target.closest('.mobile-menu-btn');
        
        if (!isClickInsideSidebar && !isClickOnToggleButton) {
            sidebar.classList.remove('active');
        }
    }
});

// Expose to window
window.toggleSidebar = toggleSidebar;
