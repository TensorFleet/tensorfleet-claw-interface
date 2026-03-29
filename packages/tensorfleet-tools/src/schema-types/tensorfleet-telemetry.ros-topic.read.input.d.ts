export interface TensorfleetTelemetryRosTopicRead {
  /**
   * ROS global topic path to read from. Use `"--list"` to list the available ROS topics
   */
  topic_id: string;
  /**
   * A list of parameters to read from the ROS node. Use `["--list"]` to get a list of available topics in the `topic-type-map` section
   */
  parameters: string[];
  /**
   * The return type for the response, defaults to JSON
   */
  return_type?: string;
  /**
   * Tensorfleet project directory path. The directory should contain both .tensorfleet and .env files at its root
   */
  "tensorfleet-project-path": string;
  /**
   * Regex filter to apply to the query
   */
  regex_filter?: string;
}
