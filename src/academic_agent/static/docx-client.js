/* Client-side Markdown → DOCX (Grok-style JS export, no server required) */
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
} from "https://cdn.jsdelivr.net/npm/docx@8.5.0/+esm";

function unwrapMarkdownSpans(text) {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "$1");
}

function normalizeEtAl(text) {
  return text.replace(/\bet\s+al\.?/gi, "et\u00a0al.");
}

function prepareInlineText(text) {
  return normalizeEtAl(
    text
      .replace(/\*\*([^*]*et\s+al\.?[^*]*)\*\*/gi, "$1")
      .replace(/(?<!\*)\*([^*]*et\s+al\.?[^*]*)\*(?!\*)/gi, "$1")
      .replace(/\(([^)]*\d{4}[a-z]?[^)]*)\)/g, (_, inner) => `(${unwrapMarkdownSpans(inner)})`)
  );
}

function stripInline(text) {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "$1")
    .replace(/`([^`]+)`/g, "$1");
}

function inlineRuns(text) {
  const prepared = prepareInlineText(text);
  const runs = [];
  const pattern = /(\*\*[^*\n]+?\*\*|\*[^*\n]+?\*|`[^`\n]+`)/g;
  let pos = 0;
  let m;
  while ((m = pattern.exec(prepared)) !== null) {
    if (m.index > pos) runs.push(new TextRun(stripInline(prepared.slice(pos, m.index))));
    const token = m[0];
    if (token.startsWith("**")) {
      runs.push(new TextRun({ text: token.slice(2, -2), bold: true }));
    } else if (token.startsWith("*")) {
      runs.push(new TextRun({ text: token.slice(1, -1), italics: true }));
    } else {
      runs.push(new TextRun({ text: token.slice(1, -1), font: "Consolas" }));
    }
    pos = m.index + token.length;
  }
  if (pos < prepared.length) runs.push(new TextRun(stripInline(prepared.slice(pos))));
  return runs.length ? runs : [new TextRun(prepared)];
}

function mdToParagraphs(markdown, title) {
  const children = [];
  const lines = markdown.split(/\r?\n/);
  let titleUsed = false;

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;

    if (line.startsWith("# ") && !titleUsed && title) {
      children.push(
        new Paragraph({
          text: title,
          heading: HeadingLevel.TITLE,
          alignment: AlignmentType.CENTER,
        })
      );
      titleUsed = true;
      continue;
    }
    if (line.startsWith("# ")) {
      children.push(new Paragraph({ text: line.slice(2), heading: HeadingLevel.HEADING_1 }));
      continue;
    }
    if (line.startsWith("## ")) {
      children.push(new Paragraph({ text: line.slice(3), heading: HeadingLevel.HEADING_2 }));
      continue;
    }
    if (line.startsWith("### ")) {
      children.push(new Paragraph({ text: line.slice(4), heading: HeadingLevel.HEADING_3 }));
      continue;
    }
    if (line.startsWith("- ") || line.startsWith("* ")) {
      children.push(
        new Paragraph({ children: inlineRuns(line.slice(2)), bullet: { level: 0 } })
      );
      continue;
    }
    if (/^\d+\.\s/.test(line)) {
      children.push(
        new Paragraph({
          children: inlineRuns(line.replace(/^\d+\.\s/, "")),
          numbering: { reference: "default-numbering", level: 0 },
        })
      );
      continue;
    }
    children.push(new Paragraph({ children: inlineRuns(line) }));
  }

  if (!children.length) {
    children.push(new Paragraph({ text: stripInline(markdown) || "(empty)" }));
  }
  return children;
}

export async function downloadDocx(markdown, topic, filename) {
  const safeName = (filename || `${topic || "paper"}.docx`).replace(/[<>:"/\\|?*]/g, "-");
  const name = safeName.toLowerCase().endsWith(".docx") ? safeName : `${safeName}.docx`;

  const doc = new Document({
    numbering: {
      config: [
        {
          reference: "default-numbering",
          levels: [{ level: 0, format: "decimal", text: "%1.", alignment: AlignmentType.START }],
        },
      ],
    },
    sections: [{ children: mdToParagraphs(markdown, topic) }],
  });

  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
  return name;
}