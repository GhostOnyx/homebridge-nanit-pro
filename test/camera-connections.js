// Drives LocalStreamingDelegate against a fake Nanit camera and counts open camera connections.
const path = require('path'); const repo = process.argv[2]; const mode = process.argv[3];
const { EventEmitter } = require('events');
const proto = require(path.join(repo, 'src/nanit.proto.js')).client;
// Modelled on the real camera: ONE mobile stream at a time (a second START gets 403) and a STOP is
// only accepted with attempts > 0.
const cam = { open: new Set(), maxOpen: 0, total: 0, started: 0, stopped: 0, badStops: 0, active: false, behaviour: 'silent', onStart: null, onStop: null };
class FakeWs extends EventEmitter {
  static OPEN = 1; static CLOSED = 3;
  constructor() { super(); this.readyState = 0; cam.total++;
    setTimeout(() => { if (this.readyState !== 0) return; this.readyState = 1; cam.open.add(this); cam.maxOpen = Math.max(cam.maxOpen, cam.open.size); this.emit('open'); }, 20); }
  send(buf) { if (this.readyState !== 1) throw new Error('not open');
    const m = proto.Message.decode(buf); const r = m.request; if (!r) return;
    let code = 200, msg = '';
    if (r.type === proto.RequestType.PUT_STREAMING) {
      if (r.streaming.status === proto.Streaming.Status.STARTED) { cam.started++;
        if (cam.active || cam.behaviour === 'forbidden') { code = 403; msg = 'Forbidden: Number of Mobile App connections above limit, declining connection'; }
        else { cam.active = true; if (cam.behaviour === 'push' && cam.onStart) setTimeout(cam.onStart, 300); }
      } else if (!(r.streaming.attempts > 0)) { cam.badStops++; code = 400; msg = 'Bad Request: Connection attempts must be greater than zero'; }
      else { cam.stopped++; cam.active = false; if (cam.onStop) cam.onStop(); }
    }
    const out = proto.Message.encode(proto.Message.create({ type: proto.Message.Type.RESPONSE, response: proto.Response.create({ requestId: r.id, statusCode: code, statusMessage: msg }) })).finish();
    setTimeout(() => { for (const w of cam.open) w.emit('message', out); }, 10);   // camera answers every connected client
  }
  close() { if (this.readyState === 3) return; this.readyState = 3; cam.open.delete(this); setTimeout(() => this.emit('close'), 15); }
}
require.cache[require.resolve(path.join(repo, 'node_modules/ws'))] = { id: 'ws', filename: 'ws', loaded: true, exports: FakeWs };
const { LocalStreamingDelegate } = require(path.join(repo, 'src/localStreamingDelegate.js'));
const log = { info() {}, debug() {}, warn() {}, error() {} };
const hap = { CameraController: { generateSynchronisationSource: () => 1 } };
const d = new LocalStreamingDelegate(hap, log, 'cam', '127.0.0.1', () => 'tok', 1935, 'UID', 'baby', '127.0.0.1', () => {}, 'ffmpeg', 'http://127.0.0.1:1', () => {}, false);
d.startRtmpServer = function () { this._rtmpPublishing = this._rtmpPublishing || new Set(); this._rtmpPublishWaiters = this._rtmpPublishWaiters || new Map(); };
d._registerGo2rtcStream = async () => {}; d._unregisterGo2rtcStream = async () => {};
cam.onStop = () => { d._rtmpPublishing?.delete('/live/nanit_baby'); };
cam.onStart = () => { const sp = '/live/nanit_baby'; d._rtmpPublishing.add(sp); const w = d._rtmpPublishWaiters.get(sp); if (w) { d._rtmpPublishWaiters.delete(sp); for (const r of w) r(true); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const start = (id) => { d.sessions.set(id, {}); d.startingSessions.add(id); const t = Date.now(); return d._ensureSharedStream().then(() => ({ ok: true, ms: Date.now() - t }), (e) => ({ ok: false, ms: Date.now() - t, err: e.message.slice(0, 60) })); };
const stop = (id) => { d.startingSessions.delete(id); d.sessions.delete(id); d._stopSharedStreamIfIdle(); };
(async () => {
  d.startSensorPolling(); await sleep(100);
  if (mode === 'forbidden') { cam.behaviour = 'forbidden';
    const r = await start('a'); console.log('403 case -> result', JSON.stringify(r)); stop('a'); await sleep(4000);
  } else if (mode === 'storm') { cam.behaviour = 'silent';       // Home app: start, give up after 0.9 s, retry at once (x8)
    for (let i = 0; i < 8; i++) { start('s' + i); await sleep(900); stop('s' + i); }
    await sleep(16000);
  } else if (mode === 'stale') { cam.behaviour = 'push'; cam.active = true;   // a stream left registered by an earlier, killed process
    const r = await start('a'); console.log('stale stream case -> result', JSON.stringify(r)); stop('a'); await sleep(4000);
  } else if (mode === 'ok') { cam.behaviour = 'push';
    const r = await start('a'); console.log('normal case -> result', JSON.stringify(r), 'open now', cam.open.size); stop('a');
    const r2 = await start('b'); console.log('immediate retry -> result', JSON.stringify(r2), 'connections made so far', cam.total); stop('b'); await sleep(4000);
  }
  console.log(`${mode}: connections made ${cam.total}, max open at once ${cam.maxOpen}, open at end ${cam.open.size}, STARTED sent ${cam.started}, stops accepted ${cam.stopped}, stops rejected ${cam.badStops}, camera stream left active: ${cam.active}`);
  d._destroyed = true; process.exit(0);
})();
