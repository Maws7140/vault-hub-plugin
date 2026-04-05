import { DetectedPlugin } from "./detection";

export interface ReadmeData {
  name: string;
  tagline: string;
  description: string;
  type: "snippet" | "note" | "bundle";
  plugins: DetectedPlugin[];
  files: { path: string }[];
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
  } else {
    lines.push("1. Download the `.md` file(s) from this repo");
    lines.push("2. Place them in your vault");
    if (selected.length > 0) {
      lines.push("3. Install the required plugins listed above");
    }
  }

  lines.push("");
  lines.push("---");
  lines.push("*Published via [Vault Hub](https://vaulthub.dev)*");
  lines.push("");

  return lines.join("\n");
}
