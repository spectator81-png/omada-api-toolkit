# Omada API Toolkit

**Unofficial Node.js client and documentation for the TP-Link Omada Controller Web API v2.**

The Omada Controller has a powerful internal API that drives its web UI — but TP-Link doesn't document it. This toolkit provides a zero-dependency Node.js client and comprehensive endpoint documentation, all reverse-engineered from browser DevTools and real-world usage.

Tested on **OC220 hardware controller** (firmware 5.x / 6.1.x). Software controller and other hardware versions not yet verified — PRs welcome!

## Why This Exists

If you've tried to automate your Omada setup, you've probably hit these walls:

- The official OpenAPI v1 **doesn't cover** VLANs, SSIDs, firewall rules, mDNS, or port profiles
- The internal Web API v2 is **completely undocumented**
- The auth flow uses a quirky **triple-auth** mechanism (Controller ID + CSRF token + session cookie)
- Payload structures are **not guessable** — one wrong field and you get cryptic errors

This toolkit gives you everything you need to automate your Omada Controller programmatically.

## Quick Start

```bash
git clone https://github.com/spectator81-png/omada-api-toolkit.git
cd omada-api-toolkit

# Set your controller credentials
export OMADA_URL="https://192.168.x.x"    # Your controller IP
export OMADA_USER="admin"
export OMADA_PASS="your-password"

# Disable SSL verification (self-signed cert)
export NODE_TLS_REJECT_UNAUTHORIZED=0

# Run the demo (lists devices, networks, ACLs)
node omada-api-helper.js
```

No `npm install` needed — zero external dependencies.

## Authentication Flow

The Omada Web API v2 uses a 3-step authentication:

```
Step 1: GET /api/info
        → Returns controllerId (omadacId)

Step 2: POST /{controllerId}/api/v2/login
        Body: { "username": "admin", "password": "..." }
        → Returns CSRF token
        → Sets TPOMADA_SESSIONID cookie

Step 3: GET /{controllerId}/api/v2/sites?token={token}
        → Returns siteId

All subsequent requests require:
  - Header:    Csrf-Token: {token}
  - Cookie:    TPOMADA_SESSIONID={value}
  - URL param: ?token={token}
```

The helper handles all of this automatically:

```javascript
const omada = require('./omada-api-helper.js');
await omada.connect();

// Now make any API call
const networks = await omada.apiCall('GET', '/setting/lan/networks?currentPage=1&currentPageSize=100');
console.log(networks.result.data);
```

## What's Included

| File | Description |
|------|-------------|
| [`omada-api-helper.js`](omada-api-helper.js) | Zero-dependency Node.js API client with auth flow, cookie jar, and helper methods |
| [`API-REFERENCE.md`](API-REFERENCE.md) | Complete endpoint documentation with exact payloads for ACLs, VLANs, SSIDs, mDNS, switch ports, port profiles, AP radio/channel config |
| [`PITFALLS.md`](PITFALLS.md) | 19 common mistakes and undocumented behavior that will save you hours |
| [`examples/`](examples/) | Ready-to-use scripts for common tasks |

## Common Operations

### List all VLANs

```javascript
const omada = require('./omada-api-helper.js');
await omada.connect();
const networks = await omada.getNetworks();
networks.result.data.forEach(n => {
  console.log(`${n.name} — VLAN ${n.vlanId}, ${n.subnet}/${n.cidr}`);
});
```

### Create a firewall rule (Gateway ACL)

```javascript
await omada.apiCall('POST', '/setting/firewall/acls', {
  name: 'Allow-HTTP-Trusted-to-IoT',
  status: true,
  policy: 1,                    // 1 = Permit, 0 = Deny
  protocols: [6],               // 6 = TCP
  sourceType: 0,                // 0 = Network
  sourceIds: ['YOUR_TRUSTED_NETWORK_ID'],
  destinationType: 0,
  destinationIds: ['YOUR_IOT_NETWORK_ID'],
  direction: {
    lanToWan: false,
    lanToLan: true,             // LAN-to-LAN rule
    wanInIds: [],
    vpnInIds: [],
  },
  type: 0,                      // 0 = Gateway ACL
  biDirectional: false,
  stateMode: 0,                 // 0 = Auto (stateful)
  ipSec: 0,
  syslog: false,
  customAclDevices: [],
  customAclOsws: [],
  customAclStacks: [],
});
```

### Create an SSID with VLAN assignment

