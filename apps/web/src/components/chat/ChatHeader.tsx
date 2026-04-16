import {
  type EnvironmentId,
  type EditorId,
  type ProjectScript,
  type ResolvedKeybindingsConfig,
  type ThreadId,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime";
import { memo, useCallback, useRef, useState, type ReactNode } from "react";
import GitActionsControl from "../GitActionsControl";
import { type DraftId } from "~/composerDraftStore";
import { CodeXmlIcon, DiffIcon, GlobeIcon, PlusIcon, TerminalSquareIcon, XIcon } from "lucide-react";
import { Badge } from "../ui/badge";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import ProjectScriptsControl, { type NewProjectScriptInput } from "../ProjectScriptsControl";
import { Toggle } from "../ui/toggle";
import { SidebarTrigger } from "../ui/sidebar";
import { OpenInPicker } from "./OpenInPicker";

export interface PaneInfo {
  surfaceId: string;
  label: string;
}

interface ChatHeaderProps {
  activeThreadEnvironmentId: EnvironmentId;
  activeThreadId: ThreadId;
  draftId?: DraftId;
  activeThreadTitle: string;
  activeProjectName: string | undefined;
  isGitRepo: boolean;
  openInCwd: string | null;
  activeProjectScripts: ProjectScript[] | undefined;
  preferredScriptId: string | null;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  terminalAvailable: boolean;
  terminalOpen: boolean;
  terminalToggleShortcutLabel: string | null;
  diffToggleShortcutLabel: string | null;
  sidebarToggleShortcutLabel: string | null;
  gitCwd: string | null;
  diffOpen: boolean;
  sidePanelOpen: boolean;
  browserPanes: PaneInfo[];
  editorPanes: PaneInfo[];
  onRunProjectScript: (script: ProjectScript) => void;
  onAddProjectScript: (input: NewProjectScriptInput) => Promise<void>;
  onUpdateProjectScript: (scriptId: string, input: NewProjectScriptInput) => Promise<void>;
  onDeleteProjectScript: (scriptId: string) => Promise<void>;
  onToggleTerminal: () => void;
  onToggleDiff: () => void;
  onToggleSidePanel: () => void;
  onToggleEditor: () => void;
  onOpenNewBrowserPane: () => void;
  onOpenNewEditorPane: () => void;
  onClosePaneSurface: (surfaceId: string) => void;
  onFocusPaneSurface: (surfaceId: string) => void;
}

export const ChatHeader = memo(function ChatHeader({
  activeThreadEnvironmentId,
  activeThreadId,
  draftId,
  activeThreadTitle,
  activeProjectName,
  isGitRepo,
  openInCwd,
  activeProjectScripts,
  preferredScriptId,
  keybindings,
  availableEditors,
  terminalAvailable,
  terminalOpen,
  terminalToggleShortcutLabel,
  diffToggleShortcutLabel,
  sidebarToggleShortcutLabel,
  gitCwd,
  diffOpen,
  sidePanelOpen,
  browserPanes,
  editorPanes,
  onRunProjectScript,
  onAddProjectScript,
  onUpdateProjectScript,
  onDeleteProjectScript,
  onToggleTerminal,
  onToggleDiff,
  onToggleSidePanel,
  onToggleEditor,
  onOpenNewBrowserPane,
  onOpenNewEditorPane,
  onClosePaneSurface,
  onFocusPaneSurface,
}: ChatHeaderProps) {
  return (
    <div className="@container/header-actions flex min-w-0 flex-1 items-center gap-2">
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden sm:gap-3">
        <Tooltip>
          <TooltipTrigger render={<SidebarTrigger className="size-7 shrink-0" />} />
          <TooltipPopup side="bottom">
            {sidebarToggleShortcutLabel
              ? `Toggle sidebar (${sidebarToggleShortcutLabel})`
              : "Toggle sidebar"}
          </TooltipPopup>
        </Tooltip>
        <h2
          className="min-w-0 shrink truncate text-sm font-medium text-foreground"
          title={activeThreadTitle}
        >
          {activeThreadTitle}
        </h2>
        {activeProjectName && (
          <Badge variant="outline" className="min-w-0 shrink overflow-hidden">
            <span className="min-w-0 truncate">{activeProjectName}</span>
          </Badge>
        )}
        {activeProjectName && !isGitRepo && (
          <Badge variant="outline" className="shrink-0 text-[10px] text-amber-700">
            No Git
          </Badge>
        )}
      </div>
      <div className="flex shrink-0 items-center justify-end gap-2 @3xl/header-actions:gap-3">
        {activeProjectScripts && (
          <ProjectScriptsControl
            scripts={activeProjectScripts}
            keybindings={keybindings}
            preferredScriptId={preferredScriptId}
            onRunScript={onRunProjectScript}
            onAddScript={onAddProjectScript}
            onUpdateScript={onUpdateProjectScript}
            onDeleteScript={onDeleteProjectScript}
          />
        )}
        {activeProjectName && (
          <OpenInPicker
            keybindings={keybindings}
            availableEditors={availableEditors}
            openInCwd={openInCwd}
          />
        )}
        {activeProjectName && (
          <GitActionsControl
            gitCwd={gitCwd}
            activeThreadRef={scopeThreadRef(activeThreadEnvironmentId, activeThreadId)}
            {...(draftId ? { draftId } : {})}
          />
        )}
        <Tooltip>
          <TooltipTrigger
            render={
              <Toggle
                className="shrink-0"
                pressed={terminalOpen}
                onPressedChange={onToggleTerminal}
                aria-label="Toggle terminal split"
                variant="outline"
                size="xs"
                disabled={!terminalAvailable}
              >
                <TerminalSquareIcon className="size-3" />
              </Toggle>
            }
          />
          <TooltipPopup side="bottom">
            {!terminalAvailable
              ? "Terminal is unavailable until this thread has an active project."
              : terminalToggleShortcutLabel
                ? `Toggle terminal split (${terminalToggleShortcutLabel})`
                : "Toggle terminal split"}
          </TooltipPopup>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Toggle
                className="shrink-0"
                pressed={diffOpen}
                onPressedChange={onToggleDiff}
                aria-label="Toggle diff panel"
                variant="outline"
                size="xs"
                disabled={!isGitRepo}
              >
                <DiffIcon className="size-3" />
              </Toggle>
            }
          />
          <TooltipPopup side="bottom">
            {!isGitRepo
              ? "Diff panel is unavailable because this project is not a git repository."
              : diffToggleShortcutLabel
                ? `Toggle diff panel (${diffToggleShortcutLabel})`
                : "Toggle diff panel"}
          </TooltipPopup>
        </Tooltip>
        <PaneControl
          icon={<GlobeIcon className="size-3" />}
          label="Browser"
          panes={browserPanes}
          onToggle={onToggleSidePanel}
          onOpenNew={onOpenNewBrowserPane}
          onClose={onClosePaneSurface}
          onFocus={onFocusPaneSurface}
        />
        <PaneControl
          icon={<CodeXmlIcon className="size-3" />}
          label="Editor"
          panes={editorPanes}
          onToggle={onToggleEditor}
          onOpenNew={onOpenNewEditorPane}
          onClose={onClosePaneSurface}
          onFocus={onFocusPaneSurface}
        />
      </div>
    </div>
  );
});

