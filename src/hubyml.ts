import { DetectedPlugin } from "./detection";

export interface HubYmlData {
  type: "snippet" | "note" | "bundle";
  name: string;
  tagline: string;
  description: string;
  author: string;
  categories: string[];
  tags: string[];
  compatibleThemes: string[];
  screenshots: string[];
  plugins: DetectedPlugin[];
  obsidianVersion: string;
  theme: string;
  os: string;
  files: { path: string; type: string; size: number }[];
}

export function generateHubYml(data: HubYmlData): string {
  const lines: string[] = [];
  lines.push("schema: 1");
  lines.push(`type: ${data.type}`);
  lines.push(`name: "${esc(data.name)}"`);
  lines.push(`tagline: "${esc(data.tagline)}"`);
  lines.push(`description: |`);
  data.description.split("\n").forEach((l) => lines.push(`  ${l}`));
  lines.push(`author: ${data.author}`);

  lines.push("categories:");
  data.categories.forEach((c) => lines.push(`  - ${c}`));

  if (data.tags.length > 0) {
    lines.push("tags:");
    data.tags.forEach((t) => lines.push(`  - ${t}`));
  }

  if (data.compatibleThemes.length > 0) {
    lines.push("compatible_themes:");
    data.compatibleThemes.forEach((t) => lines.push(`  - ${t}`));
  }

  if (data.screenshots.length > 0) {
    lines.push("screenshots:");
    data.screenshots.forEach((s) => lines.push(`  - ${s}`));
  }

  const selected = data.plugins.filter((p) => p.autoDetected);
  if (selected.length > 0) {
    lines.push("plugins:");
    selected.forEach((p) => {
      lines.push(`  - id: ${p.id}`);
      lines.push(`    name: ${p.name}`);
      lines.push(`    version: ${p.version}`);
    });
  }

  lines.push("environment:");
  lines.push(`  obsidian_version: "${data.obsidianVersion}"`);
  lines.push(`  theme: ${data.theme}`);
  lines.push(`  os: ${data.os}`);

  lines.push("files:");
  data.files.forEach((f) => {
    lines.push(`  - path: ${f.path}`);
    lines.push(`    type: ${f.type}`);
    lines.push(`    size: ${f.size}`);
  });

  return lines.join("\n") + "\n";
}

function esc(s: string): string {
  return s.replace(/"/g, '\\"');
}
