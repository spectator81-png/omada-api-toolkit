#!/usr/bin/env node

/**
 * Example: Create an SSID with VLAN assignment
 *
 * Creates a WPA2/WPA3 SSID on a specific VLAN, then configures
 * per-AP SSID overrides to control which APs broadcast it.
 *
 * Usage:
 *   export OMADA_URL="https://192.168.x.x"
 *   export OMADA_PASS="your-password"
 *   export NODE_TLS_REJECT_UNAUTHORIZED=0
 *   node examples/create-ssid.js
 */

const omada = require('../omada-api-helper.js');

(async () => {
  try {
    await omada.connect();

    // Step 1: Get the WLAN group ID
    const wlanGroups = await omada.getWlanGroups();
    const wlanGroupId = wlanGroups.result.data[0].id;
    console.log(`WLAN Group: ${wlanGroups.result.data[0].name} (${wlanGroupId})`);

    // Step 2: Get rate limit ID from existing SSIDs (or use a known one)
    const existing = await omada.getSsids(wlanGroupId);
    let rateLimitId;
    if (existing.result.data.length > 0) {
      rateLimitId = existing.result.data[0].rateLimit.rateLimitId;
      console.log(`Rate Limit ID (no limit): ${rateLimitId}`);
    } else {
      console.log('No existing SSIDs found — you need a rateLimitId.');
      console.log('Create one SSID via the web UI first, then read it to get the ID.');
      process.exit(1);
    }

    // Step 3: Create the SSID
    const ssidConfig = {
      name: 'MyNetwork',
      band: 3,                    // 1=2.4G, 2=5G, 3=both
      type: 0,
      guestNetEnable: false,
      security: 3,                // 3 = WPA2/WPA3 (NEVER use 2 — it fails!)
      broadcast: true,            // true = visible, false = hidden
      vlanSetting: {
        mode: 1,                  // 1 = custom VLAN
        customConfig: { vlanId: 10 }
      },
      pskSetting: {
        securityKey: 'change-this-password',
        encryptionPsk: 3,         // AES
        versionPsk: 2,
        gikRekeyPskEnable: false
      },
      rateLimit: { rateLimitId },
      ssidRateLimit: { rateLimitId },
      wlanScheduleEnable: false,
      rateAndBeaconCtrl: {
        rate2gCtrlEnable: false,
        rate5gCtrlEnable: false,
        rate6gCtrlEnable: false
      },
      macFilterEnable: false,
      wlanId: '',
      enable11r: false,           // 802.11r Fast Roaming
      pmfMode: 3,                 // 1=disabled, 2=optional, 3=required
      multiCastSetting: {
        multiCastEnable: true,
        arpCastEnable: true,
        filterEnable: false,
        ipv6CastEnable: true,
        channelUtil: 100
      },
      wpaPsk: [2, 3],            // WPA versions supported
      deviceType: 1,
      dhcpOption82: { dhcpEnable: false },
      greEnable: false,
      prohibitWifiShare: false,
      mloEnable: false
    };

    console.log(`\nCreating SSID "${ssidConfig.name}" on VLAN ${ssidConfig.vlanSetting.customConfig.vlanId}...`);
    const result = await omada.createSsid(wlanGroupId, ssidConfig);

    if (result.errorCode === 0) {
      console.log(`  Created! SSID ID: ${result.result.ssidId}`);
    } else {
      console.log(`  Failed: ${result.msg}`);
      process.exit(1);
    }

    // Step 4: Optionally disable SSID on specific APs
    // Get all devices to find APs
    const devices = await omada.getDevices();
    const aps = (devices.result?.data || devices.result)
      .filter(d => d.type === 'ap');

    if (aps.length > 0) {
      console.log(`\nFound ${aps.length} APs. Showing SSID override status:`);

      for (const ap of aps) {
        const apConfig = await omada.getEap(ap.mac);
        const overrides = apConfig.result.ssidOverrides || [];
        const myOverride = overrides.find(o => o.globalSsid === ssidConfig.name);

        if (myOverride) {
          console.log(`  ${ap.name || ap.mac}: ${myOverride.ssidEnable ? 'enabled' : 'disabled'}`);
        }
      }

      // Example: Disable the new SSID on the first AP
      // const firstAp = aps[0];
      // const apConfig = await omada.getEap(firstAp.mac);
      // apConfig.result.ssidOverrides.forEach(o => {
      //   if (o.globalSsid === ssidConfig.name) {
      //     o.enable = true;
      //     o.ssidEnable = false;
      //   }
      // });
      // await omada.updateEap(firstAp.mac, { ssidOverrides: apConfig.result.ssidOverrides });
    }

    // Step 5: List all SSIDs for verification
    console.log('\nAll SSIDs:');
    const allSsids = await omada.getSsids(wlanGroupId);
    const bandMap = { 1: '2.4G', 2: '5G', 3: '2.4+5G' };
    for (const s of allSsids.result.data) {
      const vlan = s.vlanSetting?.customConfig?.vlanId || 'default';
      console.log(`  ${s.name} — VLAN ${vlan}, ${bandMap[s.band] || s.band}, ${s.broadcast ? 'visible' : 'hidden'}`);
    }

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
})();
