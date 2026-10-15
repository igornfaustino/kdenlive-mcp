import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Project } from "../src/core/project.js";
import { children, parseXml, property, raw } from "../src/core/xml.js";
const fixture = readFileSync(
  new URL("./fixtures/native-26.08.2.kdenlive", import.meta.url),
  "utf8",
);
const insert = {
  type: "insert_audio_clip" as const,
  trackId: "tractor0",
  sourceId: "chain1",
  at: 25,
  sourceIn: 50,
  sourceOut: 150,
};

describe("music from project bin", () => {
  it("inserts into an empty audio track with a gap without touching narration or bin", () => {
    const p = new Project(fixture),
      before = parseXml(fixture);
    p.apply(0, [insert]);
    const info = p.info(),
      track = info.tracks.find((t) => t.id === "tractor0")!,
      clip = track.clips[0]!;
    expect(clip).toMatchObject({
      start: 25,
      end: 125,
      sourceIn: 50,
      sourceOut: 150,
    });
    expect(info.duration).toBe(250);
    const doc = parseXml(p.xml),
      source = doc.ids.get(clip.producerId)!;
    expect(source.start).toBeLessThan(doc.ids.get("playlist0")!.start);
    expect(property(source, "kdenlive:id")).toBe("4");
    for (const id of ["playlist2", "tractor1", "main_bin", "chain1"])
      expect(raw(doc, doc.ids.get(id)!)).toBe(raw(before, before.ids.get(id)!));
  });
  it("fills a blank while preserving the positions of existing entries", () => {
    const p = new Project(fixture);
    p.apply(0, [{ ...insert, at: 100, sourceIn: 0, sourceOut: 100 }]);
    p.apply(1, [{ ...insert, at: 25, sourceIn: 0, sourceOut: 50 }]);
    expect(
      p
        .info()
        .tracks.find((t) => t.id === "tractor0")!
        .clips.map((c) => [c.start, c.end]),
    ).toEqual([
      [25, 75],
      [100, 200],
    ]);
  });
  it("extends the project when appending later than all tracks", () => {
    const p = new Project(fixture);
    p.apply(0, [{ ...insert, at: 300 }]);
    expect(p.info().duration).toBe(400);
    expect(parseXml(p.xml).ids.get("tractor0")!.attributes.out).toBe("399");
  });
  it.each([{ at: 24 }, { at: 60 }, { at: 124 }])(
    "rejects overlap without changing the project %j",
    (position) => {
      const p = new Project(fixture);
      p.apply(0, [insert]);
      const before = p.xml;
      expect(() => p.apply(1, [{ ...insert, ...position }])).toThrow(
        /overlap|space/i,
      );
      expect(p.xml).toBe(before);
    },
  );
  it.each([
    { sourceIn: 150, sourceOut: 150 },
    { sourceIn: -1 },
    { sourceOut: 251 },
    { sourceId: "chain0" },
    { sourceId: "missing" },
    { trackId: "tractor2" },
  ])("rejects invalid source or target %j", (settings) => {
    const p = new Project(fixture);
    expect(() => p.apply(0, [{ ...insert, ...settings }])).toThrow();
    expect(p.xml).toBe(fixture);
  });
  it("replaces a clip source while retaining duration, placement and unknown entry properties", () => {
    const p = new Project(fixture);
    p.apply(0, [{ type: "split_clip", clipId: "playlist2:0", offset: 100 }]);
    const input = p.xml.replace(
      '<entry in="100"',
      '<entry custom="keep" in="100"',
    );
    const q = new Project(input);
    q.apply(0, [
      {
        type: "replace_audio_clip",
        clipId: "playlist2:1",
        sourceId: "chain1",
        sourceIn: 50,
      },
    ]);
    expect(
      q.info().tracks.find((t) => t.id === "tractor1")!.clips[1],
    ).toMatchObject({ start: 100, end: 250, sourceIn: 50, sourceOut: 200 });
    expect(
      children(parseXml(q.xml).ids.get("playlist2")!, "entry")[1]!.attributes
        .custom,
    ).toBe("keep");
  });
  it("refuses replacement when the media is shorter or the target has effects", () => {
    const p = new Project(fixture);
    expect(() =>
      p.apply(0, [
        {
          type: "replace_audio_clip",
          clipId: "playlist2:0",
          sourceId: "chain1",
          sourceIn: 1,
        },
      ]),
    ).toThrow();
    p.apply(0, [
      {
        type: "set_clip_audio",
        clipId: "playlist2:0",
        gainDb: -6,
        fadeInFrames: 0,
        fadeOutFrames: 0,
      },
    ]);
    expect(() =>
      p.apply(1, [
        {
          type: "replace_audio_clip",
          clipId: "playlist2:0",
          sourceId: "chain1",
          sourceIn: 0,
        },
      ]),
    ).toThrow(/effect/i);
  });
});

it.each([
  [
    "source links",
    fixture.replace(
      '<chain id="chain0" out="00:00:09.960">',
      '<chain id="chain0" out="00:00:09.960"><link><property name="mlt_service">timeremap</property></link>',
    ),
  ],
  [
    "identity comments",
    fixture.replace(
      '<property name="kdenlive:id">4</property>\n  </entry>',
      '<property name="kdenlive:id">4<!--keep--></property>\n  </entry>',
    ),
  ],
])("refuses replacement that discards unknown %s", (_, input) => {
  const project = new Project(input);
  expect(() =>
    project.apply(0, [
      {
        type: "replace_audio_clip",
        clipId: "playlist2:0",
        sourceId: "chain1",
        sourceIn: 0,
      },
    ]),
  ).toThrow();
  expect(project.xml).toBe(input);
});

it("can replace a clip that was just inserted", () => {
  const project = new Project(fixture);
  project.apply(0, [insert]);
  const clip = project.info().tracks.find((t) => t.id === "tractor0")!
    .clips[0]!;
  project.apply(1, [
    {
      type: "replace_audio_clip",
      clipId: clip.id,
      sourceId: "chain1",
      sourceIn: 100,
    },
  ]);
  expect(
    project.info().tracks.find((t) => t.id === "tractor0")!.clips[0],
  ).toMatchObject({ start: 25, end: 125, sourceIn: 100, sourceOut: 200 });
});
