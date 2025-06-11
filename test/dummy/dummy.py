from http.server import BaseHTTPRequestHandler, HTTPServer
import json
from urllib.parse import urlparse, parse_qs

# Shared state for all requests
thermostat_state = {
    "current_temperature": 21.0,
    "target_temperature": 22.0,
    "target_heating_cooling_state": 1,
    "current_heating_cooling_state": 1,
    "cooling_threshold_temperature": 25.0,
    "heating_threshold_temperature": 19.0,
    "current_relative_humidity": 40.0,
}

class SimpleHandler(BaseHTTPRequestHandler):
    def _send_json(self, obj, code=200):
        try:
            self.send_response(code)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(obj).encode('utf-8'))
        except BrokenPipeError:
            # Client disconnected before response could be sent
            pass

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        if path == "/status":
            response = {
                "currentTemperature": thermostat_state["current_temperature"],
                "targetTemperature": thermostat_state["target_temperature"],
                "targetHeatingCoolingState": thermostat_state["target_heating_cooling_state"],
                "currentHeatingCoolingState": thermostat_state["current_heating_cooling_state"],
                "coolingThresholdTemperature": thermostat_state["cooling_threshold_temperature"],
                "heatingThresholdTemperature": thermostat_state["heating_threshold_temperature"],
                "currentRelativeHumidity": thermostat_state["current_relative_humidity"],
            }
            self._send_json(response)
        elif path == "/targetHeatingCoolingState":
            value = query.get("value", [None])[0]
            if value is not None:
                try:
                    thermostat_state["target_heating_cooling_state"] = int(value)
                    thermostat_state["current_heating_cooling_state"] = int(value)
                    self._send_json({"result": "ok", "targetHeatingCoolingState": thermostat_state["target_heating_cooling_state"]})
                    print(f"Target heating/cooling state set to {thermostat_state['target_heating_cooling_state']}")
                except ValueError:
                    self._send_json({"error": "Invalid value"}, 400)
            else:
                self._send_json({"error": "Missing value"}, 400)
        elif path == "/targetTemperature":
            value = query.get("value", [None])[0]
            if value is not None:
                try:
                    thermostat_state["target_temperature"] = float(value)
                    thermostat_state["current_temperature"] = float(value)
                    self._send_json({"result": "ok", "targetTemperature": thermostat_state["target_temperature"]})
                    print(f"Target temperature set to {thermostat_state['target_temperature']}")
                except ValueError:
                    self._send_json({"error": "Invalid value"}, 400)
            else:
                self._send_json({"error": "Missing value"}, 400)
        elif path == "/coolingThresholdTemperature":
            value = query.get("value", [None])[0]
            if value is not None:
                try:
                    thermostat_state["cooling_threshold_temperature"] = float(value)
                    self._send_json({"result": "ok", "coolingThresholdTemperature": thermostat_state["cooling_threshold_temperature"]})
                    print(f"Cooling threshold temperature set to {thermostat_state['cooling_threshold_temperature']}")
                except ValueError:
                    self._send_json({"error": "Invalid value"}, 400)
            else:
                self._send_json({"error": "Missing value"}, 400)
        elif path == "/heatingThresholdTemperature":
            value = query.get("value", [None])[0]
            if value is not None:
                try:
                    thermostat_state["heating_threshold_temperature"] = float(value)
                    self._send_json({"result": "ok", "heatingThresholdTemperature": thermostat_state["heating_threshold_temperature"]})
                    print(f"Heating threshold temperature set to {thermostat_state['heating_threshold_temperature']}")
                except ValueError:
                    self._send_json({"error": "Invalid value"}, 400)
            else:
                self._send_json({"error": "Missing value"}, 400)
        else:
            self._send_json({"error": "Not found"}, 404)

if __name__ == "__main__":
    server_address = ('', 8000)
    httpd = HTTPServer(server_address, SimpleHandler)
    print("Serving on port 8000...")
    httpd.serve_forever()