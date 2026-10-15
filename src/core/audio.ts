import { toFrames, type FrameRate } from "./time.js";
import { requireCondition } from "./errors.js";
import type { Clip, Model, Track } from "./model.js";
import {
  children,
  escapeXml,
  patchXml,
  property,
  raw,
  type XmlNode,
  type XmlDocument,
  type Patch,
} from "./xml.js";

export interface AudioSettings {
  gainDb: number;
  fadeInFrames: number;
  fadeOutFrames: number;
}
export interface SetClipAudio extends AudioSettings {
  clipId: string;
}
interface AudioFilter {
  start: number;
  end: number;
  properties: Record<string, string>;
}

function validSettings(settings: AudioSettings, duration: number): boolean {
  const fades = [settings.fadeInFrames, settings.fadeOutFrames];
  return (
    Number.isFinite(settings.gainDb) &&
    settings.gainDb >= -60 &&
    settings.gainDb <= 20 &&
    fades.every((n) => Number.isSafeInteger(n) && (n === 0 || n >= 2)) &&
    settings.fadeInFrames + settings.fadeOutFrames <= duration
  );
}

function filtersFor(clip: Clip, settings: AudioSettings): AudioFilter[] {
  const filters: AudioFilter[] = [];
  const add = (
    name: string,
    start: number,
    end: number,
    parameters: Record<string, string>,
  ) => {
    filters.push({
      start,
      end,
      properties: {
        mlt_service: "volume",
        kdenlive_id: name,
        "kdenlive:ix": String(filters.length + 1),
        "kdenlive-mcp:audio": "1",
        ...parameters,
      },
    });
  };
  if (settings.gainDb !== 0)
    add("volume", clip.sourceIn, clip.sourceOut - 1, {
      "kdenlive:sync_in_out": "1",
      level: `0=${settings.gainDb}`,
    });
  if (settings.fadeInFrames)
    add("fadein", clip.sourceIn, clip.sourceIn + settings.fadeInFrames - 1, {
      gain: "0",
      end: "1",
    });
  if (settings.fadeOutFrames)
    add(
      "fadeout",
      clip.sourceOut - settings.fadeOutFrames,
      clip.sourceOut - 1,
      { gain: "1", end: "0" },
    );
  return filters;
}

function effectFrame(clock: string | undefined, fps: FrameRate): number {
  if (!clock || !/^(?:\d+|\d+:[0-5]\d:[0-5]\d\.\d{1,9})$/.test(clock))
    return NaN;
  return toFrames(clock, fps);
}
function constantLevel(level: string, fps: FrameRate): string {
  const match = /^([^=;]+)=(-?\d+(?:\.\d+)?)$/.exec(level);
  return match && effectFrame(match[1], fps) === 0
    ? `0=${Number(match[2])}`
    : "";
}

