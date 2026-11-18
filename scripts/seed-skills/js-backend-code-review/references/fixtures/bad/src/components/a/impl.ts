import { getB } from "../b/impl.ts";

export const a = 1;

export function longFunction(input: string | null): string {
  const value: any = input;
  const forced = input!;
  console.log(forced);
  const mode = process.env.FIXTURE_MODE;
  const text = `${value}${mode}${getB()}`;
  return text;
}
