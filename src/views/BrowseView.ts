import { ItemView, WorkspaceLeaf, Notice } from "obsidian";
import type VaultHubPlugin from "../main";

export const VIEW_TYPE_BROWSE = "vault-hub-browse";

interface ResourceSummary {
  id: string;
  type: "vault" | "snippet" | "note";
  rawType?: "vault" | "snippet" | "note" | "dashboard";
  subtype?: "dashboard" | null;
  title: string;
  owner: string;
  repo_name: string;
  full_name: string;
  tagline: string | null;
  stars: number;
  categories?: string[];
  tags?: string[];
}

interface HubMdAttachedSnippet {
  path: string;
  name?: string;
  optional?: boolean;
}

const TYPE_FILTERS = ["all", "vault", "snippet", "note", "dashboard"] as const;
type TypeFilter = typeof TYPE_FILTERS[number];

function normalizeToken(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_]+/g, "-");
}

function hasDashboardMarker(values?: string[] | null): boolean {
  return (values || []).some((value) => normalizeToken(value) === "dashboard");
}

function normalizeResource(resource: Omit<ResourceSummary, "type"> & { type: string }): ResourceSummary {
  const rawType = resource.rawType || resource.type;
  const subtype =
    rawType === "dashboard" || hasDashboardMarker(resource.categories) || hasDashboardMarker(resource.tags)
      ? "dashboard"
      : null;

  return {
    ...resource,
    rawType: rawType as ResourceSummary["rawType"],
    type: rawType === "dashboard" ? "note" : (rawType as ResourceSummary["type"]),
    subtype,
  };
}

function getDisplayKind(resource: ResourceSummary): "vault" | "snippet" | "note" | "dashboard" {
  return resource.subtype === "dashboard" ? "dashboard" : resource.type;
}

function isDashboardResource(resource: ResourceSummary): boolean {
  return resource.subtype === "dashboard";
}

function encodeGitHubPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function basename(path: string): string {
  return path.split("/").pop() || path;
}

function extractFrontmatter(text: string): string | null {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  return match ? match[1] : null;
}

