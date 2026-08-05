import { describe, expect, it } from "vitest";

import { getPublicKarvProject } from "./projects";

describe("KARV project registry", () => {
  it("registers KV_COLLAB_BLING with the approved contract", () => {
    expect(getPublicKarvProject("KV_COLLAB_BLING")).toEqual({
      id: "KV_COLLAB_BLING",
      repository: "KARV-LP/KV_COLLAB_BLING",
      canonicalOrigin: "https://kv-collab-bling.k-arv.com",
      connectionMode: "server-to-server",
      allowedTasks: ["order_summary"],
      features: {
        aiEnabled: false,
        reportingEnabled: false
      }
    });
  });

  it("does not expose unknown projects", () => {
    expect(getPublicKarvProject("unknown")).toBeUndefined();
  });
});
