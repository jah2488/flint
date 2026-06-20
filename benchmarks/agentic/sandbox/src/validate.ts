// Input validation at the trust boundary. Throw ValidationError; the app layer maps it to 400.
export class ValidationError extends Error {}

export function requireTitle(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ValidationError("title is required");
  }
  const title = value.trim();
  if (title.length > 200) {
    throw new ValidationError("title must be 200 characters or fewer");
  }
  return title;
}
