// Registers the Desk's operations with the agent runtime. agent-manifest.json loads this module through
// "actions.module"; only the names in "actions.agentTools" become model tools, called website_<name>.
// Each action wraps a method of the one page object, App.page, which the page's own buttons also call. No business
// rule is copied here. No action returns private key material: generate_key returns the key id only, and sign_files
// signs with the key file the visitor picked on the page, which never passes through the model.
// Trusting a publisher is deliberately NOT an action: only the visitor, on the page, can add to the trust store.
import { App } from "./desk.js";

const TARGET = {
  type: "string",
  minLength: 8,
  maxLength: 2000,
  description: "The site address, network address or agent-manifest.json address the visitor gave, starting with https://.",
};

class SiteActions {
  static registerActions(actions) {
    actions.register(SiteActions.getDeskStateAction());
    actions.register(SiteActions.runGateAction());
    actions.register(SiteActions.readDriftAction());
    actions.register(SiteActions.verifySiteAction());
    actions.register(SiteActions.generateKeyAction());
    actions.register(SiteActions.signFilesAction());
  }

  static getDeskStateAction() {
    return {
      name: "get_desk_state",
      description: "Read the Desk page: what it does, today's date, the partner sites and their page links, the last gate, drift and verification results, the key made on the page (key id only), the files the visitor chose for signing with their digests, the signing version and whether signing is ready, and the trusted publishers. Changes nothing.",
      effect: "read",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      execute: () => App.page.getState(),
    };
  }

  static runGateAction() {
    return {
      name: "run_gate",
      description: "Run the gate on a site in this browser: Plumbline's port of the reference validation rules, Agent Atlas and Agent Customs. Returns the gate report: an overall state and one finding per checker, each pass, fail or unavailable (no verdict, never a pass), with a summary. Changes nothing on the site.",
      effect: "read",
      inputSchema: { type: "object", additionalProperties: false, required: ["target"], properties: { target: TARGET } },
      execute: (args) => App.page.runGate(args),
    };
  }

  static readDriftAction() {
    return {
      name: "read_drift",
      description: "Read a site's published plumbline.lock.json and re-check its runtime files, grounding sources and peers live. Returns the lock address, whether a lock was found, and findings (kind, severity info/warn/block, ref, summary). A site with no lock gets one finding saying so. Changes nothing.",
      effect: "read",
      inputSchema: { type: "object", additionalProperties: false, required: ["target"], properties: { target: TARGET } },
      execute: (args) => App.page.readDrift(args),
    };
  }

  static verifySiteAction() {
    return {
      name: "verify_site",
      description: "Verify a site's plumbline.signature.json and the files it covers against the visitor's own trust store, checked as the origin the files were fetched from. Returns verdict verified, invalid (with reason, revoked included) or unverifiable, its meaning in plain words, the signer key id and origin, and what the site's plumbline-revocation.json did (absent, applied, not-applied, or unavailable when it could not be read). It cannot add trust. The one change it can make: a revocation that verifies under a key the visitor trusts marks that key revoked, which only takes trust away.",
      effect: "read",
      inputSchema: { type: "object", additionalProperties: false, required: ["target"], properties: { target: TARGET } },
      execute: (args) => App.page.verifySite(args),
    };
  }

  static generateKeyAction() {
    return {
      name: "generate_key",
      description: "Make a new Ed25519 publisher key in this browser and offer plumbline.private.json and .well-known/plumbline-key.json as downloads on the page. Returns only the key id: the private key is never returned, stored or sent. The visitor can discard it on the page.",
      effect: "write",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      execute: () => App.page.generateKey(),
    };
  }

  static signFilesAction() {
    return {
      name: "sign_files",
      description: "Sign the files the visitor chose on the page with the private key file they chose there, for the origin entered there, and offer plumbline.signature.json as a download. The browser asks the visitor to confirm first. Refuses a stale expectedVersion. Returns the key id, origin, expiry and the signed paths.",
      effect: "irreversible",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["expectedVersion"],
        properties: {
          expectedVersion: {
            type: "integer",
            minimum: 0,
            description: "signing.version from website_get_desk_state, read in this same turn.",
          },
        },
      },
      execute: (args) => App.page.signFiles(args),
    };
  }
}

export const registerActions = SiteActions.registerActions;
