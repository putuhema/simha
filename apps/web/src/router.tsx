/**
 * Routes: /tanya?c=… (home), /pengaturan?tab=… (/pengetahuan redirects there).
 * The root shows the login or first-run setup page until someone is logged in.
 */
import { createRootRoute, createRoute, createRouter, Outlet, redirect } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import { lazy, Suspense, useEffect, type ComponentType } from "react";
import { AppShell } from "./components/layout/AppShell.tsx";
import { Button } from "./components/ui/Button.tsx";
import { Spinner } from "./components/ui/Spinner.tsx";
import { LoginPage } from "./features/auth/LoginPage.tsx";
import type { SettingsTab } from "./features/pengaturan/PengaturanPage.tsx";
import { useAuth } from "./stores/auth.ts";

const Root = () => {
  const { status, error, load } = useAuth();
  useEffect(() => {
    void load();
  }, [load]);

  if (status === "loading") {
    return (
      <div className="grid h-full place-items-center text-ink-3">
        <Spinner className="size-6" />
      </div>
    );
  }
  if (status === "offline") {
    return (
      <div className="grid h-full place-items-center p-6">
        <div className="max-w-sm text-center">
          <p className="font-display text-[20px] font-semibold">Server tidak bisa dihubungi</p>
          <p className="mt-1 mb-4 text-[13.5px] text-ink-2">{error}</p>
          <Button onClick={() => void load()}>
            <RefreshCw /> Coba lagi
          </Button>
        </div>
      </div>
    );
  }
  if (status === "login") return <LoginPage />;
  return <Outlet />;
};

/** A page loaded on first visit. */
const page = (load: () => Promise<ComponentType>) => {
  const Page = lazy(async () => ({ default: await load() }));
  return () => (
    <Suspense fallback={<div className="grid h-full place-items-center"><Spinner className="text-ink-3" /></div>}>
      <Page />
    </Suspense>
  );
};
const TanyaPage = page(() => import("./features/tanya/TanyaPage.tsx").then((m) => m.TanyaPage));
const PengaturanPage = page(() => import("./features/pengaturan/PengaturanPage.tsx").then((m) => m.PengaturanPage));
const PemeriksaanPage = page(() => import("./features/pemeriksaan/PemeriksaanPage.tsx").then((m) => m.PemeriksaanPage));

const rootRoute = createRootRoute({ component: Root });
const shellRoute = createRoute({ getParentRoute: () => rootRoute, id: "shell", component: AppShell });

const indexRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/tanya" });
  },
});

const text = (value: unknown) => (typeof value === "string" && value !== "" ? value : undefined);

const tanyaRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/tanya",
  validateSearch: (search: Record<string, unknown>): { c?: string; q?: string; mode?: "investigasi" } => {
    const c = text(search["c"]);
    const q = text(search["q"]);
    const mode = search["mode"] === "investigasi" ? ("investigasi" as const) : undefined;
    return {
      ...(c ? { c } : {}),
      ...(q ? { q } : {}),
      ...(mode ? { mode } : {}),
    };
  },
  component: TanyaPage,
});

/** Old bookmark: the knowledge list now lives in Pengaturan. */
const pengetahuanRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/pengetahuan",
  beforeLoad: () => {
    throw redirect({ to: "/pengaturan", search: { tab: "pengetahuan" } });
  },
});

const pemeriksaanRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/pemeriksaan",
  component: PemeriksaanPage,
});

const TABS: ReadonlyArray<SettingsTab> = ["ai", "pemakaian", "audit", "akun", "desktop", "pengetahuan"];
const pengaturanRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/pengaturan",
  validateSearch: (search: Record<string, unknown>): { tab?: SettingsTab } => {
    const tab = TABS.find((t) => t === search["tab"]);
    return tab ? { tab } : {};
  },
  component: PengaturanPage,
});

const notFoundRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "$",
  beforeLoad: () => {
    throw redirect({ to: "/tanya" });
  },
});

export const router = createRouter({
  routeTree: rootRoute.addChildren([
    shellRoute.addChildren([indexRoute, tanyaRoute, pengetahuanRoute, pemeriksaanRoute, pengaturanRoute, notFoundRoute]),
  ]),
  defaultPreload: false,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
