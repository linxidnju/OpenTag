export function slackManifest({ appName = "OpenTag", slashCommand = "/opentag" } = {}) {
  return `display_information:
  name: ${appName}
  description: Channel-native AI agent gateway
  background_color: "#111827"
features:
  bot_user:
    display_name: ${appName}
    always_online: true
  slash_commands:
    - command: ${slashCommand}
      description: Inspect OpenTag sessions, approvals, audit logs, and runtimes
      usage_hint: help
      should_escape: false
oauth_config:
  scopes:
    user:
      - search:read
    bot:
      - app_mentions:read
      - channels:history
      - channels:read
      - files:read
      - files:write
      - groups:history
      - groups:read
      - im:history
      - mpim:history
      - pins:read
      - chat:write
      - commands
      - reactions:write
      - users:read
settings:
  event_subscriptions:
    bot_events:
      - app_mention
      - message.channels
      - message.groups
      - message.im
      - message.mpim
  interactivity:
    is_enabled: true
  socket_mode_enabled: true
  org_deploy_enabled: false
  token_rotation_enabled: false
`;
}

export const SLACK_MANIFEST_URL = "https://api.slack.com/apps?new_app=1";

export const REQUIRED_SCOPES = [
  "app_mentions:read",
  "channels:history",
  "channels:read",
  "files:read",
  "files:write",
  "groups:history",
  "groups:read",
  "im:history",
  "mpim:history",
  "pins:read",
  "chat:write",
  "commands",
  "reactions:write",
  "users:read"
];

export const REQUIRED_USER_SCOPES = [
  "search:read"
];
