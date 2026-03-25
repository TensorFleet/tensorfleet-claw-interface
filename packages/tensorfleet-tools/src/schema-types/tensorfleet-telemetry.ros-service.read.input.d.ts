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
   * Tensorfleet project directory path. The directory should contain both .tensorfleet and .env files at its root
   */
  "tensorfleet-project-path": string;
}