```javascript
// First, get the WLAN group ID
const wlanGroups = await omada.getWlanGroups();
const wlanGroupId = wlanGroups.result.data[0].id;

// Get rate limit ID from existing config (needed for creation)
const existingSsids = await omada.getSsids(wlanGroupId);
const rateLimitId = existingSsids.result.data[0]?.rateLimit?.rateLimitId;

// Create SSID
await omada.createSsid(wlanGroupId, {
  name: 'MyNetwork',
  band: 3,                    // 2.4 + 5 GHz
  type: 0,
  guestNetEnable: false,
  security: 3,                // WPA2/WPA3 (do NOT use 2!)
  broadcast: true,
  vlanSetting: { mode: 1, customConfig: { vlanId: 10 } },
  pskSetting: {
    securityKey: 'your-wifi-password',
    encryptionPsk: 3, versionPsk: 2, gikRekeyPskEnable: false
  },
  rateLimit: { rateLimitId },
  ssidRateLimit: { rateLimitId },
  wlanScheduleEnable: false,
  macFilterEnable: false,
  rateAndBeaconCtrl: { rate2gCtrlEnable: false, rate5gCtrlEnable: false, rate6gCtrlEnable: false },
  wlanId: '', enable11r: false, pmfMode: 3,
  multiCastSetting: { multiCastEnable: true, arpCastEnable: true, filterEnable: false, ipv6CastEnable: true, channelUtil: 100 },
  wpaPsk: [2, 3], deviceType: 1,
  dhcpOption82: { dhcpEnable: false },
  greEnable: false, prohibitWifiShare: false, mloEnable: false
});
```

### Disable an SSID on a specific AP

```javascript
// Get AP config
const ap = await omada.getEap('AA-BB-CC-DD-EE-FF');
const overrides = ap.result.ssidOverrides;

// Disable "GuestNetwork" on this AP
overrides.forEach(o => {
  if (o.globalSsid === 'GuestNetwork') {
    o.enable = true;       // activate per-AP override
    o.ssidEnable = false;  // disable on this AP
  }
});

await omada.updateEap('AA-BB-CC-DD-EE-FF', { ssidOverrides: overrides });
```

### Set AP channel and TX power

```javascript
// Channel is set via freq (MHz), NOT the channel field!
// 2.4G: Ch1=2412, Ch6=2437, Ch11=2462
// 5G:   Ch36=5180, Ch52=5260, Ch100=5500, Ch132=5660
await omada.setEapChannel('AA-BB-CC-DD-EE-FF', 2437, 5260); // Ch6 + Ch52

// Set TX power and minimum RSSI for roaming
const ap = await omada.getEap('AA-BB-CC-DD-EE-FF');
await omada.updateEap('AA-BB-CC-DD-EE-FF', {
  radioSetting2g: { ...ap.result.radioSetting2g, txPower: 14 },  // Medium
  radioSetting5g: { ...ap.result.radioSetting5g, txPower: 28 },  // High
  rssiSetting2g: { rssiEnable: true, threshold: -75 },
  rssiSetting5g: { rssiEnable: true, threshold: -75 },
});
```

### Check mDNS reflector rules

```javascript
const mdns = await omada.apiCall('GET', '/setting/service/mdns');
mdns.result.data.forEach(rule => {
  console.log(`${rule.name} — active: ${rule.status}`);
  console.log(`  Service networks: ${rule.osg.serviceNetworks}`);
  console.log(`  Client networks:  ${rule.osg.clientNetworks}`);
});
```

## Top 5 Pitfalls

1. **`protocols: []` is unreliable** — Always set explicit protocols like `[6, 17, 1]` for TCP+UDP+ICMP
2. **PATCH needs the full payload** — GET first, modify, then PATCH with everything
3. **`security: 2` (WPA2-only) fails on SSID creation** — Use `security: 3` (WPA2/WPA3) instead
4. **Trunk profiles without native VLAN can't be assigned to ports** — Always include `nativeNetworkId`
5. **Device adoption often fails on first attempt** — Wait 10–30s and retry

See [PITFALLS.md](PITFALLS.md) for all 19 pitfalls with explanations.

## Discovering New Endpoints

The API is not fully documented by TP-Link. The best way to find new endpoints:

1. Open the Omada Controller web UI in your browser
2. Open DevTools (F12) → Network tab → filter by XHR
3. Perform the action you want to automate in the UI
4. Copy the request URL and JSON body from the Network tab
5. Use `omada.apiCall()` with the same method, path, and body

## Tested Hardware

- OC220 Hardware Controller (firmware 6.1.0.19)
- ER707-M2 Router/Firewall
- SG3428XMPP / SG2210XMP-M2 / TL-SG2210P Managed Switches
- EAP650 / EAP650-Outdoor Access Points

The API structure should be similar across Omada Controller versions 5.x and 6.x, but field names may vary between versions. Software controller (Windows/Linux) may use a different default port (8043 instead of 443). Not yet verified — PRs welcome!

## License

MIT
