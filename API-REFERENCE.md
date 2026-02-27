# API Reference — Omada Controller Web API v2

All endpoints are relative to the base URL:

```
https://{controllerIp}/{controllerId}/api/v2/sites/{siteId}
```

Every request must include:
- **Header:** `Csrf-Token: {token}`
- **Cookie:** `TPOMADA_SESSIONID={value}`
- **URL param:** `?token={token}` (append with `&token=` if other params exist)

---

## Authentication

These endpoints are called **before** obtaining the site ID.

### Get Controller Info

```
GET https://{controllerIp}/api/info
```

No authentication required.

**Response:**
```json
{
  "errorCode": 0,
  "result": {
    "omadacId": "YOUR_CONTROLLER_ID",
    "controllerVer": "6.1.0.19",
    "apiVer": "1.0",
    "type": 1
  }
}
```

### Login

```
POST https://{controllerIp}/{controllerId}/api/v2/login
Content-Type: application/json
```

**Request body:**
```json
{
  "username": "admin",
  "password": "your-password"
}
```

**Response:**
```json
{
  "errorCode": 0,
  "result": {
    "token": "csrf-token-value"
  }
}
```

The response also includes a `Set-Cookie` header with `TPOMADA_SESSIONID`. Store it for all subsequent requests.

### List Sites

```
GET https://{controllerIp}/{controllerId}/api/v2/sites?token={token}&currentPage=1&currentPageSize=100
```

**Response:**
```json
{
  "errorCode": 0,
  "result": {
    "data": [
      {
        "id": "YOUR_SITE_ID",
        "name": "Default"
      }
    ]
  }
}
```

---

## Networks / VLANs

### List Networks

```
GET /setting/lan/networks?currentPage=1&currentPageSize=100
```

**Response item:**
```json
{
  "id": "YOUR_NETWORK_ID",
  "name": "Trusted",
  "purpose": "Interface",
  "vlanId": 10,
  "subnet": "192.168.10.0",
  "cidr": 24,
  "gatewayIp": "192.168.10.1",
  "dhcpEnabled": true,
  "dhcpStart": "192.168.10.100",
  "dhcpEnd": "192.168.10.254",
  "domain": ""
}
```

### Create Network

```
POST /setting/lan/networks
```

**Request body:**
```json
{
  "name": "Trusted",
  "purpose": "Interface",
  "vlanId": 10,
  "subnet": "192.168.10.0",
  "cidr": 24,
  "gatewayIp": "192.168.10.1",
  "dhcpEnabled": true,
  "dhcpStart": "192.168.10.100",
  "dhcpEnd": "192.168.10.254",
  "domain": ""
}
```

### Modify Network (DHCP, etc.)

```
PATCH /setting/lan/networks/{networkId}
```

**Important:** Send the full network object, not just changed fields. GET first, modify, then PATCH.

---

## Gateway ACL Rules (Firewall)

Gateway ACLs control traffic between VLANs at the router/firewall level.

### List Gateway ACLs

```
GET /setting/firewall/acls?type=0&currentPage=1&currentPageSize=100
```

**Response structure:**
```json
{
  "errorCode": 0,
  "result": {
    "totalRows": 14,
    "currentPage": 1,
    "currentSize": 100,
    "data": [ /* array of ACL rule objects */ ],
    "aclDisable": false
  }
}
```

**Note:** `aclDisable: true` means ACLs are **globally disabled** — rules exist but are not enforced.

**ACL rule object:**
```json
{
  "id": "rule-id-here",
  "type": 0,
  "index": 1,
  "name": "Allow-AirPlay",
  "status": true,
  "policy": 1,
  "protocols": [6, 17],
  "sourceType": 0,
  "sourceIds": ["YOUR_NETWORK_ID_TRUSTED"],
  "destinationType": 2,
  "destinationIds": ["YOUR_IPGROUP_ID"],
  "customAclPorts": [],
  "customAclDevices": [],
  "direction": {
    "lanToWan": false,
    "lanToLan": true,
    "wanInIds": [],
    "vpnInIds": []
  },
  "stateMode": 0,
  "syslog": false,
  "resource": 0
}
```

