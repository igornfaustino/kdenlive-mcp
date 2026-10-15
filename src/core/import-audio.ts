import { requireCondition } from "./errors.js";
import { buildModel } from "./model.js";
import { frame } from "./time.js";
import { parseXml, patchXml, escapeXml } from "./xml.js";

export interface AudioImport {
  path: string;
  name: string;
  uuid: string;
  samples: number;
  sampleRate: number;
  channels: number;
  bytes: number;
}
export function importAudio(xml: string, media: AudioImport) {
  const doc = parseXml(xml),
    model = buildModel(doc),
    bin = doc.ids.get("main_bin")!;
  requireCondition(
    model.version === "1.1" &&
      model.sequences.length === 1 &&
      bin.name === "playlist" &&
      !bin.selfClosing,
    "UNSUPPORTED_LAYOUT",
    "Audio import requires a version 1.1 single-sequence project bin",
  );
  requireCondition(
    frame(media.samples) > 0 &&
      frame(media.sampleRate) > 0 &&
      [1, 2].includes(media.channels),
    "INVALID_AUDIO",
    "Invalid audio metadata",
  );
  const durationFrames = frame(
    Number(
      (BigInt(media.samples) * BigInt(model.fps.numerator)) /
        (BigInt(media.sampleRate) * BigInt(model.fps.denominator)),
    ),
  );
  requireCondition(
    durationFrames > 0,
    "INVALID_AUDIO",
    "Audio must contain at least one complete project frame",
  );
  let serial = 0;
  while (doc.ids.has(`mcp_bin_${serial}`)) serial++;
  const sourceId = `mcp_bin_${serial}`;
  const used = new Set(
    doc.nodes
      .filter(
        (n) => n.name === "property" && n.attributes.name === "kdenlive:id",
      )
      .map((n) => n.text),
  );
  let binId = 1;
  while (used.has(String(binId))) binId++;
  const properties: Record<string, string | number> = {
    length: durationFrames,
    eof: "pause",
    resource: media.path,
    mlt_service: "avformat",
    audio_index: 0,
    video_index: -1,
    astream: 0,
    "kdenlive:id": binId,
    "kdenlive:folderid": -1,
    "kdenlive:clipname": media.name,
    "kdenlive:control_uuid": media.uuid,
    "kdenlive:clip_type": 1,
    "kdenlive:file_size": media.bytes,
    "set.test_audio": 0,
    "set.test_image": 1,
    mute_on_pause: 0,
  };
  const chain = `<chain id="${sourceId}" in="0" out="${durationFrames - 1}">${Object.entries(
    properties,
  )
    .map(
      ([key, value]) =>
        `<property name="${key}">${escapeXml(String(value))}</property>`,
    )
    .join("")}</chain>\n`;
  const entry = `<entry producer="${sourceId}" in="0" out="${durationFrames - 1}"/>`;
  const candidate = patchXml(xml, [
    { start: bin.start, end: bin.start, text: chain },
    { start: bin.closeStart, end: bin.closeStart, text: entry },
  ]);
  buildModel(parseXml(candidate));
  return { xml: candidate, sourceId, durationFrames };
}
