#!/usr/bin/env node

/**
 * Omada Controller API v2 Helper
 * ================================
 * Zero-dependency Node.js client for the TP-Link Omada Controller
 * internal Web API v2 (undocumented by TP-Link).
 *
 * Tested on: OC220 hardware controller (firmware 5.x / 6.1.x)
 * Software controller not yet verified — PRs welcome!
 *
 * Auth flow:
 * 1. GET  /api/info                          → get controllerId
 * 2. POST /{controllerId}/api/v2/login       → get CSRF token + session cookie
 * 3. All subsequent requests include:
 *    - Cookie: TPOMADA_SESSIONID (automatic via cookie jar)
 *    - Header: Csrf-Token: {token}
 *    - URL param: ?token={token}
 *
 * Usage (standalone):
 *   export OMADA_URL="https://192.168.x.x"
 *   export OMADA_PASS="your-password"
 *   node omada-api-helper.js
 *
 * Usage (as module):
 *   const omada = require('./omada-api-helper.js');
 *   await omada.connect();
 *   const networks = await omada.getNetworks();
 */

const https = require('https');
const http = require('http');

// ============================================================
// CONFIGURATION
// ============================================================
const CONFIG = {
  // Controller URL — set via environment variable or change default
  baseUrl: process.env.OMADA_URL || 'https://192.168.x.x',
  username: process.env.OMADA_USER || 'admin',
  password: process.env.OMADA_PASS || 'your-password',

  // Accept self-signed certificates (common on hardware controllers)
  rejectUnauthorized: false,
};

// ============================================================
// STATE
// ============================================================
let state = {
  controllerId: null,
  token: null,
  cookies: [],
  siteId: null,
};

// ============================================================
// HTTP CLIENT (zero dependencies — uses Node.js built-ins)
// ============================================================
function request(method, url, body = null) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === 'https:';
    const lib = isHttps ? https : http;

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: method,
      rejectAuthorized: CONFIG.rejectUnauthorized,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    // CSRF token header
    if (state.token) {
      options.headers['Csrf-Token'] = state.token;
    }

    // Session cookies
    if (state.cookies.length > 0) {
      options.headers['Cookie'] = state.cookies.join('; ');
    }

    if (body) {
      const bodyStr = JSON.stringify(body);
      options.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }

    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        // Store cookies from response
        const setCookies = res.headers['set-cookie'];
        if (setCookies) {
          setCookies.forEach((c) => {
            const cookiePart = c.split(';')[0];
            const cookieName = cookiePart.split('=')[0];
            // Update existing cookie or add new one
            state.cookies = state.cookies.filter(
              (existing) => !existing.startsWith(cookieName + '=')
            );
            state.cookies.push(cookiePart);
          });
        }

        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, data: json, headers: res.headers });
        } catch {
          resolve({ status: res.statusCode, data: data, headers: res.headers });
        }
      });
    });

    req.on('error', reject);

    // Allow self-signed certificates
    if (isHttps) {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    }

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

// ============================================================
// AUTH FLOW
// ============================================================

/**
 * Step 1: Get controller ID from /api/info
 */
async function getControllerId() {
  console.log('[1/3] Fetching controller ID...');
  const res = await request('GET', `${CONFIG.baseUrl}/api/info`);

  if (res.data?.result?.omadacId) {
    state.controllerId = res.data.result.omadacId;
    console.log(`      Controller ID: ${state.controllerId}`);
    console.log(`      Version: ${res.data.result.controllerVer}`);
    return state.controllerId;
  }
  throw new Error(`Controller ID not found: ${JSON.stringify(res.data)}`);
}

/**
 * Step 2: Login to get CSRF token + session cookie
 */
async function login() {
  console.log('[2/3] Logging in...');
  const url = `${CONFIG.baseUrl}/${state.controllerId}/api/v2/login`;
  const res = await request('POST', url, {
    username: CONFIG.username,
    password: CONFIG.password,
  });

  if (res.data?.errorCode === 0 && res.data?.result?.token) {
    state.token = res.data.result.token;
    console.log(`      Token: ${state.token.substring(0, 8)}...`);
    return state.token;
  }
  throw new Error(`Login failed: ${JSON.stringify(res.data)}`);
}

/**
 * Step 3: Get site ID (most setups have a single site)
 */
