import { isTierId, type TierId } from "../pricing";

export function tierOrReport(value: string | null | undefined): TierId {
  return value && isTierId(value) ? value : "report";
}
