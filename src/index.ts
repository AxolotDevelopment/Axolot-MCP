#!/usr/bin/env node
/**
 * AxolotCMS MCP Server
 *
 * Exposes the CMS as an MCP (Model Context Protocol) server.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { configManager } from './config.js'

// ── Environment Setup ────────────────────────────────────────────────────────

// 1. Try to load .env from the MCP package directory itself
const mcpDir = dirname(fileURLToPath(import.meta.url))
const masterEnv = join(mcpDir, '../.env')
if (existsSync(masterEnv)) {
  // @ts-ignore
  process.loadEnvFile(masterEnv)
  console.error(` [MCP] Loaded env from ${masterEnv}`)
}

// 2. Try to load .env from the current working directory
const localEnv = join(process.cwd(), '.env')
if (existsSync(localEnv)) {
  try {
    // @ts-ignore
    process.loadEnvFile(localEnv)
    console.error(` [MCP] Loaded env from ${localEnv}`)
  } catch (e) {
    console.error(`Warning: Failed to load .env from ${localEnv}`)
  }
}

// 3. Load Persistent Config
await configManager.load()

const API_URL = process.env.AXOLOT_API_URL || configManager.get().apiUrl || 'http://localhost:3001'

function getApiToken() {
  return configManager.get().apiToken || process.env.AXOLOT_API_TOKEN
}

function getSiteId() {
  return configManager.get().siteId || process.env.AXOLOT_SITE_ID
}

console.error(` [MCP] Active Site: ${getSiteId() || '(none)'}`)
console.error(` [MCP] API URL: ${API_URL}`)

// ── HTTP helper ─────────────────────────────────────────────────────────────

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getApiToken()
  const siteId = getSiteId()

  if (!token && !path.includes('/handshake/')) {
    throw new Error(' [MCP] Authentication required. Please run the "cms_auth_login" tool.')
  }

  // Replace :siteId placeholder in paths if present
  const finalPath = path.replace(':siteId', siteId || '')
  const url = `${API_URL}${finalPath}`
  
  // Ensure POST/PATCH/PUT have a body if content-type is json
  const fetchOptions: RequestInit = {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  }

  if (['POST', 'PATCH', 'PUT'].includes(options?.method || '') && !fetchOptions.body) {
    fetchOptions.body = JSON.stringify({})
  }

  const res = await fetch(url, fetchOptions)

  if (!res.ok) {
    let errorMessage = `API error ${res.status}`
    try {
      const errorData = await res.json() as any
      errorMessage += `: ${errorData.message || errorData.error || JSON.stringify(errorData)}`
    } catch {
      errorMessage += `: ${await res.text()}`
    }
    throw new Error(errorMessage)
  }
  return res.json() as Promise<T>
}

// ── MCP Server setup ─────────────────────────────────────────────────────────

const server = new McpServer({
  name: 'axolot-cms',
  version: '0.1.0',
})

// ── AUTH TOOLS ───────────────────────────────────────────────────────────────

/**
 * Check authentication status
 */
server.tool(
  'cms_auth_status',
  'Check if the AI is authenticated and which site is currently active.',
  {},
  async () => {
    const config = configManager.get()
    let token = getApiToken()
    const siteId = getSiteId()

    // Si hay un handshake pendiente, intentamos completarlo para persistir la llave
    if (config.pendingHandshakeId) {
      try {
        const pollUrl = `${API_URL}/api/v1/mcp/handshake/poll/${config.pendingHandshakeId}`
        const pollRes = await fetch(pollUrl)
        
        if (pollRes.ok) {
          const res = await pollRes.json() as any
          if (res.status === 'authorized' && res.token) {
            token = res.token
            await configManager.save({ 
              apiToken: token, 
              siteId: res.siteId || config.siteId,
              pendingHandshakeId: undefined 
            })
          }
        }
      } catch (e) {
        // Solo limpiamos si el error es de caducidad (404/410)
        // await configManager.save({ pendingHandshakeId: undefined })
      }
    }

    if (!token) {
      return {
        content: [{ type: 'text', text: ' [Auth] Status: NOT LOGGED IN\n\nPlease run "cms_auth_login" to connect your account.' }],
      }
    }

    try {
      const user = await api<any>('/api/v1/auth/me')
      return {
        content: [{
          type: 'text',
          text: ` [Auth] Status: CONNECTED\nUser: ${user.name} (${user.email})\nRole: ${user.role}\n\nActive Site ID: ${siteId || 'None (Global Agency Access)'}\nAPI URL: ${API_URL}`,
        }],
      }
    } catch (e: any) {
      return {
        content: [{ type: 'text', text: ` [Auth] Status: ERROR\n${e.message}` }],
      }
    }
  }
)