// ── Pane Control with hover dropdown ────────────────────────────────────

const PaneControl = memo(function PaneControl(props: {
  icon: ReactNode;
  label: string;
  panes: PaneInfo[];
  onToggle: () => void;
  onOpenNew: () => void;
  onClose: (surfaceId: string) => void;
  onFocus: (surfaceId: string) => void;
}) {
  const { icon, label, panes, onToggle, onOpenNew, onClose, onFocus } = props;
  const [open, setOpen] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleClose = useCallback(() => {
    closeTimerRef.current = setTimeout(() => setOpen(false), 200);
  }, []);

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const handleMouseEnter = useCallback(() => {
    cancelClose();
    if (panes.length > 0) setOpen(true);
  }, [cancelClose, panes.length]);

  const handleMouseLeave = useCallback(() => {
    scheduleClose();
  }, [scheduleClose]);

  const count = panes.length;

  return (
    <div
      className="relative"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button
        type="button"
        className="inline-flex shrink-0 items-center justify-center gap-0.5 rounded-md border border-input bg-transparent text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 min-w-7 px-1.5"
        onClick={onToggle}
        aria-label={`Toggle ${label}`}
      >
        {icon}
        {count > 0 && (
          <span className="min-w-[14px] rounded-full bg-primary/15 px-1 text-center text-[10px] font-semibold leading-[14px] text-primary">
            {count}
          </span>
        )}
      </button>

      {open && panes.length > 0 && (
        <div
          className="absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border border-border bg-popover py-1 shadow-lg"
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          {/* Sticky "Open new" header */}
          <button
            type="button"
            className="flex w-full items-center gap-2 border-b border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={() => {
              onOpenNew();
              setOpen(false);
            }}
          >
            <PlusIcon className="size-3 shrink-0" />
            <span>Open new {label.toLowerCase()}</span>
          </button>
          {/* Pane list */}
          <div className="max-h-48 overflow-y-auto py-0.5">
            {panes.map((pane, index) => (
              <div
                key={pane.surfaceId}
                className="group flex items-center gap-2 px-3 py-1.5 text-xs transition-colors hover:bg-accent"
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  onClick={() => {
                    onFocus(pane.surfaceId);
                    setOpen(false);
                  }}
                >
                  <span className="shrink-0 text-muted-foreground">{index + 1}.</span>
                  <span className="min-w-0 truncate">{pane.label}</span>
                </button>
                <button
                  type="button"
                  className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose(pane.surfaceId);
                  }}
                  aria-label={`Close ${pane.label}`}
                >
                  <XIcon className="size-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});
