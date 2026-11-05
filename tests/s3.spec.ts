import { describe, expect, it, vi } from 'vitest'
import { parseListing, S3Client } from '../src/sources/s3-api.ts'
import { S3ConfigSchema, s3AccountOf } from '../src/sources/s3-config.ts'

const account = { endpoint: 'http://oss.feg.cn', bucket: 'ateam', accessKey: 'uid', secretKey: 'secret', region: 'us-east-1' }

/** Answers the one listing call the client makes, and remembers what was asked with which headers. */
function serveS3 (xml = '<ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>deliverables/a.md</Key></Contents></ListBucketResult>') {
  const calls: { url: string, headers: Record<string, string> }[] = []
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, headers: init?.headers as Record<string, string> })
    return new Response(xml, { status: 200 })
  })
  return { calls, fetchImpl }
}

describe('s3 client: one signed path-style request', () => {
  it('signs the request with SigV4 and reads the bucket', async () => {
    const { calls, fetchImpl } = serveS3()
    const listing = await new S3Client(account, fetchImpl as unknown as typeof fetch).listObjects({ prefix: 'deliverables/', max: 5, recursive: true })
    expect(listing.keys).toEqual(['deliverables/a.md'])
    const call = calls[0]!
    expect(call.url).toContain('/ateam?list-type=2&max-keys=5&prefix=deliverables%2F&delimiter=')
    const authorization = call.headers.authorization ?? call.headers.Authorization
    expect(authorization).toContain('AWS4-HMAC-SHA256 Credential=uid/')
    expect(authorization).toContain('/us-east-1/s3/aws4_request')
    expect(authorization).toMatch(/Signature=[0-9a-f]{64}$/)
    expect(call.headers['x-amz-content-sha256'] ?? call.headers['X-Amz-Content-Sha256']).toBeDefined()
    expect(call.headers['x-amz-date'] ?? call.headers['X-Amz-Date']).toBeDefined()
  })

  it('reports a readable bucket in the probe', async () => {
    const { fetchImpl } = serveS3()
    const detail = await new S3Client(account, fetchImpl as unknown as typeof fetch).probe()
    expect(detail).toContain('ateam')
    expect(detail).toContain('1 object')
  })

  it('lists buckets from the account listing', async () => {
    const { fetchImpl } = serveS3('<ListAllMyBucketsResult><Buckets><Bucket><Name>ateam</Name></Bucket><Bucket><Name>dsh</Name></Bucket></Buckets></ListAllMyBucketsResult>')
    const names = await new S3Client(account, fetchImpl as unknown as typeof fetch).listBuckets()
    expect(names).toEqual(['ateam', 'dsh'])
  })

  it('follows the region a refused signature names and retries once', async () => {
    const calls: { url: string, authorization: string }[] = []
    let first = true
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>
      calls.push({ url, authorization: headers.authorization ?? '' })
      if (first) {
        first = false
        return new Response('<Error><Code>AuthorizationHeaderMalformed</Code><Message>expecting \'us-west-rack-2\'</Message></Error>', { status: 400 })
      }
      return new Response('<ListBucketResult><Key>a</Key></ListBucketResult>', { status: 200 })
    })
    const listing = await new S3Client({ ...account, region: '' }, fetchImpl as unknown as typeof fetch).listObjects({ max: 1 })
    expect(listing.keys).toEqual(['a'])
    expect(calls).toHaveLength(2)
    expect(calls[1]!.authorization).toContain('/us-west-rack-2/s3/aws4_request')
  })

  it('parses keys, entities and truncation', () => {
    expect(parseListing('<IsTruncated>true</IsTruncated><Key>a&amp;b</Key><Key>c</Key>'))
      .toEqual({ keys: ['a&b', 'c'], truncated: true })
  })
})

describe('s3 config: the card may override the storage record', () => {
  it('requires every field when no record is cached', () => {
    expect(s3AccountOf(S3ConfigSchema.parse({}))).toBeUndefined()
    expect(s3AccountOf(S3ConfigSchema.parse({ endpoint: account.endpoint, bucket: 'ateam', accessKey: 'uid', secretKey: 'secret' })))
      .toMatchObject({ bucket: 'ateam', region: '' })
  })

  it('keeps empty fields for the storage record to fill', () => {
    const config = S3ConfigSchema.parse({ endpoint: '', bucket: '', accessKey: '', secretKey: '' })
    expect(config).toMatchObject({ endpoint: '', bucket: '', accessKey: '', secretKey: '', pollSeconds: 300 })
  })
})
