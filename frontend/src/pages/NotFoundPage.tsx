import { Link } from "react-router-dom";
import { PageHeader } from "../components/States";
import { strings } from "../i18n/en";

/**
 * NotFoundPage — fallback for any URL that doesn't match a defined route.
 *
 * Friendly empty-state with a "Back to dashboard" CTA. Specifically NOT
 * an error state visually (no red, no alert role) because hitting a 404
 * is usually a stale link or a typo, not a system error. We don't want
 * a recruiter who fat-fingers a URL to think the app crashed.
 */
export function NotFoundPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title={strings.notFound.title}
        subtitle={strings.notFound.subtitle}
      />
      <div className="card card-pad text-center">
        <p className="text-ink-700 dark:text-ink-300 mb-4">
          {strings.notFound.body}
        </p>
        <Link to="/" className="btn-primary">
          {strings.notFound.backToDashboard}
        </Link>
      </div>
    </div>
  );
}
