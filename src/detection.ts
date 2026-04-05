import { Vault } from "obsidian";

export interface DetectedPlugin {
  id: string;
  name: string;
  version: string;
  author: string;
  autoDetected: boolean;
}

interface PluginManifest {
  id: string;
  name: string;
  version: string;
  author: string;
}

const MD_PATTERNS: [RegExp, string][] = [
  [/```dataviewjs/m, "dataview"],
  [/```dataview/m, "dataview"],
  [/```datacore/m, "datacore"],
  [/```tasks/m, "obsidian-tasks-plugin"],
  [/```kanban/m, "obsidian-kanban"],
  [/```excalidraw/m, "obsidian-excalidraw-plugin"],
  [/```chart/m, "obsidian-charts"],
  [/```cards-timeline/m, "any-block"],
  [/```button/m, "buttons"],
  [/```meta-bind/m, "obsidian-meta-bind-plugin"],
  [/`=\s*this\./m, "dataview"],
  [/`=\s*dv\./m, "dataview"],
  [/`\$=\s*dv\./m, "dataview"],
  [/<%\s*tp\./m, "templater-obsidian"],
  [/<%[-_*]?\s/m, "templater-obsidian"],
  [/kanban-plugin:/m, "obsidian-kanban"],
  [/^banner:/m, "obsidian-banners"],
];

const CSS_PATTERNS: [RegExp, string][] = [
  [/\.dataview/i, "dataview"],
  [/\.kanban/i, "obsidian-kanban"],
  [/\.tasks-plugin/i, "obsidian-tasks-plugin"],
  [/\.excalidraw/i, "obsidian-excalidraw-plugin"],
  [/\.cm-table-widget/i, "table-editor-obsidian"],
];

export async function getInstalledPlugins(
  vault: Vault
): Promise<DetectedPlugin[]> {
  const plugins: DetectedPlugin[] = [];
  const pluginsDir = `${vault.configDir}/plugins`;

  const listing = await vault.adapter.list(pluginsDir);
  for (const folder of listing.folders) {
    const manifestPath = `${folder}/manifest.json`;
    try {
      const raw = await vault.adapter.read(manifestPath);
      const manifest: PluginManifest = JSON.parse(raw);
      plugins.push({
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        author: manifest.author,
        autoDetected: false,
      });
    } catch {
      // skip plugins without valid manifest
    }
  }

  return plugins;
}

export async function detectPlugins(
  fileContent: string,
  fileType: "css" | "md",
  vault: Vault
): Promise<DetectedPlugin[]> {
  const installed = await getInstalledPlugins(vault);
  const installedIds = new Set(installed.map((p) => p.id));
  const detectedIds = new Set<string>();

  const patterns = fileType === "css" ? CSS_PATTERNS : MD_PATTERNS;

  for (const [regex, pluginId] of patterns) {
    if (regex.test(fileContent) && installedIds.has(pluginId)) {
      detectedIds.add(pluginId);
    }
  }

  return installed.map((p) => ({
    ...p,
    autoDetected: detectedIds.has(p.id),
  }));
}
