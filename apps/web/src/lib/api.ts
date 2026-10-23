/**
 * Calls the harness API (same origin; `pnpm dev` proxies /api). The session
 * is an HttpOnly cookie, so requests only need `credentials: "same-origin"`.
 * A 401 tells the auth store to show the login page.
 */

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let onUnauthorized: () => void = () => {};

/** Called once by the auth store. */
export const setUnauthorizedHandler = (handler: () => void) => {
  onUnauthorized = handler;
};

const errorText = async (response: Response) => {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string") return body.error;
  } catch {
    // not JSON
  }
  return `Server menjawab ${response.status}.`;
};

/** fetch with JSON body and session cookie; throws ApiError for non-2xx. */
export const request = async (method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<Response> => {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? {} : { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(0, "Server Simha tidak bisa dihubungi. Pastikan server berjalan.");
  }
  if (response.status === 401 && !path.startsWith("/api/auth/")) onUnauthorized();
  if (!response.ok) throw new ApiError(response.status, await errorText(response));
  return response;
};

export const api = {
  get: async <A>(path: string): Promise<A> => (await (await request("GET", path)).json()) as A,
  post: async <A>(path: string, body?: unknown): Promise<A> => {
    const response = await request("POST", path, body);
    return (response.status === 204 ? undefined : await response.json()) as A;
  },
  put: async <A>(path: string, body: unknown): Promise<A> => (await (await request("PUT", path, body)).json()) as A,
  patch: async <A>(path: string, body: unknown): Promise<A> => {
    const response = await request("PATCH", path, body);
    return (response.status === 204 ? undefined : await response.json()) as A;
  },
  delete: async (path: string): Promise<void> => {
    await request("DELETE", path);
  },
};

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Terjadi kesalahan yang tidak dikenal.";
