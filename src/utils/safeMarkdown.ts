import createDOMPurify, { type DOMPurify } from "dompurify";
import { marked } from "marked";

// Agent messages are durable, model-authored content. They may contain text
// copied from websites, email, integrations, or other untrusted sources, so
// they must be treated as hostile even though the message row itself came
// from our server. `marked` intentionally preserves raw HTML; DOMPurify is the
// security boundary that removes scripts, event handlers, unsafe URL schemes,
// frames, forms, and other active content before React inserts the result.
marked.setOptions({ breaks: true, gfm: true });

const SANITIZE_OPTIONS = {
  USE_PROFILES: { html: true },
  FORBID_TAGS: ["base", "form", "iframe", "object", "embed", "style", "template"],
  FORBID_ATTR: ["style", "srcdoc"],
};

let purifier: DOMPurify | null = null;

function getPurifier(): DOMPurify {
  // Build the purifier lazily from the active window. Besides being explicit
  // in the browser, this keeps tests and non-browser imports from freezing a
  // not-yet-supported DOMPurify instance before their DOM globals exist.
  if (!purifier) purifier = createDOMPurify(window);
  return purifier;
}

export function renderSafeMarkdown(source: string): string {
  const parsed = marked.parse(source, { async: false }) as string;
  const activePurifier = getPurifier();
  const sanitized = activePurifier.isSupported
    ? activePurifier.sanitize(parsed, SANITIZE_OPTIONS)
    : fallbackSanitize(parsed);
  // A second, small allow/deny pass makes the boundary fail closed in partial
  // DOM implementations where DOMPurify can mis-detect feature support.
  return fallbackSanitize(sanitized);
}

function fallbackSanitize(html: string): string {
  // DOMPurify only reports unsupported in incomplete DOM shims and unusually
  // old embeddings. Keep a fail-closed DOM walk for those environments rather
  // than returning its documented no-op result.
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const node of doc.body.querySelectorAll(
    "script,style,iframe,object,embed,base,form,template,svg,math",
  )) {
    node.remove();
  }
  for (const element of doc.body.querySelectorAll("*")) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on") || name === "style" || name === "srcdoc") {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (["href", "src", "xlink:href", "action", "formaction", "poster"].includes(name)) {
        const normalized = attribute.value.trim().replace(/[\u0000-\u0020]+/g, "").toLowerCase();
        const safeImageData = name === "src" && normalized.startsWith("data:image/");
        if (!safeImageData && /^(?:javascript|vbscript|data):/.test(normalized)) {
          element.removeAttribute(attribute.name);
        }
      }
    }
  }
  return doc.body.innerHTML;
}
