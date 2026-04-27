import { requestUrl } from "obsidian";

interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

function buildError(status: number, text: string): Error {
  return new Error(`HTTP ${status}: ${text}`);
}

export async function requestJson<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const response = await requestUrl({
    url,
    method: options.method || "GET",
    headers: options.headers,
    body: options.body,
    throw: false,
  });

  if (response.status >= 400) {
    throw buildError(response.status, response.text || "Request failed");
  }

  return response.json as T;
}

export async function requestText(url: string, options: RequestOptions = {}): Promise<string> {
  const response = await requestUrl({
    url,
    method: options.method || "GET",
    headers: options.headers,
    body: options.body,
    throw: false,
  });

  if (response.status >= 400) {
    throw buildError(response.status, response.text || "Request failed");
  }

  return response.text;
}
