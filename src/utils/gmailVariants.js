/**
 * Gmail Dot Trick Generator
 *
 * Gmail ignores dots in the local part of an address (e.g. rev.d@gmail.com and
 * revd@gmail.com map to the same inbox).
 *
 * For usernames of length n, there are 2^(n-1) possible dot variations.
 * This generator evenly distributes dot placements across the entire username.
 */

const MAX_VARIANTS = 200;

/**
 * @param {string} email - e.g. "revd@gmail.com"
 * @returns {{ variants: string[], truncated: boolean, total: number }}
 */
function generateGmailVariants(email) {
    if (!email || typeof email !== 'string') {
        return { variants: [], truncated: false, total: 0 };
    }

    const lower = email.toLowerCase().trim();
    const atIdx = lower.indexOf('@');
    if (atIdx === -1) return { variants: [], truncated: false, total: 0 };

    const domain = lower.slice(atIdx + 1);
    if (domain !== 'gmail.com' && domain !== 'googlemail.com') {
        return { variants: [], truncated: false, total: 0 };
    }

    const local = lower.slice(0, atIdx).replace(/\./g, '');
    if (local.length < 2) {
        return { variants: [`${local}@${domain}`], truncated: false, total: 1 };
    }

    const chars = local.split('');
    const slots = chars.length - 1; // number of positions where dots can be inserted
    const totalPossible = Math.pow(2, slots);
    const limit = Math.min(totalPossible, MAX_VARIANTS);
    const variantsSet = new Set();

    // 1. Base clean version
    variantsSet.add(`${local}@${domain}`);

    if (slots <= 8) {
        // Enumerate exhaustively for shorter usernames
        for (let i = 1; i < totalPossible && variantsSet.size < limit; i++) {
            let v = chars[0];
            for (let j = 0; j < slots; j++) {
                if ((i >> j) & 1) v += '.';
                v += chars[j + 1];
            }
            variantsSet.add(`${v}@${domain}`);
        }
    } else {
        // Uniform distribution for longer usernames:
        // A. Single dot placed at every single slot
        for (let s = 0; s < slots && variantsSet.size < limit; s++) {
            let v = '';
            for (let j = 0; j < chars.length; j++) {
                v += chars[j];
                if (j === s) v += '.';
            }
            variantsSet.add(`${v}@${domain}`);
        }

        // B. Double dots evenly spaced
        for (let s1 = 0; s1 < slots - 1 && variantsSet.size < limit; s1++) {
            for (let s2 = s1 + 2; s2 < slots && variantsSet.size < limit; s2 += 2) {
                let v = '';
                for (let j = 0; j < chars.length; j++) {
                    v += chars[j];
                    if (j === s1 || j === s2) v += '.';
                }
                variantsSet.add(`${v}@${domain}`);
            }
        }

        // C. Full alternating dot pattern
        variantsSet.add(`${chars.join('.')}@${domain}`);

        // D. Pseudo-random evenly distributed combinations
        for (let i = 1; variantsSet.size < limit && i < 2000; i++) {
            let v = chars[0];
            // Knuth multiplicative hash for uniform pseudo-random bit spread
            let seed = (i * 2654435761) >>> 0;
            for (let j = 0; j < slots; j++) {
                const bit = (seed >> (j % 31)) & 1;
                if (bit === 1) v += '.';
                v += chars[j + 1];
                // rotate seed
                seed = ((seed << 3) | (seed >>> 29)) >>> 0;
            }
            variantsSet.add(`${v}@${domain}`);
        }
    }

    const variants = Array.from(variantsSet).slice(0, limit);
    return {
        variants,
        truncated: totalPossible > limit,
        total: Math.min(totalPossible, 10000)
    };
}

module.exports = { generateGmailVariants };
