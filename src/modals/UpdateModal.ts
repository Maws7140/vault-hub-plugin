import { App, Modal, Setting, Notice, TFile } from "obsidian";
import type VaultHubPlugin from "../main";
import { PublishedFileMapping, PublishedResource } from "../settings";
import { GitHubAPI } from "../github";

type FileStatus = "changed" | "unchanged" | "not-found";

interface FileEntry {
  name: string;
  localPath: string;
  repoPath: string;
  githubSha?: string;
  downloadUrl: string;
  status: FileStatus;
  localContent?: string;
}

export class UpdateModal extends Modal {
  plugin: VaultHubPlugin;
  selected: PublishedResource | null = null;
  files: FileEntry[] = [];
  syncedResources: PublishedResource[] = [];
  selectedHasLocalMappings = false;

  constructor(app: App, plugin: VaultHubPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    void this.renderSelect();
  }

  onClose() {
    this.contentEl.empty();
  }

  // ─── Step 1: select resource ───────────────────────────────

  private async renderSelect() {
    const c = this.contentEl;
    c.empty();
    c.addClass("vault-hub-modal");
    c.createEl("h2", { text: "Update resource" });

    const loading = c.createEl("p", { text: "Loading resources...", cls: "vault-hub-hint" });
    const resources = await this.getSelectableResources();
    loading.remove();

    if (resources.length === 0) {
      c.createEl("p", {
        text: "No published resources yet — publish one first.",
        cls: "vault-hub-hint",
      });
      return;
    }

    new Setting(c).setName("Resource").addDropdown((dd) => {
      dd.addOption("", "Select...");
      resources.forEach((r, i) => {
        const suffix = this.hasLocalMappings(r) ? "" : " — GitHub only";
        dd.addOption(String(i), `${r.repoFullName} (${r.type}) — ${timeAgo(new Date(r.lastPublishedAt))}${suffix}`);
      });
      dd.onChange((v) => {
        this.selected = v ? resources[parseInt(v)] : null;
      });
    });

    const btn = c.createEl("button", { text: "Check for Changes", cls: "mod-cta" });
    btn.style.marginTop = "12px";
    btn.addEventListener("click", async () => {
      if (!this.selected) { new Notice("Select a resource first"); return; }
      if (!this.plugin.settings.githubToken) { new Notice("Set your GitHub token in settings"); return; }
      await this.loadDiff(btn);
    });
  }

  // ─── Step 2: diff ─────────────────────────────────────────

  private async loadDiff(triggerBtn: HTMLButtonElement) {
    triggerBtn.disabled = true;
    triggerBtn.setText("Checking...");

    const token = this.plugin.settings.githubToken;
    const [owner, repo] = this.selected!.repoFullName.split("/");

    try {
      const gh = new GitHubAPI(token);
      const fileMappings = this.getFileMappings(this.selected!);
      this.selectedHasLocalMappings = fileMappings.length > 0;

      this.files = [];

      for (const mapping of fileMappings) {
        if (!mapping.localPath.match(/\.(md|css|yml|yaml|js|json|txt|canvas)$/i)) continue;
        const entry: FileEntry = {
          name: mapping.repoPath,
          localPath: mapping.localPath,
          repoPath: mapping.repoPath,
          downloadUrl: "",
          status: "not-found",
        };

        const local = await this.readLocalContent(mapping.localPath);
        if (local !== null) {
          const remote = await gh.getFileContent(owner, repo, mapping.repoPath);
          entry.localContent = local;
          entry.githubSha = remote?.sha;
          entry.status = !remote || local !== remote.content ? "changed" : "unchanged";
        }

        this.files.push(entry);
      }

      this.renderDiff();
    } catch (e) {
      new Notice(`Error: ${e}`);
      triggerBtn.disabled = false;
      triggerBtn.setText("Check for Changes");
    }
  }

