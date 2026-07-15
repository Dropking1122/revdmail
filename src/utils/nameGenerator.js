const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let maleNames = [];
let femaleNames = [];

function loadNames() {
    try {
        const malePath = path.join(__dirname, '../../username/pria.txt');
        const femalePath = path.join(__dirname, '../../username/perempuan.txt');

        if (fs.existsSync(malePath)) {
            maleNames = fs.readFileSync(malePath, 'utf-8').split('\n').map(n => n.trim()).filter(n => n);
        }
        if (fs.existsSync(femalePath)) {
            femaleNames = fs.readFileSync(femalePath, 'utf-8').split('\n').map(n => n.trim()).filter(n => n);
        }
    } catch (err) {
        console.error("Error loading names:", err);
    }
}

// Initial load
loadNames();

function generateRandomPrefix() {
    const allNames = [...maleNames, ...femaleNames];
    const base = allNames.length === 0
        ? 'user'
        : allNames[Math.floor(Math.random() * allNames.length)].replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

    // Cryptographically random suffix instead of Math.random() 0-999.
    // A name + 3 digit number only has ~1000 combinations per name, which is
    // brute-forceable given this app has no per-address ownership check.
    // 6 hex chars (~16.7M combinations per name) makes addresses effectively
    // unguessable while still looking human-readable.
    const randomSuffix = crypto.randomBytes(3).toString('hex');
    return `${base}${randomSuffix}`;
}

module.exports = { generateRandomPrefix };
