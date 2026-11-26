import type { ReactNode } from "react";
import type { Project } from "../api";
import { useAuth } from "../hooks/useAuth";
import { useProjects } from "../hooks/useProjects";

// Screens whose data lives inside one project wrap themselves in
// ProjectRequired. While the sidebar is on All projects they show a project
// chooser instead of quietly using a remembered project; choosing one switches
// the sidebar to it and the screen renders as usual.
export function ProjectRequired({ title, description, children }: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  const { allProjects, projects, lastProject, setCurrentProject } = useProjects();
  const { user } = useAuth();
  if (!allProjects) return <>{children}</>;
  return (
    <div className="flex h-full items-start justify-center overflow-y-auto p-4 sm:p-8">
      <section className="w-full max-w-lg rounded-lg border border-border bg-bg-card p-5" aria-labelledby="project-required-title">
        <h1 id="project-required-title" className="text-base font-semibold text-text">{title}</h1>
        <p className="mt-1 text-sm text-text-muted">{description}</p>
        <ProjectChoiceList
          projects={orderProjectChoices(projects, lastProject)}
          lastProjectId={lastProject?.id}
          userId={user ? user.id : undefined}
          onChoose={setCurrentProject}
        />
      </section>
    </div>
  );
}

// The last project used comes first, then the rest in their usual order.
export function orderProjectChoices(projects: Project[], lastProject: Project | null | undefined): Project[] {
  if (!lastProject || !projects.some((project) => project.id === lastProject.id)) return projects;
  return [lastProject, ...projects.filter((project) => project.id !== lastProject.id)];
}

function ProjectChoiceList({ projects, lastProjectId, userId, onChoose }: {
  projects: Project[];
  lastProjectId?: string;
  userId?: number;
  onChoose: (project: Project) => void;
}) {
  return (
    <ul className="mt-4 divide-y divide-border overflow-hidden rounded-md border border-border">
      {projects.map((project) => (
        <li key={project.id}>
          <button
            type="button"
            onClick={() => onChoose(project)}
            className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm text-text hover:bg-bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            <span className="min-w-0 truncate">
              {project.name}
              {userId !== undefined && project.user_id !== userId ? <span className="text-text-dim"> (shared)</span> : null}
            </span>
            {project.id === lastProjectId && <span className="shrink-0 text-xs text-text-dim">Last used</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}