  private renderDiff() {
    const c = this.contentEl;
    c.empty();
    c.createEl("h2", { text: "Review changes" });
    c.createEl("p", { text: this.selected!.repoFullName, cls: "vault-hub-hint" });

    const changed = this.files.filter((f) => f.status === "changed");
    const unchanged = this.files.filter((f) => f.status === "unchanged");
    const notFound = this.files.filter((f) => f.status === "not-found");

    const list = c.createDiv("vault-hub-update-list");

    changed.forEach((f) => {
      const row = list.createDiv("vault-hub-update-row");
      row.createSpan({ text: "~ ", cls: "vault-hub-status-changed" });
      row.createSpan({ text: f.name });
      row.createSpan({ text: " modified", cls: "vault-hub-hint" });
    });

    unchanged.forEach((f) => {
      const row = list.createDiv("vault-hub-update-row");
      row.createSpan({ text: "= ", cls: "vault-hub-status-unchanged" });
      row.createSpan({ text: f.name });
      row.createSpan({ text: " up to date", cls: "vault-hub-hint" });
    });

    notFound.forEach((f) => {
      const row = list.createDiv("vault-hub-update-row");
      row.createSpan({ text: "? ", cls: "vault-hub-status-missing" });
      row.createSpan({ text: f.name });
      row.createSpan({ text: " not found locally", cls: "vault-hub-hint" });
    });

    const nav = c.createDiv("vault-hub-nav");
    const backBtn = nav.createEl("button", { text: "Back" });
    backBtn.addEventListener("click", () => void this.renderSelect());

    if (!this.selectedHasLocalMappings) {
      c.createEl("p", {
        text: "This repo was found from your GitHub account, but this vault has no local file mappings for it yet.",
        cls: "vault-hub-hint",
      });
    } else if (changed.length === 0) {
      c.createEl("p", { text: "Everything is up to date.", cls: "vault-hub-hint" });
    } else {
      const pushBtn = nav.createEl("button", {
        text: `Push ${changed.length} Change${changed.length !== 1 ? "s" : ""}`,
        cls: "mod-cta",
      });
      pushBtn.addEventListener("click", () => this.doPush(changed));
    }
  }

  // ─── Step 3: push ─────────────────────────────────────────

  private async doPush(toUpdate: FileEntry[]) {
    const c = this.contentEl;
    c.empty();
    const statusEl = c.createEl("p", { text: "Pushing...", cls: "vault-hub-hint" });

    const token = this.plugin.settings.githubToken;
    const gh = new GitHubAPI(token);
    const [owner, repo] = this.selected!.repoFullName.split("/");

    try {
      let pushed = 0;
      for (const f of toUpdate) {
        statusEl.setText(`Pushing ${f.name}...`);
        const existing = await gh.getFileContent(owner, repo, f.repoPath);
        if (existing) {
          await gh.updateFile(owner, repo, f.repoPath, f.localContent!, `Update ${f.repoPath}`, existing.sha);
        } else {
          await gh.createFile(owner, repo, f.repoPath, f.localContent!, `Add ${f.repoPath}`);
        }
        pushed++;
      }

      this.selected!.lastPublishedAt = new Date().toISOString();
      await this.plugin.saveSettings();

      let refreshRequested = false;
      const catalogRepo = this.plugin.settings.catalogRepoFullName.trim();
      if (catalogRepo.includes("/")) {
        const [catalogOwner, catalogName] = catalogRepo.split("/");
        try {
          await gh.dispatchRepositoryEvent(catalogOwner, catalogName, "catalog_refresh", {
            source_repo: this.selected!.repoFullName,
            update: true,
          });
          refreshRequested = true;
        } catch {
          refreshRequested = false;
        }
      }

      c.empty();
      c.createEl("h3", { text: "Updated!" });
      c.createEl("p", { text: `Pushed ${pushed} file(s) to ${this.selected!.repoFullName}` });
      c.createEl("p", {
        text: refreshRequested
          ? "Catalog refresh requested."
          : "Catalog refresh was not requested automatically.",
        cls: "vault-hub-hint",
      });

      const [rOwner, rName] = this.selected!.repoFullName.split("/");
      const link = c.createEl("a", {
        text: "View on Vault Hub",
        href: `https://obsidianvaulthub.com/r/${rOwner}/${rName}`,
        cls: "mod-cta vault-hub-success-link",
      });
      link.setAttr("target", "_blank");

      const closeBtn = c.createEl("button", { text: "Close" });
      closeBtn.style.marginTop = "12px";
      closeBtn.addEventListener("click", () => this.close());

      new Notice(`Pushed ${pushed} file(s)!`);
    } catch (e) {
      c.empty();
      c.createEl("h3", { text: "Error" });
      c.createEl("p", { text: String(e) });
      const retryBtn = c.createEl("button", { text: "Back" });
      retryBtn.addEventListener("click", () => this.renderDiff());
    }
  }

