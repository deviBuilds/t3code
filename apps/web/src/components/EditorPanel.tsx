import { lazy, memo, Suspense, useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { SearchIcon } from "lucide-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { fileTreeQueryOptions } from "~/lib/editorReactQuery";
import {
  type EditorTab,
  selectProjectEditorTabs,
  selectProjectActiveEditorTabId,
  useSidePanelStore,
} from "~/sidePanelStore";
import { FileTree } from "./editor/FileTree";

const MonacoEditor = lazy(() => import("./editor/MonacoEditor"));

// ── Editor state lookup by key ─────────────────────────────────────────

const EMPTY_EDITOR_STATE = Object.freeze({ tabs: [] as EditorTab[], activeTabId: null });
function getEditorByKey(
  stateMap: Record<string, { tabs: EditorTab[]; activeTabId: string | null }>,
  key: string,
): { tabs: EditorTab[]; activeTabId: string | null } {
  return stateMap[key] ?? EMPTY_EDITOR_STATE;
}

const EditorPanel = memo(function EditorPanel({
  environmentId,
  cwd,
  storeKey,
}: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  storeKey?: string;
}) {
  const scopeStore = useCallback(() => {
    if (storeKey) useSidePanelStore.setState({ activeProjectId: storeKey });
  }, [storeKey]);

  const selectTabs = useCallback(
    storeKey
      ? (s: Parameters<typeof selectProjectEditorTabs>[0]) => getEditorByKey(s.editorStateByProjectId, storeKey).tabs
      : selectProjectEditorTabs,
    [storeKey],
  );
  const selectActiveTabId = useCallback(
    storeKey
      ? (s: Parameters<typeof selectProjectActiveEditorTabId>[0]) => getEditorByKey(s.editorStateByProjectId, storeKey).activeTabId
      : selectProjectActiveEditorTabId,
    [storeKey],
  );
  const editorTabs = useSidePanelStore(selectTabs);
  const activeEditorTabId = useSidePanelStore(selectActiveTabId);
  const rawOpenEditorFile = useSidePanelStore((s) => s.openEditorFile);
  const rawPinEditorTab = useSidePanelStore((s) => s.pinEditorTab);
  const openEditorFile = useCallback((path: string) => { scopeStore(); rawOpenEditorFile(path); }, [scopeStore, rawOpenEditorFile]);
  const pinEditorTab = useCallback((tabId: string) => { scopeStore(); rawPinEditorTab(tabId); }, [scopeStore, rawPinEditorTab]);

  const fileTreeQuery = useQuery(fileTreeQueryOptions({ environmentId, cwd }));
  const entries = fileTreeQuery.data?.entries ?? [];

  const [searchQuery, setSearchQuery] = useState("");

  const filteredEntries =
    searchQuery.length > 0
      ? entries.filter((e) => e.path.toLowerCase().includes(searchQuery.toLowerCase()))
      : entries;

  const activeTab = editorTabs.find((t) => t.id === activeEditorTabId) ?? null;
  const activeFilePath = activeTab?.relativePath ?? null;

  const handleFileClick = useCallback(
    (relativePath: string) => {
      openEditorFile(relativePath);
    },
    [openEditorFile],
  );

  const handleFileDoubleClick = useCallback(
    (relativePath: string) => {
      openEditorFile(relativePath);
      const stateKey = storeKey ?? useSidePanelStore.getState().activeProjectId;
      if (!stateKey) return;
      const editorState = useSidePanelStore.getState().editorStateByProjectId[stateKey];
      const tab = editorState?.tabs.find((t) => t.relativePath === relativePath);
      if (tab) pinEditorTab(tab.id);
    },
    [openEditorFile, pinEditorTab, storeKey],
  );

  return (
    <div className="flex min-h-0 flex-1">
      {/* Left: File tree */}
      <div className="flex w-52 shrink-0 flex-col border-r border-border bg-card">
        <div className="p-1.5">
          <div className="relative">
            <SearchIcon className="absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-6 w-full rounded-md bg-accent/40 pl-7 pr-2 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
              placeholder="Search files..."
            />
          </div>
        </div>
        <FileTree
          entries={filteredEntries}
          activeFilePath={activeFilePath}
          onFileClick={handleFileClick}
          onFileDoubleClick={handleFileDoubleClick}
        />
      </div>

      {/* Right: Monaco editor (no duplicate tab bar — it's in SidePanel top row) */}
      <div className="flex min-w-0 flex-1 flex-col">
        <Suspense
          fallback={
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              Loading editor...
            </div>
          }
        >
          <MonacoEditor environmentId={environmentId} cwd={cwd} relativePath={activeFilePath} />
        </Suspense>
      </div>
    </div>
  );
});

export default EditorPanel;
