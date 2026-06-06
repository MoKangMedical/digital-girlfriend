import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

if (typeof window !== "undefined" && "serviceWorker" in navigator && !import.meta.env.DEV) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .catch(() => {
        // 离线能力为可选增强，忽略注册失败，不阻塞启动
      });
  });
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
