const HEADING_RE = /^#{1,6}\s+.+$/m;

export function hasMarkdownDirectiveHeadings(value: string): boolean {
  return HEADING_RE.test(value);
}

export function structuredDirectiveTemplate(agentName?: string): string {
  const name = (agentName || "").trim() || "this agent";
  return `# Role
You are ${name}.

# Goals
- 

# Operating Rules
- Prefer direct, useful action over commentary.
- Ask before irreversible or high-blast-radius actions.

# Inputs and Events
- Treat user messages, app events, and channel messages as work requests.

# Tools and Integrations
- Use available tools when they materially improve the result.
- Never expose credentials or secrets in messages, directives, or logs.

# Schedule
- Work reactively unless a subscription, schedule, or user request says otherwise.

# Escalation and Safety
- Pause and ask when the next action is ambiguous, destructive, or externally visible.

# Tone
- Be concise, specific, and clear.

# Learning
- Add stable lessons here when evaluations or operators identify recurring behavior.`;
}

export function structureDirectiveDraft(current: string, agentName?: string): string {
  const text = current.trim();
  if (hasMarkdownDirectiveHeadings(text)) return current;
  if (!text) return structuredDirectiveTemplate(agentName);
  const name = (agentName || "").trim() || "this agent";
  return `# Role
You are ${name}.

# Goals
- ${text.replace(/\s+/g, " ")}

# Operating Rules
- Prefer direct, useful action over commentary.
- Ask before irreversible or high-blast-radius actions.

# Inputs and Events
- Treat user messages, app events, and channel messages as work requests.

# Tools and Integrations
- Use available tools when they materially improve the result.
- Never expose credentials or secrets in messages, directives, or logs.

# Schedule
- Work reactively unless a subscription, schedule, or user request says otherwise.

# Escalation and Safety
- Pause and ask when the next action is ambiguous, destructive, or externally visible.

# Tone
- Be concise, specific, and clear.

# Learning
- Add stable lessons here when evaluations or operators identify recurring behavior.`;
}

export function appendDirectiveLearning(base: string, additions: string[]): string {
  const clean = additions.map((item) => item.trim()).filter(Boolean);
  if (clean.length === 0) return base;
  if (!hasMarkdownDirectiveHeadings(base)) {
    return clean.reduce((out, add) => (out.trim() ? `${out.trimEnd()}\n\n${add}` : add), base);
  }
  return appendToSection(base, "Learning", clean.map(learningBullet).join("\n"));
}

function learningBullet(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.startsWith("- ") || compact.startsWith("* ")) return compact;
  return `- ${compact}`;
}

function appendToSection(base: string, section: string, content: string): string {
  const normalized = base.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const target = section.toLowerCase();
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const name = headingName(lines[i]);
    if (name && name.toLowerCase() === target) {
      start = i;
      break;
    }
  }
  if (start < 0) {
    const prefix = normalized.trimEnd();
    return `${prefix ? `${prefix}\n\n` : ""}# ${section}\n${content}`;
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (headingName(lines[i])) {
      end = i;
      break;
    }
  }
  let insertAt = end;
  while (insertAt > start + 1 && lines[insertAt - 1].trim() === "") insertAt -= 1;
  const hasContent = lines.slice(start + 1, insertAt).some((line) => line.trim() !== "");
  const insert = [...(hasContent ? [""] : []), ...content.split("\n"), ...(end < lines.length ? [""] : [])];
  return [...lines.slice(0, insertAt), ...insert, ...lines.slice(end)].join("\n").trimEnd();
}

function headingName(line: string): string | null {
  const match = line.match(/^#{1,6}\s+(.+?)\s*$/);
  return match ? match[1].replace(/#+$/, "").trim() : null;
}
