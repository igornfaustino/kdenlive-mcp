import assert from "node:assert/strict";
export function pcm(buffer) {
  assert.equal(buffer.toString("ascii", 0, 4), "RIFF");
  assert.equal(buffer.toString("ascii", 8, 12), "WAVE");
  let samples, rate;
  for (let offset = 12; offset + 8 <= buffer.length; ) {
    const name = buffer.toString("ascii", offset, offset + 4),
      size = buffer.readUInt32LE(offset + 4);
    if (name === "fmt ") {
      assert.equal(buffer.readUInt16LE(offset + 8), 1, "PCM format");
      assert.equal(buffer.readUInt16LE(offset + 10), 1, "mono");
      assert.equal(buffer.readUInt16LE(offset + 22), 16, "16-bit");
      rate = buffer.readUInt32LE(offset + 12);
    }
    if (name === "data")
      samples = buffer.subarray(offset + 8, offset + 8 + size);
    offset += 8 + size + (size % 2);
  }
  assert.ok(samples && rate);
  return { samples, rate };
}
export function rms(audio, start, end) {
  let squares = 0;
  const first = Math.round(start * audio.rate),
    last = Math.round(end * audio.rate);
  assert.ok(last * 2 <= audio.samples.length);
  for (let i = first; i < last; i++)
    squares += (audio.samples.readInt16LE(i * 2) / 32768) ** 2;
  return Math.sqrt(squares / (last - first));
}
