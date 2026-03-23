export type GraphEntry = {
  watch: string[];
  cwd: string;
  script: string;
  triggers?: string[];
  quietMs?: number;
};

export const graph: Record<string, GraphEntry> = {
  tensorfleet_tools: {
    watch: ["packages/tensorfleet-tools/src/**/*"],
    cwd: "packages/tensorfleet-tools",
    script: "build",
    triggers: ["tensorfleet_cli", "tensorfleet_openclaw_plugin"],
    quietMs: 3000
  },
  tensorfleet_cli: {
    watch: ["packages/tensorfleet-cli/src/**/*"],
    cwd: "packages/tensorfleet-cli",
    script: "build",
    quietMs: 3000
  },
  tensorfleet_openclaw_plugin: {
    watch: ["packages/tensorfleet-openclaw-plugin/src/**/*"],
    cwd: "packages/tensorfleet-openclaw-plugin",
    script: "build",
    quietMs: 3000
  }
};