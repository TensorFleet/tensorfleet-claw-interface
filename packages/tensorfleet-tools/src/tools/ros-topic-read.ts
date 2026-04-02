import { Type } from "@sinclair/typebox";
import { TensorfleetTelemetryRosTopicRead } from "../schema-types/tensorfleet-telemetry.ros-topic.read.input";
import { rosConnect } from "./ros-connect";
import { TensorfleetLogger } from "tensorfleet-util";
const logger = new TensorfleetLogger('Tools');
import { ros2Bridge } from "tensorfleet-ros";
import { filterData } from "../data-filter";

interface TopicInfo {
  topic: string;
  type: string;
}

export async function rosTopicReadTool(_id: string, params: TensorfleetTelemetryRosTopicRead) {
  // First, establish ROS connection using ros-connect tool
  const releaseLock = await rosConnect(_id, params);
  
  try {
    const { topic_id, return_type = "JSON" } = params;
    
    // Validate required parameters
    if (!topic_id) {
      throw new Error("topic_id is required");
    }

    // Handle the --list case to list available topics
    if (topic_id === "--list") {
      // For --list, parameters are not required
      logger.debug('ROS topic read: listing available topics');
      
      const availableTopics = ros2Bridge.getAvailableTopics();
      const topicTypeMap: Record<string, string> = {};
      
      for (const topic of availableTopics) {
        topicTypeMap[topic.topic] = topic.type;
      }
      
      let responseData = {
        topic_type_map: topicTypeMap,
        total_count: Object.keys(topicTypeMap).length
      };
      
      // Apply regex filter if provided
      if (params.regex_filter) {
        try {
          const regex = new RegExp(params.regex_filter, 'i');
          responseData = filterData(responseData, regex) as typeof responseData;
          logger.debug(`Applied regex filter: ${params.regex_filter}`);
        } catch (error) {
          logger.warn(`Invalid regex filter: ${params.regex_filter}`, error);
        }
      }
      
      const responseText = JSON.stringify(responseData, null, 2);
      
      logger.debug(`ROS topic list completed: ${Object.keys(topicTypeMap).length} topics found`);
      
      return {
        content: [{
          type: "text",
          text: responseText || ""
        }]
      };
    }

    logger.debug(`ROS topic read: subscribing to topic ${topic_id}`);

    // Check if topic is available
    const availableTopics = ros2Bridge.getAvailableTopics();
    const topicExists = availableTopics.some((t: TopicInfo) => t.topic === topic_id);
    
    if (!topicExists) {
      // List available topics for debugging
      const topicList = availableTopics.map((t: TopicInfo) => t.topic).join(', ');
      throw new Error(`Topic "${topic_id}" not found. Available topics: ${topicList}`);
    }

    // Wait for one message from the topic
    const messagePromise = new Promise<any>((resolve, reject) => {
      let timeoutId: number;
      
      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        unsubscribe();
      };

      const unsubscribe = ros2Bridge.subscribe(
        { topic: topic_id, type: ros2Bridge.getTopicType(topic_id) ?? "unknown" },
        (message: any) => {
          cleanup();
          resolve(message);
        }
      );

      // Set timeout for waiting for message (30 seconds)
      timeoutId = (globalThis as any).setTimeout(() => {
        cleanup();
        reject(new Error(`Timeout waiting for message on topic "${topic_id}" after 30 seconds`));
      }, 30000);
    });

    const message = await messagePromise;
    
    logger.debug(`Received message from topic ${topic_id}:`, message);

    logger.debug(`ROS topic read completed for topic ${topic_id}`);
    
    return {
      content: [{
        type: "text",
        text: JSON.stringify(message, null, 2) || ""
      }]
    };

  } catch (error) {
    logger.error('ROS topic read failed:', error);
    throw error;
  } finally {
    // Release the lock when we're done
    releaseLock();
  }
}