### Create Gateway ACL

```
POST /setting/firewall/acls
```

#### Example: Deny inter-VLAN traffic (Network → Network)

```json
{
  "name": "Deny-IoT-InterVLAN",
  "status": true,
  "policy": 0,
  "protocols": [6, 17, 1],
  "sourceType": 0,
  "sourceIds": ["YOUR_NETWORK_ID_IOT"],
  "destinationType": 0,
  "destinationIds": [
    "YOUR_NETWORK_ID_TRUSTED",
    "YOUR_NETWORK_ID_WORK",
    "YOUR_NETWORK_ID_ENTERTAINMENT",
    "YOUR_NETWORK_ID_GUESTS"
  ],
  "direction": {
    "wanInIds": [],
    "vpnInIds": [],
    "lanToWan": false,
    "lanToLan": true
  },
  "type": 0,
  "biDirectional": false,
  "stateMode": 0,
  "ipSec": 0,
  "syslog": false,
  "customAclDevices": [],
  "customAclOsws": [],
  "customAclStacks": []
}
```

#### Example: Allow specific traffic with IP/Port Group

```json
{
  "name": "Allow-AirPlay",
  "status": true,
  "policy": 1,
  "protocols": [6, 17],
  "sourceType": 0,
  "sourceIds": ["YOUR_NETWORK_ID_TRUSTED"],
  "destinationType": 2,
  "destinationIds": ["YOUR_IPGROUP_ID_AIRPLAY"],
  "direction": {
    "wanInIds": [],
    "vpnInIds": [],
    "lanToWan": false,
    "lanToLan": true
  },
  "type": 0,
  "biDirectional": false,
  "stateMode": 0,
  "ipSec": 0,
  "syslog": false,
  "customAclDevices": [],
  "customAclOsws": [],
  "customAclStacks": []
}
```

### ACL Field Reference

| Field | Type | Values |
|-------|------|--------|
| `name` | string | Rule name (display only) |
| `status` | boolean | `true` = enabled, `false` = disabled |
| `policy` | integer | `0` = Deny, `1` = Permit |
| `protocols` | int[] | `[6]` = TCP, `[17]` = UDP, `[1]` = ICMP, `[6,17,1]` = all three |
| `sourceType` | integer | `0` = Network |
| `sourceIds` | string[] | Array of network IDs |
| `destinationType` | integer | `0` = Network, `2` = IP/Port Group |
| `destinationIds` | string[] | Array of network IDs or IP/Port group IDs |
| `direction.lanToLan` | boolean | `true` = LAN-to-LAN rule |
| `direction.lanToWan` | boolean | `true` = LAN-to-WAN rule |
| `direction.wanInIds` | string[] | WAN interface IDs for WAN-in rules |
| `direction.vpnInIds` | string[] | VPN interface IDs for VPN-in rules |
| `type` | integer | `0` = Gateway ACL |
| `biDirectional` | boolean | Apply rule in both directions |
| `stateMode` | integer | `0` = Auto (stateful: new/established/related) |
| `ipSec` | integer | `0` = no IPSec filter |
| `syslog` | boolean | Log matches to syslog |
| `index` | integer | Rule position (read-only, first match wins) |

---

## IP/Port Groups

IP/Port Groups allow port-based filtering in Gateway ACLs (which otherwise only support protocol filtering).

### How It Works

1. Create an IP/Port Group with target IPs and ports
2. Reference the group ID in ACL rules using `destinationType: 2`

### Create IP/Port Group

```
POST /setting/firewall/ipGroups
```

**Request body:**
```json
{
  "name": "AirPlay-Ports",
  "type": 1,
  "ipList": [
    {
      "ip": "192.168.40.0/24",
      "portList": ["7000-7100", "5353"]
    }
  ]
}
```

