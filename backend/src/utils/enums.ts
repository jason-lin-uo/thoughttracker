import { BadRequestError } from "./errors";

/**
 * parseEnumParam — validate an optional query-string value against a known set
 * of enum members, returning the typed value or undefined.
 *
 * Controllers previously cast raw query params straight to a Prisma enum type
 * with `as` and passed them into a `where` clause. An invalid value (e.g.
 * `?stanceLabel=bogus`) then reached Postgres and surfaced as a Prisma error →
 * an unhelpful 500. This helper instead rejects unknown values up front with a
 * 400 BadRequestError (listing the allowed values), which is the correct HTTP
 * semantics for bad client input.
 *
 * @param value the raw query value (already narrowed to string|undefined by the caller)
 * @param enumObject the Prisma-generated enum object (e.g. `$Enums.StanceLabel`)
 * @param paramName the param name, used in the 400 message
 * @returns the validated value typed as the enum, or undefined when absent
 */
export function parseEnumParam<T extends Record<string, string>>(
  value: string | undefined,
  enumObject: T,
  paramName: string,
): T[keyof T] | undefined {
  if (value === undefined) return undefined;
  const allowed = Object.values(enumObject);
  if (!allowed.includes(value)) {
    throw new BadRequestError(
      `Invalid ${paramName}: "${value}". Allowed: ${allowed.join(", ")}`,
    );
  }
  return value as T[keyof T];
}
