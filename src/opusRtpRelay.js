"use strict";
// Opus RTP relay for HomeKit.
//
// HomeKit does NOT follow RFC 7587 for Opus: it wants the RTP timestamp on the NEGOTIATED
// sample-rate clock (RFC 3550 style: +320 per 20 ms packet at 16 kHz). ffmpeg's RTP muxer
// hard-codes the 48 kHz clock for Opus (+960 per 20 ms), which iOS plays as audio that breaks
// up every fraction of a second even though every packet arrives on time.
// (homebridge-ring and Scrypted rewrite the timestamp for the same reason.)
//
// So for Opus ffmpeg sends PLAIN RTP to a loopback port here; this module rewrites the
// timestamp onto the negotiated clock, SRTP-protects the packet (AES_CM_128_HMAC_SHA1_80,
// RFC 3711) and sends it to the HomeKit client. ffmpeg's RTCP is dropped (its sender reports
// carry the 48 kHz timestamps).
Object.defineProperty(exports, "__esModule", { value: true });
exports.startOpusRelay = exports.SrtpEncryptor = void 0;
const crypto = require("crypto");
const dgram = require("dgram");
class SrtpEncryptor {
    constructor(keySalt) {
        if (!Buffer.isBuffer(keySalt) || keySalt.length !== 30) {
            throw new Error('SRTP master key+salt must be 30 bytes');
        }
        const masterKey = keySalt.subarray(0, 16);
        const masterSalt = keySalt.subarray(16, 30);
        const derive = (label, length) => {
            const iv = Buffer.alloc(16);
            masterSalt.copy(iv, 0);
            iv[7] ^= label;
            return crypto.createCipheriv('aes-128-ctr', masterKey, iv).update(Buffer.alloc(length));
        };
        this.encKey = derive(0x00, 16);
        this.authKey = derive(0x01, 20);
        this.salt = derive(0x02, 14);
        this.roc = 0;
        this.lastSeq = -1;
    }
    // rtp: one complete RTP packet, packets given in sending order. Returns the SRTP packet.
    protect(rtp) {
        let headerLength = 12 + 4 * (rtp[0] & 0x0f);
        if (rtp[0] & 0x10) {
            if (headerLength + 4 > rtp.length) {
                throw new Error('truncated RTP header extension');
            }
            headerLength += 4 + 4 * rtp.readUInt16BE(headerLength + 2);
        }
        if (headerLength > rtp.length) {
            throw new Error('RTP header longer than packet');
        }
        const seq = rtp.readUInt16BE(2);
        if (this.lastSeq >= 0 && seq < this.lastSeq && this.lastSeq - seq > 0x8000) {
            this.roc = (this.roc + 1) >>> 0;
        }
        this.lastSeq = seq;
        const iv = Buffer.alloc(16);
        this.salt.copy(iv, 0);
        for (let i = 0; i < 4; i++) {
            iv[4 + i] ^= rtp[8 + i]; // SSRC
        }
        const roc = Buffer.alloc(4);
        roc.writeUInt32BE(this.roc, 0);
        for (let i = 0; i < 4; i++) {
            iv[8 + i] ^= roc[i]; // packet index = ROC || SEQ
        }
        iv[12] ^= rtp[2];
        iv[13] ^= rtp[3];
        const encrypted = Buffer.concat([
            rtp.subarray(0, headerLength),
            crypto.createCipheriv('aes-128-ctr', this.encKey, iv).update(rtp.subarray(headerLength)),
        ]);
        const tag = crypto.createHmac('sha1', this.authKey).update(encrypted).update(roc).digest().subarray(0, 10);
        return Buffer.concat([encrypted, tag]);
    }
}
exports.SrtpEncryptor = SrtpEncryptor;
// Resolves to { port, close(), stats } - point ffmpeg at rtp://127.0.0.1:<port>?rtcpport=<port>.
function startOpusRelay({ target, port, keySalt, sampleRateKhz, onError }) {
    return new Promise((resolve, reject) => {
        const encryptor = new SrtpEncryptor(keySalt);
        const inSock = dgram.createSocket('udp4');
        const outSock = dgram.createSocket(target.includes(':') ? 'udp6' : 'udp4');
        const stats = { packets: 0, dropped: 0 };
        let lastTs = null;
        let elapsed48k = 0; // 48 kHz ticks since the first packet (not wrapped)
        let baseTs = 0;
        let closed = false;
        let senderPort = null; // ffmpeg's RTP source port, locked on the first RTP packet
        const fail = (err) => { if (onError) onError(err); };
        outSock.on('error', fail);
        inSock.on('error', (err) => { fail(err); reject(err); });
        inSock.on('message', (msg, rinfo) => {
            if (closed) {
                return;
            }
            if (msg.length < 12 || (msg[0] >> 6) !== 2 || (msg[1] >= 200 && msg[1] <= 204)) {
                stats.dropped++; // malformed, or RTCP from ffmpeg
                return;
            }
            // Only one sender per session: anything else on loopback is not our ffmpeg.
            if (senderPort === null) {
                senderPort = rinfo.port;
            }
            else if (rinfo.port !== senderPort) {
                stats.dropped++;
                return;
            }
            const ts = msg.readUInt32BE(4);
            if (lastTs === null) {
                baseTs = ts;
            }
            else {
                elapsed48k += (ts - lastTs) >>> 0;
            }
            lastTs = ts;
            const rtp = Buffer.from(msg);
            rtp.writeUInt32BE((baseTs + Math.round(elapsed48k * sampleRateKhz / 48)) % 0x100000000, 4);
            let srtp;
            try {
                srtp = encryptor.protect(rtp);
            }
            catch (err) {
                stats.dropped++;
                return;
            }
            stats.packets++;
            outSock.send(srtp, port, target, (err) => { if (err) fail(err); });
        });
        inSock.bind(0, '127.0.0.1', () => {
            resolve({
                port: inSock.address().port,
                stats,
                close: () => {
                    if (closed) return;
                    closed = true;
                    try { inSock.close(); } catch (_) { }
                    try { outSock.close(); } catch (_) { }
                },
            });
        });
    });
}
exports.startOpusRelay = startOpusRelay;
