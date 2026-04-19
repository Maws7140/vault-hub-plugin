import {
  App,
  Modal,
  Setting,
  Notice,
  TFile,
  TextAreaComponent,
  DropdownComponent,
} from "obsidian";
import type VaultHubPlugin from "../main";
import { DetectedPlugin, detectPlugins } from "../detection";
import { GitHubAPI } from "../github";
import { generateHubMd, HubMdData } from "../hubmd";
import { generateReadme, ReadmeData } from "../readme";

type ResourceType = "snippet" | "note" | "bundle";

const CATEGORIES: Record<string, string[]> = {
  snippet: [
    "ui-tweak", "theme-override", "layout", "typography",
    "color-scheme", "editor", "sidebar", "publishing",
  ],
  note: [
    "dashboard", "tracker", "query", "daily-note",
    "project-template", "kanban", "database", "automation",
  ],
  bundle: [
    "dashboard", "tracker", "query", "project-template", "automation",
  ],
};

export class PublishModal extends Modal {
  plugin: VaultHubPlugin;
  step = 1;

  // Step 1
  resourceType: ResourceType = "snippet";
  selectedFiles: TFile[] = [];

  // Step 2
  allPlugins: DetectedPlugin[] = [];
  checkedPlugins: Set<string> = new Set();

  // Step 3
  name = "";
  tagline = "";
  description = "";
  categories: string[] = [];
  tags = "";
  compatibleThemes: string[] = [];

  // Step 4
  readmeContent = "";

  constructor(app: App, plugin: VaultHubPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    this.renderStep();
  }

  onClose() {
    this.contentEl.empty();
  }

  private getPublishedType(): "snippet" | "note" {
    return this.resourceType === "snippet" ? "snippet" : "note";
  }

  private renderStep() {
    this.contentEl.empty();
    this.contentEl.addClass("vault-hub-modal");

    const header = this.contentEl.createDiv("vault-hub-header");
    header.createEl("h2", { text: `Publish Resource — Step ${this.step} of 5` });
    const progress = header.createDiv("vault-hub-progress");
    for (let i = 1; i <= 5; i++) {
      const dot = progress.createSpan("vault-hub-dot");
      if (i === this.step) dot.addClass("active");
      else if (i < this.step) dot.addClass("done");
    }

    switch (this.step) {
      case 1: this.renderStep1(); break;
      case 2: this.renderStep2(); break;
      case 3: this.renderStep3(); break;
      case 4: this.renderStep4(); break;
      case 5: this.renderStep5(); break;
    }
  }

  private renderStep1() {
    const c = this.contentEl;

    new Setting(c)
      .setName("Resource Type")
      .addDropdown((dd: DropdownComponent) => {
        dd.addOption("snippet", "CSS Snippet");
        dd.addOption("note", "Note / Template / Dashboard");
        dd.addOption("bundle", "Note Bundle (multiple files)");
        dd.setValue(this.resourceType);
        dd.onChange((v: string) => {
          this.resourceType = v as ResourceType;
          this.selectedFiles = [];
          this.renderStep();
        });
      });

    const ext = this.resourceType === "snippet" ? ".css" : ".md";
    const files = this.app.vault
      .getFiles()
      .filter((f: TFile) => f.extension === ext.slice(1))
      .sort((a: TFile, b: TFile) => a.path.localeCompare(b.path));

    const fileSection = c.createDiv();
    fileSection.createEl("h4", { text: `Select file${this.resourceType === "bundle" ? "s" : ""}` });

    const list = fileSection.createDiv("vault-hub-file-list");
    files.forEach((f: TFile) => {
      const row = list.createDiv("vault-hub-file-row");
      const cb = row.createEl("input", { type: this.resourceType === "bundle" ? "checkbox" : "radio" });
      cb.name = "vault-hub-file";
      cb.checked = this.selectedFiles.includes(f);
      cb.addEventListener("change", () => {
        if (this.resourceType === "bundle") {
          if (cb.checked) this.selectedFiles.push(f);
          else this.selectedFiles = this.selectedFiles.filter((x) => x !== f);
        } else {
          this.selectedFiles = cb.checked ? [f] : [];
        }
      });
      row.createSpan({ text: f.path });
    });

    this.addNav(c, null, () => {
      if (this.selectedFiles.length === 0) {
        new Notice("Select at least one file");
        return false;
      }
      return true;
    });
  }

