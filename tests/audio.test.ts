import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Project } from "../src/core/project.js";
import { children, parseXml, property, raw } from "../src/core/xml.js";

const fixture = readFileSync(
  new URL("./fixtures/native-26.08.2.kdenlive", import.meta.url),
  "utf8",
);
function splitProject() {
  const project = new Project(fixture);
  project.apply(0, [
    { type: "split_clip", clipId: "playlist2:0", offset: 125 },
  ]);
  return project;
}
const audio = {
  type: "set_clip_audio" as const,
  clipId: "playlist2:1",
  gainDb: -6,
  fadeInFrames: 25,
  fadeOutFrames: 25,
};
function entries(xml: string) {
  return children(parseXml(xml).ids.get("playlist2")!, "entry");
}

describe("clip audio", () => {
  it("sets volume and source-relative fades only on the selected shared-source entry", () => {
    const p = splitProject(),
      before = parseXml(p.xml);
    p.apply(1, [audio]);
    const after = parseXml(p.xml),
      clips = entries(p.xml);
    expect(raw(after, clips[0]!)).toBe(
      raw(before, children(before.ids.get("playlist2")!, "entry")[0]!),
    );
    for (const id of ["chain0", "chain1", "main_bin", "tractor1"])
      expect(raw(after, after.ids.get(id)!)).toBe(
        raw(before, before.ids.get(id)!),
      );
    const effects = children(clips[1]!, "filter");
    expect(effects.map((f) => property(f, "kdenlive_id"))).toEqual([
      "volume",
      "fadein",
      "fadeout",
    ]);
    expect(effects.map((f) => [f.attributes.in, f.attributes.out])).toEqual([
      ["125", "249"],
      ["125", "149"],
      ["225", "249"],
    ]);
    expect(p.info().duration).toBe(250);
    expect(
      p.info().tracks.find((t) => t.id === "tractor1")?.clips[1]?.audio,
    ).toEqual({ gainDb: -6, fadeInFrames: 25, fadeOutFrames: 25 });
  });
  it("reconfigures without stacking effects and can remove all managed effects", () => {
    const p = splitProject();
    p.apply(1, [audio]);
    p.apply(2, [{ ...audio, gainDb: -12, fadeInFrames: 0, fadeOutFrames: 2 }]);
    expect(children(entries(p.xml)[1]!, "filter")).toHaveLength(2);
    p.apply(3, [{ ...audio, gainDb: 0, fadeInFrames: 0, fadeOutFrames: 0 }]);
    expect(children(entries(p.xml)[1]!, "filter")).toHaveLength(0);
  });
  it("can configure another clip while preserving its neighbor's effects", () => {
    const p = splitProject();
    p.apply(1, [audio]);
    const before = parseXml(p.xml),
      neighbor = raw(before, entries(p.xml)[1]!);
    p.apply(2, [{ ...audio, clipId: "playlist2:0", gainDb: -3 }]);
    expect(raw(parseXml(p.xml), entries(p.xml)[1]!)).toBe(neighbor);
  });
  it("supports self-closing entries without losing their attributes", () => {
    const input = fixture.replace(
      /<entry in="00:00:00.000" out="00:00:09.960" producer="chain0">[\s\S]*?<\/entry>/,
      '<entry custom="keep" in="0" out="249" producer="chain0"/>',
    );
    const p = new Project(input);
    p.apply(0, [{ ...audio, clipId: "playlist2:0" }]);
    expect(entries(p.xml)[0]!.attributes.custom).toBe("keep");
    expect(children(entries(p.xml)[0]!, "filter")).toHaveLength(3);
  });
  // Boundaries: zero disables; one-frame fades undefined; touching fades valid; overlap invalid.
  it.each([
    { gainDb: NaN },
    { gainDb: 25 },
    { gainDb: -61 },
    { fadeInFrames: 1 },
    { fadeOutFrames: -1 },
    { fadeInFrames: 0.5 },
    { fadeInFrames: 101, fadeOutFrames: 25 },
  ])("rejects invalid settings %j", (settings) => {
    const p = splitProject(),
      before = p.xml;
    expect(() => p.apply(1, [{ ...audio, ...settings }])).toThrow();
    expect(p.xml).toBe(before);
  });
  it("accepts fades meeting at their half-open boundary", () => {
    const p = splitProject();
    p.apply(1, [{ ...audio, fadeInFrames: 60, fadeOutFrames: 65 }]);
    expect(children(entries(p.xml)[1]!, "filter")).toHaveLength(3);
  });
  it("rejects native effects and unknown additions to managed filters", () => {
    const p = splitProject();
    p.apply(1, [audio]);
    for (const altered of [
      p.xml.replace('name="kdenlive-mcp:audio">1', 'name="other-marker">1'),
      p.xml.replace('name="level">0=-6', 'name="level">0=-6;10=3'),
      p.xml.replace(
        'name="level">0=-6</property>',
        'name="level">0=-6</property><property name="unknown">preserve</property>',
      ),
    ]) {
      const q = new Project(altered);
      expect(() => q.apply(0, [audio])).toThrow(/effect/i);
      expect(q.xml).toBe(altered);
    }
  });
  it("refuses effects on non-audio or disabled-audio sources", () => {
    const p = new Project(
      fixture.replace('name="audio_index">0', 'name="audio_index">-1'),
    );
    expect(() => p.apply(0, [{ ...audio, clipId: "playlist2:0" }])).toThrow(
      /audio/i,
    );
  });
  it("keeps timing edits conservative after audio effects are added", () => {
    const p = splitProject();
    p.apply(1, [audio]);
    const before = p.xml;
    expect(() =>
      p.apply(2, [
        {
          type: "remove_ranges",
          trackId: "tractor1",
          ranges: [{ start: 0, end: 10 }],
        },
      ]),
    ).toThrow(/effect/i);
    expect(p.xml).toBe(before);
  });
});

it("recognizes and reconfigures a native-saved managed stack", () => {
  const xml = readFileSync(
    new URL("./fixtures/native-audio-26.08.2.kdenlive", import.meta.url),
    "utf8",
  );
  const p = new Project(xml);
  expect(
    p.info().tracks.find((t) => t.id === "tractor1")?.clips[1]?.audio,
  ).toEqual({ gainDb: -6, fadeInFrames: 25, fadeOutFrames: 25 });
  p.apply(0, [{ ...audio, gainDb: -12 }]);
  expect(
    p.info().tracks.find((t) => t.id === "tractor1")?.clips[1]?.audio?.gainDb,
  ).toBe(-12);
});
it("does not change XML when disabling already absent audio effects", () => {
  const xml = fixture.replace(
    /<entry in="00:00:00.000" out="00:00:09.960" producer="chain0">[\s\S]*?<\/entry>/,
    '<entry in="0" out="249" producer="chain0"/>',
  );
  const p = new Project(xml);
  p.apply(0, [
    {
      ...audio,
      clipId: "playlist2:0",
      gainDb: 0,
      fadeInFrames: 0,
      fadeOutFrames: 0,
    },
  ]);
  expect(p.xml).toBe(xml);
});
