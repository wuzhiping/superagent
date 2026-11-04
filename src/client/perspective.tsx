/**
 * The panel's perspective: the same deployment, read from the PM's seat or from a post's seat.
 *
 * A perspective changes **only what the panel shows and where it starts** — the tabs, the settings groups, the
 * overview, and how much of the project archive is in view. The host, the sources, the policy, the tickets and the
 * project archive itself stay exactly the same (RD.md §5: 岗位 is a seat, not a second brain).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

/** `pm` reads the deployment as the project manager; `post` reads it as one post doing its duties. */
export type Perspective = 'pm' | 'post'

const PERSPECTIVE_KEY = 'dsh-superagent/perspective'
const POST_KEY = 'dsh-superagent/post'

const read = <T extends string>(key: string, fallback: T, allowed: readonly T[]): T => {
  try {
    const value = localStorage.getItem(key) as T | null
    return value && allowed.includes(value) ? value : fallback
  } catch {
    return fallback
  }
}
const write = (key: string, value: string): void => {
  try { localStorage.setItem(key, value) } catch { /* A blocked storage keeps the current choice for this session. */ }
}

export interface PerspectiveState {
  perspective: Perspective
  setPerspective: (next: Perspective) => void
  /** The post the reader is, in the post perspective; empty until they choose. */
  postId: string
  setPostId: (next: string) => void
}

const PerspectiveContext = createContext<PerspectiveState | undefined>(undefined)

export function usePerspective(): PerspectiveState {
  const value = useContext(PerspectiveContext)
  if (!value) throw new Error('dsh-superagent page rendered outside its perspective')
  return value
}

/** Holds the chosen perspective and the chosen post; both survive a reload on this device. */
export function PerspectiveProvider({ children }: { children: ReactNode }) {
  const [perspective, setState] = useState<Perspective>(() => read(PERSPECTIVE_KEY, 'pm', ['pm', 'post']))
  const [postId, setStatePost] = useState<string>(() => read(POST_KEY, '', ['']))
  const setPerspective = useCallback((next: Perspective) => {
    setState(next)
    write(PERSPECTIVE_KEY, next)
  }, [])
  const setPostId = useCallback((next: string) => {
    setStatePost(next)
    write(POST_KEY, next)
  }, [])
  const value = useMemo(() => ({ perspective, setPerspective, postId, setPostId }), [perspective, setPerspective, postId, setPostId])
  return <PerspectiveContext.Provider value={value}>{children}</PerspectiveContext.Provider>
}

/** The posts the archive offers, used by the post perspective to let the reader say which post they are. */
export function postOptions (posts: { postId: string; name: string; role: 'pm' | 'worker' }[]): { postId: string; name: string; role: string }[] {
  return posts.map(post => ({ postId: post.postId, name: post.name, role: post.role }))
}

/** Forget the chosen perspective and post; used by the panel when the deployment changes under the reader. */
export function forgetPerspective(): void {
  try { localStorage.removeItem(PERSPECTIVE_KEY); localStorage.removeItem(POST_KEY) } catch { /* nothing to forget */ }
}

/** Warn when the stored post no longer exists in the archive, so the panel can fall back to the whole team. */
export function stalePost (postId: string, posts: { postId: string }[]): boolean {
  return !!postId && !posts.some(post => post.postId === postId)
}

/** Keep the stored post in sync with the archive without touching the reader's other choices. */
export function useStoredPost (posts: { postId: string }[]): void {
  const { postId, setPostId } = usePerspective()
  useEffect(() => {
    if (!postId || posts.some(post => post.postId === postId)) return
    setPostId(posts[0]?.postId ?? '')
  }, [postId, posts, setPostId])
}
