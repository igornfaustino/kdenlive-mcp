import { open, stat } from "node:fs/promises";
import { requireCondition } from "../core/errors.js";

export interface WaveInfo {
  samples: number;
  sampleRate: number;
  channels: number;
  bytes: number;
}

/** Inspect only RIFF headers; audio payloads are never loaded into memory. */
export async function inspectWave(path: string): Promise<WaveInfo> {
  const file = await open(path, "r");
  try {
    const before = await file.stat();
    requireCondition(
      before.isFile() && before.size >= 44 && before.size <= 0xffffffff + 8,
      "INVALID_AUDIO",
      "Expected a regular RIFF WAV file",
    );
    async function read(position: number, length: number) {
      const buffer = Buffer.alloc(length);
      let count = 0;
      while (count < length) {
        const result = await file.read(
          buffer,
          count,
          length - count,
          position + count,
        );
        if (!result.bytesRead) break;
        count += result.bytesRead;
      }
      requireCondition(
        count === length,
        "INVALID_AUDIO",
        "Truncated WAV header",
      );
      return buffer;
    }
    const header = await read(0, 12);
    requireCondition(
      header.toString("ascii", 0, 4) === "RIFF" &&
        header.toString("ascii", 8, 12) === "WAVE" &&
        header.readUInt32LE(4) + 8 === before.size,
      "INVALID_AUDIO",
      "Expected a complete little-endian RIFF WAVE file",
    );
    let offset = 12,
      chunks = 0,
      format: Buffer | undefined,
      dataSize: number | undefined;
    while (offset < before.size) {
      requireCondition(
        ++chunks <= 1024 && offset + 8 <= before.size,
        "INVALID_AUDIO",
        "Invalid or excessive WAV chunks",
      );
      const chunk = await read(offset, 8),
        size = chunk.readUInt32LE(4),
        name = chunk.toString("ascii", 0, 4);
      const end = offset + 8 + size + (size % 2);
      requireCondition(
        end <= before.size,
        "INVALID_AUDIO",
        "WAV chunk exceeds RIFF boundary",
      );
      if (name === "fmt ") {
        requireCondition(
          !format && (size === 16 || size === 18),
          "UNSUPPORTED_AUDIO",
          "Expected one classic PCM format chunk",
        );
        format = await read(offset + 8, size);
      }
      if (name === "data") {
        requireCondition(
          dataSize === undefined && size > 0,
          "INVALID_AUDIO",
          "Expected one nonempty data chunk",
        );
        dataSize = size;
      }
      offset = end;
    }
    requireCondition(
      format && dataSize !== undefined,
      "INVALID_AUDIO",
      "Missing WAV format or data chunk",
    );
    const channels = format.readUInt16LE(2),
      sampleRate = format.readUInt32LE(4),
      alignment = format.readUInt16LE(12);
    requireCondition(
      format.readUInt16LE(0) === 1 &&
        [1, 2].includes(channels) &&
        format.readUInt16LE(14) === 16 &&
        (format.length === 16 || format.readUInt16LE(16) === 0),
      "UNSUPPORTED_AUDIO",
      "Only PCM16 mono/stereo WAV is supported",
    );
    requireCondition(
      sampleRate > 0 &&
        alignment === channels * 2 &&
        format.readUInt32LE(8) === sampleRate * alignment &&
        dataSize % alignment === 0,
      "INVALID_AUDIO",
      "Inconsistent WAV sample layout",
    );
    const after = await file.stat(),
      current = await stat(path);
    requireCondition(
      [after, current].every(
        (s) =>
          s.dev === before.dev &&
          s.ino === before.ino &&
          s.size === before.size &&
          s.mtimeMs === before.mtimeMs &&
          s.ctimeMs === before.ctimeMs,
      ),
      "INPUT_CHANGED",
      "Audio changed during inspection",
    );
    return {
      samples: dataSize / alignment,
      sampleRate,
      channels,
      bytes: before.size,
    };
  } finally {
    await file.close();
  }
}
