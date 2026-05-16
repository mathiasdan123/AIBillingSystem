-- Phase 4: Blanche action-confirmation flow.
-- Web users always get a "Confirm/Cancel" card before mutations run.
-- MCP users (Claude Desktop) have their own client-side confirmation prompt.
-- This flag lets practice admins demand a second confirmation at the server
-- level for MCP too — useful for compliance-strict practices that don't want
-- to rely on Claude Desktop's "Always allow" UX.
--
-- Default false: MCP runs as it does today (no extra prompt). Blanche tells
-- admins about this toggle so they can opt in.

ALTER TABLE practices
  ADD COLUMN IF NOT EXISTS mcp_requires_confirmation BOOLEAN NOT NULL DEFAULT false;
