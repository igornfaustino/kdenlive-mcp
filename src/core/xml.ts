import { SaxesParser } from "saxes";
import { ProjectError, requireCondition } from "./errors.js";

export interface XmlNode {
  name: string;
  attributes: Record<string, string>;
  children: XmlNode[];
  text: string;
  start: number;
  openEnd: number;
  closeStart: number;
  end: number;
  selfClosing: boolean;
}
export interface XmlDocument {
  source: string;
  root: XmlNode;
  nodes: XmlNode[];
  ids: Map<string, XmlNode>;
}
export interface Patch {
  start: number;
  end: number;
  text: string;
}

export function parseXml(source: string): XmlDocument {
  requireCondition(
    !/<!DOCTYPE/i.test(source),
    "UNSAFE_XML",
    "DTD declarations are forbidden",
  );
  const parser = new SaxesParser({ xmlns: false, position: true });
  const stack: XmlNode[] = [];
  const nodes: XmlNode[] = [];
  const ids = new Map<string, XmlNode>();
  let start = 0;
  parser.on("error", (error) => {
    throw new ProjectError("INVALID_XML", error.message);
  });
  parser.on("opentagstart", () => {
    start = source.lastIndexOf("<", parser.position - 1);
  });
  parser.on("opentag", (tag) => {
    requireCondition(
      stack.length < 128 && nodes.length < 200_000,
      "XML_LIMIT",
      "XML complexity limit exceeded",
    );
    const node: XmlNode = {
      name: tag.name,
      attributes: { ...tag.attributes },
      children: [],
      text: "",
      start,
      openEnd: parser.position,
      closeStart: parser.position,
      end: parser.position,
      selfClosing: tag.isSelfClosing,
    };
    stack.at(-1)?.children.push(node);
    nodes.push(node);
    stack.push(node);
    const id = node.attributes.id;
    if (id) {
      requireCondition(!ids.has(id), "DUPLICATE_ID", `Duplicate XML id: ${id}`);
      ids.set(id, node);
    }
  });
  const text = (value: string) => {
    if (stack.length) stack.at(-1)!.text += value;
  };
  parser.on("text", text);
  parser.on("cdata", text);
  parser.on("closetag", () => {
    const node = stack.pop()!;
    node.end = parser.position;
    node.closeStart = node.selfClosing
      ? node.openEnd
      : source.lastIndexOf("</", node.end - 1);
  });
  parser.write(source).close();
  const root = nodes[0];
  requireCondition(
    root?.name === "mlt",
    "INVALID_PROJECT",
    "Expected an MLT document",
  );
  for (const node of nodes) {
    if (["entry", "track"].includes(node.name)) {
      requireCondition(
        node.attributes.producer && ids.has(node.attributes.producer),
        "BROKEN_REFERENCE",
        `Broken producer reference: ${node.attributes.producer}`,
      );
    }
  }
  return { source, root, nodes, ids };
}

export function children(node: XmlNode, name: string): XmlNode[] {
  return node.children.filter((n) => n.name === name);
}
export function property(node: XmlNode, name: string): string | undefined {
  const matches = children(node, "property").filter(
    (p) => p.attributes.name === name,
  );
  requireCondition(
    matches.length <= 1,
    "AMBIGUOUS_PROPERTY",
    `Duplicate property: ${name}`,
  );
  return matches[0]?.text;
}
export function raw(doc: XmlDocument, node: XmlNode): string {
  return doc.source.slice(node.start, node.end);
}
export function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
export function attributePatch(
  doc: XmlDocument,
  node: XmlNode,
  name: string,
  value: string,
): Patch {
  const opening = doc.source.slice(node.start, node.openEnd);
  // Consume each complete quoted value before considering the next attribute.
  const attributes = /(\s+([^\s=/>]+)\s*=\s*)(["'])([\s\S]*?)\3/g;
  for (const found of opening.matchAll(attributes)) {
    if (found[2] !== name) continue;
    const start = node.start + found.index + found[1]!.length + 1;
    return { start, end: start + found[4]!.length, text: escapeXml(value) };
  }
  const start = node.openEnd - (node.selfClosing ? 2 : 1);
  return { start, end: start, text: ` ${name}="${escapeXml(value)}"` };
}
export function patchXml(source: string, patches: Patch[]): string {
  const sorted = [...patches].sort((a, b) => a.start - b.start);
  let cursor = 0;
  const parts: string[] = [];
  for (const patch of sorted) {
    requireCondition(
      patch.start >= cursor &&
        patch.end >= patch.start &&
        patch.end <= source.length,
      "OVERLAPPING_PATCH",
      "Invalid or overlapping XML patches",
    );
    parts.push(source.slice(cursor, patch.start), patch.text);
    cursor = patch.end;
  }
  return parts.join("") + source.slice(cursor);
}
