import { createRoot } from "react-dom/client";
import App from "./ui/App";
import "./style.css";
import "./ui/touch.css";
import "./ui/responsive.css";
import { syncDocumentLocale } from "./i18n";

syncDocumentLocale();
createRoot(document.getElementById("root")!).render(<App />);