  private async renderStep2() {
    const c = this.contentEl;
    c.createEl("h4", { text: "Select Required Plugins" });
    c.createEl("p", {
      text: "Auto-detected plugins are pre-checked. Review and adjust.",
      cls: "vault-hub-hint",
    });

    const loading = c.createDiv({ text: "Scanning..." });

    const fileType = this.resourceType === "snippet" ? "css" : "md";
    const detectedById = new Map<string, DetectedPlugin>();
    for (const file of this.selectedFiles) {
      const content = await this.app.vault.read(file);
      const detected = await detectPlugins(content, fileType as "css" | "md", this.app.vault);
      detected.forEach((plugin) => detectedById.set(plugin.id, plugin));
    }
    this.allPlugins = [...detectedById.values()];

    loading.remove();

    // Pre-check auto-detected
    this.allPlugins.forEach((p) => {
      if (p.autoDetected) this.checkedPlugins.add(p.id);
    });

    const list = c.createDiv("vault-hub-plugin-list");
    this.allPlugins.forEach((p) => {
      const row = list.createDiv("vault-hub-plugin-row");
      const cb = row.createEl("input", { type: "checkbox" });
      cb.checked = this.checkedPlugins.has(p.id);
      cb.addEventListener("change", () => {
        if (cb.checked) this.checkedPlugins.add(p.id);
        else this.checkedPlugins.delete(p.id);
      });

      const info = row.createDiv("vault-hub-plugin-info");
      info.createSpan({ text: p.name, cls: "vault-hub-plugin-name" });
      info.createSpan({ text: ` v${p.version}`, cls: "vault-hub-plugin-version" });
      if (p.autoDetected) {
        info.createSpan({ text: " (auto-detected)", cls: "vault-hub-auto-badge" });
      }
    });

    if (this.allPlugins.length === 0) {
      c.createEl("p", { text: "No community plugins installed.", cls: "vault-hub-hint" });
    }

    this.addNav(c, null, null);
  }

  private renderStep3() {
    const c = this.contentEl;

    new Setting(c).setName("Name").addText((t) => {
      t.setPlaceholder("My Resource").setValue(this.name);
      t.onChange((v: string) => (this.name = v));
      t.inputEl.style.width = "100%";
    });

    new Setting(c).setName("Tagline").setDesc("One-line summary").addText((t) => {
      t.setPlaceholder("A brief description").setValue(this.tagline);
      t.onChange((v: string) => (this.tagline = v));
      t.inputEl.style.width = "100%";
    });

    new Setting(c).setName("Description").addTextArea((t: TextAreaComponent) => {
      t.setPlaceholder("Detailed description...").setValue(this.description);
      t.onChange((v: string) => (this.description = v));
      t.inputEl.style.width = "100%";
      t.inputEl.style.minHeight = "80px";
    });

    const cats = CATEGORIES[this.resourceType] || [];
    new Setting(c).setName("Category").addDropdown((dd: DropdownComponent) => {
      dd.addOption("", "Select...");
      cats.forEach((cat) => dd.addOption(cat, cat));
      dd.setValue(this.categories[0] || "");
      dd.onChange((v: string) => (this.categories = v ? [v] : []));
    });

    new Setting(c).setName("Tags").setDesc("Comma-separated").addText((t) => {
      t.setPlaceholder("glass, blur, dark").setValue(this.tags);
      t.onChange((v: string) => (this.tags = v));
    });

    if (this.resourceType === "snippet") {
      new Setting(c).setName("Compatible Themes").addDropdown((dd: DropdownComponent) => {
        dd.addOption("any", "Any theme");
        ["minimal", "velocity", "obsidian-default", "catppuccin"].forEach((t) =>
          dd.addOption(t, t)
        );
        dd.setValue(this.compatibleThemes[0] || "any");
        dd.onChange((v: string) => (this.compatibleThemes = [v]));
      });
    }

    this.addNav(c, null, () => {
      if (!this.name.trim()) {
        new Notice("Name is required");
        return false;
      }
      // Generate README for next step
      const selected = this.allPlugins
        .filter((p) => this.checkedPlugins.has(p.id))
        .map((p) => ({ ...p, autoDetected: true }));

      const readmeData: ReadmeData = {
        name: this.name,
        tagline: this.tagline,
        description: this.description,
        type: this.getPublishedType(),
        plugins: selected,
        files: this.selectedFiles.map((f) => ({ path: f.path })),
      };
      this.readmeContent = generateReadme(readmeData);
      return true;
    });
  }

