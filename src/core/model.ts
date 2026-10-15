import { requireCondition } from "./errors.js";
import { frame, toFrames, type FrameRate } from "./time.js";
import { children, property, type XmlDocument, type XmlNode } from "./xml.js";

export interface Clip {
  id: string;
  producerId: string;
  start: number;
  end: number;
  sourceIn: number;
  sourceOut: number;
  node: XmlNode;
}
export interface Segment {
  start: number;
  end: number;
  node: XmlNode;
  clip?: Clip;
}
export interface Track {
  id: string;
  name: string;
  kind: "audio" | "video";
  node: XmlNode;
  playlists: XmlNode[];
  clips: Clip[];
  duration: number;
}
export interface Model {
  doc: XmlDocument;
  fps: FrameRate;
  version: string;
  sequence: XmlNode;
  tracks: Track[];
  duration: number;
  sequences: XmlNode[];
}

export function segments(playlist: XmlNode, fps: FrameRate): Segment[] {
  let position = 0,
    index = 0;
  return playlist.children
    .filter((n) => ["entry", "blank"].includes(n.name))
    .map((node) => {
      const start = position;
      if (node.name === "blank") {
        position = frame(
          position + toFrames(node.attributes.length ?? "", fps),
        );
        return { start, end: position, node };
      }
      const sourceIn = toFrames(node.attributes.in ?? "0", fps);
      const sourceOut = toFrames(node.attributes.out ?? "", fps) + 1;
      requireCondition(
        sourceOut > sourceIn,
        "INVALID_CLIP",
        "Clip out must not precede in",
      );
      position = frame(position + sourceOut - sourceIn);
      const clip = {
        id: `${playlist.attributes.id}:${index++}`,
        producerId: node.attributes.producer!,
        start,
        end: position,
        sourceIn,
        sourceOut,
        node,
      };
      return { start, end: position, node, clip };
    });
}

export function buildModel(doc: XmlDocument): Model {
  const profile = children(doc.root, "profile")[0];
  requireCondition(profile, "INVALID_PROJECT", "Project profile is missing");
  const fps = {
    numerator: Number(profile.attributes.frame_rate_num),
    denominator: Number(profile.attributes.frame_rate_den),
  };
  toFrames("0", fps);
  const bin = doc.ids.get("main_bin");
  requireCondition(bin, "INVALID_PROJECT", "Kdenlive main_bin is missing");
  const version = property(bin, "kdenlive:docproperties.version") ?? "unknown";
  const sequences = children(doc.root, "tractor").filter(
    (n) => property(n, "kdenlive:uuid") !== undefined,
  );
  requireCondition(
    sequences.length > 0,
    "UNSUPPORTED_LAYOUT",
    "No supported Kdenlive sequence found",
  );
  const wrapper = children(doc.root, "tractor").find(
    (n) => property(n, "kdenlive:projectTractor") === "1",
  );
  const activeId =
    wrapper && children(wrapper, "track")[0]?.attributes.producer;
  const sequence =
    sequences.find((n) => n.attributes.id === activeId) ?? sequences[0]!;
  const tracks: Track[] = [];
  for (const ref of children(sequence, "track")) {
    const node = doc.ids.get(ref.attributes.producer!)!;
    if (node.name !== "tractor") continue;
    const playlists = children(node, "track")
      .map((t) => doc.ids.get(t.attributes.producer!)!)
      .filter((n) => n.name === "playlist");
    const all = playlists.flatMap((p) => segments(p, fps));
    tracks.push({
      id: node.attributes.id!,
      name: property(node, "kdenlive:track_name") ?? node.attributes.id!,
      kind: property(node, "kdenlive:audio_track") === "1" ? "audio" : "video",
      node,
      playlists,
      clips: all.flatMap((s) => (s.clip ? [s.clip] : [])),
      duration: Math.max(0, ...all.map((s) => s.end)),
    });
  }
  return {
    doc,
    fps,
    version,
    sequence,
    sequences,
    tracks,
    duration: Math.max(0, ...tracks.map((t) => t.duration)),
  };
}
