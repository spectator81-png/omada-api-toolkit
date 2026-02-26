# Pitfalls & Undocumented Behavior

Hard-won lessons from reverse-engineering the Omada Controller Web API v2. Each one cost us hours — so you don't have to.

## 1. `protocols: []` Does Not Mean "All Protocols"

You might assume an empty array means "match everything". It doesn't — the behavior is undefined and varies by controller version. **Always specify protocols explicitly:**

```javascript
// BAD — unreliable
protocols: []

// GOOD — explicit TCP + UDP + ICMP
protocols: [6, 17, 1]

// Protocol numbers:
// 6  = TCP
// 17 = UDP
// 1  = ICMP
```

## 2. PATCH Requires the Full Payload

Unlike REST conventions, the Omada Controller **does not support partial updates**. If you send only the fields you want to change, the missing fields get reset to defaults.

```javascript
// WRONG — will wipe all other settings
await omada.apiCall('PATCH', '/setting/service/mdns/RULE_ID', {
  status: false,
});

// CORRECT — GET first, modify, then PATCH with everything
const existing = await omada.apiCall('GET', '/setting/service/mdns');
const rule = existing.result.data[0];
rule.status = false;
await omada.apiCall('PATCH', `/setting/service/mdns/${rule.id}`, rule);
```

## 3. Self-Signed SSL Certificate

The Omada Controller (especially hardware controllers like OC220) uses a self-signed HTTPS certificate. Node.js will reject the connection by default.

```bash
# Option A: Environment variable (recommended)
export NODE_TLS_REJECT_UNAUTHORIZED=0

# Option B: In code (set before any requests)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
```

**Note:** This disables certificate verification for the entire Node.js process. In production, consider importing the controller's certificate instead.

## 4. Source and Destination Cannot Be Identical

The controller silently rejects ACL rules where `sourceIds` and `destinationIds` contain the same network ID. No error message — the rule just doesn't get created.

```javascript
// FAILS SILENTLY — same network in source and destination
{
  sourceIds: ['NETWORK_ID_A'],
  destinationIds: ['NETWORK_ID_A', 'NETWORK_ID_B'],
}

// WORKS — filter out the source network
const allNetworks = [ID_A, ID_B, ID_C, ID_D];
const sourceId = ID_A;
const destinations = allNetworks.filter(id => id !== sourceId);
```

## 5. Session Expires After ~30 Minutes

The `TPOMADA_SESSIONID` cookie and CSRF token expire after approximately 30 minutes of inactivity. Error code: `-1`.

```javascript
// For long-running scripts, re-authenticate periodically
try {
  const result = await omada.apiCall('GET', '/devices');
} catch (e) {
  // Session expired — reconnect
  await omada.connect();
  const result = await omada.apiCall('GET', '/devices');
}
```

## 6. Token Must Be Sent in Two Places

The CSRF token must be included **both** as a header and as a URL parameter. Missing either one results in a redirect to the login page (HTML response instead of JSON).

```
Header:    Csrf-Token: {token}
URL param: ?token={token}
```

The `omada-api-helper.js` handles this automatically, but if you're building your own client, don't forget either one.

## 7. `type` Has Different Meanings in Different Contexts

In the **URL query parameter** `?type=...`:
- `gateway` or `0` = Gateway/router-level ACL
- `switch` = Switch-level ACL
- `eap` = Access point-level ACL

In the **request body** `type: 0`:
- `0` = Gateway ACL (the only observed value for gateway rules)

Don't confuse the two — the query parameter selects which ACL table to operate on, the body field describes the rule type.

## 8. All List Endpoints Require Pagination

Every GET endpoint that returns a list **requires** pagination parameters. Omitting them may return empty results or errors.

```javascript
// BAD — may return nothing
await omada.apiCall('GET', '/setting/lan/networks');

// GOOD — always include pagination
await omada.apiCall('GET', '/setting/lan/networks?currentPage=1&currentPageSize=100');
```

## 9. Port-Based Filtering Requires IP/Port Groups

Gateway ACLs **cannot filter by port directly**. You can only filter by protocol (TCP/UDP/ICMP). To create port-specific rules:

1. Create an **IP/Port Group** first (via the web UI or API)
2. Reference it using `destinationType: 2` and the group ID in `destinationIds`

```javascript
// Gateway ACL with IP/Port Group target
{
  sourceType: 0,                        // 0 = Network
  sourceIds: ['YOUR_SOURCE_NETWORK_ID'],
  destinationType: 2,                   // 2 = IP/Port Group
  destinationIds: ['YOUR_IPGROUP_ID'],  // References the group
  // ...
}
```

IP/Port Group creation (observed from DevTools):

```javascript
// POST /setting/firewall/ipGroups
{
  "name": "AirPlay-Ports",
  "type": 1,                           // 1 = IP/Port Group
  "ipList": [
    {
      "ip": "192.168.40.0/24",         // Target subnet
      "portList": ["7000-7100", "5353"] // Port ranges as strings
    }
  ]
}
```

**Important:** `portList` values are **strings**, not numbers. Port ranges use a hyphen: `"7000-7100"`.

## 10. Old API Format vs. New API Format

The API payload structure changed between controller versions. If you find old tutorials or scripts, they may use the **legacy format** which no longer works:

```javascript
// OLD FORMAT (pre-5.x) — DOES NOT WORK on 6.x
{
  srcType: 4,
  srcNetworkId: '...',
  dstType: 4,
  dstNetworkId: '...',
  direction: 0,
}

// NEW FORMAT (5.x / 6.x) — USE THIS
{
  sourceType: 0,
  sourceIds: ['...'],           // Array, not single value
  destinationType: 0,
  destinationIds: ['...'],      // Array, not single value
  direction: {                  // Object, not integer
    lanToWan: false,
    lanToLan: true,
    wanInIds: [],
    vpnInIds: [],
  },
}
```

Key changes:
- `srcType` → `sourceType`, `dstType` → `destinationType`
- Single ID → Array of IDs (`sourceIds`, `destinationIds`)
- `direction: 0` → `direction: { lanToLan: true, ... }`
- Type value `4` → `0` for networks

## 11. Rate Limiting

While there's no documented rate limit, rapid-fire requests can cause the controller to become unresponsive (especially hardware controllers like OC220). Add a small delay between sequential API calls:

```javascript
for (const rule of rules) {
  await omada.apiCall('POST', '/setting/firewall/acls', rule);
  await new Promise(resolve => setTimeout(resolve, 200)); // 200ms pause
}
```

## 12. ACL Rule Order Matters

Gateway ACL rules are evaluated **top to bottom, first match wins**. The `index` field in the API response indicates the rule's position. When creating rules, they're appended at the end by default.

**Best practice:** Create ALLOW rules first, then DENY rules. The controller doesn't provide an API to reorder rules after creation (you'd have to delete and recreate them).
