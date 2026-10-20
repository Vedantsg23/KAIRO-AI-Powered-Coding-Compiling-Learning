import { altKey, isMac, modKey } from "../lib/hooks";
import { Dialog, Kbd } from "../ui/primitives";

const SHORTCUTS: [string[], string][] = [
  [[modKey, "K"], "Command palette: every action, language and example (type :42 to go to line 42)"],
  [[modKey, "Enter"], "Compile and run"],
  [[modKey, "Shift", "Enter"], "Ask Saarthi to explain the selected problem"],
  [[modKey, "S"], "Save the draft now (it also saves as you type)"],
  [["F8"], "Next problem in the editor (Shift+F8: previous)"],
  [[modKey, "Z"], "Undo (also undoes an example or a Saarthi fix)"],
  [[modKey, "F"], "Find in the editor"],
  [["Tab"], "Move between controls (in the editor: indent)"],
  [isMac ? ["Ctrl", "Shift", "M"] : ["Ctrl", "M"], "Let Tab leave the editor (press again to indent with Tab)"],
  [["Ctrl", "`"], "Show or hide the terminal panel (Ctrl+J works too)"],
  [[modKey, "B"], "Show or hide the explorer"],
  [[modKey, altKey, "B"], "Show or hide Saarthi's chat panel"],
  [[modKey, altKey, "I"], "Ask Saarthi: jump to the chat's question box"],
  [["←", "→"], "Switch tabs; resize panels when a divider is focused (Enter: default size)"],
  [["?"], "Show this list"],
  [["Esc"], "Close dialogs and menus"],
];

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  return (
    <Dialog open={open} onClose={onClose} labelledBy="shortcuts-title" width="max-w-md">
      <div className="px-6 pb-6 pt-5">
        <p className="k-label">System / keys</p>
        <h2 id="shortcuts-title" className="mt-1 text-lg font-semibold text-fg">
          Keyboard shortcuts
        </h2>
        <p className="mt-0.5 text-xs text-muted">Everything in KAIRO also works with the keyboard alone.</p>
        <ul className="mt-4 flex flex-col divide-y divide-line">
          {SHORTCUTS.map(([keys, what]) => (
            <li key={what} className="flex items-center justify-between gap-4 py-2 text-sm">
              <span className="text-muted">{what}</span>
              <span className="flex shrink-0 items-center gap-1">
                {keys.map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Dialog>
  );
}
