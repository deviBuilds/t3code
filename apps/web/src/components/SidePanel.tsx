import { lazy, memo, Suspense, useCallback, useEffect } from "react";
import { GlobeIcon, CodeXmlIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import { isElectron } from "~/env";
import { selectProjectTabs, selectProjectActiveTabId, useSidePanelStore } from "~/sidePanelStore";
import { BrowserTabBar } from "./BrowserPanel";

const BrowserPanel = lazy(() => import("./BrowserPanel"));

// ── Editor Placeholder ──────────────────────────────────────────────────

const EditorPlaceholder = memo(function EditorPlaceholder() {
  return (
    <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
      <div className="flex flex-col items-center gap-3">
        <CodeXmlIcon className="size-10 opacity-30" />
        <span className="font-medium">Editor</span>
        <span className="text-xs opacity-60">Coming soon</span>
      </div>
    </div>
  );
});

// ── Loading Fallback ────────────────────────────────────────────────────

const BrowserLoadingFallback = memo(function BrowserLoadingFallback() {
  return (
    <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
      Loading browser...
    </div>
  );
});

// ── Main SidePanel ──────────────────────────────────────────────────────

export type SidePanelLayout = "sidebar" | "sheet";

function SidePanel({ layout, projectId }: { layout: SidePanelLayout; projectId: string | null }) {
  const mode = useSidePanelStore((s) => s.mode);
  const setMode = useSidePanelStore((s) => s.setMode);
  const setActiveProjectId = useSidePanelStore((s) => s.setActiveProjectId);
  const tabs = useSidePanelStore(selectProjectTabs);
  const activeTabId = useSidePanelStore(selectProjectActiveTabId);
  const setActiveTab = useSidePanelStore((s) => s.setActiveTab);
  const closeTab = useSidePanelStore((s) => s.closeTab);
  const addTab = useSidePanelStore((s) => s.addTab);

  useEffect(() => {
    setActiveProjectId(projectId);
  }, [projectId, setActiveProjectId]);

  const handleAddTab = useCallback(() => addTab(), [addTab]);

  return (
    <div
      className={cn(
        "flex h-full flex-col bg-background text-foreground",
        layout === "sheet" && "rounded-lg",
      )}
    >
      {/*
        Single top row: mode-switch icons + tabs (browser) or just icons (editor).
        The icons never change DOM position — no jump when switching modes.
      */}
      <div
        className={cn(
          "flex min-w-0 items-center gap-0.5 border-b border-border bg-card/60 px-1.5",
          isElectron ? "h-[52px]" : "h-10",
        )}
      >
        {/* Mode switch icons — always here */}
        <button
          type="button"
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-md transition-colors",
            mode === "browser"
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
          )}
          onClick={() => setMode("browser")}
          aria-label="Browser"
          title="Browser"
        >
          <GlobeIcon className="size-3.5" />
        </button>
        <button
          type="button"
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-md transition-colors",
            mode === "editor"
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
          )}
          onClick={() => setMode("editor")}
          aria-label="Editor"
          title="Editor"
        >
          <CodeXmlIcon className="size-3.5" />
        </button>

        {/* Browser tabs — inline, same row */}
        {mode === "browser" && (
          <BrowserTabBar
            tabs={tabs}
            activeTabId={activeTabId}
            onActivate={setActiveTab}
            onClose={closeTab}
            onAddTab={handleAddTab}
          />
        )}
      </div>

      {/* Browser mode — always mounted to keep webviews alive */}
      <div className={cn("flex min-h-0 flex-1 flex-col", mode === "browser" ? "flex" : "hidden")}>
        <Suspense fallback={<BrowserLoadingFallback />}>
          <BrowserPanel layout={layout} />
        </Suspense>
      </div>

      {/* Editor mode */}
      <div className={cn("flex min-h-0 flex-1 flex-col", mode === "editor" ? "flex" : "hidden")}>
        <EditorPlaceholder />
      </div>
    </div>
  );
}

export default SidePanel;
