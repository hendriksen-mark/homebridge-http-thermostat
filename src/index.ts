'use strict';

import PACKAGE_JSON from '../package.json';
import { configParser, http, PullTimer } from 'homebridge-http-utils';
import { URL } from 'url';
import { setTimeout } from 'timers';

// Homebridge types (install @homebridge/types for best results)
import type { API, Logging } from 'homebridge';

const MANUFACTURER: string = PACKAGE_JSON.author.name;
const SERIAL_NUMBER = '001';
const MODEL: string = PACKAGE_JSON.name;
const FIRMWARE_REVISION: string = PACKAGE_JSON.version;

let Service: any, Characteristic: any;

interface HttpThermostatConfig {
  name: string;
  apiroute: any;
  pollInterval: number;
  validStates: number[];
  listener: boolean;
  port: number;
  checkupDelay: number;
  requestArray: string[];
  manufacturer: string;
  serial: string;
  model: string;
  firmware: string;
  auth?: {
    username?: string;
    password?: string;
  };
  timeout: number;
  http_method: string;
  temperatureThresholds: boolean;
  heatOnly: boolean;
  currentRelativeHumidity: boolean;
  temperatureDisplayUnits: number;
  maxTemp: number;
  minTemp: number;
  minStep: number;
};

// Use export default for ESM compatibility
const plugin = (api: API) => {
  Service = api.hap.Service;
  Characteristic = api.hap.Characteristic;

  // Register using a wrapper to adapt Homebridge's AccessoryConfig to our HttpThermostatConfig
  api.registerAccessory(MODEL, 'HttpThermostat', class extends HttpThermostat {
    constructor(log: Logging, config: any, api: API) {
      // Optionally, validate config here or map fields as needed
      super(log, config as HttpThermostatConfig, api);
    }
  });
};

class HttpThermostat {
  log: Logging;
  api: API;
  name: string;
  apiroute: any;
  pullInterval: number;
  validStates: number[];
  listener: boolean;
  port: number;
  checkupDelay: number;
  requestArray: string[];
  username?: string;
  password?: string;
  timeout: number = 3000;
  http_method: string = 'GET';
  temperatureThresholds: boolean = false;
  heatOnly: boolean = false;
  currentRelativeHumidity: boolean = false;
  temperatureDisplayUnits: number = 0;
  maxTemp: number = 30;
  minTemp: number = 15;
  minStep: number = 0.5;
  server: any; // HTTP server instance
  informationService: any;
  service: any;
  pullTimer: PullTimer | null = null;
  homebridgeService: any;

  constructor(log: Logging, config: HttpThermostatConfig, api: API) {
    this.log = log;
    this.name = config.name;
    this.api = api;
    this.pullInterval = config.pollInterval || 300;
    this.validStates = config.validStates || [0, 1, 2, 3];
    this.listener = config.listener || false;
    this.port = config.port || 2000;
    this.checkupDelay = config.checkupDelay || 2000;
    this.requestArray = config.requestArray || ['targetHeatingCoolingState', 'targetTemperature', 'coolingThresholdTemperature', 'heatingThresholdTemperature'];
    this.timeout = config.timeout || 3000;

    this.temperatureThresholds = config.temperatureThresholds || false
    this.heatOnly = config.heatOnly || false

    this.currentRelativeHumidity = config.currentRelativeHumidity || false
    this.temperatureDisplayUnits = config.temperatureDisplayUnits || 0
    this.maxTemp = config.maxTemp || 30
    this.minTemp = config.minTemp || 15
    this.minStep = config.minStep || 0.5

    this.apiroute = undefined;
    this.validateUrl('apiroute', config, true);

    this.homebridgeService = new Service.Thermostat(this.name)

    if (this.pullInterval) {
      this.pullTimer = new PullTimer(
        log,
        this.pullInterval * 1000,
        async () => {
          await this._getStatus();
        },
        undefined,
      );
      this.pullTimer.start();
    }

    if (this.listener) {
      this.server = http.createHttpServer((request, response) => {
        const baseURL = 'http://' + request.headers.host + '/'
        const url = new URL(request.url ?? '/', baseURL)
        if (this.requestArray.includes(url.pathname.substr(1))) {
          try {
            this.log.debug('Handling request')
            response.end('Handling request')
            this._httpHandler(url.pathname.substr(1), url.searchParams.get('value'))
          } catch (error: any) {
            this.log.warn('Error parsing request: %s', error.message)
          }
        } else {
          this.log.warn('Invalid request: %s', request.url)
          response.end('Invalid request')
        }
      })

      this.server.listen(this.port, () => {
        this.log('Listen server: http://%s:%s', http.getLocalIpAddress(), this.port)
      })
    }

  }

