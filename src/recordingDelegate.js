'use strict';

const { spawn } = require('child_process');

// HAP numeric constants (stable protocol values — no import needed)
// EventTriggerOption.MOTION = 1
// MediaContainerType.FRAGMENTED_MP4 = 0
// AudioRecordingCodecType.AAC_LC = 0
// AudioRecordingSamplerate.KHZ_16 = 3
// VideoCodecType.H264 = 0
// H264Profile: BASELINE=0, MAIN=1, HIGH=2
// H264Level: LEVEL3_1=0, LEVEL3_2=1, LEVEL4_0=2

const RECORDING_OPTIONS = {
  overrideEventTriggerOptions: [1], // EventTriggerOption.MOTION
  prebufferLength: 4000,
  mediaContainerConfiguration: [
    {
      type: 0, // MediaContainerType.FRAGMENTED_MP4
      fragmentLength: 4000,
    },
  ],
  video: {
    type: 0, // VideoCodecType.H264
    parameters: {
      profiles: [0, 1, 2], // BASELINE, MAIN, HIGH
      levels: [0, 1, 2],   // LEVEL3_1, LEVEL3_2, LEVEL4_0
    },
    resolutions: [
      [1920, 1080, 30],
      [1280, 720, 30],
      [640, 360, 30],
    ],
  },
  audio: {
    codecs: [
      {
        type: 0,        // AudioRecordingCodecType.AAC_LC
        samplerate: 3,  // AudioRecordingSamplerate.KHZ_16
        bitrateMode: 0,
        audioChannels: 1,
      },
    ],
  },
};

class NanitRecordingDelegate {
  constructor(log, getRtmpUrl) {
    this.log = log;
    this.getRtmpUrl = getRtmpUrl;
    this.recordingActive = false;
    this.configuration = undefined;
    this.activeProcesses = new Map();
  }

  updateRecordingActive(active) {
    this.log.info('[Nanit Recording] Active:', active);
    this.recordingActive = active;
  }

  updateRecordingConfiguration(config) {
    this.log.info('[Nanit Recording] Configuration updated');
    this.configuration = config;
  }

  async *handleRecordingStreamRequest(streamId) {
    this.log.info(`[Nanit Recording] Recording stream requested: ${streamId}`);

    const rtmpUrl = this.getRtmpUrl();
    if (!rtmpUrl) {
      this.log.warn('[Nanit Recording] No RTMP stream available for recording');
      return;
    }

    const ffmpegArgs = [
      '-i', rtmpUrl,
      '-c:v', 'libx264',
      '-preset', 'superfast',
      '-profile:v', 'high',
      '-level:v', '4.0',
      '-b:v', '2000k',
      '-c:a', 'aac',
      '-ar', '16000',
      '-ac', '1',
      '-b:a', '32k',
      '-f', 'mp4',
      '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
      'pipe:1',
    ];

    const ffmpeg = spawn('ffmpeg', ffmpegArgs);
    this.activeProcesses.set(streamId, ffmpeg);

    let headerSent = false;

    try {
      for await (const chunk of this._readStream(ffmpeg.stdout)) {
        yield {
          data: chunk,
          isLast: false,
        };
        if (!headerSent) {
          headerSent = true;
          this.log.debug(`[Nanit Recording] First fragment sent for stream ${streamId}`);
        }
      }
    } catch (err) {
      this.log.error('[Nanit Recording] Stream error:', err.message);
    } finally {
      this.activeProcesses.delete(streamId);
      try { ffmpeg.kill('SIGKILL'); } catch (_) {}
    }
  }

  acknowledgeStream(streamId) {
    this.log.debug(`[Nanit Recording] Stream acknowledged: ${streamId}`);
  }

  closeRecordingStream(streamId, reason) {
    this.log.info(`[Nanit Recording] Closing stream ${streamId}, reason: ${reason}`);
    const proc = this.activeProcesses.get(streamId);
    if (proc) {
      try { proc.kill('SIGKILL'); } catch (_) {}
      this.activeProcesses.delete(streamId);
    }
  }

  async *_readStream(readable) {
    const CHUNK = 65536; // 64KB chunks
    for await (const chunk of readable) {
      // Yield in reasonable chunk sizes
      let offset = 0;
      while (offset < chunk.length) {
        yield chunk.slice(offset, offset + CHUNK);
        offset += CHUNK;
      }
    }
  }
}

module.exports = { NanitRecordingDelegate, RECORDING_OPTIONS };
