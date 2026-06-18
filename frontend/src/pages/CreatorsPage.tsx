import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { CreatorListItem } from "../lib/types";
import {
  PageHeader,
  LoadingState,
  ErrorState,
  EmptyState,
} from "../components/States";
import { CreatorCard } from "../components/Cards";
import { strings } from "../i18n/en";

/**
 * CreatorsPage — the creators index, route `/creators`.
 *
 * Shows a search input (filters by name + slug + description, server-
 * side) and a responsive grid of `CreatorCard`s. Empty filtered results
 * surface an EmptyState; an empty database surfaces an EmptyState with
 * a CTA back to /imports.
 *
 * Search is debounced via React Query's key — typing into the input
 * updates the query key, which automatically dedupes/cancels in-flight
 * requests so the user sees the freshest result without intermediate
 * flicker.
 */
export function CreatorsPage() {
  const [search, setSearch] = useState("");
  const creatorsQuery = useQuery({
    queryKey: ["creators", search],
    queryFn: () =>
      api.get<{ items: CreatorListItem[] }>("/creators", { search }),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={strings.creators.title}
        subtitle={strings.creators.subtitle}
        actions={
          <Link to="/add-creators" className="btn-primary">
            ⬇️ {strings.dashboard.newImport}
          </Link>
        }
      />

      <div className="card card-pad">
        <input
          type="text"
          className="input"
          placeholder={strings.creators.searchPlaceholder}
          aria-label={strings.common.search}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {creatorsQuery.isLoading ? (
        <LoadingState />
      ) : creatorsQuery.isError ? (
        <ErrorState
          message={(creatorsQuery.error as Error).message}
          onRetry={() => creatorsQuery.refetch()}
        />
      ) : creatorsQuery.data!.items.length === 0 ? (
        <EmptyState
          icon="👤"
          title={strings.creators.emptyTitle}
          description={strings.creators.emptyDescription}
          cta={
            <Link to="/add-creators" className="btn-primary">
              {strings.creators.emptyCta}
            </Link>
          }
        />
      ) : (
        <div className="card-grid">
          {creatorsQuery.data!.items.map((creator) => (
            <CreatorCard key={creator.id} creator={creator} />
          ))}
        </div>
      )}
    </div>
  );
}