/**
 * Initiate Login Handshake
 */
server.tool(
  'cms_auth_login',
  'Connect your Axolot account to this AI session. This will provide a login URL.',
  {},
  async () => {
    try {
      const handshake = await api<any>('/api/v1/mcp/handshake/init', { method: 'POST' })
      
      // Guardamos el ID del handshake para poder completarlo en el siguiente check de status
      await configManager.save({ pendingHandshakeId: handshake.handshakeId })
      
      return {
        content: [{
          type: 'text',
          text: ` [Auth] Handshake Initiated!\n\n1. Please visit this URL to authorize the AI:\n${handshake.loginUrl}\n\n2. After authorizing in the browser, run "cms_auth_status" to complete the connection.\n\nNote: This link expires in 10 minutes.`,
        }],
      }
    } catch (e: any) {
      return {
        content: [{ type: 'text', text: ` [Auth] Error initiating handshake: ${e.message}` }],
        isError: true,
      }
    }
  }
)

/**
 * Switch active site
 */
server.tool(
  'cms_switch_site',
  'Change the active site context for the AI. This will list available sites if no ID is provided.',
  { siteId: z.string().optional().describe('The UUID of the site to switch to') },
  async ({ siteId }) => {
    if (!siteId) {
      const sites = await api<any[]>('/api/v1/sites')
      return {
        content: [{
          type: 'text',
          text: ` [Auth] Please provide a Site ID to switch context.\n\nAvailable Sites:\n${sites.map(s => `- ${s.name} (ID: ${s.id})`).join('\n')}`,
        }],
      }
    }

    await configManager.save({ siteId })
    return {
      content: [{ type: 'text', text: ` [Auth] Site context switched to: ${siteId}\nAll subsequent tool calls will target this site.` }],
    }
  }
)

// ── CMS TOOLS ────────────────────────────────────────────────────────────────

/**
 * Get site design tokens (colors, fonts, spacing)
 */
server.tool(
  'getDesignTokens',
  'Get the design tokens (colors, typography, spacing) for the current site. Always call this first when building or modifying UI components.',
  {},
  async () => {
    const siteId = getSiteId()
    if (!siteId) throw new Error('No active site. Use cms_switch_site to select one.')

    const site = await api<{ designTokens: Record<string, string>; name: string; domain: string }>(
      `/api/v1/sites/${siteId}`
    )
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          siteName: site.name,
          domain: site.domain,
          tokens: site.designTokens ?? {},
        }, null, 2),
      }],
    }
  }
)

/**
 * Get all media files available for the site
 */
server.tool(
  'getMedia',
  'List all media files uploaded for this client site. Returns URLs, dimensions, and AI-generated alt text.',
  { pageSlug: z.string().optional().describe('Filter by page usage (optional)') },
  async () => {
    const siteId = getSiteId()
    if (!siteId) throw new Error('No active site. Use cms_switch_site to select one.')

    const media = await api<Array<{
      id: string; filename: string; url: string; webpUrl: string | null
      altText: string | null; width: number | null; height: number | null; mimeType: string
    }>>(`/api/v1/sites/${siteId}/media`)

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(media.map(m => ({
          id: m.id,
          filename: m.filename,
          url: m.webpUrl ?? m.url,    // prefer WebP
          originalUrl: m.url,
          alt: m.altText,
          dimensions: m.width && m.height ? `${m.width}×${m.height}` : null,
          type: m.mimeType,
        })), null, 2),
      }],
    }
  }
)

