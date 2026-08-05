import type { AiTask } from "./types";

export interface PublicKarvProject {
  id: string;
  repository: string;
  canonicalOrigin: string;
  connectionMode: "server-to-server";
  allowedTasks: readonly AiTask[];
  features: {
    aiEnabled: boolean;
    reportingEnabled: boolean;
  };
}

const PROJECTS: Readonly<Record<string, PublicKarvProject>> = {
  KV_COLLAB_BLING: {
    id: "KV_COLLAB_BLING",
    repository: "KARV-LP/KV_COLLAB_BLING",
    canonicalOrigin: "https://kv-collab-bling.k-arv.com",
    connectionMode: "server-to-server",
    allowedTasks: ["order_summary"],
    features: {
      aiEnabled: false,
      reportingEnabled: false
    }
  }
};

export function getPublicKarvProject(
  projectId: string
): PublicKarvProject | undefined {
  return PROJECTS[projectId];
}
