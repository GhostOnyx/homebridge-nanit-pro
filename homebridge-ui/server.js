'use strict';

const { HomebridgePluginUiServer } = require('@homebridge/plugin-ui-utils');

const API_BASE = 'https://api.nanit.com';

class NanitUiServer extends HomebridgePluginUiServer {
    constructor() {
        super();
        this.onRequest('/login', this.handleLogin.bind(this));
        this.onRequest('/mfa', this.handleMfa.bind(this));
        this.ready();
    }

    async handleLogin({ email, password }) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        let response;
        try {
            response = await fetch(`${API_BASE}/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'nanit-api-version': '1' },
                body: JSON.stringify({ email, password }),
                signal: controller.signal,
            });
        } catch (err) {
            return { status: 'error', message: err.message };
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
        if (response.status === 429) {
            return { status: 'rate_limited' };
        }
        const text = await response.text();
        return { status: 'error', message: `Login failed (${response.status}): ${text}` };
    }

    async handleMfa({ email, password, mfa_token, mfa_code }) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        let response;
        try {
            response = await fetch(`${API_BASE}/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'nanit-api-version': '1' },
                body: JSON.stringify({ email, password, mfa_token, mfa_code }),
                signal: controller.signal,
            });
        } catch (err) {
            return { status: 'error', message: err.message };
        } finally {
            clearTimeout(timeout);
        }

        if (response.ok) {
            const data = await response.json();
            return { status: 'success', refresh_token: data.refresh_token };
        }
        if (response.status === 429) {
            return { status: 'rate_limited' };
        }
        const text = await response.text();
        return { status: 'error', message: `MFA failed (${response.status}): ${text}` };
    }
}

(() => new NanitUiServer())();
