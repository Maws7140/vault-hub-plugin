// handles all the github api stuff so we can push vaults and snippets

import { requestJson } from "./net";

function encodeUtf8ToBase64(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function decodeBase64ToUtf8(input: string): string {
  const binary = atob(input);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export class GitHubAPI {
  constructor(private token: string) {}

  private async request<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
    try {
      return await requestJson(`https://api.github.com${path}`, {
        method: options.method,
        body: typeof options.body === "string" ? options.body : undefined,
        headers: {
          Authorization: `token ${this.token}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
          ...(options.headers as Record<string, string> | undefined),
        },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const httpMatch = message.match(/^HTTP (\d+):\s*([\s\S]*)$/);
      if (httpMatch) {
        const wrapped = new Error(`GitHub API ${httpMatch[1]}: ${httpMatch[2]}`);
        (wrapped as Error & { cause?: unknown }).cause = error;
        throw wrapped;
      }
      throw error;
    }
  }

  private encodePath(path: string): string {
    return path.split("/").map(encodeURIComponent).join("/");
  }

  async getUser(): Promise<{ login: string; avatar_url: string }> {
    return this.request<{ login: string; avatar_url: string }>("/user");
  }

  async listAuthenticatedRepos(): Promise<
    { full_name: string; name: string; updated_at: string }[]
  > {
    const repos: { full_name: string; name: string; updated_at: string }[] = [];
    for (let page = 1; page <= 5; page++) {
      const batch = await this.request<{ full_name: string; name: string; updated_at: string }[]>(
        `/user/repos?per_page=100&page=${page}&affiliation=owner&sort=updated`
      );
      if (!Array.isArray(batch) || batch.length === 0) break;
      repos.push(...batch);
      if (batch.length < 100) break;
    }
    return repos;
  }

  async createRepo(
    name: string,
    description: string
  ): Promise<{ full_name: string; html_url: string }> {
    return this.request<{ full_name: string; html_url: string }>("/user/repos", {
      method: "POST",
      body: JSON.stringify({
        name,
        description,
        auto_init: false,
        private: false,
      }),
    });
  }

  async addTopics(owner: string, repo: string, topics: string[]) {
    return this.request(`/repos/${owner}/${repo}/topics`, {
      method: "PUT",
      body: JSON.stringify({ names: topics }),
    });
  }

  async createFile(
    owner: string,
    repo: string,
    path: string,
    content: string,
    message: string
  ) {
    const encoded = encodeUtf8ToBase64(content);
    return this.request(`/repos/${owner}/${repo}/contents/${this.encodePath(path)}`, {
      method: "PUT",
      body: JSON.stringify({ message, content: encoded }),
    });
  }

  async createBinaryFile(
    owner: string,
    repo: string,
    path: string,
    base64Content: string,
    message: string
  ) {
    return this.request(`/repos/${owner}/${repo}/contents/${this.encodePath(path)}`, {
      method: "PUT",
      body: JSON.stringify({ message, content: base64Content, encoding: "base64" }),
    });
  }

  async getFileSha(
    owner: string,
    repo: string,
    path: string
  ): Promise<string | null> {
    try {
      const data = await this.request<{ sha?: unknown }>(
        `/repos/${owner}/${repo}/contents/${this.encodePath(path)}`
      );
      return typeof data?.sha === "string" ? data.sha : null;
    } catch (error) {
      if (String(error).includes("GitHub API 404")) return null;
      throw error;
    }
  }

  async updateFile(
    owner: string,
    repo: string,
    path: string,
    content: string,
    message: string,
    sha: string
  ) {
    const encoded = encodeUtf8ToBase64(content);
    return this.request(`/repos/${owner}/${repo}/contents/${this.encodePath(path)}`, {
      method: "PUT",
      body: JSON.stringify({ message, content: encoded, sha }),
    });
  }

  async updateBinaryFile(
    owner: string,
    repo: string,
    path: string,
    base64Content: string,
    message: string,
    sha: string
  ) {
    return this.request(`/repos/${owner}/${repo}/contents/${this.encodePath(path)}`, {
      method: "PUT",
      body: JSON.stringify({ message, content: base64Content, encoding: "base64", sha }),
    });
  }

  async upsertFile(
    owner: string,
    repo: string,
    path: string,
    content: string,
    message: string
  ) {
    const sha = await this.getFileSha(owner, repo, path);
    if (sha) {
      return this.updateFile(owner, repo, path, content, message, sha);
    }
    return this.createFile(owner, repo, path, content, message);
  }

  async upsertBinaryFile(
    owner: string,
    repo: string,
    path: string,
    base64Content: string,
    message: string
  ) {
    const sha = await this.getFileSha(owner, repo, path);
    if (sha) {
      return this.updateBinaryFile(owner, repo, path, base64Content, message, sha);
    }
    return this.createBinaryFile(owner, repo, path, base64Content, message);
  }

  async getFileContent(
    owner: string,
    repo: string,
    path: string
  ): Promise<{ sha: string; content: string } | null> {
    try {
      const data = await this.request<{ sha?: unknown; content?: unknown }>(
        `/repos/${owner}/${repo}/contents/${this.encodePath(path)}`
      );
      if (typeof data.sha !== "string" || typeof data.content !== "string") {
        throw new Error(`Unexpected GitHub contents response for ${owner}/${repo}/${path}`);
      }
      return { sha: data.sha, content: decodeBase64ToUtf8(data.content.replace(/\s/g, "")) };
    } catch (error) {
      if (String(error).includes("GitHub API 404")) return null;
      throw error;
    }
  }

  async listFilesRecursive(
    owner: string,
    repo: string
  ): Promise<{ path: string; sha: string; download_url: string; type: string }[]> {
    const data = await this.request<{ tree?: unknown }>(
      `/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`
    );
    const tree = Array.isArray(data.tree) ? data.tree.filter(isGitHubTreeItem) : [];
    if (tree.length === 0) return [];

    return tree
      .filter((item) => item.type === "blob")
      .map((item) => ({
        path: item.path,
        sha: item.sha,
        download_url: `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${this.encodePath(item.path)}`,
        type: "file",
      }));
  }

  async fileExists(owner: string, repo: string, path: string): Promise<boolean> {
    return (await this.getFileContent(owner, repo, path)) !== null;
  }

  async getRepo(owner: string, repo: string): Promise<{ full_name: string }> {
    return this.request<{ full_name: string }>(`/repos/${owner}/${repo}`);
  }

  async getAvailableRepoName(owner: string, baseName: string): Promise<string> {
    let candidate = baseName;
    let suffix = 2;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        await this.getRepo(owner, candidate);
        candidate = `${baseName}-${suffix}`;
        suffix++;
      } catch (error) {
        if (String(error).includes("GitHub API 404")) return candidate;
        throw error;
      }
    }
    throw new Error(`Could not find an available repo name based on "${baseName}".`);
  }

  async dispatchRepositoryEvent(owner: string, repo: string, eventType: string, clientPayload?: unknown) {
    return this.request(`/repos/${owner}/${repo}/dispatches`, {
      method: "POST",
      body: JSON.stringify({
        event_type: eventType,
        client_payload: clientPayload || {},
      }),
    });
  }
}

function isGitHubTreeItem(value: unknown): value is { path: string; sha: string; type: string } {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.path === "string" &&
    typeof item.sha === "string" &&
    typeof item.type === "string"
  );
}
