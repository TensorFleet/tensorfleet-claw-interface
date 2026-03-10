export interface TensorfleetTelemetryRosServiceRead {
  /**
   * Global ROS path of the service. Use `"--list"` for `service_id` to get a list of available services and their schema (and pass null for `arguments`)
   */
  service_id: string;
  /**
   * Arguments to pass. Type/Schema depends on the ROS service
   */
  arguments: {
    [k: string]: unknown;
  };
  /**
   * The return type for the response, defaults to JSON
   */
  return_type?: string;
  /**
   * .tensorfleet file absolute path. found in the root of a tensorfleet project folder
   */
  "config-file": string;
}
