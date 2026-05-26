export { executeEntityRead } from "./tools/entity-read-executor";
export { executeRosNodeRead } from "./tools/ros-node-read-executor";
export { executeRosTopicRead } from "./tools/ros-topic-read-executor";
export { executeRosServiceRead } from "./tools/ros-service-read-executor";
export { executeRosConnect } from "./tools/ros-connect-executor";
export { executeRosDiagnostics } from "./tools/ros-diagnostics-executor";
export { executeVmTool } from "./tools/vm-executor";
export { executeAuthTool } from "./tools/auth-executor";
export { executeDroneTool } from "./tools/drone-executor";
export type { ToolAPI, ToolDefinition, ToolParameters, ToolExecutionResult } from "./tool-api";

// Export schema definitions
import entityReadSchema from "../schema/tensorfleet-telemetry.entity.read.input.json";
import rosNodeReadSchema from "../schema/tensorfleet-telemetry.ros-node.read.input.json";
import rosTopicReadSchema from "../schema/tensorfleet-telemetry.ros-topic.read.input.json";
import rosServiceReadSchema from "../schema/tensorfleet-telemetry.ros-service.read.input.json";
import rosConnectSchema from "../schema/tensorfleet-telemetry.ros-connect.input.json";
import rosDiagnosticsSchema from "../schema/tensorfleet-telemetry.ros-diagnostics.input.json";
import authSchema from "../schema/tensorfleet.auth.input.json";
import vmSchema from "../schema/tensorfleet.vm.input.json";
import droneSchema from "../schema/tensorfleet.drone.input.json";


export { entityReadSchema, rosNodeReadSchema, rosTopicReadSchema, rosServiceReadSchema, rosConnectSchema, rosDiagnosticsSchema, authSchema, vmSchema, droneSchema };
