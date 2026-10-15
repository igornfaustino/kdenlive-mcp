import {
  insertAudioClip,
  replaceAudioClip,
  type InsertAudioClip,
  type ReplaceAudioClip,
} from "./music.js";
import { setClipAudio, type SetClipAudio } from "./audio.js";
import { requireCondition } from "./errors.js";
import {
  buildModel,
  segments,
  type Clip,
  type Model,
  type Track,
} from "./model.js";
import { frame, toFrames } from "./time.js";
import {
  attributePatch,
  children,
  parseXml,
  patchXml,
  property,
  raw,
  type Patch,
  type XmlDocument,
} from "./xml.js";

export interface Range {
  start: number;
  end: number;
}
interface Operations {
  remove_ranges: { trackId: string; ranges: Range[] };
  split_clip: { clipId: string; offset: number };
  set_clip_audio: SetClipAudio;
  insert_audio_clip: InsertAudioClip;
  replace_audio_clip: ReplaceAudioClip;
}
export type Operation = {
  [K in keyof Operations]: { type: K } & Operations[K];
}[keyof Operations];

function checkLayout(model: Model, track: Track): void {
  requireCondition(
    model.version === "1.1",
    "UNSUPPORTED_VERSION",
    `Unsupported document version: ${model.version}`,
  );
  requireCondition(
    model.sequences.length === 1,
    "UNSUPPORTED_LAYOUT",
    "Nested or multiple sequences are not editable yet",
  );
  for (const ref of children(model.sequence, "track")) {
    const source = model.doc.ids.get(ref.attributes.producer!)!;
    const background =
      source.name === "producer" &&
      property(source, "kdenlive:playlistid") === "black_track" &&
      property(source, "mlt_service") === "color";
    requireCondition(
      background || model.tracks.some((t) => t.node === source),
      "UNSUPPORTED_LAYOUT",
      "Unsupported sequence source",
    );
  }
  for (const node of [model.sequence, ...model.tracks.map((t) => t.node)]) {
    requireCondition(
      toFrames(node.attributes.in ?? "0", model.fps) === 0,
      "UNSUPPORTED_TIMING",
      "Nonzero tractor timing is unsupported",
    );
    for (const ref of children(node, "track")) {
      requireCondition(
        ref.attributes.in === undefined && ref.attributes.out === undefined,
        "UNSUPPORTED_TIMING",
        "Trimmed track references are unsupported",
      );
    }
  }
  const groups = property(model.sequence, "kdenlive:sequenceproperties.groups");
  requireCondition(
    !groups || groups.replace(/\s/g, "") === "[]",
    "UNSUPPORTED_GROUPS",
    "Grouped clips are not editable yet",
  );
  requireCondition(
    property(track.node, "kdenlive:locked_track") !== "1",
    "LOCKED_TRACK",
    "Track is locked",
  );
  requireCondition(
    track.playlists.length === 2,
    "UNSUPPORTED_LAYOUT",
    "Expected two playlists per track",
  );
  requireCondition(
    track.playlists.filter((p) => segments(p, model.fps).length > 0).length <=
      1,
    "UNSUPPORTED_MIX",
    "Mixed tracks are not editable yet",
  );
  for (const transition of model.doc.nodes.filter(
    (n) => n.name === "transition",
  )) {
    requireCondition(
      property(transition, "internal_added") === "237",
      "UNSUPPORTED_TRANSITION",
      "User transitions are not editable yet",
    );
  }
  for (const node of [track.node, ...track.playlists, model.sequence]) {
    requireCondition(
      children(node, "filter").every(
        (f) => property(f, "internal_added") === "237",
      ),
      "UNSUPPORTED_EFFECT",
      "Track or sequence effects require validated timing before editing",
    );
  }
}

function checkTemporalSources(model: Model, track: Track): void {
  for (const clip of track.clips) {
    const producer = model.doc.ids.get(clip.producerId)!;
    requireCondition(
      ["chain", "producer"].includes(producer.name),
      "UNSUPPORTED_PRODUCER",
      "Nested timeline clips are not editable",
    );
    requireCondition(
      children(producer, "filter").length === 0 &&
        children(clip.node, "filter").length === 0,
      "UNSUPPORTED_EFFECT",
      "Clip effects require validated retiming before editing",
    );
    requireCondition(
      ["avformat", "avformat-novalidate", "color", "qimage", "pixbuf"].includes(
        property(producer, "mlt_service") ?? "",
      ),
      "UNSUPPORTED_PRODUCER",
      "Unsupported source service for editing",
    );
    requireCondition(
      clip.node.children.every((n) => n.name === "property"),
      "UNSUPPORTED_ENTRY",
      "Unsupported entry child",
    );
  }
}

function sliceEntry(
  doc: XmlDocument,
  clip: Clip,
  start: number,
  end: number,
): string {
  const inPatch = attributePatch(
    doc,
    clip.node,
    "in",
    String(clip.sourceIn + start - clip.start),
  );
  const outPatch = attributePatch(
    doc,
    clip.node,
    "out",
    String(clip.sourceIn + end - clip.start - 1),
  );
  return patchXml(
    raw(doc, clip.node),
    [inPatch, outPatch].map((p) => ({
      ...p,
      start: p.start - clip.node.start,
      end: p.end - clip.node.start,
    })),
  );
}