/**
 * Get all pages and their slot structure
 */
server.tool(
  'getPages',
  'Get all pages for the site and their editable slots. Use this to understand the current site structure before adding new sections.',
  {},
  async () => {
    const siteId = getSiteId()
    if (!siteId) throw new Error('No active site. Use cms_switch_site to select one.')

    const pages = await api<Array<{ id: string; title: string; slug: string; slots: unknown[] }>>(
      `/api/v1/sites/${siteId}/pages`
    )
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(pages, null, 2),
      }],
    }
  }
)

/**
 * Get slots for a specific page
 */
server.tool(
  'getSlots',
  'Get all editable slots for a specific page. Slots are the content areas the client can edit via AI chat.',
  {
    pageId: z.string().describe('The page ID to get slots for'),
  },
  async ({ pageId }) => {
    const siteId = getSiteId()
    if (!siteId) throw new Error('No active site. Use cms_switch_site to select one.')

    const slots = await api<Array<{
      id: string; key: string; label: string; type: string; value: unknown; aiHint: string | null
    }>>(`/api/v1/sites/${siteId}/slots?pageId=${pageId}`)

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(slots, null, 2),
      }],
    }
  }
)

/**
 * Register a new editable slot — called when designer creates a new component
 */
server.tool(
  'createSlot',
  'Register a new editable slot in the CMS. Call this every time you create a section with content that the client should be able to edit via AI chat. Use a dot-notation key like "hero.title" or "about.description".',
  {
    pageId: z.string().describe('The page this slot belongs to'),
    key: z.string().describe('Unique slot key in dot notation, e.g. "hero.title", "services.cta.label"'),
    label: z.string().describe('Human-readable label shown to client, e.g. "Título principal del hero"'),
    type: z.enum(['text', 'richtext', 'image', 'video', 'link', 'color', 'boolean', 'number', 'json']),
    value: z.unknown().optional().describe('Initial content value'),
    aiHint: z.string().optional().describe('Hint for the AI about constraints, e.g. "Keep under 8 words, brand voice is professional"'),
    required: z.boolean().optional(),
  },
  async ({ pageId, key, label, type, value, aiHint, required }) => {
    const siteId = getSiteId()
    if (!siteId) throw new Error('No active site. Use cms_switch_site to select one.')

    const slot = await api(`/api/v1/sites/${siteId}/slots`, {
      method: 'POST',
      body: JSON.stringify({ pageId, key, label, type, value, aiHint, required }),
    })

    return {
      content: [{
        type: 'text',
        text: `✅ Slot registered: ${key}\n\nThe client can now edit "${label}" via the AI chat.\n\n${JSON.stringify(slot, null, 2)}`,
      }],
    }
  }
)

/**
 * Update design tokens for the site
 */
server.tool(
  'setDesignTokens',
  'Update the design tokens for the site (colors, fonts, spacing). Call this when establishing or refining the brand identity.',
  {
    primaryColor: z.string().optional().describe('Main brand color, hex format e.g. #007AFF'),
    secondaryColor: z.string().optional(),
    accentColor: z.string().optional(),
    backgroundColor: z.string().optional(),
    textColor: z.string().optional(),
    fontFamily: z.string().optional().describe('Body font family, e.g. "Inter"'),
    fontFamilyHeading: z.string().optional().describe('Heading font family, e.g. "Playfair Display"'),
    borderRadius: z.string().optional().describe('Global border radius, e.g. "8px" or "0px" for sharp'),
  },
  async (tokens) => {
    const siteId = getSiteId()
    if (!siteId) throw new Error('No active site. Use cms_switch_site to select one.')

    // Remove undefined values
    const cleanTokens = Object.fromEntries(Object.entries(tokens).filter(([, v]) => v !== undefined))

    await api(`/api/v1/sites/${siteId}`, {
      method: 'PATCH',
      body: JSON.stringify({ designTokens: cleanTokens }),
    })

    return {
      content: [{
        type: 'text',
        text: `✅ Design tokens updated:\n${JSON.stringify(cleanTokens, null, 2)}`,
      }],
    }
  }
)

