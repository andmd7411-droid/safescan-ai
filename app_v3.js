// SafeScan AI - Production Logic V3.0 (ROBUST-FIXED)
// Includes Massive Database, Scan History, and Full Ingredient Display
console.log("SafeScan AI V3.0 Loading...");

// App State
let sessionScore = 100;
let isScanning = false;
let videoStream = null;
let scanHistory = [];

// User Profile State
let userProfile = {
    allergies: {
        gluten: false,
        lactose: false,
        peanuts: false,
        pork: false,
        sugar: false
    }
};

// DOM Refs (filled on load)
let videoElement, canvasElement, scanBtn, uploadBtn, fileInput, bubble, reticle;
let scoreDisplay, scanningText, errorOverlay, profileModal, btnOpenProfile;
let btnCloseProfile, btnSaveProfile, allergyToggles;

// Core Initialization
document.addEventListener('DOMContentLoaded', () => {
    console.log("SafeScan AI - DOM Loaded. Initializing...");

    // Bind DOM
    videoElement = document.getElementById('camera-feed');
    canvasElement = document.getElementById('ocr-canvas');
    scanBtn = document.getElementById('btn-scan');
    uploadBtn = document.getElementById('btn-upload');
    fileInput = document.getElementById('file-input');
    bubble = document.getElementById('ar-bubble');
    reticle = document.getElementById('reticle');
    scoreDisplay = document.getElementById('session-score');
    scanningText = document.getElementById('scanning-text');
    errorOverlay = document.getElementById('camera-error');
    profileModal = document.getElementById('profile-modal');
    btnOpenProfile = document.getElementById('btn-profile');
    btnCloseProfile = document.getElementById('btn-close-profile');
    btnSaveProfile = document.getElementById('btn-save-profile');

    allergyToggles = {
        gluten: document.getElementById('pref-gluten'),
        lactose: document.getElementById('pref-lactose'),
        peanuts: document.getElementById('pref-peanuts'),
        pork: document.getElementById('pref-pork'),
        sugar: document.getElementById('pref-sugar')
    };

    // Attach Listeners
    if (scanBtn) scanBtn.addEventListener('click', startCameraScan);
    if (uploadBtn) uploadBtn.addEventListener('click', () => fileInput.click());
    if (fileInput) fileInput.addEventListener('change', handleFileUpload);
    if (btnOpenProfile) btnOpenProfile.addEventListener('click', () => profileModal.classList.remove('hidden'));
    if (btnCloseProfile) btnCloseProfile.addEventListener('click', () => profileModal.classList.add('hidden'));
    if (btnSaveProfile) btnSaveProfile.addEventListener('click', saveProfile);

    const btnHistory = document.getElementById('btn-history');
    if (btnHistory) btnHistory.addEventListener('click', () => {
        document.getElementById('history-modal').classList.remove('hidden');
        renderHistory();
    });

    const btnCloseHistory = document.getElementById('btn-close-history');
    if (btnCloseHistory) btnCloseHistory.addEventListener('click', () => document.getElementById('history-modal').classList.add('hidden'));

    const btnClearHistory = document.getElementById('btn-clear-history');
    if (btnClearHistory) btnClearHistory.addEventListener('click', clearHistory);

    // Load Data
    const p = localStorage.getItem('safescan_profile');
    if (p) {
        userProfile = JSON.parse(p);
        Object.keys(allergyToggles).forEach(k => {
            if (allergyToggles[k]) allergyToggles[k].checked = userProfile.allergies[k];
        });
    }
    const h = localStorage.getItem('safescan_history');
    if (h) scanHistory = JSON.parse(h);

    const btnReset = document.getElementById('btn-reset-cache');
    if (btnReset) btnReset.addEventListener('click', resetAppCache);

    // Init Camera
    initCamera();
});

async function resetAppCache() {
    if (confirm("This will clear all settings and history to fix loading issues. Continue?")) {
        localStorage.clear();
        if ('caches' in window) {
            const keys = await caches.keys();
            await Promise.all(keys.map(key => caches.delete(key)));
        }
        // Force reload with unique param to bust server cache
        window.location.href = window.location.pathname + "?reset=" + Date.now();
    }
}

