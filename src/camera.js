"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NanitCamera = void 0;
const streamingDelegate_1 = require("./streamingDelegate");
const localStreamingDelegate_1 = require("./localStreamingDelegate");
const { NanitRecordingDelegate, RECORDING_OPTIONS } = require("./recordingDelegate");
class NanitCamera {
    api;
    hap;
    log;
    platform;
    accessory;
    baby;
    cameraController;
    temperatureService;
    humidityService;
    motionService;
    streamingDelegate;
    recordingDelegate;
    currentRtmpUrl;
    constructor(platform, accessory, baby) {
        this.platform = platform;
        this.api = platform.api;
        this.hap = this.api.hap;
        this.log = platform.log;
        this.accessory = accessory;
        this.baby = baby;
        this.accessory
            .getService(this.hap.Service.AccessoryInformation)
            .setCharacteristic(this.hap.Characteristic.Manufacturer, 'Nanit')
            .setCharacteristic(this.hap.Characteristic.Model, 'Nanit Camera')
            .setCharacteristic(this.hap.Characteristic.SerialNumber, baby.camera?.uid || baby.uid)
            .setCharacteristic(this.hap.Characteristic.FirmwareRevision, '1.0.0');
        this.setupSensors();
        this.setupCamera();
    }
    setupCamera() {
        const streamMode = this.platform.config.streamMode || 'cloud';
        const rtmpPort = this.platform.allocateRtmpPort();
        this.log.debug(`[${this.getName()}] Assigned RTMP port ${rtmpPort}`);
        const privateAddr = this.baby.camera?.private_address;
        const localIp = this.baby.camera?.local_ip || (privateAddr ? privateAddr.split(':')[0] : undefined);
        const cameraUid = this.baby.camera?.uid || this.baby.camera_uid;
        const hasValidCameraUid = cameraUid && cameraUid.length > 0;
        const ffmpegPath = this.platform.config.ffmpegPath || 'ffmpeg';
        const go2rtcApiUrl = this.platform.config.go2rtcApiUrl || 'http://localhost:1984';
        const allowInsecureTls = !!this.platform.config.allowInsecureTls;
        if (allowInsecureTls) {
            this.log.warn(`[${this.getName()}] allowInsecureTls is enabled — TLS certificate verification is disabled for cloud streams`);
        }
        if (streamMode === 'local' && localIp && hasValidCameraUid) {
            this.log.info(`[${this.getName()}] Using local streaming mode (${localIp})`);
            this.streamingDelegate = new localStreamingDelegate_1.LocalStreamingDelegate(this.hap, this.log, this.baby.uid, localIp, () => this.platform.getAccessToken(), rtmpPort, cameraUid, this.baby.uid, this.platform.config.localAddress, (t, h) => this.updateSensors(t, h), ffmpegPath, go2rtcApiUrl, (detected) => this.updateMotion(detected), allowInsecureTls);
        }
        else if (streamMode === 'auto' && localIp && hasValidCameraUid) {
            this.log.info(`[${this.getName()}] Using auto streaming mode (will try local first)`);
            this.streamingDelegate = new localStreamingDelegate_1.LocalStreamingDelegate(this.hap, this.log, this.baby.uid, localIp, () => this.platform.getAccessToken(), rtmpPort, cameraUid, this.baby.uid, this.platform.config.localAddress, (t, h) => this.updateSensors(t, h), ffmpegPath, go2rtcApiUrl, (detected) => this.updateMotion(detected), allowInsecureTls);
            this.streamingDelegate.cloudFallbackGetUrl = () => this.getStreamUrl();
        }
        else {
            if (streamMode !== 'cloud') {
                if (!hasValidCameraUid) {
                    this.log.warn(`[${this.getName()}] Camera UID not available, falling back to cloud streaming`);
                }
                else if (!localIp) {
                    this.log.warn(`[${this.getName()}] Local IP not available, falling back to cloud streaming`);
                }
                else {
                    this.log.warn(`[${this.getName()}] Invalid mode, falling back to cloud streaming`);
                }
            }
            else {
                this.log.info(`[${this.getName()}] Using cloud streaming mode`);
            }
            this.streamingDelegate = new streamingDelegate_1.NanitStreamingDelegate(this.hap, this.log, this.getName(), () => this.getStreamUrl(), allowInsecureTls);
        }
        this.recordingDelegate = new NanitRecordingDelegate(this.log, () => this.currentRtmpUrl);
        const options = {
            cameraStreamCount: 2,
            delegate: this.streamingDelegate,
            streamingOptions: {
                supportedCryptoSuites: [0],
                video: {
                    resolutions: [
                        [1920, 1080, 30],
                        [1280, 720, 30],
                        [640, 360, 30],
                        [320, 240, 15],
                    ],
                    codec: {
                        profiles: [0, 1, 2],
                        levels: [0, 1, 2],
                    },
                },
                audio: {
                    codecs: [
                        {
                            type: "OPUS",
                            samplerate: 16,
                        },
                    ],
                },
            },
            recording: {
                options: RECORDING_OPTIONS,
                delegate: this.recordingDelegate,
            },
            sensors: {
                motion: this.motionService,
            },
        };
        this.cameraController = new this.hap.CameraController(options);
        this.streamingDelegate.controller = this.cameraController;
        // Keep currentRtmpUrl in sync so recordingDelegate can use it
        if (this.streamingDelegate.onRtmpUrl !== undefined) {
            this.streamingDelegate.onRtmpUrl = (url) => { this.currentRtmpUrl = url; };
        }
        Object.defineProperty(this.streamingDelegate, 'currentRtmpUrl', {
            set: (url) => { this.currentRtmpUrl = url; },
            get: () => this.currentRtmpUrl,
            configurable: true,
        });
        this.accessory.configureController(this.cameraController);
    }
    setupSensors() {
        this.currentTemperature = 0;
        this.currentHumidity = 0;
        this.temperatureService =
            this.accessory.getService(this.hap.Service.TemperatureSensor) ||
                this.accessory.addService(this.hap.Service.TemperatureSensor, `${this.getName()} Temperature`);
        this.temperatureService
            .getCharacteristic(this.hap.Characteristic.CurrentTemperature)
            .onGet(() => this.currentTemperature);
        this.humidityService =
            this.accessory.getService(this.hap.Service.HumiditySensor) ||
                this.accessory.addService(this.hap.Service.HumiditySensor, `${this.getName()} Humidity`);
        this.humidityService
            .getCharacteristic(this.hap.Characteristic.CurrentRelativeHumidity)
            .onGet(() => this.currentHumidity);
        this.motionService =
            this.accessory.getService(this.hap.Service.MotionSensor) ||
                this.accessory.addService(this.hap.Service.MotionSensor, `${this.getName()} Motion`);
    }
    updateMotion(detected) {
        if (this.motionService) {
            this.motionService.getCharacteristic(this.hap.Characteristic.MotionDetected).updateValue(detected);
        }
    }
    updateSensors(temperature, humidity) {
        if (temperature !== undefined) {
            this.currentTemperature = temperature;
            if (this.temperatureService) {
                this.temperatureService
                    .getCharacteristic(this.hap.Characteristic.CurrentTemperature)
                    .updateValue(temperature);
            }
        }
        if (humidity !== undefined) {
            this.currentHumidity = humidity;
            if (this.humidityService) {
                this.humidityService
                    .getCharacteristic(this.hap.Characteristic.CurrentRelativeHumidity)
                    .updateValue(humidity);
            }
        }
    }
    getName() {
        return this.baby.name || this.baby.first_name || 'Nanit Camera';
    }
    getStreamUrl() {
        const accessToken = this.platform.getAccessToken();
        return `rtmps://media-secured.nanit.com/nanit/${this.baby.uid}.${accessToken}`;
    }
    getBabyUid() {
        return this.baby.uid;
    }
    destroy() {
        this.log.debug(`[${this.getName()}] Cleaning up camera`);
        if (this.streamingDelegate && this.streamingDelegate.destroy) {
            this.streamingDelegate.destroy();
        }
    }
}
exports.NanitCamera = NanitCamera;
