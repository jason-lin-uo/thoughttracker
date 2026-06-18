import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, api } from "../lib/api";
import { useApiCall } from "../hooks/useApiCall";
import { PageHeader, EmptyState } from "../components/States";
import { strings } from "../i18n/en";

const LIMITS = [10, 25, 50, 100] as const;
const MAX_PIPELINE_URLS_PER_RUN = 10;

/**
 * QueuedCreatorResult — one row in the per-channel results list shown after
 * the user submits. `jobId` is set only when the channel went through the
 * per-channel import-job fallback (it deep-links to the job detail page);
 * the batch onboarding path leaves it null and just reports `status`.
 * `error` is null on success and a message string on failure.
 */
interface QueuedCreatorResult {
  channelUrl: string;
  jobId: string | null;
  status: string;
  error: string | null;
}

/**
 * CreatorOnboardingRun — the response shape from `POST /creator-onboarding/run`,
 * the preferred batch path. It kicks off a background pipeline process rather
 * than returning per-channel job ids, so the UI reports its `status` (and
 * `statusPath` for progress) instead of linking each channel to a job.
 */
interface CreatorOnboardingRun {
  status: string;
  processId: number | null;
  statusPath: string;
  logDir: string;
}

interface ResetStarterReportResponse {
  deleted: number;
  report: {
    id: string;
    title: string;
    summary: string;
    creatorId: string;
    topicId: string | null;
    reportType: string;
  };
}

/**
 * parseCreatorUrls — split the textarea blob into a clean, de-duplicated list
 * of channel identifiers: one per non-blank line, trimmed, with
 * case-insensitive duplicates removed while preserving first-seen order.
 */
function parseCreatorUrls(value: string): string[] {
  const seen = new Set<string>();
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      const key = line.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/**
 * isCreatorUrl — lightweight client-side validation for one input line.
 * Accepts a YouTube channel/video URL, an `@handle`, or a bare slug/id of
 * the allowed character set. Deliberately permissive — the server does the
 * authoritative resolution; this only filters obvious junk before submit.
 */
function isCreatorUrl(value: string): boolean {
  return (
    /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(value) ||
    value.startsWith("@") ||
    /^[A-Za-z0-9._-]+$/.test(value)
  );
}

/**
 * chunkCreatorUrls — slice the valid URLs into batches of at most
 * `MAX_PIPELINE_URLS_PER_RUN` so each onboarding-pipeline run stays within
 * the backend's per-request cap.
 */
function chunkCreatorUrls(urls: string[]): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < urls.length; index += MAX_PIPELINE_URLS_PER_RUN) {
    chunks.push(urls.slice(index, index + MAX_PIPELINE_URLS_PER_RUN));
  }
  return chunks;
}

/**
 * failedResults — fan a single error out into one failed `QueuedCreatorResult`
 * per URL. Used when a whole batch fails (e.g. bad PIN, server down) so every
 * affected channel still shows up in the results list with the same message.
 */
function failedResults(urls: string[], error: string): QueuedCreatorResult[] {
  return urls.map((channelUrl) => ({
    channelUrl,
    jobId: null,
    status: "failed",
    error,
  }));
}

/**
 * resultSummary — build the "{success} of {total}" headline shown above the
 * results list, where success counts every row without an error.
 */
function resultSummary(results: QueuedCreatorResult[]): string {
  /* A row is a success iff it carries no error message. */
  const success = results.filter((result) => !result.error).length;
  return strings.addCreators.resultSummary
    .replace("{success}", String(success))
    .replace("{total}", String(results.length));
}

