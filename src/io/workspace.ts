import { createHash, randomUUID } from "node:crypto";
import { link, open, realpath, stat, unlink } from "node:fs/promises";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import type { Operation } from "../core/editing.js";
import { ProjectError, requireCondition } from "../core/errors.js";
import { Project } from "../core/project.js";
import { parseXml } from "../core/xml.js";

interface Session {
  project: Project;
  source: string;
  digest: string;
  busy: boolean;
}
interface MediaStatus {
  id: string;
  resource: string;
  status: "present" | "missing" | "forbidden" | "generated" | "unsupported";
  path?: string;
}
const MAX_BYTES = 16 * 1024 * 1024;
const digest = (data: Uint8Array) =>
  createHash("sha256").update(data).digest("hex");

export class Workspace {
  #sessions = new Map<string, Session>();
  private constructor(
    private readonly roots: string[],
    private readonly aliases: string[],
  ) {}
  static async create(roots: string[]): Promise<Workspace> {
    requireCondition(
      roots.length > 0,
      "NO_ROOTS",
      "At least one allowed root is required",
    );
    const canonical = await Promise.all(
      roots.map(async (root) => {
        requireCondition(
          isAbsolute(root),
          "INVALID_ROOT",
          "Allowed roots must be absolute",
        );
        const path = await realpath(root);
        requireCondition(
          (await stat(path)).isDirectory(),
          "INVALID_ROOT",
          "Allowed root must be a directory",
        );
        return path;
      }),
    );
    return new Workspace(
      canonical,
      roots.map((root) => resolve(root)),
    );
  }
  private checkRoot(path: string, allowAliases = false): void {
    requireCondition(
      (allowAliases ? [...this.roots, ...this.aliases] : this.roots).some(
        (root) => {
          const rel = relative(root, path);
          return (
            !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`)
          );
        },
      ),
      "FORBIDDEN_PATH",
      "Path is outside allowed roots",
    );
  }
  private async existing(path: string): Promise<string> {
    const absolute = resolve(path);
    this.checkRoot(absolute, true);
    const canonical = await realpath(absolute);
    this.checkRoot(canonical);
    return canonical;
  }
  private session(id: string): Session {
    const session = this.#sessions.get(id);
    requireCondition(session, "UNKNOWN_SESSION", "Unknown or closed session");
    return session;
  }
  private async readProject(path: string): Promise<Buffer> {
    const handle = await open(path, "r");
    try {
      const info = await handle.stat();
      requireCondition(
        info.isFile() && info.size <= MAX_BYTES,
        "INPUT_LIMIT",
        "Project must be a regular file no larger than 16 MiB",
      );
      // Read at most one byte beyond the limit, even if the file grows after stat.
      const data = Buffer.alloc(Math.min(info.size + 1, MAX_BYTES + 1));
      let size = 0;
      while (size < data.length) {
        const result = await handle.read(data, size, data.length - size, null);
        if (result.bytesRead === 0) break;
        size += result.bytesRead;
      }
      requireCondition(
        size <= MAX_BYTES && size === info.size,
        "INPUT_CHANGED",
        "Project changed while being read",
      );
      return data.subarray(0, size);
    } finally {
      await handle.close();
    }
  }
  async open(path: string) {
    requireCondition(
      this.#sessions.size < 32,
      "SESSION_LIMIT",
      "Close a session before opening another (limit 32)",
    );
    requireCondition(
      extname(path) === ".kdenlive",
      "INVALID_EXTENSION",
      "Expected a .kdenlive project",
    );
    const source = await this.existing(path);
    const data = await this.readProject(source);
    let xml: string;
    try {
      xml = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        data,
      );
    } catch {
      throw new ProjectError("INVALID_ENCODING", "Project must be valid UTF-8");
    }
    requireCondition(
      !/<\?xml[^?]*encoding\s*=\s*["'](?!utf-8["'])/i.test(xml),
      "INVALID_ENCODING",
      "Only UTF-8 XML is supported",
    );
    const project = new Project(xml),
      sessionId = randomUUID();
    requireCondition(
      this.#sessions.size < 32,
      "SESSION_LIMIT",
      "Too many concurrent opens",
    );
    this.#sessions.set(sessionId, {
      project,
      source,
      digest: digest(data),
      busy: false,
    });
    return { sessionId, ...project.info() };
  }
  info(id: string) {
    return { sessionId: id, ...this.session(id).project.info() };
  }
  apply(id: string, revision: number, operations: Operation[]) {
    const session = this.session(id);
    requireCondition(!session.busy, "SESSION_BUSY", "Session is saving");
    return { sessionId: id, ...session.project.apply(revision, operations) };
  }
  close(id: string) {
    requireCondition(
      !this.session(id).busy,
      "SESSION_BUSY",
      "Session is saving",
    );
    this.#sessions.delete(id);
    return { closed: true };
  }
  async validate(id: string) {
    const session = this.session(id),
      info = session.project.info();
    const doc = parseXml(session.project.xml);
    const root = resolve(
      dirname(session.source),
      doc.root.attributes.root || ".",
    );
    const media: MediaStatus[] = [];
    for (const item of info.media) {
      if (["color", "colour", "blank", "blipflash"].includes(item.service)) {
        media.push({
          id: item.id,
          resource: item.resource,
          status: "generated",
        });
        continue;
      }
      const remote =
        /^[a-z][a-z\d+.-]*:/i.test(item.resource) && !isAbsolute(item.resource);
      const ambiguousRoot =
        !isAbsolute(item.resource) &&
        !isAbsolute(doc.root.attributes.root ?? "");
      if (
        !["avformat", "avformat-novalidate", "qimage", "pixbuf"].includes(
          item.service,
        ) ||
        remote ||
        ambiguousRoot
      ) {
        media.push({
          id: item.id,
          resource: item.resource,
          status: "unsupported",
        });
        continue;
      }
      const path = resolve(root, item.resource);
      try {
        const canonical = await this.existing(path);
        requireCondition(
          (await stat(canonical)).isFile(),
          "INVALID_MEDIA",
          "Media is not a regular file",
        );
        media.push({
          id: item.id,
          resource: item.resource,
          status: "present",
          path: canonical,
        });
      } catch (error) {
        if (error instanceof ProjectError && error.code === "FORBIDDEN_PATH")
          media.push({
            id: item.id,
            resource: item.resource,
            status: "forbidden",
          });
        else if ((error as NodeJS.ErrnoException).code === "ENOENT")
          media.push({
            id: item.id,
            resource: item.resource,
            status: "missing",
            path,
          });
        else throw error;
      }
    }
    return {
      valid: media.every(
        (m) => m.status === "present" || m.status === "generated",
      ),
      media,
      documentVersion: info.documentVersion,
      editorCompatibility:
        "Requires native acceptance; XML validation alone is insufficient",
    };
  }
  private async unchanged(session: Session): Promise<void> {
    const source = await this.existing(session.source);
    requireCondition(
      source === session.source &&
        digest(await this.readProject(source)) === session.digest,
      "EXTERNAL_CHANGE",
      "Source project changed externally; reopen it",
    );
  }
  async saveAs(id: string, revision: number, output: string) {
    const session = this.session(id);
    requireCondition(!session.busy, "SESSION_BUSY", "Session is saving");
    requireCondition(
      revision === session.project.revision,
      "REVISION_CONFLICT",
      "Save revision does not match current revision",
    );
    const requested = resolve(output);
    this.checkRoot(requested, true);
    requireCondition(
      extname(requested) === ".kdenlive",
      "INVALID_EXTENSION",
      "Output must end in .kdenlive",
    );
    session.busy = true;
    let temporary: string | undefined;
    try {
      const parent = await this.existing(dirname(requested));
      const target = resolve(parent, basename(requested));
      requireCondition(
        target !== session.source,
        "OVERWRITE_ORIGINAL",
        "Never overwrite the original project",
      );
      requireCondition(
        parent === dirname(session.source),
        "RELATIVE_MEDIA",
        "Save a sibling file to preserve relative media paths",
      );
      await this.unchanged(session);
      requireCondition(
        (await this.validate(id)).valid,
        "INVALID_MEDIA",
        "Resolve missing, forbidden or unsupported media before saving",
      );
      temporary = resolve(parent, `.kdenlive-mcp-${randomUUID()}.tmp`);
      const file = await open(temporary, "wx", 0o600);
      try {
        await file.writeFile(session.project.xml, "utf8");
        await file.sync();
      } finally {
        await file.close();
      }
      await this.unchanged(session);
      // A hard link publishes a complete file atomically and refuses any existing target.
      await link(temporary, target);
      return {
        path: target,
        revision,
        bytes: Buffer.byteLength(session.project.xml),
        sourcePreserved: true,
      };
    } finally {
      session.busy = false;
      if (temporary)
        await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        });
    }
  }
}
