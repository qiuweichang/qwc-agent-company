# Agent Company development context

Agent Company is a local-first personal AI software company. Its Web UI
coordinates real Claude Code and Codex CLI processes through a local Node.js
runtime, PTYs, WebSocket streams, SQLite state, and the injected `team`
dispatch protocol.

The product separates planning from execution:

- Product requirements, architecture, UI design, and user approvals remain in
  the planning flow.
- Implementation, testing, acceptance, and delivery remain in the execution
  flow.
- Generated diagrams, prototypes, source code, and documents are indexed in
  the project archive.

Use `README.md` for product behavior and `AGENTS.md` for mandatory engineering
rules. Preserve the existing HTTP/JSON protocol, agent status model, persisted
state ordering, and real CLI runtime path when making changes.
