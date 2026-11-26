import type { output } from "zod";
import { MAX_COLLECTION_WEBSITES, normalizeWebsiteUrl } from "./tool-collections.ts";
import { applyIdeaPoolAction, type IdeaPoolAction } from "./idea-pool.ts";
import type { workspaceStateSchema } from "./workspace-state-schema.ts";

type Workspace = output<typeof workspaceStateSchema>;
type Collection = Workspace["tools"][number];

export type CollectionBoxAction =
  | { kind: "idea"; title: string; date: string }
  | Extract<IdeaPoolAction, { kind: "saveIdea" | "removeIdea" }>
  | { kind: "category"; title: string }
  | { kind: "save"; categoryId: string; websiteId?: string; fromId?: string; title: string; url: string; description: string }
  | { kind: "remove"; categoryId: string; websiteId: string };

export function collectionBoxView(data: Workspace, revision: number) {
  return {
    revision,
    ideaPool: { ideas: data.ideas, groups: data.ideaGroups ?? [] },
    categories: data.tools.filter(({ kind }) => kind === "collection").map(({ id, title, websites }) => ({
      id, title, websites: websites ?? [],
    })),
  };
}

export function applyCollectionBoxAction(data: Workspace, action: CollectionBoxAction, id: string) {
  function applied(tools: Collection[], categoryId: string) {
    return { status: "applied" as const, data: { ...data, tools }, categoryId };
  }

  if (action.kind === "idea" || action.kind === "saveIdea" || action.kind === "removeIdea") {
    const ideaAction = action.kind === "idea" ? { ...action, kind: "saveIdea" as const, note: "", links: [], groupId: null } : action;
    const result = applyIdeaPoolAction(data, ideaAction, id);
    return result.status === "applied" ? { ...result, categoryId: undefined } : result;
  }

  if (action.kind === "category") {
    if (data.tools.some((tool) => tool.kind === "collection" && tool.title.trim().toLowerCase() === action.title.toLowerCase())) {
      return { status: "duplicate_category" as const };
    }
    if (data.tools.length >= 2000) return { status: "full" as const };
    return applied([...data.tools, {
      id, kind: "collection", title: action.title, description: "", status: "常用", url: "", version: "", blocks: [], websites: [],
    }], id);
  }

  const destination = data.tools.find((tool) => tool.id === action.categoryId && tool.kind === "collection");
  if (!destination) return { status: "missing" as const };
  const links = destination.websites ?? [];
  if (action.kind === "remove") {
    if (!links.some((link) => link.id === action.websiteId)) return { status: "missing" as const };
    return applied(data.tools.map((tool) => tool === destination
      ? { ...tool, websites: links.filter((link) => link.id !== action.websiteId) } : tool), destination.id);
  }

  const url = normalizeWebsiteUrl(action.url);
  if (!url || url.length > 2000) return { status: "invalid_url" as const };
  const source = action.websiteId
    ? data.tools.find((tool) => tool.id === action.fromId && tool.kind === "collection")
    : undefined;
  if (action.websiteId && !source?.websites?.some((link) => link.id === action.websiteId)) {
    return { status: "missing" as const };
  }
  const sameCollection = source === destination;
  if (links.some((link) => !(sameCollection && link.id === action.websiteId) && normalizeWebsiteUrl(link.url) === url)) {
    return { status: "duplicate_url" as const };
  }
  if (!sameCollection && links.length >= MAX_COLLECTION_WEBSITES) return { status: "full" as const };

  const site = { id: action.websiteId ?? id, title: action.title, url, description: action.description };
  const tools = data.tools.map((tool) => {
    if (tool === destination) {
      const websites = sameCollection ? links.map((link) => link.id === site.id ? site : link) : [...links, site];
      return { ...tool, websites };
    }
    if (tool === source) return { ...tool, websites: source.websites?.filter((link) => link.id !== site.id) };
    return tool;
  });
  return applied(tools, destination.id);
}
