import type { FilterOption } from "@silverbulletmd/silverbullet/type/client";
import { fileName } from "@silverbulletmd/silverbullet/lib/resolve";
import { scoreToken } from "../../plug-api/lib/fuzzy.ts";

export { scoreToken };

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function tokenize(query: string): string[] {
  return normalize(query)
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

type Field = { value: string; weight: number };

function fieldsOf(opt: FilterOption): Field[] {
  const fields: Field[] = [];
  const name = opt.name ?? "";
  fields.push({ value: name, weight: 0.85 });
  const base = fileName(name);
  if (base) fields.push({ value: base, weight: 1.0 });
  const displayName = opt.meta?.displayName;
  if (displayName) fields.push({ value: displayName, weight: 0.9 });
  const aliases = opt.meta?.aliases;
  if (aliases && aliases.length > 0) {
    fields.push({ value: aliases.join(" "), weight: 0.85 });
  }
  return fields;
}

export function scoreCandidate(
  query: string,
  option: FilterOption,
): number | null {
  const tokens = tokenize(query);
  if (tokens.length === 0) return 0;
  const fields = fieldsOf(option);
  if (fields.length === 0) return null;

  const perTokenBest: number[] = [];
  for (const token of tokens) {
    let best = 0;
    for (const f of fields) {
      const raw = scoreToken(token, f.value);
      const weighted = raw * f.weight;
      if (weighted > best) best = weighted;
    }
    if (best === 0) return null; // any token fails ⇒ candidate excluded
    perTokenBest.push(best);
  }
  // Geometric mean
  let logSum = 0;
  for (const s of perTokenBest) logSum += Math.log(s);
  return Math.exp(logSum / perTokenBest.length);
}

function compareOrderId(a: number | undefined, b: number | undefined): number {
  const aOrder = a ?? 0;
  const bOrder = b ?? 0;
  if (aOrder === Infinity && bOrder === Infinity) return 0;
  if (aOrder === Infinity) return 1;
  if (bOrder === Infinity) return -1;
  return aOrder - bOrder;
}

type Scored = { item: FilterOption; score: number };

export function fuzzySearchAndSort(
  arr: FilterOption[],
  query: string,
): FilterOption[] {
  if (!query || query.trim() === "") {
    return [...arr].sort((a, b) => compareOrderId(a.orderId, b.orderId));
  }
  const scored: Scored[] = [];
  for (const item of arr) {
    const s = scoreCandidate(query, item);
    if (s !== null && s > 0) scored.push({ item, score: s });
  }
  scored.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    const orderCmp = compareOrderId(a.item.orderId, b.item.orderId);
    if (orderCmp !== 0) return orderCmp;
    const lenCmp = (a.item.name?.length ?? 0) - (b.item.name?.length ?? 0);
    if (lenCmp !== 0) return lenCmp;
    return (a.item.name ?? "").localeCompare(b.item.name ?? "");
  });
  return scored.map((s) => ({ ...s.item, score: s.score }));
}
