import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefCallback,
} from "react";
import {
  GlobeIcon,
  PlusIcon,
  XIcon,
  Trash2Icon,
  ArrowLeftIcon,
  ArrowRightIcon,
  RotateCwIcon,
  StarIcon,
  ListIcon,
  EllipsisIcon,
  SearchIcon,
  SquareTerminalIcon,
  FolderIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  GripVerticalIcon,
} from "lucide-react";
import {
  DndContext,
  DragOverlay,
  useDroppable,
  useDraggable,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type CollisionDetection,
  pointerWithin,
  closestCorners,
} from "@dnd-kit/core";
import { Button } from "./ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "./ui/menu";
import { cn } from "~/lib/utils";
import {
  type BrowserTab,
  type BrowserHistoryEntry,
  type FavoriteFolder,
  faviconUrlForSite,
  selectProjectTabs,
  selectProjectActiveTabId,
  useSidePanelStore,
} from "~/sidePanelStore";
import { isElectron } from "~/env";

// ── Electron webview type augmentation ──────────────────────────────────

interface ElectronWebviewElement extends HTMLElement {
  src: string;
  goBack: () => void;
  goForward: () => void;
  reload: () => void;
  reloadIgnoringCache: () => void;
  openDevTools: () => void;
  loadURL: (url: string) => Promise<void>;
  getTitle: () => string;
  getURL: () => string;
}

// ── Favicon ─────────────────────────────────────────────────────────────

const TabFavicon = memo(function TabFavicon({
  favicon,
  className,
}: {
  favicon: string | null;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const lastFaviconRef = useRef(favicon);

  if (favicon !== lastFaviconRef.current) {
    lastFaviconRef.current = favicon;
    setFailed(false);
  }

  if (!favicon || failed) {
    return <GlobeIcon className={cn("size-3 shrink-0 opacity-60", className)} />;
  }

  return (
    <img
      src={favicon}
      alt=""
      className={cn("size-3 shrink-0", className)}
      onError={() => setFailed(true)}
    />
  );
});

// ── Tab Bar ─────────────────────────────────────────────────────────────

const BrowserTabItem = memo(function BrowserTabItem({
  tab,
  isActive,
  onActivate,
  onClose,
}: {
  tab: BrowserTab;
  isActive: boolean;
  onActivate: () => void;
  onClose: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "group/tab relative flex min-w-0 max-w-[200px] shrink items-center gap-1.5 px-3 py-1.5 text-xs transition-colors",
        isActive
          ? "rounded-t-lg bg-background text-foreground"
          : "bg-transparent text-muted-foreground hover:bg-accent/40 hover:text-foreground",
      )}
      onClick={onActivate}
      title={tab.title}
    >
      <TabFavicon favicon={tab.favicon} />
      <span className="min-w-0 truncate">{tab.title}</span>
      <button
        type="button"
        className="ml-1 shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-accent group-hover/tab:opacity-100"
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

const BrowserTabBar = memo(function BrowserTabBar({
  tabs,
  activeTabId,
  onActivate,
  onClose,
  onAddTab,
}: {
  tabs: BrowserTab[];
  activeTabId: string | null;
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onAddTab: () => void;
}) {
  return (
    <>
      <div className="flex min-w-0 items-end gap-0 overflow-x-auto">
        {tabs.map((tab) => (
          <BrowserTabItem
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeTabId}
            onActivate={() => onActivate(tab.id)}
            onClose={() => onClose(tab.id)}
          />
        ))}
      </div>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className="size-6 shrink-0 text-muted-foreground"
              onClick={onAddTab}
              aria-label="New tab"
            >
              <PlusIcon className="size-3.5" />
            </Button>
          }
        />
        <TooltipPopup side="bottom">New tab</TooltipPopup>
      </Tooltip>
    </>
  );
});

// ── History / Favorites Panel ───────────────────────────────────────────

function groupHistoryByTime(entries: BrowserHistoryEntry[]): {
  today: BrowserHistoryEntry[];
  last30: BrowserHistoryEntry[];
  older: BrowserHistoryEntry[];
} {
  const now = Date.now();
  const dayMs = 86_400_000;
  const todayStart = now - dayMs;
  const last30Start = now - 30 * dayMs;
  const today: BrowserHistoryEntry[] = [];
  const last30: BrowserHistoryEntry[] = [];
  const older: BrowserHistoryEntry[] = [];
  for (const entry of entries) {
    const ts = Date.parse(entry.visitedAt);
    if (ts >= todayStart) today.push(entry);
    else if (ts >= last30Start) last30.push(entry);
    else older.push(entry);
  }
  return { today, last30, older };
}

// ── Draggable history/favorite entry ────────────────────────────────────

function DraggableEntry({
  dragId,
  dragData,
  children,
}: {
  dragId: string;
  dragData: { type: string; entry: BrowserHistoryEntry };
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: dragId,
    data: dragData,
  });

  return (
    <div ref={setNodeRef} className={cn(isDragging && "opacity-40")} {...attributes} {...listeners}>
      {children}
    </div>
  );
}

