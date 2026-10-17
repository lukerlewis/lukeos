/** Turns FLACs into MP3s in the browser before they upload, so they take a third of the room. */

export function isFlac(file: File) {
  return /^audio\/(x-)?flac$/.test(file.type) || /\.flac$/i.test(file.name);
}

/** Decodes the FLAC, then encodes a 320 kbps MP3 in a worker. Reports progress from 0 to 1. */
export async function flacToMp3(file: File, onProgress: (share: number) => void) {
  const label = file.name || "That file";
  onProgress(0);
  let audio: AudioBuffer;
  try {
    // MP3 only allows a few sample rates; 44.1 kHz is CD quality and plays everywhere.
    audio = await new OfflineAudioContext(2, 1, 44100).decodeAudioData(await file.arrayBuffer());
  } catch {
    throw new Error(`Couldn't read ${label}. Is it a working FLAC?`);
  }
  const channels = Array.from({ length: Math.min(audio.numberOfChannels, 2) }, (_, i) => audio.getChannelData(i).slice());
  const worker = new Worker(new URL("./mp3-worker.ts", import.meta.url), { type: "module" });
  try {
    const parts = await new Promise<Uint8Array[]>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<{ share?: number; parts?: Uint8Array[] }>) => {
        if (e.data.parts) resolve(e.data.parts);
        else if (e.data.share !== undefined) onProgress(e.data.share);
      };
      worker.onerror = () => reject(new Error(`Couldn't convert ${label} to MP3.`));
      worker.postMessage(
        { sampleRate: audio.sampleRate, channels },
        channels.map((c) => c.buffer),
      );
    });
    const name = (file.name || "Audio.flac").replace(/\.flac$/i, "") + ".mp3";
    return { file: new File(parts as BlobPart[], name, { type: "audio/mpeg" }), durationSeconds: audio.duration };
  } finally {
    worker.terminate();
  }
}
