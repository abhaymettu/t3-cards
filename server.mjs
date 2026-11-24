#!/usr/bin/env node
// t3-cards: an MCP server whose tools draw inline components in T3 Code (desktop and phone) through MCP Apps.
// Every tool carries _meta.ui.resourceUri; T3 snapshots ui://t3-cards/card once per call and hosts it in an iframe.
// Stdio, newline-delimited JSON-RPC, no dependencies.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const URI = "ui://t3-cards/card";
const MIME = "text/html;profile=mcp-app";
const HOME = os.homedir();
const MAX_DOC = 400_000;
const MAX_IMAGE_SIDE = 1200;

// What every session is told about when to draw a card. Claude Code puts a server's instructions in the system prompt.
// A file named instructions.local.md next to this one replaces the default (it is gitignored, for your own wording).
const DEFAULT_INSTRUCTIONS = `t3-cards draws a small interactive card in the T3 Code chat, on the desktop app and the phone app. Use it on your own, without being asked, in exactly these cases:
- You point the user at a markdown file to read (a report, a memo, a write-up, a note): call show_document with its path in the same reply. The file then opens on the phone, which a bare path does not.
- You report work with 3 or more steps that is still running or just finished: show_progress with each step's state.
- A deadline, a wait or a timed run matters to the user (a cutoff, a build's expected end, "back at 08:05"): show_countdown.
- You made before and after stills of a visual change: show_compare with the two image paths.
One card per thing; never a card that repeats what your text already says in full, and never more than two cards in one reply.`;
const LOCAL_INSTRUCTIONS = path.join(HERE, "instructions.local.md");
const INSTRUCTIONS = fs.existsSync(LOCAL_INSTRUCTIONS) ? fs.readFileSync(LOCAL_INSTRUCTIONS, "utf8").trim() : DEFAULT_INSTRUCTIONS;

const UI = { ui: { resourceUri: URI } };
const TOOLS = [
  {
    name: "show_document",
    title: "Show a document",
    description:
      "Draw a readable card for a markdown file in the T3 chat: title, a short preview, and a full reader with reading progress that works on the phone. Use whenever you hand the user a file to read. A file with a `Landing:` line and a `Verified:` list shows them as a checklist.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute path (or ~/...) of a .md or .txt file." },
        markdown: { type: "string", description: "Markdown to show instead of a file." },
        title: { type: "string", description: "Title; defaults to the file's first heading or name." },
      },
    },
    _meta: UI,
  },
  {
    name: "show_progress",
    title: "Show progress",
    description:
      "Draw a progress card: a bar and the steps of a piece of work, each done, active, waiting, blocked or skipped (shown by shape and word, never colour alone). Use for work with 3 or more steps when you report where it stands.",
    inputSchema: {
      type: "object",
      required: ["title", "steps"],
      properties: {
        title: { type: "string" },
        steps: {
          type: "array",
          items: {
            type: "object",
            required: ["label", "state"],
            properties: {
              label: { type: "string" },
              state: { type: "string", enum: ["done", "active", "todo", "blocked", "skipped"] },
              note: { type: "string", description: "One short line: a result, a receipt, or what it waits on." },
            },
          },
        },
        note: { type: "string", description: "One line under the title, e.g. what is next." },
      },
    },
    _meta: UI,
  },
  {
    name: "show_countdown",
    title: "Show a countdown",
    description:
      "Draw a live countdown to a time in the T3 chat (it keeps ticking on the phone). Use when a deadline, a wait or a timed run matters to the user. Give 'until' as an ISO time with offset, or 'minutes' from now.",
    inputSchema: {
      type: "object",
      required: ["label"],
      properties: {
        label: { type: "string", description: "What happens at the time, e.g. 'Install window opens'." },
        until: { type: "string", description: "ISO 8601 time with offset, e.g. 2026-11-23T08:00:00-08:00." },
        minutes: { type: "number", description: "Minutes from now, if no 'until'." },
        since: { type: "string", description: "Optional ISO start, to draw elapsed share of the wait." },
        note: { type: "string" },
      },
    },
    _meta: UI,
  },
  {
    name: "show_compare",
    title: "Compare before and after",
    description:
      "Draw a before and after slider for two stills (PNG or JPEG paths) in the T3 chat. Use whenever you made before and after captures of a visual change.",
    inputSchema: {
      type: "object",
      required: ["before", "after"],
      properties: {
        before: { type: "string" },
        after: { type: "string" },
        title: { type: "string" },
        note: { type: "string" },
      },
    },
    _meta: UI,
  },
];

const expand = (p) => path.resolve(String(p).replace(/^~(?=$|\/)/, HOME));
const shortPath = (p) => (p === HOME || p.startsWith(HOME + "/") ? "~" + p.slice(HOME.length) : p);

function documentCard(args) {
  let text = args.markdown;
  let file;
  if (text === undefined) {
    if (!args.path) throw new Error("Give path or markdown.");
    file = expand(args.path);
    const stat = fs.statSync(file);
    if (!stat.isFile()) throw new Error(`${file} is not a file.`);
    if (stat.size > MAX_DOC) throw new Error(`${file} is ${stat.size} bytes; the card takes up to ${MAX_DOC}.`);
    text = fs.readFileSync(file, "utf8");
  }
  text = text.replace(/^---\n[\s\S]*?\n---\n/, "");
  const heading = text.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const title = args.title ?? heading ?? (file ? path.basename(file).replace(/\.(md|txt)$/i, "") : "Document");
  const words = (text.match(/\S+/g) ?? []).length;
  const data = {
    kind: "document",
    title,
    source: file ? shortPath(file) : undefined,
    modified: file ? fs.statSync(file).mtime.toISOString() : undefined,
    words,
    markdown: text,
  };
  return { data, summary: `Showed "${title}" (${words} words) as a card.` };
}