// ── Droppable zone ──────────────────────────────────────────────────────

function DroppableZone({
  dropId,
  dropData,
  children,
  className,
}: {
  dropId: string;
  dropData: Record<string, unknown>;
  children: ReactNode;
  className?: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: dropId, data: dropData });
  return (
    <div
      ref={setNodeRef}
      className={cn(className, isOver && "rounded-md ring-2 ring-primary/40 bg-primary/5")}
    >
      {children}
    </div>
  );
}

// ── Favorite folder item ────────────────────────────────────────────────

function FavoriteFolderItem({
  folder,
  onToggle,
  onDelete,
  onRename,
  onNavigate,
  onRemoveEntry,
}: {
  folder: FavoriteFolder;
  onToggle: () => void;
  onDelete: () => void;
  onRename: (name: string) => void;
  onNavigate: (url: string) => void;
  onRemoveEntry: (url: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(folder.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const commitRename = () => {
    const trimmed = editName.trim();
    if (trimmed.length > 0 && trimmed !== folder.name) onRename(trimmed);
    setEditing(false);
  };

  return (
    <DroppableZone
      dropId={`folder-${folder.id}`}
      dropData={{ type: "favorite-folder", folderId: folder.id }}
      className="mt-0.5"
    >
      <div className="group/folder flex items-center">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors hover:bg-accent/50"
        >
          {folder.collapsed ? (
            <ChevronRightIcon className="size-3 shrink-0" />
          ) : (
            <ChevronDownIcon className="size-3 shrink-0" />
          )}
          {folder.collapsed ? (
            <FolderIcon className="size-3 shrink-0" />
          ) : (
            <FolderOpenIcon className="size-3 shrink-0" />
          )}
          {editing ? (
            <input
              ref={inputRef}
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") setEditing(false);
                e.stopPropagation();
              }}
              onClick={(e) => e.stopPropagation()}
              className="min-w-0 flex-1 bg-transparent text-xs outline-none"
            />
          ) : (
            <span
              className="min-w-0 flex-1 truncate text-left"
              onDoubleClick={(e) => {
                e.stopPropagation();
                setEditName(folder.name);
                setEditing(true);
              }}
            >
              {folder.name}
            </span>
          )}
          <span className="text-[10px] text-muted-foreground/50">{folder.entries.length}</span>
        </button>
        <button
          type="button"
          className="mr-1 shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover/folder:opacity-100"
          onClick={onDelete}
          aria-label="Delete folder"
        >
          <Trash2Icon className="size-3" />
        </button>
      </div>
      {!folder.collapsed && folder.entries.length > 0 && (
        <div className="ml-3 border-l border-border/30 pl-1">
          {folder.entries.map((entry) => (
            <div
              key={entry.url}
              className="group/fentry flex items-center rounded-md transition-colors hover:bg-accent/50"
            >
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1 text-left text-xs"
                onClick={() => onNavigate(entry.url)}
                title={entry.url}
              >
                <TabFavicon favicon={entry.favicon} className="size-3" />
                <span className="min-w-0 truncate flex-1">{entry.title || entry.url}</span>
              </button>
              <button
                type="button"
                className="mr-1 shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover/fentry:opacity-100"
                onClick={() => onRemoveEntry(entry.url)}
                aria-label="Remove"
              >
                <Trash2Icon className="size-2.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </DroppableZone>
  );
}

// ── Drag overlay preview ────────────────────────────────────────────────

function DragPreview({ entry }: { entry: BrowserHistoryEntry }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-xs shadow-lg">
      <TabFavicon favicon={entry.favicon} className="size-3.5" />
      <span className="max-w-[160px] truncate">{entry.title || entry.url}</span>
    </div>
  );
}

// ── History Panel ───────────────────────────────────────────────────────

const HistoryPanel = memo(function HistoryPanel({
  history,
  favorites,
  favoriteFolders,
  onNavigate,
  onToggleFavorite,
  onRemoveHistoryEntry,
  onClose,
  onAddFavoriteFolder,
  onRenameFavoriteFolder,
  onDeleteFavoriteFolder,
  onToggleFavoriteFolder,
  onMoveHistoryToFavorites,
  onMoveFavoriteToFolder,
  onRemoveFavoriteFromFolder,
}: {
  history: BrowserHistoryEntry[];
  favorites: BrowserHistoryEntry[];
  favoriteFolders: FavoriteFolder[];
  onNavigate: (url: string) => void;
  onToggleFavorite: (entry: Omit<BrowserHistoryEntry, "visitedAt">) => void;
  onRemoveHistoryEntry: (url: string) => void;
  onClose: () => void;
  onAddFavoriteFolder: (name: string) => void;
  onRenameFavoriteFolder: (folderId: string, name: string) => void;
  onDeleteFavoriteFolder: (folderId: string) => void;
  onToggleFavoriteFolder: (folderId: string) => void;
  onMoveHistoryToFavorites: (
    entry: Omit<BrowserHistoryEntry, "visitedAt">,
    folderId?: string,
  ) => void;
  onMoveFavoriteToFolder: (url: string, folderId: string) => void;
  onRemoveFavoriteFromFolder: (url: string, folderId: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const newFolderRef = useRef<HTMLInputElement>(null);
  const [draggedEntry, setDraggedEntry] = useState<BrowserHistoryEntry | null>(null);
  const lcSearch = search.toLowerCase();

  useEffect(() => {
    if (creatingFolder) newFolderRef.current?.focus();
  }, [creatingFolder]);

  const filteredFavorites = useMemo(
    () =>
      lcSearch.length === 0
        ? favorites
        : favorites.filter(
            (f) =>
              f.title.toLowerCase().includes(lcSearch) || f.url.toLowerCase().includes(lcSearch),
          ),
    [favorites, lcSearch],
  );
  const filteredHistory = useMemo(
    () =>
      lcSearch.length === 0
        ? history
        : history.filter(
            (h) =>
              h.title.toLowerCase().includes(lcSearch) || h.url.toLowerCase().includes(lcSearch),
          ),
    [history, lcSearch],
  );
  const filteredFolders = useMemo(
    () =>
      lcSearch.length === 0
        ? favoriteFolders
        : favoriteFolders.filter(
            (f) =>
              f.name.toLowerCase().includes(lcSearch) ||
              f.entries.some(
                (e) =>
                  e.title.toLowerCase().includes(lcSearch) ||
                  e.url.toLowerCase().includes(lcSearch),
              ),
          ),
    [favoriteFolders, lcSearch],
  );
  const grouped = useMemo(() => groupHistoryByTime(filteredHistory), [filteredHistory]);

  // dnd-kit
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const collisionDetection = useCallback<CollisionDetection>((args) => {
    const pointer = pointerWithin(args);
    if (pointer.length > 0) return pointer;
    return closestCorners(args);
  }, []);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current as { entry?: BrowserHistoryEntry } | undefined;
    if (data?.entry) setDraggedEntry(data.entry);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setDraggedEntry(null);
      const { active, over } = event;
      if (!over) return;
      const activeData = active.data.current as
        | { type?: string; entry?: BrowserHistoryEntry }
        | undefined;
      const overData = over.data.current as { type?: string; folderId?: string } | undefined;
      if (!activeData?.entry) return;

      if (activeData.type === "history-entry") {
        if (over.id === "favorites-drop-zone") {
          onMoveHistoryToFavorites(activeData.entry);
        } else if (overData?.type === "favorite-folder" && overData.folderId) {
          onMoveHistoryToFavorites(activeData.entry, overData.folderId);
        }
      } else if (activeData.type === "top-level-favorite") {
        if (overData?.type === "favorite-folder" && overData.folderId) {
          onMoveFavoriteToFolder(activeData.entry.url, overData.folderId);
        }
      }
    },
    [onMoveHistoryToFavorites, onMoveFavoriteToFolder],
  );

  const commitNewFolder = () => {
    const trimmed = newFolderName.trim();
    if (trimmed.length > 0) onAddFavoriteFolder(trimmed);
    setCreatingFolder(false);
    setNewFolderName("");
  };

  const renderHistoryEntry = (entry: BrowserHistoryEntry) => (
    <DraggableEntry
      key={`h|${entry.url}`}
      dragId={`history-${entry.url}`}
      dragData={{ type: "history-entry", entry }}
    >
      <div className="group/hentry flex items-center rounded-md transition-colors hover:bg-accent/50">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1 text-left text-xs"
          onClick={() => onNavigate(entry.url)}
          title={entry.url}
        >
          <GripVerticalIcon className="size-2.5 shrink-0 cursor-grab opacity-0 group-hover/hentry:opacity-40" />
          <TabFavicon favicon={entry.favicon} className="size-3.5" />
          <span className="min-w-0 truncate flex-1">{entry.title || entry.url}</span>
        </button>
        <button
          type="button"
          className="mr-1 shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover/hentry:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            onRemoveHistoryEntry(entry.url);
          }}
          aria-label="Remove from history"
        >
          <Trash2Icon className="size-3" />
        </button>
      </div>
    </DraggableEntry>
  );

  const renderSection = (label: string, entries: BrowserHistoryEntry[]) => {
    if (entries.length === 0) return null;
    return (
      <div className="mt-2">
        <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
          {label}
        </div>
        {entries.map(renderHistoryEntry)}
      </div>
    );
  };

  return (
    <>
      <div className="absolute inset-0 z-10" onClick={onClose} />
      <div className="absolute left-0 top-0 z-20 flex h-full w-52 flex-col border-r border-border bg-card shadow-lg">
        <div className="p-2">
          <div className="relative">
            <SearchIcon className="absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-7 w-full rounded-md bg-accent/40 pl-7 pr-2 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
              placeholder="Search"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-1 pb-2">
          <DndContext
            sensors={sensors}
            collisionDetection={collisionDetection}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            {/* ── Favorites section ── */}
            <DroppableZone dropId="favorites-drop-zone" dropData={{ type: "favorites-root" }}>
              <div className="group/fav-header flex items-center px-2 py-1">
                <span className="flex-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                  Favorites
                </span>
                <button
                  type="button"
                  className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover/fav-header:opacity-100"
                  onClick={() => {
                    setCreatingFolder(true);
                    setNewFolderName("");
                  }}
                  aria-label="Add folder"
                >
                  <FolderPlusIcon className="size-3" />
                </button>
              </div>

              {/* Inline folder creation */}
              {creatingFolder && (
                <div className="flex items-center gap-1 px-2 py-1">
                  <FolderIcon className="size-3 shrink-0 text-muted-foreground" />
                  <input
                    ref={newFolderRef}
                    type="text"
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    onBlur={commitNewFolder}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitNewFolder();
                      if (e.key === "Escape") {
                        setCreatingFolder(false);
                        setNewFolderName("");
                      }
                    }}
                    className="h-5 min-w-0 flex-1 rounded bg-accent/40 px-1.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
                    placeholder="Folder name"
                  />
                </div>
              )}

              {/* Top-level favorites */}
              {filteredFavorites.map((fav) => (
                <DraggableEntry
                  key={`f|${fav.url}`}
                  dragId={`fav-${fav.url}`}
                  dragData={{ type: "top-level-favorite", entry: fav }}
                >
                  <div className="group/fav flex items-center rounded-md transition-colors hover:bg-accent/50">
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1 text-left text-xs"
                      onClick={() => onNavigate(fav.url)}
                      title={fav.url}
                    >
                      <TabFavicon favicon={fav.favicon} className="size-3.5" />
                      <span className="min-w-0 truncate flex-1">{fav.title || fav.url}</span>
                    </button>
                    <button
                      type="button"
                      className="mr-1 shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover/fav:opacity-100"
                      onClick={() => onToggleFavorite(fav)}
                      aria-label="Remove favorite"
                    >
                      <Trash2Icon className="size-3" />
                    </button>
                  </div>
                </DraggableEntry>
              ))}

              {/* Folders */}
              {filteredFolders.map((folder) => (
                <FavoriteFolderItem
                  key={folder.id}
                  folder={folder}
                  onToggle={() => onToggleFavoriteFolder(folder.id)}
                  onDelete={() => onDeleteFavoriteFolder(folder.id)}
                  onRename={(name) => onRenameFavoriteFolder(folder.id, name)}
                  onNavigate={onNavigate}
                  onRemoveEntry={(url) => onRemoveFavoriteFromFolder(url, folder.id)}
                />
              ))}

              {filteredFavorites.length === 0 &&
                filteredFolders.length === 0 &&
                !creatingFolder && (
                  <div className="px-2 py-2 text-[10px] text-muted-foreground/50">
                    Drag items here or click ☆
                  </div>
                )}
            </DroppableZone>

            {/* ── History section ── */}
            {renderSection("Today", grouped.today)}
            {renderSection("Last 30 days", grouped.last30)}
            {renderSection("Older", grouped.older)}

            {filteredFavorites.length === 0 &&
              filteredFolders.length === 0 &&
              filteredHistory.length === 0 && (
                <div className="flex items-center justify-center py-8 text-xs text-muted-foreground/60">
                  No history yet
                </div>
              )}

            <DragOverlay>{draggedEntry ? <DragPreview entry={draggedEntry} /> : null}</DragOverlay>
          </DndContext>
        </div>
      </div>
    </>
  );
});

// ── Toolbar ─────────────────────────────────────────────────────────────

const BrowserToolbar = memo(function BrowserToolbar({
  url,
  isFavorite,
  historyOpen,
  onNavigate,
  onBack,
  onForward,
  onReload,
  onToggleHistory,
  onToggleFavorite,
  onHardReload,
  onCopyUrl,
  onClearHistory,
  onClearCookies,
  onClearCache,
  onOpenDevTools,
}: {
  url: string;
  isFavorite: boolean;
  historyOpen: boolean;
  onNavigate: (url: string) => void;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onToggleHistory: () => void;
  onToggleFavorite: () => void;
  onHardReload: () => void;
  onCopyUrl: () => void;
  onClearHistory: () => void;
  onClearCookies: () => void;
  onClearCache: () => void;
  onOpenDevTools: () => void;
}) {
  const [inputValue, setInputValue] = useState(url);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = useCallback(() => {
    let navigateUrl = inputValue.trim();
    if (navigateUrl.length === 0) return;
    if (!/^https?:\/\//i.test(navigateUrl)) {
      if (/\.\w+/.test(navigateUrl)) navigateUrl = `https://${navigateUrl}`;
      else navigateUrl = `https://www.google.com/search?q=${encodeURIComponent(navigateUrl)}`;
    }
    onNavigate(navigateUrl);
    inputRef.current?.blur();
  }, [inputValue, onNavigate]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  const lastUrlRef = useRef(url);
  if (url !== lastUrlRef.current) {
    lastUrlRef.current = url;
    setInputValue(url);
  }

  return (
    <div className="flex items-center gap-0.5 border-b border-border bg-background px-1.5 py-1">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "size-6 shrink-0",
                historyOpen ? "bg-accent text-foreground" : "text-muted-foreground",
              )}
              onClick={onToggleHistory}
              aria-label="History & favorites"
            >
              <ListIcon className="size-3.5" />
            </Button>
          }
        />
        <TooltipPopup side="bottom">History & favorites</TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className="size-6 shrink-0 text-muted-foreground"
              onClick={onBack}
              aria-label="Go back"
            >
              <ArrowLeftIcon className="size-3.5" />
            </Button>
          }
        />
        <TooltipPopup side="bottom">Go back</TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className="size-6 shrink-0 text-muted-foreground"
              onClick={onForward}
              aria-label="Go forward"
            >
              <ArrowRightIcon className="size-3.5" />
            </Button>
          }
        />
        <TooltipPopup side="bottom">Go forward</TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className="size-6 shrink-0 text-muted-foreground"
              onClick={onReload}
              aria-label="Reload"
            >
              <RotateCwIcon className="size-3.5" />
            </Button>
          }
        />
        <TooltipPopup side="bottom">Reload</TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "size-6 shrink-0",
                isFavorite ? "text-yellow-500" : "text-muted-foreground",
              )}
              onClick={onToggleFavorite}
              aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
            >
              <StarIcon className={cn("size-3.5", isFavorite && "fill-current")} />
            </Button>
          }
        />
        <TooltipPopup side="bottom">
          {isFavorite ? "Remove from favorites" : "Add to favorites"}
        </TooltipPopup>
      </Tooltip>
      <div className="relative flex min-w-0 flex-1 items-center">
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={(e) => e.target.select()}
          className="h-6 w-full rounded-md bg-accent/40 px-2.5 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:bg-accent/60 focus:ring-1 focus:ring-ring"
          placeholder="Search or enter URL"
        />
      </div>
      {isElectron && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className="size-6 shrink-0 text-muted-foreground"
                onClick={onOpenDevTools}
                aria-label="Open DevTools"
              >
                <SquareTerminalIcon className="size-3.5" />
              </Button>
            }
          />
          <TooltipPopup side="bottom">Open DevTools</TooltipPopup>
        </Tooltip>
      )}
      <Menu>
        <MenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className="size-6 shrink-0 text-muted-foreground"
              aria-label="More options"
            >
              <EllipsisIcon className="size-3.5" />
            </Button>
          }
        />
        <MenuPopup side="bottom" align="end">
          <MenuItem className="text-xs" onClick={onHardReload}>
            Hard Reload
          </MenuItem>
          <MenuItem className="text-xs" onClick={onCopyUrl}>
            Copy Current URL
          </MenuItem>
          <MenuItem className="text-xs" onClick={onClearHistory}>
            Clear Browsing History
          </MenuItem>
          <MenuItem className="text-xs" onClick={onClearCookies}>
            Clear Cookies
          </MenuItem>
          <MenuItem className="text-xs" onClick={onClearCache}>
            Clear Cache
          </MenuItem>
        </MenuPopup>
      </Menu>
    </div>
  );
});