  validateUrl(url_command: string, config: any, mandatory = false) {
    let value: any = {};
    value.url = config[url_command];
    if (
      (typeof value.url === 'string' && value.url.trim() !== '')
    ) {
      try {
        value.method = config.http_method || 'GET';
        if (config.username && config.password) {
          value.auth = {
            user: config.username,
            pass: config.password,
          };
        }
        if (config.timeout) {
          value.requestTimeout = config.timeout;
        }
        (this as any)[url_command] = configParser.parseUrlProperty(value);
        this.log.debug(`Parsed '${url_command}': ${JSON.stringify((this as any)[url_command])}`);
      } catch (error: any) {
        this.log.warn(`Error occurred while parsing '${url_command}': ${error.message}`);
        this.log.warn('Aborting...');
        return;
      }
    } else if (mandatory) {
      this.log.warn(`Property '${url_command}' is required!`);
      this.log.warn('Aborting...');
      return;
    } else {
      // Optional URL missing or not a non-empty string/object with url, just skip
      (this as any)[url_command] = undefined;
    }
  }

  getServices(): any[] {
    const informationService = new Service.AccessoryInformation();

    informationService
      .setCharacteristic(Characteristic.Manufacturer, MANUFACTURER)
      .setCharacteristic(Characteristic.Model, MODEL)
      .setCharacteristic(Characteristic.SerialNumber, SERIAL_NUMBER)
      .setCharacteristic(Characteristic.FirmwareRevision, FIRMWARE_REVISION);

    this.homebridgeService
      .updateCharacteristic(Characteristic.TemperatureDisplayUnits, this.temperatureDisplayUnits);

    this.homebridgeService
      .getCharacteristic(Characteristic.TargetHeatingCoolingState)
      .onSet(this.setTargetHeatingCoolingState.bind(this));

    this.homebridgeService
      .getCharacteristic(Characteristic.TargetHeatingCoolingState)
      .setProps({
        validValues: this.validStates,
      });

    this.homebridgeService
      .getCharacteristic(Characteristic.TargetTemperature)
      .onSet(this.setTargetTemperature.bind(this))
      .setProps({
        minValue: this.minTemp,
        maxValue: this.maxTemp,
        minStep: this.minStep,
      });

    this.homebridgeService
      .getCharacteristic(Characteristic.CurrentTemperature)
      .setProps({
        minValue: -600,
        maxValue: 600,
      });

    if (this.temperatureThresholds) {
      this.homebridgeService
        .getCharacteristic(Characteristic.CoolingThresholdTemperature)
        .onSet(this.setCoolingThresholdTemperature.bind(this))
        .setProps({
          minValue: this.minTemp,
          maxValue: this.maxTemp,
          minStep: this.minStep,
        });

      this.homebridgeService
        .getCharacteristic(Characteristic.HeatingThresholdTemperature)
        .onSet(this.setHeatingThresholdTemperature.bind(this))
        .setProps({
          minValue: this.minTemp,
          maxValue: this.maxTemp,
          minStep: this.minStep,
        });
    }

    this._getStatus();

    return [this.informationService, this.homebridgeService];
  }

  _getStatus = async (): Promise<void> => {
    let urlObj = { ...this.apiroute };
    urlObj.url = this.apiroute.url + '/status';
    this.log.debug('Getting status: %s', urlObj.url);
    this.log.info('Getting status from: %s', urlObj.url);

    try {
      const response = await http.httpRequest(urlObj);
      if (this.pullInterval && this.pullTimer) {
        this.pullTimer.resetTimer();
      }
      if (response.status !== 200) {
        this.log.error('Error getting status: %s', response.status);
        throw new Error('HTTP status code ' + response.status);
      }
      let json: any;
      if (typeof response.data === 'string') {
        json = JSON.parse(response.data);
      } else if (typeof response.data === 'object' && response.data !== null) {
        json = response.data;
      } else {
        throw new Error('Response data is not valid JSON or object');
      }
      this.homebridgeService.updateCharacteristic(Characteristic.TargetTemperature, json.targetTemperature)
      this.log.info('Updated TargetTemperature to: %s', json.targetTemperature)
      this.homebridgeService.updateCharacteristic(Characteristic.CurrentTemperature, json.currentTemperature)
      this.log.debug('Updated CurrentTemperature to: %s', json.currentTemperature)
      this.homebridgeService.updateCharacteristic(Characteristic.TargetHeatingCoolingState, json.targetHeatingCoolingState)
      this.log.debug('Updated TargetHeatingCoolingState to: %s', json.targetHeatingCoolingState)
      const currentHcState = Math.max(0, Math.min(2, json.currentHeatingCoolingState));
      this.homebridgeService.updateCharacteristic(Characteristic.CurrentHeatingCoolingState, currentHcState)
      this.log.debug('Updated CurrentHeatingCoolingState to: %s', currentHcState)
      if (this.temperatureThresholds) {
        this.homebridgeService.updateCharacteristic(Characteristic.CoolingThresholdTemperature, json.coolingThresholdTemperature)
        this.log.debug('Updated CoolingThresholdTemperature to: %s', json.coolingThresholdTemperature)
        this.homebridgeService.updateCharacteristic(Characteristic.HeatingThresholdTemperature, json.heatingThresholdTemperature)
        this.log.debug('Updated HeatingThresholdTemperature to: %s', json.heatingThresholdTemperature)
      }
      if (this.currentRelativeHumidity) {
        this.homebridgeService.updateCharacteristic(Characteristic.CurrentRelativeHumidity, json.currentRelativeHumidity)
        this.log.debug('Updated CurrentRelativeHumidity to: %s', json.currentRelativeHumidity)
      }
      return
    } catch (error: any) {
      this.log.error('_getStatus() failed: %s', error.message);
      throw error;
    }
  };

