"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ideaSections, MAX_IDEA_GROUPS, MAX_IDEA_LINKS, MAX_IDEAS, type Idea, type IdeaDetails, type IdeaPool, type IdeaPoolAction } from "@/lib/idea-pool";
import { normalizeWebsiteUrl } from "@/lib/tool-collections";
import { submitFormOnEnter } from "./form-keyboard";
import "./idea-pool.css";

type Editor =
  | { kind: "idea"; id?: string; original?: Idea; title: string; note: string; links: string; groupId: string | null }
  | { kind: "group"; id?: string; original?: string; title: string };

type Props = {
  pool: IdeaPool;
  workspaceOwner: string;
  readOnly: boolean;
  submit: (action: IdeaPoolAction, id?: string) => string;
  requestRemoval: (title: string, remove: () => void, description?: string) => void;
};

const ungroupedKey = (id: string | null) => id === null ? "ungrouped" : `group:${id}`;
const ideaTitle = (idea: Idea) => idea.title.trim() || "未命名想法";
const errorMessages: Record<string, string> = {
  missing: "条目或分组已变动，请重新打开。",
  duplicate_category: "已有同名分组。",
  full: "已达到数量上限。",
  invalid_input: "请检查标题和内容长度。「未分组」是保留名称。",
  invalid_url: "请输入有效的 HTTP 或 HTTPS 链接，每行一个。",
};

function Options({ label, children }: { label: string; children: ReactNode }) {
  return <details className="ideaPoolOptions" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
  }} onKeyDown={(event) => {
    if (event.key !== "Escape") return;
    event.currentTarget.open = false;
    event.currentTarget.querySelector("summary")?.focus();
  }}>
    <summary aria-label={label}>⋯</summary>
    <div className="ideaPoolActions" onClick={(event) => {
      if (event.target instanceof HTMLButtonElement) event.currentTarget.closest("details")?.removeAttribute("open");
    }}>{children}</div>
  </details>;
}

