'use strict';

const http = require('http');
const API_BASE = 'https://api.nanit.com';

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Nanit Auth</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #0f0f0f;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      color: #e0e0e0;
      padding: 20px;
    }
    .card {
      background: #1a1a1a;
      border: 1px solid #2a2a2a;
      border-radius: 12px;
      padding: 32px;
      width: 100%;
      max-width: 400px;
    }
    .logo { font-size: 24px; font-weight: 700; color: #fff; margin-bottom: 4px; }
    .sub  { font-size: 13px; color: #666; margin-bottom: 28px; }
    label { display: block; font-size: 11px; font-weight: 600; color: #888;
            text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 6px; }
    input {
      width: 100%; padding: 10px 14px;
      background: #111; border: 1px solid #333; border-radius: 8px;
      color: #e0e0e0; font-size: 14px; outline: none;
      transition: border-color 0.15s; margin-bottom: 16px;
    }
    input:focus { border-color: #3b82f6; }
    button {
      width: 100%; padding: 11px;
      background: #3b82f6; color: #fff;
      border: none; border-radius: 8px;
      font-size: 14px; font-weight: 600; cursor: pointer;
      transition: background 0.15s; margin-top: 4px;
    }
    button:hover:not(:disabled) { background: #2563eb; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .alert {
      margin-top: 16px; padding: 11px 14px;
      border-radius: 8px; font-size: 13px; display: none;
    }
    .alert-success { background: #0f2a1a; border: 1px solid #16a34a; color: #4ade80; }
    .alert-error   { background: #2a0f0f; border: 1px solid #dc2626; color: #f87171; }
    .alert-warn    { background: #2a1f0f; border: 1px solid #d97706; color: #fbbf24; }
    .token-box {
      margin-top: 12px; padding: 10px 14px;
      background: #111; border: 1px solid #333; border-radius: 8px;
      font-family: monospace; font-size: 11px; word-break: break-all; color: #aaa;
    }
    .mfa-hint {
      font-size: 13px; color: #aaa; margin-bottom: 16px;
      padding: 10px 14px; background: #111; border-radius: 8px;
      border-left: 3px solid #3b82f6;
    }
    .spinner {
      display: inline-block; width: 13px; height: 13px;
      border: 2px solid rgba(255,255,255,0.3); border-top-color: #fff;
      border-radius: 50%; animation: spin 0.7s linear infinite;
      margin-right: 6px; vertical-align: middle;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
<div class="card">
  <div class="logo">Nanit</div>
  <div class="sub">Sign in to generate a Homebridge refresh token</div>

  <div id="step-login">
    <label>Email</label>
    <input type="email" id="email" placeholder="you@example.com" autocomplete="email">
    <label>Password</label>
    <input type="password" id="password" placeholder="••••••••" autocomplete="current-password">
    <button id="btn-login" onclick="login()">Sign In</button>
  </div>

  <div id="step-mfa" style="display:none">
    <div class="mfa-hint" id="mfa-hint">Code sent to your phone</div>
    <label>MFA Code</label>
    <input type="text" id="mfa-code" placeholder="123456" inputmode="numeric" maxlength="8" autocomplete="one-time-code">
    <button id="btn-mfa" onclick="verifyMfa()">Verify</button>
  </div>

  <div class="alert alert-success" id="alert-success"></div>
  <div class="alert alert-error"   id="alert-error"></div>
  <div class="alert alert-warn"    id="alert-warn"></div>
</div>

<script>
  let mfaToken, savedEmail, savedPassword;

  function busy(id, on, label) {
    const b = document.getElementById(id);
    b.disabled = on;
    b.innerHTML = on ? '<span class="spinner"></span>Please wait…' : label;
  }

  function showAlert(type, msg, extra) {
    ['success','error','warn'].forEach(t => {
      const el = document.getElementById('alert-'+t);
      el.style.display = 'none'; el.innerHTML = '';
    });
    const el = document.getElementById('alert-'+type);
    el.innerHTML = msg + (extra ? '<div class="token-box">'+extra+'</div>' : '');
    el.style.display = 'block';
  }

  async function post(path, body) {
    const r = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return r.json();
  }

  async function login() {
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    if (!email || !password) { showAlert('error', 'Email and password are required.'); return; }
    busy('btn-login', true, 'Sign In');
    const res = await post('/auth/login', { email, password }).catch(e => ({ status: 'error', message: e.message }));
    busy('btn-login', false, 'Sign In');
    if (res.status === 'success') return showSuccess(res.refresh_token);
    if (res.status === 'mfa_required') {
      savedEmail = email; savedPassword = password; mfaToken = res.mfa_token;
      document.getElementById('mfa-hint').textContent = 'Code sent to number ending in ' + res.phone_suffix;
      document.getElementById('step-login').style.display = 'none';
      document.getElementById('step-mfa').style.display = 'block';
      document.getElementById('mfa-code').focus();
    } else if (res.status === 'rate_limited') {
      showAlert('warn', 'Rate limited by Nanit. Wait 5 minutes and try again.');
    } else {
      showAlert('error', res.message || 'Login failed.');
    }
  }

  async function verifyMfa() {
    const mfa_code = document.getElementById('mfa-code').value.trim();
    if (!mfa_code) { showAlert('error', 'Enter the MFA code.'); return; }
    busy('btn-mfa', true, 'Verify');
    const res = await post('/auth/mfa', { email: savedEmail, password: savedPassword, mfa_token: mfaToken, mfa_code })
      .catch(e => ({ status: 'error', message: e.message }));
    busy('btn-mfa', false, 'Verify');
    if (res.status === 'success') return showSuccess(res.refresh_token);
    if (res.status === 'rate_limited') showAlert('warn', 'Rate limited. Wait 5 minutes.');
    else showAlert('error', res.message || 'MFA failed.');
  }

  function showSuccess(token) {
    document.getElementById('step-login').style.display = 'none';
    document.getElementById('step-mfa').style.display = 'none';
    showAlert('success',
      '✓ Authenticated! Copy this token into your Homebridge Nanit config as <b>refreshToken</b>:',
      token
    );
  }

  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    if (document.getElementById('step-mfa').style.display !== 'none') verifyMfa();
    else login();
  });
</script>
</body>
</html>`;

async function handleLogin(body) {
    const { email, password } = body;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let response;
    try {
        response = await fetch(`${API_BASE}/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'nanit-api-version': '1',
                'user-agent': 'Nanit/2.0.6 (com.nanit.app; build:2; iOS 16.0.0) Alamofire/5.4.4',
            },
            body: JSON.stringify({ email, password }),
            signal: controller.signal,
        });
    } finally {
        clearTimeout(timeout);
    }
    if (response.ok) {
        const data = await response.json();
        return { status: 'success', refresh_token: data.refresh_token };
    }
    if (response.status === 482) {
        const data = await response.json();
        return { status: 'mfa_required', mfa_token: data.mfa_token, phone_suffix: data.phone_suffix || '??' };
    }
    if (response.status === 429) return { status: 'rate_limited' };
    const text = await response.text();
    return { status: 'error', message: `Login failed (${response.status}): ${text}` };
}

