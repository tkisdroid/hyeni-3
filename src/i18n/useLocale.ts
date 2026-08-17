import { useContext } from "react";
import { LocaleContext, type LocaleContextValue } from "./LocaleProvider";

export function useLocale(): LocaleContextValue {
  const context = useContext(LocaleContext);
  if (!context) {
    throw new Error("useLocale은 LocaleProvider 안에서 사용해야 합니다.");
  }
  return context;
}
