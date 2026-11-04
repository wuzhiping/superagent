/**
 * What this Host may do as a post: the KanEO account behind the API key and the management rights that come with it.
 *
 * Several Hosts play the posts of one KanEO project (RD.md §4). A worker post only needs to work the cards assigned to
 * its account; a PM post also manages the board's flow, publishes the charter and dispatches work. Those management
 * rights live in KanEO, not in this Host: the workspace admin may change the project's columns, a plain member may not.
 * The panel therefore asks KanEO who this Host is before it lets someone act as PM.
 */
import { z } from 'zod'
import { KaneoClient } from '../sources/kaneo-api.ts'

/** The account behind the deployment's KanEO key, and what that account may manage. */
export const CapabilitiesSchema = z.object({
  /** The KanEO account of this Host; its id is the post's identity on the board. */
  account: z.object({ id: z.string(), name: z.string(), role: z.string() }).nullable(),
  /** The workspaces the key can read. */
  workspaces: z.array(z.object({ id: z.string(), name: z.string() })),
  /** Whether this Host may act as PM: it needs the management rights on the board's flow. */
  canManageFlow: z.boolean(),
  /** The charter is a local document, so publishing it needs no KanEO rights. */
  canPublishCharter: z.boolean(),
  /** Why the management rights are missing, in words the panel can show. */
  reason: z.string().default(''),
})
export type Capabilities = z.infer<typeof CapabilitiesSchema>

/** The management rights a PM needs on the board's flow (the columns and their meaning). */
const managementRole = (role: string): boolean => role === 'admin' || role === 'owner'

/**
 * Reads the KanEO account of this Host and derives its capabilities. A deployment without a KanEO account answers with
 * no account and no management rights, rather than failing: the panel then explains what to configure.
 */
export async function readCapabilities (account: { baseUrl: string; apiKey: string } | undefined): Promise<Capabilities> {
  if (!account?.apiKey) {
    return {
      account: null, workspaces: [], canManageFlow: false, canPublishCharter: true,
      reason: 'This Host has no KanEO account yet; configure the KanEO Source to act as a post on the board.',
    }
  }
  const client = new KaneoClient(account)
  try {
    const [me, workspaces] = await Promise.all([
      client.me().catch(() => undefined),
      client.workspaces().catch(() => []),
    ])
    if (!me) {
      return {
        account: null, workspaces: workspaces.map(item => ({ id: item.id, name: item.name })),
        canManageFlow: false, canPublishCharter: true,
        reason: 'Kaneo did not answer who this Host is; the API key may be wrong or expired.',
      }
    }
    const canManageFlow = managementRole(me.role)
    return {
      account: { id: me.id, name: me.name, role: me.role },
      workspaces: workspaces.map(item => ({ id: item.id, name: item.name })),
      canManageFlow,
      canPublishCharter: true,
      reason: canManageFlow ? '' : `The KanEO account ${me.name} is a ${me.role}; managing the board's flow needs a workspace admin.`,
    }
  } catch (error) {
    return {
      account: null, workspaces: [], canManageFlow: false, canPublishCharter: true,
      reason: `Kaneo could not be reached: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}