function parseRequiredPluginIds(frontmatter: string): string[] {
  const ids: string[] = [];
  let inPlugins = false;
  for (const line of frontmatter.split(/\r?\n/)) {
    if (/^plugins:\s*$/.test(line.trim())) {
      inPlugins = true;
      continue;
    }
    if (inPlugins && /^[A-Za-z0-9_-][^:]*:\s*/.test(line)) break;
    if (!inPlugins) continue;
    const match = line.match(/^\s*-\s*id:\s*(.+)\s*$/);
    if (match) ids.push(match[1].trim().replace(/^["']|["']$/g, ""));
  }
  return ids;
}

function parseAttachedSnippets(frontmatter: string): HubMdAttachedSnippet[] {
  const snippets: HubMdAttachedSnippet[] = [];
  let inAttachedSnippets = false;
  let current: HubMdAttachedSnippet | null = null;

  const pushCurrent = () => {
    if (current?.path) snippets.push(current);
    current = null;
  };

  for (const line of frontmatter.split(/\r?\n/)) {
    if (/^attached_snippets:\s*$/.test(line.trim())) {
      inAttachedSnippets = true;
      continue;
    }
    if (inAttachedSnippets && /^[A-Za-z0-9_-][^:]*:\s*/.test(line)) {
      pushCurrent();
      break;
    }
    if (!inAttachedSnippets) continue;

    const pathMatch = line.match(/^\s*-\s*path:\s*(.+)\s*$/);
    if (pathMatch) {
      pushCurrent();
      current = { path: pathMatch[1].trim().replace(/^["']|["']$/g, "") };
      continue;
    }

    const nameMatch = line.match(/^\s+name:\s*(.+)\s*$/);
    if (nameMatch && current) {
      current.name = nameMatch[1].trim().replace(/^["']|["']$/g, "");
      continue;
    }

    const optionalMatch = line.match(/^\s+optional:\s*(.+)\s*$/);
    if (optionalMatch && current) {
      current.optional = optionalMatch[1].trim().toLowerCase() === "true";
    }
  }

  pushCurrent();
  return snippets;
}

export class BrowseView extends ItemView {
  plugin: VaultHubPlugin;
  searchQuery = "";
  resources: ResourceSummary[] = [];
  activeTab: "browse" | "snippets" = "browse";
  filterType: TypeFilter = "all";

  constructor(leaf: WorkspaceLeaf, plugin: VaultHubPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string { return VIEW_TYPE_BROWSE; }
  getDisplayText(): string { return "Vault Hub"; }
  getIcon(): string { return "globe"; }

  async onOpen() {
    this.render();
    await this.loadActiveTab();
  }

  async onClose() {
    this.contentEl.empty();
  }

  private async loadActiveTab() {
    if (this.activeTab === "browse") {
      await this.loadResources();
    } else {
      await this.renderSnippetManager();
    }
  }

  private render() {
    const c = this.contentEl;
    c.empty();
    c.addClass("vault-hub-browse");

    const tabBar = c.createDiv("vault-hub-tabs");
    (["browse", "snippets"] as const).forEach((tab) => {
      const btn = tabBar.createEl("button", {
        text: tab === "browse" ? "Browse" : "Snippets",
        cls: `vault-hub-tab${this.activeTab === tab ? " active" : ""}`,
      });
      btn.addEventListener("click", async () => {
        if (this.activeTab === tab) return;
        this.activeTab = tab;
        this.render();
        await this.loadActiveTab();
      });
    });

    if (this.activeTab === "browse") {
      const header = c.createDiv("vault-hub-browse-header");
      const searchRow = header.createDiv("vault-hub-search-row");
      const input = searchRow.createEl("input", {
        type: "text",
        placeholder: "Search resources...",
      });
      input.value = this.searchQuery;
      input.addEventListener("input", () => { this.searchQuery = input.value; });
      input.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key === "Enter") this.loadResources();
      });
      const searchBtn = searchRow.createEl("button", { text: "Search" });
      searchBtn.addEventListener("click", () => this.loadResources());

      // Type filter tabs
      const typeRow = c.createDiv("vault-hub-type-filters");
      TYPE_FILTERS.forEach((type) => {
        const btn = typeRow.createEl("button", {
          text: type === "all" ? "All" : type[0].toUpperCase() + type.slice(1),
          cls: `vault-hub-type-filter${this.filterType === type ? " active" : ""}`,
        });
        if (type !== "all") {
          btn.dataset.type = type;
        }
        btn.addEventListener("click", async () => {
          this.filterType = type;
          // Update active state without full re-render
          typeRow.querySelectorAll(".vault-hub-type-filter").forEach((b) => b.removeClass("active"));
          btn.addClass("active");
          await this.loadResources();
        });
      });

      c.createDiv("vault-hub-results");
    } else {
      c.createDiv("vault-hub-snippets-container");
    }
  }

  // ─── BROWSE TAB ───────────────────────────────────────────────

  private async loadResources() {
    const resultsEl = this.contentEl.querySelector(".vault-hub-results") as HTMLElement | null;
    if (!resultsEl) return;

    resultsEl.empty();
    resultsEl.createEl("p", { text: "Loading...", cls: "vault-hub-hint" });

    try {
      const limit = this.filterType === "dashboard" ? 100 : 30;
      const baseUrl = this.plugin.settings.vaultHubUrl.replace(/\/+$/, "");
      const params = new URLSearchParams({ limit: String(limit) });
      if (this.filterType !== "all") {
        params.set("type", this.filterType);
      }
      if (this.searchQuery.trim()) {
        params.set("q", this.searchQuery.trim());
      }

      const res = await fetch(`${baseUrl}/api/search?${params.toString()}`);

      const data = await res.json();
      if (!res.ok || !Array.isArray(data)) {
        throw new Error(data?.error || data?.message || data?.hint || "Unexpected response from API");
      }
      let resources = (data as Array<Omit<ResourceSummary, "type"> & { type: string }>).map((resource) =>
        normalizeResource(resource)
      );
      if (this.filterType === "dashboard") {
        resources = resources.filter((resource) => isDashboardResource(resource));
      }
      this.resources = resources;
      this.renderResults(resultsEl);
    } catch (e) {
      resultsEl.empty();
      resultsEl.createEl("p", { text: `Error: ${e}` });
    }
  }

  private renderResults(container: HTMLElement) {
    container.empty();
    if (this.resources.length === 0) {
      container.createEl("p", { text: "No resources found.", cls: "vault-hub-hint" });
      return;
    }

    const typeColors: Record<string, string> = {
      vault: "#7f6df2",
      snippet: "#22d3ee",
      note: "#fb923c",
      dashboard: "#4ade80",
    };

    this.resources.forEach((r) => {
      const displayKind = getDisplayKind(r);
      const card = container.createDiv("vault-hub-result-card");

      const badge = card.createSpan("vault-hub-type-badge");
      badge.setText(displayKind === "dashboard" ? "dashboard note" : r.type);
      badge.style.backgroundColor = typeColors[displayKind] || "#666";

      card.createEl("h4", { text: r.title });

      if (r.tagline) {
        card.createEl("p", { text: r.tagline, cls: "vault-hub-hint" });
      }

      const meta = card.createDiv("vault-hub-result-meta");
      meta.createSpan({ text: `${r.stars} stars` });
      meta.createSpan({ text: r.owner });

      const actions = card.createDiv("vault-hub-result-actions");

      const installBtn = actions.createEl("button", { text: "Install" });
      installBtn.addEventListener("click", () => this.installResource(r, installBtn));

      const ghBtn = actions.createEl("button", { text: "GitHub" });
      ghBtn.addEventListener("click", () => {
        window.open(`https://github.com/${r.full_name}`, "_blank");
      });
    });
  }

  // ─── INSTALL FLOWS ────────────────────────────────────────────

  private async installResource(r: ResourceSummary, btn: HTMLButtonElement) {
    btn.disabled = true;
    btn.setText("Installing...");

    try {
      if (r.type === "vault") {
        await this.installVault(r);
      } else if (r.type === "snippet") {
        await this.installSnippet(r);
      } else {
        await this.installNotes(r);
      }
      btn.setText("Installed");
    } catch (e) {
      new Notice(`Install failed: ${e}`);
      btn.disabled = false;
      btn.setText("Install");
    }
  }

  /** Download full vault tree into a named subfolder */
  private async installVault(r: ResourceSummary) {
    const treeRes = await fetch(
      `https://api.github.com/repos/${r.full_name}/git/trees/HEAD?recursive=1`,
      { headers: { Accept: "application/vnd.github.v3+json" } }
    );
    const treeData = await treeRes.json();

    if (!treeRes.ok || !Array.isArray(treeData.tree)) {
      throw new Error(treeData.message || "Failed to fetch repository tree");
    }

    const textExts = /\.(md|canvas|txt|css|js|ts|json|yaml|yml|html|xml|svg|toml|ini|cfg)$/i;
    const blobs = (treeData.tree as { path: string; type: string }[]).filter(
      (item) =>
        item.type === "blob" &&
        !item.path.startsWith(".github/") &&
        textExts.test(item.path)
    );

    const folderName = await this.availableFolder(r.repo_name);
    let installed = 0;
    let failed = 0;

    for (const item of blobs) {
      const destPath = `${folderName}/${item.path}`;
      const dirPath = destPath.split("/").slice(0, -1).join("/");
      await this.ensureDir(dirPath);

      const rawUrl = `https://raw.githubusercontent.com/${r.full_name}/HEAD/${encodeGitHubPath(item.path)}`;
      const raw = await fetch(rawUrl);
      if (!raw.ok) {
        failed++;
        continue;
      }

      await this.app.vault.adapter.write(destPath, await raw.text());
      installed++;
    }

    new Notice(
      `Installed "${r.title}" - ${installed} files in "${folderName}/"${failed ? ` (${failed} failed)` : ""}`
    );

    const hubMd = await this.fetchHubMd(r);
    if (hubMd) {
      await this.notifyRequiredPluginsFromContent(hubMd, r.title);
    }
  }

  private async ensureDir(dirPath: string) {
    if (!dirPath) return;
    const parts = dirPath.split("/");
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!(await this.app.vault.adapter.exists(current))) {
        await this.app.vault.adapter.mkdir(current);
      }
    }
  }

  private async availablePath(path: string): Promise<string> {
    if (!(await this.app.vault.adapter.exists(path))) return path;

    const slash = path.lastIndexOf("/");
    const dir = slash >= 0 ? path.slice(0, slash + 1) : "";
    const file = slash >= 0 ? path.slice(slash + 1) : path;
    const dot = file.lastIndexOf(".");
    const stem = dot > 0 ? file.slice(0, dot) : file;
    const ext = dot > 0 ? file.slice(dot) : "";

    let suffix = 2;
    let candidate = `${dir}${stem}-${suffix}${ext}`;
    while (await this.app.vault.adapter.exists(candidate)) {
      suffix++;
      candidate = `${dir}${stem}-${suffix}${ext}`;
    }
    return candidate;
  }

  private async availableFolder(baseName: string): Promise<string> {
    let candidate = baseName;
    let suffix = 2;
    while (await this.app.vault.adapter.exists(candidate)) {
      candidate = `${baseName}-${suffix}`;
      suffix++;
    }
    return candidate;
  }

  private async fetchHubMd(r: ResourceSummary): Promise<string | null> {
    const raw = await fetch(`https://raw.githubusercontent.com/${r.full_name}/HEAD/hub.md`);
    if (!raw.ok) return null;
    return raw.text();
  }

  private async notifyRequiredPluginsFromContent(hubMd: string, title: string) {
    try {
      const frontmatter = extractFrontmatter(hubMd);
      if (!frontmatter) return;
      const ids = parseRequiredPluginIds(frontmatter);
      if (ids.length === 0) return;

      const installedPlugins = Object.keys(
        (this.app as unknown as { plugins?: { plugins?: Record<string, unknown> } })
          .plugins?.plugins || {}
      );
      const missing = ids.filter((id) => !installedPlugins.includes(id));

      if (missing.length === 0) {
        new Notice(`All required plugins already installed for "${title}"`);
      } else {
        new Notice(
          `"${title}" needs ${missing.length} plugin(s): ${missing.join(", ")}. Install from Community Plugins.`,
          10000
        );
      }
    } catch {
      // hub.md parse failure is non-fatal
    }
  }

  /** Download CSS files to .obsidian/snippets/ */
  private async installSnippet(r: ResourceSummary) {
    const treeRes = await fetch(
      `https://api.github.com/repos/${r.full_name}/git/trees/HEAD?recursive=1`,
      { headers: { Accept: "application/vnd.github.v3+json" } }
    );
    const treeData = await treeRes.json();

    if (!treeRes.ok || !Array.isArray(treeData.tree)) {
      throw new Error(treeData.message || "Failed to fetch repository tree");
    }

    const cssFiles = (treeData.tree as { path: string; type: string }[]).filter(
      (f) => f.type === "blob" && f.path.endsWith(".css")
    );
    if (cssFiles.length === 0) {
      throw new Error("No CSS files found in this snippet repository");
    }

    const snippetsDir = `${this.app.vault.configDir}/snippets`;
    if (!(await this.app.vault.adapter.exists(snippetsDir))) {
      await this.app.vault.adapter.mkdir(snippetsDir);
    }

    for (const f of cssFiles) {
      const raw = await fetch(`https://raw.githubusercontent.com/${r.full_name}/HEAD/${encodeGitHubPath(f.path)}`);
      if (!raw.ok) throw new Error(`Failed to download ${f.path}`);
      const target = await this.availablePath(`${snippetsDir}/${basename(f.path)}`);
      await this.app.vault.adapter.write(target, await raw.text());
    }

    new Notice(
      `Installed ${cssFiles.length} snippet(s) from "${r.title}" - enable in Settings → Appearance → CSS snippets`
    );
  }

  /** Download .md files into a named folder */
  private async installNotes(r: ResourceSummary) {
    const hubMd = await this.fetchHubMd(r);
    const treeRes = await fetch(
      `https://api.github.com/repos/${r.full_name}/git/trees/HEAD?recursive=1`,
      { headers: { Accept: "application/vnd.github.v3+json" } }
    );
    const treeData = await treeRes.json();

    if (!treeRes.ok || !Array.isArray(treeData.tree)) {
      throw new Error(treeData.message || "Failed to fetch repository tree");
    }

    const mdFiles = (treeData.tree as { path: string; type: string }[]).filter(
      (f) =>
        f.type === "blob" &&
        f.path.endsWith(".md") &&
        basename(f.path).toLowerCase() !== "readme.md"
    );

    if (mdFiles.length === 0) {
      throw new Error("No note files found in this repository");
    }

    const folderName = await this.availableFolder(r.repo_name);
    let installed = 0;
    for (const f of mdFiles) {
      const raw = await fetch(`https://raw.githubusercontent.com/${r.full_name}/HEAD/${encodeGitHubPath(f.path)}`);
      if (!raw.ok) throw new Error(`Failed to download ${f.path}`);
      const destPath = `${folderName}/${f.path}`;
      await this.ensureDir(destPath.split("/").slice(0, -1).join("/"));
      await this.app.vault.adapter.write(destPath, await raw.text());
      installed++;
    }

    new Notice(`Installed ${installed} note(s) from "${r.title}" in "${folderName}/"`);

    if (hubMd) {
      await this.installAttachedSnippets(r, hubMd);
      await this.notifyRequiredPluginsFromContent(hubMd, r.title);
    }
  }

  private async installAttachedSnippets(r: ResourceSummary, hubMd: string) {
    const frontmatter = extractFrontmatter(hubMd);
    if (!frontmatter) return;

    const attachedSnippets = parseAttachedSnippets(frontmatter);
    if (attachedSnippets.length === 0) return;

    const snippetsDir = `${this.app.vault.configDir}/snippets`;
    if (!(await this.app.vault.adapter.exists(snippetsDir))) {
      await this.app.vault.adapter.mkdir(snippetsDir);
    }

    let installed = 0;
    let failed = 0;

    for (const snippet of attachedSnippets) {
      try {
        const raw = await fetch(
          `https://raw.githubusercontent.com/${r.full_name}/HEAD/${encodeGitHubPath(snippet.path)}`
        );
        if (!raw.ok) {
          failed++;
          continue;
        }
        const target = await this.availablePath(`${snippetsDir}/${basename(snippet.path)}`);
        await this.app.vault.adapter.write(target, await raw.text());
        installed++;
      } catch {
        failed++;
      }
    }

    if (installed > 0 || failed > 0) {
      new Notice(
        `Installed ${installed} attached snippet(s) from "${r.title}"${failed ? ` (${failed} failed)` : ""}`
      );
    }
  }

  // ─── SNIPPET MANAGER ─────────────────────────────────────────

  private async renderSnippetManager() {
    const container = this.contentEl.querySelector(".vault-hub-snippets-container") as HTMLElement | null;
    if (!container) return;

    container.empty();

    const snippetsDir = `${this.app.vault.configDir}/snippets`;
    let files: string[] = [];

    try {
      const listing = await this.app.vault.adapter.list(snippetsDir);
      files = listing.files
        .filter((f) => f.endsWith(".css"))
        .map((f) => f.split("/").pop()!);
    } catch {
      container.createEl("p", { text: "No snippets folder found.", cls: "vault-hub-hint" });
      return;
    }

    if (files.length === 0) {
      container.createEl("p", { text: "No snippets installed.", cls: "vault-hub-hint" });
      return;
    }

    let enabledSnippets: string[] = [];
    try {
      const raw = await this.app.vault.adapter.read(
        `${this.app.vault.configDir}/appearance.json`
      );
      enabledSnippets = JSON.parse(raw)?.enabledCssSnippets || [];
    } catch {
      // appearance.json may not exist
    }

    const list = container.createDiv("vault-hub-snippet-list");

    for (const fileName of files) {
      const snippetId = fileName.replace(/\.css$/, "");
      const isEnabled = enabledSnippets.includes(snippetId);

      const row = list.createDiv("vault-hub-snippet-row");
      row.createSpan({ text: snippetId, cls: "vault-hub-snippet-name" });

      const actions = row.createDiv("vault-hub-snippet-actions");

      const toggleBtn = actions.createEl("button", {
        text: isEnabled ? "Enabled" : "Disabled",
        cls: `vault-hub-snippet-toggle${isEnabled ? " on" : ""}`,
      });
      toggleBtn.addEventListener("click", async () => {
        await this.setSnippetEnabled(snippetId, !isEnabled);
        await this.renderSnippetManager();
      });

      const deleteBtn = actions.createEl("button", {
        text: "Delete",
        cls: "vault-hub-snippet-delete",
      });
      deleteBtn.addEventListener("click", async () => {
        if (confirm(`Delete snippet "${snippetId}"?`)) {
          await this.app.vault.adapter.remove(`${snippetsDir}/${fileName}`);
          new Notice(`Deleted: ${snippetId}`);
          await this.renderSnippetManager();
        }
      });
    }
  }

  private async setSnippetEnabled(snippetId: string, enable: boolean) {
    // Try Obsidian's internal API first - applies instantly without restart
    const css = (this.app as unknown as {
      customCss?: {
        enabledSnippets?: Set<string>;
        requestLoadSnippets?: () => void;
        setCssEnabledStatus?: (id: string, enabled: boolean) => void;
      };
    }).customCss;

    if (css) {
      if (css.setCssEnabledStatus) {
        css.setCssEnabledStatus(snippetId, enable);
        css.requestLoadSnippets?.();
        new Notice(`Snippet "${snippetId}" ${enable ? "enabled" : "disabled"}`);
        return;
      }
      if (css.enabledSnippets) {
        if (enable) css.enabledSnippets.add(snippetId);
        else css.enabledSnippets.delete(snippetId);
        css.requestLoadSnippets?.();
        new Notice(`Snippet "${snippetId}" ${enable ? "enabled" : "disabled"}`);
        return;
      }
    }

    // Fallback: edit appearance.json directly
    try {
      const appearancePath = `${this.app.vault.configDir}/appearance.json`;
      let appearance: Record<string, unknown> = {};
      try {
        appearance = JSON.parse(await this.app.vault.adapter.read(appearancePath));
      } catch { /* new file */ }

      const enabled: string[] = (appearance.enabledCssSnippets as string[]) || [];
      if (enable && !enabled.includes(snippetId)) {
        enabled.push(snippetId);
      } else if (!enable) {
        const i = enabled.indexOf(snippetId);
        if (i !== -1) enabled.splice(i, 1);
      }
      appearance.enabledCssSnippets = enabled;
      await this.app.vault.adapter.write(appearancePath, JSON.stringify(appearance, null, 2));
      new Notice(`Snippet "${snippetId}" ${enable ? "enabled" : "disabled"} - reload to apply`);
    } catch (e) {
      new Notice(`Failed to toggle snippet: ${e}`);
    }
  }
}
