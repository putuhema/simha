import { useEffect, useState } from "react";

/** Reports whether a CSS media query currently matches, and follows changes. */
const useMediaQuery = (query: string) => {
  const [matches, setMatches] = useState(() => (typeof window === "undefined" ? false : window.matchMedia(query).matches));

  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);

  return matches;
};

/** Wide enough for three columns: the sidebar, the chat and the card panel. */
export const useWideLayout = () => useMediaQuery("(min-width: 1200px)");
