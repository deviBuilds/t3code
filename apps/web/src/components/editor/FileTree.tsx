import { memo, useCallback, useMemo, useState } from "react";
import { ChevronRightIcon, ChevronDownIcon } from "lucide-react";
import type { ProjectEntry } from "@t3tools/contracts";
import { cn } from "~/lib/utils";
import { useTheme } from "~/hooks/useTheme";
import { VscodeEntryIcon } from "~/components/chat/VscodeEntryIcon";

interface TreeNode {
  entry: ProjectEntry;
  name: string;
  depth: number;
  children: TreeNode[];
}

function buildTree(entries: readonly ProjectEntry[]): TreeNode[] {
  const byParent = new Map<string, ProjectEntry[]>();
  for (const entry of entries) {
    const parent = entry.parentPath ?? "";
    let list = byParent.get(parent);
    if (!list) {
      list = [];
      byParent.set(parent, list);
    }
    list.push(entry);
  }

  function buildChildren(parentPath: string, depth: number): TreeNode[] {
    const children = byParent.get(parentPath) ?? [];
    children.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
      return a.path.localeCompare(b.path);
    });
    return children.map((entry) => {
      const parts = entry.path.split("/");
      const name = parts[parts.length - 1] ?? entry.path;
      return {
        entry,
        name,
        depth,
        children: entry.kind === "directory" ? buildChildren(entry.path, depth + 1) : [],
      };
    });
  }

  return buildChildren("", 0);
}

function flattenVisible(nodes: TreeNode[], expanded: Set<string>): TreeNode[] {
  const result: TreeNode[] = [];
  function walk(list: TreeNode[]) {
    for (const node of list) {
      result.push(node);
      if (node.entry.kind === "directory" && expanded.has(node.entry.path)) {
        walk(node.children);
      }
    }
  }
  walk(nodes);
  return result;
}

const FileTreeRow = memo(function FileTreeRow({
  node,
  isExpanded,
  isActive,
  theme,
  onToggle,
  onClick,
  onDoubleClick,
}: {
  node: TreeNode;
  isExpanded: boolean;
  isActive: boolean;
  theme: "light" | "dark";
  onToggle: () => void;
  onClick: () => void;
  onDoubleClick: () => void;
}) {
  const isDir = node.entry.kind === "directory";
  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-center gap-1 py-0.5 pr-2 text-left text-[12px] transition-colors hover:bg-accent/50",
        isActive && "bg-accent/70 text-foreground",
      )}
      style={{ paddingLeft: `${node.depth * 16 + 4}px` }}
      onClick={() => {
        if (isDir) onToggle();
        else onClick();
      }}
      onDoubleClick={() => {
        if (!isDir) onDoubleClick();
      }}
    >
      {/* Chevron for directories */}
      {isDir ? (
        isExpanded ? (
          <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRightIcon className="size-3 shrink-0 text-muted-foreground" />
        )
      ) : (
        <span className="size-3 shrink-0" />
      )}
      {/* VSCode file/folder icon */}
      <VscodeEntryIcon
        pathValue={node.name}
        kind={node.entry.kind}
        theme={theme}
        className="size-4 shrink-0"
      />
      <span className="min-w-0 truncate">{node.name}</span>
    </button>
  );
});

export function FileTree({
  entries,
  activeFilePath,
  onFileClick,
  onFileDoubleClick,
}: {
  entries: readonly ProjectEntry[];
  activeFilePath: string | null;
  onFileClick: (relativePath: string) => void;
  onFileDoubleClick: (relativePath: string) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const { resolvedTheme } = useTheme();
  const tree = useMemo(() => buildTree(entries), [entries]);
  const visible = useMemo(() => flattenVisible(tree, expanded), [tree, expanded]);

  const toggleDir = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden py-1">
      {visible.map((node) => (
        <FileTreeRow
          key={node.entry.path}
          node={node}
          isExpanded={expanded.has(node.entry.path)}
          isActive={node.entry.path === activeFilePath}
          theme={resolvedTheme}
          onToggle={() => toggleDir(node.entry.path)}
          onClick={() => onFileClick(node.entry.path)}
          onDoubleClick={() => onFileDoubleClick(node.entry.path)}
        />
      ))}
      {visible.length === 0 && (
        <div className="flex items-center justify-center py-8 text-xs text-muted-foreground/50">
          No files
        </div>
      )}
    </div>
  );
}
