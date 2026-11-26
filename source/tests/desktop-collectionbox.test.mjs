import assert from "node:assert/strict";
import test from "node:test";
import { applyCollectionBoxAction, collectionBoxView } from "../lib/desktop-collectionbox.ts";
import { createDesktopCredential, parseDesktopCredential } from "../lib/desktop-widget-credential.ts";
import { applyIdeaPoolAction, ideaSections } from "../lib/idea-pool.ts";
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

test("Legacy desktop capture and old notes still work with the shared idea pool", () => {
  const state = apply(initial(), { kind: "category", title: "好玩的网站" }, "sites");
  const next = apply(state, { kind: "idea", title: "试做冰面投影", date: "2026-11-25" }, "new");
  assert.deepEqual(next.ideas, [
    { id: "new", title: "试做冰面投影", note: "", createdAt: "2026-11-25" },
    existingIdea,
  ]);
  assert.strictEqual(next.tools, state.tools);
  assert.deepEqual(collectionBoxView(next, 4).ideaPool, { ideas: next.ideas, groups: [] });
  assert.deepEqual(ideaSections(next)[0].ideas, next.ideas);
});

test("Web groups and desktop idea edits share a workspace and survive persistence", () => {
  let data = initial();
  function web(action, id = "unused") {
    const next = applyIdeaPoolAction(data, action, id);
    assert.equal(next.status, "applied");
    data = next.data;
  }
  web({ kind: "saveIdeaGroup", title: "技术探索" }, "tech");
  web({ kind: "saveIdeaGroup", title: "兴趣爱好" }, "interest");
  web({ kind: "saveIdeaGroup", groupId: "tech", title: "技术项目" });
  const details = { title: "试试新工具", note: "先看文档\n再试一下", date: "2026-11-26", groupId: "tech", links: ["example.com/docs", "https://example.com/docs"] };
  web({ kind: "saveIdea", ...details }, "web-idea");
  data = apply(data, { kind: "saveIdea", ...details, title: "桌面新增" }, "desktop-idea");
  assert.deepEqual(collectionBoxView(data, 3).ideaPool.groups, [{ id: "tech", title: "技术项目" }, { id: "interest", title: "兴趣爱好" }]);
  assert.deepEqual(ideaSections(data)[0].ideas.map(({ id }) => id), ["desktop-idea", "web-idea"]);
  web({ kind: "moveIdea", ideaId: "web-idea", direction: -1 });
  assert.deepEqual(collectionBoxView(data, 4).ideaPool.ideas.map(({ id }) => id), ["web-idea", "desktop-idea", "old"]);
  data = apply(data, { kind: "saveIdea", ...details, ideaId: "web-idea", title: "从桌面编辑", groupId: "interest", date: "2026-11-27" }, "unused");
  data = workspaceStateSchema.parse(JSON.parse(JSON.stringify(data)));
  assert.deepEqual(ideaSections(data)[1].ideas, [{
    id: "web-idea", title: "从桌面编辑", note: details.note, groupId: "interest", createdAt: details.date, links: ["https://example.com/docs"],
  }]);
  web({ kind: "removeIdeaGroup", groupId: "interest" });
  assert.deepEqual(ideaSections(data).at(-1).ideas.map(({ id }) => id), ["web-idea", "old"]);
  data = apply(data, { kind: "removeIdea", ideaId: "desktop-idea" }, "unused");
  assert.deepEqual(collectionBoxView(data, 8).ideaPool.ideas, [data.ideas[0], existingIdea]);
  assert.deepEqual(data.tools, [ordinaryTool]);
});

test("Invalid links and missing groups leave the existing workspace intact", () => {
  const data = initial();
  const action = { kind: "saveIdea", ideaId: "old", title: "改个标题", note: "", date: "2026-11-26", groupId: null, links: ["javascript:alert(1)"] };
  assert.equal(applyCollectionBoxAction(data, action, "unused").status, "invalid_url");
  assert.equal(applyCollectionBoxAction(data, { ...action, groupId: "missing", links: [] }, "unused").status, "missing");
  assert.equal(applyCollectionBoxAction(data, { kind: "removeIdea", ideaId: "missing" }, "unused").status, "missing");
  assert.deepEqual(data.ideas, [existingIdea]);
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
