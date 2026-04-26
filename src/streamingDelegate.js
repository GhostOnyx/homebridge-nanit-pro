"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NanitStreamingDelegate = void 0;
const child_process_1 = require("child_process");
class NanitStreamingDelegate {
    hap;
    log;
    name;
    getStreamUrl;
    sessions = new Map();
    controller;
    constructor(hap, log, name, getStreamUrl, allowInsecureTls = false) {
        this.hap = hap;
        this.log = log;
        this.name = name;
        this.getStreamUrl = getStreamUrl;
        this.allowInsecureTls = allowInsecureTls;
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
        const streamUrl = this.getStreamUrl();
        const tlsArgs = this.allowInsecureTls ? ['-tls_verify', '0'] : [];
        const ffmpegArgs = [
            ...tlsArgs,
            '-timeout', '10000000',
            '-i', streamUrl,
            '-frames:v', '1',
            '-f', 'image2',
            '-',
        ];
        this.log.debug(`[${this.name}] Snapshot URL: rtmps://media-secured.nanit.com/nanit/[baby_uid].[token_redacted]`);
        const ffmpeg = (0, child_process_1.spawn)('ffmpeg', ffmpegArgs, { env: process.env });
        let imageBuffer = Buffer.alloc(0);
        const snapshotTimeout = setTimeout(() => {
            this.log.warn(`[${this.name}] Snapshot timed out, killing ffmpeg`);
            ffmpeg.kill('SIGTERM');
            safeCallback(new Error('Snapshot timed out'));
        }, 10000);
        ffmpeg.stdout.on('data', (data) => {
            imageBuffer = Buffer.concat([imageBuffer, data]);
        });
        ffmpeg.on('error', (error) => {
            clearTimeout(snapshotTimeout);
            this.log.error(`[${this.name}] FFmpeg snapshot error:`, error.message);
            safeCallback(error);
        });
        ffmpeg.on('close', () => {
            clearTimeout(snapshotTimeout);
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
        this.sessions.set(sessionId, { process: undefined, info: sessionInfo });
        callback(undefined, response);
    }
    async handleStreamRequest(request, callback) {
        const sessionId = request.sessionID;
        if (request.type === "start") {
            this.log.info(`[${this.name}] Starting video stream`);
            const streamUrl = this.getStreamUrl();
            const session = this.sessions.get(sessionId);
            if (!session || !session.info) {
                this.log.error(`[${this.name}] No session info found for ${sessionId}`);
                callback(new Error('No session info'));
                return;
            }
            const video = request.video;
            const info = session.info;
            const target = info.address;
            const videoPort = info.videoPort;
            const videoSrtpKey = info.videoSRTP.toString('base64');
            const videoSsrc = info.videoSSRC;
            const audioPort = info.audioPort;
            const audioSrtpKey = info.audioSRTP.toString('base64');
            const audioSsrc = info.audioSSRC;
            const tlsArgs = this.allowInsecureTls ? ['-tls_verify', '0'] : [];
            const ffmpegArgs = [
                '-re',
                ...tlsArgs,
                '-timeout', '10000000',
                '-i', streamUrl,
                '-map', '0:v',
                '-vcodec', 'libx264',
                '-preset', 'ultrafast',
                '-tune', 'zerolatency',
                '-r', video.fps.toString(),
                '-b:v', `${video.max_bit_rate}k`,
                '-bufsize', `${video.max_bit_rate * 2}k`,
                '-maxrate', `${video.max_bit_rate}k`,
                '-pix_fmt', 'yuv420p',
                '-payload_type', video.pt.toString(),
                '-ssrc', videoSsrc.toString(),
                '-f', 'rtp',
                '-srtp_out_suite', 'AES_CM_128_HMAC_SHA1_80',
                '-srtp_out_params', videoSrtpKey,
                `srtp://${target}:${videoPort}?rtcpport=${videoPort}&pkt_size=1316`,
                '-map', '0:a?',
                '-acodec', 'libopus',
                '-af', 'aresample=16000',
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
                `srtp://${target}:${audioPort}?rtcpport=${audioPort}&pkt_size=188`,
            ];
            this.log.debug(`[${this.name}] FFmpeg command starting (URL redacted for security)`);
            const ffmpeg = (0, child_process_1.spawn)('ffmpeg', ffmpegArgs, { env: process.env });
            session.process = ffmpeg;
            ffmpeg.stderr.on('data', (data) => {
                const message = data.toString().trim();
                if (message) this.log.debug(`[${this.name}] FFmpeg: ${message}`);
            });
            ffmpeg.on('error', (error) => {
                this.log.error(`[${this.name}] FFmpeg process error:`, error.message);
            });
            ffmpeg.on('close', () => {
                this.log.info(`[${this.name}] Video stream stopped`);
            });
            callback();
        }
        else if (request.type === "stop") {
            this.log.info(`[${this.name}] Stopping video stream`);
            const session = this.sessions.get(sessionId);
            if (session?.process) {
                session.process.kill('SIGTERM');
                setTimeout(() => {
                    if (session.process && !session.process.killed) {
                        this.log.debug(`[${this.name}] FFmpeg didn't stop gracefully, forcing SIGKILL`);
                        session.process.kill('SIGKILL');
                    }
                }, 2000);
            }
            this.sessions.delete(sessionId);
            callback();
        }
        else if (request.type === "reconfigure") {
            this.log.debug(`[${this.name}] Reconfigure stream (not implemented)`);
            callback();
        }
    }
    destroy() {
        this.log.debug(`[${this.name}] Cleaning up streaming delegate`);
        for (const [sessionId, session] of this.sessions.entries()) {
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
    }
}
exports.NanitStreamingDelegate = NanitStreamingDelegate;
