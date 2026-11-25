import assert from "node:assert/strict";
import test from "node:test";
import { applyCollectionBoxAction, collectionBoxView } from "../lib/desktop-collectionbox.ts";
import { createDesktopCredential, parseDesktopCredential } from "../lib/desktop-widget-credential.ts";
import { createEmptyWorkspaceState, workspaceStateSchema } from "../lib/workspace-state-schema.ts";

const ordinaryTool = { id: "tool", title: "工具", status: "常用", kind: "tool", description: "", url: "", version: "", blocks: [] };
const existingIdea = { id: "old", title: "旧想法", note: "保留内容", createdAt: "2026-11-24" };
const initial = () => ({ ...createEmptyWorkspaceState(), tools: [ordinaryTool], ideas: [existingIdea] });

function apply(state, action, id) {
  const result = applyCollectionBoxAction(state, action, id);
  assert.equal(result.status, "applied");
  assert.equal(workspaceStateSchema.safeParse(result.data).success, true);
  return result.data;
}

test("CollectionBox uses website collections and only moves the selected link", () => {
  let data = apply(initial(), { kind: "category", title: "有意思的项目" }, "projects");
  data = apply(data, { kind: "category", title: "好玩的网站" }, "sites");
  data = apply(data, { kind: "save", categoryId: "projects", title: "Demo", url: "example.com/demo", description: "回头看" }, "link");
  assert.equal(applyCollectionBoxAction(data, {
    kind: "save", categoryId: "projects", title: "Duplicate", url: "https://example.com/demo", description: "",
  }, "other").status, "duplicate_url");
  assert.equal(applyCollectionBoxAction(data, {
    kind: "save", categoryId: "sites", title: "Invalid", url: "javascript:alert(1)", description: "",
  }, "invalid").status, "invalid_url");
  const moved = apply(data, {
    kind: "save", categoryId: "sites", fromId: "projects", websiteId: "link",
    title: "Demo", url: "https://example.com/demo", description: "新分类",
  }, "unused");
  const view = collectionBoxView(moved, 42);
  assert.deepEqual(view.categories.map(({ id, websites }) => [id, websites.map((item) => item.id)]), [
    ["projects", []], ["sites", ["link"]],
  ]);
  assert.equal(view.revision, 42);
  assert.strictEqual(moved.tools[0], ordinaryTool);
  assert.strictEqual(moved.ideas, data.ideas);
  const removed = apply(moved, { kind: "remove", categoryId: "sites", websiteId: "link" }, "unused");
  assert.deepEqual(collectionBoxView(removed, 43).categories[1].websites, []);
});

test("Desktop capture prepends to the site's Ideas list and preserves collections", () => {
  const state = apply(initial(), { kind: "category", title: "好玩的网站" }, "sites");
  const next = apply(state, { kind: "idea", title: "试做冰面投影", date: "2026-11-25" }, "new");
  assert.deepEqual(next.ideas, [
    { id: "new", title: "试做冰面投影", note: "", createdAt: "2026-11-25" },
    existingIdea,
  ]);
  assert.strictEqual(next.tools, state.tools);
  assert.equal("ideas" in collectionBoxView(next, 4), false);
});

test("CollectionBox credentials are distinct from task and Yiyan credentials", () => {
  const code = createDesktopCredential("xcp1", "owner");
  assert.equal(parseDesktopCredential(code, "xcp1").accountId, "owner");
  assert.equal(parseDesktopCredential(code, "xdp1"), null);
  assert.equal(parseDesktopCredential(code, "xyp1"), null);
  const credential = createDesktopCredential("xct1", "owner");
  assert.equal(parseDesktopCredential(credential, "xct1").accountId, "owner");
  assert.equal(parseDesktopCredential(credential, "xdt1"), null);
  assert.equal(parseDesktopCredential(credential, "xyt1"), null);
});