/**
 * Get site settings (business name, contact, social links)
 */
server.tool(
  'getSiteSettings',
  'Get the site business settings — name, contact info, social links. Use this to pre-fill content in components like headers, footers, and contact sections.',
  {},
  async () => {
    const siteId = getSiteId()
    if (!siteId) throw new Error('No active site. Use cms_switch_site to select one.')

    const settings = await api(`/api/v1/sites/${siteId}/settings`)
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(settings, null, 2),
      }],
    }
  }
)

/**
 * Get active modules for the site
 */
server.tool(
  'getActiveModules',
  'Get the list of active modules for this site (blog, shop, bookings, etc.). Use this to know which sections and pages you can add to the site.',
  {},
  async () => {
    const siteId = getSiteId()
    if (!siteId) throw new Error('No active site. Use cms_switch_site to select one.')

    const site = await api<any>(`/api/v1/sites/${siteId}`)
    const modules = (site.activeModules ?? []).map((m: any) => m.module?.name || 'unknown')
    return {
      content: [{
        type: 'text',
        text: `Active modules for this site: ${modules.join(', ')}`,
      }],
    }
  }
)

/**
 * Get technical blueprints and capabilities for a specific module.
 */
server.tool(
  'getModuleCapabilities',
  'Get the technical requirements and blueprints for implementing a specific module in the UI. Call this when you need to build a UI section that interacts with a module (like a form or a blog list).',
  {
    moduleName: z.enum(['blog', 'shop', 'submissions']).describe('The name of the module'),
  },
  async ({ moduleName }) => {
    const capabilities: Record<string, any> = {
      blog: {
        type: 'content_list',
        recommended_components: ['PostCard', 'CategoryFilter'],
        data_structure: {
          title: 'string',
          excerpt: 'string',
          image: 'url (featuredImage)',
          slug: 'string (link to /blog/[slug])',
          date: 'ISO string'
        },
        endpoint: '/api/v1/blog/:siteId/posts',
        auth_required: true,
        ai_instructions: 'Use fetch with Authorization: Bearer <AXOLOT_API_TOKEN>. Posts are returned as an array.'
      },
      shop: {
        type: 'product_catalog',
        recommended_components: ['ProductCard', 'PriceTag', 'CartButton'],
        data_structure: {
          name: 'string',
          price: 'number (cents)',
          image: 'url',
          slug: 'string (link to /escapada/[slug])'
        },
        endpoint: '/api/v1/shop/:siteId/products',
        auth_required: true,
        ai_instructions: 'Use fetch with Authorization: Bearer <AXOLOT_API_TOKEN>. Products are returned as an array. Price is in cents.'
      },
      submissions: {
        type: 'form_capture',
        implementation_blueprint: {
          tag: 'form',
          required_attribute: 'data-form="unique-id"',
          required_fields: [
            { name: 'nombre', type: 'text', label: 'Nombre Completo' },
            { name: 'email', type: 'email', label: 'Email' }
          ],
          client_bridge: 'initAxolotForms(siteId)',
          feedback_states: ['loading', 'success', 'error']
        },
        ai_instructions: 'Design custom forms freely using Tailwind. Just ensure the "data-form" attribute is present and inputs have the correct "name" attributes. The layout must include the Axolot Forms Bridge script.'
      }
    }

    const spec = capabilities[moduleName]
    if (!spec) {
      return {
        content: [{ type: 'text', text: `❌ Module capabilities not found for: ${moduleName}` }],
        isError: true
      }
    }

    return {
      content: [{
        type: 'text',
        text: `Technical Blueprint for ${moduleName.toUpperCase()} module:\n\n${JSON.stringify(spec, null, 2)}`
      }]
    }
  }
)

