import { normalizeWebsiteUrl } from "./tool-collections.ts";

export const MAX_IDEAS = 10_000;
export const MAX_IDEA_GROUPS = 500;
export const MAX_IDEA_LINKS = 20;

export type Idea = { id: string; title: string; note: string; createdAt: string; groupId?: string; links?: string[] };
export type IdeaGroup = { id: string; title: string };
export type IdeaPool = { ideas: Idea[]; ideaGroups?: IdeaGroup[] };
export type IdeaDetails = { title: string; note: string; links: string[]; groupId: string | null };
export type IdeaPoolAction =
  | ({ kind: "saveIdea"; ideaId?: string; date: string } & IdeaDetails)
  | { kind: "removeIdea"; ideaId: string }
  | { kind: "moveIdea"; ideaId: string; direction: -1 | 1 }
  | { kind: "saveIdeaGroup"; groupId?: string; title: string }
  | { kind: "removeIdeaGroup"; groupId: string };

export function ideaSections({ ideas, ideaGroups = [] }: IdeaPool) {
  const ungrouped = { id: null, title: "未分组", ideas: [] as Idea[] };
  const groups = ideaGroups.map((group) => ({ ...group, ideas: [] as Idea[] }));
  const byId = new Map(groups.map((group) => [group.id, group]));
  for (const idea of ideas) (byId.get(idea.groupId ?? "") ?? ungrouped).ideas.push(idea);
  return [...groups, ungrouped];
}

export function applyIdeaPoolAction<T extends IdeaPool>(pool: T, action: IdeaPoolAction, id: string) {
  const { ideas, ideaGroups = [] } = pool;
  const applied = (data: T) => ({ status: "applied" as const, data });

  switch (action.kind) {
    case "saveIdea": {
      const existing = ideas.find((idea) => idea.id === action.ideaId);
      if (action.ideaId && !existing) return { status: "missing" as const };
      if (!existing && ideas.length >= MAX_IDEAS) return { status: "full" as const };
      if (action.groupId && !ideaGroups.some((group) => group.id === action.groupId)) return { status: "missing" as const };
      const title = action.title.trim();
      if (!title || title.length > 500 || action.note.length > 4_000 || action.links.length > MAX_IDEA_LINKS) return { status: "invalid_input" as const };
      const links: string[] = [];
      for (const input of action.links) {
        const url = normalizeWebsiteUrl(input);
        if (!url || url.length > 2_000) return { status: "invalid_url" as const };
        if (!links.includes(url)) links.push(url);
      }
      const idea: Idea = {
        id: existing?.id ?? id, title, note: action.note, createdAt: existing?.createdAt ?? action.date,
        ...(action.groupId ? { groupId: action.groupId } : {}), ...(links.length ? { links } : {}),
      };
      return applied({ ...pool, ideas: existing ? ideas.map((item) => item === existing ? idea : item) : [idea, ...ideas] });
    }
    case "removeIdea": {
      if (!ideas.some((idea) => idea.id === action.ideaId)) return { status: "missing" as const };
      return applied({ ...pool, ideas: ideas.filter((idea) => idea.id !== action.ideaId) });
    }
    case "moveIdea": {
      const section = ideaSections(pool).find((group) => group.ideas.some((idea) => idea.id === action.ideaId));
      if (!section) return { status: "missing" as const };
      const index = section.ideas.findIndex((idea) => idea.id === action.ideaId);
      const neighbour = section.ideas[index + action.direction];
      if (!neighbour) return applied(pool);
      const item = section.ideas[index];
      return applied({ ...pool, ideas: ideas.map((idea) => idea === item ? neighbour : idea === neighbour ? item : idea) });
    }
    case "saveIdeaGroup": {
      const title = action.title.trim();
      if (!title || title.length > 500 || title === "未分组") return { status: "invalid_input" as const };
      if (ideaGroups.some((group) => group.id !== action.groupId && group.title.toLowerCase() === title.toLowerCase())) return { status: "duplicate_category" as const };
      if (action.groupId && !ideaGroups.some((group) => group.id === action.groupId)) return { status: "missing" as const };
      if (!action.groupId && ideaGroups.length >= MAX_IDEA_GROUPS) return { status: "full" as const };
      const group = { id: action.groupId ?? id, title };
      return applied({ ...pool, ideaGroups: action.groupId ? ideaGroups.map((item) => item.id === action.groupId ? group : item) : [...ideaGroups, group] });
    }
    case "removeIdeaGroup": {
      if (!ideaGroups.some((group) => group.id === action.groupId)) return { status: "missing" as const };
      return applied({ ...pool, ideaGroups: ideaGroups.filter((group) => group.id !== action.groupId), ideas: ideas.map((idea) => {
        if (idea.groupId !== action.groupId) return idea;
        const { groupId: _groupId, ...ungrouped } = idea;
        return ungrouped;
      }) });
    }
  }
}
