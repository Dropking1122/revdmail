const fs = require('fs');
const path = require('path');

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
    if (allNames.length === 0) {
        return 'user' + Math.floor(Math.random() * 100000);
    }

    const randomName = allNames[Math.floor(Math.random() * allNames.length)];
    // Clean name (remove non-alphanumeric if needed, but usually assume txt is clean)
    const cleanName = randomName.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    const randomNum = Math.floor(Math.random() * 1000);
    return `${cleanName}${randomNum}`;
}

module.exports = { generateRandomPrefix };