// ── Electron Webview Tab ────────────────────────────────────────────────

function ElectronWebviewTab({
  tab,
  visible,
  onUrlChange,
  onTitleChange,
  onFaviconChange,
  webviewRef,
}: {
  tab: BrowserTab;
  visible: boolean;
  onUrlChange: (tabId: string, url: string) => void;
  onTitleChange: (tabId: string, title: string) => void;
  onFaviconChange: (tabId: string, favicon: string | null) => void;
  webviewRef: RefCallback<ElectronWebviewElement>;
}) {
  const internalRef = useRef<ElectronWebviewElement | null>(null);
  const setRef = useCallback(
    (el: ElectronWebviewElement | null) => {
      internalRef.current = el;
      webviewRef(el);
    },
    [webviewRef],
  );

  useEffect(() => {
    const webview = internalRef.current;
    if (!webview) return;

    const handleNavigation = () => {
      try {
        const raw = webview.getURL();
        const currentUrl = typeof raw === "string" ? raw : String(raw);
        if (!currentUrl || currentUrl === "undefined" || currentUrl === "[object Object]") return;
        if (currentUrl !== tab.url) onUrlChange(tab.id, currentUrl);
      } catch {
        /* webview may not be ready */
      }
    };

    const handleTitleUpdate = () => {
      try {
        const title = webview.getTitle();
        if (title && title !== tab.title) onTitleChange(tab.id, title);
      } catch {
        /* webview may not be ready */
      }
    };

    const handleFaviconUpdate = (event: Event) => {
      try {
        const detail = event as CustomEvent;
        const favicons = detail.detail?.favicons as string[] | undefined;
        if (favicons && favicons.length > 0) onFaviconChange(tab.id, favicons[0] ?? null);
      } catch {
        /* ignore */
      }
    };

    webview.addEventListener("did-navigate", handleNavigation);
    webview.addEventListener("did-navigate-in-page", handleNavigation);
    webview.addEventListener("page-title-updated", handleTitleUpdate);
    webview.addEventListener("page-favicon-updated", handleFaviconUpdate);
    return () => {
      webview.removeEventListener("did-navigate", handleNavigation);
      webview.removeEventListener("did-navigate-in-page", handleNavigation);
      webview.removeEventListener("page-title-updated", handleTitleUpdate);
      webview.removeEventListener("page-favicon-updated", handleFaviconUpdate);
    };
  }, [tab.id, tab.url, tab.title, onUrlChange, onTitleChange, onFaviconChange]);

  const containerRef = useRef<HTMLDivElement>(null);
  const mountedTabIdRef = useRef<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (mountedTabIdRef.current === tab.id) return;
    mountedTabIdRef.current = tab.id;
    container.innerHTML = "";
    const webview = document.createElement("webview") as unknown as ElectronWebviewElement;
    webview.setAttribute("src", tab.url);
    webview.setAttribute("style", "width:100%;height:100%;border:none;");
    webview.setAttribute("partition", "persist:t3browser");
    webview.setAttribute("allowpopups", "");
    container.appendChild(webview as unknown as Node);
    setRef(webview);
    return () => {
      mountedTabIdRef.current = null;
      setRef(null);
      container.innerHTML = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id]);

  return (
    <div
      ref={containerRef}
      className={cn("absolute inset-0 size-full", visible ? "block" : "hidden")}
    />
  );
}

