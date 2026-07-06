import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import "./styles/tokens.css";
import "./styles/global.css";
import "./styles/components.css";
import { App } from "./app/App";

registerSW({ immediate: true });

const root = document.getElementById("root");
if (!root) throw new Error("#root 엘리먼트를 찾을 수 없습니다.");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
