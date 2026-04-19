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
}