// ── Iframe fallback Tab ─────────────────────────────────────────────────

function IframeTab({
  tab,
  visible,
  iframeRef,
}: {
  tab: BrowserTab;
  visible: boolean;
  iframeRef: RefCallback<HTMLIFrameElement>;
}) {
  return (
    <iframe
      ref={iframeRef}
      src={tab.url}
      title={tab.title}
      className={cn("absolute inset-0 size-full border-none", visible ? "block" : "hidden")}
      sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
    />
  );
}

// ── Browser Content ─────────────────────────────────────────────────────

const BrowserContent = memo(function BrowserContent({
  allTabs,
  visibleTabId,
  viewRefs,
  onUrlChange,
  onTitleChange,
  onFaviconChange,
}: {
  allTabs: BrowserTab[];
  visibleTabId: string | null;
  viewRefs: React.MutableRefObject<
    Record<string, ElectronWebviewElement | HTMLIFrameElement | null>
  >;
  onUrlChange: (tabId: string, url: string) => void;
  onTitleChange: (tabId: string, title: string) => void;
  onFaviconChange: (tabId: string, favicon: string | null) => void;
}) {
  if (allTabs.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
        <div className="flex flex-col items-center gap-2">
          <GlobeIcon className="size-8 opacity-40" />
          <span>No tabs open</span>
        </div>
      </div>
    );
  }
  return (
    <div className="relative min-h-0 flex-1">
      {allTabs.map((tab) => {
        const visible = tab.id === visibleTabId;
        if (isElectron) {
          return (
            <ElectronWebviewTab
              key={tab.id}
              tab={tab}
              visible={visible}
              onUrlChange={onUrlChange}
              onTitleChange={onTitleChange}
              onFaviconChange={onFaviconChange}
              webviewRef={(el) => {
                viewRefs.current[tab.id] = el;
              }}
            />
          );
        }
        return (
          <IframeTab
            key={tab.id}
            tab={tab}
            visible={visible}
            iframeRef={(el) => {
              viewRefs.current[tab.id] = el;
            }}
          />
        );
      })}
    </div>
  );
});

