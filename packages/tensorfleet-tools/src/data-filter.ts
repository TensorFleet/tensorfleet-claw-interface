export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonObject
  | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

/**
 * Checks recursively if any value inside a structure matches the regex.
 */
function containsMatch(value: JsonValue, regex: RegExp): boolean {
  if (typeof value === "string") {
    return regex.test(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return regex.test(String(value));
  }

  if (Array.isArray(value)) {
    return value.some(v => containsMatch(v, regex));
  }

  if (value && typeof value === "object") {
    return Object.entries(value).some(
      ([k, v]) => regex.test(k) || containsMatch(v, regex)
    );
  }

  return false;
}

/**
 * Filters an array of strings
 */
function filterStringArray(arr: string[], regex: RegExp): string[] {
  return arr.filter(s => regex.test(s));
}

/**
 * Filters an array of objects.
 * Keeps objects that contain ANY internal match.
 */
function filterObjectArray(arr: JsonObject[], regex: RegExp): JsonObject[] {
  return arr.filter(obj => containsMatch(obj, regex));
}

/**
 * Filters a plain object map.
 */
function filterMap(
  obj: JsonObject,
  regex: RegExp,
  keyRegex?: RegExp,
  firstLayer = true
): JsonObject {
  const result: JsonObject = {};

  for (const [key, value] of Object.entries(obj)) {
    if (firstLayer && keyRegex) {
      if (!keyRegex.test(key)) continue;

      if (containsMatch(value, regex)) {
        result[key] = value;
      }
      continue;
    }

    if (regex.test(key) || containsMatch(value, regex)) {
      result[key] = value;
    }

    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested = filterMap(value as JsonObject, regex, undefined, false);
      if (Object.keys(nested).length > 0) {
        result[key] = nested;
      }
    }
  }

  return result;
}

/**
 * Main exported filtering utility.
 */
export function filterData(
  input: JsonValue,
  regex: RegExp,
  keyRegex?: RegExp
): JsonValue {

  if (Array.isArray(input)) {
    if (input.length === 0) return [];

    if (typeof input[0] === "string") {
      return filterStringArray(input as string[], regex);
    }

    if (typeof input[0] === "object") {
      return filterObjectArray(input as JsonObject[], regex);
    }
  }

  if (input && typeof input === "object") {
    return filterMap(input as JsonObject, regex, keyRegex);
  }

  if (typeof input === "string") {
    return regex.test(input) ? input : null;
  }

  if (typeof input === "number" || typeof input === "boolean") {
    return regex.test(String(input)) ? input : null;
  }

  return null;
}