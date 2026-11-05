/**
 * Minimal S3 client for the MinIO Source card: AWS Signature V4 over one path-style request, with a timeout and bounded
 * retries. It reads (list buckets, list one page of objects) so the card can prove the store is reachable; the
 * deliverables themselves are written from the Executor Sessions' `minio_*` tools.
 */
import { createHash, createHmac } from 'node:crypto'
import type { S3Account } from './s3-config.ts'

const TIMEOUT_MS = 20_000
const RETRIES = 2
export type S3Fetch = (input: string, init?: RequestInit) => Promise<Response>

/** An S3 HTTP failure; `status` is the response status when the server answered. */
export class S3Error extends Error {
  constructor (message: string, readonly status?: number) { super(message); this.name = 'S3Error' }
}

const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex')
const hmac = (key: Buffer | string, data: string): Buffer => createHmac('sha256', key).update(data).digest()

/** One page of an object listing: the object keys and whether more pages exist. */
export interface S3Listing {
  keys: string[]
  truncated: boolean
}

/** The keys in one `<ListBucketResult>`; enough for a health probe without an XML dependency. */
export function parseListing (xml: string): S3Listing {
  const keys = [...xml.matchAll(/<Key>([\s\S]*?)<\/Key>/g)].map(match => decodeXml(match[1] ?? ''))
  const truncated = /<IsTruncated>\s*true\s*<\/IsTruncated>/i.test(xml)
  return { keys, truncated }
}

const decodeXml = (text: string): string => text
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

/** A small S3 client; tests substitute `fetch` and the retry clock. */
export class S3Client {
  constructor (private readonly account: S3Account,
    private readonly fetchImpl: S3Fetch = (input, init) => fetch(input, init),
    private readonly wait: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms))) {}

  /** The region the server wants, once an answer named it; the account may also name one. */
  private resolvedRegion?: string

  /**
   * Signs and sends one request; 429 and 5xx retry, other failures surface `S3Error`. A `400` that names the region
   * the server expects is not a failure: the client takes that region and sends the request again once.
   */
  private async send (method: 'GET', path: string, query: Record<string, string> = {}, attempt = 1, probed = false): Promise<string> {
    const url = new URL(`${this.account.endpoint.replace(/\/+$/, '')}${path}`)
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
    const now = new Date()
    const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
    const dateStamp = amzDate.slice(0, 8)
    const region = this.resolvedRegion || this.account.region || 'us-east-1'
    const scope = `${dateStamp}/${region}/s3/aws4_request`
    const payloadHash = sha256('')
    const canonicalQuery = [...url.searchParams.entries()]
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&')
    const headers: Record<string, string> = { host: url.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate }
    const signedHeaders = Object.keys(headers).sort().join(';')
    const canonicalHeaders = Object.keys(headers).sort().map(name => `${name}:${headers[name]}\n`).join('')
    const canonicalRequest = [method, url.pathname, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n')
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n')
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${this.account.secretKey}`, dateStamp), region), 's3'), 'aws4_request')
    const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex')
    const authorization = `AWS4-HMAC-SHA256 Credential=${this.account.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
    let lastError: unknown
    try {
      const response = await this.fetchImpl(url.toString(), {
        method, headers: { ...headers, authorization }, signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      const body = await response.text()
      if (response.ok) return body
      const expected = /expecting\s+(?:&#39;|&quot;|['"])([a-z0-9-]+)/i.exec(body)?.[1]
      if (response.status === 400 && expected && !probed && expected !== region) {
        this.resolvedRegion = expected
        return this.send(method, path, query, attempt, true)
      }
      const error = new S3Error(`S3 ${method} ${url.pathname} answered ${response.status}: ${body.slice(0, 200)}`, response.status)
      if (!(response.status === 429 || response.status >= 500) || attempt >= RETRIES) throw error
      lastError = error
      await this.wait(500 * attempt)
    } catch (caught) {
      if (caught instanceof S3Error && attempt < RETRIES && (caught.status === 429 || (caught.status ?? 0) >= 500)) {
        lastError = caught
        await this.wait(500 * attempt)
      } else {
        if (attempt >= RETRIES) throw caught
        lastError = caught
        await this.wait(500 * attempt)
      }
    }
    if (attempt < RETRIES) return this.send(method, path, query, attempt + 1)
    throw lastError instanceof Error ? lastError : new S3Error(String(lastError))
  }
  /** `GET /` — every bucket the account can see, by name. */
  async listBuckets (): Promise<string[]> {
    const xml = await this.send('GET', '/')
    return [...xml.matchAll(/<Name>([\s\S]*?)<\/Name>/g)].map(match => decodeXml(match[1] ?? ''))
  }

  /** `GET /{bucket}?list-type=2` — one page of the bucket's objects under `prefix`. */
  async listObjects (options: { prefix?: string, max?: number, recursive?: boolean } = {}): Promise<S3Listing> {
    const query: Record<string, string> = { 'list-type': '2', 'max-keys': String(options.max ?? 20) }
    if (options.prefix) query.prefix = options.prefix
    if (options.recursive) query.delimiter = ''
    return parseListing(await this.send('GET', `/${encodeURIComponent(this.account.bucket)}`, query))
  }

  /** Whether the bucket named on the card can be read: the health probe. */
  async probe (): Promise<string> {
    const listing = await this.listObjects({ max: 5, recursive: true })
    return `${this.account.bucket}: ${listing.keys.length} object(s) readable${listing.keys.length ? `, first ${listing.keys[0]}` : ''}`
  }
}
