import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "../../lib/cn.ts";
import { useSmoothText } from "../../lib/useSmoothText.ts";

/** AI answer text. Raw HTML in the answer is not rendered. */
export const Markdown = ({ text, className }: { readonly text: string; readonly className?: string }) => (
  <div className={cn("prose-answer", className)}>
    <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
      {text}
    </ReactMarkdown>
  </div>
);

/** An answer that may still be streaming: revealed smoothly, with a dot at the end while it is written. */
export const StreamingMarkdown = ({ text, streaming, className }: { readonly text: string; readonly streaming: boolean; readonly className?: string }) => {
  const smooth = useSmoothText(text, streaming);
  return smooth.text === "" ? null : <Markdown text={smooth.text} className={cn(smooth.typing && "typing", className)} />;
};
