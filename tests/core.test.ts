import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Project } from "../src/core/project.js";
import { parseXml, raw } from "../src/core/xml.js";
import { toFrames } from "../src/core/time.js";

export const fixture = readFileSync(
  new URL("./fixtures/native-26.08.2.kdenlive", import.meta.url),
  "utf8",
);

describe("native project preservation", () => {
  it("inspects four tracks, rational FPS, native clip IDs and retains every byte", () => {
    const p = new Project(fixture);
    expect(p.xml).toBe(fixture);
    expect(p.info().fps).toEqual({ numerator: 25, denominator: 1 });
    expect(p.info().tracks).toHaveLength(4);
    expect(
      p.info().tracks.find((t) => t.id === "tractor1")?.clips[0],
    ).toMatchObject({
      id: "playlist2:0",
      producerId: "chain0",
      start: 0,
      end: 250,
      sourceIn: 0,
      sourceOut: 250,
    });
    expect(p.info().duration).toBe(250);
  });

  it("removes three disjoint ranges without rebuilding unrelated XML", () => {
    const p = new Project(fixture);
    const original = parseXml(fixture);
    p.apply(0, [
      {
        type: "remove_ranges",
        trackId: "tractor1",
        ranges: [
          { start: 25, end: 50 },
          { start: 100, end: 125 },
          { start: 175, end: 200 },
        ],
      },
    ]);
    expect(p.revision).toBe(1);
    expect(p.info().duration).toBe(175);
    expect(
      p
        .info()
        .tracks.find((t) => t.id === "tractor1")
        ?.clips.map((c) => [c.start, c.end, c.sourceIn, c.sourceOut]),
    ).toEqual([
      [0, 25, 0, 25],
      [25, 75, 50, 100],
      [75, 125, 125, 175],
      [125, 175, 200, 250],
    ]);
    const edited = parseXml(p.xml);
    for (const id of [
      "producer0",
      "chain0",
      "chain1",
      "playlist0",
      "playlist1",
      "playlist4",
      "playlist5",
      "playlist6",
      "playlist7",
      "tractor0",
      "tractor2",
      "tractor3",
      "main_bin",
    ]) {
      expect(raw(edited, edited.ids.get(id)!)).toBe(
        raw(original, original.ids.get(id)!),
      );
    }
    const beforeEffects = original.nodes
      .filter((n) => ["filter", "transition"].includes(n.name))
      .map((n) => raw(original, n));
    expect(
      edited.nodes
        .filter((n) => ["filter", "transition"].includes(n.name))
        .map((n) => raw(edited, n)),
    ).toEqual(beforeEffects);
  });

  it("splits without altering total duration or source media", () => {
    const p = new Project(fixture);
    p.apply(0, [{ type: "split_clip", clipId: "playlist2:0", offset: 100 }]);
    expect(p.info().duration).toBe(250);
    expect(
      p
        .info()
        .tracks.find((t) => t.id === "tractor1")
        ?.clips.map((c) => [c.sourceIn, c.sourceOut]),
    ).toEqual([
      [0, 100],
      [100, 250],
    ]);
  });

  it("rolls back the entire batch if a later operation fails", () => {
    const p = new Project(fixture);
    expect(() =>
      p.apply(0, [
        { type: "split_clip", clipId: "playlist2:0", offset: 100 },
        {
          type: "remove_ranges",
          trackId: "missing",
          ranges: [{ start: 0, end: 5 }],
        },
      ]),
    ).toThrow();
    expect(p.xml).toBe(fixture);
    expect(p.revision).toBe(0);
  });

  it("rejects stale revisions and reused track targets within a batch", () => {
    const p = new Project(fixture);
    expect(() => p.apply(1, [])).toThrow(/revision/i);
    expect(() =>
      p.apply(0, [
        { type: "split_clip", clipId: "playlist2:0", offset: 100 },
        { type: "split_clip", clipId: "playlist2:0", offset: 50 },
      ]),
    ).toThrow(/once/i);
  });

  it.each(
    [
      [{ start: 10, end: 10 }],
      [{ start: -1, end: 4 }],
      [{ start: 0, end: 251 }],
      [
        { start: 0, end: 25 },
        { start: 20, end: 30 },
      ],
      [{ start: 0.5, end: 4 }],
      [{ start: 0, end: 250 }],
    ].map((ranges) => ({ ranges })),
  )("rejects invalid or unsupported ranges $ranges", ({ ranges }) => {
    const p = new Project(fixture);
    expect(() =>
      p.apply(0, [{ type: "remove_ranges", trackId: "tractor1", ranges }]),
    ).toThrow();
    expect(p.xml).toBe(fixture);
  });

  it("rejects malformed XML, duplicate IDs, DTDs and dangling producer references", () => {
    expect(() => new Project("<mlt><profile></mlt>")).toThrow();
    expect(
      () => new Project(fixture.replace('id="playlist0"', 'id="playlist1"')),
    ).toThrow(/duplicate/i);
    expect(
      () =>
        new Project(
          '<!DOCTYPE mlt [<!ENTITY x SYSTEM "file:///etc/passwd">]>' + fixture,
        ),
    ).toThrow(/DTD/i);
    expect(
      () =>
        new Project(fixture.replace('producer="chain0"', 'producer="missing"')),
    ).toThrow(/reference/i);
  });

  it("refuses mutation of unknown versions and grouped clips", () => {
    const future = fixture.replace(
      'name="kdenlive:docproperties.version">1.1',
      'name="kdenlive:docproperties.version">9.0',
    );
    expect(() =>
      new Project(future).apply(0, [
        { type: "split_clip", clipId: "playlist2:0", offset: 100 },
      ]),
    ).toThrow(/version/i);
    const grouped = fixture.replace(
      'name="kdenlive:sequenceproperties.groups">[\n]',
      'name="kdenlive:sequenceproperties.groups">[{"type":"AVSplit"}]',
    );
    expect(() =>
      new Project(grouped).apply(0, [
        { type: "split_clip", clipId: "playlist2:0", offset: 100 },
      ]),
    ).toThrow(/group/i);
  });

  it("preserves comments, entities, CDATA and Unicode around an edit", () => {
    const extra =
      '<!-- 🦊 <entry/> --><property name="future">A &amp; B</property><property name="opaque"><![CDATA[<xml> 🦊]]></property>';
    const p = new Project(
      fixture.replace(
        '<playlist id="playlist2">',
        '<playlist id="playlist2">' + extra,
      ),
    );
    p.apply(0, [{ type: "split_clip", clipId: "playlist2:0", offset: 100 }]);
    expect(p.xml).toContain(extra);
  });
  it("does not mistake attribute-like text inside a quoted value for an attribute", () => {
    const p = new Project(
      fixture.replace("<entry in=", "<entry custom=\" out='249'\" in="),
    );
    p.apply(0, [{ type: "split_clip", clipId: "playlist2:0", offset: 100 }]);
    expect(p.info().duration).toBe(250);
    expect(p.xml.match(/custom=" out='249'"/g)).toHaveLength(2);
    expect(
      p
        .info()
        .tracks.find((t) => t.id === "tractor1")
        ?.clips.map((c) => [c.sourceIn, c.sourceOut]),
    ).toEqual([
      [0, 100],
      [100, 250],
    ]);
  });
  it.each([
    [
      '<track producer="tractor1"/>',
      '<track producer="tractor1" in="25" out="249"/>',
    ],
    [
      '<track hide="video" producer="playlist2"/>',
      '<track hide="video" producer="playlist2" in="25"/>',
    ],
    [
      '<tractor id="tractor1" in="00:00:00.000"',
      '<tractor id="tractor1" in="25"',
    ],
  ])(
    "rejects timing restrictions that are not modeled: %s",
    (before, after) => {
      const input = fixture.replace(before, after);
      expect(input).not.toBe(fixture);
      const p = new Project(input);
      expect(() =>
        p.apply(0, [
          {
            type: "remove_ranges",
            trackId: "tractor1",
            ranges: [{ start: 0, end: 25 }],
          },
        ]),
      ).toThrow(/timing|trim/i);
      expect(p.xml).toBe(input);
    },
  );
});

