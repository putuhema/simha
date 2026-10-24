/**
 * Who is logged in, using their SIMRS Khanza account. The session is an
 * HttpOnly cookie; this store only knows the user and the rights snapshot.
 */
import type { AuthState, User } from "@simha/shared";
import { create } from "zustand";
import { api, ApiError, errorMessage, setUnauthorizedHandler } from "../lib/api.ts";

type Status = "loading" | "login" | "ready" | "offline";

interface AuthStore {
  readonly status: Status;
  readonly user: User | null;
  readonly error: string | null;
  readonly load: () => Promise<void>;
  readonly login: (username: string, password: string) => Promise<void>;
  /** Re-read this account's Khanza rights after IT changed them. */
  readonly refreshAccess: () => Promise<void>;
  readonly logout: () => Promise<void>;
}

export const useAuth = create<AuthStore>((set) => ({
  status: "loading",
  user: null,
  error: null,
  load: async () => {
    try {
      const state = await api.get<AuthState>("/api/auth/state");
      set({ status: state.user ? "ready" : "login", user: state.user, error: null });
    } catch (error) {
      set({ status: "offline", error: errorMessage(error) });
    }
  },
  login: async (username, password) => {
    const user = await api.post<User>("/api/auth/login", { username, password });
    set({ status: "ready", user, error: null });
  },
  refreshAccess: async () => {
    const user = await api.post<User>("/api/auth/refresh");
    set({ user });
  },
  logout: async () => {
    await api.post("/api/auth/logout").catch((error: unknown) => {
      if (!(error instanceof ApiError && error.status === 401)) throw error;
    });
    set({ status: "login", user: null });
  },
}));

setUnauthorizedHandler(() => useAuth.setState({ status: "login", user: null, error: "Sesi berakhir. Silakan login lagi." }));
