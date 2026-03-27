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

# Get a list of the available topics
bun run cli ros-topic-read  -p [path-to-your-project-folder] --topic-id=--list --return-type JSON
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
bun run cli ros-topic-read  -p [path-to-your-project-folder] --topic-id=--list --return-type JSON
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
