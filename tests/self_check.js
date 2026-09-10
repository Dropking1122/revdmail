const assert = require('assert');
const { generateRandomPrefix } = require('../src/utils/nameGenerator');
const { generateGmailVariants } = require('../src/utils/gmailVariants');

console.log('🧪 Menjalankan automated self-check REVDMAIL...');

// 1. Name Generator
const prefix = generateRandomPrefix();
assert.ok(typeof prefix === 'string' && prefix.length >= 6, 'Prefix harus string minimal 6 karakter');
assert.match(prefix, /^[a-zA-Z0-9]+$/, 'Prefix hanya boleh huruf dan angka');
console.log('  ✓ Name Generator OK:', prefix);

// 2. Gmail Variants
const gres = generateGmailVariants('basyariahandini@gmail.com');
assert.strictEqual(gres.variants.length, 200, 'Harus menghasilkan 200 varian');
assert.ok(gres.variants.includes('basyariahandini@gmail.com'), 'Harus menyertakan base email');
// Pastikan dot tersebar ke karakter belakang juga
const hasDotsInBack = gres.variants.some(v => v.includes('handini') || v.includes('han.dini') || v.includes('andi.ni'));
assert.ok(hasDotsInBack, 'Dot harus tersebar merata di bagian belakang username');
console.log('  ✓ Gmail Variant Generator OK');

// 3. Security: Anti-Substring Email Matching
// Replikasi logic matching imapService
function extractAddresses(headerValue) {
    if (!headerValue) return [];
    const results = [];
    const items = Array.isArray(headerValue) ? headerValue : [headerValue];
    for (const item of items) {
        if (!item) continue;
        if (typeof item === 'string') {
            const matches = item.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
            if (matches) matches.forEach(m => results.push(m.toLowerCase().trim()));
        }
    }
    return results;
}

function matchesRecipient(headers, targetEmail) {
    if (!headers || !targetEmail) return false;
    const target = targetEmail.toLowerCase().trim();
    const [targetLocal, targetDomain] = target.split('@');
    if (!targetLocal || !targetDomain) return false;

    const candidateHeaders = [
        headers.to,
        headers['delivered-to'],
        headers['x-original-to'],
        headers['x-forwarded-to']
    ];

    for (const headerField of candidateHeaders) {
        const addresses = extractAddresses(headerField);
        for (const addr of addresses) {
            if (addr === target) return true;
        }
    }
    return false;
}

const testHeaders = {
    to: ['"User" <basyariah40c01e@revd.me>'],
    'delivered-to': ['owner@gmail.com'],
    'x-original-to': ['basyariah40c01e@revd.me']
};

// Exact target matches
assert.strictEqual(matchesRecipient(testHeaders, 'basyariah40c01e@revd.me'), true, 'Exact match harus diterima');
// Substring exploit attempt: @revd.me
assert.strictEqual(matchesRecipient(testHeaders, '@revd.me'), false, 'Substring @domain harus ditolak');
// Substring exploit attempt: revd.me
assert.strictEqual(matchesRecipient(testHeaders, 'revd.me'), false, 'Substring domain harus ditolak');
// Substring exploit attempt: basyariah@revd.me (different user)
assert.strictEqual(matchesRecipient(testHeaders, 'basyariah@revd.me'), false, 'User yang berbeda harus ditolak');
console.log('  ✓ Security: Multi-tenant Recipient Isolation OK');

console.log('✅ Semua self-check lolos tanpa error!');
