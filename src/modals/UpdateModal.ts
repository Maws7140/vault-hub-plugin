import { App, Modal, Setting, Notice } from "obsidian";
import type VaultHubPlugin from "../main";
import { PublishedResource } from "../settings";
import { GitHubAPI } from "../github";

export class UpdateModal extends Modal {
  plugin: VaultHubPlugin;
  selected: PublishedResource | null = null;

  constructor(app: App, plugin: VaultHubPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    this.render();
  }

  onClose() {
    this.contentEl.empty();
  }

  private render() {
    const c = this.contentEl;
    c.empty();
    c.createEl("h2", { text: "Update Published Resource" });

    const resources = this.plugin.settings.publishedResources;
    if (resources.length === 0) {
      c.createEl("p", { text: "No published resources yet. Use Publish first." });
      return;
    }

    new Setting(c).setName("Select Resource").addDropdown((dd) => {
      dd.addOption("", "Choose...");
      resources.forEach((r, i) => {
        dd.addOption(String(i), `${r.repoFullName} (${r.type})`);
      });
      dd.onChange((v) => {
        this.selected = v ? resources[parseInt(v)] : null;
      });
    });

    const updateBtn = c.createEl("button", { text: "Push Update", cls: "mod-cta" });
    updateBtn.addEventListener("click", () => this.doUpdate());
  }

  private async doUpdate() {
    if (!this.selected) {
      new Notice("Select a resource first");
      return;
    }

    const token = this.plugin.settings.githubToken;
    if (!token) {
      new Notice("Set your GitHub token in settings first");
      return;
    }

    const c = this.contentEl;
    c.empty();
    c.createEl("h3", { text: "Updating..." });

    try {
      const gh = new GitHubAPI(token);
      const [owner, repo] = this.selected.repoFullName.split("/");

      // Read current local file
      const file = this.app.vault.getAbstractFileByPath(this.selected.localFilePath);
      if (!file) {
        new Notice(`File not found: ${this.selected.localFilePath}`);
        return;
      }

      const content = await this.app.vault.read(file as import("obsidian").TFile);

      // Get existing file SHA from GitHub
      const existing = await gh.getFileContent(owner, repo, file.name);

      if (existing) {
        await gh.updateFile(
          owner, repo, file.name, content,
          `Update ${file.name}`, existing.sha
        );
      } else {
        await gh.createFile(owner, repo, file.name, content, `Add ${file.name}`);
      }

      // Update timestamp
      this.selected.lastPublishedAt = new Date().toISOString();
      await this.plugin.saveSettings();

      c.empty();
      c.createEl("h3", { text: "Updated!" });
      c.createEl("p", { text: `Pushed to ${this.selected.repoFullName}` });

      const closeBtn = c.createEl("button", { text: "Close", cls: "mod-cta" });
      closeBtn.addEventListener("click", () => this.close());

      new Notice("Resource updated!");
    } catch (e) {
      c.empty();
      c.createEl("h3", { text: "Error" });
      c.createEl("p", { text: String(e) });
    }
  }
}