async function getSiteId() {
  console.log('[3/3] Fetching site ID...');
  const url = `${CONFIG.baseUrl}/${state.controllerId}/api/v2/sites?token=${state.token}&currentPage=1&currentPageSize=100`;
  const res = await request('GET', url);

  if (res.data?.result?.data?.length > 0) {
    state.siteId = res.data.result.data[0].id;
    const siteName = res.data.result.data[0].name;
    console.log(`      Site: "${siteName}" (ID: ${state.siteId})`);
    return state.siteId;
  }
  throw new Error(`No sites found: ${JSON.stringify(res.data)}`);
}

/**
 * Connect to the controller (runs all 3 auth steps)
 */
async function connect() {
  await getControllerId();
  await login();
  await getSiteId();
  console.log('\nConnected to Omada Controller!\n');
}

// ============================================================
// GENERIC API CALL (with auth)
// ============================================================

/**
 * Make an authenticated API call.
 *
 * @param {string} method - HTTP method (GET, POST, PATCH, PUT, DELETE)
 * @param {string} path - API path relative to site (e.g., '/setting/lan/networks')
 * @param {object|null} body - Request body (for POST/PATCH/PUT)
 * @returns {object} Parsed JSON response
 */
async function apiCall(method, path, body = null) {
  const separator = path.includes('?') ? '&' : '?';
  const url = `${CONFIG.baseUrl}/${state.controllerId}/api/v2/sites/${state.siteId}${path}${separator}token=${state.token}`;
  const res = await request(method, url, body);

  if (res.data?.errorCode !== 0) {
    console.error(`API error: ${JSON.stringify(res.data)}`);
  }
  return res.data;
}

// ============================================================
// NETWORK / VLAN HELPERS
// ============================================================

/** List all networks/VLANs */
async function getNetworks() {
  return apiCall('GET', '/setting/lan/networks?currentPage=1&currentPageSize=100');
}

/** Create a new network/VLAN */
async function createNetwork(config) {
  return apiCall('POST', '/setting/lan/networks', config);
}

// ============================================================
// ACL / FIREWALL HELPERS
// ============================================================

/** List all Gateway ACL rules */
async function getGatewayAcls() {
  return apiCall('GET', '/setting/firewall/acls?type=gateway&currentPage=1&currentPageSize=100');
}

/** Create a Gateway ACL rule */
async function createGatewayAcl(config) {
  return apiCall('POST', '/setting/firewall/acls?type=gateway', config);
}

/** Create a Switch ACL rule */
async function createSwitchAcl(config) {
  return apiCall('POST', '/setting/firewall/acls?type=switch', config);
}

// ============================================================
// DEVICE HELPERS
// ============================================================

/** List all managed devices */
async function getDevices() {
  return apiCall('GET', '/devices?currentPage=1&currentPageSize=100');
}

/** Adopt a device by MAC address */
async function adoptDevice(mac) {
  return apiCall('POST', '/cmd/devices/adopt', { mac });
}

// ============================================================
// WLAN / SSID HELPERS
// ============================================================

/** List WLAN groups */
async function getWlanGroups() {
  return apiCall('GET', '/setting/wlans?currentPage=1&currentPageSize=100');
}

/** List SSIDs in a WLAN group */
async function getSsids(wlanGroupId) {
  return apiCall('GET', `/setting/wlans/${wlanGroupId}/ssids`);
}

/** Create an SSID in a WLAN group */
async function createSsid(wlanGroupId, config) {
  return apiCall('POST', `/setting/wlans/${wlanGroupId}/ssids`, config);
}

/** Modify an SSID (requires full object — GET first, modify, PATCH) */
async function updateSsid(wlanGroupId, ssidId, config) {
  return apiCall('PATCH', `/setting/wlans/${wlanGroupId}/ssids/${ssidId}`, config);
}

/** Delete an SSID */
async function deleteSsid(wlanGroupId, ssidId) {
  return apiCall('DELETE', `/setting/wlans/${wlanGroupId}/ssids/${ssidId}`);
}

// Keep old name for backward compatibility
const getWlans = getWlanGroups;
const createWlan = (config) => apiCall('POST', '/setting/wlans', config);

// ============================================================
// PORT PROFILE HELPERS
// ============================================================

/** List port profiles (LAN profiles) */
async function getPortProfiles() {
  return apiCall('GET', '/setting/lan/profiles?currentPage=1&currentPageSize=100');
}

/** Create a port profile */
async function createPortProfile(config) {
  return apiCall('POST', '/setting/lan/profiles', config);
}

// ============================================================
// SWITCH PORT HELPERS
// ============================================================

