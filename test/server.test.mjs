// node --test test/  : protocol and payload checks for server.mjs (no T3 needed)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { handle } from "../server.mjs";

const call = (name, args) => handle({ id: 1, method: "tools/call", params: { name, arguments: args } });
const page = () => handle({ id: 2, method: "resources/read", params: { uri: "ui://t3-cards/card" } }).contents[0];

test("every tool carries the ui resource and the page is an MCP App", () => {
  const { tools } = handle({ id: 1, method: "tools/list" });
  assert.equal(tools.length, 4);
  for (const t of tools) assert.equal(t._meta.ui.resourceUri, "ui://t3-cards/card");
  assert.equal(page().mimeType, "text/html;profile=mcp-app");
  assert.match(handle({ id: 0, method: "initialize", params: {} }).instructions, /show_document/);
});

test("progress and countdown stay small and inline", () => {
  const p = call("show_progress", { title: "t", steps: [{ label: "a", state: "done" }, { label: "b", state: "blocked" }] });
  assert.equal(p.structuredContent.kind, "progress");
  assert.match(p.content[0].text, /1 of 2/);
  const c = call("show_countdown", { label: "x", minutes: 5 });
  assert.ok(Date.parse(c.structuredContent.until) > Date.now());
  assert.equal(call("show_countdown", { label: "x" }).isError, true);
});

test("a document's text rides in the page, not the tool result", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "t3c-"));
  const f = path.join(dir, "RESULT.md");
  fs.writeFileSync(f, "Landing: branch x y @ 1; check: z -> ok\nVerified:\n- a | b -> c | 01:00\n- UNCHECKED: d | e\n\n# Title\n\nBody </script> text\n");
  const r = call("show_document", { path: f });
  assert.equal(r.structuredContent.markdown, undefined);
  assert.ok(JSON.stringify(r).length < 1000);
  const html = page().text;
  const payloads = JSON.parse(html.match(/<script id="payloads" type="application\/json">(.*?)<\/script>/s)[1]);
  assert.match(payloads[r.structuredContent.id].markdown, /Body <\/script> text/);
  assert.ok(!html.includes("Body </script>"), "a closing script tag in the text is escaped");
});

const hasSips = fs.existsSync("/usr/bin/sips");
test("compare images are downscaled JPEG data and stay out of the result", { skip: !hasSips && "show_compare needs macOS sips" }, () => {
  const png = "/System/Library/CoreServices/CoreTypes.bundle/Contents/Resources/GenericDocumentIcon.icns";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "t3c-"));
  const a = path.join(dir, "a.png");
  fs.copyFileSync(png, a);
  const r = call("show_compare", { before: a, after: a });
  assert.equal(r.isError, undefined, r.content?.[0]?.text);
  assert.equal(r.structuredContent.before, undefined);
  const payloads = JSON.parse(page().text.match(/<script id="payloads" type="application\/json">(.*?)<\/script>/s)[1]);
  assert.match(payloads[r.structuredContent.id].before.src, /^data:image\/jpeg;base64,/);
});