**Field reference:**

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Group name |
| `type` | integer | `1` = IP/Port Group |
| `ipList` | array | List of IP + port combinations |
| `ipList[].ip` | string | Target IP or CIDR subnet |
| `ipList[].portList` | string[] | **Strings, not numbers.** Port ranges use hyphen: `"7000-7100"` |

### List IP/Port Groups

```
GET /setting/firewall/ipGroups?currentPage=1&currentPageSize=100
```

---

## mDNS Reflector

The mDNS reflector enables service discovery (Bonjour, AirPlay, Chromecast, etc.) across VLANs.

### List mDNS Rules

```
GET /setting/service/mdns
```

**Response:**
```json
{
  "errorCode": 0,
  "result": {
    "totalRows": 1,
    "data": [
      {
        "id": "rule-id-here",
        "name": "AirPlay-mDNS",
        "status": true,
        "type": 1,
        "osg": {
          "profileIds": ["buildIn-1"],
          "serviceNetworks": ["YOUR_NETWORK_ID_ENTERTAINMENT"],
          "clientNetworks": ["YOUR_NETWORK_ID_TRUSTED"]
        },
        "resource": 0
      }
    ],
    "apRuleNum": 0,
    "osgRuleNum": 1,
    "apRuleLimit": 16,
    "osgRuleLimit": 20
  }
}
```

### mDNS Field Reference

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Rule name |
| `status` | boolean | Enable/disable |
| `type` | integer | `1` = OSG (gateway) rule, `0` = AP rule |
| `osg.profileIds` | string[] | Service profiles. Known values: `"buildIn-1"` = AirPlay |
| `osg.serviceNetworks` | string[] | Network IDs where services are **provided** (e.g., TVs, speakers) |
| `osg.clientNetworks` | string[] | Network IDs where clients **discover** services (e.g., phones, laptops) |
| `resource` | integer | `0` observed (meaning unknown) |

**Limits:** `osgRuleLimit: 20` (max 20 gateway mDNS rules), `apRuleLimit: 16` (max 16 AP mDNS rules).

---

## WLANs / SSIDs

WLANs have a two-level hierarchy: **WLAN Groups** contain **SSIDs**.

### List WLAN Groups

```
GET /setting/wlans?currentPage=1&currentPageSize=100
```

Returns WLAN groups (e.g., "Default"). Each group has an `id` used in SSID endpoints.

### List SSIDs in a WLAN Group

```
GET /setting/wlans/{wlanGroupId}/ssids
```

### Create SSID

```
POST /setting/wlans/{wlanGroupId}/ssids
```

**Full request body (all required fields):**
```json
{
  "name": "MySSID",
  "band": 3,
  "type": 0,
  "guestNetEnable": false,
  "security": 3,
  "broadcast": true,
  "vlanSetting": {
    "mode": 1,
    "customConfig": { "vlanId": 10 }
  },
  "pskSetting": {
    "securityKey": "your-wifi-password",
    "encryptionPsk": 3,
    "versionPsk": 2,
    "gikRekeyPskEnable": false
  },
  "rateLimit": { "rateLimitId": "YOUR_RATE_LIMIT_ID" },
  "ssidRateLimit": { "rateLimitId": "YOUR_RATE_LIMIT_ID" },
  "wlanScheduleEnable": false,
  "rateAndBeaconCtrl": {
    "rate2gCtrlEnable": false,
    "rate5gCtrlEnable": false,
    "rate6gCtrlEnable": false
  },
  "macFilterEnable": false,
  "wlanId": "",
  "enable11r": false,
  "pmfMode": 3,
  "multiCastSetting": {
    "multiCastEnable": true,
    "arpCastEnable": true,
    "filterEnable": false,
    "ipv6CastEnable": true,
    "channelUtil": 100
  },
  "wpaPsk": [2, 3],
  "deviceType": 1,
  "dhcpOption82": { "dhcpEnable": false },
  "greEnable": false,
  "prohibitWifiShare": false,
  "mloEnable": false
}
```

**Key fields:**

