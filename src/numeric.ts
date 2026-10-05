import Decimal from "decimal.js";
export const D = Decimal.clone({
  precision: 34,
  rounding: Decimal.ROUND_HALF_EVEN,
  toExpNeg: -20,
  toExpPos: 40,
});
export const POLICY = Object.freeze({
  engineVersion: "0.3.2",
  precision: 34,
  rounding: "HALF_EVEN",
  unitSystem: "dimensions-v1",
  values: "canonical-base-units",
});
export class CalcError extends Error {
  constructor(
    public code: string,
    message: string,
    public line?: number,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}
