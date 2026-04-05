import { ItemView, WorkspaceLeaf, Notice, TFile } from "obsidian";
import type VaultHubPlugin from "../main";

export const VIEW_TYPE_BROWSE = "vault-hub-browse";

const SUPABASE_URL = "https://oxvxiqiushhpwzqtpzdg.supabase.co";
const SUPABASE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im94dnhpcWl1c2hocHd6cXRwemRnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0MTI4NjAsImV4cCI6MjA5MDk4ODg2MH0.jOJloJvJmV2Q-xuY1wBbUjg0s7DnRGt6htycj4HBtEA";

interface ResourceSummary {
  id: string;
  type: string;
  title: string;
  owner: string;
  repo_name: string;
  full_name: string;
  tagline: string | null;
  stars: number;
  vote_count: number;
}

export class BrowseView extends ItemView {
  plugin: VaultHubPlugin;
  searchQuery = "";
  resources: ResourceSummary[] = [];

  constructor(leaf: WorkspaceLeaf, plugin: VaultHubPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_BROWSE;
  }

  getDisplayText(): string {
    return "Vault Hub";
  }

  getIcon(): string {
    return "globe";
  }

  async onOpen() {
    this.render();
    await this.loadResources();
  }

  async onClose() {
    this.contentEl.empty();
  }

  private render() {
    const c = this.contentEl;
    c.empty();
    c.addClass("vault-hub-browse");

    const header = c.createDiv("vault-hub-browse-header");
    header.createEl("h3", { text: "Vault Hub" });

    const searchRow = header.createDiv("vault-hub-search-row");
    const input = searchRow.createEl("input", {
      type: "text",
      placeholder: "Search resources...",
    });
    input.value = this.searchQuery;
    input.addEventListener("input", () => {
      this.searchQuery = input.value;
    });
    input.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") this.loadResources();
    });

    const searchBtn = searchRow.createEl("button", { text: "Search" });
    searchBtn.addEventListener("click", () => this.loadResources());

    c.createDiv("vault-hub-results");
  }

  private async loadResources() {
    const resultsEl = this.contentEl.querySelector(".vault-hub-results");
    if (!resultsEl) return;

    resultsEl.empty();
    resultsEl.createEl("p", { text: "Loading...", cls: "vault-hub-hint" });

    try {
      let url = `${SUPABASE_URL}/rest/v1/resources?select=id,type,title,owner,repo_name,full_name,tagline,stars,vote_count&is_active=eq.true&order=trending_score.desc&limit=30`;

      if (this.searchQuery.trim()) {
        url += `&or=(title.ilike.*${encodeURIComponent(this.searchQuery)}*,description.ilike.*${encodeURIComponent(this.searchQuery)}*)`;
      }

      const res = await fetch(url, {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
      });

      this.resources = await res.json();
      this.renderResults(resultsEl as HTMLElement);
    } catch (e) {
      resultsEl.empty();
      resultsEl.createEl("p", { text: `Error: ${e}` });
    }
  }

  private renderResults(container: HTMLElement) {
    container.empty();

    if (this.resources.length === 0) {
      container.createEl("p", {
        text: "No resources found.",
        cls: "vault-hub-hint",
      });
      return;
    }

    this.resources.forEach((r) => {
      const card = container.createDiv("vault-hub-result-card");

      const typeColors: Record<string, string> = {
        vault: "#7f6df2",
        snippet: "#22d3ee",
        note: "#fb923c",
      };

      const badge = card.createSpan("vault-hub-type-badge");
      badge.setText(r.type);
      badge.style.backgroundColor = typeColors[r.type] || "#666";

      const title = card.createEl("h4");
      title.setText(r.title);

      if (r.tagline) {
        card.createEl("p", { text: r.tagline, cls: "vault-hub-hint" });
      }

      const meta = card.createDiv("vault-hub-result-meta");
      meta.createSpan({ text: `${r.stars} stars` });
      meta.createSpan({ text: `${r.vote_count} votes` });
      meta.createSpan({ text: r.owner });

      const actions = card.createDiv("vault-hub-result-actions");

      const installBtn = actions.createEl("button", { text: "Install" });
      installBtn.addEventListener("click", () => this.installResource(r));

      const ghBtn = actions.createEl("button", { text: "GitHub" });
      ghBtn.addEventListener("click", () => {
        window.open(`https://github.com/${r.full_name}`, "_blank");
      });
    });
  }

  private async installResource(r: ResourceSummary) {
    try {
      // Fetch file list from GitHub
      const res = await fetch(
        `https://api.github.com/repos/${r.full_name}/contents`,
        { headers: { Accept: "application/vnd.github.v3+json" } }
      );
      const files = await res.json();

      if (r.type === "snippet") {
        const cssFile = files.find(
          (f: { name: string }) => f.name.endsWith(".css")
        );
        if (cssFile) {
          const raw = await fetch(cssFile.download_url);
          const content = await raw.text();
          const snippetPath = `${this.app.vault.configDir}/snippets/${cssFile.name}`;
          await this.app.vault.adapter.write(snippetPath, content);
          new Notice(`Installed snippet: ${cssFile.name}`);
        }
      } else {
        const mdFiles = files.filter(
          (f: { name: string }) =>
            f.name.endsWith(".md") && f.name !== "README.md"
        );
        for (const f of mdFiles) {
          const raw = await fetch(f.download_url);
          const content = await raw.text();
          await this.app.vault.create(f.name, content);
          new Notice(`Installed: ${f.name}`);
        }
      }
    } catch (e) {
      new Notice(`Install failed: ${e}`);
    }
  }
}
