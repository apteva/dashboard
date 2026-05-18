import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { projects as projectsAPI, type Project } from "../api";

interface ProjectContextValue {
  projects: Project[];
  currentProject: Project | null;
  setCurrentProject: (p: Project | null) => void;
  reload: () => void;
}

const ProjectContext = createContext<ProjectContextValue>({
  projects: [],
  currentProject: null,
  setCurrentProject: () => {},
  reload: () => {},
});

const PROJECT_KEY = "apteva_project_id";

// resolveInitialProjectID picks which project this tab should show.
// Tab-independence priority:
//   1. sessionStorage — what THIS tab last had selected (survives in-tab
//      refreshes; never shared with other tabs).
//   2. localStorage — the most recently switched-to project across the
//      whole browser. Acts as the new-tab default; never tramples a tab
//      that already chose its own.
//   3. projects[0] — fallback when both stores are empty (first-ever
//      load or freshly-cleared storage).
//
// Net behaviour: opening a fresh tab inherits the last project you
// switched to; switching projects in tab A does NOT yank tab B onto
// the new project. Each open tab is its own project context.
function resolveInitialProjectID(): string | null {
  if (typeof window === "undefined") return null;
  return (
    window.sessionStorage.getItem(PROJECT_KEY) ||
    window.localStorage.getItem(PROJECT_KEY) ||
    null
  );
}

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [projectList, setProjectList] = useState<Project[]>([]);
  const [current, setCurrent] = useState<Project | null>(null);

  const load = () => {
    projectsAPI.list().then((list) => {
      setProjectList(list || []);
      const savedId = resolveInitialProjectID();
      if (savedId && list?.find((p) => p.id === savedId)) {
        setCurrent(list.find((p) => p.id === savedId) || null);
      } else if (!current && list?.length > 0) {
        // Fresh user with no saved selection — seed both stores from
        // the first project so subsequent reads see a consistent
        // default and the next tab opens on it too.
        setCurrent(list[0]);
        window.sessionStorage.setItem(PROJECT_KEY, list[0].id);
        window.localStorage.setItem(PROJECT_KEY, list[0].id);
      }
    }).catch(() => {});
  };

  useEffect(() => { load(); }, []);

  // setCurrentProject writes both stores intentionally:
  //   - sessionStorage so a refresh of THIS tab returns to the same
  //     project (per-tab persistence).
  //   - localStorage so the NEXT freshly-opened tab uses this as its
  //     default (new-tab inheritance) without forcing every already-
  //     open tab to follow along — there's no `storage` event listener
  //     here on purpose, so other tabs keep their own state.
  const setCurrentProject = (p: Project | null) => {
    setCurrent(p);
    if (p) {
      window.sessionStorage.setItem(PROJECT_KEY, p.id);
      window.localStorage.setItem(PROJECT_KEY, p.id);
    } else {
      window.sessionStorage.removeItem(PROJECT_KEY);
      window.localStorage.removeItem(PROJECT_KEY);
    }
  };

  return (
    <ProjectContext.Provider value={{ projects: projectList, currentProject: current, setCurrentProject, reload: load }}>
      {children}
    </ProjectContext.Provider>
  );
}

export function useProjects() {
  return useContext(ProjectContext);
}
