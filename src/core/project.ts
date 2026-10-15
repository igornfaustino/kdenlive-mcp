import { inspectAudio } from "./audio.js";
import { editBatch, type Operation } from "./editing.js";
import { requireCondition } from "./errors.js";
import { buildModel } from "./model.js";
import { children, parseXml, property } from "./xml.js";

export class Project {
  #xml: string;
  #revision = 0;
  constructor(xml: string) {
    buildModel(parseXml(xml));
    this.#xml = xml;
  }
  get xml(): string {
    return this.#xml;
  }
  get revision(): number {
    return this.#revision;
  }
  info() {
    const model = buildModel(parseXml(this.#xml));
    return {
      revision: this.revision,
      documentVersion: model.version,
      fps: model.fps,
      duration: model.duration,
      sequenceId: model.sequence.attributes.id,
      sequenceCount: model.sequences.length,
      clipHandleScope: "current revision",
      tracks: model.tracks.map((t) => ({
        id: t.id,
        name: t.name,
        kind: t.kind,
        duration: t.duration,
        clips: t.clips.map(({ node, ...clip }) => ({
          ...clip,
          audio: inspectAudio(model.doc, { ...clip, node }, model.fps),
        })),
      })),
      media: model.doc.root.children
        .filter((n) => ["producer", "chain"].includes(n.name))
        .map((n) => ({
          id: n.attributes.id!,
          service: property(n, "mlt_service") ?? "",
          resource: property(n, "resource") ?? "",
          binId: property(n, "kdenlive:id"),
          inProjectBin: children(model.doc.ids.get("main_bin")!, "entry").some(
            (entry) => entry.attributes.producer === n.attributes.id,
          ),
        })),
    };
  }
  apply(expectedRevision: number, operations: Operation[]) {
    requireCondition(
      expectedRevision === this.revision,
      "REVISION_CONFLICT",
      `Expected revision ${this.revision}, received ${expectedRevision}`,
    );
    const candidate = editBatch(this.#xml, operations);
    this.#xml = candidate;
    this.#revision++;
    return this.info();
  }
}
