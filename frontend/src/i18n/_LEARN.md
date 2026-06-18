# \_LEARN.md — `frontend/src/i18n/`

> One file. Every English word the app ever shows to a human.

---

## The story of this folder

Imagine the app is a book that someone might want to translate. If
every sentence was written directly inside the chapters (the React
components), translating the book would mean editing every chapter.
But if every sentence was kept in a single appendix at the back of the
book, and chapters just said "see appendix entry 12," then translating
would mean translating the appendix once.

That's what this folder is. `en.ts` is **the appendix** — every
user-facing string in the app, organized by topic. JSX components
import the strings, never write them inline.

The folder is named `i18n` (the conventional shorthand for
"internationalization" — 18 letters between the *i* and the *n*).
It's a deliberate signal: "this is where strings live."

---

## File-by-file

### `en.ts`

**What it is:** a single frozen object with every UI string the app
shows. Organized into nested groups:

```ts
export const en = Object.freeze({
 nav: {
 dashboard: "Dashboard",
 creators: "Creators",
 ...
 },
 common: {
 loading: "Loading…",
 error: "Something went wrong.",
 retry: "Retry",
 ...
 },
 dashboard: {
 title: "Dashboard",
 totalCreators: "Total Creators",
 ...
 },
 // ...one section per page or feature
});
```

**Why it exists:** four reasons, all real:

1. **Reviewability.** A non-engineer (a product manager, a copy editor,
   a future translator) can open one file and read all the words the
   app ever says. Without this, they'd have to grep across hundreds of
   `.tsx` files and read the surrounding code to understand context.

2. **Consistency.** Every time the app says "Loading…", it pulls from
   `en.common.loading`. So if the team ever changes it to "Working…",
   that's one edit, not 30.

3. **Type safety.** `export type Strings = typeof en` gives downstream
   code an exact-shape type. If a component does `strings.dashboard.titel`
   (typo), TypeScript catches it.

4. **Future i18n.** ("i18n" is shorthand for "internationalization" —
   18 letters between the *i* and the *n* — meaning the work of making
   an app speak multiple languages.) Adding Spanish (`es.ts`) is a
   mechanical exercise: copy this file, translate the values, swap the
   export at the module boundary. No component changes needed.
   `react-intl` / `i18next` (off-the-shelf libraries that handle
   plurals, dates, and language switching for you) aren't worth the
   bundle weight while V1 is English-only, but the door is left wide
   open.

**`Object.freeze()`** Yes — defensive. (`Object.freeze` is a built-in
that locks an object so nothing can change it after — like sealing a
display case.) If some component ever tried `strings.nav.dashboard = "lol"`,
freeze makes the assignment a no-op (or throws in strict mode — the
extra-cautious mode that complains loudly instead of silently failing).
The string table is immutable (cannot be changed at runtime).

**Used by:** every `pages/X.tsx` and every `components/X.tsx` that
shows text. The import looks like `import { strings } from
"../i18n/en"` and then `<h1>{strings.dashboard.title}</h1>`.

---

## The convention by section

| Section                                                                           | What lives here                                                         |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `nav`                                                                             | Sidebar nav links                                                       |
| `brand`                                                                           | App name, tagline, navigation aria-labels                               |
| `header`                                                                          | The desktop `AppHeader` banner's global actions ("Add creator")         |
| `common`                                                                          | Loading, error, empty states, action verbs (Retry, Cancel, etc.)        |
| `dashboard`                                                                       | Strings on the dashboard page                                           |
| `creators`                                                                        | Strings on the creators list + detail                                   |
| `videos`, `evidence`, `reports`, `topics`, `imports`, `compare`                   | Strings on each respective page                                         |
| `errors`                                                                          | Specific error messages (e.g. "Creator not found.")                     |
| `confidence`, `stance`, `trend`                                                   | Enum-label translations (`{supportive: "Supportive", ...}`)             |

The enum-label maps are particularly useful — backend returns
`"abrupt_shift"`, frontend reads `strings.trend.abrupt_shift` to get
`"Abrupt Shift"`.

---

## What's NOT in here

- **Numbers, dates, durations** — those go through `lib/format.ts`,
  which uses the browser's locale-aware `Intl` APIs (built-in browser
  helpers that know how each country writes numbers, dates, and
  currency). Numbers are almost-translatable for free (the browser
  handles `1,234,567` vs `1.234.567`).
- **Backend-generated text** — error messages from the API, AI-generated
  summaries, evidence quotes. Those come down from the server and are
  rendered as-is. (For a real product, the AI prompts would be the
  ones to translate — but that's a deeper change.)
- **Aria-labels for icon-only buttons** — those are part of the
  component, and yes, they should be in here. A few may still be
  inline; flagged in `REVERSE_ENGINEERED_PROMPT.md` for cleanup.

---

## How i18n/ connects to everything else

```
pages/DashboardPage.tsx
 │
 │ import { strings } from "../i18n/en";
 │
 ▼
 <h1>{strings.dashboard.title}</h1>
 <p>{strings.dashboard.totalCreators}: {data.creators}</p>
 <Button>{strings.common.retry}</Button>
```

That's the entire pattern. Components import `strings` and reference
nested keys.

---

## "Where do I look when X happens"

| You want to fix...                                            | Open...                                                                                                                                                                       |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Typo in UI copy                                               | `en.ts` — find the string, change it                                                                                                                                          |
| New UI string                                                 | `en.ts` — add to the appropriate section, then reference it from the component                                                                                                |
| Need a different language                                     | Create `es.ts` (or whatever) with the same `Strings` shape, swap the `strings` export                                                                                         |
| String shows raw key like `strings.dashboard.title` literally | The component is rendering the path instead of the value — change `{"strings.dashboard.title"}` to `{strings.dashboard.title}`                                                |
| Need to interpolate a value into a string                     | Right now we use template literals at the call site (`${strings.dashboard.welcome} ${user.name}`). A real i18n lib would support placeholders properly — for V1 this is fine. |
