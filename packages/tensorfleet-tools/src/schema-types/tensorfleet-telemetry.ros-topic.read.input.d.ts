export interface TensorfleetTelemetryRosTopicRead {
  /**
   * ROS global topic path to read from. Use `"--list"` to list the available ROS topics
   */
  topic_id: string;
  /**
   * The return type for the response, defaults to JSON
   */
  return_type?: string;
  /**
   * Optional Tensorfleet project directory path for legacy .tensorfleet/.env fallback. Omit when using in-memory auth and config-store values.
   */
  "tensorfleet-project-path"?: string;
  /**
   * Regex filter to apply to the query
   */
  regex_filter?: string;
}
