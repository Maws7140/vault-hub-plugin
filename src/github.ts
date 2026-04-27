export class GitHubAPI {
  constructor(private token: string) {}

  private async request(path: string, options: RequestInit = {}) {
    const res = await fetch(`https://api.github.com${path}`, {
      ...options,
      headers: {
        Authorization: `token ${this.token}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
        ...options.headers,
      },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`GitHub API ${res.status}: ${body}`);
    }
    return res.json();
  }

  private encodePath(path: string): string {
    return path.split("/").map(encodeURIComponent).join("/");
  }

  async getUser(): Promise<{ login: string; avatar_url: string }> {
    return this.request("/user");
  }

  async listAuthenticatedRepos(): Promise<
    { full_name: string; name: string; updated_at: string }[]
  > {
    const repos: { full_name: string; name: string; updated_at: string }[] = [];
    for (let page = 1; page <= 5; page++) {
      const batch = await this.request(
        `/user/repos?per_page=100&page=${page}&affiliation=owner&sort=updated`
      ) as { full_name: string; name: string; updated_at: string }[];
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
    return this.request("/user/repos", {
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
    const encoded = btoa(unescape(encodeURIComponent(content)));
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
      const data = await this.request(
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
    const encoded = btoa(unescape(encodeURIComponent(content)));
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
      const data = await this.request(
        `/repos/${owner}/${repo}/contents/${this.encodePath(path)}`
      );
      return { sha: data.sha, content: decodeURIComponent(escape(atob(data.content.replace(/\s/g, "")))) };
    } catch (error) {
      if (String(error).includes("GitHub API 404")) return null;
      throw error;
    }
  }

  async listFilesRecursive(
    owner: string,
    repo: string
  ): Promise<{ path: string; sha: string; download_url: string; type: string }[]> {
    const data = await this.request(`/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`);
    if (!Array.isArray(data.tree)) return [];

    return data.tree
      .filter((item: { path: string; type: string }) => item.type === "blob")
      .map((item: { path: string; sha: string }) => ({
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
    return this.request(`/repos/${owner}/${repo}`);
  }

  async getAvailableRepoName(owner: string, baseName: string): Promise<string> {
    let candidate = baseName;
    let suffix = 2;
    while (true) {
      try {
        await this.getRepo(owner, candidate);
        candidate = `${baseName}-${suffix}`;
        suffix++;
      } catch (error) {
        if (String(error).includes("GitHub API 404")) return candidate;
        throw error;
      }
    }
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
