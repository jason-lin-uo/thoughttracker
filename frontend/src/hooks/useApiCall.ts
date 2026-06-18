/**
 * Custom hook: wraps a mutation-style API call with loading/error state
 * AND automatically toasts on success / failure.
 *
 * Why this exists: every page in the app has the same pattern of
 * `useMutation({ mutationFn, onSuccess, onError })` where the only
 * variable bits are the API call and the toast strings. This hook
 * collapses that boilerplate into a single line at the call site.
 *
 * Usage:
 * const generateReport = useApiCall(
 * () => api.post(`/reports/creator/${creatorId}/generate`),
 * {
 * successMessage: strings.toasts.reportReadyBody,
 * successTitle: strings.toasts.reportReadyTitle,
 * errorTitle: strings.toasts.actionFailedTitle,
 * onSuccess: () => queryClient.invalidateQueries(...),
 * }
 * );
 *
 * <button onClick={() => generateReport.run()}>...</button>
 *
 * Backed by React Query's `useMutation` so cancellation / state semantics
 * stay consistent with the rest of the app.
 */

import { useMutation } from "@tanstack/react-query";
import { useCallback } from "react";
import { useToast } from "../toast/toastContext";
import { strings } from "../i18n/en";

/**
 * Options for `useApiCall`. All toast strings are optional — pass them in
 * if you want feedback, omit them for silent fire-and-forget calls.
 */
export interface UseApiCallOptions<TResult> {
  /** Toast body shown on success. If omitted, no success toast fires. */
  successMessage?: string;
  /** Toast heading shown on success. Defaults to no title. */
  successTitle?: string;
  /** Toast body shown on failure. Defaults to the error message. */
  errorMessage?: string;
  /** Toast heading shown on failure. Defaults to "Something went wrong". */
  errorTitle?: string;
  /** Fired after success. Use to invalidate queries / navigate / etc. */
  onSuccess?: (data: TResult) => void;
  /** Fired after failure. Use to clean up local state. */
  onError?: (error: Error) => void;
  /** When true, suppress the automatic error toast. Default false. */
  suppressErrorToast?: boolean;
}

/**
 * Wraps an async API call with toast feedback + a clean trigger API.
 *
 * @param mutationFn - the async function performing the API call
 * @param options - toast strings + lifecycle hooks
 * @returns an object with `{ run, isPending, isError, isSuccess, data, error, reset }`
 */
export function useApiCall<TResult, TArgs = void>(
  mutationFn: (args: TArgs) => Promise<TResult>,
  options: UseApiCallOptions<TResult> = {},
) {
  const { showToast } = useToast();
  const mutation = useMutation({
    mutationFn,
    onSuccess: (data) => {
      if (options.successMessage) {
        showToast({
          kind: "success",
          title: options.successTitle,
          message: options.successMessage,
        });
      }
      options.onSuccess?.(data);
    },
    onError: (error: Error) => {
      if (!options.suppressErrorToast) {
        showToast({
          kind: "error",
          title: options.errorTitle ?? strings.toasts.actionFailedTitle,
          message: options.errorMessage ?? error.message,
        });
      }
      options.onError?.(error);
    },
  });

  const run = useCallback((args: TArgs) => mutation.mutate(args), [mutation]);

  return {
    run,
    isPending: mutation.isPending,
    isError: mutation.isError,
    isSuccess: mutation.isSuccess,
    data: mutation.data,
    error: mutation.error,
    reset: mutation.reset,
  };
}
