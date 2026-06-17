/** Lightweight Markdown → HTML for live document preview */
export function renderMarkdown(md) {
  if (!md) return "";
  const esc = (s) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const lines = md.split(/\r?\n/);
  const out = [];
  let inP = false;

  const closeP = () => {
    if (inP) {
      out.push("</p>");
      inP = false;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      closeP();
      continue;
    }
    if (line.startsWith("# ")) {
      closeP();
      out.push(`<h1>${inline(esc(line.slice(2)))}</h1>`);
      continue;
    }
    if (line.startsWith("## ")) {
      closeP();
      out.push(`<h2>${inline(esc(line.slice(3)))}</h2>`);
      continue;
    }
    if (line.startsWith("### ")) {
      closeP();
      out.push(`<h3>${inline(esc(line.slice(4)))}</h3>`);
      continue;
    }
    if (line.startsWith("- ") || line.startsWith("* ")) {
      closeP();
      out.push(`<li>${inline(esc(line.slice(2)))}</li>`);
      continue;
    }
    if (!inP) {
      out.push("<p>");
      inP = true;
    } else {
      out.push("<br/>");
    }
    out.push(inline(esc(line)));
  }
  closeP();
  return out.join("");
}

function inline(text) {
  return text
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}