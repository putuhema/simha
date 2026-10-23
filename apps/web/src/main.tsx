import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { router } from "./router.tsx";
// oxlint-disable-next-line import/no-unassigned-import -- the stylesheet is imported for its side effect
import "./styles.css";
import { desktop } from "./lib/desktop.ts";

// Inside the desktop app: lets CSS make room for the macOS window buttons.
if (desktop) document.documentElement.dataset["desktop"] = desktop.platform;

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");

createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
