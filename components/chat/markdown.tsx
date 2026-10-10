"use client";

import { memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import type { Components } from "react-markdown";
import { sanitizeStreamMarkdown } from "@/lib/chat/markdown";
import { cn } from "@/lib/utils";

const CARET = "\u258D";

const markdownComponents: Components = {
  p: (props) => (
    <p className="my-2 text-[0.95rem] leading-7 first:mt-0 last:mb-0" {...restOf(props)}>
      {props.children}
    </p>
  ),
  h1: (props) => (
    <h1 className="mt-4 mb-2 text-xl font-semibold tracking-tight first:mt-0" {...restOf(props)}>
      {props.children}
    </h1>
  ),
  h2: (props) => (
    <h2 className="mt-4 mb-2 text-lg font-semibold tracking-tight first:mt-0" {...restOf(props)}>
      {props.children}
    </h2>
  ),
  h3: (props) => (
    <h3 className="mt-3 mb-1.5 text-base font-semibold first:mt-0" {...restOf(props)}>
      {props.children}
    </h3>
  ),
  h4: (props) => (
    <h4 className="mt-3 mb-1.5 text-sm font-semibold first:mt-0" {...restOf(props)}>
      {props.children}
    </h4>
  ),
  a: (props) => (
    <a
      className="font-medium text-primary underline underline-offset-4 hover:opacity-80"
      href={props.href}
      target={props.href?.startsWith("http") ? "_blank" : undefined}
      rel={props.href?.startsWith("http") ? "noreferrer" : undefined}
    >
      {props.children}
    </a>
  ),
  ul: (props) => (
    <ul className="my-2 flex list-disc flex-col gap-1 pl-5 marker:text-muted-foreground" {...restOf(props)}>
      {props.children}
    </ul>
  ),
  ol: (props) => (
    <ol className="my-2 flex list-decimal flex-col gap-1 pl-5 marker:text-muted-foreground" {...restOf(props)}>
      {props.children}
    </ol>
  ),
  li: (props) => (
    <li className="text-[0.95rem] leading-7 [&>p]:my-0" {...restOf(props)}>
      {props.children}
    </li>
  ),
  blockquote: (props) => (
    <blockquote
      className="my-3 border-l-2 border-border pl-3 text-muted-foreground italic"
      {...restOf(props)}
    >
      {props.children}
    </blockquote>
  ),
  hr: (props) => <hr className="my-4 border-border" {...restOf(props)} />,
  strong: (props) => <strong className="font-semibold" {...restOf(props)}>{props.children}</strong>,
  em: (props) => <em className="italic" {...restOf(props)}>{props.children}</em>,
  table: (props) => (
    <div className="my-3 overflow-x-auto rounded-lg border border-border/70">
      <table className="w-full border-collapse text-sm" {...restOf(props)}>
        {props.children}
      </table>
    </div>
  ),
  thead: (props) => <thead className="bg-muted/50" {...restOf(props)}>{props.children}</thead>,
  th: (props) => (
    <th className="border-border/70 px-3 py-2 text-left font-medium" {...restOf(props)}>
      {props.children}
    </th>
  ),
  td: (props) => (
    <td className="border-border/70 px-3 py-2 align-top" {...restOf(props)}>
      {props.children}
    </td>
  ),
  pre: (props) => (
    <pre className="my-3 overflow-x-auto rounded-lg border border-border/70 bg-black/45 p-3 text-xs leading-5 dark:bg-black/60" {...restOf(props)}>
      {props.children}
    </pre>
  ),
  code: (props) => {
    const className = props.className ?? "";
    const isBlock = className.includes("language-") || className.includes("hljs");

    if (isBlock) {
      return (
        <code className={cn("font-mono text-xs", className)} {...restOf(props)}>
          {props.children}
        </code>
      );
    }

    return (
      <code
        className="rounded bg-muted/70 px-1.5 py-0.5 font-mono text-[0.85em] text-foreground/90"
        {...restOf(props)}
      >
        {props.children}
      </code>
    );
  },
};

function restOf<T extends { node?: unknown; className?: unknown }>(
  props: T,
): Omit<T, "node" | "className"> {
  const rest = { ...props } as Record<string, unknown>;
  delete rest.node;
  delete rest.className;
  return rest as Omit<T, "node" | "className">;
}

type Props = {
  content: string;
  streaming?: boolean;
  className?: string;
};

export const MarkdownStream = memo(function MarkdownStream({
  content,
  streaming = false,
  className,
}: Props) {
  const source = useMemo(() => {
    if (!streaming) return content;
    const withCaret = content.length > 0 ? `${content}${CARET}` : CARET;
    return sanitizeStreamMarkdown(withCaret);
  }, [content, streaming]);

  return (
    <div className={cn("chat-markdown", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: false, ignoreMissing: true }]]}
        components={markdownComponents}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
});
