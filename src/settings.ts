import { App, PluginSettingTab, Setting } from "obsidian";
import type VaultHubPlugin from "./main";

export interface PublishedResource {
  repoFullName: string;
  localFilePath: string;
  localFiles?: string[];
  type: "snippet" | "note" | "vault" | "bundle";
  lastPublishedAt: string;
}

export interface VaultHubSettings {
  githubToken: string;
  defaultCategories: string[];
  vaultHubUrl: string;
  publishedResources: PublishedResource[];
}

export const DEFAULT_SETTINGS: VaultHubSettings = {
  githubToken: "",
  defaultCategories: [],
  vaultHubUrl: "https://obsidianvaulthub.com",
  publishedResources: [],
};

export class VaultHubSettingTab extends PluginSettingTab {
  plugin: VaultHubPlugin;

  constructor(app: App, plugin: VaultHubPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Vault Hub Settings" });

    new Setting(containerEl)
      .setName("GitHub Personal Access Token")
      .setDesc("Token used to create repos and push files. Requires 'repo' scope.")
      .addText((text) =>
        text
          .setPlaceholder("ghp_xxxxxxxxxxxx")
          .setValue(this.plugin.settings.githubToken)
          .then((t) => {
            t.inputEl.type = "password";
            t.inputEl.style.width = "300px";
          })
          .onChange(async (value) => {
            this.plugin.settings.githubToken = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Vault Hub URL")
      .setDesc("URL of the Vault Hub website.")
      .addText((text) =>
        text
          .setPlaceholder("https://obsidianvaulthub.com")
          .setValue(this.plugin.settings.vaultHubUrl)
          .onChange(async (value) => {
            this.plugin.settings.vaultHubUrl = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Default Categories")
      .setDesc("Comma-separated list of default categories for new publications.")
      .addText((text) =>
        text
          .setPlaceholder("appearance, workflow")
          .setValue(this.plugin.settings.defaultCategories.join(", "))
          .onChange(async (value) => {
            this.plugin.settings.defaultCategories = value
              .split(",")
              .map((s) => s.trim())
              .filter((s) => s.length > 0);
            await this.plugin.saveSettings();
          })
      );
  }
}