describe("frame arithmetic", () => {
  it("handles fractional FPS without float accumulation", () => {
    expect(
      toFrames("00:00:01.001", { numerator: 30000, denominator: 1001 }),
    ).toBe(30);
    expect(
      toFrames("01:00:00.000", { numerator: 30000, denominator: 1001 }),
    ).toBe(107892);
    expect(toFrames("249", { numerator: 25, denominator: 1 })).toBe(249);
    expect(toFrames("00:00:09.960", { numerator: 25, denominator: 1 })).toBe(
      249,
    );
  });
  it.each(["-1", "00:00:01:12", "NaN", "1.5", "00:99:00.000"])(
    "rejects unsupported time %s",
    (value) => {
      expect(() =>
        toFrames(value, { numerator: 25, denominator: 1 }),
      ).toThrow();
    },
  );
});

describe("timeline boundaries", () => {
  it("keeps another populated track and its duration unchanged", () => {
    const input = fixture.replace(
      '<playlist id="playlist4"/>',
      '<playlist id="playlist4"><entry producer="chain0" in="0" out="249"/></playlist>',
    );
    const p = new Project(input),
      before = parseXml(input);
    p.apply(0, [
      {
        type: "remove_ranges",
        trackId: "tractor1",
        ranges: [
          { start: 0, end: 25 },
          { start: 225, end: 250 },
        ],
      },
    ]);
    expect(p.info().duration).toBe(250);
    expect(p.info().tracks.find((t) => t.id === "tractor1")?.duration).toBe(
      200,
    );
    const after = parseXml(p.xml);
    expect(raw(after, after.ids.get("playlist4")!)).toBe(
      raw(before, before.ids.get("playlist4")!),
    );
    expect(raw(after, after.ids.get("tractor2")!)).toBe(
      raw(before, before.ids.get("tractor2")!),
    );
  });
  it("removes a range spanning a blank and a clip", () => {
    const input = fixture.replace(
      '<playlist id="playlist2">',
      '<playlist id="playlist2"><blank length="25"/>',
    );
    const p = new Project(input);
    p.apply(0, [
      {
        type: "remove_ranges",
        trackId: "tractor1",
        ranges: [{ start: 10, end: 50 }],
      },
    ]);
    expect(p.info().duration).toBe(235);
    expect(
      p.info().tracks.find((t) => t.id === "tractor1")?.clips[0],
    ).toMatchObject({ start: 10, end: 235, sourceIn: 25, sourceOut: 250 });
  });
  it("refuses sequence sources whose timing is not represented by a track", () => {
    const input = fixture.replace(
      '<track producer="tractor1"/>',
      '<track producer="tractor1"/><track producer="chain0"/>',
    );
    const p = new Project(input);
    expect(() =>
      p.apply(0, [{ type: "split_clip", clipId: "playlist2:0", offset: 100 }]),
    ).toThrow(/layout|source/i);
    expect(p.xml).toBe(input);
  });
});