  private getFileMappings(resource: PublishedResource): PublishedFileMapping[] {
    if (resource.fileMappings?.length) return resource.fileMappings.filter((mapping) => Boolean(mapping.localPath));
    const localFiles = resource.localFiles?.filter(Boolean) || (resource.localFilePath ? [resource.localFilePath] : []);
    return localFiles.map((path) => ({
      localPath: path,
      repoPath: path,
      kind: "resource",
    }));
  }

  private hasLocalMappings(resource: PublishedResource): boolean {
    return this.getFileMappings(resource).length > 0;
  }

  private async getSelectableResources(): Promise<PublishedResource[]> {
    const local = this.plugin.settings.publishedResources || [];
    const token = this.plugin.settings.githubToken;
    const merged = new Map<string, PublishedResource>();

    for (const resource of local) {
      merged.set(resource.repoFullName, resource);
    }

    if (token) {
      try {
        const gh = new GitHubAPI(token);
        const repos = await gh.listAuthenticatedRepos();
        for (const repo of repos) {
          const inferredType = inferPublishedType(repo.name);
          if (!inferredType) continue;
          const existing = merged.get(repo.full_name);
          if (existing) {
            merged.set(repo.full_name, {
              ...existing,
              lastPublishedAt: newerDate(existing.lastPublishedAt, repo.updated_at),
            });
          } else {
            merged.set(repo.full_name, {
              repoFullName: repo.full_name,
              localFilePath: "",
              localFiles: [],
              fileMappings: [],
              type: inferredType,
              lastPublishedAt: repo.updated_at,
            });
          }
        }
      } catch {
        // fall back to local-only list if GitHub sync fails
      }
    }

    const resources = [...merged.values()].sort(
      (a, b) => new Date(b.lastPublishedAt).getTime() - new Date(a.lastPublishedAt).getTime()
    );

    if (JSON.stringify(resources) !== JSON.stringify(local)) {
      this.plugin.settings.publishedResources = resources;
      await this.plugin.saveSettings();
    }

    this.syncedResources = resources;
    return resources;
  }

  private async readLocalContent(path: string): Promise<string | null> {
    const tfile = this.app.vault.getAbstractFileByPath(path);
    if (tfile instanceof TFile) {
      return this.app.vault.read(tfile);
    }
    try {
      if (await this.app.vault.adapter.exists(path)) {
        return await this.app.vault.adapter.read(path);
      }
    } catch {
      // fall through
    }
    return null;
  }
}

function timeAgo(date: Date): string {
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function inferPublishedType(repoName: string): PublishedResource["type"] | null {
  if (repoName.startsWith("obsidian-snippet-")) return "snippet";
  if (repoName.startsWith("obsidian-note-")) return "note";
  if (repoName.startsWith("obsidian-vault-")) return "vault";
  return null;
}

function newerDate(a: string, b: string): string {
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}
