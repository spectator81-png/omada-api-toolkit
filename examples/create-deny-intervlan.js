#!/usr/bin/env node

/**
 * Example: Create Deny-InterVLAN rules for all networks
 *
 * Creates one DENY rule per network, blocking traffic to all other networks.
 * This is the standard approach for VLAN isolation with specific ALLOW
 * rules added above (lower index = higher priority, first match wins).
 *
 * Usage:
 *   export OMADA_URL="https://192.168.x.x"
 *   export OMADA_PASS="your-password"
 *   export NODE_TLS_REJECT_UNAUTHORIZED=0
 *   node examples/create-deny-intervlan.js
 */

const omada = require('../omada-api-helper.js');

async function run() {
  await omada.connect();

  // Step 1: Fetch all network IDs dynamically
  const networks = await omada.apiCall('GET', '/setting/lan/networks?currentPage=1&currentPageSize=100');
  const NET = {};
  networks.result.data.forEach(n => {
    NET[n.name] = n.id;
  });

  console.log('Networks found:');
  Object.entries(NET).forEach(([name, id]) => {
    console.log(`  ${name}: ${id}`);
  });

  const ALL = Object.values(NET);
  const ALL_PROTO = [6, 17, 1]; // TCP + UDP + ICMP

  // Base template for Deny rules
  const base = {
    status: true,
    type: 0,                    // Gateway ACL
    biDirectional: false,
    stateMode: 0,               // Auto (stateful)
    ipSec: 0,
    syslog: false,
    customAclDevices: [],
    customAclOsws: [],
    customAclStacks: [],
    direction: {
      wanInIds: [],
      vpnInIds: [],
      lanToWan: false,
      lanToLan: true,           // LAN-to-LAN rule
    },
  };

  // Step 2: Create one Deny rule per network
  console.log('\nCreating Deny-InterVLAN rules...\n');

  for (const [name, id] of Object.entries(NET)) {
    // Destination = all networks except the source
    const others = ALL.filter(x => x !== id);

    const result = await omada.apiCall('POST', '/setting/firewall/acls', {
      ...base,
      name: `Deny-${name}-InterVLAN`,
      policy: 0,                // Deny
      protocols: ALL_PROTO,
      sourceType: 0,            // Network
      sourceIds: [id],
      destinationType: 0,       // Network
      destinationIds: others,
    });

    const ok = result.errorCode === 0;
    console.log(`${ok ? 'OK  ' : 'FAIL'} Deny-${name}-InterVLAN${ok ? '' : ': ' + result.msg}`);

    // Small delay to avoid overwhelming the controller
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  // Step 3: Verify — list all ACL rules
  console.log('\n=== All ACL Rules ===');
  const acls = await omada.apiCall('GET', '/setting/firewall/acls?type=0&currentPage=1&currentPageSize=100');
  if (acls.result?.data) {
    acls.result.data.forEach((a, i) => {
      console.log(`${String(i + 1).padStart(2)}. ${a.policy === 1 ? 'ALLOW' : 'DENY '} | ${a.name}`);
    });
  }
}

run().catch(e => console.error('Error:', e));
