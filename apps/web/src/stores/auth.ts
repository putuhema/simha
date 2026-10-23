/**
 * Who is logged in. The session is an HttpOnly cookie; this store only knows
 * the user and whether the first admin still has to be created.
 */
import type { AuthState, User } from "@simha/shared";
import { create } from "zustand";
import { api, ApiError, errorMessage, setUnauthorizedHandler } from "../lib/api.ts";

type Status = "loading" | "setup" | "login" | "ready" | "offline";

interface AuthStore {
  readonly status: Status;
  readonly user: User | null;
  readonly error: string | null;
  readonly load: () => Promise<void>;
  readonly login: (username: string, password: string) => Promise<void>;
  readonly setup: (input: { username: string; displayName: string; password: string }) => Promise<void>;
  readonly logout: () => Promise<void>;
}

export const useAuth = create<AuthStore>((set) => ({
  status: "loading",
  user: null,
  error: null,
  load: async () => {
    try {
      const state = await api.get<AuthState>("/api/auth/state");
      set({
        status: state.user ? "ready" : state.setupNeeded ? "setup" : "login",
        user: state.user,
        error: null,
      });
    } catch (error) {
      set({ status: "offline", error: errorMessage(error) });
    }
  },
  login: async (username, password) => {
    const user = await api.post<User>("/api/auth/login", { username, password });
    set({ status: "ready", user, error: null });
  },
  setup: async (input) => {
    const user = await api.post<User>("/api/auth/setup", input);
    set({ status: "ready", user, error: null });
  },
  logout: async () => {
    await api.post("/api/auth/logout").catch((error: unknown) => {
      if (!(error instanceof ApiError && error.status === 401)) throw error;
    });
    set({ status: "login", user: null });
  },
}));

setUnauthorizedHandler(() => useAuth.setState({ status: "login", user: null, error: "Sesi berakhir. Silakan login lagi." }));
