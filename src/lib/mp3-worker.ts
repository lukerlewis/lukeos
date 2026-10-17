/** Encodes decoded audio into a 320 kbps MP3 off the main thread, so the page stays smooth. */
import { Mp3Encoder } from "@breezystack/lamejs";

type Job = { sampleRate: number; channels: Float32Array[] };

const CHUNK = 1152 * 40;

function toInt16(samples: Float32Array) {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

self.onmessage = (e: MessageEvent<Job>) => {
  const { sampleRate, channels } = e.data;
  const left = toInt16(channels[0]);
  const right = channels[1] ? toInt16(channels[1]) : undefined;
  const encoder = new Mp3Encoder(right ? 2 : 1, sampleRate, 320);
  const parts: Uint8Array[] = [];
  for (let i = 0; i < left.length; i += CHUNK) {
    parts.push(encoder.encodeBuffer(left.subarray(i, i + CHUNK), right?.subarray(i, i + CHUNK)));
    if ((i / CHUNK) % 5 === 0) self.postMessage({ share: i / left.length });
  }
  parts.push(encoder.flush());
  self.postMessage({ parts });
};
