/**
 * Gmail Dot Trick Generator
 *
 * Gmail ignores dots in the local part, so rev.d@gmail.com and
 * revd@gmail.com are the same inbox. But the TO header in IMAP
 * preserves the exact address used, making each variant searchable.
 *
 * For a username of length n, there are 2^(n-1) possible variants.
 * We cap at 200 to avoid browser freezes for long usernames.
 */

const MAX_VARIANTS = 200;

/**
 * @param {string} email  - e.g. "revd@gmail.com"
 * @returns {{ variants: string[], truncated: boolean }}
 */
function generateGmailVariants(email) {
    if (!email || typeof email !== 'string') {
        return { variants: [], truncated: false };
    }

    const lower = email.toLowerCase().trim();
    const atIdx = lower.indexOf('@');
    if (atIdx === -1) return { variants: [], truncated: false };

    const domain = lower.slice(atIdx + 1);
    if (domain !== 'gmail.com' && domain !== 'googlemail.com') {
        return { variants: [], truncated: false };
    }

    // Strip existing dots — Gmail treats them as identical anyway
    const local = lower.slice(0, atIdx).replace(/\./g, '');
    if (local.length < 2) return { variants: [lower], truncated: false };

    const chars = local.split('');
    const n = chars.length;
    const total = Math.pow(2, n - 1);
    const limit = Math.min(total, MAX_VARIANTS);
    const variants = [];

    for (let i = 0; i < limit; i++) {
        let v = chars[0];
        for (let j = 0; j < n - 1; j++) {
            if (i & (1 << j)) v += '.';
            v += chars[j + 1];
        }
        variants.push(`${v}@${domain}`);
    }

    return { variants, truncated: total > MAX_VARIANTS };
}

module.exports = { generateGmailVariants };
