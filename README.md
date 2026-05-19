#  Axolot MCP Server

Model Context Protocol (MCP) server for Axolot CMS. Give your AI assistant "hands" to manage your website content, structure, and infrastructure.

## Features

- **Master Content Tools**: List pages, read slots, and update content in real-time.
- **Media Library Access**: Allow AI to browse and select assets for your site.
- **Design Token Awareness**: Give AI context about your brand's colors, typography, and spacing.
- **Zero-Effort Integration**: Works with Cursor, Claude Desktop, Zed, and any MCP-compatible client.

## Quickstart

### Using npx (Recommended)

Add this to your MCP settings (e.g., `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "axolot": {
      "command": "npx",
      "args": ["-y", "@axolot-ai/mcp-server"]
    }
  }
}
```

### Authentication

Once the server is running, use the following tools in your AI chat:

1. `cms_auth_login`: To connect your account.
2. `cms_auth_status`: To verify the connection.
3. `cms_switch_site`: To select the target site.

## Documentation

Full documentation available at [axolot-cms.com/docs/mcp](https://axolot-cms.com/docs/mcp).

## License

MIT
