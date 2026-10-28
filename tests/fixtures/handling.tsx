// Development-only controls for browser acceptance of sustained keyboard input.
// Exercises the real input listeners, simulation, rig and renderer together.
import { createRoot } from "react-dom/client";
import { useState } from "react";
import App from "../../src/ui/App";
import "../../src/style.css";
import "../../src/ui/touch.css";
import "../../src/ui/responsive.css";

let held: string[]=[];
function drive(codes: string[]) {
  for (const code of held) document.body.dispatchEvent(new KeyboardEvent("keyup",{code,bubbles:true}));
  held=codes;
  for (const code of held) document.body.dispatchEvent(new KeyboardEvent("keydown",{code,bubbles:true}));
}
let automatic=0;
function stop() {window.clearInterval(automatic);drive([]);}
window.addEventListener("pagehide",stop);
function Controls() {
  const [result,setResult]=useState("");
  const start=(drift=false)=>{
    stop();drive(["KeyR"]);drive(["KeyA"]);
    let stage="加速",since=performance.now();
    const records: string[]=[];setResult(stage);
    automatic=window.setInterval(()=>{
      const readings=Array.from(document.querySelectorAll(".debug-live-readouts strong"),node=>node.textContent);
      const reading=()=>`${readings[0]??speed+" km/h"} · 滑角 ${readings[2]??"—"} · 偏航 ${readings[3]??"—"}`;
      const speed=Number.parseFloat(document.querySelector(".debug-live-readouts strong, .speed-readout strong")?.textContent??"0");
      const slip=Math.abs(Number.parseFloat(readings[2]??document.querySelector(".drift-indicator strong")?.textContent??"0"));
      const elapsed=(performance.now()-since)/1000;
      if(stage==="加速" && speed>=90){stage=drift?"手刹起漂":"持续左转";since=performance.now();drive(drift?["KeyA","ArrowLeft","Space"]:["KeyA","ArrowLeft"]);setResult(stage);}
      else if(stage==="手刹起漂" && elapsed>=.1){stage="左转漂移";since=performance.now();drive(["KeyA","ArrowLeft"]);setResult(stage);}
      else if(stage==="左转漂移" && slip>=20){records.push(`入漂：${reading()}`);stage="持续反打";since=performance.now();drive(["KeyA","ArrowRight"]);setResult(stage);}
      else if(stage==="持续反打" && elapsed>.1 && slip<8){records.push(`退出漂移：${reading()}`);stage="反打接续";since=performance.now();setResult(stage);}
      else if(stage==="反打接续" && elapsed>=.25){records.push(`退出后250ms：${reading()}`);stage="持续右转接续";since=performance.now();setResult(stage);}
      else if(stage==="持续右转接续" && elapsed>=.5){records.push(`退出后750ms：${reading()}`);stage="制动";drive(["KeyZ"]);setResult(stage);}
      else if(stage==="持续左转" && elapsed>=2){records.push(`左转：${reading()}`);stage="反打右转";since=performance.now();drive(["KeyA","ArrowRight"]);setResult(stage);}
      else if(stage==="反打右转" && elapsed>=.3){records.push(`反打300ms：${reading()}`);stage="制动";drive(["KeyZ"]);setResult(stage);}
      else if(stage==="制动" && speed<1){stop();setResult(`完成\n${records.join("\n")}`);}
    },50);
  };
  return <aside aria-label="持续输入验收" style={{position:"fixed",zIndex:1000,right:12,top:82,display:"flex",gap:6,flexWrap:"wrap",maxWidth:480,padding:8,background:"#edf4edee",borderRadius:8}}>
    {[
      ["直线加速",["KeyA"]],
      ["持续左转",["KeyA","ArrowLeft"]],
      ["持续右转",["KeyA","ArrowRight"]],
      ["制动",["KeyZ"]],
      ["松开按键",[]],
    ].map(([label,codes])=><button key={label as string} onClick={()=>{stop();drive(codes as string[]);}} style={{padding:"8px 10px",background:"#26463d",color:"white",borderRadius:4}}>{label as string}</button>)}
    <button onClick={()=>start()} style={{padding:8}}>高速反打验收</button>
    <button onClick={()=>start(true)} style={{padding:8}}>漂移反打验收</button>
    <output style={{fontSize:12,whiteSpace:"pre-wrap",flexBasis:"100%",lineHeight:1.7}}>{result}</output>
  </aside>;
}
createRoot(document.getElementById("root")!).render(<>
  <App/><Controls/>
</>);