function subtract(segment: Range, ranges: Range[]): Range[] {
  let cursor = segment.start;
  const remaining: Range[] = [];
  for (const range of ranges) {
    if (range.end <= cursor || range.start >= segment.end) continue;
    if (range.start > cursor)
      remaining.push({ start: cursor, end: range.start });
    cursor = Math.min(segment.end, range.end);
  }
  if (cursor < segment.end) remaining.push({ start: cursor, end: segment.end });
  return remaining;
}

function removalPatches(model: Model, track: Track, input: Range[]): Patch[] {
  requireCondition(
    input.length > 0 && input.length <= 1000,
    "INVALID_RANGES",
    "Provide 1–1000 ranges",
  );
  const ranges = input
    .map((r) => ({ start: frame(r.start), end: frame(r.end) }))
    .sort((a, b) => a.start - b.start);
  ranges.forEach((r, i) =>
    requireCondition(
      r.start < r.end &&
        r.end <= track.duration &&
        (i === 0 || r.start >= ranges[i - 1]!.end),
      "INVALID_RANGES",
      "Ranges must be disjoint and inside the track",
    ),
  );
  const patches: Patch[] = [];
  for (const playlist of track.playlists) {
    for (const segment of segments(playlist, model.fps)) {
      const parts = subtract(segment, ranges);
      if (
        parts.length === 1 &&
        parts[0]!.start === segment.start &&
        parts[0]!.end === segment.end
      )
        continue;
      const replacement = parts
        .map((part) =>
          segment.clip
            ? sliceEntry(model.doc, segment.clip, part.start, part.end)
            : `<blank length="${part.end - part.start}"/>`,
        )
        .join("\n  ");
      patches.push({
        start: segment.node.start,
        end: segment.node.end,
        text: replacement,
      });
    }
  }
  requireCondition(
    track.duration - ranges.reduce((sum, r) => sum + r.end - r.start, 0) > 0,
    "EMPTY_TRACK",
    "Removing the entire track is not supported yet",
  );
  return patches;
}

function updateDuration(source: string, trackId: string): string {
  const doc = parseXml(source),
    model = buildModel(doc),
    track = model.tracks.find((t) => t.id === trackId)!;
  const patches: Patch[] = [
    attributePatch(doc, track.node, "out", String(track.duration - 1)),
    attributePatch(doc, model.sequence, "out", String(model.duration - 1)),
  ];
  for (const name of ["kdenlive:duration", "kdenlive:maxduration"]) {
    const node = children(model.sequence, "property").find(
      (p) => p.attributes.name === name,
    );
    if (node && !node.selfClosing)
      patches.push({
        start: node.openEnd,
        end: node.closeStart,
        text: String(model.duration),
      });
  }
  const wrapper = children(doc.root, "tractor").find(
    (n) => property(n, "kdenlive:projectTractor") === "1",
  );
  if (wrapper) {
    patches.push(
      attributePatch(doc, wrapper, "out", String(model.duration - 1)),
    );
    for (const ref of children(wrapper, "track"))
      patches.push(attributePatch(doc, ref, "out", String(model.duration - 1)));
  }
  return patchXml(source, patches);
}

const handlers: {
  [K in keyof Operations]: (
    model: Model,
    track: Track,
    operation: Operations[K],
  ) => string;
} = {
  remove_ranges(model, track, operation) {
    checkTemporalSources(model, track);
    return updateDuration(
      patchXml(
        model.doc.source,
        removalPatches(model, track, operation.ranges),
      ),
      track.id,
    );
  },
  split_clip(model, track, operation) {
    checkTemporalSources(model, track);
    const clip = track.clips.find((c) => c.id === operation.clipId)!;
    const offset = frame(operation.offset);
    requireCondition(
      offset > 0 && offset < clip.end - clip.start,
      "INVALID_SPLIT",
      "Split offset must be inside the clip",
    );
    const text =
      sliceEntry(model.doc, clip, clip.start, clip.start + offset) +
      "\n  " +
      sliceEntry(model.doc, clip, clip.start + offset, clip.end);
    return patchXml(model.doc.source, [
      { start: clip.node.start, end: clip.node.end, text },
    ]);
  },
  set_clip_audio: setClipAudio,
  insert_audio_clip(model, track, operation) {
    return updateDuration(insertAudioClip(model, track, operation), track.id);
  },
  replace_audio_clip: replaceAudioClip,
};

function applyOperation<K extends keyof Operations>(
  model: Model,
  track: Track,
  operation: { type: K } & Operations[K],
): string {
  return handlers[operation.type](model, track, operation);
}

export function editBatch(xml: string, operations: Operation[]): string {
  requireCondition(
    operations.length > 0 && operations.length <= 100,
    "INVALID_BATCH",
    "Provide 1–100 operations",
  );
  const targeted = new Set<string>();
  let candidate = xml;
  for (const op of operations) {
    const model = buildModel(parseXml(candidate));
    const track =
      "trackId" in op
        ? model.tracks.find((t) => t.id === op.trackId)
        : model.tracks.find((t) => t.clips.some((c) => c.id === op.clipId));
    requireCondition(
      track,
      "UNKNOWN_TARGET",
      "Track or clip not found; inspect the current revision",
    );
    requireCondition(
      !targeted.has(track.id),
      "DUPLICATE_TARGET",
      "Each track may be edited only once per batch; combine ranges",
    );
    targeted.add(track.id);
    checkLayout(model, track);
    candidate = applyOperation(model, track, op);
    buildModel(parseXml(candidate));
  }
  return candidate;
}
