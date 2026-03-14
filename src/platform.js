"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NanitPlatform = void 0;
const fs = require('fs');
const path = require('path');
const settings_1 = require("./settings");
const camera_1 = require("./camera");
const { startAuthServer } = require("./authServer");
class NanitPlatform {
    log;
    config;
    api;
    accessories = [];
    cameras = new Map();
    accessToken;
    refreshToken;
    refreshInterval;
    discoveryInterval;
    sensorInterval;
    rtmpPortCounter = 0;
    _refreshPromise = null;
    authFailures = 0;
    authDisabled = false;
    constructor(log, config, api) {
        this.log = log;
        this.config = config;
        this.api = api;
        if (this.config.authServer !== false) {
            const authPort = this.config.authPort || 8586;
            this.authServer = startAuthServer(authPort, this.log);
        }
        if (!this.config.email) {
            this.log.error('Email is required in config');
            return;
        }
        const hasPassword = !!this.config.password;
        const hasRefreshToken = !!this.config.refreshToken;
        if (!hasPassword && !hasRefreshToken) {
            this.log.error('Either password or refreshToken must be provided in config');
            return;
        }
        this.log.info('Initializing Nanit platform');
        this.api.on('shutdown', () => this.shutdown());
        this.api.on('didFinishLaunching', () => {
            this.log.debug('Finished launching, starting authentication');
            this.authenticate().then(() => {
                this.discoverCameras();
                this.startRefreshIntervals();
            }).catch(err => {
                this.log.error('Initial authentication failed — plugin will not function until credentials are fixed.');
                this.log.error('Run "npx nanit-auth" to get a fresh refresh token, update config, and restart Homebridge.');
            });
        });
    }
    configureAccessory(accessory) {
        this.log.debug('Loading accessory from cache:', accessory.displayName);
        this.accessories.push(accessory);
    }
    async authenticate() {
        if (this.authDisabled) {
            this.log.error('Authentication is disabled due to repeated failures. Restart Homebridge after fixing credentials.');
            throw new Error('Authentication disabled (circuit breaker)');
        }
        try {
            const storedToken = this._loadToken(`nanit_refresh_${this.config.email}`) || this.config.refreshToken;
            if (storedToken && typeof storedToken === 'string') {
                this.log.debug('Found stored refresh token, attempting refresh');
                try {
                    await this.refreshAccessToken(storedToken);
                    this.authFailures = 0;
                    return;
                }
                catch (error) {
                    this.log.warn('Refresh token failed:', error);
                }
            }
            this.authFailures++;
            if (this.authFailures >= 3) {
                this.authDisabled = true;
                this.log.error(`Authentication failed ${this.authFailures} times — disabling to prevent MFA spam.`);
                this.log.error('To fix: run "npx nanit-auth" on your Mac to get a fresh refresh token,');
                this.log.error('then update the refreshToken in Homebridge config and restart.');
            }
            else {
                this.log.error(`Authentication failed (attempt ${this.authFailures}/3).`);
                this.log.error('Refresh token is invalid or expired. Will NOT attempt password login (would trigger MFA SMS).');
                this.log.error('To fix: run "npx nanit-auth" to get a fresh refresh token and update config.');
            }
            throw new Error('Authentication failed: refresh token invalid, password login disabled for safety');
        }
        catch (error) {
            this.log.error('Authentication failed:', error);
            throw error;
        }
    }
    async refreshAccessToken(token) {
        if (this._refreshPromise) return this._refreshPromise;
        this._refreshPromise = this._doRefreshAccessToken(token).finally(() => {
            this._refreshPromise = null;
        });
        return this._refreshPromise;
    }
    async _doRefreshAccessToken(token) {
        const refreshToken = token || this.refreshToken;
        if (!refreshToken) {
            throw new Error('No refresh token available');
        }
        this.log.debug('Refreshing access token');
        const abortController = new AbortController();
        const timeoutId = setTimeout(() => abortController.abort(), 15000);
        const response = await fetch('https://api.nanit.com/tokens/refresh', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'nanit-api-version': '1',
            },
            body: JSON.stringify({ refresh_token: refreshToken }),
            signal: abortController.signal,
        }).finally(() => clearTimeout(timeoutId));
        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Token refresh failed: ${response.status} ${text}`);
        }
        const data = await response.json();
        this.accessToken = data.access_token;
        this.refreshToken = data.refresh_token;
        if (this.refreshToken) {
            this._saveToken(`nanit_refresh_${this.config.email}`, this.refreshToken);
        }
        this.log.debug('Access token refreshed');
    }
    async discoverCameras() {
        try {
            if (!this.accessToken) {
                throw new Error('Not authenticated');
            }
            this.log.info('Discovering cameras');
            const abortController = new AbortController();
            const timeoutId = setTimeout(() => abortController.abort(), 15000);
            const response = await fetch('https://api.nanit.com/babies', {
                headers: {
                    'Authorization': this.accessToken,
                    'nanit-api-version': '1',
                },
                signal: abortController.signal,
            }).finally(() => clearTimeout(timeoutId));
            if (!response.ok) {
                throw new Error(`Failed to get babies: ${response.status}`);
            }
            const data = await response.json();
            this.log.info(`Found ${data.babies.length} camera(s)`);
            for (const baby of data.babies) {
                this.addOrUpdateCamera(baby);
            }
            const accessoriesToRemove = [];
            for (const accessory of this.accessories) {
                const exists = data.babies.some(b => b.uid === accessory.context.babyUid);
                if (!exists) {
                    this.log.info('Removing camera:', accessory.displayName);
                    accessoriesToRemove.push(accessory);
                    this.cameras.delete(accessory.context.babyUid);
                }
            }
            if (accessoriesToRemove.length > 0) {
                this.api.unregisterPlatformAccessories(settings_1.PLUGIN_NAME, settings_1.PLATFORM_NAME, accessoriesToRemove);
                this.accessories.splice(0, this.accessories.length, ...this.accessories.filter(acc => !accessoriesToRemove.includes(acc)));
            }
        }
        catch (error) {
            this.log.error('Failed to discover cameras:', error);
        }
    }
    addOrUpdateCamera(baby) {
        const uuid = this.api.hap.uuid.generate(baby.uid);
        const existingAccessory = this.accessories.find(acc => acc.UUID === uuid);
        if (existingAccessory) {
            const correctName = baby.name || baby.first_name || 'Nanit Camera';
            this.log.info('Updating existing accessory:', correctName);
            existingAccessory.displayName = correctName;
            existingAccessory.context.baby = baby;
            existingAccessory
                .getService(this.api.hap.Service.AccessoryInformation)
                ?.setCharacteristic(this.api.hap.Characteristic.Name, correctName);
            this.api.updatePlatformAccessories([existingAccessory]);
            if (!this.cameras.has(baby.uid)) {
                const camera = new camera_1.NanitCamera(this, existingAccessory, baby);
                this.cameras.set(baby.uid, camera);
            }
            else {
                const camera = this.cameras.get(baby.uid);
                if (camera && baby.camera) {
                    camera.updateSensors(baby.camera.temperature, baby.camera.humidity);
                }
            }
        }
        else {
            const name = baby.name || baby.first_name || 'Nanit Camera';
            this.log.info('Adding new camera:', name);
            const accessory = new this.api.platformAccessory(name, uuid);
            accessory.context.baby = baby;
            accessory.context.babyUid = baby.uid;
            const camera = new camera_1.NanitCamera(this, accessory, baby);
            this.cameras.set(baby.uid, camera);
            this.accessories.push(accessory);
            this.api.registerPlatformAccessories(settings_1.PLUGIN_NAME, settings_1.PLATFORM_NAME, [accessory]);
        }
    }
    startRefreshIntervals() {
        this.refreshInterval = setInterval(() => {
            if (this.authDisabled) {
                this.log.warn('Skipping token refresh — auth is disabled (circuit breaker)');
                return;
            }
            this.log.debug('Auto-refreshing token');
            this.refreshAccessToken().catch(err => {
                this.log.error('Auto token refresh failed:', err);
                this.authFailures++;
                if (this.authFailures >= 3) {
                    this.authDisabled = true;
                    this.log.error('Too many refresh failures — disabling auth. Fix credentials and restart Homebridge.');
                }
            });
        }, 50 * 60 * 1000);
        const discoveryInterval = (this.config.refreshInterval || 300) * 1000;
        this.discoveryInterval = setInterval(() => {
            this.log.debug('Auto-discovering cameras');
            this.discoverCameras();
        }, discoveryInterval);
        const sensorPollInterval = (this.config.sensorInterval || 60) * 1000;
        this.sensorInterval = setInterval(() => {
            this.pollSensors();
        }, sensorPollInterval);
    }
    async pollSensors() {
        try {
            if (!this.accessToken) return;
            const abortController = new AbortController();
            const timeoutId = setTimeout(() => abortController.abort(), 10000);
            const response = await fetch('https://api.nanit.com/babies', {
                headers: { 'Authorization': this.accessToken, 'nanit-api-version': '1' },
                signal: abortController.signal,
            }).finally(() => clearTimeout(timeoutId));
            if (!response.ok) return;
            const data = await response.json();
            for (const baby of data.babies) {
                const camera = this.cameras.get(baby.uid);
                if (camera && baby.camera) {
                    camera.updateSensors(baby.camera.temperature, baby.camera.humidity);
                }
            }
        } catch (err) {
            this.log.debug('Sensor poll failed:', err.message);
        }
    }
    _getTokensPath() {
        return path.join(this.api.user.storagePath(), 'nanit-tokens.json');
    }
    _loadToken(key) {
        try {
            const data = JSON.parse(fs.readFileSync(this._getTokensPath(), 'utf8'));
            return data[key] || null;
        } catch { return null; }
    }
    _saveToken(key, value) {
        try {
            let data = {};
            try { data = JSON.parse(fs.readFileSync(this._getTokensPath(), 'utf8')); } catch {}
            data[key] = value;
            fs.writeFileSync(this._getTokensPath(), JSON.stringify(data, null, 2));
        } catch (err) {
            this.log.warn('Failed to save token:', err.message);
        }
    }
    getAccessToken() {
        if (!this.accessToken) {
            throw new Error('Not authenticated');
        }
        return this.accessToken;
    }
    allocateRtmpPort() {
        const base = this.config.localRtmpPort || 1935;
        const port = base + (this.rtmpPortCounter % 100);
        this.rtmpPortCounter++;
        return port;
    }
    shutdown() {
        this.log.info('Shutting down Nanit platform');
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = undefined;
        }
        if (this.discoveryInterval) {
            clearInterval(this.discoveryInterval);
            this.discoveryInterval = undefined;
        }
        if (this.sensorInterval) {
            clearInterval(this.sensorInterval);
            this.sensorInterval = undefined;
        }
        for (const camera of this.cameras.values()) {
            if (camera.destroy) {
                camera.destroy();
            }
        }
        this.cameras.clear();
        if (this.authServer) this.authServer.close();
        this.log.info('Nanit platform shutdown complete');
    }
}
exports.NanitPlatform = NanitPlatform;
