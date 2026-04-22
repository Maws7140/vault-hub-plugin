import { DetectedPlugin } from "./detection";

export interface HubMdData {
  type: "snippet" | "note" | "vault";
  name: string;
  tagline: string;
  description: string;
  author: string;
  categories: string[];
  tags: string[];
  compatibleThemes: string[];
  screenshots: string[];
  plugins: DetectedPlugin[];
  attachedSnippets: { path: string; name?: string; optional?: boolean }[];
  obsidianVersion: string;
  theme: string;
  os: string;
  files: { path: string; type: string; size: number }[];
  body: string;
}

export function generateHubMd(data: HubMdData): string {
  const lines: string[] = [];
  lines.push("---");
  lines.push("schema: 1");
  lines.push(`type: ${data.type}`);
  lines.push(`name: "${esc(data.name)}"`);
  lines.push(`tagline: "${esc(data.tagline)}"`);
  lines.push("description: |");
  data.description.split("\n").forEach((line) => lines.push(`  ${line}`));
  lines.push(`author: ${data.author}`);

  lines.push("categories:");
  data.categories.forEach((category) => lines.push(`  - ${category}`));

  if (data.tags.length > 0) {
    lines.push("tags:");
    data.tags.forEach((tag) => lines.push(`  - ${tag}`));
  }

  if (data.compatibleThemes.length > 0) {
    lines.push("compatible_themes:");
    data.compatibleThemes.forEach((theme) => lines.push(`  - ${theme}`));
  }

  if (data.screenshots.length > 0) {
    lines.push("screenshots:");
    data.screenshots.forEach((screenshot) => lines.push(`  - ${screenshot}`));
  }

  const selected = data.plugins.filter((plugin) => plugin.autoDetected);
  if (selected.length > 0) {
    lines.push("plugins:");
    selected.forEach((plugin) => {
      lines.push(`  - id: ${plugin.id}`);
      lines.push(`    name: "${esc(plugin.name)}"`);
      lines.push(`    version: "${esc(plugin.version)}"`);
    });
  }

  if (data.attachedSnippets.length > 0) {
    lines.push("attached_snippets:");
    data.attachedSnippets.forEach((snippet) => {
      lines.push(`  - path: "${esc(snippet.path)}"`);
      if (snippet.name) lines.push(`    name: "${esc(snippet.name)}"`);
      if (snippet.optional) lines.push("    optional: true");
    });
  }

  lines.push("environment:");
  lines.push(`  obsidian_version: "${esc(data.obsidianVersion)}"`);
  lines.push(`  theme: "${esc(data.theme)}"`);
  lines.push(`  os: "${esc(data.os)}"`);

  lines.push("files:");
  data.files.forEach((file) => {
    lines.push(`  - path: "${esc(file.path)}"`);
    lines.push(`    type: ${file.type}`);
    lines.push(`    size: ${file.size}`);
  });

  lines.push("---");
  lines.push("");
  lines.push(data.body.trim());
  lines.push("");

  return lines.join("\n");
}

function esc(value: string | undefined): string {
  return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
