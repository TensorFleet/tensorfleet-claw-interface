export interface TensorfleetTelemetryRosNodeRead {
  /**
   * Global ROS path of the ROS node to read from. Use `--list` to get a list of available nodes (and pass empty array for `parameters`)
   */
  node_id: string;
  /**
   * A list of parameters to read from. Use `["--list"]` to get a list of available parameters
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
