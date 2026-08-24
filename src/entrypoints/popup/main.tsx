import { render } from "preact";
import "@/ui/base.css";
import { App } from "./App";
import "./style.css";

const mount = document.getElementById("app");

if (mount === null) {
  throw new Error("Cloudwatcher popup mount point is unavailable.");
}

render(<App />, mount);