/** List all ports of a switch */
async function getSwitchPorts(mac) {
  return apiCall('GET', `/switches/${mac}/ports`);
}

/** Update a switch port (requires full port object — GET first, modify, PATCH) */
async function updateSwitchPort(mac, portNumber, config) {
  return apiCall('PATCH', `/switches/${mac}/ports/${portNumber}`, config);
}

// ============================================================
// EAP / ACCESS POINT HELPERS
// ============================================================

/** Get AP details including SSID overrides */
async function getEap(mac) {
  return apiCall('GET', `/eaps/${mac}`);
}

/** Update AP settings (e.g., SSID overrides) */
async function updateEap(mac, config) {
  return apiCall('PATCH', `/eaps/${mac}`, config);
}

// ============================================================
// ROUTING HELPERS
// ============================================================

/** List static routes */
async function getStaticRoutes() {
  return apiCall('GET', '/setting/routing/staticRoutes?currentPage=1&currentPageSize=100');
}

// ============================================================
// DISCOVERY — explore available API endpoints
// ============================================================

/**
 * Probe known API endpoints and report which ones are available.
 * Useful for understanding the controller's capabilities.
 */
async function exploreSettings() {
  const endpoints = [
    '/setting/lan/networks',
    '/setting/firewall/acls?type=gateway',
    '/setting/firewall/acls?type=switch',
    '/setting/firewall/acls?type=eap',
    '/setting/wlans',
    '/setting/lan/profiles',
    '/setting/routing/staticRoutes',
    '/setting/service/mdns',
    '/setting/service/igmpProxy',
    '/devices',
  ];

  console.log('Exploring API endpoints...\n');
  const results = {};

  for (const endpoint of endpoints) {
    try {
      const data = await apiCall('GET', `${endpoint}?currentPage=1&currentPageSize=5`);
      results[endpoint] = {
        errorCode: data.errorCode,
        hasData: !!(data.result?.data?.length || data.result),
        sampleKeys: data.result?.data?.[0]
          ? Object.keys(data.result.data[0])
          : Object.keys(data.result || {}),
      };
      console.log(`  OK  ${endpoint}`);
      if (data.result?.data?.[0]) {
        console.log(`      Keys: ${Object.keys(data.result.data[0]).join(', ')}`);
      }
    } catch (e) {
      results[endpoint] = { error: e.message };
      console.log(`  ERR ${endpoint}: ${e.message}`);
    }
  }

  return results;
}

// ============================================================
// DEMO (when run directly)
// ============================================================
async function main() {
  try {
    await connect();

    // List devices
    console.log('Devices:');
    const devices = await getDevices();
    if (devices.result?.data) {
      devices.result.data.forEach((d) => {
        console.log(`  - ${d.name || d.mac} (${d.type}, status: ${d.status})`);
      });
    }

    // List networks
    console.log('\nNetworks:');
    const networks = await getNetworks();
    if (networks.result?.data) {
      networks.result.data.forEach((n) => {
        console.log(`  - ${n.name} (VLAN ${n.vlanId || 'default'}, ${n.subnet || ''}/${n.cidr || ''})`);
      });
    }

    // List Gateway ACL rules
    console.log('\nGateway ACL Rules:');
    const acls = await getGatewayAcls();
    if (acls.result?.data) {
      acls.result.data.forEach((a) => {
        console.log(`  - ${a.name} (${a.policy === 1 ? 'Permit' : 'Deny'}, active: ${a.status})`);
      });
    } else {
      console.log('  (no rules)');
    }

    // Explore all endpoints
    console.log('\n');
    await exploreSettings();

  } catch (error) {
    console.error('\nError:', error.message);
    process.exit(1);
  }
}

// ============================================================
// EXPORTS (for use as module)
// ============================================================
module.exports = {
  CONFIG,
  connect,
  apiCall,
  getDevices,
  adoptDevice,
  getNetworks,
  createNetwork,
  getGatewayAcls,
  createGatewayAcl,
  createSwitchAcl,
  getWlanGroups,
  getWlans,        // alias for getWlanGroups
  getSsids,
  createSsid,
  updateSsid,
  deleteSsid,
  createWlan,
  getPortProfiles,
  createPortProfile,
  getSwitchPorts,
  updateSwitchPort,
  getEap,
  updateEap,
  getStaticRoutes,
  exploreSettings,
};

// Run demo when executed directly
if (require.main === module) {
  main();
}