  private renderStep4() {
    const c = this.contentEl;
    c.createEl("h4", { text: "Edit README" });
    c.createEl("p", {
      text: "Auto-generated from your details. Edit freely.",
      cls: "vault-hub-hint",
    });

    const textarea = c.createEl("textarea", { cls: "vault-hub-readme-editor" });
    textarea.value = this.readmeContent;
    textarea.addEventListener("input", () => {
      this.readmeContent = textarea.value;
    });

    this.addNav(c, null, null);
  }

  private renderStep5() {
    const c = this.contentEl;
    c.createEl("h4", { text: "Review & Publish" });
    const publishedType = this.getPublishedType();

    const summary = c.createDiv("vault-hub-summary");
    summary.createEl("p", { text: `Type: ${publishedType}${this.resourceType === "bundle" ? " (multi-file)" : ""}` });
    summary.createEl("p", { text: `Name: ${this.name}` });
    summary.createEl("p", { text: `Files: ${this.selectedFiles.map((f) => f.path).join(", ")}` });

    const selPlugins = this.allPlugins.filter((p) => this.checkedPlugins.has(p.id));
    summary.createEl("p", {
      text: `Plugins: ${selPlugins.length > 0 ? selPlugins.map((p) => p.name).join(", ") : "None"}`,
    });
    summary.createEl("p", { text: `Categories: ${this.categories.join(", ") || "None"}` });

    const btnContainer = c.createDiv("vault-hub-nav");

    const backBtn = btnContainer.createEl("button", { text: "Back" });
    backBtn.addEventListener("click", () => { this.step--; this.renderStep(); });

    const publishBtn = btnContainer.createEl("button", {
      text: "Publish",
      cls: "mod-cta",
    });
    publishBtn.addEventListener("click", () => this.doPublish());
  }