| Field | Type | Values |
|-------|------|--------|
| `name` | string | SSID name (broadcast name) |
| `band` | integer | Bitmask: `1` = 2.4 GHz, `2` = 5 GHz, `3` = 2.4 + 5 GHz |
| `security` | integer | `0` = Open, `3` = WPA2/WPA3-Personal. **`2` (WPA2-only) fails on creation — use `3` instead** |
| `broadcast` | boolean | `true` = visible, `false` = hidden SSID |
| `vlanSetting.mode` | integer | `0` = use WLAN Group default, `1` = custom VLAN |
| `vlanSetting.customConfig.vlanId` | integer | VLAN ID (when mode = 1) |
| `enable11r` | boolean | 802.11r Fast Roaming |
| `pmfMode` | integer | Protected Management Frames: `1` = disabled, `2` = optional, `3` = required |
| `wpaPsk` | int[] | WPA versions: `[2]` = WPA2, `[2, 3]` = WPA2/WPA3 |
| `rateLimit.rateLimitId` | string | ID of the rate limit profile (get from existing SSIDs) |

**Important:** The `rateLimitId` references a built-in rate limit profile. Get the "no limit" profile ID by reading an existing SSID.

### Modify SSID

```
PATCH /setting/wlans/{wlanGroupId}/ssids/{ssidId}
```

**Important:** Like all Omada PATCH endpoints, send the **full SSID object**. GET the SSID list first, modify the fields you want, remove read-only fields (`id`, `idInt`, `index`, `site`, `resource`, `vlanEnable`, `portalEnable`, `accessEnable`), then PATCH.

### Delete SSID

```
DELETE /setting/wlans/{wlanGroupId}/ssids/{ssidId}
```

---

## Devices

### List Devices

```
GET /devices?currentPage=1&currentPageSize=100
```

**Response item:**
```json
{
  "mac": "AA-BB-CC-DD-EE-FF",
  "name": "SG3428XMPP",
  "type": "switch",
  "status": 0,
  "model": "SG3428XMPP",
  "firmwareVersion": "1.0.0"
}
```

### Adopt Device

```
POST /cmd/devices/adopt
```

**Request body:**
```json
{
  "mac": "AA-BB-CC-DD-EE-FF"
}
```

**Important:** The MAC is in the **body**, not the URL. Adoption often fails on first attempt (device not yet discovered). Wait 10–30 seconds and retry — usually succeeds after the device reaches "Discovered" state (status 20).

---

## Access Points (EAPs)

### Get AP Details

```
GET /eaps/{mac}
```

Returns full AP configuration including radio settings, IP settings, and SSID overrides.

### SSID Override per AP

Each AP has an `ssidOverrides` array that controls which SSIDs are enabled/disabled on that specific AP.

```
PATCH /eaps/{mac}
```

**Request body (only ssidOverrides needed):**
```json
{
  "ssidOverrides": [
    {
      "index": 311881680,
      "globalSsid": "HomeNet",
      "supportBands": [0, 1],
      "security": 3,
      "enable": true,
      "ssidEnable": true,
      "vlanEnable": false,
      "vlanId": 1,
      "ssid": "HomeNet",
      "psk": "wifi-password",
      "ssidEnable": true
    }
  ]
}
```

**Override fields:**

| Field | Type | Description |
|-------|------|-------------|
| `enable` | boolean | `true` = per-AP override is active (use `enable` + `ssidEnable` together) |
| `ssidEnable` | boolean | `true` = SSID broadcasts on this AP, `false` = disabled on this AP |
| `globalSsid` | string | The SSID name (read-only, used for matching) |
| `supportBands` | int[] | `[0]` = 2.4G, `[1]` = 5G, `[0,1]` = both (read-only, from SSID band setting) |

**Workflow:**
1. `GET /eaps/{mac}` — get full AP object with `ssidOverrides`
2. For each SSID override entry, set `enable: true` and `ssidEnable: true/false`
3. `PATCH /eaps/{mac}` with `{ ssidOverrides: [...] }`

---

## Port Profiles (LAN Profiles)

### List Port Profiles

```
GET /setting/lan/profiles?currentPage=1&currentPageSize=100
```

