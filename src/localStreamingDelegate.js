"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalStreamingDelegate = void 0;
const child_process_1 = require("child_process");
const ws_1 = __importDefault(require("ws"));
const os = __importStar(require("os"));
const nanit_proto_1 = require("./nanit.proto");
const node_media_server_1 = __importDefault(require("node-media-server"));
class LocalStreamingDelegate {
    hap;
    log;
    name;
    localIp;
    getAccessToken;
    rtmpPort;
    sessions = new Map();
    rtmpServer;
    wsRequestId = 1;
    startingSessions = new Set();
    controller;
    cameraUid;
    babyUid;
    configuredLocalAddress;
    ffmpegPath;
    go2rtcApiUrl;
    onSensorData;
    onMotion;
    cloudFallbackGetUrl;
    sensorPollTimer;
    currentRtmpUrl;
    sharedWs = null;
    constructor(hap, log, name, localIp, getAccessToken, rtmpPort = 1935, cameraUid, babyUid, configuredLocalAddress, onSensorData, ffmpegPath = 'ffmpeg', go2rtcApiUrl = 'http://localhost:1984', onMotion = null, allowInsecureTls = false) {
        this.hap = hap;
        this.log = log;
        this.name = name;
        this.localIp = localIp;
        this.getAccessToken = getAccessToken;
        this.rtmpPort = rtmpPort;
        this.cameraUid = cameraUid || '';
        this.babyUid = babyUid || '';
        this.configuredLocalAddress = configuredLocalAddress;
        this.onSensorData = onSensorData;
        this.onMotion = onMotion;
        this.cloudFallbackGetUrl = null;
        this.ffmpegPath = ffmpegPath;
        this.go2rtcApiUrl = go2rtcApiUrl || 'http://localhost:1984';
        this.allowInsecureTls = allowInsecureTls;
    }
    startRtmpServer() {
        if (this.rtmpServer) {
            return;
        }
        this.log.debug(`[${this.name}] Starting local RTMP server on port ${this.rtmpPort}`);
        const config = {
            logType: 0,
            rtmp: {
                port: this.rtmpPort,
                chunk_size: 60000,
                gop_cache: true,
                ping: 30,
                ping_timeout: 60,
            },
        };
        this.rtmpServer = new node_media_server_1.default(config);
        this.rtmpServer.run();
        this.log.info(`[${this.name}] Local RTMP server started on port ${this.rtmpPort}`);
    }
    stopRtmpServer() {
        this.log.debug(`[${this.name}] RTMP server kept alive for reuse`);
    }
    async connectToCamera() {
        return new Promise((resolve, reject) => {
            const url = `wss://api.nanit.com/focus/cameras/${this.cameraUid}/user_connect`;
            this.log.info(`[${this.name}] Connecting to Nanit signaling WebSocket for camera ${this.cameraUid}`);
            const ws = new ws_1.default(url, {
                headers: {
                    'Authorization': `Bearer ${this.getAccessToken()}`,
                },
            });
            ws.on('open', () => {
                this.log.info(`[${this.name}] Connected to camera via WebSocket`);
                resolve(ws);
            });
            ws.on('error', (error) => {
                this.log.error(`[${this.name}] WebSocket error:`, error.message);
                reject(error);
            });
            ws.on('close', () => {
                this.log.debug(`[${this.name}] WebSocket closed`);
            });
            ws.on('message', (data) => {
                try {
                    const message = nanit_proto_1.client.Message.decode(data);
                    this.log.debug(`[${this.name}] Received message:`, message.type);
                    if (message.type === nanit_proto_1.client.Message.Type.RESPONSE && message.response) {
                        const response = message.response;
                        this.log.debug(`[${this.name}] Response:`, {
                            requestId: response.requestId,
                            statusCode: response.statusCode,
                            statusMessage: response.statusMessage,
                        });
                        if (response.sensorData && response.sensorData.length > 0) {
                            if (this.onSensorData) {
                                let temperature;
                                let humidity;
                                for (const sd of response.sensorData) {
                                    const val = sd.valueMilli !== undefined ? sd.valueMilli / 1000 : sd.value;
                                    if (sd.sensorType === nanit_proto_1.client.SensorType.TEMPERATURE) temperature = val;
                                    if (sd.sensorType === nanit_proto_1.client.SensorType.HUMIDITY) humidity = val;
                                }
                                if (temperature !== undefined || humidity !== undefined) {
                                    this.log.debug(`[${this.name}] Sensor data — temp: ${temperature}, humidity: ${humidity}`);
                                    this.onSensorData(temperature, humidity);
                                }
                            }
                            for (const sd of response.sensorData) {
                                if (sd.sensorType === nanit_proto_1.client.SensorType.MOTION && sd.isAlert && this.onMotion) {
                                    this.onMotion(true);
                                    // Auto-clear after 10s
                                    setTimeout(() => { if (this.onMotion) this.onMotion(false); }, 10000);
                                }
                            }
                        }
                    }
                }
                catch (error) {
                    this.log.error(`[${this.name}] Failed to decode message:`, error);
                }
            });
        });
    }
    getHostIp() {
        if (this.configuredLocalAddress) {
            return this.configuredLocalAddress;
        }
        const interfaces = os.networkInterfaces();
        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name] || []) {
                if (iface.family === 'IPv4' && !iface.internal) {
                    return iface.address;
                }
            }
        }
        return '127.0.0.1';
    }
    sendStreamingRequest(ws, rtmpUrl) {
        const requestId = this.wsRequestId++;
        const request = nanit_proto_1.client.Request.create({
            id: requestId,
            type: nanit_proto_1.client.RequestType.PUT_STREAMING,
            streaming: nanit_proto_1.client.Streaming.create({
                id: nanit_proto_1.client.StreamIdentifier.MOBILE,
                status: nanit_proto_1.client.Streaming.Status.STARTED,
                rtmpUrl: rtmpUrl,
            }),
        });
        const message = nanit_proto_1.client.Message.create({
            type: nanit_proto_1.client.Message.Type.REQUEST,
            request: request,
        });
        const buffer = nanit_proto_1.client.Message.encode(message).finish();
        this.log.debug(`[${this.name}] Sending PUT_STREAMING request to ${rtmpUrl}`);
        ws.send(buffer);
    }
    sendSensorDataRequest(ws) {
        if (!this.onSensorData) return;
        const requestId = this.wsRequestId++;
        const request = nanit_proto_1.client.Request.create({
            id: requestId,
            type: nanit_proto_1.client.RequestType.GET_SENSOR_DATA,
            getSensorData: nanit_proto_1.client.GetSensorData.create({
                temperature: true,
                humidity: true,
            }),
        });
        const message = nanit_proto_1.client.Message.create({
            type: nanit_proto_1.client.Message.Type.REQUEST,
            request: request,
        });
        const buffer = nanit_proto_1.client.Message.encode(message).finish();
        this.log.debug(`[${this.name}] Sending GET_SENSOR_DATA request`);
        ws.send(buffer);
    }
    async handleSnapshotRequest(request, callback) {
        this.log.debug(`[${this.name}] Snapshot requested: ${request.width}x${request.height}`);
        let callbackCalled = false;
        const safeCallback = (error, buffer) => {
            if (!callbackCalled) {
                callbackCalled = true;
                callback(error, buffer);
            }
        };
        const cloudUrl = `rtmps://media-secured.nanit.com/nanit/${this.babyUid}.${this.getAccessToken()}`;
        const tlsArgs = this.allowInsecureTls ? ['-tls_verify', '0'] : [];
        const ffmpegArgs = [
            ...tlsArgs,
            '-timeout', '10000000',
            '-i', cloudUrl,
            '-frames:v', '1',
            '-f', 'image2',
            '-',
        ];
        this.log.debug(`[${this.name}] Snapshot URL: rtmps://media-secured.nanit.com/nanit/[baby_uid].[token_redacted]`);
        const ffmpeg = (0, child_process_1.spawn)(this.ffmpegPath, ffmpegArgs, { env: process.env });
        let imageBuffer = Buffer.alloc(0);
        ffmpeg.stdout.on('data', (data) => {
            imageBuffer = Buffer.concat([imageBuffer, data]);
        });
        ffmpeg.on('error', (error) => {
            this.log.error(`[${this.name}] FFmpeg snapshot error:`, error.message);
            safeCallback(error);
        });
        ffmpeg.on('close', () => {
            if (imageBuffer.length > 0) {
                safeCallback(undefined, imageBuffer);
            }
            else {
                safeCallback(new Error('Failed to generate snapshot'));
            }
        });
    }
    async prepareStream(request, callback) {
        this.log.debug(`[${this.name}] Prepare stream request`);
        const sessionId = request.sessionID;
        const targetAddress = request.targetAddress;
        const videoReturn = request.video.port;
        const videoSSRC = this.hap.CameraController.generateSynchronisationSource();
        const audioReturn = request.audio.port;
        const audioSSRC = this.hap.CameraController.generateSynchronisationSource();
        const sessionInfo = {
            address: targetAddress,
            videoPort: request.video.port,
            videoReturnPort: videoReturn,
            videoCryptoSuite: request.video.srtpCryptoSuite,
            videoSRTP: Buffer.concat([request.video.srtp_key, request.video.srtp_salt]),
            videoSSRC: videoSSRC,
            audioPort: request.audio.port,
            audioReturnPort: audioReturn,
            audioCryptoSuite: request.audio.srtpCryptoSuite,
            audioSRTP: Buffer.concat([request.audio.srtp_key, request.audio.srtp_salt]),
            audioSSRC: audioSSRC,
        };
        const response = {
            video: {
                port: videoReturn,
                ssrc: videoSSRC,
                srtp_key: request.video.srtp_key,
                srtp_salt: request.video.srtp_salt,
            },
            audio: {
                port: audioReturn,
                ssrc: audioSSRC,
                srtp_key: request.audio.srtp_key,
                srtp_salt: request.audio.srtp_salt,
            },
        };
        this.sessions.set(sessionId, { process: undefined, ws: undefined, info: sessionInfo });
        callback(undefined, response);
    }
    // Register the stream in go2rtc so it pulls from our local RTMP server
    async _registerGo2rtcStream(rtmpUrl) {
        const streamName = `nanit_${this.babyUid}`;
        const apiUrl = `${this.go2rtcApiUrl}/api/streams?name=${encodeURIComponent(streamName)}&src=${encodeURIComponent(rtmpUrl)}`;
        return new Promise((resolve) => {
            const http = require('http');
            const req = http.request(apiUrl, { method: 'PUT' }, (res) => {
                this.log.info(`[${this.name}] go2rtc stream registered: ${streamName} → ${rtmpUrl} (HTTP ${res.statusCode})`);
                resolve();
            });
            req.on('error', (err) => {
                this.log.warn(`[${this.name}] go2rtc API error (continuing anyway): ${err.message}`);
                resolve();
            });
            req.end();
        });
    }
    async _unregisterGo2rtcStream() {
        const streamName = `nanit_${this.babyUid}`;
        const apiUrl = `${this.go2rtcApiUrl}/api/streams?name=${encodeURIComponent(streamName)}`;
        return new Promise((resolve) => {
            const http = require('http');
            const req = http.request(apiUrl, { method: 'DELETE' }, () => {
                this.log.debug(`[${this.name}] go2rtc stream unregistered: ${streamName}`);
                resolve();
            });
            req.on('error', () => resolve());
            req.end();
        });
    }
    // Shared camera connection — one RTMP push via go2rtc relay, multiple RTSP readers
    async _ensureSharedStream() {
        if (this.sharedWs && this.sharedWs.readyState === ws_1.default.OPEN) {
            return; // already streaming
        }
        this.startRtmpServer();
        const ws = await this.connectToCamera();
        this.sharedWs = ws;
        const hostIp = this.getHostIp();
        const streamKey = `nanit_${this.babyUid}`;
        const rtmpUrl = `rtmp://${hostIp}:${this.rtmpPort}/live/${streamKey}`;
        this.log.info(`[${this.name}] Camera push → ${rtmpUrl}`);
        this.sendStreamingRequest(ws, rtmpUrl);
        this.currentRtmpUrl = rtmpUrl;
        // Register with go2rtc so it pulls and re-exposes as RTSP
        await this._registerGo2rtcStream(rtmpUrl);
        this.sendSensorDataRequest(ws);
        if (this.sensorPollTimer) clearInterval(this.sensorPollTimer);
        this.sensorPollTimer = setInterval(() => this.sendSensorDataRequest(ws), 60000);
        ws.on('close', () => {
            this.log.debug(`[${this.name}] Shared WS closed`);
            this.sharedWs = null;
        });
        // Wait until go2rtc actually has a producer (camera is pushing RTMP)
        // before handing off to FFmpeg. The fixed 2500ms delay was too short
        // and caused FFmpeg to time out on an empty RTSP stream after ~28s.
        await this._waitForGo2rtcStream(`nanit_${this.babyUid}`, 12000);
    }
    async _waitForGo2rtcStream(streamName, timeoutMs = 15000) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            try {
                const data = await new Promise((resolve, reject) => {
                    const http = require('http');
                    const req = http.request(`${this.go2rtcApiUrl}/api/streams`, { timeout: 2000 }, (res) => {
                        let body = '';
                        res.on('data', chunk => body += chunk);
                        res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
                    });
                    req.on('error', reject);
                    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
                    req.end();
                });
                const producers = data?.[streamName]?.producers;
                this.log.debug(`[${this.name}] go2rtc check [${streamName}]: producers=${JSON.stringify(producers)}`);
                // Wait for actual tracks — go2rtc sets producers[] as soon as it starts
                // pulling the URL, but tracks[] is only populated when real data flows.
                const ready = producers?.some(p => Array.isArray(p.tracks) && p.tracks.length > 0);
                if (ready) {
                    this.log.info(`[${this.name}] go2rtc stream ready: ${streamName}`);
                    return true;
                }
            } catch (_) {}
            await new Promise(r => setTimeout(r, 500));
        }
        this.log.warn(`[${this.name}] Timed out waiting for go2rtc stream "${streamName}" — camera may not be pushing RTMP, or go2rtc is not running at ${this.go2rtcApiUrl}`);
        return false;
    }
    _stopSharedStreamIfIdle() {
        if (this.sessions.size > 0) return;
        if (this.sharedWs && this.sharedWs.readyState === ws_1.default.OPEN) {
            this.log.info(`[${this.name}] No active sessions — stopping camera push`);
            const requestId = this.wsRequestId++;
            const req = nanit_proto_1.client.Request.create({
                id: requestId,
                type: nanit_proto_1.client.RequestType.PUT_STREAMING,
                streaming: nanit_proto_1.client.Streaming.create({
                    id: nanit_proto_1.client.StreamIdentifier.MOBILE,
                    status: nanit_proto_1.client.Streaming.Status.STOPPED,
                    rtmpUrl: '',
                }),
            });
            const msg = nanit_proto_1.client.Message.create({ type: nanit_proto_1.client.Message.Type.REQUEST, request: req });
            this.sharedWs.send(nanit_proto_1.client.Message.encode(msg).finish());
            this.sharedWs.close();
            this.sharedWs = null;
            this.currentRtmpUrl = null;
            this._unregisterGo2rtcStream();
        }
    }
    async handleStreamRequest(request, callback) {
        const sessionId = request.sessionID;
        if (request.type === "start") {
            this.log.info(`[${this.name}] Starting stream for session ${sessionId}`);
            this.startingSessions.add(sessionId);
            try {
                let usingCloudFallback = false;
                let fallbackInputUrl = null;
                try {
                    await this._ensureSharedStream();
                } catch (localErr) {
                    if (this.cloudFallbackGetUrl) {
                        this.log.warn(`[${this.name}] local stream failed, falling back to cloud`);
                        fallbackInputUrl = this.cloudFallbackGetUrl();
                        usingCloudFallback = true;
                    } else {
                        throw localErr;
                    }
                }
                if (!this.startingSessions.has(sessionId)) {
                    this.log.info(`[${this.name}] Stream was stopped during setup, aborting`);
                    callback();
                    return;
                }
                this.startingSessions.delete(sessionId);
                const session = this.sessions.get(sessionId);
                if (!session) {
                    this.log.error(`[${this.name}] No session found for ${sessionId}`);
                    callback(new Error('No session'));
                    return;
                }
                const streamKey = `nanit_${this.babyUid}`;
                const rtspUrl = usingCloudFallback ? fallbackInputUrl : `rtsp://localhost:8554/${streamKey}`;
                const video = request.video;
                const info = session.info;
                if (!info) {
                    this.log.error(`[${this.name}] No session info found for ${sessionId}`);
                    callback(new Error('No session info'));
                    return;
                }
                const target = info.address;
                const videoPort = info.videoPort;
                const videoSrtpKey = info.videoSRTP.toString('base64');
                const videoSsrc = info.videoSSRC;
                const audioSrtpKey = info.audioSRTP.toString('base64');
                const audioSsrc = info.audioSSRC;
                const audioBitrate = request.audio ? request.audio.max_bit_rate || 24 : 24;
                // Force minimum 2000kbps for decent quality regardless of HomeKit's request
                const videoBitrate = Math.max(video.max_bit_rate, 2000);
                // Map HAP profile/level numbers to x264 names
                const profileMap = ['baseline', 'main', 'high'];
                const levelMap = ['3.1', '3.2', '4.0'];
                const x264Profile = profileMap[video.profile] || 'main';
                const x264Level = levelMap[video.level] || '3.1';
                this.log.info(`[${this.name}] SRTP target: ${target}:${videoPort} (audio: ${info.audioPort}), profile: ${x264Profile}/${x264Level}, ${video.width}x${video.height}@${video.fps}fps ${videoBitrate}kbps`);
                const inputArgs = usingCloudFallback
                    ? ['-re', '-i', rtspUrl]
                    : ['-rtsp_transport', 'tcp', '-stimeout', '10000000', '-i', rtspUrl];
                const ffmpegArgs = [
                    ...inputArgs,
                    // Video stream
                    '-map', '0:v',
                    '-vcodec', 'libx264',
                    '-preset', 'superfast',
                    '-tune', 'zerolatency',
                    '-profile:v', x264Profile,
                    '-level:v', x264Level,
                    '-x264-params', 'bframes=0:ref=2:scenecut=0',
                    '-r', video.fps.toString(),
                    '-g', Math.round(video.fps * 2).toString(),
                    '-vf', `scale=${video.width}:${video.height}`,
                    '-b:v', `${videoBitrate}k`,
                    '-bufsize', `${videoBitrate * 2}k`,
                    '-maxrate', `${videoBitrate}k`,
                    '-pix_fmt', 'yuv420p',
                    '-payload_type', video.pt.toString(),
                    '-ssrc', videoSsrc.toString(),
                    '-f', 'rtp',
                    '-srtp_out_suite', 'AES_CM_128_HMAC_SHA1_80',
                    '-srtp_out_params', videoSrtpKey,
                    `srtp://${target}:${videoPort}?rtcpport=${videoPort}&pkt_size=1316`,
                    // Audio: reset timestamps to sequential (fixes AAC-HBR timing from RTMP→RTSP)
                    '-map', '0:a?',
                    '-acodec', 'libopus',
                    '-af', 'asetpts=N/SR/TB,aresample=16000',
                    '-ar', '16000',
                    '-ac', '1',
                    '-b:a', '32k',
                    '-frame_duration', '20',
                    '-application', 'voip',
                    '-payload_type', '110',
                    '-ssrc', audioSsrc.toString(),
                    '-f', 'rtp',
                    '-srtp_out_suite', 'AES_CM_128_HMAC_SHA1_80',
                    '-srtp_out_params', audioSrtpKey,
                    `srtp://${target}:${info.audioPort}?rtcpport=${info.audioPort}&pkt_size=188`,
                ];
                this.log.info(`[${this.name}] Starting ffmpeg → ${rtspUrl}`);
                const ffmpeg = (0, child_process_1.spawn)(this.ffmpegPath, ffmpegArgs, { env: process.env });
                session.process = ffmpeg;
                ffmpeg.stderr.on('data', (data) => {
                    const message = data.toString().trim();
                    if (message) this.log.debug(`[${this.name}] FFmpeg: ${message}`);
                });
                ffmpeg.on('error', (error) => {
                    this.log.error(`[${this.name}] FFmpeg failed to start: ${error.message} (is ffmpeg installed and in PATH?)`);
                });
                ffmpeg.on('close', (code) => {
                    this.log.info(`[${this.name}] Video stream stopped (exit code ${code})`);
                });
                callback();
            }
            catch (error) {
                this.log.error(`[${this.name}] Failed to start local stream:`, error);
                callback(error);
            }
        }
        else if (request.type === "stop") {
            this.log.info(`[${this.name}] Stopping session ${sessionId}`);
            this.startingSessions.delete(sessionId);
            const session = this.sessions.get(sessionId);
            if (session) {
                if (session.process) {
                    session.process.kill('SIGTERM');
                    setTimeout(() => {
                        if (session.process && !session.process.killed) {
                            session.process.kill('SIGKILL');
                        }
                    }, 2000);
                }
                if (false) { // placeholder — shared WS handled separately
                    session.ws.close();
                }
            }
            this.sessions.delete(sessionId);
            this._stopSharedStreamIfIdle();
            callback();
        }
        else if (request.type === "reconfigure") {
            this.log.debug(`[${this.name}] Reconfigure stream (not implemented)`);
            callback();
        }
    }
    destroy() {
        this.log.debug(`[${this.name}] Cleaning up local streaming delegate`);
        for (const [sessionId, session] of this.sessions) {
            if (session.ws && session.ws.readyState === ws_1.default.OPEN) {
                session.ws.close();
            }
            if (session.process) {
                session.process.kill('SIGTERM');
                setTimeout(() => {
                    if (session.process && !session.process.killed) {
                        session.process.kill('SIGKILL');
                    }
                }, 2000);
            }
        }
        this.sessions.clear();
        this.stopRtmpServer();
    }
}
exports.LocalStreamingDelegate = LocalStreamingDelegate;
