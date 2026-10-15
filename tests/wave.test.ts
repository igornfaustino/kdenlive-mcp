import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { inspectWave } from "../src/io/wave.js";

const tone = await readFile(new URL("./fixtures/tone.wav", import.meta.url));
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kdenlive-wave-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const fourCCOffsets = [0, 8, 12, 36].flatMap((start) =>
  [0, 1, 2, 3].map((byte) => start + byte),
);

it.each(fourCCOffsets)(
  "rejects a high-bit mutation of a required FourCC at byte %i",
  async (offset) => {
    const corrupt = Buffer.from(tone);
    corrupt[offset] = corrupt[offset]! | 0x80;
    const path = join(root, "corrupt.wav");
    await writeFile(path, corrupt);

    await expect(inspectWave(path)).rejects.toMatchObject({
      code: "INVALID_AUDIO",
    });
  },
);
