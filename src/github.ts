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
    return this.request(`/repos/${owner}/${repo}/contents/${path}`, {
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
    return this.request(`/repos/${owner}/${repo}/contents/${path}`, {
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
        `/repos/${owner}/${repo}/contents/${path}`
      );
      return { sha: data.sha, content: atob(data.content) };
    } catch {
      return null;
    }
  }
}
