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

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [projectList, setProjectList] = useState<Project[]>([]);
  const [current, setCurrent] = useState<Project | null>(null);

  const load = () => {
    projectsAPI.list().then((list) => {
      setProjectList(list || []);
      // Restore from localStorage or pick first
      const savedId = localStorage.getItem("apteva_project_id");
      if (savedId && list?.find((p) => p.id === savedId)) {
        setCurrent(list.find((p) => p.id === savedId) || null);
      } else if (!current && list?.length > 0) {
        setCurrent(list[0]);
        localStorage.setItem("apteva_project_id", list[0].id);
      }
    }).catch(() => {});
  };

  useEffect(() => { load(); }, []);

  const setCurrentProject = (p: Project | null) => {
    setCurrent(p);
    if (p) {
      localStorage.setItem("apteva_project_id", p.id);
    } else {
      localStorage.removeItem("apteva_project_id");
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
