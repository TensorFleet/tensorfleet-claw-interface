import { Type } from "@sinclair/typebox";
import { TensorfleetTelemetryRosServiceRead } from "../schema-types/tensorfleet-telemetry.ros-service.read.input";
import { rosConnect } from "./ros-connect";
import { TensorfleetLogger } from "tensorfleet-util";
const logger = new TensorfleetLogger('Tools');
import { ros2Bridge } from "tensorfleet-ros";

export async function rosServiceReadTool(_id: string, params: TensorfleetTelemetryRosServiceRead) {
  // First, establish ROS connection using ros-connect tool
  const releaseLock = await rosConnect(_id, params);
  
  try {
    const { service_id, arguments: args, return_type = "JSON" } = params;
    
    // Validate required parameters
    if (!service_id) {
      throw new Error("service_id is required");
    }

    // Handle the --list case to list available services
    if (service_id === "--list") {
      // For --list, arguments are not required
      logger.debug('ROS service read: listing available services');
      
      const availableServices = ros2Bridge.getAvailableServices();
      const serviceTypeMap: Record<string, string> = {};
      
      for (const service of availableServices) {
        serviceTypeMap[service.service] = service.type;
      }
      
      const responseText = JSON.stringify({
        service_type_map: serviceTypeMap,
        total_count: Object.keys(serviceTypeMap).length
      }, null, 2);
      
      logger.debug(`ROS service list completed: ${Object.keys(serviceTypeMap).length} services found`);
      
      return {
        content: [{
          type: "text",
          text: responseText || ""
        }]
      };
    }

    // For non --list cases, validate that arguments are provided
    if (service_id !== "--list" && (!args || args.length === 0)) {
      throw new Error("arguments array is required and cannot be empty");
    }

    logger.debug(`ROS service read: calling service ${service_id} with arguments:`, args);

    // Check if service is available
    const availableServices = ros2Bridge.getAvailableServices();
    const serviceExists = availableServices.some((s: { service: string }) => s.service === service_id);
    
    if (!serviceExists) {
      // List available services for debugging
      const serviceList = availableServices.map((s: { service: string }) => s.service).join(', ');
      throw new Error(`Service "${service_id}" not found. Available services: ${serviceList}`);
    }

    // For --list functionality, return the service schema
    if (args && args.length > 0 && args[0] === "--list") {
      // Return service schema information
      const serviceInfo = availableServices.find((s: { service: string }) => s.service === service_id);
      if (serviceInfo) {
        const responseText = JSON.stringify({
          service_schema: {
            service_id: service_id,
            service_type: serviceInfo.type || "unknown",
            // Note: In a full implementation, we would extract the actual schema
            // from the service definition, but for now we just return the type
          }
        }, null, 2);
        
        logger.debug(`ROS service schema for ${service_id}`);
        
        return {
          content: [{
            type: "text",
            text: responseText || ""
          }]
        };
      } else {
        throw new Error(`Service "${service_id}" not found`);
      }
    }

    // For non --list cases, we would need to convert the arguments array to an object
    // based on the service schema. For now, we'll pass an empty object.
    // In a real implementation, this would parse the arguments array and convert to
    // the proper service request object based on the service schema.
    const serviceArgs = {};
    
    // Call the service
    const result = await ros2Bridge.callService(service_id, serviceArgs);
    
    // Format the response based on return_type
    let responseText: string;
    
    if (return_type === "JSON") {
      responseText = JSON.stringify(result, null, 2);
    } else {
      // For other return types, convert to string representation
      responseText = String(result);
    }

    logger.debug(`ROS service read completed for service ${service_id}`);
    
    return {
      content: [{
        type: "text",
        text: responseText || ""
      }]
    };

  } catch (error) {
    logger.error('ROS service read failed:', error);
    throw error;
  } finally {
    // Release the lock when we're done
    releaseLock();
  }
}