/**
 * AddCreatorsPage — the admin-gated "bulk add creators" form, route
 * `/add-creators`.
 *
 * Flow:
 * 1. PIN gate: the form stays disabled until the user enters an admin PIN
 * and clicks Unlock. The PIN is sent as an `X-Admin-Pin` header on every
 * request and is cleared on any 403 so a bad PIN re-locks the form.
 * 2. The user pastes channel URLs/handles (one per line) and picks a
 * per-creator video limit.
 * 3. On submit, the mutation parses + validates + de-dupes the input, then
 * tries the batch onboarding pipeline (`/creator-onboarding/run`) in
 * chunks. If that endpoint is unavailable (404/503) it falls back to
 * queueing individual import jobs (`/import-jobs/youtube-channel`) so
 * the feature still works against an older backend.
 * 4. Results (per channel: started / queued job / failed) render in a list,
 * and the import-jobs query is invalidated so the Imports page refreshes.
 */
export function AddCreatorsPage() {
  const queryClient = useQueryClient();
  const [urlsText, setUrlsText] = useState("");
  const [limit, setLimit] = useState<(typeof LIMITS)[number]>(25);
  const [results, setResults] = useState<QueuedCreatorResult[]>([]);
  const [pinText, setPinText] = useState("");
  const [adminPin, setAdminPin] = useState("");
  const [resetResult, setResetResult] =
    useState<ResetStarterReportResponse | null>(null);

  /*
   * Parsed/validated views of the textarea, memoized so the partition only
   * recomputes when the raw text changes (drives the disabled state + counts).
   */
  const creatorUrls = useMemo(() => parseCreatorUrls(urlsText), [urlsText]);
  const validCreatorUrls = useMemo(
    () => creatorUrls.filter((url) => isCreatorUrl(url)),
    [creatorUrls],
  );
  const invalidCreatorUrls = useMemo(
    () => creatorUrls.filter((url) => !isCreatorUrl(url)),
    [creatorUrls],
  );
  const isUnlocked = adminPin.length > 0;

  const unlockMutation = useApiCall(
    async (pin: string) => {
      await api.post<{ ok: true }>("/creator-onboarding/verify-pin", undefined, {
        headers: {
          "X-Admin-Pin": pin,
        },
      });
      return pin;
    },
    {
      onSuccess: (pin) => {
        setAdminPin(pin);
        setResults([]);
      },
      onError: () => setAdminPin(""),
    },
  );

  /*
   * Wrapped in useApiCall so the submission surfaces success/error toasts
   * (audit §7: AddCreators previously used a raw, silent useMutation). The
   * mutationFn catches per-channel failures internally and resolves with a
   * results array, so the success toast fires once per submission and the
   * automatic error toast is a backstop for an unexpected throw.
   */
  const createMutation = useApiCall(
    async () => {
      const invalidResults = failedResults(
        invalidCreatorUrls,
        strings.addCreators.invalidUrl,
      );

      /**
       * queueImportJobs — the per-channel fallback used when the batch
       * onboarding pipeline isn't available. Posts one import job per URL,
       * sequentially so a shared PIN/rate limit isn't hammered, and records
       * each outcome. On a 403 it clears the PIN, marks every remaining URL
       * failed with the same error, and stops early (no point retrying a
       * rejected PIN).
       */
      async function queueImportJobs(
        urls: string[],
      ): Promise<QueuedCreatorResult[]> {
        const nextResults: QueuedCreatorResult[] = [];
        for (let index = 0; index < urls.length; index += 1) {
          const channelUrl = urls[index] as string;
          try {
            const result = await api.post<{ jobId: string; status: string }>(
              "/import-jobs/youtube-channel",
              {
                channelUrl,
                requestedLimit: limit,
              },
              {
                headers: {
                  "X-Admin-Pin": adminPin,
                },
              },
            );
            nextResults.push({
              channelUrl,
              jobId: result.jobId,
              status: result.status,
              error: null,
            });
          } catch (reason) {
            const error =
              reason instanceof Error ? reason.message : String(reason);
            nextResults.push({
              channelUrl,
              jobId: null,
              status: "failed",
              error,
            });
            if (reason instanceof ApiError && reason.status === 403) {
              setAdminPin("");
              nextResults.push(...failedResults(urls.slice(index + 1), error));
              break;
            }
          }
        }
        return nextResults;
      }

      if (validCreatorUrls.length === 0) {
        return invalidResults;
      }

      const queuedResults: QueuedCreatorResult[] = [];
      for (const batch of chunkCreatorUrls(validCreatorUrls)) {
        try {
          const run = await api.post<CreatorOnboardingRun>(
            "/creator-onboarding/run",
            {
              channelUrls: batch,
              requestedLimit: limit,
            },
            {
              headers: {
                "X-Admin-Pin": adminPin,
              },
            },
          );
          const status = run.statusPath
            ? `${run.status}: ${run.statusPath}`
            : run.status;
          queuedResults.push(
            ...batch.map((channelUrl) => ({
              channelUrl,
              jobId: null,
              status,
              error: null,
            })),
          );
        } catch (reason) {
          const remainingValidUrls = validCreatorUrls.slice(
            queuedResults.length,
          );
          if (
            reason instanceof ApiError &&
            (reason.status === 404 || reason.status === 503)
          ) {
            return [
              ...queuedResults,
              ...(await queueImportJobs(remainingValidUrls)),
              ...invalidResults,
            ];
          }

          const error =
            reason instanceof Error ? reason.message : String(reason);
          if (reason instanceof ApiError && reason.status === 403) {
            setAdminPin("");
          }
          return [
            ...queuedResults,
            ...failedResults(remainingValidUrls, error),
            ...invalidResults,
          ];
        }
      }

      return [...queuedResults, ...invalidResults];
    },
    {
      successTitle: strings.toasts.creatorsQueuedTitle,
      successMessage: strings.toasts.creatorsQueuedBody,
      onSuccess: (nextResults: QueuedCreatorResult[]) => {
        setResults(nextResults);
        queryClient.invalidateQueries({ queryKey: ["import-jobs"] });
      },
    },
  );

  const resetReportsMutation = useApiCall(
    async () =>
      api.post<ResetStarterReportResponse>(
        "/reports/reset-starter",
        undefined,
        {
          headers: {
            "X-Admin-Pin": adminPin,
          },
        },
      ),
    {
      successTitle: strings.toasts.reportsResetTitle,
      successMessage: strings.toasts.reportsResetBody,
      onSuccess: (data) => {
        setResetResult(data);
        queryClient.invalidateQueries({ queryKey: ["dashboard"] });
        queryClient.invalidateQueries({ queryKey: ["reports"] });
        queryClient.invalidateQueries({ queryKey: ["report"] });
      },
      onError: (error) => {
        if (error instanceof ApiError && error.status === 403) {
          setAdminPin("");
        }
      },
    },
  );

  return (
    <div className="space-y-8">
      <PageHeader
        title={strings.addCreators.title}
        subtitle={strings.addCreators.subtitle}
      />

      <section className="card card-pad">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold text-ink-900 dark:text-ink-50">
              {isUnlocked
                ? strings.addCreators.adminUnlocked
                : strings.addCreators.adminLocked}
            </p>
            <p className="mt-1 text-sm text-ink-600 dark:text-ink-400">
              {strings.addCreators.pinDescription}
            </p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-80 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label className="label" htmlFor="adminPin">
                {strings.addCreators.pinLabel}
              </label>
              <input
                id="adminPin"
                className="input"
                type="password"
                value={pinText}
                onChange={(event) => {
                  setPinText(event.target.value);
                  setAdminPin("");
                }}
                placeholder={strings.addCreators.pinPlaceholder}
              />
            </div>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setAdminPin("");
                unlockMutation.run(pinText.trim());
              }}
              disabled={
                pinText.trim().length === 0 || unlockMutation.isPending
              }
            >
              {unlockMutation.isPending
                ? strings.addCreators.unlocking
                : strings.addCreators.unlock}
            </button>
          </div>
        </div>
      </section>

      {isUnlocked ? (
        <section className="card card-pad">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="max-w-2xl">
              <h2 className="text-base font-semibold text-ink-900 dark:text-ink-50">
                {strings.addCreators.reportResetTitle}
              </h2>
              <p className="mt-1 text-sm text-ink-600 dark:text-ink-400">
                {strings.addCreators.reportResetDescription}
              </p>
              {resetResult ? (
                <p className="mt-2 text-sm text-emerald-700 dark:text-emerald-300">
                  {strings.addCreators.reportResetDone.replace(
                    "{title}",
                    resetResult.report.title,
                  )}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              className="btn-secondary shrink-0"
              onClick={() => {
                if (window.confirm(strings.addCreators.reportResetConfirm)) {
                  resetReportsMutation.run();
                }
              }}
              disabled={resetReportsMutation.isPending}
            >
              {resetReportsMutation.isPending
                ? strings.addCreators.reportResetting
                : strings.addCreators.reportResetButton}
            </button>
          </div>
        </section>
      ) : null}

      <section className="card card-pad">
        <fieldset
          disabled={!isUnlocked || createMutation.isPending}
          className="contents"
        >
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
            <div>
              <label className="label" htmlFor="creatorUrls">
                {strings.addCreators.urlsLabel}
              </label>
              <textarea
                id="creatorUrls"
                className="input min-h-40 resize-y"
                value={urlsText}
                onChange={(event) => setUrlsText(event.target.value)}
                placeholder={strings.addCreators.urlsPlaceholder}
                aria-describedby={
                  !isUnlocked ? "addCreatorsLockHint" : undefined
                }
              />
              {!isUnlocked ? (
                <p
                  id="addCreatorsLockHint"
                  className="mt-2 text-xs text-ink-500 dark:text-ink-400"
                >
                  {strings.addCreators.lockHint}
                </p>
              ) : null}
            </div>

            <div>
              <label className="label" htmlFor="onboardingLimit">
                {strings.addCreators.limit}
              </label>
              <select
                id="onboardingLimit"
                className="input"
                value={limit}
                onChange={(event) =>
                  setLimit(
                    Number(event.target.value) as (typeof LIMITS)[number],
                  )
                }
              >
                {LIMITS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn-primary mt-4 w-full"
                onClick={() => createMutation.run()}
                disabled={
                  !isUnlocked ||
                  createMutation.isPending ||
                  creatorUrls.length === 0
                }
              >
                {createMutation.isPending
                  ? strings.addCreators.starting
                  : strings.addCreators.start}
              </button>
            </div>
          </div>
        </fieldset>
      </section>

      <section>
        <h2 className="section-h2">{strings.addCreators.queuedJobs}</h2>
        {results.length === 0 ? (
          <EmptyState
            icon="+"
            title={strings.addCreators.queuedJobs}
            description={strings.addCreators.emptyResult}
          />
        ) : (
          <div className="card divide-y divide-ink-100 dark:divide-ink-800">
            <div
              className="p-4 text-sm text-ink-600 dark:text-ink-400"
              role="status"
              aria-live="polite"
            >
              {resultSummary(results)}
            </div>
            {results.map((result) => (
              <div
                key={result.channelUrl}
                className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink-900 dark:text-ink-50">
                    {result.channelUrl}
                  </p>
                  <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">
                    {result.error ?? result.status}
                  </p>
                </div>
                {result.jobId ? (
                  <Link
                    className="btn-secondary shrink-0 text-center"
                    to={`/imports/${result.jobId}`}
                  >
                    {strings.addCreators.viewJob}
                  </Link>
                ) : !result.error ? (
                  <span className="shrink-0 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
                    {strings.addCreators.started}
                  </span>
                ) : (
                  <span
                    className="shrink-0 rounded-full bg-rose-100 px-2.5 py-1 text-xs font-medium text-rose-800 dark:bg-rose-950 dark:text-rose-200"
                    role="alert"
                  >
                    {strings.addCreators.failed}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
