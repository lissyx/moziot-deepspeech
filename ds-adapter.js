'use strict';

const { Adapter } = require('gateway-addon');
const manifest = require('./manifest.json');
const DsAPIHandler = require('./ds-api-handler');

class DSAdapter extends Adapter {
  constructor(addonManager) {
    console.log('Creating DsAdapter');
    super(addonManager, manifest.id, manifest.id);
    addonManager.addAdapter(this);
    this.savedDevices = new Set();
    this._dsApi = this.startDsApi(addonManager);
  }

  startDsApi(addonManager) {
    console.log('Launching DsAPI from DsAdapter');
    return new DsAPIHandler(addonManager);
  }

  handleDeviceSaved(deviceId, deviceFull) {
    console.log('DsAdapter discover device: ' + deviceId);
    this.savedDevices.add(deviceFull);
    if (this._dsApi) {
      this._dsApi.generateLocalLM(this.savedDevices);
    }
  }
}

module.exports = DSAdapter;