  _httpHandler = (characteristic: string, value: any): void => {
    switch (characteristic) {
      case 'targetHeatingCoolingState': {
        this.service.updateCharacteristic(Characteristic.TargetHeatingCoolingState, value);
        this.log.debug('Updated %s to: %s', characteristic, value);
        break;
      }
      case 'targetTemperature': {
        this.service.updateCharacteristic(Characteristic.TargetTemperature, value);
        this.log.debug('Updated %s to: %s', characteristic, value);
        break;
      }
      case 'coolingThresholdTemperature': {
        this.service.updateCharacteristic(Characteristic.CoolingThresholdTemperature, value);
        this.log.debug('Updated %s to: %s', characteristic, value);
        break;
      }
      case 'heatingThresholdTemperature': {
        this.service.updateCharacteristic(Characteristic.HeatingThresholdTemperature, value);
        this.log.debug('Updated %s to: %s', characteristic, value);
        break;
      }
      default: {
        this.log.warn('Unknown characteristic "%s" with value "%s"', characteristic, value);
      }
    }
  };

  setTargetHeatingCoolingState = async (value: number): Promise<void> => {
    let urlObj = { ...this.apiroute };
    urlObj.url = this.apiroute.url + '/targetHeatingCoolingState?value=' + value;
    try {
      const response = await http.httpRequest(urlObj);
      if (response.status !== 200) {
        this.log.error('Error setting targetHeatingCoolingState: %s', response.status);
        throw new Error('HTTP status code ' + response.status);
      }
      this.log.info('Set targetHeatingCoolingState to: %s', value);

      setTimeout(() => {
        this._getStatus();
      }, this.checkupDelay);
    } catch (error: any) {
      this.log.error('setTargetHeatingCoolingState() failed: %s', error.message);
      throw error;
    }
  };

  setTargetTemperature = async (value: number): Promise<void> => {
    value = parseFloat(value.toFixed(1));
    const urlObj = { ...this.apiroute };
    urlObj.url = this.apiroute.url + '/targetTemperature?value=' + value;
    this.log.debug('Setting targetTemperature: %s, %s', urlObj.url, value);

    try {
      const response = await http.httpRequest(urlObj);
      if (response.status !== 200) {
        this.log.error('Error setting targetTemperature: %s', response.status);
        throw new Error('HTTP status code ' + response.status);
      }
      this.log.info('Set targetTemperature to: %s', value);
    } catch (error: any) {
      this.log.error('setTargetTemperature() failed: %s', error.message);
      throw error;
    }
  };

  setCoolingThresholdTemperature = async (value: number): Promise<void> => {
    value = parseFloat(value.toFixed(1));
    const urlObj = { ...this.apiroute };
    urlObj.url = this.apiroute.url + '/coolingThresholdTemperature?value=' + value;
    this.log.debug('Setting coolingThresholdTemperature: %s, %s', urlObj.url, value);

    try {
      const response = await http.httpRequest(urlObj);
      if (response.status !== 200) {
        this.log.error('Error setting coolingThresholdTemperature: %s', response.status);
        throw new Error('HTTP status code ' + response.status);
      }
      this.log.info('Set coolingThresholdTemperature to: %s', value);
    } catch (error: any) {
      this.log.error('setCoolingThresholdTemperature() failed: %s', error.message);
      throw error;
    }
  };

  setHeatingThresholdTemperature = async (value: number): Promise<void> => {
    value = parseFloat(value.toFixed(1));
    const urlObj = { ...this.apiroute };
    urlObj.url = this.apiroute.url + '/heatingThresholdTemperature?value=' + value;
    this.log.debug('Setting heatingThresholdTemperature: %s, %s', urlObj.url, value);

    try {
      const response = await http.httpRequest(urlObj);
      if (response.status !== 200) {
        this.log.error('Error setting heatingThresholdTemperature: %s', response.status);
        throw new Error('HTTP status code ' + response.status);
      }
      this.log.info('Set heatingThresholdTemperature to: %s', value);
    } catch (error: any) {
      this.log.error('setHeatingThresholdTemperature() failed: %s', error.message);
      throw error;
    }
  }
}

export default plugin;
