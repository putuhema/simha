import { twMerge } from "tailwind-merge";

/** Joins class names; later Tailwind classes win over earlier ones. */
export const cn = (...classes: Array<string | false | null | undefined>) => twMerge(classes.filter(Boolean).join(" "));
