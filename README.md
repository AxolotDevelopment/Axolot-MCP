#  Axolot MCP Server — AI-Native Headless CMS Bridge

[![NPM Version](https://img.shields.io/npm/v/@axolot-ai/mcp-server?color=E67E22&style=flat-square)](https://www.npmjs.com/package/@axolot-ai/mcp-server)
[![Model Context Protocol](https://img.shields.io/badge/MCP-Supported-09B5C4?style=flat-square)](https://modelcontextprotocol.io)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](https://github.com/axolot-ai/Axolot-MCP/blob/main/LICENSE)

**Axolot MCP Server** (`@axolot-ai/mcp-server`) implements Anthropic's **Model Context Protocol (MCP)** to expose your website's database schema, layouts, media library, design tokens, and module tools directly to local AI assistants (Cursor, Claude Desktop, Antigravity, VS Code, Zed).

By running this server, you give your AI editor context-aware "hands" to fetch, build, and optimize pages, products, blog posts, and text slots within your exact design system constraints.

---

## ⚡ Key Capabilities

*   **Surgical Content Orchestration**: The AI can query pages, read slots, and register new visual slots (`createSlot`) dynamically as it writes Astro components.
*   **Media Library Access**: The AI browses available client assets, reading dimensions, file types, and vision-generated descriptions (`getMedia`) to select images automatically.
*   **Brand Token Awareness**: Fetches active color schemes, font families, and spacing rules (`getDesignTokens`) to write style-compliant Tailwind or CSS code.
*   **Module Management**: AI can query, create, or update articles in the **Blog Pro** module or products in the **Tienda Online (E-commerce)** module.

---

## 🔌 Setup & Configuration

Since the server is a Node.js CLI tool, the recommended way to run it is via **`npx`**, which requires zero local code installation or cloning.

### A. Claude Desktop Integration

Add this snippet to your Claude Desktop configuration file (located at `%APPDATA%\Claude\claude_desktop_config.json` on Windows or `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "axolot-cms": {
      "command": "npx",
      "args": ["-y", "@axolot-ai/mcp-server"],
      "env": {
        "AXOLOT_API_URL": "https://api.axolotcms.com"
      }
    }
  }
}
```

### B. Cursor Integration

1.  Open Cursor and go to **Settings -> Features -> MCP**.
2.  Click **"+ Add New MCP Server"**.
3.  Configure it as:
    *   **Name**: `axolot-cms`
    *   **Type**: `command`
    *   **Command**: `npx -y @axolot-ai/mcp-server`
4.  Add environment variables under settings if required, or log in interactively using the tools.

---

## 🛠️ Exposed AI Tools

Once connected, the AI will automatically invoke the following tools to fulfill your design prompts:

### 🔑 Authentication & Context
*   `cms_auth_login`: Triggers a secure authorization handshake URL in your browser.
*   `cms_auth_status`: Verifies connection status, user role, and active site.
*   `cms_switch_site`: Switches the active site context (site ID) when managing multiple client sites.

### 🎨 Brand & Design
*   `getDesignTokens`: Fetches active brand guidelines (colors, typography, spacing, border radius).
*   `setDesignTokens`: Updates brand tokens in the database to establish brand styling.
*   `getSiteSettings`: Fetches core business information (address, social links, email).

### 📝 Layouts & Visual Slots (Consolidated)
*   `managePage`: High-efficiency consolidated tool to list, get, create, update, or delete pages and their schemas.
*   `getSlots`: Reads details and values of slots on a specific page.
*   `createSlot`: Registers a new editable slot key (e.g. `home.hero.title`) in the database.

### 🛍️ Modules & Assets (Consolidated)
*   `manageBlogPost`: Consolidated tool to perform CRUD actions on blog posts (list, get, create, update, or delete).
*   `manageProduct`: Consolidated tool to perform CRUD actions on shop products (list, get, create, update, or delete).
*   `getMedia`: Lists media library files with WebP URLs and alt text descriptions.

---

## 🔒 Security & Sandboxing

The MCP server runs locally on your machine under your user context, connecting to the API via StdIO. It stores session authentication tokens securely in your user home directory at `~/.axolot/mcp-auth.json` (isolated by OS permissions). It never exposes public network ports or scans files outside your active development project directory.

---

## 🔗 Useful Links

*   **Official Website**: [axolotcms.com](https://axolotcms.com)
*   **Client Dashboard**: [ai.axolotcms.com](https://ai.axolotcms.com)
*   **Documentation & Guides**: [axolotcms.com/docs](https://axolotcms.com/docs)
*   **Astro SDK Repository**: [github.com/AxolotDevelopment/Axolot-SDK](https://github.com/AxolotDevelopment/Axolot-SDK)

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.
