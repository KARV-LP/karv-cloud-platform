import { describe, expect, it } from "vitest";
import {
  corsHeaders,
  HttpError,
  requireAllowedBrowserOrigin
} from "./security";
import type { Env } from "./types";

function envWithOrigins(origins: string): Env {
  return { ALLOWED_ORIGINS: origins } as Env;
}

describe("browser origin policy", () => {
  it("treats the explicit none marker as no authorized origins", () => {
    const request = new Request("https://api.k-arv.com/api/internal/ai", {
      method: "OPTIONS",
      headers: { Origin: "https://www.k-arv.com" }
    });

    try {
      requireAllowedBrowserOrigin(request, envWithOrigins("none"));
      throw new Error("Expected origin rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).status).toBe(403);
    }

    expect(corsHeaders(request, envWithOrigins("none"))).toEqual({});
  });

  it("still allows an explicitly configured origin", () => {
    const request = new Request("https://api.k-arv.com/api/internal/ai", {
      method: "OPTIONS",
      headers: { Origin: "https://www.k-arv.com" }
    });

    expect(() =>
      requireAllowedBrowserOrigin(
        request,
        envWithOrigins("https://www.k-arv.com")
      )
    ).not.toThrow();
    expect(corsHeaders(request, envWithOrigins("https://www.k-arv.com"))).toMatchObject({
      "Access-Control-Allow-Origin": "https://www.k-arv.com"
    });
  });
});
