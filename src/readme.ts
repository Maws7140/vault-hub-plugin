import { DetectedPlugin } from "./detection";

export interface ReadmeData {
  name: string;
  tagline: string;
  description: string;
  type: "snippet" | "note" | "vault";
  plugins: DetectedPlugin[];
  files: { path: string }[];
  attachedSnippets: { path: string; name?: string; optional?: boolean }[];
  screenshots: { path: string; alt?: string }[];
}

export function generateReadme(data: ReadmeData): string {
  const lines: string[] = [];

  lines.push(`# ${data.name}`);
  lines.push("");
  lines.push(data.tagline);
  lines.push("");
  lines.push("## Description");
  lines.push("");
  lines.push(data.description);
  lines.push("");

  const selected = data.plugins.filter((p) => p.autoDetected);
  const attachedSnippets = data.attachedSnippets || [];
  const screenshots = data.screenshots || [];
  if (selected.length > 0) {
    lines.push("## Required Plugins");
    lines.push("");
    lines.push("| Plugin | Version | Link |");
    lines.push("|--------|---------|------|");
    selected.forEach((p) => {
      lines.push(
        `| ${p.name} | ${p.version} | [GitHub](https://github.com/search?q=${encodeURIComponent(p.name + " obsidian")}) |`
      );
    });
    lines.push("");
  }

  if (attachedSnippets.length > 0) {
    lines.push("## Attached Snippets");
    lines.push("");
    attachedSnippets.forEach((snippet) => {
      lines.push(
        `- \`${snippet.path}\`${snippet.optional ? " (optional)" : ""}${snippet.name ? ` — ${snippet.name}` : ""}`
      );
    });
    lines.push("");
  }

  if (screenshots.length > 0) {
    lines.push("## Screenshots");
    lines.push("");
    screenshots.forEach((screenshot) => {
      const alt = screenshot.alt || screenshot.path.split("/").pop() || "Screenshot";
      lines.push(`![${alt}](${screenshot.path})`);
      lines.push("");
    });
  }

  lines.push("## Installation");
  lines.push("");

  if (data.type === "snippet") {
    lines.push(
      `1. Download \`${data.files[0]?.path || "snippet.css"}\` from this repo`
    );
    lines.push(
      "2. Place it in your vault's `.obsidian/snippets/` folder"
    );
    lines.push("3. Enable it in Settings > Appearance > CSS Snippets");
  } else if (data.type === "vault") {
    lines.push("1. Download or clone this repo");
    lines.push("2. Open the folder as an Obsidian vault");
    if (attachedSnippets.length > 0) {
      lines.push("3. Copy the attached CSS snippet files into `.obsidian/snippets/`");
      lines.push("4. Enable them in Settings > Appearance > CSS Snippets");
      if (selected.length > 0) {
        lines.push("5. Install or enable the required plugins listed above");
      }
    } else if (selected.length > 0) {
      lines.push("3. Install or enable the required plugins listed above");
    }
  } else {
    lines.push("1. Download the `.md` file(s) from this repo");
    lines.push("2. Place them in your vault");
    if (attachedSnippets.length > 0) {
      lines.push("3. Copy the attached CSS snippet files into `.obsidian/snippets/`");
      lines.push("4. Enable them in Settings > Appearance > CSS Snippets");
      if (selected.length > 0) {
        lines.push("5. Install the required plugins listed above");
      }
    } else if (selected.length > 0) {
      lines.push("3. Install the required plugins listed above");
    }
  }

  lines.push("");
  lines.push("---");
  lines.push("*Published via [Vault Hub](https://obsidianvaulthub.com)*");
  lines.push("");

  return lines.join("\n");
}

export function syncReadmeScreenshots(
  readme: string,
  screenshots: { path: string; alt?: string }[]
): string {
  const normalized = readme.replace(/\r\n/g, "\n");
  const section = buildScreenshotSection(screenshots);
  const pattern = /## Screenshots\n\n[\s\S]*?(?=\n## |\n---\n|\s*$)/;

  if (section) {
    if (pattern.test(normalized)) {
      return normalized.replace(pattern, section.trimEnd());
    }
    const installHeading = "\n## Installation";
    if (normalized.includes(installHeading)) {
      return normalized.replace(installHeading, `\n${section}${installHeading}`);
    }
    return `${normalized.trimEnd()}\n\n${section}`;
  }

  if (pattern.test(normalized)) {
    return `${normalized.replace(pattern, "").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
  }

  return normalized;
}

function buildScreenshotSection(
  screenshots: { path: string; alt?: string }[]
): string {
  if (screenshots.length === 0) return "";

  const lines: string[] = ["## Screenshots", ""];
  screenshots.forEach((screenshot) => {
    const alt = screenshot.alt || screenshot.path.split("/").pop() || "Screenshot";
    lines.push(`![${alt}](${screenshot.path})`);
    lines.push("");
  });
  return `${lines.join("\n")}\n`;
}
