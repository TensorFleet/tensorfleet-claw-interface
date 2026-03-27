import { Type } from "@sinclair/typebox";
import { TensorfleetTelemetryEntityRead } from "../schema-types/tensorfleet-telemetry.entity.read.input";
import { rosConnect } from "./ros-connect";
import { fetchFeaturedEntities } from "tensorfleet-util";
import { TensorfleetLogger } from "tensorfleet-util";
import { ros2Bridge } from "tensorfleet-ros";

const logger = new TensorfleetLogger('Tools');

export async function entityReadTool(_id: string, params: TensorfleetTelemetryEntityRead) {
  // First, establish ROS connection using ros-connect tool
  const releaseLock = await rosConnect(_id, params);
  
  try {
    const { entity_id, parameters, return_type = "JSON" } = params;
    
    // Validate required parameters
    if (!entity_id) {
      throw new Error("entity_id is required");
    }

    // Handle the --list case to list available entities
    if (entity_id === "--list") {
      // For --list, parameters are not required
      logger.debug('Entity read: listing available entities');
      
      const featuredEntities = await fetchFeaturedEntities(ros2Bridge);
      const entityMap: Record<string, string> = {};
      
      for (const entity of featuredEntities) {
        entityMap[entity.name] = entity.type;
      }
      
      const responseText = JSON.stringify({
        entity_type_map: entityMap,
        total_count: Object.keys(entityMap).length
      }, null, 2);
      
      logger.debug(`Entity list completed: ${Object.keys(entityMap).length} entities found`);
      
      return {
        content: [{
          type: "text",
          text: responseText || ""
        }]
      };
    }

    // For non --list cases, validate that parameters are provided
    if (!parameters || parameters.length === 0) {
      throw new Error("parameters array is required and cannot be empty");
    }

    // Check if entity exists
    const featuredEntities = await fetchFeaturedEntities(ros2Bridge);
    const entity = featuredEntities.find(e => e.name === entity_id);
    
    if (!entity) {
      // List available entities for debugging
      const entityList = featuredEntities.map(e => e.name).join(', ');
      throw new Error(`Entity "${entity_id}" not found. Available entities: ${entityList}`);
    }

    logger.debug(`Entity read: reading from entity ${entity_id} with parameters: ${parameters.join(', ')}`);

    // Handle the --list case for parameters to dump entity data
    if (parameters.length === 1 && parameters[0] === "--list") {
      logger.debug(`Entity read: dumping entity data for ${entity_id}`);
      
      const responseText = JSON.stringify({
        entity_data: entity,
        entity_name: entity.name,
        entity_type: entity.type,
        entity_target: entity.target,
        entity_params: entity.params
      }, null, 2);
      
      logger.debug(`Entity data dump completed for ${entity_id}`);
      
      return {
        content: [{
          type: "text",
          text: responseText || ""
        }]
      };
    }

    // For now, return a not implemented error for specific parameters
    throw new Error(`Entity read for specific parameters is not yet implemented. Use --list to dump entity data.`);
    
  } catch (error) {
    logger.error('Entity read failed:', error);
    throw error;
  } finally {
    // Release the lock when we're done
    releaseLock();
  }
}
