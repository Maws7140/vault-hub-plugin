// plugin settings and default values

import { App, PluginSettingTab, Setting } from "obsidian";
import type VaultHubPlugin from "./main";

export interface PublishedResource {
  repoFullName: string;
  localFilePath: string;
  localFiles?: string[];
  fileMappings?: PublishedFileMapping[];
  type: "snippet" | "note" | "vault" | "bundle";
  lastPublishedAt: string;
}

export interface PublishedFileMapping {
  localPath: string;
  repoPath: string;
  kind?: "resource" | "attached-snippet" | "screenshot";
}

export interface PublishDraft {
  step: number;
  resourceType: "snippet" | "note" | "bundle";
  selectedFilePaths: string[];
  attachedSnippetPaths: string[];
  screenshotPaths: string[];
  externalScreenshotUrls: string;
  fileSearchQuery: string;
  attachedSnippetSearchQuery: string;
  screenshotSearchQuery: string;
  checkedPluginIds: string[];
  name: string;
  tagline: string;
  description: string;
  categories: string[];
  tags: string;
  compatibleThemes: string[];
  readmeContent: string;
}

export interface VaultHubSettings {
  githubToken: string;
  defaultCategories: string[];
  vaultHubUrl: string;
  catalogRepoFullName: string;
  publishedResources: PublishedResource[];
  publishDraft: PublishDraft | null;
}

export const DEFAULT_SETTINGS: VaultHubSettings = {
  githubToken: "",
  defaultCategories: [],
  vaultHubUrl: "https://obsidianvaulthub.com",
  catalogRepoFullName: "Maws7140/vault-hub",
  publishedResources: [],
  publishDraft: null,
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

    new Setting(containerEl)
      .setName("GitHub personal access token")
      .setDesc("Token used to create repos and push files. Requires the repo scope.")
      .addText((text) => {
        text.setPlaceholder("GitHub personal access token").setValue(this.plugin.settings.githubToken);
        text.inputEl.type = "password";
        text.inputEl.addClass("vault-hub-text-input-wide");
        text.onChange((value) => {
          this.plugin.settings.githubToken = value;
          void this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Hub URL")
      .setDesc("URL of the vault hub website.")
      .addText((text) =>
        text
          .setPlaceholder("https://obsidianvaulthub.com")
          .setValue(this.plugin.settings.vaultHubUrl)
          .onChange((value) => {
            this.plugin.settings.vaultHubUrl = value;
            void this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Catalog repository")
      .setDesc("Repository that stores the website catalog workflow. Used to request a refresh after publish or update.")
      .addText((text) =>
        text
          .setPlaceholder("Maws7140/vault-hub")
          .setValue(this.plugin.settings.catalogRepoFullName)
          .onChange((value) => {
            this.plugin.settings.catalogRepoFullName = value.trim();
            void this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Default categories")
      .setDesc("Comma-separated list of default categories for new publications.")
      .addText((text) =>
        text
          .setPlaceholder("Appearance, workflow")
          .setValue(this.plugin.settings.defaultCategories.join(", "))
          .onChange((value) => {
            this.plugin.settings.defaultCategories = value
              .split(",")
              .map((s) => s.trim())
              .filter((s) => s.length > 0);
            void this.plugin.saveSettings();
          })
      );
  }
}