async function handleMfa(body) {
    const { email, password, mfa_token, mfa_code } = body;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let response;
    try {
        response = await fetch(`${API_BASE}/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'nanit-api-version': '1',
                'user-agent': 'Nanit/2.0.6 (com.nanit.app; build:2; iOS 16.0.0) Alamofire/5.4.4',
            },
            body: JSON.stringify({ email, password, mfa_token, mfa_code }),
            signal: controller.signal,
        });
    } finally {
        clearTimeout(timeout);
    }
    if (response.ok) {
        const data = await response.json();
        return { status: 'success', refresh_token: data.refresh_token };
    }
    if (response.status === 429) return { status: 'rate_limited' };
    const text = await response.text();
    return { status: 'error', message: `MFA failed (${response.status}): ${text}` };
}

function startAuthServer(port, log) {
    const server = http.createServer(async (req, res) => {
        if (req.method === 'GET' && req.url === '/') {
            res.writeHead(302, { Location: '/auth' });
            return res.end();
        }
        if (req.method === 'GET' && req.url === '/auth') {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            return res.end(HTML);
        }
        if (req.method === 'POST' && (req.url === '/auth/login' || req.url === '/auth/mfa')) {
            let body = '';
            req.on('data', chunk => {
                if (body.length + chunk.length > 10240) {
                    res.writeHead(413, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 'error', message: 'Request too large' }));
                    req.destroy();
                    return;
                }
                body += chunk;
            });
            req.on('end', async () => {
                try {
                    const data = JSON.parse(body);
                    const result = req.url === '/auth/login'
                        ? await handleLogin(data)
                        : await handleMfa(data);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(result));
                } catch (err) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 'error', message: err.message }));
                }
            });
            return;
        }
        res.writeHead(404);
        res.end();
    });

    const tryListen = (attempt) => {
        server.listen(port, '127.0.0.1', () => {
            log.info(`Nanit auth page available at http://localhost:${port}/auth`);
        });
    };

    server.on('error', err => {
        if (err.code === 'EADDRINUSE' && server._retries < 5) {
            server._retries = (server._retries || 0) + 1;
            setTimeout(() => {
                server.close();
                tryListen();
            }, 3000);
        } else {
            log.warn(`Auth server could not start on port ${port}: ${err.message}`);
        }
    });

    server._retries = 0;
    tryListen();

    return server;
}

module.exports = { startAuthServer };
