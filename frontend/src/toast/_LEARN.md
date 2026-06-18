# \_LEARN.md — `frontend/src/toast/`

> Two files. The little pop-up cards that say "Saved!" or "Error" in
> the corner of the screen.

---

## The story of this folder

Imagine your phone's notification system — when an app wants to tell
you something quickly ("Message sent"), it slides in from the side,
sits there for a few seconds, and disappears on its own. It doesn't
block what you're doing. You can dismiss it early by tapping it. If a
bunch arrive at once, they stack.

That's exactly what these two files do for the web app. Components
deep inside the tree can pop up a notification without knowing where
on screen it'll appear or how it'll animate. They just ask the toast
system: "hey, show this message."

The pattern follows the same split-by-Fast-Refresh-rule that
[`theme/`](../theme/_LEARN.md) uses:

- `toastContext.ts` defines the types + the React Context.
- `ToastProvider.tsx` is the component that holds state, renders the
  visible toasts, and exposes the `showToast()` function.

---

## File-by-file

### `toastContext.ts`

**What it is:** a small file that holds:

- `ToastKind` — `"success" | "error" | "info" | "warning"`.
- `Toast` interface — `{ id, kind, title, message, durationMs }`.
- `ToastContextValue` — `{ toasts, showToast, dismissToast,
clearToasts }`.
- `ToastContext` — the React Context.
- `useToast()` — the hook callers use.

**Why it's separate:** same Fast Refresh reason as `themeContext.ts` —
keep components in one file, helpers in another.

**Used by:** `ToastProvider.tsx` (imports the context to provide it),
and any component anywhere in the tree that wants to fire a toast.

---

### `ToastProvider.tsx`

**What it is:** the actual provider + the visible UI.

**What it does:**

1. Holds an array of currently-visible toasts in state.
2. Exposes `showToast({ kind, title, message, durationMs })` — adds a
   toast to the array, generates a UUID for it (a UUID is just a long,
   guaranteed-unique label, like a tracking number), and schedules an
   auto-dismiss via `setTimeout` (the built-in browser timer that runs
   a piece of code after N milliseconds) (unless `durationMs === 0`,
   which means "stay open until manually dismissed").
3. Enforces a **cap of 5 visible toasts** — if more arrive, the oldest
   gets evicted. This prevents the screen from becoming a wall of
   notifications.
4. Renders a `<ToastViewport>` in a fixed position (bottom-right on
   desktop, full-width across the bottom on mobile).
5. Cleans up all pending `setTimeout` handles on unmount (otherwise
   they could fire after the component is gone and cause a warning).

**Accessibility:** (in plain terms, making sure the app works for people
who can't see the screen and use a screen reader, plus everyone using
a keyboard or other assistive tech)

- The viewport has `aria-live="polite"` (a hint to screen readers that
  says "speak this when you get a chance, don't cut off whatever you
  were saying") so screen readers announce new toasts non-disruptively.
- Error and warning toasts use `role="alert"` (interrupts the screen
  reader — like a fire alarm); success and info use `role="status"`
  (waits until idle — like a gentle ding).
- Every toast has a dismiss button with `aria-label="Dismiss
notification"` (the invisible text label a screen reader reads for an
  icon-only button).

**Used by:** `main.tsx` (wraps the app inside the theme provider).
`useToast().showToast(...)` is called from many places — API error
handlers in pages, success after a form submit, etc.

---

## How toast/ connects to everything else

```
main.tsx
 │
 │ <ToastProvider>
 │ <App />
 │ </ToastProvider>
 │
 ▼
ToastProvider
 │
 │ holds toasts: Toast[]
 │ exposes showToast, dismissToast, clearToasts via context
 │ renders <ToastViewport /> at end of children
 │
 ▼
Any descendant:
 const { showToast } = useToast();
 showToast({ kind: "success", message: "Report saved!" });
 │
 ▼
ToastProvider adds to array
 │
 ▼
ToastViewport renders new toast card with animation
 │
 │ 4 seconds pass (or click X)
 │
 ▼
ToastProvider removes from array
ToastViewport unmounts the card
```

---

## The four kinds, visually

| Kind      | Color        | Icon | aria role |
| --------- | ------------ | ---- | --------- |
| `success` | green        | ✓    | status    |
| `error`   | rose         | ✕    | alert     |
| `info`    | brand (blue) | ℹ   | status    |
| `warning` | amber        | ⚠   | alert     |

Each one has both light-mode and dark-mode color tokens (tokens are
named color values like "danger-red" instead of raw hex codes — they
let the whole app swap palettes by changing one source) (via Tailwind
`dark:` variants — Tailwind shorthand that only applies a style when
dark mode is on).

---

## Why a cap of 5

A naïve implementation lets toasts accumulate without limit. On a slow
network, if every API failure fires a toast, the user could end up
with 30 stacked notifications obscuring the UI.

5 is enough to not lose recent context, low enough to never become a
wall. Newer toasts push out older ones.

---

## "Where do I look when X happens"

| You want to fix...                 | Open...                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Toast styling is wrong             | `ToastProvider.tsx` — the `tone` map inside `ToastItem`                                                       |
| Toast doesn't dismiss              | Check that the calling code isn't passing `durationMs: 0` accidentally                                        |
| New kind of toast (e.g. "pending") | Add to `ToastKind` in `toastContext.ts`, then to the `tone` and `icon` maps in `ToastProvider.tsx`            |
| Toast position is wrong            | The `<div>` with `className="fixed bottom-4 inset-x-4 sm:inset-x-auto sm:right-4 ..."` inside `ToastViewport` |
| Screen reader doesn't announce     | Check `aria-live`/`role` on viewport and item — error/warning should be `alert`, others `status`              |