/**
 * Get all blog posts
 */
server.tool(
  'getBlogPosts',
  'List all blog posts for the site. Use this to build blog index pages or latest post widgets.',
  {
    status: z.enum(['draft', 'published', 'archived']).optional().describe('Filter by status'),
  },
  async ({ status }) => {
    const siteId = getSiteId()
    if (!siteId) throw new Error('No active site. Use cms_switch_site to select one.')

    const site = await api<{ activeModules: Array<{ module: { name: string } }> }>(`/api/v1/sites/${siteId}`)
    const isBlogActive = (site.activeModules ?? []).some(m => m.module.name === 'blog')

    if (!isBlogActive) {
      return {
        content: [{
          type: 'text',
          text: '❌ ERROR: El módulo de "Blog" no está activo para este sitio.',
        }],
        isError: true,
      }
    }

    const posts = await api<any[]>(`/api/v1/blog/${siteId}/posts`)
    const filteredPosts = status ? posts.filter(p => p.status === status) : posts

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(filteredPosts.map(p => ({
          id: p.id,
          title: p.title,
          slug: p.slug,
          status: p.status,
          date: p.publishedAt || p.createdAt,
          image: p.featuredImage
        })), null, 2),
      }],
    }
  }
)

/**
 * Get a specific blog post
 */
server.tool(
  'getBlogPost',
  'Get the full content and details of a specific blog post.',
  {
    postId: z.string().optional().describe('The post ID'),
    slug: z.string().optional().describe('The post slug'),
  },
  async ({ postId, slug }) => {
    const siteId = getSiteId()
    if (!siteId) throw new Error('No active site. Use cms_switch_site to select one.')

    const site = await api<{ activeModules: Array<{ module: { name: string } }> }>(`/api/v1/sites/${siteId}`)
    const isBlogActive = (site.activeModules ?? []).some(m => m.module.name === 'blog')

    if (!isBlogActive) {
      return {
        content: [{ type: 'text', text: '❌ ERROR: El módulo de "Blog" no está activo.' }],
        isError: true,
      }
    }

    const posts = await api<any[]>(`/api/v1/blog/${siteId}/posts`)
    const post = postId 
      ? posts.find(p => p.id === postId) 
      : posts.find(p => p.slug === slug)

    if (!post) {
      return { content: [{ type: 'text', text: `❌ Post not found` }], isError: true }
    }

    return { content: [{ type: 'text', text: JSON.stringify(post, null, 2) }] }
  }
)

/**
 * Create a new blog post
 */
server.tool(
  'createBlogPost',
  'Create a new blog post in the CMS.',
  {
    title: z.string().describe('The post title'),
    slug: z.string().describe('The post slug'),
    excerpt: z.string().optional().describe('A short summary of the post'),
    content: z.string().describe('The full content (HTML or Markdown)'),
    featuredImage: z.string().optional().describe('URL of the featured image'),
    status: z.enum(['draft', 'published', 'archived']).default('published'),
    categoryId: z.string().optional().describe('UUID of the category'),
  },
  async (data) => {
    const siteId = getSiteId()
    if (!siteId) throw new Error('No active site. Use cms_switch_site to select one.')

    const post = await api(`/api/v1/blog/${siteId}/posts`, {
      method: 'POST',
      body: JSON.stringify(data),
    })

    return {
      content: [{
        type: 'text',
        text: `✅ Blog post created: ${data.title}\nURL: /blog/${data.slug}`,
      }],
    }
  }
)

/**
 * Update an existing blog post
 */
