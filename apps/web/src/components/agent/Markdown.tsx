import { memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "../../lib/cn.ts";
import { splitStreamingMarkdown } from "../../lib/streamingMarkdown.ts";
import { useSmoothText } from "../../lib/useSmoothText.ts";

const PLUGINS = [remarkGfm];

/**
 * The markdown parse itself. Memoized by text: reveal frames that add no new
 * characters (or a parent re-render, such as a keystroke in the composer) skip
 * remark entirely.
 */
const Blocks = memo(({ text }: { readonly text: string }) => (
  <ReactMarkdown remarkPlugins={PLUGINS} skipHtml>
    {text}
  </ReactMarkdown>
));

/** AI answer text. Raw HTML in the answer is not rendered. */
export const Markdown = ({ text, className }: { readonly text: string; readonly className?: string }) => (
  <div className={cn("prose-answer", className)}>
    <Blocks text={text} />
  </div>
);

/** An answer that may still be streaming: revealed smoothly, with a dot at the end while it is written. */
export const StreamingMarkdown = ({ text, streaming, className }: { readonly text: string; readonly streaming: boolean; readonly className?: string }) => {
  const smooth = useSmoothText(text, streaming);
  // While typing, parse the finished blocks once and only the tail per frame.
  // When typing ends, parse the complete answer once so it is exactly right.
  // The split itself is memoized too: a token that has not been revealed yet
  // does not need to rescan the answer.
  const { prefix, tail } = useMemo(
    () => (smooth.typing ? splitStreamingMarkdown(smooth.text) : { prefix: smooth.text, tail: "" }),
    [smooth.text, smooth.typing],
  );
  if (smooth.text === "") return null;
  return (
    <div className={cn("prose-answer", className, smooth.typing && "typing")}>
      {prefix ? <Blocks text={prefix} /> : null}
      {tail ? <Blocks text={tail} /> : null}
    </div>
  );
};
