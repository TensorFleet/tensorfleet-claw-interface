export interface TensorfleetTelemetryRosTopicRead {
  /**
   * ROS global topic path to read from. Use `"--list"` to list the available ROS topics
   */
  topic_id: string;
  /**
   * A list of parameters to read from the ROS node
   */
  parameters: string[];
  /**
   * The return type for the response, defaults to JSON
   */
  return_type?: string;
  /**
   * .tensorfleet file absolute path. found in the root of a tensorfleet project folder
   */
  "config-file": string;
}
