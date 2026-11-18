// The watch's reads that need only a fetcher: a published file hashed, and a locked peer observed (its network
// definition, its links.json and its signer kid). Pure: no node:* import, so the CLI's watch and its --init capture
// (src/watch, through safeFetch) and the Desk's drift reader (site/drift.js, through the page's fetcher) ask a peer the
// same things in the same order, and decide.ts says what the answers mean. scripts/build-site.mjs copies it into
// site/lib/plumbline/watch/, where the Desk's partner pin check (site/site.js) can read a partner through it too.
//
// What a driver injects: the fetcher, its fetch options, the sentence for a fetch error (`why`; the Desk words a
// browser's "network" failure as the browser refusing to read it), and for the Desk a `guard` that holds the network
// file a peer's manifest names to the address rule before it is fetched (decide.ts destinationProblem). The CLI needs
// no guard: safeFetch refuses those addresses itself.

import { LINKS_FILE, PEER_LINKS_ABSENT, SIGNATURE_FILE } from "../core/types.js";
import { hashBytes } from "../net/canonical.js";
import { describeFetchError, type SafeFetchOptions } from "../net/fetch-types.js";
import { locatePeerFile, type Fetcher } from "../net/locate.js";
import { readSignatureKid, type LinksRead, type Observed, type PeerObservation, type SignatureRead } from "./decide.js";
import { peerOutline } from "./outline.js";

/** A sentence for the parentheses after "could not be fetched", naming why a fetch failed. */
export type Describe = (error: unknown) => string;

/** The watch's default: the shared table in net/fetch-types. */
export const describeWatchError: Describe = (error) => describeFetchError(error, "it could not be read");

export interface ObserveOptions {
  /** Passed to every fetch. */
  fetchOptions?: SafeFetchOptions;
  /** Default describeWatchError. */
  why?: Describe;
}

/**
 * One published document, hashed over its exact bytes: decide.ts's Observed shape. A 404 or 410 is `missing` (the file
 * is not published); any other failure is a sentence completing "it ...".
 */
export async function observePublished(fetcher: Fetcher, url: string, options: ObserveOptions = {}): Promise<Observed> {
  const why = options.why ?? describeWatchError;
  let response;
  try {
    response = await fetcher(url, options.fetchOptions ?? {});
  } catch (error) {
    return { ok: false, missing: false, sentence: `could not be fetched (${why(error)})` };
  }
  if (response.status === 404 || response.status === 410) return { ok: false, missing: true, sentence: `is not published (HTTP ${response.status})` };
  if (!response.ok) return { ok: false, missing: false, sentence: `could not be fetched (HTTP ${response.status})` };
  return { ok: true, sha256: await hashBytes(response.bytes), bytes: response.bytes };
}

/**
 * The state of a peer's `links.json` at its site base: the SHA-256 of its exact bytes, or PEER_LINKS_ABSENT when the
 * peer answers 404 or 410. The runtime fetches it for every peer network it loads and lays it over that network's
 * links, so it is as much the peer's code as its network definition.
 */
export async function readPeerLinks(fetcher: Fetcher, base: string, options: ObserveOptions = {}): Promise<LinksRead> {
  const why = options.why ?? describeWatchError;
  let response;
  try {
    response = await fetcher(`${base}${LINKS_FILE}`, options.fetchOptions ?? {});
  } catch (error) {
    return { problem: `could not be fetched (${why(error)})` };
  }
  if (response.status === 404 || response.status === 410) return { state: PEER_LINKS_ABSENT };
  if (!response.ok) return { problem: `answered HTTP ${response.status}` };
  return { state: await hashBytes(response.bytes) };
}

/** A peer's signer kid at its site base, by the one rule init and every watch share (decide.ts readSignatureKid). */
export async function readPeerKid(fetcher: Fetcher, base: string, options: ObserveOptions = {}): Promise<SignatureRead> {
  const why = options.why ?? describeWatchError;
  try {
    const sig = await fetcher(`${base}${SIGNATURE_FILE}`, options.fetchOptions ?? {});
    return readSignatureKid({ status: sig.status, text: sig.ok ? sig.text() : "" });
  } catch (error) {
    return readSignatureKid({ error: why(error) });
  }
}

export interface PeerObserveOptions extends ObserveOptions {
  /** Read links.json too: true when the lock records it (a watch), and always when a lock is being written. */
  links: boolean;
  /**
   * Why the network file the peer's manifest names must not be fetched, or null. Checked before that fetch; a refusal
   * is `definition.refused` and nothing more is asked of the peer.
   */
  guard?: (fileUrl: string) => string | null;
}

/**
 * What a driver sees of one peer now, in decide.ts's PeerObservation shape: its network definition (located through
 * the peer's manifest, net/locate.ts), then its links.json when asked, then its signer kid. A definition that cannot
 * be read ends the observation: the signature is reported as none and links.json is not asked.
 */
export async function observePeer(url: string, fetcher: Fetcher, options: PeerObserveOptions): Promise<PeerObservation> {
  const why = options.why ?? describeWatchError;
  const fetchOptions = options.fetchOptions ?? {};
  let located;
  let response;
  try {
    located = await locatePeerFile(url, fetcher, fetchOptions);
    const refused = options.guard?.(located.fileUrl) ?? null;
    if (refused !== null) return { definition: { ok: false, refused }, signature: { none: true } };
    response = await fetcher(located.fileUrl, fetchOptions);
  } catch (error) {
    return { definition: { ok: false, reason: why(error) }, signature: { none: true } };
  }
  if (!response.ok) return { definition: { ok: false, status: response.status }, signature: { none: true } };
  const sha256 = await hashBytes(response.bytes);
  // the definition in outline (outline.ts), so a change can be said in counts; null when it cannot be outlined
  const outline = await peerOutline(response.bytes);
  const links = options.links ? await readPeerLinks(fetcher, located.base, options) : undefined;
  const signature = await readPeerKid(fetcher, located.base, options);
  return { definition: { ok: true, sha256, outline }, ...(links !== undefined ? { links } : {}), signature };
}
