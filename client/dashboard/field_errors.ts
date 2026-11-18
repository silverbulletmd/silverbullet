import type { FieldError } from "./types.ts";

/**
 * Server field keys mapped to the labels the dashboard shows. Keys may carry a
 * scope prefix (`space.host`, `<space id>.binding`); only the last segment
 * names the field.
 */
const FIELD_LABELS: Record<string, string> = {
  adminUsername: "Username",
  adminPassword: "Password",
  adminPassword2: "Repeat password",
  adminFullName: "Full name",
  adminEmail: "Email",
  name: "Name",
  host: "Hostname",
  prefix: "Path",
  binding: "Path",
  folder: "Folder",
  indexPage: "Index page",
  serverName: "Server name",
  primaryUrl: "Server address",
  model: "Search model",
  runtimeIdleTimeout: "Stop idle runtimes after",
};

/** The form field an error belongs to: `space.host` → `host`. */
export function fieldName(field: string): string {
  return field.slice(field.lastIndexOf(".") + 1);
}

function sentence(message: string): string {
  return message.charAt(0).toUpperCase() + message.slice(1);
}

/** One error as the user should read it: `Path: Prefix is required`. */
export function describeFieldError(error: FieldError): string {
  const label = FIELD_LABELS[fieldName(error.field)];
  const message = sentence(error.message);
  return label ? `${label}: ${message}` : message;
}

/**
 * Errors for the fields a form renders inline, keyed by field name, and the
 * rest for a summary above the form.
 */
export function splitFieldErrors(
  errors: FieldError[],
  inline: string[],
): { byField: Record<string, string>; other: FieldError[] } {
  const byField: Record<string, string> = {};
  const other: FieldError[] = [];
  for (const error of errors) {
    const name = fieldName(error.field);
    if (error.field && inline.includes(name)) {
      const message = sentence(error.message);
      byField[name] = byField[name] ? `${byField[name]}; ${message}` : message;
    } else {
      other.push(error);
    }
  }
  return { byField, other };
}
