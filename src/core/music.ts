import { requireAudioSource } from "./audio.js";
import { requireCondition } from "./errors.js";
import { segments, type Model, type Track } from "./model.js";
import { frame, toFrames } from "./time.js";
import {
  attributePatch,
  children,
  escapeXml,
  patchXml,
  property,
  raw,
  type Patch,
  type XmlNode,
} from "./xml.js";

export interface InsertAudioClip {
  trackId: string;
  sourceId: string;
  at: number;
  sourceIn: number;
  sourceOut: number;
}
export interface ReplaceAudioClip {
  clipId: string;
  sourceId: string;
  sourceIn: number;
}
interface SourceRange {
  sourceId: string;
  sourceIn: number;
  sourceOut: number;
}

function binSource(model: Model, range: SourceRange): XmlNode {
  const source = model.doc.ids.get(range.sourceId);
  const references = children(model.doc.ids.get("main_bin")!, "entry").filter(
    (n) => n.attributes.producer === range.sourceId,
  );
  requireCondition(
    source && references.length === 1,
    "UNKNOWN_SOURCE",
    "Choose a unique audio source already in the project bin",
  );
  requireAudioSource(source);
  requireCondition(
    source.children.every((n) => n.name === "property") &&
      children(references[0]!, "filter").length === 0,
    "UNSUPPORTED_EFFECT",
    "Bin source effects or links are unsupported",
  );
  const duration = toFrames(property(source, "length") ?? "", model.fps);
  const binIn = toFrames(references[0]!.attributes.in ?? "0", model.fps);
  const binOut = frame(
    toFrames(
      references[0]!.attributes.out ?? source.attributes.out ?? "",
      model.fps,
    ) + 1,
  );
  requireCondition(
    frame(range.sourceIn) < frame(range.sourceOut) &&
      range.sourceIn >= binIn &&
      range.sourceOut <= Math.min(duration, binOut),
    "INVALID_SOURCE_RANGE",
    "Source range exceeds available bin media",
  );
  requireCondition(
    property(source, "kdenlive:id"),
    "UNKNOWN_SOURCE",
    "Source bin identity is missing",
  );
  return source;
}

function cloneSource(model: Model, source: XmlNode, playlist: XmlNode) {
  let serial = 0;
  while (model.doc.ids.has(`mcp_source_${serial}`)) serial++;
  const id = `mcp_source_${serial}`;
  const patch = attributePatch(model.doc, source, "id", id);
  const xml = patchXml(raw(model.doc, source), [
    {
      ...patch,
      start: patch.start - source.start,
      end: patch.end - source.start,
    },
  ]);
  // MLT resolves references while reading XML: the new source must precede its playlist.
  return {
    id,
    patch: { start: playlist.start, end: playlist.start, text: xml + "\n" },
  };
}

function appendInside(node: XmlNode, text: string): Patch {
  return node.selfClosing
    ? {
        start: node.openEnd - 2,
        end: node.openEnd,
        text: `>${text}</${node.name}>`,
      }
    : { start: node.closeStart, end: node.closeStart, text };
}
function blank(length: number): string {
  return length > 0 ? `<blank length="${length}"/>` : "";
}
function placement(
  model: Model,
  playlist: XmlNode,
  request: { at: number; duration: number; entry: string },
): Patch {
  const timeline = segments(playlist, model.fps),
    end = timeline.at(-1)?.end ?? 0;
  if (request.at >= end)
    return appendInside(playlist, blank(request.at - end) + request.entry);
  const space = timeline.find(
    (s) =>
      !s.clip &&
      s.start <= request.at &&
      s.end >= request.at + request.duration,
  );
  requireCondition(
    space,
    "OVERLAP",
    "Insertion requires empty space; clips are never moved or overwritten",
  );
  requireCondition(
    Object.keys(space.node.attributes).every((key) => key === "length") &&
      space.node.children.length === 0 &&
      !/<!--|<\?|<!\[CDATA\[/.test(raw(model.doc, space.node)),
    "UNSUPPORTED_LAYOUT",
    "Blank metadata cannot be discarded",
  );
  return {
    start: space.node.start,
    end: space.node.end,
    text:
      blank(request.at - space.start) +
      request.entry +
      blank(space.end - request.at - request.duration),
  };
}

export function insertAudioClip(
  model: Model,
  track: Track,
  operation: InsertAudioClip,
): string {
  requireCondition(
    track.kind === "audio",
    "UNSUPPORTED_AUDIO",
    "Music requires an audio track",
  );
  frame(operation.at);
  frame(operation.at + operation.sourceOut - operation.sourceIn);
  const source = binSource(model, operation);
  const playlist =
    track.playlists.find((p) => segments(p, model.fps).length > 0) ??
    track.playlists[0]!;
  const clone = cloneSource(model, source, playlist);
  const entry = `<entry producer="${clone.id}" in="${operation.sourceIn}" out="${operation.sourceOut - 1}"><property name="kdenlive:id">${escapeXml(property(source, "kdenlive:id")!)}</property></entry>`;
  const insert = placement(model, playlist, {
    at: operation.at,
    duration: operation.sourceOut - operation.sourceIn,
    entry,
  });
  return patchXml(model.doc.source, [clone.patch, insert]);
}

export function replaceAudioClip(
  model: Model,
  track: Track,
  operation: ReplaceAudioClip,
): string {
  requireCondition(
    track.kind === "audio",
    "UNSUPPORTED_AUDIO",
    "Music requires an audio track",
  );
  const clip = track.clips.find((c) => c.id === operation.clipId)!;
  requireCondition(
    clip.node.children.every((n) => n.name === "property") &&
      children(model.doc.ids.get(clip.producerId)!, "filter").length === 0,
    "UNSUPPORTED_EFFECT",
    "Remove clip effects before replacing its source",
  );
  const sourceOut = frame(operation.sourceIn + clip.end - clip.start);
  const source = binSource(model, { ...operation, sourceOut });
  const playlist = track.playlists.find((p) => p.children.includes(clip.node))!;
  const clone = cloneSource(model, source, playlist);
  const binId = children(clip.node, "property").filter(
    (n) => n.attributes.name === "kdenlive:id",
  );
  requireCondition(
    binId.length <= 1,
    "AMBIGUOUS_PROPERTY",
    "Duplicate entry bin identity",
  );
  const identity = escapeXml(property(source, "kdenlive:id")!);
  const patches = [
    clone.patch,
    attributePatch(model.doc, clip.node, "producer", clone.id),
    attributePatch(model.doc, clip.node, "in", String(operation.sourceIn)),
    attributePatch(model.doc, clip.node, "out", String(sourceOut - 1)),
  ];
  if (binId[0]) {
    requireCondition(
      !binId[0].selfClosing && binId[0].children.length === 0,
      "UNSUPPORTED_ENTRY",
      "Unsupported bin identity metadata",
    );
    patches.push({
      start: binId[0].openEnd,
      end: binId[0].closeStart,
      text: identity,
    });
  } else
    patches.push(
      appendInside(
        clip.node,
        `<property name="kdenlive:id">${identity}</property>`,
      ),
    );
  return patchXml(model.doc.source, patches);
}
