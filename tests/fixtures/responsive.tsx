// Development-only visual fixtures; Vite's production entry does not include them.
import { createRoot } from "react-dom/client";
import { Results, ErrorDialog, LoadingScreen } from "../../src/ui/App";
import type { Snapshot } from "../../src/game/types";
import "../../src/style.css";
import "../../src/ui/touch.css";
import "../../src/ui/responsive.css";

const result = {time:72.43,best:72.43,previousBest:78.31,customSetup:false} as Snapshot;
const view = location.hash.slice(1);
createRoot(document.getElementById("root")!).render(
  <main className="app phase-finished">
    {view === "loading" ? <LoadingScreen loaded={52}/> : view === "error" ?
      <ErrorDialog error="Visual acceptance fixture"/> :
      <Results state={result} vehicleName="小燕号" start={() => {}} menu={() => {}}/>}
  </main>,
);