async function initCamera() {
    console.log("Initializing Camera...");
    if (!window.isSecureContext && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1' && !window.location.hostname.startsWith('192.168.')) {
        console.warn("Non-secure context. Camera might fail.");
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        console.warn("Camera API not available.");
        handleCameraError();
        return;
    }

    try {
        const constraints = {
            video: {
                facingMode: 'environment',
                width: { ideal: 1280 },
                height: { ideal: 720 }
            }
        };
        videoStream = await navigator.mediaDevices.getUserMedia(constraints);
        videoElement.srcObject = videoStream;
        if (scanBtn) scanBtn.classList.remove('hidden');
        if (uploadBtn) uploadBtn.classList.add('hidden');
        if (errorOverlay) errorOverlay.classList.add('hidden');
    } catch (err) {
        console.error("Camera access failed:", err);
        handleCameraError();
    }
}

function handleCameraError() {
    if (reticle) reticle.style.display = 'none';
    if (scanningText) scanningText.style.display = 'none';
    if (errorOverlay) errorOverlay.classList.remove('hidden');
    if (scanBtn) scanBtn.classList.add('hidden');
    if (uploadBtn) {
        uploadBtn.classList.remove('hidden');
        uploadBtn.style.display = 'block';
    }
}

// Scanning & OCR
async function startCameraScan() {
    if (isScanning) return;
    if (!videoElement || videoElement.readyState < 2 || videoElement.videoWidth === 0) {
        alert("Camera not ready. Please use PHOTO.");
        handleCameraError();
        return;
    }
    isScanning = true;
    updateUIForScanning("Analyzing...");
    try {
        const image = captureFrame();
        await performOCR(image);
    } catch (err) {
        console.error("Scan Error:", err);
        resetScanUI();
    }
}

function captureFrame() {
    const context = canvasElement.getContext('2d');
    canvasElement.width = videoElement.videoWidth;
    canvasElement.height = videoElement.videoHeight;
    context.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height);
    return preprocessImage(canvasElement);
}

function preprocessImage(canvas) {
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
        let gray = 0.21 * data[i] + 0.72 * data[i + 1] + 0.07 * data[i + 2];
        const factor = 1.5;
        gray = Math.max(0, Math.min(255, factor * (gray - 128) + 128));
        data[i] = data[i + 1] = data[i + 2] = gray;
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL('image/png');
}

async function performOCR(imageData) {
    if (typeof Tesseract === 'undefined') {
        alert("OCR Engine not loaded. Check internet connection.");
        resetScanUI();
        return;
    }

    try {
        const { data: { text } } = await Tesseract.recognize(imageData, 'eng+fra+ron', {
            logger: m => {
                if (m.status === 'recognizing text' && scanningText) {
                    scanningText.innerText = `Reading... ${Math.floor(m.progress * 100)}%`;
                }
            }
        });
        analyzeText(text);
        resetScanUI();
    } catch (err) {
        console.error("Tesseract Error:", err);
        resetScanUI();
    }
}

function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
        const img = new Image();
        img.onload = () => {
            const ctx = canvasElement.getContext('2d');
            let scale = Math.min(1, 1000 / img.width);
            canvasElement.width = img.width * scale;
            canvasElement.height = img.height * scale;
            ctx.drawImage(img, 0, 0, canvasElement.width, canvasElement.height);
            const data = preprocessImage(canvasElement);
            isScanning = true;
            updateUIForScanning("Processing...");
            performOCR(data);
        };
        img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
}

