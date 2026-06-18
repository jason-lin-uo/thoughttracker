import { useTheme, type ThemeMode } from "../theme/themeContext";
import { strings } from "../i18n/en";

/**
 * The three states the toggle exposes. Order here is the order users see
 * (light → system → dark), chosen so the middle option is the most
 * common "let the OS decide" mode — putting it between the two explicit
 * choices makes the segmented control feel symmetrical.
 */
const OPTIONS: Array<{ value: ThemeMode; label: string; icon: string }> = [
  { value: "light", label: strings.theme.light, icon: "☀" },
  { value: "system", label: strings.theme.system, icon: "💻" },
  { value: "dark", label: strings.theme.dark, icon: "🌙" },
];

/**
 * ThemeToggle — a three-state segmented control for picking the color
 * scheme: light, system (track `prefers-color-scheme`), or dark.
 *
 * Mounted in the sidebar footer (desktop) and inside the mobile top bar.
 *
 * Accessibility:
 * - Wrapper has `role="radiogroup"` with an `aria-label`, marking it as
 * a related set of mutually exclusive choices.
 * - Each button is `role="radio"` with `aria-checked` driven by the
 * current mode, so screen readers announce "Light, radio button,
 * checked" / "System, radio button, not checked".
 * - The visible icon is `aria-hidden` and the human label is rendered
 * as `sr-only` text — visually compact but fully announced.
 *
 * State lives in ThemeProvider; this component is purely the rendering
 * + setter wrapper. The provider handles localStorage persistence and
 * the `prefers-color-scheme` media query so the toggle itself can stay
 * stateless.
 */
export function ThemeToggle() {
  const { mode, setMode } = useTheme();
  return (
    <div
      role="radiogroup"
      aria-label={strings.theme.toggleLabel}
      className="inline-flex items-center gap-0.5 rounded-lg border border-ink-700/40 bg-ink-800/40 p-0.5"
    >
      {OPTIONS.map((opt) => {
        const active = opt.value === mode;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={opt.label}
            title={opt.label}
            onClick={() => setMode(opt.value)}
            className={
              "px-2 py-1 rounded-md text-xs leading-none transition-colors " +
              (active
                ? "bg-brand-600 text-white"
                : "text-ink-300 hover:text-white hover:bg-ink-700/60")
            }
          >
            <span aria-hidden>{opt.icon}</span>
            <span className="sr-only"> {opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
