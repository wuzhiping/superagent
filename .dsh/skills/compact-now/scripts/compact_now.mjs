#!/usr/bin/env node
/**
 * Run the DSH `/compact` slash command against the local dsh web host.
 *
 * `/compact` is a human-facing client command, and the host refuses to compact
 * while a turn is open ("the agent is not idle"). This script speaks the same
 * wire protocol the web client uses, so it can be fired from a background job
 * right after a task turn ends.
 *
 * Protocol (see @deepseek-ai/dsh-client-connection + @deepseek-ai/dsh-api-gateway):
 *   POST http://<authority>/api/commands/execute
 *   body: { type: "client-request", rpcId, method: "commands/execute",
 *           payload: { args: { agentId, line, submittedAttachments } } }
 *   auth: signed browser-session cookie minted from the local credential store
 *         (DSH_HOME/.credentials.yaml -> client-connection/browser-session).
 *
 * Usage:
 *   node compact_now.mjs [--url http://127.0.0.1:3080] [--session <sessionId>]
 *                         [--wait <seconds>] [--retries <n>] [--interval <seconds>]
 */

import { createHash, createHmac, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const args = process.argv.slice(2)

function option(name, fallback) {
	const index = args.indexOf(`--${name}`)
	if (index === -1 || index === args.length - 1) return fallback
	return args[index + 1]
}

const baseUrl = (option('url', process.env.DSH_WEB_URL ?? 'http://127.0.0.1:3080')).replace(/\/+$/, '')
const sessionId = option('session', process.env.DSH_SESSION_ID ?? '')
const waitSeconds = Number(option('wait', '0'))
const maxRetries = Number(option('retries', '1'))
const intervalSeconds = Number(option('interval', '10'))

const authority = new URL(baseUrl).host
const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')

/** Read the browser-session signing secret from the local credential store. */
function readSigningSecret() {
	const path = join(dshHome, '.credentials.yaml')
	const yaml = readFileSync(path, 'utf8')
	const block = yaml.match(/client-connection\/browser-session:[\s\S]*?(?=\n\S|$)/)
	if (block === null) throw new Error(`no client-connection/browser-session record in ${path}`)
	const secret = block[0].match(/^\s*secret:\s*['"]?([A-Za-z0-9_-]+)['"]?\s*$/m)
	if (secret === null) throw new Error(`browser-session record in ${path} has no secret`)
	return Buffer.from(secret[1], 'base64url')
}

/** Mint a signed browser-session cookie for this authority. */
function sessionCookie(secret) {
	const name = `dsh-auth-${createHash('sha256').update(authority).digest('base64url')}`
	const now = Date.now()
	const payload = {
		version: 1,
		authority,
		issuedAt: now - 1000,
		expiresAt: now + 30 * 24 * 60 * 60 * 1000,
	}
	const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
	const signature = createHmac('sha256', secret).update(body).digest('base64url')
	return `${name}=v1.${body}.${signature}`
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Execute one `/compact` command line and return the host's outcome text. */
async function compactOnce() {
	const rpcId = randomUUID()
	const request = {
		type: 'client-request',
		rpcId,
		method: 'commands/execute',
		payload: {
			args: {
				agentId: sessionId,
				line: '/compact',
				submittedAttachments: [],
			},
		},
	}
	const response = await fetch(`${baseUrl}/api/commands/execute`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			cookie: sessionCookie(readSigningSecret()),
		},
		body: JSON.stringify(request),
	})
	const text = await response.text()
	if (!response.ok) return { ok: false, text: `HTTP ${response.status}: ${text.slice(0, 200)}` }
	let envelope
	try {
		envelope = JSON.parse(text)
	} catch {
		return { ok: false, text: `unparsable response: ${text.slice(0, 200)}` }
	}
	const result = envelope?.result
	if (result?.ok === true) {
		const value = result.value
		return { ok: true, text: value?.text ?? JSON.stringify(value) }
	}
	const error = result?.error
	return { ok: false, text: `${error?.code ?? 'unknown'}: ${error?.message ?? text.slice(0, 200)}` }
}

async function main() {
	if (sessionId === '') throw new Error('no session id (pass --session or set DSH_SESSION_ID)')
	if (waitSeconds > 0) await sleep(waitSeconds * 1000)
	for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
		let outcome
		try {
			outcome = await compactOnce()
		} catch (error) {
			outcome = { ok: false, text: error instanceof Error ? error.message : String(error) }
		}
		const busy = outcome.text.includes('not idle') || outcome.text.includes('active compaction')
		if (outcome.ok && !busy) {
			console.log(`[compact-now] ${outcome.text}`)
			return
		}
		if (busy) {
			console.log(`[compact-now] attempt ${attempt + 1}: session busy, retrying in ${intervalSeconds}s`)
		} else {
			console.log(`[compact-now] attempt ${attempt + 1} failed: ${outcome.text}`)
		}
		if (attempt < maxRetries) await sleep(intervalSeconds * 1000)
	}
	console.log('[compact-now] gave up without compacting')
	process.exitCode = 1
}

await main()
