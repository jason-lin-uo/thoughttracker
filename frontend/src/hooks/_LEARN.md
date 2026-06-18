# \_LEARN.md — `frontend/src/hooks/`

> One file. One custom hook. A surprising amount of leverage.

---

## The story of this folder

In React, a "hook" is a function whose name starts with `use` — it's
how components borrow state (their own remembered values), lifecycle
behavior (running code when the component appears, updates, or
disappears), or context (shared data from above) from elsewhere.
Built-in hooks (`useState` — remember a value, `useEffect` — do
something after rendering, etc.) are good for the basics. **Custom
hooks** are how you bottle up a repetitive pattern so a dozen
components don't all rewrite the same logic.

This folder currently has one hook: `useApiCall`. It exists because the
same 15-line pattern was about to be written 12 times across the
codebase. Instead of doing that, we wrote it once.

---

## File-by-file

### `useApiCall.ts`

**What it is:** a custom hook that wraps React Query's `useMutation`
(React Query's standard way to send a change to the backend — POST,
PATCH, DELETE — and track whether it's loading/succeeded/failed)
with **toast feedback baked in**. It's the "fire an API call, get
toasts on success/failure for free" hook.

**The problem it solves:** every "Generate Report" button, every
"Retry Import" button, every "Trigger Analysis" button on the
frontend has the same structure:

```ts
// Without useApiCall — repeated 12 times across the codebase
const { showToast } = useToast();
const mutation = useMutation({
 mutationFn: () => api.post(`/reports/creator/${id}/generate`),
 onSuccess: () => {
 showToast({ kind: "success", title: "Report ready", message: "Open it from Reports." });
 queryClient.invalidateQueries(["reports"]);
 },
 onError: (err) => {
 showToast({ kind: "error", title: "Action failed", message: err.message });
 },
});
return <button onClick={() => mutation.mutate()}>Generate</button>;
```

15 lines of boilerplate, mostly identical from page to page.

```ts
// With useApiCall — same behavior, one line
const generate = useApiCall(
 () => api.post(`/reports/creator/${id}/generate`),
 {
 successTitle: t.toasts.reportReadyTitle,
 successMessage: t.toasts.reportReadyBody,
 onSuccess: () => queryClient.invalidateQueries(["reports"]),
 }
);
return <button onClick={() => generate.run()}>Generate</button>;
```

The boilerplate moves into the hook, the call site says only what's
specific to *this* call.

**The return shape:** `{ run, isPending, isError, isSuccess, data,
error, reset }`. Same field names as React Query's `useMutation`, so if
you already know that API you already know this one.

**Knobs:** `suppressErrorToast: true` for the rare case where the
caller wants to handle errors silently and show a custom UI instead.

**Why not just use React Query directly** Because then you'd need to
remember to call `showToast()` in `onSuccess` and `onError` every
single time. Standardizing this means **every API action in the app
gives consistent feedback** — same toast position, same kind colors,
same default titles. The user gets a coherent experience whether they
just generated a report, triggered an import, or refreshed a chart.

**Used by:** every page that has an action button (ReportsPage,
CreatorOverviewPage, ImportsPage, etc.).

---

## What's NOT a hook in this folder

- **Data fetching** (`useQuery`-style reads — `useQuery` is React
  Query's standard way to *ask* the backend for data and have the
  result remembered/cached automatically) — pages call `useQuery(...)`
  directly with `lib/api.ts`. No wrapper needed because the pattern is
  already minimal:

```ts
const { data, isLoading } = useQuery({
  queryKey: ["creators"],
  queryFn: () => api.get<Page<Creator>>("/creators"),
});
```

Wrapping that wouldn't save anything.

- **Theme access** — that's in `theme/themeContext.ts` as `useTheme()`,
  because the context lives there.

- **Toast access** — same, in `toast/toastContext.ts` as `useToast()`.

The folder name `hooks/` is reserved for hooks that aren't tied to a
specific context.

---

## When would another hook live here

If we needed any of these in the future, they'd come here:

- `useDebouncedValue(value, ms)` — for search inputs. (Debouncing
  means "wait until the user stops typing for a beat before doing
  anything," so we don't search on every keystroke.)
- `useLocalStorage(key, defaultValue)` — for persisting per-user UI
  state (sidebar collapsed, table column order, etc.) in the
  browser's built-in per-site storage.
- `useScrollRestoration()` — for remembering scroll position when
  navigating back to a list page.

None of those are needed yet. The folder is intentionally small.

---

## How hooks/ connects to everything else

```
pages/ReportsPage.tsx
 │
 │ const generate = useApiCall(
 │ () => api.post("/reports/.../generate"),
 │ { successMessage: t.toasts.reportReadyBody, ... }
 │ );
 │
 ▼
hooks/useApiCall.ts
 │
 ├──▶ uses @tanstack/react-query (useMutation)
 │
 └──▶ uses toast/toastContext (showToast)
 │
 ▼
 ToastProvider renders a toast
```

---

## "Where do I look when X happens"

| You want to fix...                      | Open...                                                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| All action buttons stopped toasting     | `useApiCall.ts`                                                                                              |
| One action button doesn't toast right   | The call site — check the `successMessage`/`errorMessage` props                                              |
| Need a new shared behavior across pages | Add a new hook here                                                                                          |
| Action button feels slow                | Check if the underlying `mutationFn` actually awaits everything, or if it's React Query's cache invalidation |