export default function IdeaPoolView({ pool, workspaceOwner, readOnly, submit, requestRemoval }: Props) {
  const storageKey = `xuliu:idea-pool:open:${workspaceOwner}`;
  const initialOpen = [ungroupedKey(null)];
  const [open, setOpen] = useState(initialOpen);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null");
      if (Array.isArray(saved)) setOpen(saved.filter((item) => typeof item === "string"));
    } catch { /* The current session can still use the default disclosure state. */ }
  }, [storageKey]);

  function setDisclosed(id: string | null, expanded: boolean) {
    const key = ungroupedKey(id);
    const next = expanded ? [...new Set([...open, key])] : open.filter((item) => item !== key);
    setOpen(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Keep the session state. */ }
  }

  function edit(next: Editor) {
    setError("");
    setEditor(next);
    input.current?.focus();
  }

  function openIdea(groupId: string | null, idea?: Idea) {
    edit({ kind: "idea", groupId, id: idea?.id, original: idea, title: idea?.title ?? "", note: idea?.note ?? "", links: idea?.links?.join("\n") ?? "" });
  }

  function act(action: IdeaPoolAction, id?: string) {
    const status = submit(action, id);
    setError(status === "applied" ? "" : errorMessages[status] ?? "保存失败。" );
    return status === "applied";
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor || readOnly) return;
    const id = globalThis.crypto.randomUUID();
    if (editor.kind === "group") {
      if (editor.id && pool.ideaGroups?.find((group) => group.id === editor.id)?.title !== editor.original) {
        setError("该分组已更新，请重新打开后编辑。");
        return;
      }
      if (!act({ kind: "saveIdeaGroup", groupId: editor.id, title: editor.title }, id)) return;
      setDisclosed(editor.id ?? id, true);
    } else {
      const latest = pool.ideas.find((idea) => idea.id === editor.id);
      const original = editor.original;
      if (original && (!latest || latest.title !== original.title || latest.note !== original.note || latest.groupId !== original.groupId
        || JSON.stringify(latest.links ?? []) !== JSON.stringify(original.links ?? []))) {
        setError("该想法已在别处更新，请重新打开后编辑。");
        return;
      }
      const details: IdeaDetails = { title: editor.title, note: editor.note, groupId: editor.groupId, links: editor.links.split(/\r?\n/).map((link) => link.trim()).filter(Boolean) };
      const now = new Date();
      const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      if (!act({ kind: "saveIdea", ideaId: editor.id, date, ...details }, id)) return;
      setDisclosed(editor.groupId, true);
    }
    setEditor(null);
  }

  const groups = ideaSections(pool);
  const canAddIdea = pool.ideas.length < MAX_IDEAS;
  return <div className="page narrowPage ideaPoolPage">
    <header className="pageHead ideaPoolHead"><h1>想法池</h1>{!readOnly && <div className="ideaPoolControls">
      <button type="button" className="softButton" disabled={(pool.ideaGroups?.length ?? 0) >= MAX_IDEA_GROUPS} onClick={() => edit({ kind: "group", title: "" })}>＋ 分组</button>
      <button type="button" className="primaryButton" disabled={!canAddIdea} onClick={() => openIdea(null)}>＋ 想法</button>
    </div>}</header>
    {!readOnly && editor && <form className="panel ideaPoolEditor" onSubmit={save} onKeyDown={submitFormOnEnter}>
      <label>{editor.kind === "idea" ? "标题" : "分组名称"}<input ref={input} autoFocus required maxLength={500} value={editor.title} onChange={(event) => setEditor({ ...editor, title: event.target.value })} /></label>
      {editor.kind === "idea" && <>
        <label>分组<select value={editor.groupId ?? ""} onChange={(event) => setEditor({ ...editor, groupId: event.target.value || null })}>
          <option value="">未分组</option>{(pool.ideaGroups ?? []).map((group) => <option key={group.id} value={group.id}>{group.title}</option>)}
        </select></label>
        <label>补充说明<textarea rows={3} maxLength={4_000} value={editor.note} onChange={(event) => setEditor({ ...editor, note: event.target.value })} /></label>
        <label>相关链接<textarea rows={2} maxLength={MAX_IDEA_LINKS * 2_001} placeholder="每行一个链接" value={editor.links} onChange={(event) => setEditor({ ...editor, links: event.target.value })} /></label>
      </>}
      <div className="ideaPoolControls"><button type="button" className="softButton" onClick={() => { setEditor(null); setError(""); }}>取消</button><button type="submit" className="primaryButton" disabled={!editor.title.trim()}>保存</button></div>
    </form>}
    {error && <p className="ideaPoolError" role="alert">{error}</p>}
    <div className="panel ideaPoolGroups">
      {groups.map((group) => {
        const key = ungroupedKey(group.id);
        const expanded = open.includes(key);
        const groupId = group.id;
        return <section key={key} className="ideaPoolGroup" aria-label={group.title}>
          <div className="ideaPoolGroupHead">
            <button type="button" className="ideaPoolToggle" aria-expanded={expanded} onClick={() => setDisclosed(groupId, !expanded)}><span>{group.title}</span></button>
            {!readOnly && <div className="ideaPoolControls">
              {canAddIdea && <button type="button" className="ideaPoolSmallButton" aria-label={`在${group.title}新增想法`} onClick={() => openIdea(groupId)}>＋</button>}
              {groupId !== null && <Options label={`管理分组 ${group.title}`}>
                <button type="button" onClick={() => edit({ kind: "group", id: groupId, title: group.title, original: group.title })}>重命名分组</button>
                <button type="button" className="ideaPoolDanger" onClick={() => requestRemoval(group.title, () => act({ kind: "removeIdeaGroup", groupId }), "该组的想法会移到「未分组」。")}>移除分组</button>
              </Options>}
            </div>}
          </div>
          {expanded && (group.ideas.length ? <ul className="ideaPoolItems">{group.ideas.map((idea, index) => <li className="ideaPoolItem" key={idea.id}>
            <div className="ideaPoolItemContent">
              <strong>{ideaTitle(idea)}</strong>
              {idea.note && <p>{idea.note}</p>}
              {idea.links?.length ? <div className="ideaPoolLinks">{idea.links.map((link) => {
                const url = normalizeWebsiteUrl(link);
                return url && <a key={link} href={url} target="_blank" rel="noopener noreferrer" title={url}>{url.replace(/^https?:\/\//i, "")}</a>;
              })}</div> : null}
            </div>
            {!readOnly && <Options label={`管理想法 ${ideaTitle(idea)}`}>
              <button type="button" onClick={() => openIdea(groupId, idea)}>编辑</button>
              <button type="button" disabled={index === 0} onClick={() => act({ kind: "moveIdea", ideaId: idea.id, direction: -1 })}>上移</button>
              <button type="button" disabled={index === group.ideas.length - 1} onClick={() => act({ kind: "moveIdea", ideaId: idea.id, direction: 1 })}>下移</button>
              <button type="button" className="ideaPoolDanger" onClick={() => requestRemoval(ideaTitle(idea), () => act({ kind: "removeIdea", ideaId: idea.id }))}>删除</button>
            </Options>}
          </li>)}</ul> : <p className="ideaPoolEmpty">暂无想法</p>)}
        </section>;
      })}
    </div>
  </div>;
}
