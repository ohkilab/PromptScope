type TextBlock =
  | { kind: "paragraph"; lines: string[] }
  | { kind: "unordered" | "ordered"; items: string[]; start: number };

/** Render line breaks and simple lists as text, without interpreting HTML. */
export function FormattedText({ text }: { text: string }) {
  const blocks: TextBlock[] = [];
  let current: TextBlock | undefined;

  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (!line.trim()) {
      current = undefined;
      continue;
    }
    const bullet = line.match(/^\s*(?:[-*+]\s+|[・•]\s*)(\S.*)$/);
    const numbered = line.match(/^\s*(\d+)[.)]\s+(\S.*)$/);
    if (bullet || numbered) {
      const kind = bullet ? "unordered" : "ordered";
      const item = bullet ? bullet[1] : numbered![2];
      if (!current || current.kind !== kind) {
        current = { kind, items: [], start: numbered ? Number(numbered[1]) : 1 };
        blocks.push(current);
      }
      current.items.push(item);
    } else if (current && current.kind !== "paragraph" && /^(?: {2}|\t)/.test(line)) {
      current.items[current.items.length - 1] += `\n${line.trim()}`;
    } else {
      if (!current || current.kind !== "paragraph") {
        current = { kind: "paragraph", lines: [] };
        blocks.push(current);
      }
      current.lines.push(line);
    }
  }

  return <div className="formatted-text">{blocks.map((block, index) => {
    if (block.kind === "paragraph") return <p key={index}>{block.lines.join("\n")}</p>;
    const items = block.items.map((item, itemIndex) => <li key={itemIndex}>{item}</li>);
    return block.kind === "ordered"
      ? <ol key={index} start={block.start}>{items}</ol>
      : <ul key={index}>{items}</ul>;
  })}</div>;
}
