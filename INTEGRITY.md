# INTEGRITY.md — IdeaLift MCP Server

**Product:** IdeaLift MCP Server (https://github.com/Startvest-LLC/idealift-mcp-server)
**Operator:** Startvest LLC (SDVOSB/VOSB certified, Hampstead NC, USA)
**Framework version evaluated against:** 1.0
**Self-evaluation tier:** Bronze
**Last updated:** 2026-05-18

IdeaLift MCP Server is a Model Context Protocol server exposing decision-intelligence operations to AI assistants. Captures product feedback, tracks decisions, manages a backlog.

---

## Layer 1 vetoes — self-mapping

### Veto 1 — Artifact versus outcome

**Pass.** This repository ships a working tool, not a badge or certificate. The MIT-licensed code is the value. No marketing claim is made on the existence of this INTEGRITY.md that the code itself cannot back up.

### Veto 2 — Independence

**Pass with disclosed conflict.** Startvest LLC operates The Integrity Framework directory and is also the author of this repository. The directory verifies the artifacts named here against the framework spec; the directory listing carries an asterisk disclosing the operator relationship. Per-repository external review is the long-term independence path; no public target date is committed in this file until one is genuinely funded.

### Veto 3 — Verifiability

**Pass.** Source code is public. Releases are versioned in this repository's history. Issues and pull requests are public. The framework spec this file maps against is reachable at https://theintegrityframework.org/framework/v1.

### Veto 4 — AI accountability

**Pass.** The server passes user inputs to whichever AI assistant the client invokes (Claude, ChatGPT, etc.); the server itself does not call out to LLMs. No hidden AI generation happens server-side. The IdeaLift product the server connects to discloses its AI sub-processors at https://idealift.app/integrity.

### Veto 5 — Pricing-rigor alignment

**Pass.** The repository is MIT-licensed (or the license stated in LICENSE if different). There is no paid tier of this software, so pricing-rigor mismatch is not a failure mode that applies here.

### Veto 6 — The TechCrunch test

**Pass.** The repository's published behaviour and the description in this file match. A journalist describing the code as misleading or theatrical based on this self-mapping would have to find a gap between the README, the code, and this file — public review is welcome.

---

## Changelog

- 2026-05-18 — Initial publication against framework v1.0.

---

*Published under CC BY 4.0. The Integrity Framework canonical spec is at https://theintegrityframework.org/framework/v1. INTEGRITY.md template: https://theintegrityframework.org/integrity-md.*
