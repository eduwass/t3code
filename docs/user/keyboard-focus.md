# Keyboard focus

The command palette keeps focus while open. Closing it returns focus to the composer in chat,
or to the previous control on other pages. Choosing a workspace focus command moves to that
area instead. Opening Pull Requests moves focus into that page.
While the palette or model picker is open, number shortcuts select its entries instead of
switching threads. Model shortcuts work in Settings as well as the composer.
See [Keybindings](./keybindings.md) to customize these shortcuts.

If you return to typing while a terminal is starting, the composer keeps focus when the terminal
becomes ready. Opening or switching to a terminal explicitly still focuses it.

## Move between workspace areas

On web and desktop, press `F6` or `Shift+F6` to move between the Threads sidebar,
message input, and visible panels. The arrow keys in an empty message input scroll the
conversation; it becomes a stop of its own only when a thread has no message input. A
browser panel with a page loaded focuses the page, not its address bar. Navigation wraps
around and restores the last focused control in each area. Pull Requests has a page content area. In Settings,
`F6` moves between the section list and the open section. Hidden areas are skipped. Other
dialogs and form popups retain focus; a thread context menu closes when an area command
moves focus away.

In a browser, plain `F6` may move to the browser's own toolbar. Use `mod+F6` and
`mod+Shift+F6` instead (`mod` is Command on macOS and Ctrl elsewhere). **Focus Next
Workspace Area** and **Focus Previous Workspace Area** are also in the command palette and
can be remapped in Settings > Keybindings.

On macOS, `Command+Arrow` moves by direction instead: it jumps to the nearest visible area
on that side. When there is no area on that side, the key keeps its usual job, so
`Command+Down` in an empty message input still scrolls to the end. In a browser panel's
page, only `Command+Left` and `Command+Right` move; Up and Down scroll the page.

## Browse threads

Tab moves through each thread and its buttons. Up and Down also move between threads
without opening them; Enter opens the focused thread or toggles a group. Right and Left
expand and collapse groups. `F2` renames the focused thread.

Press `Shift+F10` or the Context Menu key to open the focused thread's menu. Use the arrow
keys to move through it, Enter to choose, and Escape to close it.

The Settings section list works the same way: Up and Down move between sections, and Enter
opens one.