function progressCard(args) {
  const steps = (args.steps ?? []).map((s) => ({ label: String(s.label), state: String(s.state), note: s.note }));
  if (!steps.length) throw new Error("Give at least one step.");
  const done = steps.filter((s) => s.state === "done" || s.state === "skipped").length;
  return {
    data: { kind: "progress", title: args.title, note: args.note, steps },
    summary: `Showed progress "${args.title}": ${done} of ${steps.length} steps done.`,
  };
}

function countdownCard(args) {
  let until = args.until ? new Date(args.until) : undefined;
  if (!until && typeof args.minutes === "number") until = new Date(Date.now() + args.minutes * 60_000);
  if (!until || Number.isNaN(until.getTime())) throw new Error("Give 'until' (ISO time) or 'minutes'.");
  const since = args.since ? new Date(args.since) : new Date();
  return {
    data: { kind: "countdown", label: args.label, note: args.note, until: until.toISOString(), since: since.toISOString() },
    summary: `Showed a countdown to ${until.toISOString()} (${args.label}).`,
  };
}

function imageData(p) {
  const file = expand(p);
  if (!fs.statSync(file).isFile()) throw new Error(`${file} is not a file.`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "t3-cards-"));
  const out = path.join(tmp, "img.jpg");
  try {
    execFileSync("/usr/bin/sips", ["-Z", String(MAX_IMAGE_SIDE), "-s", "format", "jpeg", "-s", "formatOptions", "78", file, "--out", out], { stdio: "ignore" });
    const dims = execFileSync("/usr/bin/sips", ["-g", "pixelWidth", "-g", "pixelHeight", out], { encoding: "utf8" });
    const w = Number(dims.match(/pixelWidth: (\d+)/)?.[1]);
    const h = Number(dims.match(/pixelHeight: (\d+)/)?.[1]);
    return { src: "data:image/jpeg;base64," + fs.readFileSync(out).toString("base64"), w, h, name: shortPath(file) };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function compareCard(args) {
  return {
    data: { kind: "compare", title: args.title, note: args.note, before: imageData(args.before), after: imageData(args.after) },
    summary: `Showed a before and after slider${args.title ? ` for ${args.title}` : ""}.`,
  };
}

const HANDLERS = { show_document: documentCard, show_progress: progressCard, show_countdown: countdownCard, show_compare: compareCard };

// Heavy parts (a document's text, images) never go in the tool result: Claude Code counts structuredContent against its
// output cap and shows it to the model. They wait here, keyed by card id, and go into the page T3 snapshots: T3 reads
// the resource right after each call, so the snapshot carries its own data and keeps working after the session ends.
const HEAVY = { document: ["markdown"], compare: ["before", "after"] };
const PAYLOAD_TTL_MS = 10 * 60_000;
const PAYLOAD_MAX_BYTES = 4_000_000;
const payloads = new Map(); // id -> { at, data }

function stash(data) {
  const id = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const heavy = HEAVY[data.kind] ?? [];
  const light = { ...data, id };
  const rest = {};
  for (const key of heavy) { rest[key] = data[key]; delete light[key]; }
  if (heavy.length) payloads.set(id, { at: Date.now(), data: rest });
  return light;
}

function widgetHtml() {
  const html = fs.readFileSync(path.join(HERE, "widget.html"), "utf8");
  const now = Date.now();
  const recent = {};
  let bytes = 0;
  for (const [id, p] of [...payloads].reverse()) {
    if (now - p.at > PAYLOAD_TTL_MS) { payloads.delete(id); continue; }
    const size = JSON.stringify(p.data).length;
    if (bytes + size > PAYLOAD_MAX_BYTES) continue;
    recent[id] = p.data;
    bytes += size;
  }
  const json = JSON.stringify(recent).replace(/</g, "\\u003c");
  return html.replace("<!--T3CARDS_PAYLOADS-->", `<script id="payloads" type="application/json">${json}</script>`);
}

export function handle(msg) {
  const { id, method, params } = msg;
  switch (method) {
    case "initialize":
      return {
        protocolVersion: params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: "t3-cards", version: "0.1.0" },
        instructions: INSTRUCTIONS,
      };
    case "ping":
      return {};
    case "tools/list":
      return { tools: TOOLS };
    case "resources/list":
      return { resources: [{ uri: URI, name: "t3-cards card", mimeType: MIME }] };
    case "resources/templates/list":
      return { resourceTemplates: [] };
    case "resources/read":
      if (params?.uri !== URI) throw Object.assign(new Error(`Unknown resource ${params?.uri}`), { code: -32002 });
      return { contents: [{ uri: URI, mimeType: MIME, text: widgetHtml(), _meta: { ui: { prefersBorder: false } } }] };
    case "tools/call": {
      const fn = HANDLERS[params?.name];
      if (!fn) throw Object.assign(new Error(`Unknown tool ${params?.name}`), { code: -32602 });
      try {
        const { data, summary } = fn(params.arguments ?? {});
        return { content: [{ type: "text", text: summary }], structuredContent: stash(data) };
      } catch (error) {
        return { content: [{ type: "text", text: String(error.message ?? error) }], isError: true };
      }
    }
    default:
      if (id === undefined) return undefined;
      throw Object.assign(new Error(`Method not found: ${method}`), { code: -32601 });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  let buffer = "";
  const send = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
        continue;
      }
      if (msg.id === undefined) continue; // notifications
      try {
        send({ jsonrpc: "2.0", id: msg.id, result: handle(msg) });
      } catch (error) {
        send({ jsonrpc: "2.0", id: msg.id, error: { code: error.code ?? -32603, message: String(error.message ?? error) } });
      }
    }
  });
}
