import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "../../lib/cn.ts";

/** AI answer text. Raw HTML in the answer is not rendered. */
export const Markdown = ({ text, className }: { readonly text: string; readonly className?: string }) => (
  <div className={cn("prose-answer", className)}>
    <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
      {text}
    </ReactMarkdown>
  </div>
);