function matchesFilter(
  doc: XmlDocument,
  node: XmlNode,
  expected: AudioFilter,
  fps: FrameRate,
): boolean {
  if (
    Object.keys(node.attributes).some(
      (key) => !["id", "in", "out"].includes(key),
    )
  )
    return false;
  if (
    effectFrame(node.attributes.in, fps) !== expected.start ||
    effectFrame(node.attributes.out, fps) !== expected.end
  )
    return false;
  // Replacing a stack must not discard native additions, comments or nested metadata.
  if (/<!--|<\?|<!\[CDATA\[/.test(raw(doc, node)) || node.text.trim())
    return false;
  const defaults: Record<string, string> = {
    window: "75",
    max_gain: "20dB",
    channel_mask: "-1",
  };
  const accepted = { ...defaults, ...expected.properties };
  const names = node.children.map((n) => n.attributes.name);
  if (new Set(names).size !== names.length) return false;
  return (
    node.children.every(
      (child) =>
        child.name === "property" &&
        child.children.length === 0 &&
        Object.keys(child.attributes).length === 1 &&
        child.attributes.name !== undefined &&
        accepted[child.attributes.name] ===
          (child.attributes.name === "level"
            ? constantLevel(child.text, fps)
            : child.text),
    ) && Object.keys(expected.properties).every((name) => names.includes(name))
  );
}

/** Undefined means absent or unrecognized; unknown native stacks are never replaced. */
export function inspectAudio(
  doc: XmlDocument,
  clip: Clip,
  fps: FrameRate,
): AudioSettings | undefined {
  const filters = children(clip.node, "filter");
  if (!filters.length) return undefined;
  const settings: AudioSettings = {
    gainDb: 0,
    fadeInFrames: 0,
    fadeOutFrames: 0,
  };
  for (const filter of filters) {
    const kind = property(filter, "kdenlive_id");
    if (kind === "volume") {
      const level = constantLevel(property(filter, "level") ?? "", fps);
      if (!/^0=-?\d+(?:\.\d+)?$/.test(level)) return undefined;
      settings.gainDb = Number(level.slice(2));
    } else if (kind === "fadein")
      settings.fadeInFrames =
        effectFrame(filter.attributes.out, fps) - clip.sourceIn + 1;
    else if (kind === "fadeout")
      settings.fadeOutFrames =
        clip.sourceOut - effectFrame(filter.attributes.in, fps);
    else return undefined;
  }
  if (!validSettings(settings, clip.end - clip.start)) return undefined;
  const expected = filtersFor(clip, settings);
  return expected.length === filters.length &&
    expected.every((f, i) => matchesFilter(doc, filters[i]!, f, fps))
    ? settings
    : undefined;
}

export function requireAudioSource(source: XmlNode): void {
  requireCondition(
    ["chain", "producer"].includes(source.name) &&
      ["avformat", "avformat-novalidate"].includes(
        property(source, "mlt_service") ?? "",
      ) &&
      /^\d+$/.test(property(source, "audio_index") ?? "") &&
      property(source, "video_index") === "-1" &&
      property(source, "set.test_audio") !== "1",
    "UNSUPPORTED_AUDIO",
    "Expected an enabled audio-only file source",
  );
}

function checkAudioSource(model: Model, track: Track, clip: Clip): void {
  requireCondition(
    track.kind === "audio",
    "UNSUPPORTED_AUDIO",
    "Expected an audio track",
  );
  const source = model.doc.ids.get(clip.producerId)!;
  requireAudioSource(source);
  requireCondition(
    source.children.every((n) => n.name === "property") &&
      clip.node.children.every((n) => ["property", "filter"].includes(n.name)),
    "UNSUPPORTED_EFFECT",
    "Source effects, links or unknown entry children are unsupported",
  );
  requireCondition(
    children(clip.node, "filter").length === 0 ||
      inspectAudio(model.doc, clip, model.fps) !== undefined,
    "UNSUPPORTED_EFFECT",
    "Existing effects are not an unchanged managed audio stack",
  );
}

function serializeFilters(model: Model, filters: AudioFilter[]): string {
  let serial = 0;
  return filters
    .map((filter) => {
      while (model.doc.ids.has(`mcp_audio_${serial}`)) serial++;
      const id = `mcp_audio_${serial++}`;
      const properties = Object.entries(filter.properties)
        .map(
          ([name, value]) =>
            `<property name="${escapeXml(name)}">${escapeXml(value)}</property>`,
        )
        .join("\n");
      return `<filter id="${id}" in="${filter.start}" out="${filter.end}">\n${properties}\n</filter>`;
    })
    .join("\n");
}

export function setClipAudio(
  model: Model,
  track: Track,
  operation: SetClipAudio,
): string {
  const clip = track.clips.find((c) => c.id === operation.clipId)!;
  requireCondition(
    validSettings(operation, clip.end - clip.start),
    "INVALID_AUDIO",
    "Invalid audio gain or fade durations",
  );
  checkAudioSource(model, track, clip);
  const filters = serializeFilters(model, filtersFor(clip, operation));
  const patches: Patch[] = children(clip.node, "filter").map((node) => ({
    start: node.start,
    end: node.end,
    text: "",
  }));
  if (!filters && !patches.length) return model.doc.source;
  if (clip.node.selfClosing)
    patches.push({
      start: clip.node.openEnd - 2,
      end: clip.node.openEnd,
      text: `>${filters}</entry>`,
    });
  else
    patches.push({
      start: clip.node.closeStart,
      end: clip.node.closeStart,
      text: filters,
    });
  return patchXml(model.doc.source, patches);
}
