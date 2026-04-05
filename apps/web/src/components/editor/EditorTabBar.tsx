import { memo } from "react";
import { XIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import { useTheme } from "~/hooks/useTheme";
import { VscodeEntryIcon } from "~/components/chat/VscodeEntryIcon";
import type { EditorTab } from "~/sidePanelStore";

function basename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

const EditorTabItem = memo(function EditorTabItem({
  tab,
  isActive,
  theme,
  onActivate,
  onClose,
  onDoubleClick,
}: {
  tab: EditorTab;
  isActive: boolean;
  theme: "light" | "dark";
  onActivate: () => void;
  onClose: () => void;
  onDoubleClick: () => void;
}) {
  const name = basename(tab.relativePath);
  return (
    <button
      type="button"
      className={cn(
        "group/etab relative flex min-w-0 max-w-[180px] shrink items-center gap-1.5 border-b-2 px-3 py-1 text-xs transition-colors",
        isActive
          ? "border-primary bg-background text-foreground"
          : "border-transparent bg-transparent text-muted-foreground hover:bg-accent/40 hover:text-foreground",
        !tab.pinned && "italic",
      )}
      onClick={onActivate}
      onDoubleClick={onDoubleClick}
      title={tab.relativePath}
    >
      <VscodeEntryIcon pathValue={name} kind="file" theme={theme} className="size-3.5 shrink-0" />
      <span className="min-w-0 truncate">{name}</span>
      <button
        type="button"
        className="ml-0.5 shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-accent group-hover/etab:opacity-100"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label="Close tab"
      >
        <XIcon className="size-2.5" />
      </button>
    </button>
  );
});

export function EditorTabBar({
  tabs,
  activeTabId,
  onActivate,
  onClose,
  onPin,
}: {
  tabs: EditorTab[];
  activeTabId: string | null;
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onPin: (tabId: string) => void;
}) {
  const { resolvedTheme } = useTheme();
  if (tabs.length === 0) return null;
  return (
    <>
      {tabs.map((tab) => (
        <EditorTabItem
          key={tab.id}
          tab={tab}
          isActive={tab.id === activeTabId}
          theme={resolvedTheme}
          onActivate={() => onActivate(tab.id)}
          onClose={() => onClose(tab.id)}
          onDoubleClick={() => onPin(tab.id)}
        />
      ))}
    </>
  );
}
