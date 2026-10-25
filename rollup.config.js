import { nodeResolve } from "@rollup/plugin-node-resolve";
export default { input: "src/worker.js", output: { file: "worker.js", format: "es" }, plugins: [nodeResolve()], treeshake: true };