  private async doPublish() {
    const token = this.plugin.settings.githubToken;
    if (!token) {
      new Notice("Set your GitHub token in Vault Hub settings first");
      return;
    }

    const c = this.contentEl;
    c.empty();
    c.createEl("h3", { text: "Publishing..." });
    const status = c.createEl("p", { text: "Creating repository..." });

    try {
      const gh = new GitHubAPI(token);
      const user = await gh.getUser();
      const publishedType = this.getPublishedType();

      const slug = this.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "resource";
      const repoName = await gh.getAvailableRepoName(user.login, `obsidian-${publishedType}-${slug}`);

      status.setText("Creating repository...");
      const repo = await gh.createRepo(repoName, this.tagline || this.name);
      const [owner, rName] = repo.full_name.split("/");

      // Topic tag
      const topicMap: Record<string, string> = {
        snippet: "obsidian-css-snippet",
        note: "obsidian-note-template",
      };
      status.setText("Adding topic tag...");
      await gh.addTopics(owner, rName, [topicMap[publishedType]]);

      // Upload resource files
      for (const file of this.selectedFiles) {
        status.setText(`Uploading ${file.path}...`);
        const content = await this.app.vault.read(file);
        await gh.createFile(owner, rName, file.path, content, `Add ${file.path}`);
      }

      // Generate and upload hub.md
      status.setText("Generating hub.md...");
      const selectedPlugins = this.allPlugins
        .filter((p) => this.checkedPlugins.has(p.id))
        .map((p) => ({ ...p, autoDetected: true }));

      const obsVer = (this.app as unknown as { appVersion?: string }).appVersion || "unknown";
      const themeName = ((this.app.vault as unknown as { config?: { cssTheme?: string } }).config?.cssTheme) || "default";

      const hubData: HubMdData = {
        type: publishedType,
        name: this.name,
        tagline: this.tagline,
        description: this.description,
        author: user.login,
        categories: this.categories,
        tags: this.tags.split(",").map((t) => t.trim()).filter(Boolean),
        compatibleThemes: this.compatibleThemes,
        screenshots: [],
        plugins: selectedPlugins,
        obsidianVersion: obsVer,
        theme: themeName,
        os: navigator.platform,
        files: this.selectedFiles.map((f) => ({
          path: f.path,
          type: f.extension,
          size: f.stat.size,
        })),
        body: this.readmeContent,
      };

      const hubMd = generateHubMd(hubData);
      await gh.createFile(owner, rName, "hub.md", hubMd, "Add hub.md");

      // Upload README
      status.setText("Uploading README...");
      await gh.createFile(owner, rName, "README.md", this.readmeContent, "Add README");

      // Save to published resources
      this.plugin.settings.publishedResources.push({
        repoFullName: repo.full_name,
        localFilePath: this.selectedFiles[0].path,
        localFiles: this.selectedFiles.map((f) => f.path),
        type: publishedType,
        lastPublishedAt: new Date().toISOString(),
      });
      await this.plugin.saveSettings();

      // Success
      c.empty();
      c.createEl("h3", { text: "Published!" });
      c.createEl("p", { text: `Repository: ${repo.full_name}` });

      const vaultHubUrl = `https://obsidianvaulthub.com/r/${owner}/${rName}`;
      const link = c.createEl("a", {
        text: "View on Vault Hub",
        href: vaultHubUrl,
        cls: "mod-cta vault-hub-success-link",
      });
      link.setAttr("target", "_blank");

      c.createEl("p", {
        text: "It will appear after the next catalog refresh.",
        cls: "vault-hub-hint",
      });

      const ghLink = c.createEl("a", {
        text: "View on GitHub",
        href: repo.html_url,
        cls: "vault-hub-hint",
      });
      ghLink.setAttr("target", "_blank");

      const closeBtn = c.createEl("button", { text: "Close", cls: "mod-cta" });
      closeBtn.addEventListener("click", () => this.close());

      new Notice(`Published to ${repo.full_name}!`);
    } catch (e) {
      c.empty();
      c.createEl("h3", { text: "Error" });
      c.createEl("p", { text: String(e) });
      const retryBtn = c.createEl("button", { text: "Back to Review" });
      retryBtn.addEventListener("click", () => {
        this.step = 5;
        this.renderStep();
      });
    }
  }

  private addNav(
    container: HTMLElement,
    backCheck: (() => boolean) | null,
    nextCheck: (() => boolean) | null
  ) {
    const nav = container.createDiv("vault-hub-nav");

    if (this.step > 1) {
      const back = nav.createEl("button", { text: "Back" });
      back.addEventListener("click", () => {
        if (backCheck && !backCheck()) return;
        this.step--;
        this.renderStep();
      });
    }

    if (this.step < 5) {
      const next = nav.createEl("button", { text: "Next", cls: "mod-cta" });
      next.addEventListener("click", () => {
        if (nextCheck && !nextCheck()) return;
        this.step++;
        this.renderStep();
      });
    }
  }
}
