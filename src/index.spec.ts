import plugin from './index';
import { expect, jest, it, describe } from '@jest/globals';

describe('homebridge-http-thermostat plugin', () => {
  it('should export a function', () => {
    expect(typeof plugin).toBe('function');
  });

  it('should register accessory when called with mock API', () => {
    const mockRegisterAccessory = jest.fn();
    const mockApi = {
      hap: {
        Service: {},
        Characteristic: {},
      },
      registerAccessory: mockRegisterAccessory,
    };
    plugin(mockApi as any);
    expect(mockRegisterAccessory).toHaveBeenCalled();
  });
});
