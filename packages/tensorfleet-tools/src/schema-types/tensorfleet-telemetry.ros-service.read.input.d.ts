export interface TensorfleetTelemetryRosServiceRead {
  /**
   * Global ROS path of the service. Use `"--list"` for `service_id` to get a list of available services and their schema (and pass empty array for `arguments`)
   */
  service_id: string;
  /**
   * A list of arguments to pass to the service. Use `["--list"]` to get a list of available arguments in the `service-type-map` section
   */
  arguments: string[];
  /**
   * The return type for the response, defaults to JSON
   */
  return_type?: string;
  /**
   * Tensorfleet project directory path. The directory should contain both .tensorfleet and .env files at its root
   */
  "tensorfleet-project-path": string;
}
