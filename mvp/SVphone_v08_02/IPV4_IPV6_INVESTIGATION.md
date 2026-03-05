# IPv4 ↔ IPv6 Call Connection Investigation

## Problem

Cable connection (IPv4) calling mobile phone (IPv6): call signal sent and received, answer signal sent and received, but WebRTC P2P connection never completes (ICE fails/times out).

## SVphone Design Constraint

No servers in the middle. No STUN, no TURN. Pure P2P. The public IP of each peer is embedded directly in the call signal (OP_RETURN binary tokenAttributes field `senderIp`).

## How ICE Candidate Synthesis Works in SVphone

Instead of STUN, SVphone uses `_buildPublicIpCandidates()` in `peer_connection.js`. After receiving the remote SDP, it:

1. Parses `typ host` candidates from the SDP to extract local IP:port pairs
2. Pairs each host candidate with the known public IP (from the call signal's `senderIp`)
3. Synthesizes a `typ srflx` candidate: "reach me at [publicIp]:[hostPort] via [hostIp]:[hostPort]"
4. Injects these synthetic candidates via `addIceCandidate()`

**This only works when host candidate IP version matches public IP version (both IPv4 or both IPv6).**

## Root Cause of IPv4↔IPv6 Failure

`_buildPublicIpCandidates()` in `peer_connection.js` lines ~412-426 explicitly skips cross-family combinations:

```js
if (isIpv6Host) continue       // IPv6 host + any public IP → skip
if (isIpv6Public) continue     // IPv4 host + IPv6 public IP → skip (version mismatch)
```

Result: when one peer is IPv4 and the other is IPv6, **zero synthetic candidates are produced** on both sides. ICE has only local host candidates which can't cross NAT or address-family boundaries → connection fails.

There are no STUN servers as fallback.

## Network Physics

An IPv4-only device and an IPv6-only device **cannot communicate directly** — there is no common protocol. A relay or NAT64 translator is required at the network level.

| Scenario | Works? | Reason |
|---|---|---|
| IPv4 cable ↔ IPv4 cable | ✓ | Synthetic srflx works both sides |
| IPv6 mobile ↔ IPv6 mobile | ✓ | IPv6 host candidates are globally routable |
| IPv4 cable ↔ dual-stack mobile | ✓ maybe | Mobile has IPv4 host candidate + IPv4 public IP |
| IPv4-only ↔ IPv6-only | ✗ | No common protocol, no relay |

## Mobile Network Reality

Most mobile LTE/5G networks are one of two configurations:

**A) Dual-stack** — device gets both `10.x.x.x` (IPv4 via CGNAT) AND `2001::x` (IPv6). Browser gathers candidates for both. If `senderIp` is IPv4, synthesis works and the call connects.

**B) IPv6-only with NAT64** — device gets ONLY an IPv6 address. No IPv4 host candidates appear in the SDP at all. Detected public IP is IPv6. An IPv4-only cable peer has nothing to connect to.

## Information Needed (Next Test Session)

When testing cable (IPv4) → mobile (IPv6), capture from the **mobile browser console**:

1. **What is `myIp` on the mobile?** Look for:
   ```
   [SUCCESS] ✓ Public IP: xxx.xxx.xxx.xxx
   ```
   Is it IPv4 (e.g. `82.66.x.x`) or IPv6 (e.g. `2001:db8::1`)?

2. **What host candidates are in the mobile's SDP?** Look for lines like:
   ```
   [PeerConnection] Built N public-IP candidates for xxx.xxx.xxx.xxx
   ```
   If N=0 and the public IP is IPv6, mobile is likely IPv6-only.

3. **What ICE connection state does the mobile reach?** Look for:
   ```
   [PeerConnection] ICE connection state: ... checking
   [PeerConnection] ICE connection state: ... failed
   ```

4. **Are there any IPv4 host candidates in the mobile's SDP offer/answer?** (Advanced) In browser devtools → Application → any logged SDP containing `a=candidate` lines with IPv4 addresses.

## Possible Fixes (Within Serverless Constraint)

### Fix A — Dual-stack IP detection at startup (recommended if mobile is dual-stack)

Detect and embed BOTH a public IPv4 AND public IPv6 address in the call signal. Currently only one IP is sent. With both:
- `_buildPublicIpCandidates` can pair IPv4 host candidates with the IPv4 public IP ✓
- `_buildPublicIpCandidates` can pair IPv6 host candidates with the IPv6 public IP ✓

Implementation: at app startup, make two parallel IP detection requests — one that resolves over IPv4, one over IPv6. Embed both in `senderIp` (would require extending the binary token format or using a second field).

Files to change:
- `src/phone-controller.js` — detect both IPs at startup
- `src/sv_connect/call_token.js` — extend binary format to carry both IPs
- `src/sv_connect/peer_connection.js` — `_buildPublicIpCandidates` accepts array of public IPs

### Fix B — Accept limitation for strict IPv6-only mobile

If the mobile is IPv6-only with NAT64 (no IPv4 stack at all), there is no serverless fix. Document as a known limitation: "Direct P2P requires at least one common IP version between peers."

## Current State of v08.02

All other call signaling is working as of 2026-03-05:
- OP_RETURN binary format call signaling ✓ (replaced ordinal inscriptions)
- SDP encoding/decoding ✓ (RTCSessionDescription object extraction fixed)
- Caller setRemoteDescription ✓ (answer SDP passed as plain string)
- Dust output fix ✓ (0-sat change output omitted)
- Double-accept prevention ✓ (incoming call UI hidden immediately on Accept)
- Outgoing ring starts immediately on call ✓
- Incoming ring stops immediately on Accept ✓
- IPv4↔IPv4 calls working ✓
- IPv4↔IPv6 calls: under investigation

## Key Files

| File | Role |
|---|---|
| `src/sv_connect/peer_connection.js` | `_buildPublicIpCandidates()` — ICE synthesis |
| `src/sv_connect/call_manager.js` | Injects caller's IP candidates after answer (lines ~229-237) |
| `src/phone-controller.js` | Injects callee's IP candidates after setRemoteDescription (lines ~317-326) |
| `src/sv_connect/call_token.js` | Binary encode/decode — `senderIp` field |
| `src/token_protocol/tokenBuilder.ts` | `createCallSignalTx()` — broadcasts call/answer signal |