// ── Helpers ─────────────────────────────────────────────────────────────

function isWebview(
  el: ElectronWebviewElement | HTMLIFrameElement | null,
): el is ElectronWebviewElement {
  return el !== null && (el as HTMLElement).tagName?.toLowerCase() === "webview";
}

// ── Main BrowserPanel ───────────────────────────────────────────────────

export type BrowserPanelLayout = "sidebar" | "sheet";
const HISTORY_DEBOUNCE_MS = 1500;

function BrowserPanel({ layout }: { layout: BrowserPanelLayout }) {
  const projectTabs = useSidePanelStore(selectProjectTabs);
  const projectActiveTabId = useSidePanelStore(selectProjectActiveTabId);
  const browserStateByProjectId = useSidePanelStore((s) => s.browserStateByProjectId);
  const allTabs = useMemo(() => {
    const result: BrowserTab[] = [];
    for (const pbs of Object.values(browserStateByProjectId)) {
      for (const tab of pbs.tabs) result.push(tab);
    }
    return result;
  }, [browserStateByProjectId]);

  const navigateTab = useSidePanelStore((s) => s.navigateTab);
  const updateTabTitle = useSidePanelStore((s) => s.updateTabTitle);
  const updateTabFavicon = useSidePanelStore((s) => s.updateTabFavicon);
  const addHistoryEntry = useSidePanelStore((s) => s.addHistoryEntry);
  const updateHistoryEntryTitle = useSidePanelStore((s) => s.updateHistoryEntryTitle);
  const removeHistoryEntry = useSidePanelStore((s) => s.removeHistoryEntry);
  const toggleFavorite = useSidePanelStore((s) => s.toggleFavorite);
  const clearHistory = useSidePanelStore((s) => s.clearHistory);
  const favorites = useSidePanelStore((s) => s.favorites);
  const favoriteFolders = useSidePanelStore((s) => s.favoriteFolders);
  const history = useSidePanelStore((s) => s.history);
  const addFavoriteFolder = useSidePanelStore((s) => s.addFavoriteFolder);
  const renameFavoriteFolder = useSidePanelStore((s) => s.renameFavoriteFolder);
  const deleteFavoriteFolder = useSidePanelStore((s) => s.deleteFavoriteFolder);
  const toggleFavoriteFolder = useSidePanelStore((s) => s.toggleFavoriteFolder);
  const moveFavoriteToFolder = useSidePanelStore((s) => s.moveFavoriteToFolder);
  const moveHistoryToFavorites = useSidePanelStore((s) => s.moveHistoryToFavorites);
  const removeFavoriteFromFolder = useSidePanelStore((s) => s.removeFavoriteFromFolder);

  const viewRefs = useRef<Record<string, ElectronWebviewElement | HTMLIFrameElement | null>>({});
  const activeTab = projectTabs.find((t) => t.id === projectActiveTabId) ?? null;
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  /** Tracks the latest URL per tab so we can pair it with the real title when it arrives */
  const pendingUrlByTabRef = useRef<Record<string, string>>({});

  const isFavorite = useMemo(() => {
    if (!activeTab) return false;
    if (favorites.some((f) => f.url === activeTab.url)) return true;
    return favoriteFolders.some((folder) => folder.entries.some((e) => e.url === activeTab.url));
  }, [activeTab, favorites, favoriteFolders]);

  const debouncedAddHistory = useCallback(
    (tabId: string, url: string, title: string, favicon: string | null) => {
      if (url === "about:blank" || url === "") return;
      const existing = historyTimersRef.current[tabId];
      if (existing) clearTimeout(existing);
      historyTimersRef.current[tabId] = setTimeout(() => {
        delete historyTimersRef.current[tabId];
        addHistoryEntry({ url, title, favicon });
      }, HISTORY_DEBOUNCE_MS);
    },
    [addHistoryEntry],
  );

  useEffect(() => {
    const timers = historyTimersRef.current;
    return () => {
      for (const timer of Object.values(timers)) clearTimeout(timer);
    };
  }, []);

  const handleNavigate = useCallback(
    (url: string) => {
      if (!projectActiveTabId) return;
      navigateTab(projectActiveTabId, url);
      const view = viewRefs.current[projectActiveTabId];
      if (!view) return;
      if (isWebview(view))
        view.loadURL(url).catch(() => {
          view.src = url;
        });
      else (view as HTMLIFrameElement).src = url;
    },
    [projectActiveTabId, navigateTab],
  );

  const handleBack = useCallback(() => {
    if (!projectActiveTabId) return;
    const view = viewRefs.current[projectActiveTabId];
    if (!view) return;
    if (isWebview(view)) view.goBack();
    else {
      try {
        (view as HTMLIFrameElement).contentWindow?.history.back();
      } catch {
        /* cross-origin */
      }
    }
  }, [projectActiveTabId]);

  const handleForward = useCallback(() => {
    if (!projectActiveTabId) return;
    const view = viewRefs.current[projectActiveTabId];
    if (!view) return;
    if (isWebview(view)) view.goForward();
    else {
      try {
        (view as HTMLIFrameElement).contentWindow?.history.forward();
      } catch {
        /* cross-origin */
      }
    }
  }, [projectActiveTabId]);

  const handleReload = useCallback(() => {
    if (!projectActiveTabId) return;
    const view = viewRefs.current[projectActiveTabId];
    if (!view) return;
    if (isWebview(view)) view.reload();
    else {
      try {
        (view as HTMLIFrameElement).contentWindow?.location.reload();
      } catch {
        if (activeTab) (view as HTMLIFrameElement).src = activeTab.url;
      }
    }
  }, [projectActiveTabId, activeTab]);

  const handleHardReload = useCallback(() => {
    if (!projectActiveTabId) return;
    const view = viewRefs.current[projectActiveTabId];
    if (!view) return;
    if (isWebview(view)) view.reloadIgnoringCache();
    else handleReload();
  }, [projectActiveTabId, handleReload]);

  const handleCopyUrl = useCallback(() => {
    if (activeTab?.url) void navigator.clipboard.writeText(activeTab.url);
  }, [activeTab]);

  const handleOpenDevTools = useCallback(() => {
    if (!projectActiveTabId) return;
    const view = viewRefs.current[projectActiveTabId];
    if (view && isWebview(view)) view.openDevTools();
  }, [projectActiveTabId]);

  const handleToggleFavorite = useCallback(() => {
    if (!activeTab || activeTab.url === "about:blank") return;
    toggleFavorite({ url: activeTab.url, title: activeTab.title, favicon: activeTab.favicon });
  }, [activeTab, toggleFavorite]);

  const handleUrlChange = useCallback(
    (tabId: string, rawUrl: string) => {
      if (
        typeof rawUrl !== "string" ||
        rawUrl === "" ||
        rawUrl === "[object Object]" ||
        rawUrl === "undefined"
      )
        return;
      navigateTab(tabId, rawUrl);
      // Track the URL so handleTitleChange can pair it with the real page title.
      // Don't record history here — wait for the page title to arrive.
      pendingUrlByTabRef.current[tabId] = rawUrl;
    },
    [navigateTab],
  );

  const handleTitleChange = useCallback(
    (tabId: string, title: string) => {
      updateTabTitle(tabId, title);
      // Now we have the real page title — record in history with it.
      const url = pendingUrlByTabRef.current[tabId];
      if (url && url !== "about:blank") {
        const tab = allTabs.find((t) => t.id === tabId);
        const favicon = tab?.favicon ?? faviconUrlForSite(url);
        // Debounce to skip intermediate redirects
        debouncedAddHistory(tabId, url, title, favicon);
        // Also update any existing history entry that was recorded with a hostname-only title
        updateHistoryEntryTitle(url, title);
      }
    },
    [updateTabTitle, updateHistoryEntryTitle, debouncedAddHistory, allTabs],
  );
  const handleFaviconChange = useCallback(
    (tabId: string, favicon: string | null) => {
      updateTabFavicon(tabId, favicon);
    },
    [updateTabFavicon],
  );
  const handleHistoryNavigate = useCallback(
    (url: string) => {
      handleNavigate(url);
      setHistoryOpen(false);
    },
    [handleNavigate],
  );

  void layout;

  return (
    <>
      <BrowserToolbar
        url={
          activeTab?.url && activeTab.url !== "about:blank" && activeTab.url !== "[object Object]"
            ? activeTab.url
            : ""
        }
        isFavorite={isFavorite}
        historyOpen={historyOpen}
        onNavigate={handleNavigate}
        onBack={handleBack}
        onForward={handleForward}
        onReload={handleReload}
        onToggleHistory={() => setHistoryOpen((o) => !o)}
        onToggleFavorite={handleToggleFavorite}
        onHardReload={handleHardReload}
        onCopyUrl={handleCopyUrl}
        onClearHistory={clearHistory}
        onClearCookies={() => {}}
        onClearCache={() => {}}
        onOpenDevTools={handleOpenDevTools}
      />
      <div className="relative flex min-h-0 flex-1 flex-col">
        {historyOpen && (
          <HistoryPanel
            history={history}
            favorites={favorites}
            favoriteFolders={favoriteFolders}
            onNavigate={handleHistoryNavigate}
            onToggleFavorite={toggleFavorite}
            onRemoveHistoryEntry={removeHistoryEntry}
            onClose={() => setHistoryOpen(false)}
            onAddFavoriteFolder={addFavoriteFolder}
            onRenameFavoriteFolder={renameFavoriteFolder}
            onDeleteFavoriteFolder={deleteFavoriteFolder}
            onToggleFavoriteFolder={toggleFavoriteFolder}
            onMoveHistoryToFavorites={moveHistoryToFavorites}
            onMoveFavoriteToFolder={moveFavoriteToFolder}
            onRemoveFavoriteFromFolder={removeFavoriteFromFolder}
          />
        )}
        <BrowserContent
          allTabs={allTabs}
          visibleTabId={projectActiveTabId}
          viewRefs={viewRefs}
          onUrlChange={handleUrlChange}
          onTitleChange={handleTitleChange}
          onFaviconChange={handleFaviconChange}
        />
      </div>
    </>
  );
}

export { BrowserTabBar };
export default BrowserPanel;