server.tool(
  'updateBlogPost',
  'Update an existing blog post.',
  {
    postId: z.string().describe('The UUID of the post to update'),
    title: z.string().optional(),
    slug: z.string().optional(),
    excerpt: z.string().optional(),
    content: z.string().optional(),
    featuredImage: z.string().optional(),
    status: z.enum(['draft', 'published', 'archived']).optional(),
    categoryId: z.string().optional(),
  },
  async ({ postId, ...data }) => {
    const siteId = getSiteId()
    if (!siteId) throw new Error('No active site. Use cms_switch_site to select one.')

    await api(`/api/v1/blog/${siteId}/posts/${postId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    })

    return {
      content: [{ type: 'text', text: `✅ Blog post updated (ID: ${postId})` }],
    }
  }
)

/**
 * Get all shop products
 */
server.tool(
  'getProducts',
  'List all products (escapadas) for the site.',
  { status: z.enum(['draft', 'published', 'archived']).optional() },
  async ({ status }) => {
    const siteId = getSiteId()
    if (!siteId) throw new Error('No active site.')

    const products = await api<any[]>(`/api/v1/shop/${siteId}/products`)
    const filtered = status ? products.filter(p => p.status === status) : products

    return { content: [{ type: 'text', text: JSON.stringify(filtered, null, 2) }] }
  }
)

/**
 * Get a specific product
 */
server.tool(
  'getProduct',
  'Get details of a specific product by its slug.',
  { slug: z.string() },
  async ({ slug }) => {
    const siteId = getSiteId()
    if (!siteId) throw new Error('No active site.')
    const product = await api<any>(`/api/v1/shop/${siteId}/products/slug/${slug}`)
    return { content: [{ type: 'text', text: JSON.stringify(product, null, 2) }] }
  }
)

/**
 * Create a new product
 */
server.tool(
  'createProduct',
  'Create a new product in the shop.',
  {
    name: z.string(),
    slug: z.string(),
    description: z.string(),
    shortDescription: z.string(),
    price: z.number(),
    featuredImage: z.string().optional(),
    status: z.enum(['draft', 'published']).default('published'),
  },
  async (data) => {
    const siteId = getSiteId()
    if (!siteId) throw new Error('No active site.')
    const product = await api(`/api/v1/shop/${siteId}/products`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
    return { content: [{ type: 'text', text: `✅ Product created: ${data.name}` }] }
  }
)

/**
 * Create a new page
 */
server.tool(
  'createPage',
  'Create a new page in the CMS. IMPORTANT: The slug MUST start with a slash (e.g. /my-page or /).',
  {
    title: z.string(),
    slug: z.string(),
    metaTitle: z.string().optional(),
    metaDescription: z.string().optional(),
  },
  async (data) => {
    const siteId = getSiteId()
    if (!siteId) throw new Error('No active site.')
    const page = await api(`/api/v1/sites/${siteId}/pages`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
    return { content: [{ type: 'text', text: `✅ Page created: ${data.title}` }] }
  }
)

// ── RESOURCES ─────────────────────────────────────────────────────────────────

server.resource(
  'site-context',
  'axolot://site/context',
  async () => {
    const siteId = getSiteId()
    if (!siteId) throw new Error('No active site. Use cms_switch_site to select one.')

    const [site, settings] = await Promise.all([
      api<{ name: string; domain: string; designTokens: Record<string, string>; activeModules: unknown[] }>(`/api/v1/sites/${siteId}`),
      api<{ businessName: string | null; businessEmail: string | null; socialLinks: unknown }>(`/api/v1/sites/${siteId}/settings`),
    ])

    return {
      contents: [{
        uri: 'axolot://site/context',
        mimeType: 'text/plain',
        text: `
# Site Context: ${site.name}

## Domain
${site.domain ?? 'Not set'}

## Business
Name: ${settings.businessName ?? site.name}
Email: ${settings.businessEmail ?? 'Not set'}

## Design Tokens
${JSON.stringify(site.designTokens ?? {}, null, 2)}

## Active Modules
${JSON.stringify(site.activeModules ?? [], null, 2)}

---
Use the tools (getMedia, getSlots, createSlot, etc.) to interact with this site's content.
`.trim(),
      }],
    }
  }
)

// ── Start ─────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport()
await server.connect(transport)
console.error('AxolotCMS MCP server running — site:', getSiteId() || '(no site set)')
