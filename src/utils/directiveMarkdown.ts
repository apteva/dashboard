export interface DirectiveSection {
  title: string;
  level: number;
  start: number;
  end: number;
  headerEnd: number;
  bodyStart: number;
  bodyEnd: number;
  style: "atx" | "setext" | "plain";
}

type Heading = { title: string; level: number; start: number; end: number; style: "atx" | "setext" };

// Offsets refer to the original string. Unedited slices, including CRLF,
// introductory text, duplicate headings and fenced code, survive mode switches.
export function parseDirectiveSections(value: string): DirectiveSection[] {
  if (!value) return [];
  const headings: Heading[] = [];
  let offset = 0;
  let fence: { character: string; length: number } | null = null;
  let previous: { text: string; start: number } | null = null;
  for (const match of value.matchAll(/[^\n]*(?:\n|$)/g)) {
    const raw = match[0];
    if (!raw) continue;
    const start = offset;
    offset += raw.length;
    const line = raw.replace(/\r?\n$/, "");
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence.character && fenceMatch[1].length >= fence.length && !fenceMatch[2].trim()) fence = null;
      previous = null;
      continue;
    }
    if (fenceMatch && !(fenceMatch[1][0] === "`" && fenceMatch[2].includes("`"))) {
      fence = { character: fenceMatch[1][0], length: fenceMatch[1].length };
      previous = null;
      continue;
    }
    const atx = line.match(/^ {0,3}(#{1,6})(?:[ \t]+(.*)|$)/);
    if (atx) {
      const title = (atx[2] || "").replace(/[ \t]+#+[ \t]*$/, "").trim();
      headings.push({ title, level: atx[1].length, start, end: offset, style: "atx" });
      previous = null;
      continue;
    }
    const setext = line.match(/^ {0,3}(=+|-+)[ \t]*$/);
    if (setext && previous) {
      headings.push({ title: previous.text.trim(), level: setext[1][0] === "=" ? 1 : 2, start: previous.start, end: offset, style: "setext" });
      previous = null;
      continue;
    }
    previous = line.trim() && !/^(?: {4}|\t| {0,3}(?:>|[-+*] |\d+[.)] ))/.test(line) ? { text: line, start } : null;
  }
  const level = headings.length ? Math.min(...headings.map((heading) => heading.level)) : 0;
  const roots = headings.filter((heading) => heading.level === level);
  const sections: DirectiveSection[] = [];
  const section = (title: string, start: number, end: number, headerEnd: number, style: DirectiveSection["style"], level: number): DirectiveSection => {
    const remainder = value.slice(headerEnd, end);
    const leading = style === "plain" || !remainder.replace(/[\r\n]/g, "") ? 0 : (remainder.match(/^(?:\r?\n)*/) || [""])[0].length;
    const bodyStart = headerEnd + leading;
    const trailing = (value.slice(bodyStart, end).match(/(?:\r?\n)+$/) || [""])[0].length;
    return { title, start, end, headerEnd, bodyStart, bodyEnd: end - trailing, style, level };
  };
  if (!roots.length) return [section("Instructions", 0, value.length, 0, "plain", 0)];
  if (roots[0].start > 0) sections.push(section("Introduction", 0, roots[0].start, 0, "plain", 0));
  roots.forEach((heading, index) => sections.push(section(heading.title, heading.start, roots[index + 1]?.start ?? value.length, heading.end, heading.style, heading.level)));
  return sections;
}

export function directiveSectionBody(value: string, section: DirectiveSection): string {
  return value.slice(section.bodyStart, section.bodyEnd);
}

export function updateDirectiveSection(value: string, section: DirectiveSection, body: string): string {
  const eol = value.includes("\r\n") ? "\r\n" : "\n";
  const prefix = value.slice(0, section.bodyStart);
  // A heading at EOF has no line ending yet. Add one only when content is entered.
  const separator = section.style !== "plain" && section.headerEnd === section.bodyStart && !prefix.endsWith("\n") && body ? eol : "";
  const followingSeparator = section.end < value.length && section.bodyEnd === section.end && body && !body.endsWith("\n") ? eol + eol : "";
  return prefix + separator + body + followingSeparator + value.slice(section.bodyEnd);
}

export function renameDirectiveSection(value: string, section: DirectiveSection, title: string): string {
  const clean = title.replace(/[\r\n]+/g, " ").trim();
  if (!clean) return value;
  const eol = value.includes("\r\n") ? "\r\n" : "\n";
  const level = section.level || (parseDirectiveSections(value).find((entry) => entry.level)?.level ?? 1);
  const header = section.style === "setext"
    ? clean + eol + (level === 1 ? "=" : "-").repeat(Math.max(clean.length, 3)) + eol
    : "#".repeat(level) + " " + clean + eol;
  return value.slice(0, section.start) + header + value.slice(section.headerEnd);
}

export function addDirectiveSection(value: string, title: string, body = ""): string {
  const clean = title.replace(/[\r\n]+/g, " ").trim();
  if (!clean) return value;
  const eol = value.includes("\r\n") ? "\r\n" : "\n";
  const level = parseDirectiveSections(value).find((entry) => entry.level)?.level ?? 1;
  // Explicitly adding a section to plain text gives the existing text its own
  // heading, so it remains independently editable rather than becoming a goal.
  const base = value.trim() && !parseDirectiveSections(value).some((entry) => entry.level) ? "# Instructions" + eol + value : value;
  const separator = !base ? "" : base.endsWith(eol + eol) ? "" : base.endsWith(eol) ? eol : eol + eol;
  return base + separator + "#".repeat(level) + " " + clean + eol + body;
}

export function removeDirectiveSection(value: string, section: DirectiveSection): string {
  return value.slice(0, section.start) + value.slice(section.end);
}

export function moveDirectiveSection(value: string, index: number, direction: -1 | 1): string {
  const sections = parseDirectiveSections(value);
  const target = index + direction;
  if (!sections[index]?.level || !sections[target]?.level) return value;
  const chunks = sections.map((section) => value.slice(section.start, section.end));
  [chunks[index], chunks[target]] = [chunks[target], chunks[index]];
  const eol = value.includes("\r\n") ? "\r\n" : "\n";
  return chunks.reduce((out, chunk) => out + (out && !out.endsWith("\n") ? eol + eol : "") + chunk, "");
}

export function hasMarkdownDirectiveHeadings(value: string): boolean {
  return parseDirectiveSections(value).some((section) => section.level > 0);
}

export function structuredDirectiveTemplate(agentName?: string): string {
  const name = (agentName || "").trim() || "this agent";
  return `# Role\nYou are ${name}.\n\n# Working instructions\n`;
}

// Only an explicit organize action uses this helper. Existing text is preserved
// verbatim in Working instructions; no goals or behavior policies are invented.
export function structureDirectiveDraft(current: string, agentName?: string): string {
  if (hasMarkdownDirectiveHeadings(current)) return current;
  return structuredDirectiveTemplate(agentName) + current;
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
