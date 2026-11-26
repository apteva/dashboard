import { createContext, useCallback, useContext, useState, useEffect, type ReactNode } from "react";
import { projects as projectsAPI, type Project } from "../api";

interface ProjectContextValue {
  projects: Project[];
  /** The selected project, or null when the sidebar is on All projects. */
  currentProject: Project | null;
  /** True when the sidebar picker is on All projects. */
  allProjects: boolean;
  /** The most recently selected project. Stays set while All projects is on. */
  lastProject: Project | null;
  /** All projects is offered only when there is more than one project. */
  canSelectAll: boolean;
  loaded: boolean;
  setCurrentProject: (p: Project | null) => void;
  selectAllProjects: () => void;
  reload: () => void;
}

const ProjectContext = createContext<ProjectContextValue>({
  projects: [],
  currentProject: null,
  allProjects: false,
  lastProject: null,
  canSelectAll: false,
  loaded: false,
  setCurrentProject: () => {},
  selectAllProjects: () => {},
  reload: () => {},
});

const PROJECT_KEY = "apteva_project_id";
// "all" while the sidebar is on All projects, "project" otherwise. The last
// project id stays in PROJECT_KEY so leaving All projects returns to it.
const SCOPE_KEY = "apteva_project_scope";

export type ProjectScope = "all" | "project";

type ProjectStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

// resolveProjectIDForTab picks which project this tab should show and, crucially,
// claims that choice in sessionStorage before returning it.
//
// Claiming matters when the tab had no session-scoped choice yet. Previously we
// read the shared localStorage default and rendered it without copying it into
// sessionStorage. If another tab then changed the shared default, refreshing the
// first tab silently moved it to the other tab's project.
export function resolveProjectIDForTab(
  projectIDs: readonly string[],
  tabStorage: ProjectStorage,
  sharedStorage: ProjectStorage,
): string | null {
  const available = new Set(projectIDs);
  const tabID = tabStorage.getItem(PROJECT_KEY);
  if (tabID && available.has(tabID)) return tabID;

  const sharedID = sharedStorage.getItem(PROJECT_KEY);
  const resolved = sharedID && available.has(sharedID)
    ? sharedID
    : projectIDs[0] ?? null;

  if (!resolved) {
    tabStorage.removeItem(PROJECT_KEY);
    return null;
  }

  // Turn the shared/new-tab default into an independent selection for this tab.
  tabStorage.setItem(PROJECT_KEY, resolved);

  // Repair an empty or stale shared default so subsequently opened tabs start
  // from a real project.
  if (sharedID !== resolved) sharedStorage.setItem(PROJECT_KEY, resolved);
  return resolved;
}

// resolveProjectScopeForTab applies the same tab-first rule to the All
// projects choice: this tab's own choice wins, then the browser-wide default
// for new tabs. The result is claimed for the tab. All projects needs at least
// two projects; with fewer it resolves to "project" without changing storage.
export function resolveProjectScopeForTab(
  projectCount: number,
  tabStorage: ProjectStorage,
  sharedStorage: ProjectStorage,
): ProjectScope {
  const valid = (value: string | null): value is ProjectScope => value === "all" || value === "project";
  const tabScope = tabStorage.getItem(SCOPE_KEY);
  const sharedScope = sharedStorage.getItem(SCOPE_KEY);
  const scope: ProjectScope = valid(tabScope) ? tabScope : valid(sharedScope) ? sharedScope : "project";
  if (!valid(tabScope)) tabStorage.setItem(SCOPE_KEY, scope);
  return scope === "all" && projectCount > 1 ? "all" : "project";
}

// Project selection priority:
// Tab-independence priority:
//   1. sessionStorage — what THIS tab last had selected (survives in-tab
//      refreshes; never shared with other tabs).
//   2. localStorage — the most recently switched-to project across the
//      whole browser. Acts as the new-tab default; never tramples a tab
//      that already chose its own.
//   3. projects[0] — fallback when both stores are empty (first-ever
//      load or freshly-cleared storage).
//
// The All projects choice follows the same rules under its own key.
export function ProjectProvider({ children }: { children: ReactNode }) {
  const [projectList, setProjectList] = useState<Project[]>([]);
  const [current, setCurrent] = useState<Project | null>(null);
  const [scope, setScope] = useState<ProjectScope>("project");
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(() => {
    projectsAPI.list().then((list) => {
      const nextList = list || [];
      setProjectList(nextList);
      const selectedID = resolveProjectIDForTab(
        nextList.map((project) => project.id),
        window.sessionStorage,
        window.localStorage,
      );
      setCurrent(nextList.find((project) => project.id === selectedID) || null);
      setScope(resolveProjectScopeForTab(nextList.length, window.sessionStorage, window.localStorage));
      setLoaded(true);
    }).catch(() => { setLoaded(true); });
  }, []);

  useEffect(() => { load(); }, [load]);

  // setCurrentProject writes both stores intentionally:
  //   - sessionStorage so a refresh of THIS tab returns to the same
  //     project (per-tab persistence).
  //   - localStorage so the NEXT freshly-opened tab uses this as its
  //     default (new-tab inheritance) without forcing every already-
  //     open tab to follow along — there's no `storage` event listener
  //     here on purpose, so other tabs keep their own state.
  const setCurrentProject = useCallback((p: Project | null) => {
    setCurrent(p);
    setScope("project");
    window.sessionStorage.setItem(SCOPE_KEY, "project");
    window.localStorage.setItem(SCOPE_KEY, "project");
    if (p) {
      window.sessionStorage.setItem(PROJECT_KEY, p.id);
      window.localStorage.setItem(PROJECT_KEY, p.id);
    } else {
      window.sessionStorage.removeItem(PROJECT_KEY);
      window.localStorage.removeItem(PROJECT_KEY);
    }
  }, []);

  const canSelectAll = projectList.length > 1;
  const selectAllProjects = useCallback(() => {
    setScope("all");
    window.sessionStorage.setItem(SCOPE_KEY, "all");
    window.localStorage.setItem(SCOPE_KEY, "all");
  }, []);

  const allProjects = scope === "all" && canSelectAll;
  return (
    <ProjectContext.Provider value={{
      projects: projectList,
      currentProject: allProjects ? null : current,
      allProjects,
      lastProject: current,
      canSelectAll,
      loaded,
      setCurrentProject,
      selectAllProjects,
      reload: load,
    }}>
      {children}
    </ProjectContext.Provider>
  );
}

export function useProjects() {
  return useContext(ProjectContext);
}
