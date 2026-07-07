import { getMessages } from "./messages";

export function useMessage() {
  return getMessages("ko");
}
