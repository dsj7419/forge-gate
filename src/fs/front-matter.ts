import { parse as parseYaml } from "yaml";

export type FrontMatter =
  | { ok: true; data: unknown; body: string }
  | { ok: false; error: string };

const DELIMITER = "---";

/**
 * Splits a Markdown document's leading YAML front-matter from its body.
 *
 * Returns a structured result rather than throwing, so the validator can turn
 * any parse problem into a finding instead of crashing.
 *
 * Permissive by design: empty front-matter yields `null` and a scalar root
 * yields a string — both `ok: true`. Enforcing that ticket metadata is a
 * proper object with required fields is the schema layer's job, not the
 * parser's.
 */
export function parseFrontMatter(raw: string): FrontMatter {
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");

  if (lines[0]?.trimEnd() !== DELIMITER) {
    return { ok: false, error: "missing front-matter: document must begin with a '---' line" };
  }

  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trimEnd() === DELIMITER);
  if (closingIndex === -1) {
    return { ok: false, error: "unterminated front-matter: no closing '---' line" };
  }

  const yamlText = lines.slice(1, closingIndex).join("\n");
  const body = lines.slice(closingIndex + 1).join("\n");

  let data: unknown;
  try {
    data = parseYaml(yamlText);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `invalid YAML in front-matter: ${message}` };
  }

  return { ok: true, data, body };
}
