# Tensorfleet OpenClaw Plugin

This plugin provides integration between OpenClaw and the ROS environment in the Tensorfleet runtime. It also assists users by controlling the VS Code extension's UI.

## Configuration

The plugin uses the `.tensorfleet` and `.env` configuration files to establish connections to ROS environments. These files should be placed in your project directory and contains the necessary proxy and connection settings.

## Building the plugin

To build the plugin use the `build` script
```bash
bun run build
```

For a continous watch use the `watch` script
```bash
bun run watch
```

## CLI usage

If you have the vscode with the tensorfleet extension up, with the tensorfleet project open and the VM started, you can use the cli to test `tensorfleet-tools` functionalities :

```bash
# Test the connection
bun run cli ros-connect -p [path-to-your-project-folder]
```

### CLI - `ros-topic-read` command
```bash
# Get a list of the available topics
bun run cli ros-topic-read  -p [path-to-your-project-folder] --topic-id=--list
# Result example
# {
#   "topic_type_map": {
#     "/mavros/imu/data": "sensor_msgs/msg/Imu",
#     "/mavros/gpsstatus/gps1/raw": "mavros_msgs/msg/GPSRAW",
#     "/mavros/debug_value/send": "mavros_msgs/msg/DebugValue",
#     "/mavros/hil/rc_inputs": "mavros_msgs/msg/RCIn",
#     "/mavros/debug_value/named_value_int": "mavros_msgs/msg/DebugValue",
#     "/move_base_simple/goal": "geometry_msgs/msg/PoseStamped",
#     "/mavros/local_position/odom": "nav_msgs/msg/Odometry",
#     "/mavros/fake_gps/mocap/tf": "geometry_msgs/msg/TransformStamped",
#     "/mavros/esc_telemetry/telemetry": "mavros_msgs/msg/ESCTelemetry",
#     "/mavros/debug_value/named_value_float": "mavros_msgs/msg/DebugValue",
#     "/mavros/debug_value/debug_vector": "mavros_msgs/msg/DebugValue",
#     "/mavros/open_drone_id/system_update": "mavros_msgs/msg/OpenDroneIDSystemUpdate",
#     "/mavros/debug_value/debug": "mavros_msgs/msg/DebugValue",
#     "/mavros/companion_process/status": "mavros_msgs/msg/CompanionProcessStatus"
#     ...
#   },
#   "total_count": 206
# }


# Read from a topic
bun run cli ros-topic-read  -p [path-to-your-project-folder] --topic-id=--list
# Result example
# {
#   "topic": "/mavros/battery",
#   "type": "sensor_msgs/msg/BatteryState",
#   "msg": {
#     "header": {
#       "stamp": {
#         "sec": 1774591751,
#         "nsec": 762224174
#       },
#       "frame_id": ""
#     },
#     "voltage": 16.200000762939453,
#     "temperature": 0,
#     "current": 1,
#     "charge": null,
#     "capacity": null,
#     "design_capacity": null,
#     "percentage": 1,
#     "power_supply_status": 2,
#     "power_supply_health": 0,
#     "power_supply_technology": 3,
#     "present": true,
#     "cell_voltage": {
#       "0": 16.200000762939453
#     },
#     "cell_temperature": {},
#     "location": "id0",
#     "serial_number": ""
#   }
# }
```

### CLI - `entity-read` command
```bash

# List the available entities and their type
bun run cli entity-read -p [path-to-your-project-folder] --entity-id=--list
# Example result
# {
#   "entity_type_map": {
#     "/mavros": "drone"
#   },
#   "total_count": 1
# }


# Get the metadata for a specific entity
bun run cli entity-read -p [path-to-your-project-folder] --entity-id=/mavros --parameters --list
# Example result
# {
#   "entity_data": {
#     "name": "/mavros",
#     "type": "drone",
#     "target": "/mavros",
#     "params": {
#       "type": "drone",
#       "model_names": [
#         "x500_0"
#       ]
#     }
#   },
#   "entity_name": "/mavros",
#   "entity_type": "drone",
#   "entity_target": "/mavros",
#   "entity_params": {
#     "type": "drone",
#     "model_names": [
#       "x500_0"
#     ]
#   }
# }

```

### CLI - `ros-servicec-read` command
```bash

# Get a list of available service calls
bun run cli ros-service-read -p [path-to-your-project-folder] "--service-id=--list"
# Example result
# {
#   "service_type_map": {
#     "/mavros/wind/set_parameters_atomically": "rcl_interfaces/srv/SetParametersAtomically",
#     "/mavros/wind/set_parameters": "rcl_interfaces/srv/SetParameters",
#     "/mavros/wind/list_parameters": "rcl_interfaces/srv/ListParameters",
#     "/mavros/wind/get_type_description": "type_description_interfaces/srv/GetTypeDescription",
#     "/mavros/wind/get_parameters": "rcl_interfaces/srv/GetParameters",
#     "/mavros/wind/get_parameter_types": "rcl_interfaces/srv/GetParameterTypes",
#     ...
#   },
#   "total_count": 672
# }

```

### CLI - regex-filter usage

For the tools that provide a JSON output, it's possible to apply a smart regex filter to the output. For passing a regex filter use the --regex-filter param.

```bash
bun run cli ros-topic-read -p [path-to-your-project-folder] --topic-id=--list --regex-filter ".*fix.*"

# Example output
# {
#   "topic_type_map": {
#     "/mavros/sim_state/global_position": "sensor_msgs/msg/NavSatFix",
#     "/mavros/global_position/raw/fix": "sensor_msgs/msg/NavSatFix",
#     "/mavros/global_position/global": "sensor_msgs/msg/NavSatFix"
#   }
# }
```