**Important:** The endpoint is `/setting/lan/profiles`, NOT `/setting/switching/portProfiles`.

### Create Port Profile

```
POST /setting/lan/profiles
```

**Request body (Trunk profile example):**
```json
{
  "name": "Trunk-All",
  "nativeNetworkId": "YOUR_MGMT_NETWORK_ID",
  "tagNetworkIds": [
    "YOUR_TRUSTED_NETWORK_ID",
    "YOUR_WORK_NETWORK_ID",
    "YOUR_IOT_NETWORK_ID"
  ],
  "poe": 1,
  "dot1x": 0,
  "spanningTreeEnable": true,
  "duplex": 0,
  "linkSpeed": 0,
  "lldpMedEnable": false,
  "topologyNotifyEnable": false,
  "type": 0
}
```

**Important:** The `nativeNetworkId` cannot appear in `tagNetworkIds` (error). Also, every port **must** have a native network — profiles without `nativeNetworkId` can be created but cannot be assigned to ports.

---

## Switch Ports

### List Switch Ports

```
GET /switches/{mac}/ports
```

Returns all ports with their current configuration, status, and assigned profiles.

### Modify Switch Port

```
PATCH /switches/{mac}/ports/{portNumber}
```

**Important notes:**
- Use port **number** in the URL, not port ID
- Requires the **full port object** (GET first, clone, modify, PATCH)
- Remove read-only fields: `portStatus`, `portCap`
- SFP+ ports may have different port numbers (e.g., SFP+1 = port 9, SFP+2 = port 10 on SG2210XMP-M2)

**Workflow:**
```javascript
// 1. GET all ports
const ports = await omada.apiCall('GET', `/switches/${mac}/ports`);

// 2. Find the port you want to modify
const port = ports.result.find(p => p.port === 1);

// 3. Clone and modify
const payload = { ...port };
delete payload.portStatus;  // read-only
delete payload.portCap;     // read-only
payload.profileId = 'YOUR_PROFILE_ID';

// 4. PATCH
await omada.apiCall('PATCH', `/switches/${mac}/ports/1`, payload);
```

---

## Routing

### List Static Routes

```
GET /setting/routing/staticRoutes?currentPage=1&currentPageSize=100
```

---

## Other Services

### IGMP Proxy

```
GET  /setting/service/igmpProxy
PATCH /setting/service/igmpProxy
```

### Switch ACLs

```
GET  /setting/firewall/acls?type=switch&currentPage=1&currentPageSize=100
POST /setting/firewall/acls?type=switch
```

### EAP (Access Point) ACLs

```
GET  /setting/firewall/acls?type=eap&currentPage=1&currentPageSize=100
POST /setting/firewall/acls?type=eap
```

---

## Error Codes

| Code | Meaning | Solution |
|------|---------|----------|
| `0` | Success | — |
| `-1` | Session expired | Re-authenticate (call `connect()` again) |
| `-1001` | Invalid or incomplete payload | Check all required fields, compare with DevTools |
| `-30109` | Invalid username or password | Check credentials |
| HTML response | Not authenticated | Complete the 3-step auth flow first |
| `ETIMEDOUT` | Controller unreachable | Check IP, port, and network connectivity |
| `ECONNREFUSED` | Wrong port or controller down | OC220 uses port 443, software controller may use 8043 |

---

## Response Format

All API responses follow this structure:

```json
{
  "errorCode": 0,
  "msg": "Success.",
  "result": {
    "totalRows": 10,
    "currentPage": 1,
    "currentSize": 100,
    "data": [ /* items */ ]
  }
}
```

For single-object responses (e.g., controller info), `result` contains the object directly instead of a paginated wrapper.

---

## Discovering New Endpoints

Since the API is not fully documented, new endpoints are discovered via browser DevTools:

1. Open the Omada Controller web UI
2. Press F12 → Network tab → filter by `XHR` or `Fetch`
3. Perform the desired action in the UI
4. Find the request in the Network tab
5. Copy the URL path, method, and request body
6. Use `omada.apiCall()` with the extracted values