// Analysis Logic
function analyzeText(scannedText) {
    let normalizedText = scannedText.toUpperCase()
        .replace(/E\s*[-]?\s*(\d{3,4}[a-z]?)/gi, "E$1")
        .replace(/[^A-Z0-9,\s\-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    console.log("OCR Result:", normalizedText);
    const tokens = normalizedText.split(/[\s,]+/);
    let foundIngredients = [];

    tokens.forEach(token => {
        if (token.length < 3) return;
        let match = INGREDIENTS_DB.find(item => item.code === token);
        if (match && !foundIngredients.find(i => i.code === match.code)) {
            foundIngredients.push({ ...match, type: 'code' });
        }
    });

    INGREDIENTS_DB.forEach(item => {
        const names = [item.name.toUpperCase(), ...item.alt.toUpperCase().split(/\s*[/,|]\s*/)];
        if (names.some(name => name.length >= 3 && normalizedText.includes(name))) {
            if (!foundIngredients.find(r => r.code === item.code)) {
                foundIngredients.push({ ...item, type: 'name' });
            }
        }
    });

    foundIngredients.forEach(ing => {
        const cat = (ing.category || "").toLowerCase();
        const name = (ing.name || "").toLowerCase();
        const alt = (ing.alt || "").toLowerCase();
        let isAllergy = false;
        if (userProfile.allergies.gluten && (cat.includes("gluten") || name.includes("gluten") || alt.includes("grâu") || alt.includes("wheat") || alt.includes("secara") || alt.includes("orz"))) isAllergy = true;
        if (userProfile.allergies.lactose && (cat.includes("lacto") || name.includes("lapte") || alt.includes("lapte") || alt.includes("milk") || alt.includes("lactoza"))) isAllergy = true;
        if (userProfile.allergies.peanuts && (cat.includes("alun") || cat.includes("arahid") || alt.includes("peanut") || alt.includes("arahid"))) isAllergy = true;
        if (userProfile.allergies.pork && (cat.includes("porc") || alt.includes("porc") || alt.includes("gelatină") || alt.includes("untură"))) isAllergy = true;
        if (userProfile.allergies.sugar && (cat.includes("zahar") || name.includes("sugar") || alt.includes("zahar") || alt.includes("sirop"))) isAllergy = true;

        if (isAllergy) {
            ing.risk = 3;
            ing.desc = "⚠️ ALERGIE! / ALLERGY! " + ing.desc;
            ing.isAllergen = true;
        }
    });

    foundIngredients.sort((a, b) => b.risk - a.risk);
    const nutrition = findNutrition(scannedText);
    showResultList(foundIngredients, nutrition);

    let maxRisk = foundIngredients.length > 0 ? foundIngredients[0].risk : 1;
    if (nutrition && nutrition.risk > maxRisk) maxRisk = nutrition.risk;
    updateScore(maxRisk);
    saveScanToHistory(foundIngredients, nutrition);
}

function showResultList(ingredients, nutrition) {
    const title = document.getElementById('risk-title');
    const desc = document.getElementById('risk-desc');
    const icon = document.getElementById('risk-icon');
    let html = "";
    if (nutrition) {
        let color = nutrition.risk === 3 ? "text-red" : (nutrition.risk === 2 ? "text-yellow" : "text-green");
        html += `<div style="margin-bottom:8px; font-weight:bold; border-bottom:1px solid rgba(255,255,255,0.2);">
                    🍫 Fats: ${nutrition.value}g <span class="${color}">(${nutrition.label})</span>
                  </div>`;
    }
    if (ingredients.length > 0) {
        title.innerText = `Detected ${ingredients.length} Items:`;
        ingredients.forEach(ing => {
            let color = ing.risk === 3 ? "#e74c3c" : (ing.risk === 2 ? "#f1c40f" : "#2ecc71");
            html += `<li style="color:${color}; margin-bottom:12px; list-style:none; border-left:4px solid ${color}; padding-left:12px; background: rgba(0,0,0,0.05); border-radius: 4px; padding: 8px;">
                        <span style="font-weight:bold; color:#2c3e50;">${ing.isAllergen ? '❗ ' : ''}${ing.code ? ing.code + ' - ' : ''}${ing.name}</span><br>
                        <span style="font-size:0.85em; color:#444;">${ing.desc}</span>
                      </li>`;
        });
    } else {
        title.innerText = "Product Seems SAFE";
        html += "<p>No dangerous additives detected.</p>";
    }
    if (desc) desc.innerHTML = html;
    if (bubble) {
        bubble.className = "";
        let risk = (ingredients.length > 0) ? ingredients[0].risk : 1;
        if (nutrition && nutrition.risk > risk) risk = nutrition.risk;
        bubble.classList.add(risk === 3 ? 'risk-danger' : (risk === 2 ? 'risk-warning' : 'risk-safe'));
        if (icon) icon.innerText = risk > 1 ? "!" : "✓";
        bubble.classList.remove('hidden');
    }
}

// History & Score
function saveScanToHistory(ingredients, nutrition) {
    const timestamp = new Date().toLocaleString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const entry = {
        time: timestamp,
        count: ingredients.length,
        maxRisk: ingredients.length > 0 ? ingredients[0].risk : (nutrition ? nutrition.risk : 1),
        items: ingredients.length > 0 ? ingredients.map(i => i.name).join(', ') : (nutrition ? "Nutrition Risk" : "Safe Product")
    };
    scanHistory.unshift(entry);
    if (scanHistory.length > 50) scanHistory.pop();
    localStorage.setItem('safescan_history', JSON.stringify(scanHistory));
}

function renderHistory() {
    const list = document.getElementById('history-list');
    if (!list) return;
    list.innerHTML = scanHistory.length ? "" : "<p style='text-align:center; opacity:0.6;'>No scans yet.</p>";
    scanHistory.forEach(scan => {
        let color = scan.maxRisk === 3 ? "#e74c3c" : (scan.maxRisk === 2 ? "#f1c40f" : "#2ecc71");
        list.innerHTML += `
            <div style="border-bottom:1px solid rgba(255,255,255,0.1); padding:10px 0;">
                <div style="display:flex; justify-content:space-between; font-size:0.8em; opacity:0.7;">
                    <span>${scan.time}</span>
                    <span style="color:${color}; font-weight:bold;">${scan.count} ingrediente</span>
                </div>
                <div style="font-size:0.9em; margin-top:4px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${scan.items}</div>
            </div>`;
    });
}

function clearHistory() {
    if (confirm("Reset History?")) {
        scanHistory = [];
        localStorage.removeItem('safescan_history');
        renderHistory();
    }
}

function saveProfile() {
    Object.keys(allergyToggles).forEach(k => {
        if (allergyToggles[k]) userProfile.allergies[k] = allergyToggles[k].checked;
    });
    localStorage.setItem('safescan_profile', JSON.stringify(userProfile));
    if (profileModal) profileModal.classList.add('hidden');
}

function updateScore(risk) {
    if (risk === 3) sessionScore -= 20;
    else if (risk === 2) sessionScore -= 10;
    else sessionScore += 5;
    sessionScore = Math.max(0, Math.min(100, sessionScore));
    if (scoreDisplay) {
        scoreDisplay.innerText = sessionScore;
        scoreDisplay.style.color = sessionScore > 70 ? '#2ecc71' : (sessionScore > 40 ? '#f1c40f' : '#e74c3c');
    }
}

function findNutrition(text) {
    // Standardized Regex (GI instead of YI)
    const fatRegex = /(?:gr[aă]simi|fats?|lipides?)\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*g?/gi;
    const matches = text.matchAll(fatRegex);
    for (const match of matches) {
        if (match[1]) {
            const val = parseFloat(match[1].replace(',', '.'));
            let risk = val > 17.5 ? 3 : (val > 3 ? 2 : 1);
            return { value: val, risk, label: risk === 3 ? "High Fat" : (risk === 2 ? "Medium Fat" : "Low Fat") };
        }
    }
    return null;
}

// UI Helpers
function resetScanUI() {
    isScanning = false;
    if (scanBtn) { scanBtn.disabled = false; scanBtn.innerText = "SCAN"; }
    if (reticle) reticle.classList.remove('scanning');
}

function updateUIForScanning(text) {
    if (scanBtn) { scanBtn.disabled = true; scanBtn.innerText = "⌛"; }
    if (scanningText) scanningText.innerText = text;
    if (reticle) reticle.classList.add('scanning');
    if (bubble) bubble.classList.add('hidden');
}
