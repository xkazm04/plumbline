// Example gate runs for the overview, so the compass card has a fix to show before the visitor has run the gate.
// They are NOT live: each one is a gate report captured 2026-11-17 by Plumbline's own CLI (`plumbline gate`) against the
// live site, copied from the contest data (.contest/arena/plumbline-desk/data/desk-data.json, gateReports). The page
// labels every one of them "example" wherever it shows them, and a gate run on this page always takes their place.
// The shell (shell.js) draws them. desk.js reads only their target addresses: the assistant may send the read tools to
// an example's host without the visitor typing it (D1). No tool result depends on the captured reports.

export const EXAMPLE_CAPTURED = "2026-11-17";

export const EXAMPLE_RUNS = [
  {
    name: "Agent Customs",
    target: "https://montbaga.github.io/agent-customs/agent_customs",
    state: "pass",
    findings: [
      { adapter: "validator", state: "pass", summary: "Plumbline's port of the reference validation rules (not the reference code) found no problem: 1 network definition checked." },
      { adapter: "atlas", state: "pass", summary: "Agent Atlas reports the target conformant to its checks (score 100, no failed MUST checks)." },
      {
        adapter: "customs",
        state: "pass",
        summary:
          "Agent Customs' signed receipt stamps the network CLEARED (inspected 2026-11-16, valid until 2026-12-21); the signature checks out. The live network was not rechecked: Plumbline cannot reproduce Customs' fingerprint, so a change since the stamp would not show here.",
      },
    ],
  },
  {
    name: "Agent Atlas",
    target: "https://agent-atlas-phi.vercel.app/",
    state: "unavailable",
    findings: [
      { adapter: "validator", state: "pass", summary: "Plumbline's port of the reference validation rules (not the reference code) found no problem: 1 network definition checked." },
      { adapter: "atlas", state: "pass", summary: "Agent Atlas reports the target conformant to its checks (score 100, no failed MUST checks)." },
      { adapter: "customs", state: "unavailable", summary: "Unavailable: no receipt for this target in Agent Customs' published receipts. The live network was not rechecked." },
    ],
  },
  {
    name: "The challenge site",
    target: "https://worldwideagenticweb.org/",
    state: "fail",
    findings: [
      { adapter: "validator", state: "fail", summary: "Plumbline's port of the reference validation rules (not the reference code): no agent-manifest.json is published at the target (HTTP 404)." },
      { adapter: "atlas", state: "fail", summary: "Agent Atlas found no usable agent-manifest.json at the target (it got HTTP 404)." },
      { adapter: "customs", state: "unavailable", summary: "Agent Customs was not asked: no network address could be worked out for the target." },
    ],
  },
];
