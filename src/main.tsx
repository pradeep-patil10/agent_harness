import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

// No StrictMode: a call owns the mic and speaker, and double-mounting would start two calls in dev.
createRoot(document.getElementById("root")!).render(<App />);
