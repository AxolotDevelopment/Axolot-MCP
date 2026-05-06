import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

export interface McpConfig {
  apiToken?: string
  siteId?: string
  apiUrl?: string
  userEmail?: string
  pendingHandshakeId?: string
}

const CONFIG_DIR = join(homedir(), '.axolot')
const CONFIG_FILE = join(CONFIG_DIR, 'mcp-auth.json')

export class ConfigManager {
  private config: McpConfig = {}

  async load(): Promise<McpConfig> {
    try {
      const data = await readFile(CONFIG_FILE, 'utf-8')
      this.config = JSON.parse(data)
      return this.config
    } catch (e) {
      // If file doesn't exist, return empty config
      return {}
    }
  }

  async save(newConfig: Partial<McpConfig>): Promise<void> {
    this.config = { ...this.config, ...newConfig }
    try {
      await mkdir(CONFIG_DIR, { recursive: true })
      await writeFile(CONFIG_FILE, JSON.stringify(this.config, null, 2))
    } catch (e) {
      console.error(' [MCP] Error saving config:', e)
    }
  }

  get(): McpConfig {
    return this.config
  }

  async clear(): Promise<void> {
    this.config = {}
    try {
      await writeFile(CONFIG_FILE, JSON.stringify({}, null, 2))
    } catch (e) {
      console.error(' [MCP] Error clearing config:', e)
    }
  }
}

export const configManager = new ConfigManager()
